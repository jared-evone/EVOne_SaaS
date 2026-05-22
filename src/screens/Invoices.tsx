import { useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { Search } from 'lucide-react';

const INVOICE_STATUSES = ['Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled'] as const;
type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const INVOICE_STATUS_COLORS: Record<InvoiceStatus, { bg: string; color: string }> = {
  Draft:     { bg: '#F3F3F3', color: '#767B77' },
  Sent:      { bg: '#E3F0FF', color: '#1A62C0' },
  Paid:      { bg: '#E4F3E3', color: '#1B512D' },
  Overdue:   { bg: '#FDEAEA', color: '#C0321A' },
  Cancelled: { bg: '#FFF0E0', color: '#B45309' },
};

interface InvoiceProduct {
  id: string;
  name: string;
  price: number;
}
const INVOICE_PRODUCTS: InvoiceProduct[] = [
  { id: '7kw',   name: '7kW Home Charger + Installation',       price: 3399 },
  { id: '22kw',  name: '22kW Commercial Charger + Installation', price: 8800 },
  { id: 'dc50',  name: 'DC Fast Charger 50kW + Installation',   price: 22500 },
  { id: 'cable', name: 'Type 2 Charging Cable 7m',              price: 220 },
  { id: 'encl',  name: 'IP67 Weatherproof Enclosure',           price: 380 },
  { id: 'lb',    name: 'Smart Load Balancer Module',            price: 750 },
  { id: 'svc',   name: 'Annual Maintenance Service',            price: 480 },
];

interface InvoiceLineItem {
  product: string;
  qty: number;
}

interface Invoice {
  id: string;
  customer: string;
  address: string;
  email?: string;
  items: InvoiceLineItem[];
  discount: number;
  tax: number;
  notes: string;
  status: InvoiceStatus;
  date: string;
  due: string;
  amount?: string;
  product?: string;
}

const INITIAL_INVOICES: Invoice[] = [
  { id: 'INV-2026-0081', customer: 'Ahmad Razif',         address: 'Bangsar, KL',         items: [{ product: '7kw',  qty: 1 }], discount: 0, tax: 8, notes: '',                              status: 'Paid',      date: '02 May 2026', due: '16 May 2026' },
  { id: 'INV-2026-0080', customer: 'Nurul Ain Bt Hassan', address: 'Petaling Jaya, SL',   items: [{ product: '22kw', qty: 1 }], discount: 0, tax: 8, notes: '',                              status: 'Sent',      date: '01 May 2026', due: '15 May 2026' },
  { id: 'INV-2026-0079', customer: 'Lee Cheng Wei',       address: 'Mont Kiara, KL',      items: [{ product: '7kw',  qty: 1 }], discount: 0, tax: 8, notes: '',                              status: 'Draft',     date: '30 Apr 2026', due: '14 May 2026' },
  { id: 'INV-2026-0078', customer: 'Priya Rajendran',     address: 'Cyberjaya, SL',       items: [{ product: '22kw', qty: 2 }], discount: 5, tax: 8, notes: 'Office carpark 2 bays.',        status: 'Paid',      date: '29 Apr 2026', due: '13 May 2026' },
  { id: 'INV-2026-0077', customer: 'Hafiz Mohd Noor',     address: 'Shah Alam, SL',       items: [{ product: '7kw',  qty: 1 }], discount: 0, tax: 8, notes: '',                              status: 'Cancelled', date: '28 Apr 2026', due: '12 May 2026' },
  { id: 'INV-2026-0076', customer: 'Tan Siew Ling',       address: 'Cheras, KL',          items: [{ product: '7kw',  qty: 1 }], discount: 0, tax: 8, notes: '',                              status: 'Paid',      date: '27 Apr 2026', due: '11 May 2026' },
  { id: 'INV-2026-0075', customer: 'Mohd Farid Roslan',   address: 'Subang, SL',          items: [{ product: '22kw', qty: 1 }], discount: 0, tax: 8, notes: '',                              status: 'Overdue',   date: '26 Apr 2026', due: '10 May 2026' },
];

function calcInvoiceTotal(items: InvoiceLineItem[], discount: number, tax: number): number {
  const sub = items.reduce((s, it) => {
    const p = INVOICE_PRODUCTS.find((pr) => pr.id === it.product);
    return s + (p ? p.price * it.qty : 0);
  }, 0);
  const afterDiscount = sub * (1 - discount / 100);
  return afterDiscount * (1 + tax / 100);
}

function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  const s = INVOICE_STATUS_COLORS[status] ?? INVOICE_STATUS_COLORS.Draft;
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

interface InvoiceModalProps {
  invoice: Invoice | null;
  onClose: () => void;
  onSave: (inv: Invoice) => void;
  onDelete: (id: string) => void;
}

function InvoiceModal({ invoice, onClose, onSave, onDelete }: InvoiceModalProps) {
  const isNew = !invoice;
  const [form, setForm] = useState<Invoice>(
    invoice
      ? { ...invoice, items: invoice.items.map((i) => ({ ...i })) }
      : {
          id: '',
          customer: '',
          address: '',
          email: '',
          items: [{ product: '7kw', qty: 1 }],
          discount: 0,
          tax: 8,
          notes: '',
          status: 'Draft',
          date: '2026-05-04',
          due: '2026-05-18',
        },
  );

  const subtotal = form.items.reduce((s, it) => {
    const p = INVOICE_PRODUCTS.find((pr) => pr.id === it.product);
    return s + (p ? p.price * it.qty : 0);
  }, 0);
  const discountAmt = (subtotal * form.discount) / 100;
  const afterDiscount = subtotal - discountAmt;
  const taxAmt = (afterDiscount * form.tax) / 100;
  const total = afterDiscount + taxAmt;

  const addItem = () =>
    setForm((f) => ({ ...f, items: [...f.items, { product: '7kw', qty: 1 }] }));
  const removeItem = (i: number) =>
    setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const updateItem = (i: number, key: keyof InvoiceLineItem, val: string | number) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)),
    }));

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        style={{ background: C.white, borderRadius: 20, width: 640, maxHeight: '90vh', overflowY: 'auto', padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{isNew ? 'New Invoice' : form.id}</div>
            {!isNew && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>Issued {form.date} · Due {form.due}</div>}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F3F3', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: C.slate }}>×</button>
        </div>

        {/* Status pills */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Status</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {INVOICE_STATUSES.map((s) => {
              const sc = INVOICE_STATUS_COLORS[s];
              return (
                <button
                  key={s}
                  onClick={() => setForm((f) => ({ ...f, status: s }))}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 99,
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

        {/* Customer details */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>Bill To</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Customer / Company</label>
              <input
                value={form.customer}
                onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}
                placeholder="e.g. Ahmad Razif"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="e.g. Bangsar, KL"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Email</label>
              <input
                value={form.email ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="e.g. customer@email.com"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
              />
            </div>
          </div>
        </div>

        {/* Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Issue Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Due Date</label>
            <input
              type="date"
              value={form.due}
              onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none' }}
            />
          </div>
        </div>

        {/* Line items */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Line Items</label>
            <button onClick={addItem} style={{ fontSize: 12, fontWeight: 600, color: C.green, background: C.honeydew, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'Figtree' }}>+ Add Item</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px 90px 32px', gap: 8, marginBottom: 6 }}>
            {['Product', 'Qty', 'Unit Price', 'Subtotal', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
            ))}
          </div>
          {form.items.map((item, i) => {
            const prod = INVOICE_PRODUCTS.find((p) => p.id === item.product);
            const lineTotal = prod ? prod.price * item.qty : 0;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px 90px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select
                  value={item.product}
                  onChange={(e) => updateItem(i, 'product', e.target.value)}
                  style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.white }}
                >
                  {INVOICE_PRODUCTS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={item.qty}
                  onChange={(e) => updateItem(i, 'qty', parseInt(e.target.value) || 1)}
                  style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', textAlign: 'center', background: C.white }}
                />
                <div style={{ fontSize: 12, color: C.slate }}>RM {prod ? prod.price.toLocaleString() : 0}</div>
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
          <div style={{ borderTop: '1px solid #F3F3F3', marginTop: 8, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: C.slate }}>Subtotal</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>RM {subtotal.toLocaleString()}</span>
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
                  style={{ width: 50, padding: '4px 8px', borderRadius: 6, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: C.slate }}>%</span>
                <span style={{ fontSize: 12, color: '#C0321A' }}>− RM {discountAmt.toLocaleString()}</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.slate }}>Tax (SST)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.tax}
                  onChange={(e) => setForm((f) => ({ ...f, tax: parseFloat(e.target.value) || 0 }))}
                  style={{ width: 50, padding: '4px 8px', borderRadius: 6, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: C.slate }}>%</span>
                <span style={{ fontSize: 12, color: C.slate }}>+ RM {taxAmt.toLocaleString()}</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #F3F3F3' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Total</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: C.green }}>
                RM {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            placeholder="Payment instructions, remarks…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          {!isNew && (
            <button
              onClick={() => onDelete(invoice!.id)}
              style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginLeft: isNew ? 0 : 'auto' }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const id = form.id || `INV-2026-${String(Date.now()).slice(-4)}`;
              const amount = `RM ${total.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`;
              const product = form.items
                .map((it) => {
                  const p = INVOICE_PRODUCTS.find((pr) => pr.id === it.product);
                  return `${it.qty}× ${p ? p.name.split('+')[0].trim() : it.product}`;
                })
                .join(', ');
              onSave({ ...form, id, amount, product });
            }}
            style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            {isNew ? 'Create Invoice' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScreenInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [filter, setFilter] = useState<'All' | InvoiceStatus>('All');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Invoice | 'new' | null>(null);

  const statuses: ('All' | InvoiceStatus)[] = ['All', ...INVOICE_STATUSES];
  const filtered = invoices.filter(
    (o) =>
      (filter === 'All' || o.status === filter) &&
      (o.customer.toLowerCase().includes(search.toLowerCase()) ||
        o.id.toLowerCase().includes(search.toLowerCase())),
  );

  const handleSave = (form: Invoice) => {
    if (invoices.find((i) => i.id === form.id)) {
      setInvoices((is) => is.map((i) => (i.id === form.id ? form : i)));
    } else {
      setInvoices((is) => [form, ...is]);
    }
    setModal(null);
  };

  const handleDelete = (id: string) => {
    setInvoices((is) => is.filter((i) => i.id !== id));
    setModal(null);
  };

  const totalPaid = invoices
    .filter((i) => i.status === 'Paid')
    .reduce((s, i) => s + calcInvoiceTotal(i.items, i.discount, i.tax), 0);
  const totalOverdue = invoices.filter((i) => i.status === 'Overdue').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Total Invoices (YTD)"  value="412"                                     sub="vs 358 last year" trend="15.1%" trendUp accent />
        <KPICard label="Collected This Month"  value={`RM ${(totalPaid / 1000).toFixed(1)}k`}  sub="Paid invoices"    trend="13%"   trendUp />
        <KPICard label="Avg. Invoice Value"    value="RM 4,246"                                sub="7kW + 22kW blended" trend="4.2%" trendUp />
        <KPICard label="Overdue"               value={totalOverdue}                            sub="Requires follow-up" trend="1"    trendUp={false} />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: '6px 14px',
                borderRadius: 99,
                border: `1px solid ${filter === s ? C.green : '#EBEBEB'}`,
                background: filter === s ? C.green : C.white,
                color: filter === s ? C.white : C.slate,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'Figtree',
                cursor: 'pointer',
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', width: 220 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoices…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
          />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
        </div>
        <button
          onClick={() => setModal('new')}
          style={{ marginLeft: 'auto', padding: '8px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontSize: 13, fontWeight: 700, fontFamily: 'Figtree', cursor: 'pointer' }}
        >
          + New Invoice
        </button>
      </div>

      {/* Table */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Invoice ID', 'Customer', 'Address', 'Product', 'Amount', 'Status', 'Date'].map((h) => (
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
            {filtered.map((o, i) => {
              const total = calcInvoiceTotal(o.items, o.discount, o.tax);
              const amount =
                o.amount ?? `RM ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              const productSummary =
                o.product ??
                o.items
                  .map((it) => {
                    const p = INVOICE_PRODUCTS.find((pr) => pr.id === it.product);
                    return `${it.qty}× ${p ? p.name.split('+')[0].trim() : it.product}`;
                  })
                  .join(', ');
              return (
                <tr
                  key={i}
                  style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                  onClick={() => setModal(o)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>{o.id}</td>
                  <td style={{ padding: '13px 16px', fontWeight: 600, color: '#1a1a1a' }}>{o.customer}</td>
                  <td style={{ padding: '13px 16px', color: C.slate }}>{o.address}</td>
                  <td style={{ padding: '13px 16px', color: '#1a1a1a', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{productSummary}</td>
                  <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>{amount}</td>
                  <td style={{ padding: '13px 16px' }}><InvoiceBadge status={o.status} /></td>
                  <td style={{ padding: '13px 16px', color: C.slate }}>{o.date}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: C.slate, fontSize: 14 }}>No invoices found.</div>
        )}
      </div>

      {modal && (
        <InvoiceModal
          invoice={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
