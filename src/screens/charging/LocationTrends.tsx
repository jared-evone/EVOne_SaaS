import { useEffect, useMemo, useState } from 'react';
import { C } from '../../theme';
import { LineChart } from '../../components/charts';
import { supabase } from '../../lib/supabase';

export type Granularity = 'day' | 'week' | 'month';
type RangeMonths = 6 | 12 | 24 | 'all';
type SourceFilter = 'all' | 'goparkin' | 'sp';

export interface RawRow {
  carpark_code: string | null;
  start_date_time: string;
  total_energy_supplied_kwh: number | null;
  source: 'goparkin' | 'sp';
  charge_type: string | null;
  payment_status: string | null;
}

interface BucketPoint { key: string; label: string; kwh: number; count: number; }

export interface CarparkTrend {
  carpark_code: string;
  sources: ('goparkin' | 'sp')[];
  buckets: BucketPoint[];
  totalKwh: number;
  latestKwh: number;
  priorKwh: number;
  peakKwh: number;
  totalCount: number;
  latestCount: number;
  priorCount: number;
  peakCount: number;
}

const SOURCE_COLORS: Record<'goparkin' | 'sp', { bg: string; color: string }> = {
  goparkin: { bg: '#E3F0FF', color: '#1A62C0' },
  sp:       { bg: '#FFF0E0', color: '#B45309' },
};

// ── Date helpers ──────────────────────────────────────────────────

// All week math is done in UTC. Parsing as `T00:00:00` (local) but formatting via
// toISOString() (UTC) drifts the bucket grid out of sync with per-row keys in any
// non-UTC browser, dropping most weeks to zero — so parse with `Z` and use the
// getUTC*/setUTC* family throughout. (Month math uses pure string slicing, immune.)
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const diff = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthKey(iso: string): string { return iso.slice(0, 7); }

function addMonthsKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function rangeStartISO(months: RangeMonths): string | null {
  if (months === 'all') return null;
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return d.toISOString().slice(0, 10);
}

function fmtMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function fmtWeekLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function fmtDayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

// Full date for hover tooltips: "Week of 12 May 2025" (week start) or "May 2025" (month).
function fmtTooltipDate(key: string, granularity: Granularity): string {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const [y, m, d] = key.split('-').map(Number);
  return 'Week of ' + new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmtKwh(n: number): string {
  return `${Number(n).toLocaleString('en-SG', { maximumFractionDigits: 1 })} kWh`;
}

function fmtKwhShort(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return Math.round(n).toString();
}

function fmtCount(n: number): string {
  return `${Math.round(n).toLocaleString('en-SG')} session${Math.round(n) === 1 ? '' : 's'}`;
}

function fmtCountShort(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return Math.round(n).toString();
}

// ── Aggregation ───────────────────────────────────────────────────

function buildBucketKeys(granularity: Granularity, startISO: string | null, endISO: string): string[] {
  if (granularity === 'day') {
    const keys: string[] = [];
    let cur = startISO ?? endISO;
    let guard = 0;
    while (cur <= endISO && guard++ < 4000) {
      keys.push(cur);
      cur = addDaysISO(cur, 1);
    }
    return keys;
  }
  if (granularity === 'week') {
    const startMonday = mondayOf(startISO ?? endISO);
    const endMonday = mondayOf(endISO);
    const keys: string[] = [];
    let cur = startMonday;
    while (cur <= endMonday) {
      keys.push(cur);
      cur = addDaysISO(cur, 7);
    }
    return keys;
  }
  const startMo = monthKey(startISO ?? endISO);
  const endMo = monthKey(endISO);
  const keys: string[] = [];
  let cur = startMo;
  while (cur <= endMo) {
    keys.push(cur);
    cur = addMonthsKey(cur, 1);
  }
  return keys;
}

function thinLabels(keys: string[], formatter: (k: string) => string, target: number = 10): string[] {
  if (keys.length <= target) return keys.map(formatter);
  const stride = Math.ceil(keys.length / target);
  return keys.map((k, i) => (i % stride === 0 || i === keys.length - 1 ? formatter(k) : ''));
}

export function aggregate(rows: RawRow[], granularity: Granularity, startISO: string | null): CarparkTrend[] {
  const todayISO = new Date().toISOString().slice(0, 10);
  // Derive the data's actual min/max dates in one pass. The axis START for "all time"
  // (startISO null) must be the earliest row, not today. The axis END is the latest
  // data date (never future-of-today) — NOT today — so an incomplete current period
  // doesn't render as a misleading drop-to-zero cliff at the right edge.
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const r of rows) {
    const d = r.start_date_time.slice(0, 10);
    if (d.length < 10) continue;
    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
  }
  const effectiveStartISO = startISO ?? minDate;
  const effectiveEndISO = maxDate && maxDate < todayISO ? maxDate : todayISO;

  const bucketKeys = buildBucketKeys(granularity, effectiveStartISO, effectiveEndISO);
  const formatter = granularity === 'day' ? fmtDayLabel : granularity === 'week' ? fmtWeekLabel : fmtMonthLabel;
  const labels = thinLabels(bucketKeys, formatter);

  // group rows by carpark + bucket — track both summed kWh and session count
  const perCp = new Map<string, { kwhByBucket: Map<string, number>; countByBucket: Map<string, number>; sources: Set<'goparkin' | 'sp'> }>();
  for (const r of rows) {
    const dateISO = r.start_date_time.slice(0, 10);
    if (dateISO.length < 10) continue; // skip malformed/empty timestamps (mondayOf would throw)
    const code = r.carpark_code || '(unknown)';
    const bucketKey = granularity === 'day' ? dateISO : granularity === 'week' ? mondayOf(dateISO) : monthKey(dateISO);
    let entry = perCp.get(code);
    if (!entry) { entry = { kwhByBucket: new Map(), countByBucket: new Map(), sources: new Set() }; perCp.set(code, entry); }
    entry.kwhByBucket.set(bucketKey, (entry.kwhByBucket.get(bucketKey) ?? 0) + Number(r.total_energy_supplied_kwh ?? 0));
    entry.countByBucket.set(bucketKey, (entry.countByBucket.get(bucketKey) ?? 0) + 1);
    entry.sources.add(r.source);
  }

  const out: CarparkTrend[] = [];
  for (const [code, entry] of perCp) {
    const buckets: BucketPoint[] = bucketKeys.map((key, i) => ({
      key,
      label: labels[i],
      kwh: Math.round((entry.kwhByBucket.get(key) ?? 0) * 100) / 100,
      count: entry.countByBucket.get(key) ?? 0,
    }));
    const totalKwh = buckets.reduce((s, b) => s + b.kwh, 0);
    const latestKwh = buckets[buckets.length - 1]?.kwh ?? 0;
    const priorKwh = buckets[buckets.length - 2]?.kwh ?? 0;
    const peakKwh = buckets.reduce((m, b) => Math.max(m, b.kwh), 0);
    const totalCount = buckets.reduce((s, b) => s + b.count, 0);
    const latestCount = buckets[buckets.length - 1]?.count ?? 0;
    const priorCount = buckets[buckets.length - 2]?.count ?? 0;
    const peakCount = buckets.reduce((m, b) => Math.max(m, b.count), 0);
    out.push({
      carpark_code: code,
      sources: Array.from(entry.sources).sort(),
      buckets,
      totalKwh,
      latestKwh,
      priorKwh,
      peakKwh,
      totalCount,
      latestCount,
      priorCount,
      peakCount,
    });
  }
  out.sort((a, b) => b.totalKwh - a.totalKwh);
  return out;
}

// ── Session cache ─────────────────────────────────────────────────
// The trends view never changes which rows it needs — it always wants the full
// session history; range / source / granularity are pure client-side views over
// it. So we load every row ONCE per session into a module-level cache and derive
// every pill switch in memory (zero network). The one-time load fetches pages in
// parallel (count → concurrent ranges) instead of 1000-at-a-time sequentially.

let cachedRows: RawRow[] | null = null;
let cachePromise: Promise<RawRow[]> | null = null;

export function getCachedChargingRows(): RawRow[] | null {
  return cachedRows;
}

export function clearChargingTrendsCache(): void {
  cachedRows = null;
  cachePromise = null;
}

export function ensureChargingTrendsCache(onProgress?: (n: number) => void): Promise<RawRow[]> {
  if (cachedRows) return Promise.resolve(cachedRows);
  if (!cachePromise) {
    cachePromise = loadAllChargingRows(onProgress)
      .then((r) => { cachedRows = r; return r; })
      .catch((e) => { cachePromise = null; throw e; });
  }
  return cachePromise;
}

// Set of carpark_codes operated by the CPO (EVE + EVOne) — i.e. every row in
// cpo_managed_carparks (categories evone_cpo / eve_cpo). Same membership the
// Weekly Detail "CPO Only" toggle uses. Tiny table; loaded once per session.
let cpoSetCache: Set<string> | null = null;
let cpoSetPromise: Promise<Set<string>> | null = null;

async function loadCpoCarparkSet(): Promise<Set<string>> {
  const { data, error } = await supabase.from('cpo_managed_carparks').select('carpark_name');
  if (error) throw new Error(error.message);
  return new Set<string>(((data ?? []) as { carpark_name: string | null }[])
    .map((r) => r.carpark_name)
    .filter((n): n is string => !!n));
}

export function ensureCpoCarparkSet(): Promise<Set<string>> {
  if (cpoSetCache) return Promise.resolve(cpoSetCache);
  if (!cpoSetPromise) {
    cpoSetPromise = loadCpoCarparkSet()
      .then((s) => { cpoSetCache = s; return s; })
      .catch((e) => { cpoSetPromise = null; throw e; });
  }
  return cpoSetPromise;
}

// Count-then-parallel-range pagination. Assumes the table is stable for the
// duration of the load (records are imported via a separate modal, never
// concurrently with a dashboard view), so offset pages don't shift under us.
async function loadAllChargingRows(onProgress?: (n: number) => void): Promise<RawRow[]> {
  const PAGE = 1000;
  const CONCURRENCY = 8;

  const { count, error: countErr } = await supabase
    .from('crm_charging_records')
    .select('*', { count: 'exact', head: true });
  if (countErr) throw new Error(countErr.message);
  // A null count would otherwise collapse to one page and silently truncate to 1000 rows.
  if (count == null) throw new Error('Could not determine record count for the trends cache.');

  const total = count;
  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const rows: RawRow[] = [];

  for (let i = 0; i < pageCount; i += CONCURRENCY) {
    const batch = [];
    for (let p = i; p < Math.min(i + CONCURRENCY, pageCount); p++) {
      batch.push(
        supabase
          .from('crm_charging_records')
          .select('carpark_code, start_date_time, total_energy_supplied_kwh, source, charge_type, payment_status')
          .order('id', { ascending: true })
          .range(p * PAGE, p * PAGE + PAGE - 1),
      );
    }
    const results = await Promise.all(batch);
    for (const res of results) {
      if (res.error) throw new Error(res.error.message);
      if (res.data) rows.push(...(res.data as RawRow[]));
    }
    onProgress?.(rows.length);
  }
  return rows;
}

// ── Component ─────────────────────────────────────────────────────

export function LocationTrends() {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [rangeMonths, setRangeMonths] = useState<RangeMonths>(12);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [dcOnly, setDcOnly] = useState(false);
  const [cpoOnly, setCpoOnly] = useState(false);
  const [cpoSet, setCpoSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    ensureCpoCarparkSet().then((s) => { if (!cancelled) setCpoSet(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Load the full session history ONCE; pill switches are derived in memory.
  const [rows, setRows] = useState<RawRow[]>(() => getCachedChargingRows() ?? []);
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

  // Range + source + charge-type + CPO are applied in memory — instant, no refetch.
  const filteredRows = useMemo(() => {
    const startISO = rangeStartISO(rangeMonths);
    return rows.filter((r) => {
      const dateStr = r.start_date_time.slice(0, 10);
      if (dateStr.length < 10) return false;
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (dcOnly && r.charge_type !== 'DC') return false;
      if (cpoOnly && cpoSet.size > 0 && !(r.carpark_code && cpoSet.has(r.carpark_code))) return false;
      if (startISO && dateStr < startISO) return false;
      return true;
    });
  }, [rows, rangeMonths, sourceFilter, dcOnly, cpoOnly, cpoSet]);

  const trends = useMemo(
    () => aggregate(filteredRows, granularity, rangeStartISO(rangeMonths)),
    [filteredRows, granularity, rangeMonths],
  );

  const rangeLabel =
    rangeMonths === 'all' ? 'All time' :
    rangeMonths === 6 ? 'Last 6 months' :
    rangeMonths === 12 ? 'Last 12 months' :
    'Last 24 months';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* Filter strip */}
      <div style={{ background: C.white, borderRadius: 16, padding: '14px 20px', border: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['6', '12', '24', 'all'] as const).map((r) => {
            const v: RangeMonths = r === 'all' ? 'all' : (Number(r) as 6 | 12 | 24);
            const active = rangeMonths === v;
            return (
              <button key={r} onClick={() => setRangeMonths(v)} style={pillBtn(active)}>
                {r === 'all' ? 'All time' : `${r} mo`}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 24, background: '#EBEBEB' }} />

        <div style={{ display: 'flex', gap: 4 }}>
          {(['month', 'week'] as const).map((g) => (
            <button key={g} onClick={() => setGranularity(g)} style={pillBtn(granularity === g)}>
              {g === 'month' ? 'Monthly' : 'Weekly'}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: '#EBEBEB' }} />

        <button onClick={() => setDcOnly((v) => !v)} style={toggleBtn(dcOnly)}>{dcOnly ? '✓ ' : ''}DC Only</button>
        <button onClick={() => setCpoOnly((v) => !v)} style={toggleBtn(cpoOnly)}>{cpoOnly ? '✓ ' : ''}CPO Only (EVE + EVOne)</button>

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
        <span><strong style={{ color: '#1a1a1a' }}>{rangeLabel}</strong> · {granularity === 'month' ? 'monthly' : 'weekly'} aggregate</span>
        <span>{trends.length} carpark{trends.length === 1 ? '' : 's'} with data</span>
        <span>{filteredRows.length.toLocaleString()} session{filteredRows.length === 1 ? '' : 's'} analysed</span>
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
          Loading sessions… {loadedCount > 0 ? `(${loadedCount.toLocaleString()} so far)` : ''}
        </div>
      ) : trends.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '60px 24px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
          No charging activity for the selected range and source filter.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16 }}>
          {trends.map((t) => <CarparkCard key={t.carpark_code} t={t} granularity={granularity} />)}
        </div>
      )}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────

export function CarparkCard({ t, granularity, metric = 'kwh' }: { t: CarparkTrend; granularity: Granularity; metric?: 'kwh' | 'count' }) {
  const isCount = metric === 'count';
  const data = t.buckets.map((b) => (isCount ? b.count : b.kwh));
  const labels = t.buckets.map((b) => b.label);

  const total  = isCount ? t.totalCount  : t.totalKwh;
  const latest = isCount ? t.latestCount : t.latestKwh;
  const prior  = isCount ? t.priorCount  : t.priorKwh;
  const peak   = isCount ? t.peakCount   : t.peakKwh;
  const fmtVal  = isCount ? fmtCount      : fmtKwh;
  const fmtAxis = isCount ? fmtCountShort : fmtKwhShort;

  // delta vs prior bucket. 'new' only when this is the carpark's first-ever active
  // period — a long-running site with a single gap period must not read as "new".
  const nonzeroBuckets = data.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
  let deltaPill: { label: string; bg: string; color: string } | null = null;
  if (prior > 0) {
    const pct = ((latest - prior) / prior) * 100;
    if (Math.abs(pct) < 0.5) deltaPill = { label: '0%', bg: '#F3F3F3', color: C.slate };
    else if (pct > 0)        deltaPill = { label: `▲ ${pct.toFixed(0)}%`, bg: '#E4F3E3', color: '#1B512D' };
    else                     deltaPill = { label: `▼ ${Math.abs(pct).toFixed(0)}%`, bg: '#FDEAEA', color: '#C0321A' };
  } else if (latest > 0 && nonzeroBuckets === 1) {
    deltaPill = { label: 'new', bg: '#E3F0FF', color: '#1A62C0' };
  }

  const periodLabel = granularity === 'month' ? 'month' : granularity === 'day' ? 'day' : 'week';

  // Hover tooltips for weekly / monthly only (daily excluded — too dense).
  const tooltips = granularity === 'day'
    ? undefined
    : t.buckets.map((b) => ({ title: fmtTooltipDate(b.key, granularity), value: fmtVal(isCount ? b.count : b.kwh) }));

  return (
    <div style={{ background: C.white, borderRadius: 16, padding: '18px 20px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div title={t.carpark_code} style={{ fontSize: 15, fontWeight: 700, color: C.green, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.carpark_code}</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            {t.sources.map((s) => (
              <span key={s} style={{ background: SOURCE_COLORS[s].bg, color: SOURCE_COLORS[s].color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {s === 'goparkin' ? 'GoParkin' : 'SP'}
              </span>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: C.slate, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>{fmtVal(total)}</div>
        </div>
      </div>

      <LineChart data={data} labels={labels} color={C.green} height={200} formatY={fmtAxis} tooltips={tooltips} />

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', borderTop: '1px solid #F3F3F3', paddingTop: 10, fontSize: 12 }}>
        <div>
          <div style={{ color: C.slate, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Latest {periodLabel}</div>
          <div style={{ color: '#1a1a1a', fontWeight: 700 }}>{fmtVal(latest)}</div>
        </div>
        <div>
          <div style={{ color: C.slate, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Prior {periodLabel}</div>
          <div style={{ color: '#1a1a1a', fontWeight: 600 }}>{fmtVal(prior)}</div>
        </div>
        <div>
          <div style={{ color: C.slate, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Peak {periodLabel}</div>
          <div style={{ color: '#1a1a1a', fontWeight: 600 }}>{fmtVal(peak)}</div>
        </div>
        {deltaPill && (
          <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>
            <span style={{ background: deltaPill.bg, color: deltaPill.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>{deltaPill.label}</span>
          </div>
        )}
      </div>
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

// Toggle filter (on/off) — honeydew fill + green outline when active, matching the
// Weekly Detail "CPO Only" toggle.
export function toggleBtn(active: boolean): React.CSSProperties {
  return {
    padding: '7px 14px', borderRadius: 99,
    border: `1px solid ${active ? C.green : '#EBEBEB'}`,
    background: active ? C.honeydew : C.white,
    color: active ? C.green : C.slate,
    fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  };
}
