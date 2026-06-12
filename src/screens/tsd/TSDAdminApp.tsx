import { useEffect, useRef, useState } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import { Search, Power, ChevronDown, Copy, CopyPlus, QrCode } from 'lucide-react';
import { useIsMobile } from '../../lib/useIsMobile';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../permissions';
import {
  STATUS_COLORS,
  OTHER_FORM_ID,
  useWorkOrderStore,
  type Customer,
  type CustomerType,
  type FieldType,
  type FormField,
  type FormTemplate,
  type FormValues,
  type WorkOrder,
  type WorkOrderForm,
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Power size={12} strokeWidth={2.25} /> Sign out</span>
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

export function WorkOrdersAdmin() {
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
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
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
        </div>
        <button
          onClick={() => setModal('new')}
          style={{ marginLeft: 'auto', padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + New Work Order
        </button>
      </div>

      {/* Table */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Ref', 'Title', 'Customer', 'Form', 'Tech', 'Date', 'Priority', 'Status'].map((h) => (
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
                  <td style={{ padding: '11px 14px', color: C.slate }}>{(() => {
                    const counts = new Map<string, number>();
                    for (const f of w.forms) {
                      const n = f.templateId === OTHER_FORM_ID ? 'Other (PDF)' : (store.getTemplate(f.templateId)?.name ?? 'Form');
                      counts.set(n, (counts.get(n) ?? 0) + 1);
                    }
                    const s = [...counts.entries()].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ');
                    return s || '—';
                  })()}</td>
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

// Work orders can be scoped to a Charger Registry customer (→ pick one of their
// sites) or to a CPO location (→ pick one of its chargers).
interface RegistryEntry { id: string; name: string; source: 'registry' | 'cpo'; address: string | null; }
interface SiteRec { id: string; name: string; address: string | null; }

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
  const { can } = usePermissions();
  const canDelete = can('tsd_workorders', 'can_delete');
  const isNew = mode === 'new';
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    title: workOrder?.title ?? '',
    customerId: workOrder?.customerId ?? null,   // charger-registry entry id
    customer: workOrder?.customer ?? '',
    siteId: null as string | null,
    address: workOrder?.address ?? '',
    scheduledDate: workOrder?.scheduledDate ?? '2026-05-08',
    priority: workOrder?.priority ?? ('normal' as 'low' | 'normal' | 'high'),
    assignedTo: workOrder?.assignedTo ?? null,
  });

  // A work order can bundle several forms, each with a quantity.
  const formChoices: BrandSelectOption[] = [
    ...store.templates.map((t) => ({ value: t.id, label: t.name })),
    { value: OTHER_FORM_ID, label: 'Other — non-templated (PDF report)' },
  ];
  const [formLines, setFormLines] = useState<{ templateId: string; qty: number }[]>(
    [{ templateId: store.templates[0]?.id ?? OTHER_FORM_ID, qty: 1 }],
  );
  const updateLine = (i: number, patch: Partial<{ templateId: string; qty: number }>) =>
    setFormLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setFormLines((ls) => [...ls, { templateId: store.templates[0]?.id ?? OTHER_FORM_ID, qty: 1 }]);
  const removeLine = (i: number) => setFormLines((ls) => ls.filter((_, idx) => idx !== i));
  const totalForms = formLines.reduce((s, l) => s + Math.max(1, l.qty), 0);
  const formLabel = (templateId: string) =>
    templateId === OTHER_FORM_ID ? 'Other (PDF report)' : (store.getTemplate(templateId)?.name ?? 'Form');

  // Jobs are scoped to a Charger Registry entry (a customer) and one of its sites.
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [registryLoading, setRegistryLoading] = useState(isNew);
  const [sites, setSites] = useState<SiteRec[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);

  useEffect(() => {
    if (!isNew) return;
    let cancelled = false;
    void (async () => {
      const [proj, loc] = await Promise.all([
        supabase.from('projects').select('id, name').order('name'),
        supabase.from('cpo_locations').select('id, name, address').order('name'),
      ]);
      if (cancelled) return;
      const entries: RegistryEntry[] = [
        ...((proj.data ?? []) as Array<{ id: string; name: string }>).map((p) => ({
          id: p.id, name: p.name, source: 'registry' as const, address: null,
        })),
        ...((loc.data ?? []) as Array<{ id: string; name: string; address: string | null }>).map((l) => ({
          id: l.id, name: l.name, source: 'cpo' as const, address: l.address,
        })),
      ];
      setRegistry(entries);
      setRegistryLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isNew]);

  const selectedEntry = registry.find((r) => r.id === form.customerId);

  const selectRegistry = async (entryId: string) => {
    const p = registry.find((r) => r.id === entryId);
    if (!p) return;
    if (p.source === 'cpo') {
      // CPO location → no site/charger step; the location's address fills straight away.
      setForm((f) => ({ ...f, customerId: p.id, customer: p.name, siteId: null, address: p.address ?? p.name }));
      setSites([]);
      return;
    }
    setForm((f) => ({ ...f, customerId: p.id, customer: p.name, siteId: null, address: '' }));
    setSites([]);
    setSitesLoading(true);
    const { data } = await supabase.from('project_sites').select('id, name, address').eq('project_id', p.id).order('position').order('created_at');
    setSites((data as SiteRec[]) ?? []);
    setSitesLoading(false);
  };

  const selectSite = (siteId: string) => {
    const s = sites.find((x) => x.id === siteId);
    if (!s) return;
    // Address only — the site/charger name stays in its own dropdown.
    setForm((f) => ({ ...f, siteId: s.id, address: s.address || s.name }));
  };

  // Technicians come from the shared technicians table — managed in the Technicians tab.
  const [techs, setTechs] = useState<TechRec[]>([]);
  useEffect(() => {
    let cancelled = false;
    supabase.from('technicians').select('name, fin_number, contact_number, photo_path').order('name').then(({ data }) => {
      if (!cancelled) setTechs((data as TechRec[]) ?? []);
    });
    return () => { cancelled = true; };
  }, []);

  const canCreate = !!form.customerId && (selectedEntry?.source === 'cpo' || !!form.siteId) && totalForms > 0;

  const handleSave = () => {
    if (isNew) {
      if (!canCreate) return;
      // Expand the form lines (template + quantity) into individual instances.
      const forms: WorkOrderForm[] = [];
      let seq = 0;
      for (const line of formLines) {
        const qty = Math.max(1, line.qty);
        for (let i = 1; i <= qty; i++) {
          const name = formLabel(line.templateId);
          forms.push({
            id: `wf-${Date.now()}-${seq++}`,
            templateId: line.templateId,
            label: qty > 1 ? `${name} (${i} of ${qty})` : name,
          });
        }
      }
      store.createWorkOrder({
        title: form.title || 'Untitled work order',
        customerId: form.customerId,
        customer: form.customer,
        address: form.address,
        scheduledDate: form.scheduledDate,
        priority: form.priority,
        forms,
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
          maxWidth: 'calc(100vw - 24px)',
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
        <FormRow label="Customer (Charger Registry / CPO)">
          {isNew ? (
            <SearchSelect
              value={form.customerId ?? ''}
              options={registry.map((r) => ({ value: r.id, label: r.source === 'cpo' ? `${r.name} · CPO` : r.name }))}
              onChange={selectRegistry}
              loading={registryLoading}
              disabled={registryLoading || registry.length === 0}
              placeholder="— Select customer —"
              emptyText="No registry entries — add one in Charger Registry"
            />
          ) : (
            <input value={form.customer} disabled style={inputStyle(true)} />
          )}
          {isNew && (
            <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>
              Pick a Charger Registry customer (then one of their sites) or a CPO location (address fills automatically).
            </div>
          )}
        </FormRow>
        {isNew && selectedEntry?.source !== 'cpo' && (
          <FormRow label="Site">
            <SearchSelect
              value={form.siteId ?? ''}
              options={sites.map((s) => ({ value: s.id, label: s.address ? `${s.name} — ${s.address}` : s.name }))}
              onChange={selectSite}
              loading={sitesLoading}
              disabled={!form.customerId || sitesLoading || sites.length === 0}
              placeholder={!form.customerId
                ? 'Select a customer first'
                : sites.length === 0 ? 'No sites registered for this customer' : '— Select a site —'}
              emptyText="No sites for this customer"
            />
          </FormRow>
        )}
        <FormRow label={isNew ? 'Address (auto-filled)' : 'Address'}>
          <input
            value={form.address}
            disabled
            placeholder={isNew && form.customerId && !form.address ? 'Select a site to fill the address' : ''}
            style={inputStyle(true)}
          />
        </FormRow>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <FormRow label="Scheduled date">
            <input
              type="date"
              value={form.scheduledDate}
              onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))}
              disabled={!isNew}
              style={inputStyle(!isNew)}
            />
          </FormRow>
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
        </div>
        <FormRow label="Forms">
          {isNew ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {formLines.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <BrandSelect value={line.templateId} options={formChoices} onChange={(v) => updateLine(i, { templateId: v })} />
                  </div>
                  <input type="number" min={1} value={line.qty}
                    onChange={(e) => updateLine(i, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    title="Quantity"
                    style={{ width: 70, padding: '9px 10px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', textAlign: 'center' }} />
                  {formLines.length > 1 && (
                    <button onClick={() => removeLine(i)} title="Remove form"
                      style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: '#C0321A', cursor: 'pointer', fontSize: 14 }}>×</button>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <button onClick={addLine}
                  style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  + Add another form
                </button>
                <span style={{ fontSize: 11, color: C.slate }}>{totalForms} form{totalForms === 1 ? '' : 's'} total · non-templated forms upload a PDF on-site</span>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(workOrder?.forms ?? []).map((f) => (
                <div key={f.id} style={{ fontSize: 13, color: '#1a1a1a', padding: '8px 12px', borderRadius: 8, background: '#F9F9F9', border: '1px solid #EBEBEB' }}>{f.label}</div>
              ))}
            </div>
          )}
        </FormRow>
        <FormRow label="Assigned technician">
          <TechnicianSelect
            value={form.assignedTo}
            technicians={techs}
            onChange={(name) => setForm((f) => ({ ...f, assignedTo: name }))}
          />
        </FormRow>

        {!isNew && canDelete && confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete {workOrder!.id}?</div>
            <div style={{ fontSize: 12, color: '#C0321A' }}>This permanently removes the work order and its submitted report. This cannot be undone.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => { if (workOrder) store.deleteWorkOrder(workOrder.id); onClose(); }}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Yes, Delete
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {!isNew && canDelete && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                padding: '10px 20px',
                borderRadius: 10,
                border: '1px solid #FDEAEA',
                background: C.white,
                color: '#C0321A',
                fontFamily: 'Figtree',
                fontSize: 13,
                fontWeight: 700,
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
          {(() => {
            const blocked = isNew && !canCreate;
            return (
              <button
                onClick={handleSave}
                disabled={blocked}
                style={{
                  padding: '9px 24px',
                  borderRadius: 10,
                  border: 'none',
                  background: blocked ? '#ccc' : C.green,
                  color: C.white,
                  fontFamily: 'Figtree',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: blocked ? 'default' : 'pointer',
                }}
              >
                {isNew ? 'Create work order' : 'Save assignment'}
              </button>
            );
          })()}
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

interface BrandSelectOption { value: string; label: string; }

// Brand-styled dropdown replacing the native <select> on work-order fields.
function BrandSelect({ value, options, onChange, disabled, placeholder, up }: {
  value: string;
  options: BrandSelectOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          ...inputStyle(!!disabled),
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          cursor: disabled ? 'default' : 'pointer', textAlign: 'left',
          borderColor: open ? C.green : '#EBEBEB',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? '#1a1a1a' : C.slate }}>
          {selected?.label ?? placeholder ?? 'Select…'}
        </span>
        <ChevronDown size={16} strokeWidth={2.25} style={{ color: C.slate, flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && !disabled && (
        <div style={{
          position: 'absolute', left: 0, right: 0, zIndex: 60,
          top: up ? undefined : 'calc(100% + 6px)', bottom: up ? 'calc(100% + 6px)' : undefined,
          background: C.white, border: '1px solid #EBEBEB', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,.14)', padding: 6, maxHeight: 240, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value || '__none'}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.seasalt; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                style={{
                  flexShrink: 0, width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none',
                  background: active ? C.honeydew : 'transparent', color: active ? C.green : '#1a1a1a',
                  fontFamily: 'Figtree', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Brand dropdown with search ────────────────────────────────────

function SearchSelect({ value, options, onChange, disabled, placeholder, emptyText, loading }: {
  value: string;
  options: BrandSelectOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyText?: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const ql = q.trim().toLowerCase();
  const filtered = ql ? options.filter((o) => o.label.toLowerCase().includes(ql)) : options;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled} onClick={() => { setOpen((o) => !o); setQ(''); }}
        style={{ ...inputStyle(!!disabled), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: disabled ? 'default' : 'pointer', textAlign: 'left', borderColor: open ? C.green : '#EBEBEB' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? '#1a1a1a' : C.slate }}>
          {loading ? 'Loading…' : selected?.label ?? placeholder ?? 'Select…'}
        </span>
        <ChevronDown size={16} strokeWidth={2.25} style={{ color: C.slate, flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && !disabled && (
        <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 60, top: 'calc(100% + 6px)', background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.14)', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              style={{ width: '100%', padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.seasalt, boxSizing: 'border-box' }} />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={13} /></span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px', textAlign: 'center', color: C.slate, fontSize: 12 }}>{emptyText ?? 'No matches'}</div>
            ) : filtered.map((o) => {
              const active = o.value === value;
              return (
                <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.seasalt; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  style={{ flexShrink: 0, width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: active ? C.honeydew : 'transparent', color: active ? C.green : '#1a1a1a', fontFamily: 'Figtree', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Technician picker (avatar + name + FIN + contact) ─────────────

interface TechRec { name: string; fin_number: string | null; contact_number: string | null; photo_path: string | null; }

function techPhotoUrl(path: string): string {
  return supabase.storage.from('technician-photos').getPublicUrl(path).data.publicUrl;
}

function TechAvatar({ name, photoPath, size = 30 }: { name: string; photoPath: string | null; size?: number }) {
  if (photoPath) {
    return <img src={techPhotoUrl(photoPath)} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '1px solid #EBEBEB', flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: C.honeydew, color: C.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.42, flexShrink: 0 }}>
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </div>
  );
}

function TechnicianSelect({ value, technicians, onChange }: {
  value: string | null;
  technicians: TechRec[];
  onChange: (name: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const selected = value ? technicians.find((t) => t.name === value) : undefined;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ ...inputStyle(false), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'left', borderColor: open ? C.green : '#EBEBEB' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          {value ? (
            <>
              <TechAvatar name={value} photoPath={selected?.photo_path ?? null} size={24} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1a1a1a' }}>{value}</span>
            </>
          ) : (
            <span style={{ color: C.slate }}>— Unassigned —</span>
          )}
        </span>
        <ChevronDown size={16} strokeWidth={2.25} style={{ color: C.slate, flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', left: 0, right: 0, zIndex: 60, bottom: 'calc(100% + 6px)',
          background: C.white, border: '1px solid #EBEBEB', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,.14)', padding: 6, maxHeight: 320, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          <button type="button" onClick={() => { onChange(null); setOpen(false); }}
            onMouseEnter={(e) => { if (value) e.currentTarget.style.background = C.seasalt; }}
            onMouseLeave={(e) => { if (value) e.currentTarget.style.background = 'transparent'; }}
            style={{ flexShrink: 0, width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: !value ? C.honeydew : 'transparent', color: !value ? C.green : '#1a1a1a', fontFamily: 'Figtree', fontSize: 13, fontWeight: !value ? 700 : 500, cursor: 'pointer' }}>
            — Unassigned —
          </button>
          {technicians.map((t) => {
            const active = t.name === value;
            return (
              <button key={t.name} type="button" onClick={() => { onChange(t.name); setOpen(false); }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.seasalt; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', background: active ? C.honeydew : 'transparent', cursor: 'pointer', fontFamily: 'Figtree' }}>
                <TechAvatar name={t.name} photoPath={t.photo_path} size={34} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: active ? C.green : '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.fin_number || 'No FIN'} · {t.contact_number || 'No contact'}
                  </span>
                </span>
              </button>
            );
          })}
          {technicians.length === 0 && (
            <div style={{ padding: '12px', textAlign: 'center', color: C.slate, fontSize: 12 }}>No technicians yet — add them in the Technicians tab.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Customers admin
// ─────────────────────────────────────────────────────────────────

const CUSTOMER_TYPE_COLORS: Record<CustomerType, { bg: string; color: string }> = {
  Residential: { bg: '#F3F3F3',  color: C.slate },
  Commercial:  { bg: '#E6F4EA',  color: C.green },
  Enterprise:  { bg: C.green,    color: C.white },
};

export function CustomersAdmin() {
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
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
            <Search size={14} />
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
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
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
          maxWidth: 'calc(100vw - 24px)',
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
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
              padding: '9px 24px',
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

export function FormBuilder() {
  const store = useWorkOrderStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.templates[0]?.id ?? null);
  const selected = store.templates.find((t) => t.id === selectedId) ?? null;
  // Field clipboard — survives switching templates (TemplateEditor remounts on select).
  const [clipboard, setClipboard] = useState<FormField | null>(null);

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

  const isMobile = useIsMobile();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '280px 1fr', gap: 20 }}>
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
                  ? `${t.imageSrc ? `Form uploaded${(t.pages?.length ?? 1) > 1 ? ` · ${t.pages!.length} pages` : ''} · ` : 'No form yet · '}${t.fields.length} fields`
                  : `${t.fields.filter((f) => f.type !== 'section').length} fields`}
              </div>
            </button>
          );
        })}
      </div>

      {/* Editor */}
      <div>
        {selected ? (
          <TemplateEditor template={selected} key={selected.id} clipboard={clipboard} setClipboard={setClipboard} onDelete={() => {
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

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  section: 'Section',
  text: 'Text',
  textarea: 'Long Text',
  checkbox: 'Checkbox',
  photo: 'Photo',
  group: 'Group',
  date: 'Date',
  signature: 'Signature',
  select: 'Dropdown',
  charger: 'Charger',
};

function TemplateEditor({
  template,
  onDelete,
  clipboard,
  setClipboard,
}: {
  template: FormTemplate;
  onDelete: () => void;
  clipboard: FormField | null;
  setClipboard: (f: FormField | null) => void;
}) {
  const store = useWorkOrderStore();
  const [draft, setDraft] = useState<FormTemplate>(template);
  const dirty = JSON.stringify(draft) !== JSON.stringify(template);

  const cloneField = (f: FormField): FormField => {
    const stamp = `f-${Date.now()}-${Math.round(performance.now() % 1000)}`;
    return {
      ...f,
      id: stamp,
      options: f.options ? [...f.options] : undefined,
      // group children need fresh ids too — values are keyed by child id
      children: f.children?.map((c, i) => ({ ...c, id: `${stamp}-c${i}`, options: c.options ? [...c.options] : undefined })),
    };
  };

  const duplicateField = (idx: number) =>
    setDraft((d) => {
      const fields = [...d.fields];
      fields.splice(idx + 1, 0, cloneField(d.fields[idx]));
      return { ...d, fields };
    });

  const pasteField = () => {
    if (!clipboard) return;
    setDraft((d) => ({ ...d, fields: [...d.fields, cloneField(clipboard)] }));
  };

  const addField = (type: FieldType) => {
    const id = `f-${Date.now()}`;
    const label =
      type === 'section'
        ? 'New Section'
        : type === 'checkbox'
          ? 'Confirm step'
          : type === 'textarea'
            ? 'Notes'
            : type === 'photo'
              ? 'Photo'
              : type === 'group'
                ? 'New Group'
                : type === 'date'
                  ? 'Date'
                  : type === 'signature'
                    ? 'Signature'
                    : type === 'select'
                      ? 'Select option'
                      : type === 'charger'
                        ? 'Charger'
                        : 'Field';
    const extra =
      type === 'group'
        ? { children: [] as FormField[] }
        : type === 'select'
          ? { options: ['Option 1', 'Option 2'] }
          : {};
    setDraft((d) => ({ ...d, fields: [...d.fields, { id, type, label, ...extra }] }));
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

  const isMobile = useIsMobile();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 440px',
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
            (['section', 'text', 'textarea', 'checkbox', 'photo', 'group', 'date', 'signature', 'select', 'charger'] as FieldType[]).map((t) => (
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
                + {FIELD_TYPE_LABELS[t]}
              </button>
            ))}
          {!isOverlay(draft) && clipboard && (
            <button
              onClick={pasteField}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px dashed ${C.opal}`,
                background: '#E3F0FF',
                color: C.opal,
                fontFamily: 'Figtree',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Paste field
            </button>
          )}
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
              onCopy={() => setClipboard(cloneField(f))}
              onDuplicate={() => duplicateField(i)}
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
      <TemplatePreview template={draft} dirty={dirty} />
    </div>
  );
}

// Lazy-load the QR generator from a CDN (no npm dep, same pattern as pdf.js / Leaflet).
interface QRCodeCtor {
  new (el: HTMLElement, opts: { text: string; width: number; height: number; colorDark: string; colorLight: string }): unknown;
}
let qrLoader: Promise<QRCodeCtor> | null = null;
function loadQrLib(): Promise<QRCodeCtor> {
  const w = window as unknown as { QRCode?: QRCodeCtor };
  if (w.QRCode) return Promise.resolve(w.QRCode);
  if (!qrLoader) {
    qrLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = () => (w.QRCode ? resolve(w.QRCode) : reject(new Error('QR library did not attach to window')));
      s.onerror = () => reject(new Error('Failed to load QR library from CDN'));
      document.head.appendChild(s);
    });
  }
  return qrLoader;
}

function QRTestModal({ templateId, templateName, dirty, onClose }: {
  templateId: string;
  templateName: string;
  dirty: boolean;
  onClose: () => void;
}) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${window.location.pathname}?formPreview=${encodeURIComponent(templateId)}`;

  useEffect(() => {
    let live = true;
    loadQrLib()
      .then((QR) => {
        if (!live || !qrRef.current) return;
        qrRef.current.innerHTML = '';
        new QR(qrRef.current, { text: url, width: 200, height: 200, colorDark: '#1a1a1a', colorLight: '#FFFFFF' });
      })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [url]);

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 380, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Test on your phone</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{templateName}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F3F3', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: C.slate }}>
            ×
          </button>
        </div>

        {dirty && (
          <div style={{ background: '#FFF8E1', color: '#B07D00', borderRadius: 12, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>
            You have unsaved changes — save the template first; the phone loads the last saved version.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          {error ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#C0321A', fontSize: 12 }}>{error}</div>
          ) : (
            <div ref={qrRef} style={{ width: 200, height: 200, borderRadius: 12, padding: 12, border: '1px solid #EBEBEB', background: C.white, boxSizing: 'content-box' }} />
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0, background: C.seasalt, borderRadius: 10, padding: '9px 12px', fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {url}
          </div>
          <button onClick={copy} style={{ padding: '9px 14px', borderRadius: 10, border: `1px solid ${C.green}`, background: copied ? C.honeydew : 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5 }}>
          Scan with your phone camera to open the saved template as a fill-able test form. Responses are not saved.
        </div>
      </div>
    </div>
  );
}

function TemplatePreview({ template, dirty }: { template: FormTemplate; dirty: boolean }) {
  const values = samplePreviewValues(template);
  const overlay = isOverlay(template);
  const [showQR, setShowQR] = useState(false);

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
        <button
          onClick={() => setShowQR(true)}
          title="Scan a QR code to test this form on your phone"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
        >
          <QrCode size={12} strokeWidth={2.25} />
          View
        </button>
      </div>
      {showQR && (
        <QRTestModal templateId={template.id} templateName={template.name || 'Untitled template'} dirty={dirty} onClose={() => setShowQR(false)} />
      )}

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
          <span style={{ marginLeft: 'auto', color: C.slate, opacity: 0.55, display: 'inline-flex' }}><Power size={14} strokeWidth={2} /></span>
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
  const fill = (f: FormField) => {
    if (f.type === 'section') return;
    if (f.type === 'group' && f.children) {
      f.children.forEach(fill);
      return;
    }
    if (f.type === 'checkbox') {
      values[f.id] = true;
      return;
    }
    if (f.type === 'signature') return; // no sample image
    if (f.type === 'date') {
      values[f.id] = '2026-05-08';
      return;
    }
    if (f.type === 'select') {
      values[f.id] = (f.options ?? []).map((o) => o.trim()).filter(Boolean)[0] ?? '';
      return;
    }
    if (f.type === 'charger') {
      values[f.id] = 'EV-SG-001 — ABB Terra AC @ Suntec City · CPO';
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
  };
  template.fields.forEach(fill);
  return values;
}

function FieldEditor({
  field,
  onChange,
  onRemove,
  onCopy,
  onDuplicate,
  onUp,
  onDown,
  first,
  last,
}: {
  field: FormField;
  onChange: (patch: Partial<FormField>) => void;
  onRemove: () => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onUp: () => void;
  onDown: () => void;
  first: boolean;
  last: boolean;
}) {
  const isSection = field.type === 'section';
  // Container group: admin composes the sub-fields. Legacy groups (saved before
  // this existed) keep their fixed photo + remarks pair.
  const isContainerGroup = field.type === 'group' && !!field.children;
  const children = field.children ?? [];
  const childId = () => `f-${Date.now()}-c${Math.round(performance.now() % 1000)}`;
  const addChild = (type: FieldType) =>
    onChange({
      children: [...children, {
        id: childId(),
        type,
        label: FIELD_TYPE_LABELS[type],
        ...(type === 'select' ? { options: ['Option 1', 'Option 2'] } : {}),
      }],
    });
  const updateChild = (cid: string, patch: Partial<FormField>) =>
    onChange({ children: children.map((c) => (c.id === cid ? { ...c, ...patch } : c)) });
  const removeChild = (cid: string) =>
    onChange({ children: children.filter((c) => c.id !== cid) });
  const moveChild = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= children.length) return;
    const arr = [...children];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    onChange({ children: arr });
  };
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 10,
        border: `1px solid ${isSection ? C.green : '#EBEBEB'}`,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
     <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
      {!isSection && !isContainerGroup && (
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
      <button onClick={onCopy} title="Copy field" style={fieldActionBtn}>
        <Copy size={13} strokeWidth={2} />
      </button>
      <button onClick={onDuplicate} title="Duplicate field" style={fieldActionBtn}>
        <CopyPlus size={13} strokeWidth={2} />
      </button>
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
      {field.type === 'group' && !isContainerGroup && (
        <div style={{ display: 'flex', gap: 10, paddingLeft: 34, flexWrap: 'wrap' }}>
          <input value={field.photoLabel ?? 'Photo'} onChange={(e) => onChange({ photoLabel: e.target.value })} placeholder="Photo label"
            style={{ flex: 1, minWidth: 140, padding: '6px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: '#FAFAFA' }} />
          <input value={field.remarkLabel ?? 'Remarks'} onChange={(e) => onChange({ remarkLabel: e.target.value })} placeholder="Remarks label"
            style={{ flex: 1, minWidth: 140, padding: '6px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: '#FAFAFA' }} />
        </div>
      )}
      {isContainerGroup && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 34 }}>
          {children.map((c, ci) => (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, background: C.seasalt, borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button onClick={() => moveChild(ci, -1)} disabled={ci === 0} style={iconBtn(ci === 0)}>▲</button>
                  <button onClick={() => moveChild(ci, 1)} disabled={ci === children.length - 1} style={iconBtn(ci === children.length - 1)}>▼</button>
                </div>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: '#FFFFFF', border: '1px solid #EBEBEB', color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 }}>
                  {FIELD_TYPE_LABELS[c.type]}
                </span>
                <input
                  value={c.label}
                  onChange={(e) => updateChild(c.id, { label: e.target.value })}
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.white }}
                />
                <label style={{ fontSize: 10, color: C.slate, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flexShrink: 0 }}>
                  <input type="checkbox" checked={c.required ?? false} onChange={(e) => updateChild(c.id, { required: e.target.checked })} style={{ accentColor: C.green }} />
                  Req.
                </label>
                <button onClick={() => removeChild(c.id)} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>×</button>
              </div>
              {c.type === 'select' && (
                <textarea
                  value={(c.options ?? []).join('\n')}
                  onChange={(e) => updateChild(c.id, { options: e.target.value.split('\n') })}
                  placeholder={'Option 1\nOption 2'}
                  rows={Math.max(2, (c.options ?? []).length)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.white, resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' }}
                />
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Add to group:</span>
            {(['text', 'textarea', 'checkbox', 'photo', 'date', 'signature', 'select', 'charger'] as FieldType[]).map((t) => (
              <button
                key={t}
                onClick={() => addChild(t)}
                style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                + {FIELD_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          {children.length === 0 && (
            <div style={{ fontSize: 11, color: C.slate }}>Empty group — add fields above.</div>
          )}
        </div>
      )}
      {field.type === 'charger' && (
        <div style={{ paddingLeft: 34, fontSize: 11, color: C.slate }}>
          Options load live when the technician fills this form — only the work order's customer's chargers (Charger Registry or CPO) are listed.
        </div>
      )}
      {field.type === 'select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 34 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Dropdown options (one per line)
          </label>
          <textarea
            value={(field.options ?? []).join('\n')}
            onChange={(e) => onChange({ options: e.target.value.split('\n') })}
            placeholder={'Option 1\nOption 2'}
            rows={Math.max(2, (field.options ?? []).length)}
            style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: '#FAFAFA', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>
      )}
    </div>
  );
}

const fieldActionBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: '1px solid #EBEBEB',
  background: 'transparent',
  color: C.slate,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

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
