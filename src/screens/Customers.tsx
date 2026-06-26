import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { Search, Upload, ChevronDown, AlertTriangle } from 'lucide-react';

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
  const { can, isAdmin } = usePermissions();
  const canEdit   = can('customers', 'can_edit');
  const canDelete = can('customers', 'can_delete');

  const [rows, setRows]       = useState<Customer[]>([]);
  const [mainContacts, setMainContacts] = useState<Map<string, MainContact>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | CustomerType>('all');
  const [adding, setAdding]   = useState(false);
  const [importing, setImporting] = useState(false);
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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            {isAdmin && (
              <button onClick={() => setImporting(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <Upload size={14} strokeWidth={2.25} /> Bulk Upload
              </button>
            )}
            <button onClick={() => setAdding(true)}
              style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + New Customer
            </button>
          </div>
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
      {importing && isAdmin && (
        <CustomerImportModal existing={rows} onClose={() => setImporting(false)}
          onDone={fetchAll} />
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

// ── Bulk import (CSV / XLSX) ───────────────────────────────────────
//
// Parses a customer-master export, groups invoice rows into one customer per
// company (each distinct person → a contact, primary = latest invoice date),
// fuzzy-matches against existing customers, and flags messy rows. Nothing is
// written until the user reviews & confirms; merges dedupe contacts and never
// overwrite existing data.

type ImportAction = 'new' | 'merge' | 'skip';
interface ImportContact { name: string; email: string; phone: string; invDate: string; flags: string[]; }
interface ImportCompany {
  key: string;
  company: string;
  type: CustomerType;
  address: string;
  contacts: ImportContact[];
  flags: string[];
  action: ImportAction;
  mergeTargetId: string | null;
  bestMatch: { id: string; name: string; score: number } | null;
}

function normKey(s: string): string {
  return (s || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(pte\.?|ltd\.?|limited|llp|co\.?|corporation|inc\.?|pl)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function diceSim(aRaw: string, bRaw: string): number {
  const a = normKey(aRaw), b = normKey(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  for (const [g, n] of A) { total += n; if (B.has(g)) inter += Math.min(n, B.get(g)!); }
  for (const [, n] of B) total += n;
  return total ? (2 * inter) / total : 0;
}
const SG_POSTAL = /\b\d{6}\b/;
const ADDRESSY = /\b(road|rd|street|st|ave|avenue|lane|ln|drive|dr|cres|crescent|park|terrace|walk|close|blk|block|jalan|lorong|tuas|bukit|loop|link|sector|industrial|building|hub)\b|#\d/i;
const looksLikeAddress = (s: string) => !!s && (SG_POSTAL.test(s) || ADDRESSY.test(s));

function normPhone(p: string): { value: string; flag: string | null } {
  if (!p) return { value: '', flag: null };
  const dual = p.includes('/');
  const first = p.split('/')[0].trim();
  let digits = first.replace(/[^\d+]/g, '');
  if (digits.startsWith('+65')) digits = digits.slice(3);
  else if (digits.startsWith('65') && digits.length === 10) digits = digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^[896]\d{7}$/.test(digits)) return { value: '+65' + digits, flag: dual ? 'dual-phone' : null };
  return { value: first, flag: 'foreign/odd-phone' };
}
const parseDmy = (s: string): number => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || '').trim()); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0; };
const normName = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function buildCompanies(rows: string[][], existing: Customer[]): ImportCompany[] {
  if (!rows.length) return [];
  const header = rows[0].map((h) => (h || '').toString().trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => h === name.toLowerCase());
  const ci = {
    company: col('Customer / Company'), type: col('Type'), contact: col('Contact Person'),
    invDate: col('Latest Invoice Date'), phone: col('Phone'), email: col('Email'), address: col('Address'),
  };
  if (ci.company < 0) return [];

  const groups = new Map<string, { display: string; type: string; rows: Array<{ contact: string; email: string; phone: string; address: string; invDate: string; flags: string[] }> }>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const companyRaw = (row[ci.company] || '').toString().trim();
    if (!companyRaw) continue;
    const type = (row[ci.type] || '').toString().trim();
    let contact = (row[ci.contact] || '').toString().trim();
    let address = (row[ci.address] || '').toString().trim();
    const invDate = (row[ci.invDate] || '').toString().trim();
    const flags = new Set<string>();
    const isIndividual = type.toLowerCase() === 'individual';

    // Individual rows are often column-shifted: contact cell holds the address, address cell the name.
    if (isIndividual && looksLikeAddress(contact) && !looksLikeAddress(address)) {
      flags.add('shifted-columns');
      const realName = address; address = contact; contact = realName;
    }
    // For companies, a contact cell that just repeats the company name means there's no
    // real person — blank it. For individuals the person legitimately IS the name, so keep it.
    if (!isIndividual && normKey(contact) === normKey(companyRaw)) { flags.add('contact=company'); contact = ''; }
    else if (looksLikeAddress(contact)) flags.add('contact-looks-like-address');

    const ph = normPhone((row[ci.phone] || '').toString());
    if (ph.flag) flags.add(ph.flag);
    const emailRaw = (row[ci.email] || '').toString().trim();
    if (emailRaw.includes('/')) flags.add('dual-email');
    const email = emailRaw.split('/')[0].trim();

    // Grouping key: per-company, EXCEPT junk/unknown rows which must stay distinct.
    const nk = normKey(companyRaw);
    let key: string, display = companyRaw;
    if (!nk || nk === 'unknown') { key = `row:${r}`; display = contact || companyRaw; flags.add('was-unknown'); }
    else key = nk;

    if (!groups.has(key)) groups.set(key, { display, type, rows: [] });
    const g = groups.get(key)!;
    if (display.length > g.display.length && !/^cash sales/i.test(display)) g.display = display;
    g.rows.push({ contact, email, phone: ph.value, address, invDate, flags: [...flags] });
  }

  const out: ImportCompany[] = [];
  for (const [key, g] of groups) {
    // Distinct contacts (by name+email), keep the latest-invoice variant; sort primary first.
    const byContact = new Map<string, { contact: string; email: string; phone: string; address: string; invDate: string; flags: string[] }>();
    for (const row of g.rows) {
      const ck = (row.contact + '|' + row.email).toLowerCase();
      const prev = byContact.get(ck);
      if (!prev || parseDmy(row.invDate) > parseDmy(prev.invDate)) byContact.set(ck, row);
    }
    let contacts: ImportContact[] = [...byContact.values()]
      .filter((c) => c.contact || c.email || c.phone)
      .sort((a, b) => parseDmy(b.invDate) - parseDmy(a.invDate))
      .map((c) => ({ name: c.contact, email: c.email, phone: c.phone, invDate: c.invDate, flags: c.flags }));
    const address = [...g.rows].sort((a, b) => parseDmy(b.invDate) - parseDmy(a.invDate))
      .map((r) => r.address).find((a) => a && a.toLowerCase() !== 'singapore singapore') ?? '';
    const flags = [...new Set(g.rows.flatMap((r) => r.flags))];
    const type: CustomerType = g.type.toLowerCase() === 'individual' ? 'residential' : 'commercial';

    const isJunk = /^cash sales|^test$/i.test(g.display.trim());
    const baseFlags = isJunk ? [...flags, 'junk/cash-sale'] : flags;
    const company: ImportCompany = { key, company: g.display, type, address, contacts, flags: baseFlags, action: 'new', mergeTargetId: null, bestMatch: null };
    out.push({ ...company, ...resolveMatch(company, existing) });
  }
  out.sort(flaggedFirst);
  return out;
}

// (Re)compute a company's best existing match + suggested action. Run at parse time and
// again after each imported batch against the refreshed customer list, so later rows match
// against customers created in earlier batches instead of duplicating them. Preserves the
// company's data-quality flags; only the match-derived ones (verify-match) are recomputed.
function resolveMatch(c: ImportCompany, existing: Customer[]): Pick<ImportCompany, 'bestMatch' | 'action' | 'mergeTargetId' | 'flags'> {
  let best: { id: string; name: string; score: number } | null = null;
  for (const e of existing) { const s = diceSim(c.company, e.name); if (!best || s > best.score) best = { id: e.id, name: e.name, score: s }; }
  const baseFlags = c.flags.filter((f) => f !== 'verify-match');
  const keep = best && best.score >= 0.4 ? best : null;
  if (baseFlags.includes('junk/cash-sale')) return { bestMatch: keep, action: 'skip', mergeTargetId: null, flags: baseFlags };
  if (best && best.score >= 0.985) return { bestMatch: best, action: 'merge', mergeTargetId: best.id, flags: baseFlags };
  if (best && best.score >= 0.6) return { bestMatch: best, action: 'merge', mergeTargetId: best.id, flags: [...baseFlags, 'verify-match'] };
  return { bestMatch: keep, action: 'new', mergeTargetId: null, flags: baseFlags };
}
function flaggedFirst(a: ImportCompany, b: ImportCompany): number {
  const rank = (c: ImportCompany) => (c.flags.includes('verify-match') || c.flags.includes('shifted-columns') || c.flags.includes('was-unknown') ? 0 : c.action === 'merge' ? 1 : c.action === 'new' ? 2 : 3);
  return rank(a) - rank(b) || a.company.localeCompare(b.company);
}

const FLAG_LABEL: Record<string, string> = {
  'verify-match': 'Verify match', 'shifted-columns': 'Shifted columns', 'was-unknown': 'Was _Unknown',
  'contact=company': 'No named contact', 'contact-looks-like-address': 'Contact looks like address',
  'foreign/odd-phone': 'Foreign phone', 'dual-phone': '2 phones', 'dual-email': '2 emails', 'junk/cash-sale': 'Cash-sale / junk',
};

const BATCH_SIZE = 50;

function CustomerImportModal({ existing, onClose, onDone }: { existing: Customer[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [phase, setPhase] = useState<'pick' | 'review' | 'committing' | 'done'>('pick');
  const [companies, setCompanies] = useState<ImportCompany[]>([]);
  const [cursor, setCursor] = useState(0); // index of the first row in the current batch
  const [existingList, setExistingList] = useState<Customer[]>(existing); // refreshed after each batch
  const [totals, setTotals] = useState({ created: 0, merged: 0, contacts: 0, skipped: 0, errors: [] as string[] });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ created: number; merged: number; contacts: number; skipped: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const existingSorted = [...existingList].sort((a, b) => a.name.localeCompare(b.name));
  const total = companies.length;
  const batch = companies.slice(cursor, cursor + BATCH_SIZE);
  const batchNum = Math.floor(cursor / BATCH_SIZE) + 1;
  const totalBatches = Math.max(1, Math.ceil(total / BATCH_SIZE));
  const rangeEnd = Math.min(cursor + BATCH_SIZE, total);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][];
      const built = buildCompanies(rows, existing);
      if (!built.length) { setError('No "Customer / Company" column found, or the file is empty. Expected the customer-master export.'); return; }
      setCompanies(built);
      setCursor(0);
      setExistingList(existing);
      setTotals({ created: 0, merged: 0, contacts: 0, skipped: 0, errors: [] });
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file. Use the .csv or .xlsx export.');
    }
  };

  const patch = (key: string, p: Partial<ImportCompany>) =>
    setCompanies((cs) => cs.map((c) => (c.key === key ? { ...c, ...p } : c)));

  const counts = {
    new: batch.filter((c) => c.action === 'new').length,
    merge: batch.filter((c) => c.action === 'merge').length,
    skip: batch.filter((c) => c.action === 'skip').length,
    contacts: batch.filter((c) => c.action !== 'skip').reduce((n, c) => n + c.contacts.length, 0),
  };
  const batchHasUnsetMerge = batch.some((c) => c.action === 'merge' && !c.mergeTargetId);

  const commit = async () => {
    setPhase('committing');
    setProgress(0);
    const errors: string[] = [];
    let created = 0, merged = 0, contacts = 0;
    const todo = batch.filter((c) => c.action !== 'skip');
    const skipped = batch.length - todo.length;

    for (let i = 0; i < todo.length; i++) {
      const c = todo[i];
      setProgress(Math.round(((i + 1) / todo.length) * 100));
      try {
        let customerId: string | null = null;
        let existingContacts: Array<{ name: string | null; email: string | null; phone: string | null; position: number }> = [];

        if (c.action === 'new') {
          const { data, error: e } = await supabase.from('customers')
            .insert({ name: c.company.trim(), type: c.type, address: c.address.trim() || null, notes: null })
            .select('id').single();
          if (e || !data) { errors.push(`${c.company}: ${e?.message ?? 'insert failed'}`); continue; }
          customerId = data.id; created++;
        } else {
          customerId = c.mergeTargetId;
          if (!customerId) { errors.push(`${c.company}: no merge target selected`); continue; }
          const { data: ex } = await supabase.from('customer_contacts').select('name, email, phone, position').eq('customer_id', customerId);
          existingContacts = (ex ?? []) as typeof existingContacts;
          // The CSV billing address is the more current/correct one — overwrite.
          if (c.address.trim()) await supabase.from('customers').update({ address: c.address.trim() }).eq('id', customerId);
          merged++;
        }

        if (!customerId) continue;
        // Dedup: a contact is "the same" if its email OR its name already exists (or, when
        // it has neither, its phone). Applies against existing contacts AND within this batch.
        const emailSeen = new Set<string>(), nameSeen = new Set<string>(), phoneSeen = new Set<string>();
        for (const r of existingContacts) {
          const e = (r.email ?? '').toLowerCase().trim(); if (e) emailSeen.add(e);
          const n = normName(r.name ?? ''); if (n) nameSeen.add(n);
          const p = (r.phone ?? '').replace(/\D/g, ''); if (p) phoneSeen.add(p);
        }
        let pos = existingContacts.reduce((m, r) => Math.max(m, r.position ?? 0), -1) + 1;
        const toInsert: Array<{ customer_id: string; name: string; email: string | null; phone: string | null; position: number }> = [];
        for (const ct of c.contacts) {
          const e = ct.email.toLowerCase().trim(), n = normName(ct.name), p = ct.phone.replace(/\D/g, '');
          if ((e && emailSeen.has(e)) || (n && nameSeen.has(n)) || (!e && !n && p && phoneSeen.has(p))) continue;
          if (e) emailSeen.add(e); if (n) nameSeen.add(n); if (p) phoneSeen.add(p);
          toInsert.push({ customer_id: customerId, name: ct.name.trim(), email: ct.email.trim() || null, phone: ct.phone.trim() || null, position: pos++ });
        }
        if (toInsert.length) {
          const { error: e } = await supabase.from('customer_contacts').insert(toInsert);
          if (e) errors.push(`${c.company} contacts: ${e.message}`); else contacts += toInsert.length;
        }
      } catch (e) {
        errors.push(`${c.company}: ${e instanceof Error ? e.message : 'error'}`);
      }
    }

    const acc = {
      created: totals.created + created, merged: totals.merged + merged,
      contacts: totals.contacts + contacts, skipped: totals.skipped + skipped,
      errors: [...totals.errors, ...errors],
    };
    setTotals(acc);
    // Refresh the customer list from the DB and keep the parent screen in sync, so the
    // next batch fuzzy-matches against everything imported so far (no cross-batch dupes).
    const { data: fresh } = await supabase.from('customers').select('*').order('name');
    const freshList = (fresh ?? []) as Customer[];
    setExistingList(freshList);
    await onDone();

    const nextCursor = cursor + BATCH_SIZE;
    if (nextCursor >= companies.length) {
      setResult(acc);
      setPhase('done');
    } else {
      // Re-match every not-yet-reviewed row against the refreshed list, then re-sort the
      // remaining rows (flagged first) so the next batch surfaces the items needing a call.
      setCompanies((cs) => {
        const done = cs.slice(0, nextCursor);
        const rest = cs.slice(nextCursor).map((c) => ({ ...c, ...resolveMatch(c, freshList) })).sort(flaggedFirst);
        return [...done, ...rest];
      });
      setCursor(nextCursor);
      setExpanded(null);
      setProgress(0);
      setPhase('review');
    }
  };

  const chip = (text: string, bg: string, color: string) => (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: bg, color, whiteSpace: 'nowrap' }}>{text}</span>
  );
  const actionStyle = (a: ImportAction): React.CSSProperties => ({ ...inputStyle(), padding: '6px 10px', width: 'auto', fontWeight: 700, cursor: 'pointer', background: C.white,
    color: a === 'new' ? C.green : a === 'merge' ? '#1A62C0' : C.slate });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: phase === 'review' ? 960 : 520, maxWidth: 'calc(100vw - 24px)', height: phase === 'review' ? '90vh' : undefined, maxHeight: '90vh', overflowY: phase === 'review' ? 'hidden' : 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Bulk Upload Customers</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>}

        {phase === 'pick' && (<>
          <div style={{ fontSize: 13, color: C.slate, lineHeight: 1.6 }}>
            Upload the customer-master export (<strong>.csv</strong> or <strong>.xlsx</strong>). Rows are grouped into one customer per company — repeat people become additional contacts (primary = latest invoice). We fuzzy-match the {existing.length} existing customers and flag anything that needs your call. Nothing saves until you review.
          </div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleFile(f); }} />
          <button onClick={() => fileRef.current?.click()}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px', borderRadius: 12, border: `1px dashed ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            <Upload size={16} strokeWidth={2} /> Choose file…
          </button>
        </>)}

        {phase === 'review' && (<>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
            {chip(`${counts.new} new`, C.honeydew, '#1B512D')}
            {chip(`${counts.merge} merge`, '#E3F0FF', '#1A62C0')}
            {chip(`${counts.skip} skip`, '#F3F3F3', C.slate)}
            {chip(`${counts.contacts} contacts`, C.seasalt, C.slate)}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.slate }}>
              Batch <strong style={{ color: '#1a1a1a' }}>{batchNum}</strong> of {totalBatches} · rows {cursor + 1}–{rangeEnd} of {total} · flagged first
            </span>
          </div>

          <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {batch.map((c) => {
              const flagged = c.flags.some((f) => ['verify-match', 'shifted-columns', 'was-unknown'].includes(f));
              const isOpen = expanded === c.key;
              return (
                <div key={c.key} style={{ borderBottom: '1px solid #F3F3F3', background: flagged ? '#FFFCF5' : C.white }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input value={c.company} onChange={(e) => patch(c.key, { company: e.target.value })}
                        style={{ width: '100%', border: 'none', outline: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, color: '#1a1a1a', background: 'transparent' }} />
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button onClick={() => setExpanded(isOpen ? null : c.key)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: 0, border: 'none', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                          <ChevronDown size={11} strokeWidth={2.5} style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} /> {c.contacts.length} contact{c.contacts.length === 1 ? '' : 's'}
                        </button>
                        {c.flags.map((f) => (
                          <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            {chip(FLAG_LABEL[f] ?? f, '#FFF0E0', '#B45309')}
                          </span>
                        ))}
                      </div>
                    </div>
                    <select value={c.type} onChange={(e) => patch(c.key, { type: e.target.value as CustomerType })}
                      style={{ ...inputStyle(), padding: '6px 8px', width: 'auto', cursor: 'pointer', background: C.white, fontSize: 12 }}>
                      {CUSTOMER_TYPES.map((t) => (<option key={t} value={t}>{TYPE_LABEL[t]}</option>))}
                    </select>
                    <select value={c.action} onChange={(e) => { const a = e.target.value as ImportAction; patch(c.key, { action: a, mergeTargetId: a === 'merge' ? (c.mergeTargetId ?? c.bestMatch?.id ?? existingSorted[0]?.id ?? null) : c.mergeTargetId }); }}
                      style={actionStyle(c.action)}>
                      <option value="new">New</option>
                      <option value="merge">Merge</option>
                      <option value="skip">Skip</option>
                    </select>
                    {c.action === 'merge' ? (
                      <select value={c.mergeTargetId ?? ''} onChange={(e) => patch(c.key, { mergeTargetId: e.target.value || null })}
                        style={{ ...inputStyle(), padding: '6px 8px', width: 230, cursor: 'pointer', background: c.mergeTargetId ? C.white : '#FDEAEA', fontSize: 12 }}>
                        <option value="">— pick existing —</option>
                        {existingSorted.map((e) => (
                          <option key={e.id} value={e.id}>{e.name}{c.bestMatch?.id === e.id ? `  (${Math.round(c.bestMatch.score * 100)}%)` : ''}</option>
                        ))}
                      </select>
                    ) : <div style={{ width: 230 }} />}
                  </div>
                  {isOpen && (
                    <div style={{ padding: '0 14px 12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {c.contacts.length === 0 && <div style={{ fontSize: 12, color: C.slate }}>No named contacts — customer will be created without one.</div>}
                      {c.contacts.map((ct, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, color: '#1a1a1a', background: C.seasalt, borderRadius: 8, padding: '6px 10px', alignItems: 'center' }}>
                          {i === 0 && c.contacts.length > 1 && chip('PRIMARY', C.honeydew, '#1B512D')}
                          <span style={{ fontWeight: 600, minWidth: 140 }}>{ct.name || <span style={{ color: C.slate }}>(no name)</span>}</span>
                          <span style={{ color: C.slate, minWidth: 200 }}>{ct.email || '—'}</span>
                          <span style={{ color: C.slate }}>{ct.phone || '—'}</span>
                        </div>
                      ))}
                      {c.address && <div style={{ fontSize: 11, color: C.slate }}><strong>Billing:</strong> {c.address}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexShrink: 0 }}>
            {totals.created + totals.merged > 0 && (
              <span style={{ marginRight: 'auto', fontSize: 11, color: C.slate }}>
                So far: {totals.created} created · {totals.merged} merged · {totals.contacts} contacts
              </span>
            )}
            {batchHasUnsetMerge && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#C0321A', fontWeight: 600 }}>
                <AlertTriangle size={13} /> Some Merge rows have no target.
              </span>
            )}
            <button onClick={() => { setPhase('pick'); setCompanies([]); setCursor(0); }}
              style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Back</button>
            <button onClick={() => void commit()} disabled={batchHasUnsetMerge}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: batchHasUnsetMerge ? '#A5D6A7' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: batchHasUnsetMerge ? 'not-allowed' : 'pointer' }}>
              Import {counts.new + counts.merge} · batch {batchNum}/{totalBatches}
            </button>
          </div>
        </>)}

        {phase === 'committing' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 0' }}>
            <div style={{ fontSize: 13, color: C.slate, textAlign: 'center' }}>Importing… {progress}%</div>
            <div style={{ height: 8, borderRadius: 99, background: C.seasalt, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: C.green, transition: 'width .2s' }} />
            </div>
          </div>
        )}

        {phase === 'done' && result && (<>
          <div style={{ background: C.honeydew, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1B512D' }}>Import complete</div>
            <div style={{ fontSize: 13, color: '#1B512D' }}>{result.created} created · {result.merged} merged · {result.contacts} contacts added · {result.skipped} skipped</div>
          </div>
          {result.errors.length > 0 && (
            <div style={{ background: '#FDEAEA', borderRadius: 12, padding: 14, maxHeight: 200, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#C0321A', marginBottom: 6 }}>{result.errors.length} row{result.errors.length === 1 ? '' : 's'} had issues:</div>
              {result.errors.map((e, i) => <div key={i} style={{ fontSize: 11, color: '#C0321A' }}>{e}</div>)}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Done</button>
          </div>
        </>)}
      </div>
    </div>
  );
}
