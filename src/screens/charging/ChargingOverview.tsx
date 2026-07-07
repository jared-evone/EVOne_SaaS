import { useEffect, useMemo, useRef, useState } from 'react';
import { C } from '../../theme';
import { LineChart, type LineChartTooltip } from '../../components/charts';
import {
  aggregateTotal, ensureCpoCarparkSet, toggleBtn,
  ensureChargingTrendsCache, getCachedChargingRows, clearChargingTrendsCache,
  ensureExcludedVehicles, normalizePlate,
  fmtKwh, fmtKwhShort, fmtCount, fmtCountShort, fmtTooltipDate,
  type Granularity,
} from './LocationTrends';

type RangeMonths = 3 | 6 | 12 | 24 | 'all';
type SourceFilter = 'all' | 'goparkin' | 'sp';

function rangeStartISO(months: RangeMonths): string | null {
  if (months === 'all') return null;
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return d.toISOString().slice(0, 10);
}

const isSuccess = (s: string | null) => (s ?? '').toLowerCase() === 'success';

function currentYM(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function addMonthYM(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Component ─────────────────────────────────────────────────────
// Two dashboard-wide line charts (sessions + energy) summed across every carpark,
// off the shared charging cache that's preloaded on dashboard mount.

export function ChargingOverview() {
  const [rangeMonths, setRangeMonths] = useState<RangeMonths>(12);
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [dcOnly, setDcOnly] = useState(false);
  const [cpoOnly, setCpoOnly] = useState(false);
  const [cpoSet, setCpoSet] = useState<Set<string>>(new Set());
  const [excludeOn, setExcludeOn] = useState(false);
  const [excludedSet, setExcludedSet] = useState<Set<string>>(new Set());
  const [carparkSel, setCarparkSel] = useState<Set<string>>(new Set());
  const [kpiMonth, setKpiMonth] = useState(currentYM);
  const [carparkOpen, setCarparkOpen] = useState(false);
  const [carparkSearch, setCarparkSearch] = useState('');
  const carparkRef = useRef<HTMLDivElement>(null);
  const carparkActive = carparkSel.size > 0;

  useEffect(() => {
    let cancelled = false;
    ensureCpoCarparkSet().then((s) => { if (!cancelled) setCpoSet(s); }).catch(() => {});
    ensureExcludedVehicles().then((s) => { if (!cancelled) setExcludedSet(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!carparkOpen) return;
    const onDown = (e: MouseEvent) => {
      if (carparkRef.current && !carparkRef.current.contains(e.target as Node)) setCarparkOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [carparkOpen]);

  // Carpark filter and CPO Only are mutually exclusive — selecting carparks clears CPO,
  // and enabling CPO clears the carpark selection.
  const toggleCarpark = (cp: string) => {
    setCpoOnly(false);
    setCarparkSel((prev) => {
      const next = new Set(prev);
      if (next.has(cp)) next.delete(cp); else next.add(cp);
      return next;
    });
  };
  const enableCpoOnly = () => {
    setCpoOnly((v) => {
      const nv = !v;
      if (nv) { setCarparkSel(new Set()); setCarparkOpen(false); }
      return nv;
    });
  };

  const [rows, setRows] = useState(() => getCachedChargingRows() ?? []);
  const [loading, setLoading] = useState(() => getCachedChargingRows() === null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedChargingRows();
    if (cached) { setRows(cached); setLoading(false); } else { setLoading(true); setLoadedCount(0); }
    setError(null);
    // Always revalidate against the live row count; refetch only if the data changed, so
    // every login converges to the latest data instead of a stale first-load snapshot.
    ensureChargingTrendsCache((n) => { if (!cancelled) setLoadedCount(n); }, true)
      .then((r) => { if (!cancelled) { setRows(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setLoading(false); if (!getCachedChargingRows()) setError((e as Error).message); } });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const refresh = () => {
    clearChargingTrendsCache();
    setRows([]);
    setLoading(true);
    setRefreshKey((k) => k + 1);
  };

  const allCarparks = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.carpark_code) s.add(r.carpark_code);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const carparkOptions = useMemo(() => {
    const q = carparkSearch.trim().toLowerCase();
    return q ? allCarparks.filter((c) => c.toLowerCase().includes(q)) : allCarparks;
  }, [allCarparks, carparkSearch]);

  const filteredRows = useMemo(() => {
    const startISO = rangeStartISO(rangeMonths);
    return rows.filter((r) => {
      if (!isSuccess(r.payment_status)) return false;
      const dateStr = r.start_date_time.slice(0, 10);
      if (dateStr.length < 10) return false;
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (dcOnly && r.charge_type !== 'DC') return false;
      if (carparkActive) {
        if (!(r.carpark_code && carparkSel.has(r.carpark_code))) return false;
      } else if (cpoOnly && cpoSet.size > 0 && !(r.carpark_code && cpoSet.has(r.carpark_code))) {
        return false;
      }
      if (excludeOn && excludedSet.size > 0 && r.vehicle_plate_number && excludedSet.has(normalizePlate(r.vehicle_plate_number))) return false;
      if (startISO && dateStr < startISO) return false;
      return true;
    });
  }, [rows, rangeMonths, sourceFilter, dcOnly, cpoOnly, cpoSet, carparkActive, carparkSel, excludeOn, excludedSet]);

  const series = useMemo(
    () => aggregateTotal(filteredRows, granularity, rangeStartISO(rangeMonths)),
    [filteredRows, granularity, rangeMonths],
  );

  const carparks = useMemo(() => {
    const s = new Set<string>();
    for (const r of filteredRows) if (r.carpark_code) s.add(r.carpark_code);
    return s.size;
  }, [filteredRows]);

  // Selected month's daily average sessions per carpark:
  //   sessions that month ÷ #carparks ÷ days in the month (days elapsed so far if it's
  //   the current, unfinished month).
  const monthlyAvg = useMemo(() => {
    const cur = currentYM();
    const [y, m] = kpiMonth.split('-').map(Number);
    const monthRows = filteredRows.filter((r) => r.start_date_time.slice(0, 7) === kpiMonth);
    const sessions = monthRows.length;
    const inMonth = new Set<string>();
    for (const r of monthRows) if (r.carpark_code) inMonth.add(r.carpark_code);
    const cpCount = carparkActive ? carparkSel.size : inMonth.size;
    const daysInMonth = new Date(y, m, 0).getDate();
    let daysElapsed = daysInMonth;
    let finished = true;
    if (kpiMonth === cur) { daysElapsed = Math.min(new Date().getDate(), daysInMonth); finished = daysElapsed >= daysInMonth; }
    const avg = cpCount > 0 && daysElapsed > 0 ? sessions / cpCount / daysElapsed : 0;
    return {
      avg, sessions, cpCount, daysElapsed, finished,
      monthLabel: new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    };
  }, [filteredRows, carparkActive, carparkSel, kpiMonth]);

  const labels = series.buckets.map((b) => b.label);
  const sessionTips: (LineChartTooltip | undefined)[] | undefined = granularity === 'day'
    ? undefined
    : series.buckets.map((b) => ({ title: fmtTooltipDate(b.key, granularity), value: fmtCount(b.count) }));
  const energyTips: (LineChartTooltip | undefined)[] | undefined = granularity === 'day'
    ? undefined
    : series.buckets.map((b) => ({ title: fmtTooltipDate(b.key, granularity), value: fmtKwh(b.kwh) }));

  const rangeLabel =
    rangeMonths === 'all' ? 'All time' :
    rangeMonths === 3 ? 'Last 3 months' :
    rangeMonths === 6 ? 'Last 6 months' :
    rangeMonths === 12 ? 'Last 12 months' :
    'Last 24 months';
  const granLabel = granularity === 'day' ? 'daily' : granularity === 'week' ? 'weekly' : 'monthly';

  const hasData = !loading && series.buckets.length > 0 && series.totalCount > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* Filter strip */}
      <div style={{ background: C.white, borderRadius: 16, padding: '14px 20px', border: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['3', '6', '12', '24', 'all'] as const).map((r) => {
            const v: RangeMonths = r === 'all' ? 'all' : (Number(r) as 3 | 6 | 12 | 24);
            return (
              <button key={r} onClick={() => setRangeMonths(v)} style={pillBtn(rangeMonths === v)}>
                {r === 'all' ? 'All time' : `${r} mo`}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 24, background: '#EBEBEB' }} />

        <div style={{ display: 'flex', gap: 4 }}>
          {(['week', 'month'] as const).map((g) => (
            <button key={g} onClick={() => setGranularity(g)} style={pillBtn(granularity === g)}>
              {g === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: '#EBEBEB' }} />

        <button onClick={() => setDcOnly((v) => !v)} style={toggleBtn(dcOnly)}>{dcOnly ? '✓ ' : ''}DC Only</button>
        <button onClick={enableCpoOnly} style={toggleBtn(cpoOnly)}>{cpoOnly ? '✓ ' : ''}CPO Only (EVE + EVOne)</button>

        <div ref={carparkRef} style={{ position: 'relative' }}>
          <button onClick={() => setCarparkOpen((o) => !o)} style={toggleBtn(carparkActive)}>
            {carparkActive ? `✓ Carparks (${carparkSel.size})` : 'Carparks'} ▾
          </button>
          {carparkOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50, width: 300, background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.14)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={carparkSearch} onChange={(e) => setCarparkSearch(e.target.value)} placeholder="Search carparks…"
                style={{ width: '100%', padding: '7px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: C.seasalt }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>{carparkSel.size} of {allCarparks.length} selected</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setCpoOnly(false); setCarparkSel(new Set(allCarparks)); }}
                    style={{ border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Select all</button>
                  <button onClick={() => setCarparkSel(new Set())}
                    style={{ border: 'none', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Clear</button>
                </div>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {carparkOptions.length === 0 && (
                  <div style={{ padding: '12px 8px', textAlign: 'center', color: C.slate, fontSize: 12 }}>No matches</div>
                )}
                {carparkOptions.map((cp) => {
                  const checked = carparkSel.has(cp);
                  return (
                    <label key={cp} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 12, background: checked ? C.honeydew : 'transparent' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleCarpark(cp)} style={{ accentColor: C.green, cursor: 'pointer' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: checked ? C.green : '#1a1a1a', fontWeight: checked ? 700 : 400 }} title={cp}>{cp}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <button onClick={() => setExcludeOn((v) => !v)} style={toggleBtn(excludeOn)}>{excludeOn ? '✓ ' : ''}Exclude Vehicles{excludedSet.size > 0 ? ` (${excludedSet.size})` : ''}</button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['all', 'goparkin', 'sp'] as const).map((s) => (
            <button key={s} onClick={() => setSourceFilter(s)} style={pillBtn(sourceFilter === s)}>
              {s === 'all' ? 'All Sources' : s === 'goparkin' ? 'GoParkin' : 'SP'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary line */}
      <div style={{ fontSize: 13, color: C.slate, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span><strong style={{ color: '#1a1a1a' }}>{rangeLabel}</strong> · {granLabel} totals across {carparkActive ? 'selected' : 'all'} carparks · <strong style={{ color: '#1a1a1a' }}>successful sessions only</strong></span>
        <span>{carparks} carpark{carparks === 1 ? '' : 's'}</span>
        <span>{filteredRows.length.toLocaleString()} session{filteredRows.length === 1 ? '' : 's'}</span>
        {!loading && (
          <button onClick={refresh}
            style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ↻ Refresh data
          </button>
        )}
      </div>

      {loading && !hasData ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '60px 24px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
          Loading charging data… {loadedCount > 0 ? `(${loadedCount.toLocaleString()} rows so far)` : ''}
        </div>
      ) : !hasData ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '60px 24px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
          No charging activity for the selected range and filters.
        </div>
      ) : (
        <>
          {/* Big KPI — current month's daily average sessions per carpark */}
          <div style={{ background: C.green, borderRadius: 16, padding: '24px 28px', color: C.white, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.85 }}>
                Avg Daily Sessions per Carpark · {monthlyAvg.monthLabel}
              </div>
              <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1, marginTop: 8 }}>
                {monthlyAvg.avg.toLocaleString('en-SG', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>
                {monthlyAvg.sessions.toLocaleString()} session{monthlyAvg.sessions === 1 ? '' : 's'} ÷ {monthlyAvg.cpCount} carpark{monthlyAvg.cpCount === 1 ? '' : 's'} ÷ {monthlyAvg.daysElapsed} day{monthlyAvg.daysElapsed === 1 ? '' : 's'}
                {monthlyAvg.finished ? '' : ' so far this month'}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => setKpiMonth((mo) => addMonthYM(mo, -1))} title="Previous month"
                  style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.2)', color: C.white, fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>‹</button>
                <input type="month" value={kpiMonth} max={currentYM()} onChange={(e) => { if (e.target.value) setKpiMonth(e.target.value); }}
                  style={{ padding: '6px 10px', borderRadius: 8, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, color: '#1a1a1a', background: C.white, outline: 'none', cursor: 'pointer', colorScheme: 'light' }} />
                <button onClick={() => setKpiMonth((mo) => (mo >= currentYM() ? mo : addMonthYM(mo, 1)))} disabled={kpiMonth >= currentYM()} title="Next month"
                  style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.2)', color: C.white, fontSize: 16, fontWeight: 700, cursor: kpiMonth >= currentYM() ? 'default' : 'pointer', opacity: kpiMonth >= currentYM() ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>›</button>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{monthlyAvg.sessions.toLocaleString()}</div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>total sessions in {monthlyAvg.monthLabel}</div>
              </div>
            </div>
          </div>

          <ChartCard
            title={`Total Charging Sessions (${granLabel})`}
            totalLabel="Total"
            totalValue={fmtCount(series.totalCount)}
            data={series.buckets.map((b) => b.count)}
            labels={labels}
            color={C.green}
            formatY={fmtCountShort}
            tooltips={sessionTips}
          />
          <ChartCard
            title={`Total Energy (${granLabel})`}
            totalLabel="Total"
            totalValue={fmtKwh(series.totalKwh)}
            data={series.buckets.map((b) => b.kwh)}
            labels={labels}
            color={C.opal}
            formatY={fmtKwhShort}
            tooltips={energyTips}
          />
        </>
      )}
    </div>
  );
}

interface ChartCardProps {
  title: string;
  totalLabel: string;
  totalValue: string;
  data: number[];
  labels: string[];
  color: string;
  formatY: (v: number) => string;
  tooltips?: (LineChartTooltip | undefined)[];
}

function ChartCard({ title, totalLabel, totalValue, data, labels, color, formatY, tooltips }: ChartCardProps) {
  return (
    <div style={{ background: C.white, borderRadius: 16, padding: '18px 24px', border: '1px solid #EBEBEB' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{title}</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: C.slate, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{totalLabel}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>{totalValue}</div>
        </div>
      </div>
      <LineChart data={data} labels={labels} color={color} height={300} formatY={formatY} tooltips={tooltips} />
    </div>
  );
}

function pillBtn(active: boolean): React.CSSProperties {
  return {
    padding: '7px 14px', borderRadius: 99,
    border: active ? 'none' : '1px solid #EBEBEB',
    background: active ? C.green : C.white,
    color: active ? C.white : C.slate,
    fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  };
}
