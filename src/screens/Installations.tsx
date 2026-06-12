import { C } from '../theme';
import { installations } from '../data';
import { KPICard } from '../components/KPICard';
import { Badge } from '../components/Badge';
import { useIsMobile } from '../lib/useIsMobile';

export function ScreenInstallations() {
  const isMobile = useIsMobile();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Scheduled This Week" value="14"      sub="5 technicians active" />
        <KPICard label="Completed MTD"       value="46"      sub="Target: 50"           trend="92%"        trendUp accent />
        <KPICard label="Avg. Install Time"   value="3.8 hrs" sub={<>Target: &lt;4 hrs</>} trend="0.2h faster" trendUp />
        <KPICard label="Overdue"             value="2"       sub="Requires rescheduling" trend="↓ 3 last mo" trendUp={false} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap: 16 }}>
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F3F3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Installation Schedule</div>
            <button style={{ padding: '6px 14px', borderRadius: 99, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontSize: 12, fontWeight: 600, fontFamily: 'Figtree', cursor: 'pointer' }}>+ Schedule</button>
          </div>
          <table style={{ width: '100%', minWidth: 770, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Ref', 'Customer', 'Address', 'Technician', 'Date', 'Product', 'Status'].map((h) => (
                  <th
                    key={h}
                    style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {installations.map((r, i) => (
                <tr
                  key={i}
                  style={{ borderBottom: '1px solid #F3F3F3' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: C.green }}>{r.id}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{r.customer}</td>
                  <td style={{ padding: '12px 16px', color: C.slate, fontSize: 12 }}>{r.address}</td>
                  <td style={{ padding: '12px 16px', color: '#1a1a1a' }}>{r.tech}</td>
                  <td style={{ padding: '12px 16px', color: C.slate }}>{r.scheduled}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: C.honeydew, color: C.green, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>{r.product}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Technician load */}
        <div style={{ background: C.white, borderRadius: 16, padding: '20px', border: '1px solid #EBEBEB' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>Technician Load</div>
          <div style={{ fontSize: 12, color: C.slate, marginBottom: 16 }}>Jobs assigned this week</div>
          {[
            { name: 'Zulkifli A.', jobs: 5, max: 6 },
            { name: 'Ramesh K.',   jobs: 4, max: 6 },
            { name: 'David T.',    jobs: 5, max: 6 },
            { name: 'Fadzli H.',   jobs: 3, max: 6 },
            { name: 'Jason L.',    jobs: 2, max: 6 },
          ].map((t, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{t.name}</span>
                <span style={{ fontSize: 12, color: C.slate }}>{t.jobs}/{t.max}</span>
              </div>
              <div style={{ background: '#F3F3F3', borderRadius: 99, height: 7 }}>
                <div style={{ width: `${(t.jobs / t.max) * 100}%`, height: '100%', background: t.jobs >= t.max - 1 ? C.yellow : C.green, borderRadius: 99, transition: 'width .5s' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
