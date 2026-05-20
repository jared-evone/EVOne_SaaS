import { useState } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import {
  STATUS_COLORS,
  TECHNICIANS,
  useWorkOrderStore,
  type Customer,
  type CustomerType,
  type FieldType,
  type FormField,
  type FormTemplate,
  type FormValues,
  type WorkOrder,
  type WorkOrderStatus,
} from '../../workOrderStore';
import { FieldList, FormHeader, FormPaper } from './TechApp';
import { OverlayEditor, OverlayFormRenderer, isOverlay } from './OverlayForm';
import { PICReviewBoard } from './PICApp';

interface TSDAdminAppProps {
  onBack: () => void;
  onSignOut: () => void;
}

type AdminScreen = 'workorders' | 'customers' | 'forms' | 'pic';

export function TSDAdminApp({ onBack, onSignOut }: TSDAdminAppProps) {
  const [screen, setScreen] = useState<AdminScreen>('workorders');

  const NAV: { id: AdminScreen; icon: string; label: string }[] = [
    { id: 'workorders', icon: '◧', label: 'Work Orders' },
    { id: 'customers',  icon: '◉', label: 'Customers' },
    { id: 'forms',      icon: '◫', label: 'Form Templates' },
    { id: 'pic',        icon: '◑', label: 'PIC Review' },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: C.seasalt }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          background: C.white,
          borderRight: '1px solid #EBEBEB',
          display: 'flex',
          flexDirection: 'column',
          padding: '0 12px',
        }}
      >
        <div style={{ padding: '20px 8px 14px', borderBottom: '1px solid #F3F3F3', marginBottom: 6 }}>
          <Logo height={30} />
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 99,
              background: C.honeydew,
              color: C.green,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              marginTop: 8,
              display: 'inline-block',
            }}
          >
            TSD · Admin
          </div>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 8 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: C.slate,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '6px 16px 4px',
            }}
          >
            Manage
          </div>
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setScreen(n.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                background: screen === n.id ? C.honeydew : 'transparent',
                color: screen === n.id ? C.green : C.slate,
                fontFamily: 'Figtree',
                fontSize: 13,
                fontWeight: screen === n.id ? 700 : 500,
                width: '100%',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        <div style={{ borderTop: '1px solid #F3F3F3', padding: '12px 6px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onBack}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #EBEBEB',
              background: 'transparent',
              color: C.slate,
              fontFamily: 'Figtree',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            ← TSD Workspace
          </button>
          <button
            onClick={onSignOut}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #EBEBEB',
              background: 'transparent',
              color: C.slate,
              fontFamily: 'Figtree',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            ⏻ Sign out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header
          style={{
            height: 60,
            flexShrink: 0,
            background: C.white,
            borderBottom: '1px solid #EBEBEB',
            display: 'flex',
            alignItems: 'center',
            padding: '0 28px',
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>
              {screen === 'workorders'
                ? 'Work Order Management'
                : screen === 'customers'
                  ? 'Customers'
                  : screen === 'forms'
                    ? 'Form Builder'
                    : 'PIC Review'}
            </div>
            <div style={{ fontSize: 11, color: C.slate }}>
              {screen === 'workorders'
                ? 'Create, assign, and track field jobs'
                : screen === 'customers'
                  ? 'Customer registry linked to work orders'
                  : screen === 'forms'
                    ? 'Design the forms technicians fill in the field'
                    : 'Review submitted reports, amend, and sign off'}
            </div>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {screen === 'workorders' && <WorkOrdersAdmin />}
          {screen === 'customers' && <CustomersAdmin />}
          {screen === 'forms' && <FormBuilder />}
          {screen === 'pic' && <PICReviewBoard />}
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Work Orders admin
// ─────────────────────────────────────────────────────────────────

function WorkOrdersAdmin() {
  const store = useWorkOrderStore();
  const [statusFilter, setStatusFilter] = useState<'all' | WorkOrderStatus>('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'new' | WorkOrder | null>(null);

  const visible = store.workOrders.filter(
    (w) =>
      (statusFilter === 'all' || w.status === statusFilter) &&
      (w.customer.toLowerCase().includes(search.toLowerCase()) ||
        w.id.toLowerCase().includes(search.toLowerCase())),
  );

  const countBy = (s: WorkOrderStatus) =>
    store.workOrders.filter((w) => w.status === s).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Status summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        {(['open', 'assigned', 'in_progress', 'submitted', 'reviewed', 'completed'] as WorkOrderStatus[]).map(
          (s) => {
            const sc = STATUS_COLORS[s];
            return (
              <div
                key={s}
                style={{
                  background: C.white,
                  borderRadius: 12,
                  border: '1px solid #EBEBEB',
                  padding: '12px 14px',
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: sc.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {sc.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.green, marginTop: 4, letterSpacing: '-0.02em' }}>
                  {countBy(s)}
                </div>
              </div>
            );
          },
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', 'open', 'assigned', 'in_progress', 'submitted', 'reviewed', 'completed'] as const).map((s) => {
            const label = s === 'all' ? 'All' : STATUS_COLORS[s].label;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 99,
                  border: `1px solid ${statusFilter === s ? C.green : '#EBEBEB'}`,
                  background: statusFilter === s ? C.green : C.white,
                  color: statusFilter === s ? C.white : C.slate,
                  fontFamily: 'Figtree',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ position: 'relative', width: 220 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search work orders…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
          />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
        </div>
        <button
          onClick={() => setModal('new')}
          style={{ marginLeft: 'auto', padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + New Work Order
        </button>
      </div>

      {/* Table */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Ref', 'Title', 'Customer', 'Product', 'Tech', 'Date', 'Priority', 'Status'].map((h) => (
                <th
                  key={h}
                  style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((w) => {
              const sc = STATUS_COLORS[w.status];
              return (
                <tr
                  key={w.id}
                  style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                  onClick={() => setModal(w)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '11px 14px', fontWeight: 700, color: C.green }}>{w.id}</td>
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: '#1a1a1a' }}>{w.title}</td>
                  <td style={{ padding: '11px 14px', color: '#1a1a1a' }}>{w.customer}</td>
                  <td style={{ padding: '11px 14px', color: C.slate }}>{w.product}</td>
                  <td style={{ padding: '11px 14px', color: C.slate }}>{w.assignedTo ?? '—'}</td>
                  <td style={{ padding: '11px 14px', color: C.slate }}>{w.scheduledDate}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 99,
                        background: w.priority === 'high' ? '#FDEAEA' : w.priority === 'low' ? '#F3F3F3' : '#E3F0FF',
                        color: w.priority === 'high' ? '#C0321A' : w.priority === 'low' ? C.slate : '#1A62C0',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {w.priority}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: 99,
                        background: sc.bg,
                        color: sc.color,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {sc.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: C.slate, fontSize: 14 }}>
            No work orders match your filters.
          </div>
        )}
      </div>

      {modal && (
        <WorkOrderModal
          mode={modal === 'new' ? 'new' : 'edit'}
          workOrder={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function WorkOrderModal({
  mode,
  workOrder,
  onClose,
}: {
  mode: 'new' | 'edit';
  workOrder: WorkOrder | null;
  onClose: () => void;
}) {
  const store = useWorkOrderStore();
  const isNew = mode === 'new';
  const [form, setForm] = useState({
    title: workOrder?.title ?? '',
    customerId: workOrder?.customerId ?? (store.customers[0]?.id ?? null),
    customer: workOrder?.customer ?? (store.customers[0]?.name ?? ''),
    address: workOrder?.address ?? (store.customers[0]?.address ?? ''),
    product: workOrder?.product ?? '7kW Home Charger',
    scheduledDate: workOrder?.scheduledDate ?? '2026-05-08',
    priority: workOrder?.priority ?? ('normal' as 'low' | 'normal' | 'high'),
    templateId: workOrder?.templateId ?? store.templates[0]?.id ?? '',
    assignedTo: workOrder?.assignedTo ?? null,
  });

  const selectCustomer = (customerId: string) => {
    const c = store.customers.find((x) => x.id === customerId);
    if (!c) return;
    setForm((f) => ({
      ...f,
      customerId: c.id,
      customer: c.name,
      address: c.address,
    }));
  };

  const handleSave = () => {
    if (isNew) {
      store.createWorkOrder({
        title: form.title || 'Untitled work order',
        customerId: form.customerId,
        customer: form.customer,
        address: form.address,
        product: form.product,
        scheduledDate: form.scheduledDate,
        priority: form.priority,
        templateId: form.templateId,
        assignedTo: form.assignedTo,
      });
    } else if (workOrder) {
      store.reassign(workOrder.id, form.assignedTo);
    }
    onClose();
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        style={{
          background: C.white,
          borderRadius: 20,
          width: 580,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 28,
          boxShadow: '0 24px 64px rgba(0,0,0,.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>
              {isNew ? 'New Work Order' : workOrder!.id}
            </div>
            {!isNew && (
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                Status: {STATUS_COLORS[workOrder!.status].label}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F3F3', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: C.slate }}>
            ×
          </button>
        </div>

        <FormRow label="Title">
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. 7kW Wallbox install"
            disabled={!isNew}
            style={inputStyle(!isNew)}
          />
        </FormRow>
        <FormRow label="Customer">
          {isNew && store.customers.length > 0 ? (
            <select
              value={form.customerId ?? ''}
              onChange={(e) => selectCustomer(e.target.value)}
              style={inputStyle(false)}
            >
              {store.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.type}
                </option>
              ))}
            </select>
          ) : (
            <input value={form.customer} disabled style={inputStyle(true)} />
          )}
          {isNew && (
            <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>
              Add new customers in the Customers tab. Address pulls from their profile.
            </div>
          )}
        </FormRow>
        <FormRow label="Address (auto-filled from customer)">
          <input
            value={form.address}
            disabled
            style={inputStyle(true)}
          />
        </FormRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormRow label="Product">
            <input
              value={form.product}
              onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
              disabled={!isNew}
              style={inputStyle(!isNew)}
            />
          </FormRow>
          <FormRow label="Scheduled date">
            <input
              type="date"
              value={form.scheduledDate}
              onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))}
              disabled={!isNew}
              style={inputStyle(!isNew)}
            />
          </FormRow>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormRow label="Priority">
            <select
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as 'low' | 'normal' | 'high' }))}
              disabled={!isNew}
              style={inputStyle(!isNew)}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </FormRow>
          <FormRow label="Form template">
            <select
              value={form.templateId}
              onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}
              disabled={!isNew}
              style={inputStyle(!isNew)}
            >
              {store.templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </FormRow>
        </div>
        <FormRow label="Assigned technician">
          <select
            value={form.assignedTo ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value || null }))}
            style={inputStyle(false)}
          >
            <option value="">— Unassigned —</option>
            {TECHNICIANS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </FormRow>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: 10,
              border: '1px solid #EBEBEB',
              background: 'transparent',
              color: C.slate,
              fontFamily: 'Figtree',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '10px 24px',
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
            {isNew ? 'Create work order' : 'Save assignment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 10,
    border: '1px solid #EBEBEB',
    fontFamily: 'Figtree',
    fontSize: 13,
    outline: 'none',
    background: disabled ? '#F9F9F9' : C.white,
    color: '#1a1a1a',
  };
}

// ─────────────────────────────────────────────────────────────────
// Customers admin
// ─────────────────────────────────────────────────────────────────

const CUSTOMER_TYPE_COLORS: Record<CustomerType, { bg: string; color: string }> = {
  Residential: { bg: '#F3F3F3',  color: C.slate },
  Commercial:  { bg: '#E6F4EA',  color: C.green },
  Enterprise:  { bg: C.green,    color: C.white },
};

function CustomersAdmin() {
  const store = useWorkOrderStore();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | CustomerType>('All');
  const [modal, setModal] = useState<Customer | 'new' | null>(null);

  const linkedCount = (id: string) =>
    store.workOrders.filter((w) => w.customerId === id).length;

  const filtered = store.customers.filter(
    (c) =>
      (typeFilter === 'All' || c.type === typeFilter) &&
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.email.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {(['Residential', 'Commercial', 'Enterprise'] as CustomerType[]).map((t) => {
          const sc = CUSTOMER_TYPE_COLORS[t];
          const count = store.customers.filter((c) => c.type === t).length;
          return (
            <div
              key={t}
              style={{
                background: C.white,
                borderRadius: 12,
                border: '1px solid #EBEBEB',
                padding: '12px 14px',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: sc.color === C.white ? C.green : sc.color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {t}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.green, marginTop: 4, letterSpacing: '-0.02em' }}>
                {count}
              </div>
            </div>
          );
        })}
        <div
          style={{
            background: C.white,
            borderRadius: 12,
            border: '1px solid #EBEBEB',
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Total
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.green, marginTop: 4, letterSpacing: '-0.02em' }}>
            {store.customers.length}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['All', 'Residential', 'Commercial', 'Enterprise'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              style={{
                padding: '6px 12px',
                borderRadius: 99,
                border: `1px solid ${typeFilter === t ? C.green : '#EBEBEB'}`,
                background: typeFilter === t ? C.green : C.white,
                color: typeFilter === t ? C.white : C.slate,
                fontFamily: 'Figtree',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', width: 240 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers…"
            style={{
              width: '100%',
              padding: '8px 14px 8px 34px',
              borderRadius: 99,
              border: '1px solid #EBEBEB',
              fontFamily: 'Figtree',
              fontSize: 13,
              outline: 'none',
              background: C.white,
            }}
          />
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: C.slate,
              fontSize: 15,
            }}
          >
            ⌕
          </span>
        </div>
        <button
          onClick={() => setModal('new')}
          style={{
            marginLeft: 'auto',
            padding: '9px 18px',
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
          + New Customer
        </button>
      </div>

      {/* Table */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Customer', 'Type', 'Email', 'Phone', 'Address', 'Work Orders'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '11px 14px',
                    textAlign: 'left',
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.slate,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    borderBottom: '1px solid #EBEBEB',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const sc = CUSTOMER_TYPE_COLORS[c.type];
              const wos = linkedCount(c.id);
              return (
                <tr
                  key={c.id}
                  style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                  onClick={() => setModal(c)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: C.honeydew,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 13,
                          fontWeight: 700,
                          color: C.green,
                          flexShrink: 0,
                        }}
                      >
                        {c.name[0]}
                      </div>
                      <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{c.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: sc.bg,
                        color: sc.color,
                      }}
                    >
                      {c.type}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', color: C.slate }}>{c.email}</td>
                  <td style={{ padding: '11px 14px', color: C.slate }}>{c.phone}</td>
                  <td style={{ padding: '11px 14px', color: C.slate, fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.address}
                  </td>
                  <td style={{ padding: '11px 14px', fontWeight: 700, color: C.green }}>{wos}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: C.slate, fontSize: 14 }}>
            No customers found.
          </div>
        )}
      </div>

      {modal && (
        <CustomerModal
          customer={modal === 'new' ? null : modal}
          linkedWorkOrderCount={modal === 'new' ? 0 : linkedCount(modal.id)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function CustomerModal({
  customer,
  linkedWorkOrderCount,
  onClose,
}: {
  customer: Customer | null;
  linkedWorkOrderCount: number;
  onClose: () => void;
}) {
  const store = useWorkOrderStore();
  const isNew = !customer;
  const [form, setForm] = useState<Customer>(
    customer ?? {
      id: `cust-${Date.now()}`,
      name: '',
      type: 'Residential',
      email: '',
      phone: '',
      address: '',
      notes: '',
    },
  );

  const handleSave = () => {
    if (!form.name.trim()) return;
    store.saveCustomer(form);
    onClose();
  };

  const handleDelete = () => {
    if (linkedWorkOrderCount > 0) {
      const ok = window.confirm(
        `This customer is linked to ${linkedWorkOrderCount} work order${linkedWorkOrderCount === 1 ? '' : 's'}. ` +
          `Deleting will leave those work orders with a frozen name & address but no live customer link. Continue?`,
      );
      if (!ok) return;
    }
    store.deleteCustomer(form.id);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.32)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: C.white,
          borderRadius: 20,
          width: 580,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 28,
          boxShadow: '0 24px 64px rgba(0,0,0,.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>
              {isNew ? 'New Customer' : form.name || 'Customer'}
            </div>
            {!isNew && (
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                {linkedWorkOrderCount} work order{linkedWorkOrderCount === 1 ? '' : 's'} linked
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: '#F3F3F3',
              borderRadius: 8,
              width: 32,
              height: 32,
              cursor: 'pointer',
              fontSize: 16,
              color: C.slate,
            }}
          >
            ×
          </button>
        </div>

        <FormRow label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Ahmad Razif"
            style={inputStyle(false)}
          />
        </FormRow>

        <FormRow label="Customer Type">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['Residential', 'Commercial', 'Enterprise'] as CustomerType[]).map((t) => {
              const sc = CUSTOMER_TYPE_COLORS[t];
              return (
                <button
                  key={t}
                  onClick={() => setForm((f) => ({ ...f, type: t }))}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    borderRadius: 10,
                    border: `2px solid ${form.type === t ? (sc.color === C.white ? C.green : sc.color) : '#EBEBEB'}`,
                    background: form.type === t ? sc.bg : C.white,
                    color: form.type === t ? sc.color : C.slate,
                    fontFamily: 'Figtree',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </FormRow>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormRow label="Email">
            <input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="customer@email.com"
              style={inputStyle(false)}
            />
          </FormRow>
          <FormRow label="Phone">
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+60..."
              style={inputStyle(false)}
            />
          </FormRow>
        </div>

        <FormRow label="Address">
          <input
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            placeholder="Installation / billing address"
            style={inputStyle(false)}
          />
        </FormRow>

        <FormRow label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            placeholder="Relationship notes, special requirements…"
            style={{ ...inputStyle(false), resize: 'vertical', lineHeight: 1.5 }}
          />
        </FormRow>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {!isNew && (
            <button
              onClick={handleDelete}
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                border: '1px solid #FDEAEA',
                background: 'transparent',
                color: '#C0321A',
                fontFamily: 'Figtree',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: 10,
              border: '1px solid #EBEBEB',
              background: 'transparent',
              color: C.slate,
              fontFamily: 'Figtree',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!form.name.trim()}
            style={{
              padding: '10px 24px',
              borderRadius: 10,
              border: 'none',
              background: form.name.trim() ? C.green : '#A5D6A7',
              color: C.white,
              fontFamily: 'Figtree',
              fontSize: 13,
              fontWeight: 700,
              cursor: form.name.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            {isNew ? 'Create customer' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Form Builder
// ─────────────────────────────────────────────────────────────────

function FormBuilder() {
  const store = useWorkOrderStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.templates[0]?.id ?? null);
  const selected = store.templates.find((t) => t.id === selectedId) ?? null;

  const createNew = (kind: 'structured' | 'overlay') => {
    const id = `tpl-${Date.now()}`;
    const tpl: FormTemplate = kind === 'overlay'
      ? {
          id,
          name: 'Untitled overlay template',
          description: 'Upload an official form and place fields on it.',
          kind: 'overlay',
          fields: [],
        }
      : {
          id,
          name: 'Untitled template',
          description: '',
          kind: 'structured',
          fields: [{ id: `f-${Date.now()}`, type: 'section', label: 'New Section' }],
        };
    store.saveTemplate(tpl);
    setSelectedId(id);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
      {/* Template list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => createNew('structured')}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px dashed ${C.green}`,
              background: C.honeydew,
              color: C.green,
              fontFamily: 'Figtree',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            + Structured
          </button>
          <button
            onClick={() => createNew('overlay')}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px dashed ${C.opal}`,
              background: '#E3F0FF',
              color: C.opal,
              fontFamily: 'Figtree',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            + Overlay
          </button>
        </div>
        {store.templates.map((t) => {
          const active = selectedId === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              style={{
                background: C.white,
                borderRadius: 12,
                border: `1.5px solid ${active ? C.green : '#EBEBEB'}`,
                padding: '12px 14px',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'Figtree',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.green, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: isOverlay(t) ? '#E3F0FF' : C.honeydew,
                    color: isOverlay(t) ? C.opal : C.green,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    flexShrink: 0,
                  }}
                >
                  {isOverlay(t) ? 'Overlay' : 'Structured'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: C.slate }}>
                {isOverlay(t)
                  ? `${t.imageSrc ? 'Form uploaded · ' : 'No form yet · '}${t.fields.length} fields`
                  : `${t.fields.filter((f) => f.type !== 'section').length} fields`}
              </div>
            </button>
          );
        })}
      </div>

      {/* Editor */}
      <div>
        {selected ? (
          <TemplateEditor template={selected} key={selected.id} onDelete={() => {
            store.deleteTemplate(selected.id);
            setSelectedId(store.templates.filter(t => t.id !== selected.id)[0]?.id ?? null);
          }} />
        ) : (
          <div
            style={{
              background: C.white,
              border: '1px dashed #EBEBEB',
              borderRadius: 14,
              padding: '60px 24px',
              textAlign: 'center',
              color: C.slate,
              fontSize: 14,
            }}
          >
            Select a template or create a new one.
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateEditor({ template, onDelete }: { template: FormTemplate; onDelete: () => void }) {
  const store = useWorkOrderStore();
  const [draft, setDraft] = useState<FormTemplate>(template);
  const dirty = JSON.stringify(draft) !== JSON.stringify(template);

  const addField = (type: FieldType) => {
    const id = `f-${Date.now()}`;
    const label =
      type === 'section'
        ? 'New Section'
        : type === 'checkbox'
          ? 'Confirm step'
          : type === 'textarea'
            ? 'Notes'
            : 'Field';
    setDraft((d) => ({ ...d, fields: [...d.fields, { id, type, label }] }));
  };

  const updateField = (id: string, patch: Partial<FormField>) =>
    setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));

  const removeField = (id: string) =>
    setDraft((d) => ({ ...d, fields: d.fields.filter((f) => f.id !== id) }));

  const move = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= draft.fields.length) return;
    setDraft((d) => {
      const fields = [...d.fields];
      [fields[idx], fields[next]] = [fields[next], fields[idx]];
      return { ...d, fields };
    });
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 440px',
        gap: 20,
        alignItems: 'start',
      }}
    >
      {/* Editor column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {/* Header */}
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
        <input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: C.green,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'Figtree',
            letterSpacing: '-0.02em',
          }}
        />
        <input
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          placeholder="Short description for technicians…"
          style={{
            fontSize: 12,
            color: C.slate,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'Figtree',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '3px 9px',
              borderRadius: 99,
              background: isOverlay(draft) ? '#E3F0FF' : C.honeydew,
              color: isOverlay(draft) ? C.opal : C.green,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {isOverlay(draft) ? 'Overlay mode' : 'Structured mode'}
          </span>
          {!isOverlay(draft) &&
            (['section', 'text', 'textarea', 'checkbox'] as FieldType[]).map((t) => (
              <button
                key={t}
                onClick={() => addField(t)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: `1px solid ${C.green}`,
                  background: 'transparent',
                  color: C.green,
                  fontFamily: 'Figtree',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + {t === 'textarea' ? 'Long Text' : t === 'text' ? 'Text' : t === 'checkbox' ? 'Checkbox' : 'Section'}
              </button>
            ))}
          <button
            onClick={onDelete}
            style={{
              marginLeft: 'auto',
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #FDEAEA',
              background: 'transparent',
              color: '#C0321A',
              fontFamily: 'Figtree',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Delete template
          </button>
          <button
            onClick={() => store.saveTemplate(draft)}
            disabled={!dirty}
            style={{
              padding: '6px 18px',
              borderRadius: 8,
              border: 'none',
              background: dirty ? C.green : '#A5D6A7',
              color: C.white,
              fontFamily: 'Figtree',
              fontSize: 12,
              fontWeight: 700,
              cursor: dirty ? 'pointer' : 'not-allowed',
            }}
          >
            Save template
          </button>
        </div>
      </div>

      {/* Fields — structured or overlay */}
      {isOverlay(draft) ? (
        <OverlayEditor template={draft} onChange={setDraft} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {draft.fields.map((f, i) => (
            <FieldEditor
              key={f.id}
              field={f}
              onChange={(patch) => updateField(f.id, patch)}
              onRemove={() => removeField(f.id)}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              first={i === 0}
              last={i === draft.fields.length - 1}
            />
          ))}
          {draft.fields.length === 0 && (
            <div
              style={{
                background: C.white,
                border: '1px dashed #EBEBEB',
                borderRadius: 12,
                padding: 20,
                textAlign: 'center',
                color: C.slate,
                fontSize: 13,
              }}
            >
              No fields yet — add one above.
            </div>
          )}
        </div>
      )}
      </div>

      {/* Live PDF preview column */}
      <TemplatePreview template={draft} />
    </div>
  );
}

function TemplatePreview({ template }: { template: FormTemplate }) {
  const values = samplePreviewValues(template);
  const overlay = isOverlay(template);

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        alignSelf: 'start',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px' }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#22a14b',
            boxShadow: '0 0 0 4px rgba(34,161,75,0.18)',
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.slate,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          Live Mobile Preview
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: C.slate, fontWeight: 600 }}>
          What the technician sees
        </span>
      </div>

      {/* Phone */}
      <PhoneFrame>
        {/* App header */}
        <div
          style={{
            background: C.white,
            borderBottom: '1px solid #EBEBEB',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <Logo height={20} />
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 99,
              background: C.honeydew,
              color: C.green,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            TSD · Tech
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 14, color: C.slate, opacity: 0.55 }}>⏻</span>
        </div>

        {/* Title block */}
        <div
          style={{
            background: C.white,
            padding: '12px 14px 14px',
            borderBottom: '1px solid #F3F3F3',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: C.green,
              letterSpacing: '-0.02em',
              lineHeight: 1.25,
            }}
          >
            {template.name || 'Untitled template'}
          </div>
          <div style={{ fontSize: 10, color: C.slate, marginTop: 3 }}>WO-PREVIEW · Ahmad Razif</div>
        </div>

        {/* Form (scrolls inside the phone) */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 12px 14px',
            background: C.seasalt,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {overlay ? (
            <OverlayFormRenderer template={template} values={values} onChange={() => {}} disabled />
          ) : (
            <FormPaper>
              <FormHeader template={template} workOrder={PREVIEW_HEADER_INFO} />
              <FieldList fields={template.fields} values={values} onChange={() => {}} disabled />
            </FormPaper>
          )}
        </div>

        {/* Action bar (mocked, non-functional in preview) */}
        <div
          style={{
            background: C.white,
            borderTop: '1px solid #EBEBEB',
            padding: '8px 10px',
            display: 'flex',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <button
            disabled
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${C.green}`,
              background: 'transparent',
              color: C.green,
              fontFamily: 'Figtree',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'default',
              opacity: 0.85,
            }}
          >
            Save draft
          </button>
          <button
            disabled
            style={{
              flex: 2,
              padding: '8px 10px',
              borderRadius: 8,
              border: 'none',
              background: C.green,
              color: C.white,
              fontFamily: 'Figtree',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'default',
              opacity: 0.85,
            }}
          >
            Submit report
          </button>
        </div>
      </PhoneFrame>

      <div
        style={{
          fontSize: 10,
          color: C.slate,
          textAlign: 'center',
          lineHeight: 1.5,
          padding: '0 8px',
        }}
      >
        Mobile view (≈380 px). Updates live as you edit the template.
      </div>
    </div>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#1a1a1a',
        borderRadius: 36,
        padding: '10px 10px 12px',
        width: '100%',
        maxWidth: 380,
        margin: '0 auto',
        boxShadow: '0 14px 40px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.04)',
        display: 'flex',
        flexDirection: 'column',
        height: 'min(740px, calc(100vh - 200px))',
        flexShrink: 0,
      }}
    >
      {/* Faux status bar */}
      <div
        style={{
          height: 22,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 18px',
          color: C.white,
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        <span>9:41</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {/* signal bars */}
          <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 9 }}>
            <span style={{ width: 2, height: 3, background: 'white', borderRadius: 1 }} />
            <span style={{ width: 2, height: 5, background: 'white', borderRadius: 1 }} />
            <span style={{ width: 2, height: 7, background: 'white', borderRadius: 1 }} />
            <span style={{ width: 2, height: 9, background: 'white', borderRadius: 1 }} />
          </span>
          {/* battery */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              width: 22,
              height: 10,
              border: '1px solid white',
              borderRadius: 3,
              padding: 1,
              position: 'relative',
            }}
          >
            <span style={{ width: '85%', height: '100%', background: 'white', borderRadius: 1 }} />
            <span
              style={{
                position: 'absolute',
                right: -3,
                top: 3,
                width: 2,
                height: 4,
                background: 'white',
                borderRadius: 1,
              }}
            />
          </span>
        </span>
      </div>

      {/* Screen */}
      <div
        style={{
          flex: 1,
          background: C.seasalt,
          borderRadius: 22,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)',
        }}
      >
        {children}
      </div>

      {/* Home indicator */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <div style={{ width: 100, height: 4, background: '#3a3a3a', borderRadius: 99 }} />
      </div>
    </div>
  );
}

const PREVIEW_HEADER_INFO = {
  id: 'WO-PREVIEW',
  scheduledDate: '2026-05-08',
  assignedTo: 'Zulkifli A.',
};

function samplePreviewValues(template: FormTemplate): FormValues {
  const values: FormValues = {};
  template.fields.forEach((f) => {
    if (f.type === 'section') return;
    if (f.type === 'checkbox') {
      values[f.id] = true;
      return;
    }
    const lbl = f.label.toLowerCase();
    let v = 'Sample value';
    if (lbl.includes('customer') && lbl.includes('sign')) v = 'A. Razif';
    else if (lbl.includes('technician')) v = 'Zulkifli A.';
    else if (lbl.includes('customer')) v = 'Ahmad Razif Bin Hamid';
    else if (lbl.includes('name')) v = 'Ahmad Razif Bin Hamid';
    else if (lbl.includes('address')) v = 'Jln Riong, Bangsar, 59100 Kuala Lumpur';
    else if (lbl.includes('date')) v = '08 May 2026';
    else if (lbl.includes('serial')) v = 'EVO-7K-019487';
    else if (f.type === 'textarea') v = 'No deviations. Customer trained on app pairing and emergency stop.';
    else v = '—';
    values[f.id] = v;
  });
  return values;
}

function FieldEditor({
  field,
  onChange,
  onRemove,
  onUp,
  onDown,
  first,
  last,
}: {
  field: FormField;
  onChange: (patch: Partial<FormField>) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  first: boolean;
  last: boolean;
}) {
  const isSection = field.type === 'section';
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 10,
        border: `1px solid ${isSection ? C.green : '#EBEBEB'}`,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button onClick={onUp} disabled={first} style={iconBtn(first)}>▲</button>
        <button onClick={onDown} disabled={last} style={iconBtn(last)}>▼</button>
      </div>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 6,
          background: isSection ? C.honeydew : '#F3F3F3',
          color: isSection ? C.green : C.slate,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          flexShrink: 0,
        }}
      >
        {field.type}
      </span>
      <input
        value={field.label}
        onChange={(e) => onChange({ label: e.target.value })}
        style={{
          flex: 1,
          padding: '7px 10px',
          borderRadius: 8,
          border: '1px solid #EBEBEB',
          fontFamily: 'Figtree',
          fontSize: 13,
          outline: 'none',
          background: '#FAFAFA',
        }}
      />
      {!isSection && (
        <label style={{ fontSize: 11, color: C.slate, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={field.required ?? false}
            onChange={(e) => onChange({ required: e.target.checked })}
            style={{ accentColor: C.green }}
          />
          Required
        </label>
      )}
      <button
        onClick={onRemove}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: '1px solid #FDEAEA',
          background: 'transparent',
          color: '#C0321A',
          cursor: 'pointer',
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function iconBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 14,
    border: '1px solid #EBEBEB',
    background: 'transparent',
    color: disabled ? '#DADADA' : C.slate,
    fontSize: 9,
    cursor: disabled ? 'default' : 'pointer',
    padding: 0,
    borderRadius: 4,
    lineHeight: 1,
  };
}
