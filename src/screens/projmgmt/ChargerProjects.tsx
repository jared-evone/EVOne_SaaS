import { useEffect, useRef, useState } from 'react';
import { C } from '../../theme';
import { KPICard } from '../../components/KPICard';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../lib/useIsMobile';
import { SearchSelect } from '../../components/SearchSelect';
import { usePermissions } from '../../permissions';
import { Search, Plus, Trash2, GanttChartSquare, ListChecks, MapPin, CalendarDays, ChevronRight, ArrowLeft, Pencil, FileText, Upload, Paperclip, ChevronUp, ChevronDown, StickyNote } from 'lucide-react';

// ── Model ─────────────────────────────────────────────────────────
// A charger-build project: from a closed sale through to a commissioned,
// handed-over site. Each project owns its OWN lifecycle (stages differ by job),
// and documents are tagged to a stage for review. Stored one-row-per-project as
// a jsonb `data` blob (same pattern as TSD work orders).

const DOC_BUCKET = 'charger-project-docs';

interface LifecycleStage { key: string; label: string; }

type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
const STATUS_META: Record<TaskStatus, { label: string; bg: string; color: string }> = {
  pending:     { label: 'Not started', bg: '#F3F3F3', color: '#767B77' },
  in_progress: { label: 'In progress', bg: '#FFF8E1', color: '#B07D00' },
  done:        { label: 'Done',        bg: '#E4F3E3', color: '#1B512D' },
  blocked:     { label: 'Blocked',     bg: '#FDEAEA', color: '#C0321A' },
};
// A checklist is grouped into sections, each holding dated, status-tracked tasks.
interface TaskFile { id: string; name: string; path: string; uploadedAt: string; size?: number; }

// A dated note on a project — a site visit, a call, a blocker — with its own
// attachments (photos, letters, approvals).
interface ProjectNote { id: string; date: string; body: string; author: string; files: TaskFile[]; createdAt: string; }
// Sub-steps of a task: date + status only, no attachments.
interface SubTask { id: string; label: string; date: string | null; status: TaskStatus; }
interface ChecklistTask { id: string; label: string; date: string | null; status: TaskStatus; files?: TaskFile[]; subtasks?: SubTask[]; }
interface ChecklistSection { id: string; title: string; items: ChecklistTask[]; }

// A task with sub-tasks is a roll-up: it can't be marked Done while any of its
// sub-tasks is still outstanding.
const subsOf = (t: ChecklistTask) => t.subtasks ?? [];
const subsDoneCount = (t: ChecklistTask) => subsOf(t).filter((x) => x.status === 'done').length;
const canCompleteTask = (t: ChecklistTask) => subsOf(t).every((x) => x.status === 'done');
// A reusable checklist for a type of project (AC install, DC fast charger, …).
// A template is a *project type*: the lifecycle timeline AND the build checklist
// that go together for that kind of job.
interface ChecklistTemplate { id: string; name: string; stages: LifecycleStage[]; sections: ChecklistSection[]; }

const cloneStages = (st: LifecycleStage[] | undefined): LifecycleStage[] =>
  (st?.length ? st : DEFAULT_STAGES).map((x) => ({ key: rid(), label: x.label }));

// Fresh ids + cleared dates/status, so applying a template never carries another
// project's progress across.
const cloneSections = (secs: ChecklistSection[]): ChecklistSection[] =>
  secs.map((sec) => ({
    id: rid(),
    title: sec.title,
    items: (sec.items ?? []).map((t) => ({
      id: rid(), label: t.label, date: null, status: 'pending' as TaskStatus,
      subtasks: (t.subtasks ?? []).map((x) => ({ id: rid(), label: x.label, date: null, status: 'pending' as TaskStatus })),
    })),
  }));
interface ProjectDoc { id: string; name: string; path: string; stageKey: string; uploadedAt: string; size?: number; }

export interface BuildProject {
  id: string;
  name: string;
  customer: string;            // denormalised customer name (display)
  customerId?: string | null;  // link to the customers table
  site: string;
  owner: string;               // project manager
  stages: LifecycleStage[];    // this project's lifecycle (ordered)
  stage: string;               // current stage key (must be in `stages`)
  startDate: string | null;    // YYYY-MM-DD
  targetDate: string | null;   // go-live target
  chargerCount: number;
  value: number;               // contract value (SGD)
  checklist: ChecklistSection[];
  documents: ProjectDoc[];
  notes: string;              // legacy free-text; migrated into noteLog on load
  noteLog?: ProjectNote[];     // dated notes, newest first
  createdAt: string;
}

const DEFAULT_STAGES: LifecycleStage[] = [
  { key: 'sales_closed', label: 'Sales Closed' },
  { key: 'site_survey',  label: 'Site Survey' },
  { key: 'design',       label: 'Design & Approval' },
  { key: 'procurement',  label: 'Procurement' },
  { key: 'installation', label: 'Installation' },
  { key: 'commissioning',label: 'Commissioning' },
  { key: 'handover',     label: 'Handover' },
  { key: 'completed',    label: 'Completed' },
];

const DEFAULT_CHECKLIST: { title: string; items: string[] }[] = [
  { title: 'Contract & Survey',  items: ['Signed contract / PO received', 'Site survey completed', 'DB load capacity confirmed'] },
  { title: 'Design & Approval',  items: ['Single-line diagram (SLD) approved', 'Authority submission (LEW / BCA) done'] },
  { title: 'Procurement',        items: ['Chargers & materials ordered', 'Equipment delivered on site'] },
  { title: 'Installation',       items: ['Civil & cabling works completed', 'Charger mounted & wired'] },
  { title: 'Commissioning',      items: ['Power-on & function test passed', 'OCPP / network connectivity verified'] },
  { title: 'Handover',           items: ['Customer acceptance signed', 'As-built drawings & warranty registered'] },
];
const defaultChecklist = (): ChecklistSection[] =>
  DEFAULT_CHECKLIST.map((s) => ({ id: rid(), title: s.title, items: s.items.map((label) => ({ id: rid(), label, date: null, status: 'pending' as TaskStatus })) }));

// Projects saved before sections existed hold a flat [{label, done}] list.
function toSections(raw: unknown): ChecklistSection[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0] as Record<string, unknown> | undefined;
  if (first && Array.isArray(first.items)) return raw as ChecklistSection[];
  const legacy = raw as { id?: string; label: string; done?: boolean }[];
  return [{ id: rid(), title: 'Checklist', items: legacy.map((i) => ({ id: i.id ?? rid(), label: i.label, date: null, status: (i.done ? 'done' : 'pending') as TaskStatus })) }];
}
const allTasks = (sections: ChecklistSection[]) => sections.flatMap((s) => s.items);

// Ids must be real UUIDs — project and template rows use uuid primary keys, so a
// short random string is rejected by Postgres ("invalid input syntax for type uuid").
const rid = (): string => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const todayISO = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const parseISO = (s: string) => new Date(`${s}T00:00:00`);
const addDays = (iso: string, n: number) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const money = (n: number) => 'S$' + (Number(n) || 0).toLocaleString('en-US');
const toISODate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const openStoredFile = async (f: TaskFile) => {
  const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(f.path, 60);
  if (error || !data) { alert(`Could not open: ${error?.message ?? 'unknown'}`); return; }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
};
const fmtDate = (s: string | null) => (s ? parseISO(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function newProject(): BuildProject {
  const start = todayISO();
  const target = addDays(start, 60);
  return {
    id: rid(), name: '', customer: '', customerId: null, site: '', owner: '',
    stages: DEFAULT_STAGES.map((s) => ({ ...s })), stage: DEFAULT_STAGES[0].key,
    startDate: start, targetDate: target, chargerCount: 1, value: 0,
    checklist: defaultChecklist(),
    documents: [], notes: '', createdAt: new Date().toISOString(),
  };
}

// Fill in fields added after a project was first saved.
function normalize(p: BuildProject): BuildProject {
  const stages = p.stages?.length ? p.stages : DEFAULT_STAGES.map((s) => ({ ...s }));
  const stage = stages.some((s) => s.key === p.stage) ? p.stage : stages[0].key;
  // The old single free-text note becomes the first card of the log. Only clear
  // `notes` once it has actually been carried over.
  const legacy = (p.notes ?? '').trim();
  const noteLog: ProjectNote[] = (p.noteLog ?? []).map((n) => ({ ...n, files: n.files ?? [] }));
  const migrated = Boolean(legacy) && noteLog.length === 0;
  if (migrated) {
    const at = p.createdAt ?? new Date().toISOString();
    noteLog.push({ id: rid(), date: at.slice(0, 10), body: legacy, author: '', files: [], createdAt: at });
  }
  return { ...p, stages, stage, documents: p.documents ?? [], checklist: toSections(p.checklist), notes: migrated ? '' : p.notes ?? '', noteLog };
}

const stageIdxOf = (p: BuildProject) => Math.max(0, p.stages.findIndex((s) => s.key === p.stage));
const isFinalStage = (p: BuildProject) => stageIdxOf(p) >= p.stages.length - 1;
const progressOf = (p: BuildProject) => {
  const t = allTasks(p.checklist);
  return t.length ? Math.round((t.filter((x) => x.status === 'done').length / t.length) * 100) : 0;
};
const isOverdue = (p: BuildProject) => !!p.targetDate && !isFinalStage(p) && p.targetDate < todayISO();

function stageChip(p: BuildProject): { bg: string; color: string; label: string } {
  const idx = stageIdxOf(p);
  const last = p.stages.length - 1;
  const label = p.stages[idx]?.label ?? p.stage;
  if (idx >= last) return { bg: '#E4F3E3', color: '#1B512D', label };
  const frac = last > 0 ? idx / last : 0;
  const c = frac < 0.34 ? { bg: '#E3F0FF', color: '#1A62C0' } : frac < 0.67 ? { bg: '#FFF8E1', color: '#B07D00' } : { bg: '#FFF0E0', color: '#B45309' };
  return { ...c, label };
}

// ══════════════════════════════════════════════════════════════════

type StatusFilter = 'all' | 'active' | 'completed' | 'overdue';

export function ScreenChargerProjects() {
  const { can, isAdmin } = usePermissions();
  const canEdit = can('charger_projects', 'can_edit');
  const canDelete = can('charger_projects', 'can_delete');
  // Structural changes (adding/removing/renaming checklist sections & tasks, and
  // managing templates) are admin-only. Everyone with edit rights can still work
  // the checklist: set dates, move statuses and attach/remove files.
  const canManage = isAdmin;

  const [projects, setProjects] = useState<BuildProject[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [managingTemplates, setManagingTemplates] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data, error }, { data: cust }, { data: tpl }] = await Promise.all([
        supabase.from('charger_projects').select('id, data').order('created_at', { ascending: false }),
        supabase.from('customers').select('id, name').order('name'),
        supabase.from('charger_project_templates').select('id, name, stages, sections').order('name'),
      ]);
      if (error) console.error('load projects failed', error);
      setProjects(((data ?? []) as { data: BuildProject }[]).map((r) => normalize(r.data)));
      setCustomers((cust as { id: string; name: string }[]) ?? []);
      // Templates saved before lifecycles were paired in fall back to the default.
      setTemplates(((tpl as ChecklistTemplate[]) ?? []).map((t) => ({
        ...t, stages: t.stages?.length ? t.stages : DEFAULT_STAGES.map((x) => ({ ...x })),
      })));
      setLoading(false);
    })();
  }, []);

  const upsertLocal = (p: BuildProject) => {
    setProjects((ps) => (ps.some((x) => x.id === p.id) ? ps.map((x) => (x.id === p.id ? p : x)) : [p, ...ps]));
    void supabase.from('charger_projects').upsert({ id: p.id, data: p, updated_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) { console.error('save project failed', error); alert(`Could not save project: ${error.message}`); }
      });
  };
  const saveTemplate = async (t: ChecklistTemplate) => {
    setTemplates((ts) => (ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t]));
    const { error } = await supabase.from('charger_project_templates')
      .upsert({ id: t.id, name: t.name, stages: t.stages, sections: t.sections, updated_at: new Date().toISOString() });
    if (error) { console.error(error); alert(`Could not save template: ${error.message}`); }
  };
  const deleteTemplate = async (id: string) => {
    setTemplates((ts) => ts.filter((t) => t.id !== id));
    const { error } = await supabase.from('charger_project_templates').delete().eq('id', id);
    if (error) console.error(error);
  };

  const removeProject = (id: string) => {
    setProjects((ps) => ps.filter((p) => p.id !== id));
    setSelectedId(null);
    void supabase.from('charger_projects').delete().eq('id', id).then(({ error }) => { if (error) console.error(error); });
  };

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const visible = projects.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = p.name.toLowerCase().includes(q) || p.customer.toLowerCase().includes(q);
    const matchFilter =
      filter === 'all' ? true :
      filter === 'completed' ? isFinalStage(p) :
      filter === 'overdue' ? isOverdue(p) :
      !isFinalStage(p); // active
    return matchSearch && matchFilter;
  });

  const active = projects.filter((p) => !isFinalStage(p));
  const totalChargers = projects.reduce((s, p) => s + (p.chargerCount || 0), 0);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading projects…</div>;

  if (selected) {
    return <ProjectDetail project={selected} customers={customers} canEdit={canEdit} canDelete={canDelete} canManage={canManage}
      onSaveTemplate={saveTemplate}
      onChange={upsertLocal} onDelete={() => removeProject(selected.id)} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Projects" value={String(projects.length)} sub={`${active.length} in progress`} accent />
        <KPICard label="Chargers to build" value={String(totalChargers)} sub="across all projects" />
        <KPICard label="Overdue" value={String(projects.filter(isOverdue).length)} sub="past target date" />
        <KPICard label="Completed" value={String(projects.filter(isFinalStage).length)} sub="reached final stage" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 240 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'active', 'completed', 'overdue'] as StatusFilter[]).map((k) => {
            const on = filter === k;
            return (
              <button key={k} onClick={() => setFilter(k)}
                style={{ padding: '6px 14px', borderRadius: 99, border: `1px solid ${on ? C.green : '#EBEBEB'}`, background: on ? C.green : C.white, color: on ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                {k}
              </button>
            );
          })}
        </div>
        {canEdit && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {canManage && <button onClick={() => setManagingTemplates(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <ListChecks size={15} strokeWidth={2.25} /> Checklist Templates
            </button>}
            <button onClick={() => setCreating(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <Plus size={15} strokeWidth={2.5} /> New Project
            </button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <div style={{ background: C.white, border: '1px dashed #EBEBEB', borderRadius: 16, padding: '48px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
          <GanttChartSquare size={30} strokeWidth={1.5} style={{ color: C.slate, marginBottom: 8 }} />
          <div>No projects match. {canEdit && 'Start one from a closed sale with “New Project”.'}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map((p) => {
            const chip = stageChip(p);
            const prog = progressOf(p);
            const over = isOverdue(p);
            return (
              <button key={p.id} onClick={() => setSelectedId(p.id)}
                style={{ textAlign: 'left', width: '100%', background: C.white, border: '1px solid #EBEBEB', borderRadius: 14, padding: '16px 18px', cursor: 'pointer', fontFamily: 'Figtree', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{p.name || 'Untitled project'}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 99, background: chip.bg, color: chip.color }}>{chip.label}</span>
                    {over && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 99, background: '#FDEAEA', color: '#C0321A' }}>Overdue</span>}
                    {p.documents.length > 0 && <span style={{ fontSize: 10, color: C.slate, display: 'inline-flex', alignItems: 'center', gap: 3 }}><FileText size={11} /> {p.documents.length}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>{p.customer || '—'}{p.site ? ` · ${p.site}` : ''}</div>
                  <div style={{ fontSize: 11, color: C.slate, marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <span><CalendarDays size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />Target {fmtDate(p.targetDate)}</span>
                    <span>{p.chargerCount} charger{p.chargerCount === 1 ? '' : 's'}</span>
                    <span>{p.owner || 'Unassigned PM'}</span>
                  </div>
                </div>
                <div style={{ width: 120, flexShrink: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.slate, fontWeight: 700, marginBottom: 4 }}>
                    <span>PROGRESS</span><span>{prog}%</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 99, background: '#EEF1F3', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${prog}%`, background: C.green, borderRadius: 99 }} />
                  </div>
                </div>
                <ChevronRight size={18} strokeWidth={2.25} style={{ color: C.slate, flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}

      {creating && (
        <ProjectModal title="New Project" wizard canManage={canManage} initial={newProject()} customers={customers} templates={templates}
          onSave={(p) => { upsertLocal(p); setCreating(false); setSelectedId(p.id); }}
          onClose={() => setCreating(false)} />
      )}
      {managingTemplates && (
        <TemplateManager templates={templates} onSave={saveTemplate} onDelete={deleteTemplate} onClose={() => setManagingTemplates(false)} />
      )}
    </div>
  );
}

// ── Detail ────────────────────────────────────────────────────────

function ProjectDetail({ project, customers, canEdit, canDelete, canManage, onSaveTemplate, onChange, onDelete, onBack }: {
  project: BuildProject; customers: { id: string; name: string }[]; canEdit: boolean; canDelete: boolean; canManage: boolean;
  onSaveTemplate: (t: ChecklistTemplate) => void;
  onChange: (p: BuildProject) => void; onDelete: () => void; onBack: () => void;
}) {
  const { user } = usePermissions();
  const [editing, setEditing] = useState(false);
  const [manageStages, setManageStages] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isMobile = useIsMobile();
  const patch = (over: Partial<BuildProject>) => onChange({ ...project, ...over });
  const prog = progressOf(project);

  // Lifecycle sets the height of the pair; the checklist is capped to it and
  // scrolls internally, so a long checklist never stretches the row.
  const lifecycleRef = useRef<HTMLDivElement>(null);
  const [lifecycleH, setLifecycleH] = useState<number | null>(null);
  useEffect(() => {
    const el = lifecycleRef.current;
    if (!el || isMobile) { setLifecycleH(null); return; }
    const sync = () => setLifecycleH(el.offsetHeight);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ArrowLeft size={16} strokeWidth={2.25} />
        </button>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.01em' }}>{project.name || 'Untitled project'}</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 3, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>{project.customer || '—'}</span>
            {project.site && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MapPin size={11} /> {project.site}</span>}
            <span>PM: {project.owner || '—'}</span>
            <span>{money(project.value)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Trash2 size={13} /> Delete
            </button>
          )}
          {canEdit && (
            <button onClick={() => setEditing(true)}
              style={{ padding: '8px 16px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete “{project.name || 'this project'}”? This can't be undone.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmDelete(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={onDelete} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, delete</button>
          </div>
        </div>
      )}

      {/* Lifecycle (+ stage documents) alongside the project's own checklist */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 0.85fr) minmax(0, 1.15fr)', gap: 16, alignItems: 'start' }}>
        <div ref={lifecycleRef} style={{ minWidth: 0 }}>
        <Section fill title="Lifecycle" icon={<GanttChartSquare size={15} strokeWidth={2.25} />}
          right={canEdit && (
            <button onClick={() => setManageStages(true)}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, cursor: 'pointer', fontFamily: 'Figtree' }}>
              Edit lifecycle
            </button>
          )}>
          <VerticalLifecycle project={project} canEdit={canEdit} onChange={onChange} />
        </Section>
        </div>

        <div style={{ minWidth: 0, height: lifecycleH ?? undefined }}>
        <Section fill title="Build Checklist" icon={<ListChecks size={15} strokeWidth={2.25} />}
          right={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              {canManage && project.checklist.length > 0 && (
                <button onClick={() => {
                  const name = window.prompt("Save this project's lifecycle + checklist as a template named:", `${project.name || 'Project'} template`);
                  if (name?.trim()) onSaveTemplate({ id: rid(), name: name.trim(), stages: cloneStages(project.stages), sections: cloneSections(project.checklist) });
                }}
                  style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, cursor: 'pointer', fontFamily: 'Figtree' }}>
                  Save as project type
                </button>
              )}
              <span style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{prog}%</span>
            </span>
          }>
          <Checklist sections={project.checklist} canEdit={canEdit} canManage={canManage} uploadPrefix={project.id} onChange={(checklist) => patch({ checklist })} />
        </Section>
        </div>
      </div>

      {/* Dated note log */}
      <NoteLog notes={project.noteLog ?? []} canEdit={canEdit} author={user.full_name}
        uploadPrefix={project.id} onChange={(noteLog) => patch({ noteLog })} />

      {editing && (
        <ProjectModal title="Edit Project" initial={project} customers={customers}
          onSave={(p) => { onChange(p); setEditing(false); }} onClose={() => setEditing(false)} />
      )}
      {manageStages && (
        <LifecycleModal stages={project.stages} onClose={() => setManageStages(false)}
          onSave={(stages) => {
            const stage = stages.some((s) => s.key === project.stage) ? project.stage : (stages[0]?.key ?? project.stage);
            onChange({ ...project, stages, stage });
            setManageStages(false);
          }} />
      )}
    </div>
  );
}

// ── Note log ──────────────────────────────────────────────────────

// Dated notes as cards: each one carries its own date, body, author and
// attachments, so a project reads as a running site diary rather than one
// ever-growing text box. Newest date first.
function NoteLog({ notes, canEdit, author, uploadPrefix, onChange }: {
  notes: ProjectNote[]; canEdit: boolean; author: string; uploadPrefix: string;
  onChange: (n: ProjectNote[]) => void;
}) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const patchNote = (id: string, over: Partial<ProjectNote>) =>
    onChange(notes.map((n) => (n.id === id ? { ...n, ...over } : n)));
  const addNote = () => {
    const now = new Date();
    onChange([{ id: rid(), date: toISODate(now), body: '', author, files: [], createdAt: now.toISOString() }, ...notes]);
  };
  const delNote = async (n: ProjectNote) => {
    if (n.files.length) await supabase.storage.from(DOC_BUCKET).remove(n.files.map((f) => f.path));
    onChange(notes.filter((x) => x.id !== n.id));
    setConfirmDel(null);
  };
  const attach = async (n: ProjectNote, file: File) => {
    setUploading(n.id);
    try {
      const ext = file.name.match(/\.[^.]+$/)?.[0] ?? '';
      const path = `${uploadPrefix}/notes/${rid()}${ext}`;
      const { error } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (error) { alert(`Upload failed: ${error.message}`); return; }
      patchNote(n.id, { files: [...n.files, { id: rid(), name: file.name, path, uploadedAt: new Date().toISOString(), size: file.size }] });
    } finally { setUploading(null); }
  };
  const detach = async (n: ProjectNote, f: TaskFile) => {
    await supabase.storage.from(DOC_BUCKET).remove([f.path]);
    patchNote(n.id, { files: n.files.filter((x) => x.id !== f.id) });
  };

  // Newest note first; undated notes fall back to when they were created.
  const ordered = [...notes].sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));

  return (
    <Section title="Notes" icon={<StickyNote size={15} strokeWidth={2.25} />}
      right={canEdit ? (
        <button onClick={addNote}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 99, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={12} /> Add note
        </button>
      ) : undefined}>
      {ordered.length === 0 ? (
        <div style={{ padding: '26px 0', textAlign: 'center', color: C.slate, fontSize: 12.5 }}>
          <StickyNote size={28} strokeWidth={1.5} color={C.slate} style={{ display: 'block', margin: '0 auto 8px' }} />
          No notes yet{canEdit ? ' — add one for a site visit, a call or a blocker.' : '.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {ordered.map((n) => (
            <div key={n.id} style={{ background: C.seasalt, borderRadius: 12, border: '1px solid #EBEBEB', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {canEdit ? (
                  <input type="date" value={n.date} onChange={(e) => patchNote(n.id, { date: e.target.value })}
                    style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 11.5, fontWeight: 700, color: C.green, background: C.white, outline: 'none' }} />
                ) : (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: C.green }}>{n.date ? fmtDate(n.date) : '—'}</span>
                )}
                {n.author && <span style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.author}</span>}
                {canEdit && (
                  <button onClick={() => setConfirmDel(n.id)} title="Delete note"
                    style={{ marginLeft: 'auto', width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>×</button>
                )}
              </div>

              {canEdit ? (
                <textarea value={n.body} rows={3} placeholder="What happened…" onChange={(e) => patchNote(n.id, { body: e.target.value })}
                  style={{ width: '100%', padding: '9px 11px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5, background: C.white }} />
              ) : (
                <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: n.body ? '#1a1a1a' : C.slate }}>{n.body || '—'}</div>
              )}

              {(n.files.length > 0 || canEdit) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {n.files.map((f) => (
                    <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 6, background: C.white, border: '1px solid #EBEBEB', maxWidth: '100%' }}>
                      <button onClick={() => openStoredFile(f)} title={f.name}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', padding: 0, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <FileText size={11} /> {f.name}
                      </button>
                      {canEdit && <button onClick={() => detach(n, f)} title="Remove" style={{ border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>}
                    </span>
                  ))}
                  {canEdit && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, border: `1px dashed ${C.green}`, color: C.green, fontSize: 11, fontWeight: 700, cursor: uploading === n.id ? 'default' : 'pointer' }}>
                      <Paperclip size={11} /> {uploading === n.id ? 'Uploading…' : 'Attach'}
                      <input type="file" disabled={uploading === n.id} style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(n, f); e.currentTarget.value = ''; }} />
                    </label>
                  )}
                </div>
              )}

              {confirmDel === n.id && (
                <div style={{ background: '#FDEAEA', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#C0321A' }}>
                    Delete this note{n.files.length ? ` and its ${n.files.length} attachment${n.files.length === 1 ? '' : 's'}` : ''}?
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setConfirmDel(null)} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={() => void delNote(n)} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Yes, delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// `fill` makes the card stretch to its grid row and lets the body flex — used so
// Lifecycle and Build Checklist always end at the same height.
function Section({ title, icon, right, fill, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; fill?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '18px 20px', ...(fill ? { height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' as const } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexShrink: 0 }}>
        {icon && <span style={{ color: C.green, display: 'inline-flex' }}>{icon}</span>}
        <span style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{title}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      {fill ? <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div> : children}
    </div>
  );
}

// ── Vertical lifecycle with per-stage documents ───────────────────

// One compact vertical list: the stage node/connector on the left, the stage's
// documents on the right. Keeps the left column narrow so the checklist gets room.
function VerticalLifecycle({ project, canEdit, onChange }: { project: BuildProject; canEdit: boolean; onChange: (p: BuildProject) => void }) {
  const [uploading, setUploading] = useState<string | null>(null);
  const cur = Math.max(0, project.stages.findIndex((s) => s.key === project.stage));

  const upload = async (stageKey: string, file: File) => {
    setUploading(stageKey);
    try {
      const ext = file.name.match(/\.[^.]+$/)?.[0] ?? '';
      const path = `${project.id}/${rid()}${ext}`;
      const { error } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (error) { alert(`Upload failed: ${error.message}`); return; }
      const doc: ProjectDoc = { id: rid(), name: file.name, path, stageKey, uploadedAt: new Date().toISOString(), size: file.size };
      onChange({ ...project, documents: [...project.documents, doc] });
    } finally { setUploading(null); }
  };
  const view = async (doc: ProjectDoc) => {
    const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(doc.path, 60);
    if (error || !data) { alert(`Could not open: ${error?.message ?? 'unknown'}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };
  const removeDoc = async (doc: ProjectDoc) => {
    await supabase.storage.from(DOC_BUCKET).remove([doc.path]);
    onChange({ ...project, documents: project.documents.filter((d) => d.id !== doc.id) });
  };

  const orphan = project.documents.filter((d) => !project.stages.some((s) => s.key === d.stageKey));
  const rows = [
    ...project.stages.map((s, i) => ({ key: s.key, label: s.label, i, docs: project.documents.filter((d) => d.stageKey === s.key) })),
    ...(orphan.length ? [{ key: '__other', label: 'Other', i: -1, docs: orphan }] : []),
  ];

  const docChip = (d: ProjectDoc) => (
    <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: C.honeydew, borderRadius: 99, padding: '3px 6px 3px 9px', maxWidth: '100%' }}>
      <button onClick={() => view(d)} title="Open" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <FileText size={11} /> {d.name}
      </button>
      {canEdit && <button onClick={() => removeDoc(d)} title="Remove" style={{ width: 16, height: 16, borderRadius: 99, border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>×</button>}
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((row, idx) => {
        const isStage = row.i >= 0;
        const done = isStage && row.i < cur;
        const active = isStage && row.i === cur;
        const last = idx === rows.length - 1;
        return (
          <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 10 }}>
            {/* Node + connector */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <button onClick={() => canEdit && isStage && onChange({ ...project, stage: row.key })} disabled={!canEdit || !isStage}
                title={canEdit && isStage ? `Set current stage to ${row.label}` : undefined}
                style={{ width: 26, height: 26, borderRadius: 99, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 800, padding: 0, fontFamily: 'Figtree',
                  background: done ? C.green : active ? C.white : '#F3F3F3', color: done ? C.white : active ? C.green : C.slate,
                  border: active ? `2px solid ${C.green}` : 'none', cursor: canEdit && isStage ? 'pointer' : 'default' }}>
                {done ? '✓' : isStage ? row.i + 1 : '·'}
              </button>
              {!last && <div style={{ width: 2, flex: 1, minHeight: 18, background: done ? C.green : '#E4E9ED' }} />}
            </div>

            {/* Stage label + its documents */}
            <div style={{ paddingBottom: last ? 0 : 14, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: active ? 800 : 700, color: active ? C.green : done ? '#1a1a1a' : C.slate, lineHeight: '26px' }}>{row.label}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginTop: 2 }}>
                {row.docs.map(docChip)}
                {canEdit && isStage && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, border: `1px dashed ${C.green}`, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: uploading === row.key ? 'default' : 'pointer', opacity: uploading === row.key ? 0.6 : 1 }}>
                    <Upload size={11} /> {uploading === row.key ? 'Uploading…' : 'Upload'}
                    <input type="file" disabled={!!uploading} style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(row.key, f); }} />
                  </label>
                )}
                {!canEdit && row.docs.length === 0 && <span style={{ fontSize: 11.5, color: C.slate }}>—</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ── Manage lifecycle ──────────────────────────────────────────────

function LifecycleModal({ stages, onSave, onClose }: { stages: LifecycleStage[]; onSave: (s: LifecycleStage[]) => void; onClose: () => void }) {
  const [list, setList] = useState<LifecycleStage[]>(stages.map((s) => ({ ...s })));
  return (
    <Modal title="Edit lifecycle" onClose={onClose} width={480}>
      <div style={{ fontSize: 12, color: C.slate }}>Each project has its own stages. Rename, reorder, add or remove them — documents stay tagged to their stage.</div>
      <StageEditor list={list} onChange={setList} />
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        <button onClick={() => onSave(list.filter((s) => s.label.trim()).map((s) => ({ ...s, label: s.label.trim() })))}
          style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Save lifecycle</button>
      </div>
    </Modal>
  );
}

// Ordered stage list editor — shared by the per-project lifecycle modal and the
// lifecycle half of a template.
function StageEditor({ list, onChange }: { list: LifecycleStage[]; onChange: (s: LifecycleStage[]) => void }) {
  const setList = (fn: (l: LifecycleStage[]) => LifecycleStage[]) => onChange(fn(list));
  const rename = (i: number, label: string) => setList((l) => l.map((s, idx) => (idx === i ? { ...s, label } : s)));
  const move = (i: number, dir: -1 | 1) => setList((l) => { const n = [...l]; const j = i + dir; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const del = (i: number) => setList((l) => (l.length <= 1 ? l : l.filter((_, idx) => idx !== i)));
  const add = () => setList((l) => [...l, { key: rid(), label: 'New stage' }]);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <button onClick={() => move(i, -1)} disabled={i === 0} style={{ width: 22, height: 18, border: '1px solid #EBEBEB', borderBottom: 'none', borderRadius: '6px 6px 0 0', background: C.white, color: i === 0 ? '#CBD5DD' : C.slate, cursor: i === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><ChevronUp size={12} /></button>
              <button onClick={() => move(i, 1)} disabled={i === list.length - 1} style={{ width: 22, height: 18, border: '1px solid #EBEBEB', borderRadius: '0 0 6px 6px', background: C.white, color: i === list.length - 1 ? '#CBD5DD' : C.slate, cursor: i === list.length - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><ChevronDown size={12} /></button>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, width: 18, textAlign: 'center' }}>{i + 1}</span>
            <input value={s.label} onChange={(e) => rename(i, e.target.value)}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            <button onClick={() => del(i)} disabled={list.length <= 1} title="Remove"
              style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: list.length <= 1 ? '#CBD5DD' : '#C0321A', cursor: list.length <= 1 ? 'default' : 'pointer', flexShrink: 0 }}>×</button>
          </div>
        ))}
      </div>
      <button onClick={add} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
        <Plus size={13} /> Add stage
      </button>
    </>
  );
}

// ── Checklist (sectioned task table) ──────────────────────────────

// Sections are tabs across the top; the table below shows the active section's
// tasks with a target date and status. Completed tasks sink to the bottom.
// `canEdit` = work the checklist (status, dates, attachments).
// `canManage` = restructure it (add/rename/remove sections & tasks) — admin only.
function Checklist({ sections, canEdit, canManage = false, uploadPrefix, onChange }: { sections: ChecklistSection[]; canEdit: boolean; canManage?: boolean; uploadPrefix?: string; onChange: (s: ChecklistSection[]) => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newSection, setNewSection] = useState('');
  const [addingSection, setAddingSection] = useState(false);
  const [uploadingTask, setUploadingTask] = useState<string | null>(null);
  const withFiles = !!uploadPrefix;

  const tasks = allTasks(sections);
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  const active = sections.find((s) => s.id === activeId) ?? sections[0] ?? null;

  const patchSection = (sid: string, over: Partial<ChecklistSection>) =>
    onChange(sections.map((s) => (s.id === sid ? { ...s, ...over } : s)));
  const patchTask = (sid: string, tid: string, over: Partial<ChecklistTask>) =>
    patchSection(sid, { items: sections.find((s) => s.id === sid)!.items.map((t) => (t.id === tid ? { ...t, ...over } : t)) });
  const addTask = (sid: string) =>
    patchSection(sid, { items: [...sections.find((s) => s.id === sid)!.items, { id: rid(), label: '', date: null, status: 'pending' }] });
  const patchSub = (sid: string, tid: string, subId: string, over: Partial<SubTask>) => {
    const t = sections.find((x) => x.id === sid)!.items.find((x) => x.id === tid)!;
    const subtasks = (t.subtasks ?? []).map((x) => (x.id === subId ? { ...x, ...over } : x));
    // Re-opening a sub-task re-opens its parent.
    const reopened = t.status === 'done' && subtasks.some((x) => x.status !== 'done');
    patchTask(sid, tid, reopened ? { subtasks, status: 'in_progress' } : { subtasks });
  };
  const addSub = (sid: string, t: ChecklistTask) =>
    patchTask(sid, t.id, {
      subtasks: [...(t.subtasks ?? []), { id: rid(), label: '', date: null, status: 'pending' }],
      ...(t.status === 'done' ? { status: 'in_progress' as TaskStatus } : {}),
    });
  const delSub = (sid: string, t: ChecklistTask, subId: string) =>
    patchTask(sid, t.id, { subtasks: (t.subtasks ?? []).filter((x) => x.id !== subId) });

  const delTask = (sid: string, tid: string) =>
    patchSection(sid, { items: sections.find((s) => s.id === sid)!.items.filter((t) => t.id !== tid) });
  const delSection = (sid: string) => { onChange(sections.filter((s) => s.id !== sid)); setActiveId(null); };
  const addSection = () => {
    const title = newSection.trim();
    if (!title) return;
    const id = rid();
    onChange([...sections, { id, title, items: [] }]);
    setNewSection(''); setAddingSection(false); setActiveId(id);
  };

  // Per-task attachments land in the same private bucket as the stage documents.
  const attach = async (sid: string, t: ChecklistTask, file: File) => {
    setUploadingTask(t.id);
    try {
      const ext = file.name.match(/\.[^.]+$/)?.[0] ?? '';
      const path = `${uploadPrefix}/tasks/${rid()}${ext}`;
      const { error } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (error) { alert(`Upload failed: ${error.message}`); return; }
      patchTask(sid, t.id, { files: [...(t.files ?? []), { id: rid(), name: file.name, path, uploadedAt: new Date().toISOString(), size: file.size }] });
    } finally { setUploadingTask(null); }
  };
  const openFile = openStoredFile;
  const detach = async (sid: string, t: ChecklistTask, f: TaskFile) => {
    await supabase.storage.from(DOC_BUCKET).remove([f.path]);
    patchTask(sid, t.id, { files: (t.files ?? []).filter((x) => x.id !== f.id) });
  };

  const cols = [
    '1fr', '122px', '116px',
    ...(withFiles ? ['132px'] : []),
    ...(canManage ? ['24px'] : []),
  ].join(' ');
  const cell: React.CSSProperties = { fontSize: 12.5, color: '#1a1a1a', minWidth: 0 };
  const smallInput: React.CSSProperties = { width: '100%', padding: '5px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: C.white };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ flex: 1, height: 7, borderRadius: 99, background: '#EEF1F3', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: C.green, borderRadius: 99 }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>{done}/{tasks.length}</span>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0, paddingBottom: 2 }}>
        {sections.map((s) => {
          const on = active?.id === s.id;
          const sDone = s.items.filter((t) => t.status === 'done').length;
          return (
            <button key={s.id} onClick={() => setActiveId(s.id)}
              style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 99,
                border: `1px solid ${on ? C.green : '#EBEBEB'}`, background: on ? C.green : C.white, color: on ? C.white : C.slate,
                fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {s.title || 'Untitled'}
              <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.85 }}>{sDone}/{s.items.length}</span>
            </button>
          );
        })}
        {canManage && !addingSection && (
          <button onClick={() => setAddingSection(true)} title="Add section"
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 99, border: `1px dashed ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <Plus size={12} /> Section
          </button>
        )}
        {canManage && addingSection && (
          <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
            <input autoFocus value={newSection} onChange={(e) => setNewSection(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addSection(); if (e.key === 'Escape') { setAddingSection(false); setNewSection(''); } }}
              placeholder="Section name" style={{ width: 130, padding: '5px 10px', borderRadius: 99, border: `1px solid ${C.green}`, fontFamily: 'Figtree', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            <button onClick={addSection} disabled={!newSection.trim()} style={{ padding: '5px 12px', borderRadius: 99, border: 'none', background: newSection.trim() ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: newSection.trim() ? 'pointer' : 'default' }}>Add</button>
          </span>
        )}
      </div>

      {/* Rename / remove the active section */}
      {canManage && active && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <input value={active.title} onChange={(e) => patchSection(active.id, { title: e.target.value })} placeholder="Section name"
            style={{ flex: 1, minWidth: 0, padding: '5px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, color: C.green, outline: 'none', boxSizing: 'border-box' }} />
          <button onClick={() => delSection(active.id)}
            style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            Remove section
          </button>
        </div>
      )}

      {/* Column header */}
      {active && (
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '0 10px', flexShrink: 0 }}>
          {['Task', 'Date', 'Status', ...(withFiles ? ['File'] : [])].map((h) => (
            <span key={h} style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
          ))}
          {canManage && <span />}
        </div>
      )}

      {/* Active section's tasks */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: active ? '1px solid #EBEBEB' : 'none', borderRadius: 12 }}>
        {!active && <div style={{ fontSize: 12, color: C.slate, padding: '10px 2px' }}>{canManage ? 'No sections yet — add one above.' : 'No checklist sections yet.'}</div>}
        {active && active.items.length === 0 && <div style={{ padding: '10px', fontSize: 12, color: C.slate }}>No tasks in this section.</div>}
        {active && [...active.items].sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)).map((t, i) => {
          const st = STATUS_META[t.status] ?? STATUS_META.pending;
          const subs = subsOf(t);
          const subsReady = canCompleteTask(t);
          const blockNote = `Complete all ${subs.length} sub-tasks before marking this Done`;
          return (
            <div key={t.id}>
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', padding: '7px 10px', borderTop: i === 0 ? 'none' : '1px solid #F3F3F3', background: t.status === 'done' ? C.honeydew : 'transparent' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                {canManage ? (
                  <input value={t.label} onChange={(e) => patchTask(active.id, t.id, { label: e.target.value })} placeholder="Task name"
                    style={{ ...cell, flex: 1, border: 'none', background: 'transparent', outline: 'none', fontFamily: 'Figtree', padding: 0, textDecoration: t.status === 'done' ? 'line-through' : 'none' }} />
                ) : (
                  <span style={{ ...cell, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.label}</span>
                )}
                {subs.length > 0 && (
                  <span title={subsReady ? 'All sub-tasks done' : blockNote}
                    style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: subsReady ? '#E4F3E3' : C.seasalt, color: subsReady ? '#1B512D' : C.slate, border: `1px solid ${subsReady ? '#E4F3E3' : '#EBEBEB'}` }}>
                    {subsDoneCount(t)}/{subs.length}
                  </span>
                )}
                {canManage && (
                  <button onClick={() => addSub(active.id, t)} title="Add sub-task"
                    style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 99, border: `1px dashed ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                    <Plus size={9} /> Sub
                  </button>
                )}
              </span>

              {canEdit ? (
                <input type="date" value={t.date ?? ''} onChange={(e) => patchTask(active.id, t.id, { date: e.target.value || null })} style={smallInput} />
              ) : (
                <span style={{ fontSize: 12, color: t.date ? '#1a1a1a' : C.slate }}>{t.date ? fmtDate(t.date) : '—'}</span>
              )}

              {canEdit ? (
                <select value={t.status} title={subsReady ? undefined : blockNote}
                  onChange={(e) => {
                    const next = e.target.value as TaskStatus;
                    if (next === 'done' && !subsReady) { alert(blockNote + '.'); return; }
                    patchTask(active.id, t.id, { status: next });
                  }}
                  style={{ ...smallInput, fontWeight: 700, color: st.color, background: st.bg, border: `1px solid ${st.bg}`, cursor: 'pointer' }}>
                  {(Object.keys(STATUS_META) as TaskStatus[]).map((k) => (
                    <option key={k} value={k} disabled={k === 'done' && !subsReady} style={{ color: '#1a1a1a', background: C.white }}>
                      {k === 'done' && !subsReady ? `${STATUS_META[k].label} — ${subsDoneCount(t)}/${subs.length} sub-tasks` : STATUS_META[k].label}
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: st.bg, color: st.color, justifySelf: 'start' }}>{st.label}</span>
              )}

              {withFiles && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  {(t.files ?? []).map((f) => (
                    <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: C.honeydew, borderRadius: 99, padding: '2px 4px 2px 7px', maxWidth: '100%' }}>
                      <button onClick={() => openFile(f)} title={f.name}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', padding: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <Paperclip size={10} style={{ flexShrink: 0 }} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      </button>
                      {canEdit && <button onClick={() => detach(active.id, t, f)} title="Remove attachment" style={{ width: 14, height: 14, borderRadius: 99, border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', fontSize: 11, flexShrink: 0, padding: 0 }}>×</button>}
                    </span>
                  ))}
                  {canEdit && (
                    <label title="Attach a file" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', padding: '2px 8px', borderRadius: 99, border: `1px dashed ${C.green}`, color: C.green, fontFamily: 'Figtree', fontSize: 10.5, fontWeight: 700, cursor: uploadingTask === t.id ? 'default' : 'pointer', opacity: uploadingTask === t.id ? 0.6 : 1 }}>
                      <Paperclip size={10} /> {uploadingTask === t.id ? 'Uploading…' : 'Attach'}
                      <input type="file" disabled={!!uploadingTask} style={{ display: 'none' }}
                        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void attach(active.id, t, file); }} />
                    </label>
                  )}
                  {!canEdit && (t.files ?? []).length === 0 && <span style={{ fontSize: 11, color: C.slate }}>—</span>}
                </div>
              )}
              {canManage && <button onClick={() => delTask(active.id, t.id)} title="Remove task" style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', fontSize: 14 }}>×</button>}
            </div>
            {/* Sub-tasks — date + status only, no attachments */}
            {(t.subtasks ?? []).map((sub) => {
              const sst = STATUS_META[sub.status] ?? STATUS_META.pending;
              return (
                <div key={sub.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', padding: '5px 10px 5px 26px', borderTop: '1px solid #F7F9FA', background: sub.status === 'done' ? '#F4FAF5' : 'transparent' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ color: '#CBD5DD', fontSize: 11, flexShrink: 0 }}>↳</span>
                    {canManage ? (
                      <input value={sub.label} onChange={(e) => patchSub(active.id, t.id, sub.id, { label: e.target.value })} placeholder="Sub-task"
                        style={{ ...cell, flex: 1, fontSize: 12, color: C.slate, border: 'none', background: 'transparent', outline: 'none', fontFamily: 'Figtree', padding: 0, textDecoration: sub.status === 'done' ? 'line-through' : 'none' }} />
                    ) : (
                      <span style={{ ...cell, flex: 1, fontSize: 12, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: sub.status === 'done' ? 'line-through' : 'none' }}>{sub.label}</span>
                    )}
                  </span>

                  {canEdit ? (
                    <input type="date" value={sub.date ?? ''} onChange={(e) => patchSub(active.id, t.id, sub.id, { date: e.target.value || null })} style={smallInput} />
                  ) : (
                    <span style={{ fontSize: 12, color: sub.date ? '#1a1a1a' : C.slate }}>{sub.date ? fmtDate(sub.date) : '—'}</span>
                  )}

                  {canEdit ? (
                    <select value={sub.status} onChange={(e) => patchSub(active.id, t.id, sub.id, { status: e.target.value as TaskStatus })}
                      style={{ ...smallInput, fontWeight: 700, color: sst.color, background: sst.bg, border: `1px solid ${sst.bg}`, cursor: 'pointer' }}>
                      {(Object.keys(STATUS_META) as TaskStatus[]).map((k) => <option key={k} value={k} style={{ color: '#1a1a1a', background: C.white }}>{STATUS_META[k].label}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: sst.bg, color: sst.color, justifySelf: 'start' }}>{sst.label}</span>
                  )}

                  {withFiles && <span />}
                  {canManage && <button onClick={() => delSub(active.id, t, sub.id)} title="Remove sub-task" style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', fontSize: 13 }}>×</button>}
                </div>
              );
            })}
          </div>
          );
        })}
      </div>

      {canManage && active && (
        <button onClick={() => addTask(active.id)}
          style={{ flexShrink: 0, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={13} /> Add task
        </button>
      )}
    </div>
  );
}


// ── Checklist template manager ────────────────────────────────────

// Build reusable checklists per project type. Editing reuses the same sectioned
// table the projects use, so a template behaves exactly like the real thing.
function TemplateManager({ templates, onSave, onDelete, onClose }: {
  templates: ChecklistTemplate[];
  onSave: (t: ChecklistTemplate) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [selId, setSelId] = useState<string | null>(templates[0]?.id ?? null);
  const [draft, setDraft] = useState<ChecklistTemplate | null>(templates[0] ? { ...templates[0] } : null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [half, setHalf] = useState<'lifecycle' | 'checklist'>('lifecycle');

  const pick = (t: ChecklistTemplate) => {
    setSelId(t.id);
    setDraft({ ...t, stages: t.stages?.length ? t.stages : DEFAULT_STAGES.map((x) => ({ ...x })), sections: t.sections });
    setConfirmDel(false);
  };
  const startNew = () => {
    const t: ChecklistTemplate = { id: rid(), name: 'New template', stages: cloneStages(undefined), sections: defaultChecklist() };
    setSelId(t.id); setDraft(t); setConfirmDel(false); setHalf('lifecycle');
  };

  return (
    <Modal title="Checklist Templates" onClose={onClose} width={780}>
      <div style={{ fontSize: 12, color: C.slate }}>
        A template is a project type — its <strong style={{ color: '#1a1a1a' }}>lifecycle timeline</strong> and <strong style={{ color: '#1a1a1a' }}>build checklist</strong> together (AC install, DC fast charger, retrofit…). Pick one when starting a new project and both are applied.
      </div>

      {/* Template tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {templates.map((t) => {
          const on = selId === t.id;
          return (
            <button key={t.id} onClick={() => pick(t)}
              style={{ padding: '6px 12px', borderRadius: 99, border: `1px solid ${on ? C.green : '#EBEBEB'}`, background: on ? C.green : C.white, color: on ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {t.name}
            </button>
          );
        })}
        <button onClick={startNew}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 99, border: `1px dashed ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={12} /> New template
        </button>
      </div>

      {!draft ? (
        <div style={{ padding: '30px 0', textAlign: 'center', color: C.slate, fontSize: 13 }}>
          No template selected — pick one above or create a new one.
        </div>
      ) : (
        <>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Template name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. DC Fast Charger — 2× 120kW"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* The two halves of a project type */}
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              ['lifecycle', `Lifecycle timeline · ${draft.stages.length} stage${draft.stages.length === 1 ? '' : 's'}`],
              ['checklist', `Build checklist · ${draft.sections.reduce((n, x) => n + x.items.length, 0)} tasks`],
            ] as const).map(([k, label]) => {
              const on = half === k;
              return (
                <button key={k} onClick={() => setHalf(k)}
                  style={{ padding: '7px 14px', borderRadius: 99, border: `1px solid ${on ? C.green : '#EBEBEB'}`, background: on ? C.honeydew : C.white, color: on ? C.green : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {label}
                </button>
              );
            })}
          </div>

          <div style={{ height: 380, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: half === 'lifecycle' ? 'auto' : 'visible' }}>
            {half === 'lifecycle' ? (
              <>
                <div style={{ fontSize: 12, color: C.slate }}>Stages a project of this type runs through, in order. Projects created from this template start at stage 1.</div>
                <StageEditor list={draft.stages} onChange={(stages) => setDraft({ ...draft, stages })} />
              </>
            ) : (
              <Checklist sections={draft.sections} canEdit canManage onChange={(sections) => setDraft({ ...draft, sections })} />
            )}
          </div>

          {confirmDel && (
            <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete “{draft.name}”? Projects already using it keep their lifecycle and checklist.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmDel(false)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => { onDelete(draft.id); setDraft(null); setSelId(null); setConfirmDel(false); }}
                  style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, delete</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!confirmDel && (
              <button onClick={() => setConfirmDel(true)}
                style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Delete template
              </button>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Close</button>
              <button onClick={() => {
                const stages = draft.stages.filter((x) => x.label.trim()).map((x) => ({ ...x, label: x.label.trim() }));
                onSave({ ...draft, name: draft.name.trim() || 'Untitled template', stages: stages.length ? stages : cloneStages(undefined) });
                onClose();
              }}
                style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Save template</button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Project create / edit modal ───────────────────────────────────

function ProjectModal({ title, initial, customers, templates = [], wizard, canManage = false, onSave, onClose }: { title: string; initial: BuildProject; customers: { id: string; name: string }[]; templates?: ChecklistTemplate[]; wizard?: boolean; canManage?: boolean; onSave: (p: BuildProject) => void; onClose: () => void }) {
  const [p, setP] = useState(initial);
  // Creating runs as a 2-step wizard: details, then tailor the checklist before
  // the project exists. Editing is single-step (the checklist lives on the page).
  const [step, setStep] = useState<1 | 2>(1);
  const [tplId, setTplId] = useState('');
  // Keep the current value selectable even if it isn't in the customer list
  // (e.g. a legacy/seeded project whose customer was typed free-text).
  const custOptions = p.customer && !customers.some((c) => c.name === p.customer)
    ? [{ id: p.customerId ?? p.customer, name: p.customer }, ...customers]
    : customers;
  const set = (over: Partial<BuildProject>) => setP((x) => ({ ...x, ...over }));
  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
  const field = (label: string, node: React.ReactNode) => (
    <div><label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>{label}</label>{node}</div>
  );
  const save = () => onSave(p);
  return (
    <Modal title={title} onClose={onClose} width={520}>
      {(!wizard || step === 1) && (
      <>
      {field('Project name', <input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. JTC Kranji Green — 8× AC" style={inp} />)}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {field('Customer', (
          <SearchSelect
            value={p.customer}
            options={custOptions.map((c) => ({ value: c.name, label: c.name }))}
            placeholder="— Select customer —"
            emptyText="No matching customer"
            onChange={(name) => set({ customer: name, customerId: customers.find((c) => c.name === name)?.id ?? null })}
          />
        ))}
        {field('Project manager', <input value={p.owner} onChange={(e) => set({ owner: e.target.value })} style={inp} />)}
      </div>
      {field('Site / address', <input value={p.site} onChange={(e) => set({ site: e.target.value })} style={inp} />)}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {field('Start date', <input type="date" value={p.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value || null })} style={inp} />)}
        {field('Target go-live', <input type="date" value={p.targetDate ?? ''} onChange={(e) => set({ targetDate: e.target.value || null })} style={inp} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {field('Chargers', <input type="number" min={0} value={p.chargerCount} onChange={(e) => set({ chargerCount: Math.max(0, parseInt(e.target.value, 10) || 0) })} style={inp} />)}
        {field('Contract value (SGD)', <input type="number" min={0} value={p.value} onChange={(e) => set({ value: Math.max(0, Number(e.target.value) || 0) })} style={inp} />)}
      </div>
      {!wizard && field('Current stage', (
        <SearchSelect up value={p.stage} options={p.stages.map((s) => ({ value: s.key, label: s.label }))}
          onChange={(key) => set({ stage: key })} />
      ))}
      </>
      )}

      {wizard && step === 2 && (
        <>
          <div style={{ fontSize: 12, color: C.slate }}>
            Set the lifecycle and build checklist for <strong style={{ color: '#1a1a1a' }}>{p.name.trim() || 'this project'}</strong>. You can change both again later.
          </div>
          {templates.length > 0 && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Project type — applies its lifecycle + checklist</label>
              <SearchSelect value={tplId} placeholder="— Choose a project type —" emptyText="No templates"
                options={templates.map((t) => ({ value: t.id, label: t.name, sub: `${(t.stages ?? []).length} stages · ${t.sections.reduce((n, x) => n + x.items.length, 0)} tasks` }))}
                onChange={(id) => {
                  const t = templates.find((x) => x.id === id);
                  if (!t) return;
                  const stages = cloneStages(t.stages);
                  setTplId(id);
                  set({ checklist: cloneSections(t.sections), stages, stage: stages[0].key });
                }} />
            </div>
          )}
          {/* The template's lifecycle, shown so it's clear what was applied. */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Lifecycle · starting stage</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {p.stages.map((st, i) => {
                const on = st.key === p.stage;
                return (
                  <button key={st.key} onClick={() => set({ stage: st.key })} title="Set as the current stage"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 99, border: `1px solid ${on ? C.green : '#EBEBEB'}`, background: on ? C.honeydew : C.white, color: on ? C.green : C.slate, fontFamily: 'Figtree', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                    <span style={{ opacity: .6 }}>{i + 1}</span>{st.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ height: 320, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Checklist sections={p.checklist} canEdit canManage={canManage} onChange={(checklist) => set({ checklist })} />
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
        {wizard && (
          <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em' }}>
            STEP {step} OF 2 · {step === 1 ? 'DETAILS' : 'LIFECYCLE & CHECKLIST'}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {wizard && step === 2 ? (
            <button onClick={() => setStep(1)} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Back</button>
          ) : (
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          )}
          {wizard && step === 1 ? (
            <button onClick={() => setStep(2)} disabled={!p.name.trim()}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: p.name.trim() ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: p.name.trim() ? 'pointer' : 'default' }}>
              Next: lifecycle & checklist →
            </button>
          ) : (
            <button onClick={save} disabled={!p.name.trim()}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: p.name.trim() ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: p.name.trim() ? 'pointer' : 'default' }}>
              {wizard ? 'Create project' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, width = 460, children }: { title: string; onClose: () => void; width?: number; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, color: C.slate, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Figtree' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
