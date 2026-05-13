import { useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';

const QUOTE_STATUSES = ['Draft', 'Sent', 'Viewed', 'Accepted', 'Declined', 'Expired'] as const;
type QuoteStatus = (typeof QUOTE_STATUSES)[number];

const QUOTE_STATUS_COLORS: Record<QuoteStatus, { bg: string; color: string }> = {
  Draft:    { bg: '#F3F3F3', color: '#767B77' },
  Sent:     { bg: '#E3F0FF', color: '#1A62C0' },
  Viewed:   { bg: '#F0E8FF', color: '#6B21A8' },
  Accepted: { bg: '#E4F3E3', color: '#1B512D' },
  Declined: { bg: '#FDEAEA', color: '#C0321A' },
  Expired:  { bg: '#FFF0E0', color: '#B45309' },
};

interface SalesProduct {
  id: string;
  name: string;
  price: number;
  install: number;
}
const PRODUCTS: SalesProduct[] = [
  { id: '7kw',  name: '7kW Home Charger',        price: 2800,  install: 599 },
  { id: '22kw', name: '22kW Commercial Charger', price: 6800,  install: 2000 },
  { id: 'dc50', name: 'DC Fast Charger (50kW)',  price: 18000, install: 4500 },
];

interface QuoteLine {
  product: string;
  qty: number;
}
interface Quote {
  id: string;
  customer: string;
  contact: string;
  email: string;
  items: QuoteLine[];
  discount: number;
  notes: string;
  status: QuoteStatus;
  created: string;
  expiry: string;
  type: 'Quotation' | 'Proposal';
}

const INITIAL_QUOTES: Quote[] = [
  { id: 'QT-2026-0042', customer: 'Suria KLCC Sdn Bhd',     contact: 'Roslinda Mohd',   email: 'procurement@suriaklcc.com.my', items: [{ product: '22kw', qty: 6 }],                              discount: 5,  notes: 'Carpark Level B2–B4. Require 3-phase supply assessment.', status: 'Sent',     created: '2026-04-28', expiry: '2026-05-28', type: 'Proposal' },
  { id: 'QT-2026-0041', customer: 'Lee Cheng Wei',          contact: 'Lee Cheng Wei',   email: 'lee.cw@email.com',             items: [{ product: '7kw',  qty: 1 }],                              discount: 0,  notes: 'Terrace house, single phase.',                           status: 'Accepted', created: '2026-04-25', expiry: '2026-05-25', type: 'Quotation' },
  { id: 'QT-2026-0040', customer: 'EcoMall Setia Alam',     contact: 'Faizal Hamid',    email: 'faizal@ecomall.my',            items: [{ product: '22kw', qty: 4 }, { product: 'dc50', qty: 1 }], discount: 8,  notes: 'Phase 1 deployment. Option for Phase 2 in Q3.',          status: 'Viewed',   created: '2026-04-22', expiry: '2026-05-22', type: 'Proposal' },
  { id: 'QT-2026-0039', customer: 'Ahmad Razif Bin Hamid',  contact: 'Ahmad Razif',     email: 'ahmad.razif@email.com',        items: [{ product: '7kw',  qty: 1 }],                              discount: 0,  notes: '',                                                       status: 'Accepted', created: '2026-04-20', expiry: '2026-05-20', type: 'Quotation' },
  { id: 'QT-2026-0038', customer: 'Tropicana Golf & CC',    contact: 'Suresh Nair',     email: 'suresh@tropicana.com.my',      items: [{ product: '22kw', qty: 8 }],                              discount: 10, notes: 'Clubhouse + Valet area. Branded fascia required.',       status: 'Draft',    created: '2026-04-18', expiry: '2026-05-18', type: 'Proposal' },
  { id: 'QT-2026-0037', customer: 'Priya Rajendran',        contact: 'Priya Rajendran', email: 'priya.r@techco.com',           items: [{ product: '22kw', qty: 2 }],                              discount: 0,  notes: 'Office carpark, 2 bays.',                                status: 'Accepted', created: '2026-04-15', expiry: '2026-05-15', type: 'Quotation' },
  { id: 'QT-2026-0036', customer: 'Pavilion Bukit Jalil',   contact: 'Nancy Lim',       email: 'nancy.lim@pavilion.com.my',    items: [{ product: '22kw', qty: 10 }, { product: 'dc50', qty: 2 }],discount: 12, notes: 'Level 3 carpark. Phased delivery preferred.',            status: 'Declined', created: '2026-04-10', expiry: '2026-05-10', type: 'Proposal' },
  { id: 'QT-2026-0035', customer: 'Tan Siew Ling',          contact: 'Tan Siew Ling',   email: 'siewling@email.com',           items: [{ product: '7kw',  qty: 1 }],                              discount: 0,  notes: 'Semi-D, double garage.',                                 status: 'Accepted', created: '2026-04-08', expiry: '2026-05-08', type: 'Quotation' },
  { id: 'QT-2026-0034', customer: 'KL Eco City',            contact: 'Hafizuddin Aris', email: 'hafiz@klcc.com.my',            items: [{ product: '22kw', qty: 5 }],                              discount: 7,  notes: 'Tower B podium carpark.',                                status: 'Expired',  created: '2026-03-28', expiry: '2026-04-28', type: 'Proposal' },
];

function calcQuoteTotal(items: QuoteLine[], discount: number): number {
  const sub = items.reduce((s, item) => {
    const p = PRODUCTS.find((pr) => pr.id === item.product);
    return s + (p ? (p.price + p.install) * item.qty : 0);
  }, 0);
  return sub * (1 - discount / 100);
}

function QuoteBadge({ status }: { status: QuoteStatus }) {
  const s = QUOTE_STATUS_COLORS[status] ?? QUOTE_STATUS_COLORS.Draft;
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

interface QuoteModalProps {
  quote: Quote | null;
  onClose: () => void;
  onSave: (q: Quote) => void;
  onDelete: (id: string) => void;
}

function QuoteModal({ quote, onClose, onSave, onDelete }: QuoteModalProps) {
  const isNew = !quote;
  const [form, setForm] = useState<Quote>(
    quote
      ? { ...quote, items: quote.items.map((i) => ({ ...i })) }
      : {
          id: '',
          customer: '',
          contact: '',
          email: '',
          type: 'Quotation',
          items: [{ product: '7kw', qty: 1 }],
          discount: 0,
          notes: '',
          status: 'Draft',
          created: '2026-05-04',
          expiry: '2026-06-04',
        },
  );

  const total = calcQuoteTotal(form.items, form.discount);
  const subtotal = calcQuoteTotal(form.items, 0);

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { product: '7kw', qty: 1 }] }));
  const removeItem = (i: number) => setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const updateItem = (i: number, key: keyof QuoteLine, val: string | number) =>
    setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)) }));

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{ background: C.white, borderRadius: 20, width: 640, maxHeight: '90vh', overflowY: 'auto', padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>
              {isNew ? 'New Quotation / Proposal' : form.id}
            </div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
              {isNew ? 'Fill in the details below' : `Created ${form.created} · Expires ${form.expiry}`}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F3F3', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: C.slate }}>×</button>
        </div>

        {/* Type + Status */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Document Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['Quotation', 'Proposal'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setForm((f) => ({ ...f, type: t }))}
                  style={{
                    flex: 1,
                    padding: '9px 0',
                    borderRadius: 10,
                    border: `2px solid ${form.type === t ? C.green : '#EBEBEB'}`,
                    background: form.type === t ? C.honeydew : C.white,
                    color: form.type === t ? C.green : C.slate,
                    fontFamily: 'Figtree',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as QuoteStatus }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', color: '#1a1a1a', background: C.white }}
            >
              {QUOTE_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Customer details */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>Customer Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Company / Name</label>
              <input
                value={form.customer}
                onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}
                placeholder="e.g. Suria KLCC Sdn Bhd"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Contact Person</label>
              <input
                value={form.contact}
                onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
                placeholder="e.g. Roslinda Mohd"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Email</label>
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="e.g. procurement@company.com.my"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
              />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Line Items</label>
            <button onClick={addItem} style={{ fontSize: 12, fontWeight: 600, color: C.green, background: C.honeydew, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'Figtree' }}>+ Add Item</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 100px 32px', gap: 8, marginBottom: 6 }}>
            {['Product', 'Qty', 'Unit Price', 'Subtotal', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
            ))}
          </div>
          {form.items.map((item, i) => {
            const prod = PRODUCTS.find((p) => p.id === item.product);
            const unitPrice = prod ? prod.price + prod.install : 0;
            const lineTotal = unitPrice * item.qty;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 100px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select
                  value={item.product}
                  onChange={(e) => updateItem(i, 'product', e.target.value)}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.white }}
                >
                  {PRODUCTS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={item.qty}
                  onChange={(e) => updateItem(i, 'qty', parseInt(e.target.value) || 1)}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', textAlign: 'center', background: C.white }}
                />
                <div style={{ fontSize: 12, color: C.slate, padding: '8px 0' }}>RM {unitPrice.toLocaleString()}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>RM {lineTotal.toLocaleString()}</div>
                <button
                  onClick={() => removeItem(i)}
                  disabled={form.items.length === 1}
                  style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #EBEBEB', background: 'transparent', cursor: form.items.length === 1 ? 'default' : 'pointer', color: '#C0321A', fontSize: 14, opacity: form.items.length === 1 ? 0.3 : 1 }}
                >
                  ×
                </button>
              </div>
            );
          })}

          {/* Totals */}
          <div style={{ borderTop: '1px solid #F3F3F3', marginTop: 8, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: C.slate }}>Subtotal</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>RM {subtotal.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.slate }}>Discount</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.discount}
                  onChange={(e) => setForm((f) => ({ ...f, discount: parseFloat(e.target.value) || 0 }))}
                  style={{ width: 56, padding: '4px 8px', borderRadius: 6, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: C.slate }}>%</span>
                <span style={{ fontSize: 12, color: '#C0321A' }}>− RM {((subtotal * form.discount) / 100).toLocaleString()}</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #F3F3F3' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Total</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.green }}>RM {total.toLocaleString(undefined, { minimumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>

        {/* Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Created Date</label>
            <input type="date" value={form.created} onChange={(e) => setForm((f) => ({ ...f, created: e.target.value }))} style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Expiry Date</label>
            <input type="date" value={form.expiry} onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))} style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none' }} />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Notes / Scope</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={3}
            placeholder="Site details, scope of work, special requirements…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.5, color: '#1a1a1a' }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          {!isNew && (
            <button
              onClick={() => onDelete(quote!.id)}
              style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Delete
            </button>
          )}
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginLeft: isNew ? 0 : 'auto' }}>
            Cancel
          </button>
          <button
            onClick={() => onSave({ ...form, id: form.id || `QT-2026-${String(Date.now()).slice(-4)}` })}
            style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            {isNew ? 'Create' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScreenSales() {
  const [quotes, setQuotes] = useState<Quote[]>(INITIAL_QUOTES);
  const [filterType, setFilterType] = useState<'All' | 'Quotation' | 'Proposal'>('All');
  const [filterStatus, setFilterStatus] = useState<'All' | QuoteStatus>('All');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Quote | 'new' | null>(null);
  const [tab, setTab] = useState<'list' | 'pipeline'>('list');

  const filtered = quotes.filter(
    (q) =>
      (filterType === 'All' || q.type === filterType) &&
      (filterStatus === 'All' || q.status === filterStatus) &&
      (q.customer.toLowerCase().includes(search.toLowerCase()) ||
        q.id.toLowerCase().includes(search.toLowerCase())),
  );

  const handleSave = (form: Quote) => {
    if (quotes.find((q) => q.id === form.id)) {
      setQuotes((qs) => qs.map((q) => (q.id === form.id ? form : q)));
    } else {
      setQuotes((qs) => [form, ...qs]);
    }
    setModal(null);
  };

  const handleDelete = (id: string) => {
    setQuotes((qs) => qs.filter((q) => q.id !== id));
    setModal(null);
  };

  const totalValue = quotes.reduce((s, q) => s + calcQuoteTotal(q.items, q.discount), 0);
  const acceptedValue = quotes
    .filter((q) => q.status === 'Accepted')
    .reduce((s, q) => s + calcQuoteTotal(q.items, q.discount), 0);
  const pendingCount = quotes.filter((q) => (['Sent', 'Viewed'] as QuoteStatus[]).includes(q.status)).length;
  const winRate = Math.round(
    (quotes.filter((q) => q.status === 'Accepted').length /
      quotes.filter((q) => (['Accepted', 'Declined'] as QuoteStatus[]).includes(q.status)).length) *
      100,
  );

  const pipelineStatuses: QuoteStatus[] = ['Draft', 'Sent', 'Viewed', 'Accepted', 'Declined', 'Expired'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Pipeline Value"   value={`RM ${(totalValue / 1000).toFixed(0)}k`}    sub="All active quotes" accent />
        <KPICard label="Accepted Value"   value={`RM ${(acceptedValue / 1000).toFixed(0)}k`} sub="Confirmed this period" trend="22%" trendUp />
        <KPICard label="Awaiting Response" value={pendingCount}                              sub="Sent or viewed" />
        <KPICard label="Win Rate"         value={`${winRate}%`}                              sub="Accepted vs Declined" trend="5pp" trendUp />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 220 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quotes…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
          />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['All', 'Quotation', 'Proposal'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              style={{
                padding: '7px 16px',
                borderRadius: 99,
                border: `1px solid ${filterType === t ? C.green : '#EBEBEB'}`,
                background: filterType === t ? C.green : C.white,
                color: filterType === t ? C.white : C.slate,
                fontFamily: 'Figtree',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['All', ...QUOTE_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                padding: '7px 12px',
                borderRadius: 99,
                border: `1px solid ${filterStatus === s ? C.green : '#EBEBEB'}`,
                background: filterStatus === s ? C.green : 'transparent',
                color: filterStatus === s ? C.white : C.slate,
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

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
            {([['list', '≡ List'], ['pipeline', '◫ Pipeline']] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setTab(v)}
                style={{
                  padding: '7px 14px',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'Figtree',
                  fontSize: 12,
                  fontWeight: 600,
                  background: tab === v ? C.green : 'transparent',
                  color: tab === v ? C.white : C.slate,
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <button onClick={() => setModal('new')} style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + New Quote
          </button>
        </div>
      </div>

      {/* List view */}
      {tab === 'list' && (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Ref', 'Type', 'Customer', 'Contact', 'Items', 'Value', 'Status', 'Expiry'].map((h) => (
                  <th
                    key={h}
                    style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((q, i) => {
                const total = calcQuoteTotal(q.items, q.discount);
                const itemSummary = q.items
                  .map((it) => {
                    const p = PRODUCTS.find((pr) => pr.id === it.product);
                    return `${it.qty}× ${p ? p.name.replace(' Charger', '').replace('Commercial ', '').replace('Home ', '') : it.product}`;
                  })
                  .join(', ');
                return (
                  <tr
                    key={i}
                    style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                    onClick={() => setModal(q)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>{q.id}</td>
                    <td style={{ padding: '13px 16px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: q.type === 'Proposal' ? C.green : C.honeydew,
                          color: q.type === 'Proposal' ? C.white : C.green,
                        }}
                      >
                        {q.type}
                      </span>
                    </td>
                    <td style={{ padding: '13px 16px', fontWeight: 600, color: '#1a1a1a' }}>{q.customer}</td>
                    <td style={{ padding: '13px 16px', color: C.slate }}>{q.contact}</td>
                    <td style={{ padding: '13px 16px', color: C.slate, fontSize: 12 }}>{itemSummary}</td>
                    <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>RM {total.toLocaleString()}</td>
                    <td style={{ padding: '13px 16px' }}><QuoteBadge status={q.status} /></td>
                    <td style={{ padding: '13px 16px', color: C.slate }}>{q.expiry}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', color: C.slate, fontSize: 14 }}>No quotes match your filters.</div>
          )}
        </div>
      )}

      {/* Pipeline view */}
      {tab === 'pipeline' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, alignItems: 'start' }}>
          {pipelineStatuses.map((status) => {
            const sc = QUOTE_STATUS_COLORS[status];
            const colQuotes = quotes.filter(
              (q) =>
                q.status === status &&
                (filterType === 'All' || q.type === filterType) &&
                q.customer.toLowerCase().includes(search.toLowerCase()),
            );
            const colValue = colQuotes.reduce((s, q) => s + calcQuoteTotal(q.items, q.discount), 0);
            return (
              <div key={status}>
                <div style={{ background: sc.bg, borderRadius: 10, padding: '10px 12px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: sc.color }}>{status}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: sc.color, background: 'rgba(255,255,255,0.6)', padding: '1px 7px', borderRadius: 99 }}>{colQuotes.length}</span>
                </div>
                {colValue > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.slate, marginBottom: 8, paddingLeft: 2 }}>RM {colValue.toLocaleString()}</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {colQuotes.map((q) => {
                    const total = calcQuoteTotal(q.items, q.discount);
                    return (
                      <div
                        key={q.id}
                        onClick={() => setModal(q)}
                        style={{ background: C.white, borderRadius: 10, padding: '12px', border: '1px solid #EBEBEB', cursor: 'pointer', transition: 'box-shadow .15s, transform .15s' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,.08)';
                          e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = 'none';
                          e.currentTarget.style.transform = 'none';
                        }}
                      >
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, marginBottom: 4 }}>{q.id}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.green, lineHeight: 1.3, marginBottom: 6 }}>{q.customer}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 6 }}>RM {total.toLocaleString()}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: 5,
                              background: q.type === 'Proposal' ? C.green : C.honeydew,
                              color: q.type === 'Proposal' ? C.white : C.green,
                            }}
                          >
                            {q.type}
                          </span>
                          <span style={{ fontSize: 10, color: C.slate }}>{q.expiry}</span>
                        </div>
                        {q.notes && (
                          <div
                            style={{
                              fontSize: 10,
                              color: C.slate,
                              marginTop: 6,
                              lineHeight: 1.4,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {q.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {colQuotes.length === 0 && (
                    <div style={{ padding: '20px 0', textAlign: 'center', color: '#DADADA', fontSize: 12 }}>Empty</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <QuoteModal
          quote={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
