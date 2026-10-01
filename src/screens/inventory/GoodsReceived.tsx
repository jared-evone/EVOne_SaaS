import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { KPICard } from '../../components/KPICard';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../permissions';
import { Plus, Download, PackageCheck } from 'lucide-react';
import {
  useInvCore, itemLabel, fmtD, todayISO,
  Pill, Field, ErrorBanner, Modal, ItemSelect, LocationSelect, SearchBox, downloadCsv,
  inputStyle, primaryBtn, ghostBtn, pillBtn, thStyle, tdStyle,
  type InvItem, type InvGrn, type InvLocation, type OnHand,
} from './invShared';

type Filter = 'all' | 'pending' | 'received' | 'variance';

export function ScreenInvGrn() {
  const { can, user } = usePermissions();
  const canEdit = can('inv_grn', 'can_edit');
  const me = user.full_name || user.email;
  const { items, locations, onHand, error: coreErr, reload: reloadCore } = useInvCore();

  const [rows, setRows] = useState<InvGrn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const { data, error: e } = await supabase.from('inv_grn').select('*')
      .order('received_on', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false });
    if (e) setError(e.message);
    setRows((data as InvGrn[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const refresh = async () => { await Promise.all([load(), reloadCore()]); };

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [completing, setCompleting] = useState<InvGrn | null>(null);
  const [recording, setRecording] = useState(false);
  const [viewing, setViewing] = useState<InvGrn | null>(null);

  const variance = (g: InvGrn) => (g.status === 'received' && g.qty_ordered != null && g.qty_received != null ? g.qty_received - g.qty_ordered : 0);
  const locName = (id: string | null) => locations.find((l) => l.id === id)?.name ?? '—';
  const month = todayISO().slice(0, 7);

  const visible = rows.filter((g) => {
    if (filter === 'pending' && g.status !== 'pending') return false;
    if (filter === 'received' && g.status !== 'received') return false;
    if (filter === 'variance' && variance(g) === 0) return false;
    const q = search.trim().toLowerCase();
    return !q || [g.po_no, g.supplier, g.item_name, g.notes, g.condition].join(' ').toLowerCase().includes(q);
  });

  const thisMonth = rows.filter((g) => g.status === 'received' && (g.received_on ?? '').startsWith(month));

  const exportCsv = () => {
    downloadCsv(`goods_received_${todayISO()}.csv`, [
      ['PO Number', 'Date Received', 'Supplier', 'Item Name', 'Qty Ordered', 'Qty Received', 'In Transit', 'Target Location', 'Qty Variance', 'Condition', 'Notes'],
      ...visible.map((g) => [g.po_no, g.received_on, g.supplier, g.item_name, g.qty_ordered, g.qty_received,
        g.status === 'pending' ? (g.qty_ordered ?? 0) - (g.qty_received ?? 0) : 0, locName(g.location_id), variance(g), g.condition, g.notes]),
    ]);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading receipts…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ErrorBanner text={error ?? coreErr} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <KPICard accent label="Received this month" value={thisMonth.reduce((n, g) => n + (g.qty_received ?? 0), 0).toLocaleString()} sub={`${thisMonth.length} receipt line${thisMonth.length === 1 ? '' : 's'}`} />
        <KPICard label="Awaiting receipt" value={rows.filter((g) => g.status === 'pending').length} sub="Logged as in transit" />
        <KPICard label="With variance" value={rows.filter((g) => variance(g) !== 0).length} sub="Received ≠ ordered" />
        <KPICard label="Total receipts" value={rows.filter((g) => g.status === 'received').length} sub={`${rows.filter((g) => g.legacy).length} migrated from Excel`} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search PO, item, supplier…" />
        {([['all', 'All'], ['pending', 'Awaiting receipt'], ['received', 'Received'], ['variance', 'With variance']] as const).map(([id, l]) => (
          <button key={id} onClick={() => setFilter(id)} style={pillBtn(filter === id)}>{l}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={13} /> Export</button>
          {canEdit && <button onClick={() => setRecording(true)} style={{ ...primaryBtn(), display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> Record receipt</button>}
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.slate, marginTop: -8 }}>
        Receipts against a tracked shipment are recorded from <b>Incoming Shipments → Receive into stock</b>; use <b>Record receipt</b> for goods that arrive without one.
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
            <thead>
              <tr>{['Date received', 'PO', 'Supplier', 'Item', 'Ordered', 'Received', 'Variance', 'Location', 'Condition', ''].map((h, i) => (
                <th key={i} style={{ ...thStyle, textAlign: ['Ordered', 'Received', 'Variance'].includes(h) ? 'right' : 'left' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {visible.map((g) => {
                const v = variance(g);
                const pending = g.status === 'pending';
                return (
                  <tr key={g.id} onClick={() => setViewing(g)} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer', background: pending ? '#FFFCF2' : 'transparent' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = pending ? '#FFFCF2' : 'transparent'; }}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: C.slate }}>{pending ? <Pill bg="#FFF8E1" color="#B07D00">In transit</Pill> : fmtD(g.received_on)}</td>
                    <td style={{ ...tdStyle, color: C.slate, whiteSpace: 'nowrap' }}>{g.po_no || '—'}</td>
                    <td style={tdStyle}>{g.supplier || '—'}</td>
                    <td style={tdStyle}>
                      {g.item_name}
                      {!g.item_id && <div style={{ fontSize: 10, fontWeight: 700, color: '#B07D00', marginTop: 2 }}>NOT IN ITEM LIST</div>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{g.qty_ordered ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: C.green }}>{g.qty_received ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: v < 0 ? '#C0321A' : v > 0 ? '#B07D00' : '#C7CDD3' }}>{v === 0 ? '—' : v > 0 ? `+${v}` : v}</td>
                    <td style={{ ...tdStyle, color: C.slate }}>{locName(g.location_id)}</td>
                    <td style={{ ...tdStyle, color: C.slate }}>{g.condition || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      {pending && canEdit
                        ? <button onClick={() => setCompleting(g)} style={{ ...primaryBtn(), padding: '6px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}><PackageCheck size={13} /> Receive</button>
                        : g.legacy && !g.posted && g.status === 'received'
                          ? <span title="Migrated from Excel — already counted in the opening stock" style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>History</span>
                          : null}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={10} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No receipts here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {viewing && (
        <Modal title={viewing.item_name} subtitle={viewing.po_no ? `PO ${viewing.po_no}` : 'Goods received'} onClose={() => setViewing(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
            {([
              ['Status', viewing.status === 'pending' ? 'In transit (awaiting receipt)' : 'Received'],
              ['Date received', fmtD(viewing.received_on)],
              ['Supplier', viewing.supplier || '—'],
              ['Location', locName(viewing.location_id)],
              ['Qty ordered', viewing.qty_ordered ?? '—'],
              ['Qty received', viewing.qty_received ?? '—'],
              ['Condition', viewing.condition || '—'],
              ['Recorded by', viewing.created_by || '—'],
              ['Counted into stock', viewing.posted ? 'Yes' : viewing.legacy ? 'Already in the Excel opening balance' : 'No'],
            ] as [string, string | number][]).map(([k, v]) => (
              <div key={k}><div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div><div style={{ marginTop: 2 }}>{v}</div></div>
            ))}
          </div>
          {viewing.notes && <div style={{ background: C.seasalt, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#1a1a1a', lineHeight: 1.5 }}>{viewing.notes}</div>}
        </Modal>
      )}
      {completing && (
        <CompleteModal grn={completing} items={items} locations={locations} onHand={onHand} me={me}
          onClose={() => setCompleting(null)} onDone={async () => { setCompleting(null); await refresh(); }} />
      )}
      {recording && (
        <RecordModal items={items} locations={locations} onHand={onHand} me={me}
          onClose={() => setRecording(false)} onDone={async () => { setRecording(false); await refresh(); }} />
      )}
    </div>
  );
}

function CompleteModal({ grn, items, locations, onHand, me, onClose, onDone }: {
  grn: InvGrn; items: InvItem[]; locations: InvLocation[]; onHand: OnHand; me: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [qty, setQty] = useState(String(grn.qty_ordered ?? ''));
  const [loc, setLoc] = useState(locations.find((l) => l.usable)?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [condition, setCondition] = useState('Good');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const item = items.find((i) => i.id === grn.item_id);

  const go = async () => {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 0) { setErr('Enter the quantity received.'); return; }
    if (!loc) { setErr('Pick the location.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('inv_complete_grn', { p_grn: grn.id, p_qty: n, p_location: loc, p_date: date, p_condition: condition.trim() || null, p_by: me });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onDone();
  };

  return (
    <Modal title={`Receive ${item ? itemLabel(item, items) : grn.item_name}`} subtitle={`${grn.qty_ordered ?? '?'} expected${grn.po_no ? ` · PO ${grn.po_no}` : ''}`} onClose={onClose}
      footer={<><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={() => void go()} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Receiving…' : 'Confirm receipt'}</button></>}>
      <ErrorBanner text={err} />
      {grn.notes && <div style={{ fontSize: 12, color: C.slate }}>{grn.notes}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <Field label="Qty received"><input type="number" min="0" step="1" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} /></Field>
        <Field label="Into location"><LocationSelect locations={locations} value={loc} onChange={setLoc} itemId={grn.item_id} onHand={onHand} /></Field>
        <Field label="Date received"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="Condition"><input value={condition} onChange={(e) => setCondition(e.target.value)} style={inputStyle} /></Field>
      </div>
      <div style={{ fontSize: 11, color: C.slate }}>Adds the received quantity to stock at the chosen location.</div>
    </Modal>
  );
}

function RecordModal({ items, locations, onHand, me, onClose, onDone }: {
  items: InvItem[]; locations: InvLocation[]; onHand: OnHand; me: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [f, setF] = useState({ item_id: '', supplier: '', po_no: '', qty_ordered: '', qty_received: '', location: locations.find((l) => l.usable)?.id ?? '', date: todayISO(), condition: 'Good', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    const rec = Number(f.qty_received);
    const ord = f.qty_ordered.trim() === '' ? null : Number(f.qty_ordered);
    if (!f.item_id) { setErr('Pick the item received.'); return; }
    if (!Number.isInteger(rec) || rec <= 0) { setErr('Enter the quantity received.'); return; }
    if (!f.location) { setErr('Pick the location.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('inv_record_grn', {
      p_item: f.item_id, p_supplier: f.supplier.trim() || null, p_po: f.po_no.trim() || null, p_qty_ordered: ord ?? rec, p_qty_received: rec,
      p_location: f.location, p_date: f.date, p_condition: f.condition.trim() || null, p_note: f.note.trim() || null, p_by: me,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onDone();
  };

  return (
    <Modal title="Record goods received" subtitle="For goods that arrive without a tracked shipment" width={600} onClose={onClose}
      footer={<><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={() => void go()} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Saving…' : 'Record & add to stock'}</button></>}>
      <ErrorBanner text={err} />
      <Field label="Item"><ItemSelect items={items} value={f.item_id} onChange={(v) => setF({ ...f, item_id: v })} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <Field label="Supplier"><input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} style={inputStyle} /></Field>
        <Field label="PO number"><input value={f.po_no} onChange={(e) => setF({ ...f, po_no: e.target.value })} style={inputStyle} /></Field>
        <Field label="Qty ordered"><input type="number" min="0" step="1" value={f.qty_ordered} onChange={(e) => setF({ ...f, qty_ordered: e.target.value })} placeholder="Same as received" style={inputStyle} /></Field>
        <Field label="Qty received"><input type="number" min="1" step="1" value={f.qty_received} onChange={(e) => setF({ ...f, qty_received: e.target.value })} style={inputStyle} /></Field>
        <Field label="Into location"><LocationSelect locations={locations} value={f.location} onChange={(v) => setF({ ...f, location: v })} itemId={f.item_id || null} onHand={onHand} /></Field>
        <Field label="Date received"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
        <Field label="Condition"><input value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} style={inputStyle} /></Field>
        <Field label="Note"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={inputStyle} /></Field>
      </div>
    </Modal>
  );
}
