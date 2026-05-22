import { useEffect, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { Search, FolderClosed, Mail, Phone, Pencil } from 'lucide-react';
import {
  type Customer,
  type CustomerType,
  TYPE_LABEL,
  TYPE_PALETTE,
} from './Customers';

// ── Types ─────────────────────────────────────────────────────────

type ProjectStatus = 'active' | 'inactive';

const PROJECT_STATUSES: ProjectStatus[] = ['active', 'inactive'];

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active:   'Active',
  inactive: 'Inactive',
};

const PROJECT_STATUS_PALETTE: Record<ProjectStatus, { bg: string; color: string }> = {
  active:   { bg: '#E4F3E3', color: '#1B512D' },
  inactive: { bg: '#F3F3F3', color: '#5B6B7A' },
};

interface Project {
  id: string;
  customer_id: string | null;
  name: string;
  status: ProjectStatus;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

interface CustomerLite {
  id: string;
  name: string;
  type: CustomerType;
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

// ── Top-level screen ──────────────────────────────────────────────

type StatusFilter = 'all' | ProjectStatus;

export function ScreenProjects() {
  const { can } = usePermissions();
  const canEdit   = can('projects', 'can_edit');
  const canDelete = can('projects', 'can_delete');

  const [projects, setProjects]   = useState<Project[]>([]);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [adding, setAdding]       = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: ps, error: pErr }, { data: cs }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name, type').order('name'),
    ]);
    setLoading(false);
    if (pErr) { setError(pErr.message); return; }
    setError(null);
    setProjects((ps ?? []) as Project[]);
    setCustomers((cs ?? []) as CustomerLite[]);
  };
  useEffect(() => { void fetchAll(); }, []);

  const customerById = (id: string | null) => id ? customers.find((c) => c.id === id) ?? null : null;

  const counts = {
    active:   projects.filter((p) => p.status === 'active').length,
    inactive: projects.filter((p) => p.status === 'inactive').length,
  };

  const visible = projects.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const customerName = customerById(p.customer_id)?.name ?? '';
    return (p.name + ' ' + customerName + ' ' + (p.notes ?? '')).toLowerCase().includes(q);
  });

  const addProject = async (data: ProjectFormData) => {
    const { data: created } = await supabase.from('projects').insert(data).select().single();
    await fetchAll();
    if (created) setViewingId(created.id);
  };

  if (viewingId) {
    return (
      <ProjectDetailPage
        projectId={viewingId}
        customers={customers}
        canEdit={canEdit}
        canDelete={canDelete}
        onBack={async () => { await fetchAll(); setViewingId(null); }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <KPICard label="Total Projects" value={String(projects.length)} sub="all statuses" accent />
        <KPICard label="Active"         value={String(counts.active)}   sub="ongoing" />
        <KPICard label="Inactive"       value={String(counts.inactive)} sub="paused / closed" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', ...PROJECT_STATUSES] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s as StatusFilter)}
              style={{ padding: '7px 14px', borderRadius: 99, border: `1px solid ${statusFilter === s ? C.green : '#EBEBEB'}`, background: statusFilter === s ? C.green : C.white, color: statusFilter === s ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {s === 'all' ? 'All' : PROJECT_STATUS_LABEL[s as ProjectStatus]}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', width: 260 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        {canEdit && (
          <button onClick={() => setAdding(true)}
            style={{ marginLeft: 'auto', padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + New Project
          </button>
        )}
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Project', 'Status', 'Customer', 'Updated'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  {projects.length === 0 ? 'No projects yet. Click "+ New Project" to add one.' : 'No projects match your filters.'}
                </td></tr>
              ) : visible.map((p) => {
                const palette = PROJECT_STATUS_PALETTE[p.status];
                const cust = customerById(p.customer_id);
                const open = () => setViewingId(p.id);
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #F3F3F3' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: 'pointer' }}>
                      <div style={{ fontWeight: 700, color: '#1a1a1a', fontSize: 13 }}>{p.name}</div>
                      {p.notes && (
                        <div style={{ fontSize: 11, color: C.slate, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>{p.notes}</div>
                      )}
                    </td>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: 'pointer' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: palette.bg, color: palette.color }}>
                        {PROJECT_STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: 'pointer' }}>
                      {cust ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, color: '#1a1a1a', fontSize: 13 }}>{cust.name}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: TYPE_PALETTE[cust.type].bg, color: TYPE_PALETTE[cust.type].color }}>
                            {TYPE_LABEL[cust.type]}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: C.slate, fontStyle: 'italic' }}>Unlinked</span>
                      )}
                    </td>
                    <td onClick={open} style={{ padding: '13px 16px', color: C.slate, fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                      {new Date(p.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <ProjectModal title="New Project" initial={blankProject()} customers={customers}
          onSave={addProject} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────

interface ProjectFormData {
  name: string;
  status: ProjectStatus;
  notes: string | null;
  customer_id: string | null;
}

function blankProject(): ProjectFormData {
  return { name: '', status: 'active', notes: null, customer_id: null };
}

interface ProjectModalProps {
  initial: ProjectFormData;
  title: string;
  customers: CustomerLite[];
  onSave: (data: ProjectFormData) => Promise<void>;
  onClose: () => void;
}

function ProjectModal({ initial, title, customers, onSave, onClose }: ProjectModalProps) {
  const [form, setForm] = useState<ProjectFormData>(initial);
  // Track the customer name we last auto-filled into the project name. If
  // the user manually edits the name, this falls out of sync — we then
  // stop overwriting on subsequent customer changes.
  const initialCustomer = initial.customer_id ? customers.find((c) => c.id === initial.customer_id) ?? null : null;
  const [autoFilledFrom, setAutoFilledFrom] = useState<string>(initialCustomer?.name ?? '');
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ProjectFormData>(k: K, v: ProjectFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onCustomerChange = (id: string) => {
    const next = customers.find((c) => c.id === id) ?? null;
    setForm((f) => {
      const userTouchedName = f.name.trim() !== '' && f.name.trim() !== autoFilledFrom.trim();
      const nextName = userTouchedName ? f.name : (next?.name ?? '');
      return { ...f, customer_id: id || null, name: nextName };
    });
    setAutoFilledFrom(next?.name ?? '');
  };

  const onNameChange = (v: string) => {
    set('name', v);
    if (v.trim() !== autoFilledFrom.trim()) setAutoFilledFrom('');
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name:        form.name.trim(),
      status:      form.status,
      notes:       form.notes && form.notes.trim() ? form.notes.trim() : null,
      customer_id: form.customer_id,
    });
    setSaving(false);
    onClose();
  };

  const canSave = form.name.trim().length > 0 && !!form.customer_id && !saving;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 540, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div>
          <FieldLabel>Linked Customer</FieldLabel>
          <select value={form.customer_id ?? ''} onChange={(e) => onCustomerChange(e.target.value)}
            style={{ ...inputStyle(), background: C.white, cursor: 'pointer' }} autoFocus>
            <option value="" disabled>— Select a customer —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>
            Customers are shared across Project Management, Sales, and Technical Service. Deleting a customer keeps this project — the link just goes blank.
          </div>
        </div>

        <div>
          <FieldLabel>Project Name</FieldLabel>
          <input value={form.name} onChange={(e) => onNameChange(e.target.value)}
            placeholder={form.customer_id ? 'Auto-filled from customer — edit if needed' : 'Pick a customer first…'}
            disabled={!form.customer_id}
            style={{ ...inputStyle(), background: form.customer_id ? C.white : C.seasalt, cursor: form.customer_id ? 'text' : 'not-allowed' }} />
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
          <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} rows={4}
            placeholder="Scope, contractors, blockers…"
            style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={!canSave}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
            {saving ? 'Creating…' : 'Create & Open'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Project Detail Page ────────────────────────────────────────────

// ── Customer-scoped types (joined into the project detail view) ────

interface CustomerContact {
  id: string;
  customer_id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface CustomerCharger {
  id: string;
  customer_id: string;
  asset_tag: string;
  brand_model: string | null;
  turn_on_date: string | null;
  form_a_next_date: string | null;
  form_d_next_date: string | null;
  warranty_start_date: string | null;
  warranty_end_date: string | null;
  notes: string | null;
}

type DetailTab = 'overview' | 'files';

function ProjectDetailPage({ projectId, customers, canEdit, canDelete, onBack }: {
  projectId: string;
  customers: CustomerLite[];
  canEdit: boolean;
  canDelete: boolean;
  onBack: () => Promise<void>;
}) {
  const [project, setProject]   = useState<Project | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [chargers, setChargers] = useState<CustomerCharger[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<DetailTab>('overview');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = async () => {
    const { data: p } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();
    const proj = (p as Project | null) ?? null;
    setProject(proj);
    if (proj?.customer_id) {
      const [{ data: c }, { data: cc }, { data: ch }] = await Promise.all([
        supabase.from('customers').select('*').eq('id', proj.customer_id).maybeSingle(),
        supabase.from('customer_contacts').select('id, customer_id, name, email, phone').eq('customer_id', proj.customer_id).order('position').order('created_at'),
        supabase.from('customer_chargers').select('*').eq('customer_id', proj.customer_id).order('position').order('created_at'),
      ]);
      setCustomer((c as Customer | null) ?? null);
      setContacts((cc ?? []) as CustomerContact[]);
      setChargers((ch ?? []) as CustomerCharger[]);
    } else {
      setCustomer(null);
      setContacts([]);
      setChargers([]);
    }
    setLoading(false);
  };
  useEffect(() => { void fetchAll(); }, [projectId]);

  const handleDelete = async () => {
    setDeleting(true);
    await supabase.from('projects').delete().eq('id', projectId);
    setDeleting(false);
    await onBack();
  };

  if (loading || !project) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 14 }}>
        {loading ? 'Loading project…' : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>Project not found.</div>
            <button onClick={() => void onBack()}
              style={{ alignSelf: 'center', padding: '8px 18px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ← Back to Projects
            </button>
          </div>
        )}
      </div>
    );
  }

  const palette = PROJECT_STATUS_PALETTE[project.status];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={() => void onBack()}
          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          ← Projects
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: C.honeydew, color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, flexShrink: 0 }}>
            {project.name.trim().charAt(0).toUpperCase() || '?'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.01em', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project.name}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: palette.bg, color: palette.color, alignSelf: 'flex-start' }}>
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
          </div>
        </div>
        {canDelete && (
          <button onClick={() => setConfirmDelete(true)}
            style={{ marginLeft: 'auto', padding: '7px 14px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Delete project
          </button>
        )}
      </div>

      {confirmDelete && (
        <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A', flex: 1 }}>
            Delete <strong>{project.name}</strong>? The linked customer is unaffected.
          </div>
          <button onClick={() => setConfirmDelete(false)} disabled={deleting}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void handleDelete()} disabled={deleting}
            style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {deleting ? 'Deleting…' : 'Yes, delete'}
          </button>
        </div>
      )}

      {/* Two-column body */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 18, alignItems: 'start' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ProjectDetailsCard
            project={project}
            customers={customers}
            canEdit={canEdit}
            onSaved={fetchAll}
          />
          <LinkedCustomerCard customer={customer} contacts={contacts} hasLink={!!project.customer_id} />
        </div>

        {/* Right column */}
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #EBEBEB', padding: '8px 12px', gap: 4 }}>
            {(['overview', 'files'] as DetailTab[]).map((t) => {
              const active = tab === t;
              return (
                <button key={t} onClick={() => setTab(t)}
                  style={{ padding: '8px 16px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: active ? C.honeydew : 'transparent',
                    color: active ? C.green : C.slate,
                    borderBottom: active ? `2px solid ${C.green}` : '2px solid transparent',
                    marginBottom: -1,
                  }}>
                  {t === 'overview' ? 'Overview' : 'Files'}
                </button>
              );
            })}
          </div>
          <div style={{ padding: 22 }}>
            {tab === 'overview' && (
              <OverviewTab
                project={project}
                customer={customer}
                contacts={contacts}
                chargers={chargers}
                canEdit={canEdit}
                canDelete={canDelete}
                onChargersChanged={fetchAll}
              />
            )}
            {tab === 'files' && <FilesTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Left column: Project Details ──────────────────────────────────

function ProjectDetailsCard({ project, customers, canEdit, onSaved }: {
  project: Project;
  customers: CustomerLite[];
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName]       = useState(project.name);
  const [status, setStatus]   = useState<ProjectStatus>(project.status);
  const [notes, setNotes]     = useState(project.notes ?? '');
  const [customerId, setCustomerId] = useState<string | null>(project.customer_id);
  const initialCustomer = project.customer_id ? customers.find((c) => c.id === project.customer_id) ?? null : null;
  const [autoFilledFrom, setAutoFilledFrom] = useState<string>(initialCustomer?.name ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(project.name);
    setStatus(project.status);
    setNotes(project.notes ?? '');
    setCustomerId(project.customer_id);
    const c = project.customer_id ? customers.find((c) => c.id === project.customer_id) ?? null : null;
    setAutoFilledFrom(c?.name ?? '');
  }, [project.id, customers]);

  const onCustomerChange = (id: string) => {
    const next = customers.find((c) => c.id === id) ?? null;
    setCustomerId(id || null);
    const userTouchedName = name.trim() !== '' && name.trim() !== autoFilledFrom.trim();
    if (!userTouchedName) setName(next?.name ?? '');
    setAutoFilledFrom(next?.name ?? '');
  };

  const onNameChange = (v: string) => {
    setName(v);
    if (v.trim() !== autoFilledFrom.trim()) setAutoFilledFrom('');
  };

  const cancel = () => {
    setName(project.name);
    setStatus(project.status);
    setNotes(project.notes ?? '');
    setCustomerId(project.customer_id);
    setAutoFilledFrom(initialCustomer?.name ?? '');
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    await supabase.from('projects').update({
      name:        name.trim(),
      status,
      notes:       notes.trim() || null,
      customer_id: customerId,
    }).eq('id', project.id);
    setSaving(false);
    setEditing(false);
    await onSaved();
  };

  const linkedName = project.customer_id
    ? customers.find((c) => c.id === project.customer_id)?.name ?? '— (deleted) —'
    : '—';
  const palette = PROJECT_STATUS_PALETTE[project.status];

  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Project Details</div>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            <Pencil size={11} strokeWidth={2.25} /> Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <DetailRow label="Name" value={project.name} />
          <DetailRow label="Customer" value={linkedName} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 70 }}>Status</div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: palette.bg, color: palette.color }}>
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
          </div>
          <DetailRow label="Notes" value={project.notes ?? '—'} multiline />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <FieldLabel>Linked Customer</FieldLabel>
            <select value={customerId ?? ''} onChange={(e) => onCustomerChange(e.target.value)}
              style={{ ...inputStyle(), background: C.white, cursor: 'pointer' }}>
              <option value="" disabled>— Select a customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Project Name</FieldLabel>
            <input value={name} onChange={(e) => onNameChange(e.target.value)}
              disabled={!customerId}
              style={{ ...inputStyle(), background: customerId ? C.white : C.seasalt, cursor: customerId ? 'text' : 'not-allowed' }} />
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              style={{ ...inputStyle(), background: C.white, cursor: 'pointer' }}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={cancel}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={() => void save()} disabled={saving || !name.trim() || !customerId}
              style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: (name.trim() && customerId && !saving) ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: (name.trim() && customerId && !saving) ? 'pointer' : 'default' }}>
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

// ── Left column: Linked Customer (read-only summary) ──────────────

function LinkedCustomerCard({ customer, contacts, hasLink }: { customer: Customer | null; contacts: CustomerContact[]; hasLink: boolean }) {
  if (!hasLink) {
    return (
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Linked Customer</div>
        <div style={{ background: '#FDEAEA', borderRadius: 10, padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#C0321A', lineHeight: 1.5 }}>
          Linked customer was deleted — pick a new one from <strong>Project Details</strong> to keep this project connected.
        </div>
      </div>
    );
  }
  if (!customer) return null;

  const palette = TYPE_PALETTE[customer.type];
  const visibleContacts = contacts.slice(0, 3);
  const extras = contacts.length - visibleContacts.length;

  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Linked Customer</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: C.honeydew, color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
          {customer.name.trim().charAt(0).toUpperCase() || '?'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.name}</div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: palette.bg, color: palette.color, alignSelf: 'flex-start' }}>
            {TYPE_LABEL[customer.type]}
          </span>
        </div>
      </div>
      {customer.address && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Billing Address</div>
          <div style={{ fontSize: 12, color: '#1a1a1a', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{customer.address}</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Contacts{contacts.length > 0 && <span style={{ color: C.slate, marginLeft: 4 }}>· {contacts.length}</span>}
        </div>
        {contacts.length === 0 ? (
          <div style={{ fontSize: 12, color: C.slate, fontStyle: 'italic' }}>No contacts yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleContacts.map((c) => (
              <div key={c.id} style={{ background: C.seasalt, borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Attn:</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>{c.name}</span>
                </div>
                {c.email && (
                  <a href={`mailto:${c.email}`} style={{ fontSize: 11, color: C.green, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, wordBreak: 'break-all' }}>
                    <Mail size={11} strokeWidth={2.25} /> {c.email}
                  </a>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone.replace(/\s+/g, '')}`} style={{ fontSize: 11, color: '#1a1a1a', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, fontVariantNumeric: 'tabular-nums' }}>
                    <Phone size={11} strokeWidth={2.25} /> {c.phone}
                  </a>
                )}
              </div>
            ))}
            {extras > 0 && (
              <div style={{ fontSize: 11, color: C.slate, alignSelf: 'flex-start' }}>+ {extras} more — manage from the Customers tab.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Right column: Overview tab ────────────────────────────────────

function OverviewTab({ project, customer, contacts, chargers, canEdit, canDelete, onChargersChanged }: {
  project: Project;
  customer: Customer | null;
  contacts: CustomerContact[];
  chargers: CustomerCharger[];
  canEdit: boolean;
  canDelete: boolean;
  onChargersChanged: () => Promise<void>;
}) {
  const emailCount = contacts.filter((c) => !!c.email).length;
  const phoneCount = contacts.filter((c) => !!c.phone).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <SummaryStat label="Chargers"       value={String(chargers.length)} />
        <SummaryStat label="Contacts"       value={String(contacts.length)} />
        <SummaryStat label="Emails on file" value={String(emailCount)} />
        <SummaryStat label="Phones on file" value={String(phoneCount)} />
      </div>

      <ChargersCard
        customerId={customer?.id ?? null}
        chargers={chargers}
        canEdit={canEdit && !!customer}
        canDelete={canDelete}
        onChanged={onChargersChanged}
        noCustomer={!customer}
      />

      <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Created</div>
        <div style={{ fontSize: 13, color: '#1a1a1a' }}>
          {new Date(project.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
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

// ── Right column: Files tab ───────────────────────────────────────

function FilesTab() {
  return (
    <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 12, padding: 40, textAlign: 'center', color: C.slate, fontSize: 13, lineHeight: 1.6 }}>
      <div style={{ marginBottom: 8, display: 'inline-flex', justifyContent: 'center' }}><FolderClosed size={32} color={C.slate} strokeWidth={1.5} /></div>
      No files yet. File uploads will live here once the integration is built.
    </div>
  );
}

// ── Chargers card + modal (customer-scoped, surfaced on the project) ──

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysFromToday(s: string | null): number | null {
  if (!s) return null;
  const todayMid = new Date(new Date().toDateString()).getTime();
  return Math.round((new Date(s).getTime() - todayMid) / 86_400_000);
}

function warrantyTone(endDate: string | null): { label: string; bg: string; color: string } {
  const d = daysFromToday(endDate);
  if (d === null) return { label: 'No warranty info', bg: '#F3F3F3', color: '#767B77' };
  if (d < 0)      return { label: `Expired ${Math.abs(d)}d ago`, bg: '#FDEAEA', color: '#C0321A' };
  if (d <= 30)    return { label: `Expires in ${d}d`, bg: '#FFF0E0', color: '#B45309' };
  return { label: `In warranty · ${d}d left`, bg: '#E4F3E3', color: '#1B512D' };
}

function ChargersCard({ customerId, chargers, canEdit, canDelete, onChanged, noCustomer }: {
  customerId: string | null;
  chargers: CustomerCharger[];
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
  noCustomer: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CustomerCharger | null>(null);

  return (
    <div style={{ background: C.white, borderRadius: 14, border: '1px solid #EBEBEB', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Chargers Purchased {chargers.length > 0 && <span style={{ color: C.slate, marginLeft: 4 }}>· {chargers.length}</span>}
          </div>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
            Track units sold to this customer — turn-on date, Form A / D schedules, and warranty windows.
          </div>
        </div>
        {canEdit && (
          <button onClick={() => setAdding(true)}
            style={{ padding: '7px 14px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            + Add Charger
          </button>
        )}
      </div>

      {noCustomer ? (
        <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: C.slate, textAlign: 'center', lineHeight: 1.6 }}>
          Link a customer first to manage chargers.
        </div>
      ) : chargers.length === 0 ? (
        <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: C.slate, textAlign: 'center', lineHeight: 1.6 }}>
          No chargers logged yet.{canEdit && ' Click + Add Charger to start.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {chargers.map((ch) => {
            const tone = warrantyTone(ch.warranty_end_date);
            const cellCursor = canEdit ? 'pointer' : 'default';
            return (
              <div key={ch.id}
                onClick={() => { if (canEdit) setEditing(ch); }}
                style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, cursor: cellCursor }}
                onMouseEnter={(e) => { if (canEdit) e.currentTarget.style.borderColor = '#C8E6C9'; }}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#EBEBEB')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{ch.asset_tag}</div>
                  {ch.brand_model && <div style={{ fontSize: 11, color: C.slate }}>{ch.brand_model}</div>}
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: tone.bg, color: tone.color, whiteSpace: 'nowrap' }}>
                    {tone.label}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  <ChargerMeta label="Turn-on"     value={fmtDate(ch.turn_on_date)} />
                  <ChargerMeta label="Form A next" value={fmtDate(ch.form_a_next_date)} />
                  <ChargerMeta label="Form D next" value={fmtDate(ch.form_d_next_date)} />
                  <ChargerMeta label="Warranty"    value={ch.warranty_start_date || ch.warranty_end_date
                    ? `${fmtDate(ch.warranty_start_date)} → ${fmtDate(ch.warranty_end_date)}`
                    : '—'} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && customerId && (
        <ChargerModal
          title="New Charger"
          initial={blankCharger()}
          canDelete={false}
          onSave={async (data) => {
            await supabase.from('customer_chargers').insert({ ...data, customer_id: customerId });
            await onChanged();
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <ChargerModal
          key={editing.id}
          title="Edit Charger"
          initial={{
            asset_tag: editing.asset_tag,
            brand_model: editing.brand_model,
            turn_on_date: editing.turn_on_date,
            form_a_next_date: editing.form_a_next_date,
            form_d_next_date: editing.form_d_next_date,
            warranty_start_date: editing.warranty_start_date,
            warranty_end_date: editing.warranty_end_date,
            notes: editing.notes,
          }}
          canDelete={canDelete}
          onSave={async (data) => {
            await supabase.from('customer_chargers').update(data).eq('id', editing.id);
            await onChanged();
          }}
          onDelete={async () => {
            await supabase.from('customer_chargers').delete().eq('id', editing.id);
            await onChanged();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ChargerMeta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 12, color: value === '—' ? C.slate : '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

interface ChargerFormData {
  asset_tag: string;
  brand_model: string | null;
  turn_on_date: string | null;
  form_a_next_date: string | null;
  form_d_next_date: string | null;
  warranty_start_date: string | null;
  warranty_end_date: string | null;
  notes: string | null;
}

function blankCharger(): ChargerFormData {
  return {
    asset_tag: '', brand_model: null,
    turn_on_date: null, form_a_next_date: null, form_d_next_date: null,
    warranty_start_date: null, warranty_end_date: null, notes: null,
  };
}

function ChargerModal({ title, initial, canDelete, onSave, onDelete, onClose }: {
  title: string;
  initial: ChargerFormData;
  canDelete: boolean;
  onSave: (data: ChargerFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ChargerFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const set = <K extends keyof ChargerFormData>(k: K, v: ChargerFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      asset_tag:           form.asset_tag.trim(),
      brand_model:         form.brand_model && form.brand_model.trim() ? form.brand_model.trim() : null,
      turn_on_date:        form.turn_on_date || null,
      form_a_next_date:    form.form_a_next_date || null,
      form_d_next_date:    form.form_d_next_date || null,
      warranty_start_date: form.warranty_start_date || null,
      warranty_end_date:   form.warranty_end_date || null,
      notes:               form.notes && form.notes.trim() ? form.notes.trim() : null,
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

  const canSave = form.asset_tag.trim().length > 0 && !saving;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 580, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Asset Tag / Serial</FieldLabel>
            <input value={form.asset_tag} onChange={(e) => set('asset_tag', e.target.value)} placeholder="CHG-001" style={inputStyle()} autoFocus />
          </div>
          <div>
            <FieldLabel>Brand & Model</FieldLabel>
            <input value={form.brand_model ?? ''} onChange={(e) => set('brand_model', e.target.value || null)} placeholder="ABB Terra 54 CJG" style={inputStyle()} />
          </div>
        </div>

        <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Service Dates</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <div>
              <FieldLabel>Turn-on</FieldLabel>
              <input type="date" value={form.turn_on_date ?? ''} onChange={(e) => set('turn_on_date', e.target.value || null)} style={{ ...inputStyle(), background: C.white }} />
            </div>
            <div>
              <FieldLabel>Form A Next</FieldLabel>
              <input type="date" value={form.form_a_next_date ?? ''} onChange={(e) => set('form_a_next_date', e.target.value || null)} style={{ ...inputStyle(), background: C.white }} />
            </div>
            <div>
              <FieldLabel>Form D Next</FieldLabel>
              <input type="date" value={form.form_d_next_date ?? ''} onChange={(e) => set('form_d_next_date', e.target.value || null)} style={{ ...inputStyle(), background: C.white }} />
            </div>
          </div>
        </div>

        <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Warranty</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <FieldLabel>Start Date</FieldLabel>
              <input type="date" value={form.warranty_start_date ?? ''} onChange={(e) => set('warranty_start_date', e.target.value || null)} style={{ ...inputStyle(), background: C.white }} />
            </div>
            <div>
              <FieldLabel>End Date</FieldLabel>
              <input type="date" value={form.warranty_end_date ?? ''} onChange={(e) => set('warranty_end_date', e.target.value || null)} style={{ ...inputStyle(), background: C.white }} />
            </div>
          </div>
        </div>

        <div>
          <FieldLabel>Notes</FieldLabel>
          <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} rows={3}
            placeholder="Serial number, install quirks, warranty terms…"
            style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this charger?</div>
            <div style={{ fontSize: 12, color: '#C0321A' }}>This action is permanent.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => void handleDelete()} disabled={deleting}
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
            <button onClick={() => void handleSave()} disabled={!canSave}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
