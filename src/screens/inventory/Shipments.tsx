import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { KPICard } from '../../components/KPICard';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../permissions';
import { Plus, PackageCheck, Download, Lock, Building2, Square, SquareCheck } from 'lucide-react';
import { SearchSelect } from '../../components/SearchSelect';
import {
  useInvCore, itemLabel, fmtD, todayISO,
  Pill, Field, ErrorBanner, Modal, ItemSelect, LocationSelect, SearchBox, downloadCsv, LookupSelect, LookupList, useLookupRows, type LookupRow,
  inputStyle, primaryBtn, ghostBtn, pillBtn, thStyle, tdStyle,
  type InvItem, type InvShipment, type InvLocation, type OnHand,
} from './invShared';

type ShipStatus = InvShipment['status'];

export const SHIP_META: Record<ShipStatus, { label: string; bg: string; color: string }> = {
  ordered:    { label: 'Ordered',    bg: '#F3F3F3', color: '#767B77' },
  in_transit: { label: 'In transit', bg: '#E3F0FF', color: '#1A62C0' },
  partial:    { label: 'Partly received', bg: '#FFF8E1', color: '#B07D00' },
  received:   { label: 'Received',   bg: '#E4F3E3', color: '#1B512D' },
  cancelled:  { label: 'Cancelled',  bg: '#FDEAEA', color: '#C0321A' },
};

type Filter = 'open' | ShipStatus | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' }, { id: 'ordered', label: 'Ordered' }, { id: 'in_transit', label: 'In transit' },
  { id: 'partial', label: 'Partly received' }, { id: 'received', label: 'Received' }, { id: 'cancelled', label: 'Cancelled' }, { id: 'all', label: 'All' },
];

interface CustomerOpt { id: string; name: string; }

const MODES = ['Air', 'Sea', 'Local'];

const isOpen = (s: InvShipment) => s.status === 'ordered' || s.status === 'in_transit' || s.status === 'partial';

export function ScreenInvShipments() {
  const { can, user } = usePermissions();
  const canEdit = can('inv_shipments', 'can_edit');
  const canDelete = can('inv_shipments', 'can_delete');
  const me = user.full_name || user.email;
  const { items, locations, onHand, error: coreErr, reload: reloadCore } = useInvCore();
  const { rows: suppliers, reload: reloadSuppliers } = useLookupRows('supplier');
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  useEffect(() => {
    void supabase.from('customers').select('id, name').order('name')
      .then(({ data }) => setCustomers((data as CustomerOpt[]) ?? []));
  }, []);
  const [managingSuppliers, setManagingSuppliers] = useState(false);

  const [rows, setRows] = useState<InvShipment[]>([]);
  const [received, setReceived] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const [{ data, error: e }, { data: g }] = await Promise.all([
      supabase.from('inv_shipments').select('*').order('order_date', { ascending: false, nullsFirst: false }).order('legacy_no', { ascending: false }),
      supabase.from('inv_grn').select('shipment_id, qty_received').eq('status', 'received').not('shipment_id', 'is', null),
    ]);
    if (e) setError(e.message);
    setRows((data as InvShipment[]) ?? []);
    const m = new Map<string, number>();
    for (const r of (g ?? []) as { shipment_id: string; qty_received: number | null }[]) m.set(r.shipment_id, (m.get(r.shipment_id) ?? 0) + (r.qty_received ?? 0));
    setReceived(m);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const refresh = async () => { await Promise.all([load(), reloadCore()]); };

  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const today = todayISO();
  const month = today.slice(0, 7);
  const outstanding = (s: InvShipment) => (s.status === 'received' || s.status === 'cancelled' ? 0 : Math.max(0, s.qty - (received.get(s.id) ?? 0)));

  const visible = rows.filter((s) => {
    if (filter === 'open' && !isOpen(s)) return false;
    if (filter !== 'open' && filter !== 'all' && s.status !== filter) return false;
    const q = search.trim().toLowerCase();
    return !q || [s.po_no, s.supplier, s.description, s.customer, s.employee, itemLabel(items.find((i) => i.id === s.item_id), items)].join(' ').toLowerCase().includes(q);
  });

  const exportCsv = () => {
    downloadCsv(`incoming_shipments_${today}.csv`, [
      ['No', 'Supplier', 'PO', 'Employee', 'Customer', 'Description', 'Item', 'Qty', 'Mode', 'Order Date', 'In Transit Date', 'Est. Arrival', 'Status'],
      ...visible.map((s) => [s.legacy_no, s.supplier, s.po_no, s.employee, s.customer, s.description, itemLabel(items.find((i) => i.id === s.item_id), items), s.qty, s.mode, s.order_date, s.in_transit_date, s.eta ?? s.eta_note, SHIP_META[s.status].label]),
    ]);
  };

  const open = openId ? rows.find((s) => s.id === openId) ?? null : null;
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading shipments…</div>;

  const openRows = rows.filter(isOpen);
  const overdue = openRows.filter((s) => s.eta && s.eta < today);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ErrorBanner text={error ?? coreErr} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <KPICard accent label="Open shipments" value={openRows.length} sub={`${openRows.reduce((n, s) => n + outstanding(s), 0).toLocaleString()} units to come`} />
        <KPICard label="In transit" value={rows.filter((s) => s.status === 'in_transit').length} sub="Shipped by the supplier" />
        <KPICard label="Past ETA" value={overdue.length} sub="Open with an arrival date already gone" />
        <KPICard label="Received this month" value={rows.filter((s) => s.status === 'received' && (s.received_on ?? '').startsWith(month)).length} sub="Shipment lines closed" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search PO, supplier, item…" />
        {FILTERS.map((f) => <button key={f.id} onClick={() => setFilter(f.id)} style={pillBtn(filter === f.id)}>{f.label}</button>)}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canDelete && <button onClick={() => setManagingSuppliers(true)} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Building2 size={13} /> Suppliers</button>}
          <button onClick={exportCsv} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={13} /> Export</button>
          {canEdit && <button onClick={() => setCreating(true)} style={{ ...primaryBtn(), display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> New shipment</button>}
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
            <thead>
              <tr>{['PO', 'Supplier', 'Description', 'Qty', 'Ordered', 'ETA', 'Status'].map((h) => <th key={h} style={{ ...thStyle, textAlign: h === 'Qty' ? 'right' : 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const meta = SHIP_META[s.status];
                const got = received.get(s.id) ?? 0;
                const late = isOpen(s) && s.eta && s.eta < today;
                const linked = items.find((i) => i.id === s.item_id);
                return (
                  <tr key={s.id} onClick={() => setOpenId(s.id)} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>
                      {s.po_no || <span style={{ color: C.slate }}>No PO</span>}
                      {s.legacy_no != null && <div style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>Excel #{s.legacy_no}</div>}
                    </td>
                    <td style={tdStyle}>{s.supplier || '—'}{s.customer && <div style={{ fontSize: 11, color: C.slate }}>For {s.customer}</div>}</td>
                    <td style={tdStyle}>
                      {s.description}
                      <div style={{ fontSize: 11, color: linked ? C.slate : '#B07D00', fontWeight: linked ? 400 : 700, marginTop: 2 }}>
                        {linked ? `→ ${itemLabel(linked, items)}` : 'NOT LINKED TO AN ITEM'}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {s.qty}
                      {s.status === 'partial' && <div style={{ fontSize: 11, color: '#B07D00' }}>{got} in</div>}
                    </td>
                    <td style={{ ...tdStyle, color: C.slate, whiteSpace: 'nowrap' }}>{fmtD(s.order_date)}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: late ? '#C0321A' : C.slate, fontWeight: late ? 700 : 400 }}>
                      {s.eta_note && !s.eta ? s.eta_note : fmtD(s.eta)}
                      {s.eta && s.eta_note && <div style={{ fontSize: 11, color: C.slate, fontWeight: 400 }}>{s.eta_note}</div>}
                    </td>
                    <td style={tdStyle}><Pill bg={meta.bg} color={meta.color}>{meta.label}</Pill></td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No shipments here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <ShipmentModal key={open.id} ship={open} receivedQty={received.get(open.id) ?? 0} items={items} locations={locations} onHand={onHand} me={me}
          suppliers={suppliers} reloadSuppliers={reloadSuppliers} customers={customers} isAdmin={canDelete}
          canEdit={canEdit} canDelete={canDelete} onClose={() => setOpenId(null)} onChanged={refresh} />
      )}
      {creating && (
        <ShipmentModal ship={null} receivedQty={0} items={items} locations={locations} onHand={onHand} me={me}
          suppliers={suppliers} reloadSuppliers={reloadSuppliers} customers={customers} isAdmin={canDelete}
          canEdit={canEdit} canDelete={false} onClose={() => setCreating(false)} onChanged={async () => { setCreating(false); await refresh(); }} />
      )}
      {managingSuppliers && (
        <Modal title="Suppliers" subtitle="The options in the shipment Supplier dropdown. Renaming updates every shipment and goods-received record that uses it." width={440} onClose={() => setManagingSuppliers(false)}>
          <LookupList kind="supplier" rows={suppliers} unit="shipment"
            usage={(n) => rows.filter((s) => (s.supplier ?? '').toLowerCase() === n.toLowerCase()).length}
            onChanged={async () => { await Promise.all([reloadSuppliers(), load()]); }} />
        </Modal>
      )}
    </div>
  );
}

function ShipmentModal({ ship, receivedQty, items, locations, onHand, me, suppliers, reloadSuppliers, customers, isAdmin, canEdit, canDelete, onClose, onChanged }: {
  ship: InvShipment | null; receivedQty: number; items: InvItem[]; locations: InvLocation[]; onHand: OnHand; me: string;
  suppliers: LookupRow[]; reloadSuppliers: () => Promise<void>; customers: CustomerOpt[]; isAdmin: boolean;
  canEdit: boolean; canDelete: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const isNew = !ship;
  const editable = canEdit && (isNew || ship!.status !== 'cancelled');
  const [f, setF] = useState({
    supplier: ship?.supplier ?? '', po_no: ship?.po_no ?? '', customer: ship?.customer ?? '', customer_id: ship?.customer_id ?? '',
    description: ship?.description ?? '', item_id: ship?.item_id ?? '',
    qty: String(ship?.qty ?? 1), mode: ship?.mode ?? '', order_date: ship?.order_date ?? todayISO(),
    in_transit_date: ship?.in_transit_date ?? '', eta: ship?.eta ?? '', eta_note: ship?.eta_note ?? '', notes: ship?.notes ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | 'receive' | 'delete'>(null);
  // Not every shipment has a PO (warranty swaps, samples). Existing lines
  // without one open with this already ticked.
  const [noPo, setNoPo] = useState(!!ship && !ship.po_no);
  // Set from the signed-in account when the shipment is created; never typed.
  const employee = ship ? ship.employee : me;

  const save = async (extra?: Record<string, unknown>) => {
    const qty = Number(f.qty);
    if (!f.description.trim() && !f.item_id) { setErr('Describe the shipment or pick an item.'); return false; }
    if (!Number.isInteger(qty) || qty <= 0) { setErr('Quantity must be a whole number above zero.'); return false; }
    if (!noPo && !f.po_no.trim()) { setErr('Enter the PO number, or tick "No PO".'); return false; }
    setBusy(true);
    setErr(null);
    const item = items.find((i) => i.id === f.item_id);
    const payload = {
      supplier: f.supplier.trim() || null, po_no: noPo ? null : f.po_no.trim() || null,
      customer_id: f.customer_id || null, customer: f.customer.trim() || null,
      description: f.description.trim() || (item ? `${qty} × ${item.name}` : ''), item_id: f.item_id || null, qty,
      mode: f.mode || null, order_date: f.order_date || null, in_transit_date: f.in_transit_date || null,
      eta: f.eta || null, eta_note: f.eta_note.trim() || null, notes: f.notes.trim() || null, updated_at: new Date().toISOString(),
      ...extra,
    };
    const { error } = isNew
      ? await supabase.from('inv_shipments').insert({ ...payload, status: 'ordered', employee: me, created_by: me })
      : await supabase.from('inv_shipments').update(payload).eq('id', ship!.id);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    return true;
  };

  const setStatus = async (status: ShipStatus, extra?: Record<string, unknown>) => {
    setBusy(true);
    const { error } = await supabase.from('inv_shipments').update({ status, updated_at: new Date().toISOString(), ...extra }).eq('id', ship!.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onChanged();
    onClose();
  };

  const remove = async () => {
    setBusy(true);
    const { error } = await supabase.from('inv_shipments').delete().eq('id', ship!.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onChanged();
    onClose();
  };

  const ro = !editable;
  const meta = ship ? SHIP_META[ship.status] : null;
  const canReceive = ship && isOpen(ship);

  return (
    <Modal title={isNew ? 'New incoming shipment' : (ship!.po_no || 'Shipment — no PO')} width={680} onClose={onClose}
      subtitle={ship ? `${ship.supplier ?? ''}${ship.legacy_no != null ? ` · Excel #${ship.legacy_no}` : ''}` : 'Track a supplier order until it is received into stock'}
      footer={editable ? (
        <>
          <button onClick={onClose} style={ghostBtn}>Close</button>
          <button onClick={async () => { if (await save()) { await onChanged(); if (!isNew) onClose(); } }} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Saving…' : isNew ? 'Add shipment' : 'Save changes'}</button>
        </>
      ) : undefined}>
      <ErrorBanner text={err} />
      {meta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Pill bg={meta.bg} color={meta.color}>{meta.label}</Pill>
          {receivedQty > 0 && <span style={{ fontSize: 12, color: C.slate }}>{receivedQty} of {ship!.qty} received in the app</span>}
          {ship!.received_on && <span style={{ fontSize: 12, color: C.slate }}>Received {fmtD(ship!.received_on)}</span>}
        </div>
      )}
      {ship?.notes && <div style={{ background: '#FFF8E1', color: '#7A5A00', borderRadius: 10, padding: '10px 14px', fontSize: 12, lineHeight: 1.5 }}>{ship.notes}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Field label="Supplier">
          <LookupSelect kind="supplier" value={f.supplier} options={suppliers} isAdmin={isAdmin} disabled={ro}
            onChange={(v) => setF({ ...f, supplier: v })} onAdded={reloadSuppliers} />
        </Field>
        <Field label="PO number">
          <input value={noPo ? '' : f.po_no} disabled={ro || noPo} onChange={(e) => setF({ ...f, po_no: e.target.value })}
            placeholder={noPo ? 'No PO for this shipment' : 'EV1PO-000000'} style={{ ...inputStyle, background: noPo ? C.seasalt : C.white }} />
          {!ro && (
            <button type="button" onClick={() => setNoPo(!noPo)}
              style={{ marginTop: 6, padding: 0, border: 'none', background: 'transparent', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, color: noPo ? C.green : C.slate, cursor: 'pointer' }}>
              {noPo ? <SquareCheck size={14} /> : <Square size={14} />} No PO
            </button>
          )}
        </Field>
        <Field label="Mode">
          <SearchSelect value={f.mode} disabled={ro} placeholder="Select mode"
            options={[{ value: '', label: 'Not set' }, ...MODES.concat(f.mode && !MODES.includes(f.mode) ? [f.mode] : []).map((m) => ({ value: m, label: m }))]}
            onChange={(v) => setF({ ...f, mode: v })} />
        </Field>
      </div>
      <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 12 }}>
          <Field label="Item it becomes in stock" hint={!f.item_id ? 'Link an item so receiving can add it to stock' : undefined}>
            <ItemSelect items={items} value={f.item_id} onChange={(v) => setF({ ...f, item_id: v })} allowNone noneLabel="Not linked" disabled={ro} />
          </Field>
          <Field label="Qty"><input type="number" min="1" step="1" value={f.qty} disabled={ro} onChange={(e) => setF({ ...f, qty: e.target.value })} style={inputStyle} /></Field>
        </div>
        <Field label="Supplier description"><input value={f.description} disabled={ro} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="As written on the PO / packing list" style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Field label="Order date"><input type="date" value={f.order_date} disabled={ro} onChange={(e) => setF({ ...f, order_date: e.target.value })} style={inputStyle} /></Field>
        <Field label="In transit (ETD)"><input type="date" value={f.in_transit_date} disabled={ro} onChange={(e) => setF({ ...f, in_transit_date: e.target.value })} style={inputStyle} /></Field>
        <Field label="Est. arrival"><input type="date" value={f.eta} disabled={ro} onChange={(e) => setF({ ...f, eta: e.target.value })} style={inputStyle} /></Field>
        <Field label="Arrival note"><input value={f.eta_note} disabled={ro} onChange={(e) => setF({ ...f, eta_note: e.target.value })} placeholder="e.g. TBC, 16/06 - 17/06" style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Field label="EV1 employee" hint={ship && !ship.employee ? 'Not recorded in Excel' : undefined}>
          <div title="Set from the signed-in account — cannot be changed"
            style={{ ...inputStyle, background: C.seasalt, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={12} color={C.slate} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{employee || '—'}</span>
          </div>
        </Field>
        <Field label="For customer" hint={!f.customer_id && f.customer ? `From Excel: "${f.customer}" — pick the matching customer to link it` : undefined}>
          <SearchSelect value={f.customer_id} disabled={ro} placeholder="Select customer…" emptyText="No customers match"
            options={[
              { value: '', label: !f.customer_id && f.customer ? `${f.customer} (not linked)` : 'None — stock order' },
              ...customers.map((c) => ({ value: c.id, label: c.name })),
            ]}
            onChange={(v) => setF({ ...f, customer_id: v, customer: v ? customers.find((c) => c.id === v)?.name ?? '' : (f.customer_id ? '' : f.customer) })} />
        </Field>
      </div>
      <Field label="Notes"><input value={f.notes} disabled={ro} onChange={(e) => setF({ ...f, notes: e.target.value })} style={inputStyle} /></Field>

      {!isNew && canEdit && (
        <div style={{ borderTop: '1px solid #F3F3F3', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mode === null && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canReceive && (
                <button onClick={() => setMode('receive')} style={{ ...primaryBtn(), display: 'inline-flex', alignItems: 'center', gap: 6 }}><PackageCheck size={14} /> Receive into stock</button>
              )}
              {ship!.status === 'ordered' && (
                <button onClick={async () => { if (await save({ status: 'in_transit', in_transit_date: f.in_transit_date || todayISO() })) { await onChanged(); onClose(); } }} disabled={busy} style={ghostBtn}>Mark in transit</button>
              )}
              {isOpen(ship!) && receivedQty === 0 && <button onClick={() => void setStatus('cancelled')} disabled={busy} style={{ ...ghostBtn, color: '#C0321A' }}>Cancel shipment</button>}
              {ship!.status === 'cancelled' && <button onClick={() => void setStatus('ordered')} disabled={busy} style={ghostBtn}>Reopen</button>}
              {canDelete && receivedQty === 0 && <button onClick={() => setMode('delete')} style={{ ...ghostBtn, marginLeft: 'auto', color: '#C0321A' }}>Delete</button>}
            </div>
          )}
          {mode === 'receive' && (
            <ReceiveForm ship={ship!} receivedQty={receivedQty} items={items} locations={locations} onHand={onHand} me={me}
              beforeReceive={save} onCancel={() => setMode(null)} onDone={async () => { await onChanged(); onClose(); }} />
          )}
          {mode === 'delete' && (
            <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this shipment line? This can't be undone.</span>
              <button onClick={() => setMode(null)} style={ghostBtn}>Cancel</button>
              <button onClick={() => void remove()} disabled={busy} style={{ ...primaryBtn(busy), background: '#C0321A' }}>Yes, delete</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ReceiveForm({ ship, receivedQty, items, locations, onHand, me, beforeReceive, onCancel, onDone }: {
  ship: InvShipment; receivedQty: number; items: InvItem[]; locations: InvLocation[]; onHand: OnHand; me: string;
  beforeReceive: () => Promise<boolean>; onCancel: () => void; onDone: () => Promise<void>;
}) {
  const outstanding = Math.max(0, ship.qty - receivedQty);
  const [qty, setQty] = useState(String(outstanding));
  const [loc, setLoc] = useState(locations.find((l) => l.usable)?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [condition, setCondition] = useState('Good');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const item = items.find((i) => i.id === ship.item_id);

  const go = async () => {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 0) { setErr('Enter the quantity received (0 or more).'); return; }
    if (!loc) { setErr('Pick where it is going.'); return; }
    setBusy(true);
    setErr(null);
    if (!(await beforeReceive())) { setBusy(false); return; }
    const { error } = await supabase.rpc('inv_receive_shipment', {
      p_shipment: ship.id, p_qty: n, p_location: loc, p_date: date, p_condition: condition.trim() || null, p_note: note.trim() || null, p_by: me,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onDone();
  };

  const n = Number(qty);
  return (
    <div style={{ background: C.honeydew, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Receive {item ? itemLabel(item, items) : 'shipment'} — {outstanding} outstanding</div>
      {!item && <div style={{ fontSize: 12, color: '#B07D00', fontWeight: 600 }}>Link this shipment to an item above first — receiving adds the quantity to that item.</div>}
      <ErrorBanner text={err} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Field label="Qty received" hint={Number.isInteger(n) && n !== outstanding ? `Variance ${n - outstanding > 0 ? '+' : ''}${n - outstanding}${n < outstanding ? ' — rest stays open' : ''}` : undefined}>
          <input type="number" min="0" step="1" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Into location"><LocationSelect locations={locations} value={loc} onChange={setLoc} itemId={ship.item_id} onHand={onHand} /></Field>
        <Field label="Date received"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="Condition"><input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Good / damaged…" style={inputStyle} /></Field>
      </div>
      <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — damaged box, short-shipped…" style={inputStyle} /></Field>
      <div style={{ fontSize: 11, color: C.slate }}>Creates the Goods Received entry and adds the quantity to stock. A short receipt keeps the shipment open for the rest.</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Back</button>
        <button onClick={() => void go()} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Receiving…' : 'Confirm receipt'}</button>
      </div>
    </div>
  );
}
