import { useEffect, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';

// ── Types (also imported by Projects.tsx for the project-hub view) ───

export type CustomerType = 'residential' | 'commercial' | 'dealer';

export const CUSTOMER_TYPES: CustomerType[] = ['residential', 'commercial', 'dealer'];

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

// ── Top-level screen — list + add/edit modal ──────────────────────

export function ScreenCustomers() {
  const { can } = usePermissions();
  const canEdit   = can('customers', 'can_edit');
  const canDelete = can('customers', 'can_delete');

  const [rows, setRows]       = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | CustomerType>('all');
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('customers').select('*').order('name');
    setLoading(false);
    if (err) { setError(err.message); return; }
    setError(null);
    setRows((data ?? []) as Customer[]);
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
    return (c.name + ' ' + (c.email ?? '') + ' ' + (c.phone ?? '')).toLowerCase().includes(q);
  });

  const save = async (data: CustomerFormData, id?: string) => {
    if (id) await supabase.from('customers').update(data).eq('id', id);
    else    await supabase.from('customers').insert(data);
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
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
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
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
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Customer', 'Type', 'Billing Address'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  {rows.length === 0 ? 'No customers yet. Click "+ New Customer" to add one.' : 'No customers match your filters.'}
                </td></tr>
              ) : visible.map((c) => {
                const p = TYPE_PALETTE[c.type];
                const cellCursor = canEdit ? 'pointer' : 'default';
                const open = () => { if (canEdit) setEditing(c); };
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
                    <td onClick={open} style={{ padding: '13px 16px', color: c.address ? '#1a1a1a' : C.slate, cursor: cellCursor, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.address ?? ''}>
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
        <CustomerModal key={editing.id} title="Edit Customer"
          initial={{ name: editing.name, type: editing.type, address: editing.address, notes: editing.notes }}
          canDelete={canDelete}
          onSave={(d) => save(d, editing.id)}
          onDelete={() => remove(editing.id)}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

interface CustomerFormData {
  name:    string;
  type:    CustomerType;
  address: string | null;
  notes:   string | null;
}

function blankCustomer(): CustomerFormData {
  return { name: '', type: 'residential', address: null, notes: null };
}

interface CustomerModalProps {
  initial: CustomerFormData;
  title: string;
  canDelete: boolean;
  onSave: (data: CustomerFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function CustomerModal({ initial, title, canDelete, onSave, onDelete, onClose }: CustomerModalProps) {
  const [form, setForm] = useState<CustomerFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const set = <K extends keyof CustomerFormData>(k: K, v: CustomerFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name:    form.name.trim(),
      type:    form.type,
      address: form.address && form.address.trim() ? form.address.trim() : null,
      notes:   form.notes   && form.notes.trim()   ? form.notes.trim()   : null,
    });
    setSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete!();
    setDeleting(false);
    onClose();
  };

  const canSave = form.name.trim().length > 0 && !saving;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

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
