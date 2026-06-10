import { useState, useEffect } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import { Download as DownloadIcon, Power } from 'lucide-react';
import {
  DEMO_PIC,
  OTHER_FORM_ID,
  STATUS_COLORS,
  useWorkOrderStore,
  type FormValues,
  type WorkOrder,
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

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '340px 1fr',
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
  const template = store.getTemplate(workOrder.templateId);
  const [values, setValues] = useState<FormValues>(workOrder.response?.values ?? {});
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  // reset when switching work order
  useEffect(() => {
    setValues(workOrder.response?.values ?? {});
    setDirty(false);
    setToast(null);
  }, [workOrder.id, workOrder.response]);

  if (!template) {
    if (workOrder.templateId === OTHER_FORM_ID) {
      const completedOther = workOrder.status === 'completed';
      return (
        <div style={{ background: C.white, borderRadius: 14, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>{workOrder.id} · {workOrder.customer}</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>Non-templated job — review the uploaded PDF report.</div>
          </div>
          {workOrder.reportPdfBase64 ? (
            <button onClick={() => openBase64Pdf(workOrder.reportPdfBase64!, workOrder.reportFileName ?? `${workOrder.id}.pdf`)}
              style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <DownloadIcon size={13} strokeWidth={2.25} /> {workOrder.reportFileName ?? 'Download report PDF'}
            </button>
          ) : (
            <div style={{ fontSize: 13, color: '#B45309' }}>No report PDF attached.</div>
          )}
          {completedOther ? (
            <div style={{ background: C.honeydew, color: C.green, borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>Approved & marked completed.</div>
          ) : (
            <button onClick={() => store.approve(workOrder.id)}
              style={{ alignSelf: 'flex-start', padding: '10px 22px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Approve & mark completed
            </button>
          )}
        </div>
      );
    }
    return (
      <div style={{ background: C.white, borderRadius: 14, padding: 24, border: '1px solid #EBEBEB' }}>
        Template missing.
      </div>
    );
  }

  const setField = (id: string, val: string | boolean) => {
    setValues((v) => ({ ...v, [id]: val }));
    setDirty(true);
  };

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  const completed = workOrder.status === 'completed';

  const handleSave = () => {
    store.amend(workOrder.id, values, DEMO_PIC);
    setDirty(false);
    flash('Changes saved.');
  };
  const handleApprove = () => {
    if (dirty) store.amend(workOrder.id, values, DEMO_PIC);
    store.approve(workOrder.id);
    setDirty(false);
    flash('Report approved & marked completed.');
  };
  const handleExport = () => {
    setPdfOpen(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Action bar */}
      <div
        style={{
          background: C.white,
          borderRadius: 12,
          border: '1px solid #EBEBEB',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{workOrder.id} · {workOrder.customer}</div>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
            {workOrder.response?.submittedAt && (
              <>
                Submitted by {workOrder.response.submittedBy} on {workOrder.response.submittedAt}
              </>
            )}
            {workOrder.response?.editedAt && (
              <>
                {' '}· Last edited by {workOrder.response.editedBy} on {workOrder.response.editedAt}
              </>
            )}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={handleExport}
            style={{
              padding: '8px 14px',
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
            <DownloadIcon size={12} strokeWidth={2.25} style={{display:"inline",verticalAlign:"-2px",marginRight:4}}/> Export PDF
          </button>
          {!completed && (
            <>
              <button
                onClick={handleSave}
                disabled={!dirty}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: `1px solid ${dirty ? C.green : '#EBEBEB'}`,
                  background: dirty ? C.honeydew : C.white,
                  color: dirty ? C.green : C.slate,
                  fontFamily: 'Figtree',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: dirty ? 'pointer' : 'not-allowed',
                }}
              >
                Save changes
              </button>
              <button
                onClick={handleApprove}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: C.green,
                  color: C.white,
                  fontFamily: 'Figtree',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✓ Approve & complete
              </button>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div
          style={{
            background: C.honeydew,
            color: C.green,
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {toast}
        </div>
      )}

      {isOverlay(template) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* The on-form view — image with positioned filled fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: C.slate,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                padding: '0 2px',
              }}
            >
              On-form view · click any field on the form to edit
            </div>
            <OverlayFormRenderer
              template={template}
              values={values}
              onChange={setField}
              disabled={completed}
            />
          </div>

          {/* Cross-reference list — every filled value, top to bottom */}
          {template.fields.length > 0 && (
            <div
              style={{
                background: C.white,
                borderRadius: 14,
                border: '1px solid #EBEBEB',
                padding: '18px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.slate,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                  }}
                >
                  Cross-reference · Filled values
                </span>
                <span style={{ fontSize: 11, color: C.slate }}>
                  {template.fields.length} field{template.fields.length === 1 ? '' : 's'} · edits sync with the form above
                </span>
              </div>
              <FieldList
                fields={template.fields}
                values={values}
                onChange={setField}
                disabled={completed}
              />
            </div>
          )}

          {workOrder.response && (
            <div
              style={{
                background: C.white,
                borderRadius: 12,
                border: '1px solid #EBEBEB',
                padding: '12px 16px',
                fontSize: 11,
                color: C.slate,
                lineHeight: 1.6,
              }}
            >
              <div>
                <strong style={{ color: '#1a1a1a' }}>Audit:</strong>
              </div>
              {workOrder.response.submittedBy && (
                <div>Submitted by {workOrder.response.submittedBy} on {workOrder.response.submittedAt}</div>
              )}
              {workOrder.response.editedBy && (
                <div>Edited by {workOrder.response.editedBy} on {workOrder.response.editedAt}</div>
              )}
              {completed && <div>Approved & marked completed.</div>}
            </div>
          )}
        </div>
      ) : (
        <FormPaper>
          <FormHeader template={template} workOrder={workOrder} />
          <FieldList fields={template.fields} values={values} onChange={setField} disabled={completed} />
          {workOrder.response && (
            <div style={{ marginTop: 24, borderTop: '1px dashed #EBEBEB', paddingTop: 14, fontSize: 11, color: C.slate, lineHeight: 1.6 }}>
              <div>
                <strong style={{ color: '#1a1a1a' }}>Audit:</strong>
              </div>
              {workOrder.response.submittedBy && (
                <div>Submitted by {workOrder.response.submittedBy} on {workOrder.response.submittedAt}</div>
              )}
              {workOrder.response.editedBy && (
                <div>Edited by {workOrder.response.editedBy} on {workOrder.response.editedAt}</div>
              )}
              {completed && <div>Approved & marked completed.</div>}
            </div>
          )}
        </FormPaper>
      )}

      {pdfOpen && (
        <PDFPreviewModal
          workOrder={workOrder}
          template={template}
          values={values}
          onClose={() => setPdfOpen(false)}
        />
      )}
    </div>
  );
}
