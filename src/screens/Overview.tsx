import { C } from '../theme';
import { months, revenueData, orders } from '../data';
import { KPICard } from '../components/KPICard';
import { Badge } from '../components/Badge';
import { Sparkline, MiniBar, Donut, LineChart } from '../components/charts';
import { useIsMobile } from '../lib/useIsMobile';

export function ScreenOverview() {
  const isMobile = useIsMobile();
  const pipeline = [
    { label: 'New Enquiry',  value: 24, color: C.opal },
    { label: 'Quoted',       value: 18, color: C.yellow },
    { label: 'Order Placed', value: 12, color: '#1A62C0' },
    { label: 'Scheduled',    value: 9,  color: C.green },
    { label: 'Installed',    value: 52, color: '#22a14b' },
  ];
  const maxP = Math.max(...pipeline.map((p) => p.value));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
        <KPICard label="Monthly Revenue"     value="RM 204k" sub="vs RM 188k last month" trend="8.5%" trendUp chart={<Sparkline data={revenueData.slice(-8)} color={C.white} />} accent />
        <KPICard label="Orders This Month"   value="52"      sub="7kW: 38 · 22kW: 14"     trend="13%"  trendUp chart={<MiniBar  data={[28, 30, 27, 35, 38, 42, 46, 52]} color={C.green} />} />
        <KPICard label="Installations Done"  value="46"      sub="6 pending · 2 overdue"  trend="9.5%" trendUp chart={<MiniBar  data={[22, 25, 23, 28, 31, 36, 40, 46]} color={C.opal} />} />
        <KPICard label="Active Customers"    value="318"     sub="+12 this month"         trend="3.9%" trendUp chart={<Sparkline data={[220, 238, 251, 264, 270, 284, 302, 318]} color={C.green} />} />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 340px', gap: 16 }}>
        <div style={{ background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Revenue Overview</div>
              <div style={{ fontSize: 12, color: C.slate }}>Jan – Dec 2025/2026</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.green, background: C.honeydew, padding: '4px 12px', borderRadius: 99 }}>
              RM 1.65M YTD
            </span>
          </div>
          <LineChart data={revenueData} labels={months} color={C.green} height={160} />
        </div>

        {/* Order pipeline */}
        <div style={{ background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>Order Pipeline</div>
          <div style={{ fontSize: 12, color: C.slate, marginBottom: 20 }}>Current status breakdown</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pipeline.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 12, color: C.slate, width: 96, flexShrink: 0 }}>{p.label}</div>
                <div style={{ flex: 1, background: '#F3F3F3', borderRadius: 99, height: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${(p.value / maxP) * 100}%`, height: '100%', background: p.color, borderRadius: 99, transition: 'width .6s' }} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.green, width: 28, textAlign: 'right', flexShrink: 0 }}>{p.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        {/* Recent orders mini */}
        <div style={{ background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 16 }}>Recent Orders</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {orders.slice(0, 4).map((o, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  paddingBottom: 10,
                  borderBottom: i < 3 ? '1px solid #F3F3F3' : 'none',
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 10, background: C.honeydew, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: C.green, flexShrink: 0 }}>
                  {o.customer[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.green, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.customer}</div>
                  <div style={{ fontSize: 11, color: C.slate }}>{o.product}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{o.amount}</div>
                <Badge status={o.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Charger donut */}
        <div style={{ background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>Chargers Installed</div>
          <div style={{ fontSize: 12, color: C.slate, marginBottom: 16 }}>By product type</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <Donut
              segments={[
                { value: 284, color: C.green },
                { value: 96,  color: C.yellow },
                { value: 34,  color: C.opal },
              ]}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: '7kW Home',          value: 284, color: C.green },
                { label: '22kW Commercial',   value: 96,  color: C.yellow },
                { label: 'DC Fast (50kW)',    value: 34,  color: C.opal },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <div style={{ fontSize: 12, color: C.slate }}>{s.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginLeft: 'auto', paddingLeft: 12 }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
