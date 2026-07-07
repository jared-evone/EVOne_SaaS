import { useEffect, useState } from 'react';
import { C } from '../theme';
import { ensureChargingTrendsCache } from './charging/LocationTrends';
import { Sessions } from './charging/Sessions';
import { ChargingOverview } from './charging/ChargingOverview';
import { ExcludedCompanies } from './charging/ExcludedCompanies';

type DashboardTab = 'overview' | 'sessions' | 'excluded';

export function ScreenChargingDashboard() {
  const [tab, setTab] = useState<DashboardTab>('overview');

  useEffect(() => {
    // Warm the shared charging session cache in the background as soon as the
    // dashboard mounts, so switching tabs (and between ranges) is instant.
    ensureChargingTrendsCache().catch(() => { /* surfaced on the tab itself */ });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
        {([
          ['overview', 'Overview'],
          ['sessions', 'Sessions'],
          ['excluded', 'Excluded Companies'],
        ] as [DashboardTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: '8px 22px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: tab === id ? C.green : 'transparent', color: tab === id ? C.white : C.slate }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <ChargingOverview />}
      {tab === 'sessions' && <Sessions />}
      {tab === 'excluded' && <ExcludedCompanies />}
    </div>
  );
}
