import { useState, useEffect } from 'react';
import { C } from '../../theme';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../lib/useIsMobile';
import { Logo } from '../../components/Logo';
import { Download as DownloadIcon, Power } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import {
  DEMO_PIC,
  STATUS_COLORS,
  useWorkOrderStore,
  type WorkOrder,
  type WorkOrderForm,
  type FormTemplate,
  type FormField,
} from '../../workOrderStore';
import { FieldList, FormHeader, FormPaper, openBase64Pdf } from './TechApp';
import { OverlayFormRenderer, isOverlay } from './OverlayForm';
import { PDFPreviewModal, WorkOrderDocument } from './PDFExport';

const CPO_BUCKET = 'cpo-maintenance-pdfs';

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
  const visible = store.workOrders.filter((w) =>
    (VISIBLE_STATUSES as readonly string[]).includes(w.status),
  );
  const [selectedId, setSelectedId] = useState<string | null>(visible[0]?.id ?? null);
  const selected = visible.find((w) => w.id === selectedId) ?? null;
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
        <div style={{ fontSize: 13, fontWeight: 700, color: C.slate, padding: '0 4px' }}>
          Review Queue · {visible.length}
        </div>
        {visible.length === 0 && (
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
            No reports waiting for review.
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
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{w.customer}</div>
              <div style={{ fontSize: 11, color: C.slate }}>{w.product ? `${w.product} · ` : ''}{w.assignedTo ?? '—'}</div>
              {w.response?.submittedAt && (
                <div style={{ fontSize: 10, color: C.slate, marginTop: 2 }}>
                  Submitted {w.response.submittedAt}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Detail pane */}
      <div>
        {selected ? (
          <PICReportEditor workOrder={selected} key={selected.id} />
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

function PICReportEditor({ workOrder }: { workOrder: WorkOrder }) {
  const store = useWorkOrderStore();
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
          {/* Export PDF only after the report is approved & completed. */}
          {hasTemplated && completed && (
            <button onClick={() => setPdfOpen(true)}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <DownloadIcon size={12} strokeWidth={2.25} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} /> Export PDF
            </button>
          )}
          {isCpo && (
            <button onClick={() => setPushOpen(true)}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #1A62C0', background: '#E3F0FF', color: '#1A62C0', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              → CPO meter readings
            </button>
          )}
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
                <>
                  <OverlayFormRenderer template={tpl} values={inst.values ?? {}} onChange={(fid, v) => setField(i, fid, v)} disabled={completed} />
                  {tpl.fields.length > 0 && (
                    <div style={{ background: C.white, borderRadius: 14, border: '1px solid #EBEBEB', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Cross-reference · Filled values</span>
                      <FieldList fields={tpl.fields} values={inst.values ?? {}} onChange={(fid, v) => setField(i, fid, v)} disabled={completed} chargerCustomerId={workOrder.customerId} />
                    </div>
                  )}
                </>
              ) : (
                <FormPaper>
                  <FormHeader template={tpl} workOrder={workOrder} />
                  <FieldList fields={tpl.fields} values={inst.values ?? {}} onChange={(fid, v) => setField(i, fid, v)} disabled={completed} chargerCustomerId={workOrder.customerId} />
                </FormPaper>
              )
            ) : (
              <div style={{ background: C.white, borderRadius: 14, padding: 20, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 13, color: C.slate }}>Non-templated — uploaded PDF report.</div>
                {inst.reportPdfBase64 ? (
                  <button onClick={() => openBase64Pdf(inst.reportPdfBase64!, inst.reportFileName ?? 'report.pdf')}
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
          onClose={() => setPushOpen(false)} onDone={(msg) => { setPushOpen(false); flash(msg); }} />
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

      // 2. Render the work-order form to a PDF blob.
      const blob = await pdf(<WorkOrderDocument workOrder={workOrder} forms={forms} getTemplate={getTemplate} />).toBlob();

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
