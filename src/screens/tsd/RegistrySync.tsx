import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { supabase } from '../../lib/supabase';
import { SearchSelect } from '../../components/SearchSelect';
import { Check, RotateCcw } from 'lucide-react';
import {
  assigneesLabel,
  useWorkOrderStore,
  type WorkOrder,
  type WorkOrderForm,
  type FormTemplate,
  type RegistrySyncEntry,
} from '../../workOrderStore';
import { generateWorkOrderPdf } from './PDFExport';
import { CHARGER_FORMS_BUCKET, computeLtaFilename, composeChargerFilename, pathSafe, ltaExistFloor } from '../Projects';

type SyncKind = RegistrySyncEntry['kind'];
type Target = 'registry' | 'cpo';
const CPO_BUCKET = 'cpo-maintenance-pdfs';
const KIND_LABEL: Record<SyncKind, string> = { A: 'Form A', D: 'Form D', breakdown: 'Breakdown' };

interface RegCharger {
  id: string;
  asset_tag: string;
  brand_model: string | null;
  turn_on_date: string | null;
  procurement_date: string | null;
  siteName: string;
  formANext?: string | null;
  formDNext?: string | null;
}

interface Row {
  kind: SyncKind;
  chargerId: string;
  date: string;
  description: string;
  status: 'idle' | 'busy' | 'done' | 'error';
  error?: string;
  resync?: boolean;
}

// Work orders whose reports belong on a registry charger once approved.
export const isRegistrySyncCategory = (w: WorkOrder) => /breakdown|form\s*[ad]\b/i.test(`${w.category ?? ''} ${w.title}`);

function guessKind(form: WorkOrderForm, w: WorkOrder, t: FormTemplate | undefined): SyncKind {
  const own = `${form.label} ${t?.name ?? ''}`;
  if (/breakdown/i.test(own)) return 'breakdown';
  if (/form\s*d\b/i.test(own)) return 'D';
  if (/form\s*a\b/i.test(own)) return 'A';
  const cat = `${w.category ?? ''} ${w.title}`;
  if (/breakdown/i.test(cat)) return 'breakdown';
  if (/form\s*d\b/i.test(cat) && !/form\s*a\b/i.test(cat)) return 'D';
  return 'A';
}

// Structured forms' charger field holds "TAG — Brand @ Site · Registry" (or · CPO); overlay
// forms (Form A) have a typed "Charger ID". Match either to a registry tag,
// ignoring case and spaces.
const normTag = (s: string) => s.replace(/\s+/g, '').toLowerCase();
function guessCharger(form: WorkOrderForm, chargers: RegCharger[]): string {
  const values = Object.values(form.values ?? {}).filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length < 120);
  const byTag = (tag: string) => chargers.find((c) => normTag(c.asset_tag) === normTag(tag))?.id ?? '';
  for (const v of values) {
    if (!/ · (Registry|CPO)$/.test(v)) continue;
    const hit = byTag(v.replace(/ · (Registry|CPO)$/, '').split(' @ ')[0].split(' — ')[0]);
    if (hit) return hit;
  }
  for (const v of values) {
    const hit = byTag(v);
    if (hit) return hit;
  }
  return '';
}

async function formPdf(w: WorkOrder, form: WorkOrderForm, getTemplate: (id: string) => FormTemplate | undefined): Promise<Blob> {
  if (form.reportPdfUrl) {
    const r = await fetch(form.reportPdfUrl);
    if (!r.ok) throw new Error('Could not download the uploaded report PDF');
    return r.blob();
  }
  if (form.reportPdfBase64) {
    const bin = atob(form.reportPdfBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'application/pdf' });
  }
  if (!getTemplate(form.templateId)) throw new Error('This form has no report to file');
  return generateWorkOrderPdf(w, [form], getTemplate);
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => isoDay(new Date());
const addMonths = (iso: string, m: number) => {
  const [y, mo, d] = iso.split('-').map(Number);
  return isoDay(new Date(y, mo - 1 + m, d));
};

// After approval, each form of a Breakdown / Form A / Form D work order is filed
// on the charger the reviewer picks, with that form's own PDF attached. Registry
// customers: a Form A/D inspection record or a breakdown report. CPO locations:
// a Form A/D maintenance record (advancing the charger's next due date) or a
// CPO breakdown. Six forms for six chargers become six records, never one.
export function RegistrySyncModal({ workOrder, forms, by, onClose, onDone }: {
  workOrder: WorkOrder;
  forms: WorkOrderForm[];
  by: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const store = useWorkOrderStore();
  const [chargers, setChargers] = useState<RegCharger[] | null>(null);
  const [target, setTarget] = useState<Target>('registry');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [running, setRunning] = useState(false);
  const synced = workOrder.registrySync ?? {};
  const defaultDate = (workOrder.response?.submittedAt || workOrder.scheduledDate || today()).slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!workOrder.customerId) { setChargers([]); return; }
      const list: RegCharger[] = [];
      const loc = await supabase.from('cpo_locations').select('id, name').eq('id', workOrder.customerId).maybeSingle();
      if (cancelled) return;
      if (loc.data) {
        setTarget('cpo');
        const { data, error } = await supabase.from('cpo_chargers')
          .select('id, charger_code, brand_model, form_a_next_date, form_d_next_date')
          .eq('location_id', workOrder.customerId).order('charger_code');
        if (cancelled) return;
        if (error) { setLoadErr(error.message); setChargers([]); return; }
        for (const c of (data ?? []) as { id: string; charger_code: string; brand_model: string | null; form_a_next_date: string | null; form_d_next_date: string | null }[]) {
          list.push({ id: c.id, asset_tag: c.charger_code, brand_model: c.brand_model, turn_on_date: null, procurement_date: null,
            siteName: (loc.data as { name: string }).name, formANext: c.form_a_next_date, formDNext: c.form_d_next_date });
        }
      } else {
        const { data, error } = await supabase.from('project_sites')
          .select('name, position, site_chargers(id, asset_tag, brand_model, turn_on_date, procurement_date)')
          .eq('project_id', workOrder.customerId).order('position');
        if (cancelled) return;
        if (error) { setLoadErr(error.message); setChargers([]); return; }
        for (const s of (data ?? []) as { name: string; site_chargers: Omit<RegCharger, 'siteName'>[] }[]) {
          for (const c of s.site_chargers ?? []) list.push({ ...c, siteName: s.name });
        }
      }
      setChargers(list);
      const init: Record<string, Row> = {};
      for (const f of forms) {
        init[f.id] = {
          kind: guessKind(f, workOrder, store.getTemplate(f.templateId)),
          chargerId: guessCharger(f, list) || (list.length === 1 ? list[0].id : ''),
          date: defaultDate,
          description: workOrder.instructions?.trim() || workOrder.title,
          status: 'idle',
        };
      }
      setRows(init);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const chargerOf = (id: string) => chargers?.find((c) => c.id === id) ?? null;
  const isOpen = (f: WorkOrderForm) => !synced[f.id] || rows[f.id]?.resync;

  const problem = (f: WorkOrderForm): string | null => {
    const r = rows[f.id];
    if (!r || !r.chargerId) return null;
    if (!r.date) return 'Pick the date.';
    if (r.date > today()) return "The date can't be in the future.";
    if (r.kind === 'breakdown') return r.description.trim() ? null : 'Describe the breakdown.';
    const ch = chargerOf(r.chargerId);
    const floor = ch && target === 'registry' ? ltaExistFloor(ch) : null;
    return floor && r.date <= floor ? `This charger was only registered on ${floor} — the inspection date must be after it.` : null;
  };
  const todo = forms.filter((f) => isOpen(f) && rows[f.id]?.chargerId && rows[f.id]?.status !== 'done');
  const blocked = todo.some((f) => !!problem(f));

  const run = async () => {
    setRunning(true);
    let sync: Record<string, RegistrySyncEntry> = { ...synced };
    let ok = 0;
    for (const f of todo) {
      const r = rows[f.id];
      const ch = chargerOf(r.chargerId);
      if (!ch) continue;
      setRow(f.id, { status: 'busy', error: undefined });
      let path: string | null = null;
      try {
        const blob = await formPdf(workOrder, f, store.getTemplate);
        const filename = r.kind === 'breakdown'
          ? composeChargerFilename('Breakdown', ch.asset_tag, r.date, ch.siteName)
          : computeLtaFilename(r.kind, ch.asset_tag, r.date, ch.siteName);
        const note = `From work order ${workOrder.id} · ${f.label}`;
        let recordId: string;
        if (target === 'cpo') {
          path = r.kind === 'breakdown' ? `chargers/${ch.id}/breakdowns/${crypto.randomUUID()}.pdf` : `chargers/${ch.id}/${crypto.randomUUID()}.pdf`;
          const up = await supabase.storage.from(CPO_BUCKET).upload(path, blob, { contentType: 'application/pdf' });
          if (up.error) { path = null; throw new Error(up.error.message); }
          if (r.kind === 'breakdown') {
            const ins = await supabase.from('cpo_breakdowns').insert({
              charger_id: ch.id, breakdown_date: r.date, description: r.description.trim(), technician: assigneesLabel(workOrder, '') || null,
              pdf_path: path, pdf_filename: filename, work_order_id: workOrder.id, created_by: by,
            }).select('id').single();
            if (ins.error || !ins.data) throw new Error(ins.error?.message ?? 'Could not save the breakdown');
            recordId = (ins.data as { id: string }).id;
          } else {
            const nextDue = addMonths(r.date, r.kind === 'A' ? 6 : 12);
            const ins = await supabase.from('cpo_maintenance_records').insert({
              charger_id: ch.id, maintenance_type: r.kind === 'A' ? 'preventive_form_a' : 'preventive_form_d', performed_date: r.date,
              technician: assigneesLabel(workOrder, '') || null, summary: note, pdf_path: path, pdf_filename: filename, next_due_date: nextDue,
            }).select('id').single();
            if (ins.error || !ins.data) throw new Error(ins.error?.message ?? 'Could not save the maintenance record');
            recordId = (ins.data as { id: string }).id;
            // Only move the due date forward — filing an older report mustn't pull it back.
            const current = r.kind === 'A' ? ch.formANext : ch.formDNext;
            if (!current || nextDue > current) {
              await supabase.from('cpo_chargers').update(r.kind === 'A' ? { form_a_next_date: nextDue } : { form_d_next_date: nextDue }).eq('id', ch.id);
              if (r.kind === 'A') ch.formANext = nextDue; else ch.formDNext = nextDue;
            }
          }
        } else {
          path = `${r.kind === 'breakdown' ? 'breakdown' : 'lta'}/${ch.id}/${crypto.randomUUID()}/${pathSafe(filename)}`;
          const up = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(path, blob, { contentType: 'application/pdf' });
          if (up.error) { path = null; throw new Error(up.error.message); }
          const ins = r.kind === 'breakdown'
            ? await supabase.from('charger_breakdowns').insert({
                charger_id: ch.id, breakdown_date: r.date, description: r.description.trim(), storage_path: path, filename,
              }).select('id').single()
            : await supabase.from('charger_lta_records').insert({
                charger_id: ch.id, form_type: r.kind, performed_at: r.date, period_n: null, storage_path: path, filename, notes: note,
              }).select('id').single();
          if (ins.error || !ins.data) throw new Error(ins.error?.message ?? 'Could not save the record');
          recordId = (ins.data as { id: string }).id;
        }
        path = null;
        sync = {
          ...sync,
          [f.id]: { target, chargerId: ch.id, assetTag: ch.asset_tag, kind: r.kind, recordId, date: r.date, syncedAt: new Date().toISOString(), syncedBy: by },
        };
        try {
          await store.setRegistrySync(workOrder.id, sync);
          setRow(f.id, { status: 'done', resync: false });
        } catch (e) {
          setRow(f.id, { status: 'error', error: `Filed on ${ch.asset_tag}, but the work order couldn't note it: ${(e as Error).message}` });
        }
        ok++;
      } catch (e) {
        if (path) void supabase.storage.from(target === 'cpo' ? CPO_BUCKET : CHARGER_FORMS_BUCKET).remove([path]);
        setRow(f.id, { status: 'error', error: (e as Error).message });
      }
    }
    setRunning(false);
    if (ok === todo.length && ok > 0) onDone(`${ok} form${ok === 1 ? '' : 's'} filed into ${target === 'cpo' ? 'CPO Chargers' : 'the Charger Registry'}.`);
  };

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const input: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };
  const chargerOptions = [
    { value: '', label: "Don't file this form" },
    ...(chargers ?? []).map((c) => ({ value: c.id, label: c.asset_tag, sub: [c.siteName, c.brand_model].filter(Boolean).join(' · ') })),
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 720, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{target === 'cpo' ? 'File into CPO Chargers' : 'File into the Charger Registry'}</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{workOrder.id} · {workOrder.customer}{workOrder.site ? ` · ${workOrder.site}` : ''}</div>
          </div>
          <button onClick={onClose} disabled={running} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: running ? 'default' : 'pointer', fontSize: 18, fontFamily: 'Figtree', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>
          {target === 'cpo'
            ? "Each form becomes its own record on the CPO charger you pick — a Form A or Form D maintenance record (which moves that charger's next due date on), or a breakdown — with that form's PDF attached."
            : "Each form becomes its own record on the charger you pick — a Form A or Form D inspection, or a breakdown report — with that form's PDF attached."}
          {' '}Pick a different charger for each form when the job covered several.
        </div>

        {loadErr && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{loadErr}</div>}
        {chargers === null ? (
          <div style={{ padding: 24, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading chargers…</div>
        ) : chargers.length === 0 ? (
          <div style={{ background: '#FFF8E1', color: '#B07D00', borderRadius: 10, padding: '12px 14px', fontSize: 12, fontWeight: 600 }}>
            {workOrder.customer} has no chargers {target === 'cpo' ? 'in CPO Chargers' : 'in the Charger Registry'}, so there is nothing to file into. Add its chargers there first.
          </div>
        ) : (
          forms.map((f) => {
            const r = rows[f.id];
            if (!r) return null;
            const done = synced[f.id];
            const err = r.status === 'error' ? r.error : problem(f);
            return (
              <div key={f.id} style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{f.label}</span>
                  {r.status === 'busy' && <span style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>Filing…</span>}
                  {done && !isOpen(f) && (
                    <>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: '#E4F3E3', color: '#1B512D', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Check size={11} strokeWidth={3} /> {KIND_LABEL[done.kind]} on {done.assetTag} · {done.date}
                      </span>
                      {!running && (
                        <button onClick={() => setRow(f.id, { resync: true, status: 'idle', chargerId: done.chargerId, kind: done.kind, date: done.date })} title="File this form again (e.g. after deleting the record in the registry)"
                          style={{ border: 'none', background: 'none', padding: 0, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <RotateCcw size={11} /> File again
                        </button>
                      )}
                    </>
                  )}
                </div>
                {isOpen(f) && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                      <div>
                        <label style={label}>Record as</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {(['A', 'D', 'breakdown'] as SyncKind[]).map((k) => (
                            <button key={k} type="button" disabled={running} onClick={() => setRow(f.id, { kind: k })}
                              style={{ flex: 1, padding: '8px 6px', borderRadius: 8, border: r.kind === k ? 'none' : '1px solid #EBEBEB', background: r.kind === k ? C.green : C.white, color: r.kind === k ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {KIND_LABEL[k]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label style={label}>Charger</label>
                        <SearchSelect value={r.chargerId} options={chargerOptions} disabled={running}
                          onChange={(v) => setRow(f.id, { chargerId: v, status: 'idle', error: undefined })}
                          placeholder="Pick the charger" emptyText="No chargers match" />
                      </div>
                      <div>
                        <label style={label}>{r.kind === 'breakdown' ? 'Breakdown date' : 'Inspection date'}</label>
                        <input type="date" value={r.date} max={today()} disabled={running} onChange={(e) => setRow(f.id, { date: e.target.value })} style={input} />
                      </div>
                    </div>
                    {r.kind === 'breakdown' && r.chargerId && (
                      <div>
                        <label style={label}>What broke down</label>
                        <input value={r.description} disabled={running} onChange={(e) => setRow(f.id, { description: e.target.value })} placeholder="e.g. Gun B not charging — contactor replaced" style={input} />
                      </div>
                    )}
                  </>
                )}
                {err && <div style={{ fontSize: 12, fontWeight: 600, color: '#C0321A' }}>{err}</div>}
              </div>
            );
          })
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: C.slate, marginRight: 'auto' }}>
            {Object.keys(synced).length} of {forms.length} form{forms.length === 1 ? '' : 's'} filed so far
          </span>
          <button onClick={onClose} disabled={running}
            style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: running ? 'default' : 'pointer' }}>Close</button>
          <button onClick={() => void run()} disabled={running || todo.length === 0 || blocked}
            style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: running || todo.length === 0 || blocked ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: running || todo.length === 0 || blocked ? 'default' : 'pointer' }}>
            {running ? 'Filing…' : `File ${todo.length} form${todo.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
