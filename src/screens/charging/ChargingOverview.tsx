import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    let cancelled = false;
    ensureCpoCarparkSet().then((s) => { if (!cancelled) setCpoSet(s); }).catch(() => {});
    ensureExcludedVehicles().then((s) => { if (!cancelled) setExcludedSet(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const [rows, setRows] = useState(() => getCachedChargingRows() ?? []);
  const [loading, setLoading] = useState(() => getCachedChargingRows() === null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedChargingRows();
    if (cached) { setRows(cached); setLoading(false); return; }
    setLoading(true);
    setError(null);
    setLoadedCount(0);
    ensureChargingTrendsCache((n) => { if (!cancelled) setLoadedCount(n); })
      .then((r) => { if (!cancelled) { setRows(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const refresh = () => {
    clearChargingTrendsCache();
    setRows([]);
    setLoading(true);
    setRefreshKey((k) => k + 1);
  };

  const filteredRows = useMemo(() => {
    const startISO = rangeStartISO(rangeMonths);
    return rows.filter((r) => {
      if (!isSuccess(r.payment_status)) return false;
      const dateStr = r.start_date_time.slice(0, 10);
      if (dateStr.length < 10) return false;
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (dcOnly && r.charge_type !== 'DC') return false;
      if (cpoOnly && cpoSet.size > 0 && !(r.carpark_code && cpoSet.has(r.carpark_code))) return false;
      if (excludeOn && excludedSet.size > 0 && r.vehicle_plate_number && excludedSet.has(normalizePlate(r.vehicle_plate_number))) return false;
      if (startISO && dateStr < startISO) return false;
      return true;
    });
  }, [rows, rangeMonths, sourceFilter, dcOnly, cpoOnly, cpoSet, excludeOn, excludedSet]);

  const series = useMemo(
    () => aggregateTotal(filteredRows, granularity, rangeStartISO(rangeMonths)),
    [filteredRows, granularity, rangeMonths],
  );

  const carparks = useMemo(() => {
    const s = new Set<string>();
    for (const r of filteredRows) if (r.carpark_code) s.add(r.carpark_code);
    return s.size;
  }, [filteredRows]);

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
        <button onClick={() => setCpoOnly((v) => !v)} style={toggleBtn(cpoOnly)}>{cpoOnly ? '✓ ' : ''}CPO Only (EVE + EVOne)</button>
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
        <span><strong style={{ color: '#1a1a1a' }}>{rangeLabel}</strong> · {granLabel} totals across all carparks · <strong style={{ color: '#1a1a1a' }}>successful sessions only</strong></span>
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
