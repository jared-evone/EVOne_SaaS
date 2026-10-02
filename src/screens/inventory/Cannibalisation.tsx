import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { KPICard } from '../../components/KPICard';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../permissions';
import { Plus, Download, Wrench } from 'lucide-react';
import {
  useInvCore, itemLabel, fmtD, todayISO,
  Pill, Field, ErrorBanner, Modal, ItemSelect, LocationSelect, SearchBox, downloadCsv,
  inputStyle, primaryBtn, ghostBtn, pillBtn, thStyle, tdStyle,
  type InvItem, type InvCannibal, type InvLocation, type OnHand, type InvShipment,
} from './invShared';

const CB_META: Record<InvCannibal['status'], { label: string; bg: string; color: string }> = {
  awaiting:    { label: 'Awaiting replacement', bg: '#FFF0E0', color: '#B45309' },
  replenished: { label: 'Replenished',          bg: '#E4F3E3', color: '#1B512D' },
  written_off: { label: 'Written off',          bg: '#F3F3F3', color: '#767B77' },
};

const daysSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86400000));

export function ScreenInvCannibal() {
  const { can, user } = usePermissions();
  const canEdit = can('inv_cannibal', 'can_edit');
  const me = user.full_name || user.email;
  const { items, locations, onHand, error: coreErr, reload: reloadCore } = useInvCore();

  const [rows, setRows] = useState<InvCannibal[]>([]);
  const [openShips, setOpenShips] = useState<InvShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const [{ data, error: e }, { data: sh }] = await Promise.all([
      supabase.from('inv_cannibalisations').select('*').order('taken_on', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('inv_shipments').select('*').in('status', ['ordered', 'in_transit', 'partial']),
    ]);
    if (e) setError(e.message);
    setRows((data as InvCannibal[]) ?? []);
    setOpenShips((sh as InvShipment[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const refresh = async () => { await Promise.all([load(), reloadCore()]); };

  const [filter, setFilter] = useState<'awaiting' | 'closed' | 'all'>('awaiting');
  const [search, setSearch] = useState('');
  const [logging, setLogging] = useState(false);
  const [closing, setClosing] = useState<InvCannibal | null>(null);

  const visible = rows.filter((r) => {
    if (filter === 'awaiting' && r.status !== 'awaiting') return false;
    if (filter === 'closed' && r.status === 'awaiting') return false;
    const q = search.trim().toLowerCase();
    return !q || [r.cb_no, r.part_name, r.used_for, r.charger_ref, r.reason, r.donor_note, itemLabel(items.find((i) => i.id === r.donor_item_id), items)].join(' ').toLowerCase().includes(q);
  });

  const awaiting = rows.filter((r) => r.status === 'awaiting');
  const month = todayISO().slice(0, 7);
  const replacementFor = (r: InvCannibal) => (r.part_item_id ? openShips.filter((s) => s.item_id === r.part_item_id) : []);

  const exportCsv = () => {
    downloadCsv(`cannibalisation_${todayISO()}.csv`, [
      ['Ref', 'Date taken', 'Part', 'Qty', 'Taken from', 'Donor', 'Used for', 'Charger fixed', 'Reason', 'Status', 'Closed on', 'Close note'],
      ...visible.map((r) => [r.cb_no, r.taken_on, r.part_name, r.qty,
        r.source === 'stock' ? `Stock — ${locations.find((l) => l.id === r.source_location_id)?.name ?? ''}` : 'Charger in stock',
        r.source === 'charger' ? [itemLabel(items.find((i) => i.id === r.donor_item_id), items), r.donor_note].filter(Boolean).join(' · ') : '',
        r.used_for, r.charger_ref, r.reason, CB_META[r.status].label, r.replenished_on, r.replenish_note]),
    ]);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ErrorBanner text={error ?? coreErr} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <KPICard accent label="Awaiting replacement" value={awaiting.length} sub={awaiting.length ? `Oldest ${Math.max(...awaiting.map((r) => daysSince(r.taken_on)))} days` : 'Nothing outstanding'} />
        <KPICard label="Incomplete chargers" value={awaiting.filter((r) => r.source === 'charger').length} sub="Units in stock with a part taken out" />
        <KPICard label="Replacement on order" value={awaiting.filter((r) => replacementFor(r).length > 0).length} sub="Open shipment exists for the part" />
        <KPICard label="Logged this month" value={rows.filter((r) => r.taken_on.startsWith(month)).length} sub={`${rows.length} all-time`} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search part, charger, site…" />
        {([['awaiting', 'Awaiting replacement'], ['closed', 'Closed'], ['all', 'All']] as const).map(([id, l]) => (
          <button key={id} onClick={() => setFilter(id)} style={pillBtn(filter === id)}>{l}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={13} /> Export</button>
          {canEdit && <button onClick={() => setLogging(true)} style={{ ...primaryBtn(), display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> Log cannibalisation</button>}
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead>
              <tr>{['Ref', 'Part taken', 'Taken from', 'Used to fix', 'Replacement', 'Status', ''].map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const meta = CB_META[r.status];
                const reps = replacementFor(r);
                const donor = items.find((i) => i.id === r.donor_item_id);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #F3F3F3' }}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 700, color: C.green }}>{r.cb_no}</div>
                      <div style={{ fontSize: 11, color: C.slate }}>{fmtD(r.taken_on)}{r.created_by ? ` · ${r.created_by}` : ''}</div>
                    </td>
                    <td style={tdStyle}>
                      <b>{r.qty} ×</b> {r.part_name}
                      {r.reason && <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{r.reason}</div>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12.5 }}>
                      {r.source === 'stock'
                        ? <>Spare stock<div style={{ fontSize: 11, color: C.slate }}>{locations.find((l) => l.id === r.source_location_id)?.name ?? '—'}</div></>
                        : <>Stripped from {donor ? itemLabel(donor, items) : 'a charger'}<div style={{ fontSize: 11, color: '#B45309', fontWeight: 600 }}>{r.donor_note || 'Unit now incomplete'}</div></>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12.5 }}>
                      {r.charger_ref || '—'}
                      {r.used_for && <div style={{ fontSize: 11, color: C.slate }}>{r.used_for}</div>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>
                      {r.status !== 'awaiting'
                        ? <span style={{ color: C.slate }}>{fmtD(r.replenished_on)}{r.replenish_note ? ` · ${r.replenish_note}` : ''}</span>
                        : reps.length
                          ? reps.map((s) => <div key={s.id} style={{ color: C.opal, fontWeight: 600 }}>{s.po_no || 'Shipment'} · {s.eta ? `ETA ${fmtD(s.eta)}` : s.eta_note || 'no ETA'}</div>)
                          : <span style={{ color: '#C0321A', fontWeight: 600 }}>Nothing on order</span>}
                    </td>
                    <td style={tdStyle}>
                      <Pill bg={meta.bg} color={meta.color}>{meta.label}</Pill>
                      {r.status === 'awaiting' && <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>{daysSince(r.taken_on)} days</div>}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {canEdit && r.status === 'awaiting' && <button onClick={() => setClosing(r)} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }}>Close</button>}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  <Wrench size={28} strokeWidth={1.5} style={{ display: 'block', margin: '0 auto 8px' }} />
                  {filter === 'awaiting' ? 'No parts waiting on a replacement.' : 'Nothing here yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {logging && <LogModal items={items} locations={locations} onHand={onHand} me={me} onClose={() => setLogging(false)} onDone={async () => { setLogging(false); await refresh(); }} />}
      {closing && <CloseModal rec={closing} items={items} locations={locations} onHand={onHand} me={me} onClose={() => setClosing(null)} onDone={async () => { setClosing(null); await refresh(); }} />}
    </div>
  );
}

function LogModal({ items, locations, onHand, me, onClose, onDone }: {
  items: InvItem[]; locations: InvLocation[]; onHand: OnHand; me: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [source, setSource] = useState<'stock' | 'charger'>('stock');
  const [f, setF] = useState({ part: '', partName: '', qty: '1', location: locations.find((l) => l.usable)?.id ?? '', donor: '', donorNote: '', usedFor: '', chargerRef: '', reason: '', date: todayISO() });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    const qty = Number(f.qty);
    if (!f.part && !f.partName.trim()) { setErr('Pick the part, or describe it.'); return; }
    if (!Number.isInteger(qty) || qty <= 0) { setErr('Quantity must be a whole number above zero.'); return; }
    if (source === 'stock' && (!f.part || !f.location)) { setErr('Taking from spare stock needs the item and the location.'); return; }
    if (source === 'charger' && !f.donor) { setErr('Pick the charger the part was taken from.'); return; }
    if (!f.chargerRef.trim()) { setErr('Say which charger the part was used to fix.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('inv_cannibalise', {
      p_part: f.part || null, p_part_name: f.partName.trim() || null, p_qty: qty, p_source: source,
      p_location: source === 'stock' ? f.location : null,
      p_donor_item: source === 'charger' ? f.donor : null, p_donor_note: f.donorNote.trim() || null,
      p_used_for: f.usedFor.trim() || null, p_charger_ref: f.chargerRef.trim(), p_reason: f.reason.trim() || null, p_date: f.date, p_by: me,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onDone();
  };

  return (
    <Modal title="Log cannibalisation" subtitle="A part taken to fix a charger, tracked until its replacement arrives" width={640} onClose={onClose}
      footer={<><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={() => void go()} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Saving…' : 'Log it'}</button></>}>
      <ErrorBanner text={err} />
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Where did the part come from?</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {([['stock', 'Spare-parts stock', 'Takes the part out of stock now'], ['charger', 'A charger in stock', 'The charger stays in stock but is marked incomplete']] as const).map(([k, t, d]) => (
            <button key={k} type="button" onClick={() => setSource(k)}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: `1.5px solid ${source === k ? C.green : '#EBEBEB'}`, background: source === k ? C.honeydew : C.white, cursor: 'pointer', fontFamily: 'Figtree' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: source === k ? C.green : '#1a1a1a' }}>{t}</div>
              <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{d}</div>
            </button>
          ))}
        </div>
      </div>
      <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12 }}>
          <Field label="Part taken"><ItemSelect items={items} value={f.part} onChange={(v) => setF({ ...f, part: v })} allowNone={source !== 'stock'} noneLabel={source === 'stock' ? 'Select item' : 'Not in item list'} /></Field>
          <Field label="Qty"><input type="number" min="1" step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} style={inputStyle} /></Field>
        </div>
        {!f.part && source === 'charger' && (
          <Field label="Describe the part"><input value={f.partName} onChange={(e) => setF({ ...f, partName: e.target.value })} placeholder="e.g. Control board, contactor, screen" style={inputStyle} /></Field>
        )}
        {source === 'stock' ? (
          <Field label="Taken from"><LocationSelect locations={locations} value={f.location} onChange={(v) => setF({ ...f, location: v })} itemId={f.part || null} onHand={onHand} /></Field>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Charger stripped"><ItemSelect items={items.filter((i) => (i.category ?? '').toLowerCase() === 'charger')} value={f.donor} onChange={(v) => setF({ ...f, donor: v })} /></Field>
            <Field label="Which unit"><input value={f.donorNote} onChange={(e) => setF({ ...f, donorNote: e.target.value })} placeholder="Serial / box no. / Toh Guan shelf" style={inputStyle} /></Field>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Charger fixed"><input value={f.chargerRef} onChange={(e) => setF({ ...f, chargerRef: e.target.value })} placeholder="e.g. Charger 6 / serial S33822" style={inputStyle} /></Field>
        <Field label="Customer / site"><input value={f.usedFor} onChange={(e) => setF({ ...f, usedFor: e.target.value })} placeholder="e.g. Tower Transit Bulim" style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12 }}>
        <Field label="Reason"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Breakdown — replacement not in stock" style={inputStyle} /></Field>
        <Field label="Date taken"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={inputStyle} /></Field>
      </div>
    </Modal>
  );
}

function CloseModal({ rec, items, locations, onHand, me, onClose, onDone }: {
  rec: InvCannibal; items: InvItem[]; locations: InvLocation[]; onHand: OnHand; me: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [status, setStatus] = useState<'replenished' | 'written_off'>('replenished');
  const [refit, setRefit] = useState(rec.source === 'charger' && !!rec.part_item_id);
  const [loc, setLoc] = useState(locations.find((l) => l.usable)?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const part = items.find((i) => i.id === rec.part_item_id);

  const go = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('inv_replenish_cannibalisation', {
      p_id: rec.id, p_status: status, p_refit_location: status === 'replenished' && refit ? loc : null, p_date: date, p_note: note.trim() || null, p_by: me,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onDone();
  };

  return (
    <Modal title={`Close ${rec.cb_no}`} subtitle={`${rec.qty} × ${rec.part_name}`} onClose={onClose}
      footer={<><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={() => void go()} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Saving…' : 'Close record'}</button></>}>
      <ErrorBanner text={err} />
      <div style={{ display: 'flex', gap: 8 }}>
        {([['replenished', 'Replacement arrived'], ['written_off', 'Write off']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} style={pillBtn(status === k)}>{l}</button>
        ))}
      </div>
      {status === 'replenished' && rec.source === 'stock' && (
        <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5 }}>
          The replacement comes back into stock when it is received (Incoming Shipments or Goods Received) — this just closes the record.
        </div>
      )}
      {status === 'replenished' && rec.source === 'charger' && (
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: part ? 'pointer' : 'default', color: part ? '#1a1a1a' : C.slate }}>
            <input type="checkbox" checked={refit} disabled={!part} onChange={(e) => setRefit(e.target.checked)} style={{ marginTop: 2, accentColor: C.green }} />
            <span>The replacement was received into stock — take it from stock to refit the stripped charger{!part && ' (link the part to an item to use this)'}</span>
          </label>
          {refit && part && <Field label="Take from"><LocationSelect locations={locations} value={loc} onChange={setLoc} itemId={part.id} onHand={onHand} /></Field>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12 }}>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={status === 'written_off' ? 'Why it will not be replaced' : 'e.g. Refitted 3 Oct, PO EV1PO-000250'} style={inputStyle} /></Field>
      </div>
    </Modal>
  );
}
