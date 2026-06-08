import { useEffect, useMemo, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { Search } from 'lucide-react';
import { LocationTrends, ensureChargingTrendsCache } from './charging/LocationTrends';
import { Sessions } from './charging/Sessions';
import { ChargingOverview } from './charging/ChargingOverview';
import { ExcludedCompanies } from './charging/ExcludedCompanies';

// ── Types ─────────────────────────────────────────────────────────

interface PerCarparkRow {
  carpark_code:  string;
  sources:       ('goparkin' | 'sp')[];
  sessions:      number;
  kwh:           number;
  revenue:       number;
  prior_kwh:     number;
  prior_revenue: number;
}

interface PerDayRow {
  day_date: string; // YYYY-MM-DD
  sessions: number;
  kwh:      number;
  revenue:  number;
}

type SourceFilter = 'all' | 'goparkin' | 'sp';
type DashboardTab = 'overview' | 'weekly' | 'trends' | 'sessions' | 'excluded';

const PER_PAGE = 12;

const SOURCE_COLORS: Record<'goparkin' | 'sp', { bg: string; color: string }> = {
  goparkin: { bg: '#E3F0FF', color: '#1A62C0' },
  sp:       { bg: '#FFF0E0', color: '#B45309' },
};

// ── Helpers ───────────────────────────────────────────────────────

function todayISO() { return new Date().toISOString().slice(0, 10); }

// Returns the Monday of the ISO week containing `dateISO` (YYYY-MM-DD).
function mondayOf(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00`);
  const day = d.getDay(); // 0 = Sun, 1 = Mon, …
  const diff = (day + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fmtWeekRange(start: string): string {
  const end = addDays(start, 6);
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

function fmtKwh(n: number): string {
  return `${Number(n).toLocaleString('en-SG', { maximumFractionDigits: 1 })} kWh`;
}

function fmtAmt(n: number): string {
  return `$${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function deltaTone(curr: number, prior: number): { label: string; color: string; bg: string } {
  if (prior === 0 && curr === 0) return { label: '—', color: C.slate, bg: '#F3F3F3' };
  if (prior === 0) return { label: 'new', color: '#1A62C0', bg: '#E3F0FF' };
  const pct = ((curr - prior) / prior) * 100;
  if (Math.abs(pct) < 0.5) return { label: '0%', color: C.slate, bg: '#F3F3F3' };
  if (pct > 0)  return { label: `▲ ${pct.toFixed(0)}%`, color: '#1B512D', bg: '#E4F3E3' };
  return                { label: `▼ ${Math.abs(pct).toFixed(0)}%`, color: '#C0321A', bg: '#FDEAEA' };
}

// ── Component ─────────────────────────────────────────────────────

export function ScreenChargingDashboard() {
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()));
  const [cpoOnly, setCpoOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [perCarpark, setPerCarpark] = useState<PerCarparkRow[]>([]);
  const [perDay, setPerDay] = useState<PerDayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestDataDate, setLatestDataDate] = useState<string | null>(null);

  useEffect(() => {
    // Warm the Location Trends session cache in the background as soon as the
    // dashboard mounts, so switching to that tab (and between ranges) is instant.
    ensureChargingTrendsCache().catch(() => { /* surfaced on the tab itself */ });
  }, []);

  useEffect(() => {
    // One-off: detect the most recent record so the user can jump to a week with data.
    supabase
      .from('crm_charging_records')
      .select('start_date_time')
      .order('start_date_time', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.start_date_time) {
          setLatestDataDate(String(data.start_date_time).slice(0, 10));
        }
      });
  }, []);

  useEffect(() => {
    if (tab !== 'weekly') return;
    setLoading(true);
    setError(null);
    const src = sourceFilter === 'all' ? null : sourceFilter;
    Promise.all([
      supabase.rpc('weekly_charging_per_carpark', { week_start: weekStart, cpo_only: cpoOnly, src }),
      supabase.rpc('weekly_charging_per_day',     { week_start: weekStart, cpo_only: cpoOnly, src }),
    ]).then(([cp, pd]) => {
      if (cp.error) { setError(cp.error.message); setPerCarpark([]); }
      else { setPerCarpark(((cp.data as PerCarparkRow[]) ?? []).map(normaliseRow)); }
      if (pd.error) { setError(pd.error.message); setPerDay([]); }
      else { setPerDay((pd.data as PerDayRow[]) ?? []); }
      setLoading(false);
    });
  }, [tab, weekStart, cpoOnly, sourceFilter]);

  const totals = useMemo(() => {
    const sessions = perCarpark.reduce((s, r) => s + Number(r.sessions ?? 0), 0);
    const kwh      = perCarpark.reduce((s, r) => s + Number(r.kwh ?? 0), 0);
    const revenue  = perCarpark.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
    const priorKwh = perCarpark.reduce((s, r) => s + Number(r.prior_kwh ?? 0), 0);
    const priorRev = perCarpark.reduce((s, r) => s + Number(r.prior_revenue ?? 0), 0);
    return {
      sessions, kwh, revenue, priorKwh, priorRev,
      activeCarparks: perCarpark.filter((r) => Number(r.kwh ?? 0) > 0).length,
    };
  }, [perCarpark]);

  const filteredCarparks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return perCarpark;
    return perCarpark.filter((r) => r.carpark_code.toLowerCase().includes(q));
  }, [perCarpark, search]);

  const totalPages = Math.max(1, Math.ceil(filteredCarparks.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pagedCarparks = filteredCarparks.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const maxCarparkKwh = perCarpark.reduce((m, r) => Math.max(m, Number(r.kwh ?? 0)), 0);
  const maxDayKwh     = perDay.reduce((m, r) => Math.max(m, Number(r.kwh ?? 0)), 0);
  const kwhDelta = deltaTone(totals.kwh, totals.priorKwh);
  const revDelta = deltaTone(totals.revenue, totals.priorRev);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
        {([
          ['overview', 'Overview'],
          ['weekly', 'Weekly Detail'],
          ['trends', 'Location Trends'],
          ['sessions', 'Sessions'],
          ['excluded', 'Excluded Companies'],
        ] as [DashboardTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: '8px 22px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: tab === id ? C.green : 'transparent', color: tab === id ? C.white : C.slate }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <ChargingOverview />}

      {tab === 'trends' && <LocationTrends />}

      {tab === 'sessions' && <Sessions />}

      {tab === 'excluded' && <ExcludedCompanies />}

      {tab === 'weekly' && <>
      {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>}

      {/* Week selector + filters */}
      <div style={{ background: C.white, borderRadius: 16, padding: '14px 20px', border: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setWeekStart((w) => addDays(w, -7))}
          style={pillBtn(false)} title="Previous week">← Prev Week</button>
        <button onClick={() => setWeekStart(mondayOf(todayISO()))}
          style={pillBtn(weekStart === mondayOf(todayISO()))}>This Week</button>
        <button onClick={() => setWeekStart((w) => addDays(w, 7))}
          style={pillBtn(false)} title="Next week">Next Week →</button>
        <div style={{ marginLeft: 8, fontSize: 14, fontWeight: 700, color: C.green }}>
          {fmtWeekRange(weekStart)}
        </div>
        {latestDataDate && weekStart > latestDataDate && (
          <button onClick={() => setWeekStart(mondayOf(latestDataDate))}
            style={{ ...pillBtn(false), fontSize: 11 }} title={`Jump to the week of the latest record (${latestDataDate})`}>
            ↩ Jump to latest data
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'goparkin', 'sp'] as const).map((s) => (
              <button key={s} onClick={() => setSourceFilter(s)}
                style={pillBtn(sourceFilter === s)}>
                {s === 'all' ? 'All Sources' : s === 'goparkin' ? 'GoParkin' : 'SP'}
              </button>
            ))}
          </div>
          <button onClick={() => setCpoOnly((v) => !v)}
            style={{ padding: '7px 14px', borderRadius: 99,
              border: `1px solid ${cpoOnly ? C.green : '#EBEBEB'}`,
              background: cpoOnly ? C.honeydew : C.white,
              color: cpoOnly ? C.green : C.slate,
              fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {cpoOnly ? '✓ ' : ''}CPO Only
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Total Energy"    value={fmtKwh(totals.kwh)}              sub={`vs prior week`} accent />
        <KPICard label="Total Revenue"   value={fmtAmt(totals.revenue)}          sub="payment collected" />
        <KPICard label="Sessions"        value={totals.sessions.toLocaleString()} sub="charging sessions" />
        <KPICard label="Active Carparks" value={String(totals.activeCarparks)}    sub={`of ${perCarpark.length} this week`} />
      </div>

      {/* Trend chips under KPIs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: -8 }}>
        <span style={{ background: kwhDelta.bg, color: kwhDelta.color, fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99 }}>
          Energy {kwhDelta.label} <span style={{ opacity: 0.7, fontWeight: 600 }}>· prior {fmtKwh(totals.priorKwh)}</span>
        </span>
        <span style={{ background: revDelta.bg, color: revDelta.color, fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99 }}>
          Revenue {revDelta.label} <span style={{ opacity: 0.7, fontWeight: 600 }}>· prior {fmtAmt(totals.priorRev)}</span>
        </span>
      </div>

      {/* Daily chart */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Daily Energy · {fmtWeekRange(weekStart)}</div>
          <div style={{ fontSize: 12, color: C.slate }}>Total {fmtKwh(totals.kwh)} · {totals.sessions.toLocaleString()} sessions</div>
        </div>
        <DailyBars data={perDay} max={maxDayKwh} />
      </div>

      {/* Per-carpark toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search carpark…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: C.slate }}>
          {filteredCarparks.length} carpark{filteredCarparks.length === 1 ? '' : 's'} shown
        </div>
      </div>

      {/* Per-carpark table */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['#', 'Carpark', 'Sources', 'Sessions', 'Energy (kWh)', 'Revenue', 'Share', 'vs Prior Week'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && pagedCarparks.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</td></tr>
              ) : pagedCarparks.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  No charging activity for this week with the current filters.
                </td></tr>
              ) : (
                pagedCarparks.map((r, i) => {
                  const share = totals.kwh > 0 ? (Number(r.kwh) / totals.kwh) * 100 : 0;
                  const d = deltaTone(Number(r.kwh), Number(r.prior_kwh));
                  return (
                    <tr key={r.carpark_code} style={{ borderBottom: '1px solid #F3F3F3' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                      <td style={{ padding: '11px 16px', fontSize: 12, color: C.slate }}>{(safePage - 1) * PER_PAGE + i + 1}</td>
                      <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 700, color: C.green }}>{r.carpark_code}</td>
                      <td style={{ padding: '11px 16px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {(r.sources ?? []).map((s) => (
                            <span key={s} style={{ background: SOURCE_COLORS[s].bg, color: SOURCE_COLORS[s].color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              {s === 'goparkin' ? 'GoParkin' : 'SP'}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: '11px 16px', fontSize: 13, color: '#1a1a1a' }}>{Number(r.sessions).toLocaleString()}</td>
                      <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>{fmtKwh(Number(r.kwh))}</td>
                      <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{fmtAmt(Number(r.revenue))}</td>
                      <td style={{ padding: '11px 16px', minWidth: 180 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, height: 6, background: C.seasalt, borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{ width: `${maxCarparkKwh > 0 ? (Number(r.kwh) / maxCarparkKwh) * 100 : 0}%`, height: '100%', background: C.green }} />
                          </div>
                          <span style={{ fontSize: 11, color: C.slate, minWidth: 42, textAlign: 'right' }}>{share.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                        <span title={`Prior week: ${fmtKwh(Number(r.prior_kwh))}`} style={{ background: d.bg, color: d.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>
                          {d.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #F3F3F3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, color: C.slate }}>
            {filteredCarparks.length === 0 ? 'No results' : `Showing ${(safePage - 1) * PER_PAGE + 1}–${Math.min(safePage * PER_PAGE, filteredCarparks.length)} of ${filteredCarparks.length}`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
              style={pageBtn(safePage === 1)}>← Prev</button>
            <span style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>Page {safePage} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
              style={pageBtn(safePage >= totalPages)}>Next →</button>
          </div>
        </div>
      </div>
      </>}
    </div>
  );
}

// Always returns 7 typed rows (Mon..Sun) for the selected week, even if the RPC missed a date.
function DailyBars({ data, max }: { data: PerDayRow[]; max: number }) {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const H = 180;
  const safeMax = max > 0 ? max * 1.15 : 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: H, gap: 8 }}>
      {data.map((d, i) => {
        const kwh = Number(d.kwh ?? 0);
        const pct = (kwh / safeMax) * 100;
        return (
          <div key={d.day_date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: kwh > 0 ? C.green : C.slate }}>
              {kwh > 0 ? fmtKwh(kwh) : '—'}
            </div>
            <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div title={`${fmtDate(d.day_date)} · ${fmtKwh(kwh)} · ${Number(d.sessions ?? 0)} sessions`}
                style={{ width: '100%', height: `${pct}%`, minHeight: kwh > 0 ? 4 : 0,
                  background: `linear-gradient(180deg, ${C.green} 0%, #6BBE7E 100%)`,
                  borderRadius: '8px 8px 0 0', transition: 'height .3s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>{DAYS[i]}</div>
            <div style={{ fontSize: 10, color: C.slate }}>{fmtDate(d.day_date)}</div>
          </div>
        );
      })}
      {data.length === 0 && (
        <div style={{ flex: 1, textAlign: 'center', color: C.slate, fontSize: 13, alignSelf: 'center' }}>No daily data.</div>
      )}
    </div>
  );
}

// ── Small style helpers ───────────────────────────────────────────

function pillBtn(active: boolean): React.CSSProperties {
  return {
    padding: '7px 14px', borderRadius: 99,
    border: active ? 'none' : '1px solid #EBEBEB',
    background: active ? C.green : C.white,
    color: active ? C.white : C.slate,
    fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  };
}

function pageBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB',
    background: disabled ? C.seasalt : C.white,
    color: disabled ? '#ccc' : C.slate,
    fontFamily: 'Figtree', fontSize: 12, fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
  };
}

// The RPC's bigint/numeric come back as strings in PostgREST — coerce up front.
function normaliseRow(r: PerCarparkRow): PerCarparkRow {
  return {
    ...r,
    sources:       (r.sources ?? []).filter((s) => s === 'goparkin' || s === 'sp') as ('goparkin' | 'sp')[],
    sessions:      Number(r.sessions)      || 0,
    kwh:           Number(r.kwh)           || 0,
    revenue:       Number(r.revenue)       || 0,
    prior_kwh:     Number(r.prior_kwh)     || 0,
    prior_revenue: Number(r.prior_revenue) || 0,
  };
}
