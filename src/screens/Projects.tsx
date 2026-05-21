import { useEffect, useState } from 'react';
import { C } from '../theme';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import {
  type Customer,
  type CustomerType,
  CUSTOMER_TYPES,
  TYPE_LABEL,
  TYPE_PALETTE,
} from './Customers';

// ── Local types ───────────────────────────────────────────────────

interface CustomerContact {
  id: string;
  customer_id: string;
  name: string;
  role: string | null;
  emails: string[];
  whatsapps: string[];
  position: number;
}

type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';

const PROJECT_STATUSES: ProjectStatus[] = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning:  'Planning',
  active:    'Active',
  on_hold:   'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const PROJECT_STATUS_PALETTE: Record<ProjectStatus, { bg: string; color: string }> = {
  planning:  { bg: '#FFF0E0', color: '#B45309' },
  active:    { bg: '#E4F3E3', color: '#1B512D' },
  on_hold:   { bg: '#FFF8E1', color: '#B07D00' },
  completed: { bg: '#E3F0FF', color: '#1A62C0' },
  cancelled: { bg: '#FDEAEA', color: '#C0321A' },
};

interface Project {
  id: string;
  customer_id: string;
  name: string;
  status: ProjectStatus;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

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

// ── Top-level screen — customer picker ─────────────────────────────

export function ScreenProjects() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch]       = useState('');

  const fetchCustomers = async () => {
    const { data } = await supabase
      .from('customers')
      .select('*')
      .order('name');
    setCustomers((data ?? []) as Customer[]);
    setLoading(false);
  };
  useEffect(() => { void fetchCustomers(); }, []);

  if (selectedId) {
    return <CustomerProjectHub customerId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const visible = customers.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Pick a customer</div>
        <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>
          Projects are organised under their customer. Choose one below to view its company details, contacts, overview, and files.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: C.slate, fontWeight: 600 }}>
          {loading ? 'Loading…' : `${visible.length} customer${visible.length === 1 ? '' : 's'}`}
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Customer', 'Type', ''].map((h, i) => (
                <th key={i} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                {customers.length === 0
                  ? 'No customers yet. Add one from the Customers tab first.'
                  : 'No customers match your search.'}
              </td></tr>
            ) : visible.map((c) => {
              const p = TYPE_PALETTE[c.type];
              return (
                <tr key={c.id} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                  onClick={() => setSelectedId(c.id)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '13px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: C.honeydew, color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                        {c.name.trim().charAt(0).toUpperCase() || '?'}
                      </div>
                      <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{c.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '13px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: p.bg, color: p.color }}>
                      {TYPE_LABEL[c.type]}
                    </span>
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', color: C.green, fontWeight: 700, fontSize: 12 }}>
                    Open →
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Customer project hub — Company Details + Contacts + tabs ──────

type DetailTab = 'overview' | 'files' | 'projects';

function CustomerProjectHub({ customerId, onBack }: { customerId: string; onBack: () => void }) {
  const { can } = usePermissions();
  const canEdit   = can('projects', 'can_edit');
  const canDelete = can('projects', 'can_delete');

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<DetailTab>('overview');

  const fetchAll = async () => {
    const [{ data: c }, { data: cc }, { data: pp }] = await Promise.all([
      supabase.from('customers').select('*').eq('id', customerId).maybeSingle(),
      supabase.from('customer_contacts').select('*').eq('customer_id', customerId).order('position').order('created_at'),
      supabase.from('projects').select('*').eq('customer_id', customerId).order('position').order('created_at'),
    ]);
    setCustomer((c as Customer) ?? null);
    setContacts((cc ?? []) as CustomerContact[]);
    setProjects((pp ?? []) as Project[]);
    setLoading(false);
  };
  useEffect(() => { void fetchAll(); }, [customerId]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 14 }}>Loading customer…</div>;
  }
  if (!customer) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>Customer not found.</div>
        <button onClick={onBack}
          style={{ alignSelf: 'center', padding: '8px 18px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          ← Back
        </button>
      </div>
    );
  }

  const palette = TYPE_PALETTE[customer.type];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={onBack}
          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          ← Customers
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: C.honeydew, color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, flexShrink: 0 }}>
            {customer.name.trim().charAt(0).toUpperCase() || '?'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              {customer.name}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: palette.bg, color: palette.color, alignSelf: 'flex-start' }}>
              {TYPE_LABEL[customer.type]} · Projects
            </span>
          </div>
        </div>
      </div>

      {/* Two-column body */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 18, alignItems: 'start' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <CompanyDetailsCard customer={customer} canEdit={canEdit} onChanged={fetchAll} />
          <ContactsCard customerId={customer.id} contacts={contacts} canEdit={canEdit} onChanged={fetchAll} />
        </div>

        {/* Right column */}
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #EBEBEB', padding: '8px 12px', gap: 4 }}>
            {(['overview', 'files', 'projects'] as DetailTab[]).map((t) => {
              const active = tab === t;
              const label = t === 'overview' ? 'Overview' : t === 'files' ? 'Files' : 'Projects';
              const count = t === 'projects' && projects.length > 0 ? ` · ${projects.length}` : '';
              return (
                <button key={t} onClick={() => setTab(t)}
                  style={{ padding: '8px 16px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: active ? C.honeydew : 'transparent',
                    color: active ? C.green : C.slate,
                    borderBottom: active ? `2px solid ${C.green}` : '2px solid transparent',
                    marginBottom: -1,
                  }}>
                  {label}{count}
                </button>
              );
            })}
          </div>
          <div style={{ padding: 22 }}>
            {tab === 'overview' && <OverviewTab customer={customer} contacts={contacts} projects={projects} />}
            {tab === 'files'    && <FilesTab />}
            {tab === 'projects' && (
              <ProjectsTab
                customerId={customer.id}
                projects={projects}
                canEdit={canEdit}
                canDelete={canDelete}
                onChanged={fetchAll}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Company Details card ──────────────────────────────────────────

function CompanyDetailsCard({ customer, canEdit, onChanged }: { customer: Customer; canEdit: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName]       = useState(customer.name);
  const [type, setType]       = useState<CustomerType>(customer.type);
  const [address, setAddress] = useState(customer.address ?? '');
  const [notes, setNotes]     = useState(customer.notes ?? '');
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    setName(customer.name); setType(customer.type);
    setAddress(customer.address ?? ''); setNotes(customer.notes ?? '');
  }, [customer.id]);

  const save = async () => {
    setSaving(true);
    await supabase.from('customers').update({
      name: name.trim(),
      type,
      address: address.trim() || null,
      notes:   notes.trim()   || null,
    }).eq('id', customer.id);
    setSaving(false);
    setEditing(false);
    await onChanged();
  };

  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Company Details</div>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)}
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <DetailRow label="Name" value={customer.name} />
          <DetailRow label="Type" value={TYPE_LABEL[customer.type]} />
          <DetailRow label="Billing Address" value={customer.address ?? '—'} multiline />
          <DetailRow label="Notes" value={customer.notes ?? '—'} multiline />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <FieldLabel>Name</FieldLabel>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle()} />
          </div>
          <div>
            <FieldLabel>Type</FieldLabel>
            <select value={type} onChange={(e) => setType(e.target.value as CustomerType)}
              style={{ ...inputStyle(), background: C.white, cursor: 'pointer' }}>
              {CUSTOMER_TYPES.map((t) => (<option key={t} value={t}>{TYPE_LABEL[t]}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel>Billing Address</FieldLabel>
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2}
              style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={() => setEditing(false)}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving || !name.trim()}
              style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: name.trim() && !saving ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: name.trim() && !saving ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: multiline ? 'column' : 'row', alignItems: multiline ? 'flex-start' : 'baseline', gap: multiline ? 4 : 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: multiline ? undefined : 70 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5, whiteSpace: multiline ? 'pre-wrap' : 'normal' }}>{value}</div>
    </div>
  );
}

// ── Contacts card ─────────────────────────────────────────────────

function ContactsCard({ customerId, contacts, canEdit, onChanged }: { customerId: string; contacts: CustomerContact[]; canEdit: boolean; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Contacts {contacts.length > 0 && <span style={{ color: C.slate, marginLeft: 4 }}>· {contacts.length}</span>}
        </div>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)}
            style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            + Add
          </button>
        )}
      </div>

      {contacts.length === 0 && !adding && (
        <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: C.slate, textAlign: 'center' }}>
          No contacts yet. Click + Add to capture one.
        </div>
      )}

      {contacts.map((c) =>
        editingId === c.id ? (
          <ContactEditor
            key={c.id}
            initial={c}
            onCancel={() => setEditingId(null)}
            onSaved={async () => { setEditingId(null); await onChanged(); }}
            onDelete={async () => { setEditingId(null); await onChanged(); }}
            customerId={customerId}
          />
        ) : (
          <ContactRow key={c.id} contact={c} canEdit={canEdit} onEdit={() => setEditingId(c.id)} />
        )
      )}

      {adding && (
        <ContactEditor
          customerId={customerId}
          onCancel={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await onChanged(); }}
        />
      )}
    </div>
  );
}

function ContactRow({ contact, canEdit, onEdit }: { contact: CustomerContact; canEdit: boolean; onEdit: () => void }) {
  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{contact.name}</div>
          {contact.role && <div style={{ fontSize: 11, color: C.slate }}>{contact.role}</div>}
        </div>
        {canEdit && (
          <button onClick={onEdit}
            style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
            Edit
          </button>
        )}
      </div>
      {contact.emails.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {contact.emails.map((e, i) => (
            <a key={i} href={`mailto:${e}`} style={{ fontSize: 12, color: C.green, textDecoration: 'none', wordBreak: 'break-all' }}>✉ {e}</a>
          ))}
        </div>
      )}
      {contact.whatsapps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {contact.whatsapps.map((w, i) => (
            <a key={i} href={`https://wa.me/${w.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#25D366', textDecoration: 'none', fontVariantNumeric: 'tabular-nums' }}>
              💬 {w}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactEditor({
  customerId,
  initial,
  onSaved,
  onCancel,
  onDelete,
}: {
  customerId: string;
  initial?: CustomerContact;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName]     = useState(initial?.name ?? '');
  const [role, setRole]     = useState(initial?.role ?? '');
  const [emails, setEmails] = useState<string[]>(initial?.emails ?? ['']);
  const [whatsapps, setWA]  = useState<string[]>(initial?.whatsapps ?? ['']);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateAt = (list: string[], setList: (s: string[]) => void, i: number, v: string) =>
    setList(list.map((x, idx) => idx === i ? v : x));
  const addRow    = (list: string[], setList: (s: string[]) => void) => setList([...list, '']);
  const removeRow = (list: string[], setList: (s: string[]) => void, i: number) =>
    setList(list.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    const payload = {
      customer_id: customerId,
      name: name.trim(),
      role: role.trim() || null,
      emails:    emails.map((s) => s.trim()).filter(Boolean),
      whatsapps: whatsapps.map((s) => s.trim()).filter(Boolean),
    };
    if (initial) await supabase.from('customer_contacts').update(payload).eq('id', initial.id);
    else         await supabase.from('customer_contacts').insert(payload);
    setSaving(false);
    await onSaved();
  };

  const handleDelete = async () => {
    if (!initial) return;
    await supabase.from('customer_contacts').delete().eq('id', initial.id);
    if (onDelete) await onDelete();
  };

  const canSave = name.trim().length > 0 && !saving;

  return (
    <div style={{ background: C.seasalt, border: `1px solid ${C.green}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <FieldLabel>Contact Name</FieldLabel>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Tan"
          style={{ ...inputStyle(), background: C.white }} autoFocus />
      </div>
      <div>
        <FieldLabel>Role (optional)</FieldLabel>
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Owner, Operations Lead, …"
          style={{ ...inputStyle(), background: C.white }} />
      </div>

      <MultiValueList
        label="Emails"
        type="email"
        values={emails}
        placeholder="jane@acme.com"
        onChange={(i, v) => updateAt(emails, setEmails, i, v)}
        onAdd={() => addRow(emails, setEmails)}
        onRemove={(i) => removeRow(emails, setEmails, i)}
      />

      <MultiValueList
        label="WhatsApps"
        type="tel"
        values={whatsapps}
        placeholder="+65 9123 4567"
        onChange={(i, v) => updateAt(whatsapps, setWA, i, v)}
        onAdd={() => addRow(whatsapps, setWA)}
        onRemove={(i) => removeRow(whatsapps, setWA, i)}
      />

      {confirmDelete && (
        <div style={{ background: '#FDEAEA', borderRadius: 8, padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#C0321A', display: 'flex', alignItems: 'center', gap: 8 }}>
          Delete this contact?
          <button onClick={() => setConfirmDelete(false)}
            style={{ marginLeft: 'auto', padding: '3px 9px', borderRadius: 6, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleDelete}
            style={{ padding: '3px 9px', borderRadius: 6, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Yes, delete</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        {initial && !confirmDelete && (
          <button onClick={() => setConfirmDelete(true)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            Delete
          </button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={onCancel}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={!canSave}
            style={{ padding: '6px 16px', borderRadius: 8, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MultiValueList({
  label, values, type, placeholder, onChange, onAdd, onRemove,
}: {
  label: string;
  values: string[];
  type: string;
  placeholder: string;
  onChange: (i: number, v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {values.length === 0 ? (
          <div style={{ fontSize: 11, color: C.slate, fontStyle: 'italic' }}>None added</div>
        ) : values.map((v, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <input type={type} value={v} onChange={(e) => onChange(i, e.target.value)} placeholder={placeholder}
              style={{ ...inputStyle(), background: C.white }} />
            <button onClick={() => onRemove(i)}
              style={{ padding: '0 12px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 14, cursor: 'pointer' }}
              title={`Remove ${label.slice(0, -1).toLowerCase()}`}>
              ×
            </button>
          </div>
        ))}
        <button onClick={onAdd}
          style={{ alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 6, border: `1px dashed ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          + Add {label.toLowerCase().endsWith('s') ? label.slice(0, -1).toLowerCase() : label.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

// ── Right-column tabs ─────────────────────────────────────────────

function OverviewTab({ customer, contacts, projects }: { customer: Customer; contacts: CustomerContact[]; projects: Project[] }) {
  const emailCount = contacts.reduce((n, c) => n + c.emails.length, 0);
  const waCount    = contacts.reduce((n, c) => n + c.whatsapps.length, 0);
  const activeProjectCount = projects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <SummaryStat label="Active projects"   value={String(activeProjectCount)} />
        <SummaryStat label="Contacts"          value={String(contacts.length)} />
        <SummaryStat label="Emails on file"    value={String(emailCount)} />
        <SummaryStat label="WhatsApps on file" value={String(waCount)} />
      </div>
      <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Created</div>
        <div style={{ fontSize: 13, color: '#1a1a1a' }}>
          {new Date(customer.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      {customer.notes && (
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes</div>
          <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{customer.notes}</div>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  );
}

function FilesTab() {
  return (
    <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 12, padding: 40, textAlign: 'center', color: C.slate, fontSize: 13, lineHeight: 1.6 }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
      No files yet. File uploads will live here once the integration is built.
    </div>
  );
}

// ── Projects tab ──────────────────────────────────────────────────

function ProjectsTab({ customerId, projects, canEdit, canDelete, onChanged }: {
  customerId: string;
  projects: Project[];
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Projects</div>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
            Lightweight scaffold for now — fields will grow as we design the per-project layout.
          </div>
        </div>
        {canEdit && (
          <button onClick={() => setAdding(true)}
            style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + New Project
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 12, padding: 40, textAlign: 'center', color: C.slate, fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>◧</div>
          No projects yet.{canEdit && ' Click + New Project to add one.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {projects.map((p) => {
            const palette = PROJECT_STATUS_PALETTE[p.status];
            const cellCursor = canEdit ? 'pointer' : 'default';
            return (
              <div key={p.id}
                onClick={() => { if (canEdit) setEditing(p); }}
                style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: cellCursor }}
                onMouseEnter={(e) => { if (canEdit) e.currentTarget.style.borderColor = '#C8E6C9'; }}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#EBEBEB')}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  {p.notes && (
                    <div style={{ fontSize: 12, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>{p.notes}</div>
                  )}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: palette.bg, color: palette.color, flexShrink: 0 }}>
                  {PROJECT_STATUS_LABEL[p.status]}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <ProjectModal
          title="New Project"
          initial={{ name: '', status: 'planning', notes: null }}
          canDelete={false}
          onSave={async (data) => {
            await supabase.from('projects').insert({ ...data, customer_id: customerId });
            await onChanged();
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {editing && (
        <ProjectModal
          key={editing.id}
          title="Edit Project"
          initial={{ name: editing.name, status: editing.status, notes: editing.notes }}
          canDelete={canDelete}
          onSave={async (data) => {
            await supabase.from('projects').update(data).eq('id', editing.id);
            await onChanged();
          }}
          onDelete={async () => {
            await supabase.from('projects').delete().eq('id', editing.id);
            await onChanged();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface ProjectFormData {
  name: string;
  status: ProjectStatus;
  notes: string | null;
}

function ProjectModal({ title, initial, canDelete, onSave, onDelete, onClose }: {
  title: string;
  initial: ProjectFormData;
  canDelete: boolean;
  onSave: (data: ProjectFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ProjectFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const set = <K extends keyof ProjectFormData>(k: K, v: ProjectFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name:   form.name.trim(),
      status: form.status,
      notes:  form.notes && form.notes.trim() ? form.notes.trim() : null,
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
          <FieldLabel>Project Name</FieldLabel>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Phase 1 — Office HVAC refit" style={inputStyle()} autoFocus />
        </div>

        <div>
          <FieldLabel>Status</FieldLabel>
          <select value={form.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}
            style={{ ...inputStyle(), background: C.white, cursor: 'pointer' }}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>Notes</FieldLabel>
          <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} rows={3}
            placeholder="Scope, contractors, blockers…"
            style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this project?</div>
            <div style={{ fontSize: 12, color: '#C0321A' }}>This action is permanent.</div>
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
