import { useEffect, useMemo, useState } from 'react';
import { C } from '../../theme';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../permissions';
import { useWorkOrderStore, assigneesOf } from '../../workOrderStore';
import { AvatarCropper } from '../../components/AvatarCropper';
import { Search, UserPlus } from 'lucide-react';

interface Technician {
  id: string;
  name: string;
  fin_number: string | null;
  contact_number: string | null;
  photo_path: string | null;
  email: string | null;
  app_user_id: string | null;
  app_users?: { email: string } | null;
  is_active?: boolean;
  created_at: string;
}

// A missing column (pre-migration) reads as active — only an explicit false deactivates.
const isTechActive = (t: Technician) => t.is_active !== false;

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Accounts are one-per-email and span departments now. Only remove a login when
// it has no viewable screens outside the Technical Service set — otherwise the
// person keeps signing in for their other departments and we just unlink here.
async function removeLoginIfTechOnly(appUserId: string): Promise<void> {
  const { data } = await supabase
    .from('app_user_permissions')
    .select('department, can_view')
    .eq('user_id', appUserId);
  // Grants are per-department now: "used elsewhere" = a viewable grant in any
  // department other than Technical Service.
  const usedElsewhere = ((data ?? []) as { department: string; can_view: boolean }[])
    .some((g) => g.can_view && g.department !== 'tech');
  if (!usedElsewhere) await supabase.from('app_users').delete().eq('id', appUserId);
}

function photoUrl(path: string): string {
  return supabase.storage.from('technician-photos').getPublicUrl(path).data.publicUrl;
}

async function uploadPhoto(file: File): Promise<string> {
  const safe = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
  const path = `${Date.now()}_${safe}`;
  const { error } = await supabase.storage.from('technician-photos').upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  return path;
}

function Avatar({ path, name, size = 38 }: { path: string | null; name: string; size?: number }) {
  if (path) {
    return <img src={photoUrl(path)} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '1px solid #EBEBEB', flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: C.honeydew, color: C.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.42, flexShrink: 0 }}>
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </div>
  );
}

export function TechniciansAdmin() {
  const { can } = usePermissions();
  const canEdit = can('tsd_technicians', 'can_edit');
  const canDelete = can('tsd_technicians', 'can_delete');
  const store = useWorkOrderStore();

  const [techs, setTechs] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'new' | Technician | null>(null);

  const load = async () => {
    const { data, error: err } = await supabase
      .from('technicians')
      .select('*, app_users(email)')
      .order('name');
    if (err) setError(err.message);
    setTechs((data as Technician[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const jobsByTech = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of store.workOrders) {
      if (w.status === 'completed') continue;
      for (const a of assigneesOf(w)) m.set(a, (m.get(a) ?? 0) + 1);
    }
    return m;
  }, [store.workOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return techs;
    return techs.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.fin_number ?? '').toLowerCase().includes(q) ||
      (t.contact_number ?? '').toLowerCase().includes(q));
  }, [techs, search]);

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    const tech = techs.find((t) => t.id === id);
    if (tech?.app_user_id) await removeLoginIfTechOnly(tech.app_user_id);
    const { error: err } = await supabase.from('technicians').delete().eq('id', id);
    if (err) setError(err.message);
    else { setConfirmDeleteId(null); await load(); }
    setBusy(false);
  };

  // Deactivate (fired / on leave) or reactivate. Keeps the record & all history;
  // also flips the linked login so a deactivated tech can't sign in.
  const setActive = async (t: Technician, active: boolean) => {
    setBusy(true);
    setError(null);
    const { error: e1 } = await supabase.from('technicians').update({ is_active: active }).eq('id', t.id);
    let e2: { message: string } | null = null;
    if (t.app_user_id) {
      const { error } = await supabase.from('app_users').update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', t.app_user_id);
      e2 = error;
    }
    if (e1 || e2) setError((e1 ?? e2)!.message);
    else await load();
    setBusy(false);
  };

  const th: React.CSSProperties = {
    padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate,
    letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, borderBottom: '1px solid #F3F3F3' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search technicians…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        <span style={{ fontSize: 12, color: C.slate }}>{techs.length} technician{techs.length === 1 ? '' : 's'}</span>
        {canEdit && (
          <button onClick={() => setModal('new')}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            <UserPlus size={14} strokeWidth={2.25} /> Add Technician
          </button>
        )}
      </div>

      {/* List */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 770, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              <th style={th}>Technician</th>
              <th style={th}>Login / Role</th>
              <th style={th}>FIN Number</th>
              <th style={th}>Contact</th>
              <th style={th}>Active Jobs</th>
              <th style={th}>Status</th>
              <th style={th}>Added</th>
              <th style={{ ...th, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: C.slate, padding: '40px 16px' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: C.slate, padding: '40px 16px' }}>
                {techs.length === 0 ? 'No technicians yet. Add one above.' : 'No matches.'}
              </td></tr>
            ) : (
              filtered.map((t) => {
                const active = isTechActive(t);
                return (
                <tr key={t.id}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <td style={{ ...td, opacity: active ? 1 : 0.55 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Avatar path={t.photo_path} name={t.name} />
                      <span style={{ fontWeight: 700, color: C.green }}>{t.name}</span>
                    </div>
                  </td>
                  <td style={td}>
                    {t.app_users?.email ? (
                      <span style={{ color: '#1a1a1a', fontFamily: 'monospace', fontSize: 12 }}>{t.app_users.email}</span>
                    ) : (
                      <span style={{ color: C.slate, fontStyle: 'italic', fontSize: 12 }}>No login</span>
                    )}
                  </td>
                  <td style={{ ...td, color: t.fin_number ? '#1a1a1a' : C.slate, fontFamily: t.fin_number ? 'monospace' : 'Figtree', opacity: active ? 1 : 0.55 }}>{t.fin_number || '—'}</td>
                  <td style={{ ...td, color: t.contact_number ? '#1a1a1a' : C.slate, opacity: active ? 1 : 0.55 }}>{t.contact_number || '—'}</td>
                  <td style={{ ...td, color: '#1a1a1a', opacity: active ? 1 : 0.55 }}>{jobsByTech.get(t.name) ?? 0}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                      background: active ? '#E4F3E3' : '#F3F3F3', color: active ? '#1B512D' : '#767B77' }}>
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ ...td, color: C.slate, whiteSpace: 'nowrap', opacity: active ? 1 : 0.55 }}>{fmtDate(t.created_at)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {confirmDeleteId === t.id ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => setConfirmDeleteId(null)}
                          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={() => remove(t.id)} disabled={busy}
                          style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>Confirm</button>
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        {canEdit && (
                          <button onClick={() => setModal(t)}
                            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                            Edit
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => setActive(t, !active)} disabled={busy}
                            title={active ? 'Deactivate — keeps the record but blocks sign-in and new jobs' : 'Reactivate this technician'}
                            style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${active ? '#EBEBEB' : C.green}`, background: active ? C.white : C.honeydew, color: active ? C.slate : C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
                            {active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => setConfirmDeleteId(t.id)}
                            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            Remove
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <TechnicianModal
          initial={modal === 'new' ? null : modal}
          existingNames={techs.filter((t) => modal === 'new' || t.id !== modal.id).map((t) => t.name.toLowerCase())}
          onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); await load(); }}
        />
      )}
    </div>
  );
}

// ── Add / Edit modal ──────────────────────────────────────────────

interface TechnicianModalProps {
  initial: Technician | null;
  existingNames: string[];
  onClose: () => void;
  onSaved: () => void;
}

function TechnicianModal({ initial, existingNames, onClose, onSaved }: TechnicianModalProps) {
  const isNew = !initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [fin, setFin] = useState(initial?.fin_number ?? '');
  const [contact, setContact] = useState(initial?.contact_number ?? '');
  const [photoPath, setPhotoPath] = useState<string | null>(initial?.photo_path ?? null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(initial?.photo_path ? photoUrl(initial.photo_path) : null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Login (an app_users account; access is granted per user, seeded with the
  // Technician screen — the superadmin console can extend it later).
  const [loginEmail, setLoginEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!initial?.app_user_id) return;
    // Passwords are hashed server-side and not readable — prefill the email only.
    supabase.from('app_users').select('email').eq('id', initial.app_user_id).maybeSingle()
      .then(({ data }) => {
        const u = data as { email: string } | null;
        if (u) setLoginEmail(u.email);
      });
  }, [initial?.app_user_id]);

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCropFile(file);
  };

  const handleSave = async () => {
    const n = name.trim();
    if (!n) { setErr('Name is required.'); return; }
    if (existingNames.includes(n.toLowerCase())) { setErr('A technician with that name already exists.'); return; }
    const wantsLogin = !!loginEmail.trim();
    const editingLogin = !!initial?.app_user_id;
    // Password required only when creating a new login; on an existing one, blank keeps the current password.
    if (wantsLogin && !editingLogin && !password.trim()) { setErr('A new login needs an email and a password.'); return; }
    setSaving(true);
    setErr(null);
    try {
      let path = photoPath;
      if (photoFile) path = await uploadPhoto(photoFile);

      // Provision / update / remove the linked login account. Passwords are set via the
      // server-side app_set_password RPC (never written to the password column from the client).
      let appUserId = initial?.app_user_id ?? null;
      if (wantsLogin) {
        const userPayload = {
          department: 'tech', email: loginEmail.trim().toLowerCase(), full_name: n, is_active: true,
        };
        if (appUserId) {
          const { error } = await supabase.from('app_users').update({ ...userPayload, updated_at: new Date().toISOString() }).eq('id', appUserId);
          if (error) throw error;
        } else {
          // Emails are globally unique — if this person already has an account
          // (possibly from another department), link it instead of inserting.
          const { data: existing } = await supabase.from('app_users')
            .select('id').eq('email', userPayload.email).maybeSingle();
          if (existing) {
            appUserId = (existing as { id: string }).id;
            const { error } = await supabase.from('app_users').update({ is_active: true, updated_at: new Date().toISOString() }).eq('id', appUserId);
            if (error) throw error;
          } else {
            const { data: created, error } = await supabase.from('app_users').insert(userPayload).select('id').single();
            if (error) throw error;
            appUserId = (created as { id: string }).id;
          }
        }
        // Access is per-user (app_user_permissions). Make sure the account can at
        // least open the Technician app; anything more is granted in the
        // superadmin console. Never removes access the person already has.
        const { data: grants } = await supabase.from('app_user_permissions')
          .select('screen_key').eq('user_id', appUserId).eq('department', 'tech').eq('screen_key', 'tsd_technician');
        if (!(grants ?? []).length) {
          const { error: permErr } = await supabase.from('app_user_permissions')
            .insert({ user_id: appUserId, department: 'tech', screen_key: 'tsd_technician', can_view: true, can_edit: false, can_delete: false });
          if (permErr) throw permErr;
        }
        if (password.trim()) {
          const { error: pwErr } = await supabase.rpc('app_set_password', { p_user_id: appUserId, p_password: password.trim() });
          if (pwErr) throw pwErr;
        }
      } else if (appUserId) {
        await removeLoginIfTechOnly(appUserId);
        appUserId = null;
      }

      const payload = {
        name: n,
        fin_number: fin.trim() || null,
        contact_number: contact.trim() || null,
        photo_path: path,
        email: wantsLogin ? loginEmail.trim().toLowerCase() : null,
        app_user_id: appUserId,
      };
      const { error } = isNew
        ? await supabase.from('technicians').insert(payload)
        : await supabase.from('technicians').update(payload).eq('id', initial!.id);
      if (error) throw error;
      onSaved();
    } catch (e) {
      setErr((e as Error).message ?? 'Save failed.');
      setSaving(false);
    }
  };

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const field: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 480, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{isNew ? 'Add Technician' : 'Edit Technician'}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {/* Photo */}
        {cropFile ? (
          <AvatarCropper
            file={cropFile}
            onCancel={() => setCropFile(null)}
            onApply={(f, p) => { setPhotoFile(f); setPreview(p); setCropFile(null); }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {preview
              ? <img src={preview} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid #EBEBEB' }} />
              : <Avatar path={null} name={name || '?'} size={64} />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'inline-block', padding: '8px 16px', borderRadius: 10, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {preview ? 'Change photo' : 'Upload photo'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickPhoto} />
              </label>
              {preview && (
                <button onClick={() => { setPreview(null); setPhotoFile(null); setPhotoPath(null); }}
                  style={{ padding: 0, border: 'none', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline' }}>
                  Remove photo
                </button>
              )}
            </div>
          </div>
        )}

        <div>
          <label style={label}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ahmad K." style={field} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={label}>FIN Number</label>
            <input value={fin} onChange={(e) => setFin(e.target.value)} placeholder="e.g. G1234567X" style={field} />
          </div>
          <div>
            <label style={label}>Contact Number</label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="e.g. +65 8123 4567" style={field} />
          </div>
        </div>

        {/* Login */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Login</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>
              Optional. Give this technician a login — they sign in under <strong>Technical Service</strong> with this email & password and get the Technician app. Any further access is granted by the superadmin. Leave the email blank for no login.
            </div>
          </div>
          <div>
            <label style={label}>Login Email</label>
            <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="tech@evone.com.sg" style={{ ...field, background: C.white }} />
          </div>
          <div>
            <label style={label}>{initial?.app_user_id ? 'Reset Password' : 'Password'}</label>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={initial?.app_user_id ? 'Leave blank to keep current' : 'set a password'} style={{ ...field, background: C.white }} />
          </div>
        </div>

        {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: saving || !name.trim() ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving || !name.trim() ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : isNew ? 'Add Technician' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
