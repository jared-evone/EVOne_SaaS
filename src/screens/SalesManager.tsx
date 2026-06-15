import { useEffect, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { BarChart, Donut } from '../components/charts';
import { supabase } from '../lib/supabase';
import { TrendingUp } from 'lucide-react';
import { QUOTE_STATUSES, QUOTE_STATUS_COLORS, fmtMoney, type Quote } from './Sales';

type Period = 'all' | 'month' | 'quarter' | 'year';

const PERIOD_LABELS: Record<Period, string> = {
  all: 'All time',
  month: 'This month',
  quarter: 'This quarter',
  year: 'This year',
};

function periodStart(p: Period): Date | null {
  const now = new Date();
  if (p === 'all') return null;
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (p === 'quarter') return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  return new Date(now.getFullYear(), 0, 1);
}

interface SalesUser {
  id: string;
  full_name: string;
  is_active: boolean;
  target_amount: number;
}

interface RepStats {
  key: string;
  name: string;
  inactive: boolean;
  target: number;
  quotes: number;
  openValue: number;
  wonValue: number;
  won: number;
  lost: number;
}

export function ScreenSalesManager() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [users, setUsers] = useState<SalesUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('all');

  const fetchAll = async () => {
    const [q, u] = await Promise.all([
      supabase.from('sales_quotations').select('*'),
      supabase.from('sales_people').select('id, name, is_active, target_amount').order('name'),
    ]);
    const err = q.error ?? u.error;
    if (err) { setError(err.message); setLoading(false); return; }
    setQuotes((q.data ?? []) as Quote[]);
    setUsers(((u.data ?? []) as Array<{ id: string; name: string; is_active: boolean; target_amount: number }>).map((r) => ({ id: r.id, full_name: r.name, is_active: r.is_active, target_amount: r.target_amount })));
    setLoading(false);
  };

  useEffect(() => { void fetchAll(); }, []);

  // Period filter — won metrics use won_at when present, everything else quote_date.
  const start = periodStart(period);
  const inPeriod = (q: Quote) => {
    if (!start) return true;
    const d = q.status === 'Won' && q.won_at ? new Date(q.won_at) : new Date(q.quote_date);
    return d >= start;
  };
  const filtered = quotes.filter(inPeriod);

  // Team KPIs
  const open = filtered.filter((q) => q.status === 'Draft' || q.status === 'Sent');
  const won = filtered.filter((q) => q.status === 'Won');
  const lost = filtered.filter((q) => q.status === 'Lost');
  const pipelineValue = open.reduce((s, q) => s + Number(q.total), 0);
  const wonValue = won.reduce((s, q) => s + Number(q.total), 0);
  const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
  const teamTarget = users.reduce((s, u) => s + Number(u.target_amount), 0);
  const attainment = teamTarget > 0 ? Math.round((wonValue / teamTarget) * 100) : null;

  // Per-salesperson stats
  const byUser = new Map<string, SalesUser>(users.map((u) => [u.id, u]));
  const reps = new Map<string, RepStats>();
  for (const q of filtered) {
    const key = q.salesperson_id ?? q.salesperson_name;
    const u = q.salesperson_id ? byUser.get(q.salesperson_id) : undefined;
    let r = reps.get(key);
    if (!r) {
      r = { key, name: u?.full_name ?? q.salesperson_name, inactive: u ? !u.is_active : true, target: u?.target_amount ?? 0, quotes: 0, openValue: 0, wonValue: 0, won: 0, lost: 0 };
      reps.set(key, r);
    }
    r.quotes += 1;
    if (q.status === 'Draft' || q.status === 'Sent') r.openValue += Number(q.total);
    if (q.status === 'Won') { r.wonValue += Number(q.total); r.won += 1; }
    if (q.status === 'Lost') r.lost += 1;
  }
  const leaderboard = [...reps.values()].sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue);

  // Charts
  const chartReps = leaderboard.slice(0, 8);
  const barData = chartReps.map((r) => [Math.round(r.openValue / 1000), Math.round(r.wonValue / 1000)]);
  const barLabels = chartReps.map((r) => r.name.split(' ')[0]);
  const hasBarData = barData.some((g) => g.some((v) => v > 0));
  const statusCounts = QUOTE_STATUSES.map((s) => ({ status: s, count: filtered.filter((q) => q.status === s).length }));
  const donutSegments = statusCounts.filter((s) => s.count > 0).map((s) => ({ value: s.count, color: QUOTE_STATUS_COLORS[s.status].color }));

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 99, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', border: active ? 'none' : '1px solid #EBEBEB',
    background: active ? C.green : C.white, color: active ? C.white : C.slate,
  });

  const th: React.CSSProperties = {
    padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate,
    letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB',
  };

  if (loading) {
    return <div style={{ padding: '60px 20px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading performance data…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* Period filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} style={pill(period === p)}>{PERIOD_LABELS[p]}</button>
        ))}
      </div>

      {/* Team KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard accent label="Team Pipeline Value" value={fmtMoney(pipelineValue)} sub={`${open.length} open quote${open.length === 1 ? '' : 's'}`} />
        <KPICard label="Won Value" value={fmtMoney(wonValue)} sub={attainment === null ? `${won.length} deals won` : `${attainment}% of ${fmtMoney(teamTarget)} target`} />
        <KPICard label="Team Win Rate" value={winRate === null ? '—' : `${winRate}%`} sub={`${won.length} won · ${lost.length} lost`} />
        <KPICard label="Open Quotes" value={String(open.length)} sub={`${filtered.length} total in period`} />
      </div>

      {quotes.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px dashed #EBEBEB', padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'inline-flex' }}><TrendingUp size={32} strokeWidth={1.5} color={C.slate} /></div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>No pipeline data yet</div>
          <div style={{ fontSize: 12, color: C.slate }}>Performance appears here once quotes are created in the Sales Pipeline.</div>
        </div>
      ) : (
        <>
          {/* Leaderboard */}
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.seasalt }}>
                  {['Salesperson', 'Quotes', 'Open Value', 'Won Value', 'Target', 'Attainment', 'Win Rate', 'Avg Deal'].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r, i) => {
                  const rate = r.won + r.lost > 0 ? Math.round((r.won / (r.won + r.lost)) * 100) : null;
                  const avg = r.won > 0 ? r.wonValue / r.won : null;
                  const attain = r.target > 0 ? Math.round((r.wonValue / r.target) * 100) : null;
                  return (
                    <tr key={r.key} style={{ borderBottom: '1px solid #F3F3F3', background: i === 0 && r.wonValue > 0 ? C.honeydew : 'transparent' }}>
                      <td style={{ padding: '13px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 30, height: 30, borderRadius: '50%', background: C.honeydew, color: C.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                            {(r.name.trim().charAt(0) || '?').toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 700 }}>{r.name}</span>
                          {r.inactive && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#F3F3F3', color: '#767B77' }}>Inactive</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '13px 16px', color: C.slate }}>{r.quotes}</td>
                      <td style={{ padding: '13px 16px', color: C.slate }}>{fmtMoney(r.openValue)}</td>
                      <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>{fmtMoney(r.wonValue)}</td>
                      <td style={{ padding: '13px 16px', color: C.slate }}>{r.target > 0 ? fmtMoney(r.target) : '—'}</td>
                      <td style={{ padding: '13px 16px' }}>
                        {attain === null ? <span style={{ color: C.slate }}>—</span> : (
                          <span style={{ fontWeight: 700, color: attain >= 100 ? '#1B512D' : attain >= 60 ? '#B07D00' : '#C0321A' }}>{attain}%</span>
                        )}
                      </td>
                      <td style={{ padding: '13px 16px', color: C.slate }}>{rate === null ? '—' : `${rate}%`}</td>
                      <td style={{ padding: '13px 16px', color: C.slate }}>{avg === null ? '—' : fmtMoney(avg)}</td>
                    </tr>
                  );
                })}
                {leaderboard.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: '32px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No quotes in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>Value by Salesperson</div>
              <div style={{ fontSize: 11, color: C.slate, marginBottom: 14, display: 'flex', gap: 14 }}>
                <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: C.opal, marginRight: 5 }} />Open ($'000)</span>
                <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: C.green, marginRight: 5 }} />Won ($'000)</span>
              </div>
              {hasBarData ? (
                <BarChart data={barData} labels={barLabels} colors={[C.opal, C.green]} height={180} />
              ) : (
                <div style={{ padding: '32px 0', textAlign: 'center', color: C.slate, fontSize: 12 }}>No value recorded in this period.</div>
              )}
            </div>
            <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 14 }}>Quotes by Status</div>
              {donutSegments.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                  <Donut segments={donutSegments} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {statusCounts.map((s) => (
                      <div key={s.status} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: QUOTE_STATUS_COLORS[s.status].color, flexShrink: 0 }} />
                        <span style={{ color: C.slate, minWidth: 50 }}>{s.status}</span>
                        <span style={{ fontWeight: 700 }}>{s.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ padding: '32px 0', textAlign: 'center', color: C.slate, fontSize: 12 }}>No quotes in this period.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
