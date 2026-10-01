import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { supabase } from '../../lib/supabase';
import { Download, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useInvCore, itemLabel, fmtD, todayISO, MOVEMENT_LABELS, MOVEMENT_COLORS,
  Pill, ErrorBanner, ItemSelect, downloadCsv, SearchBox,
  inputStyle, ghostBtn, pillBtn, thStyle, tdStyle,
  type InvMovement, type MovementKind,
} from './invShared';

const PAGE = 50;
const KIND_FILTERS: ('all' | MovementKind)[] = ['all', 'receipt', 'issue', 'transfer_in', 'transfer_out', 'adjustment', 'spoilt', 'cannibalised', 'opening'];

export function ScreenInvLedger() {
  const { items, locations, error: coreErr } = useInvCore();
  const [rows, setRows] = useState<InvMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [itemId, setItemId] = useState('');
  const [locId, setLocId] = useState('');
  const [kind, setKind] = useState<'all' | MovementKind>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = (withCount: boolean) => {
    let q = supabase.from('inv_movements').select('*', withCount ? { count: 'exact' } : undefined)
      .order('moved_on', { ascending: false }).order('created_at', { ascending: false });
    if (itemId) q = q.eq('item_id', itemId);
    if (locId) q = q.eq('location_id', locId);
    if (kind !== 'all') q = q.eq('kind', kind);
    if (from) q = q.gte('moved_on', from);
    if (to) q = q.lte('moved_on', to);
    if (search.trim()) q = q.or(`note.ilike.%${search.trim().replace(/[%,()]/g, ' ')}%,created_by.ilike.%${search.trim().replace(/[%,()]/g, ' ')}%`);
    return q;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void query(true).range(page * PAGE, page * PAGE + PAGE - 1).then(({ data, count, error: e }) => {
      if (cancelled) return;
      if (e) setError(e.message);
      setRows((data as InvMovement[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [page, itemId, locId, kind, from, to, search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPage(0); }, [itemId, locId, kind, from, to, search]);

  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? '—';

  const exportCsv = async () => {
    const { data } = await query(false).limit(10000);
    downloadCsv(`stock_ledger_${todayISO()}.csv`, [
      ['Date', 'Item', 'Brand', 'Location', 'Movement', 'Qty', 'Note', 'By', 'Recorded at'],
      ...((data as InvMovement[]) ?? []).map((m) => {
        const it = items.find((i) => i.id === m.item_id);
        return [m.moved_on, it?.name ?? '', it?.brand ?? '', locName(m.location_id), MOVEMENT_LABELS[m.kind], m.qty, m.note, m.created_by, m.created_at];
      }),
    ]);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ErrorBanner text={error ?? coreErr} />
      <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5 }}>
        Every change to stock, newest first. Stock levels are the sum of these movements — nothing changes stock without leaving a line here.
      </div>
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ width: 280, maxWidth: '100%' }}><ItemSelect items={items} value={itemId} onChange={setItemId} allowNone noneLabel="All items" /></div>
        <select value={locId} onChange={(e) => setLocId(e.target.value)} style={{ ...inputStyle, width: 160, cursor: 'pointer' }}>
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From" style={{ ...inputStyle, width: 150 }} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To" style={{ ...inputStyle, width: 150 }} />
        <SearchBox value={search} onChange={setSearch} placeholder="Search note or person…" width={220} />
        <button onClick={() => void exportCsv()} style={{ ...ghostBtn, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={13} /> Export</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {KIND_FILTERS.map((k) => <button key={k} onClick={() => setKind(k)} style={pillBtn(kind === k)}>{k === 'all' ? 'All movements' : MOVEMENT_LABELS[k]}</button>)}
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>{['Date', 'Item', 'Location', 'Movement', 'Qty', 'Note', 'By'].map((h) => <th key={h} style={{ ...thStyle, textAlign: h === 'Qty' ? 'right' : 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} style={{ borderBottom: '1px solid #F3F3F3' }}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: C.slate }}>{fmtD(m.moved_on)}</td>
                  <td style={tdStyle}>{itemLabel(items.find((i) => i.id === m.item_id), items)}</td>
                  <td style={{ ...tdStyle, color: C.slate }}>{locName(m.location_id)}</td>
                  <td style={tdStyle}><Pill bg={MOVEMENT_COLORS[m.kind].bg} color={MOVEMENT_COLORS[m.kind].color}>{MOVEMENT_LABELS[m.kind]}</Pill></td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: m.qty > 0 ? C.green : '#C0321A' }}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                  <td style={{ ...tdStyle, color: C.slate, fontSize: 12, maxWidth: 360 }}>{m.note || '—'}</td>
                  <td style={{ ...tdStyle, color: C.slate, fontSize: 12, whiteSpace: 'nowrap' }}>{m.created_by || '—'}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No movements match.</td></tr>}
              {loading && <tr><td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid #F3F3F3', fontSize: 12, color: C.slate }}>
          <span>{total.toLocaleString()} movement{total === 1 ? '' : 's'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ ...ghostBtn, padding: '4px 8px', display: 'inline-flex' }}><ChevronLeft size={14} /></button>
            <span style={{ fontWeight: 700 }}>{page + 1} / {pages}</span>
            <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} style={{ ...ghostBtn, padding: '4px 8px', display: 'inline-flex' }}><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
