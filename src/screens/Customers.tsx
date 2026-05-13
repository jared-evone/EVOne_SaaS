import { useState } from 'react';
import { C } from '../theme';
import { customers } from '../data';
import { KPICard } from '../components/KPICard';
import { Badge } from '../components/Badge';

export function ScreenCustomers() {
  const [search, setSearch] = useState('');
  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Total Customers"     value="318"       sub="Residential + Commercial" trend="3.9%" trendUp />
        <KPICard label="Enterprise Accounts" value="12"        sub="5+ installs each"         trend="20%"  trendUp accent />
        <KPICard label="Avg. Lifetime Value" value="RM 4,890"  sub="Per customer"             trend="8%"   trendUp />
        <KPICard label="Churn Rate"          value="1.2%"      sub="Last 12 months" />
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers…"
            style={{ width: '100%', padding: '9px 16px 9px 36px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, color: '#1a1a1a' }}
          />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
        </div>
        <button
          style={{ padding: '9px 18px', borderRadius: 99, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontSize: 13, fontWeight: 600, fontFamily: 'Figtree', cursor: 'pointer', marginLeft: 'auto' }}
        >
          + Add Customer
        </button>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Customer', 'Email', 'Type', 'Installs', 'Total Spend', 'Status', 'Joined'].map((h) => (
                <th
                  key={h}
                  style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => (
              <tr
                key={i}
                style={{ borderBottom: '1px solid #F3F3F3' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFA')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '13px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: C.honeydew, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: C.green, flexShrink: 0 }}>
                      {c.name[0]}
                    </div>
                    <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{c.name}</span>
                  </div>
                </td>
                <td style={{ padding: '13px 16px', color: C.slate }}>{c.email}</td>
                <td style={{ padding: '13px 16px' }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 6,
                      background:
                        c.type === 'Enterprise' ? C.green : c.type === 'Commercial' ? C.honeydew : '#F3F3F3',
                      color: c.type === 'Enterprise' ? C.white : C.green,
                    }}
                  >
                    {c.type}
                  </span>
                </td>
                <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green, textAlign: 'center' }}>{c.installs}</td>
                <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>{c.spend}</td>
                <td style={{ padding: '13px 16px' }}><Badge status={c.status} /></td>
                <td style={{ padding: '13px 16px', color: C.slate }}>{c.joined}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
