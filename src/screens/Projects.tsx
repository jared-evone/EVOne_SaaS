import { useEffect, useMemo, useRef, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { Search, Mail, Pencil, FileText, Upload, Download as DownloadIcon, ChevronDown, X, MapPin, Navigation, Trash2 } from 'lucide-react';
import { OneMapAutocomplete } from '../components/OneMapAutocomplete';
import { searchOneMap } from '../lib/onemap';
import { googleMapsDirections, hasNavTarget } from '../lib/navLinks';
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
import { InvoiceIngestModal } from './RegistryInvoiceImport';

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
  // One-way "taken up for charger entry" claim — only meaningful while the registry has 0 chargers.
  charger_entry_claimed_by: string | null;
  charger_entry_claimed_at: string | null;
  // Flagged (by an editor) as a mistaken registry for an admin to review & delete. Toggleable.
  deletion_flagged_by: string | null;
  deletion_flagged_at: string | null;
  deletion_flag_reason: string | null;
  // Marked as a special case with a free-text remark (awaiting docs, non-standard, etc.). Toggleable.
  special_case_at: string | null;
  special_case_by: string | null;
  special_case_remark: string | null;
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

// Registries are evenly split across these three for charger keying-in (deterministic
// round-robin over a stable created-at order — see assigneeOf).
const ASSIGNEES = ['Nay', 'Vivian', 'Yi Lin'] as const;

// A registry's assignee, derived from its id so it's fixed to that registry and
// unaffected by which other registries exist (deleting one won't re-label the
// rest). Same id → same assignee, on every load and for every user.
function assigneeForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return ASSIGNEES[h % ASSIGNEES.length];
}
const ASSIGNEE_COLORS: Record<string, { bg: string; color: string }> = {
  'Nay':    { bg: '#E3F0FF', color: '#1A62C0' },
  'Vivian': { bg: '#F0E8FF', color: '#6B21A8' },
  'Yi Lin': { bg: '#FFF0E0', color: '#B45309' },
};

export function ScreenProjects() {
  const { can, isAdmin, user } = usePermissions();
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
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [pendingTakeupOnly, setPendingTakeupOnly] = useState(false);
  const [adding, setAdding]       = useState(false);
  const [importingInvoices, setImportingInvoices] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: ps, error: pErr }, { data: cs }, { data: siteData }, { data: chargerData }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }).order('id', { ascending: true }),
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

  // Split registries across the assignees by hashing each registry's own id —
  // NOT its position in the list. A positional round-robin re-labelled every row
  // after a deleted one; keying off the id makes each registry's assignee its
  // own, so deleting one never reshuffles the others. Distribution stays ~even
  // across the id space, and it's identical on every load and for every user.
  const assigneeOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, assigneeForId(p.id));
    return m;
  }, [projects]);

  // A registry is "pending take-up" (undone) when it has no chargers yet and
  // nobody has claimed keying them in.
  const isPendingTakeup = (p: Project) => (chargerCounts[p.id] ?? 0) === 0 && !p.charger_entry_claimed_at;

  // How many pending take-ups each assignee still owns, so each person sees
  // their own remaining workload on their filter chip.
  const pendingByAssignee = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) {
      if (!isPendingTakeup(p)) continue;
      const a = assigneeOf.get(p.id);
      if (a) m.set(a, (m.get(a) ?? 0) + 1);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, chargerCounts, assigneeOf]);

  const visible = projects.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (assigneeFilter !== 'all' && assigneeOf.get(p.id) !== assigneeFilter) return false;
    if (pendingTakeupOnly && !isPendingTakeup(p)) return false;
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

  // Mark an empty registry as taken up for charger entry. One-way: once claimed it can't be undone.
  const claimChargerEntry = async (p: Project) => {
    if (p.charger_entry_claimed_at) return;
    if (!window.confirm(`Take up "${p.name}" to key in its charger? This locks it to you and can’t be undone.`)) return;
    await supabase.from('projects')
      .update({ charger_entry_claimed_by: user.full_name || user.email, charger_entry_claimed_at: new Date().toISOString() })
      .eq('id', p.id);
    await fetchAll();
  };

  // Flag a mistaken registry for an admin to delete (e.g. an invoice that wasn't a charger
  // procurement), or clear the flag. Editors can toggle; admins act on it via delete.
  const toggleDeletionFlag = async (p: Project) => {
    if (p.deletion_flagged_at) {
      await supabase.from('projects').update({ deletion_flagged_by: null, deletion_flagged_at: null, deletion_flag_reason: null }).eq('id', p.id);
    } else {
      const reason = window.prompt('Flag this registry for an admin to delete. Reason (optional):');
      if (reason === null) return; // cancelled
      await supabase.from('projects')
        .update({ deletion_flagged_by: user.full_name || user.email, deletion_flagged_at: new Date().toISOString(), deletion_flag_reason: reason.trim() || null })
        .eq('id', p.id);
    }
    await fetchAll();
  };

  // Directly delete a flagged registry (admin, from the list). Cascades to its
  // sites, chargers, LTA records, warranty claims, files and their storage.
  const deleteFlagged = async (p: Project) => {
    setDeletingId(p.id);
    setError(null);
    const err = await deleteRegistryProject(p.id);
    setDeletingId(null);
    setConfirmDeleteId(null);
    if (err) { setError(err); return; }
    // Drop the row locally instead of refetching, so the table doesn't flash a
    // full reload on every delete. The KPI counts derive from `projects`.
    setProjects((ps) => ps.filter((x) => x.id !== p.id));
  };

  // Mark a registry as a special case with a remark, edit the remark, or clear it.
  const toggleSpecialCase = async (p: Project) => {
    if (p.special_case_at) {
      await supabase.from('projects').update({ special_case_at: null, special_case_by: null, special_case_remark: null }).eq('id', p.id);
    } else {
      const remark = window.prompt('Mark as a special case. Remark:');
      if (remark === null) return; // cancelled
      await supabase.from('projects')
        .update({ special_case_at: new Date().toISOString(), special_case_by: user.full_name || user.email, special_case_remark: remark.trim() || null })
        .eq('id', p.id);
    }
    await fetchAll();
  };
  const editSpecialRemark = async (p: Project) => {
    const remark = window.prompt('Edit special-case remark:', p.special_case_remark ?? '');
    if (remark === null) return;
    await supabase.from('projects').update({ special_case_remark: remark.trim() || null }).eq('id', p.id);
    await fetchAll();
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', ...ASSIGNEES] as const).map((a) => {
            const active = assigneeFilter === a;
            const col = a !== 'all' ? ASSIGNEE_COLORS[a] : null;
            // When filtering by pending take-up, surface each person's remaining count.
            const remaining = a !== 'all' && pendingTakeupOnly ? (pendingByAssignee.get(a) ?? 0) : null;
            return (
              <button key={a} onClick={() => setAssigneeFilter(a)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 99,
                  border: `1px solid ${active ? (col?.color ?? C.green) : '#EBEBEB'}`,
                  background: active ? (col?.bg ?? C.green) : C.white,
                  color: active ? (col?.color ?? C.white) : C.slate,
                  fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {a === 'all' ? 'All assignees' : a}
                {remaining !== null && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
                    background: active ? 'rgba(255,255,255,0.5)' : (col?.bg ?? C.seasalt),
                    color: col?.color ?? C.slate }}>
                    {remaining}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button onClick={() => setPendingTakeupOnly((v) => !v)}
          title="Show only registries still waiting to be taken up for charger entry"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 99,
            border: `1px solid ${pendingTakeupOnly ? C.yellow : '#EBEBEB'}`,
            background: pendingTakeupOnly ? C.yellow : C.white,
            color: pendingTakeupOnly ? C.white : C.slate,
            fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Pending take-up
          <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
            background: pendingTakeupOnly ? 'rgba(255,255,255,0.28)' : C.seasalt,
            color: pendingTakeupOnly ? C.white : C.slate }}>
            {projects.filter(isPendingTakeup).length}
          </span>
        </button>
        <div style={{ position: 'relative', width: 260 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chargers…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        {canEdit && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            {isAdmin && (
              <button onClick={() => setImportingInvoices(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <Upload size={14} strokeWidth={2.25} /> Bulk Upload Invoices
              </button>
            )}
            <button onClick={() => setAdding(true)}
              style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + New Registration
            </button>
          </div>
        )}
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Customer', 'Status', 'Sites', 'Chargers', 'Assigned', 'Take-up', 'Special', 'Flag', 'Updated'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  {projects.length === 0 ? 'No customers yet. Click "+ New Registration" to add one.' : 'No customers match your filters.'}
                </td></tr>
              ) : visible.map((p) => {
                const palette = PROJECT_STATUS_PALETTE[p.status];
                const cust = customerById(p.customer_id);
                const open = () => setViewingId(p.id);
                const chargerCount = chargerCounts[p.id] ?? 0;
                const claimed = !!p.charger_entry_claimed_at;
                const flagged = !!p.deletion_flagged_at;
                const baseBg = flagged ? '#FDF2F2' : 'transparent';
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #F3F3F3', background: baseBg }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = flagged ? '#FBE9E9' : '#FAFAFA')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = baseBg)}>
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
                    <td onClick={open} style={{ padding: '13px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: C.green }}>{chargerCount}</td>
                    <td onClick={open} style={{ padding: '13px 16px', cursor: 'pointer' }}>
                      {(() => {
                        const a = assigneeOf.get(p.id);
                        const col = a ? ASSIGNEE_COLORS[a] : null;
                        return a
                          ? <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: col?.bg, color: col?.color, whiteSpace: 'nowrap' }}>{a}</span>
                          : <span style={{ color: C.slate, fontSize: 13 }}>—</span>;
                      })()}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      {chargerCount > 0 ? (
                        <span style={{ color: C.slate, fontSize: 13 }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                          title={claimed ? `Taken up by ${p.charger_entry_claimed_by ?? '—'} · ${new Date(p.charger_entry_claimed_at as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'Check to take up keying in this charger (can’t be undone)'}>
                          <input type="checkbox" checked={claimed} disabled={claimed || !canEdit}
                            onChange={() => void claimChargerEntry(p)}
                            style={{ width: 16, height: 16, cursor: (claimed || !canEdit) ? 'default' : 'pointer', accentColor: C.green }} />
                          {claimed && <span style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{p.charger_entry_claimed_by}</span>}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      {(() => {
                        const special = !!p.special_case_at;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                            title={special
                              ? `Special case by ${p.special_case_by ?? '—'} · ${new Date(p.special_case_at as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}${p.special_case_remark ? ` · ${p.special_case_remark}` : ''}`
                              : 'Mark as a special case and add a remark'}>
                            <input type="checkbox" checked={special} disabled={!canEdit}
                              onChange={() => void toggleSpecialCase(p)}
                              style={{ width: 16, height: 16, cursor: canEdit ? 'pointer' : 'default', accentColor: C.yellow }} />
                            {special && (
                              <span onClick={canEdit ? () => void editSpecialRemark(p) : undefined}
                                title={canEdit ? 'Click to edit remark' : undefined}
                                style={{ fontSize: 11, fontWeight: 600, color: '#B45309', background: '#FFF0E0', padding: '2px 8px', borderRadius: 99,
                                  maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  cursor: canEdit ? 'pointer' : 'default' }}>
                                {p.special_case_remark || 'Special'}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                        title={flagged
                          ? `Flagged for deletion by ${p.deletion_flagged_by ?? '—'} · ${new Date(p.deletion_flagged_at as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}${p.deletion_flag_reason ? ` · ${p.deletion_flag_reason}` : ''}`
                          : 'Flag this registry for an admin to review & delete'}>
                        <input type="checkbox" checked={flagged} disabled={!canEdit}
                          onChange={() => void toggleDeletionFlag(p)}
                          style={{ width: 16, height: 16, cursor: canEdit ? 'pointer' : 'default', accentColor: '#C0321A' }} />
                        {flagged && <span style={{ fontSize: 10, fontWeight: 700, color: '#C0321A', background: '#FDEAEA', padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>To delete</span>}
                        {flagged && canDelete && (
                          confirmDeleteId === p.id ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <button onClick={() => void deleteFlagged(p)} disabled={deletingId === p.id}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: deletingId === p.id ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                                {deletingId === p.id ? 'Deleting…' : 'Confirm'}
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)} disabled={deletingId === p.id}
                                style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button onClick={() => setConfirmDeleteId(p.id)}
                              title={`Delete “${p.name}” and all its sites, chargers, forms and files. This cannot be undone.`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              <Trash2 size={11} strokeWidth={2.25} /> Delete
                            </button>
                          )
                        )}
                      </div>
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
        <ProjectModal title="New Registration" initial={blankProject()} customers={customers}
          onSave={addProject} onClose={() => setAdding(false)} />
      )}
      {importingInvoices && isAdmin && (
        <InvoiceIngestModal onClose={() => setImportingInvoices(false)} onDone={fetchAll} />
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
  registration_code: string | null;
  procurement_date: string | null;
  turn_on_date: string | null;
  lta_letter_date: string | null;
  lta_letter_forms: LetterForms | null;
  form_a_next_date: string | null;
  form_d_next_date: string | null;
  form_a_override_date: string | null;
  form_a_override_count: number | null;
  form_d_override_date: string | null;
  form_d_override_count: number | null;
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
  lta_contract_years: number | null;
  lta_contract_start_date: string | null;
  lta_contract_path: string | null;
  lta_contract_filename: string | null;
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
  // Populated for AI-ingested invoices (section='invoices'); null for manual uploads.
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  bill_to_name: string | null;
  billing_address: string | null;
}

const PROJECT_FILES_BUCKET = 'project-files';

// Storage objects don't cascade when a charger/site/project row is deleted, so every
// delete path must collect and remove them first. This gathers the charger-forms paths
// tied to a set of chargers: LTA record PDFs + invoices + warranty-claim documents.
// (Form 1 PDFs and site LTA contracts live on the charger/site rows and are added by callers.)
async function collectChargerStoragePaths(chargerIds: string[]): Promise<string[]> {
  if (!chargerIds.length) return [];
  const paths: string[] = [];
  const { data: lta } = await supabase.from('charger_lta_records').select('storage_path, invoice_path').in('charger_id', chargerIds);
  for (const r of (lta ?? []) as Array<{ storage_path: string | null; invoice_path: string | null }>) {
    if (r.storage_path) paths.push(r.storage_path);
    if (r.invoice_path) paths.push(r.invoice_path);
  }
  const { data: claims } = await supabase.from('charger_warranty_claims').select('storage_path').in('charger_id', chargerIds);
  for (const r of (claims ?? []) as Array<{ storage_path: string | null }>) {
    if (r.storage_path) paths.push(r.storage_path);
  }
  return paths;
}

// Delete a whole registry: its sites, chargers, LTA records, warranty claims and
// project_files rows go via FK ON DELETE CASCADE, but storage objects don't
// cascade — so clear them first to avoid orphans. Used by both the detail page
// and the flagged-row delete in the list.
async function deleteRegistryProject(projectId: string): Promise<string | null> {
  const [{ data: siteRows }, { data: files }] = await Promise.all([
    supabase.from('project_sites').select('lta_contract_path, site_chargers(id, form_1_path)').eq('project_id', projectId),
    supabase.from('project_files').select('storage_path').eq('project_id', projectId),
  ]);
  const sites = (siteRows ?? []) as Array<{ lta_contract_path: string | null; site_chargers: Array<{ id: string; form_1_path: string | null }> }>;
  const chargers = sites.flatMap((st) => st.site_chargers ?? []);
  const chargerFormPaths = [
    ...chargers.map((c) => c.form_1_path),
    ...sites.map((st) => st.lta_contract_path),
    ...(await collectChargerStoragePaths(chargers.map((c) => c.id))),
  ].filter((x): x is string => !!x);
  const projectFilePaths = ((files ?? []) as Array<{ storage_path: string | null }>).map((f) => f.storage_path).filter((x): x is string => !!x);
  if (projectFilePaths.length) await supabase.storage.from(PROJECT_FILES_BUCKET).remove(projectFilePaths);
  if (chargerFormPaths.length) await supabase.storage.from(CHARGER_FORMS_BUCKET).remove(chargerFormPaths);
  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  return error ? error.message : null;
}

type DetailTabId = 'overview' | 'files' | `site:${string}`;

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
  const [sites, setSites]       = useState<ProjectSite[]>([]);
  const [lta, setLta]           = useState<SiteLtaRow[]>([]);
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
    const siteRows = (s ?? []) as ProjectSite[];
    setSites(siteRows);
    setBrandModels((bm ?? []) as BrandModel[]);

    // LTA records for every charger in the project — drives the Overview flags.
    const chargerIds = siteRows.flatMap((st) => st.site_chargers.map((c) => c.id));
    if (chargerIds.length) {
      const { data: lr } = await supabase.from('charger_lta_records')
        .select('id, charger_id, form_type, performed_at, invoice_path, period_n')
        .in('charger_id', chargerIds)
        .order('performed_at', { ascending: false });
      setLta((lr ?? []) as SiteLtaRow[]);
    } else {
      setLta([]);
    }
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
    const err = await deleteRegistryProject(projectId);
    setDeleting(false);
    if (err) { setDeleteError(err); return; }
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
            Delete registry
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

      {/* Tabbed detail — full width */}
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
                customers={customers}
                customer={customer}
                contacts={contacts}
                sites={sites}
                lta={lta}
                onPickSite={(id) => setTab(`site:${id}`)}
                canEdit={canEdit}
                onSaved={fetchAll}
              />
            )}
            {tab === 'files' && (
              <FilesTab
                projectId={project.id}
                files={files}
                sites={sites}
                brandModels={brandModels}
                customer={customer}
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
            initial={{
              name: customer?.type === 'residential' ? 'Home' : (customer?.name ?? ''),
              address: customer?.address ?? null,
              latitude: null, longitude: null, notes: null,
            }}
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
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 18, height: '100%', display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Registry Details</div>
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
  const [expanded, setExpanded] = useState(false);
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
  const COLLAPSED = 3;
  const visibleContacts = expanded ? contacts : contacts.slice(0, COLLAPSED);
  const extras = contacts.length - COLLAPSED;

  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 18, height: '100%', display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
              {visibleContacts.map((c) => (
                <div key={c.id} style={{ background: C.seasalt, borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  {c.email && (
                    <a href={`mailto:${c.email}`} title={c.email} style={{ fontSize: 11, color: C.green, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</a>
                  )}
                  {c.phone && (
                    <span style={{ fontSize: 11, color: C.slate, fontVariantNumeric: 'tabular-nums' }}>{c.phone}</span>
                  )}
                </div>
              ))}
            </div>
            {extras > 0 && (
              <button type="button" onClick={() => setExpanded((v) => !v)}
                style={{ alignSelf: 'flex-start', padding: 0, border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {expanded ? 'Show less' : `+ ${extras} more`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Right column: Overview tab ────────────────────────────────────

function OverviewTab({ project, customers, customer, contacts, sites, lta, onPickSite, canEdit, onSaved }: {
  project: Project;
  customers: CustomerLite[];
  customer: Customer | null;
  contacts: CustomerContact[];
  sites: ProjectSite[];
  lta: SiteLtaRow[];
  onPickSite: (id: string) => void;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const emailCount   = contacts.filter((c) => !!c.email).length;
  const phoneCount   = contacts.filter((c) => !!c.phone).length;
  const chargerCount = sites.reduce((n, s) => n + s.site_chargers.length, 0);
  const isResidential = customer?.type === 'residential';
  const formAMonths = isResidential ? 24 : 6;

  // All A / D records per charger (rows arrive newest-first) — drives the due/invoice flags.
  const byCharger = new Map<string, { A: SiteLtaRow[]; D: SiteLtaRow[] }>();
  for (const r of lta) {
    const e = byCharger.get(r.charger_id) ?? { A: [], D: [] };
    e[r.form_type].push(r);
    byCharger.set(r.charger_id, e);
  }
  const siteFlags = (site: ProjectSite) => {
    let form1Missing = 0, formADue = 0, invoiceMissing = 0;
    for (const c of site.site_chargers) {
      if (!c.form_1_path) form1Missing++;
      const e = byCharger.get(c.id) ?? { A: [], D: [] };
      const performedA = e.A.map(toPerformed);
      const performedD = e.D.map(toPerformed);
      if (ltaSchedule(ltaScheduleBase(c, formAMonths, 'A'), formAMonths, performedA).overdueCount > 0) formADue++;
      if (!isResidential && ltaSchedule(ltaScheduleBase(c, 12, 'D'), 12, performedD).overdueCount > 0) formADue++;
      // Newest record (rows arrive newest-first) drives the "invoice missing" flag.
      if (e.A[0] && !e.A[0].invoice_path) invoiceMissing++;
      if (!isResidential && e.D[0] && !e.D[0].invoice_path) invoiceMissing++;
    }
    return { form1Missing, formADue, invoiceMissing };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Registry details + linked customer (moved here from the old side column) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'stretch' }}>
        <ProjectDetailsCard project={project} customers={customers} canEdit={canEdit} onSaved={onSaved} />
        <LinkedCustomerCard customer={customer} contacts={contacts} hasLink={!!project.customer_id} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <SummaryStat label="Sites"    value={String(sites.length)} />
        <SummaryStat label="Chargers" value={String(chargerCount)} />
        <SummaryStat label="Contacts" value={String(contacts.length)} sub={`${emailCount} email${emailCount === 1 ? '' : 's'} · ${phoneCount} phone${phoneCount === 1 ? '' : 's'} on file`} />
      </div>

        {sites.length === 0 ? (
          <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: C.slate, textAlign: 'center', lineHeight: 1.6 }}>
            No sites yet.{canEdit && ' Click + Site (top right) to add the first one.'}
          </div>
        ) : (
          <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: C.seasalt }}>
                    {([['Site', 'left'], ['Chargers', 'center'], ['Form 1 Missing', 'center'], ['Form A Due', 'center'], ['Invoices Missing', 'center'], ['Contract', 'center'], ['', 'right']] as const).map(([h, align]) => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: align, fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => {
                    const f = siteFlags(s);
                    const cYears = s.lta_contract_years ?? 0;
                    const cEnd = cYears > 0 && s.lta_contract_start_date ? addYears(s.lta_contract_start_date, cYears) : null;
                    const cDaysLeft = cEnd ? daysFromToday(cEnd) : null;
                    const contractActive = cYears > 0 && (cDaysLeft === null || cDaysLeft >= 0);
                    const numCell = (n: number) => (
                      <td style={{ padding: '12px 14px', textAlign: 'center', borderBottom: '1px solid #F3F3F3', fontWeight: 700, color: n > 0 ? '#C0321A' : C.slate }}>{n}</td>
                    );
                    return (
                      <tr key={s.id} onClick={() => onPickSite(s.id)} style={{ cursor: 'pointer' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                        <td style={{ padding: '12px 14px', borderBottom: '1px solid #F3F3F3', minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{s.name}</div>
                          {s.address && <div style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>{s.address}</div>}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', borderBottom: '1px solid #F3F3F3', fontWeight: 700, color: C.green }}>{s.site_chargers.length}</td>
                        {numCell(f.form1Missing)}
                        {numCell(f.formADue)}
                        {numCell(f.invoiceMissing)}
                        <td style={{ padding: '12px 14px', textAlign: 'center', borderBottom: '1px solid #F3F3F3', whiteSpace: 'nowrap' }}>
                          {contractActive ? (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#E4F3E3', color: '#1B512D', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                              {cYears} yr{cYears === 1 ? '' : 's'}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: C.slate }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', borderBottom: '1px solid #F3F3F3', whiteSpace: 'nowrap' }}>
                          <span style={{ color: C.green, fontWeight: 700, fontSize: 12 }}>Open →</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
    // Row cascade (site_chargers → charger_lta_records / warranty_claims) is handled
    // by the DB, but storage objects don't cascade — clean them up first.
    const paths: string[] = [
      ...site.site_chargers.map((c) => c.form_1_path),
      site.lta_contract_path,
      ...(await collectChargerStoragePaths(site.site_chargers.map((c) => c.id))),
    ].filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from(CHARGER_FORMS_BUCKET).remove(paths);
    await supabase.from('project_sites').delete().eq('id', site.id);
    setDeleting(false);
    onDeleted();
    await onChanged();
  };

  const { unit: siteUnit, rest: siteNotes } = splitUnit(site.notes);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Site header */}
      <div style={{ background: C.white, borderRadius: 14, border: '1px solid #EBEBEB', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a' }}>{site.name}</div>
            {(site.address || siteUnit) && (
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                {site.address}{siteUnit && <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{site.address ? ' · ' : ''}{siteUnit}</span>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {hasNavTarget({ address: site.address, lat: site.latitude, lng: site.longitude }) && (
              <button onClick={() => window.open(googleMapsDirections({ address: site.address, unit: siteUnit, lat: site.latitude, lng: site.longitude }), '_blank', 'noopener,noreferrer')}
                title="Navigate with Google Maps"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                <Navigation size={11} strokeWidth={2.25} /> Navigate
              </button>
            )}
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
        {siteNotes && (
          <div style={{ background: C.seasalt, borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#1a1a1a', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {siteNotes}
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

      {/* LTA inspection contract — at the site level */}
      <div style={{ background: C.white, borderRadius: 14, border: '1px solid #EBEBEB', padding: 16 }}>
        <ContractCard
          years={site.lta_contract_years}
          startDate={site.lta_contract_start_date}
          turnOn={site.site_chargers.map((c) => c.turn_on_date).filter((d): d is string => !!d).sort()[0] ?? null}
          canEdit={canEdit}
          isResidential={customer.type === 'residential'}
          chargers={site.site_chargers.map((c) => ({ id: c.id, label: c.asset_tag, covered: c.has_maintenance_package }))}
          contractPath={site.lta_contract_path}
          contractFilename={site.lta_contract_filename}
          onSave={async (years, startDate, coveredIds, newFile) => {
            let path = site.lta_contract_path;
            let filename = site.lta_contract_filename;
            if (years == null) {
              if (path) void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([path]);
              path = null; filename = null;
            } else if (newFile) {
              const p = `lta-contract/${site.id}/${crypto.randomUUID()}/${pathSafe(newFile.name)}`;
              const up = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(p, newFile, { contentType: newFile.type || 'application/pdf' });
              if (up.error) throw new Error(up.error.message);
              if (path) void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([path]);
              path = p; filename = newFile.name;
            }
            await supabase.from('project_sites').update({ lta_contract_years: years, lta_contract_start_date: startDate, lta_contract_path: path, lta_contract_filename: filename }).eq('id', site.id);
            const allIds = site.site_chargers.map((c) => c.id);
            const coveredSet = new Set(coveredIds);
            const yes = allIds.filter((id) => coveredSet.has(id));
            const no = allIds.filter((id) => !coveredSet.has(id));
            if (yes.length) await supabase.from('site_chargers').update({ has_maintenance_package: true }).in('id', yes);
            if (no.length) await supabase.from('site_chargers').update({ has_maintenance_package: false }).in('id', no);
            await onChanged();
          }}
        />
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

// The unit / shoplot number can't get its own map pin (OneMap geocodes to the building),
// so it's recorded manually and stored as a structured first line of the site notes.
const UNIT_PREFIX = 'Unit/Shoplot: ';
export function splitUnit(notes: string | null): { unit: string; rest: string } {
  const text = notes ?? '';
  if (text.startsWith(UNIT_PREFIX)) {
    const nl = text.indexOf('\n');
    if (nl === -1) return { unit: text.slice(UNIT_PREFIX.length).trim(), rest: '' };
    return { unit: text.slice(UNIT_PREFIX.length, nl).trim(), rest: text.slice(nl + 1).trim() };
  }
  return { unit: '', rest: text };
}
function joinUnit(unit: string, rest: string): string | null {
  const u = unit.trim(), r = rest.trim();
  if (!u && !r) return null;
  if (!u) return r || null;
  return UNIT_PREFIX + u + (r ? '\n' + r : '');
}

function SiteModal({ title, initial, onSave, onClose }: {
  title: string;
  initial: SiteFormData;
  canDelete: boolean;
  onSave: (data: SiteFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<SiteFormData>(() => ({ ...initial, notes: splitUnit(initial.notes).rest || null }));
  const [unit, setUnit] = useState(() => splitUnit(initial.notes).unit);
  const [saving, setSaving] = useState(false);
  const [geo, setGeo] = useState<{ status: 'idle' | 'loading' | 'ok' | 'fail'; matched?: string }>({ status: 'idle' });
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  // Resolve a lat/lng for a free-text address via OneMap, WITHOUT rewriting the address
  // the user sees — the original text stays put so they can double-check the pin matched.
  const geocode = async (addr: string) => {
    const q = (addr ?? '').trim();
    if (q.length < 3) { setGeo({ status: 'fail' }); return; }
    setGeo({ status: 'loading' });
    const results = await searchOneMap(q);
    if (!live.current) return;
    if (results.length) {
      setForm((f) => ({ ...f, latitude: results[0].latitude, longitude: results[0].longitude }));
      setGeo({ status: 'ok', matched: results[0].address });
    } else {
      setGeo({ status: 'fail' });
    }
  };

  // Auto-geocode a prefilled address (e.g. a residential registry's billing address) once
  // on open, when no pin is set yet. Edited sites already carry their coordinates.
  useEffect(() => {
    if ((initial.address ?? '').trim() && initial.latitude == null && initial.longitude == null) void geocode(initial.address ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name:      form.name.trim(),
      address:   form.address && form.address.trim() ? form.address.trim() : null,
      latitude:  form.latitude,
      longitude: form.longitude,
      notes:     joinUnit(unit, form.notes ?? ''),
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
            onChange={(t) => { setForm((f) => ({ ...f, address: t || null, latitude: null, longitude: null })); setGeo({ status: 'idle' }); }}
            onPick={(r) => { setForm((f) => ({ ...f, address: r.address, latitude: r.latitude, longitude: r.longitude })); setGeo({ status: 'ok', matched: r.address }); }}
            placeholder="Start typing — pick a Singapore address to auto-fill lat/lng"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void geocode(form.address ?? '')} disabled={geo.status === 'loading' || (form.address ?? '').trim().length < 3}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: (geo.status === 'loading' || (form.address ?? '').trim().length < 3) ? 'default' : 'pointer', opacity: (form.address ?? '').trim().length < 3 ? 0.5 : 1 }}>
              <MapPin size={12} strokeWidth={2.25} /> {geo.status === 'loading' ? 'Locating…' : 'Locate on map'}
            </button>
            {geo.status === 'ok' && (
              <span style={{ fontSize: 11, fontWeight: 600, color: C.green }}>Pinned to {geo.matched} — check it matches the address above</span>
            )}
            {geo.status === 'fail' && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#B45309' }}>Couldn't locate — pick a suggestion or save without a map pin</span>
            )}
            {geo.status === 'idle' && form.latitude == null && (
              <span style={{ fontSize: 11, color: C.slate }}>No map pin yet</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.4 }}>
            Powered by <a href="https://www.onemap.gov.sg" target="_blank" rel="noreferrer" style={{ color: C.green, textDecoration: 'none', fontWeight: 600 }}>OneMap</a> (data.gov.sg). A prefilled address is located automatically; the text you see is kept as-is for you to verify.
          </div>
        </div>
        <div>
          <FieldLabel>Unit / Shoplot No. (optional)</FieldLabel>
          <input value={unit} onChange={(e) => setUnit(e.target.value)}
            placeholder="#01-18" style={inputStyle()} />
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.4 }}>
            The map pin is building-level — add the exact unit / shoplot here for industrial buildings and multi-tenant addresses.
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

function FilesTab({ projectId, files, sites, brandModels, customer, canEdit, canDelete, onChanged }: {
  projectId: string;
  files: ProjectFile[];
  sites: ProjectSite[];
  brandModels: BrandModel[];
  customer: Customer | null;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
}) {
  const invoices = files.filter((f) => f.section === 'invoices');
  const others   = files.filter((f) => f.section === 'others');
  const [selected, setSelected] = useState<ProjectFile | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [viewerErr, setViewerErr] = useState<string | null>(null);
  // Add-charger-from-document flow: resolve the site (create one if none, pick if several),
  // then open the charger form with the invoice PDF shown alongside for reference.
  const [addChargerSiteId, setAddChargerSiteId] = useState<string | null>(null);
  const [pickSiteOpen, setPickSiteOpen] = useState(false);
  const [newSiteOpen, setNewSiteOpen] = useState(false);
  const isResidential = customer?.type === 'residential';

  const startAddCharger = () => {
    if (sites.length === 0) setNewSiteOpen(true);
    else if (sites.length === 1) setAddChargerSiteId(sites[0].id);
    else setPickSiteOpen(true);
  };
  const targetSite = addChargerSiteId ? sites.find((s) => s.id === addChargerSiteId) ?? null : null;

  // Drop the selection if the file disappears (deleted / reload).
  useEffect(() => {
    if (selected && !files.find((f) => f.id === selected.id)) setSelected(null);
  }, [files, selected]);

  // Sign a longer-lived URL for the inline preview when the selection changes.
  useEffect(() => {
    if (!selected) { setSignedUrl(null); setViewerErr(null); return; }
    let cancelled = false;
    setSignedUrl(null); setViewerErr(null);
    void (async () => {
      const { data, error } = await supabase.storage.from(PROJECT_FILES_BUCKET).createSignedUrl(selected.storage_path, 3600);
      if (cancelled) return;
      if (error || !data) setViewerErr(error?.message ?? 'Could not load preview');
      else setSignedUrl(data.signedUrl);
    })();
    return () => { cancelled = true; };
  }, [selected]);

  const isPdf = (f: ProjectFile) => (f.mime_type ?? '').includes('pdf') || f.filename.toLowerCase().endsWith('.pdf');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 400px) 1fr', gap: 16, alignItems: 'start' }}>
      {/* Left — document lists */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        <FileSection title="Invoices" section="invoices" files={invoices} selectedId={selected?.id ?? null} onSelect={setSelected}
          projectId={projectId} canEdit={canEdit} canDelete={canDelete} onChanged={onChanged} />
        <FileSection title="Others" section="others" files={others} selectedId={selected?.id ?? null} onSelect={setSelected}
          projectId={projectId} canEdit={canEdit} canDelete={canDelete} onChanged={onChanged} />
      </div>

      {/* Right — inline viewer for cross-checking */}
      <div style={{ position: 'sticky', top: 0, border: '1px solid #EBEBEB', borderRadius: 12, background: C.seasalt, height: 'calc(100vh - 210px)', minHeight: 460, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.slate, padding: 24, textAlign: 'center' }}>
            <FileText size={32} strokeWidth={1.5} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>Click a document to preview it here</div>
            <div style={{ fontSize: 12 }}>Open an invoice on the left to cross-check it without leaving the page.</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #EBEBEB', background: C.white }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div title={selected.filename} style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.filename}</div>
                {selected.invoice_number && (
                  <div style={{ fontSize: 11, color: C.slate, marginTop: 1 }}>
                    <span style={{ color: C.green, fontWeight: 700 }}>{selected.invoice_number}</span>
                    {selected.invoice_date && ` · ${fmtDate(selected.invoice_date)}`}
                    {selected.total_amount != null && ` · $${selected.total_amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </div>
                )}
              </div>
              {canEdit && (
                <button onClick={startAddCharger} title="Create a charger with this invoice open"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  + Add charger
                </button>
              )}
              {signedUrl && (
                <a href={signedUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, fontWeight: 700, color: C.green, textDecoration: 'none', whiteSpace: 'nowrap' }}>Open ↗</a>
              )}
              <button onClick={() => setSelected(null)} title="Close preview"
                style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={13} strokeWidth={2.5} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, background: '#525659' }}>
              {viewerErr ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.white, fontSize: 13, padding: 24, textAlign: 'center' }}>{viewerErr}</div>
              ) : !signedUrl ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.white, fontSize: 13 }}>Loading preview…</div>
              ) : isPdf(selected) ? (
                <iframe key={selected.id} src={signedUrl} title={selected.filename} style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
              ) : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: C.white, fontSize: 13, padding: 24, textAlign: 'center' }}>
                  Preview isn't available for this file type.
                  <a href={signedUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#A5D6A7', fontWeight: 700 }}>Open in a new tab ↗</a>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Pick which site to add the charger to (only when the registry has several). */}
      {pickSiteOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.white, borderRadius: 20, padding: 24, width: 420, maxWidth: 'calc(100vw - 24px)', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>Add charger to which site?</div>
              <button onClick={() => setPickSiteOpen(false)} style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 17, fontFamily: 'Figtree' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sites.map((s) => (
                <button key={s.id} onClick={() => { setAddChargerSiteId(s.id); setPickSiteOpen(false); }}
                  style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: '#1a1a1a', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.honeydew)} onMouseLeave={(e) => (e.currentTarget.style.background = C.white)}>
                  {s.name}{s.address ? <span style={{ color: C.slate, fontWeight: 400 }}> · {s.address}</span> : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* No site yet → create one first. Residential defaults to Home; commercial/dealer to
          the company name — both prefill the billing address. */}
      {newSiteOpen && (
        <SiteModal
          title="New Site"
          initial={{
            name: isResidential ? 'Home' : (customer?.name ?? ''),
            address: customer?.address ?? null,
            latitude: null, longitude: null, notes: null,
          }}
          canDelete={false}
          onSave={async (data) => {
            const { data: created } = await supabase.from('project_sites').insert({ ...data, project_id: projectId }).select('id').single();
            await onChanged();
            if (created) setAddChargerSiteId((created as { id: string }).id);
          }}
          onClose={() => setNewSiteOpen(false)}
        />
      )}

      {/* Charger form with the invoice PDF alongside for reference. */}
      {targetSite && (
        <ChargerModal
          title="New Registration"
          initial={{ ...blankCharger(), asset_tag: isResidential ? 'Home Charger' : `Commercial ${(targetSite.site_chargers?.length ?? 0) + 1}` }}
          siteName={targetSite.name}
          isResidential={isResidential}
          brandModels={brandModels}
          canDelete={false}
          canManageBrandModels={canDelete}
          pdfUrl={selected && isPdf(selected) ? (signedUrl ?? undefined) : undefined}
          pdfName={selected?.filename}
          onSave={async (data) => {
            await supabase.from('site_chargers').insert({ ...data, site_id: targetSite.id });
            await onChanged();
          }}
          onBrandModelsChanged={onChanged}
          onClose={() => setAddChargerSiteId(null)}
        />
      )}
    </div>
  );
}

function FileSection({ title, section, files, projectId, canEdit, canDelete, onChanged, selectedId, onSelect }: {
  title: string;
  section: ProjectFileSection;
  files: ProjectFile[];
  projectId: string;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
  selectedId: string | null;
  onSelect: (f: ProjectFile) => void;
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
            <FileRow key={f.id} file={f} canDelete={canDelete} onChanged={onChanged}
              selected={selectedId === f.id} onSelect={() => onSelect(f)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ file, canDelete, onChanged, selected, onSelect }: { file: ProjectFile; canDelete: boolean; onChanged: () => Promise<void>; selected: boolean; onSelect: () => void }) {
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: `1.5px solid ${selected ? C.green : '#EBEBEB'}`, borderRadius: 10, background: selected ? C.honeydew : C.white }}>
      <FileText size={18} strokeWidth={1.75} color={selected ? C.green : C.slate} style={{ flexShrink: 0 }} />
      <div onClick={onSelect} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
        <div title={file.filename} style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.filename}
        </div>
        {file.invoice_number && (
          <div style={{ fontSize: 11, color: '#1a1a1a', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: C.green }}>{file.invoice_number}</span>
            {file.invoice_date && <span style={{ color: C.slate }}>{fmtDate(file.invoice_date)}</span>}
            {file.total_amount != null && <span style={{ color: C.slate }}>${file.total_amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
          </div>
        )}
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

  // All A/D inspection dates per charger — drives the due/missing chips on the cards.
  const [ltaByCharger, setLtaByCharger] = useState<Map<string, { A: LtaPerformed[]; D: LtaPerformed[] }>>(new Map());
  const chargerIdsKey = chargers.map((c) => c.id).sort().join(',');
  useEffect(() => {
    const ids = chargers.map((c) => c.id);
    if (!ids.length) { setLtaByCharger(new Map()); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from('charger_lta_records').select('id, charger_id, form_type, performed_at, period_n').in('charger_id', ids);
      if (cancelled) return;
      const m = new Map<string, { A: LtaPerformed[]; D: LtaPerformed[] }>();
      for (const r of (data ?? []) as Array<{ id: string; charger_id: string; form_type: 'A' | 'D'; performed_at: string; period_n: number | null }>) {
        const e = m.get(r.charger_id) ?? { A: [], D: [] };
        e[r.form_type].push(toPerformed(r));
        m.set(r.charger_id, e);
      }
      setLtaByCharger(m);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargerIdsKey]);
  const isResidential = customer.type === 'residential';
  const formAMonths = isResidential ? 24 : 6;

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
    // Row cascade (LTA records / warranty claims) is handled by the DB; clean their
    // storage objects + the Form 1 PDF first so nothing is orphaned in the bucket.
    const paths: string[] = [
      selected.form_1_path,
      ...(await collectChargerStoragePaths([selected.id])),
    ].filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from(CHARGER_FORMS_BUCKET).remove(paths);
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
          {chargers.map((ch) => {
            const l = ltaByCharger.get(ch.id) ?? { A: [], D: [] };
            return (
              <ChargerCard
                key={ch.id}
                charger={ch}
                selected={selectedId === ch.id}
                flags={{
                  formADue: ltaSchedule(ltaScheduleBase(ch, formAMonths, 'A'), formAMonths, l.A).overdueCount > 0,
                  formDDue: !isResidential && ltaSchedule(ltaScheduleBase(ch, 12, 'D'), 12, l.D).overdueCount > 0,
                  form1Missing: !ch.form_1_path,
                }}
                onClick={() => setSelectedId(selectedId === ch.id ? null : ch.id)}
              />
            );
          })}
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
            registration_code: editing.registration_code,
            procurement_date: editing.procurement_date,
            turn_on_date: editing.turn_on_date,
            lta_letter_date: editing.lta_letter_date,
            lta_letter_forms: editing.lta_letter_forms,
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
            const paths: string[] = [
              editing.form_1_path,
              ...(await collectChargerStoragePaths([editing.id])),
            ].filter((p): p is string => !!p);
            if (paths.length) await supabase.storage.from(CHARGER_FORMS_BUCKET).remove(paths);
            await supabase.from('site_chargers').delete().eq('id', editing.id);
            await onChanged();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ChargerCard({ charger, selected, flags, onClick }: { charger: SiteCharger; selected: boolean; flags: { formADue: boolean; formDDue: boolean; form1Missing: boolean }; onClick: () => void }) {
  const chips: { label: string; bg: string; color: string }[] = [];
  if (flags.formADue) chips.push({ label: 'Form A due', bg: '#FDEAEA', color: '#C0321A' });
  if (flags.formDDue) chips.push({ label: 'Form D due', bg: '#FDEAEA', color: '#C0321A' });
  if (flags.form1Missing) chips.push({ label: 'Form 1 missing', bg: '#FFF0E0', color: '#B45309' });
  if (chips.length === 0) chips.push({ label: 'Up to date', bg: '#E4F3E3', color: '#1B512D' });
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {chips.map((c) => (
          <span key={c.label} style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{c.label}</span>
        ))}
      </div>
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
  if (tab === 'details')     return <ChargerDetailsPanel charger={charger} siteName={siteName} customer={customer} onTabChange={onTabChange} onChargerChanged={onChargerChanged} />;
  if (tab === 'maintenance') return <LtaInspectionPanel  charger={charger} siteName={siteName} canEdit={canEdit} canDelete={canDelete} customer={customer} />;
  return <WarrantyPanel charger={charger} siteName={siteName} canEdit={canEdit} canDelete={canDelete} />;
}

function ChargerDetailsPanel({ charger, siteName, customer, onTabChange, onChargerChanged }: {
  charger: SiteCharger;
  siteName: string;
  customer: LtaEmailCustomer;
  onTabChange: (t: ChargerDetailTab) => void;
  onChargerChanged: () => Promise<void>;
}) {
  // Residential chargers need only Form A, every 24 months — no Form D.
  const isResidential = customer.type === 'residential';
  const formAMonths = isResidential ? 24 : 6;
  const [ltaRecords, setLtaRecords] = useState<LtaRecord[]>([]);
  const [addingForm, setAddingForm] = useState<LtaFormType | null>(null);
  const [addingInvoiceFor, setAddingInvoiceFor] = useState<LtaRecord | null>(null);
  const [addingForm1, setAddingForm1] = useState(false);
  const [editingDue, setEditingDue] = useState<LtaFormType | null>(null);
  const [dueDraft, setDueDraft] = useState('');
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  const refresh = async () => {
    const { data } = await supabase.from('charger_lta_records')
      .select('*')
      .eq('charger_id', charger.id)
      .order('performed_at', { ascending: false });
    setLtaRecords((data ?? []) as LtaRecord[]);
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [charger.id]);

  const form1DisplayName = computeForm1Filename(charger.asset_tag, charger.turn_on_date, siteName);

  const openForm1 = async (mode: 'view' | 'download') => {
    if (!charger.form_1_path) return;
    const { data } = await supabase.storage.from(CHARGER_FORMS_BUCKET)
      .createSignedUrl(charger.form_1_path, 60, mode === 'download' ? { download: form1DisplayName } : undefined);
    if (data?.signedUrl) window.open(data.signedUrl, mode === 'download' ? '_self' : '_blank');
  };

  const openLtaRecord = async (record: LtaRecord) => {
    // Open inline in a new tab (no `download` option) so it displays, not downloads.
    const { data } = await supabase.storage.from(CHARGER_FORMS_BUCKET)
      .createSignedUrl(record.storage_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  const tone = warrantyTone(charger.warranty_end_date);
  const performedA = ltaRecords.filter((r) => r.form_type === 'A').map(toPerformed);
  const performedD = ltaRecords.filter((r) => r.form_type === 'D').map(toPerformed);
  const overrideA = resolveDueOverride(charger.form_a_override_date, charger.form_a_override_count, performedA.length);
  const overrideD = resolveDueOverride(charger.form_d_override_date, charger.form_d_override_count, performedD.length);
  // Cycles already closed, per form type — so the picker can't double-book one.
  const claimedByForm = (ft: LtaFormType): Map<number, string> => {
    const ofType = ltaRecords.filter((r) => r.form_type === ft);
    const interval = ft === 'A' ? formAMonths : 12;
    const { periodOf } = ltaAssignPeriods(ltaScheduleBase(charger, interval, ft), interval, ofType.map(toPerformed));
    const m = new Map<number, string>();
    for (const [id, n] of periodOf) m.set(n, id);
    return m;
  };
  const schedA = ltaSchedule(ltaScheduleBase(charger, formAMonths, 'A'), formAMonths, performedA);
  const schedD = ltaSchedule(ltaScheduleBase(charger, 12, 'D'), 12, performedD);
  const formADate = overrideA ?? schedA.nextDue;
  const formDDate = overrideD ?? schedD.nextDue;
  const formA = daysFromToday(formADate);
  const formD = daysFromToday(formDDate);

  // Manually override a next-due date. The count is stamped so the override is
  // dropped once a further inspection is logged (then the schedule resumes).
  const saveOverride = async (ft: LtaFormType, date: string | null) => {
    const count = ft === 'A' ? performedA.length : performedD.length;
    const patch = ft === 'A'
      ? { form_a_override_date: date, form_a_override_count: date ? count : null }
      : { form_d_override_date: date, form_d_override_count: date ? count : null };
    await supabase.from('site_chargers').update(patch).eq('id', charger.id);
    setEditingDue(null);
    await onChargerChanged();
  };

  // Lifecycle timeline — chronological top → bottom: procurement → installation
  // (Form 1) → registration → recurring Form A / Form D (latest done + next due).
  type TLAction = { label: string; onClick: () => void; tone: 'green' | 'amber' | 'plain' };
  type TLNode = { dot: string; titleColor: string; title: string; date: string | null; dateLabel?: string; subtitle: React.ReactNode; actions: TLAction[] };
  const GREEN = C.green, RED = '#C2410C', AMBER = '#F1B04C', PURPLE = '#6B21A8', BLACK = '#1a1a1a';
  const underContract = charger.has_maintenance_package;
  const dueColor = underContract ? RED : PURPLE;

  const inspectedSub = (rec: LtaRecord) => rec.invoice_path
    ? <>Inspected · invoice attached</>
    : <>Inspected · <span style={{ color: AMBER, fontWeight: 700 }}>invoice pending</span></>;
  const completedActions = (rec: LtaRecord): TLAction[] => {
    const a: TLAction[] = [{ label: 'View', onClick: () => void openLtaRecord(rec), tone: 'green' }];
    if (!rec.invoice_path) a.push({ label: 'Add invoice', onClick: () => setAddingInvoiceFor(rec), tone: 'amber' });
    return a;
  };
  const dueSubtitle = (date: string | null, days: number | null): React.ReactNode => {
    if (!date) return 'Set a registration or procurement date';
    const due = <>Next due {fmtDate(date)}{days != null && <> · {relDays(days)}</>}</>;
    return underContract ? due : <><span style={{ color: PURPLE, fontWeight: 700 }}>No contract</span> · {due}</>;
  };
  // How far off the schedule an inspection actually landed — the reason the
  // performed date and the cycle's due date are shown side by side.
  const cycleDrift = (performed: string, due: string): string | null => {
    const p = new Date(performed + 'T00:00:00').getTime(), d = new Date(due + 'T00:00:00').getTime();
    if (isNaN(p) || isNaN(d)) return null;
    const days = Math.round((p - d) / 86400000);
    if (days === 0) return 'on time';
    return days > 0 ? `${days}d late` : `${Math.abs(days)}d early`;
  };
  const completedNode = (label: string, rec: LtaRecord, cycle: { n: number; due: string } | null): TLNode => {
    const drift = cycle ? cycleDrift(rec.performed_at, cycle.due) : null;
    return {
      dot: rec.invoice_path ? GREEN : AMBER, titleColor: BLACK, title: `${label} — Completed`,
      date: rec.performed_at, dateLabel: 'Performed',
      subtitle: (
        <>
          {cycle && <>Cycle {cycle.n} · due {fmtDate(cycle.due)}{drift && <> · <span style={{ fontWeight: 700, color: drift === 'on time' ? C.green : C.slate }}>{drift}</span></>}{rec.period_n ? <span style={{ fontWeight: 700, color: C.green }}> · mapped manually</span> : null}<br /></>}
          {inspectedSub(rec)}
        </>
      ),
      actions: completedActions(rec),
    };
  };
  const overdueNode = (label: string, due: string, n: number): TLNode => ({
    dot: dueColor, titleColor: dueColor, title: `${label} — Overdue`, date: due, dateLabel: 'Due',
    subtitle: <>Cycle {n} · {underContract
      ? <span style={{ color: dueColor, fontWeight: 700 }}>Not performed</span>
      : <><span style={{ color: PURPLE, fontWeight: 700 }}>No contract</span> · <span style={{ color: dueColor, fontWeight: 700 }}>Not performed</span></>}</>,
    actions: [],
  });
  const dueNode = (label: string, ft: LtaFormType, date: string | null, days: number | null, n: number | null): TLNode => ({
    dot: dueColor, titleColor: dueColor, title: `${label} — Due`, date: null,
    subtitle: <>{n ? <>Cycle {n} · </> : null}{dueSubtitle(date, days)}</>,
    actions: [{ label: 'Add →', onClick: () => setAddingForm(ft), tone: 'plain' }],
  });
  // Every node carries a sort value (ms since epoch) so Form A & Form D interleave
  // strictly by date rather than being grouped. Form A wins same-date ties (+0.2 > +0.1).
  type TLEntry = { node: TLNode; sort: number };
  const DAY = 86400000, FAR_FUTURE = 8.64e15;
  const parseMs = (s: string | null): number => { if (!s) return NaN; const d = new Date(s + 'T00:00:00'); return isNaN(d.getTime()) ? NaN : d.getTime(); };
  const regMs = parseMs(charger.turn_on_date);
  const procMs = parseMs(charger.procurement_date);
  // Genesis nodes always sort Procurement < Installation < Registration, even when dates are missing/equal.
  const regSort = !isNaN(regMs) ? regMs : (!isNaN(procMs) ? procMs + 2 * DAY : 2);
  const installSort = !isNaN(regMs) ? regMs - DAY : (!isNaN(procMs) ? procMs + DAY : 1);
  const procSort = !isNaN(procMs) ? procMs : (!isNaN(regMs) ? regMs - 2 * DAY : 0);

  // Build the recurring nodes for one form type: one entry per scheduled period
  // (Completed or Overdue · not performed) + the upcoming Due, each dated for sorting.
  const formEntries = (label: string, ft: LtaFormType, intervalMonths: number, sched: LtaScheduleResult, dueDate: string | null, dueDays: number | null): TLEntry[] => {
    const eps = ft === 'A' ? 0.2 : 0.1;
    // Look the record up by the cycle it satisfies, not by date — a manual
    // mapping means the two can disagree.
    const ofType = ltaRecords.filter((r) => r.form_type === ft);
    const { periodOf } = ltaAssignPeriods(ltaScheduleBase(charger, intervalMonths, ft), intervalMonths, ofType.map(toPerformed));
    const recByPeriod = new Map<number, LtaRecord>();
    for (const r of ofType) { const n = periodOf.get(r.id); if (n != null) recByPeriod.set(n, r); }
    const out: TLEntry[] = [];
    for (const p of sched.periods) {
      const dm = parseMs(p.performedAt ?? p.due);
      const sort = (isNaN(dm) ? regSort : dm) + eps;
      if (p.performedAt) {
        const rec = recByPeriod.get(p.n);
        out.push({ node: rec ? completedNode(label, rec, { n: p.n, due: p.due })
          : { dot: GREEN, titleColor: BLACK, title: `${label} — Completed`, date: p.performedAt, dateLabel: 'Performed', subtitle: <>Cycle {p.n} · due {fmtDate(p.due)}<br />Inspected</>, actions: [] }, sort });
      } else {
        out.push({ node: overdueNode(label, p.due, p.n), sort });
      }
    }
    const dm = parseMs(dueDate);
    const nextN = sched.periods.length ? sched.periods[sched.periods.length - 1].n + 1 : 1;
    out.push({ node: dueNode(label, ft, dueDate, dueDays, dueDate ? nextN : null), sort: (isNaN(dm) ? FAR_FUTURE : dm) + eps });
    return out;
  };

  const entries: TLEntry[] = [
    { node: charger.procurement_date
        ? { dot: GREEN, titleColor: BLACK, title: 'Procurement', date: charger.procurement_date, subtitle: 'Charger procured', actions: [] }
        : { dot: RED, titleColor: RED, title: 'Procurement', date: null, subtitle: 'Procurement date pending', actions: [] }, sort: procSort },
    { node: charger.form_1_path
        ? { dot: GREEN, titleColor: BLACK, title: 'Installation + Form 1', date: null, subtitle: 'Form 1 attached', actions: [{ label: 'View', onClick: () => void openForm1('view'), tone: 'green' }] }
        : { dot: RED, titleColor: RED, title: 'Installation + Form 1', date: null, subtitle: 'Form 1 pending upload', actions: [{ label: 'Upload →', onClick: () => setAddingForm1(true), tone: 'plain' }] }, sort: installSort },
    { node: { dot: charger.turn_on_date ? GREEN : RED, titleColor: charger.turn_on_date ? BLACK : RED, title: 'Registration', date: charger.turn_on_date, subtitle: charger.turn_on_date ? 'Charger commissioned' : 'Registration date not set', actions: [] }, sort: regSort },
    ...(charger.lta_letter_date ? [{
      node: { dot: C.opal, titleColor: C.opal, title: 'LTA Inspection Letter', date: charger.lta_letter_date, dateLabel: 'Due by', subtitle: (() => {
        const f = isResidential ? 'A' : (charger.lta_letter_forms ?? 'both');
        const which = f === 'both' ? 'Form A & D' : 'Form A';
        return <span style={{ fontWeight: 700, color: C.opal }}>{which} due by this date</span>;
      })(), actions: [] } as TLNode,
      // Sit just after Registration so it reads as the scheduling anchor.
      sort: (parseMs(charger.lta_letter_date) || regSort) + 0.05,
    }] : []),
    ...formEntries('Form A', 'A', formAMonths, schedA, formADate, formA),
    ...(!isResidential ? formEntries('Form D', 'D', 12, schedD, formDDate, formD) : []),
  ];
  // Newest-at-top: sort by date descending.
  entries.sort((a, b) => b.sort - a.sort);
  const nodes = entries.map((e) => e.node);

  // Keep the 4 most-recent nodes and the 3 genesis nodes (down to Registration)
  // always visible; collapse the overdue middle behind a click-to-expand toggle.
  const TOP_KEEP = 4, BOTTOM_KEEP = 3;
  type TLItem = { kind: 'node'; node: TLNode } | { kind: 'toggle'; count: number };
  let timelineItems: TLItem[];
  if (nodes.length <= TOP_KEEP + BOTTOM_KEEP + 1) {
    timelineItems = nodes.map((n) => ({ kind: 'node', node: n }));
  } else {
    const middle = nodes.slice(TOP_KEEP, nodes.length - BOTTOM_KEEP);
    timelineItems = [
      ...nodes.slice(0, TOP_KEEP).map((n): TLItem => ({ kind: 'node', node: n })),
      ...(timelineExpanded ? middle.map((n): TLItem => ({ kind: 'node', node: n })) : []),
      { kind: 'toggle', count: middle.length },
      ...nodes.slice(nodes.length - BOTTOM_KEEP).map((n): TLItem => ({ kind: 'node', node: n })),
    ];
  }

  const kvLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' };
  const KV = ({ label, value, muted }: { label: string; value: string; muted?: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
      <span style={kvLabel}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: muted ? C.slate : '#1a1a1a', textAlign: 'right', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
  const sectionHeader = (title: string, link?: { label: string; onClick: () => void }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      {link && <button onClick={link.onClick} style={{ padding: 0, border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{link.label}</button>}
    </div>
  );
  const cardStyle: React.CSSProperties = { border: '1px solid #EBEBEB', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 };

  return (
    <>
    {addingForm && (
      <AddLtaRecordModal charger={charger} siteName={siteName} formType={addingForm}
        intervalMonths={addingForm === 'A' ? formAMonths : 12} claimedBy={claimedByForm(addingForm)}
        onClose={() => setAddingForm(null)} onSaved={async () => { await refresh(); setAddingForm(null); }} />
    )}
    {addingInvoiceFor && (
      <AddInvoiceModal record={addingInvoiceFor}
        onClose={() => setAddingInvoiceFor(null)} onSaved={async () => { await refresh(); setAddingInvoiceFor(null); }} />
    )}
    {addingForm1 && (
      <AddForm1Modal charger={charger} siteName={siteName}
        onClose={() => setAddingForm1(false)} onSaved={async () => { await onChargerChanged(); setAddingForm1(false); }} />
    )}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr)', gap: 16, alignItems: 'start' }}>
      {/* Left — lifecycle timeline */}
      <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, padding: '14px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>Lifecycle Timeline</div>
        <div>
          {timelineItems.map((item, i) => {
            const isLast = i === timelineItems.length - 1;
            if (item.kind === 'toggle') {
              return (
                <div key="toggle" style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.white, border: '2px solid #EBEBEB', flexShrink: 0, marginTop: 4 }} />
                    {!isLast && <div style={{ flex: 1, width: 2, background: '#EBEBEB', marginTop: 4 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 16 }}>
                    <button onClick={() => setTimelineExpanded((v) => !v)}
                      style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <ChevronDown size={12} strokeWidth={2.5} style={{ transform: timelineExpanded ? 'rotate(180deg)' : 'none' }} />
                      {timelineExpanded ? 'Show less' : `Show ${item.count} more`}
                    </button>
                  </div>
                </div>
              );
            }
            const n = item.node;
            return (
              <div key={i} style={{ display: 'flex', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: n.dot, flexShrink: 0, marginTop: 2, boxShadow: '0 0 0 3px #fff, 0 0 0 4px #EBEBEB' }} />
                  {!isLast && <div style={{ flex: 1, width: 2, background: '#EBEBEB', marginTop: 4 }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: n.titleColor }}>{n.title}</div>
                      {n.date && (
                        <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
                          {n.dateLabel && <span style={{ fontWeight: 700 }}>{n.dateLabel} </span>}{fmtDate(n.date)}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{n.subtitle}</div>
                    </div>
                    {n.actions.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignItems: 'flex-end' }}>
                        {n.actions.map((a) => {
                          const ts = a.tone === 'green'
                            ? { border: '1px solid #C8E6C9', background: C.honeydew, color: C.green }
                            : a.tone === 'amber'
                            ? { border: '1px solid #FBD8B6', background: '#FFF0E0', color: '#B45309' }
                            : { border: '1px solid #EBEBEB', background: C.white, color: C.slate };
                          return (
                            <button key={a.label} onClick={a.onClick}
                              style={{ padding: '4px 10px', borderRadius: 8, ...ts, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {a.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right — compact details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={cardStyle}>
          {sectionHeader('Charger')}
          <KV label="Serial Number" value={charger.asset_tag} />
          <KV label="Registration Code" value={charger.registration_code ?? '—'} muted={!charger.registration_code} />
          <KV label="Brand & Model" value={charger.brand_model ?? '—'} muted={!charger.brand_model} />
        </div>

        <div style={cardStyle}>
          {sectionHeader('Registration & Form 1')}
          <KV label="Procurement Date" value={fmtDate(charger.procurement_date) ?? 'Not recorded'} muted={!charger.procurement_date} />
          <KV label="Registration Date" value={fmtDate(charger.turn_on_date) ?? 'Not recorded'} muted={!charger.turn_on_date} />
          <KV label="LTA Letter Date" value={fmtDate(charger.lta_letter_date) ?? 'Not recorded'} muted={!charger.lta_letter_date} />
          {charger.lta_letter_date && (() => {
            const f = isResidential ? 'A' : (charger.lta_letter_forms ?? 'both');
            const which = f === 'both' ? 'Form A & D' : 'Form A';
            return (
              <div style={{ fontSize: 10.5, fontWeight: 700, color: C.green, background: C.honeydew, borderRadius: 6, padding: '5px 8px', lineHeight: 1.4 }}>
                {which} due on the LTA letter date
              </div>
            );
          })()}
          {charger.form_1_path ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={14} strokeWidth={1.8} color={C.green} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form1DisplayName}</span>
              <button onClick={() => void openForm1('view')} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>View</button>
              <button onClick={() => void openForm1('download')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}><DownloadIcon size={11} strokeWidth={2.25} /></button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.slate, fontStyle: 'italic' }}>No Form 1 attached yet.</div>
          )}
        </div>

        <div style={cardStyle}>
          {sectionHeader('LTA Inspection', { label: 'View →', onClick: () => onTabChange('maintenance') })}
          {(() => {
            const dueRow = (label: string, ft: LtaFormType, date: string | null, days: number | null, isOverride: boolean) => {
              if (editingDue === ft) {
                return (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={kvLabel}>{label}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="date" value={dueDraft} onChange={(e) => setDueDraft(e.target.value)}
                        style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none' }} />
                      <button onClick={() => void saveOverride(ft, dueDraft || null)} title="Save override"
                        style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: C.green, color: C.white, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✓</button>
                      <button onClick={() => void saveOverride(ft, null)} title="Clear override (use schedule)"
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Auto</button>
                      <button onClick={() => setEditingDue(null)} title="Cancel"
                        style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={12} strokeWidth={2.5} /></button>
                    </span>
                  </div>
                );
              }
              return (
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <span style={kvLabel}>{label}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    {isOverride && <span style={{ fontSize: 9, fontWeight: 700, color: PURPLE, background: '#F0E8FF', padding: '1px 6px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Manual</span>}
                    <span style={{ fontSize: 12, fontWeight: 600, color: date ? '#1a1a1a' : C.slate }}>{date ? `${fmtDate(date)} · ${days != null ? relDays(days) : ''}` : '—'}</span>
                    <button onClick={() => { setDueDraft(date ?? ''); setEditingDue(ft); }} title="Override due date"
                      style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Pencil size={10} strokeWidth={2.25} />
                    </button>
                  </span>
                </div>
              );
            };
            return (
              <>
                {dueRow(isResidential ? 'Next Form A (24-mo)' : 'Next Form A (6-mo)', 'A', formADate, formA, !!overrideA)}
                {!isResidential && dueRow('Next Form D (12-mo)', 'D', formDDate, formD, !!overrideD)}
              </>
            );
          })()}
        </div>

        <div style={cardStyle}>
          {sectionHeader('Warranty', { label: 'View →', onClick: () => onTabChange('warranty') })}
          <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: tone.bg, color: tone.color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{tone.label}</span>
          <KV label="Start" value={fmtDate(charger.warranty_start_date) ?? '—'} muted={!charger.warranty_start_date} />
          <KV label="End"   value={fmtDate(charger.warranty_end_date)   ?? '—'} muted={!charger.warranty_end_date} />
        </div>
      </div>
    </div>
    </>
  );
}

// Quick-add an LTA Form A/D record (with optional invoice) from the timeline,
// without leaving the Details tab.
function AddLtaRecordModal({ charger, siteName, formType, intervalMonths, claimedBy, onClose, onSaved }: {
  charger: SiteCharger;
  siteName: string;
  formType: LtaFormType;
  intervalMonths: number;
  claimedBy: Map<number, string>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [periodN, setPeriodN] = useState<number | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingInvoice, setPendingInvoice] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const invoiceRef = useRef<HTMLInputElement>(null);
  const isPdf = (f: File) => !f.type || f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');

  const submit = async () => {
    setError(null);
    if (!pendingFile) { setError('Pick the form PDF first.'); return; }
    if (!date) { setError('Pick the inspection date first.'); return; }
    const todayStr = new Date().toISOString().slice(0, 10);
    if (date > todayStr) { setError('Inspection date can’t be in the future.'); return; }
    // A real inspection can't predate the charger existing.
    const floor = ltaExistFloor(charger);
    if (floor && date <= floor) { setError('Inspection date must be after the registration date.'); return; }
    setBusy(true);
    const friendly = computeLtaFilename(formType, charger.asset_tag, date, siteName);
    const path = `lta/${charger.id}/${crypto.randomUUID()}/${pathSafe(friendly)}`;
    const up = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(path, pendingFile, { contentType: pendingFile.type || 'application/pdf' });
    if (up.error) { setBusy(false); setError(up.error.message); return; }
    let invoice_path: string | null = null;
    let invoice_filename: string | null = null;
    if (pendingInvoice) {
      const ipath = `lta/${charger.id}/${crypto.randomUUID()}/invoice/${pathSafe(pendingInvoice.name)}`;
      const iup = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(ipath, pendingInvoice, { contentType: pendingInvoice.type || 'application/pdf' });
      if (iup.error) { setBusy(false); void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([path]); setError(iup.error.message); return; }
      invoice_path = ipath;
      invoice_filename = pendingInvoice.name;
    }
    const ins = await supabase.from('charger_lta_records').insert({
      charger_id: charger.id, form_type: formType, performed_at: date, period_n: periodN, storage_path: path,
      filename: computeLtaFilename(formType, charger.asset_tag, date, siteName), invoice_path, invoice_filename,
    });
    setBusy(false);
    if (ins.error) { void supabase.storage.from(CHARGER_FORMS_BUCKET).remove(invoice_path ? [path, invoice_path] : [path]); setError(ins.error.message); return; }
    await onSaved();
  };

  const picker = (file: File | null, ref: React.RefObject<HTMLInputElement>, onPick: (f: File) => void, onClear: (() => void) | null, chooseLabel: string, dashed: boolean) => (
    <>
      <input ref={ref} type="file" accept="application/pdf" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { if (!isPdf(f)) { setError('File must be a PDF.'); return; } setError(null); onPick(f); } }} />
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.seasalt, border: '1px solid #EBEBEB', borderRadius: 10, padding: '8px 10px' }}>
          <FileText size={14} strokeWidth={1.8} color={C.green} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
          <button type="button" onClick={() => ref.current?.click()} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Change</button>
          {onClear && <button type="button" onClick={onClear} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><X size={12} strokeWidth={2.5} /></button>}
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: `1px dashed ${dashed ? '#C8E6C9' : '#EBEBEB'}`, background: C.white, color: dashed ? C.green : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
          <Upload size={14} strokeWidth={2} /> {chooseLabel}
        </button>
      )}
    </>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 480, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Add Form {formType} — {charger.asset_tag}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>
        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Performed on</FieldLabel>
            <input type="date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle(), background: C.white }} />
          </div>
          <div>
            <FieldLabel>Counts as</FieldLabel>
            <LtaCyclePicker registration={ltaScheduleBase(charger, intervalMonths, formType)} intervalMonths={intervalMonths} date={date}
              value={periodN} disabled={busy} claimedBy={claimedBy} recordId={null} onChange={setPeriodN} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{`Form ${formType} PDF`} <span style={{ color: '#C0321A' }}>*</span></div>
          {picker(pendingFile, fileRef, setPendingFile, null, 'Choose PDF', true)}
        </div>
        <div>
          <FieldLabel>Invoice PDF (optional)</FieldLabel>
          {picker(pendingInvoice, invoiceRef, setPendingInvoice, () => setPendingInvoice(null), 'Choose invoice', false)}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy || !pendingFile || !date}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: (busy || !pendingFile || !date) ? '#A5D6A7' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: (busy || !pendingFile || !date) ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Saving…' : `Submit Form ${formType}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── LTA Inspection panel ─────────────────────────────────────────

type LtaFormType = 'A' | 'D';
type LetterForms = 'A' | 'D' | 'both';

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
  period_n: number | null;
}

interface LtaEmailCustomer { name: string; email: string | null; type?: CustomerType }

// Attach an invoice PDF to an existing LTA record (from the timeline, via popup).
function AddInvoiceModal({ record, onClose, onSaved }: {
  record: LtaRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const isPdf = (f: File) => !f.type || f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');

  const submit = async () => {
    if (!file) { setError('Pick the invoice PDF first.'); return; }
    setBusy(true);
    setError(null);
    const ipath = `lta/${record.charger_id}/${record.id}/invoice/${pathSafe(file.name)}`;
    const up = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(ipath, file, { contentType: file.type || 'application/pdf', upsert: true });
    if (up.error) { setBusy(false); setError(up.error.message); return; }
    const { error: err } = await supabase.from('charger_lta_records').update({ invoice_path: ipath, invoice_filename: file.name }).eq('id', record.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    await onSaved();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 440, maxWidth: 'calc(100vw - 24px)', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Add invoice — Form {record.form_type}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>
        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Invoice PDF <span style={{ color: '#C0321A' }}>*</span></div>
          <input ref={ref} type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { if (!isPdf(f)) { setError('File must be a PDF.'); return; } setError(null); setFile(f); } }} />
          {file ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.seasalt, border: '1px solid #EBEBEB', borderRadius: 10, padding: '8px 10px' }}>
              <FileText size={14} strokeWidth={1.8} color={C.green} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
              <button type="button" onClick={() => ref.current?.click()} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Change</button>
            </div>
          ) : (
            <button type="button" onClick={() => ref.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: '1px dashed #C8E6C9', background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
              <Upload size={14} strokeWidth={2} /> Choose invoice PDF
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy || !file}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: (busy || !file) ? '#A5D6A7' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: (busy || !file) ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Saving…' : 'Attach invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Upload the installation Form 1 PDF for a charger (from the timeline, via popup).
function AddForm1Modal({ charger, siteName, onClose, onSaved }: {
  charger: SiteCharger;
  siteName: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const isPdf = (f: File) => !f.type || f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');

  const submit = async () => {
    if (!file) { setError('Pick the Form 1 PDF first.'); return; }
    setBusy(true);
    setError(null);
    const friendly = computeForm1Filename(charger.asset_tag, charger.turn_on_date, siteName);
    const path = `form-1/${crypto.randomUUID()}/${pathSafe(friendly)}`;
    const up = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(path, file, { contentType: file.type || 'application/pdf' });
    if (up.error) { setBusy(false); setError(up.error.message); return; }
    if (charger.form_1_path) void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([charger.form_1_path]);
    const { error: err } = await supabase.from('site_chargers').update({ form_1_path: path, form_1_filename: friendly }).eq('id', charger.id);
    setBusy(false);
    if (err) { void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([path]); setError(err.message); return; }
    await onSaved();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 440, maxWidth: 'calc(100vw - 24px)', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Upload Form 1 — {charger.asset_tag}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>
        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Form 1 PDF <span style={{ color: '#C0321A' }}>*</span></div>
          <input ref={ref} type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { if (!isPdf(f)) { setError('File must be a PDF.'); return; } setError(null); setFile(f); } }} />
          {file ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.seasalt, border: '1px solid #EBEBEB', borderRadius: 10, padding: '8px 10px' }}>
              <FileText size={14} strokeWidth={1.8} color={C.green} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
              <button type="button" onClick={() => ref.current?.click()} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Change</button>
            </div>
          ) : (
            <button type="button" onClick={() => ref.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: '1px dashed #C8E6C9', background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
              <Upload size={14} strokeWidth={2} /> Choose Form 1 PDF
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy || !file}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: (busy || !file) ? '#A5D6A7' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: (busy || !file) ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Uploading…' : 'Upload Form 1'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Lightweight LTA record used to flag overdue inspections / missing invoices per site.
interface SiteLtaRow { id: string; charger_id: string; form_type: LtaFormType; performed_at: string; invoice_path: string | null; period_n: number | null; }

function LtaInspectionPanel({ charger, siteName, canEdit, canDelete, customer }: {
  charger: SiteCharger;
  siteName: string;
  canEdit: boolean;
  canDelete: boolean;
  customer: LtaEmailCustomer;
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
      <LtaSection formType="A" intervalMonths={isResidential ? 24 : 6} title={isResidential ? 'Form A · 24-month inspection' : 'Form A · 6-month inspection'}  records={formA} charger={charger} siteName={siteName} canEdit={canEdit} canDelete={canDelete} customer={customer} loading={loading} onChanged={refresh} />
      {!isResidential && (
        <LtaSection formType="D" intervalMonths={12} title="Form D · 12-month inspection" records={formD} charger={charger} siteName={siteName} canEdit={canEdit} canDelete={canDelete} customer={customer} loading={loading} onChanged={refresh} />
      )}
    </div>
  );
}

function ContractCard({ years: years0, startDate: start0, turnOn, canEdit, isResidential, chargers, contractPath, contractFilename, onSave }: {
  years: number | null;
  startDate: string | null;
  turnOn: string | null;
  canEdit: boolean;
  isResidential: boolean;
  chargers: { id: string; label: string; covered: boolean }[];
  contractPath: string | null;
  contractFilename: string | null;
  onSave: (years: number | null, startDate: string | null, coveredIds: string[], newFile: File | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [years, setYears] = useState<number | null>(years0);
  const [startDate, setStartDate] = useState<string | null>(start0);
  const [active, setActive] = useState<boolean>(!!years0 && years0 > 0);
  const [covered, setCovered] = useState<Set<string>>(() => new Set(chargers.filter((c) => c.covered).map((c) => c.id)));
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewContract = async () => {
    if (!contractPath) return;
    const { data } = await supabase.storage.from(CHARGER_FORMS_BUCKET).createSignedUrl(contractPath, 60, { download: contractFilename ?? 'contract.pdf' });
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };
  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.type && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) { setError('Contract must be a PDF.'); return; }
    setError(null);
    setPendingFile(f);
  };

  const coveredKey = chargers.filter((c) => c.covered).map((c) => c.id).sort().join(',');
  useEffect(() => {
    setYears(years0);
    setStartDate(start0);
    setActive(!!years0 && years0 > 0);
    setCovered(new Set(chargers.filter((c) => c.covered).map((c) => c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years0, start0, coveredKey]);

  const storedYears = years0 ?? 0;
  const storedStart = start0 ?? turnOn;
  const endDate     = storedYears > 0 && storedStart ? addYears(storedStart, storedYears) : null;
  const daysLeft    = endDate ? daysFromToday(endDate) : null;
  const isActive    = storedYears > 0 && (daysLeft === null || daysLeft >= 0);
  const isExpired   = storedYears > 0 && daysLeft !== null && daysLeft < 0;

  // Auto-clear an expired contract so the UI cleanly returns to "No contract".
  const autoClearedRef = useRef(false);
  useEffect(() => { autoClearedRef.current = false; }, [years0, start0]);
  useEffect(() => {
    if (autoClearedRef.current || !isExpired) return;
    autoClearedRef.current = true;
    void onSave(null, null, [], null);
  }, [isExpired, onSave]);

  const onToggleActive = (next: boolean) => {
    setActive(next);
    if (next) {
      if (!years) setYears(3);
      if (!startDate) setStartDate(new Date().toISOString().slice(0, 10));
      // Default a fresh contract to covering every charger.
      if (covered.size === 0) setCovered(new Set(chargers.map((c) => c.id)));
    }
  };
  const toggleCovered = (id: string) =>
    setCovered((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const startEdit = () => {
    setYears(years0);
    setStartDate(start0);
    setActive(!!years0 && years0 > 0);
    setCovered(new Set(chargers.filter((c) => c.covered).map((c) => c.id)));
    setPendingFile(null);
    setError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setPendingFile(null);
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    const finalYears = active && years && years > 0 ? Math.max(1, Math.min(20, Math.floor(years))) : null;
    const finalStart = finalYears ? (startDate || new Date().toISOString().slice(0, 10)) : null;
    const coveredIds = finalYears ? chargers.filter((c) => covered.has(c.id)).map((c) => c.id) : [];
    // The contract document is compulsory when a contract is active.
    if (finalYears && !pendingFile && !contractPath) { setError('Attach the signed contract PDF.'); return; }
    setSaving(true);
    try {
      await onSave(finalYears, finalStart, coveredIds, pendingFile);
    } catch (e) {
      setSaving(false);
      setError((e as Error).message);
      return;
    }
    setSaving(false);
    setEditing(false);
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
          {active && (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                <FieldLabel>Chargers under contract</FieldLabel>
                {chargers.length > 0 && (
                  <button type="button" onClick={() => setCovered(covered.size === chargers.length ? new Set() : new Set(chargers.map((c) => c.id)))}
                    style={{ padding: 0, border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    {covered.size === chargers.length ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>
              {chargers.length === 0 ? (
                <div style={{ fontSize: 12, color: C.slate, fontStyle: 'italic' }}>No chargers at this site yet.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                  {chargers.map((c) => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '8px 10px', cursor: 'pointer', minWidth: 0 }}>
                      <input type="checkbox" checked={covered.has(c.id)} onChange={() => toggleCovered(c.id)}
                        style={{ width: 16, height: 16, accentColor: C.green, cursor: 'pointer', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {active && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Contract PDF <span style={{ color: '#C0321A' }}>*</span></div>
              <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={pickFile} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '8px 10px' }}>
                <FileText size={14} strokeWidth={1.8} color={pendingFile || contractFilename ? C.green : C.slate} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: pendingFile || contractFilename ? '#1a1a1a' : C.slate, fontStyle: pendingFile || contractFilename ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pendingFile ? pendingFile.name : contractFilename ? contractFilename : 'No contract attached'}
                </span>
                {pendingFile && <span style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>New</span>}
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  {pendingFile || contractFilename ? 'Replace' : 'Choose PDF'}
                </button>
              </div>
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
            {(() => {
              const blocked = saving || (active && (!years || years <= 0)) || (active && !pendingFile && !contractPath);
              return (
                <button onClick={() => void handleSave()} disabled={blocked}
                  style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: blocked ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: blocked ? 'default' : 'pointer' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              );
            })()}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          {isActive ? (
            <>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#E4F3E3', color: '#1B512D', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Active · {storedYears} yr{storedYears === 1 ? '' : 's'}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: C.honeydew, color: C.green, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {chargers.filter((c) => c.covered).length}/{chargers.length} chargers
              </span>
              <span style={{ fontSize: 12, color: C.slate }}>
                {endDate ? <>Ends <strong style={{ color: '#1a1a1a' }}>{fmtDate(endDate)}</strong>{daysLeft !== null && <> · {relDays(daysLeft)} left</>}.</> : 'Contract active.'}
              </span>
              {contractPath && (
                <button onClick={() => void viewContract()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  <FileText size={11} strokeWidth={2.25} /> View contract
                </button>
              )}
            </>
          ) : (
            <>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: '#FFF0E0', color: '#B45309', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                No contract
              </span>
              <span style={{ fontSize: 12, color: C.slate }}>
                {canEdit ? 'Click Edit to mark this site as covered by an LTA inspection contract.' : 'No active LTA inspection contract.'}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LtaSection({ formType, intervalMonths, title, records, charger, siteName, canEdit, canDelete, customer, loading, onChanged }: {
  formType: LtaFormType;
  intervalMonths: number;
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
  const [periodN, setPeriodN] = useState<number | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingInvoice, setPendingInvoice] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const invoiceRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setAdding(false);
    setPendingFile(null);
    setPendingInvoice(null);
    setDate(new Date().toISOString().slice(0, 10));
    setPeriodN(null);
    setError(null);
  };

  const isPdf = (file: File) => !file.type || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const handleFileSelected = (file: File) => {
    if (!isPdf(file)) { setError('Upload must be a PDF.'); return; }
    setError(null);
    setPendingFile(file);
  };
  const handleInvoiceSelected = (file: File) => {
    if (!isPdf(file)) { setError('Invoice must be a PDF.'); return; }
    setError(null);
    setPendingInvoice(file);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!pendingFile) { setError('Pick the form PDF first.'); return; }
    if (!date)        { setError('Pick the inspection date first.'); return; }
    setBusy(true);
    const friendly = computeLtaFilename(formType, charger.asset_tag, date, siteName);
    const path = `lta/${charger.id}/${crypto.randomUUID()}/${pathSafe(friendly)}`;
    const up = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(path, pendingFile, { contentType: pendingFile.type || 'application/pdf' });
    if (up.error) { setBusy(false); setError(up.error.message); return; }

    // Optional invoice — uploaded alongside the form.
    let invoice_path: string | null = null;
    let invoice_filename: string | null = null;
    if (pendingInvoice) {
      const ipath = `lta/${charger.id}/${crypto.randomUUID()}/invoice/${pathSafe(pendingInvoice.name)}`;
      const iup = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(ipath, pendingInvoice, { contentType: pendingInvoice.type || 'application/pdf' });
      if (iup.error) { setBusy(false); void supabase.storage.from(CHARGER_FORMS_BUCKET).remove([path]); setError(iup.error.message); return; }
      invoice_path = ipath;
      invoice_filename = pendingInvoice.name;
    }

    const ins = await supabase.from('charger_lta_records').insert({
      charger_id: charger.id,
      form_type:  formType,
      performed_at: date,
      period_n: periodN,
      storage_path: path,
      filename: computeLtaFilename(formType, charger.asset_tag, date, siteName),
      invoice_path,
      invoice_filename,
    });
    setBusy(false);
    if (ins.error) {
      void supabase.storage.from(CHARGER_FORMS_BUCKET).remove(invoice_path ? [path, invoice_path] : [path]);
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

  // Which cycle each logged inspection currently satisfies — a manual mapping
  // wins its cycle, the rest fall where their date lands.
  const registration = ltaScheduleBase(charger, intervalMonths, formType);
  const { periodOf } = ltaAssignPeriods(registration, intervalMonths, records.map(toPerformed));
  const claimedBy = new Map<number, string>();
  for (const [id, n] of periodOf) claimedBy.set(n, id);

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
          <div style={{ display: 'grid', gridTemplateColumns: '160px 190px 1fr 1fr', gap: 10, alignItems: 'end' }}>
            <div>
              <FieldLabel>Performed on</FieldLabel>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} style={{ ...inputStyle(), background: C.white }} />
            </div>
            <div>
              <FieldLabel>Counts as</FieldLabel>
              <LtaCyclePicker registration={registration} intervalMonths={intervalMonths} date={date}
                value={periodN} disabled={busy} claimedBy={claimedBy} recordId={null} onChange={setPeriodN} />
            </div>
            <div>
              <FieldLabel>{`Form ${formType} PDF`}</FieldLabel>
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
            <div>
              <FieldLabel>Invoice PDF (optional)</FieldLabel>
              {pendingInvoice ? (
                <div style={{ background: C.seasalt, border: '1px solid #EBEBEB', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={16} strokeWidth={1.8} color={C.green} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingInvoice.name}</div>
                    <div style={{ fontSize: 10, color: C.slate, marginTop: 1 }}>{fmtSize(pendingInvoice.size)} · ready to upload</div>
                  </div>
                  <button type="button" onClick={() => setPendingInvoice(null)} disabled={busy}
                    style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: busy ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <X size={12} strokeWidth={2.5} />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => invoiceRef.current?.click()} disabled={busy}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: '1px dashed #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
                  <Upload size={14} strokeWidth={2} /> Choose invoice
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
          <input ref={invoiceRef} type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleInvoiceSelected(file);
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
            <LtaRecordRow key={r.id} record={r} displayName={computeLtaFilename(r.form_type, charger.asset_tag, r.performed_at, siteName)} charger={charger} siteName={siteName} customer={customer} canEdit={canEdit} canDelete={canDelete} onChanged={onChanged}
              registration={registration} intervalMonths={intervalMonths} assignedPeriod={periodOf.get(r.id) ?? null} claimedBy={claimedBy} />
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

// Which scheduled cycle an inspection counts for. Defaults to Auto (the cycle
// the date falls in); pick a cycle explicitly when an inspection ran late and
// should still close the previous one. Cycles already taken by another record
// are shown but not selectable.
function LtaCyclePicker({ registration, intervalMonths, date, value, disabled, claimedBy, recordId, compact, onChange }: {
  registration: string | null;
  intervalMonths: number;
  date: string;
  value: number | null;
  disabled?: boolean;
  claimedBy: Map<number, string>;
  recordId: string | null;
  compact?: boolean;
  onChange: (n: number | null) => void;
}) {
  const auto = ltaAutoPeriod(registration, intervalMonths, date);
  const options = ltaCycleOptions(registration, intervalMonths, value ?? auto ?? 1);
  // The date's own cycle is already closed by another record — on Auto this
  // inspection would count for nothing, so flag it rather than look settled.
  const autoTaken = auto != null && claimedBy.has(auto) && claimedBy.get(auto) !== recordId;
  const warn = value == null && (auto == null || autoTaken);
  const tone = warn ? { fg: '#B07D00', bg: '#FFF8E1', border: '#FFF8E1' }
    : value ? { fg: C.green, bg: C.honeydew, border: '#EBEBEB' }
    : { fg: C.slate, bg: C.white, border: '#EBEBEB' };
  const base: React.CSSProperties = compact
    ? { padding: '4px 8px', borderRadius: 6, border: `1px solid ${tone.border}`, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, color: tone.fg, background: tone.bg, outline: 'none', cursor: disabled ? 'default' : 'pointer' }
    : { ...inputStyle(), background: tone.bg, color: tone.fg, fontWeight: 700, cursor: disabled ? 'default' : 'pointer' };

  if (!registration) {
    return <div style={{ fontSize: 11, color: C.slate, fontStyle: 'italic', padding: compact ? 0 : '9px 0' }}>Set a registration date first</div>;
  }
  return (
    <select value={value ?? ''} disabled={disabled}
      title={value ? `Manually mapped to cycle ${value}`
        : autoTaken ? `Cycle ${auto} is already closed by another record — this one counts for no cycle. Pick one explicitly.`
        : `Auto — cycle ${auto ?? '—'} from the date performed`}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} style={base}>
      <option value="">{auto ? `Auto · cycle ${auto}${autoTaken ? ' · taken' : ''}` : 'Auto · no cycle'}</option>
      {options.map((o) => {
        const taken = claimedBy.get(o.n);
        const mine = taken && taken === recordId;
        return (
          <option key={o.n} value={o.n} disabled={!!taken && !mine}>
            Cycle {o.n} · due {fmtDate(o.due)}{taken && !mine ? ' · taken' : ''}
          </option>
        );
      })}
    </select>
  );
}

function LtaRecordRow({ record, displayName, charger, siteName, customer, canEdit, canDelete, onChanged, registration, intervalMonths, assignedPeriod, claimedBy }: {
  record: LtaRecord;
  displayName: string;
  charger: SiteCharger;
  siteName: string;
  customer: LtaEmailCustomer;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
  registration: string | null;
  intervalMonths: number;
  assignedPeriod: number | null;
  claimedBy: Map<number, string>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [remapping, setRemapping] = useState(false);
  const invoiceInputRef = useRef<HTMLInputElement>(null);

  const remapCycle = async (n: number | null) => {
    setRemapping(true);
    const { error } = await supabase.from('charger_lta_records').update({ period_n: n }).eq('id', record.id);
    setRemapping(false);
    if (error) { alert(`Could not change the cycle: ${error.message}`); return; }
    await onChanged();
  };

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
        {canEdit ? (
          <LtaCyclePicker compact registration={registration} intervalMonths={intervalMonths} date={record.performed_at}
            value={record.period_n} disabled={remapping} claimedBy={claimedBy} recordId={record.id} onChange={(n) => void remapCycle(n)} />
        ) : (
          <span style={{ fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', padding: '3px 8px', borderRadius: 6, ...(assignedPeriod
            ? { color: C.slate, background: C.seasalt, border: '1px solid #EBEBEB' }
            : { color: '#B07D00', background: '#FFF8E1', border: '1px solid #FFF8E1' }) }}>
            {assignedPeriod ? `Cycle ${assignedPeriod}` : 'No cycle'}
          </span>
        )}
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


// A form cycle is overdue once the charger is past its first due date and has no
// inspection within the latest cadence window. `latestPerformedAt` is the most
// recent inspection of that form type (or null if none).
// A manual next-due override applies only while no further inspection has been
// logged since it was set (overrideCount === current inspection count).
function resolveDueOverride(overrideDate: string | null, overrideCount: number | null, count: number): string | null {
  return overrideDate && overrideCount === count ? overrideDate : null;
}

// One logged inspection. `period` is the manual cycle mapping (charger_lta_records
// .period_n) — null means "work it out from the date".
export interface LtaPerformed { key: string; date: string; period: number | null }

interface LtaPeriod { n: number; due: string; performedAt: string | null }
interface LtaScheduleResult {
  periods: LtaPeriod[];  // chronological (n ascending): every period up to & incl. the latest performed / past-due one
  nextDue: string | null; // earliest scheduled date ≥ today with no inspection in its window (forward-looking)
  overdueCount: number;    // past periods (due < today) with no inspection performed
}

// The cycle a date falls into on its own (the window match), for labelling the
// "Auto" choice in the cycle picker.
function ltaAutoPeriod(registration: string | null, intervalMonths: number, date: string): number | null {
  if (!registration || !date) return null;
  const reg = new Date(registration + 'T00:00:00');
  const d = new Date(date + 'T00:00:00');
  if (isNaN(reg.getTime()) || isNaN(d.getTime()) || d <= reg) return null;
  for (let n = 1; n <= 600; n++) if (d <= ltaPeriodEnd(registration, intervalMonths, n)) return n;
  return null;
}

// A window of cycles around `around`, each with its scheduled due date — the
// options offered when re-mapping an inspection to a different cycle.
function ltaCycleOptions(registration: string | null, intervalMonths: number, around: number): { n: number; due: string }[] {
  if (!registration) return [];
  const from = Math.max(1, around - 3);
  const out: { n: number; due: string }[] = [];
  for (let n = from; n <= around + 3; n++) out.push({ n, due: toYmd(ltaPeriodEnd(registration, intervalMonths, n)) });
  return out;
}

const toPerformed = (r: { id: string; performed_at: string; period_n: number | null }): LtaPerformed =>
  ({ key: r.id, date: r.performed_at, period: r.period_n });

// LTA inspections alternate every 6 months: Form A, then Form A & D, then A, …
// The letter's expiry date is cycle 1's due date. Form A is always due on it.
// Form D lands on it only when the letter is an "A & D" inspection; if the letter
// is Form-A-only, Form D falls on the NEXT inspection, one Form-A interval later.
const FORM_A_INTERVAL = 6; // commercial Form A cadence (months); Form D only exists commercial
function ltaLetterCycle1(c: { lta_letter_date?: string | null; lta_letter_forms?: LetterForms | null }, ft: LtaFormType): string | null {
  const letter = c.lta_letter_date;
  if (!letter) return null;
  if (ft === 'A') return letter;
  // Form D:
  if ((c.lta_letter_forms ?? 'both') === 'both') return letter;
  const d = new Date(letter + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + FORM_A_INTERVAL);
  return toYmd(d);
}

// The base the schedule counts from: periodEnd(n) = base + n × interval, so cycle
// 1's due date is base + interval. With a letter, cycle 1's due date is fixed
// (ltaLetterCycle1) so we back the base off one interval to land on it. Without a
// letter, anchor on registration (then procurement) — first form one interval later.
function ltaScheduleBase(c: { lta_letter_date?: string | null; lta_letter_forms?: LetterForms | null; turn_on_date: string | null; procurement_date: string | null }, intervalMonths: number, ft: LtaFormType): string | null {
  const cycle1 = ltaLetterCycle1(c, ft);
  if (cycle1) {
    const d = new Date(cycle1 + 'T00:00:00');
    if (!isNaN(d.getTime())) { d.setMonth(d.getMonth() - intervalMonths); return toYmd(d); }
  }
  return c.turn_on_date ?? c.procurement_date ?? null;
}

// The earliest date a real inspection can have — when the charger physically
// exists. Used to validate new records (not the letter date, which is only a
// scheduling due date; an inspection may legitimately predate it).
function ltaExistFloor(c: { turn_on_date: string | null; procurement_date: string | null }): string | null {
  return c.turn_on_date ?? c.procurement_date;
}

// Build the LTA schedule for one form type. The schedule is fixed at registration +
// n × interval. An inspection performed within a period's window (D_{n-1}, D_n] marks
// that period performed (window match — so a late inspection lands in the period it
// actually falls in, leaving genuinely missed periods flagged overdue). The headline
// `nextDue` is forward-looking: the next scheduled date from today, NOT a stale
// overdue one — those live in `periods`/`overdueCount` for the timeline audit.
function ltaPeriodEnd(registration: string, intervalMonths: number, n: number): Date {
  const d = new Date(registration + 'T00:00:00');
  d.setMonth(d.getMonth() + n * intervalMonths);
  return d;
}

// Decide which cycle each inspection satisfies. A record with an explicit
// `period` claims that cycle outright — that's how a late inspection still
// counts for the cycle it was meant for. Everything else window-matches by date.
// First claim wins a cycle; a loser falls back to auto-matching.
export function ltaAssignPeriods(registration: string | null, intervalMonths: number, performed: LtaPerformed[]):
  { byPeriod: Map<number, string>; periodOf: Map<string, number> } {
  const byPeriod = new Map<number, string>();
  const periodOf = new Map<string, number>();
  if (!registration) return { byPeriod, periodOf };
  const reg = new Date(registration + 'T00:00:00');
  if (isNaN(reg.getTime())) return { byPeriod, periodOf };

  const items = performed
    .map((p) => ({ ...p, d: new Date(p.date + 'T00:00:00') }))
    .filter((x) => !isNaN(x.d.getTime()) && x.d > reg)
    .sort((a, b) => a.d.getTime() - b.d.getTime());

  for (const x of items) {
    if (x.period && x.period > 0 && !byPeriod.has(x.period)) {
      byPeriod.set(x.period, toYmd(x.d));
      periodOf.set(x.key, x.period);
    }
  }
  for (const x of items) {
    if (periodOf.has(x.key)) continue;
    // Cycle whose due date is closest to when it was performed, among those not
    // already taken. Search a window around the arithmetically-nearest cycle.
    const monthsFromBase = (x.d.getFullYear() - reg.getFullYear()) * 12 + (x.d.getMonth() - reg.getMonth());
    const nIdeal = Math.max(1, Math.round(monthsFromBase / intervalMonths));
    let best = -1, bestDist = Infinity;
    for (let n = Math.max(1, nIdeal - 6); n <= nIdeal + 6; n++) {
      if (byPeriod.has(n)) continue;
      const dist = Math.abs(ltaPeriodEnd(registration, intervalMonths, n).getTime() - x.d.getTime());
      if (dist < bestDist) { bestDist = dist; best = n; }
    }
    if (best > 0) { byPeriod.set(best, toYmd(x.d)); periodOf.set(x.key, best); }
  }
  return { byPeriod, periodOf };
}

function ltaSchedule(registration: string | null, intervalMonths: number, performed: LtaPerformed[]): LtaScheduleResult {
  const empty: LtaScheduleResult = { periods: [], nextDue: null, overdueCount: 0 };
  if (!registration) return empty;
  const reg = new Date(registration + 'T00:00:00');
  if (isNaN(reg.getTime())) return empty;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const periodEnd = (n: number) => ltaPeriodEnd(registration, intervalMonths, n);

  const { byPeriod: performedByPeriod } = ltaAssignPeriods(registration, intervalMonths, performed);

  const periods: LtaPeriod[] = [];
  let nextDue: string | null = null;
  let overdueCount = 0;
  for (let n = 1; n <= 600; n++) {
    const end = periodEnd(n);
    const due = toYmd(end);
    const performedAt = performedByPeriod.get(n) ?? null;
    if (end < today) {
      periods.push({ n, due, performedAt });
      if (!performedAt) overdueCount++;
    } else if (!performedAt) {
      nextDue = due;
      break;
    } else {
      periods.push({ n, due, performedAt }); // performed early — list it and keep scanning for the next gap
    }
  }
  return { periods, nextDue, overdueCount };
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

// Format a Date as YYYY-MM-DD using LOCAL components (toISOString would shift the
// day backwards in positive-offset timezones, e.g. UTC+8).
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The next upcoming inspection date. The first inspection is due `intervalMonths`
// after turn-on (not on the turn-on day itself), then it repeats every interval.
function nextCycleDate(turnOn: string | null, intervalMonths: number): string | null {
  if (!turnOn) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(turnOn + 'T00:00:00');
  if (isNaN(next.getTime())) return null;
  next.setMonth(next.getMonth() + intervalMonths);
  while (next < today) next.setMonth(next.getMonth() + intervalMonths);
  return toYmd(next);
}

function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setFullYear(d.getFullYear() + years);
  return toYmd(d);
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
  registration_code: string | null;
  procurement_date: string | null;
  turn_on_date: string | null;
  lta_letter_date: string | null;
  lta_letter_forms: LetterForms | null;
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
    asset_tag: '', brand_model: null, registration_code: null, procurement_date: null,
    turn_on_date: null, lta_letter_date: null, lta_letter_forms: null, form_a_next_date: null, form_d_next_date: null,
    warranty_start_date: null, warranty_end_date: null,
    form_1_path: null, form_1_filename: null,
    notes: null,
  };
}

function ChargerModal({ title, initial, siteName, isResidential, brandModels, canDelete, canManageBrandModels, onSave, onDelete, onBrandModelsChanged, onClose, pdfUrl, pdfName }: {
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
  // When set, the modal shows the PDF (e.g. the source invoice) in a split pane on the
  // left so the user can read line items while filling the charger form on the right.
  pdfUrl?: string;
  pdfName?: string;
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
    const letter = form.lta_letter_date || null;
    // Residential has no Form D, so a letter can only be about Form A there.
    const letterForms: LetterForms | null = letter ? (isResidential ? 'A' : (form.lta_letter_forms ?? 'both')) : null;
    // Next Form A/D from the schedule BASE (see ltaScheduleBase): when the letter
    // covers a form, cycle 1's due date IS the letter date; otherwise it's one
    // interval after registration/procurement.
    const forSchedule = { ...form, lta_letter_date: letter, lta_letter_forms: letterForms };
    await onSave({
      asset_tag:               form.asset_tag.trim(),
      brand_model:             form.brand_model && form.brand_model.trim() ? form.brand_model.trim() : null,
      registration_code:       form.registration_code && form.registration_code.trim() ? form.registration_code.trim() : null,
      procurement_date:        form.procurement_date || null,
      turn_on_date:            turnOn,
      lta_letter_date:         letter,
      lta_letter_forms:        letterForms,
      form_a_next_date:        nextCycleDate(ltaScheduleBase(forSchedule, isResidential ? 24 : 6, 'A'), isResidential ? 24 : 6),
      form_d_next_date:        isResidential ? null : nextCycleDate(ltaScheduleBase(forSchedule, 12, 'D'), 12),
      // Warranty starts on the registration date; the end is editable (defaults to start + years).
      warranty_start_date:     turnOn ? turnOn : null,
      warranty_end_date:       form.warranty_end_date || null,
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

  // Next Form A/D (auto) preview — mirrors the real schedule (letter date = the
  // first due date, else one interval after registration/procurement).
  const nextAuto = (interval: number, ft: LtaFormType) => nextCycleDate(ltaScheduleBase(form, interval, ft), interval);
  const canSave = form.asset_tag.trim().length > 0 && !saving;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ display: 'flex', gap: pdfUrl ? 16 : 0, alignItems: 'stretch', justifyContent: 'center', width: pdfUrl ? 'min(1180px, 100%)' : 'auto', maxWidth: '100%', height: pdfUrl ? '90vh' : 'auto' }}>
      {pdfUrl && (
        <div style={{ flex: 1, minWidth: 0, background: '#525659', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.18)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: C.white, borderBottom: '1px solid #EBEBEB' }}>
            <FileText size={14} strokeWidth={1.8} color={C.green} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pdfName ?? 'Invoice'}</span>
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: C.green, textDecoration: 'none', whiteSpace: 'nowrap' }}>Open ↗</a>
          </div>
          <iframe src={pdfUrl} title={pdfName ?? 'Invoice'} style={{ flex: 1, width: '100%', border: 'none', display: 'block' }} />
        </div>
      )}
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: pdfUrl ? 560 : 580, flexShrink: 0, maxWidth: '100%', maxHeight: pdfUrl ? '100%' : '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
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
            <FieldLabel>Registration Code</FieldLabel>
            <input value={form.registration_code ?? ''} onChange={(e) => set('registration_code', e.target.value || null)} placeholder="e.g. REG-2026-001" style={{ ...inputStyle(), background: C.white }} />
          </div>
          <div>
            <FieldLabel>Procurement Date</FieldLabel>
            <input type="date" value={form.procurement_date ?? ''} onChange={(e) => set('procurement_date', e.target.value || null)} style={{ ...inputStyle(), background: C.white }} />
            <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>When the charger was procured — the first step in its lifecycle.</div>
          </div>
          <div>
            <FieldLabel>Registration Date</FieldLabel>
            <input type="date" value={form.turn_on_date ?? ''}
              onChange={(e) => {
                const v = e.target.value || null;
                // Refresh the default warranty end (start + years) when the date changes.
                setForm((f) => ({ ...f, turn_on_date: v, warranty_end_date: v && warrantyYears ? addYears(v, warrantyYears) : f.warranty_end_date }));
              }}
              style={{ ...inputStyle(), background: C.white }} />
            <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>
              {isResidential
                ? <>Residential chargers need only <strong>Form A every 24 months</strong> — no Form D. The system always shows the <strong>next upcoming</strong> date.</>
                : <>Form A repeats every <strong>6 months</strong>, Form D every <strong>12 months</strong>. The system always shows the <strong>next upcoming</strong> date so cold calls stay on track.</>}
            </div>
          </div>
          <div>
            <FieldLabel>LTA Inspection Letter Date</FieldLabel>
            <input type="date" value={form.lta_letter_date ?? ''}
              onChange={(e) => {
                const v = e.target.value || null;
                // Default the letter to both forms when first set; clear the
                // choice when the date is removed.
                setForm((f) => ({ ...f, lta_letter_date: v, lta_letter_forms: v ? (f.lta_letter_forms ?? (isResidential ? 'A' : 'both')) : null }));
              }}
              style={{ ...inputStyle(), background: C.white }} />
            <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>
              The <strong>expiry date</strong> on LTA's inspection letter — the date the inspection must be performed by. <strong>When set, this is the due date of the form(s) it covers</strong> (below), overriding the registration schedule. Leave blank to schedule from the registration date.
            </div>
          </div>
          {form.lta_letter_date && !isResidential && (
            <div>
              <FieldLabel>This inspection is</FieldLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                {([['A', 'Form A'], ['both', 'Form A & D']] as const).map(([val, label]) => {
                  const on = (form.lta_letter_forms ?? 'both') === val;
                  return (
                    <button key={val} type="button" onClick={() => set('lta_letter_forms', val)}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: `1px solid ${on ? C.green : '#EBEBEB'}`, background: on ? C.green : C.white, color: on ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>
                Inspections alternate every 6 months. The next one is auto-calculated from the letter date: <strong>{(form.lta_letter_forms ?? 'both') === 'A' ? 'Form A now → Form A & D in 6 months' : 'Form A & D now → Form A in 6 months'}</strong>.
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <ReadOnlyField label="Next Form A (auto)" value={fmtDate(nextAuto(isResidential ? 24 : 6, 'A'))}  placeholder="Set a letter, registration or procurement date" />
            {!isResidential && (
              <ReadOnlyField label="Next Form D (auto)" value={fmtDate(nextAuto(12, 'D'))} placeholder="Set a letter, registration or procurement date" />
            )}
          </div>
          {form.lta_letter_date && (
            <div style={{ fontSize: 11, fontWeight: 600, color: C.green, background: C.honeydew, borderRadius: 8, padding: '7px 10px', lineHeight: 1.5 }}>
              {(() => {
                const f = isResidential ? 'A' : (form.lta_letter_forms ?? 'both');
                const which = f === 'both' ? 'Form A & D' : 'Form A';
                return <>{which} due on the LTA letter date ({fmtDate(form.lta_letter_date)}); later inspections auto-follow the 6-month alternation.</>;
              })()}
            </div>
          )}
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
                  const n = v === '' ? null : Math.max(0, Math.min(20, parseInt(v, 10) || 0));
                  setWarrantyYears(n);
                  // Default the end date from registration + years (still editable below).
                  setForm((f) => ({ ...f, warranty_end_date: f.turn_on_date && n ? addYears(f.turn_on_date, n) : f.warranty_end_date }));
                }}
                placeholder="e.g. 2"
                style={{ ...inputStyle(), background: C.white }} />
            </div>
            <div>
              <FieldLabel>Ends on</FieldLabel>
              <input type="date" value={form.warranty_end_date ?? ''} onChange={(e) => set('warranty_end_date', e.target.value || null)}
                style={{ ...inputStyle(), background: C.white }} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5 }}>
            Warranty starts on the registration date. The end date defaults to the registration date plus the warranty years — adjust it directly if needed.
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
