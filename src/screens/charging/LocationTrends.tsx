import { useCallback, useEffect, useMemo, useState } from 'react';
import { C } from '../../theme';
import { LineChart } from '../../components/charts';
import { supabase } from '../../lib/supabase';
import { Pencil, X } from 'lucide-react';
import { usePermissions } from '../../permissions';

export type Granularity = 'day' | 'week' | 'month';
type RangeMonths = 6 | 12 | 24 | 'all';
type SourceFilter = 'all' | 'goparkin' | 'sp';

export interface RawRow {
  carpark_code: string | null;
  charger_id: string | null;
  start_date_time: string;
  total_energy_supplied_kwh: number | null;
  source: 'goparkin' | 'sp';
  charge_type: string | null;
  payment_status: string | null;
  vehicle_plate_number: string | null;
}

interface BucketPoint { key: string; label: string; kwh: number; count: number; }

// Normalized charger type; GoParkin's "AC and DC integrated (equipment)"
// variants collapse to 'AC/DC' — they can't be split further.
export type ChargerType = 'AC' | 'DC' | 'AC/DC';
function chargerTypeOf(raw: string | null): ChargerType | null {
  if (!raw) return null;
  if (raw === 'AC' || raw === 'DC') return raw;
  return 'AC/DC';
}

// Per-charger sub-series inside a carpark, on the SAME bucket grid as the
// parent — lets the card filter to one charger / one charge type.
export interface ChargerSeries {
  charger_id: string;
  type: ChargerType | null;
  buckets: BucketPoint[];
  totalKwh: number;
  totalCount: number;
}

export interface CarparkTrend {
  carpark_code: string;
  sources: ('goparkin' | 'sp')[];
  buckets: BucketPoint[];
  chargers: ChargerSeries[];
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
export function fmtTooltipDate(key: string, granularity: Granularity): string {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const [y, m, d] = key.split('-').map(Number);
  return 'Week of ' + new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fmtKwh(n: number): string {
  return `${Number(n).toLocaleString('en-SG', { maximumFractionDigits: 1 })} kWh`;
}

export function fmtKwhShort(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return Math.round(n).toString();
}

export function fmtCount(n: number): string {
  return `${Math.round(n).toLocaleString('en-SG')} session${Math.round(n) === 1 ? '' : 's'}`;
}

export function fmtCountShort(n: number): string {
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

// Shared axis scaffold: bucket keys, thinned labels, and a row→bucketKey mapper.
// The axis START for "all time" (startISO null) is the earliest row, not today.
// The axis END is the latest data date (never future-of-today) so an incomplete
// current period doesn't render as a misleading drop-to-zero cliff at the right edge.
function bucketScaffold(rows: RawRow[], granularity: Granularity, startISO: string | null) {
  const todayISO = new Date().toISOString().slice(0, 10);
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
  const keyOf = (dateISO: string) => granularity === 'day' ? dateISO : granularity === 'week' ? mondayOf(dateISO) : monthKey(dateISO);
  return { bucketKeys, labels, keyOf };
}

export interface TotalSeries {
  buckets: { key: string; label: string; kwh: number; count: number }[];
  totalKwh: number;
  totalCount: number;
}

// Single series summed across ALL carparks (for the Overview tab).
export function aggregateTotal(rows: RawRow[], granularity: Granularity, startISO: string | null): TotalSeries {
  const { bucketKeys, labels, keyOf } = bucketScaffold(rows, granularity, startISO);
  const kwhByBucket = new Map<string, number>();
  const countByBucket = new Map<string, number>();
  for (const r of rows) {
    const dateISO = r.start_date_time.slice(0, 10);
    if (dateISO.length < 10) continue;
    const bk = keyOf(dateISO);
    kwhByBucket.set(bk, (kwhByBucket.get(bk) ?? 0) + Number(r.total_energy_supplied_kwh ?? 0));
    countByBucket.set(bk, (countByBucket.get(bk) ?? 0) + 1);
  }
  const buckets = bucketKeys.map((key, i) => ({
    key,
    label: labels[i],
    kwh: Math.round((kwhByBucket.get(key) ?? 0) * 100) / 100,
    count: countByBucket.get(key) ?? 0,
  }));
  return {
    buckets,
    totalKwh: buckets.reduce((s, b) => s + b.kwh, 0),
    totalCount: buckets.reduce((s, b) => s + b.count, 0),
  };
}

export function aggregate(rows: RawRow[], granularity: Granularity, startISO: string | null): CarparkTrend[] {
  const { bucketKeys, labels, keyOf } = bucketScaffold(rows, granularity, startISO);

  // group rows by carpark + bucket — track both summed kWh and session count,
  // plus a per-charger breakdown on the same bucket grid
  interface ChargerAcc { kwhByBucket: Map<string, number>; countByBucket: Map<string, number>; type: ChargerType | null }
  const perCp = new Map<string, { kwhByBucket: Map<string, number>; countByBucket: Map<string, number>; sources: Set<'goparkin' | 'sp'>; chargers: Map<string, ChargerAcc> }>();
  for (const r of rows) {
    const dateISO = r.start_date_time.slice(0, 10);
    if (dateISO.length < 10) continue; // skip malformed/empty timestamps (mondayOf would throw)
    const code = r.carpark_code || '(unknown)';
    const bucketKey = keyOf(dateISO);
    let entry = perCp.get(code);
    if (!entry) { entry = { kwhByBucket: new Map(), countByBucket: new Map(), sources: new Set(), chargers: new Map() }; perCp.set(code, entry); }
    const kwh = Number(r.total_energy_supplied_kwh ?? 0);
    entry.kwhByBucket.set(bucketKey, (entry.kwhByBucket.get(bucketKey) ?? 0) + kwh);
    entry.countByBucket.set(bucketKey, (entry.countByBucket.get(bucketKey) ?? 0) + 1);
    entry.sources.add(r.source);
    if (r.charger_id) {
      let ch = entry.chargers.get(r.charger_id);
      if (!ch) { ch = { kwhByBucket: new Map(), countByBucket: new Map(), type: null }; entry.chargers.set(r.charger_id, ch); }
      ch.kwhByBucket.set(bucketKey, (ch.kwhByBucket.get(bucketKey) ?? 0) + kwh);
      ch.countByBucket.set(bucketKey, (ch.countByBucket.get(bucketKey) ?? 0) + 1);
      ch.type = chargerTypeOf(r.charge_type) ?? ch.type;
    }
  }

  const out: CarparkTrend[] = [];
  for (const [code, entry] of perCp) {
    const buckets: BucketPoint[] = bucketKeys.map((key, i) => ({
      key,
      label: labels[i],
      kwh: Math.round((entry.kwhByBucket.get(key) ?? 0) * 100) / 100,
      count: entry.countByBucket.get(key) ?? 0,
    }));
    const chargers: ChargerSeries[] = [...entry.chargers].map(([id, ch]) => {
      const chBuckets: BucketPoint[] = bucketKeys.map((key, i) => ({
        key,
        label: labels[i],
        kwh: Math.round((ch.kwhByBucket.get(key) ?? 0) * 100) / 100,
        count: ch.countByBucket.get(key) ?? 0,
      }));
      return {
        charger_id: id,
        type: ch.type,
        buckets: chBuckets,
        totalKwh: chBuckets.reduce((s, b) => s + b.kwh, 0),
        totalCount: chBuckets.reduce((s, b) => s + b.count, 0),
      };
    }).sort((a, b) => b.totalKwh - a.totalKwh);
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
      chargers,
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

async function liveChargingRowCount(): Promise<number | null> {
  const { count, error } = await supabase
    .from('crm_charging_records')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? null;
}

export async function ensureChargingTrendsCache(onProgress?: (n: number) => void, revalidate = false): Promise<RawRow[]> {
  // Serve the in-memory snapshot, but when asked to revalidate, first do a cheap live
  // row-count check and drop the snapshot if the table changed (e.g. a new CSV import).
  // This makes every login converge to the latest data instead of holding a stale copy
  // from whenever the tab first loaded — the cause of two logins showing different totals.
  if (cachedRows) {
    if (!revalidate) return cachedRows;
    try {
      const live = await liveChargingRowCount();
      if (live == null || live === cachedRows.length) return cachedRows;
    } catch {
      return cachedRows; // transient error — keep serving what we have
    }
    cachedRows = null;
    cachePromise = null;
  }
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

// EVOne-operated carparks only (category evone_cpo) — the "CPO EVOne" quick select.
let evoneSetCache: Set<string> | null = null;
let evoneSetPromise: Promise<Set<string>> | null = null;

async function loadEvoneCarparkSet(): Promise<Set<string>> {
  const { data, error } = await supabase.from('cpo_managed_carparks').select('carpark_name').eq('category', 'evone_cpo');
  if (error) throw new Error(error.message);
  return new Set<string>(((data ?? []) as { carpark_name: string | null }[])
    .map((r) => r.carpark_name)
    .filter((n): n is string => !!n));
}

export function ensureEvoneCpoCarparkSet(): Promise<Set<string>> {
  if (evoneSetCache) return Promise.resolve(evoneSetCache);
  if (!evoneSetPromise) {
    evoneSetPromise = loadEvoneCarparkSet()
      .then((s) => { evoneSetCache = s; return s; })
      .catch((e) => { evoneSetPromise = null; throw e; });
  }
  return evoneSetPromise;
}

// Vehicles to exclude from the analytics. The user picks whole companies (in the
// Excluded Companies tab); here we resolve those companies to the plate set of all
// their CRM vehicles. Plates are normalised (UPPER + trim) on both sides so casing /
// spacing differences match. Cache is cleared whenever the exclusion list is edited.
export function normalizePlate(p: string | null | undefined): string {
  return (p ?? '').toUpperCase().trim();
}

let excludedCache: Set<string> | null = null;
let excludedPromise: Promise<Set<string>> | null = null;

async function loadExcludedVehicles(): Promise<Set<string>> {
  const [{ data: ex, error: exErr }, { data: veh, error: vErr }] = await Promise.all([
    supabase.from('charging_excluded_companies').select('company_id'),
    supabase.from('crm_vehicles').select('vehicle_plate, company_id'),
  ]);
  if (exErr) throw new Error(exErr.message);
  if (vErr) throw new Error(vErr.message);
  const excludedCompanies = new Set(((ex ?? []) as { company_id: string }[]).map((r) => r.company_id));
  const set = new Set<string>();
  for (const v of (veh ?? []) as { vehicle_plate: string | null; company_id: string | null }[]) {
    if (v.company_id && excludedCompanies.has(v.company_id)) {
      const p = normalizePlate(v.vehicle_plate);
      if (p) set.add(p);
    }
  }
  return set;
}

export function ensureExcludedVehicles(): Promise<Set<string>> {
  if (excludedCache) return Promise.resolve(excludedCache);
  if (!excludedPromise) {
    excludedPromise = loadExcludedVehicles()
      .then((s) => { excludedCache = s; return s; })
      .catch((e) => { excludedPromise = null; throw e; });
  }
  return excludedPromise;
}

export function clearExcludedVehiclesCache(): void {
  excludedCache = null;
  excludedPromise = null;
}

// ── Location chart groups ─────────────────────────────────────────
// Display-level grouping: several raw location names (e.g. before/after a CSMS
// rename) render as ONE chart. Raw records are never rewritten; the member
// table's primary key guarantees a location lives in exactly one chart.

export interface ChartMeta { key: string; groupId: string | null; title: string; members: string[]; }

interface LocationGroupsState {
  titles: Map<string, string>;   // group_id → chart title
  memberTo: Map<string, string>; // carpark_code → group_id
}

let locGroupsCache: LocationGroupsState | null = null;

async function fetchLocationGroups(): Promise<LocationGroupsState> {
  const [{ data: groups }, { data: members }] = await Promise.all([
    supabase.from('charging_location_groups').select('id, title'),
    supabase.from('charging_location_group_members').select('carpark_code, group_id'),
  ]);
  const titles = new Map<string, string>();
  for (const g of (groups ?? []) as { id: string; title: string }[]) titles.set(g.id, g.title);
  const memberTo = new Map<string, string>();
  for (const m of (members ?? []) as { carpark_code: string; group_id: string }[]) {
    if (titles.has(m.group_id)) memberTo.set(m.carpark_code, m.group_id);
  }
  return { titles, memberTo };
}

export function useLocationGroups() {
  const [state, setState] = useState<LocationGroupsState | null>(locGroupsCache);
  const reload = useCallback(async () => {
    const s = await fetchLocationGroups();
    locGroupsCache = s;
    setState(s);
  }, []);
  useEffect(() => { if (!locGroupsCache) void reload().catch(() => {}); else setState(locGroupsCache); }, [reload]);

  // Rewrites member rows onto their group key and reports which raw names fed
  // each chart — the card subtitle reads from the data, not the config.
  const apply = useCallback((rows: RawRow[]): { rows: RawRow[]; metaOf: (key: string) => ChartMeta } => {
    const s = state;
    if (!s || s.memberTo.size === 0) {
      return { rows, metaOf: (key) => ({ key, groupId: null, title: key, members: [key] }) };
    }
    const memberSets = new Map<string, Set<string>>();
    const mapped = rows.map((r) => {
      if (!r.carpark_code) return r;
      const gid = s.memberTo.get(r.carpark_code);
      if (!gid) return r;
      const key = `grp:${gid}`;
      let set = memberSets.get(key);
      if (!set) { set = new Set(); memberSets.set(key, set); }
      set.add(r.carpark_code);
      return { ...r, carpark_code: key };
    });
    const metaOf = (key: string): ChartMeta => {
      if (!key.startsWith('grp:')) return { key, groupId: null, title: key, members: [key] };
      const gid = key.slice(4);
      return { key, groupId: gid, title: s.titles.get(gid) ?? '(untitled chart)', members: [...(memberSets.get(key) ?? [])].sort() };
    };
    return { rows: mapped, metaOf };
  }, [state]);

  // A plain (ungrouped) location chart becomes a real group the first time it
  // is renamed or gains a member.
  const ensureGroup = async (meta: ChartMeta): Promise<string> => {
    if (meta.groupId) return meta.groupId;
    const { data, error } = await supabase.from('charging_location_groups')
      .insert({ title: meta.title }).select('id').single();
    if (error || !data) throw new Error(error?.message ?? 'Could not create the chart group.');
    const gid = (data as { id: string }).id;
    const { error: mErr } = await supabase.from('charging_location_group_members')
      .upsert({ carpark_code: meta.key, group_id: gid });
    if (mErr) throw new Error(mErr.message);
    return gid;
  };

  // A chart whose last location was claimed by another chart disappears.
  const dropEmptyGroups = async () => {
    const s = await fetchLocationGroups();
    const used = new Set(s.memberTo.values());
    const empty = [...s.titles.keys()].filter((id) => !used.has(id));
    if (empty.length > 0) await supabase.from('charging_location_groups').delete().in('id', empty);
  };

  const rename = async (meta: ChartMeta, title: string) => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === meta.title) return;
    if (meta.groupId) {
      const { error } = await supabase.from('charging_location_groups').update({ title: trimmed }).eq('id', meta.groupId);
      if (error) throw new Error(error.message);
    } else {
      await ensureGroup({ ...meta, title: trimmed });
    }
    await reload();
  };

  // Moving a location in claims it from wherever it was — one location lives
  // in exactly one chart (the member row's primary key).
  const addLocation = async (meta: ChartMeta, code: string) => {
    const gid = await ensureGroup(meta);
    const { error } = await supabase.from('charging_location_group_members')
      .upsert({ carpark_code: code, group_id: gid });
    if (error) throw new Error(error.message);
    await dropEmptyGroups();
    await reload();
  };

  const removeLocation = async (_meta: ChartMeta, code: string) => {
    const { error } = await supabase.from('charging_location_group_members').delete().eq('carpark_code', code);
    if (error) throw new Error(error.message);
    await dropEmptyGroups();
    await reload();
  };

  return { ready: state !== null, apply, rename, addLocation, removeLocation };
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
          .select('carpark_code, charger_id, start_date_time, total_energy_supplied_kwh, source, charge_type, payment_status, vehicle_plate_number')
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
  const [evoneOnly, setEvoneOnly] = useState(false);
  const [cpoSet, setCpoSet] = useState<Set<string>>(new Set());
  const [evoneSet, setEvoneSet] = useState<Set<string>>(new Set());
  const [excludeOn, setExcludeOn] = useState(false);
  const [excludedSet, setExcludedSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    ensureCpoCarparkSet().then((s) => { if (!cancelled) setCpoSet(s); }).catch(() => {});
    ensureEvoneCpoCarparkSet().then((s) => { if (!cancelled) setEvoneSet(s); }).catch(() => {});
    ensureExcludedVehicles().then((s) => { if (!cancelled) setExcludedSet(s); }).catch(() => {});
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

  // Range + source + charge-type + CPO are applied in memory — instant, no refetch.
  const filteredRows = useMemo(() => {
    const startISO = rangeStartISO(rangeMonths);
    return rows.filter((r) => {
      const dateStr = r.start_date_time.slice(0, 10);
      if (dateStr.length < 10) return false;
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (dcOnly && r.charge_type !== 'DC') return false;
      if (cpoOnly && cpoSet.size > 0 && !(r.carpark_code && cpoSet.has(r.carpark_code))) return false;
      if (evoneOnly && evoneSet.size > 0 && !(r.carpark_code && evoneSet.has(r.carpark_code))) return false;
      if (excludeOn && excludedSet.size > 0 && r.vehicle_plate_number && excludedSet.has(normalizePlate(r.vehicle_plate_number))) return false;
      if (startISO && dateStr < startISO) return false;
      return true;
    });
  }, [rows, rangeMonths, sourceFilter, dcOnly, cpoOnly, cpoSet, evoneOnly, evoneSet, excludeOn, excludedSet]);

  // Renaming charts and merging locations is an admin-only capability.
  const { isAdmin } = usePermissions();
  const { apply: applyGroups, rename, addLocation, removeLocation } = useLocationGroups();
  const grouped = useMemo(() => applyGroups(filteredRows), [applyGroups, filteredRows]);
  const rawCodes = useMemo(
    () => [...new Set(filteredRows.map((r) => r.carpark_code).filter((c): c is string => !!c))].sort(),
    [filteredRows],
  );

  const trends = useMemo(
    () => aggregate(grouped.rows, granularity, rangeStartISO(rangeMonths)),
    [grouped, granularity, rangeMonths],
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
        <button onClick={() => { setCpoOnly((v) => !v); setEvoneOnly(false); }} style={toggleBtn(cpoOnly)}>{cpoOnly ? '✓ ' : ''}CPO Only (EVE + EVOne)</button>
        <button onClick={() => { setEvoneOnly((v) => !v); setCpoOnly(false); }} style={toggleBtn(evoneOnly)}>{evoneOnly ? '✓ ' : ''}CPO EVOne</button>
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
          {trends.map((t) => (
            <CarparkCard key={t.carpark_code} t={t} granularity={granularity}
              meta={grouped.metaOf(t.carpark_code)} allLocations={rawCodes}
              onRename={isAdmin ? rename : undefined}
              onAddLocation={isAdmin ? addLocation : undefined}
              onRemoveLocation={isAdmin ? removeLocation : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────

const CHARGER_TYPE_COLORS: Record<ChargerType, string> = { DC: C.green, AC: C.opal, 'AC/DC': C.yellow };

export function CarparkCard({ t, granularity, metric = 'kwh', dual = false, meta, allLocations, onRename, onAddLocation, onRemoveLocation }: {
  t: CarparkTrend; granularity: Granularity; metric?: 'kwh' | 'count'; dual?: boolean;
  /** Chart identity when location grouping is wired: title + the raw location names feeding it. */
  meta?: ChartMeta;
  allLocations?: string[];
  onRename?: (meta: ChartMeta, title: string) => Promise<void>;
  onAddLocation?: (meta: ChartMeta, code: string) => Promise<void>;
  onRemoveLocation?: (meta: ChartMeta, code: string) => Promise<void>;
}) {
  const isCount = metric === 'count';
  const chartTitle = meta?.title ?? t.carpark_code;
  const editable = !!meta && !!onRename;
  const [editOpen, setEditOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(chartTitle);
  const [gBusy, setGBusy] = useState(false);
  const [gErr, setGErr] = useState<string | null>(null);
  const runGroupAction = async (fn: () => Promise<void>) => {
    setGBusy(true);
    setGErr(null);
    try { await fn(); } catch (e) { setGErr((e as Error).message); }
    setGBusy(false);
  };
  // Per-card charger filter: 'all' | 'id:<charger_id>' — lets a struggling
  // charger be spotted inside its site's aggregate.
  const [sel, setSel] = useState('all');
  const selChargers = useMemo(() => {
    if (sel === 'all') return null;
    const m = t.chargers.filter((c) => c.charger_id === sel.slice(3));
    return m.length > 0 ? m : null;
  }, [sel, t.chargers]);
  const buckets = useMemo(() => {
    if (!selChargers) return t.buckets;
    return t.buckets.map((b, i) => ({
      ...b,
      kwh: Math.round(selChargers.reduce((s, c) => s + c.buckets[i].kwh, 0) * 100) / 100,
      count: selChargers.reduce((s, c) => s + c.buckets[i].count, 0),
    }));
  }, [selChargers, t.buckets]);

  const data = buckets.map((b) => (isCount ? b.count : b.kwh));
  const data2 = dual ? buckets.map((b) => b.kwh) : undefined; // blue energy line on the right axis
  const labels = buckets.map((b) => b.label);

  const viewKwh = buckets.reduce((s, b) => s + b.kwh, 0);
  const total  = isCount ? buckets.reduce((s, b) => s + b.count, 0) : viewKwh;
  const latest = data[data.length - 1] ?? 0;
  const prior  = data[data.length - 2] ?? 0;
  const peak   = data.reduce((m, v) => Math.max(m, v), 0);
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
    : buckets.map((b) => ({ title: fmtTooltipDate(b.key, granularity), value: fmtVal(isCount ? b.count : b.kwh), value2: dual ? fmtKwh(b.kwh) : undefined }));

  return (
    <div style={{ background: C.white, borderRadius: 16, padding: '18px 20px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div title={chartTitle} style={{ fontSize: 15, fontWeight: 700, color: C.green, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chartTitle}</div>
            {editable && (
              <button onClick={() => { setTitleDraft(chartTitle); setEditOpen((v) => !v); setGErr(null); }}
                title="Rename this chart / merge locations"
                style={{ border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', padding: 2, flexShrink: 0 }}>
                <Pencil size={12} strokeWidth={2.25} />
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {t.sources.map((s) => (
              <span key={s} style={{ background: SOURCE_COLORS[s].bg, color: SOURCE_COLORS[s].color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {s === 'goparkin' ? 'GoParkin' : 'SP'}
              </span>
            ))}
            {/* Subtitle: the real location name(s) as read from the data */}
            {meta && meta.members.map((m) => (
              <span key={m} title={`Location name in the data: ${m}`}
                style={{ background: '#F3F3F3', color: C.slate, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m}
              </span>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: C.slate, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>{fmtVal(total)}</div>
          {dual && <div style={{ fontSize: 13, fontWeight: 700, color: C.opal, marginTop: 2 }}>{fmtKwh(viewKwh)}</div>}
        </div>
      </div>

      {editOpen && meta && (
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} placeholder="Chart title"
              style={{ flex: 1, minWidth: 0, padding: '7px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }} />
            <button disabled={gBusy} onClick={() => void runGroupAction(() => onRename!(meta, titleDraft))}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: gBusy ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: gBusy ? 'default' : 'pointer' }}>
              Save
            </button>
            <button onClick={() => setEditOpen(false)}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Done
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {meta.members.map((m) => (
              <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: C.white, border: '1px solid #EBEBEB', color: '#1a1a1a', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 99, maxWidth: 240 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                {meta.groupId && onRemoveLocation && (
                  <button disabled={gBusy} onClick={() => void runGroupAction(() => onRemoveLocation(meta, m))} title="Split this location back into its own chart"
                    style={{ border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', padding: 0 }}>
                    <X size={11} strokeWidth={2.5} />
                  </button>
                )}
              </span>
            ))}
            {onAddLocation && allLocations && (
              <select value="" disabled={gBusy}
                onChange={(e) => { const v = e.target.value; if (v) void runGroupAction(() => onAddLocation(meta, v)); }}
                style={{ padding: '5px 8px', borderRadius: 8, border: '1px dashed #CBD5DC', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer', maxWidth: 240 }}>
                <option value="">+ Merge a location into this chart…</option>
                {allLocations.filter((c) => !meta.members.includes(c)).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
          </div>
          <div style={{ fontSize: 10.5, color: C.slate, lineHeight: 1.5 }}>
            A location can only live in one chart — merging it here removes it (and its old chart, if that was its own). Raw records are never changed.
          </div>
          {gErr && <div style={{ background: '#FDEAEA', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#C0321A' }}>{gErr}</div>}
        </div>
      )}

      <LineChart data={data} labels={labels} color={C.green} height={200} formatY={fmtAxis} tooltips={tooltips}
        data2={data2} color2={C.opal} formatY2={fmtKwhShort} />

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

      {/* Charger filter chips — only when the site has more than one charger */}
      {t.chargers.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid #F3F3F3', paddingTop: 10 }}>
          {([
            { key: 'all', label: 'All', dot: null as string | null },
            ...t.chargers.map((c) => ({ key: `id:${c.charger_id}`, label: c.charger_id, dot: c.type ? CHARGER_TYPE_COLORS[c.type] : '#CBD5DC' })),
          ]).map(({ key, label, dot }) => {
            const active = sel === key;
            return (
              <button key={key} onClick={() => setSel(active ? 'all' : key)}
                title={key.startsWith('id:') ? `Only charger ${label}` : 'All chargers'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '3px 10px', borderRadius: 99,
                  border: `1px solid ${active ? C.green : '#EBEBEB'}`,
                  background: active ? C.green : C.white,
                  color: active ? C.white : C.slate,
                  fontFamily: 'Figtree', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                  letterSpacing: '0.02em',
                }}>
                {dot && <span style={{ width: 6, height: 6, borderRadius: 99, background: active ? C.white : dot, flexShrink: 0 }} />}
                {label}
              </button>
            );
          })}
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
