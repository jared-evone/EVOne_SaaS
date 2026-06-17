import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { Search, Mail, Phone, Pencil, FileText, Upload, Download as DownloadIcon, ChevronDown, X } from 'lucide-react';
import { OneMapAutocomplete } from '../components/OneMapAutocomplete';
import { useIsMobile } from '../lib/useIsMobile';
import {
  type EmailBrand, DEFAULT_LTA_BRAND, fetchLtaBrand, buildLtaEmailHtml,
  type EmailSender, fetchSenders,
} from '../lib/ltaEmail';
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

// ── Brand searchable dropdown (local copy of the TSD pattern) ─────

interface SearchSelectOption { value: string; label: string; }

function SearchSelect({ value, options, onChange, disabled, placeholder }: {
  value: string;
  options: SearchSelectOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const ql = q.trim().toLowerCase();
  const filtered = ql ? options.filter((o) => o.label.toLowerCase().includes(ql)) : options;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled} onClick={() => { setOpen((o) => !o); setQ(''); }}
        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${open ? C.green : '#EBEBEB'}`, background: disabled ? '#F9F9F9' : C.white, fontFamily: 'Figtree', fontSize: 13, cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? '#1a1a1a' : C.slate }}>
          {selected?.label ?? placeholder ?? 'Select…'}
        </span>
        <ChevronDown size={16} strokeWidth={2.25} style={{ color: C.slate, flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && !disabled && (
        <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 60, top: 'calc(100% + 6px)', background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.14)', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              style={{ width: '100%', padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.seasalt, boxSizing: 'border-box' }} />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={13} /></span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px', textAlign: 'center', color: C.slate, fontSize: 12 }}>No matches</div>
            ) : filtered.map((o) => {
              const active = o.value === value;
              return (
                <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.seasalt; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  style={{ flexShrink: 0, width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: active ? C.honeydew : 'transparent', color: active ? C.green : '#1a1a1a', fontFamily: 'Figtree', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Top-level screen ──────────────────────────────────────────────

type StatusFilter = 'all' | ProjectStatus;

export function ScreenProjects() {
  const { can } = usePermissions();
  const canEdit   = can('projects', 'can_edit');
  const canDelete = can('projects', 'can_delete');

  const [projects, setProjects]   = useState<Project[]>([]);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [siteCounts, setSiteCounts]       = useState<Record<string, number>>({});
  const [chargerCounts, setChargerCounts] = useState<Record<string, number>>({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [adding, setAdding]       = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: ps, error: pErr }, { data: cs }, { data: siteData }, { data: chargerData }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name, type').order('name'),
      supabase.from('project_sites').select('id, project_id'),
      supabase.from('site_chargers').select('site_id'),
    ]);
    setLoading(false);
    if (pErr) { setError(pErr.message); return; }
    setError(null);
    setProjects((ps ?? []) as Project[]);
    setCustomers((cs ?? []) as CustomerLite[]);

    // Site + charger counts per registry entry (project).
    const sites = (siteData ?? []) as { id: string; project_id: string }[];
    const chargers = (chargerData ?? []) as { site_id: string }[];
    const siteToProject = new Map(sites.map((s) => [s.id, s.project_id]));
    const sc: Record<string, number> = {};
    for (const s of sites) sc[s.project_id] = (sc[s.project_id] ?? 0) + 1;
    const cc: Record<string, number> = {};
    for (const ch of chargers) { const pid = siteToProject.get(ch.site_id); if (pid) cc[pid] = (cc[pid] ?? 0) + 1; }
    setSiteCounts(sc);
    setChargerCounts(cc);
  };
  useEffect(() => { void fetchAll(); }, []);

  const customerById = (id: string | null) => id ? customers.find((c) => c.id === id) ?? null : null;

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Companies" value={String(projects.length)} sub="in registry" accent />
        <KPICard label="Sites"     value={String(Object.values(siteCounts).reduce((a, b) => a + b, 0))} sub="across all customers" />
        <KPICard label="Chargers"  value={String(Object.values(chargerCounts).reduce((a, b) => a + b, 0))} sub="registered" />
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
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chargers…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        {canEdit && (
          <button onClick={() => setAdding(true)}
            style={{ marginLeft: 'auto', padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + New Registration
          </button>
        )}
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Customer', 'Status', 'Sites', 'Chargers', 'Updated'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  {projects.length === 0 ? 'No customers yet. Click "+ New Registration" to add one.' : 'No customers match your filters.'}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, color: '#1a1a1a', fontSize: 13 }}>{p.name}</span>
                        {cust && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: TYPE_PALETTE[cust.type].bg, color: TYPE_PALETTE[cust.type].color }}>
                            {TYPE_LABEL[cust.type]}
                          </span>
                        )}
                      </div>
                      {p.notes && (
                        <div style={{ fontSize: 11, color: C.slate, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>{p.notes}</div>
                      )}
                    </td>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: 'pointer' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: palette.bg, color: palette.color }}>
                        {PROJECT_STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: 'pointer', fontSize: 13, color: '#1a1a1a' }}>{siteCounts[p.id] ?? 0}</td>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: C.green }}>{chargerCounts[p.id] ?? 0}</td>
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
        <ProjectModal title="New Registration" initial={blankProject()} customers={customers}
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
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 540, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div>
          <FieldLabel>Linked Customer</FieldLabel>
          <SearchSelect value={form.customer_id ?? ''} onChange={onCustomerChange}
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="— Select a customer —" />
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>
            Customers are shared across Charger Registry, Sales, and Technical Service. Deleting a customer keeps this charger — the link just goes blank.
          </div>
        </div>

        <div>
          <FieldLabel>Charger Name</FieldLabel>
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

interface SiteCharger {
  id: string;
  site_id: string;
  asset_tag: string;
  brand_model: string | null;
  turn_on_date: string | null;
  form_a_next_date: string | null;
  form_d_next_date: string | null;
  warranty_start_date: string | null;
  warranty_end_date: string | null;
  has_maintenance_package: boolean;
  lta_contract_years: number | null;
  lta_contract_start_date: string | null;
  form_1_path: string | null;
  form_1_filename: string | null;
  notes: string | null;
}

const CHARGER_FORMS_BUCKET = 'charger-forms';

interface ProjectSite {
  id: string;
  project_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  position: number;
  site_chargers: SiteCharger[];
}

interface BrandModel {
  id: string;
  label: string;
  position: number;
}

type ProjectFileSection = 'invoices' | 'others';

interface ProjectFile {
  id: string;
  project_id: string;
  section: ProjectFileSection;
  filename: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
}

const PROJECT_FILES_BUCKET = 'project-files';

type DetailTabId = 'overview' | 'files' | `site:${string}`;

function ProjectDetailPage({ projectId, customers, canEdit, canDelete, onBack }: {
  projectId: string;
  customers: CustomerLite[];
  canEdit: boolean;
  canDelete: boolean;
  onBack: () => Promise<void>;
}) {
  const isMobile = useIsMobile();
  const [project, setProject]   = useState<Project | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [sites, setSites]       = useState<ProjectSite[]>([]);
  const [files, setFiles]       = useState<ProjectFile[]>([]);
  const [brandModels, setBrandModels] = useState<BrandModel[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<DetailTabId>('overview');
  const [addingSite, setAddingSite] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchAll = async () => {
    const [{ data: p }, { data: f }, { data: s }, { data: bm }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
      supabase.from('project_files').select('*').eq('project_id', projectId).order('uploaded_at', { ascending: false }),
      supabase.from('project_sites').select('*, site_chargers(*)').eq('project_id', projectId).order('position').order('created_at'),
      supabase.from('charger_brand_models').select('*').order('position').order('label'),
    ]);
    const proj = (p as Project | null) ?? null;
    setProject(proj);
    setFiles((f ?? []) as ProjectFile[]);
    setSites((s ?? []) as ProjectSite[]);
    setBrandModels((bm ?? []) as BrandModel[]);
    if (proj?.customer_id) {
      const [{ data: c }, { data: cc }] = await Promise.all([
        supabase.from('customers').select('*').eq('id', proj.customer_id).maybeSingle(),
        supabase.from('customer_contacts').select('id, customer_id, name, email, phone').eq('customer_id', proj.customer_id).order('position').order('created_at'),
      ]);
      setCustomer((c as Customer | null) ?? null);
      setContacts((cc ?? []) as CustomerContact[]);
    } else {
      setCustomer(null);
      setContacts([]);
    }
    setLoading(false);
  };
  useEffect(() => { void fetchAll(); }, [projectId]);

  // If the currently-active site tab disappears (delete / reload), fall back to overview.
  useEffect(() => {
    if (tab.startsWith('site:') && !sites.find((s) => `site:${s.id}` === tab)) {
      setTab('overview');
    }
  }, [sites, tab]);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    // Deleting the project cascade-deletes its sites, chargers, LTA records,
    // warranty claims and project_files rows (FK ON DELETE CASCADE). Storage
    // objects don't cascade, so clean them up first to avoid orphans.
    const chargers = sites.flatMap((s) => s.site_chargers ?? []);
    const chargerFormPaths: string[] = chargers.map((c) => c.form_1_path).filter((p): p is string => !!p);
    const chargerIds = chargers.map((c) => c.id);
    if (chargerIds.length) {
      const { data: lta } = await supabase.from('charger_lta_records').select('storage_path, invoice_path').in('charger_id', chargerIds);
      for (const r of (lta ?? []) as Array<{ storage_path: string | null; invoice_path: string | null }>) {
        if (r.storage_path) chargerFormPaths.push(r.storage_path);
        if (r.invoice_path) chargerFormPaths.push(r.invoice_path);
      }
    }
    const projectFilePaths = files.map((f) => f.storage_path).filter(Boolean);
    if (projectFilePaths.length) await supabase.storage.from(PROJECT_FILES_BUCKET).remove(projectFilePaths);
    if (chargerFormPaths.length) await supabase.storage.from(CHARGER_FORMS_BUCKET).remove(chargerFormPaths);

    const { error } = await supabase.from('projects').delete().eq('id', projectId);
    setDeleting(false);
    if (error) { setDeleteError(error.message); return; }
    await onBack();
  };

  if (loading || !project) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 14 }}>
        {loading ? 'Loading charger…' : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>Charger not found.</div>
            <button onClick={() => void onBack()}
              style={{ alignSelf: 'center', padding: '9px 20px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ← Back to Charger Registry
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
          ← Charger Registry
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
            Delete charger
          </button>
        )}
      </div>

      {confirmDelete && (
        <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A', flex: 1 }}>
            {deleteError
              ? <>Could not delete: {deleteError}</>
              : <>Delete <strong>{project.name}</strong>? Its sites and chargers will be removed too. The linked customer is unaffected.</>}
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
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '360px 1fr', gap: 18, alignItems: 'start' }}>
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
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #EBEBEB', padding: '8px 12px', gap: 4, overflowX: 'auto', flexWrap: 'nowrap' }}>
            <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
            <TabButton active={tab === 'files'}    onClick={() => setTab('files')}>
              Documents{files.length > 0 && <span style={{ color: C.slate, marginLeft: 4, fontWeight: 600 }}>· {files.length}</span>}
            </TabButton>
            {sites.map((s) => {
              const id: DetailTabId = `site:${s.id}`;
              return (
                <TabButton key={s.id} active={tab === id} onClick={() => setTab(id)}>
                  {s.name}{s.site_chargers.length > 0 && <span style={{ color: C.slate, marginLeft: 4, fontWeight: 600 }}>· {s.site_chargers.length}</span>}
                </TabButton>
              );
            })}
            {canEdit && (
              <button onClick={() => setAddingSite(true)}
                style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 10, border: `1px dashed ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                + Site
              </button>
            )}
          </div>
          <div style={{ padding: 22 }}>
            {tab === 'overview' && (
              <OverviewTab
                project={project}
                contacts={contacts}
                sites={sites}
                onPickSite={(id) => setTab(`site:${id}`)}
                canEdit={canEdit}
                onAddSite={() => setAddingSite(true)}
              />
            )}
            {tab === 'files' && (
              <FilesTab
                projectId={project.id}
                files={files}
                canEdit={canEdit}
                canDelete={canDelete}
                onChanged={fetchAll}
              />
            )}
            {tab.startsWith('site:') && (() => {
              const site = sites.find((s) => `site:${s.id}` === tab);
              if (!site) return null;
              return (
                <SiteTab
                  site={site}
                  brandModels={brandModels}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  customer={{ name: customer?.name ?? project.name, email: contacts.find((c) => c.email)?.email ?? null, type: customer?.type }}
                  onChanged={fetchAll}
                  onDeleted={() => setTab('overview')}
                />
              );
            })()}
          </div>
        </div>
        {addingSite && (
          <SiteModal
            title="New Site"
            initial={{ name: '', address: null, latitude: null, longitude: null, notes: null }}
            canDelete={false}
            onSave={async (data) => {
              const { data: created } = await supabase.from('project_sites')
                .insert({ ...data, project_id: project.id })
                .select()
                .single();
              await fetchAll();
              if (created) setTab(`site:${created.id}`);
            }}
            onClose={() => setAddingSite(false)}
          />
        )}
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
        <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Charger Details</div>
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
            <SearchSelect value={customerId ?? ''} onChange={onCustomerChange}
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="— Select a customer —" />
          </div>
          <div>
            <FieldLabel>Charger Name</FieldLabel>
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
          Linked customer was deleted — pick a new one from <strong>Charger Details</strong> to keep this charger connected.
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

function OverviewTab({ project, contacts, sites, onPickSite, canEdit, onAddSite }: {
  project: Project;
  contacts: CustomerContact[];
  sites: ProjectSite[];
  onPickSite: (id: string) => void;
  canEdit: boolean;
  onAddSite: () => void;
}) {
  const emailCount   = contacts.filter((c) => !!c.email).length;
  const phoneCount   = contacts.filter((c) => !!c.phone).length;
  const chargerCount = sites.reduce((n, s) => n + s.site_chargers.length, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <SummaryStat label="Sites"    value={String(sites.length)} />
        <SummaryStat label="Chargers" value={String(chargerCount)} />
        <SummaryStat label="Contacts" value={String(contacts.length)} sub={`${emailCount} email${emailCount === 1 ? '' : 's'} · ${phoneCount} phone${phoneCount === 1 ? '' : 's'} on file`} />
      </div>

      <div style={{ background: C.white, borderRadius: 14, border: '1px solid #EBEBEB', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Sites{sites.length > 0 && <span style={{ color: C.slate, marginLeft: 4 }}>· {sites.length}</span>}
            </div>
            <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
              One tab per site — chargers, address, and notes live inside each site.
            </div>
          </div>
          {canEdit && (
            <button onClick={onAddSite}
              style={{ padding: '7px 14px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + Add Site
            </button>
          )}
        </div>
        {sites.length === 0 ? (
          <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: C.slate, textAlign: 'center', lineHeight: 1.6 }}>
            No sites yet.{canEdit && ' Click + Add Site to add the first one.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sites.map((s) => (
              <div key={s.id}
                onClick={() => onPickSite(s.id)}
                style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#C8E6C9')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#EBEBEB')}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{s.name}</div>
                  {s.address && (
                    <div style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.address}</div>
                  )}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: C.honeydew, color: C.green, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {s.site_chargers.length} charger{s.site_chargers.length === 1 ? '' : 's'}
                </span>
                <span style={{ color: C.green, fontWeight: 700, fontSize: 12 }}>Open →</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Created</div>
        <div style={{ fontSize: 13, color: '#1a1a1a' }}>
          {new Date(project.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{ padding: '8px 16px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        background: active ? C.honeydew : 'transparent',
        color: active ? C.green : C.slate,
        borderBottom: active ? `2px solid ${C.green}` : '2px solid transparent',
        marginBottom: -1,
        whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  );
}

function SummaryStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

// ── Site tab (one per site) ───────────────────────────────────────

function SiteTab({ site, brandModels, canEdit, canDelete, customer, onChanged, onDeleted }: {
  site: ProjectSite;
  brandModels: BrandModel[];
  canEdit: boolean;
  canDelete: boolean;
  customer: LtaEmailCustomer;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [editingSite, setEditingSite] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    await supabase.from('project_sites').delete().eq('id', site.id);
    setDeleting(false);
    onDeleted();
    await onChanged();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Site header */}
      <div style={{ background: C.white, borderRadius: 14, border: '1px solid #EBEBEB', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a' }}>{site.name}</div>
            {site.address && (
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{site.address}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canEdit && (
              <button onClick={() => setEditingSite(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <Pencil size={11} strokeWidth={2.25} /> Edit
              </button>
            )}
            {canDelete && (
              <button onClick={() => setConfirmDelete(true)}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Delete site
              </button>
            )}
          </div>
        </div>
        {site.notes && (
          <div style={{ background: C.seasalt, borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#1a1a1a', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {site.notes}
          </div>
        )}
        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#C0321A', flex: 1 }}>
              Delete <strong>{site.name}</strong>? All {site.site_chargers.length} charger{site.site_chargers.length === 1 ? '' : 's'} under this site will go with it.
            </div>
            <button onClick={() => setConfirmDelete(false)} disabled={deleting}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => void handleDelete()} disabled={deleting}
              style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </button>
          </div>
        )}
      </div>

      <SiteChargersCard
        siteId={site.id}
        siteName={site.name}
        chargers={site.site_chargers}
        brandModels={brandModels}
        canEdit={canEdit}
        canDelete={canDelete}
        customer={customer}
        onChanged={onChanged}
      />

      {editingSite && (
        <SiteModal
          title="Edit Site"
          initial={{ name: site.name, address: site.address, latitude: site.latitude, longitude: site.longitude, notes: site.notes }}
          canDelete={false}
          onSave={async (data) => {
            await supabase.from('project_sites').update(data).eq('id', site.id);
            await onChanged();
          }}
          onClose={() => setEditingSite(false)}
        />
      )}
    </div>
  );
}

interface SiteFormData {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

function SiteModal({ title, initial, onSave, onClose }: {
  title: string;
  initial: SiteFormData;
  canDelete: boolean;
  onSave: (data: SiteFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<SiteFormData>(initial);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name:      form.name.trim(),
      address:   form.address && form.address.trim() ? form.address.trim() : null,
      latitude:  form.latitude,
      longitude: form.longitude,
      notes:     form.notes && form.notes.trim() ? form.notes.trim() : null,
    });
    setSaving(false);
    onClose();
  };

  const canSave = form.name.trim().length > 0 && (form.address ?? '').trim().length > 0 && !saving;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 520, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>
        <div>
          <FieldLabel>Site Name</FieldLabel>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Main building, Block A, Carpark Level B2 …" style={inputStyle()} autoFocus />
        </div>
        <div>
          <FieldLabel>Address</FieldLabel>
          <OneMapAutocomplete
            value={form.address ?? ''}
            onChange={(t) => setForm((f) => ({ ...f, address: t || null }))}
            onPick={(r) => setForm((f) => ({ ...f, address: r.address, latitude: r.latitude, longitude: r.longitude }))}
            placeholder="Start typing — pick a Singapore address to auto-fill lat/lng"
          />
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.4 }}>
            Powered by <a href="https://www.onemap.gov.sg" target="_blank" rel="noreferrer" style={{ color: C.green, textDecoration: 'none', fontWeight: 600 }}>OneMap</a> (data.gov.sg). Picking a suggestion saves latitude &amp; longitude alongside the address.
          </div>
        </div>
        <div>
          <FieldLabel>Notes (optional)</FieldLabel>
          <textarea value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
            rows={3} placeholder="Access details, key contacts, install quirks…"
            style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void handleSave()} disabled={!canSave}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Right column: Files tab ───────────────────────────────────────

function FilesTab({ projectId, files, canEdit, canDelete, onChanged }: {
  projectId: string;
  files: ProjectFile[];
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
}) {
  const invoices = files.filter((f) => f.section === 'invoices');
  const others   = files.filter((f) => f.section === 'others');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <FileSection title="Invoices" section="invoices" files={invoices}
        projectId={projectId} canEdit={canEdit} canDelete={canDelete} onChanged={onChanged} />
      <FileSection title="Others" section="others" files={others}
        projectId={projectId} canEdit={canEdit} canDelete={canDelete} onChanged={onChanged} />
    </div>
  );
}

function FileSection({ title, section, files, projectId, canEdit, canDelete, onChanged }: {
  title: string;
  section: ProjectFileSection;
  files: ProjectFile[];
  projectId: string;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = async (list: FileList) => {
    if (!canEdit) return;
    setError(null);
    setUploading(true);
    const failures: string[] = [];
    for (const file of Array.from(list)) {
      const id = crypto.randomUUID();
      const ext = file.name.match(/\.[^.]+$/)?.[0] ?? '';
      const path = `${projectId}/${section}/${id}${ext}`;
      const { error: upErr } = await supabase.storage.from(PROJECT_FILES_BUCKET).upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      });
      if (upErr) { failures.push(`${file.name}: ${upErr.message}`); continue; }
      const { error: rowErr } = await supabase.from('project_files').insert({
        project_id: projectId,
        section,
        filename: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
      });
      if (rowErr) {
        // Roll back the storage upload so we don't leave orphans.
        await supabase.storage.from(PROJECT_FILES_BUCKET).remove([path]);
        failures.push(`${file.name}: ${rowErr.message}`);
      }
    }
    setUploading(false);
    if (failures.length) setError(failures.join(' · '));
    await onChanged();
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
  };
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
    e.target.value = '';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {title}{files.length > 0 && <span style={{ color: C.slate, marginLeft: 4 }}>· {files.length}</span>}
        </div>
        {canEdit && (
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: uploading ? 'default' : 'pointer' }}>
            <Upload size={12} strokeWidth={2.25} /> {uploading ? 'Uploading…' : 'Upload'}
          </button>
        )}
      </div>

      {canEdit && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          style={{
            background: dragging ? C.honeydew : C.seasalt,
            border: `2px dashed ${dragging ? C.green : '#EBEBEB'}`,
            borderRadius: 12, padding: '20px 16px', textAlign: 'center', cursor: 'pointer',
            transition: 'background .15s, border-color .15s', display: 'flex',
            flexDirection: 'column', alignItems: 'center', gap: 6,
          }}>
          <input ref={inputRef} type="file" multiple onChange={onPick} style={{ display: 'none' }} />
          <Upload size={26} color={dragging ? C.green : C.slate} strokeWidth={1.5} />
          <div style={{ fontSize: 13, fontWeight: 600, color: dragging ? C.green : C.slate }}>
            {dragging ? `Drop files into ${title}` : `Drag & drop or click to upload`}
          </div>
          <div style={{ fontSize: 11, color: C.slate }}>Any file type · multiple at once</div>
        </div>
      )}

      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {files.length === 0 ? (
        !canEdit && (
          <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: C.slate, textAlign: 'center' }}>
            No {title.toLowerCase()} yet.
          </div>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map((f) => (
            <FileRow key={f.id} file={f} canDelete={canDelete} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ file, canDelete, onChanged }: { file: ProjectFile; canDelete: boolean; onChanged: () => Promise<void> }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const view = async () => {
    const { data, error } = await supabase.storage.from(PROJECT_FILES_BUCKET).createSignedUrl(file.storage_path, 60);
    if (error || !data) { alert(`Could not open: ${error?.message ?? 'unknown'}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const download = async () => {
    const { data, error } = await supabase.storage.from(PROJECT_FILES_BUCKET)
      .createSignedUrl(file.storage_path, 60, { download: file.filename });
    if (error || !data) { alert(`Could not download: ${error?.message ?? 'unknown'}`); return; }
    const a = document.createElement('a');
    a.href = data.signedUrl; a.rel = 'noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
  };

  const remove = async () => {
    setBusy(true);
    await supabase.storage.from(PROJECT_FILES_BUCKET).remove([file.storage_path]);
    await supabase.from('project_files').delete().eq('id', file.id);
    setBusy(false);
    await onChanged();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid #EBEBEB', borderRadius: 10, background: C.white }}>
      <FileText size={18} strokeWidth={1.75} color={C.slate} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div title={file.filename} style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.filename}
        </div>
        <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
          {fmtSize(file.size_bytes)} · uploaded {fmtUploadedAt(file.uploaded_at)}
        </div>
      </div>
      {confirmDelete ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FDEAEA', borderRadius: 8, padding: '4px 8px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#C0321A' }}>Delete?</span>
          <button onClick={() => setConfirmDelete(false)} disabled={busy}
            style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void remove()} disabled={busy}
            style={{ padding: '3px 8px', borderRadius: 6, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {busy ? '…' : 'Yes'}
          </button>
        </div>
      ) : (
        <>
          <button onClick={() => void view()}
            title={`View ${file.filename}`}
            style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            View
          </button>
          <button onClick={() => void download()}
            title={`Download ${file.filename}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 6, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            <DownloadIcon size={11} strokeWidth={2.25} /> PDF
          </button>
          {canDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              Delete
            </button>
          )}
        </>
      )}
    </div>
  );
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtUploadedAt(s: string): string {
  return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Chargers card + modal (site-scoped) ───────────────────────────

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

type ChargerDetailTab = 'details' | 'maintenance' | 'warranty';

function SiteChargersCard({ siteId, siteName, chargers, brandModels, canEdit, canDelete, customer, onChanged }: {
  siteId: string;
  siteName: string;
  chargers: SiteCharger[];
  brandModels: BrandModel[];
  canEdit: boolean;
  canDelete: boolean;
  customer: LtaEmailCustomer;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SiteCharger | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ChargerDetailTab>('details');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // If the selected charger disappears (deleted / reload) drop the selection.
  useEffect(() => {
    if (selectedId && !chargers.find((c) => c.id === selectedId)) setSelectedId(null);
  }, [chargers, selectedId]);

  // Clear the confirmation when the user switches chargers.
  useEffect(() => { setConfirmingDelete(false); }, [selectedId]);

  const selected = chargers.find((c) => c.id === selectedId) ?? null;

  const handleDeleteSelected = async () => {
    if (!selected) return;
    setDeleting(true);
    await supabase.from('site_chargers').delete().eq('id', selected.id);
    await onChanged();
    setDeleting(false);
    setConfirmingDelete(false);
  };

  return (
    <div style={{ background: C.white, borderRadius: 14, border: '1px solid #EBEBEB', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Chargers {chargers.length > 0 && <span style={{ color: C.slate, marginLeft: 4 }}>· {chargers.length}</span>}
          </div>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
            Tap a card to open its Details, LTA Inspection, and Warranty tabs below.
          </div>
        </div>
        {canEdit && (
          <button onClick={() => setAdding(true)}
            style={{ padding: '7px 14px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            + Add Charger
          </button>
        )}
      </div>

      {chargers.length === 0 ? (
        <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: C.slate, textAlign: 'center', lineHeight: 1.6 }}>
          No chargers logged at this site yet.{canEdit && ' Click + Add Charger to start.'}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {chargers.map((ch) => (
            <ChargerCard
              key={ch.id}
              charger={ch}
              selected={selectedId === ch.id}
              onClick={() => setSelectedId(selectedId === ch.id ? null : ch.id)}
            />
          ))}
        </div>
      )}

      {selected && (
        <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #EBEBEB', padding: '6px 10px', gap: 4 }}>
            {(['details', 'maintenance', 'warranty'] as ChargerDetailTab[]).map((t) => (
              <TabButton key={t} active={tab === t} onClick={() => setTab(t)}>
                {t === 'details' ? 'Details' : t === 'maintenance' ? 'LTA Inspection' : 'Warranty'}
              </TabButton>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {canEdit && (
                <button onClick={() => setEditing(selected)} disabled={confirmingDelete || deleting}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: (confirmingDelete || deleting) ? 'default' : 'pointer', opacity: (confirmingDelete || deleting) ? 0.5 : 1 }}>
                  <Pencil size={11} strokeWidth={2.25} /> Edit
                </button>
              )}
              {canDelete && !confirmingDelete && (
                <button onClick={() => setConfirmingDelete(true)}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  Delete
                </button>
              )}
            </div>
          </div>
          {confirmingDelete && (
            <div style={{ background: '#FDEAEA', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #EBEBEB' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#C0321A', flex: 1, lineHeight: 1.5 }}>
                Delete charger <strong>{selected.asset_tag}</strong>? This action is permanent.
              </div>
              <button onClick={() => setConfirmingDelete(false)} disabled={deleting}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: deleting ? 'default' : 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => void handleDeleteSelected()} disabled={deleting}
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: deleting ? 'default' : 'pointer' }}>
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          )}
          <div style={{ padding: 18 }}>
            <ChargerTabPanel charger={selected} siteName={siteName} tab={tab} onTabChange={setTab} canEdit={canEdit} canDelete={canDelete} customer={customer} onChargerChanged={onChanged} />
          </div>
        </div>
      )}

      {adding && (
        <ChargerModal
          title="New Registration"
          initial={blankCharger()}
          siteName={siteName}
          isResidential={customer.type === 'residential'}
          brandModels={brandModels}
          canDelete={false}
          canManageBrandModels={canDelete}
          onSave={async (data) => {
            await supabase.from('site_chargers').insert({ ...data, site_id: siteId });
            await onChanged();
          }}
          onBrandModelsChanged={onChanged}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <ChargerModal
          key={editing.id}
          title="Edit Charger"
          siteName={siteName}
          isResidential={customer.type === 'residential'}
          initial={{
            asset_tag: editing.asset_tag,
            brand_model: editing.brand_model,
            turn_on_date: editing.turn_on_date,
            form_a_next_date: editing.form_a_next_date,
            form_d_next_date: editing.form_d_next_date,
            warranty_start_date: editing.warranty_start_date,
            warranty_end_date: editing.warranty_end_date,
            form_1_path: editing.form_1_path,
            form_1_filename: editing.form_1_filename,
            notes: editing.notes,
          }}
          brandModels={brandModels}
          canDelete={canDelete}
          canManageBrandModels={canDelete}
          onSave={async (data) => {
            await supabase.from('site_chargers').update(data).eq('id', editing.id);
            await onChanged();
          }}
          onBrandModelsChanged={onChanged}
          onDelete={async () => {
            await supabase.from('site_chargers').delete().eq('id', editing.id);
            await onChanged();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ChargerCard({ charger, selected, onClick }: { charger: SiteCharger; selected: boolean; onClick: () => void }) {
  const tone = warrantyTone(charger.warranty_end_date);
  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? C.honeydew : C.white,
        border: `${selected ? 2 : 1}px solid ${selected ? C.green : '#EBEBEB'}`,
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: 'pointer',
        minWidth: 200,
        maxWidth: 240,
        flexShrink: 0,
        transition: 'background .15s, border-color .15s',
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.borderColor = '#C8E6C9'; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.borderColor = '#EBEBEB'; }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: selected ? C.green : '#1a1a1a', letterSpacing: '-0.01em' }}>
        {charger.asset_tag}
      </div>
      {charger.brand_model ? (
        <div style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{charger.brand_model}</div>
      ) : (
        <div style={{ fontSize: 11, color: C.slate, fontStyle: 'italic' }}>No model</div>
      )}
      <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: tone.bg, color: tone.color, whiteSpace: 'nowrap' }}>
        {tone.label}
      </span>
    </div>
  );
}

function ChargerTabPanel({ charger, siteName, tab, onTabChange, canEdit, canDelete, customer, onChargerChanged }: {
  charger: SiteCharger;
  siteName: string;
  tab: ChargerDetailTab;
  onTabChange: (t: ChargerDetailTab) => void;
  canEdit: boolean;
  canDelete: boolean;
  customer: LtaEmailCustomer;
  onChargerChanged: () => Promise<void>;
}) {
  if (tab === 'details')     return <ChargerDetailsPanel charger={charger} siteName={siteName} customer={customer} onTabChange={onTabChange} />;
  if (tab === 'maintenance') return <LtaInspectionPanel  charger={charger} siteName={siteName} canEdit={canEdit} canDelete={canDelete} customer={customer} onChargerChanged={onChargerChanged} />;
  return <WarrantyPanel charger={charger} siteName={siteName} canEdit={canEdit} canDelete={canDelete} />;
}

function ChargerDetailsPanel({ charger, siteName, customer, onTabChange }: {
  charger: SiteCharger;
  siteName: string;
  customer: LtaEmailCustomer;
  onTabChange: (t: ChargerDetailTab) => void;
}) {
  // Residential chargers need only Form A, every 24 months — no Form D.
  const isResidential = customer.type === 'residential';
  const formAMonths = isResidential ? 24 : 6;
  const [ltaRecords, setLtaRecords] = useState<LtaRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from('charger_lta_records')
        .select('*')
        .eq('charger_id', charger.id)
        .order('performed_at', { ascending: false });
      if (!cancelled) setLtaRecords((data ?? []) as LtaRecord[]);
    })();
    return () => { cancelled = true; };
  }, [charger.id]);

  const form1DisplayName = computeForm1Filename(charger.asset_tag, charger.turn_on_date, siteName);

  const openForm1 = async (mode: 'view' | 'download') => {
    if (!charger.form_1_path) return;
    const { data } = await supabase.storage.from(CHARGER_FORMS_BUCKET)
      .createSignedUrl(charger.form_1_path, 60, mode === 'download' ? { download: form1DisplayName } : undefined);
    if (data?.signedUrl) window.open(data.signedUrl, mode === 'download' ? '_self' : '_blank');
  };

  const openLtaRecord = async (record: LtaRecord) => {
    const downloadName = computeLtaFilename(record.form_type, charger.asset_tag, record.performed_at, siteName);
    const { data } = await supabase.storage.from(CHARGER_FORMS_BUCKET)
      .createSignedUrl(record.storage_path, 60, { download: downloadName });
    if (data?.signedUrl) window.open(data.signedUrl, '_self');
  };

  const tone = warrantyTone(charger.warranty_end_date);
  const formADate = nextCycleDate(charger.turn_on_date, formAMonths);
  const formDDate = nextCycleDate(charger.turn_on_date, 12);
  const formA = daysFromToday(formADate);
  const formD = daysFromToday(formDDate);
  const latestA = ltaRecords.find((r) => r.form_type === 'A') ?? null;
  const latestD = ltaRecords.find((r) => r.form_type === 'D') ?? null;
  const doneA = isInspectedWithin(latestA, formAMonths);
  const doneD = isInspectedWithin(latestD, 12);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <ChargerDetailRow label="Serial Number" value={charger.asset_tag} />
        <ChargerDetailRow label="Brand & Model" value={charger.brand_model ?? '—'} muted={!charger.brand_model} />
      </div>

      <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Turn-on &amp; Form 1</div>
          <div style={{ fontSize: 11, color: C.slate }}>Installation compliance form</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, alignItems: 'stretch' }}>
          <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Turn-on Date</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: charger.turn_on_date ? C.green : C.slate, marginTop: 4, letterSpacing: '-0.01em' }}>
              {fmtDate(charger.turn_on_date) ?? 'Not recorded'}
            </div>
          </div>
          <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Form 1 PDF</div>
            {charger.form_1_path ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <FileText size={14} strokeWidth={1.8} color={C.green} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {form1DisplayName}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => void openForm1('view')}
                    style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    View
                  </button>
                  <button onClick={() => void openForm1('download')}
                    style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '5px 8px', borderRadius: 6, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    <DownloadIcon size={11} strokeWidth={2.25} /> Download
                  </button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: C.slate, fontStyle: 'italic' }}>No Form 1 attached yet. Edit the charger to upload one.</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>LTA Inspection Records</div>
          <button onClick={() => onTabChange('maintenance')}
            style={{ padding: 0, border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            View LTA inspection →
          </button>
        </div>
        <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(() => {
            const years = charger.lta_contract_years ?? 0;
            const start = charger.lta_contract_start_date ?? charger.turn_on_date;
            const endDate = years > 0 && start ? addYears(start, years) : null;
            const daysLeft = endDate ? daysFromToday(endDate) : null;
            const active = years > 0 && (daysLeft === null || daysLeft >= 0);
            if (active) {
              return (
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#E4F3E3', color: '#1B512D', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Contract active · {years} yr{years === 1 ? '' : 's'}
                  </span>
                  <span style={{ fontSize: 12, color: C.slate }}>
                    {endDate ? <>Ends <strong style={{ color: '#1a1a1a' }}>{fmtDate(endDate)}</strong>{daysLeft !== null && <> · {relDays(daysLeft)} left</>}.</> : 'Contract active.'}
                  </span>
                </div>
              );
            }
            return (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#FFF0E0', color: '#B45309', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  No contract
                </span>
                <span style={{ fontSize: 12, color: C.slate }}>Use the cards below to call &amp; pitch an LTA inspection contract.</span>
              </div>
            );
          })()}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            <FormStatusCard formType="A" period={isResidential ? '24-month' : '6-month'} latest={latestA} latestDisplayName={latestA ? computeLtaFilename('A', charger.asset_tag, latestA.performed_at, siteName) : null} done={doneA} nextDate={formADate} nextDays={formA} onDownload={() => void openLtaRecord(latestA!)} />
            {!isResidential && (
              <FormStatusCard formType="D" period="12-month" latest={latestD} latestDisplayName={latestD ? computeLtaFilename('D', charger.asset_tag, latestD.performed_at, siteName) : null} done={doneD} nextDate={formDDate} nextDays={formD} onDownload={() => void openLtaRecord(latestD!)} />
            )}
          </div>
        </div>
      </div>

      <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Warranty Records</div>
          <button onClick={() => onTabChange('warranty')}
            style={{ padding: 0, border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            View warranty →
          </button>
        </div>
        <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: tone.bg, color: tone.color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {tone.label}
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <ChargerDetailRow label="Start" value={fmtDate(charger.warranty_start_date) ?? '—'} muted={!charger.warranty_start_date} />
            <ChargerDetailRow label="End"   value={fmtDate(charger.warranty_end_date)   ?? '—'} muted={!charger.warranty_end_date} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── LTA Inspection panel ─────────────────────────────────────────

type LtaFormType = 'A' | 'D';

interface LtaRecord {
  id: string;
  charger_id: string;
  form_type: LtaFormType;
  performed_at: string;
  storage_path: string;
  filename: string;
  notes: string | null;
  created_at: string;
  invoice_path: string | null;
  invoice_filename: string | null;
  invoice_sent_at: string | null;
}

interface LtaEmailCustomer { name: string; email: string | null; type?: CustomerType }

function LtaInspectionPanel({ charger, siteName, canEdit, canDelete, customer, onChargerChanged }: {
  charger: SiteCharger;
  siteName: string;
  canEdit: boolean;
  canDelete: boolean;
  customer: LtaEmailCustomer;
  onChargerChanged: () => Promise<void>;
}) {
  const [records, setRecords] = useState<LtaRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const { data } = await supabase.from('charger_lta_records')
      .select('*')
      .eq('charger_id', charger.id)
      .order('performed_at', { ascending: false });
    setRecords((data ?? []) as LtaRecord[]);
    setLoading(false);
  };

  useEffect(() => { setLoading(true); void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [charger.id]);

  const formA = records.filter((r) => r.form_type === 'A');
  const formD = records.filter((r) => r.form_type === 'D');
  // Residential chargers need only Form A, every 24 months — no Form D.
  const isResidential = customer.type === 'residential';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5 }}>
        {isResidential
          ? <>Upload completed Form A (24-month) inspection PDFs for <strong style={{ color: '#1a1a1a' }}>{charger.asset_tag}</strong>. Residential chargers do not require Form D. Each upload is dated for when the inspection was performed.</>
          : <>Upload completed Form A (6-month) and Form D (12-month) inspection PDFs for <strong style={{ color: '#1a1a1a' }}>{charger.asset_tag}</strong>. Each upload is dated for when the inspection was performed.</>}
      </div>
      <ContractCard charger={charger} canEdit={canEdit} isResidential={isResidential} onChargerChanged={onChargerChanged} />
      <LtaSection formType="A" title={isResidential ? 'Form A · 24-month inspection' : 'Form A · 6-month inspection'}  records={formA} charger={charger} siteName={siteName} canEdit={canEdit} canDelete={canDelete} customer={customer} loading={loading} onChanged={refresh} />
      {!isResidential && (
        <LtaSection formType="D" title="Form D · 12-month inspection" records={formD} charger={charger} siteName={siteName} canEdit={canEdit} canDelete={canDelete} customer={customer} loading={loading} onChanged={refresh} />
      )}
    </div>
  );
}

function ContractCard({ charger, canEdit, isResidential, onChargerChanged }: {
  charger: SiteCharger;
  canEdit: boolean;
  isResidential: boolean;
  onChargerChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [years, setYears] = useState<number | null>(charger.lta_contract_years);
  const [startDate, setStartDate] = useState<string | null>(charger.lta_contract_start_date);
  const [active, setActive] = useState<boolean>(!!charger.lta_contract_years && charger.lta_contract_years > 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setYears(charger.lta_contract_years);
    setStartDate(charger.lta_contract_start_date);
    setActive(!!charger.lta_contract_years && charger.lta_contract_years > 0);
  }, [charger.id, charger.lta_contract_years, charger.lta_contract_start_date]);

  const storedYears = charger.lta_contract_years ?? 0;
  const storedStart = charger.lta_contract_start_date ?? charger.turn_on_date;
  const endDate     = storedYears > 0 && storedStart ? addYears(storedStart, storedYears) : null;
  const daysLeft    = endDate ? daysFromToday(endDate) : null;
  const isActive    = storedYears > 0 && (daysLeft === null || daysLeft >= 0);
  const isExpired   = storedYears > 0 && daysLeft !== null && daysLeft < 0;

  // Auto-clear an expired contract so the UI cleanly returns to "No contract".
  // Runs once per charger; after the clear, the refreshed charger has no years and the effect won't re-fire.
  const autoClearedRef = useRef(false);
  useEffect(() => {
    autoClearedRef.current = false;
  }, [charger.id]);
  useEffect(() => {
    if (autoClearedRef.current) return;
    if (!isExpired) return;
    autoClearedRef.current = true;
    void (async () => {
      const { error: err } = await supabase.from('site_chargers').update({
        lta_contract_years: null,
        lta_contract_start_date: null,
        has_maintenance_package: false,
      }).eq('id', charger.id);
      if (!err) await onChargerChanged();
    })();
  }, [charger.id, isExpired, onChargerChanged]);

  const onToggleActive = (next: boolean) => {
    setActive(next);
    if (next) {
      if (!years) setYears(3);
      if (!startDate) setStartDate(new Date().toISOString().slice(0, 10));
    }
  };

  const startEdit = () => {
    setYears(charger.lta_contract_years);
    setStartDate(charger.lta_contract_start_date);
    setActive(!!charger.lta_contract_years && charger.lta_contract_years > 0);
    setError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    const finalYears = active && years && years > 0 ? Math.max(1, Math.min(20, Math.floor(years))) : null;
    const finalStart = finalYears ? (startDate || new Date().toISOString().slice(0, 10)) : null;
    setSaving(true);
    const { error: err } = await supabase.from('site_chargers').update({
      lta_contract_years: finalYears,
      lta_contract_start_date: finalStart,
      has_maintenance_package: finalYears !== null,
    }).eq('id', charger.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setEditing(false);
    await onChargerChanged();
  };

  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          LTA Inspection Contract
        </div>
        {canEdit && !editing && (
          <button onClick={startEdit}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            <Pencil size={11} strokeWidth={2.25} /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={(e) => onToggleActive(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: C.green, cursor: 'pointer' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>LTA inspection contract is active</div>
              <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
                {isResidential
                  ? <>Residential chargers require <strong>1 Form A</strong> inspection every <strong>24 months</strong> — no Form D.</>
                  : <>1 year of contract covers <strong>2 Form A</strong> inspections + <strong>1 Form D</strong> inspection.</>}
              </div>
            </div>
          </label>
          {active && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'start' }}>
              <div>
                <FieldLabel>Start Date</FieldLabel>
                <input type="date" value={startDate ?? ''} onChange={(e) => setStartDate(e.target.value || null)}
                  style={{ ...inputStyle(), background: C.white }} />
              </div>
              <div>
                <FieldLabel>Contract Years</FieldLabel>
                <input type="number" min={1} max={20} step={1}
                  value={years ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') { setYears(null); return; }
                    const n = parseInt(v, 10);
                    setYears(isNaN(n) ? null : Math.max(1, Math.min(20, n)));
                  }}
                  style={{ ...inputStyle(), background: C.white }} />
              </div>
              <ReadOnlyField
                label="Contract ends (auto)"
                value={startDate && years && years > 0 ? fmtDate(addYears(startDate, years)) : null}
                placeholder={startDate ? 'Enter contract years' : 'Pick a start date'} />
            </div>
          )}
          {error && (
            <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={cancelEdit} disabled={saving}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
              Cancel
            </button>
            <button onClick={() => void handleSave()} disabled={saving || (active && (!years || years <= 0))}
              style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: (saving || (active && (!years || years <= 0))) ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: (saving || (active && (!years || years <= 0))) ? 'default' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          {isActive ? (
            <>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#E4F3E3', color: '#1B512D', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Active · {storedYears} yr{storedYears === 1 ? '' : 's'}
              </span>
              <span style={{ fontSize: 12, color: C.slate }}>
                {endDate ? <>Ends <strong style={{ color: '#1a1a1a' }}>{fmtDate(endDate)}</strong>{daysLeft !== null && <> · {relDays(daysLeft)} left</>}.</> : 'Contract active.'}
              </span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#FFF0E0', color: '#B45309', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                No contract
              </span>
              <span style={{ fontSize: 12, color: C.slate }}>
                {canEdit ? 'Click Edit to mark this charger as covered by an LTA inspection contract.' : 'No active LTA inspection contract.'}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LtaSection({ formType, title, records, charger, siteName, canEdit, canDelete, customer, loading, onChanged }: {
  formType: LtaFormType;
  title: string;
  records: LtaRecord[];
  charger: SiteCharger;
  siteName: string;
  canEdit: boolean;
  canDelete: boolean;
  customer: LtaEmailCustomer;
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setAdding(false);
    setPendingFile(null);
    setDate(new Date().toISOString().slice(0, 10));
    setError(null);
  };

  const handleFileSelected = (file: File) => {
    setError(null);
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Upload must be a PDF.');
      return;
    }
    setPendingFile(file);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!pendingFile) { setError('Pick a PDF file first.'); return; }
    if (!date)        { setError('Pick the inspection date first.'); return; }
    setBusy(true);
    const friendly = computeLtaFilename(formType, charger.asset_tag, date, siteName);
    const path = `lta/${charger.id}/${crypto.randomUUID()}/${pathSafe(friendly)}`;
    const up = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(path, pendingFile, { contentType: pendingFile.type || 'application/pdf' });
    if (up.error) { setBusy(false); setError(up.error.message); return; }
    const ins = await supabase.from('charger_lta_records').insert({
      charger_id: charger.id,
      form_type:  formType,
      performed_at: date,
      storage_path: path,
      filename: computeLtaFilename(formType, charger.asset_tag, date, siteName),
    });
    setBusy(false);
    if (ins.error) {
      void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([path]);
      setError(ins.error.message);
      return;
    }
    resetForm();
    await onChanged();
  };

  const fmtSize = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const canSubmit = !!pendingFile && !!date && !busy;

  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {title} {records.length > 0 && <span style={{ color: C.slate, marginLeft: 4 }}>· {records.length}</span>}
        </div>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)}
            style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            + Add Form {formType}
          </button>
        )}
      </div>

      {adding && (
        <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'end' }}>
            <div>
              <FieldLabel>Performed on</FieldLabel>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} style={{ ...inputStyle(), background: C.white }} />
            </div>
            <div>
              <FieldLabel>PDF file</FieldLabel>
              {pendingFile ? (
                <div style={{ background: C.seasalt, border: '1px solid #EBEBEB', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={16} strokeWidth={1.8} color={C.green} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingFile.name}</div>
                    <div style={{ fontSize: 10, color: C.slate, marginTop: 1 }}>{fmtSize(pendingFile.size)} · ready to upload</div>
                  </div>
                  <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
                    Change
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: '1px dashed #C8E6C9', background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
                  <Upload size={14} strokeWidth={2} /> Choose PDF
                </button>
              )}
            </div>
          </div>
          <input ref={inputRef} type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(file);
              e.target.value = '';
            }} />
          {error && (
            <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600 }}>{error}</div>
          )}
          {pendingFile && !busy && !error && (
            <div style={{ background: C.honeydew, color: '#1B512D', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, lineHeight: 1.5 }}>
              Review the file and inspection date above, then click <strong>Submit Form {formType}</strong> to save this record.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={resetForm} disabled={busy}
              style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
              Cancel
            </button>
            <button onClick={() => void handleSubmit()} disabled={!canSubmit}
              style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: canSubmit ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default' }}>
              {busy ? 'Uploading…' : `Submit Form ${formType}`}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: C.slate, padding: '8px 4px' }}>Loading…</div>
      ) : records.length === 0 ? (
        <div style={{ background: C.white, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: C.slate, textAlign: 'center' }}>
          No Form {formType} records yet.{canEdit && ' Click + Add Form ' + formType + ' to upload one.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {records.map((r) => (
            <LtaRecordRow key={r.id} record={r} displayName={computeLtaFilename(r.form_type, charger.asset_tag, r.performed_at, siteName)} charger={charger} siteName={siteName} customer={customer} canEdit={canEdit} canDelete={canDelete} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

// Download a storage object and base64-encode it (for email attachments).
async function storageFileBase64(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(error?.message ?? 'Could not read file from storage.');
  const bytes = new Uint8Array(await data.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function LtaRecordRow({ record, displayName, charger, siteName, customer, canEdit, canDelete, onChanged }: {
  record: LtaRecord;
  displayName: string;
  charger: SiteCharger;
  siteName: string;
  customer: LtaEmailCustomer;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const invoiceInputRef = useRef<HTMLInputElement>(null);

  const open = async (mode: 'view' | 'download') => {
    const { data } = await supabase.storage.from(CHARGER_FORMS_BUCKET)
      .createSignedUrl(record.storage_path, 60, mode === 'download' ? { download: displayName } : undefined);
    if (data?.signedUrl) window.open(data.signedUrl, mode === 'download' ? '_self' : '_blank');
  };

  const openInvoice = async (mode: 'view' | 'download') => {
    if (!record.invoice_path) return;
    const { data } = await supabase.storage.from(CHARGER_FORMS_BUCKET)
      .createSignedUrl(record.invoice_path, 60, mode === 'download' ? { download: record.invoice_filename ?? 'invoice.pdf' } : undefined);
    if (data?.signedUrl) window.open(data.signedUrl, mode === 'download' ? '_self' : '_blank');
  };

  const handleInvoiceFile = async (file: File) => {
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return;
    setUploadingInvoice(true);
    const path = `lta/${charger.id}/${record.id}/invoice/${pathSafe(file.name)}`;
    const up = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(path, file, { contentType: file.type || 'application/pdf', upsert: true });
    if (!up.error) {
      await supabase.from('charger_lta_records').update({ invoice_path: path, invoice_filename: file.name }).eq('id', record.id);
      await onChanged();
    }
    setUploadingInvoice(false);
  };

  const removeInvoice = async () => {
    if (record.invoice_path) void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([record.invoice_path]);
    await supabase.from('charger_lta_records').update({ invoice_path: null, invoice_filename: null, invoice_sent_at: null }).eq('id', record.id);
    await onChanged();
  };

  const handleDelete = async () => {
    setDeleting(true);
    const paths = [record.storage_path, ...(record.invoice_path ? [record.invoice_path] : [])];
    void supabase.storage.from(CHARGER_FORMS_BUCKET).remove(paths);
    await supabase.from('charger_lta_records').delete().eq('id', record.id);
    setDeleting(false);
    setConfirming(false);
    await onChanged();
  };

  if (confirming) {
    return (
      <div style={{ background: '#FDEAEA', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#C0321A', flex: 1, lineHeight: 1.5 }}>
          Delete this Form {record.form_type} record from {fmtDate(record.performed_at)}?
        </div>
        <button onClick={() => setConfirming(false)} disabled={deleting}
          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: deleting ? 'default' : 'pointer' }}>
          Cancel
        </button>
        <button onClick={() => void handleDelete()} disabled={deleting}
          style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: deleting ? 'default' : 'pointer' }}>
          {deleting ? 'Deleting…' : 'Yes, delete'}
        </button>
      </div>
    );
  }

  const btnGhost: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' };

  return (
    <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <FileText size={16} strokeWidth={1.8} color={C.green} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.01em' }}>
            {fmtDate(record.performed_at)}
          </div>
          <div style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
        </div>
        <button onClick={() => void open('view')} style={btnGhost}>View</button>
        <button onClick={() => void open('download')} style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <DownloadIcon size={11} strokeWidth={2.25} /> Download
        </button>
        {canDelete && (
          <button onClick={() => setConfirming(true)}
            style={{ ...btnGhost, border: '1px solid #FDEAEA', color: '#C0321A' }}>
            Delete
          </button>
        )}
      </div>

      {/* Invoice sub-row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 26 }}>
        <input ref={invoiceInputRef} type="file" accept="application/pdf" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleInvoiceFile(f); e.target.value = ''; }} />
        {record.invoice_path ? (
          <>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.green, background: C.honeydew, padding: '2px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>Invoice</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.invoice_filename}</span>
            {record.invoice_sent_at && (
              <span style={{ fontSize: 10, fontWeight: 600, color: C.slate, whiteSpace: 'nowrap' }}>Sent {fmtDate(record.invoice_sent_at.slice(0, 10))}</span>
            )}
            <button onClick={() => void openInvoice('view')} style={btnGhost}>View</button>
            <button onClick={() => setEmailing(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              <Mail size={11} strokeWidth={2.25} /> Email
            </button>
            {canEdit && (
              <button onClick={() => void removeInvoice()} style={{ ...btnGhost, border: '1px solid #FDEAEA', color: '#C0321A' }}>Remove</button>
            )}
          </>
        ) : canEdit ? (
          <button onClick={() => invoiceInputRef.current?.click()} disabled={uploadingInvoice}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: '1px dashed #C8E6C9', background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: uploadingInvoice ? 'default' : 'pointer' }}>
            <Upload size={11} strokeWidth={2.25} /> {uploadingInvoice ? 'Uploading…' : 'Attach invoice (PDF)'}
          </button>
        ) : (
          <span style={{ fontSize: 11, color: C.slate, fontStyle: 'italic' }}>No invoice attached.</span>
        )}
      </div>

      {emailing && (
        <SendLtaEmailModal record={record} formDisplayName={displayName} charger={charger} siteName={siteName} customer={customer}
          onClose={() => setEmailing(false)} onSent={onChanged} />
      )}
    </div>
  );
}

function SendLtaEmailModal({ record, formDisplayName, charger, siteName, customer, onClose, onSent }: {
  record: LtaRecord;
  formDisplayName: string;
  charger: SiteCharger;
  siteName: string;
  customer: LtaEmailCustomer;
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const [to, setTo] = useState(customer.email ?? '');
  const [cc, setCc] = useState('');
  const [fixedCc, setFixedCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [brand, setBrand] = useState<EmailBrand>(DEFAULT_LTA_BRAND);
  const [senders, setSenders] = useState<EmailSender[]>([]);
  const [senderId, setSenderId] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [includeForm, setIncludeForm] = useState(true);
  const [includeInvoice, setIncludeInvoice] = useState(true);

  useEffect(() => {
    void (async () => {
      const [tplRes, b, s] = await Promise.all([
        supabase.from('lta_email_templates').select('subject, body, cc').eq('form_type', record.form_type).maybeSingle(),
        fetchLtaBrand(),
        fetchSenders(),
      ]);
      const tpl = (tplRes.data as { subject: string; body: string; cc: string | null } | null) ?? { subject: '', body: '', cc: '' };
      setFixedCc(tpl.cc ?? '');
      const fill = (str: string) => str
        .replace(/\{\{\s*charger\s*\}\}/gi, charger.asset_tag)
        .replace(/\{\{\s*form_type\s*\}\}/gi, `Form ${record.form_type}`)
        .replace(/\{\{\s*site\s*\}\}/gi, siteName)
        .replace(/\{\{\s*customer\s*\}\}/gi, customer.name)
        .replace(/\{\{\s*date\s*\}\}/gi, fmtDate(record.performed_at) ?? record.performed_at);
      setSubject(fill(tpl.subject));
      setBody(fill(tpl.body));
      setBrand(b);
      setSenders(s);
      setSenderId(s[0]?.id ?? '');
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedSender = senders.find((s) => s.id === senderId) ?? null;

  const toList = to.split(/[,;]/).map((e) => e.trim()).filter(Boolean);
  // Per-email CC plus the admin-configured fixed internal CC (deduped).
  const fixedCcList = fixedCc.split(/[,;]/).map((e) => e.trim()).filter(Boolean);
  const ccList = Array.from(new Set([...cc.split(/[,;]/).map((e) => e.trim()).filter(Boolean), ...fixedCcList]));
  const hasInvoice = !!record.invoice_path;
  const attachCount = (includeForm ? 1 : 0) + (includeInvoice && hasInvoice ? 1 : 0);
  const canSend = toList.length > 0 && !!subject.trim() && !!body.trim() && attachCount > 0 && !sending && !loading;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const attachments: { filename: string; content: string }[] = [];
      if (includeForm) {
        const formB64 = await storageFileBase64(CHARGER_FORMS_BUCKET, record.storage_path);
        attachments.push({ filename: formDisplayName.toLowerCase().endsWith('.pdf') ? formDisplayName : `${formDisplayName}.pdf`, content: formB64 });
      }
      if (includeInvoice && record.invoice_path) {
        const invoiceB64 = await storageFileBase64(CHARGER_FORMS_BUCKET, record.invoice_path);
        attachments.push({ filename: record.invoice_filename ?? 'invoice.pdf', content: invoiceB64 });
      }
      const fromAddress = selectedSender ? `${selectedSender.from_name} <${selectedSender.from_email}>` : undefined;
      const { data, error: err } = await supabase.functions.invoke('send-customer-email', {
        body: {
          to: toList, cc: ccList, subject,
          html: buildLtaEmailHtml(body, brand),
          from: fromAddress,
          replyTo: selectedSender?.reply_to || undefined,
          attachments,
        },
      });
      const errMsg = (data as { error?: string } | null)?.error ?? err?.message ?? null;
      // Audit every attempt (success or failure) for the Email Audit tab.
      await supabase.from('lta_email_log').insert({
        lta_record_id: record.id,
        charger_tag: charger.asset_tag,
        form_type: record.form_type,
        site_name: siteName,
        customer_name: customer.name,
        to_email: toList.join(', '),
        cc: ccList,
        status: errMsg ? 'failed' : 'sent',
        error: errMsg,
        sent_at: errMsg ? null : new Date().toISOString(),
      });
      if (errMsg) { setError(errMsg); setSending(false); return; }
      // Only mark the invoice as sent if it was actually attached.
      if (includeInvoice && record.invoice_path) {
        await supabase.from('charger_lta_records').update({ invoice_sent_at: new Date().toISOString() }).eq('id', record.id);
      }
      setSending(false);
      setDone(true);
      await onSent();
    } catch (e) {
      setError((e as Error).message || 'Send failed.');
      setSending(false);
    }
  };

  const field: React.CSSProperties = { ...inputStyle(), background: C.white };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => e.stopPropagation()}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 600, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Email Form {record.form_type} &amp; Invoice</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {done ? (
          <div style={{ background: C.honeydew, color: '#1B512D', borderRadius: 12, padding: '14px 16px', fontSize: 13, fontWeight: 600 }}>
            Email sent to {toList.join(', ')}.
          </div>
        ) : loading ? (
          <div style={{ fontSize: 13, color: C.slate, padding: '12px 0' }}>Loading template…</div>
        ) : (
          <>
            {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>}
            {senders.length > 0 && (
              <div>
                <FieldLabel>From</FieldLabel>
                <select value={senderId} onChange={(e) => setSenderId(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  {senders.map((s) => <option key={s.id} value={s.id}>{s.from_name} &lt;{s.from_email}&gt;</option>)}
                </select>
              </div>
            )}
            <div>
              <FieldLabel>To</FieldLabel>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@company.com" style={field} />
              {!customer.email && <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>The linked customer has no contact email on file — enter one above.</div>}
            </div>
            <div>
              <FieldLabel>CC (comma-separated)</FieldLabel>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional" style={field} />
              {fixedCcList.length > 0 && (
                <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>Internal team auto-CC'd: {fixedCcList.join(', ')}</div>
              )}
            </div>
            <div>
              <FieldLabel>Subject</FieldLabel>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} style={field} />
            </div>
            <div>
              <FieldLabel>Message</FieldLabel>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} style={{ ...field, resize: 'vertical', lineHeight: 1.5, fontFamily: 'Figtree' }} />
              <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>Plain text — the logo, header and footer are added automatically. Edit defaults in Charger Registry → Email.</div>
            </div>
            <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Attachments</div>
              {([
                { name: formDisplayName, on: includeForm, set: setIncludeForm, show: true },
                { name: record.invoice_filename ?? 'invoice.pdf', on: includeInvoice, set: setIncludeInvoice, show: hasInvoice },
              ] as const).filter((a) => a.show).map((a) => (
                <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={14} color={a.on ? C.green : C.slate} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: a.on ? '#1a1a1a' : C.slate, textDecoration: a.on ? 'none' : 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  {a.on ? (
                    <button type="button" onClick={() => a.set(false)} title="Don't attach"
                      style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={12} strokeWidth={2.5} />
                    </button>
                  ) : (
                    <button type="button" onClick={() => a.set(true)}
                      style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Attach
                    </button>
                  )}
                </div>
              ))}
              {attachCount === 0 && <div style={{ fontSize: 11, color: '#C0321A', fontWeight: 600 }}>Attach at least one file to send.</div>}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => void handleSend()} disabled={!canSend}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 22px', borderRadius: 10, border: 'none', background: canSend ? C.green : '#A5D6A7', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSend ? 'pointer' : 'not-allowed' }}>
                <Mail size={13} strokeWidth={2.25} /> {sending ? 'Sending…' : 'Send email'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Warranty panel ───────────────────────────────────────────────

interface WarrantyClaim {
  id: string;
  charger_id: string;
  claim_date: string;
  parts: string | null;
  remarks: string | null;
  storage_path: string | null;
  filename: string | null;
  created_at: string;
}

function computeWarrantyClaimFilename(assetTag: string | null | undefined, claimDate: string | null | undefined, siteName: string | null | undefined): string {
  return composeChargerFilename('Warranty Claim', assetTag, claimDate, siteName);
}

function WarrantyPanel({ charger, siteName, canEdit, canDelete }: {
  charger: SiteCharger;
  siteName: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = async () => {
    const { data } = await supabase.from('charger_warranty_claims')
      .select('*')
      .eq('charger_id', charger.id)
      .order('claim_date', { ascending: false });
    setClaims((data ?? []) as WarrantyClaim[]);
    setLoading(false);
  };

  useEffect(() => { setLoading(true); void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [charger.id]);

  const tone = warrantyTone(charger.warranty_end_date);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: tone.bg, color: tone.color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {tone.label}
        </span>
        <span style={{ fontSize: 12, color: C.slate }}>
          {charger.warranty_start_date || charger.warranty_end_date ? (
            <>
              {charger.warranty_start_date && <>Start <strong style={{ color: '#1a1a1a' }}>{fmtDate(charger.warranty_start_date)}</strong></>}
              {charger.warranty_start_date && charger.warranty_end_date && ' · '}
              {charger.warranty_end_date && <>End <strong style={{ color: '#1a1a1a' }}>{fmtDate(charger.warranty_end_date)}</strong></>}
            </>
          ) : (
            'No warranty dates recorded.'
          )}
        </span>
      </div>

      <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Warranty Claims {claims.length > 0 && <span style={{ color: C.slate, marginLeft: 4 }}>· {claims.length}</span>}
          </div>
          {canEdit && !adding && (
            <button onClick={() => { setAdding(true); setEditingId(null); }}
              style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              + Add Warranty Claim
            </button>
          )}
        </div>

        {adding && (
          <WarrantyClaimForm
            charger={charger}
            siteName={siteName}
            existing={null}
            onCancel={() => setAdding(false)}
            onSaved={async () => { setAdding(false); await refresh(); }}
          />
        )}

        {loading ? (
          <div style={{ fontSize: 12, color: C.slate, padding: '8px 4px' }}>Loading…</div>
        ) : claims.length === 0 ? (
          <div style={{ background: C.white, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: C.slate, textAlign: 'center' }}>
            No warranty claims logged yet.{canEdit && ' Click + Add Warranty Claim to log one.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {claims.map((c) => (
              editingId === c.id ? (
                <WarrantyClaimForm
                  key={c.id}
                  charger={charger}
                  siteName={siteName}
                  existing={c}
                  onCancel={() => setEditingId(null)}
                  onSaved={async () => { setEditingId(null); await refresh(); }}
                />
              ) : (
                <WarrantyClaimRow
                  key={c.id}
                  claim={c}
                  charger={charger}
                  siteName={siteName}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onEdit={() => { setEditingId(c.id); setAdding(false); }}
                  onChanged={refresh}
                />
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WarrantyClaimForm({ charger, siteName, existing, onCancel, onSaved }: {
  charger: SiteCharger;
  siteName: string;
  existing: WarrantyClaim | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [claimDate, setClaimDate] = useState<string>(existing?.claim_date ?? new Date().toISOString().slice(0, 10));
  const [parts, setParts] = useState<string>(existing?.parts ?? '');
  const [remarks, setRemarks] = useState<string>(existing?.remarks ?? '');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelected = (file: File) => {
    setError(null);
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Upload must be a PDF.');
      return;
    }
    setPendingFile(file);
    setRemoveExisting(false);
  };

  const fmtSize = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const openExisting = async () => {
    if (!existing?.storage_path) return;
    const downloadName = computeWarrantyClaimFilename(charger.asset_tag, existing.claim_date, siteName);
    const { data } = await supabase.storage.from(CHARGER_FORMS_BUCKET)
      .createSignedUrl(existing.storage_path, 60, { download: downloadName });
    if (data?.signedUrl) window.open(data.signedUrl, '_self');
  };

  const handleSubmit = async () => {
    setError(null);
    if (!claimDate) { setError('Pick a claim date.'); return; }
    if (!pendingFile && (!existing?.storage_path || removeExisting)) {
      setError('A warranty report PDF is required.');
      return;
    }
    setBusy(true);

    let storagePath: string | null = existing?.storage_path ?? null;
    let storedFilename: string | null = existing?.filename ?? null;

    if (pendingFile) {
      const friendly = computeWarrantyClaimFilename(charger.asset_tag, claimDate, siteName);
      const path = `warranty/${charger.id}/${crypto.randomUUID()}/${pathSafe(friendly)}`;
      const up = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(path, pendingFile, { contentType: pendingFile.type || 'application/pdf' });
      if (up.error) { setBusy(false); setError(up.error.message); return; }
      if (existing?.storage_path) {
        void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([existing.storage_path]);
      }
      storagePath = path;
      storedFilename = friendly;
    } else if (removeExisting && existing?.storage_path) {
      void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([existing.storage_path]);
      storagePath = null;
      storedFilename = null;
    }

    const payload = {
      charger_id:   charger.id,
      claim_date:   claimDate,
      parts:        parts.trim() || null,
      remarks:      remarks.trim() || null,
      storage_path: storagePath,
      filename:     storedFilename,
    };

    const result = existing
      ? await supabase.from('charger_warranty_claims').update(payload).eq('id', existing.id)
      : await supabase.from('charger_warranty_claims').insert(payload);

    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    await onSaved();
  };

  const hasFile = !!pendingFile || (!!existing?.storage_path && !removeExisting);

  return (
    <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <div>
          <FieldLabel>Claim Date</FieldLabel>
          <input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} disabled={busy}
            style={{ ...inputStyle(), background: C.white }} />
        </div>
      </div>
      <div>
        <FieldLabel>Parts / Items</FieldLabel>
        <textarea value={parts} onChange={(e) => setParts(e.target.value)} disabled={busy} rows={2}
          placeholder="e.g. LCD screen, charging gun cable"
          style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
      </div>
      <div>
        <FieldLabel>Remarks</FieldLabel>
        <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={busy} rows={3}
          placeholder="Resolution notes, supplier contact, RMA reference…"
          style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
      </div>
      <div>
        <FieldLabel>Warranty Report PDF</FieldLabel>
        {hasFile ? (
          <div style={{ background: C.seasalt, border: '1px solid #EBEBEB', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={16} strokeWidth={1.8} color={C.green} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {pendingFile ? (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingFile.name}</div>
                  <div style={{ fontSize: 10, color: C.slate, marginTop: 1 }}>{fmtSize(pendingFile.size)} · ready to upload</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{existing?.filename ?? 'warranty.pdf'}</div>
                  <div style={{ fontSize: 10, color: C.slate, marginTop: 1 }}>Currently attached</div>
                </>
              )}
            </div>
            {!pendingFile && existing?.storage_path && (
              <button type="button" onClick={() => void openExisting()} disabled={busy}
                style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer', flexShrink: 0 }}>
                View
              </button>
            )}
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer', flexShrink: 0 }}>
              Change
            </button>
            <button type="button" onClick={() => { setPendingFile(null); setRemoveExisting(true); }} disabled={busy}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer', flexShrink: 0 }}>
              Remove
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: '1px dashed #C8E6C9', background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
            <Upload size={14} strokeWidth={2} /> Choose Warranty Report PDF
          </button>
        )}
        <input ref={inputRef} type="file" accept="application/pdf" style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelected(file);
            e.target.value = '';
          }} />
      </div>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600 }}>{error}</div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} disabled={busy}
          style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
          Cancel
        </button>
        <button onClick={() => void handleSubmit()} disabled={busy || !claimDate || !hasFile}
          style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: (busy || !claimDate || !hasFile) ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: (busy || !claimDate || !hasFile) ? 'default' : 'pointer' }}>
          {busy ? 'Saving…' : existing ? 'Save Claim' : 'Submit Claim'}
        </button>
      </div>
    </div>
  );
}

function WarrantyClaimRow({ claim, charger, siteName, canEdit, canDelete, onEdit, onChanged }: {
  claim: WarrantyClaim;
  charger: SiteCharger;
  siteName: string;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const displayName = computeWarrantyClaimFilename(charger.asset_tag, claim.claim_date, siteName);

  const open = async (mode: 'view' | 'download') => {
    if (!claim.storage_path) return;
    const { data } = await supabase.storage.from(CHARGER_FORMS_BUCKET)
      .createSignedUrl(claim.storage_path, 60, mode === 'download' ? { download: displayName } : undefined);
    if (data?.signedUrl) window.open(data.signedUrl, mode === 'download' ? '_self' : '_blank');
  };

  const handleDelete = async () => {
    setDeleting(true);
    if (claim.storage_path) {
      void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([claim.storage_path]);
    }
    await supabase.from('charger_warranty_claims').delete().eq('id', claim.id);
    setDeleting(false);
    setConfirming(false);
    await onChanged();
  };

  if (confirming) {
    return (
      <div style={{ background: '#FDEAEA', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#C0321A', flex: 1, lineHeight: 1.5, minWidth: 220 }}>
          Delete the warranty claim from {fmtDate(claim.claim_date)}?
        </div>
        <button onClick={() => setConfirming(false)} disabled={deleting}
          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: deleting ? 'default' : 'pointer' }}>
          Cancel
        </button>
        <button onClick={() => void handleDelete()} disabled={deleting}
          style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: deleting ? 'default' : 'pointer' }}>
          {deleting ? 'Deleting…' : 'Yes, delete'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.01em' }}>
          {fmtDate(claim.claim_date)}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {canEdit && (
            <button onClick={onEdit}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              <Pencil size={11} strokeWidth={2.25} /> Edit
            </button>
          )}
          {canDelete && (
            <button onClick={() => setConfirming(true)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              Delete
            </button>
          )}
        </div>
      </div>
      {claim.parts && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Parts / Items</div>
          <div style={{ fontSize: 12, color: '#1a1a1a', marginTop: 2, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{claim.parts}</div>
        </div>
      )}
      {claim.remarks && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Remarks</div>
          <div style={{ fontSize: 12, color: '#1a1a1a', marginTop: 2, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{claim.remarks}</div>
        </div>
      )}
      {claim.storage_path && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <FileText size={14} strokeWidth={1.8} color={C.green} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 11, color: C.slate, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
          <button onClick={() => void open('view')}
            style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            View
          </button>
          <button onClick={() => void open('download')}
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            <DownloadIcon size={11} strokeWidth={2.25} /> Download
          </button>
        </div>
      )}
    </div>
  );
}

function ReadOnlyField({ label, value, placeholder }: { label: string; value: string | null; placeholder: string }) {
  const has = !!value;
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div style={{ ...inputStyle(), background: '#F3F3F3', color: has ? '#1a1a1a' : C.slate, fontStyle: has ? 'normal' : 'italic', display: 'flex', alignItems: 'center' }}>
        {has ? value : placeholder}
      </div>
    </div>
  );
}

function ChargerDetailRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: muted ? C.slate : '#1a1a1a', marginTop: 4, letterSpacing: '-0.01em', fontStyle: muted ? 'italic' : 'normal' }}>
        {value}
      </div>
    </div>
  );
}

function isInspectedWithin(record: LtaRecord | null, months: number): boolean {
  if (!record) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - months);
  const performed = new Date(record.performed_at + 'T00:00:00');
  return !isNaN(performed.getTime()) && performed >= cutoff;
}

function FormStatusCard({ formType, period, latest, latestDisplayName, done, nextDate, nextDays, onDownload }: {
  formType: LtaFormType;
  period: string;
  latest: LtaRecord | null;
  latestDisplayName: string | null;
  done: boolean;
  nextDate: string | null;
  nextDays: number | null;
  onDownload: () => void;
}) {
  if (done && latest) {
    return (
      <div style={{ background: C.seasalt, border: '1px solid #EBEBEB', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#E4F3E3', color: '#1B512D', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Done
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Form {formType} · {period}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.01em' }}>
          Inspected on {fmtDate(latest.performed_at)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <FileText size={12} strokeWidth={1.8} color={C.slate} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 11, color: C.slate, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{latestDisplayName ?? latest.filename}</div>
          <button onClick={onDownload} title="Download PDF"
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            <DownloadIcon size={12} strokeWidth={2.25} />
          </button>
        </div>
        {nextDate && (
          <div style={{ borderTop: '1px solid #EBEBEB', marginTop: 4, paddingTop: 6, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 6px' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Next LTA Form {formType} Due</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>{fmtDate(nextDate)}</span>
            {nextDays !== null && <span style={{ fontSize: 11, color: C.slate }}>· {relDays(nextDays)}</span>}
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ background: C.seasalt, border: '1px solid #EBEBEB', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Next LTA Form {formType} Due
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: nextDate ? '#1a1a1a' : C.slate, marginTop: 6, fontStyle: nextDate ? 'normal' : 'italic' }}>
        {fmtDate(nextDate) ?? 'Not scheduled'}
      </div>
      {nextDays !== null && (
        <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{relDays(nextDays)}</div>
      )}
    </div>
  );
}

function fmtDate(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function relDays(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days <= 30) return `Due in ${days}d`;
  return `In ${days}d`;
}

function computeForm1Filename(assetTag: string | null | undefined, turnOnDate: string | null | undefined, siteName: string | null | undefined): string {
  return composeChargerFilename('Form 1', assetTag, turnOnDate, siteName);
}

function computeLtaFilename(formType: 'A' | 'D', assetTag: string | null | undefined, performedAt: string | null | undefined, siteName: string | null | undefined): string {
  return composeChargerFilename(`Form ${formType}`, assetTag, performedAt, siteName);
}

function composeChargerFilename(prefix: string, assetTag: string | null | undefined, date: string | null | undefined, siteName: string | null | undefined): string {
  const parts: string[] = [prefix];
  const tag = (assetTag ?? '').trim();
  if (tag) parts.push(tag);
  const dateLabel = fmtDate(date ?? null);
  if (dateLabel) parts.push(dateLabel);
  const site = (siteName ?? '').trim();
  if (site) parts.push(site);
  return parts.join(' - ') + '.pdf';
}

function pathSafe(name: string): string {
  return name.replace(/[^a-zA-Z0-9 \-_.]/g, '_').replace(/\s+/g, ' ').trim();
}

function nextCycleDate(turnOn: string | null, intervalMonths: number): string | null {
  if (!turnOn) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(turnOn + 'T00:00:00');
  if (isNaN(next.getTime())) return null;
  while (next < today) next.setMonth(next.getMonth() + intervalMonths);
  return next.toISOString().slice(0, 10);
}

function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function deriveWarrantyYears(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const s = new Date(start + 'T00:00:00').getTime();
  const e = new Date(end   + 'T00:00:00').getTime();
  if (isNaN(s) || isNaN(e) || e < s) return null;
  const years = Math.round((e - s) / (1000 * 60 * 60 * 24 * 365.25));
  return years > 0 ? years : null;
}

interface ChargerFormData {
  asset_tag: string;
  brand_model: string | null;
  turn_on_date: string | null;
  form_a_next_date: string | null;
  form_d_next_date: string | null;
  warranty_start_date: string | null;
  warranty_end_date: string | null;
  form_1_path: string | null;
  form_1_filename: string | null;
  notes: string | null;
}

function blankCharger(): ChargerFormData {
  return {
    asset_tag: '', brand_model: null,
    turn_on_date: null, form_a_next_date: null, form_d_next_date: null,
    warranty_start_date: null, warranty_end_date: null,
    form_1_path: null, form_1_filename: null,
    notes: null,
  };
}

function ChargerModal({ title, initial, siteName, isResidential, brandModels, canDelete, canManageBrandModels, onSave, onDelete, onBrandModelsChanged, onClose }: {
  title: string;
  initial: ChargerFormData;
  siteName: string;
  isResidential: boolean;
  brandModels: BrandModel[];
  canDelete: boolean;
  canManageBrandModels: boolean;
  onSave: (data: ChargerFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  onBrandModelsChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ChargerFormData>(initial);
  const [warrantyYears, setWarrantyYears] = useState<number | null>(
    deriveWarrantyYears(initial.warranty_start_date, initial.warranty_end_date),
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [form1Busy, setForm1Busy] = useState(false);
  const [form1Error, setForm1Error] = useState<string | null>(null);
  const form1InputRef = useRef<HTMLInputElement>(null);

  const handleForm1Upload = async (file: File) => {
    setForm1Error(null);
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setForm1Error('Form 1 must be a PDF.');
      return;
    }
    setForm1Busy(true);
    const friendly = computeForm1Filename(form.asset_tag, form.turn_on_date, siteName);
    const path = `form-1/${crypto.randomUUID()}/${pathSafe(friendly)}`;
    const { error } = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(path, file, { contentType: file.type || 'application/pdf' });
    setForm1Busy(false);
    if (error) { setForm1Error(error.message); return; }
    if (form.form_1_path) {
      void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([form.form_1_path]);
    }
    setForm((f) => ({ ...f, form_1_path: path, form_1_filename: computeForm1Filename(f.asset_tag, f.turn_on_date, siteName) }));
  };

  const form1DisplayName = computeForm1Filename(form.asset_tag, form.turn_on_date, siteName);

  const openForm1 = async (mode: 'view' | 'download') => {
    if (!form.form_1_path) return;
    const { data } = await supabase.storage.from(CHARGER_FORMS_BUCKET)
      .createSignedUrl(form.form_1_path, 60, mode === 'download' ? { download: form1DisplayName } : undefined);
    if (data?.signedUrl) window.open(data.signedUrl, mode === 'download' ? '_self' : '_blank');
  };

  const removeForm1 = async () => {
    if (form.form_1_path) {
      void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([form.form_1_path]);
    }
    setForm((f) => ({ ...f, form_1_path: null, form_1_filename: null }));
  };

  // If the existing brand_model isn't in the catalogue yet (legacy data),
  // include it as a selectable option so editing doesn't lose the value.
  const allLabels = (() => {
    const set = new Set(brandModels.map((b) => b.label));
    if (form.brand_model && !set.has(form.brand_model)) set.add(form.brand_model);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  })();

  const set = <K extends keyof ChargerFormData>(k: K, v: ChargerFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    const turnOn = form.turn_on_date || null;
    const yrs    = warrantyYears && warrantyYears > 0 ? warrantyYears : null;
    await onSave({
      asset_tag:               form.asset_tag.trim(),
      brand_model:             form.brand_model && form.brand_model.trim() ? form.brand_model.trim() : null,
      turn_on_date:            turnOn,
      form_a_next_date:        nextCycleDate(turnOn, isResidential ? 24 : 6),
      form_d_next_date:        isResidential ? null : nextCycleDate(turnOn, 12),
      warranty_start_date:     turnOn ? turnOn : null,
      warranty_end_date:       turnOn && yrs  ? addYears(turnOn, yrs) : null,
      form_1_path:             form.form_1_path || null,
      form_1_filename:         form.form_1_path ? computeForm1Filename(form.asset_tag, form.turn_on_date, siteName) : null,
      notes:                   form.notes && form.notes.trim() ? form.notes.trim() : null,
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
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 580, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <FieldLabel>Serial Number</FieldLabel>
            <input value={form.asset_tag} onChange={(e) => set('asset_tag', e.target.value)} placeholder="CHG-001" style={inputStyle()} autoFocus />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <FieldLabel>Brand & Model</FieldLabel>
              {canManageBrandModels && (
                <button type="button" onClick={() => setManageOpen(true)}
                  style={{ marginBottom: 6, padding: 0, border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  Manage list
                </button>
              )}
            </div>
            <select value={form.brand_model ?? ''} onChange={(e) => set('brand_model', e.target.value || null)}
              style={{ ...inputStyle(), background: C.white, cursor: 'pointer' }}>
              <option value="">— None —</option>
              {allLabels.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
            {allLabels.length === 0 && (
              <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>
                {canManageBrandModels
                  ? <>No models yet. Click <strong>Manage list</strong> above to add one.</>
                  : 'No models available. Ask a Department Admin to add some.'}
              </div>
            )}
          </div>
        </div>

        <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Service Dates</div>
          <div>
            <FieldLabel>Turn-on Date</FieldLabel>
            <input type="date" value={form.turn_on_date ?? ''} onChange={(e) => set('turn_on_date', e.target.value || null)} style={{ ...inputStyle(), background: C.white }} />
            <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>
              {isResidential
                ? <>Residential chargers need only <strong>Form A every 24 months</strong> from turn-on — no Form D. The system always shows the <strong>next upcoming</strong> date.</>
                : <>Form A repeats every <strong>6 months</strong>, Form D every <strong>12 months</strong> from turn-on. The system always shows the <strong>next upcoming</strong> date so cold calls stay on track.</>}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <ReadOnlyField label="Next Form A (auto)" value={fmtDate(nextCycleDate(form.turn_on_date, isResidential ? 24 : 6))}  placeholder="Set turn-on date" />
            {!isResidential && (
              <ReadOnlyField label="Next Form D (auto)" value={fmtDate(nextCycleDate(form.turn_on_date, 12))} placeholder="Set turn-on date" />
            )}
          </div>
        </div>

        <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Warranty</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'start' }}>
            <div>
              <FieldLabel>Years</FieldLabel>
              <input type="number" min={0} max={20} step={1}
                value={warrantyYears ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') { setWarrantyYears(null); return; }
                  const n = parseInt(v, 10);
                  setWarrantyYears(isNaN(n) ? null : Math.max(0, Math.min(20, n)));
                }}
                placeholder="e.g. 2"
                style={{ ...inputStyle(), background: C.white }} />
            </div>
            <ReadOnlyField
              label="Ends on (auto)"
              value={form.turn_on_date && warrantyYears ? fmtDate(addYears(form.turn_on_date, warrantyYears)) : null}
              placeholder={form.turn_on_date ? 'Enter warranty years' : 'Set turn-on date'} />
          </div>
          <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5 }}>
            Warranty starts on the turn-on date. Enter the warranty length in years — the end date is computed automatically.
          </div>
        </div>

        <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Form 1 (Installation Compliance)</div>
          {form.form_1_path ? (
            <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <FileText size={18} strokeWidth={1.8} color={C.green} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {form1DisplayName}
                </div>
                <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>PDF attached</div>
              </div>
              <button type="button" onClick={() => void openForm1('view')}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                View
              </button>
              <button type="button" onClick={() => void openForm1('download')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                <DownloadIcon size={11} strokeWidth={2.25} /> Download
              </button>
              <button type="button" onClick={() => form1InputRef.current?.click()} disabled={form1Busy}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                {form1Busy ? 'Uploading…' : 'Replace'}
              </button>
              <button type="button" onClick={() => void removeForm1()}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                Remove
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => form1InputRef.current?.click()} disabled={form1Busy}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: '1px dashed #C8E6C9', background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              <Upload size={14} strokeWidth={2} /> {form1Busy ? 'Uploading…' : 'Upload Form 1 PDF'}
            </button>
          )}
          <input ref={form1InputRef} type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleForm1Upload(file);
              e.target.value = '';
            }} />
          {form1Error && (
            <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600 }}>{form1Error}</div>
          )}
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
      {manageOpen && (
        <BrandModelsModal
          brandModels={brandModels}
          onClose={() => setManageOpen(false)}
          onChanged={onBrandModelsChanged}
        />
      )}
    </div>
  );
}

// ── Brand & model catalogue (gated by can_delete admin) ────────────

function BrandModelsModal({ brandModels, onClose, onChanged }: {
  brandModels: BrandModel[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState<BrandModel[]>(brandModels);
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const { data } = await supabase.from('charger_brand_models').select('*').order('position').order('label');
    setRows((data ?? []) as BrandModel[]);
    await onChanged();
  };

  const add = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('charger_brand_models').insert({ label });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setNewLabel('');
    await refresh();
  };

  const rename = async (id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('charger_brand_models').update({ label: trimmed }).eq('id', id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    await refresh();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this brand / model? Chargers already tagged with it keep the text — they just won\'t auto-resolve to a list entry until you re-add it.')) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('charger_brand_models').delete().eq('id', id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    await refresh();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 520, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Brand &amp; Model List</div>
            <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
              Edit the dropdown options used by every charger in this department.
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            placeholder="e.g. ABB Terra 54 CJG"
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
            style={{ ...inputStyle(), background: C.white }} />
          <button onClick={() => void add()} disabled={busy || !newLabel.trim()}
            style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: (busy || !newLabel.trim()) ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: (busy || !newLabel.trim()) ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
            + Add
          </button>
        </div>

        {error && (
          <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>
            {error}
          </div>
        )}

        {rows.length === 0 ? (
          <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: C.slate, textAlign: 'center' }}>
            No brand / model entries yet — add the first one above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((r) => (
              <BrandModelRow key={r.id} row={r} onRename={(v) => rename(r.id, v)} onRemove={() => remove(r.id)} busy={busy} />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function BrandModelRow({ row, onRename, onRemove, busy }: {
  row: BrandModel;
  onRename: (label: string) => Promise<void>;
  onRemove: () => Promise<void>;
  busy: boolean;
}) {
  const [value, setValue] = useState(row.label);
  const dirty = value.trim() !== row.label && value.trim().length > 0;
  return (
    <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
      <input value={value} onChange={(e) => setValue(e.target.value)}
        style={{ ...inputStyle(), background: C.white }} />
      <button onClick={() => void onRename(value)} disabled={!dirty || busy}
        style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: (dirty && !busy) ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: (dirty && !busy) ? 'pointer' : 'default' }}>
        Save
      </button>
      <button onClick={() => void onRemove()} disabled={busy}
        style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
        Delete
      </button>
    </div>
  );
}
