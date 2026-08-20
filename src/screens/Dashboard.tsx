import { useEffect, useMemo, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { ChargerLocationMap, type ChargerMapLocation } from '../components/ChargerLocationMap';
import { supabase } from '../lib/supabase';
import { ltaSchedule, ltaScheduleBase, toPerformed, type LtaFormType, type LetterForms } from './Projects';

interface ProjectRow {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  customer_id: string | null;
}

interface ChargerRow {
  id: string;
  asset_tag: string;
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
  address: string | null;
  latitude: number | null;
  longitude: number | null;
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

// The registry-wide outstanding categories, in display order. Same rules as the
// per-registry Overview tab, so the dashboard totals match what each registry
// reports about itself.
const ISSUE_KINDS = ['formA', 'formD', 'form1', 'invoice'] as const;
type IssueKind = (typeof ISSUE_KINDS)[number];
const ISSUE_META: Record<IssueKind, { label: string; sub: string; bg: string; color: string }> = {
  formA:   { label: 'Form A due',       sub: 'Inspection cycles overdue',            bg: '#FDEAEA', color: '#C0321A' },
  formD:   { label: 'Form D due',       sub: 'Annual inspection overdue',            bg: '#FDEAEA', color: '#C0321A' },
  form1:   { label: 'Form 1 missing',   sub: 'Installation form not uploaded',       bg: '#FFF0E0', color: '#B45309' },
  invoice: { label: 'Invoices missing', sub: 'Latest Form A/D has no invoice',       bg: '#FFF8E1', color: '#B07D00' },
};

export function ScreenDashboard() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [lta, setLta] = useState<LtaRow[]>([]);
  const [customerTypes, setCustomerTypes] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ data: projs }, { data: siteRows }, { data: ltaRows }, { data: custRows }] = await Promise.all([
        supabase.from('projects').select('id, name, status, customer_id'),
        supabase.from('project_sites').select('id, project_id, name, address, latitude, longitude, site_chargers(id, asset_tag, form_1_path, turn_on_date, procurement_date, lta_letter_date, lta_letter_forms, warranty_end_date)'),
        supabase.from('charger_lta_records').select('id, charger_id, form_type, performed_at, invoice_path, period_n').order('performed_at', { ascending: false }),
        supabase.from('customers').select('id, type'),
      ]);
      if (cancelled) return;
      setProjects((projs ?? []) as ProjectRow[]);
      setSites((siteRows ?? []) as SiteRow[]);
      setLta((ltaRows ?? []) as LtaRow[]);
      setCustomerTypes(new Map(((custRows ?? []) as { id: string; type: string }[]).map((c) => [c.id, c.type])));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const totalProjects   = projects.length;
  const activeProjects  = projects.filter((p) => p.status === 'active').length;
  const totalSites      = sites.length;
  const sitesWithCoords = sites.filter((s) => s.latitude !== null && s.longitude !== null);
  const totalChargers   = sites.reduce((sum, s) => sum + s.site_chargers.length, 0);
  const inWarrantyChargers = sites.reduce((sum, s) => sum + s.site_chargers.filter((c) => {
    if (!c.warranty_end_date) return false;
    return new Date(`${c.warranty_end_date}T00:00:00`).getTime() >= Date.now();
  }).length, 0);

  // Registry-wide outstanding issues — same rules the per-registry Overview uses.
  const outstanding = useMemo(() => {
    const byCharger = new Map<string, { A: LtaRow[]; D: LtaRow[] }>();
    for (const r of lta) {
      const e = byCharger.get(r.charger_id) ?? { A: [], D: [] };
      e[r.form_type].push(r); // rows arrive newest-first
      byCharger.set(r.charger_id, e);
    }
    const totals: Record<IssueKind, number> = { formA: 0, formD: 0, form1: 0, invoice: 0 };
    const perProject = new Map<string, Record<IssueKind, number>>();
    const bump = (projectId: string, kind: IssueKind) => {
      totals[kind]++;
      const rec = perProject.get(projectId) ?? { formA: 0, formD: 0, form1: 0, invoice: 0 };
      rec[kind]++;
      perProject.set(projectId, rec);
    };
    for (const site of sites) {
      const project = projectById.get(site.project_id);
      if (!project) continue;
      const isResidential = (project.customer_id ? customerTypes.get(project.customer_id) : null) === 'residential';
      const formAMonths = isResidential ? 24 : 6;
      for (const c of site.site_chargers) {
        const e = byCharger.get(c.id) ?? { A: [], D: [] };
        if (!c.form_1_path) bump(project.id, 'form1');
        if (ltaSchedule(ltaScheduleBase(c, formAMonths, 'A'), formAMonths, e.A.map(toPerformed)).overdueCount > 0) bump(project.id, 'formA');
        if (!isResidential && ltaSchedule(ltaScheduleBase(c, 12, 'D'), 12, e.D.map(toPerformed)).overdueCount > 0) bump(project.id, 'formD');
        if (e.A[0] && !e.A[0].invoice_path) bump(project.id, 'invoice');
        if (!isResidential && e.D[0] && !e.D[0].invoice_path) bump(project.id, 'invoice');
      }
    }
    const total = ISSUE_KINDS.reduce((n, k) => n + totals[k], 0);
    // Registries with the most open items, for the "needs attention" list.
    const worst = [...perProject.entries()]
      .map(([projectId, counts]) => ({
        project: projectById.get(projectId)!,
        counts,
        total: ISSUE_KINDS.reduce((n, k) => n + counts[k], 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
    return { totals, total, affectedRegistries: perProject.size, worst };
  }, [sites, lta, projectById, customerTypes]);

  // One pin per site. Pop-up shows site name + project + address + charger count.
  const locations: ChargerMapLocation[] = sitesWithCoords.map((s) => {
    const project = projectById.get(s.project_id);
    const count = s.site_chargers.length;
    const tail = `${count} charger${count === 1 ? '' : 's'}`;
    return {
      id: s.id,
      name: `${s.name} · ${tail}${project ? ` · ${project.name}` : ''}`,
      address: s.address,
      latitude: s.latitude as number,
      longitude: s.longitude as number,
      brand: null,
      csms_platform: null,
    };
  });

  const maxKind = Math.max(1, ...ISSUE_KINDS.map((k) => outstanding.totals[k]));

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <KPICard label="Projects"          value={totalProjects.toString()}     accent sub={`${activeProjects} active`} />
        <KPICard label="Sites"             value={totalSites.toString()}        sub={`${sitesWithCoords.length} mapped`} />
        <KPICard label="Chargers"          value={totalChargers.toString()}     sub="Across all sites" />
        <KPICard label="In Warranty"       value={inWarrantyChargers.toString()} sub={`${totalChargers - inWarrantyChargers} out / unknown`} />
        <KPICard label="Outstanding"       value={loading ? '…' : outstanding.total.toString()}
          sub={loading ? 'Calculating…' : outstanding.total === 0 ? 'All clear' : `across ${outstanding.affectedRegistries} registr${outstanding.affectedRegistries === 1 ? 'y' : 'ies'}`} />
      </div>

      {/* Map (smaller) + registry-wide outstanding issues side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'stretch' }}>
        <div style={{ background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Charger Map</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                Every project site with a recorded address.
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {sitesWithCoords.length} of {totalSites} site{totalSites === 1 ? '' : 's'} mapped
            </div>
          </div>

          {loading ? (
            <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 12, padding: '40px 16px', fontSize: 13, color: C.slate, textAlign: 'center' }}>
              Loading sites…
            </div>
          ) : sitesWithCoords.length === 0 ? (
            <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 12, padding: '40px 16px', fontSize: 13, color: C.slate, textAlign: 'center' }}>
              No project sites have geocoded addresses yet. Add a site address from inside any project to see it here.
            </div>
          ) : (
            <ChargerLocationMap locations={locations} height={380} />
          )}
        </div>

        <div style={{ background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Outstanding Issues</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                Across the whole charger registry, by category.
              </div>
            </div>
            {!loading && (
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 99,
                background: outstanding.total > 0 ? '#FDEAEA' : '#E4F3E3',
                color: outstanding.total > 0 ? '#C0321A' : '#1B512D' }}>
                {outstanding.total > 0 ? `${outstanding.total} open` : 'All clear'}
              </span>
            )}
          </div>

          {loading ? (
            <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 12, padding: '40px 16px', fontSize: 13, color: C.slate, textAlign: 'center' }}>
              Calculating…
            </div>
          ) : (
            <>
              {/* Category rows with proportional bars */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ISSUE_KINDS.map((k) => {
                  const meta = ISSUE_META[k];
                  const n = outstanding.totals[k];
                  return (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: meta.bg, color: meta.color, whiteSpace: 'nowrap', width: 118, textAlign: 'center', flexShrink: 0 }}>
                        {meta.label}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ height: 8, borderRadius: 99, background: '#F3F3F3', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(n / maxKind) * 100}%`, borderRadius: 99, background: n > 0 ? meta.color : 'transparent', opacity: 0.75, transition: 'width .3s' }} />
                        </div>
                        <div style={{ fontSize: 10.5, color: C.slate, marginTop: 3 }}>{meta.sub}</div>
                      </div>
                      <span style={{ fontSize: 16, fontWeight: 700, color: n > 0 ? meta.color : C.slate, width: 34, textAlign: 'right', flexShrink: 0 }}>{n}</span>
                    </div>
                  );
                })}
              </div>

              {/* Registries with the most open items */}
              {outstanding.worst.length > 0 && (
                <div style={{ borderTop: '1px solid #F3F3F3', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Needs attention first</div>
                  {outstanding.worst.map(({ project, counts, total }) => (
                    <div key={project.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
                      {ISSUE_KINDS.filter((k) => counts[k] > 0).map((k) => (
                        <span key={k} title={ISSUE_META[k].label} style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: ISSUE_META[k].bg, color: ISSUE_META[k].color, whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {counts[k]}
                        </span>
                      ))}
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#C0321A', width: 26, textAlign: 'right', flexShrink: 0 }}>{total}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 10.5, color: C.slate }}>Open each registry's Overview tab to resolve its items directly.</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
