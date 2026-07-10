import { useEffect, useMemo, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { Search, Plus, Package, FileText, Save, Trash2, Pencil } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────

interface CatalogItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  unit_price: number;
  description: string | null;
  is_active: boolean;
}

interface QuoteLine {
  key: string;
  item_id: string | null;
  name: string;
  unit: string;
  unit_price: number;
  qty: number;
}

interface SavedQuote {
  id: string;
  title: string;
  customer: string | null;
  notes: string | null;
  lines: QuoteLine[];
  discount: number;
  profit_pct: number;
  subtotal: number;
  total: number;
  created_by: string | null;
  created_at: string;
}

const UNITS = ['unit', 'meter', 'each', 'set', 'point', 'run', 'lot', 'hour', 'day'];

const money = (n: number) => '$' + (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let lineSeq = 0;
const newKey = () => `l-${Date.now()}-${lineSeq++}`;

// ── Root ──────────────────────────────────────────────────────────

type Tab = 'build' | 'catalog' | 'saved';

export function ScreenQuoteMachine() {
  const { can, user } = usePermissions();
  const canEdit = can('quote_machine', 'can_edit');
  const canDelete = can('quote_machine', 'can_delete');

  const [tab, setTab] = useState<Tab>('build');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [saved, setSaved] = useState<SavedQuote[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadQuote, setLoadQuote] = useState<SavedQuote | null>(null);

  const fetchCategories = async () => {
    const { data } = await supabase.from('quote_categories').select('name').order('name');
    setCategories(((data as { name: string }[]) ?? []).map((c) => c.name));
  };
  const fetchAll = async () => {
    const [{ data: it }, { data: q }] = await Promise.all([
      supabase.from('quote_catalog_items').select('*').order('category').order('name'),
      // Personal workspace: only the signed-in user's own saved quotes.
      supabase.from('quotes').select('*').eq('created_by_id', user.id).order('created_at', { ascending: false }),
      fetchCategories(),
    ]);
    setItems((it as CatalogItem[]) ?? []);
    setSaved((q as unknown as SavedQuote[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { void fetchAll(); }, []);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Catalog Items" value={String(items.filter((i) => i.is_active).length)} sub="products & services" accent />
        <KPICard label="Categories" value={String(categories.length)} sub="in the catalog" />
        <KPICard label="Saved Quotes" value={String(saved.length)} sub="generated" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
        {([
          ['build', 'Build Quote'],
          ['catalog', 'Price Catalog'],
          ['saved', 'Saved Quotes'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: '8px 20px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: tab === id ? C.green : 'transparent', color: tab === id ? C.white : C.slate }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'build' && (
        <BuildQuote key={loadQuote?.id ?? 'fresh'} items={items} loadQuote={loadQuote} onSaved={async () => { await fetchAll(); }} />
      )}
      {tab === 'catalog' && (
        <CatalogTab items={items} categories={categories} canEdit={canEdit} canDelete={canDelete} onRefresh={fetchAll} />
      )}
      {tab === 'saved' && (
        <SavedTab saved={saved} canDelete={canDelete} onRefresh={fetchAll}
          onLoad={(q) => { setLoadQuote(q); setTab('build'); }} />
      )}
    </div>
  );
}

// ── Build Quote ───────────────────────────────────────────────────

function BuildQuote({ items, loadQuote, onSaved }: { items: CatalogItem[]; loadQuote: SavedQuote | null; onSaved: () => Promise<void> }) {
  const { user } = usePermissions();
  const [title, setTitle] = useState(loadQuote?.title ?? '');
  const [notes, setNotes] = useState(loadQuote?.notes ?? '');
  const [profit, setProfit] = useState<number>(loadQuote?.profit_pct ?? 0);
  const [lines, setLines] = useState<QuoteLine[]>(() => (loadQuote?.lines ?? []).map((l) => ({ ...l, key: newKey() })));
  const [catFilter, setCatFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  const active = items.filter((i) => i.is_active);
  const cats = [...new Set(active.map((i) => i.category))].sort((a, b) => a.localeCompare(b));
  const visibleItems = catFilter ? active.filter((i) => i.category === catFilter) : active;
  const grouped = useMemo(() => {
    const m = new Map<string, CatalogItem[]>();
    for (const i of visibleItems) { const a = m.get(i.category) ?? []; a.push(i); m.set(i.category, a); }
    for (const [, arr] of m) arr.sort((a, b) => a.unit_price - b.unit_price); // cheapest first within each category
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleItems]);

  const dirty = () => setSavedMsg(false);
  const addItem = (it: CatalogItem) => {
    dirty();
    setLines((prev) => {
      const ex = prev.find((l) => l.item_id === it.id);
      if (ex) return prev.map((l) => (l.key === ex.key ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { key: newKey(), item_id: it.id, name: it.name, unit: it.unit, unit_price: it.unit_price, qty: 1 }];
    });
  };
  const addCustom = () => { dirty(); setLines((prev) => [...prev, { key: newKey(), item_id: null, name: '', unit: 'unit', unit_price: 0, qty: 1 }]); };
  const updateLine = (key: string, patch: Partial<QuoteLine>) => { dirty(); setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l))); };
  const removeLine = (key: string) => { dirty(); setLines((prev) => prev.filter((l) => l.key !== key)); };

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0); // contractor cost
  const markup = subtotal * (profit / 100);
  const total = subtotal + markup; // marked-up quote price

  const save = async () => {
    if (!lines.length) return;
    setSaving(true);
    const payload = {
      title: title.trim() || 'Untitled quote',
      notes: notes.trim() || null,
      lines: lines.map(({ key, ...rest }) => rest), // drop the transient key
      profit_pct: profit,
      subtotal,
      total,
      created_by: user.full_name || user.email,
      created_by_id: user.id,
    };
    const { error } = await supabase.from('quotes').insert(payload);
    setSaving(false);
    if (error) { window.alert(`Could not save the quote: ${error.message}`); return; }
    setSavedMsg(true);
    await onSaved();
  };

  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: 16, alignItems: 'flex-start' }}>
      {/* Catalog picker */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '72vh' }}>
        <div style={{ padding: 14, borderBottom: '1px solid #F3F3F3', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Add from catalog</div>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">All categories</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {active.length === 0 ? (
            <div style={{ padding: '30px 14px', textAlign: 'center', color: C.slate, fontSize: 12 }}>
              No catalog items yet. Add prices in the <strong>Price Catalog</strong> tab.
            </div>
          ) : grouped.map(([cat, list]) => (
            <div key={cat}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '2px 8px 6px' }}>{cat}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {list.map((it) => (
                  <button key={it.id} onClick={() => addItem(it)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.seasalt; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'Figtree' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                      {it.description && <span style={{ display: 'block', fontSize: 11, color: C.slate, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.description}</span>}
                      <span style={{ display: 'block', fontSize: 11, color: C.slate }}>{money(it.unit_price)} / {it.unit}</span>
                    </span>
                    <span style={{ width: 24, height: 24, borderRadius: 7, background: C.honeydew, color: C.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Plus size={14} strokeWidth={2.5} /></span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: 10, borderTop: '1px solid #F3F3F3' }}>
          <button onClick={addCustom}
            style={{ width: '100%', padding: '8px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + Add a custom line
          </button>
        </div>
      </div>

      {/* Quote sheet */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '18px 22px' }}>
          <label style={labelStyle}>Quote Title</label>
          <input value={title} onChange={(e) => { setTitle(e.target.value); dirty(); }} placeholder="e.g. Charger installation — Blk 123" style={inputStyle} />
        </div>

        {/* Lines */}
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Item', 'Unit Price', 'Qty', 'Unit', 'Line Total', ''].map((h) => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: h === 'Item' ? 'left' : 'right', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} style={{ borderBottom: '1px solid #F3F3F3' }}>
                  <td style={{ padding: '8px 14px' }}>
                    <input value={l.name} onChange={(e) => updateLine(l.key, { name: e.target.value })} placeholder="Item name"
                      style={{ width: '100%', minWidth: 160, padding: '6px 8px', borderRadius: 8, border: l.item_id ? '1px solid transparent' : '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, color: '#1a1a1a', outline: 'none', background: l.item_id ? 'transparent' : C.white }} />
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                    <input type="number" min={0} step="0.01" value={l.unit_price} onChange={(e) => updateLine(l.key, { unit_price: parseFloat(e.target.value) || 0 })}
                      style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, textAlign: 'right', outline: 'none', background: C.white }} />
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                    <input type="number" min={0} step="any" value={l.qty} onChange={(e) => updateLine(l.key, { qty: Math.max(0, parseFloat(e.target.value) || 0) })}
                      style={{ width: 70, padding: '6px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, textAlign: 'right', outline: 'none', background: C.white }} />
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 13, color: C.slate }}>{l.unit}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>{money(l.qty * l.unit_price)}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                    <button onClick={() => removeLine(l.key)} title="Remove"
                      style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  Add items from the catalog on the left to build a quote.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals + save */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '18px 22px', width: 340, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Contractor cost" value={money(subtotal)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: '#1a1a1a' }}>Profit markup</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="text" inputMode="decimal" value={profit ? String(profit) : ''}
                  onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); setProfit(parseFloat(v) || 0); dirty(); }}
                  placeholder="0" style={{ width: 64, padding: '6px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, textAlign: 'right', outline: 'none', background: C.white }} />
                <span style={{ fontSize: 13, color: C.slate }}>%</span>
              </div>
            </div>
            {profit > 0 && <Row label="Markup" value={'+ ' + money(markup)} muted />}
            <div style={{ borderTop: '1px solid #EBEBEB', margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>Quote price</span>
              <span style={{ fontSize: 24, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>{money(total)}</span>
            </div>
            <div>
              <label style={{ ...labelStyle, marginTop: 6 }}>Notes</label>
              <textarea value={notes} onChange={(e) => { setNotes(e.target.value); dirty(); }} rows={2} placeholder="Optional"
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'Figtree' }} />
            </div>
            <button onClick={save} disabled={saving || lines.length === 0}
              style={{ marginTop: 6, padding: '11px', borderRadius: 10, border: 'none', background: saving || lines.length === 0 ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 14, fontWeight: 700, cursor: saving || lines.length === 0 ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Save size={14} strokeWidth={2.25} /> {saving ? 'Saving…' : savedMsg ? 'Saved ✓' : 'Save Quote'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: muted ? C.slate : '#1a1a1a' }}>
      <span>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ── Price Catalog ─────────────────────────────────────────────────

function CatalogTab({ items, categories, canEdit, canDelete, onRefresh }: { items: CatalogItem[]; categories: string[]; canEdit: boolean; canDelete: boolean; onRefresh: () => Promise<void> }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [managingCats, setManagingCats] = useState(false);

  const visible = items
    .filter((i) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q);
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.unit_price - b.unit_price);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search catalog…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        {canEdit && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={() => setManagingCats(true)}
              style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Manage categories
            </button>
            <button onClick={() => setAdding(true)}
              style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Add Item
            </button>
          </div>
        )}
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Item', 'Remark', 'Category', 'Unit', 'Unit Price', 'Status', ''].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: h === 'Unit Price' ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((it) => (
              <tr key={it.id} style={{ borderBottom: '1px solid #F3F3F3', cursor: canEdit ? 'pointer' : 'default', opacity: it.is_active ? 1 : 0.55 }}
                onMouseEnter={(e) => { if (canEdit) e.currentTarget.style.background = '#FAFAFA'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={() => canEdit && setEditing(it)}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{it.name}</div>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: it.description ? C.slate : '#C7CDD3', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.description ?? ''}>
                  {it.description || '—'}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: C.seasalt, border: '1px solid #EBEBEB', color: C.slate }}>{it.category}</span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: C.slate }}>{it.unit}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green, textAlign: 'right' }}>{money(it.unit_price)}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: it.is_active ? '#E4F3E3' : '#F3F3F3', color: it.is_active ? '#1B512D' : '#767B77' }}>
                    {it.is_active ? 'Active' : 'Hidden'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  {canEdit && (
                    <button onClick={(e) => { e.stopPropagation(); setEditing(it); }}
                      style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Pencil size={12} /> Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                {items.length === 0
                  ? <><Package size={28} strokeWidth={1.5} style={{ display: 'block', margin: '0 auto 10px', color: C.slate }} />No priced items yet.{canEdit && ' Click “+ Add Item”.'}</>
                  : 'No items match your search.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <ItemModal title="Add Item" canDelete={false} categories={categories}
          initial={{ name: '', category: categories[0] ?? 'General', unit: 'unit', unit_price: 0, description: '', is_active: true }}
          onSave={async (data) => { await supabase.from('quote_catalog_items').insert(data); await onRefresh(); }}
          onClose={() => setAdding(false)} />
      )}
      {editing && (
        <ItemModal key={editing.id} title="Edit Item" canDelete={canDelete} categories={categories}
          initial={{ name: editing.name, category: editing.category, unit: editing.unit, unit_price: editing.unit_price, description: editing.description ?? '', is_active: editing.is_active }}
          onSave={async (data) => { await supabase.from('quote_catalog_items').update({ ...data, updated_at: new Date().toISOString() }).eq('id', editing.id); await onRefresh(); }}
          onDelete={async () => { await supabase.from('quote_catalog_items').delete().eq('id', editing.id); await onRefresh(); }}
          onClose={() => setEditing(null)} />
      )}
      {managingCats && (
        <CategoriesModal categories={categories} items={items} onRefresh={onRefresh} onClose={() => setManagingCats(false)} />
      )}
    </div>
  );
}

// ── Manage categories ─────────────────────────────────────────────

function CategoriesModal({ categories, items, onRefresh, onClose }: { categories: string[]; items: CatalogItem[]; onRefresh: () => Promise<void>; onClose: () => void }) {
  const [newCat, setNewCat] = useState('');
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1);
    return m;
  }, [items]);

  const addCat = async () => {
    const n = newCat.trim();
    if (!n) return;
    const { error } = await supabase.from('quote_categories').insert({ name: n });
    if (error && error.code !== '23505') { window.alert(error.message); return; }
    setNewCat('');
    await onRefresh();
  };

  const renameCat = async (oldName: string, next: string) => {
    const nn = next.trim();
    if (!nn || nn === oldName) return;
    // Move every item on the old category to the new name…
    await supabase.from('quote_catalog_items').update({ category: nn }).eq('category', oldName);
    // …then either merge into an existing category or rename the row.
    if (categories.includes(nn)) {
      await supabase.from('quote_categories').delete().eq('name', oldName);
    } else {
      await supabase.from('quote_categories').update({ name: nn }).eq('name', oldName);
    }
    await onRefresh();
  };

  const deleteCat = async (name: string) => {
    await supabase.from('quote_categories').delete().eq('name', name);
    await onRefresh();
  };

  const input: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 460, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Manage Categories</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addCat(); }}
            placeholder="Add a category…" style={{ ...input, flex: 1 }} />
          <button onClick={() => void addCat()} disabled={!newCat.trim()}
            style={{ padding: '0 16px', borderRadius: 10, border: 'none', background: newCat.trim() ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: newCat.trim() ? 'pointer' : 'default' }}>Add</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {categories.length === 0 && <div style={{ fontSize: 12, color: C.slate, textAlign: 'center', padding: 12 }}>No categories yet.</div>}
          {categories.map((c) => (
            <CategoryRow key={c} name={c} count={usage.get(c) ?? 0} onRename={renameCat} onDelete={deleteCat} />
          ))}
        </div>

        <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5 }}>
          Renaming a category moves every item on it to the new name (merging if the name already exists).
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 22px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  );
}

function CategoryRow({ name, count, onRename, onDelete }: { name: string; count: number; onRename: (oldName: string, next: string) => Promise<void>; onDelete: (name: string) => Promise<void> }) {
  const [v, setV] = useState(name);
  const [confirmDel, setConfirmDel] = useState(false);
  const changed = !!v.trim() && v.trim() !== name;
  const input: React.CSSProperties = { flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, color: '#1a1a1a', outline: 'none', background: C.white };

  if (confirmDel) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FDEAEA', borderRadius: 10, padding: '8px 12px' }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#C0321A' }}>
          Delete “{name}”?{count > 0 ? ` ${count} item${count === 1 ? '' : 's'} will keep this label until re-categorised.` : ''}
        </span>
        <button onClick={() => setConfirmDel(false)} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        <button onClick={() => void onDelete(name)} style={{ padding: '5px 10px', borderRadius: 7, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Delete</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && changed) void onRename(name, v); }} style={input} />
      {count > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: C.slate, background: C.seasalt, border: '1px solid #EBEBEB', borderRadius: 99, padding: '3px 8px', whiteSpace: 'nowrap' }}>{count} used</span>}
      {changed ? (
        <button onClick={() => void onRename(name, v)} style={{ padding: '7px 12px', borderRadius: 8, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Save</button>
      ) : (
        <button onClick={() => setConfirmDel(true)} title="Delete category"
          style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

interface ItemForm { name: string; category: string; unit: string; unit_price: number; description: string; is_active: boolean; }

function ItemModal({ initial, title, canDelete, categories, onSave, onDelete, onClose }: {
  initial: ItemForm; title: string; canDelete: boolean; categories: string[];
  onSave: (data: ItemForm) => Promise<void>; onDelete?: () => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState<ItemForm>(initial);
  const [priceStr, setPriceStr] = useState(initial.unit_price ? String(initial.unit_price) : '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canSave = !!form.name.trim() && !!form.category.trim() && !saving;

  const catOptions = [...new Set([form.category, ...categories].filter(Boolean))];

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 460, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div>
          <label style={label}>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Isolator switch 63A" style={input} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>Category</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...input, cursor: 'pointer' }}>
              {catOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Unit</label>
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} style={{ ...input, cursor: 'pointer' }}>
              {[...new Set([form.unit, ...UNITS])].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={label}>Unit Price ($)</label>
          <input type="text" inputMode="decimal" value={priceStr}
            onChange={(e) => {
              const clean = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
              setPriceStr(clean);
              setForm({ ...form, unit_price: parseFloat(clean) || 0 });
            }}
            placeholder="0.00" style={input} />
        </div>
        <div>
          <label style={label}>Remark (optional)</label>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. brand / spec note" style={input} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#1a1a1a', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} style={{ width: 16, height: 16, accentColor: C.green, cursor: 'pointer' }} />
          Available in the quote builder
        </label>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this item?</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={async () => { await onDelete!(); onClose(); }} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, Delete</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {onDelete && canDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)} style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button disabled={!canSave} onClick={async () => { setSaving(true); await onSave(form); setSaving(false); onClose(); }}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Saved Quotes ──────────────────────────────────────────────────

function SavedTab({ saved, canDelete, onLoad, onRefresh }: { saved: SavedQuote[]; canDelete: boolean; onLoad: (q: SavedQuote) => void; onRefresh: () => Promise<void> }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (saved.length === 0) {
    return (
      <div style={{ background: C.white, border: '1px dashed #EBEBEB', borderRadius: 16, padding: '48px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
        <FileText size={30} strokeWidth={1.5} style={{ display: 'block', margin: '0 auto 10px', color: C.slate }} />
        No saved quotes yet. Build one in the <strong>Build Quote</strong> tab and save it.
      </div>
    );
  }

  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: C.seasalt }}>
            {['Quote', 'Items', 'Profit', 'Quote Price', 'Created', ''].map((h) => (
              <th key={h} style={{ padding: '12px 16px', textAlign: h === 'Quote Price' ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {saved.map((q) => (
            <tr key={q.id} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              onClick={() => onLoad(q)}>
              <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green }}>{q.title}</td>
              <td style={{ padding: '12px 16px', fontSize: 13, color: C.slate }}>{q.lines?.length ?? 0} line{(q.lines?.length ?? 0) === 1 ? '' : 's'}</td>
              <td style={{ padding: '12px 16px', fontSize: 13, color: C.slate }}>{q.profit_pct ? `${q.profit_pct}%` : '—'}</td>
              <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green, textAlign: 'right' }}>{money(q.total)}</td>
              <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate, whiteSpace: 'nowrap' }}>{new Date(q.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
              <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => onLoad(q)}
                  style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 6 }}>
                  Open
                </button>
                {canDelete && (confirmId === q.id ? (
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <button onClick={() => setConfirmId(null)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={async () => { await supabase.from('quotes').delete().eq('id', q.id); setConfirmId(null); await onRefresh(); }} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Delete</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmId(q.id)} title="Delete"
                    style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Trash2 size={13} />
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
