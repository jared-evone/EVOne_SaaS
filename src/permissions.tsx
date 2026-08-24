import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './lib/supabase';

export type Department = 'cpo' | 'sales' | 'tech' | 'pm';

export const DEPARTMENT_LABELS: Record<Department, string> = {
  cpo:   'CPO',
  sales: 'Sales',
  tech:  'Technical Service',
  pm:    'Charger Registry',
};

export type ScreenKey =
  | 'dashboard'
  | 'overview' | 'orders' | 'installations' | 'customers' | 'projects' | 'social' | 'sales' | 'sales_manager' | 'sales_team'
  | 'purchaseorders' | 'inventory' | 'suppliers'
  | 'corporatecrm' | 'corporatecrm_invoicing'
  | 'cpochargers' | 'charging' | 'corporateinvoicing' | 'charging_dashboard'
  | 'charging_cpo_carparks' | 'charging_sp_price'
  | 'tsd_technician' | 'tsd_workorders' | 'tsd_forms' | 'tsd_pic' | 'tsd_technicians'
  | 'email_designer' | 'quote_machine' | 'raise_po'
  | 'charger_projects' | 'registry_todo'
  | 'settings' | 'dbhealth';

export const SCREEN_LABELS: Record<ScreenKey, string> = {
  dashboard:             'Dashboard',
  overview:              'Overview',
  orders:                'Invoices',
  installations:         'Installations',
  customers:             'Customers',
  projects:              'Charger Registry',
  social:                'Social Media Planner',
  sales:                 'Sales Pipeline',
  sales_manager:         'Sales Dashboard',
  sales_team:            'Sales Manager',
  purchaseorders:        'Purchase Orders',
  inventory:             'Inventory & Products',
  suppliers:             'Suppliers',
  corporatecrm:          'Corporate CRM',
  corporatecrm_invoicing:'Corporate CRM › Invoicing & CC only',
  cpochargers:           'CPO Chargers',
  charging:              'Charging Records',
  charging_cpo_carparks: 'Charging Records › CPO Carparks tab',
  charging_sp_price:     'Charging Records › SP Price tab',
  corporateinvoicing:    'Corporate Invoicing',
  charging_dashboard:    'Charging Dashboard',
  tsd_technician:        'Technician',
  tsd_workorders:        'Work Orders',
  tsd_forms:             'Form Templates',
  tsd_pic:               'PIC Review',
  tsd_technicians:       'Technicians',
  email_designer:        'Email',
  quote_machine:         'Quote Machine',
  raise_po:              'Raise PO',
  charger_projects:      'Projects',
  registry_todo:         'To Do',
  settings:              'Users & Permissions',
  dbhealth:              'DB Health',
};

// Each department exposes only its own screens in the NAV + Settings matrix.
export const DEPARTMENT_SCREENS: Record<Department, ScreenKey[]> = {
  // Users & Permissions ('settings') and DB Health ('dbhealth') are no longer
  // per-department — they live only in the hidden cross-department superadmin
  // console (superadmin_login / 1234). Don't add them back to any department.
  cpo:   ['charging_dashboard', 'corporatecrm', 'corporatecrm_invoicing', 'cpochargers', 'charging',
          'charging_cpo_carparks', 'charging_sp_price',
          'corporateinvoicing'],
  sales: ['customers', 'sales', 'sales_manager', 'sales_team', 'quote_machine', 'raise_po'],
  tech:  ['tsd_technician', 'tsd_workorders', 'tsd_forms', 'tsd_pic', 'tsd_technicians', 'customers', 'projects'],
  pm:    ['dashboard', 'registry_todo', 'charger_projects', 'customers', 'projects', 'email_designer'],
};

export interface ScreenCap {
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export type PermissionMap = Partial<Record<ScreenKey, ScreenCap>>;

export interface SignedInUser {
  id: string;
  email: string;
  full_name: string;
  /** The department picked at sign-in — scopes this session's sidebar/screens.
   *  Whether the account may enter a department is decided by its per-user
   *  grants in app_user_permissions (managed centrally per email). */
  department: Department;
  role_id: string;
  role_name: string;
  role_label: string;
  /** Hidden cross-department superadmin (signed in via superadmin_login). */
  is_superadmin?: boolean;
}

/** All departments, in nav/matrix order. */
export const DEPARTMENTS: Department[] = ['cpo', 'sales', 'tech', 'pm'];

/** Screens grouped by their OWNING department — the grouping used by the
 *  per-user permission matrix, the Access chips and the login department gate.
 *  A screen shared by several departments (customers, projects) belongs to the
 *  first department that lists it, so a Sales-only grant of `customers` doesn't
 *  read as access to Technical Service or Charger Registry. */
export const PERMISSION_SECTIONS: { department: Department; keys: ScreenKey[] }[] = (() => {
  const seen = new Set<ScreenKey>();
  return DEPARTMENTS.map((d) => ({
    department: d,
    keys: DEPARTMENT_SCREENS[d].filter((k) => !seen.has(k) && (seen.add(k), true)),
  }));
})();

/** Sections for the superadmin permission matrix. Unlike PERMISSION_SECTIONS
 *  these are NOT deduped: a shared screen (customers, projects) is listed under
 *  every department that exposes it, so you can find and switch off e.g.
 *  "Customers" while setting up a technician. There is still only ONE grant per
 *  (user, screen) — see SHARED_SCREENS: toggling it in one section changes it in
 *  the others too, which the UI calls out. */
export const MATRIX_SECTIONS: { department: Department; keys: ScreenKey[] }[] =
  DEPARTMENTS.map((d) => ({ department: d, keys: DEPARTMENT_SCREENS[d] }));

/** Screens exposed by more than one department — their grant is shared. */
export const SHARED_SCREENS: Set<ScreenKey> = (() => {
  const count = new Map<ScreenKey, number>();
  for (const d of DEPARTMENTS) for (const k of DEPARTMENT_SCREENS[d]) count.set(k, (count.get(k) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
})();

interface PermissionsContextValue {
  user: SignedInUser;
  perms: PermissionMap;
  can: (screen: ScreenKey, cap: keyof ScreenCap) => boolean;
  /** True only for a full department admin: view+edit+delete on EVERY screen the
   *  department exposes. Use this — not a single screen's can_delete — to gate
   *  cross-user/admin-wide views (e.g. seeing every salesperson's pipeline). */
  isAdmin: boolean;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

const DENY: ScreenCap = { can_view: false, can_edit: false, can_delete: false };

// Grants are per-department: a screen shared by several departments (customers,
// projects) can be granted in one and denied in another. A session is scoped to
// the department picked at sign-in, so we only load that department's rows.
export async function loadPermissionsForUser(userId: string, department: Department): Promise<PermissionMap> {
  const { data: rows } = await supabase
    .from('app_user_permissions')
    .select('screen_key, can_view, can_edit, can_delete')
    .eq('user_id', userId)
    .eq('department', department);
  const map: PermissionMap = {};
  for (const r of (rows ?? []) as Array<{ screen_key: string; can_view: boolean; can_edit: boolean; can_delete: boolean }>) {
    map[r.screen_key as ScreenKey] = { can_view: r.can_view, can_edit: r.can_edit, can_delete: r.can_delete };
  }
  return map;
}

interface PermissionsProviderProps {
  user: SignedInUser;
  children: ReactNode;
}

export function PermissionsProvider({ user, children }: PermissionsProviderProps) {
  const [perms, setPerms] = useState<PermissionMap>({});
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    // Superadmin has no permission rows — it bypasses the matrix entirely.
    const m = user.is_superadmin ? {} : await loadPermissionsForUser(user.id, user.department);
    setPerms(m);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [user.id]);

  // Superadmin sees and can do everything, in any department.
  const can = (screen: ScreenKey, cap: keyof ScreenCap) =>
    user.is_superadmin ? true : (perms[screen] ?? DENY)[cap];

  // Admin = full view+edit+delete on every screen of the department this
  // session was signed into. Grants are per-user (cross-department), so the
  // same email can be an admin in one department and a member in another.
  const isAdmin = user.is_superadmin || DEPARTMENT_SCREENS[user.department].every((k) => {
    const c = perms[k] ?? DENY;
    return c.can_view && c.can_edit && c.can_delete;
  });

  if (loading) return null;

  return (
    <PermissionsContext.Provider value={{ user, perms, can, isAdmin, refresh }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used inside <PermissionsProvider>');
  return ctx;
}
