import { useMemo, useState } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import {
  DEMO_TECHNICIAN,
  STATUS_COLORS,
  useWorkOrderStore,
  type FormField,
  type FormValues,
  type WorkOrder,
} from '../../workOrderStore';
import { OverlayFormRenderer, isOverlay } from './OverlayForm';

interface TechAppProps {
  onBack?: () => void;
  onSignOut?: () => void;
}

export function TechApp({ onBack, onSignOut }: TechAppProps = {}) {
  const store = useWorkOrderStore();
  const me = DEMO_TECHNICIAN;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<'available' | 'mine'>('mine');

  const active = activeId ? store.workOrders.find((w) => w.id === activeId) : null;
  if (active) {
    return (
      <TechFillFormView
        workOrder={active}
        onBack={() => setActiveId(null)}
        onSignOut={onSignOut}
      />
    );
  }

  const available = store.workOrders.filter((w) => w.status === 'open');
  const mine = store.workOrders.filter(
    (w) => w.assignedTo === me && w.status !== 'completed',
  );

  const visible = tab === 'available' ? available : mine;

  return (
    <Shell
      onBack={onBack}
      onSignOut={onSignOut}
      title="My Workday"
      subtitle={`Signed in as ${me}`}
      crumb="Technician"
    >
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(
          [
            ['mine', `My Jobs (${mine.length})`],
            ['available', `Available (${available.length})`],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 12,
              border: tab === k ? 'none' : '1px solid #EBEBEB',
              fontFamily: 'Figtree',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              background: tab === k ? C.green : C.white,
              color: tab === k ? C.white : C.slate,
              boxShadow: tab === k ? '0 6px 14px rgba(42,154,71,0.2)' : 'none',
            }}
          >
            {l}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {visible.length === 0 && (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: C.slate,
              fontSize: 13,
              background: C.white,
              borderRadius: 14,
              border: '1px dashed #EBEBEB',
            }}
          >
            {tab === 'mine' ? 'No open jobs assigned to you.' : 'No jobs available to pick up.'}
          </div>
        )}
        {visible.map((wo) => (
          <WorkOrderCard
            key={wo.id}
            wo={wo}
            actionLabel={
              tab === 'available'
                ? 'Pick up'
                : wo.status === 'in_progress'
                  ? 'Continue'
                  : wo.status === 'assigned'
                    ? 'Start'
                    : 'Open'
            }
            onAction={() => {
              if (wo.status === 'open') store.pickUp(wo.id, me);
              setActiveId(wo.id);
            }}
          />
        ))}
      </div>
    </Shell>
  );
}

// ── Shell ─────────────────────────────────────────────────────────

function Shell({
  children,
  onBack,
  onSignOut,
  title,
  subtitle,
  crumb,
}: {
  children: React.ReactNode;
  onBack?: () => void;
  onSignOut?: () => void;
  title: string;
  subtitle: string;
  crumb: string;
}) {
  // When embedded inside the Dashboard (no onBack/onSignOut), the parent
  // already provides the logo, page title, sign-out menu, and scroll —
  // so the Shell's own chrome would just duplicate it.
  const embedded = !onBack && !onSignOut;
  return (
    <div style={{ height: '100%', overflowY: embedded ? 'visible' : 'auto', background: embedded ? 'transparent' : C.seasalt }}>
      {!embedded && (
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
          TSD · {crumb}
        </span>
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
        {onSignOut && (
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
          ⏻
        </button>
        )}
      </header>
      )}

      <div style={{ maxWidth: 720, margin: '0 auto', padding: embedded ? '0 0 60px' : '24px 20px 60px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>{title}</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>{subtitle}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Work order card ───────────────────────────────────────────────

function WorkOrderCard({
  wo,
  actionLabel,
  onAction,
}: {
  wo: WorkOrder;
  actionLabel: string;
  onAction: () => void;
}) {
  const sc = STATUS_COLORS[wo.status];
  const priorityColor = wo.priority === 'high' ? '#C0321A' : wo.priority === 'low' ? C.slate : C.opal;
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 14,
        border: '1px solid #EBEBEB',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em' }}>{wo.id}</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: sc.bg, color: sc.color }}>{sc.label}</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 700,
            color: priorityColor,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {wo.priority}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.3 }}>{wo.title}</div>
      <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>
        {wo.customer} · {wo.product}
        <br />
        {wo.address}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <span style={{ fontSize: 11, color: C.slate }}>📅 {wo.scheduledDate}</span>
        <button
          onClick={onAction}
          style={{
            marginLeft: 'auto',
            padding: '8px 16px',
            borderRadius: 10,
            border: 'none',
            background: C.green,
            color: C.white,
            fontFamily: 'Figtree',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {actionLabel} →
        </button>
      </div>
    </div>
  );
}

// ── Fill-form view ────────────────────────────────────────────────

function TechFillFormView({
  workOrder,
  onBack,
  onSignOut,
}: {
  workOrder: WorkOrder;
  onBack: () => void;
  onSignOut?: () => void;
}) {
  const store = useWorkOrderStore();
  const me = DEMO_TECHNICIAN;
  const template = store.getTemplate(workOrder.templateId);
  const [values, setValues] = useState<FormValues>(() => workOrder.response?.values ?? {});
  const [savedAt, setSavedAt] = useState<string | null>(null);

  if (!template) {
    return (
      <Shell onBack={onBack} onSignOut={onSignOut} title="Form not found" subtitle="" crumb="Technician">
        <div>This work order references a missing template.</div>
      </Shell>
    );
  }

  const setField = (id: string, val: string | boolean) =>
    setValues((v) => ({ ...v, [id]: val }));

  const missingRequired = useMemo(
    () =>
      template.fields
        .filter((f) => f.required)
        .filter((f) => {
          const v = values[f.id];
          return v === undefined || v === '' || v === false;
        }),
    [template.fields, values],
  );

  const readOnly = workOrder.status === 'submitted' || workOrder.status === 'reviewed' || workOrder.status === 'completed';

  const handleSaveDraft = () => {
    store.saveDraft(workOrder.id, values);
    setSavedAt(new Date().toLocaleTimeString());
  };
  const handleSubmit = () => {
    if (missingRequired.length > 0) return;
    store.submit(workOrder.id, values, me);
    onBack();
  };

  return (
    <Shell
      onBack={onBack}
      onSignOut={onSignOut}
      title={template.name}
      subtitle={`${workOrder.id} · ${workOrder.customer}`}
      crumb="Technician"
    >
      {isOverlay(template) ? (
        <OverlayFormRenderer
          template={template}
          values={values}
          onChange={setField}
          disabled={readOnly}
        />
      ) : (
        <FormPaper>
          <FormHeader template={template} workOrder={workOrder} />
          <FieldList
            fields={template.fields}
            values={values}
            onChange={setField}
            disabled={readOnly}
          />
        </FormPaper>
      )}

      {readOnly ? (
        <div
          style={{
            marginTop: 18,
            padding: '12px 16px',
            background: C.honeydew,
            color: C.green,
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          This report has been submitted. The PIC handles edits from here.
        </div>
      ) : (
        <div
          style={{
            marginTop: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 16,
            background: C.white,
            borderRadius: 12,
            border: '1px solid #EBEBEB',
          }}
        >
          {missingRequired.length > 0 && (
            <div
              style={{
                fontSize: 12,
                color: '#C0321A',
                background: '#FDEAEA',
                padding: '8px 12px',
                borderRadius: 8,
              }}
            >
              Required: {missingRequired.map((f) => f.label).join(', ')}
            </div>
          )}
          {savedAt && (
            <div style={{ fontSize: 11, color: C.slate, textAlign: 'center' }}>
              Draft saved at {savedAt}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleSaveDraft}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: 10,
                border: `1px solid ${C.green}`,
                background: 'transparent',
                color: C.green,
                fontFamily: 'Figtree',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Save draft
            </button>
            <button
              onClick={handleSubmit}
              disabled={missingRequired.length > 0}
              style={{
                flex: 2,
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background: missingRequired.length > 0 ? '#A5D6A7' : C.green,
                color: C.white,
                fontFamily: 'Figtree',
                fontSize: 13,
                fontWeight: 700,
                cursor: missingRequired.length > 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Submit report
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ── Form rendering helpers (also used by PIC) ─────────────────────

export function FormPaper({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 14,
        border: '1px solid #EBEBEB',
        padding: '28px 28px 32px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
      }}
    >
      {children}
    </div>
  );
}

export interface FormHeaderInfo {
  id: string;
  scheduledDate: string;
  assignedTo: string | null;
}

export function FormHeader({
  template,
  workOrder,
}: {
  template: { name: string; description: string };
  workOrder: FormHeaderInfo;
}) {
  return (
    <div
      style={{
        borderBottom: '2px solid ' + C.green,
        paddingBottom: 14,
        marginBottom: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Logo height={26} />
        <div style={{ flex: 1, minWidth: 140 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: C.green,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              lineHeight: 1.3,
            }}
          >
            {template.name}
          </div>
          {template.description && (
            <div
              style={{
                fontSize: 11,
                color: C.slate,
                marginTop: 3,
                lineHeight: 1.4,
              }}
            >
              {template.description}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 14px',
          fontSize: 11,
          color: C.slate,
        }}
      >
        <span>
          <strong style={{ color: '#1a1a1a' }}>Ref:</strong> {workOrder.id}
        </span>
        <span>
          <strong style={{ color: '#1a1a1a' }}>Scheduled:</strong> {workOrder.scheduledDate}
        </span>
        <span>
          <strong style={{ color: '#1a1a1a' }}>Technician:</strong> {workOrder.assignedTo ?? '—'}
        </span>
      </div>
    </div>
  );
}

export function FieldList({
  fields,
  values,
  onChange,
  disabled = false,
}: {
  fields: FormField[];
  values: FormValues;
  onChange: (id: string, val: string | boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {fields.map((f) => (
        <FieldRow key={f.id} field={f} value={values[f.id]} onChange={onChange} disabled={disabled} />
      ))}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: string | boolean | undefined;
  onChange: (id: string, val: string | boolean) => void;
  disabled: boolean;
}) {
  if (field.type === 'section') {
    return (
      <div
        style={{
          marginTop: 12,
          paddingBottom: 6,
          borderBottom: '1px solid #EBEBEB',
          fontSize: 13,
          fontWeight: 700,
          color: C.green,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
        }}
      >
        {field.label}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    const checked = value === true;
    return (
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 10,
          background: checked ? C.honeydew : '#F9F9F9',
          border: `1px solid ${checked ? C.green : '#EBEBEB'}`,
          cursor: disabled ? 'default' : 'pointer',
          fontSize: 13,
          color: '#1a1a1a',
          transition: 'background .15s, border-color .15s',
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(field.id, e.target.checked)}
          style={{ width: 18, height: 18, accentColor: C.green, cursor: disabled ? 'default' : 'pointer' }}
        />
        <span>{field.label}</span>
        {field.required && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#C0321A' }}>required</span>}
      </label>
    );
  }

  const isTextarea = field.type === 'textarea';
  const strVal = typeof value === 'string' ? value : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {field.label}
        {field.required && <span style={{ color: '#C0321A', marginLeft: 6 }}>*</span>}
      </label>
      {isTextarea ? (
        <textarea
          value={strVal}
          disabled={disabled}
          rows={3}
          onChange={(e) => onChange(field.id, e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #EBEBEB',
            fontFamily: 'Figtree',
            fontSize: 13,
            outline: 'none',
            resize: 'vertical',
            lineHeight: 1.5,
            background: disabled ? '#F9F9F9' : C.white,
          }}
        />
      ) : (
        <input
          value={strVal}
          disabled={disabled}
          onChange={(e) => onChange(field.id, e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #EBEBEB',
            fontFamily: 'Figtree',
            fontSize: 13,
            outline: 'none',
            background: disabled ? '#F9F9F9' : C.white,
          }}
        />
      )}
    </div>
  );
}
