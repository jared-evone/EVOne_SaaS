import { useEffect, useMemo, useState } from 'react';
import { C } from '../../theme';
import {
  aggregate, CarparkCard, ensureCpoCarparkSet, toggleBtn,
  ensureChargingTrendsCache, getCachedChargingRows, clearChargingTrendsCache,
  ensureExcludedVehicles, normalizePlate,
  type Granularity,
} from './LocationTrends';

type RangeMonths = 3 | 6 | 12 | 'all';
type SourceFilter = 'all' | 'goparkin' | 'sp';

function rangeStartISO(months: RangeMonths): string | null {
  if (months === 'all') return null;
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return d.toISOString().slice(0, 10);
}

const isSuccess = (s: string | null) => (s ?? '').toLowerCase() === 'success';

// ── Component ─────────────────────────────────────────────────────
// Sessions reuses the shared charging cache (preloaded on dashboard mount, same
// one Location Trends uses) and derives "successful sessions only" in memory — no
// separate fetch, so it's instant once that one cache is warm.

export function Sessions() {
  const [rangeMonths, setRangeMonths] = useState<RangeMonths>(12);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [dcOnly, setDcOnly] = useState(false);
  const [cpoOnly, setCpoOnly] = useState(false);
  const [cpoSet, setCpoSet] = useState<Set<string>>(new Set());
  const [excludeOn, setExcludeOn] = useState(false);
  const [excludedSet, setExcludedSet] = useState<Set<string>>(new Set());
  const [showEnergy, setShowEnergy] = useState(true);

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

  // Success-only + range + source + charge-type + CPO — all in memory, instant.
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

  // aggregate sorts by total kWh; re-sort by session count to match the count metric.
  const trends = useMemo(
    () => aggregate(filteredRows, granularity, rangeStartISO(rangeMonths))
      .sort((a, b) => b.totalCount - a.totalCount),
    [filteredRows, granularity, rangeMonths],
  );

  const rangeLabel =
    rangeMonths === 'all' ? 'All time' :
    rangeMonths === 3 ? 'Last 3 months' :
    rangeMonths === 6 ? 'Last 6 months' :
    'Last 12 months';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* Filter strip */}
      <div style={{ background: C.white, borderRadius: 16, padding: '14px 20px', border: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['3', '6', '12', 'all'] as const).map((r) => {
            const v: RangeMonths = r === 'all' ? 'all' : (Number(r) as 3 | 6 | 12);
            return (
              <button key={r} onClick={() => setRangeMonths(v)} style={pillBtn(rangeMonths === v)}>
                {r === 'all' ? 'All time' : `${r} mo`}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 24, background: '#EBEBEB' }} />

        <div style={{ display: 'flex', gap: 4 }}>
          {(['day', 'week', 'month'] as const).map((g) => (
            <button key={g} onClick={() => setGranularity(g)} style={pillBtn(granularity === g)}>
              {g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: '#EBEBEB' }} />

        <button onClick={() => setDcOnly((v) => !v)} style={toggleBtn(dcOnly)}>{dcOnly ? '✓ ' : ''}DC Only</button>
        <button onClick={() => setCpoOnly((v) => !v)} style={toggleBtn(cpoOnly)}>{cpoOnly ? '✓ ' : ''}CPO Only (EVE + EVOne)</button>
        <button onClick={() => setExcludeOn((v) => !v)} style={toggleBtn(excludeOn)}>{excludeOn ? '✓ ' : ''}Exclude Vehicles{excludedSet.size > 0 ? ` (${excludedSet.size})` : ''}</button>
        <button onClick={() => setShowEnergy((v) => !v)}
          style={{ padding: '7px 14px', borderRadius: 99, border: `1px solid ${showEnergy ? C.opal : '#EBEBEB'}`, background: showEnergy ? '#E3F0FF' : C.white, color: showEnergy ? '#1A62C0' : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          {showEnergy ? '✓ ' : ''}Energy (kWh)
        </button>

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
        <span><strong style={{ color: '#1a1a1a' }}>{rangeLabel}</strong> · {granularity === 'day' ? 'daily' : granularity === 'week' ? 'weekly' : 'monthly'} · <strong style={{ color: C.green }}>sessions</strong>{showEnergy && <> + <strong style={{ color: C.opal }}>energy kWh</strong></>} · <strong style={{ color: '#1a1a1a' }}>successful sessions only</strong></span>
        <span>{trends.length} carpark{trends.length === 1 ? '' : 's'} with data</span>
        <span>{filteredRows.length.toLocaleString()} session{filteredRows.length === 1 ? '' : 's'}</span>
        {!loading && (
          <button onClick={refresh}
            style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ↻ Refresh data
          </button>
        )}
      </div>

      {/* Cards */}
      {loading && trends.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '60px 24px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
          Loading charging data… {loadedCount > 0 ? `(${loadedCount.toLocaleString()} rows so far)` : ''}
        </div>
      ) : trends.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '60px 24px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
          No successful sessions for the selected range and source filter.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16 }}>
          {trends.map((t) => <CarparkCard key={t.carpark_code} t={t} granularity={granularity} metric="count" dual={showEnergy} />)}
        </div>
      )}
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
