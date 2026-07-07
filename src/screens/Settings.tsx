import { useEffect, useMemo, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { Search, ArrowLeft } from 'lucide-react';
import {
  DEPARTMENT_LABELS, PERMISSION_SECTIONS, SCREEN_LABELS, usePermissions,
  type ScreenKey, type ScreenCap, type Department,
} from '../permissions';

// ── Types ─────────────────────────────────────────────────────────

interface AppUser {
  id: string;
  department: Department;
  email: string;
  full_name: string;
  is_active: boolean;
}

type PermissionRow = ScreenCap & { screen_key: ScreenKey };

const SHORT_DEPT: Record<Department, string> = { cpo: 'CPO', sales: 'Sales', tech: 'Tech', pm: 'Registry' };

const ALL_GRANTABLE_KEYS: ScreenKey[] = PERMISSION_SECTIONS.flatMap((s) => s.keys);

// ── Root ──────────────────────────────────────────────────────────

export function ScreenSettings() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [allPerms, setAllPerms] = useState<(PermissionRow & { user_id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    const [{ data: u }, { data: p }] = await Promise.all([
      supabase.from('app_users').select('id, department, email, full_name, is_active').order('full_name'),
      supabase.from('app_user_permissions').select('user_id, screen_key, can_view, can_edit, can_delete'),
    ]);
    setUsers((u as AppUser[]) ?? []);
    setAllPerms((p as (PermissionRow & { user_id: string })[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Scope banner */}
      <div style={{ background: C.honeydew, color: C.green, borderRadius: 12, padding: '12px 18px', fontSize: 12, fontWeight: 600 }}>
        One account per email. Toggle each user's access per screen — across every department — from here.
        New users start with no access until you enable their screens.
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Users" value={String(users.length)} sub="one account per email" accent />
        <KPICard label="Active Users" value={String(users.filter((u) => u.is_active).length)} sub="can sign in" />
        <KPICard label="Access Grants" value={String(allPerms.filter((p) => p.can_view).length)} sub="screens enabled across users" />
      </div>

      <UsersTab users={users} allPerms={allPerms} onRefresh={fetchAll} />
    </div>
  );
}

// ── Users & Access ────────────────────────────────────────────────

interface UsersTabProps {
  users: AppUser[];
  allPerms: (PermissionRow & { user_id: string })[];
  onRefresh: () => Promise<void>;
}

function UsersTab({ users, allPerms, onRefresh }: UsersTabProps) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [permUserId, setPermUserId] = useState<string | null>(null);

  const permUser = users.find((u) => u.id === permUserId) ?? null;

  // Which departments each user can access: ≥1 viewable screen OWNED by that
  // department (shared screens like customers count only for their owning
  // section, so a Sales-only user doesn't read as having Tech access).
  const accessByUser = useMemo(() => {
    const viewable = new Map<string, Set<ScreenKey>>();
    for (const p of allPerms) {
      if (!p.can_view) continue;
      const s = viewable.get(p.user_id) ?? new Set<ScreenKey>();
      s.add(p.screen_key);
      viewable.set(p.user_id, s);
    }
    const m = new Map<string, Department[]>();
    for (const [uid, keys] of viewable) {
      m.set(uid, PERMISSION_SECTIONS.filter((s) => s.keys.some((k) => keys.has(k))).map((s) => s.department));
    }
    return m;
  }, [allPerms]);

  const visible = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.email.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q);
  });

  if (permUser) {
    return (
      <UserPermissionsEditor key={permUser.id} user={permUser}
        onBack={() => setPermUserId(null)} onRefresh={onRefresh} />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        <button onClick={() => setAdding(true)}
          style={{ marginLeft: 'auto', padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Add User
        </button>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['#', 'Name', 'Email', 'Access', 'Status', ''].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((u, i) => {
              const access = accessByUser.get(u.id) ?? [];
              return (
                <tr key={u.id} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  onClick={() => setPermUserId(u.id)}>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate }}>{i + 1}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green }}>{u.full_name}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#1a1a1a' }}>{u.email}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {access.length === 0 ? (
                      <span style={{ fontSize: 11, color: C.slate, fontStyle: 'italic' }}>No access</span>
                    ) : (
                      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                        {access.map((d) => (
                          <span key={d} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: C.seasalt, border: '1px solid #EBEBEB', color: C.slate, letterSpacing: '0.02em' }}>
                            {SHORT_DEPT[d]}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                      background: u.is_active ? '#E4F3E3' : '#F3F3F3',
                      color:      u.is_active ? '#1B512D' : '#767B77' }}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={(e) => { e.stopPropagation(); setPermUserId(u.id); }}
                      style={{ padding: '5px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 6 }}>
                      Permissions
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setEditing(u); }}
                      style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No users match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <UserModal title="New User" isEdit={false}
          initial={{ email: '', full_name: '', is_active: true, password: '1234' }}
          onSave={async (data) => {
            const { data: created, error } = await supabase
              .from('app_users')
              .insert({ email: data.email, full_name: data.full_name, is_active: data.is_active })
              .select('id').single();
            if (error) {
              window.alert(error.code === '23505'
                ? `An account for ${data.email} already exists — every email has exactly one account. Edit that user instead.`
                : `Could not create the user: ${error.message}`);
              return;
            }
            if (created) {
              await supabase.rpc('app_set_password', { p_user_id: created.id, p_password: data.password.trim() || '1234' });
            }
            await onRefresh();
            // A new account has no access yet — jump straight into its matrix.
            if (created) setPermUserId((created as { id: string }).id);
          }}
          onClose={() => setAdding(false)} />
      )}
      {editing && (
        <UserModal key={editing.id} title={`Edit ${editing.full_name}`} isEdit
          initial={{ email: editing.email, full_name: editing.full_name, is_active: editing.is_active, password: '' }}
          onSave={async (data) => {
            await supabase.from('app_users').update({ email: data.email, full_name: data.full_name, is_active: data.is_active, updated_at: new Date().toISOString() }).eq('id', editing.id);
            if (data.password.trim()) await supabase.rpc('app_set_password', { p_user_id: editing.id, p_password: data.password.trim() });
            await onRefresh();
          }}
          onDelete={async () => { await supabase.from('app_users').delete().eq('id', editing.id); await onRefresh(); }}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Per-user permission editor (the "main manager" matrix) ────────

interface UserPermissionsEditorProps {
  user: AppUser;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}

function UserPermissionsEditor({ user, onBack, onRefresh }: UserPermissionsEditorProps) {
  const { refresh: refreshActivePerms } = usePermissions();
  const [perms, setPerms] = useState<Record<ScreenKey, ScreenCap>>(() => emptyMatrix(ALL_GRANTABLE_KEYS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('app_user_permissions')
        .select('screen_key, can_view, can_edit, can_delete')
        .eq('user_id', user.id);
      const matrix = emptyMatrix(ALL_GRANTABLE_KEYS);
      for (const row of (data ?? []) as PermissionRow[]) {
        if (row.screen_key in matrix) {
          matrix[row.screen_key] = { can_view: row.can_view, can_edit: row.can_edit, can_delete: row.can_delete };
        }
      }
      setPerms(matrix);
      setLoading(false);
    })();
  }, [user.id]);

  const totals = useMemo(() => {
    let v = 0, e = 0, d = 0;
    for (const k of ALL_GRANTABLE_KEYS) {
      if (perms[k]?.can_view) v++;
      if (perms[k]?.can_edit) e++;
      if (perms[k]?.can_delete) d++;
    }
    return { v, e, d };
  }, [perms]);

  const togglePerm = (k: ScreenKey, cap: keyof ScreenCap) => {
    setSaved(false);
    setPerms((prev) => {
      const next = { ...prev, [k]: { ...prev[k], [cap]: !prev[k][cap] } };
      if (cap === 'can_view' && !next[k].can_view) {
        next[k] = { can_view: false, can_edit: false, can_delete: false };
      } else if (cap !== 'can_view' && next[k][cap]) {
        next[k].can_view = true;
      }
      return next;
    });
  };

  const toggleAllForScreen = (k: ScreenKey) => {
    setSaved(false);
    setPerms((prev) => {
      const all = prev[k].can_view && prev[k].can_edit && prev[k].can_delete;
      return { ...prev, [k]: { can_view: !all, can_edit: !all, can_delete: !all } };
    });
  };

  const toggleSection = (keys: ScreenKey[]) => {
    setSaved(false);
    setPerms((prev) => {
      const allOn = keys.every((k) => prev[k].can_view && prev[k].can_edit && prev[k].can_delete);
      const next = { ...prev };
      for (const k of keys) next[k] = { can_view: !allOn, can_edit: !allOn, can_delete: !allOn };
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    // Upsert the enabled grants first, then prune the revoked ones — never a
    // window where a failed request has wiped the user's access.
    const granted = ALL_GRANTABLE_KEYS.filter((k) => perms[k].can_view || perms[k].can_edit || perms[k].can_delete);
    const rows = granted.map((k) => ({ user_id: user.id, screen_key: k, ...perms[k] }));
    let failure: string | null = null;
    if (rows.length) {
      const { error } = await supabase.from('app_user_permissions').upsert(rows, { onConflict: 'user_id,screen_key' });
      if (error) failure = error.message;
    }
    if (!failure) {
      const prune = granted.length
        ? supabase.from('app_user_permissions').delete().eq('user_id', user.id)
            .not('screen_key', 'in', `(${granted.map((k) => `"${k}"`).join(',')})`)
        : supabase.from('app_user_permissions').delete().eq('user_id', user.id);
      const { error } = await prune;
      if (error) failure = error.message;
    }
    setSaving(false);
    if (failure) { window.alert(`Could not save access: ${failure}`); return; }
    await refreshActivePerms();
    await onRefresh();
    setSaved(true);
  };

  if (loading) {
    return <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* User header */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <button onClick={onBack}
          style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ArrowLeft size={16} strokeWidth={2.25} />
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.01em' }}>{user.full_name}</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>{user.email}</div>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>
            View: <strong style={{ color: '#1a1a1a' }}>{totals.v}</strong> · Edit: <strong style={{ color: '#1a1a1a' }}>{totals.e}</strong> · Delete: <strong style={{ color: '#1a1a1a' }}>{totals.d}</strong> of {ALL_GRANTABLE_KEYS.length} screens
          </div>
        </div>
        <button onClick={save} disabled={saving}
          style={{ padding: '8px 22px', borderRadius: 10, border: 'none', background: saving ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Access'}
        </button>
      </div>

      {/* Matrix, one section per department */}
      {PERMISSION_SECTIONS.map(({ department, keys }) => (
        <div key={department} style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F3F3', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{DEPARTMENT_LABELS[department]}</div>
            <button onClick={() => toggleSection(keys)}
              style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99, border: '1px solid #EBEBEB', background: C.white, color: C.slate, cursor: 'pointer', fontFamily: 'Figtree', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Toggle All
            </button>
          </div>
          <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB' }}>Screen</th>
                {(['view', 'edit', 'delete'] as const).map((cap) => (
                  <th key={cap} style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', width: 90 }}>{cap}</th>
                ))}
                <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', width: 80 }}>Row</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
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
      ))}

      <div style={{ background: C.honeydew, color: C.green, borderRadius: 10, padding: '10px 14px', fontSize: 11, fontWeight: 600 }}>
        Edit / Delete imply View. Turning View off clears the other two. A user can sign in to a department when at least one of its screens is viewable.
      </div>
    </div>
  );
}

// ── User Modal ────────────────────────────────────────────────────

interface UserFormShape {
  email: string;
  full_name: string;
  is_active: boolean;
  password: string;
}

interface UserModalProps {
  initial: UserFormShape;
  title: string;
  isEdit: boolean;
  onSave: (data: UserFormShape) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function UserModal({ initial, title, isEdit, onSave, onDelete, onClose }: UserModalProps) {
  const [form, setForm] = useState<UserFormShape>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // On create a password is required (defaults to 1234); on edit it's optional (blank = keep current).
  const canSave = !!form.email.trim() && !!form.full_name.trim() && (isEdit || !!form.password.trim()) && !saving;

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
        <Field label={isEdit ? 'Reset Password' : 'Password'}>
          <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={isEdit ? 'Leave blank to keep current' : '1234'}
            style={{ ...inputStyle, fontFamily: 'monospace' }} />
        </Field>
        {!isEdit && (
          <div style={{ fontSize: 11, color: C.slate, marginTop: -10 }}>
            After saving you'll land in the access matrix to enable this user's screens.
          </div>
        )}
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
