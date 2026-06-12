import { useEffect, useMemo, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { Search } from 'lucide-react';
import { useIsMobile } from '../lib/useIsMobile';
import {
  DEPARTMENT_LABELS, DEPARTMENT_SCREENS, SCREEN_LABELS, usePermissions,
  type ScreenKey, type ScreenCap, type Department,
} from '../permissions';

// ── Types ─────────────────────────────────────────────────────────

interface AppRole {
  id: string;
  department: Department;
  name: string;
  label: string;
  description: string | null;
  is_system: boolean;
}

interface AppUser {
  id: string;
  department: Department;
  email: string;
  full_name: string;
  role_id: string;
  is_active: boolean;
  password: string;
  app_roles?: { label: string; name: string } | null;
}

type PermissionRow = ScreenCap & { screen_key: ScreenKey };

// ── Root ──────────────────────────────────────────────────────────

type Tab = 'users' | 'roles';

export function ScreenSettings() {
  const { user: currentUser } = usePermissions();
  const department = currentUser.department;
  const departmentScreens = DEPARTMENT_SCREENS[department];

  const [tab, setTab] = useState<Tab>('users');
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    const [{ data: r }, { data: u }] = await Promise.all([
      supabase.from('app_roles').select('*').eq('department', department).order('is_system', { ascending: false }).order('label'),
      supabase.from('app_users').select('*, app_roles(label, name)').eq('department', department).order('full_name'),
    ]);
    setRoles((r as AppRole[]) ?? []);
    setUsers((u as AppUser[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [department]);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Scope banner */}
      <div style={{ background: C.honeydew, color: C.green, borderRadius: 12, padding: '12px 18px', fontSize: 12, fontWeight: 600 }}>
        Showing users &amp; roles for the <strong>{DEPARTMENT_LABELS[department]}</strong> department only.
        Other departments manage their own access separately.
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label={`${DEPARTMENT_LABELS[department]} Users`} value={String(users.length)} sub="in this department" accent />
        <KPICard label="Active Users" value={String(users.filter((u) => u.is_active).length)} sub="can sign in" />
        <KPICard label="Total Roles"  value={String(roles.length)} sub={`${roles.filter((r) => r.is_system).length} system`} />
        <KPICard label="Custom Roles" value={String(roles.filter((r) => !r.is_system).length)} sub="created by admins" />
      </div>

      {/* Top-level tab strip */}
      <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
        {([
          ['users', 'Users'],
          ['roles', 'Roles & Permissions'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{
              padding: '8px 22px', borderRadius: 10, border: 'none',
              fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: tab === id ? C.green : 'transparent',
              color: tab === id ? C.white : C.slate,
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <UsersTab users={users} roles={roles} department={department} onRefresh={fetchAll} />
      )}
      {tab === 'roles' && (
        <RolesTab roles={roles} department={department} departmentScreens={departmentScreens} onRefresh={fetchAll} />
      )}
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────

interface UsersTabProps {
  users: AppUser[];
  roles: AppRole[];
  department: Department;
  onRefresh: () => Promise<void>;
}

function UsersTab({ users, roles, department, onRefresh }: UsersTabProps) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);

  const visible = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.email.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q) || (u.app_roles?.label ?? '').toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, role…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
        </div>
        <button onClick={() => setAdding(true)}
          style={{ marginLeft: 'auto', padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Add User
        </button>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 660, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['#', 'Name', 'Email', 'Role', 'Status', ''].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((u, i) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={() => setEditing(u)}>
                <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate }}>{i + 1}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green }}>{u.full_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#1a1a1a' }}>{u.email}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: C.honeydew, color: C.green }}>
                    {u.app_roles?.label ?? '—'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                    background: u.is_active ? '#E4F3E3' : '#F3F3F3',
                    color:      u.is_active ? '#1B512D' : '#767B77' }}>
                    {u.is_active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <button onClick={(e) => { e.stopPropagation(); setEditing(u); }}
                    style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No users match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <UserModal title="New User" roles={roles}
          initial={{ email: '', full_name: '', role_id: roles[0]?.id ?? '', is_active: true, password: '1234' }}
          onSave={async (data) => {
            await supabase.from('app_users').insert({ ...data, department });
            await onRefresh();
          }}
          onClose={() => setAdding(false)} />
      )}
      {editing && (
        <UserModal key={editing.id} title={`Edit ${editing.full_name}`} roles={roles}
          initial={{ email: editing.email, full_name: editing.full_name, role_id: editing.role_id, is_active: editing.is_active, password: editing.password }}
          onSave={async (data) => {
            await supabase.from('app_users').update({ ...data, updated_at: new Date().toISOString() }).eq('id', editing.id);
            await onRefresh();
          }}
          onDelete={async () => { await supabase.from('app_users').delete().eq('id', editing.id); await onRefresh(); }}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── User Modal ────────────────────────────────────────────────────

interface UserFormShape {
  email: string;
  full_name: string;
  role_id: string;
  is_active: boolean;
  password: string;
}

interface UserModalProps {
  initial: UserFormShape;
  title: string;
  roles: AppRole[];
  onSave: (data: UserFormShape) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function UserModal({ initial, title, roles, onSave, onDelete, onClose }: UserModalProps) {
  const [form, setForm] = useState<UserFormShape>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canSave = !!form.email.trim() && !!form.full_name.trim() && !!form.role_id && !!form.password && !saving;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 480, maxWidth: 'calc(100vw - 24px)', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <Field label="Full Name">
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.toLowerCase() })} style={inputStyle} />
        </Field>
        <Field label="Password">
          <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="1234"
            style={{ ...inputStyle, fontFamily: 'monospace' }} />
        </Field>
        <Field label="Role">
          <select value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })} style={{ ...inputStyle, background: C.white, cursor: 'pointer' }}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#1a1a1a', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            style={{ width: 16, height: 16, accentColor: C.green, cursor: 'pointer' }} />
          User is active (can sign in)
        </label>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this user?</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={async () => { await onDelete!(); onClose(); }}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, Delete</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {onDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button disabled={!canSave}
              onClick={async () => { setSaving(true); await onSave(form); setSaving(false); onClose(); }}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Roles Tab ─────────────────────────────────────────────────────

interface RolesTabProps {
  roles: AppRole[];
  department: Department;
  departmentScreens: ScreenKey[];
  onRefresh: () => Promise<void>;
}

function RolesTab({ roles, department, departmentScreens, onRefresh }: RolesTabProps) {
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(roles[0]?.id ?? null);
  const [adding, setAdding] = useState(false);

  const selected = roles.find((r) => r.id === selectedId) ?? null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '280px 1fr', gap: 16, alignItems: 'flex-start' }}>
      {/* Role list */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F3F3', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Roles</div>
          <button onClick={() => setAdding(true)}
            style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + New
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {roles.map((r) => {
            const active = r.id === selectedId;
            return (
              <button key={r.id} onClick={() => setSelectedId(r.id)}
                style={{ padding: '12px 16px', textAlign: 'left', border: 'none',
                  borderLeft: `3px solid ${active ? C.green : 'transparent'}`,
                  borderBottom: '1px solid #F3F3F3',
                  background: active ? C.honeydew : 'transparent',
                  cursor: 'pointer', fontFamily: 'Figtree',
                  display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: active ? C.green : '#1a1a1a' }}>{r.label}</span>
                  {r.is_system && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: '#F3F3F3', color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      System
                    </span>
                  )}
                </div>
                {r.description && (
                  <div style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Role detail */}
      {selected ? (
        <RoleEditor key={selected.id} role={selected} departmentScreens={departmentScreens} onRefresh={onRefresh}
          onDeleted={() => { setSelectedId(roles.find((r) => r.id !== selected.id)?.id ?? null); }} />
      ) : (
        <div style={{ background: C.white, borderRadius: 16, border: '1px dashed #EBEBEB', padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>
          Select a role to edit its permissions, or click <strong>+ New</strong> to create one.
        </div>
      )}

      {adding && (
        <RoleModal title="New Role" onClose={() => setAdding(false)}
          initial={{ name: '', label: '', description: '' }}
          onSave={async (data) => {
            const { data: created } = await supabase.from('app_roles')
              .insert({ ...data, department, is_system: false })
              .select().single();
            await onRefresh();
            if (created) setSelectedId(created.id);
          }} />
      )}
    </div>
  );
}

// ── Role Editor (permission matrix) ───────────────────────────────

interface RoleEditorProps {
  role: AppRole;
  departmentScreens: ScreenKey[];
  onRefresh: () => Promise<void>;
  onDeleted: () => void;
}

function RoleEditor({ role, departmentScreens, onRefresh, onDeleted }: RoleEditorProps) {
  const { refresh: refreshActivePerms } = usePermissions();
  const [perms, setPerms] = useState<Record<ScreenKey, ScreenCap>>(() => emptyMatrix(departmentScreens));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fetchPerms = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('app_role_permissions')
      .select('screen_key, can_view, can_edit, can_delete')
      .eq('role_id', role.id);
    const matrix = emptyMatrix(departmentScreens);
    for (const row of (data ?? []) as PermissionRow[]) {
      if (departmentScreens.includes(row.screen_key)) {
        matrix[row.screen_key] = { can_view: row.can_view, can_edit: row.can_edit, can_delete: row.can_delete };
      }
    }
    setPerms(matrix);
    setLoading(false);
  };

  useEffect(() => { fetchPerms(); }, [role.id]);

  const totals = useMemo(() => {
    let v = 0, e = 0, d = 0;
    for (const k of departmentScreens) {
      if (perms[k]?.can_view) v++;
      if (perms[k]?.can_edit) e++;
      if (perms[k]?.can_delete) d++;
    }
    return { v, e, d };
  }, [perms, departmentScreens]);

  const togglePerm = (k: ScreenKey, cap: keyof ScreenCap) => {
    setPerms((prev) => {
      const next = { ...prev, [k]: { ...prev[k], [cap]: !prev[k][cap] } };
      // Convenience: edit/delete require view; turning view off clears the others
      if (cap === 'can_view' && !next[k].can_view) {
        next[k] = { can_view: false, can_edit: false, can_delete: false };
      } else if (cap !== 'can_view' && next[k][cap]) {
        next[k].can_view = true;
      }
      return next;
    });
  };

  const toggleAllForScreen = (k: ScreenKey) => {
    setPerms((prev) => {
      const all = prev[k].can_view && prev[k].can_edit && prev[k].can_delete;
      return { ...prev, [k]: { can_view: !all, can_edit: !all, can_delete: !all } };
    });
  };

  const toggleColumn = (cap: keyof ScreenCap) => {
    const allOn = departmentScreens.every((k) => perms[k][cap]);
    setPerms((prev) => {
      const next = { ...prev };
      for (const k of departmentScreens) {
        next[k] = { ...next[k], [cap]: !allOn };
        if (cap === 'can_view' && !next[k].can_view) {
          next[k].can_edit = false; next[k].can_delete = false;
        }
        if (cap !== 'can_view' && next[k][cap]) {
          next[k].can_view = true;
        }
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    // Replace strategy: delete all rows for this role, then insert new ones.
    await supabase.from('app_role_permissions').delete().eq('role_id', role.id);
    const rows = departmentScreens.map((k) => ({
      role_id: role.id,
      screen_key: k,
      can_view: perms[k].can_view,
      can_edit: perms[k].can_edit,
      can_delete: perms[k].can_delete,
    }));
    await supabase.from('app_role_permissions').insert(rows);
    await refreshActivePerms();
    setSaving(false);
  };

  const deleteRole = async () => {
    await supabase.from('app_roles').delete().eq('id', role.id);
    await onRefresh();
    onDeleted();
  };

  if (loading) {
    return <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Role header */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '18px 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.01em' }}>{role.label}</div>
            {role.is_system && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#F3F3F3', color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                System
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>
            <code style={{ background: C.seasalt, padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{role.name}</code>
            {role.description ? ` · ${role.description}` : ''}
          </div>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 8 }}>
            View: <strong style={{ color: '#1a1a1a' }}>{totals.v}</strong> · Edit: <strong style={{ color: '#1a1a1a' }}>{totals.e}</strong> · Delete: <strong style={{ color: '#1a1a1a' }}>{totals.d}</strong> of {departmentScreens.length} screens
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {!role.is_system && (
            <button onClick={() => setEditing(true)}
              style={{ padding: '8px 16px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Edit Info
            </button>
          )}
          {!role.is_system && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Delete
            </button>
          )}
          <button onClick={save} disabled={saving}
            style={{ padding: '8px 22px', borderRadius: 10, border: 'none', background: saving ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save Permissions'}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#C0321A', flex: 1 }}>
            Delete the role "{role.label}"? Users assigned to it must be reassigned first.
          </span>
          <button onClick={() => setConfirmDelete(false)}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={deleteRole}
            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, Delete</button>
        </div>
      )}

      {/* Permission matrix */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB' }}>
                Screen
              </th>
              {(['can_view', 'can_edit', 'can_delete'] as const).map((cap) => (
                <th key={cap} style={{ padding: '12px 16px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', width: 110 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span>{cap.replace('can_', '')}</span>
                    <button onClick={() => toggleColumn(cap)}
                      style={{ fontSize: 9, fontWeight: 700, padding: '1px 8px', borderRadius: 99, border: '1px solid #EBEBEB', background: C.white, color: C.slate, cursor: 'pointer', fontFamily: 'Figtree' }}>
                      Toggle All
                    </button>
                  </div>
                </th>
              ))}
              <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', width: 90 }}>
                Row
              </th>
            </tr>
          </thead>
          <tbody>
            {departmentScreens.map((k) => {
              const p = perms[k];
              return (
                <tr key={k} style={{ borderBottom: '1px solid #F3F3F3' }}>
                  <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
                    {SCREEN_LABELS[k]}
                    <div style={{ fontSize: 10, color: C.slate, marginTop: 2 }}><code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{k}</code></div>
                  </td>
                  {(['can_view', 'can_edit', 'can_delete'] as const).map((cap) => (
                    <td key={cap} style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <input type="checkbox" checked={p[cap]} onChange={() => togglePerm(k, cap)}
                        style={{ cursor: 'pointer', width: 18, height: 18, accentColor: C.green }} />
                    </td>
                  ))}
                  <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                    <button onClick={() => toggleAllForScreen(k)}
                      style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, border: '1px solid #EBEBEB', background: C.white, color: C.slate, cursor: 'pointer', fontFamily: 'Figtree' }}>
                      All
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ background: C.honeydew, color: C.green, borderRadius: 10, padding: '10px 14px', fontSize: 11, fontWeight: 600 }}>
        Edit / Delete imply View. Turning View off clears the other two.
      </div>

      {editing && (
        <RoleModal title={`Edit ${role.label}`} onClose={() => setEditing(false)}
          initial={{ name: role.name, label: role.label, description: role.description ?? '' }}
          onSave={async (data) => {
            await supabase.from('app_roles').update({ ...data, updated_at: new Date().toISOString() }).eq('id', role.id);
            await onRefresh();
          }} />
      )}
    </div>
  );
}

// ── Role Modal (info edit) ────────────────────────────────────────

interface RoleFormShape {
  name: string;
  label: string;
  description: string;
}

interface RoleModalProps {
  initial: RoleFormShape;
  title: string;
  onSave: (data: RoleFormShape) => Promise<void>;
  onClose: () => void;
}

function RoleModal({ initial, title, onSave, onClose }: RoleModalProps) {
  const [form, setForm] = useState<RoleFormShape>(initial);
  const [saving, setSaving] = useState(false);
  const canSave = form.name.trim() && form.label.trim() && !saving;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 480, maxWidth: 'calc(100vw - 24px)', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>
        <Field label="Display Label">
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Regional Manager" style={inputStyle} />
        </Field>
        <Field label="Internal Name (lowercase, no spaces)">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="regional_manager"
            style={{ ...inputStyle, fontFamily: 'monospace' }} />
        </Field>
        <Field label="Description (optional)">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'Figtree' }} />
        </Field>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button disabled={!canSave}
            onClick={async () => { setSaving(true); await onSave(form); setSaving(false); onClose(); }}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB',
  fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function emptyMatrix(keys: ScreenKey[]): Record<ScreenKey, ScreenCap> {
  const m = {} as Record<ScreenKey, ScreenCap>;
  for (const k of keys) m[k] = { can_view: false, can_edit: false, can_delete: false };
  return m;
}
