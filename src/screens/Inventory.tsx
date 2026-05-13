import { useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { SUPPLIERS } from './PurchaseOrders';

const INV_CATEGORIES = ['All', 'Charger Units', 'Electrical', 'Accessories', 'Cables'] as const;
type InvCategory = (typeof INV_CATEGORIES)[number];

type InvStatus = 'In Stock' | 'Low Stock' | 'Out of Stock';

const INV_STATUS_COLORS: Record<InvStatus, { bg: string; color: string }> = {
  'In Stock':     { bg: '#E4F3E3', color: '#1B512D' },
  'Low Stock':    { bg: '#FFF8E1', color: '#B07D00' },
  'Out of Stock': { bg: '#FDEAEA', color: '#C0321A' },
};

interface InventoryItem {
  id: string;
  name: string;
  category: Exclude<InvCategory, 'All'>;
  sku: string;
  qty: number;
  reorder: number;
  cost: number;
  price: number;
  supplier: string;
  location: string;
  status: InvStatus;
  notes?: string;
}

const INITIAL_INVENTORY: InventoryItem[] = [
  { id: 'SKU-001', name: '7kW Home Charger Unit',       category: 'Charger Units', sku: 'VOLT-7KW-01',  qty: 24,  reorder: 10, cost: 1800,  price: 2800,  supplier: 'evdb',      location: 'Sunway Warehouse', status: 'In Stock'     },
  { id: 'SKU-002', name: '22kW Commercial Charger',     category: 'Charger Units', sku: 'VOLT-22KW-01', qty: 8,   reorder: 5,  cost: 5200,  price: 6800,  supplier: 'evdb',      location: 'Sunway Warehouse', status: 'In Stock'     },
  { id: 'SKU-003', name: 'DC Fast Charger 50kW',        category: 'Charger Units', sku: 'VOLT-DC50-01', qty: 2,   reorder: 2,  cost: 14000, price: 18000, supplier: 'schneider', location: 'Sunway Warehouse', status: 'Low Stock'    },
  { id: 'SKU-004', name: 'MCB 32A',                     category: 'Electrical',    sku: 'ELEC-MCB-32A', qty: 120, reorder: 30, cost: 45,    price: 90,    supplier: 'hager',     location: 'Site Stock',       status: 'In Stock'     },
  { id: 'SKU-005', name: 'RCCB Type A 30mA',            category: 'Electrical',    sku: 'ELEC-RCCB-A',  qty: 85,  reorder: 30, cost: 180,   price: 320,   supplier: 'hager',     location: 'Site Stock',       status: 'In Stock'     },
  { id: 'SKU-006', name: 'Isolator Switch',             category: 'Electrical',    sku: 'ELEC-ISO-01',  qty: 14,  reorder: 20, cost: 65,    price: 120,   supplier: 'hager',     location: 'Site Stock',       status: 'Low Stock'    },
  { id: 'SKU-007', name: 'Type 2 Charging Cable 7m',    category: 'Cables',        sku: 'CABL-T2-7M',   qty: 42,  reorder: 15, cost: 120,   price: 220,   supplier: 'evdb',      location: 'Sunway Warehouse', status: 'In Stock'     },
  { id: 'SKU-008', name: 'Type 2 Charging Cable 5m',    category: 'Cables',        sku: 'CABL-T2-5M',   qty: 0,   reorder: 10, cost: 95,    price: 180,   supplier: 'evdb',      location: 'Sunway Warehouse', status: 'Out of Stock' },
  { id: 'SKU-009', name: 'Conduit & Fittings Set',      category: 'Accessories',   sku: 'ACC-COND-01',  qty: 55,  reorder: 20, cost: 95,    price: 160,   supplier: 'local',     location: 'Site Stock',       status: 'In Stock'     },
  { id: 'SKU-010', name: 'Wallbox Accessories Kit',     category: 'Accessories',   sku: 'ACC-WBX-KIT',  qty: 38,  reorder: 15, cost: 55,    price: 110,   supplier: 'local',     location: 'Site Stock',       status: 'In Stock'     },
  { id: 'SKU-011', name: 'IP67 Weatherproof Enclosure', category: 'Accessories',   sku: 'ACC-ENC-IP67', qty: 6,   reorder: 8,  cost: 220,   price: 380,   supplier: 'hager',     location: 'Site Stock',       status: 'Low Stock'    },
  { id: 'SKU-012', name: 'Smart Load Balancer Module',  category: 'Accessories',   sku: 'ACC-LB-SM01',  qty: 11,  reorder: 5,  cost: 480,   price: 750,   supplier: 'schneider', location: 'Sunway Warehouse', status: 'In Stock'     },
];

function InvBadge({ status }: { status: InvStatus }) {
  const s = INV_STATUS_COLORS[status] ?? INV_STATUS_COLORS['In Stock'];
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

function StockBar({ qty, reorder, max }: { qty: number; reorder: number; max?: number }) {
  const pct = Math.min((qty / (max || reorder * 4)) * 100, 100);
  const color = qty === 0 ? '#C0321A' : qty <= reorder ? '#B07D00' : C.green;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, background: '#F3F3F3', borderRadius: 99, height: 6, overflow: 'hidden', minWidth: 60 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 24, textAlign: 'right' }}>{qty}</span>
    </div>
  );
}

interface ProductModalProps {
  item: InventoryItem | null;
  onClose: () => void;
  onSave: (it: InventoryItem) => void;
  onDelete: (id: string) => void;
}

function ProductModal({ item, onClose, onSave, onDelete }: ProductModalProps) {
  const isNew = !item;
  const [form, setForm] = useState<InventoryItem>(
    item
      ? { ...item }
      : {
          id: '',
          name: '',
          category: 'Charger Units',
          sku: '',
          qty: 0,
          reorder: 10,
          cost: 0,
          price: 0,
          supplier: 'evdb',
          location: 'Sunway Warehouse',
          status: 'In Stock',
          notes: '',
        },
  );

  const margin = form.price > 0 ? Math.round(((form.price - form.cost) / form.price) * 100) : 0;
  const stockVal = form.cost * form.qty;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{ background: C.white, borderRadius: 20, width: 600, maxHeight: '90vh', overflowY: 'auto', padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{isNew ? 'Add Product' : form.name}</div>
            {!isNew && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{form.sku} · {form.category}</div>}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F3F3', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: C.slate }}>×</button>
        </div>

        {/* Basic info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Product Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. 7kW Home Charger Unit"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>SKU</label>
            <input value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} placeholder="e.g. VOLT-7KW-01" style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as InventoryItem['category'] }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
            >
              {INV_CATEGORIES.filter((c) => c !== 'All').map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Pricing */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 12 }}>Pricing</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Cost Price (RM)</label>
              <input type="number" min="0" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: parseFloat(e.target.value) || 0 }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Selling Price (RM)</label>
              <input type="number" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 2 }}>
              <div style={{ fontSize: 11, color: C.slate }}>Gross Margin</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: margin >= 30 ? C.green : margin >= 15 ? '#B07D00' : '#C0321A' }}>{margin}%</div>
            </div>
          </div>
        </div>

        {/* Stock */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 12 }}>Stock</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Current Qty</label>
              <input
                type="number"
                min="0"
                value={form.qty}
                onChange={(e) => {
                  const qty = parseInt(e.target.value) || 0;
                  const status: InvStatus = qty === 0 ? 'Out of Stock' : qty <= form.reorder ? 'Low Stock' : 'In Stock';
                  setForm((f) => ({ ...f, qty, status }));
                }}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Reorder Level</label>
              <input
                type="number"
                min="0"
                value={form.reorder}
                onChange={(e) => setForm((f) => ({ ...f, reorder: parseInt(e.target.value) || 0 }))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 2 }}>
              <div style={{ fontSize: 11, color: C.slate }}>Stock Value</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>RM {stockVal.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Supplier + Location */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Supplier</label>
            <select
              value={form.supplier}
              onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
            >
              {SUPPLIERS.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Storage Location</label>
            <select
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
            >
              {['Sunway Warehouse', 'Site Stock', 'KL Office', 'Transit'].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          {!isNew && (
            <button
              onClick={() => onDelete(item!.id)}
              style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Delete
            </button>
          )}
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginLeft: isNew ? 0 : 'auto' }}>
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                ...form,
                id:
                  form.id ||
                  `SKU-${String(INITIAL_INVENTORY.length + Date.now()).slice(-3)}`,
              })
            }
            style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            {isNew ? 'Add Product' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScreenInventory() {
  const [items, setItems] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [category, setCategory] = useState<InvCategory>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | InvStatus>('All');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<InventoryItem | 'new' | null>(null);
  const [view, setView] = useState<'table' | 'cards'>('table');

  const filtered = items.filter(
    (it) =>
      (category === 'All' || it.category === category) &&
      (statusFilter === 'All' || it.status === statusFilter) &&
      (it.name.toLowerCase().includes(search.toLowerCase()) ||
        it.sku.toLowerCase().includes(search.toLowerCase())),
  );

  const handleSave = (form: InventoryItem) => {
    if (items.find((i) => i.id === form.id)) {
      setItems((is) => is.map((i) => (i.id === form.id ? form : i)));
    } else {
      setItems((is) => [...is, form]);
    }
    setModal(null);
  };

  const handleDelete = (id: string) => {
    setItems((is) => is.filter((i) => i.id !== id));
    setModal(null);
  };

  const totalSKUs = items.length;
  const totalStockVal = items.reduce((s, i) => s + i.cost * i.qty, 0);
  const lowStockCount = items.filter((i) => i.status === 'Low Stock').length;
  const outOfStock = items.filter((i) => i.status === 'Out of Stock').length;
  const avgMargin = Math.round(
    items.filter((i) => i.price > 0).reduce((s, i) => s + ((i.price - i.cost) / i.price) * 100, 0) /
      items.filter((i) => i.price > 0).length,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Total SKUs"        value={totalSKUs}                                   sub="Active products" accent />
        <KPICard label="Stock Value"       value={`RM ${(totalStockVal / 1000).toFixed(0)}k`}  sub="At cost price" trend="12%" trendUp />
        <KPICard label="Low / Out Stock"   value={`${lowStockCount} / ${outOfStock}`}          sub="Items needing reorder" />
        <KPICard label="Avg Gross Margin"  value={`${avgMargin}%`}                             sub="Across all products" trend="2pp" trendUp />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {INV_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              style={{
                padding: '6px 14px',
                borderRadius: 99,
                border: `1px solid ${category === c ? C.green : '#EBEBEB'}`,
                background: category === c ? C.green : C.white,
                color: category === c ? C.white : C.slate,
                fontFamily: 'Figtree',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['All', 'In Stock', 'Low Stock', 'Out of Stock'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '6px 12px',
                borderRadius: 99,
                border: `1px solid ${statusFilter === s ? C.green : '#EBEBEB'}`,
                background: statusFilter === s ? C.green : 'transparent',
                color: statusFilter === s ? C.white : C.slate,
                fontFamily: 'Figtree',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: 200 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
          />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
            {([['table', '≡ Table'], ['cards', '▦ Cards']] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '7px 14px',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'Figtree',
                  fontSize: 12,
                  fontWeight: 600,
                  background: view === v ? C.green : 'transparent',
                  color: view === v ? C.white : C.slate,
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <button onClick={() => setModal('new')} style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Add Product
          </button>
        </div>
      </div>

      {/* Table view */}
      {view === 'table' && (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['SKU', 'Product', 'Category', 'Stock Level', 'Reorder At', 'Cost', 'Price', 'Margin', 'Supplier', 'Status'].map((h) => (
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
              {filtered.map((it, i) => {
                const margin = it.price > 0 ? Math.round(((it.price - it.cost) / it.price) * 100) : 0;
                const supplier = SUPPLIERS.find((s) => s.id === it.supplier);
                return (
                  <tr
                    key={i}
                    style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                    onClick={() => setModal(it)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '11px 14px', fontWeight: 700, color: C.green, fontSize: 11 }}>{it.sku}</td>
                    <td style={{ padding: '11px 14px', fontWeight: 600, color: '#1a1a1a', maxWidth: 180 }}>{it.name}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: '#F3F3F3', color: C.slate }}>{it.category}</span>
                    </td>
                    <td style={{ padding: '11px 14px', minWidth: 120 }}>
                      <StockBar qty={it.qty} reorder={it.reorder} max={it.reorder * 5} />
                    </td>
                    <td style={{ padding: '11px 14px', color: C.slate, textAlign: 'center' }}>{it.reorder}</td>
                    <td style={{ padding: '11px 14px', color: C.slate }}>RM {it.cost.toLocaleString()}</td>
                    <td style={{ padding: '11px 14px', fontWeight: 600, color: '#1a1a1a' }}>RM {it.price.toLocaleString()}</td>
                    <td style={{ padding: '11px 14px', fontWeight: 700, color: margin >= 30 ? C.green : margin >= 15 ? '#B07D00' : '#C0321A' }}>{margin}%</td>
                    <td style={{ padding: '11px 14px', color: C.slate, fontSize: 12 }}>
                      {supplier?.name.replace(' Malaysia', '').replace(' Sdn Bhd', '').replace(' Technology', '') ?? it.supplier}
                    </td>
                    <td style={{ padding: '11px 14px' }}><InvBadge status={it.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center', color: C.slate, fontSize: 14 }}>No products found.</div>
          )}
        </div>
      )}

      {/* Cards view */}
      {view === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {filtered.map((it, i) => {
            const margin = it.price > 0 ? Math.round(((it.price - it.cost) / it.price) * 100) : 0;
            return (
              <div
                key={i}
                onClick={() => setModal(it)}
                style={{ background: C.white, borderRadius: 14, padding: '18px 20px', border: '1px solid #EBEBEB', cursor: 'pointer', transition: 'box-shadow .15s, transform .15s' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.08)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.slate, background: '#F3F3F3', padding: '2px 8px', borderRadius: 5 }}>{it.category}</span>
                  <InvBadge status={it.status} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.green, lineHeight: 1.3, marginBottom: 4 }}>{it.name}</div>
                <div style={{ fontSize: 11, color: C.slate, marginBottom: 14 }}>{it.sku}</div>

                <StockBar qty={it.qty} reorder={it.reorder} max={it.reorder * 5} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, marginBottom: 14 }}>
                  <span style={{ fontSize: 11, color: C.slate }}>Reorder at {it.reorder}</span>
                  <span style={{ fontSize: 11, color: C.slate }}>📍 {it.location}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, borderTop: '1px solid #F3F3F3', paddingTop: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: C.slate }}>Cost</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>RM {it.cost.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: C.slate }}>Price</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>RM {it.price.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: C.slate }}>Margin</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: margin >= 30 ? C.green : margin >= 15 ? '#B07D00' : '#C0321A' }}>{margin}%</div>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1/-1', padding: '40px', textAlign: 'center', color: C.slate, fontSize: 14, background: C.white, borderRadius: 16, border: '1px solid #EBEBEB' }}>
              No products found.
            </div>
          )}
        </div>
      )}

      {modal && (
        <ProductModal
          item={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
