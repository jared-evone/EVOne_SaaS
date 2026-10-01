import { useEffect, useMemo, useState } from 'react';
import { C } from '../../theme';
import { KPICard } from '../../components/KPICard';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../permissions';
import { Download, Plus, Trash2, Archive, ArchiveRestore, Tags, Pencil, Check, X } from 'lucide-react';
import {
  useInvCore, qtyAt, usableTotal, itemLabel, fmtD, todayISO, MOVEMENT_LABELS, MOVEMENT_COLORS,
  Pill, Field, ErrorBanner, Modal, SearchBox, downloadCsv,
  inputStyle, primaryBtn, ghostBtn, pillBtn, thStyle, tdStyle,
  type InvItem, type InvLocation, type InvMovement, type OnHand,
} from './invShared';

type StockStatus = 'negative' | 'below' | 'out' | 'ok';

const STATUS_META: Record<StockStatus, { label: string; bg: string; color: string }> = {
  negative: { label: 'Negative — check records', bg: '#FDEAEA', color: '#C0321A' },
  below:    { label: 'Below reorder point',      bg: '#FFF8E1', color: '#B07D00' },
  out:      { label: 'Out of stock',             bg: '#F3F3F3', color: '#767B77' },
  ok:       { label: 'OK',                       bg: '#E4F3E3', color: '#1B512D' },
};

function statusOf(item: InvItem, onHand: OnHand, locations: InvLocation[]): StockStatus {
  const anyNegative = locations.some((l) => qtyAt(onHand, item.id, l.id) < 0);
  const total = usableTotal(onHand, item.id, locations);
  if (anyNegative || total < 0) return 'negative';
  if (item.reorder_point != null && total < item.reorder_point) return 'below';
  if (total === 0) return 'out';
  return 'ok';
}

// Admin-maintained pick-lists for Brand and Category. Items store the text.
interface LookupRow { id: string; name: string; sort_order: number; }
interface Lookups { brands: LookupRow[]; categories: LookupRow[]; }
type LookupKind = 'brand' | 'category';
const LOOKUP_TABLE: Record<LookupKind, string> = { brand: 'inv_brands', category: 'inv_categories' };

function useLookups() {
  const [lookups, setLookups] = useState<Lookups>({ brands: [], categories: [] });
  const reload = async () => {
    const [b, c] = await Promise.all([
      supabase.from('inv_brands').select('*').order('sort_order').order('name'),
      supabase.from('inv_categories').select('*').order('sort_order').order('name'),
    ]);
    setLookups({ brands: (b.data as LookupRow[]) ?? [], categories: (c.data as LookupRow[]) ?? [] });
  };
  useEffect(() => { void reload(); }, []);
  return { lookups, reloadLookups: reload };
}

export function ScreenInvStock() {
  const { can } = usePermissions();
  const canEdit = can('inv_stock', 'can_edit');
  const canDelete = can('inv_stock', 'can_delete');
  const { items, locations, onHand, loading, error, reload } = useInvCore();
  const { lookups, reloadLookups } = useLookups();

  // Open shipments → units still incoming per item; open cannibalisations from
  // chargers in stock → units that are currently incomplete.
  const [incoming, setIncoming] = useState<Map<string, number>>(new Map());
  const [incomplete, setIncomplete] = useState<Map<string, number>>(new Map());
  const loadSide = async () => {
    const [sh, gr, cb] = await Promise.all([
      supabase.from('inv_shipments').select('id, item_id, qty, status').in('status', ['ordered', 'in_transit', 'partial']),
      supabase.from('inv_grn').select('shipment_id, qty_received').eq('status', 'received').not('shipment_id', 'is', null),
      supabase.from('inv_cannibalisations').select('donor_item_id, qty').eq('status', 'awaiting').eq('source', 'charger'),
    ]);
    const got = new Map<string, number>();
    for (const g of (gr.data ?? []) as { shipment_id: string; qty_received: number | null }[]) got.set(g.shipment_id, (got.get(g.shipment_id) ?? 0) + (g.qty_received ?? 0));
    const inc = new Map<string, number>();
    for (const s of (sh.data ?? []) as { id: string; item_id: string | null; qty: number }[]) {
      if (!s.item_id) continue;
      inc.set(s.item_id, (inc.get(s.item_id) ?? 0) + Math.max(0, s.qty - (got.get(s.id) ?? 0)));
    }
    setIncoming(inc);
    const icm = new Map<string, number>();
    for (const c of (cb.data ?? []) as { donor_item_id: string | null; qty: number }[]) {
      if (c.donor_item_id) icm.set(c.donor_item_id, (icm.get(c.donor_item_id) ?? 0) + 1);
    }
    setIncomplete(icm);
  };
  useEffect(() => { void loadSide(); }, []);
  const refresh = async () => { await Promise.all([reload(), loadSide(), reloadLookups()]); };

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [attention, setAttention] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [managingLists, setManagingLists] = useState(false);

  const usable = locations.filter((l) => l.usable);
  const spoiltLoc = locations.find((l) => !l.usable) ?? null;
  const categories = useMemo(() => ['All', ...new Set([...lookups.categories.map((c) => c.name), ...items.map((i) => i.category || 'Uncategorised')])], [items, lookups]);

  const visible = items.filter((i) => {
    if (!showArchived && !i.active) return false;
    if (showArchived && i.active) return false;
    if (category !== 'All' && (i.category || 'Uncategorised') !== category) return false;
    if (attention) {
      const st = statusOf(i, onHand, locations);
      if (st !== 'negative' && st !== 'below') return false;
    }
    const q = search.trim().toLowerCase();
    return !q || `${i.name} ${i.brand ?? ''} ${i.category ?? ''}`.toLowerCase().includes(q);
  });

  const active = items.filter((i) => i.active);
  const kpiUnits = active.reduce((s, i) => s + Math.max(0, usableTotal(onHand, i.id, locations)), 0);
  const kpiBelow = active.filter((i) => statusOf(i, onHand, locations) === 'below').length;
  const kpiNegative = active.filter((i) => statusOf(i, onHand, locations) === 'negative').length;
  const kpiIncoming = [...incoming.values()].reduce((s, n) => s + n, 0);

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [[
      'Item Name', 'Brand', 'Category', ...usable.map((l) => `${l.name} (Now)`), 'Spoilt', 'Total (Now)', 'Incoming', 'Reorder Point', 'Reorder Qty', 'Price',
    ]];
    for (const i of visible) {
      rows.push([
        i.name, i.brand, i.category, ...usable.map((l) => qtyAt(onHand, i.id, l.id)),
        spoiltLoc ? qtyAt(onHand, i.id, spoiltLoc.id) : 0, usableTotal(onHand, i.id, locations),
        incoming.get(i.id) ?? 0, i.reorder_point, i.reorder_qty, i.unit_price,
      ]);
    }
    downloadCsv(`stock_levels_${todayISO()}.csv`, rows);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading stock…</div>;

  const open = openId ? items.find((i) => i.id === openId) ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ErrorBanner text={error} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <KPICard accent label="Units on hand" value={kpiUnits.toLocaleString()} sub={`${active.length} items · ${usable.map((l) => l.name).join(' + ')}`} />
        <KPICard label="Below reorder point" value={kpiBelow} sub="Total under its reorder point" />
        <KPICard label="Negative stock" value={kpiNegative} sub="Issued before a receipt was recorded" />
        <KPICard label="Incoming" value={kpiIncoming.toLocaleString()} sub="Units on open shipments" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search item, brand…" />
        {categories.map((c) => <button key={c} onClick={() => setCategory(c)} style={pillBtn(category === c)}>{c}</button>)}
        <button onClick={() => setAttention((v) => !v)}
          style={{ ...pillBtn(false), border: `1px solid ${attention ? '#B07D00' : '#EBEBEB'}`, background: attention ? '#FFF8E1' : C.white, color: attention ? '#B07D00' : C.slate }}>
          {attention ? '✓ ' : ''}Needs attention
        </button>
        <button onClick={() => setShowArchived((v) => !v)} style={pillBtn(showArchived)}>{showArchived ? '✓ ' : ''}Archived</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={13} /> Export</button>
          {canDelete && <button onClick={() => setManagingLists(true)} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Tags size={13} /> Brands &amp; categories</button>}
          {canEdit && <button onClick={() => setAdding(true)} style={{ ...primaryBtn(), display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> New item</button>}
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={thStyle}>Item</th>
                <th style={thStyle}>Category</th>
                {usable.map((l) => <th key={l.id} style={{ ...thStyle, textAlign: 'right' }}>{l.name}</th>)}
                <th style={{ ...thStyle, textAlign: 'right' }}>Spoilt</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Incoming</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Reorder pt / qty</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => {
                const total = usableTotal(onHand, i.id, locations);
                const st = statusOf(i, onHand, locations);
                const meta = STATUS_META[st];
                const inc = incoming.get(i.id) ?? 0;
                const icm = incomplete.get(i.id) ?? 0;
                return (
                  <tr key={i.id} onClick={() => setOpenId(i.id)} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700 }}>{i.name}</div>
                      <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{i.brand || '—'}</div>
                    </td>
                    <td style={{ ...tdStyle, color: C.slate, fontSize: 12 }}>{i.category || '—'}</td>
                    {usable.map((l) => {
                      const q = qtyAt(onHand, i.id, l.id);
                      return <td key={l.id} style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: q < 0 ? '#C0321A' : q === 0 ? '#C7CDD3' : '#1a1a1a' }}>{q}</td>;
                    })}
                    <td style={{ ...tdStyle, textAlign: 'right', color: spoiltLoc && qtyAt(onHand, i.id, spoiltLoc.id) ? '#C0321A' : '#C7CDD3' }}>
                      {spoiltLoc ? qtyAt(onHand, i.id, spoiltLoc.id) || '—' : '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: total < 0 ? '#C0321A' : C.green }}>
                      {total}
                      {icm > 0 && <div title="Units in stock with a part taken out (cannibalised)" style={{ fontSize: 10, fontWeight: 700, color: '#B45309' }}>{icm} incomplete</div>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: inc ? C.opal : '#C7CDD3', fontWeight: inc ? 700 : 400 }}>{inc ? `+${inc}` : '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: C.slate, whiteSpace: 'nowrap' }}>
                      {i.reorder_point ?? '—'} / {i.reorder_qty ?? '—'}
                    </td>
                    <td style={tdStyle}><Pill bg={meta.bg} color={meta.color}>{meta.label}</Pill></td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={7 + usable.length} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No items match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <ItemDrawer key={open.id} item={open} items={items} locations={locations} onHand={onHand} lookups={lookups} onLookupsChanged={reloadLookups}
          canEdit={canEdit} canDelete={canDelete} onClose={() => setOpenId(null)} onChanged={refresh} />
      )}
      {adding && (
        <ItemFormModal items={items} lookups={lookups} isAdmin={canDelete} onLookupsChanged={reloadLookups} onClose={() => setAdding(false)}
          onSaved={async (id) => { setAdding(false); await refresh(); setOpenId(id); }} />
      )}
      {managingLists && <ListsModal lookups={lookups} items={items} onClose={() => setManagingLists(false)} onChanged={refresh} />}
    </div>
  );
}

// ── Item detail: balances, actions, history ──────────────────────

function ItemDrawer({ item, items, locations, onHand, lookups, onLookupsChanged, canEdit, canDelete, onClose, onChanged }: {
  item: InvItem; items: InvItem[]; locations: InvLocation[]; onHand: OnHand;
  lookups: Lookups; onLookupsChanged: () => Promise<void>;
  canEdit: boolean; canDelete: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [history, setHistory] = useState<InvMovement[]>([]);
  const [action, setAction] = useState<null | 'edit'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadHistory = async () => {
    const { data } = await supabase.from('inv_movements').select('*').eq('item_id', item.id)
      .order('moved_on', { ascending: false }).order('created_at', { ascending: false }).limit(100);
    setHistory((data as InvMovement[]) ?? []);
  };
  useEffect(() => { void loadHistory(); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const after = async () => { setAction(null); await onChanged(); await loadHistory(); };
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? '—';

  const setActive = async (active: boolean) => {
    setBusy(true);
    const { error } = await supabase.from('inv_items').update({ active, updated_at: new Date().toISOString() }).eq('id', item.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onChanged();
    onClose();
  };

  return (
    <Modal title={itemLabel(item, items)} subtitle={[item.brand, item.category].filter(Boolean).join(' · ')} width={720} onClose={onClose}>
      <ErrorBanner text={err} />
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${locations.length + 1}, minmax(0, 1fr))`, gap: 10 }}>
        {locations.map((l) => {
          const q = qtyAt(onHand, item.id, l.id);
          return (
            <div key={l.id} style={{ background: C.seasalt, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l.name}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: q < 0 ? '#C0321A' : l.usable ? '#1a1a1a' : '#C0321A', marginTop: 4 }}>{q}</div>
            </div>
          );
        })}
        <div style={{ background: C.honeydew, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total usable</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.green, marginTop: 4 }}>{usableTotal(onHand, item.id, locations)}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.slate }}>
        Reorder point <b style={{ color: '#1a1a1a' }}>{item.reorder_point ?? '—'}</b> · reorder qty <b style={{ color: '#1a1a1a' }}>{item.reorder_qty ?? '—'}</b> · unit price <b style={{ color: '#1a1a1a' }}>{item.unit_price != null ? `$${Number(item.unit_price).toLocaleString()}` : '—'}</b>
        {item.notes && <div style={{ marginTop: 4 }}>{item.notes}</div>}
      </div>

      <div style={{ fontSize: 11.5, color: C.slate, background: C.seasalt, borderRadius: 10, padding: '8px 12px' }}>
        Stock only changes through <b>Incoming Shipments</b> (in) and <b>Requests &amp; Delivery</b> (out) — this view is for monitoring.
      </div>

      {canEdit && item.active && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setAction('edit')} style={ghostBtn}>Edit item</button>
          {canDelete && <button onClick={() => void setActive(false)} disabled={busy} style={{ ...ghostBtn, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Archive size={13} /> Archive</button>}
        </div>
      )}
      {canDelete && !item.active && (
        <button onClick={() => void setActive(true)} disabled={busy} style={{ ...ghostBtn, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArchiveRestore size={13} /> Restore item</button>
      )}

      {action === 'edit' && (
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16 }}>
          <ItemFields item={item} items={items} lookups={lookups} isAdmin={canDelete} onLookupsChanged={onLookupsChanged} onCancel={() => setAction(null)} onSaved={async () => { await after(); }} />
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Movement history</div>
        <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'hidden', maxHeight: 320, overflowY: 'auto' }}>
          {history.length === 0 && <div style={{ padding: 16, fontSize: 12, color: C.slate }}>No movements yet.</div>}
          {history.map((m, idx) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: idx ? '1px solid #F3F3F3' : 'none', fontSize: 12.5 }}>
              <span style={{ width: 86, color: C.slate, flexShrink: 0 }}>{fmtD(m.moved_on)}</span>
              <Pill bg={MOVEMENT_COLORS[m.kind].bg} color={MOVEMENT_COLORS[m.kind].color}>{MOVEMENT_LABELS[m.kind]}</Pill>
              <span style={{ color: C.slate, flexShrink: 0 }}>{locName(m.location_id)}</span>
              <span style={{ flex: 1, minWidth: 0, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.note ?? ''}>{m.note}</span>
              <span style={{ fontWeight: 700, color: m.qty > 0 ? C.green : '#C0321A', flexShrink: 0 }}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function ItemFields({ item, items, lookups, isAdmin, onLookupsChanged, onCancel, onSaved }: {
  item: InvItem | null; items: InvItem[]; lookups: Lookups; isAdmin: boolean; onLookupsChanged: () => Promise<void>;
  onCancel: () => void; onSaved: (id: string) => Promise<void>;
}) {
  const [f, setF] = useState({
    name: item?.name ?? '', brand: item?.brand ?? '', category: item?.category ?? '',
    reorder_point: item?.reorder_point != null ? String(item.reorder_point) : '',
    reorder_qty: item?.reorder_qty != null ? String(item.reorder_qty) : '',
    unit_price: item?.unit_price != null ? String(item.unit_price) : '',
    notes: item?.notes ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  const save = async () => {
    if (!f.name.trim()) { setErr('Item name is required.'); return; }
    if (!f.brand) { setErr('Pick a brand.'); return; }
    if (!f.category) { setErr('Pick a category.'); return; }
    setBusy(true);
    const payload = {
      name: f.name.trim(), brand: f.brand.trim() || null, category: f.category.trim() || null,
      reorder_point: num(f.reorder_point), reorder_qty: num(f.reorder_qty), unit_price: num(f.unit_price),
      notes: f.notes.trim() || null, updated_at: new Date().toISOString(),
    };
    const res = item
      ? await supabase.from('inv_items').update(payload).eq('id', item.id).select('id').single()
      : await supabase.from('inv_items').insert({ ...payload, sort_order: Math.max(0, ...items.map((i) => i.sort_order)) + 1 }).select('id').single();
    setBusy(false);
    if (res.error) { setErr(res.error.message.includes('duplicate') ? 'An item with this name and brand already exists.' : res.error.message); return; }
    await onSaved((res.data as { id: string }).id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ErrorBanner text={err} />
      <Field label="Item name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Hici AC - 7kW - Standard (5m)" style={inputStyle} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Brand">
          <LookupSelect kind="brand" value={f.brand} options={lookups.brands} isAdmin={isAdmin}
            onChange={(v) => setF((x) => ({ ...x, brand: v }))} onAdded={onLookupsChanged} />
        </Field>
        <Field label="Category">
          <LookupSelect kind="category" value={f.category} options={lookups.categories} isAdmin={isAdmin}
            onChange={(v) => setF((x) => ({ ...x, category: v }))} onAdded={onLookupsChanged} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <Field label="Reorder point"><input type="number" min="0" value={f.reorder_point} onChange={(e) => setF({ ...f, reorder_point: e.target.value })} style={inputStyle} /></Field>
        <Field label="Reorder qty"><input type="number" min="0" value={f.reorder_qty} onChange={(e) => setF({ ...f, reorder_qty: e.target.value })} style={inputStyle} /></Field>
        <Field label="Unit price ($)"><input type="number" min="0" step="0.01" value={f.unit_price} onChange={(e) => setF({ ...f, unit_price: e.target.value })} style={inputStyle} /></Field>
      </div>
      <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Part numbers, supplier codes…" style={inputStyle} /></Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button onClick={() => void save()} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Saving…' : item ? 'Save item' : 'Create item'}</button>
      </div>
    </div>
  );
}

function ItemFormModal({ items, lookups, isAdmin, onLookupsChanged, onClose, onSaved }: {
  items: InvItem[]; lookups: Lookups; isAdmin: boolean; onLookupsChanged: () => Promise<void>;
  onClose: () => void; onSaved: (id: string) => Promise<void>;
}) {
  return (
    <Modal title="New item" subtitle="Starts at zero — stock arrives through Incoming Shipments." onClose={onClose}>
      <ItemFields item={null} items={items} lookups={lookups} isAdmin={isAdmin} onLookupsChanged={onLookupsChanged} onCancel={onClose} onSaved={onSaved} />
    </Modal>
  );
}

// Dropdown over a managed list. Admins get "+ Add new…" inline; everyone else
// can only pick existing entries.
const ADD_NEW = '__add_new__';
function LookupSelect({ kind, value, options, isAdmin, onChange, onAdded }: {
  kind: LookupKind; value: string; options: LookupRow[]; isAdmin: boolean;
  onChange: (v: string) => void; onAdded: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const noun = kind === 'brand' ? 'brand' : 'category';
  const inList = options.some((o) => o.name === value);

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    const existing = options.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (existing) { onChange(existing.name); setAdding(false); setDraft(''); return; }
    const { error } = await supabase.from(LOOKUP_TABLE[kind]).insert({ name, sort_order: Math.max(0, ...options.map((o) => o.sort_order)) + 1 });
    if (error) { setErr(error.message); return; }
    await onAdded();
    onChange(name);
    setAdding(false);
    setDraft('');
    setErr(null);
  };

  if (adding) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder={`New ${noun}`}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); if (e.key === 'Escape') setAdding(false); }}
            style={inputStyle} />
          <button type="button" onClick={() => void add()} title="Add" style={{ ...primaryBtn(!draft.trim()), padding: '0 12px' }}><Check size={14} /></button>
          <button type="button" onClick={() => { setAdding(false); setDraft(''); }} title="Cancel" style={{ ...ghostBtn, padding: '0 10px' }}><X size={14} /></button>
        </div>
        {err && <div style={{ fontSize: 11, color: '#C0321A' }}>{err}</div>}
      </div>
    );
  }
  return (
    <select value={value} onChange={(e) => { if (e.target.value === ADD_NEW) setAdding(true); else onChange(e.target.value); }}
      style={{ ...inputStyle, cursor: 'pointer' }}>
      <option value="" disabled>— Select {noun} —</option>
      {options.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
      {value && !inList && <option value={value}>{value} (not in list)</option>}
      {isAdmin && <option value={ADD_NEW}>+ Add new {noun}…</option>}
    </select>
  );
}

// Admin manager for the Brand and Category lists.
function ListsModal({ lookups, items, onClose, onChanged }: {
  lookups: Lookups; items: InvItem[]; onClose: () => void; onChanged: () => Promise<void>;
}) {
  return (
    <Modal title="Brands & categories" subtitle="The options in the item Brand and Category dropdowns. Renaming updates every item that uses it." width={680} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <LookupList kind="brand" rows={lookups.brands} usage={(n) => items.filter((i) => i.brand === n).length} onChanged={onChanged} />
        <LookupList kind="category" rows={lookups.categories} usage={(n) => items.filter((i) => i.category === n).length} onChanged={onChanged} />
      </div>
    </Modal>
  );
}

function LookupList({ kind, rows, usage, onChanged }: {
  kind: LookupKind; rows: LookupRow[]; usage: (name: string) => number; onChanged: () => Promise<void>;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noun = kind === 'brand' ? 'brand' : 'category';

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) { setErr(error.message.includes('duplicate') ? `That ${noun} already exists.` : error.message); return false; }
    await onChanged();
    return true;
  };

  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{kind === 'brand' ? 'Brands' : 'Categories'}</div>
      {rows.map((r) => {
        const n = usage(r.name);
        return (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '6px 8px' }}>
            {editId === r.id ? (
              <>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditId(null); }}
                  style={{ ...inputStyle, padding: '5px 8px', fontSize: 12.5 }} />
                <button disabled={busy} title="Save"
                  onClick={async () => { if (await run(() => supabase.rpc('inv_rename_lookup', { p_kind: kind, p_id: r.id, p_new: draft }))) setEditId(null); }}
                  style={{ border: 'none', background: C.green, color: C.white, borderRadius: 8, padding: '5px 8px', cursor: 'pointer', display: 'inline-flex' }}><Check size={13} /></button>
                <button onClick={() => setEditId(null)} title="Cancel" style={{ border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', padding: 4 }}><X size={13} /></button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                <span style={{ fontSize: 11, color: C.slate, whiteSpace: 'nowrap' }}>{n} item{n === 1 ? '' : 's'}</span>
                <button onClick={() => { setEditId(r.id); setDraft(r.name); }} title="Rename" style={{ border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', padding: 4 }}><Pencil size={13} /></button>
                <button disabled={busy || n > 0} title={n > 0 ? `In use by ${n} item${n === 1 ? '' : 's'} — reassign them first` : `Remove ${noun}`}
                  onClick={() => void run(() => supabase.from(LOOKUP_TABLE[kind]).delete().eq('id', r.id))}
                  style={{ border: 'none', background: 'transparent', color: n > 0 ? '#D5DDE3' : '#C0321A', cursor: n > 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', padding: 4 }}><Trash2 size={13} /></button>
              </>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`New ${noun}`}
          onKeyDown={async (e) => { if (e.key === 'Enter' && newName.trim() && await run(() => supabase.from(LOOKUP_TABLE[kind]).insert({ name: newName.trim(), sort_order: Math.max(0, ...rows.map((x) => x.sort_order)) + 1 }))) setNewName(''); }}
          style={{ ...inputStyle, padding: '6px 10px', fontSize: 12.5 }} />
        <button disabled={busy || !newName.trim()}
          onClick={async () => { if (await run(() => supabase.from(LOOKUP_TABLE[kind]).insert({ name: newName.trim(), sort_order: Math.max(0, ...rows.map((x) => x.sort_order)) + 1 }))) setNewName(''); }}
          style={{ ...primaryBtn(busy || !newName.trim()), padding: '0 12px', display: 'inline-flex', alignItems: 'center' }}><Plus size={14} /></button>
      </div>
      {err && <div style={{ fontSize: 11, color: '#C0321A' }}>{err}</div>}
    </div>
  );
}

