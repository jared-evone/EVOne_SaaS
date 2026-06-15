import { useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { Search } from 'lucide-react';

const PO_STATUSES = ['Draft', 'Submitted', 'Approved', 'Received', 'Partial', 'Cancelled'] as const;
type POStatus = (typeof PO_STATUSES)[number];

const PO_STATUS_COLORS: Record<POStatus, { bg: string; color: string }> = {
  Draft:     { bg: '#F3F3F3', color: '#767B77' },
  Submitted: { bg: '#E3F0FF', color: '#1A62C0' },
  Approved:  { bg: '#F0E8FF', color: '#6B21A8' },
  Received:  { bg: '#E4F3E3', color: '#1B512D' },
  Partial:   { bg: '#FFF8E1', color: '#B07D00' },
  Cancelled: { bg: '#FDEAEA', color: '#C0321A' },
};

interface Supplier {
  id: string;
  name: string;
  contact: string;
  email: string;
}
export const SUPPLIERS: Supplier[] = [
  { id: 'evdb',      name: 'EVDB Technology Sdn Bhd',     contact: 'Kevin Tan',      email: 'kevin@evdb.com.my' },
  { id: 'schneider', name: 'Schneider Electric Malaysia', contact: 'Azrul Ismail',   email: 'azrul@schneider.com.my' },
  { id: 'hager',     name: 'Hager Malaysia Sdn Bhd',      contact: 'Priscilla Wong', email: 'priscilla@hager.com.my' },
  { id: 'local',     name: 'EVOne Internal Stock',        contact: 'Warehouse Team', email: 'warehouse@evone.com.my' },
];

interface POProduct {
  id: string;
  name: string;
  unit: string;
  price: number;
}
const PO_PRODUCTS: POProduct[] = [
  { id: 'unit_7kw',    name: '7kW Charger Unit',         unit: 'unit', price: 1800 },
  { id: 'unit_22kw',   name: '22kW Charger Unit',        unit: 'unit', price: 5200 },
  { id: 'unit_dc50',   name: 'DC 50kW Charger Unit',     unit: 'unit', price: 14000 },
  { id: 'cable_7m',    name: 'Type 2 Cable 7m',          unit: 'pcs',  price: 120 },
  { id: 'mcb_32a',     name: 'MCB 32A',                  unit: 'pcs',  price: 45 },
  { id: 'rccb_typeA',  name: 'RCCB Type A 30mA',         unit: 'pcs',  price: 180 },
  { id: 'isolator',    name: 'Isolator Switch',          unit: 'pcs',  price: 65 },
  { id: 'conduit',     name: 'Conduit & Fittings (set)', unit: 'set',  price: 95 },
  { id: 'wallbox_acc', name: 'Wallbox Accessories Kit',  unit: 'set',  price: 55 },
];

interface POLine {
  product: string;
  qty: number;
}
interface PO {
  id: string;
  supplier?: string;
  customer?: string;
  contact?: string;
  items: POLine[];
  discount: number;
  notes: string;
  status: POStatus;
  created: string;
  delivery: string;
  ref: string;
}

const INITIAL_POS_OUTGOING: PO[] = [
  { id: 'PO-OUT-2026-0031', supplier: 'evdb',      items: [{ product: 'unit_7kw', qty: 20 }, { product: 'unit_22kw', qty: 6 }],                                            discount: 5,  notes: 'Monthly restock. Deliver to Sunway Velocity warehouse.', status: 'Received',  created: '2026-04-15', delivery: '2026-04-28', ref: 'EVDB-SO-4421' },
  { id: 'PO-OUT-2026-0030', supplier: 'hager',     items: [{ product: 'rccb_typeA', qty: 50 }, { product: 'mcb_32a', qty: 50 }, { product: 'isolator', qty: 50 }],         discount: 0,  notes: 'Electrical components for Q2 installations.',           status: 'Received',  created: '2026-04-10', delivery: '2026-04-20', ref: 'HMY-2026-889' },
  { id: 'PO-OUT-2026-0029', supplier: 'evdb',      items: [{ product: 'unit_7kw', qty: 10 }, { product: 'cable_7m', qty: 10 }],                                            discount: 0,  notes: 'Urgent top-up for Bangsar + PJ.',                       status: 'Approved',  created: '2026-04-28', delivery: '2026-05-05', ref: '' },
  { id: 'PO-OUT-2026-0028', supplier: 'schneider', items: [{ product: 'unit_22kw', qty: 4 }, { product: 'unit_dc50', qty: 1 }],                                            discount: 8,  notes: 'EcoMall Setia Alam project supply.',                    status: 'Submitted', created: '2026-04-30', delivery: '2026-05-10', ref: '' },
  { id: 'PO-OUT-2026-0027', supplier: 'hager',     items: [{ product: 'conduit', qty: 30 }, { product: 'wallbox_acc', qty: 20 }],                                          discount: 0,  notes: '',                                                       status: 'Draft',     created: '2026-05-02', delivery: '2026-05-12', ref: '' },
  { id: 'PO-OUT-2026-0026', supplier: 'evdb',      items: [{ product: 'unit_22kw', qty: 10 }, { product: 'unit_dc50', qty: 2 }],                                           discount: 10, notes: 'Tropicana Golf & CC. Confirm branded fascia lead time.', status: 'Cancelled', created: '2026-04-01', delivery: '2026-04-20', ref: '' },
];

const INITIAL_POS_INCOMING: PO[] = [
  { id: 'PO-IN-2026-0021', customer: 'YTL PowerSeraya',      contact: 'procurement@ytl.com.my',          items: [{ product: 'unit_22kw', qty: 18 }],                              discount: 12, notes: 'Phased delivery: 9 units May, 9 units Jun.', status: 'Approved',  created: '2026-04-20', delivery: '2026-05-15', ref: 'YTL-PO-2026-087' },
  { id: 'PO-IN-2026-0020', customer: 'Suria KLCC Sdn Bhd',   contact: 'procurement@suriaklcc.com.my',    items: [{ product: 'unit_22kw', qty: 6 }],                               discount: 5,  notes: 'Carpark B2–B4. Include installation.',       status: 'Submitted', created: '2026-04-28', delivery: '2026-05-20', ref: 'SKLCC-PO-0044' },
  { id: 'PO-IN-2026-0019', customer: 'EcoMall Setia Alam',   contact: 'faizal@ecomall.my',               items: [{ product: 'unit_22kw', qty: 4 }, { product: 'unit_dc50', qty: 1 }], discount: 8, notes: 'Phase 1 only. Phase 2 TBC Q3.',             status: 'Received',  created: '2026-04-05', delivery: '2026-04-22', ref: 'ECOM-2026-113' },
  { id: 'PO-IN-2026-0018', customer: 'Priya Rajendran',      contact: 'priya.r@techco.com',              items: [{ product: 'unit_22kw', qty: 2 }],                               discount: 0,  notes: 'Office carpark 2 bays.',                    status: 'Received',  created: '2026-04-01', delivery: '2026-04-15', ref: 'PR-2026-02' },
  { id: 'PO-IN-2026-0017', customer: 'Tropicana Golf & CC',  contact: 'suresh@tropicana.com.my',         items: [{ product: 'unit_22kw', qty: 8 }],                               discount: 10, notes: 'Pending board approval.',                   status: 'Draft',     created: '2026-05-01', delivery: '2026-05-30', ref: '' },
  { id: 'PO-IN-2026-0016', customer: 'Pavilion Bukit Jalil', contact: 'nancy.lim@pavilion.com.my',       items: [{ product: 'unit_22kw', qty: 10 }, { product: 'unit_dc50', qty: 2 }], discount: 12, notes: '',                                       status: 'Cancelled', created: '2026-03-28', delivery: '2026-04-25', ref: 'PBJ-PO-2026-55' },
];

function calcPOTotal(items: POLine[], discount: number): number {
  const sub = items.reduce((s, item) => {
    const p = PO_PRODUCTS.find((pr) => pr.id === item.product);
    return s + (p ? p.price * item.qty : 0);
  }, 0);
  return sub * (1 - discount / 100);
}

function POBadge({ status }: { status: POStatus }) {
  const s = PO_STATUS_COLORS[status] ?? PO_STATUS_COLORS.Draft;
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

interface POModalProps {
  po: PO | null;
  direction: 'outgoing' | 'incoming';
  onClose: () => void;
  onSave: (p: PO) => void;
  onDelete: (id: string) => void;
}

function POModal({ po, direction, onClose, onSave, onDelete }: POModalProps) {
  const isNew = !po;
  const [form, setForm] = useState<PO>(
    po
      ? { ...po, items: po.items.map((i) => ({ ...i })) }
      : {
          id: '',
          customer: '',
          contact: '',
          supplier: 'evdb',
          items: [{ product: 'unit_7kw', qty: 1 }],
          discount: 0,
          notes: '',
          status: 'Draft',
          created: '2026-05-04',
          delivery: '2026-05-18',
          ref: '',
        },
  );

  const subtotal = form.items.reduce((s, it) => {
    const p = PO_PRODUCTS.find((pr) => pr.id === it.product);
    return s + (p ? p.price * it.qty : 0);
  }, 0);
  const total = subtotal * (1 - form.discount / 100);
  const supplier = SUPPLIERS.find((s) => s.id === form.supplier);

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { product: 'unit_7kw', qty: 1 }] }));
  const removeItem = (i: number) => setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const updateItem = (i: number, key: keyof POLine, val: string | number) =>
    setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)) }));

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: C.white, borderRadius: 20, width: 640, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{isNew ? `New ${direction === 'outgoing' ? 'Outgoing' : 'Incoming'} PO` : form.id}</div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 99,
                  background: direction === 'outgoing' ? '#E3F0FF' : C.honeydew,
                  color: direction === 'outgoing' ? '#1A62C0' : C.green,
                }}
              >
                {direction === 'outgoing' ? '↑ Outgoing' : '↓ Incoming'}
              </span>
            </div>
            {!isNew && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>Created {form.created} · Delivery {form.delivery}</div>}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F3F3', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: C.slate }}>×</button>
        </div>

        {/* Status pills */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Status</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PO_STATUSES.map((s) => {
              const sc = PO_STATUS_COLORS[s];
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

        {/* Party */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>{direction === 'outgoing' ? 'Supplier' : 'Customer'}</div>
          {direction === 'outgoing' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Select Supplier</label>
                <select
                  value={form.supplier ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
                >
                  {SUPPLIERS.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              {supplier && (
                <div style={{ display: 'flex', gap: 20 }}>
                  <span style={{ fontSize: 12, color: C.slate }}>Contact: <strong style={{ color: '#1a1a1a' }}>{supplier.contact}</strong></span>
                  <span style={{ fontSize: 12, color: C.slate }}>Email: <strong style={{ color: '#1a1a1a' }}>{supplier.email}</strong></span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Company / Name</label>
                <input
                  value={form.customer ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}
                  placeholder="e.g. YTL PowerSeraya"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.slate, display: 'block', marginBottom: 5 }}>Contact Email</label>
                <input
                  value={form.contact ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
                  placeholder="e.g. procurement@company.com"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Line items */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Items</label>
            <button onClick={addItem} style={{ fontSize: 12, fontWeight: 600, color: C.green, background: C.honeydew, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'Figtree' }}>+ Add Item</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 560 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px 90px 32px', gap: 8, marginBottom: 6 }}>
            {['Product', 'Qty', 'Unit Price', 'Subtotal', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
            ))}
          </div>
          {form.items.map((item, i) => {
            const prod = PO_PRODUCTS.find((p) => p.id === item.product);
            const lineTotal = prod ? prod.price * item.qty : 0;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px 90px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select
                  value={item.product}
                  onChange={(e) => updateItem(i, 'product', e.target.value)}
                  style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.white }}
                >
                  {PO_PRODUCTS.map((p) => (
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
                <div style={{ fontSize: 12, color: C.slate }}>${prod ? prod.price.toLocaleString() : 0}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>${lineTotal.toLocaleString()}</div>
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
          </div>
          </div>
          <div style={{ borderTop: '1px solid #F3F3F3', marginTop: 8, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: C.slate }}>Subtotal</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>${subtotal.toLocaleString()}</span>
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
                <span style={{ fontSize: 12, color: '#C0321A' }}>− ${((subtotal * form.discount) / 100).toLocaleString()}</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #F3F3F3' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Total</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.green }}>${total.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Dates + ref */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Created</label>
            <input type="date" value={form.created} onChange={(e) => setForm((f) => ({ ...f, created: e.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Delivery Date</label>
            <input type="date" value={form.delivery} onChange={(e) => setForm((f) => ({ ...f, delivery: e.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>External Ref</label>
            <input value={form.ref} onChange={(e) => setForm((f) => ({ ...f, ref: e.target.value }))} placeholder="Supplier/customer PO ref…" style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none' }} />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            placeholder="Delivery instructions, special requirements…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          {!isNew && (
            <button
              onClick={() => onDelete(po!.id)}
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
            onClick={() =>
              onSave({
                ...form,
                id:
                  form.id ||
                  `PO-${direction === 'outgoing' ? 'OUT' : 'IN'}-2026-${String(Date.now()).slice(-4)}`,
              })
            }
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            {isNew ? 'Create PO' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function POTable({
  pos,
  direction,
  onRowClick,
}: {
  pos: PO[];
  direction: 'outgoing' | 'incoming';
  onRowClick: (p: PO) => void;
}) {
  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.seasalt }}>
            {['PO Ref', direction === 'outgoing' ? 'Supplier' : 'Customer', 'Items', 'Total', 'Created', 'Delivery', 'Ext. Ref', 'Status'].map((h) => (
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
          {pos.map((po, i) => {
            const total = calcPOTotal(po.items, po.discount);
            const party =
              direction === 'outgoing'
                ? SUPPLIERS.find((s) => s.id === po.supplier)?.name ?? po.supplier ?? ''
                : po.customer ?? '';
            const itemSummary = po.items
              .map((it) => {
                const p = PO_PRODUCTS.find((pr) => pr.id === it.product);
                return `${it.qty}× ${p ? p.name.replace(' Unit', '').replace(' Charger', '') : it.product}`;
              })
              .join(', ');
            return (
              <tr
                key={i}
                style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                onClick={() => onRowClick(po)}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '12px 14px', fontWeight: 700, color: C.green }}>{po.id}</td>
                <td style={{ padding: '12px 14px', fontWeight: 600, color: '#1a1a1a' }}>{party}</td>
                <td style={{ padding: '12px 14px', color: C.slate, fontSize: 12 }}>{itemSummary}</td>
                <td style={{ padding: '12px 14px', fontWeight: 700, color: C.green }}>${total.toLocaleString()}</td>
                <td style={{ padding: '12px 14px', color: C.slate }}>{po.created}</td>
                <td style={{ padding: '12px 14px', color: C.slate }}>{po.delivery}</td>
                <td style={{ padding: '12px 14px', color: C.slate, fontSize: 12 }}>{po.ref || '—'}</td>
                <td style={{ padding: '12px 14px' }}><POBadge status={po.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {pos.length === 0 && (
        <div style={{ padding: '32px', textAlign: 'center', color: C.slate, fontSize: 14 }}>No purchase orders found.</div>
      )}
    </div>
  );
}

export function ScreenPurchaseOrders() {
  const [outgoing, setOutgoing] = useState<PO[]>(INITIAL_POS_OUTGOING);
  const [incoming, setIncoming] = useState<PO[]>(INITIAL_POS_INCOMING);
  const [direction, setDirection] = useState<'outgoing' | 'incoming'>('outgoing');
  const [filterStatus, setFilterStatus] = useState<'All' | POStatus>('All');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<PO | 'new' | null>(null);

  const current = direction === 'outgoing' ? outgoing : incoming;
  const setCurrent = direction === 'outgoing' ? setOutgoing : setIncoming;

  const filtered = current.filter(
    (po) =>
      (filterStatus === 'All' || po.status === filterStatus) &&
      (po.id.toLowerCase().includes(search.toLowerCase()) ||
        (direction === 'outgoing'
          ? (SUPPLIERS.find((s) => s.id === po.supplier)?.name ?? '').toLowerCase().includes(search.toLowerCase())
          : (po.customer ?? '').toLowerCase().includes(search.toLowerCase()))),
  );

  const handleSave = (form: PO) => {
    if (current.find((p) => p.id === form.id)) {
      setCurrent((ps) => ps.map((p) => (p.id === form.id ? form : p)));
    } else {
      setCurrent((ps) => [form, ...ps]);
    }
    setModal(null);
  };

  const handleDelete = (id: string) => {
    setCurrent((ps) => ps.filter((p) => p.id !== id));
    setModal(null);
  };

  const totalOutValue = outgoing
    .filter((p) => p.status !== 'Cancelled')
    .reduce((s, p) => s + calcPOTotal(p.items, p.discount), 0);
  const totalInValue = incoming
    .filter((p) => p.status !== 'Cancelled')
    .reduce((s, p) => s + calcPOTotal(p.items, p.discount), 0);
  const pendingDelivery = outgoing.filter((p) =>
    (['Approved', 'Submitted', 'Partial'] as POStatus[]).includes(p.status),
  ).length;
  const pendingApproval = incoming.filter((p) =>
    (['Submitted', 'Draft'] as POStatus[]).includes(p.status),
  ).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Outgoing PO Value" value={`$${(totalOutValue / 1000).toFixed(0)}k`} sub="Active supplier orders" accent />
        <KPICard label="Incoming PO Value" value={`$${(totalInValue / 1000).toFixed(0)}k`}  sub="Customer orders received" trend="18%" trendUp />
        <KPICard label="Pending Delivery"  value={pendingDelivery}                            sub="Awaiting supplier delivery" />
        <KPICard label="Awaiting Approval" value={pendingApproval}                            sub="Incoming POs to confirm" />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
          {([['outgoing', '↑ Outgoing'], ['incoming', '↓ Incoming']] as const).map(([d, l]) => (
            <button
              key={d}
              onClick={() => {
                setDirection(d);
                setFilterStatus('All');
                setSearch('');
              }}
              style={{
                padding: '8px 20px',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'Figtree',
                fontSize: 13,
                fontWeight: 700,
                background: direction === d ? (d === 'outgoing' ? '#E3F0FF' : C.honeydew) : 'transparent',
                color: direction === d ? (d === 'outgoing' ? '#1A62C0' : C.green) : C.slate,
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: 200 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}
          />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['All', ...PO_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                padding: '6px 12px',
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

        <button
          onClick={() => setModal('new')}
          style={{ marginLeft: 'auto', padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + New PO
        </button>
      </div>

      {/* Summary bar */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          padding: '12px 16px',
          background: direction === 'outgoing' ? '#E3F0FF' : C.honeydew,
          borderRadius: 12,
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: direction === 'outgoing' ? '#1A62C0' : C.green }}>
          {direction === 'outgoing' ? '↑ Outgoing — orders placed with suppliers' : '↓ Incoming — orders received from customers'}
        </span>
        <span style={{ fontSize: 12, color: direction === 'outgoing' ? '#1A62C0' : C.green, marginLeft: 'auto' }}>
          {filtered.length} records · RM{' '}
          {filtered.reduce((s, p) => s + calcPOTotal(p.items, p.discount), 0).toLocaleString()}
        </span>
      </div>

      <POTable pos={filtered} direction={direction} onRowClick={(p) => setModal(p)} />

      {modal && (
        <POModal
          po={modal === 'new' ? null : modal}
          direction={direction}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
