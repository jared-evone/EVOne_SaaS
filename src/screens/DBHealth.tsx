import { useEffect, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';

interface DbStatsRow {
  database_size_bytes: number;
  table_name: string;
  row_count: number;
  table_size_bytes: number;
}

interface BucketInfo {
  name: string;
  isPublic: boolean;
  fileCount: number;
  totalBytes: number;
}

interface StorageStatsRow {
  bucket_name: string;
  is_public: boolean;
  file_count: number;
  total_bytes: number;
}

const FREE_TIER_DB_BYTES      = 500 * 1024 * 1024;       // 500 MB
const FREE_TIER_STORAGE_BYTES = 1 * 1024 * 1024 * 1024;  // 1 GB

function fmtBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function fmtCount(n: number): string {
  return n.toLocaleString();
}

export function ScreenDBHealth() {
  const [stats, setStats] = useState<DbStatsRow[] | null>(null);
  const [buckets, setBuckets] = useState<BucketInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);

    const t0 = performance.now();
    const { data, error: err } = await supabase.rpc('db_health_stats');
    setPingMs(Math.round(performance.now() - t0));

    if (err) {
      setError(`Could not load DB stats: ${err.message}`);
      setStats(null);
    } else {
      setStats((data as DbStatsRow[]) ?? []);
    }

    // Storage stats via SECURITY DEFINER RPC — bypasses storage RLS so anon can read totals.
    const { data: storageData, error: sErr } = await supabase.rpc('storage_health_stats');
    if (sErr) {
      setError((e) => e ? `${e}\nStorage: ${sErr.message}` : `Storage: ${sErr.message}`);
      setBuckets([]);
    } else {
      const rows = (storageData as StorageStatsRow[]) ?? [];
      setBuckets(rows.map((r) => ({
        name:       r.bucket_name,
        isPublic:   r.is_public,
        fileCount:  Number(r.file_count) || 0,
        totalBytes: Number(r.total_bytes) || 0,
      })));
    }
    setRefreshedAt(new Date());
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const dbSize = stats?.[0]?.database_size_bytes ?? 0;
  const totalRows = stats?.reduce((s, r) => s + Number(r.row_count ?? 0), 0) ?? 0;
  const totalStorageBytes = buckets.reduce((s, b) => s + b.totalBytes, 0);
  const totalFiles = buckets.reduce((s, b) => s + b.fileCount, 0);
  const dbPct      = Math.min(100, Math.round((dbSize / FREE_TIER_DB_BYTES) * 100));
  const storagePct = Math.min(100, Math.round((totalStorageBytes / FREE_TIER_STORAGE_BYTES) * 100));

  const connOk = !error && stats !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Connection banner */}
      <div style={{
        background: connOk ? C.honeydew : '#FDEAEA',
        color: connOk ? C.green : '#C0321A',
        borderRadius: 12, padding: '12px 18px',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{connOk ? '✓' : '⚠'}</span>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
          {connOk
            ? <>Supabase reachable · round-trip <strong>{pingMs ?? '—'} ms</strong></>
            : <>Connection problem: {error}</>}
          {refreshedAt && (
            <span style={{ marginLeft: 10, fontWeight: 400, opacity: 0.7 }}>
              · refreshed {refreshedAt.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
        <button onClick={fetchAll} disabled={loading}
          style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${connOk ? C.green : '#C0321A'}`,
            background: C.white, color: connOk ? C.green : '#C0321A',
            fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Database Size"   value={fmtBytes(dbSize)} sub={`${dbPct}% of free tier (500 MB)`} accent />
        <KPICard label="Total Rows"      value={fmtCount(totalRows)} sub={`across ${stats?.length ?? 0} tables`} />
        <KPICard label="Storage Used"    value={fmtBytes(totalStorageBytes)} sub={`${storagePct}% of free tier (1 GB)`} />
        <KPICard label="Total Files"     value={fmtCount(totalFiles)} sub={`in ${buckets.length} bucket${buckets.length === 1 ? '' : 's'}`} />
      </div>

      {/* Usage bars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <UsageBar label="Database" pct={dbPct} used={dbSize} total={FREE_TIER_DB_BYTES} />
        <UsageBar label="Storage"  pct={storagePct} used={totalStorageBytes} total={FREE_TIER_STORAGE_BYTES} />
      </div>

      {/* Tables */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #F3F3F3' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Tables · public schema</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
            Row counts are Postgres estimates (instant). Sizes include indexes &amp; TOAST.
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Table', 'Rows', 'Size', 'Share of DB'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(stats ?? []).map((r) => {
                const share = dbSize > 0 ? (Number(r.table_size_bytes) / dbSize) * 100 : 0;
                return (
                  <tr key={r.table_name} style={{ borderBottom: '1px solid #F3F3F3' }}>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 700, color: C.green, fontFamily: 'monospace' }}>{r.table_name}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: '#1a1a1a' }}>{fmtCount(Number(r.row_count))}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: '#1a1a1a' }}>{fmtBytes(Number(r.table_size_bytes))}</td>
                    <td style={{ padding: '11px 16px', width: 240 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 6, background: C.seasalt, borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.max(2, share)}%`, height: '100%', background: C.green }} />
                        </div>
                        <span style={{ fontSize: 11, color: C.slate, minWidth: 40, textAlign: 'right' }}>{share.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(stats?.length ?? 0) === 0 && (
                <tr><td colSpan={4} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  {loading ? 'Loading…' : 'No tables found.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Storage buckets */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #F3F3F3' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Storage Buckets</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
            Aggregated server-side from <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>storage.objects</code> — includes every file in every prefix.
          </div>
        </div>
        <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Bucket', 'Access', 'Files', 'Size'].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.name} style={{ borderBottom: '1px solid #F3F3F3' }}>
                <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 700, color: C.green, fontFamily: 'monospace' }}>{b.name}</td>
                <td style={{ padding: '11px 16px' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                    background: b.isPublic ? '#FFF8E1' : C.honeydew,
                    color:      b.isPublic ? '#B07D00' : C.green,
                    textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {b.isPublic ? 'Public' : 'Private'}
                  </span>
                </td>
                <td style={{ padding: '11px 16px', fontSize: 13, color: '#1a1a1a' }}>{fmtCount(b.fileCount)}</td>
                <td style={{ padding: '11px 16px', fontSize: 13, color: '#1a1a1a' }}>{fmtBytes(b.totalBytes)}</td>
              </tr>
            ))}
            {buckets.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                {loading ? 'Loading…' : 'No storage buckets configured.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsageBar({ label, pct, used, total }: { label: string; pct: number; used: number; total: number }) {
  const tone =
    pct >= 90 ? { bar: '#C0321A', tag: { bg: '#FDEAEA', color: '#C0321A' } } :
    pct >= 70 ? { bar: '#B07D00', tag: { bg: '#FFF8E1', color: '#B07D00' } } :
                { bar: C.green,   tag: { bg: C.honeydew, color: C.green   } };
  return (
    <div style={{ background: C.white, borderRadius: 14, padding: '16px 20px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{label}</div>
        <span style={{ background: tone.tag.bg, color: tone.tag.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>
          {pct}%
        </span>
      </div>
      <div style={{ background: C.seasalt, borderRadius: 99, height: 10, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: tone.bar, transition: 'width .3s ease' }} />
      </div>
      <div style={{ fontSize: 11, color: C.slate, display: 'flex', justifyContent: 'space-between' }}>
        <span>{fmtBytes(used)} used</span>
        <span>of {fmtBytes(total)} free-tier ceiling</span>
      </div>
    </div>
  );
}
