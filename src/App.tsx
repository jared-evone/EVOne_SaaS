import { useEffect, useState } from 'react';
import { C } from './theme';
import { Logo } from './components/Logo';
import { NavItem } from './components/NavItem';
import {
  LayoutDashboard, Home, Receipt, Wrench, Users, FolderKanban, CalendarDays,
  Handshake, ClipboardList, Boxes, Truck, Building2, Plug, Zap, FileText,
  Hammer, Settings as SettingsIcon, ShieldCheck, Database, ChevronRight, ChevronDown,
  Power, Menu, TrendingUp, UserCog, Mail, Calculator, ClipboardCheck,
  type LucideIcon,
} from 'lucide-react';
import { useIsMobile } from './lib/useIsMobile';
import { setAppToken, hasValidAppToken } from './lib/supabase';
import { startVersionWatch } from './lib/version';
import { ScreenOverview } from './screens/Overview';
import { ScreenInvoices } from './screens/Invoices';
import { ScreenInstallations } from './screens/Installations';
import { ScreenCustomers } from './screens/Customers';
import { ScreenProjects } from './screens/Projects';
import { ScreenSocial } from './screens/Social';
import { ScreenSales } from './screens/Sales';
import { ScreenSalesManager } from './screens/SalesManager';
import { ScreenSalesTeam } from './screens/SalesTeam';
import { ScreenPurchaseOrders } from './screens/PurchaseOrders';
import { ScreenInventory } from './screens/Inventory';
import { ScreenSuppliers } from './screens/Suppliers';
import { ScreenCorporateCRM } from './screens/CorporateCRM';
import { ScreenChargingRecords } from './screens/ChargingRecords';
import { ScreenCorporateInvoicing } from './screens/CorporateInvoicing';
import { ScreenCPOChargers } from './screens/CPOChargers';
import { ScreenSettings } from './screens/Settings';
import { ScreenDBHealth } from './screens/DBHealth';
import { ScreenEmailDesigner } from './screens/EmailDesigner';
import { ScreenQuoteMachine } from './screens/QuoteMachine';
import { ScreenRaisePO, PODecisionPage } from './screens/RaisePO';
import { SuperAdminConsole } from './screens/SuperAdmin';
import { ScreenChargingDashboard } from './screens/ChargingDashboard';
import { ScreenDashboard } from './screens/Dashboard';
import { Login } from './screens/Login';
import { TechApp } from './screens/tsd/TechApp';
import { WorkOrdersAdmin, FormBuilder } from './screens/tsd/TSDAdminApp';
import { TechniciansAdmin } from './screens/tsd/TechniciansAdmin';
import { PICReviewBoard } from './screens/tsd/PICApp';
import { PublicApplication } from './screens/crm/PublicApplication';
import { FormTestPage } from './screens/tsd/FormTestPage';
import {
  PermissionsProvider, usePermissions,
  DEPARTMENT_LABELS, DEPARTMENT_SCREENS,
  type ScreenKey, type SignedInUser, type Department,
} from './permissions';

type ScreenId = ScreenKey;

// Landing screen per department when a session starts (used if that screen is
// visible to the user; otherwise the first available screen is used). Technicians
// land on their job list rather than the shared Customers tab.
const DEPARTMENT_DEFAULT_SCREEN: Partial<Record<Department, ScreenId>> = {
  tech: 'tsd_technician',
};

type NavLeaf  = { kind: 'leaf';  id: ScreenId; icon: LucideIcon; label: string };
type NavGroup = { kind: 'group'; key: string;  icon: LucideIcon; label: string; children: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

const NAV_ALL: NavEntry[] = [
  { kind: 'leaf', id: 'dashboard',         icon: LayoutDashboard, label: 'Dashboard' },
  { kind: 'leaf', id: 'charging_dashboard',icon: LayoutDashboard, label: 'Charging Dashboard' },
  { kind: 'leaf', id: 'overview',          icon: Home,            label: 'Overview' },
  { kind: 'leaf', id: 'orders',            icon: Receipt,         label: 'Invoices' },
  { kind: 'leaf', id: 'installations',     icon: Wrench,          label: 'Installations' },
  { kind: 'leaf', id: 'customers',         icon: Users,           label: 'Customers' },
  { kind: 'leaf', id: 'projects',          icon: FolderKanban,    label: 'Charger Registry' },
  { kind: 'leaf', id: 'email_designer',    icon: Mail,            label: 'Email' },
  { kind: 'leaf', id: 'social',            icon: CalendarDays,    label: 'Social Media Planner' },
  { kind: 'leaf', id: 'sales',             icon: Handshake,       label: 'Sales Pipeline' },
  { kind: 'leaf', id: 'sales_manager',     icon: TrendingUp,      label: 'Sales Dashboard' },
  { kind: 'leaf', id: 'sales_team',        icon: UserCog,         label: 'Sales Manager' },
  { kind: 'leaf', id: 'purchaseorders',    icon: ClipboardList,   label: 'Purchase Orders' },
  { kind: 'leaf', id: 'inventory',         icon: Boxes,           label: 'Inventory & Products' },
  { kind: 'leaf', id: 'suppliers',         icon: Truck,           label: 'Suppliers' },
  { kind: 'leaf', id: 'corporatecrm',      icon: Building2,       label: 'Corporate CRM' },
  { kind: 'leaf', id: 'cpochargers',       icon: Plug,            label: 'CPO Chargers' },
  { kind: 'leaf', id: 'charging',          icon: Zap,             label: 'Charging Records' },
  { kind: 'leaf', id: 'corporateinvoicing',icon: FileText,        label: 'Corporate Invoicing' },
  { kind: 'leaf', id: 'quote_machine',     icon: Calculator,      label: 'Quote Machine' },
  { kind: 'leaf', id: 'raise_po',          icon: ClipboardCheck,  label: 'Raise PO' },
  { kind: 'leaf', id: 'tsd_technician',    icon: Hammer,          label: 'Technician' },
  { kind: 'group', key: 'tsd_admin_group', icon: ClipboardList,   label: 'TSD Admin', children: [
    { kind: 'leaf', id: 'tsd_workorders',  icon: ClipboardList,   label: 'Work Orders' },
    { kind: 'leaf', id: 'tsd_forms',       icon: FileText,        label: 'Form Templates' },
    { kind: 'leaf', id: 'tsd_pic',         icon: ShieldCheck,     label: 'PIC Review' },
    { kind: 'leaf', id: 'tsd_technicians', icon: Users,           label: 'Technicians' },
  ]},
  { kind: 'group', key: 'settings_group', icon: SettingsIcon,     label: 'Settings', children: [
    { kind: 'leaf', id: 'settings', icon: Users,                  label: 'Users & Permissions' },
    { kind: 'leaf', id: 'dbhealth', icon: Database,               label: 'DB Health' },
  ]},
];

// Only top-level navigable screens get titles + components. Sub-screen permission
// keys (e.g. charging_cpo_carparks) live in the matrix but never render directly.
const SCREEN_TITLES: Partial<Record<ScreenId, string>> = {
  dashboard:      'Dashboard',
  overview:       'Overview',
  orders:         'Invoices',
  installations:  'Installations',
  customers:      'Customers',
  projects:       'Charger Registry',
  social:         'Social Media Planner',
  sales:          'Sales Pipeline',
  sales_manager:  'Sales Dashboard',
  sales_team:     'Sales Manager',
  purchaseorders: 'Purchase Orders',
  inventory:      'Inventory & Products',
  suppliers:      'Suppliers',
  corporatecrm:        'Corporate CRM',
  cpochargers:         'CPO Chargers',
  charging:            'Charging Records',
  corporateinvoicing:  'Corporate Invoicing',
  charging_dashboard:  'Charging Dashboard',
  quote_machine:       'Quote Machine',
  raise_po:            'Raise PO',
  tsd_technician:      'Technician',
  tsd_workorders:      'Work Orders',
  tsd_forms:           'Form Templates',
  tsd_pic:             'PIC Review',
  tsd_technicians:     'Technicians',
  email_designer:      'Email',
  settings:            'Users & Permissions',
  dbhealth:            'DB Health',
};

const screens: Partial<Record<ScreenId, JSX.Element>> = {
  dashboard:      <ScreenDashboard />,
  overview:       <ScreenOverview />,
  orders:         <ScreenInvoices />,
  installations:  <ScreenInstallations />,
  customers:      <ScreenCustomers />,
  projects:       <ScreenProjects />,
  social:         <ScreenSocial />,
  sales:          <ScreenSales />,
  sales_manager:  <ScreenSalesManager />,
  sales_team:     <ScreenSalesTeam />,
  purchaseorders: <ScreenPurchaseOrders />,
  inventory:      <ScreenInventory />,
  suppliers:      <ScreenSuppliers />,
  corporatecrm:        <ScreenCorporateCRM />,
  cpochargers:         <ScreenCPOChargers />,
  charging:            <ScreenChargingRecords />,
  corporateinvoicing:  <ScreenCorporateInvoicing />,
  charging_dashboard:  <ScreenChargingDashboard />,
  quote_machine:       <ScreenQuoteMachine />,
  raise_po:            <ScreenRaisePO />,
  tsd_technician:      <TechApp />,
  tsd_workorders:      <WorkOrdersAdmin />,
  tsd_forms:           <FormBuilder />,
  tsd_pic:             <PICReviewBoard />,
  tsd_technicians:     <TechniciansAdmin />,
  email_designer:      <ScreenEmailDesigner />,
  settings:            <ScreenSettings />,
  dbhealth:            <ScreenDBHealth />,
};

interface DashboardProps {
  onSignOut: () => void;
}

function Dashboard({ onSignOut }: DashboardProps) {
  const { can, user } = usePermissions();
  // The session is scoped to the department picked at sign-in; within it, each
  // screen shows only if the centrally-managed per-user grants allow viewing.
  const departmentScreens = DEPARTMENT_SCREENS[user.department];
  const isLeafVisible = (id: ScreenId) => departmentScreens.includes(id) && can(id, 'can_view');

  const NAV: NavEntry[] = NAV_ALL.flatMap((n): NavEntry[] => {
    if (n.kind === 'leaf') return isLeafVisible(n.id) ? [n] : [];
    const visibleChildren = n.children.filter((c) => isLeafVisible(c.id));
    return visibleChildren.length > 0 ? [{ ...n, children: visibleChildren }] : [];
  });

  const allVisibleLeafIds: ScreenId[] = NAV.flatMap((n) => n.kind === 'leaf' ? [n.id] : n.children.map((c) => c.id));
  const preferredDefault = DEPARTMENT_DEFAULT_SCREEN[user.department];
  const fallbackScreen: ScreenId | null =
    (preferredDefault && allVisibleLeafIds.includes(preferredDefault) ? preferredDefault : allVisibleLeafIds[0]) ?? null;
  const [screen, setScreen] = useState<ScreenId | null>(fallbackScreen);
  const activeScreen = screen && allVisibleLeafIds.includes(screen) ? screen : fallbackScreen;

  // Settings group expands automatically when one of its children is active
  const initialOpen: Record<string, boolean> = {};
  for (const n of NAV) {
    if (n.kind === 'group') {
      initialOpen[n.key] = n.children.some((c) => c.id === activeScreen);
    }
  }
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);
  const toggleGroup = (key: string) => setOpenGroups((s) => ({ ...s, [key]: !s[key] }));

  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);
  const contentPad = isMobile ? 12 : 28;
  const userInitial = (user.full_name || user.email).trim().charAt(0).toUpperCase();

  const selectScreen = (id: ScreenId) => {
    setScreen(id);
    if (isMobile) setNavOpen(false);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: C.seasalt }}>
      {/* Mobile drawer scrim */}
      {isMobile && navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1090 }}
        />
      )}
      {/* Sidebar — fixed column on desktop, slide-over drawer on mobile */}
      <aside
        style={{
          width: isMobile ? 264 : 224,
          flexShrink: 0,
          background: C.white,
          borderRight: '1px solid #EBEBEB',
          display: isMobile && !navOpen ? 'none' : 'flex',
          flexDirection: 'column',
          padding: '0 12px',
          overflow: 'hidden',
          ...(isMobile
            ? { position: 'fixed' as const, left: 0, top: 0, bottom: 0, zIndex: 1100, boxShadow: '0 0 48px rgba(0,0,0,.18)' }
            : {}),
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
                  onClick={() => selectScreen(n.id)}
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
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}>
                    {open ? <ChevronDown size={12} strokeWidth={2.5} /> : <ChevronRight size={12} strokeWidth={2.5} />}
                  </span>
                </button>
                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {n.children.map((c) => (
                      <NavItem
                        key={c.id}
                        icon={c.icon}
                        label={c.label}
                        active={activeScreen === c.id}
                        onClick={() => selectScreen(c.id)}
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
              {user.role_label || user.email}
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
            <Power size={14} strokeWidth={2.25} />
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
            padding: isMobile ? '0 14px' : '0 28px',
            gap: isMobile ? 10 : 16,
          }}
        >
          {isMobile && (
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                border: '1px solid #EBEBEB',
                background: 'transparent',
                color: C.slate,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Menu size={18} strokeWidth={2.25} />
            </button>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeScreen ? SCREEN_TITLES[activeScreen] : 'EVOne'}
            </div>
            {!isMobile && <div style={{ fontSize: 11, color: C.slate }}>May 4, 2026 · Kuala Lumpur</div>}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontSize: isMobile ? 9 : 11,
                fontWeight: 700,
                padding: '5px 12px',
                borderRadius: 99,
                background: C.honeydew,
                color: C.green,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {DEPARTMENT_LABELS[user.department]}{user.role_label ? ` · ${user.role_label}` : ''}
            </span>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: contentPad }}>
          {activeScreen ? screens[activeScreen] : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 10, textAlign: 'center' }}>
              <ShieldCheck size={32} strokeWidth={1.5} color={C.slate} />
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>No access yet</div>
              <div style={{ fontSize: 13, color: C.slate, maxWidth: 320, lineHeight: 1.5 }}>
                Your account has no screens enabled. Ask an administrator to grant you access.
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const USER_KEY = 'evone_app_user';

// When a new version is deployed, also clear the session so everyone re-logs in.
const FORCE_RELOGIN_ON_UPDATE = true;

function UpdateOverlay({ relogin }: { relogin: boolean }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: C.seasalt, zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, border: '1px solid #EBEBEB', padding: '32px 36px', boxShadow: '0 24px 64px rgba(0,0,0,.12)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 360, textAlign: 'center' }}>
        <Logo height={34} />
        <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Updating to the latest version…</div>
        <div style={{ fontSize: 13, color: C.slate, lineHeight: 1.5 }}>
          A new version was just released.{relogin ? ' Please sign in again after the page reloads.' : ' The page will reload automatically.'}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  // Restore the session on reload — only if the stored auth token is still valid.
  const [user, setUser] = useState<SignedInUser | null>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw && hasValidAppToken()) return JSON.parse(raw) as SignedInUser;
    } catch { /* ignore */ }
    return null;
  });
  const [updating, setUpdating] = useState(false);

  // Watch for a newer deploy. When found, optionally drop the session (force a
  // re-login) and reload so everyone runs the latest bundle.
  useEffect(() => {
    startVersionWatch(() => {
      setUpdating(true);
      if (FORCE_RELOGIN_ON_UPDATE) {
        setAppToken(null);
        try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
      }
      window.setTimeout(() => window.location.reload(), 1200);
    });
  }, []);

  const handleLogin = (u: SignedInUser) => {
    try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch { /* ignore */ }
    setUser(u);
  };
  const handleSignOut = () => {
    setAppToken(null);
    try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
    setUser(null);
  };

  // A newer version was deployed — show the updating splash while we reload.
  if (updating) {
    return <UpdateOverlay relogin={FORCE_RELOGIN_ON_UPDATE} />;
  }

  // Public account-opening invite: bypass login entirely.
  const applyToken = new URLSearchParams(window.location.search).get('apply');
  if (applyToken) {
    return <PublicApplication token={applyToken} />;
  }

  // QR-code form test from the Form Builder: bypass login, render the saved template.
  const formPreviewId = new URLSearchParams(window.location.search).get('formPreview');
  if (formPreviewId) {
    return <FormTestPage templateId={formPreviewId} />;
  }

  // PO approve/reject from the approval email: bypass login, render the decision page.
  const poToken = new URLSearchParams(window.location.search).get('po');
  if (poToken) {
    return <PODecisionPage token={poToken} decision={new URLSearchParams(window.location.search).get('decision')} />;
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  // Hidden superadmin console — cross-department, no normal sidebar.
  if (user.is_superadmin) {
    return (
      <PermissionsProvider user={user}>
        <SuperAdminConsole onSignOut={handleSignOut} />
      </PermissionsProvider>
    );
  }

  return (
    <PermissionsProvider user={user}>
      <Dashboard onSignOut={handleSignOut} />
    </PermissionsProvider>
  );
}
