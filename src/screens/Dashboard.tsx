import { useEffect, useMemo, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { ChargerLocationMap, type ChargerMapLocation } from '../components/ChargerLocationMap';
import { supabase } from '../lib/supabase';
import { useScreenNav } from '../App';
import { parseChargerPower, fmtKw, type ChargerCurrent } from '../lib/chargerPower';
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
interface PowerBucket { key: string; kw: number | null; current: ChargerCurrent | null; count: number; sites: Set<string>; models: Map<string, number> }

const CURRENT_TAG: Record<ChargerCurrent, { bg: string; color: string }> = {
  DC: { bg: '#E3F0FF', color: '#1A62C0' },
  AC: { bg: '#E4F3E3', color: '#1B512D' },
};

const ISSUE_KINDS = ['formA', 'formD', 'form1', 'invoice'] as const;
type IssueKind = (typeof ISSUE_KINDS)[number];
const ISSUE_META: Record<IssueKind, { label: string; sub: string; bg: string; color: string }> = {
  formA:   { label: 'Form A due',       sub: 'Inspection cycles overdue',            bg: '#FDEAEA', color: '#C0321A' },
  formD:   { label: 'Form D due',       sub: 'Annual inspection overdue',            bg: '#FDEAEA', color: '#C0321A' },
  form1:   { label: 'Form 1 missing',   sub: 'Installation form not uploaded',       bg: '#FFF0E0', color: '#B45309' },
  invoice: { label: 'Invoices missing', sub: 'Latest Form A/D has no invoice',       bg: '#FFF8E1', color: '#B07D00' },
};

export function ScreenDashboard() {
  const go = useScreenNav();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [lta, setLta] = useState<LtaRow[]>([]);
  const [customerTypes, setCustomerTypes] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [powerKey, setPowerKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ data: projs }, { data: siteRows }, { data: ltaRows }, { data: custRows }] = await Promise.all([
        supabase.from('projects').select('id, name, status, customer_id'),
        supabase.from('project_sites').select('id, project_id, name, address, latitude, longitude, site_chargers(id, asset_tag, brand_model, form_1_path, turn_on_date, procurement_date, lta_letter_date, lta_letter_forms, warranty_end_date)'),
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

  // Installed base by charger size, read from each charger's Brand & Model.
  const power = useMemo(() => {
    const buckets = new Map<string, PowerBucket>();
    const unknown: PowerBucket = { key: 'unknown', kw: null, current: null, count: 0, sites: new Set(), models: new Map() };
    for (const site of sites) {
      for (const c of site.site_chargers) {
        const p = parseChargerPower(c.brand_model);
        const model = c.brand_model?.trim() || 'No brand & model set';
        let b = unknown;
        if (p) {
          const key = `${p.current}-${p.kw}`;
          b = buckets.get(key) ?? { key, kw: p.kw, current: p.current, count: 0, sites: new Set(), models: new Map() };
          buckets.set(key, b);
        }
        b.count++;
        b.sites.add(site.id);
        b.models.set(model, (b.models.get(model) ?? 0) + 1);
      }
    }
    const byKw = (cur: ChargerCurrent) => [...buckets.values()].filter((b) => b.current === cur).sort((a, b) => (b.kw ?? 0) - (a.kw ?? 0));
    const dc = byKw('DC');
    const ac = byKw('AC');
    return { dc, ac, unknown, dcTotal: dc.reduce((n, b) => n + b.count, 0), acTotal: ac.reduce((n, b) => n + b.count, 0) };
  }, [sites]);
  const powerSelected = powerKey === 'unknown' ? power.unknown : [...power.dc, ...power.ac].find((b) => b.key === powerKey) ?? null;

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

      {/* Installed chargers by size */}
      <div style={{ background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Chargers by Power</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
              Installed chargers by size, read from each charger's Brand &amp; Model (brand ignored). Click a size to see the models behind it.
            </div>
          </div>
          {!loading && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 99, ...CURRENT_TAG.DC }}>{power.dcTotal} DC</span>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 99, ...CURRENT_TAG.AC }}>{power.acTotal} AC</span>
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 12, padding: '28px 16px', fontSize: 13, color: C.slate, textAlign: 'center' }}>
            Counting chargers…
          </div>
        ) : (
          <>
            {([['DC', 'DC fast charging', power.dc], ['AC', 'AC charging', power.ac]] as const).filter(([, , list]) => list.length > 0).map(([cur, title, list]) => (
              <div key={cur} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
                  {list.map((b) => {
                    const on = powerKey === b.key;
                    return (
                      <button key={b.key} type="button" onClick={() => setPowerKey(on ? null : b.key)}
                        style={{ textAlign: 'left', padding: '14px 16px', borderRadius: 14, border: on ? `1.5px solid ${C.green}` : '1px solid #EBEBEB', background: on ? C.honeydew : C.white, cursor: 'pointer', fontFamily: 'Figtree' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{fmtKw(b.kw ?? 0)}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, ...CURRENT_TAG[cur] }}>{cur}</span>
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 700, color: C.green, letterSpacing: '-0.04em', lineHeight: 1, marginTop: 10 }}>{b.count}</div>
                        <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>at {b.sites.size} site{b.sites.size === 1 ? '' : 's'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {power.unknown.count > 0 && (
              <button type="button" onClick={() => setPowerKey(powerKey === 'unknown' ? null : 'unknown')}
                style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, border: powerKey === 'unknown' ? '1.5px solid #B45309' : '1px solid #EBEBEB', background: '#FFF0E0', color: '#B45309', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {power.unknown.count} charger{power.unknown.count === 1 ? '' : 's'} with no kW in the Brand &amp; Model
              </button>
            )}

            {powerSelected && (
              <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>
                  {powerSelected.kw != null ? `${fmtKw(powerSelected.kw)} ${powerSelected.current}` : 'Size unknown'} · {powerSelected.count} charger{powerSelected.count === 1 ? '' : 's'} at {powerSelected.sites.size} site{powerSelected.sites.size === 1 ? '' : 's'}
                </div>
                {[...powerSelected.models.entries()].sort((a, b) => b[1] - a[1]).map(([model, n]) => (
                  <div key={model} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <span style={{ flex: 1, minWidth: 0, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model}</span>
                    <span style={{ fontWeight: 700, color: C.slate }}>{n}</span>
                  </div>
                ))}
                {powerSelected.kw == null && (
                  <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5, marginTop: 4 }}>
                    These labels don't say how many kW. Put the size in the name (e.g. "Hiconics 120kW DC") — in a project, edit the charger and pick a Brand &amp; Model that includes it.
                  </div>
                )}
              </div>
            )}
          </>
        )}
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
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 99,
                  background: outstanding.total > 0 ? '#FDEAEA' : '#E4F3E3',
                  color: outstanding.total > 0 ? '#C0321A' : '#1B512D' }}>
                  {outstanding.total > 0 ? `${outstanding.total} open` : 'All clear'}
                </span>
                <button onClick={() => go('registry_todo')}
                  style={{ padding: '4px 12px', borderRadius: 99, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Open To Do →
                </button>
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
