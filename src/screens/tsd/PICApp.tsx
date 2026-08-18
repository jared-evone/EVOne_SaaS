import { useState, useEffect } from 'react';
import { C } from '../../theme';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../lib/useIsMobile';
import { usePermissions } from '../../permissions';
import { Logo } from '../../components/Logo';
import { Download as DownloadIcon, Power, Trash2, Search, X } from 'lucide-react';
import { SearchSelect } from '../../components/SearchSelect';
import {
  DEMO_PIC,
  STATUS_COLORS,
  assigneesLabel,
  useWorkOrderStore,
  type WorkOrder,
  type WorkOrderForm,
  type FormTemplate,
  type FormField,
} from '../../workOrderStore';
import { FieldList, FormHeader, FormPaper, openBase64Pdf } from './TechApp';
import { OverlayFormRenderer, isOverlay } from './OverlayForm';
import { PDFPreviewModal, generateWorkOrderPdf } from './PDFExport';

const CPO_BUCKET = 'cpo-maintenance-pdfs';

// Review cards per page in the list pane.
const PER_PAGE = 5;

interface PICAppProps {
  onBack: () => void;
  onSignOut: () => void;
}

const VISIBLE_STATUSES = ['submitted', 'reviewed', 'completed'] as const;

export function PICApp({ onBack, onSignOut }: PICAppProps) {
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: C.seasalt }}>
      <header
        style={{
          background: C.white,
          borderBottom: '1px solid #EBEBEB',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Logo height={26} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: 99,
            background: C.honeydew,
            color: C.green,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          TSD · Person in Charge
        </span>
        <span style={{ fontSize: 12, color: C.slate, marginLeft: 4 }}>{DEMO_PIC}</span>
        <button
          onClick={onBack}
          style={{
            marginLeft: 'auto',
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid #EBEBEB',
            background: 'transparent',
            color: C.slate,
            fontFamily: 'Figtree',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ← TSD Workspace
        </button>
        <button
          onClick={onSignOut}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid #EBEBEB',
            background: 'transparent',
            color: C.slate,
            fontFamily: 'Figtree',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Power size={14} strokeWidth={2.25} />
        </button>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px 60px' }}>
        <PICReviewBoard />
      </div>
    </div>
  );
}

export function PICReviewBoard() {
  const store = useWorkOrderStore();
  const all = store.workOrders.filter((w) => (VISIBLE_STATUSES as readonly string[]).includes(w.status));
  const pending = all.filter((w) => w.status !== 'completed');
  const done = all.filter((w) => w.status === 'completed');
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(pending[0]?.id ?? null);
  const selected = all.find((w) => w.id === selectedId) ?? null;

  // The list is a light projection (no photo/PDF blobs). Pull the full report the
  // moment a work order is selected, and only mount the editor once it's loaded.
  // Tracked per-open (resets on every selection) so a background refetch can never
  // leave us showing a stale/light report.
  const [detailReadyId, setDetailReadyId] = useState<string | null>(null);
  useEffect(() => {
    setDetailReadyId(null);
    if (!selectedId) return;
    let ok = true;
    void store.loadWorkOrderDetail(selectedId).then(() => { if (ok) setDetailReadyId(selectedId); });
    return () => { ok = false; };
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const switchTab = (t: 'pending' | 'completed') => {
    setTab(t);
    const list = t === 'pending' ? pending : done;
    if (!list.some((w) => w.id === selectedId)) setSelectedId(list[0]?.id ?? null);
  };
  const isMobile = useIsMobile();

  // A work order is for a CPO charger when its customerId is a cpo_locations id — flag it
  // on the review card so the reviewer knows they're checking a CPO (not registry) charger.
  const [cpoIds, setCpoIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    supabase.from('cpo_locations').select('id').then(({ data }) => {
      if (!cancelled) setCpoIds(new Set(((data ?? []) as { id: string }[]).map((r) => r.id)));
    });
    return () => { cancelled = true; };
  }, []);

  // Which work orders have already been pushed into CPO Chargers (each push writes
  // a cpo_meter_readings row noting the source work order). Drives the "synced" tag
  // and disables the push button so it can't be sent twice.
  const [pushedIds, setPushedIds] = useState<Set<string>>(new Set());
  const loadPushed = () => {
    void supabase.from('cpo_meter_readings').select('notes').then(({ data }) => {
      const ids = new Set<string>();
      for (const r of (data ?? []) as { notes: string | null }[]) {
        const m = /From work order (\S+)/.exec(r.notes ?? '');
        if (m) ids.add(m[1]);
      }
      setPushedIds(ids);
    });
  };
  useEffect(() => { loadPushed(); }, []);

  // Completed can grow without bound, so it gets filter pills + paging. Each pill
  // is an independent toggle; combining them narrows further.
  const [fThisMonth, setFThisMonth] = useState(false);
  const [fCpo, setFCpo] = useState(false);
  const [fSynced, setFSynced] = useState(false);
  // Free-text search + an exact company picker. Both apply to either tab.
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [tab, fThisMonth, fCpo, fSynced, search, company]);

  const thisMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const woDate = (w: WorkOrder) => w.response?.submittedAt || w.scheduledDate || '';
  const isCpoWo = (w: WorkOrder) => !!w.customerId && cpoIds.has(w.customerId);

  // Everything a reviewer might recognise a job by — ref, company, site, title,
  // technician, category, submitted date.
  const haystack = (w: WorkOrder) =>
    [w.id, w.customer, w.site ?? '', w.title, assigneesLabel(w, ''), w.category ?? '', woDate(w)]
      .join(' ')
      .toLowerCase();

  const tabList = tab === 'completed' ? done : pending;
  const q = search.trim().toLowerCase();
  const matchesSearch = (w: WorkOrder) => !q || haystack(w).includes(q);
  const matchesCompany = (w: WorkOrder) => !company || w.customer === company;

  // Company options come from the current tab, so every choice yields results.
  const companyOptions = (() => {
    const counts = new Map<string, number>();
    for (const w of tabList) if (w.customer) counts.set(w.customer, (counts.get(w.customer) ?? 0) + 1);
    return [
      { value: '', label: 'All companies' },
      ...[...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, n]) => ({ value: name, label: name, sub: `${n} report${n === 1 ? '' : 's'}` })),
    ];
  })();

  const filtered = (tab === 'completed'
    ? done.filter((w) =>
        (!fThisMonth || woDate(w).startsWith(thisMonth)) &&
        (!fCpo || isCpoWo(w)) &&
        (!fSynced || pushedIds.has(w.id)))
    : pending
  ).filter((w) => matchesSearch(w) && matchesCompany(w));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '340px 1fr',
        gap: 20,
      }}
    >
      {/* List pane */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['pending', 'Pending Review', pending.length], ['completed', 'Completed', done.length]] as const).map(([id, label, n]) => (
            <button key={id} onClick={() => switchTab(id)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: `1px solid ${tab === id ? C.green : '#EBEBEB'}`, background: tab === id ? C.green : C.white, color: tab === id ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {label} · {n}
            </button>
          ))}
        </div>
        {/* Search: free text over ref / company / site / title / tech, plus an
            exact company picker for a long customer list. */}
        <div style={{ position: 'relative' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref, company, site, tech…"
            style={{ width: '100%', padding: '8px 30px 8px 32px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12.5, outline: 'none', background: C.white, boxSizing: 'border-box' }}
          />
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}>
            <Search size={13} />
          </span>
          {search && (
            <button onClick={() => setSearch('')} title="Clear search"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, borderRadius: 99, border: 'none', background: '#F3F3F3', color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
              <X size={11} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <SearchSelect
          value={company}
          options={companyOptions}
          onChange={setCompany}
          placeholder="All companies"
          emptyText="No matching company"
        />
        {(search || company) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.slate, fontWeight: 600 }}>
            <span>{filtered.length} match{filtered.length === 1 ? '' : 'es'}</span>
            <button onClick={() => { setSearch(''); setCompany(''); }}
              style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 99, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              Clear filters
            </button>
          </div>
        )}
        {tab === 'completed' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([
              ['This month', fThisMonth, setFThisMonth],
              ['CPO', fCpo, setFCpo],
              ['Synced', fSynced, setFSynced],
            ] as const).map(([label, on, set]) => (
              <button key={label} onClick={() => set(!on)}
                style={{ padding: '5px 12px', borderRadius: 99, border: `1px solid ${on ? C.green : '#EBEBEB'}`, background: on ? C.green : C.white, color: on ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        )}
        {filtered.length === 0 && (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: C.slate,
              fontSize: 13,
              background: C.white,
              borderRadius: 12,
              border: '1px dashed #EBEBEB',
            }}
          >
            {(search || company)
              ? 'No reports match your search.'
              : tab === 'pending'
                ? 'No reports waiting for review.'
                : (fThisMonth || fCpo || fSynced) ? 'No completed reports match these filters.' : 'No completed reports yet.'}
          </div>
        )}
        {visible.map((w) => {
          const sc = STATUS_COLORS[w.status];
          const isActive = selectedId === w.id;
          return (
            <button
              key={w.id}
              onClick={() => setSelectedId(w.id)}
              style={{
                background: C.white,
                borderRadius: 12,
                border: `1.5px solid ${isActive ? C.green : '#EBEBEB'}`,
                padding: '12px 14px',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'Figtree',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>{w.id}</span>
                {!!w.customerId && cpoIds.has(w.customerId) && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: '#E3F0FF', color: '#1A62C0', letterSpacing: '0.04em' }}>CPO</span>
                )}
                {pushedIds.has(w.id) && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: '#E4F3E3', color: '#1B512D', letterSpacing: '0.04em' }}>✓ CPO synced</span>
                )}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 99,
                    background: sc.bg,
                    color: sc.color,
                    marginLeft: 'auto',
                  }}
                >
                  {sc.label}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{w.title || w.customer}</div>
              <div style={{ fontSize: 12, color: C.slate }}>{w.customer}</div>
              <div style={{ fontSize: 11, color: C.slate }}>{w.product ? `${w.product} · ` : ''}{assigneesLabel(w, '—')}</div>
              {w.response?.submittedAt && (
                <div style={{ fontSize: 10, color: C.slate, marginTop: 2 }}>
                  Submitted {w.response.submittedAt}
                </div>
              )}
            </button>
          );
        })}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '2px 2px' }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: safePage <= 1 ? '#C9CFD5' : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: safePage <= 1 ? 'default' : 'pointer' }}>
              ‹ Prev
            </button>
            <span style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>
              {(safePage - 1) * PER_PAGE + 1}–{Math.min(safePage * PER_PAGE, filtered.length)} of {filtered.length}
            </span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: safePage >= totalPages ? '#C9CFD5' : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: safePage >= totalPages ? 'default' : 'pointer' }}>
              Next ›
            </button>
          </div>
        )}
      </div>

      {/* Detail pane */}
      <div>
        {selected ? (
          detailReadyId === selected.id ? (
            <PICReportEditor workOrder={selected} key={selected.id} alreadyPushed={pushedIds.has(selected.id)} onPushed={loadPushed} onDeleted={() => setSelectedId(null)} />
          ) : (
            <div style={{ background: C.white, borderRadius: 14, border: '1px dashed #EBEBEB', padding: '60px 24px', textAlign: 'center', color: C.slate, fontSize: 14 }}>
              Loading report…
            </div>
          )
        ) : (
          <div
            style={{
              background: C.white,
              borderRadius: 14,
              border: '1px dashed #EBEBEB',
              padding: '60px 24px',
              textAlign: 'center',
              color: C.slate,
              fontSize: 14,
            }}
          >
            Select a report on the left to review.
          </div>
        )}
      </div>
    </div>
  );
}

function PICReportEditor({ workOrder, alreadyPushed = false, onPushed, onDeleted }: { workOrder: WorkOrder; alreadyPushed?: boolean; onPushed?: () => void; onDeleted?: () => void }) {
  const store = useWorkOrderStore();
  const { can } = usePermissions();
  const canDelete = can('tsd_pic', 'can_delete');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forms, setForms] = useState<WorkOrderForm[]>(() => workOrder.forms.map((f) => ({ ...f, values: { ...(f.values ?? {}) } })));
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);

  useEffect(() => {
    setForms(workOrder.forms.map((f) => ({ ...f, values: { ...(f.values ?? {}) } })));
    setDirty(false);
    setToast(null);
  }, [workOrder.id, workOrder.response, workOrder.forms]);

  const setField = (i: number, id: string, val: string | boolean) => {
    setForms((fs) => fs.map((f, idx) => (idx === i ? { ...f, values: { ...(f.values ?? {}), [id]: val } } : f)));
    setDirty(true);
  };
  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2400); };
  const completed = workOrder.status === 'completed';

  const handleSave = () => { store.amend(workOrder.id, forms, DEMO_PIC); setDirty(false); flash('Changes saved.'); };
  const handleApprove = () => { if (dirty) store.amend(workOrder.id, forms, DEMO_PIC); store.approve(workOrder.id); setDirty(false); flash('Report approved & marked completed.'); };
  const handleDelete = () => { setConfirmDelete(false); store.deleteWorkOrder(workOrder.id); onDeleted?.(); };

  const hasTemplated = forms.some((f) => !!store.getTemplate(f.templateId));

  // Pull the selected CPO charger + its readings out of the submitted form so the reviewer
  // can push them straight into CPO Chargers storage. Walk the template (incl. group
  // children) so we can match fields BY LABEL — a CPO charger value ends in " · CPO", the
  // code is the token before the em-dash (e.g. "S17321 — …"), and Gun A/B come from their
  // own labelled fields.
  const labeled: { label: string; value: string }[] = [];
  const walkFields = (fields: FormField[], values: Record<string, string | boolean> | undefined) => {
    for (const f of fields) {
      const v = values?.[f.id];
      if (typeof v === 'string' && v.trim()) labeled.push({ label: (f.label ?? '').toLowerCase(), value: v });
      if (f.children) walkFields(f.children, values);
    }
  };
  for (const inst of forms) { const tpl = store.getTemplate(inst.templateId); if (tpl) walkFields(tpl.fields, inst.values); }
  const numByLabel = (re: RegExp) => { const h = labeled.find((x) => re.test(x.label)); return h ? (h.value.replace(/,/g, '').match(/[\d.]+/)?.[0] ?? '') : ''; };
  const allValues = labeled.map((x) => x.value);
  const chargerVal = allValues.find((v) => / · CPO$/.test(v)) ?? '';
  const chargerCode = chargerVal ? chargerVal.split('—')[0].trim() : '';
  const prefillReading = numByLabel(/db meter|meter.*reading|kwh reading|reading.*kwh/)
    || ((allValues.find((v) => /[\d.,]+\s*k?wh/i.test(v)) ?? '').replace(/,/g, '').match(/[\d.]+/)?.[0] ?? '');
  const prefillGunA = numByLabel(/gun\s*a\b|connector\s*a\b|gun a/);
  const prefillGunB = numByLabel(/gun\s*b\b|connector\s*b\b|gun b/);
  const isCpo = !!chargerCode && / · CPO$/.test(chargerVal);
  const auditLine = (
    <>
      {workOrder.response?.submittedAt && <>Submitted by {workOrder.response.submittedBy} on {workOrder.response.submittedAt}</>}
      {workOrder.response?.editedAt && <>{' '}· Last edited by {workOrder.response.editedBy} on {workOrder.response.editedAt}</>}
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Action bar */}
      <div style={{ background: C.white, borderRadius: 12, border: '1px solid #EBEBEB', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{workOrder.id} · {workOrder.customer}</div>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{forms.length} form{forms.length === 1 ? '' : 's'} · {auditLine}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canDelete && (
            <button onClick={() => setConfirmDelete(true)} title="Delete this work order"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Trash2 size={12} strokeWidth={2.25} /> Delete
            </button>
          )}
          {/* Export PDF only after the report is approved & completed. */}
          {hasTemplated && completed && (
            <button onClick={() => setPdfOpen(true)}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <DownloadIcon size={12} strokeWidth={2.25} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} /> Export PDF
            </button>
          )}
          {isCpo && (alreadyPushed ? (
            <span title="This reading has already been sent to CPO Chargers"
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #E4F3E3', background: '#E4F3E3', color: '#1B512D', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'default' }}>
              ✓ Sent to CPO meter readings
            </span>
          ) : (
            <button onClick={() => setPushOpen(true)}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #1A62C0', background: '#E3F0FF', color: '#1A62C0', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              → CPO meter readings
            </button>
          ))}
          {!completed && (
            <>
              <button onClick={handleSave} disabled={!dirty}
                style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${dirty ? C.green : '#EBEBEB'}`, background: dirty ? C.honeydew : C.white, color: dirty ? C.green : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: dirty ? 'pointer' : 'not-allowed' }}>
                Save changes
              </button>
              <button onClick={handleApprove}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                ✓ Approve & complete
              </button>
            </>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete {workOrder.id}?</div>
          <div style={{ fontSize: 12, color: '#C0321A' }}>This permanently removes the work order and its submitted report. This cannot be undone.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmDelete(false)}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleDelete}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, delete</button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ background: C.honeydew, color: C.green, borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{toast}</div>
      )}

      {forms.map((inst, i) => {
        const tpl = store.getTemplate(inst.templateId);
        return (
          <div key={inst.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {forms.length > 1 && (
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '0 2px' }}>
                Form {i + 1} of {forms.length} · {inst.label}
              </div>
            )}
            {tpl ? (
              isOverlay(tpl) ? (
                // Overlay fields are edited in place on the form itself — the PIC
                // reads top to bottom, so no consolidated value list is needed.
                <OverlayFormRenderer template={tpl} values={inst.values ?? {}} onChange={(fid, v) => setField(i, fid, v)} disabled={completed} />
              ) : (
                <FormPaper>
                  <FormHeader template={tpl} workOrder={workOrder} />
                  <FieldList fields={tpl.fields} values={inst.values ?? {}} onChange={(fid, v) => setField(i, fid, v)} disabled={completed} chargerCustomerId={workOrder.customerId} />
                </FormPaper>
              )
            ) : (
              <div style={{ background: C.white, borderRadius: 14, padding: 20, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 13, color: C.slate }}>Non-templated — uploaded PDF report.</div>
                {(inst.reportPdfUrl || inst.reportPdfBase64) ? (
                  <button onClick={() => { if (inst.reportPdfUrl) window.open(inst.reportPdfUrl, '_blank', 'noopener,noreferrer'); else openBase64Pdf(inst.reportPdfBase64!, inst.reportFileName ?? 'report.pdf'); }}
                    style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    <DownloadIcon size={13} strokeWidth={2.25} /> {inst.reportFileName ?? 'Download report PDF'}
                  </button>
                ) : (
                  <div style={{ fontSize: 13, color: '#B45309' }}>No report PDF attached.</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {workOrder.response && (
        <div style={{ background: C.white, borderRadius: 12, border: '1px solid #EBEBEB', padding: '12px 16px', fontSize: 11, color: C.slate, lineHeight: 1.6 }}>
          <div><strong style={{ color: '#1a1a1a' }}>Audit:</strong></div>
          {workOrder.response.submittedBy && <div>Submitted by {workOrder.response.submittedBy} on {workOrder.response.submittedAt}</div>}
          {workOrder.response.editedBy && <div>Edited by {workOrder.response.editedBy} on {workOrder.response.editedAt}</div>}
          {completed && <div>Approved & marked completed.</div>}
        </div>
      )}

      {pdfOpen && (
        <PDFPreviewModal workOrder={workOrder} forms={forms} getTemplate={store.getTemplate} onClose={() => setPdfOpen(false)} />
      )}
      {pushOpen && (
        <PushToCpoModal workOrder={workOrder} forms={forms} getTemplate={store.getTemplate}
          chargerCode={chargerCode} locationId={workOrder.customerId}
          prefillReading={prefillReading} prefillDate={workOrder.scheduledDate}
          prefillGunA={prefillGunA} prefillGunB={prefillGunB}
          onClose={() => setPushOpen(false)} onDone={(msg) => { setPushOpen(false); flash(msg); onPushed?.(); }} />
      )}
    </div>
  );
}

// Push a reviewed CPO work-order meter reading into CPO Chargers storage: resolve the
// charger by code + location, render the work-order form to a PDF, upload it to the
// cpo-maintenance-pdfs bucket, and insert a cpo_meter_readings row. The reviewer verifies
// the reading value and date before it's committed.
function PushToCpoModal({ workOrder, forms, getTemplate, chargerCode, locationId, prefillReading, prefillDate, prefillGunA, prefillGunB, onClose, onDone }: {
  workOrder: WorkOrder;
  forms: WorkOrderForm[];
  getTemplate: (id: string) => FormTemplate | undefined;
  chargerCode: string;
  locationId: string | null;
  prefillReading: string;
  prefillDate: string;
  prefillGunA: string;
  prefillGunB: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [reading, setReading] = useState(prefillReading);
  const [date, setDate] = useState(prefillDate);
  const [gunA, setGunA] = useState(prefillGunA);
  const [gunB, setGunB] = useState(prefillGunB);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };

  const submit = async () => {
    setError(null);
    if (!reading.trim() || isNaN(Number(reading))) { setError('Enter a valid meter reading (kWh).'); return; }
    if (!date) { setError('Pick the reading date.'); return; }
    setBusy(true);
    try {
      // 1. Resolve the CPO charger (by code, scoped to this location when known).
      let ch: { id: string } | null = null;
      if (locationId) {
        const r = await supabase.from('cpo_chargers').select('id').eq('location_id', locationId).eq('charger_code', chargerCode).maybeSingle();
        ch = (r.data as { id: string } | null) ?? null;
      }
      if (!ch) {
        const r = await supabase.from('cpo_chargers').select('id').eq('charger_code', chargerCode).limit(1).maybeSingle();
        ch = (r.data as { id: string } | null) ?? null;
      }
      if (!ch) { setBusy(false); setError(`Couldn't find charger "${chargerCode}" in CPO Chargers.`); return; }
      const chargerId = ch.id;

      // 2. Render the work-order form to a PDF blob (overlay forms are assembled
      //    from flattened page images so they don't freeze the tab).
      const blob = await generateWorkOrderPdf(workOrder, forms, getTemplate);

      // 3. Upload it to the CPO reading storage, then 4. insert the reading (roll back on failure).
      const pdf_path = `chargers/${chargerId}/readings/${crypto.randomUUID()}.pdf`;
      const pdf_filename = `${workOrder.id}.pdf`;
      const { error: upErr } = await supabase.storage.from(CPO_BUCKET).upload(pdf_path, blob, { contentType: 'application/pdf' });
      if (upErr) { setBusy(false); setError(`PDF upload failed: ${upErr.message}`); return; }

      const guns: Record<string, number> = {};
      if (gunA.trim() && !isNaN(Number(gunA))) guns.A = Number(gunA);
      if (gunB.trim() && !isNaN(Number(gunB))) guns.B = Number(gunB);

      const { error: insErr } = await supabase.from('cpo_meter_readings').insert({
        charger_id: chargerId, reading_kwh: Number(reading), reading_date: date,
        recorded_by: workOrder.assignedTo ?? null, notes: `From work order ${workOrder.id}`,
        pdf_path, pdf_filename, gun_readings: Object.keys(guns).length ? guns : null,
      });
      if (insErr) { await supabase.storage.from(CPO_BUCKET).remove([pdf_path]); setBusy(false); setError(insErr.message); return; }

      setBusy(false);
      onDone(`Reading sent to CPO Chargers · ${chargerCode}.`);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Failed to send the reading.');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 480, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Send to CPO meter readings</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>Charger <strong>{chargerCode || '—'}</strong> · from {workOrder.id}</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>DB Meter Reading (kWh)</label>
            <input value={reading} onChange={(e) => setReading(e.target.value)} placeholder="12345.67" style={input} />
          </div>
          <div>
            <label style={label}>Reading Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
          </div>
          <div>
            <label style={label}>Gun A (optional)</label>
            <input value={gunA} onChange={(e) => setGunA(e.target.value)} placeholder="0.00" style={input} />
          </div>
          <div>
            <label style={label}>Gun B (optional)</label>
            <input value={gunB} onChange={(e) => setGunB(e.target.value)} placeholder="0.00" style={input} />
          </div>
        </div>

        <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5 }}>
          The work-order report PDF is generated and attached as the reading sheet. Verify the value and date above before sending.
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}
            style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy}
            style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: busy ? '#A5C8EE' : '#1A62C0', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Sending…' : 'Send reading'}
          </button>
        </div>
      </div>
    </div>
  );
}
