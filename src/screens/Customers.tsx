import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { Search } from 'lucide-react';

// ── Types (also imported by Projects.tsx for the project-hub view) ───

export type CustomerType = 'residential' | 'commercial' | 'dealer';

export const CUSTOMER_TYPES: CustomerType[] = ['residential', 'commercial', 'dealer'];

interface MainContact {
  name:  string;
  email: string | null;
  phone: string | null;
}

export interface Customer {
  id: string;
  name: string;
  type: CustomerType;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
}

export const TYPE_LABEL: Record<CustomerType, string> = {
  residential: 'Residential',
  commercial:  'Commercial',
  dealer:      'Dealer',
};

export const TYPE_PALETTE: Record<CustomerType, { bg: string; color: string }> = {
  residential: { bg: '#F3F3F3', color: '#5B6B7A' },
  commercial:  { bg: '#E6F4EA', color: '#1B512D' },
  dealer:      { bg: '#FFF0E0', color: '#B45309' },
};

// ── Shared bits ───────────────────────────────────────────────────

function FieldLabel({ children }: { children: string }) {
  return (
    <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
      {children}
    </label>
  );
}

function inputStyle(): React.CSSProperties {
  return { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
}

// Phone numbers are stored as `+65` + local digits, no spaces. The `+65` is a
// fixed UI prefix; the editable part is the local digits only.
// `localPart` strips a leading +65 / 65 country code (only when long enough that
// it can't be the local number itself), so it's the inverse of the stored form
// without eating a genuine local number that happens to start with 65.
function localPart(full: string): string {
  let d = (full || '').replace(/\D/g, '');
  if (d.startsWith('65') && d.length > 8) d = d.slice(2);
  return d;
}
// Normalise any stored/legacy value for saving: `+65` + local digits, or null.
function storePhone(full: string | undefined | null): string | null {
  const d = localPart(full ?? '');
  return d ? '+65' + d : null;
}

function PhoneInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // The local digits are the source of truth in the input's own state — we never
  // re-derive them from the combined `+65…` value on every render (that round-trip
  // is what made the prefix's "65" leak back in and multiply while typing).
  const [local, setLocal] = useState(() => localPart(value));
  const lastEmitted = useRef(value);

  // Re-seed only when the parent value changes for a reason other than our own
  // emit (e.g. switching to a different customer / contact).
  useEffect(() => {
    if (value !== lastEmitted.current) setLocal(localPart(value));
  }, [value]);

  const emit = (digits: string) => {
    setLocal(digits);
    const full = digits ? '+65' + digits : '';
    lastEmitted.current = full;
    onChange(full);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, overflow: 'hidden' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 12px', fontSize: 13, fontWeight: 600, color: C.slate, background: C.seasalt, borderRight: '1px solid #EBEBEB' }}>+65</span>
      <input type="tel" value={local}
        onChange={(e) => emit(e.target.value.replace(/\D/g, ''))}
        onPaste={(e) => {
          e.preventDefault();
          emit(localPart(e.clipboardData.getData('text')));
        }}
        placeholder="9123 4567"
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', padding: '10px 14px', fontFamily: 'Figtree', fontSize: 13, background: 'transparent' }} />
    </div>
  );
}

// ── Top-level screen — list + add/edit modal ──────────────────────

export function ScreenCustomers() {
  const { can } = usePermissions();
  const canEdit   = can('customers', 'can_edit');
  const canDelete = can('customers', 'can_delete');

  const [rows, setRows]       = useState<Customer[]>([]);
  const [mainContacts, setMainContacts] = useState<Map<string, MainContact>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | CustomerType>('all');
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data, error: err }, { data: contacts }] = await Promise.all([
      supabase.from('customers').select('*').order('name'),
      supabase
        .from('customer_contacts')
        .select('customer_id, name, email, phone, position, created_at')
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);
    setLoading(false);
    if (err) { setError(err.message); return; }
    setError(null);
    setRows((data ?? []) as Customer[]);
    // Build a customer_id → first contact map (rows are already sorted, so
    // the first occurrence wins).
    const map = new Map<string, MainContact>();
    for (const c of (contacts ?? []) as Array<{ customer_id: string; name: string; email: string | null; phone: string | null }>) {
      if (!map.has(c.customer_id)) map.set(c.customer_id, { name: c.name, email: c.email, phone: c.phone });
    }
    setMainContacts(map);
  };

  const openEdit = async (c: Customer) => {
    const { data: contacts } = await supabase
      .from('customer_contacts')
      .select('id, name, email, phone')
      .eq('customer_id', c.id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1);
    const contact = (contacts ?? [])[0] ?? null;
    setEditing({
      customer: c,
      contactId: contact?.id ?? null,
      contactName:  contact?.name  ?? '',
      contactEmail: contact?.email ?? '',
      contactPhone: contact?.phone ?? '',
    });
  };
  useEffect(() => { fetchAll(); }, []);

  const counts = {
    residential: rows.filter((r) => r.type === 'residential').length,
    commercial:  rows.filter((r) => r.type === 'commercial').length,
    dealer:      rows.filter((r) => r.type === 'dealer').length,
  };

  const visible = rows.filter((c) => {
    if (typeFilter !== 'all' && c.type !== typeFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const m = mainContacts.get(c.id);
    return (c.name + ' ' + (m?.name ?? '') + ' ' + (m?.email ?? '') + ' ' + (m?.phone ?? '')).toLowerCase().includes(q);
  });

  const save = async (data: CustomerFormData, id?: string, contactId?: string | null) => {
    const contactPayload = {
      name:  (data.contact_name  ?? '').trim(),
      email: (data.contact_email ?? '').trim() || null,
      phone: storePhone(data.contact_phone),
    };
    if (id) {
      await supabase.from('customers').update({
        name: data.name, type: data.type, address: data.address, notes: data.notes,
      }).eq('id', id);
      // Upsert the main contact row.
      if (contactId) {
        await supabase.from('customer_contacts').update(contactPayload).eq('id', contactId);
      } else if (contactPayload.name || contactPayload.email || contactPayload.phone) {
        await supabase.from('customer_contacts').insert({ ...contactPayload, customer_id: id });
      }
    } else {
      const { data: created } = await supabase
        .from('customers')
        .insert({ name: data.name, type: data.type, address: data.address, notes: data.notes })
        .select()
        .single();
      // Main contact is required on create — seed the first contact row.
      if (created) {
        await supabase.from('customer_contacts').insert({ ...contactPayload, customer_id: created.id });
      }
    }
    await fetchAll();
  };

  const remove = async (id: string) => {
    await supabase.from('customers').delete().eq('id', id);
    await fetchAll();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Total Customers" value={String(rows.length)}        sub="all departments"  accent />
        <KPICard label="Residential"     value={String(counts.residential)} sub="individual accounts" />
        <KPICard label="Commercial"      value={String(counts.commercial)}  sub="business accounts" />
        <KPICard label="Dealer"          value={String(counts.dealer)}      sub="channel partners" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'residential', 'commercial', 'dealer'] as const).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              style={{ padding: '7px 14px', borderRadius: 99, border: `1px solid ${typeFilter === t ? C.green : '#EBEBEB'}`, background: typeFilter === t ? C.green : C.white, color: typeFilter === t ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {t === 'all' ? 'All' : TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', width: 260 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
        </div>
        {canEdit && (
          <button onClick={() => setAdding(true)}
            style={{ marginLeft: 'auto', padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + New Customer
          </button>
        )}
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 660, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Customer', 'Type', 'Attention', 'Email', 'Phone', 'Billing Address'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  {rows.length === 0 ? 'No customers yet. Click "+ New Customer" to add one.' : 'No customers match your filters.'}
                </td></tr>
              ) : visible.map((c) => {
                const p = TYPE_PALETTE[c.type];
                const m = mainContacts.get(c.id);
                const cellCursor = canEdit ? 'pointer' : 'default';
                const open = () => { if (canEdit) void openEdit(c); };
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid #F3F3F3' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: cellCursor }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: C.honeydew, color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                          {c.name.trim().charAt(0).toUpperCase() || '?'}
                        </div>
                        <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{c.name}</span>
                      </div>
                    </td>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: cellCursor }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: p.bg, color: p.color }}>
                        {TYPE_LABEL[c.type]}
                      </span>
                    </td>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: cellCursor, color: m?.name ? '#1a1a1a' : C.slate, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }} title={m?.name ?? ''}>
                      {m?.name ?? '—'}
                    </td>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: cellCursor, color: m?.email ? '#1a1a1a' : C.slate, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }} title={m?.email ?? ''}>
                      {m?.email ?? '—'}
                    </td>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: cellCursor, color: m?.phone ? '#1a1a1a' : C.slate, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {m?.phone ?? '—'}
                    </td>
                    <td onClick={open} style={{ padding: '13px 16px', color: c.address ? '#1a1a1a' : C.slate, cursor: cellCursor, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.address ?? ''}>
                      {c.address ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <CustomerModal title="New Customer" initial={blankCustomer()} canDelete={false}
          onSave={(d) => save(d)} onClose={() => setAdding(false)} />
      )}
      {editing && (
        <CustomerModal key={editing.customer.id} title="Edit Customer" customerId={editing.customer.id}
          initial={{
            name:    editing.customer.name,
            type:    editing.customer.type,
            address: editing.customer.address,
            notes:   editing.customer.notes,
            contact_name:  editing.contactName,
            contact_email: editing.contactEmail,
            contact_phone: editing.contactPhone,
          }}
          canDelete={canDelete}
          onSave={(d) => save(d, editing.customer.id, editing.contactId)}
          onDelete={() => remove(editing.customer.id)}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

interface EditingState {
  customer: Customer;
  contactId: string | null;
  contactName:  string;
  contactEmail: string;
  contactPhone: string;
}

interface CustomerFormData {
  name:    string;
  type:    CustomerType;
  address: string | null;
  notes:   string | null;
  // Main contact (attention / email / phone). Required on both create and edit
  // — the modal upserts the first customer_contacts row.
  contact_name?:  string;
  contact_email?: string;
  contact_phone?: string;
}

function blankCustomer(): CustomerFormData {
  return { name: '', type: 'residential', address: null, notes: null, contact_name: '', contact_email: '', contact_phone: '' };
}

interface CustomerModalProps {
  initial: CustomerFormData;
  title: string;
  canDelete: boolean;
  customerId?: string;
  onSave: (data: CustomerFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

interface ExtraContact { id: string | null; name: string; email: string; phone: string; }

function CustomerModal({ initial, title, canDelete, customerId, onSave, onDelete, onClose }: CustomerModalProps) {
  const [form, setForm] = useState<CustomerFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Additional Contacts tab (edit-only). The first customer_contacts row is the
  // main contact (handled on the Overview tab); the rest live here.
  const [tab, setTab] = useState<'overview' | 'contacts'>('overview');
  const [extras, setExtras] = useState<ExtraContact[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!customerId) return;
    void (async () => {
      const { data } = await supabase
        .from('customer_contacts')
        .select('id, name, email, phone, position, created_at')
        .eq('customer_id', customerId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });
      const all = (data ?? []) as Array<{ id: string; name: string | null; email: string | null; phone: string | null }>;
      setExtras(all.slice(1).map((r) => ({ id: r.id, name: r.name ?? '', email: r.email ?? '', phone: r.phone ?? '' })));
    })();
  }, [customerId]);

  const addExtra = () => setExtras((xs) => [...xs, { id: null, name: '', email: '', phone: '' }]);
  const patchExtra = (i: number, patch: Partial<ExtraContact>) =>
    setExtras((xs) => xs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeExtra = (i: number) =>
    setExtras((xs) => {
      const x = xs[i];
      if (x.id) setDeletedIds((d) => [...d, x.id as string]);
      return xs.filter((_, idx) => idx !== i);
    });

  const set = <K extends keyof CustomerFormData>(k: K, v: CustomerFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name:    form.name.trim(),
      type:    form.type,
      address: form.address && form.address.trim() ? form.address.trim() : null,
      notes:   form.notes   && form.notes.trim()   ? form.notes.trim()   : null,
      contact_name:  form.contact_name?.trim()  || '',
      contact_email: form.contact_email?.trim() || '',
      contact_phone: form.contact_phone?.trim() || '',
    });
    // Sync additional contacts (edit mode only). Inserted without a position so
    // they default like the main contact and sort after it by created_at.
    if (customerId) {
      if (deletedIds.length) await supabase.from('customer_contacts').delete().in('id', deletedIds);
      for (const x of extras) {
        const name = x.name.trim();
        const email = x.email.trim() || null;
        const phone = storePhone(x.phone);
        if (!name && !email && !phone) continue;
        const payload = { name, email, phone };
        if (x.id) await supabase.from('customer_contacts').update(payload).eq('id', x.id);
        else await supabase.from('customer_contacts').insert({ ...payload, customer_id: customerId });
      }
    }
    setSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete!();
    setDeleting(false);
    onClose();
  };

  const canSave = !saving
    && form.name.trim().length > 0
    && (form.contact_name  ?? '').trim().length > 0
    && ((form.contact_email ?? '').trim().length > 0 || (form.contact_phone ?? '').trim().length > 0);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 520, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {/* Overview / Additional Contacts tabs — only when editing an existing customer */}
        {customerId && (
          <div style={{ display: 'flex', gap: 6, background: C.seasalt, borderRadius: 12, padding: 4 }}>
            {(['overview', 'contacts'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                style={{
                  flex: 1, padding: '8px 14px', borderRadius: 9, border: 'none',
                  background: tab === t ? C.white : 'transparent', color: tab === t ? C.green : C.slate,
                  fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                }}>
                {t === 'overview' ? 'Overview' : 'Additional Contacts'}
              </button>
            ))}
          </div>
        )}

        {(!customerId || tab === 'overview') && (<>
        <div>
          <FieldLabel>Customer Name</FieldLabel>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Jane Tan" style={inputStyle()} autoFocus />
        </div>

        <div>
          <FieldLabel>Type</FieldLabel>
          <select value={form.type} onChange={(e) => set('type', e.target.value as CustomerType)}
            style={{ ...inputStyle(), background: C.white, cursor: 'pointer' }}>
            {CUSTOMER_TYPES.map((t) => (<option key={t} value={t}>{TYPE_LABEL[t]}</option>))}
          </select>
        </div>

        <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Main Contact</div>
          <div>
            <FieldLabel>Attention</FieldLabel>
            <input value={form.contact_name ?? ''} onChange={(e) => set('contact_name', e.target.value)}
              placeholder="Jane Tan" style={{ ...inputStyle(), background: C.white }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div>
              <FieldLabel>Email</FieldLabel>
              <input type="email" value={form.contact_email ?? ''} onChange={(e) => set('contact_email', e.target.value)}
                placeholder="jane@acme.com" style={{ ...inputStyle(), background: C.white }} />
            </div>
            <div>
              <FieldLabel>Phone Number</FieldLabel>
              <PhoneInput value={form.contact_phone ?? ''} onChange={(v) => set('contact_phone', v)} />
            </div>
          </div>
        </div>

        <div>
          <FieldLabel>Billing Address</FieldLabel>
          <textarea value={form.address ?? ''} onChange={(e) => set('address', e.target.value || null)} rows={2}
            placeholder="Street, city, postal code…"
            style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        <div>
          <FieldLabel>Notes</FieldLabel>
          <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} rows={3}
            placeholder="Account context, past interactions, billing quirks…"
            style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
        </div>
        </>)}

        {customerId && tab === 'contacts' && (<>
          {extras.length === 0 && (
            <div style={{ fontSize: 13, color: C.slate, textAlign: 'center', padding: '12px 0' }}>
              No additional contacts yet. Add people beyond the main contact below.
            </div>
          )}
          {extras.map((x, i) => (
            <div key={i} style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Contact {i + 1}</div>
                <button type="button" onClick={() => removeExtra(i)}
                  style={{ marginLeft: 'auto', width: 26, height: 26, borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontFamily: 'Figtree' }}>×</button>
              </div>
              <div>
                <FieldLabel>Attention</FieldLabel>
                <input value={x.name} onChange={(e) => patchExtra(i, { name: e.target.value })}
                  placeholder="Contact name" style={{ ...inputStyle(), background: C.white }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div>
                  <FieldLabel>Email</FieldLabel>
                  <input type="email" value={x.email} onChange={(e) => patchExtra(i, { email: e.target.value })}
                    placeholder="name@acme.com" style={{ ...inputStyle(), background: C.white }} />
                </div>
                <div>
                  <FieldLabel>Phone Number</FieldLabel>
                  <PhoneInput value={x.phone} onChange={(v) => patchExtra(i, { phone: v })} />
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addExtra}
            style={{ alignSelf: 'flex-start', padding: '9px 16px', borderRadius: 10, border: `1px dashed ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Add contact
          </button>
        </>)}

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this customer?</div>
            <div style={{ fontSize: 12, color: '#C0321A' }}>Contacts will be removed too. This action is permanent.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {onDelete && canDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Delete
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose}
              style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={!canSave}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
