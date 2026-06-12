import { useState, useEffect } from 'react';
import { C } from '../../theme';
import { useIsMobile } from '../../lib/useIsMobile';
import { Logo } from '../../components/Logo';
import { Download as DownloadIcon, Power } from 'lucide-react';
import {
  DEMO_PIC,
  STATUS_COLORS,
  useWorkOrderStore,
  type WorkOrder,
  type WorkOrderForm,
} from '../../workOrderStore';
import { FieldList, FormHeader, FormPaper, openBase64Pdf } from './TechApp';
import { OverlayFormRenderer, isOverlay } from './OverlayForm';
import { PDFPreviewModal } from './PDFExport';

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
          {hasTemplated && (
            <button onClick={() => setPdfOpen(true)}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <DownloadIcon size={12} strokeWidth={2.25} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} /> Export PDF
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
    </div>
  );
}
