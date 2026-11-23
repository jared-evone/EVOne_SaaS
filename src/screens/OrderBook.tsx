import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, X, BookCheck, Download } from 'lucide-react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { SearchSelect, type SelectOption } from '../components/SearchSelect';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { fmtMoney, WON_STAGES, WON_STAGE_LABELS, WON_STAGE_COLORS, type WonStage } from './Sales';

// The sales order book: every WON quotation and the chargers it has to supply,
// with how each is being bought — a Raise PO, a PO number raised outside the
// app, or existing stock. Lines with none of those are the pending purchases.

interface OrderQuote {
  id: string;
  ref: string;
  customer_id: string | null;
  customer_name: string;
  salesperson_id: string | null;
  salesperson_name: string;
  total: number;
  quote_date: string;
  won_at: string | null;
  outcome_date: string | null;
  won_stage: WonStage | null;
  archived_at: string | null;
}

interface OrderLine {
  id: string;
  quote_id: string;
  item_id: string | null;
  item_name: string;
  qty: number;
  from_stock: boolean;
  po_id: string | null;
  po_no: string | null;
  notes: string | null;
  position: number;
  warranty_years: number | null;
}

const warrantyLabel = (y: number | null | undefined) => (y == null ? '' : `${y}-yr warranty`);

interface PORef {
  id: string;
  po_number: string;
  title: string;
  supplier: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'sent_to_finance' | 'completed' | 'cancelled';
  lines: { product_id: string | null }[] | null;
  customer_id: string | null;
  customer_name: string | null;
}

interface ShipRef { po_id: string | null; po_no: string | null; item_id: string | null; status: string }
interface ItemRef { id: string; name: string; brand: string | null; category: string | null; active: boolean }

/** Units of one charger model on the book, split by where the purchase stands. */
interface ModelRow {
  key: string;
  brand: string;
  model: string;
  sold: number;
  awaiting: number;
  inPo: number;
  onOrder: number;
  inHand: number;
  refs: { id: string; ref: string }[];
  oldest: string;
  warranty: number | null;
}

type LineState = 'awaiting' | 'po_dead' | 'po_pending' | 'po_finance' | 'po_raised' | 'ordered' | 'in_transit' | 'received' | 'stock';

const LINE_META: Record<LineState, { label: string; bg: string; color: string; rank: number }> = {
  awaiting:   { label: 'Awaiting PO',          bg: '#FFF0E0', color: '#B45309', rank: 0 },
  po_dead:    { label: 'PO rejected / cancelled', bg: '#FDEAEA', color: '#C0321A', rank: 0 },
  po_pending: { label: 'PO pending approval',  bg: '#FFF8E1', color: '#B07D00', rank: 1 },
  po_finance: { label: 'PO with finance',      bg: '#E3F0FF', color: '#1A62C0', rank: 2 },
  po_raised:  { label: 'PO raised',            bg: '#F0E8FF', color: '#6B21A8', rank: 3 },
  ordered:    { label: 'Ordered',              bg: '#F0E8FF', color: '#6B21A8', rank: 3 },
  in_transit: { label: 'In transit',           bg: '#E3F0FF', color: '#1A62C0', rank: 4 },
  received:   { label: 'Received',             bg: '#E4F3E3', color: '#1B512D', rank: 5 },
  stock:      { label: 'From stock',           bg: '#F3F3F3', color: '#767B77', rank: 5 },
};

type OrderState = 'unlisted' | 'awaiting' | 'on_order' | 'ready';
const ORDER_META: Record<OrderState, { label: string; bg: string; color: string }> = {
  unlisted: { label: 'Chargers not listed', bg: '#F3F3F3', color: '#767B77' },
  awaiting: { label: 'Awaiting PO',         bg: '#FFF0E0', color: '#B45309' },
  on_order: { label: 'On order',            bg: '#E3F0FF', color: '#1A62C0' },
  ready:    { label: 'All in hand',         bg: '#E4F3E3', color: '#1B512D' },
};

const PO_STATUS_LABEL: Record<PORef['status'], string> = {
  pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected',
  sent_to_finance: 'With finance', completed: 'Completed', cancelled: 'Cancelled',
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const wonDate = (q: OrderQuote) => (q.won_at ?? q.outcome_date ?? q.quote_date ?? '').slice(0, 10);
const normNo = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

function Pill({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: bg, color, whiteSpace: 'nowrap' }}>{children}</span>;
}

export function ScreenOrderBook() {
  const { can, user, isAdmin } = usePermissions();
  const canEdit = can('sales_orderbook', 'can_edit');
  // Like the Sales Pipeline: admins (and full Order Book rights) see every
  // salesperson's orders; everyone else sees their own.
  const seeAll = isAdmin || (canEdit && can('sales_orderbook', 'can_delete'));

  const [quotes, setQuotes] = useState<OrderQuote[]>([]);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [pos, setPos] = useState<PORef[]>([]);
  const [ships, setShips] = useState<ShipRef[]>([]);
  const [items, setItems] = useState<ItemRef[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string; user_id: string | null }[]>([]);
  const [customerNames, setCustomerNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<'orders' | 'models' | 'pending'>('orders');
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | OrderState>('all');
  const [stageFilter, setStageFilter] = useState<string>('open');
  const [person, setPerson] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const [q, l, p, s, it, sp, cu] = await Promise.all([
      supabase.from('sales_quotations').select('id, ref, customer_id, customer_name, salesperson_id, salesperson_name, total, quote_date, won_at, outcome_date, won_stage, archived_at').eq('status', 'Won'),
      supabase.from('sales_order_lines').select('*').order('position').order('created_at'),
      supabase.from('purchase_orders').select('id, po_number, title, supplier, status, lines, customer_id, customer_name').order('created_at', { ascending: false }),
      supabase.from('inv_shipments').select('po_id, po_no, item_id, status'),
      supabase.from('inv_items').select('id, name, brand, category, active').order('name'),
      supabase.from('sales_people').select('id, name, user_id').order('name'),
      supabase.from('customers').select('id, name'),
    ]);
    const err = q.error ?? l.error ?? p.error ?? s.error ?? it.error ?? sp.error ?? cu.error;
    if (err) { setError(err.message); setLoading(false); return; }
    setQuotes((q.data ?? []) as OrderQuote[]);
    setLines((l.data ?? []) as OrderLine[]);
    setPos((p.data ?? []) as PORef[]);
    setShips((s.data ?? []) as ShipRef[]);
    setItems((it.data ?? []) as ItemRef[]);
    setPeople((sp.data ?? []) as { id: string; name: string; user_id: string | null }[]);
    setCustomerNames(new Map(((cu.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])));
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const poById = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);
  const linesByQuote = useMemo(() => {
    const m = new Map<string, OrderLine[]>();
    for (const l of lines) m.set(l.quote_id, [...(m.get(l.quote_id) ?? []), l]);
    return m;
  }, [lines]);

  // Shipment progress for a PO: prefer the shipment lines for this charger.
  const shipState = (match: (s: ShipRef) => boolean, itemId: string | null): LineState | null => {
    const all = ships.filter(match).filter((s) => s.status !== 'cancelled');
    const forItem = itemId ? all.filter((s) => s.item_id === itemId) : [];
    const set = forItem.length ? forItem : all;
    if (!set.length) return null;
    if (set.every((s) => s.status === 'received')) return 'received';
    if (set.some((s) => s.status === 'in_transit' || s.status === 'partial' || s.status === 'received')) return 'in_transit';
    return 'ordered';
  };
  const lineState = (l: Pick<OrderLine, 'from_stock' | 'po_id' | 'po_no' | 'item_id'>): LineState => {
    if (l.from_stock) return 'stock';
    const po = l.po_id ? poById.get(l.po_id) : undefined;
    if (po) {
      if (po.status === 'rejected' || po.status === 'cancelled') return 'po_dead';
      if (po.status === 'pending') return 'po_pending';
      // Approved = the order is going ahead: show Ordered (then In transit /
      // Received once finance completes it and its shipment moves).
      if (po.status === 'approved' || po.status === 'sent_to_finance') return 'ordered';
      return shipState((s) => s.po_id === po.id || normNo(s.po_no) === normNo(po.po_number), l.item_id) ?? 'ordered';
    }
    if (normNo(l.po_no)) return shipState((s) => normNo(s.po_no) === normNo(l.po_no), l.item_id) ?? 'po_raised';
    return 'awaiting';
  };
  const orderState = (ls: OrderLine[]): OrderState => {
    if (!ls.length) return 'unlisted';
    const ranks = ls.map((l) => LINE_META[lineState(l)].rank);
    if (ranks.some((r) => r === 0)) return 'awaiting';
    return ranks.every((r) => r === 5) ? 'ready' : 'on_order';
  };

  const myPerson = people.find((p) => p.user_id === user.id || p.id === user.id) ?? null;
  // An archived won quote stays on the book only while it has chargers listed.
  const visible = quotes
    .filter((q) => !q.archived_at || (linesByQuote.get(q.id)?.length ?? 0) > 0)
    .filter((q) => (seeAll ? person === 'all' || q.salesperson_id === person : !!myPerson && q.salesperson_id === myPerson.id))
    .map((q) => ({ ...q, customer_name: (q.customer_id && customerNames.get(q.customer_id)) || q.customer_name }))
    .sort((a, b) => wonDate(b).localeCompare(wonDate(a)));

  const ql = search.trim().toLowerCase();
  const stageOk = (q: OrderQuote) => (stageFilter === 'all' ? true
    : stageFilter === 'open' ? q.won_stage !== 'completed_invoiced'
    : stageFilter === 'none' ? !q.won_stage
    : q.won_stage === stageFilter);
  const shown = visible.filter((q) => {
    const ls = linesByQuote.get(q.id) ?? [];
    if (stateFilter !== 'all' && orderState(ls) !== stateFilter) return false;
    if (!stageOk(q)) return false;
    if (!ql) return true;
    return [q.ref, q.customer_name, q.salesperson_name, ...ls.flatMap((l) => [l.item_name, l.po_no, l.po_id ? poById.get(l.po_id)?.po_number : ''])]
      .join(' ').toLowerCase().includes(ql);
  });

  // Charger units per brand and model, across the orders the Stage and
  // Salesperson filters leave in view. A line typed in without a Stock Levels
  // item takes its brand from its first word when that matches a known brand.
  const knownBrands = new Map(items.filter((i) => i.brand?.trim()).map((i) => [i.brand!.trim().toLowerCase(), i.brand!.trim()]));
  const modelRows: ModelRow[] = (() => {
    const m = new Map<string, ModelRow>();
    for (const q of visible.filter(stageOk)) {
      for (const l of linesByQuote.get(q.id) ?? []) {
        const item = l.item_id ? items.find((i) => i.id === l.item_id) : undefined;
        const key = `${l.item_id ?? `name:${l.item_name.trim().toLowerCase()}`}|${l.warranty_years ?? ''}`;
        const brand = item?.brand?.trim()
          || (!item ? knownBrands.get(l.item_name.trim().split(/\s+/)[0]?.toLowerCase() ?? '') : undefined)
          || 'Others';
        const row = m.get(key) ?? { key, brand, model: item?.name ?? l.item_name, sold: 0, awaiting: 0, inPo: 0, onOrder: 0, inHand: 0, refs: [], oldest: wonDate(q), warranty: l.warranty_years };
        const st = lineState(l);
        row.sold += l.qty;
        if (st === 'received' || st === 'stock') row.inHand += l.qty;
        else if (st === 'awaiting' || st === 'po_dead') row.awaiting += l.qty;
        else if (st === 'po_pending' || st === 'po_finance') row.inPo += l.qty;
        else row.onOrder += l.qty;
        if (!row.refs.some((r) => r.id === q.id)) row.refs.push({ id: q.id, ref: q.ref });
        if (wonDate(q) && (!row.oldest || wonDate(q) < row.oldest)) row.oldest = wonDate(q);
        m.set(key, row);
      }
    }
    return [...m.values()];
  })();
  const toCome = (r: ModelRow) => r.awaiting + r.inPo + r.onOrder;
  const pendingRows = modelRows.filter((r) => toCome(r) > 0);
  const chargerRows = (view === 'pending' ? pendingRows : modelRows)
    .filter((r) => !ql || [r.brand, r.model, ...r.refs.map((x) => x.ref)].join(' ').toLowerCase().includes(ql));
  // Brand groups, biggest first; models inside by units.
  const brandGroups = (() => {
    const g = new Map<string, { brand: string; rows: ModelRow[] }>();
    for (const r of chargerRows) {
      const k = r.brand.toLowerCase();
      g.set(k, { brand: g.get(k)?.brand ?? r.brand, rows: [...(g.get(k)?.rows ?? []), r] });
    }
    const weight = (r: ModelRow) => (view === 'pending' ? r.awaiting * 1e6 + toCome(r) : r.sold);
    return [...g.values()]
      .map((x) => ({ ...x, rows: x.rows.sort((a, b) => weight(b) - weight(a) || a.model.localeCompare(b.model)) }))
      .sort((a, b) => (a.brand.toLowerCase() === 'others' ? 1 : 0) - (b.brand.toLowerCase() === 'others' ? 1 : 0)
        || b.rows.reduce((n, r) => n + weight(r), 0) - a.rows.reduce((n, r) => n + weight(r), 0)
        || a.brand.localeCompare(b.brand));
  })();

  const visibleLines = visible.flatMap((q) => linesByQuote.get(q.id) ?? []);
  const awaitingUnits = visibleLines.filter((l) => { const s = lineState(l); return s === 'awaiting' || s === 'po_dead'; }).reduce((n, l) => n + l.qty, 0);
  const awaitingOrders = visible.filter((q) => orderState(linesByQuote.get(q.id) ?? []) === 'awaiting').length;
  const unlisted = visible.filter((q) => !(linesByQuote.get(q.id)?.length)).length;

  const exportCsv = () => {
    const rows: (string | number | null)[][] = view === 'orders'
      ? [['Quotation', 'Customer', 'Salesperson', 'Won', 'Value', 'Stage', 'Charger', 'Qty', 'Warranty (years)', 'Purchase', 'PO', 'Notes']]
      : [['Brand', 'Model', 'Warranty (years)', 'Sold', 'Awaiting PO', 'PO in progress', 'Ordered / in transit', 'In hand', 'Quotations', 'Oldest win']];
    if (view !== 'orders') {
      for (const g of brandGroups) for (const r of g.rows) rows.push([g.brand, r.model, r.warranty, r.sold, r.awaiting, r.inPo, r.onOrder, r.inHand, r.refs.map((x) => x.ref).join(' '), r.oldest]);
    }
    for (const q of view === 'orders' ? shown : []) {
      const ls = linesByQuote.get(q.id) ?? [];
      const base = [q.ref, q.customer_name, q.salesperson_name, wonDate(q), q.total, q.won_stage ? WON_STAGE_LABELS[q.won_stage] : ''];
      if (!ls.length) rows.push([...base, '', '', '', ORDER_META.unlisted.label, '', '']);
      for (const l of ls) rows.push([...base, l.item_name, l.qty, l.warranty_years, LINE_META[lineState(l)].label, (l.po_id && poById.get(l.po_id)?.po_number) || l.po_no || '', l.notes]);
    }
    const csv = rows.map((r) => r.map((v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `order-book-${view === 'orders' ? 'orders' : view === 'pending' ? 'pending-purchases' : 'chargers'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.slate, fontSize: 13 }}>Loading…</div>;

  const open = openId ? visible.find((q) => q.id === openId) ?? null : null;
  const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#1a1a1a', verticalAlign: 'top' };
  const pill = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 99, border: active ? 'none' : '1px solid #EBEBEB', background: active ? C.green : C.white, color: active ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        <KPICard label="Won orders" value={String(visible.length)} sub={`${fmtMoney(visible.reduce((n, q) => n + (q.total || 0), 0))} won value`} accent />
        <KPICard label="Chargers on the book" value={visibleLines.reduce((n, l) => n + l.qty, 0).toLocaleString()} sub={`across ${visible.length - unlisted} order${visible.length - unlisted === 1 ? '' : 's'}`} />
        <KPICard label="Awaiting PO" value={awaitingUnits.toLocaleString()} sub={`charger${awaitingUnits === 1 ? '' : 's'} on ${awaitingOrders} order${awaitingOrders === 1 ? '' : 's'}`} />
        <KPICard label="Not listed yet" value={String(unlisted)} sub="won quotes with no chargers entered" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB' }}>
          {([['orders', 'Orders'], ['models', 'By brand & model'], ['pending', 'Pending purchases']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              style={{ padding: '8px 18px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: view === id ? C.green : 'transparent', color: view === id ? C.white : C.slate, whiteSpace: 'nowrap' }}>
              {label}{id === 'pending' && pendingRows.length ? ` · ${pendingRows.length}` : ''}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', width: 240 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search quote, customer, charger, PO…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        <div style={{ width: 210 }}>
          <SearchSelect value={stageFilter} onChange={setStageFilter} placeholder="Stage"
            options={[
              { value: 'open', label: 'Not yet completed' },
              { value: 'all', label: 'All stages' },
              ...WON_STAGES.map((s) => ({ value: s, label: WON_STAGE_LABELS[s] })),
              { value: 'none', label: 'No stage set' },
            ]} />
        </div>
        {seeAll && (
          <div style={{ width: 200 }}>
            <SearchSelect value={person} onChange={setPerson} placeholder="Salesperson"
              options={[{ value: 'all', label: 'All salespeople' }, ...people.map((p) => ({ value: p.id, label: p.name }))]} />
          </div>
        )}
        <button onClick={exportCsv} disabled={view === 'orders' ? !shown.length : !chargerRows.length}
          style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: (view === 'orders' ? shown.length : chargerRows.length) ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> CSV
        </button>
      </div>

      {view === 'orders' ? (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['all', 'awaiting', 'on_order', 'ready', 'unlisted'] as const).map((k) => (
              <button key={k} onClick={() => setStateFilter(k)} style={pill(stateFilter === k)}>
                {k === 'all' ? 'All' : ORDER_META[k].label}
              </button>
            ))}
          </div>
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: C.seasalt }}>
                  {['Quotation', 'Customer', 'Value', 'Stage', 'Chargers', 'Purchase'].map((h) => (
                    <th key={h} style={{ ...th, textAlign: h === 'Value' ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((q) => {
                  const ls = linesByQuote.get(q.id) ?? [];
                  const st = ORDER_META[orderState(ls)];
                  const poNos = [...new Set(ls.map((l) => (l.po_id && poById.get(l.po_id)?.po_number) || l.po_no).filter(Boolean))];
                  return (
                    <tr key={q.id} onClick={() => setOpenId(q.id)} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                      <td style={td}>
                        <div style={{ fontWeight: 700, color: C.green }}>{q.ref}</div>
                        <div style={{ fontSize: 12, color: C.slate }}>Won {fmtDate(wonDate(q))}{q.archived_at ? ' · archived' : ''}</div>
                      </td>
                      <td style={td}>
                        {q.customer_name}
                        <div style={{ fontSize: 12, color: C.slate }}>{q.salesperson_name}</div>
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>{fmtMoney(q.total || 0)}</td>
                      <td style={td}>{q.won_stage ? <Pill {...WON_STAGE_COLORS[q.won_stage]}>{WON_STAGE_LABELS[q.won_stage]}</Pill> : <span style={{ fontSize: 12, color: C.slate }}>—</span>}</td>
                      <td style={td}>
                        {ls.length === 0 ? <span style={{ fontSize: 12, color: C.slate }}>None listed</span> : (
                          <>
                            {ls.slice(0, 3).map((l) => (
                              <div key={l.id} style={{ fontSize: 13 }}>{l.qty} × {l.item_name}{l.warranty_years != null && <span style={{ color: '#6B21A8', fontWeight: 700, fontSize: 11 }}> · {warrantyLabel(l.warranty_years)}</span>}</div>
                            ))}
                            {ls.length > 3 && <div style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>+ {ls.length - 3} more</div>}
                          </>
                        )}
                      </td>
                      <td style={td}>
                        <Pill bg={st.bg} color={st.color}>{st.label}</Pill>
                        {poNos.length > 0 && <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>{poNos.join(', ')}</div>}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '48px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                    <BookCheck size={32} strokeWidth={1.5} color={C.slate} style={{ display: 'block', margin: '0 auto 10px' }} />
                    {!seeAll && !myPerson ? 'Your account isn\'t linked to a salesperson, so there are no orders to show.' : visible.length ? 'No orders match these filters.' : 'No won quotations yet. Quotes marked Won in the Sales Pipeline appear here.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (() => {
        const pendingView = view === 'pending';
        const cols: { h: string; num?: boolean }[] = [
          { h: 'Brand / model' },
          { h: pendingView ? 'Still to come' : 'Sold', num: true },
          { h: 'Awaiting PO', num: true },
          { h: 'PO in progress', num: true },
          { h: 'Ordered / in transit', num: true },
          ...(pendingView ? [] : [{ h: 'In hand', num: true }]),
          { h: 'Quotations' },
          { h: 'Oldest win' },
        ];
        const nums = (r: Pick<ModelRow, 'sold' | 'awaiting' | 'inPo' | 'onOrder' | 'inHand'>) => [
          { v: pendingView ? r.awaiting + r.inPo + r.onOrder : r.sold, color: '#1a1a1a' },
          { v: r.awaiting, color: '#B45309' },
          { v: r.inPo, color: '#1A62C0' },
          { v: r.onOrder, color: '#6B21A8' },
          ...(pendingView ? [] : [{ v: r.inHand, color: '#1B512D' }]),
        ];
        return (
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: pendingView ? 820 : 900, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: C.seasalt }}>
                  {cols.map((c) => <th key={c.h} style={{ ...th, textAlign: c.num ? 'right' : 'left' }}>{c.h}</th>)}
                </tr>
              </thead>
              <tbody>
                {brandGroups.map((g) => {
                  const sum = (k: 'sold' | 'awaiting' | 'inPo' | 'onOrder' | 'inHand') => g.rows.reduce((n, r) => n + r[k], 0);
                  const totals = { sold: sum('sold'), awaiting: sum('awaiting'), inPo: sum('inPo'), onOrder: sum('onOrder'), inHand: sum('inHand') };
                  return [
                    <tr key={`b:${g.brand}`} style={{ background: C.honeydew, borderBottom: '1px solid #F3F3F3' }}>
                      <td style={{ ...td, fontWeight: 700, color: C.green }}>
                        {g.brand}
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: C.slate }}>{g.rows.length} model{g.rows.length === 1 ? '' : 's'}</span>
                      </td>
                      {nums(totals).map((n, i) => (
                        <td key={i} style={{ ...td, textAlign: 'right', fontWeight: 700, color: n.v ? (i === 0 ? C.green : n.color) : C.slate }}>{n.v || '—'}</td>
                      ))}
                      <td style={td} />
                      <td style={td} />
                    </tr>,
                    ...g.rows.map((r) => (
                      <tr key={r.key} style={{ borderBottom: '1px solid #F3F3F3' }}>
                        <td style={{ ...td, paddingLeft: 32, fontWeight: 600 }}>
                          {r.model}
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap',
                            background: r.warranty == null ? '#F3F3F3' : '#F0E8FF', color: r.warranty == null ? '#767B77' : '#6B21A8' }}>
                            {r.warranty == null ? 'Warranty not set' : warrantyLabel(r.warranty)}
                          </span>
                        </td>
                        {nums(r).map((n, i) => (
                          <td key={i} style={{ ...td, textAlign: 'right', fontWeight: 700, color: n.v ? n.color : C.slate }}>{n.v || '—'}</td>
                        ))}
                        <td style={td}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {r.refs.map((x) => (
                              <button key={x.id} onClick={() => setOpenId(x.id)}
                                style={{ padding: '2px 8px', borderRadius: 99, border: '1px solid #EBEBEB', background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{x.ref}</button>
                            ))}
                          </div>
                        </td>
                        <td style={{ ...td, color: C.slate, whiteSpace: 'nowrap' }}>{fmtDate(r.oldest)}</td>
                      </tr>
                    )),
                  ];
                })}
                {brandGroups.length === 0 && (
                  <tr><td colSpan={cols.length} style={{ padding: '48px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                    <BookCheck size={32} strokeWidth={1.5} color={C.slate} style={{ display: 'block', margin: '0 auto 10px' }} />
                    {ql ? 'No chargers match this search.'
                      : pendingView ? 'Nothing pending — every listed charger is received or coming from stock.'
                      : 'No chargers listed on these orders yet. Open an order and add its chargers.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })()}

      {open && (
        <OrderModal key={open.id} quote={open} lines={linesByQuote.get(open.id) ?? []} items={items} pos={pos}
          lineState={lineState} canEdit={canEdit} me={user.full_name || user.email} customerNames={customerNames}
          onClose={() => setOpenId(null)} onSaved={async () => { setOpenId(null); await load(); }} />
      )}
    </div>
  );
}

interface DraftLine {
  key: string;
  id: string | null;
  item_id: string;
  item_name: string;
  qty: string;
  from_stock: boolean;
  po_id: string;
  po_no: string;
  notes: string;
  warranty: string;
}

interface OrderModalProps {
  quote: OrderQuote;
  lines: OrderLine[];
  items: ItemRef[];
  pos: PORef[];
  lineState: (l: Pick<OrderLine, 'from_stock' | 'po_id' | 'po_no' | 'item_id'>) => LineState;
  canEdit: boolean;
  me: string;
  customerNames: Map<string, string>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function OrderModal({ quote, lines, items, pos, lineState, canEdit, me, customerNames, onClose, onSaved }: OrderModalProps) {
  const toDraft = (l: OrderLine): DraftLine => ({
    key: l.id, id: l.id, item_id: l.item_id ?? '', item_name: l.item_name, qty: String(l.qty), from_stock: l.from_stock,
    po_id: l.po_id ?? '', po_no: l.po_id ? '' : (l.po_no ?? ''), notes: l.notes ?? '',
    warranty: l.warranty_years == null ? '' : String(l.warranty_years),
  });
  const blank = (): DraftLine => ({ key: crypto.randomUUID(), id: null, item_id: '', item_name: '', qty: '1', from_stock: false, po_id: '', po_no: '', notes: '', warranty: '' });
  const [draft, setDraft] = useState<DraftLine[]>(() => (lines.length ? lines.map(toDraft) : canEdit ? [blank()] : []));
  const [allItems, setAllItems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ro = !canEdit;

  const setLine = (key: string, patch: Partial<DraftLine>) => setDraft((d) => d.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const itemOptions = (cur: DraftLine): SelectOption[] => {
    const pool = items.filter((i) => i.active && (allItems || (i.category ?? '').toLowerCase() === 'charger'));
    const opts: SelectOption[] = pool.map((i) => ({ value: i.id, label: i.name, sub: allItems ? i.category ?? undefined : undefined }));
    if (cur.item_id && !pool.some((i) => i.id === cur.item_id)) opts.unshift({ value: cur.item_id, label: cur.item_name });
    if (!cur.item_id && cur.item_name) opts.unshift({ value: `name:${cur.item_name}`, label: cur.item_name, sub: 'Not in Stock Levels' });
    return opts;
  };
  // POs for this order's customer first, then ones carrying this charger.
  const poCustomer = (p: PORef) => (p.customer_id && customerNames.get(p.customer_id)) || p.customer_name || null;
  const poOptions = (cur: DraftLine): SelectOption[] => {
    const has = (p: PORef) => !!cur.item_id && (p.lines ?? []).some((x) => x.product_id === cur.item_id);
    const mine = (p: PORef) => !!quote.customer_id && p.customer_id === quote.customer_id;
    const sorted = [...pos].sort((a, b) => Number(mine(b)) - Number(mine(a)) || Number(has(b)) - Number(has(a)));
    const opts: SelectOption[] = [
      { value: '', label: 'PO not raised yet' },
      ...sorted.map((p) => ({
        value: p.id,
        label: `${p.po_number} · ${p.title || 'Untitled PO'}`,
        sub: [poCustomer(p) ? `For ${poCustomer(p)}${mine(p) ? ' (this customer)' : ''}` : 'No customer', has(p) ? 'Has this charger' : '', p.supplier, PO_STATUS_LABEL[p.status]].filter(Boolean).join(' · '),
      })),
    ];
    if (cur.po_no) opts.splice(1, 0, { value: `no:${cur.po_no}`, label: cur.po_no, sub: 'PO number not in Raise PO' });
    return opts;
  };

  const save = async () => {
    for (const [i, l] of draft.entries()) {
      const n = Number(l.qty);
      if (!l.item_name.trim()) { setErr(`Line ${i + 1}: pick the charger.`); return; }
      if (!Number.isInteger(n) || n <= 0) { setErr(`Line ${i + 1}: quantity must be a whole number above zero.`); return; }
      const w = l.warranty.trim() === '' ? null : Number(l.warranty);
      if (w != null && (!Number.isFinite(w) || w < 0 || w > 20)) { setErr(`Line ${i + 1}: warranty is in years, between 0 and 20.`); return; }
    }
    setBusy(true);
    setErr(null);
    const errors: string[] = [];
    const kept = new Set(draft.map((l) => l.id).filter(Boolean));
    const gone = lines.filter((l) => !kept.has(l.id)).map((l) => l.id);
    if (gone.length) {
      const { error } = await supabase.from('sales_order_lines').delete().in('id', gone);
      if (error) errors.push(error.message);
    }
    const now = new Date().toISOString();
    for (const [i, l] of draft.entries()) {
      const po = l.po_id ? pos.find((p) => p.id === l.po_id) : undefined;
      const row = {
        item_id: l.item_id || null, item_name: l.item_name.trim(), qty: Number(l.qty), from_stock: l.from_stock,
        po_id: l.from_stock ? null : po?.id ?? null,
        po_no: l.from_stock ? null : po?.po_number ?? (l.po_no.trim() || null),
        notes: l.notes.trim() || null, position: i, updated_at: now,
        warranty_years: l.warranty.trim() === '' ? null : Number(l.warranty),
      };
      const { error } = l.id
        ? await supabase.from('sales_order_lines').update(row).eq('id', l.id)
        : await supabase.from('sales_order_lines').insert({ ...row, quote_id: quote.id, created_by: me });
      if (error) errors.push(error.message);
    }
    setBusy(false);
    if (errors.length) { setErr(errors[0]); return; }
    await onSaved();
  };

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const input: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };
  const total = draft.reduce((n, l) => n + (Number(l.qty) || 0), 0);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 760, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{quote.ref} · {quote.customer_name}</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
              {quote.salesperson_name} · won {fmtDate(wonDate(quote))} · {fmtMoney(quote.total || 0)}{quote.won_stage ? ` · ${WON_STAGE_LABELS[quote.won_stage]}` : ''}
            </div>
          </div>
          <button onClick={onClose} disabled={busy} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>
          List the chargers this order has to supply. Link each to its Raise PO (or a PO number raised outside the app), or mark it as coming from stock — anything else counts as a pending purchase.
        </div>

        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Chargers · {total} unit{total === 1 ? '' : 's'}</span>
            {!ro && (
              <button type="button" onClick={() => setAllItems(!allItems)}
                style={{ marginLeft: 'auto', border: 'none', background: 'none', padding: 0, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {allItems ? 'Chargers only' : 'Show all Stock Levels items'}
              </button>
            )}
          </div>
          {draft.length === 0 && <div style={{ fontSize: 13, color: C.slate, padding: '8px 0' }}>No chargers listed for this order.</div>}
          {draft.map((l, i) => {
            const st = LINE_META[lineState({ from_stock: l.from_stock, po_id: l.po_id || null, po_no: l.po_no || null, item_id: l.item_id || null })];
            return (
              <div key={l.key} style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>Line {i + 1}</span>
                  {l.item_name && <Pill bg={st.bg} color={st.color}>{st.label}</Pill>}
                  {!ro && (
                    <button type="button" onClick={() => setDraft((d) => d.filter((x) => x.key !== l.key))} title="Remove this line"
                      style={{ marginLeft: 'auto', width: 26, height: 26, borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                      <X size={13} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px 130px', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <label style={label}>Charger</label>
                    <SearchSelect value={l.item_id || (l.item_name ? `name:${l.item_name}` : '')} options={itemOptions(l)} disabled={ro}
                      placeholder="Pick the charger" emptyText="No items match"
                      onChange={(v) => { const it = items.find((x) => x.id === v); if (it) setLine(l.key, { item_id: it.id, item_name: it.name }); }}
                      addNewLabel="Use a charger not in Stock Levels" onAddNew={(q) => { if (q.trim()) setLine(l.key, { item_id: '', item_name: q.trim() }); }} />
                  </div>
                  <div>
                    <label style={label}>Qty</label>
                    <input type="number" min={1} step={1} value={l.qty} disabled={ro} onChange={(e) => setLine(l.key, { qty: e.target.value })} style={input} />
                  </div>
                  <div>
                    <label style={label}>Warranty (years)</label>
                    <input type="number" min={0} max={20} step={0.5} value={l.warranty} disabled={ro} placeholder="Not set" onChange={(e) => setLine(l.key, { warranty: e.target.value })} style={input} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, auto) 1fr', gap: 12, alignItems: 'end' }}>
                  <div>
                    <label style={label}>Supply</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {([[false, 'Purchase'], [true, 'From stock']] as const).map(([v, t]) => (
                        <button key={t} type="button" disabled={ro} onClick={() => setLine(l.key, { from_stock: v })}
                          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: l.from_stock === v ? 'none' : '1px solid #EBEBEB', background: l.from_stock === v ? C.green : C.white, color: l.from_stock === v ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: ro ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  {!l.from_stock && (
                    <div style={{ minWidth: 0 }}>
                      <label style={label}>Purchase order</label>
                      <SearchSelect value={l.po_id || (l.po_no ? `no:${l.po_no}` : '')} options={poOptions(l)} disabled={ro}
                        placeholder="PO not raised yet" emptyText="No POs match"
                        onChange={(v) => setLine(l.key, v.startsWith('no:') ? { po_id: '', po_no: v.slice(3) } : { po_id: v, po_no: '' })}
                        addNewLabel="Use a PO number not in Raise PO" onAddNew={(q) => { if (q.trim()) setLine(l.key, { po_id: '', po_no: q.trim().toUpperCase() }); }} />
                    </div>
                  )}
                </div>
                <input value={l.notes} disabled={ro} onChange={(e) => setLine(l.key, { notes: e.target.value })} placeholder="Notes (optional) — e.g. deliver with installation on 12 Dec" style={input} />
              </div>
            );
          })}
          {!ro && (
            <button type="button" onClick={() => setDraft((d) => [...d, blank()])}
              style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 10, border: `1px dashed ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={13} strokeWidth={2.5} /> Add a charger
            </button>
          )}
        </div>

        {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}
            style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Close</button>
          {!ro && (
            <button onClick={() => void save()} disabled={busy}
              style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: busy ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
