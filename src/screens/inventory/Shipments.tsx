import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { KPICard } from '../../components/KPICard';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../permissions';
import { Plus, PackageCheck, Download, Lock, Building2, Square, SquareCheck, X } from 'lucide-react';
import { SearchSelect } from '../../components/SearchSelect';
import { ScreenInvGrn, CompleteModal } from './GoodsReceived';
import {
  useInvCore, itemLabel, fmtD, todayISO,
  Pill, Field, ErrorBanner, Modal, ItemSelect, LocationSelect, SearchBox, downloadCsv, LookupSelect, LookupList, useLookupRows, type LookupRow,
  inputStyle, primaryBtn, ghostBtn, pillBtn, thStyle, tdStyle,
  type InvItem, type InvShipment, type InvLocation, type OnHand, type InvGrn,
} from './invShared';

type ShipStatus = InvShipment['status'];
// A shipment's status is derived from its item lines; 'pending' = a receipt was
// logged as in transit (Excel leftovers) but never received.
type ShipState = ShipStatus | 'pending';

export const SHIP_META: Record<ShipStatus, { label: string; bg: string; color: string }> = {
  ordered:    { label: 'Ordered',    bg: '#F3F3F3', color: '#767B77' },
  in_transit: { label: 'In transit', bg: '#E3F0FF', color: '#1A62C0' },
  partial:    { label: 'Partly received', bg: '#FFF8E1', color: '#B07D00' },
  received:   { label: 'Received',   bg: '#E4F3E3', color: '#1B512D' },
  cancelled:  { label: 'Cancelled',  bg: '#FDEAEA', color: '#C0321A' },
};
const STATE_META: Record<ShipState, { label: string; bg: string; color: string }> = {
  ...SHIP_META,
  pending: { label: 'Receipt pending', bg: '#FFF8E1', color: '#B07D00' },
};

type Filter = 'open' | 'not_completed' | ShipStatus | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' }, { id: 'not_completed', label: 'Not completed' }, { id: 'ordered', label: 'Ordered' },
  { id: 'in_transit', label: 'In transit' }, { id: 'partial', label: 'Partly received' }, { id: 'received', label: 'Received' },
  { id: 'cancelled', label: 'Cancelled' }, { id: 'all', label: 'All' },
];

interface CustomerOpt { id: string; name: string; }

/** One shipment = the item lines (inv_shipments rows) sharing a group_id. Header
 *  fields (supplier, PO, dates…) are identical across lines, so read them off `head`. */
interface Shipment { id: string; head: InvShipment; lines: InvShipment[] }

const MODES = ['Air', 'Sea', 'Local'];
const lineOpen = (s: InvShipment) => s.status === 'ordered' || s.status === 'in_transit' || s.status === 'partial';
const lineOrder = (a: InvShipment, b: InvShipment) =>
  (a.legacy_no ?? Number.MAX_SAFE_INTEGER) - (b.legacy_no ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at);

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
  // Every receipt line per item line — received ones and ones still awaiting receipt.
  const [receipts, setReceipts] = useState<Map<string, InvGrn[]>>(new Map());
  const [view, setView] = useState<'shipments' | 'log'>('shipments');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const [{ data, error: e }, { data: g }] = await Promise.all([
      supabase.from('inv_shipments').select('*').order('order_date', { ascending: false, nullsFirst: false }).order('legacy_no', { ascending: false }),
      supabase.from('inv_grn').select('*').not('shipment_id', 'is', null).order('received_on', { ascending: true, nullsFirst: false }).order('created_at'),
    ]);
    if (e) setError(e.message);
    setRows((data as InvShipment[]) ?? []);
    const m = new Map<string, number>();
    const byLine = new Map<string, InvGrn[]>();
    for (const r of (g ?? []) as InvGrn[]) {
      if (!r.shipment_id) continue;
      if (r.status === 'received') m.set(r.shipment_id, (m.get(r.shipment_id) ?? 0) + (r.qty_received ?? 0));
      byLine.set(r.shipment_id, [...(byLine.get(r.shipment_id) ?? []), r]);
    }
    setReceived(m);
    setReceipts(byLine);
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

  const groups: Shipment[] = (() => {
    const by = new Map<string, InvShipment[]>();
    for (const r of rows) by.set(r.group_id, [...(by.get(r.group_id) ?? []), r]);
    return [...by.entries()].map(([id, ls]) => {
      const lines = [...ls].sort(lineOrder);
      return { id, head: lines[0], lines };
    });
  })();

  const gotOf = (l: InvShipment) => received.get(l.id) ?? 0;
  const lineOutstanding = (l: InvShipment) => (l.status === 'received' || l.status === 'cancelled' ? 0 : Math.max(0, l.qty - gotOf(l)));
  const linePending = (l: InvShipment) => (receipts.get(l.id) ?? []).some((g) => g.status === 'pending');
  const live = (s: Shipment) => s.lines.filter((l) => l.status !== 'cancelled');
  const stateOf = (s: Shipment): ShipState => {
    const ls = live(s);
    if (ls.length === 0) return 'cancelled';
    if (s.lines.some(linePending)) return 'pending';
    if (ls.every((l) => l.status === 'received')) return 'received';
    if (ls.some((l) => l.status === 'received' || l.status === 'partial' || gotOf(l) > 0)) return 'partial';
    if (ls.some((l) => l.status === 'in_transit')) return 'in_transit';
    return 'ordered';
  };
  const qtyOf = (s: Shipment) => live(s).reduce((n, l) => n + l.qty, 0);
  const gotTotal = (s: Shipment) => live(s).reduce((n, l) => n + gotOf(l), 0);
  const outOf = (s: Shipment) => live(s).reduce((n, l) => n + lineOutstanding(l), 0);
  const isOpenShip = (s: Shipment) => ['ordered', 'in_transit', 'partial', 'pending'].includes(stateOf(s));
  // What to chase the supplier about: part-delivered, or a receipt still outstanding.
  const notCompleted = (s: Shipment) => stateOf(s) === 'partial' || stateOf(s) === 'pending';

  const visible = groups.filter((s) => {
    const st = stateOf(s);
    if (filter === 'open' && !isOpenShip(s)) return false;
    if (filter === 'not_completed' && !notCompleted(s)) return false;
    if (!['open', 'not_completed', 'all'].includes(filter) && st !== filter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const h = s.head;
    return [h.po_no, h.supplier, h.customer, h.employee, ...s.lines.flatMap((l) => [l.description, itemLabel(items.find((i) => i.id === l.item_id), items)])]
      .join(' ').toLowerCase().includes(q);
  });

  const exportCsv = () => {
    downloadCsv(`incoming_shipments_${today}.csv`, [
      ['PO', 'Supplier', 'Employee', 'Customer', 'Excel No', 'Description', 'Item', 'Qty Ordered', 'Qty Received', 'Outstanding', 'Mode', 'Order Date', 'In Transit Date', 'Est. Arrival', 'Shipment Status'],
      ...visible.flatMap((s) => s.lines.map((l) => [
        s.head.po_no, s.head.supplier, s.head.employee, s.head.customer, l.legacy_no, l.description, itemLabel(items.find((i) => i.id === l.item_id), items),
        l.qty, gotOf(l) || null, lineOutstanding(l), s.head.mode, s.head.order_date, s.head.in_transit_date, s.head.eta ?? s.head.eta_note, STATE_META[stateOf(s)].label,
      ])),
    ]);
  };

  const open = openId ? groups.find((s) => s.id === openId) ?? null : null;
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading shipments…</div>;

  const openShips = groups.filter(isOpenShip);
  const overdue = groups.filter((s) => ['ordered', 'in_transit', 'partial'].includes(stateOf(s)) && s.head.eta && s.head.eta < today);
  const chase = groups.filter(notCompleted);
  const receivedThisMonth = [...receipts.values()].flat().filter((g) => g.status === 'received' && (g.received_on ?? '').startsWith(month));

  const viewSwitch = (
    <div style={{ display: 'flex', gap: 4, background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: 4, alignSelf: 'flex-start' }}>
      {([['shipments', `Shipments · ${groups.length}`], ['log', 'Receipt log']] as const).map(([id, label]) => (
        <button key={id} onClick={() => setView(id)}
          style={{ padding: '7px 16px', borderRadius: 10, border: 'none', background: view === id ? C.green : 'transparent', color: view === id ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          {label}
        </button>
      ))}
    </div>
  );
  if (view === 'log') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {viewSwitch}
        <ScreenInvGrn embedded onChanged={load} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ErrorBanner text={error ?? coreErr} />
      {viewSwitch}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <KPICard accent label="Open shipments" value={openShips.length} sub={`${openShips.reduce((n, s) => n + outOf(s), 0).toLocaleString()} units to come · ${groups.filter((s) => stateOf(s) === 'in_transit').length} in transit`} />
        <KPICard label="Not completed" value={chase.length} sub="Part-delivered or awaiting receipt — chase the supplier" />
        <KPICard label="Past ETA" value={overdue.length} sub="Open with an arrival date already gone" />
        <KPICard label="Received this month" value={receivedThisMonth.reduce((n, g) => n + (g.qty_received ?? 0), 0).toLocaleString()} sub={`units over ${receivedThisMonth.length} receipt${receivedThisMonth.length === 1 ? '' : 's'}`} />
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
              <tr>{['PO', 'Supplier', 'Items', 'Received / Qty', 'Ordered', 'ETA', 'Status'].map((h) => <th key={h} style={{ ...thStyle, textAlign: h === 'Received / Qty' ? 'right' : 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const h = s.head;
                const st = stateOf(s);
                const meta = STATE_META[st];
                const got = gotTotal(s);
                const out = outOf(s);
                const late = ['ordered', 'in_transit', 'partial'].includes(st) && h.eta && h.eta < today;
                const excel = s.lines.map((l) => l.legacy_no).filter((n): n is number => n != null);
                return (
                  <tr key={s.id} onClick={() => setOpenId(s.id)} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer', verticalAlign: 'top' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>
                      {h.po_no || <span style={{ color: C.slate }}>No PO</span>}
                      {h.po_id && <div style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>From Raise PO</div>}
                      {excel.length > 0 && <div style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>Excel #{excel.join(', ')}</div>}
                    </td>
                    <td style={tdStyle}>{h.supplier || '—'}{h.customer && <div style={{ fontSize: 11, color: C.slate }}>For {h.customer}</div>}</td>
                    <td style={tdStyle}>
                      {s.lines.slice(0, 3).map((l) => {
                        const linked = items.find((i) => i.id === l.item_id);
                        return (
                          <div key={l.id} style={{ marginBottom: 4, textDecoration: l.status === 'cancelled' ? 'line-through' : 'none' }}>
                            {l.description}
                            <div style={{ fontSize: 11, color: linked ? C.slate : '#B07D00', fontWeight: linked ? 400 : 700 }}>
                              {linked ? `→ ${itemLabel(linked, items)}` : 'NOT LINKED TO AN ITEM'}
                            </div>
                          </div>
                        );
                      })}
                      {s.lines.length > 3 && <div style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>+ {s.lines.length - 3} more item{s.lines.length - 3 === 1 ? '' : 's'}</div>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {got > 0 ? <>{got}<span style={{ color: C.slate, fontWeight: 600 }}> / {qtyOf(s)}</span></> : qtyOf(s)}
                      {s.lines.length > 1 && <div style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>{s.lines.length} items</div>}
                      {got > 0 && out > 0 && <div style={{ fontSize: 11, color: '#B07D00' }}>{out} outstanding</div>}
                    </td>
                    <td style={{ ...tdStyle, color: C.slate, whiteSpace: 'nowrap' }}>{fmtD(h.order_date)}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: late ? '#C0321A' : C.slate, fontWeight: late ? 700 : 400 }}>
                      {h.eta_note && !h.eta ? h.eta_note : fmtD(h.eta)}
                      {h.eta && h.eta_note && <div style={{ fontSize: 11, color: C.slate, fontWeight: 400 }}>{h.eta_note}</div>}
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
        <ShipmentModal key={open.id} shipment={open} state={stateOf(open)} received={received} receipts={receipts}
          items={items} locations={locations} onHand={onHand} me={me}
          suppliers={suppliers} reloadSuppliers={reloadSuppliers} customers={customers} isAdmin={canDelete}
          canEdit={canEdit} canDelete={canDelete} onClose={() => setOpenId(null)} onChanged={refresh} />
      )}
      {creating && (
        <ShipmentModal shipment={null} state={null} received={received} receipts={receipts}
          items={items} locations={locations} onHand={onHand} me={me}
          suppliers={suppliers} reloadSuppliers={reloadSuppliers} customers={customers} isAdmin={canDelete}
          canEdit={canEdit} canDelete={false} onClose={() => setCreating(false)} onChanged={async () => { setCreating(false); await refresh(); }} />
      )}
      {managingSuppliers && (
        <Modal title="Suppliers" subtitle="The options in the shipment Supplier dropdown. Renaming updates every shipment and goods-received record that uses it." width={440} onClose={() => setManagingSuppliers(false)}>
          <LookupList kind="supplier" rows={suppliers} unit="shipment"
            usage={(n) => groups.filter((s) => (s.head.supplier ?? '').toLowerCase() === n.toLowerCase()).length}
            onChanged={async () => { await Promise.all([reloadSuppliers(), load()]); }} />
        </Modal>
      )}
    </div>
  );
}

interface LineDraft {
  key: string;
  id: string | null;
  item_id: string;
  description: string;
  qty: string;
  status: ShipStatus;
  got: number;
  hasReceipts: boolean;
}

function ShipmentModal({ shipment, state, received, receipts, items, locations, onHand, me, suppliers, reloadSuppliers, customers, isAdmin, canEdit, canDelete, onClose, onChanged }: {
  shipment: Shipment | null; state: ShipState | null; received: Map<string, number>; receipts: Map<string, InvGrn[]>;
  items: InvItem[]; locations: InvLocation[]; onHand: OnHand; me: string;
  suppliers: LookupRow[]; reloadSuppliers: () => Promise<void>; customers: CustomerOpt[]; isAdmin: boolean;
  canEdit: boolean; canDelete: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const isNew = !shipment;
  const head = shipment?.head ?? null;
  const editable = canEdit && state !== 'cancelled';
  const [completing, setCompleting] = useState<InvGrn | null>(null);
  const locName = (id: string | null) => locations.find((l) => l.id === id)?.name ?? '—';

  const initHeader = {
    supplier: head?.supplier ?? '', po_no: head?.po_no ?? '', customer: head?.customer ?? '', customer_id: head?.customer_id ?? '',
    mode: head?.mode ?? '', order_date: head?.order_date ?? todayISO(), in_transit_date: head?.in_transit_date ?? '',
    eta: head?.eta ?? '', eta_note: head?.eta_note ?? '', notes: head?.notes ?? '',
  };
  const initLines: LineDraft[] = shipment
    ? shipment.lines.map((l) => ({
        key: l.id, id: l.id, item_id: l.item_id ?? '', description: l.description, qty: String(l.qty), status: l.status,
        got: received.get(l.id) ?? 0, hasReceipts: (receipts.get(l.id) ?? []).length > 0,
      }))
    : [{ key: crypto.randomUUID(), id: null, item_id: '', description: '', qty: '1', status: 'ordered', got: 0, hasReceipts: false }];
  const [f, setF] = useState(initHeader);
  const [lines, setLines] = useState<LineDraft[]>(initLines);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | 'receive' | 'delete'>(null);
  // Not every shipment has a PO (warranty swaps, samples). Existing shipments
  // without one open with this already ticked.
  const [noPo, setNoPo] = useState(!!head && !head.po_no);
  // Set from the signed-in account when the shipment is created; never typed.
  const employee = head ? head.employee : me;
  const dirty = JSON.stringify(f) !== JSON.stringify(initHeader) || noPo !== (!!head && !head.po_no)
    || JSON.stringify(lines.map(({ id, item_id, description, qty }) => ({ id, item_id, description, qty })))
       !== JSON.stringify(initLines.map(({ id, item_id, description, qty }) => ({ id, item_id, description, qty })));

  const setLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { key: crypto.randomUUID(), id: null, item_id: '', description: '', qty: '1', status: 'ordered', got: 0, hasReceipts: false }]);
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const allReceipts = (shipment?.lines ?? []).flatMap((l) => receipts.get(l.id) ?? []);
  const anyReceipts = allReceipts.length > 0;

  const save = async (headerExtra?: Record<string, unknown>) => {
    if (lines.length === 0) { setErr('Add at least one item.'); return false; }
    for (const [i, l] of lines.entries()) {
      const n = Number(l.qty);
      if (!l.description.trim() && !l.item_id) { setErr(`Item ${i + 1}: describe it or pick an item.`); return false; }
      if (!Number.isInteger(n) || n <= 0) { setErr(`Item ${i + 1}: quantity must be a whole number above zero.`); return false; }
      if (n < l.got) { setErr(`Item ${i + 1}: ${l.got} already received — the quantity can't go below that.`); return false; }
    }
    if (!noPo && !f.po_no.trim()) { setErr('Enter the PO number, or tick "No PO".'); return false; }
    setBusy(true);
    setErr(null);
    const header = {
      supplier: f.supplier.trim() || null, po_no: noPo ? null : f.po_no.trim() || null,
      customer_id: f.customer_id || null, customer: f.customer.trim() || null,
      mode: f.mode || null, order_date: f.order_date || null, in_transit_date: f.in_transit_date || null,
      eta: f.eta || null, eta_note: f.eta_note.trim() || null, notes: f.notes.trim() || null, updated_at: new Date().toISOString(),
      ...headerExtra,
    };
    const lineFields = (l: LineDraft) => {
      const item = items.find((i) => i.id === l.item_id);
      const qty = Number(l.qty);
      return { item_id: l.item_id || null, qty, description: l.description.trim() || (item ? `${qty} × ${item.name}` : '') };
    };
    const groupId = shipment?.id ?? crypto.randomUUID();
    // New lines join a shipment already on its way as in transit.
    const newStatus: ShipStatus = state === 'in_transit' || state === 'partial' ? 'in_transit' : 'ordered';
    const errors: string[] = [];
    const kept = new Set(lines.map((l) => l.id).filter(Boolean));
    for (const old of shipment?.lines ?? []) {
      if (kept.has(old.id)) continue;
      const { error } = await supabase.from('inv_shipments').delete().eq('id', old.id);
      if (error) errors.push(error.message);
    }
    for (const l of lines) {
      const { error } = l.id
        ? await supabase.from('inv_shipments').update({ ...header, ...lineFields(l) }).eq('id', l.id)
        : await supabase.from('inv_shipments').insert({ ...header, ...lineFields(l), group_id: groupId, status: newStatus, employee: employee ?? me, created_by: me });
      if (error) errors.push(error.message);
    }
    setBusy(false);
    if (errors.length) { setErr(errors[0]); return false; }
    return true;
  };

  // Status changes apply to every item line still in that state.
  const setLinesStatus = async (from: ShipStatus[], to: ShipStatus, extra?: Record<string, unknown>) => {
    const ids = (shipment?.lines ?? []).filter((l) => from.includes(l.status)).map((l) => l.id);
    if (!ids.length) return;
    setBusy(true);
    const { error } = await supabase.from('inv_shipments').update({ status: to, updated_at: new Date().toISOString(), ...extra }).in('id', ids);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onChanged();
    onClose();
  };

  const remove = async () => {
    setBusy(true);
    const { error } = await supabase.from('inv_shipments').delete().in('id', (shipment?.lines ?? []).map((l) => l.id));
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onChanged();
    onClose();
  };

  const ro = !editable;
  const meta = state ? STATE_META[state] : null;
  const openLines = (shipment?.lines ?? []).filter(lineOpen);
  const totalQty = lines.reduce((n, l) => n + (Number(l.qty) || 0), 0);
  const totalGot = lines.reduce((n, l) => n + l.got, 0);
  const excel = (shipment?.lines ?? []).map((l) => l.legacy_no).filter((n): n is number => n != null);

  return (
    <Modal title={isNew ? 'New incoming shipment' : (head!.po_no || 'Shipment — no PO')} width={760} onClose={onClose}
      subtitle={head ? `${head.supplier ?? ''}${excel.length ? ` · Excel #${excel.join(', ')}` : ''}` : 'Track a supplier order until it is received into stock'}
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
          {totalGot > 0 && <span style={{ fontSize: 12, color: C.slate }}>{totalGot} of {totalQty} received in the app</span>}
          {head?.received_on && <span style={{ fontSize: 12, color: C.slate }}>Last received {fmtD(head.received_on)}</span>}
        </div>
      )}
      {head?.notes && <div style={{ background: '#FFF8E1', color: '#7A5A00', borderRadius: 10, padding: '10px 14px', fontSize: 12, lineHeight: 1.5 }}>{head.notes}</div>}

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

      {/* Item lines */}
      <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Items · {lines.length}</div>
          <span style={{ fontSize: 12, color: C.slate }}>{totalQty} unit{totalQty === 1 ? '' : 's'} in total</span>
        </div>
        {lines.map((l, i) => {
          const locked = l.hasReceipts || l.status === 'received';
          const lm = SHIP_META[l.status];
          return (
            <div key={l.key} style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>Item {i + 1}</span>
                {l.id && <Pill bg={lm.bg} color={lm.color}>{lm.label}</Pill>}
                {l.got > 0 && <span style={{ fontSize: 11, color: C.slate }}>{l.got} received</span>}
                {!ro && !locked && lines.length > 1 && (
                  <button type="button" onClick={() => removeLine(l.key)} title="Remove this item"
                    style={{ marginLeft: 'auto', width: 26, height: 26, borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                    <X size={13} strokeWidth={2.5} />
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 12 }}>
                <Field label="Item it becomes in stock" hint={!l.item_id ? 'Link an item so receiving can add it to stock' : undefined}>
                  <ItemSelect items={items} value={l.item_id} onChange={(v) => setLine(l.key, { item_id: v })} allowNone noneLabel="Not linked" disabled={ro} />
                </Field>
                <Field label="Qty"><input type="number" min={Math.max(1, l.got)} step="1" value={l.qty} disabled={ro} onChange={(e) => setLine(l.key, { qty: e.target.value })} style={inputStyle} /></Field>
              </div>
              <Field label="Supplier description"><input value={l.description} disabled={ro} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="As written on the PO / packing list" style={inputStyle} /></Field>
            </div>
          );
        })}
        {!ro && (
          <button type="button" onClick={addLine}
            style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 10, border: `1px dashed ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> Add another item
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Field label="Order date"><input type="date" value={f.order_date} disabled={ro} onChange={(e) => setF({ ...f, order_date: e.target.value })} style={inputStyle} /></Field>
        <Field label="In transit (ETD)"><input type="date" value={f.in_transit_date} disabled={ro} onChange={(e) => setF({ ...f, in_transit_date: e.target.value })} style={inputStyle} /></Field>
        <Field label="Est. arrival"><input type="date" value={f.eta} disabled={ro} onChange={(e) => setF({ ...f, eta: e.target.value })} style={inputStyle} /></Field>
        <Field label="Arrival note"><input value={f.eta_note} disabled={ro} onChange={(e) => setF({ ...f, eta_note: e.target.value })} placeholder="e.g. TBC, 16/06 - 17/06" style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Field label="EV1 employee" hint={head && !head.employee ? 'Not recorded in Excel' : undefined}>
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

      {allReceipts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Receipts</div>
          {allReceipts.map((g) => {
            const pending = g.status === 'pending';
            const short = !pending && g.qty_ordered != null && g.qty_received != null && g.qty_received < g.qty_ordered;
            return (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: pending ? '#FFFCF2' : C.seasalt, border: '1px solid #F3F3F3', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: pending ? '#B07D00' : C.green, whiteSpace: 'nowrap' }}>{pending ? 'Awaiting receipt' : fmtD(g.received_on)}</span>
                <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{g.item_name}</span>
                <span style={{ color: '#1a1a1a', whiteSpace: 'nowrap' }}>{pending ? `${g.qty_ordered ?? '?'} expected` : `${g.qty_received ?? 0} of ${g.qty_ordered ?? '?'}`}</span>
                {short && <span style={{ fontSize: 11, fontWeight: 700, color: '#C0321A', whiteSpace: 'nowrap' }}>short {(g.qty_ordered ?? 0) - (g.qty_received ?? 0)}</span>}
                <span style={{ flex: 1, minWidth: 120, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[!pending && locName(g.location_id), g.condition, g.notes].filter(Boolean).join(' · ')}
                </span>
                {pending && canEdit && (
                  <button onClick={() => setCompleting(g)} style={{ ...primaryBtn(), padding: '6px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <PackageCheck size={13} /> Receive
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {completing && (
        <CompleteModal grn={completing} items={items} locations={locations} onHand={onHand} me={me}
          onClose={() => setCompleting(null)} onDone={async () => { setCompleting(null); await onChanged(); onClose(); }} />
      )}

      {!isNew && canEdit && (
        <div style={{ borderTop: '1px solid #F3F3F3', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mode === null && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {openLines.length > 0 && (
                <button onClick={() => setMode('receive')} disabled={dirty} title={dirty ? 'Save your changes first' : undefined}
                  style={{ ...primaryBtn(dirty), display: 'inline-flex', alignItems: 'center', gap: 6 }}><PackageCheck size={14} /> Receive into stock</button>
              )}
              {shipment!.lines.some((l) => l.status === 'ordered') && (
                <button onClick={() => void setLinesStatus(['ordered'], 'in_transit', { in_transit_date: f.in_transit_date || todayISO() })} disabled={busy || dirty} style={ghostBtn}>Mark in transit</button>
              )}
              {openLines.length > 0 && !anyReceipts && (
                <button onClick={() => void setLinesStatus(['ordered', 'in_transit'], 'cancelled')} disabled={busy} style={{ ...ghostBtn, color: '#C0321A' }}>Cancel shipment</button>
              )}
              {state === 'cancelled' && <button onClick={() => void setLinesStatus(['cancelled'], 'ordered')} disabled={busy} style={ghostBtn}>Reopen</button>}
              {dirty && openLines.length > 0 && <span style={{ fontSize: 11, color: C.slate }}>Save changes before receiving.</span>}
              {canDelete && !anyReceipts && <button onClick={() => setMode('delete')} style={{ ...ghostBtn, marginLeft: 'auto', color: '#C0321A' }}>Delete</button>}
            </div>
          )}
          {mode === 'receive' && (
            <ReceiveForm lines={openLines} received={received} items={items} locations={locations} me={me}
              onCancel={() => setMode(null)} onDone={async () => { await onChanged(); onClose(); }} />
          )}
          {mode === 'delete' && (
            <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this shipment and its {shipment!.lines.length} item{shipment!.lines.length === 1 ? '' : 's'}? This can't be undone.</span>
              <button onClick={() => setMode(null)} style={ghostBtn}>Cancel</button>
              <button onClick={() => void remove()} disabled={busy} style={{ ...primaryBtn(busy), background: '#C0321A' }}>Yes, delete</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// Receive any or all of a shipment's open items in one go: one location, date
// and condition for the delivery, a quantity per item. All-or-nothing.
function ReceiveForm({ lines, received, items, locations, me, onCancel, onDone }: {
  lines: InvShipment[]; received: Map<string, number>; items: InvItem[]; locations: InvLocation[]; me: string;
  onCancel: () => void; onDone: () => Promise<void>;
}) {
  const outstanding = (l: InvShipment) => Math.max(0, l.qty - (received.get(l.id) ?? 0));
  const [qtys, setQtys] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, l.item_id ? String(outstanding(l)) : '0'])));
  const [loc, setLoc] = useState(locations.find((l) => l.usable)?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [condition, setCondition] = useState('Good');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    const payload: { shipment: string; qty: number }[] = [];
    for (const l of lines) {
      const n = Number(qtys[l.id] ?? 0);
      if (!Number.isInteger(n) || n < 0) { setErr('Quantities must be whole numbers (0 or more).'); return; }
      if (n > 0 && !l.item_id) { setErr(`"${l.description}" isn't linked to an item — link it above and save first.`); return; }
      if (n > 0) payload.push({ shipment: l.id, qty: n });
    }
    if (payload.length === 0) { setErr('Enter a received quantity for at least one item.'); return; }
    if (!loc) { setErr('Pick where it is going.'); return; }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc('inv_receive_shipment_lines', {
      p_lines: payload, p_location: loc, p_date: date, p_condition: condition.trim() || null, p_note: note.trim() || null, p_by: me,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onDone();
  };

  return (
    <div style={{ background: C.honeydew, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Receive into stock</div>
      <ErrorBanner text={err} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {lines.map((l) => {
          const item = items.find((i) => i.id === l.item_id);
          const out = outstanding(l);
          const n = Number(qtys[l.id] ?? 0);
          return (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.white, borderRadius: 10, padding: '8px 12px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item ? itemLabel(item, items) : l.description}</div>
                <div style={{ fontSize: 11, color: item ? C.slate : '#B07D00', fontWeight: item ? 400 : 700 }}>
                  {item ? `${out} outstanding${Number.isInteger(n) && n > 0 && n !== out ? ` · variance ${n - out > 0 ? '+' : ''}${n - out}` : ''}` : 'Not linked to an item — link it above first'}
                </div>
              </div>
              <input type="number" min="0" step="1" value={qtys[l.id] ?? '0'} disabled={!item}
                onChange={(e) => setQtys((q) => ({ ...q, [l.id]: e.target.value }))}
                style={{ ...inputStyle, width: 90, textAlign: 'right', background: item ? C.white : C.seasalt }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Field label="Into location"><LocationSelect locations={locations} value={loc} onChange={setLoc} /></Field>
        <Field label="Date received"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="Condition"><input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Good / damaged…" style={inputStyle} /></Field>
      </div>
      <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — damaged box, short-shipped…" style={inputStyle} /></Field>
      <div style={{ fontSize: 11, color: C.slate }}>Each item with a quantity becomes a receipt and goes into stock at the chosen location. Anything short stays open on the shipment. Leave an item at 0 if it didn't come.</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Back</button>
        <button onClick={() => void go()} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Receiving…' : 'Confirm receipt'}</button>
      </div>
    </div>
  );
}
