import { useState } from 'react';
import { C } from '../../theme';
import { MasterView } from './MasterView';
import { AccountManager } from './AccountManager';
import { CustomerLogin } from './CustomerLogin';
import type { PortalAccount } from './types';

type PortalTab = 'master' | 'accounts' | 'login';

const TABS: { id: PortalTab; label: string }[] = [
  { id: 'master',   label: 'Master View' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'login',    label: 'Customer Login' },
];

export function CustomerPortal() {
  const [tab, setTab] = useState<PortalTab>('master');
  const [loggedInAccount, setLoggedInAccount] = useState<PortalAccount | null>(null);

  // When a customer is logged in, hide the admin tab strip and only show the customer dashboard.
  const inCustomerSession = tab === 'login' && loggedInAccount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {!inCustomerSession && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB' }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding: '8px 20px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  background: tab === t.id ? C.green : 'transparent', color: tab === t.id ? C.white : C.slate }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.slate, marginLeft: 'auto', fontStyle: 'italic' }}>
            Dev preview — this whole section will move to a top-level screen later.
          </div>
        </div>
      )}

      {inCustomerSession && (
        <div>
          <button onClick={() => setLoggedInAccount(null)}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            ← Back to admin view
          </button>
        </div>
      )}

      {tab === 'master'   && <MasterView />}
      {tab === 'accounts' && <AccountManager />}
      {tab === 'login'    && <CustomerLogin onLoginChange={setLoggedInAccount} />}
    </div>
  );
}
