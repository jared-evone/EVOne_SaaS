import { useMemo, useState } from 'react';
import { C } from '../../theme';
import { KPICard } from '../../components/KPICard';
import { supabase } from '../../lib/supabase';
import { Search } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────

export type CarparkCategory = 'evone_cpo' | 'eve_cpo' | 'managed_cpo';
type CategoryOrOther = CarparkCategory | 'other';

export interface ManagedCarpark {
  carpark_name: string;
  category: CarparkCategory;
  location_id: string | null;
  notes: string | null;
}

export interface CpoLocationLite {
  id: string;
  name: string;
}

export interface CarparkAgg {
  carpark_name: string;
  sources: Set<'goparkin' | 'sp'>;
  records: number;
  kwh: number;
  revenue: number;
}

// ── Category metadata ─────────────────────────────────────────────

const CATEGORY_LABELS: Record<CategoryOrOther, string> = {
  evone_cpo:   'EVOne CPO',
  eve_cpo:     'EVE CPO',
  managed_cpo: 'Managed CPOs',
  other:       'Others',
};

const CATEGORY_COLORS: Record<CategoryOrOther, { bg: string; color: string }> = {
  evone_cpo:   { bg: '#E4F3E3', color: '#1B512D' },
  eve_cpo:     { bg: '#FFF0E0', color: '#B45309' },
  managed_cpo: { bg: '#E3F0FF', color: '#1A62C0' },
  other:       { bg: '#F3F3F3', color: '#767B77' },
};

const CATEGORY_ORDER: CarparkCategory[] = ['evone_cpo', 'eve_cpo', 'managed_cpo'];

// ── Component ─────────────────────────────────────────────────────

interface CarparksTabProps {
  agg: CarparkAgg[];
  managed: ManagedCarpark[];
  locations: CpoLocationLite[];
  onRefresh: () => Promise<void>;
}

type StatusFilter = 'all' | CategoryOrOther;

export function CarparksTab({ agg: aggInput, managed, locations, onRefresh }: CarparksTabProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const agg = useMemo(
    () => [...aggInput].sort((a, b) => a.carpark_name.localeCompare(b.carpark_name)),
    [aggInput],
  );

  const managedMap = useMemo(() => new Map(managed.map((m) => [m.carpark_name, m])), [managed]);
  const categoryFor = (name: string): CategoryOrOther => managedMap.get(name)?.category ?? 'other';

  const visible = agg.filter((c) => {
    const cat = categoryFor(c.carpark_name);
    if (statusFilter !== 'all' && statusFilter !== cat) return false;
    if (!search) return true;
    return c.carpark_name.toLowerCase().includes(search.toLowerCase());
  });

  const counts: Record<CategoryOrOther, number> = { evone_cpo: 0, eve_cpo: 0, managed_cpo: 0, other: 0 };
  for (const c of agg) counts[categoryFor(c.carpark_name)] += 1;

  const totalEvoneNetwork = counts.evone_cpo + counts.eve_cpo + counts.managed_cpo;
  const managedRecords    = agg.filter((c) => categoryFor(c.carpark_name) !== 'other').reduce((s, c) => s + c.records, 0);
  const managedKwh        = agg.filter((c) => categoryFor(c.carpark_name) !== 'other').reduce((s, c) => s + c.kwh, 0);

  const setCategory = async (name: string, cat: CategoryOrOther) => {
    setBusy(name);
    if (cat === 'other') {
      await supabase.from('cpo_managed_carparks').delete().eq('carpark_name', name);
    } else {
      await supabase.from('cpo_managed_carparks').upsert({
        carpark_name: name,
        category: cat,
        updated_at: new Date().toISOString(),
      });
    }
    await onRefresh();
    setBusy(null);
  };

  const linkLocation = async (name: string, locId: string | null) => {
    setBusy(name);
    const current = managedMap.get(name);
    await supabase.from('cpo_managed_carparks').upsert({
      carpark_name: name,
      category: current?.category ?? 'evone_cpo',
      location_id: locId,
      updated_at: new Date().toISOString(),
    });
    await onRefresh();
    setBusy(null);
  };

  const statusPills: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'all',         label: 'All',          count: agg.length },
    { id: 'evone_cpo',   label: CATEGORY_LABELS.evone_cpo,   count: counts.evone_cpo },
    { id: 'eve_cpo',     label: CATEGORY_LABELS.eve_cpo,     count: counts.eve_cpo },
    { id: 'managed_cpo', label: CATEGORY_LABELS.managed_cpo, count: counts.managed_cpo },
    { id: 'other',       label: CATEGORY_LABELS.other,       count: counts.other },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Distinct Carparks"  value={String(agg.length)} sub="seen in charging records" accent />
        <KPICard label="EVOne Network"      value={String(totalEvoneNetwork)} sub={`${agg.length ? Math.round(totalEvoneNetwork * 100 / agg.length) : 0}% of total`} />
        <KPICard label="Records (Network)"  value={managedRecords.toLocaleString()} sub="charging sessions" />
        <KPICard label="Energy (Network)"   value={`${managedKwh.toFixed(1)} kWh`} sub="from EVOne network" />
      </div>

      <div style={{ background: C.honeydew, color: C.green, borderRadius: 12, padding: '12px 16px', fontSize: 12, fontWeight: 600, lineHeight: 1.5 }}>
        Categorise each carpark by the EVOne business line that operates it. Categorised carparks drive the "CPO Only" filter on Charging Records and the Corporate Invoicing GoParkin pull. Link to a CPO Location to make it appear in CPO Chargers monitoring.
      </div>

      {/* Category legend */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: C.slate }}>
        <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Categories:</span>
        {([...CATEGORY_ORDER, 'other'] as CategoryOrOther[]).map((cat) => {
          const sc = CATEGORY_COLORS[cat];
          return (
            <span key={cat} style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: sc.bg, color: sc.color }}>
              {CATEGORY_LABELS[cat]}
            </span>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {statusPills.map((p) => {
            const active = statusFilter === p.id;
            return (
              <button key={p.id} onClick={() => setStatusFilter(p.id)}
                style={{ padding: '6px 14px', borderRadius: 99,
                  border: `1px solid ${active ? C.green : '#EBEBEB'}`,
                  background: active ? C.green : C.white,
                  color: active ? C.white : C.slate,
                  fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {p.label} <span style={{ opacity: 0.7 }}>· {p.count}</span>
              </button>
            );
          })}
        </div>
        <div style={{ position: 'relative', width: 280, marginLeft: 'auto' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search carpark name…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 770 }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Carpark', 'Sources', 'Records', 'Energy', 'Revenue', 'Category', 'CPO Location'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const cat = categoryFor(c.carpark_name);
                const isManaged = cat !== 'other';
                const isBusy = busy === c.carpark_name;
                const sc = CATEGORY_COLORS[cat];
                const m = managedMap.get(c.carpark_name);
                return (
                  <tr key={c.carpark_name} style={{ borderBottom: '1px solid #F3F3F3', background: isManaged ? '#FBFEFB' : 'transparent' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: isManaged ? C.green : '#1a1a1a', whiteSpace: 'nowrap' }}>{c.carpark_name}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[...c.sources].map((s) => (
                          <span key={s} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                            background: s === 'goparkin' ? '#E3F0FF' : '#FFF0E0',
                            color:      s === 'goparkin' ? '#1A62C0' : '#B45309' }}>
                            {s === 'goparkin' ? 'GoParkin' : 'SP'}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#1a1a1a' }}>{c.records.toLocaleString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: C.green, whiteSpace: 'nowrap' }}>{c.kwh.toFixed(1)} kWh</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: C.green, whiteSpace: 'nowrap' }}>${c.revenue.toFixed(2)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <select value={cat} disabled={isBusy}
                        onChange={(e) => setCategory(c.carpark_name, e.target.value as CategoryOrOther)}
                        style={{ padding: '5px 10px', borderRadius: 99, border: 'none',
                          background: sc.bg, color: sc.color,
                          fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer', outline: 'none' }}>
                        <option value="evone_cpo">{CATEGORY_LABELS.evone_cpo}</option>
                        <option value="eve_cpo">{CATEGORY_LABELS.eve_cpo}</option>
                        <option value="managed_cpo">{CATEGORY_LABELS.managed_cpo}</option>
                        <option value="other">{CATEGORY_LABELS.other}</option>
                      </select>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {isManaged ? (
                        <select value={m?.location_id ?? ''} disabled={isBusy}
                          onChange={(e) => linkLocation(c.carpark_name, e.target.value || null)}
                          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.white, maxWidth: 180 }}>
                          <option value="">— Not linked —</option>
                          {locations.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 12, color: C.slate }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  {agg.length === 0 ? 'No carparks found. Import charging records first to see carparks here.' : 'No carparks match the current filter.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
