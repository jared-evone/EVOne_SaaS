import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './lib/supabase';

export type Department = 'cpo' | 'sales' | 'tech' | 'pm';

export const DEPARTMENT_LABELS: Record<Department, string> = {
  cpo:   'CPO',
  sales: 'Sales',
  tech:  'Technical Service',
  pm:    'Project Management',
};

export type ScreenKey =
  | 'dashboard'
  | 'overview' | 'orders' | 'installations' | 'customers' | 'projects' | 'social' | 'sales' | 'sales_manager' | 'sales_team'
  | 'purchaseorders' | 'inventory' | 'suppliers'
  | 'corporatecrm' | 'corporatecrm_invoicing'
  | 'cpochargers' | 'charging' | 'corporateinvoicing' | 'charging_dashboard'
  | 'charging_cpo_carparks' | 'charging_sp_price'
  | 'tsd_technician' | 'tsd_workorders' | 'tsd_forms' | 'tsd_pic' | 'tsd_technicians'
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
  settings:              'Users & Permissions',
  dbhealth:              'DB Health',
};

// Each department exposes only its own screens in the NAV + Settings matrix.
export const DEPARTMENT_SCREENS: Record<Department, ScreenKey[]> = {
  cpo:   ['charging_dashboard', 'corporatecrm', 'corporatecrm_invoicing', 'cpochargers', 'charging',
          'charging_cpo_carparks', 'charging_sp_price',
          'corporateinvoicing', 'settings', 'dbhealth'],
  sales: ['customers', 'sales', 'sales_manager', 'sales_team', 'settings', 'dbhealth'],
  tech:  ['tsd_technician', 'tsd_workorders', 'tsd_forms', 'tsd_pic', 'tsd_technicians', 'customers', 'projects', 'settings', 'dbhealth'],
  pm:    ['dashboard', 'customers', 'projects', 'settings', 'dbhealth'],
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
  department: Department;
  role_id: string;
  role_name: string;
  role_label: string;
}

interface PermissionsContextValue {
  user: SignedInUser;
  perms: PermissionMap;
  can: (screen: ScreenKey, cap: keyof ScreenCap) => boolean;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

const DENY: ScreenCap = { can_view: false, can_edit: false, can_delete: false };

export async function loadPermissionsForRole(roleId: string): Promise<PermissionMap> {
  const { data: rows } = await supabase
    .from('app_role_permissions')
    .select('screen_key, can_view, can_edit, can_delete')
    .eq('role_id', roleId);
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
    const m = await loadPermissionsForRole(user.role_id);
    setPerms(m);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [user.role_id]);

  const can = (screen: ScreenKey, cap: keyof ScreenCap) => (perms[screen] ?? DENY)[cap];

  if (loading) return null;

  return (
    <PermissionsContext.Provider value={{ user, perms, can, refresh }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used inside <PermissionsProvider>');
  return ctx;
}
