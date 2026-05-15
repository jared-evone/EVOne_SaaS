import { useState } from 'react';
import { C } from './theme';
import { Logo } from './components/Logo';
import { NavItem } from './components/NavItem';
import { ScreenOverview } from './screens/Overview';
import { ScreenInvoices } from './screens/Invoices';
import { ScreenInstallations } from './screens/Installations';
import { ScreenCustomers } from './screens/Customers';
import { ScreenSocial } from './screens/Social';
import { ScreenSales } from './screens/Sales';
import { ScreenPurchaseOrders } from './screens/PurchaseOrders';
import { ScreenInventory } from './screens/Inventory';
import { ScreenSuppliers } from './screens/Suppliers';
import { ScreenCorporateCRM } from './screens/CorporateCRM';
import { ScreenChargingRecords } from './screens/ChargingRecords';
import { Login, ROLE_LABELS, type Role } from './screens/Login';
import { TSDWorkspace } from './screens/tsd/TSDWorkspace';

type ScreenId =
  | 'overview'
  | 'orders'
  | 'installations'
  | 'customers'
  | 'social'
  | 'sales'
  | 'purchaseorders'
  | 'inventory'
  | 'suppliers'
  | 'corporatecrm'
  | 'charging';

const NAV_ALL: { id: ScreenId; icon: string; label: string; roles?: Role[] }[] = [
  { id: 'overview',       icon: '⊞', label: 'Overview' },
  { id: 'orders',         icon: '◈', label: 'Invoices' },
  { id: 'installations',  icon: '◎', label: 'Installations' },
  { id: 'customers',      icon: '◉', label: 'Customers' },
  { id: 'social',         icon: '◫', label: 'Social Media Planner' },
  { id: 'sales',          icon: '◐', label: 'Sales' },
  { id: 'purchaseorders', icon: '◧', label: 'Purchase Orders' },
  { id: 'inventory',      icon: '▦', label: 'Inventory & Products' },
  { id: 'suppliers',      icon: '◑', label: 'Suppliers' },
  { id: 'corporatecrm',   icon: '◉', label: 'Corporate CRM',          roles: ['cpo'] },
  { id: 'charging',       icon: '⚡', label: 'Charging Records',        roles: ['cpo'] },
];

const SCREEN_TITLES: Record<ScreenId, string> = {
  overview:       'Overview',
  orders:         'Invoices',
  installations:  'Installations',
  customers:      'Customers',
  social:         'Social Media Planner',
  sales:          'Sales',
  purchaseorders: 'Purchase Orders',
  inventory:      'Inventory & Products',
  suppliers:      'Suppliers',
  corporatecrm:   'Corporate CRM',
  charging:       'Charging Records',
};

const screens: Record<ScreenId, JSX.Element> = {
  overview:       <ScreenOverview />,
  orders:         <ScreenInvoices />,
  installations:  <ScreenInstallations />,
  customers:      <ScreenCustomers />,
  social:         <ScreenSocial />,
  sales:          <ScreenSales />,
  purchaseorders: <ScreenPurchaseOrders />,
  inventory:      <ScreenInventory />,
  suppliers:      <ScreenSuppliers />,
  corporatecrm:   <ScreenCorporateCRM />,
  charging:       <ScreenChargingRecords />,
};

interface DashboardProps {
  role: Role;
  onSignOut: () => void;
}

function Dashboard({ role, onSignOut }: DashboardProps) {
  const NAV = NAV_ALL.filter((n) =>
    n.roles ? n.roles.includes(role) : role !== 'cpo',
  );
  const [screen, setScreen] = useState<ScreenId>(NAV[0].id);
  const contentPad = 28;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: C.seasalt }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 224,
          flexShrink: 0,
          background: C.white,
          borderRight: '1px solid #EBEBEB',
          display: 'flex',
          flexDirection: 'column',
          padding: '0 12px',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 8px 16px', borderBottom: '1px solid #F3F3F3', marginBottom: 8 }}>
          <Logo height={34} />
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 12 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: C.slate,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '10px 16px 4px',
            }}
          >
            Main
          </div>
          {NAV.map((n) => (
            <NavItem
              key={n.id}
              icon={n.icon}
              label={n.label}
              active={screen === n.id}
              onClick={() => setScreen(n.id)}
            />
          ))}
        </nav>

        {/* User block */}
        <div style={{ borderTop: '1px solid #F3F3F3', padding: '14px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: C.green,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: C.white,
              fontWeight: 700,
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            A
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Admin User
            </div>
            <div style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ROLE_LABELS[role]}
            </div>
          </div>
          <button
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: '1px solid #EBEBEB',
              background: 'transparent',
              color: C.slate,
              cursor: 'pointer',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#C0321A';
              e.currentTarget.style.borderColor = '#FDEAEA';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = C.slate;
              e.currentTarget.style.borderColor = '#EBEBEB';
            }}
          >
            ⏻
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header
          style={{
            height: 60,
            flexShrink: 0,
            background: C.white,
            borderBottom: '1px solid #EBEBEB',
            display: 'flex',
            alignItems: 'center',
            padding: '0 28px',
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>
              {SCREEN_TITLES[screen]}
            </div>
            <div style={{ fontSize: 11, color: C.slate }}>May 4, 2026 · Kuala Lumpur</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '5px 12px',
                borderRadius: 99,
                background: C.honeydew,
                color: C.green,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {ROLE_LABELS[role]}
            </span>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: contentPad }}>{screens[screen]}</div>
      </main>
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState<Role | null>(null);

  if (!role) {
    return <Login onLogin={setRole} />;
  }

  // TSD role drops into the Work Order workspace, not the global dashboard
  if (role === 'tech') {
    return <TSDWorkspace onSignOut={() => setRole(null)} />;
  }

  return <Dashboard role={role} onSignOut={() => setRole(null)} />;
}
