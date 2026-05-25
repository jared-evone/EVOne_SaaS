import { useEffect, useMemo, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { ChargerLocationMap, type ChargerMapLocation } from '../components/ChargerLocationMap';
import { supabase } from '../lib/supabase';

interface ProjectRow {
  id: string;
  name: string;
  status: 'active' | 'inactive';
}

interface SiteRow {
  id: string;
  project_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  site_chargers: { id: string; warranty_end_date: string | null }[];
}

export function ScreenDashboard() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ data: projs }, { data: siteRows }] = await Promise.all([
        supabase.from('projects').select('id, name, status'),
        supabase.from('project_sites').select('id, project_id, name, address, latitude, longitude, site_chargers(id, warranty_end_date)'),
      ]);
      if (cancelled) return;
      setProjects((projs ?? []) as ProjectRow[]);
      setSites((siteRows ?? []) as SiteRow[]);
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

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>Dashboard</div>
        <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>
          Operational snapshot across every project — chargers, sites, and warranty health.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <KPICard label="Projects"          value={totalProjects.toString()}     accent sub={`${activeProjects} active`} />
        <KPICard label="Sites"             value={totalSites.toString()}        sub={`${sitesWithCoords.length} mapped`} />
        <KPICard label="Chargers"          value={totalChargers.toString()}     sub="Across all sites" />
        <KPICard label="In Warranty"       value={inWarrantyChargers.toString()} sub={`${totalChargers - inWarrantyChargers} out / unknown`} />
      </div>

      <div style={{ background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Charger Map</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
              Every project site with a recorded address. Click a pin to see the site, project, and charger count.
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
          <ChargerLocationMap locations={locations} height={560} />
        )}
      </div>
    </div>
  );
}
