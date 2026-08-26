import { useState } from 'react';
import { C } from '../theme';
import { supabase } from '../lib/supabase';

export type QuickCustomerType = 'residential' | 'commercial' | 'dealer';

export interface CreatedCustomer {
  id: string;
  name: string;
  type: QuickCustomerType;
  contact_name: string | null;
  contact_email: string | null;
}

// Create a CRM customer without leaving the current flow — used from the
// "+ Add new customer" footer of customer dropdowns (registry registration,
// sales quotes, projects). Writes the same `customers` / `customer_contacts`
// rows the Customers screen manages, then hands the new customer back so the
// caller can select it immediately.
export function CustomerCreateModal({ initialName = '', onClose, onCreated }: {
  initialName?: string;
  onClose: () => void;
  onCreated: (c: CreatedCustomer) => void;
}) {
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<QuickCustomerType>('commercial');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const nm = name.trim();
    if (!nm) { setErr('Customer name is required.'); return; }
    setBusy(true);
    setErr(null);
    const { data: created, error } = await supabase.from('customers')
      .insert({ name: nm, type, address: address.trim() || null, notes: null })
      .select('id').single();
    if (error || !created) { setBusy(false); setErr(error?.message ?? 'Could not create the customer.'); return; }
    const cn = contactName.trim();
    const em = email.trim();
    const ph = phone.trim();
    if (cn || em || ph) {
      const { error: cErr } = await supabase.from('customer_contacts')
        .insert({ customer_id: created.id, name: cn || nm, email: em || null, phone: ph || null, position: 0 });
      if (cErr) { setBusy(false); setErr(`Customer created, but the contact failed: ${cErr.message}`); return; }
    }
    setBusy(false);
    onCreated({ id: created.id, name: nm, type, contact_name: cn || (em || ph ? nm : null), contact_email: em || null });
  };

  const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };

  return (
    // Above the parent modal (those sit at zIndex 1000).
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 440, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>New Customer</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, color: C.slate, fontFamily: 'Figtree' }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5, marginTop: -6 }}>
          Saved straight into the customer CRM — shared with Charger Registry, Sales and Technical Service.
        </div>
        {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 600 }}>{err}</div>}
        <div>
          <label style={label}>Customer name *</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Engineering Pte Ltd" style={inp} />
        </div>
        <div>
          <label style={label}>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as QuickCustomerType)} style={{ ...inp, cursor: 'pointer' }}>
            <option value="commercial">Commercial</option>
            <option value="residential">Residential</option>
            <option value="dealer">Dealer</option>
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={label}>Contact name</label>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="optional" style={inp} />
          </div>
          <div>
            <label style={label}>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="optional" style={inp} />
          </div>
        </div>
        <div>
          <label style={label}>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" style={inp} />
        </div>
        <div>
          <label style={label}>Billing address</label>
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder="optional" style={{ ...inp, resize: 'vertical', lineHeight: 1.5, fontFamily: 'Figtree' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}
            style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void save()} disabled={busy || !name.trim()}
            style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: busy || !name.trim() ? '#9DC7A6' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: busy || !name.trim() ? 'default' : 'pointer' }}>
            {busy ? 'Creating…' : 'Create & select'}
          </button>
        </div>
      </div>
    </div>
  );
}
