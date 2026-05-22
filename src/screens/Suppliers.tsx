import { useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { Search } from 'lucide-react';

interface SupplierData {
  id: string;
  name: string;
  category: SupplierCategory;
  contact: string;
  email: string;
  phone: string;
  address: string;
  reg: string;
  currency: string;
  paymentTerms: string;
  leadTime: string;
  rating: number;
  status: SupplierStatus;
  totalPOs: number;
  totalValue: number;
  notes: string;
  products: string[];
}

const SUPPLIER_CATEGORIES = ['All', 'Charger OEM', 'Electrical Equipment', 'Electrical Components', 'Internal'] as const;
type SupplierCategoryAll = (typeof SUPPLIER_CATEGORIES)[number];
type SupplierCategory = Exclude<SupplierCategoryAll, 'All'>;
const SUPPLIER_STATUSES = ['All', 'Active', 'Inactive', 'Prospect'] as const;
type SupplierStatusAll = (typeof SUPPLIER_STATUSES)[number];
type SupplierStatus = Exclude<SupplierStatusAll, 'All'>;

const SUPPLIER_STATUS_COLORS: Record<SupplierStatus, { bg: string; color: string }> = {
  Active:   { bg: '#E4F3E3', color: '#1B512D' },
  Inactive: { bg: '#F3F3F3', color: '#767B77' },
  Prospect: { bg: '#E3F0FF', color: '#1A62C0' },
};

const INITIAL_SUPPLIERS_DATA: SupplierData[] = [
  {
    id: 'evdb', name: 'EVDB Technology Sdn Bhd', category: 'Charger OEM',
    contact: 'Kevin Tan', email: 'kevin@evdb.com.my', phone: '+603-7890 1234',
    address: 'Unit 12-3, Menara BRDB, Bangsar, 59000 Kuala Lumpur',
    reg: '201801023456 (1234567-X)', currency: 'MYR', paymentTerms: 'Net 30',
    leadTime: '7–14 days', rating: 5, status: 'Active',
    totalPOs: 18, totalValue: 284600,
    notes: 'Primary charger hardware supplier. Strong warranty support. Preferred partner.',
    products: ['7kW Charger Unit', '22kW Charger Unit', 'DC 50kW Unit', 'Type 2 Cables'],
  },
  {
    id: 'schneider', name: 'Schneider Electric Malaysia', category: 'Electrical Equipment',
    contact: 'Azrul Ismail', email: 'azrul@schneider.com.my', phone: '+603-2171 1000',
    address: 'Lot 1, Jalan Astaka U8/84, Bukit Jelutong, 40150 Shah Alam, Selangor',
    reg: '199401012345 (304891-T)', currency: 'MYR', paymentTerms: 'Net 45',
    leadTime: '14–21 days', rating: 4, status: 'Active',
    totalPOs: 8, totalValue: 96800,
    notes: 'Commercial charger units and industrial switchgear. Long lead times for imported models.',
    products: ['22kW Commercial Charger', 'DC Fast Charger 50kW', 'Smart Load Balancer'],
  },
  {
    id: 'hager', name: 'Hager Malaysia Sdn Bhd', category: 'Electrical Components',
    contact: 'Priscilla Wong', email: 'priscilla@hager.com.my', phone: '+603-5191 2288',
    address: '8, Jalan Kilang, Taman Perindustrian Puchong, 47100 Puchong, Selangor',
    reg: '200501034567 (698234-W)', currency: 'MYR', paymentTerms: 'Net 30',
    leadTime: '5–10 days', rating: 4, status: 'Active',
    totalPOs: 22, totalValue: 48200,
    notes: 'Reliable for MCB, RCCB, isolators. Bulk pricing available above 100 units. Good local stock.',
    products: ['MCB 32A', 'RCCB Type A 30mA', 'Isolator Switch', 'IP67 Enclosure', 'Conduit Fittings'],
  },
  {
    id: 'local', name: 'EVOne Internal Stock', category: 'Internal',
    contact: 'Warehouse Team', email: 'warehouse@evone.com.my', phone: '+6011-2845 6416',
    address: 'Level 3A, Sunway Visio Tower, Sunway Velocity, 55100 Kuala Lumpur',
    reg: '202601013495 (1675593-V)', currency: 'MYR', paymentTerms: 'N/A',
    leadTime: 'Same day', rating: 5, status: 'Active',
    totalPOs: 0, totalValue: 0,
    notes: 'Internal warehouse for accessories and small components. Managed by ops team.',
    products: ['Wallbox Accessories Kit', 'Conduit & Fittings', 'Installation Tools'],
  },
  {
    id: 'abb', name: 'ABB Malaysia Sdn Bhd', category: 'Electrical Equipment',
    contact: 'Siti Norzahra', email: 'siti.norzahra@abb.com', phone: '+603-2162 4888',
    address: 'Wisma ABB, No.14, Jalan Yap Kwan Seng, 50450 Kuala Lumpur',
    reg: '198601002345 (156789-U)', currency: 'MYR', paymentTerms: 'Net 60',
    leadTime: '21–30 days', rating: 3, status: 'Inactive',
    totalPOs: 3, totalValue: 22400,
    notes: 'Previously used for surge protection and grid-tie components. Currently inactive — evaluating for DC charger supply.',
    products: ['Surge Protection Devices', 'Grid Tie Modules'],
  },
  {
    id: 'siemens', name: 'Siemens Malaysia Sdn Bhd', category: 'Electrical Equipment',
    contact: 'Raj Kumar', email: 'raj.kumar@siemens.com', phone: '+603-2052 7000',
    address: 'Level 7, Menara Shell, No.211, Jalan Tun Razak, 50400 Kuala Lumpur',
    reg: '196301000456 (5678-A)', currency: 'MYR', paymentTerms: 'Net 60',
    leadTime: '30–45 days', rating: 3, status: 'Prospect',
    totalPOs: 0, totalValue: 0,
    notes: 'In discussion for potential OCPP backend integration. No purchase history yet.',
    products: ['SCADA / Backend Systems', 'Smart Metering'],
  },
];

function StarRating({ value }: { value: number }) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} style={{ fontSize: 12, color: s <= value ? C.yellow : '#E0E0E0' }}>★</span>
      ))}
    </div>
  );
}

interface SupplierModalProps {
  supplier: SupplierData | null;
  onClose: () => void;
  onSave: (s: SupplierData) => void;
  onDelete: (id: string) => void;
}

function SupplierModal({ supplier, onClose, onSave, onDelete }: SupplierModalProps) {
  const isNew = !supplier;
  const [form, setForm] = useState<SupplierData>(
    supplier
      ? { ...supplier, products: [...supplier.products] }
      : {
          id: '',
          name: '',
          category: 'Electrical Components',
          contact: '',
          email: '',
          phone: '',
          address: '',
          reg: '',
          currency: 'MYR',
          paymentTerms: 'Net 30',
          leadTime: '7–14 days',
          rating: 3,
          status: 'Active',
          totalPOs: 0,
          totalValue: 0,
          notes: '',
          products: [],
        },
  );
  const [newProduct, setNewProduct] = useState('');

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: C.white, borderRadius: 20, width: 620, maxHeight: '90vh', overflowY: 'auto', padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{isNew ? 'Add Supplier' : form.name}</div>
            {!isNew && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{form.category} · {form.reg}</div>}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F3F3', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: C.slate }}>×</button>
        </div>

        {/* Status + Category */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as SupplierCategory }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
            >
              {SUPPLIER_CATEGORIES.filter((c) => c !== 'All').map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Status</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['Active', 'Inactive', 'Prospect'] as const).map((s) => {
                const sc = SUPPLIER_STATUS_COLORS[s];
                return (
                  <button
                    key={s}
                    onClick={() => setForm((f) => ({ ...f, status: s }))}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      borderRadius: 10,
                      border: `2px solid ${form.status === s ? sc.color : '#EBEBEB'}`,
                      background: form.status === s ? sc.bg : C.white,
                      color: form.status === s ? sc.color : C.slate,
                      fontFamily: 'Figtree',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Company info */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>Company Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Company Name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. EVDB Technology Sdn Bhd" style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Contact Person</label>
              <input value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Email</label>
              <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Phone</label>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Address</label>
              <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Company Reg No.</label>
              <input value={form.reg} onChange={(e) => setForm((f) => ({ ...f, reg: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }} />
            </div>
          </div>
        </div>

        {/* Terms */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Payment Terms</label>
            <select
              value={form.paymentTerms}
              onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
            >
              {['COD', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'N/A'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Lead Time</label>
            <input value={form.leadTime} onChange={(e) => setForm((f) => ({ ...f, leadTime: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Rating</label>
            <div style={{ display: 'flex', gap: 4, paddingTop: 8 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setForm((f) => ({ ...f, rating: s }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: s <= form.rating ? C.yellow : '#E0E0E0', padding: 0 }}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Products */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>Products Supplied</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {form.products.map((p, i) => (
              <span key={i} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 99, background: C.honeydew, color: C.green, display: 'flex', alignItems: 'center', gap: 6 }}>
                {p}
                <button
                  onClick={() => setForm((f) => ({ ...f, products: f.products.filter((_, idx) => idx !== i) }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.slate, fontSize: 12, padding: 0, lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newProduct}
              onChange={(e) => setNewProduct(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newProduct.trim()) {
                  setForm((f) => ({ ...f, products: [...f.products, newProduct.trim()] }));
                  setNewProduct('');
                }
              }}
              placeholder="Type product and press Enter…"
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none' }}
            />
            <button
              onClick={() => {
                if (newProduct.trim()) {
                  setForm((f) => ({ ...f, products: [...f.products, newProduct.trim()] }));
                  setNewProduct('');
                }
              }}
              style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              Add
            </button>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={3}
            placeholder="Relationship notes, special terms, quality observations…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          {!isNew && (
            <button
              onClick={() => onDelete(supplier!.id)}
              style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Delete
            </button>
          )}
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginLeft: isNew ? 0 : 'auto' }}>
            Cancel
          </button>
          <button
            onClick={() => onSave({ ...form, id: form.id || `supp-${Date.now()}` })}
            style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            {isNew ? 'Add Supplier' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScreenSuppliers() {
  const [suppliersData, setSuppliersData] = useState<SupplierData[]>(INITIAL_SUPPLIERS_DATA);
  const [categoryFilter, setCategoryFilter] = useState<SupplierCategoryAll>('All');
  const [statusFilter, setStatusFilter] = useState<SupplierStatusAll>('All');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<SupplierData | 'new' | null>(null);
  const [selected, setSelected] = useState<SupplierData | null>(null);

  const filtered = suppliersData.filter(
    (s) =>
      (categoryFilter === 'All' || s.category === categoryFilter) &&
      (statusFilter === 'All' || s.status === statusFilter) &&
      (s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.contact.toLowerCase().includes(search.toLowerCase())),
  );

  const handleSave = (form: SupplierData) => {
    if (suppliersData.find((s) => s.id === form.id)) {
      setSuppliersData((ss) => ss.map((s) => (s.id === form.id ? form : s)));
      if (selected?.id === form.id) setSelected(form);
    } else {
      setSuppliersData((ss) => [...ss, form]);
    }
    setModal(null);
  };

  const handleDelete = (id: string) => {
    setSuppliersData((ss) => ss.filter((s) => s.id !== id));
    if (selected?.id === id) setSelected(null);
    setModal(null);
  };

  const activeCount = suppliersData.filter((s) => s.status === 'Active').length;
  const totalSpend = suppliersData.reduce((s, sup) => s + sup.totalValue, 0);
  const avgRating = (suppliersData.reduce((s, sup) => s + sup.rating, 0) / suppliersData.length).toFixed(1);
  const prospectCount = suppliersData.filter((s) => s.status === 'Prospect').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Active Suppliers"    value={activeCount}                              sub={`${suppliersData.length} total`} accent />
        <KPICard label="Total Spend (YTD)"   value={`RM ${(totalSpend / 1000).toFixed(0)}k`}  sub="All suppliers combined" trend="14%" trendUp />
        <KPICard label="Avg Supplier Rating" value={`${avgRating} ★`}                         sub="Out of 5.0" />
        <KPICard label="Prospects"           value={prospectCount}                            sub="Under evaluation" />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {SUPPLIER_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              style={{
                padding: '6px 14px',
                borderRadius: 99,
                border: `1px solid ${categoryFilter === c ? C.green : '#EBEBEB'}`,
                background: categoryFilter === c ? C.green : C.white,
                color: categoryFilter === c ? C.white : C.slate,
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
          {SUPPLIER_STATUSES.map((s) => (
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
            placeholder="Search suppliers…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
          />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
        </div>
        <button onClick={() => setModal('new')} style={{ marginLeft: 'auto', padding: '8px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Add Supplier
        </button>
      </div>

      {/* List + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 340px' : '1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((s, i) => {
            const sc = SUPPLIER_STATUS_COLORS[s.status] ?? SUPPLIER_STATUS_COLORS.Active;
            const isSelected = selected?.id === s.id;
            return (
              <div
                key={i}
                onClick={() => setSelected(isSelected ? null : s)}
                style={{
                  background: C.white,
                  borderRadius: 14,
                  padding: '16px 20px',
                  border: `1.5px solid ${isSelected ? C.green : '#EBEBEB'}`,
                  cursor: 'pointer',
                  transition: 'box-shadow .15s, border-color .15s',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.borderColor = '#C8E6C9';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.borderColor = '#EBEBEB';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.white, fontWeight: 700, fontSize: 18, flexShrink: 0 }}>
                    {s.name[0]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{s.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: sc.bg, color: sc.color }}>{s.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.slate }}>{s.category} · {s.contact} · {s.email}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 24, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: C.slate }}>Total Spend</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>RM {s.totalValue.toLocaleString()}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: C.slate }}>POs</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{s.totalPOs}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: C.slate }}>Lead Time</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>{s.leadTime}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: C.slate, marginBottom: 2 }}>Rating</div>
                      <StarRating value={s.rating} />
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal(s);
                      }}
                      style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer', alignSelf: 'center' }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
                {s.products.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {s.products.map((p, pi) => (
                      <span key={pi} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: C.seasalt, color: C.slate }}>
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', color: C.slate, fontSize: 14, background: C.white, borderRadius: 16, border: '1px solid #EBEBEB' }}>
              No suppliers found.
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, alignSelf: 'start', position: 'sticky', top: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.green, lineHeight: 1.3 }}>{selected.name}</div>
                <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{selected.category}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: '#F3F3F3', border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', fontSize: 14, color: C.slate }}>×</button>
            </div>

            <StarRating value={selected.rating} />

            {[
              { label: 'Contact',   value: selected.contact },
              { label: 'Email',     value: selected.email },
              { label: 'Phone',     value: selected.phone },
              { label: 'Payment',   value: selected.paymentTerms },
              { label: 'Lead Time', value: selected.leadTime },
              { label: 'Reg No.',   value: selected.reg },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #F3F3F3', paddingBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 12, color: '#1a1a1a', textAlign: 'right', wordBreak: 'break-all' }}>{value || '—'}</span>
              </div>
            ))}

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Address</div>
              <div style={{ fontSize: 12, color: '#1a1a1a', lineHeight: 1.5 }}>{selected.address}</div>
            </div>

            {selected.notes && (
              <div style={{ background: C.seasalt, borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Notes</div>
                <div style={{ fontSize: 12, color: '#1a1a1a', lineHeight: 1.5 }}>{selected.notes}</div>
              </div>
            )}

            <button onClick={() => setModal(selected)} style={{ padding: '10px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
              Edit Supplier
            </button>
          </div>
        )}
      </div>

      {modal && (
        <SupplierModal
          supplier={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
