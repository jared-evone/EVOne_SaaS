import { useEffect, useMemo, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { FilterSelect, selectionCount, type FilterGroup, type FilterSelection } from '../components/FilterSelect';
import { supabase } from '../lib/supabase';
import { setRegistryTarget, type RegistryTarget } from '../lib/registryNav';
import { useScreenNav } from '../App';
import { Search, ChevronRight } from 'lucide-react';
import { ltaSchedule, ltaScheduleBase, toPerformed, type LtaFormType, type LetterForms } from './Projects';

// ── The registry-wide work queue ──────────────────────────────────
// Every open item across the Charger Registry, with due dates — overdue AND
// upcoming — so the team works from one list instead of opening registries one
// by one. Clicking an item deep-links into the exact registry/site/charger.

const UPCOMING_HORIZON_DAYS = 180;

type TodoKind = 'formA' | 'formD' | 'form1' | 'invoice' | 'cpo_renewal' | 'warranty';

const KIND_META: Record<TodoKind, { label: string; bg: string; color: string }> = {
  formA:       { label: 'Form A',       bg: '#FDEAEA', color: '#C0321A' },
  formD:       { label: 'Form D',       bg: '#FDEAEA', color: '#C0321A' },
  form1:       { label: 'Form 1',       bg: '#FFF0E0', color: '#B45309' },
  invoice:     { label: 'Invoice',      bg: '#FFF8E1', color: '#B07D00' },
  cpo_renewal: { label: 'CPO renewal',  bg: '#E3F0FF', color: '#1A62C0' },
  warranty:    { label: 'Warranty',     bg: '#F0E8FF', color: '#6B21A8' },
};

interface TodoItem {
  id: string;
  kind: TodoKind;
  overdue: boolean;
  dueDate: string | null;   // null = no schedule (e.g. Form 1 missing)
  title: string;
  detail: string;
  projectName: string;
  siteName: string;
  chargerTag: string | null;
  target: RegistryTarget;
}

interface ChargerRow {
  id: string;
  asset_tag: string;
  brand_model: string | null;
  form_1_path: string | null;
  turn_on_date: string | null;
  procurement_date: string | null;
  lta_letter_date: string | null;
  lta_letter_forms: LetterForms | null;
  warranty_end_date: string | null;
}

interface SiteRow {
  id: string;
  project_id: string;
  name: string;
  managed_cpo: boolean;
  cpo_platform_fee: number | null;
  cpo_contract_start: string | null;
  cpo_contract_months: number | null;
  site_chargers: ChargerRow[];
}

interface LtaRow {
  id: string;
  charger_id: string;
  form_type: LtaFormType;
  performed_at: string;
  invoice_path: string | null;
  period_n: number | null;
}

const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addMonthsYmd = (s: string, m: number) => { const d = new Date(s + 'T00:00:00'); d.setMonth(d.getMonth() + m); return toYmd(d); };
const daysFromToday = (s: string): number => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(s + 'T00:00:00').getTime() - t.getTime()) / 86400000);
};
const fmtDate = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const relDue = (s: string): string => {
  const d = daysFromToday(s);
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return 'Due today';
  return `In ${d}d`;
};
const monthKey = (s: string) => s.slice(0, 7);

export function ScreenRegistryTodo() {
  const go = useScreenNav();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TodoItem[]>([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterSelection>({});
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, filters]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ data: projs }, { data: siteRows }, { data: ltaRows }, { data: custRows }] = await Promise.all([
        supabase.from('projects').select('id, name, customer_id'),
        supabase.from('project_sites').select('id, project_id, name, managed_cpo, cpo_platform_fee, cpo_contract_start, cpo_contract_months, site_chargers(id, asset_tag, brand_model, form_1_path, turn_on_date, procurement_date, lta_letter_date, lta_letter_forms, warranty_end_date)'),
        supabase.from('charger_lta_records').select('id, charger_id, form_type, performed_at, invoice_path, period_n').order('performed_at', { ascending: false }),
        supabase.from('customers').select('id, type'),
      ]);
      if (cancelled) return;

      const projects = (projs ?? []) as { id: string; name: string; customer_id: string | null }[];
      const sites = (siteRows ?? []) as SiteRow[];
      const lta = (ltaRows ?? []) as LtaRow[];
      const custType = new Map(((custRows ?? []) as { id: string; type: string }[]).map((c) => [c.id, c.type]));
      const projectById = new Map(projects.map((p) => [p.id, p]));

      const byCharger = new Map<string, { A: LtaRow[]; D: LtaRow[] }>();
      for (const r of lta) {
        const e = byCharger.get(r.charger_id) ?? { A: [], D: [] };
        e[r.form_type].push(r); // newest first
        byCharger.set(r.charger_id, e);
      }

      const out: TodoItem[] = [];
      for (const site of sites) {
        const project = projectById.get(site.project_id);
        if (!project) continue;
        const isResidential = (project.customer_id ? custType.get(project.customer_id) : null) === 'residential';
        const formAMonths = isResidential ? 24 : 6;

        // Managed-CPO subscription renewal — overdue or inside the horizon.
        if (site.managed_cpo && site.cpo_contract_start && site.cpo_contract_months) {
          const expiry = addMonthsYmd(site.cpo_contract_start, site.cpo_contract_months);
          const d = daysFromToday(expiry);
          if (d <= UPCOMING_HORIZON_DAYS) {
            out.push({
              id: `${site.id}-cpo`, kind: 'cpo_renewal', overdue: d < 0, dueDate: expiry,
              title: 'Platform subscription renewal',
              detail: site.cpo_platform_fee != null ? `Invoice the next term · S$${Number(site.cpo_platform_fee).toLocaleString('en-SG')}` : 'Invoice the next term',
              projectName: project.name, siteName: site.name, chargerTag: null,
              target: { projectId: project.id, siteId: site.id },
            });
          }
        }

        for (const c of site.site_chargers) {
          const e = byCharger.get(c.id) ?? { A: [], D: [] };
          const base = { projectName: project.name, siteName: site.name, chargerTag: c.asset_tag };

          // Form A / D — one item per charger per form: the earliest OVERDUE cycle
          // if any, else the next upcoming due date within the horizon.
          const formItem = (ft: LtaFormType, months: number, kind: TodoKind) => {
            const rows = ft === 'A' ? e.A : e.D;
            const sched = ltaSchedule(ltaScheduleBase(c, months, ft), months, rows.map(toPerformed));
            const firstMissed = sched.periods.find((p) => !p.performedAt);
            if (firstMissed) {
              out.push({
                id: `${c.id}-${ft}-over`, kind, overdue: true, dueDate: firstMissed.due,
                title: `Form ${ft} inspection overdue`,
                detail: `${sched.overdueCount} cycle${sched.overdueCount === 1 ? '' : 's'} outstanding${sched.nextDue ? ` · next scheduled ${fmtDate(sched.nextDue)}` : ''}`,
                ...base, target: { projectId: project.id, siteId: site.id, chargerId: c.id, chargerTab: 'maintenance' },
              });
            } else if (sched.nextDue && daysFromToday(sched.nextDue) <= UPCOMING_HORIZON_DAYS) {
              out.push({
                id: `${c.id}-${ft}-next`, kind, overdue: false, dueDate: sched.nextDue,
                title: `Form ${ft} inspection due`,
                detail: 'Book the inspection ahead of the due date',
                ...base, target: { projectId: project.id, siteId: site.id, chargerId: c.id, chargerTab: 'maintenance' },
              });
            }
          };
          formItem('A', formAMonths, 'formA');
          if (!isResidential) formItem('D', 12, 'formD');

          if (!c.form_1_path) {
            out.push({
              id: `${c.id}-form1`, kind: 'form1', overdue: false, dueDate: null,
              title: 'Form 1 not uploaded',
              detail: 'Attach the installation compliance form',
              ...base, target: { projectId: project.id, siteId: site.id, chargerId: c.id, chargerTab: 'details' },
            });
          }

          const invItem = (rows: LtaRow[], ft: LtaFormType) => {
            if (rows[0] && !rows[0].invoice_path) {
              out.push({
                id: `${c.id}-inv${ft}`, kind: 'invoice', overdue: false, dueDate: null,
                title: `Form ${ft} invoice missing`,
                detail: `Inspection performed ${fmtDate(rows[0].performed_at)} — attach the invoice`,
                ...base, target: { projectId: project.id, siteId: site.id, chargerId: c.id, chargerTab: 'maintenance' },
              });
            }
          };
          invItem(e.A, 'A');
          if (!isResidential) invItem(e.D, 'D');

          // Warranty about to lapse — a chance to flag paid maintenance.
          if (c.warranty_end_date) {
            const d = daysFromToday(c.warranty_end_date);
            if (d >= 0 && d <= 60) {
              out.push({
                id: `${c.id}-warranty`, kind: 'warranty', overdue: false, dueDate: c.warranty_end_date,
                title: 'Warranty expiring',
                detail: 'Review coverage / offer a maintenance contract',
                ...base, target: { projectId: project.id, siteId: site.id, chargerId: c.id, chargerTab: 'warranty' },
              });
            }
          }
        }
      }

      // Most urgent first: overdue by how late, then upcoming by date, dateless last.
      out.sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return a.projectName.localeCompare(b.projectName);
      });
      setItems(out);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Filters ──
  const thisMonth = monthKey(toYmd(new Date()));
  const nextMonth = monthKey(addMonthsYmd(toYmd(new Date()), 1));
  const windowOf = (it: TodoItem): string => {
    if (!it.dueDate) return 'nodate';
    if (it.overdue || daysFromToday(it.dueDate) < 0) return 'overdue';
    const mk = monthKey(it.dueDate);
    if (mk === thisMonth) return 'this_month';
    if (mk === nextMonth) return 'next_month';
    return 'later';
  };

  const groups: FilterGroup[] = useMemo(() => {
    const n = (f: (it: TodoItem) => boolean) => String(items.filter(f).length);
    return [
      {
        key: 'kind', label: 'Issue type',
        options: (Object.keys(KIND_META) as TodoKind[])
          .map((k) => ({ value: k, label: KIND_META[k].label, sub: n((it) => it.kind === k) }))
          .filter((o) => o.sub !== '0'),
      },
      {
        key: 'window', label: 'Due',
        options: [
          { value: 'overdue',    label: 'Overdue',       sub: n((it) => windowOf(it) === 'overdue') },
          { value: 'this_month', label: 'This month',    sub: n((it) => windowOf(it) === 'this_month') },
          { value: 'next_month', label: 'Next month',    sub: n((it) => windowOf(it) === 'next_month') },
          { value: 'later',      label: `Later (≤${UPCOMING_HORIZON_DAYS}d)`, sub: n((it) => windowOf(it) === 'later') },
          { value: 'nodate',     label: 'No due date',   sub: n((it) => windowOf(it) === 'nodate') },
        ].filter((o) => o.sub !== '0'),
      },
    ].filter((g) => g.options.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const anyOf = (key: string, test: (v: string) => boolean) => {
    const vs = filters[key];
    return !vs?.length || vs.some(test);
  };
  const q = search.trim().toLowerCase();
  const visible = items.filter((it) =>
    anyOf('kind', (v) => it.kind === v) &&
    anyOf('window', (v) => windowOf(it) === v) &&
    (!q || `${it.projectName} ${it.siteName} ${it.chargerTag ?? ''} ${it.title}`.toLowerCase().includes(q)));

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const kpi = {
    overdue: items.filter((it) => windowOf(it) === 'overdue').length,
    thisMonth: items.filter((it) => windowOf(it) === 'this_month').length,
    nextMonth: items.filter((it) => windowOf(it) === 'next_month').length,
    nodate: items.filter((it) => windowOf(it) === 'nodate').length,
  };

  const open = (it: TodoItem) => {
    setRegistryTarget(it.target);
    go('projects');
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        <KPICard label="Overdue"        value={loading ? '…' : String(kpi.overdue)}   accent sub="Act on these first" />
        <KPICard label="Due This Month" value={loading ? '…' : String(kpi.thisMonth)} sub="Book & invoice ahead" />
        <KPICard label="Due Next Month" value={loading ? '…' : String(kpi.nextMonth)} sub="Plan the schedule" />
        <KPICard label="No Due Date"    value={loading ? '…' : String(kpi.nodate)}    sub="Form 1s & missing invoices" />
      </div>

      {/* Toolbar: search + one filter dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search registry, site, charger…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        <div style={{ width: 250 }}>
          <FilterSelect groups={groups} selected={filters} onChange={setFilters} placeholder="All to-dos" />
        </div>
        {(selectionCount(filters) > 0 || search) && (
          <span style={{ fontSize: 11.5, color: C.slate, fontWeight: 600 }}>{visible.length} match{visible.length === 1 ? '' : 'es'}</span>
        )}
      </div>

      {/* The queue */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Building the to-do list…</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
            {items.length === 0 ? 'Nothing outstanding — the registry is fully up to date.' : 'No to-dos match these filters.'}
          </div>
        ) : (
          <>
            {pageRows.map((it, i) => {
              const meta = KIND_META[it.kind];
              return (
                <div key={it.id} onClick={() => open(it)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderTop: i === 0 ? 'none' : '1px solid #F3F3F3', cursor: 'pointer' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: meta.bg, color: meta.color, whiteSpace: 'nowrap', width: 96, textAlign: 'center', flexShrink: 0 }}>
                    {meta.label}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
                      {it.title}
                      {it.overdue && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 99, background: '#FDEAEA', color: '#C0321A', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Overdue</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.projectName} · {it.siteName}{it.chargerTag ? ` · ${it.chargerTag}` : ''} — {it.detail}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {it.dueDate ? (
                      <>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: it.overdue ? '#C0321A' : '#1a1a1a', whiteSpace: 'nowrap' }}>{fmtDate(it.dueDate)}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: it.overdue ? '#C0321A' : C.slate }}>{relDue(it.dueDate)}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: C.slate }}>—</div>
                    )}
                  </div>
                  <ChevronRight size={15} color={C.slate} style={{ flexShrink: 0 }} />
                </div>
              );
            })}
            {visible.length > PAGE_SIZE && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 16px', borderTop: '1px solid #EBEBEB' }}>
                <button onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={safePage <= 1}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: safePage <= 1 ? '#C9CFD5' : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: safePage <= 1 ? 'default' : 'pointer' }}>‹ Prev</button>
                <span style={{ fontSize: 11.5, color: C.slate, fontWeight: 600 }}>
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length}
                </span>
                <button onClick={() => setPage((v) => Math.min(totalPages, v + 1))} disabled={safePage >= totalPages}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: safePage >= totalPages ? '#C9CFD5' : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: safePage >= totalPages ? 'default' : 'pointer' }}>Next ›</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
