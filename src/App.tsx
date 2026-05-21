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
import { ScreenCorporateInvoicing } from './screens/CorporateInvoicing';
import { ScreenCPOChargers } from './screens/CPOChargers';
import { ScreenSettings } from './screens/Settings';
import { ScreenDBHealth } from './screens/DBHealth';
import { ScreenChargingDashboard } from './screens/ChargingDashboard';
import { Login } from './screens/Login';
import { TSDWorkspace } from './screens/tsd/TSDWorkspace';
import { PublicApplication } from './screens/crm/PublicApplication';
import {
  PermissionsProvider, usePermissions,
  DEPARTMENT_LABELS, DEPARTMENT_SCREENS,
  type ScreenKey, type SignedInUser,
} from './permissions';

type ScreenId = ScreenKey;

type NavLeaf  = { kind: 'leaf';  id: ScreenId; icon: string; label: string };
type NavGroup = { kind: 'group'; key: string;  icon: string; label: string; children: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

const NAV_ALL: NavEntry[] = [
  { kind: 'leaf', id: 'charging_dashboard',icon: '▤', label: 'Charging Dashboard' },
  { kind: 'leaf', id: 'overview',          icon: '⊞', label: 'Overview' },
  { kind: 'leaf', id: 'orders',            icon: '◈', label: 'Invoices' },
  { kind: 'leaf', id: 'installations',     icon: '◎', label: 'Installations' },
  { kind: 'leaf', id: 'customers',         icon: '◉', label: 'Customers' },
  { kind: 'leaf', id: 'social',            icon: '◫', label: 'Social Media Planner' },
  { kind: 'leaf', id: 'sales',             icon: '◐', label: 'Sales' },
  { kind: 'leaf', id: 'purchaseorders',    icon: '◧', label: 'Purchase Orders' },
  { kind: 'leaf', id: 'inventory',         icon: '▦', label: 'Inventory & Products' },
  { kind: 'leaf', id: 'suppliers',         icon: '◑', label: 'Suppliers' },
  { kind: 'leaf', id: 'corporatecrm',      icon: '◉', label: 'Corporate CRM' },
  { kind: 'leaf', id: 'cpochargers',       icon: '▣', label: 'CPO Chargers' },
  { kind: 'leaf', id: 'charging',          icon: '⚡', label: 'Charging Records' },
  { kind: 'leaf', id: 'corporateinvoicing',icon: '◈', label: 'Corporate Invoicing' },
  { kind: 'group', key: 'settings_group', icon: '◆', label: 'Settings', children: [
    { kind: 'leaf', id: 'settings', icon: '◉', label: 'Users & Permissions' },
    { kind: 'leaf', id: 'dbhealth', icon: '◫', label: 'DB Health' },
  ]},
];

// Only top-level navigable screens get titles + components. Sub-screen permission
// keys (e.g. charging_cpo_carparks) live in the matrix but never render directly.
const SCREEN_TITLES: Partial<Record<ScreenId, string>> = {
  overview:       'Overview',
  orders:         'Invoices',
  installations:  'Installations',
  customers:      'Customers',
  social:         'Social Media Planner',
  sales:          'Sales',
  purchaseorders: 'Purchase Orders',
  inventory:      'Inventory & Products',
  suppliers:      'Suppliers',
  corporatecrm:        'Corporate CRM',
  cpochargers:         'CPO Chargers',
  charging:            'Charging Records',
  corporateinvoicing:  'Corporate Invoicing',
  charging_dashboard:  'Charging Dashboard',
  settings:            'Users & Permissions',
  dbhealth:            'DB Health',
};

const screens: Partial<Record<ScreenId, JSX.Element>> = {
  overview:       <ScreenOverview />,
  orders:         <ScreenInvoices />,
  installations:  <ScreenInstallations />,
  customers:      <ScreenCustomers />,
  social:         <ScreenSocial />,
  sales:          <ScreenSales />,
  purchaseorders: <ScreenPurchaseOrders />,
  inventory:      <ScreenInventory />,
  suppliers:      <ScreenSuppliers />,
  corporatecrm:        <ScreenCorporateCRM />,
  cpochargers:         <ScreenCPOChargers />,
  charging:            <ScreenChargingRecords />,
  corporateinvoicing:  <ScreenCorporateInvoicing />,
  charging_dashboard:  <ScreenChargingDashboard />,
  settings:            <ScreenSettings />,
  dbhealth:            <ScreenDBHealth />,
};

interface DashboardProps {
  onSignOut: () => void;
}

function Dashboard({ onSignOut }: DashboardProps) {
  const { can, user } = usePermissions();
  const departmentScreens = DEPARTMENT_SCREENS[user.department];
  const isLeafVisible = (id: ScreenId) => departmentScreens.includes(id) && can(id, 'can_view');

  const NAV: NavEntry[] = NAV_ALL.flatMap((n): NavEntry[] => {
    if (n.kind === 'leaf') return isLeafVisible(n.id) ? [n] : [];
    const visibleChildren = n.children.filter((c) => isLeafVisible(c.id));
    return visibleChildren.length > 0 ? [{ ...n, children: visibleChildren }] : [];
  });

  const allVisibleLeafIds: ScreenId[] = NAV.flatMap((n) => n.kind === 'leaf' ? [n.id] : n.children.map((c) => c.id));
  const fallbackScreen: ScreenId = allVisibleLeafIds[0] ?? 'settings';
  const [screen, setScreen] = useState<ScreenId>(fallbackScreen);
  const activeScreen = allVisibleLeafIds.includes(screen) ? screen : fallbackScreen;

  // Settings group expands automatically when one of its children is active
  const initialOpen: Record<string, boolean> = {};
  for (const n of NAV) {
    if (n.kind === 'group') {
      initialOpen[n.key] = n.children.some((c) => c.id === activeScreen);
    }
  }
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);
  const toggleGroup = (key: string) => setOpenGroups((s) => ({ ...s, [key]: !s[key] }));

  const contentPad = 28;
  const userInitial = (user.full_name || user.email).trim().charAt(0).toUpperCase();

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
          {NAV.map((n) => {
            if (n.kind === 'leaf') {
              return (
                <NavItem
                  key={n.id}
                  icon={n.icon}
                  label={n.label}
                  active={activeScreen === n.id}
                  onClick={() => setScreen(n.id)}
                />
              );
            }
            const open = !!openGroups[n.key];
            return (
              <div key={n.key} style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
                <button
                  onClick={() => toggleGroup(n.key)}
                  style={{
                    display: 'flex', alignItems: 'center',
                    padding: '10px 16px 4px',
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    fontFamily: 'Figtree',
                    fontSize: 10, fontWeight: 700,
                    color: C.slate,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    width: '100%', textAlign: 'left',
                  }}>
                  <span>{n.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 8, transition: 'transform .15s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
                </button>
                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {n.children.map((c) => (
                      <NavItem
                        key={c.id}
                        icon={c.icon}
                        label={c.label}
                        active={activeScreen === c.id}
                        onClick={() => setScreen(c.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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
            {userInitial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.full_name}
            </div>
            <div style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.role_label}
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
              {SCREEN_TITLES[activeScreen]}
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
              {DEPARTMENT_LABELS[user.department]} · {user.role_label}
            </span>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: contentPad }}>{screens[activeScreen]}</div>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<SignedInUser | null>(null);

  // Public account-opening invite: bypass login entirely.
  const applyToken = new URLSearchParams(window.location.search).get('apply');
  if (applyToken) {
    return <PublicApplication token={applyToken} />;
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  // Technical Service still routes to its dedicated workspace (no dashboard nav)
  if (user.department === 'tech') {
    return <TSDWorkspace onSignOut={() => setUser(null)} />;
  }

  return (
    <PermissionsProvider user={user}>
      <Dashboard onSignOut={() => setUser(null)} />
    </PermissionsProvider>
  );
}
