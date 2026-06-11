import { useEffect, useMemo, useRef, useState } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import {
  DEMO_TECHNICIAN,
  STATUS_COLORS,
  useWorkOrderStore,
  type FormField,
  type FormValues,
  type WorkOrder,
  type WorkOrderForm,
} from '../../workOrderStore';
import { OverlayFormRenderer, isOverlay } from './OverlayForm';
import { usePermissions } from '../../permissions';
import { supabase } from '../../lib/supabase';
import { Power, Calendar, User, Camera, Search, ChevronDown } from 'lucide-react';

interface TechAppProps {
  onBack?: () => void;
  onSignOut?: () => void;
}

type TabKey = 'available' | 'mine' | 'all' | 'unassigned';

export function TechApp({ onBack, onSignOut }: TechAppProps = {}) {
  const store = useWorkOrderStore();
  const { user } = usePermissions();
  const isAdmin = user.role_name === 'admin';
  const me = user.full_name || DEMO_TECHNICIAN;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('mine');
  const [adminView, setAdminView] = useState<'list' | 'calendar'>('calendar');
  const [adminFilter, setAdminFilter] = useState<string>('all'); // 'all' | 'unassigned' | technician name
  const [dbTechs, setDbTechs] = useState<string[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    supabase.from('technicians').select('name').order('name').then(({ data }) => {
      if (!cancelled) setDbTechs(((data as { name: string }[]) ?? []).map((t) => t.name));
    });
    return () => { cancelled = true; };
  }, [isAdmin]);

  const active = activeId ? store.workOrders.find((w) => w.id === activeId) : null;
  if (active) {
    return (
      <TechFillFormView
        workOrder={active}
        onBack={() => setActiveId(null)}
        onSignOut={onSignOut}
      />
    );
  }

  const available = store.workOrders.filter((w) => w.status === 'open');
  const mine = store.workOrders.filter((w) => w.assignedTo === me && w.status !== 'completed');
  const all = store.workOrders;
  const unassigned = store.workOrders.filter((w) => !w.assignedTo);

  // Member tabs (My Jobs / Available).
  const tabs: [TabKey, string][] = [
    ['mine', `My Jobs (${mine.length})`],
    ['available', `Available (${available.length})`],
  ];
  const visible = tab === 'available' ? available : mine;
  const emptyMsg = tab === 'mine' ? 'No open jobs assigned to you.' : 'No jobs available to pick up.';

  // Admin: per-technician job counts, listing every known technician plus any
  // assignee already on a job (so legacy names still appear as a filter).
  const jobsByAssignee = new Map<string, number>();
  for (const w of store.workOrders) if (w.assignedTo) jobsByAssignee.set(w.assignedTo, (jobsByAssignee.get(w.assignedTo) ?? 0) + 1);
  const techFilters = [...new Set([...dbTechs, ...jobsByAssignee.keys()])].sort((a, b) => a.localeCompare(b));

  const adminVisible =
    adminFilter === 'all' ? all :
    adminFilter === 'unassigned' ? unassigned :
    store.workOrders.filter((w) => w.assignedTo === adminFilter);
  const adminEmptyMsg =
    adminFilter === 'all' ? 'No work orders yet.' :
    adminFilter === 'unassigned' ? 'No unassigned work orders.' :
    `No jobs assigned to ${adminFilter}.`;

  const railBtn = (active: boolean): React.CSSProperties => ({
    textAlign: 'left', padding: '10px 16px', borderRadius: 12,
    border: active ? 'none' : '1px solid #EBEBEB',
    fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    background: active ? C.green : C.white,
    color: active ? C.white : C.slate,
    boxShadow: active ? '0 6px 14px rgba(42,154,71,0.2)' : 'none',
  });

  if (isAdmin) {
    return (
      <Shell
        onBack={onBack}
        onSignOut={onSignOut}
        title="All Jobs"
        subtitle={`All technicians · ${all.length} job${all.length === 1 ? '' : 's'}`}
        crumb="Technician"
        wide
      >
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Filter rail */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => setAdminFilter('all')} style={railBtn(adminFilter === 'all')}>All Jobs ({all.length})</button>
            <button onClick={() => setAdminFilter('unassigned')} style={railBtn(adminFilter === 'unassigned')}>Unassigned ({unassigned.length})</button>
            {techFilters.length > 0 && (
              <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '12px 8px 2px' }}>Technicians</div>
            )}
            {techFilters.map((name) => (
              <button key={name} onClick={() => setAdminFilter(name)} style={railBtn(adminFilter === name)}>
                {name} ({jobsByAssignee.get(name) ?? 0})
              </button>
            ))}
          </div>
          {/* List / Calendar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
              {([['list', 'List view'], ['calendar', 'Calendar view']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setAdminView(k)}
                  style={{ padding: '8px 18px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: adminView === k ? C.green : 'transparent', color: adminView === k ? C.white : C.slate }}>
                  {l}
                </button>
              ))}
            </div>

            {adminView === 'calendar' ? (
              <JobCalendar key={adminFilter} jobs={adminVisible} onOpen={setActiveId} onReschedule={(id, date) => store.reschedule(id, date)} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {adminVisible.length === 0 && (
                  <div style={{ padding: '40px 20px', textAlign: 'center', color: C.slate, fontSize: 13, background: C.white, borderRadius: 14, border: '1px dashed #EBEBEB' }}>
                    {adminEmptyMsg}
                  </div>
                )}
                {adminVisible.map((wo) => (
                  <WorkOrderCard key={wo.id} wo={wo} assignee={wo.assignedTo} actionLabel="View" onAction={() => setActiveId(wo.id)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      onBack={onBack}
      onSignOut={onSignOut}
      title="My Workday"
      subtitle={`Signed in as ${me}`}
      crumb="Technician"
    >
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {tabs.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 12,
              border: tab === k ? 'none' : '1px solid #EBEBEB',
              fontFamily: 'Figtree',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              background: tab === k ? C.green : C.white,
              color: tab === k ? C.white : C.slate,
              boxShadow: tab === k ? '0 6px 14px rgba(42,154,71,0.2)' : 'none',
            }}
          >
            {l}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {visible.length === 0 && (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: C.slate,
              fontSize: 13,
              background: C.white,
              borderRadius: 14,
              border: '1px dashed #EBEBEB',
            }}
          >
            {emptyMsg}
          </div>
        )}
        {visible.map((wo) => (
          <WorkOrderCard
            key={wo.id}
            wo={wo}
            assignee={isAdmin ? wo.assignedTo : undefined}
            actionLabel={
              isAdmin
                ? 'View'
                : tab === 'available'
                  ? 'Pick up'
                  : wo.status === 'in_progress'
                    ? 'Continue'
                    : wo.status === 'assigned'
                      ? 'Start'
                      : 'Open'
            }
            onAction={() => {
              if (!isAdmin && wo.status === 'open') store.pickUp(wo.id, me);
              setActiveId(wo.id);
            }}
          />
        ))}
      </div>
    </Shell>
  );
}

// ── Shell ─────────────────────────────────────────────────────────

function Shell({
  children,
  onBack,
  onSignOut,
  title,
  subtitle,
  crumb,
  wide,
}: {
  children: React.ReactNode;
  onBack?: () => void;
  onSignOut?: () => void;
  title: string;
  subtitle: string;
  crumb: string;
  wide?: boolean;
}) {
  // When embedded inside the Dashboard (no onBack/onSignOut), the parent
  // already provides the logo, page title, sign-out menu, and scroll —
  // so the Shell's own chrome would just duplicate it.
  const embedded = !onBack && !onSignOut;
  return (
    <div style={{ height: '100%', overflowY: embedded ? 'visible' : 'auto', background: embedded ? 'transparent' : C.seasalt }}>
      {!embedded && (
      <header
        style={{
          background: C.white,
          borderBottom: '1px solid #EBEBEB',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Logo height={26} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: 99,
            background: C.honeydew,
            color: C.green,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          TSD · {crumb}
        </span>
        <button
          onClick={onBack}
          style={{
            marginLeft: 'auto',
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid #EBEBEB',
            background: 'transparent',
            color: C.slate,
            fontFamily: 'Figtree',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ← TSD Workspace
        </button>
        {onSignOut && (
        <button
          onClick={onSignOut}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid #EBEBEB',
            background: 'transparent',
            color: C.slate,
            fontFamily: 'Figtree',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Power size={14} strokeWidth={2.25} />
        </button>
        )}
      </header>
      )}

      <div style={{ maxWidth: wide ? 'none' : 720, margin: '0 auto', padding: embedded ? '0 0 60px' : '24px 20px 60px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>{title}</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>{subtitle}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Work order card ───────────────────────────────────────────────

function WorkOrderCard({
  wo,
  actionLabel,
  onAction,
  assignee,
}: {
  wo: WorkOrder;
  actionLabel: string;
  onAction: () => void;
  assignee?: string | null;
}) {
  const sc = STATUS_COLORS[wo.status];
  const priorityColor = wo.priority === 'high' ? '#C0321A' : wo.priority === 'low' ? C.slate : C.opal;
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 14,
        border: '1px solid #EBEBEB',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em' }}>{wo.id}</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: sc.bg, color: sc.color }}>{sc.label}</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 700,
            color: priorityColor,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {wo.priority}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.3 }}>{wo.title}</div>
      <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>
        {wo.customer}{wo.product ? ` · ${wo.product}` : ''}
        <br />
        {wo.address}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.slate, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Calendar size={11} strokeWidth={2} /> {wo.scheduledDate}</span>
        {assignee !== undefined && (
          <span style={{ fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 99, background: assignee ? C.honeydew : '#FFF0E0', color: assignee ? C.green : '#B45309' }}>
            <User size={11} strokeWidth={2.25} /> {assignee ?? 'Unassigned'}
          </span>
        )}
        <button
          onClick={onAction}
          style={{
            marginLeft: 'auto',
            padding: '8px 16px',
            borderRadius: 10,
            border: 'none',
            background: C.green,
            color: C.white,
            fontFamily: 'Figtree',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {actionLabel} →
        </button>
      </div>
    </div>
  );
}

// ── Calendar (admin "All Jobs") ───────────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function pad2(n: number) { return String(n).padStart(2, '0'); }
function isoOf(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function JobCalendar({ jobs, onOpen, onReschedule }: { jobs: WorkOrder[]; onOpen: (id: string) => void; onReschedule?: (id: string, date: string) => void }) {
  const [dragOverIso, setDragOverIso] = useState<string | null>(null);
  useEffect(() => {
    const clear = () => setDragOverIso(null);
    document.addEventListener('dragend', clear);
    return () => document.removeEventListener('dragend', clear);
  }, []);

  // Open on the month of the most recent scheduled job (falling back to today).
  const [cursor, setCursor] = useState(() => {
    const dates = jobs.map((j) => j.scheduledDate).filter(Boolean).sort();
    const base = dates.length ? dates[dates.length - 1] : isoOf(new Date());
    const [yy, mm] = base.split('-').map(Number);
    return { y: yy, m0: mm - 1 };
  });

  const byDate = useMemo(() => {
    const m = new Map<string, WorkOrder[]>();
    for (const j of jobs) {
      if (!j.scheduledDate) continue;
      const arr = m.get(j.scheduledDate);
      if (arr) arr.push(j); else m.set(j.scheduledDate, [j]);
    }
    return m;
  }, [jobs]);

  const { y, m0 } = cursor;
  const todayIso = isoOf(new Date());
  const monthLabel = new Date(y, m0, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const first = new Date(y, m0, 1);
  const startOffset = (first.getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => new Date(y, m0, 1 - startOffset + i));

  const step = (delta: number) => setCursor((c) => {
    const d = new Date(c.y, c.m0 + delta, 1);
    return { y: d.getFullYear(), m0: d.getMonth() };
  });
  const goToday = () => { const n = new Date(); setCursor({ y: n.getFullYear(), m0: n.getMonth() }); };

  const navBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 };

  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: '1px solid #F3F3F3' }}>
        <button onClick={() => step(-1)} style={navBtn} title="Previous month">‹</button>
        <button onClick={() => step(1)} style={navBtn} title="Next month">›</button>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.green, marginLeft: 4 }}>{monthLabel}</div>
        <button onClick={goToday} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Today</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #F3F3F3', background: C.seasalt }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{w}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((d, i) => {
          const iso = isoOf(d);
          const inMonth = d.getMonth() === m0;
          const dayJobs = byDate.get(iso) ?? [];
          const isToday = iso === todayIso;
          const isDropTarget = dragOverIso === iso;
          return (
            <div key={i}
              onDragOver={onReschedule ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverIso !== iso) setDragOverIso(iso); } : undefined}
              onDrop={onReschedule ? (e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                setDragOverIso(null);
                if (id) onReschedule(id, iso);
              } : undefined}
              style={{
                minHeight: 160,
                borderRight: (i % 7 !== 6) ? '1px solid #F3F3F3' : 'none',
                borderBottom: '1px solid #F3F3F3',
                background: isDropTarget ? C.honeydew : inMonth ? C.white : '#FBFCFD',
                boxShadow: isDropTarget ? `inset 0 0 0 2px ${C.green}` : 'none',
                padding: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: inMonth ? (isToday ? C.white : '#1a1a1a') : '#C7CDD3',
                  background: isToday ? C.green : 'transparent',
                  minWidth: 22, height: 22, borderRadius: 99, padding: '0 6px',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>{d.getDate()}</span>
                {dayJobs.length > 0 && <span style={{ fontSize: 10, color: C.slate, fontWeight: 700 }}>{dayJobs.length}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', maxHeight: 280 }}>
                {dayJobs.map((j) => <CalendarJobCard key={j.id} wo={j} onOpen={() => onOpen(j.id)} draggable={!!onReschedule} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarJobCard({ wo, onOpen, draggable }: { wo: WorkOrder; onOpen: () => void; draggable?: boolean }) {
  const sc = STATUS_COLORS[wo.status];
  const priorityColor = wo.priority === 'high' ? '#C0321A' : wo.priority === 'low' ? C.slate : C.opal;
  return (
    <button
      onClick={onOpen}
      draggable={draggable}
      onDragStart={draggable ? (e) => { e.dataTransfer.setData('text/plain', wo.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      title={draggable ? 'Drag to another day to reschedule' : undefined}
      style={{
        textAlign: 'left', width: '100%',
        border: '1px solid #EBEBEB', borderLeft: `3px solid ${priorityColor}`, borderRadius: 10,
        background: C.white, padding: '9px 11px', cursor: draggable ? 'grab' : 'pointer',
        display: 'flex', flexDirection: 'column', gap: 5, fontFamily: 'Figtree',
      }}>
      {/* Company name */}
      <span style={{ fontSize: 12, fontWeight: 700, color: C.green, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={wo.customer}>{wo.customer}</span>
      {/* Job title */}
      <span style={{ fontSize: 11, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={wo.title}>{wo.title}</span>
      {/* Technician */}
      <span style={{ fontSize: 10, color: wo.assignedTo ? C.slate : '#B45309', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {wo.assignedTo ?? 'Unassigned'}
      </span>
      {/* Status */}
      <span style={{ alignSelf: 'flex-start', fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: sc.bg, color: sc.color, whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>{sc.label}</span>
    </button>
  );
}

// ── Non-templated ("Other") job — manually-uploaded PDF report ─────

export function openBase64Pdf(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// A single non-templated ("Other") form instance — its report is an uploaded PDF.
export function OtherFormCard({ inst, disabled, onUpload, onRemove }: {
  inst: WorkOrderForm;
  disabled: boolean;
  onUpload: (name: string, base64: string) => void;
  onRemove: () => void;
}) {
  const read = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => onUpload(file.name, String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  };
  return (
    <div style={{ background: C.white, borderRadius: 14, border: '1px solid #EBEBEB', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: C.slate }}>Non-templated — upload the PDF report for this job.</div>
      {inst.reportPdfBase64 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => openBase64Pdf(inst.reportPdfBase64!, inst.reportFileName ?? 'report.pdf')}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 10, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            ⬇ {inst.reportFileName ?? 'Download report PDF'}
          </button>
          {!disabled && (
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Replace<input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={read} />
              </label>
              <button type="button" onClick={onRemove} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
            </div>
          )}
        </div>
      ) : disabled ? (
        <div style={{ fontSize: 13, color: '#B45309' }}>No report PDF attached.</div>
      ) : (
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '18px', borderRadius: 10, border: '1.5px dashed #CBD5DD', background: '#F9F9F9', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          ⬆ Upload PDF report
          <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={read} />
        </label>
      )}
    </div>
  );
}

// ── Fill-form view ────────────────────────────────────────────────

function TechFillFormView({
  workOrder,
  onBack,
  onSignOut,
}: {
  workOrder: WorkOrder;
  onBack: () => void;
  onSignOut?: () => void;
}) {
  const store = useWorkOrderStore();
  const { user } = usePermissions();
  const me = user.full_name || DEMO_TECHNICIAN;
  const [forms, setForms] = useState<WorkOrderForm[]>(() => workOrder.forms.map((f) => ({ ...f, values: { ...(f.values ?? {}) } })));
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const setField = (i: number, id: string, val: string | boolean) =>
    setForms((fs) => fs.map((f, idx) => (idx === i ? { ...f, values: { ...(f.values ?? {}), [id]: val } } : f)));
  const setReport = (i: number, name: string, base64: string) =>
    setForms((fs) => fs.map((f, idx) => (idx === i ? { ...f, reportFileName: name || undefined, reportPdfBase64: base64 || undefined } : f)));

  const missingRequired = useMemo(() => {
    const out: string[] = [];
    for (const inst of forms) {
      const tpl = store.getTemplate(inst.templateId);
      if (!tpl) {
        if (!inst.reportPdfBase64) out.push(`${inst.label}: PDF report`);
        continue;
      }
      // container groups contribute their children, not themselves
      const flat = tpl.fields.flatMap((f) => (f.type === 'group' && f.children ? f.children : [f]));
      for (const f of flat) {
        if (!f.required) continue;
        const v = (inst.values ?? {})[f.id];
        if (v === undefined || v === '' || v === false) out.push(`${inst.label}: ${f.label}`);
      }
    }
    return out;
  }, [forms, store]);

  const readOnly = workOrder.status === 'submitted' || workOrder.status === 'reviewed' || workOrder.status === 'completed';

  const handleSaveDraft = () => {
    store.saveDraft(workOrder.id, forms);
    setSavedAt(new Date().toLocaleTimeString());
  };
  const handleSubmit = () => {
    if (missingRequired.length > 0) return;
    store.submit(workOrder.id, forms, me);
    onBack();
  };

  return (
    <Shell
      onBack={onBack}
      onSignOut={onSignOut}
      title={workOrder.title || 'Work Order'}
      subtitle={`${workOrder.id} · ${workOrder.customer} · ${forms.length} form${forms.length === 1 ? '' : 's'}`}
      crumb="Technician"
    >
      {forms.map((inst, i) => {
        const tpl = store.getTemplate(inst.templateId);
        return (
          <div key={inst.id} style={{ marginBottom: 18 }}>
            {forms.length > 1 && (
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Form {i + 1} of {forms.length} · {inst.label}
              </div>
            )}
            {tpl ? (
              isOverlay(tpl) ? (
                <OverlayFormRenderer template={tpl} values={inst.values ?? {}} onChange={(fid, val) => setField(i, fid, val)} disabled={readOnly} />
              ) : (
                <FormPaper>
                  <FormHeader template={tpl} workOrder={workOrder} />
                  <FieldList fields={tpl.fields} values={inst.values ?? {}} onChange={(fid, val) => setField(i, fid, val)} disabled={readOnly} chargerCustomerId={workOrder.customerId} />
                </FormPaper>
              )
            ) : (
              <OtherFormCard inst={inst} disabled={readOnly} onUpload={(name, b64) => setReport(i, name, b64)} onRemove={() => setReport(i, '', '')} />
            )}
          </div>
        );
      })}

      {readOnly ? (
        <div
          style={{
            marginTop: 18,
            padding: '12px 16px',
            background: C.honeydew,
            color: C.green,
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          This report has been submitted. The PIC handles edits from here.
        </div>
      ) : (
        <div
          style={{
            marginTop: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 16,
            background: C.white,
            borderRadius: 12,
            border: '1px solid #EBEBEB',
          }}
        >
          {missingRequired.length > 0 && (
            <div
              style={{
                fontSize: 12,
                color: '#C0321A',
                background: '#FDEAEA',
                padding: '8px 12px',
                borderRadius: 8,
              }}
            >
              Required: {missingRequired.join(', ')}
            </div>
          )}
          {savedAt && (
            <div style={{ fontSize: 11, color: C.slate, textAlign: 'center' }}>
              Draft saved at {savedAt}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleSaveDraft}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: 10,
                border: `1px solid ${C.green}`,
                background: 'transparent',
                color: C.green,
                fontFamily: 'Figtree',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Save draft
            </button>
            <button
              onClick={handleSubmit}
              disabled={missingRequired.length > 0}
              style={{
                flex: 2,
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background: missingRequired.length > 0 ? '#A5D6A7' : C.green,
                color: C.white,
                fontFamily: 'Figtree',
                fontSize: 13,
                fontWeight: 700,
                cursor: missingRequired.length > 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Submit report
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ── Form rendering helpers (also used by PIC) ─────────────────────

export function FormPaper({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 14,
        border: '1px solid #EBEBEB',
        padding: '28px 28px 32px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
      }}
    >
      {children}
    </div>
  );
}

export interface FormHeaderInfo {
  id: string;
  scheduledDate: string;
  assignedTo: string | null;
}

export function FormHeader({
  template,
  workOrder,
}: {
  template: { name: string; description: string };
  workOrder: FormHeaderInfo;
}) {
  return (
    <div
      style={{
        borderBottom: '2px solid ' + C.green,
        paddingBottom: 14,
        marginBottom: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Logo height={26} />
        <div style={{ flex: 1, minWidth: 140 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: C.green,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              lineHeight: 1.3,
            }}
          >
            {template.name}
          </div>
          {template.description && (
            <div
              style={{
                fontSize: 11,
                color: C.slate,
                marginTop: 3,
                lineHeight: 1.4,
              }}
            >
              {template.description}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 14px',
          fontSize: 11,
          color: C.slate,
        }}
      >
        <span>
          <strong style={{ color: '#1a1a1a' }}>Ref:</strong> {workOrder.id}
        </span>
        <span>
          <strong style={{ color: '#1a1a1a' }}>Scheduled:</strong> {workOrder.scheduledDate}
        </span>
        <span>
          <strong style={{ color: '#1a1a1a' }}>Technician:</strong> {workOrder.assignedTo ?? '—'}
        </span>
      </div>
    </div>
  );
}

export function FieldList({
  fields,
  values,
  onChange,
  disabled = false,
  chargerCustomerId,
}: {
  fields: FormField[];
  values: FormValues;
  onChange: (id: string, val: string | boolean) => void;
  disabled?: boolean;
  // Scope charger-field options to this work order's customer (Registry project
  // id or CPO location id). Omit to list all chargers.
  chargerCustomerId?: string | null;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {fields.map((f) => (
        <FieldRow key={f.id} field={f} values={values} onChange={onChange} disabled={disabled} chargerCustomerId={chargerCustomerId} />
      ))}
    </div>
  );
}

// Combined charger list — Charger Registry (site_chargers) + CPO chargers.
// When a customerId is given (a Registry project id or a CPO location id, from the
// work order) the list is scoped to that customer's chargers only.
// Cached per customer so multiple charger fields don't refetch.
const chargerOptionsCache = new Map<string, Promise<string[]>>();
async function fetchChargerOptions(customerId?: string | null): Promise<string[]> {
  const key = customerId ?? '__all__';
  const hit = chargerOptionsCache.get(key);
  if (hit) return hit;
  const promise = (async () => {
    const regQuery = customerId
      ? supabase.from('site_chargers').select('asset_tag, brand_model, project_sites!inner(name, project_id)').eq('project_sites.project_id', customerId)
      : supabase.from('site_chargers').select('asset_tag, brand_model, project_sites(name)');
    const cpoQuery = customerId
      ? supabase.from('cpo_chargers').select('charger_code, brand_model, cpo_locations(name)').eq('location_id', customerId)
      : supabase.from('cpo_chargers').select('charger_code, brand_model, cpo_locations(name)');
    const [reg, cpo] = await Promise.all([regQuery, cpoQuery]);
    const opts: string[] = [];
    for (const c of (reg.data ?? []) as Array<{ asset_tag?: string; brand_model?: string | null; project_sites?: { name?: string } | null }>) {
      if (!c.asset_tag) continue;
      const site = c.project_sites?.name;
      opts.push(`${c.asset_tag}${c.brand_model ? ' — ' + c.brand_model : ''}${site ? ' @ ' + site : ''} · Registry`);
    }
    for (const c of (cpo.data ?? []) as Array<{ charger_code?: string; brand_model?: string | null; cpo_locations?: { name?: string } | null }>) {
      if (!c.charger_code) continue;
      const loc = c.cpo_locations?.name;
      opts.push(`${c.charger_code}${c.brand_model ? ' — ' + c.brand_model : ''}${loc ? ' @ ' + loc : ''} · CPO`);
    }
    return opts.sort((a, b) => a.localeCompare(b));
  })();
  chargerOptionsCache.set(key, promise);
  return promise;
}

function ChargerSelect({
  value,
  onChange,
  disabled,
  customerId,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  customerId?: string | null;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;
    let live = true;
    setLoading(true);
    fetchChargerOptions(customerId)
      .then((o) => { if (live) { setOptions(o); setLoading(false); } })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [disabled, customerId]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  if (disabled) {
    return (
      <div style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, background: '#F9F9F9', color: value ? '#1a1a1a' : C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value || '—'}
      </div>
    );
  }

  const all = value && !options.includes(value) ? [value, ...options] : options;
  const ql = q.trim().toLowerCase();
  const filtered = ql ? all.filter((o) => o.toLowerCase().includes(ql)) : all;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQ(''); }}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${open ? C.green : '#EBEBEB'}`, fontFamily: 'Figtree', fontSize: 13, background: C.white, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? '#1a1a1a' : C.slate }}>
          {loading ? 'Loading chargers…' : value || 'Select charger…'}
        </span>
        <ChevronDown size={16} strokeWidth={2.25} style={{ color: C.slate, flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 60, top: 'calc(100% + 6px)', background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.14)', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chargers…"
              style={{ width: '100%', padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.seasalt, boxSizing: 'border-box' }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={13} /></span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {value && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                style={{ flexShrink: 0, width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                — Clear selection —
              </button>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: '12px', textAlign: 'center', color: C.slate, fontSize: 12 }}>
                {loading ? 'Loading chargers…' : 'No matching chargers'}
              </div>
            ) : filtered.map((o) => {
              const active = o === value;
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => { onChange(o); setOpen(false); }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.seasalt; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  style={{ flexShrink: 0, width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: active ? C.honeydew : 'transparent', color: active ? C.green : '#1a1a1a', fontFamily: 'Figtree', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function SignaturePad({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  disabled: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  // Paint an already-saved signature onto the editable canvas (e.g. PIC review
  // of a submitted report) — otherwise the pad starts blank despite a value.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (disabled || !canvas || !value || dirty.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvasRef.current!.setPointerCapture(e.pointerId);
  };

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1a1a';
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dirty.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current) onChange(canvasRef.current!.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange('');
  };

  if (disabled) {
    return value ? (
      <img src={value} alt="Signature" style={{ width: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white }} />
    ) : (
      <div style={{ padding: '24px', textAlign: 'center', color: C.slate, fontSize: 12, background: '#F9F9F9', borderRadius: 10, border: '1px dashed #EBEBEB' }}>Not signed</div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <canvas
        ref={canvasRef}
        width={600}
        height={180}
        onPointerDown={start}
        onPointerMove={moveDraw}
        onPointerUp={end}
        onPointerLeave={end}
        style={{ width: '100%', height: 160, touchAction: 'none', borderRadius: 10, border: '1.5px dashed #CBD5DD', background: C.white, cursor: 'crosshair' }}
      />
      <button
        type="button"
        onClick={clear}
        style={{ alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
      >
        Clear signature
      </button>
    </div>
  );
}

function FieldRow({
  field,
  values,
  onChange,
  disabled,
  chargerCustomerId,
}: {
  field: FormField;
  values: FormValues;
  onChange: (id: string, val: string | boolean) => void;
  disabled: boolean;
  chargerCustomerId?: string | null;
}) {
  const value = values[field.id];
  if (field.type === 'section') {
    return (
      <div
        style={{
          marginTop: 12,
          paddingBottom: 6,
          borderBottom: '1px solid #EBEBEB',
          fontSize: 13,
          fontWeight: 700,
          color: C.green,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
        }}
      >
        {field.label}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    const checked = value === true;
    return (
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 10,
          background: checked ? C.honeydew : '#F9F9F9',
          border: `1px solid ${checked ? C.green : '#EBEBEB'}`,
          cursor: disabled ? 'default' : 'pointer',
          fontSize: 13,
          color: '#1a1a1a',
          transition: 'background .15s, border-color .15s',
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(field.id, e.target.checked)}
          style={{ width: 18, height: 18, accentColor: C.green, cursor: disabled ? 'default' : 'pointer' }}
        />
        <span>{field.label}</span>
        {field.required && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#C0321A' }}>required</span>}
      </label>
    );
  }

  if (field.type === 'group' && field.children) {
    return (
      <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, background: C.white }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{field.label}</div>
        {field.children.length === 0 ? (
          <div style={{ fontSize: 12, color: C.slate }}>No fields in this group.</div>
        ) : (
          field.children.map((c) => (
            <FieldRow key={c.id} field={c} values={values} onChange={onChange} disabled={disabled} chargerCustomerId={chargerCustomerId} />
          ))
        )}
      </div>
    );
  }

  if (field.type === 'group') {
    const checked = value === true;
    const photoKey = `${field.id}::photo`;
    const remarkKey = `${field.id}::remark`;
    const photoSrc = typeof values[photoKey] === 'string' ? (values[photoKey] as string) : '';
    const remark = typeof values[remarkKey] === 'string' ? (values[remarkKey] as string) : '';
    const readGroupPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onloadend = () => onChange(photoKey, String(reader.result));
      reader.readAsDataURL(file);
    };
    return (
      <div style={{ border: `1px solid ${checked ? C.green : '#EBEBEB'}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, background: C.white }}>
        {/* The question (checkbox) */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: disabled ? 'default' : 'pointer', fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
          <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(field.id, e.target.checked)}
            style={{ width: 18, height: 18, accentColor: C.green, cursor: disabled ? 'default' : 'pointer' }} />
          <span>{field.label}{field.required && <span style={{ color: '#C0321A', marginLeft: 6 }}>*</span>}</span>
        </label>

        {/* Photo */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{field.photoLabel || 'Photo'}</label>
          {photoSrc ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <img src={photoSrc} alt={field.photoLabel || 'Photo'} style={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 10, border: '1px solid #EBEBEB', background: '#F9F9F9' }} />
              {!disabled && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    <Camera size={12} strokeWidth={2.25} /> Replace
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={readGroupPhoto} />
                  </label>
                  <button type="button" onClick={() => onChange(photoKey, '')} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                </div>
              )}
            </div>
          ) : disabled ? (
            <div style={{ padding: '16px', textAlign: 'center', color: C.slate, fontSize: 12, background: '#F9F9F9', borderRadius: 10, border: '1px dashed #EBEBEB' }}>No photo</div>
          ) : (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px', borderRadius: 10, border: '1.5px dashed #CBD5DD', background: '#F9F9F9', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <Camera size={16} strokeWidth={2.25} /> Take or upload photo
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={readGroupPhoto} />
            </label>
          )}
        </div>

        {/* Remarks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{field.remarkLabel || 'Remarks'}</label>
          <textarea value={remark} disabled={disabled} rows={2} onChange={(e) => onChange(remarkKey, e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.5, background: disabled ? '#F9F9F9' : C.white }} />
        </div>
      </div>
    );
  }

  if (field.type === 'photo') {
    const src = typeof value === 'string' ? value : '';
    const readPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onloadend = () => onChange(field.id, String(reader.result));
      reader.readAsDataURL(file);
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {field.label}
          {field.required && <span style={{ color: '#C0321A', marginLeft: 6 }}>*</span>}
        </label>
        {src ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <img src={src} alt={field.label} style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 10, border: '1px solid #EBEBEB', background: '#F9F9F9' }} />
            {!disabled && (
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  <Camera size={13} strokeWidth={2.25} /> Replace
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={readPhoto} />
                </label>
                <button type="button" onClick={() => onChange(field.id, '')}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ) : disabled ? (
          <div style={{ padding: '20px', textAlign: 'center', color: C.slate, fontSize: 12, background: '#F9F9F9', borderRadius: 10, border: '1px dashed #EBEBEB' }}>No photo</div>
        ) : (
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '18px', borderRadius: 10, border: '1.5px dashed #CBD5DD', background: '#F9F9F9', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            <Camera size={16} strokeWidth={2.25} /> Take or upload photo
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={readPhoto} />
          </label>
        )}
      </div>
    );
  }

  if (field.type === 'date') {
    const strVal = typeof value === 'string' ? value : '';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {field.label}
          {field.required && <span style={{ color: '#C0321A', marginLeft: 6 }}>*</span>}
        </label>
        <input
          type="date"
          value={strVal}
          disabled={disabled}
          onChange={(e) => onChange(field.id, e.target.value)}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: disabled ? '#F9F9F9' : C.white }}
        />
      </div>
    );
  }

  if (field.type === 'select') {
    const strVal = typeof value === 'string' ? value : '';
    const options = (field.options ?? []).map((o) => o.trim()).filter(Boolean);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {field.label}
          {field.required && <span style={{ color: '#C0321A', marginLeft: 6 }}>*</span>}
        </label>
        <select
          value={strVal}
          disabled={disabled}
          onChange={(e) => onChange(field.id, e.target.value)}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: disabled ? '#F9F9F9' : C.white, color: strVal ? '#1a1a1a' : C.slate }}
        >
          <option value="">Select…</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'signature') {
    const src = typeof value === 'string' ? value : '';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {field.label}
          {field.required && <span style={{ color: '#C0321A', marginLeft: 6 }}>*</span>}
        </label>
        <SignaturePad value={src} disabled={disabled} onChange={(v) => onChange(field.id, v)} />
      </div>
    );
  }

  if (field.type === 'charger') {
    const strVal = typeof value === 'string' ? value : '';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {field.label}
          {field.required && <span style={{ color: '#C0321A', marginLeft: 6 }}>*</span>}
        </label>
        <ChargerSelect value={strVal} disabled={disabled} customerId={chargerCustomerId} onChange={(v) => onChange(field.id, v)} />
      </div>
    );
  }

  const isTextarea = field.type === 'textarea';
  const strVal = typeof value === 'string' ? value : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {field.label}
        {field.required && <span style={{ color: '#C0321A', marginLeft: 6 }}>*</span>}
      </label>
      {isTextarea ? (
        <textarea
          value={strVal}
          disabled={disabled}
          rows={3}
          onChange={(e) => onChange(field.id, e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #EBEBEB',
            fontFamily: 'Figtree',
            fontSize: 13,
            outline: 'none',
            resize: 'vertical',
            lineHeight: 1.5,
            background: disabled ? '#F9F9F9' : C.white,
          }}
        />
      ) : (
        <input
          value={strVal}
          disabled={disabled}
          onChange={(e) => onChange(field.id, e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #EBEBEB',
            fontFamily: 'Figtree',
            fontSize: 13,
            outline: 'none',
            background: disabled ? '#F9F9F9' : C.white,
          }}
        />
      )}
    </div>
  );
}
