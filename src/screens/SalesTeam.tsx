import { useEffect, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { AvatarCropper } from '../components/AvatarCropper';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { UserCog, Plus } from 'lucide-react';
import { fmtMoney } from './Sales';

interface SalesPerson {
  id: string;
  name: string;
  email: string | null;
  is_active: boolean;
  user_id: string | null;
  target_amount: number;
  photo_path: string | null;
}

function photoUrl(path: string): string {
  return supabase.storage.from('sales-photos').getPublicUrl(path).data.publicUrl;
}

function Avatar({ path, name, size = 30 }: { path: string | null; name: string; size?: number }) {
  if (path) {
    return <img src={photoUrl(path)} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '1px solid #EBEBEB', flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: C.honeydew, color: C.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.42, flexShrink: 0 }}>
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </div>
  );
}

interface LoginUser {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
}

export function ScreenSalesTeam() {
  const { can } = usePermissions();
  const canEdit = can('sales_team', 'can_edit');
  const canDelete = can('sales_team', 'can_delete');

  const [people, setPeople] = useState<SalesPerson[]>([]);
  const [logins, setLogins] = useState<LoginUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'new' } | { mode: 'edit'; person: SalesPerson } | null>(null);

  const fetchAll = async () => {
    const [p, u] = await Promise.all([
      supabase.from('sales_people').select('id, name, email, is_active, user_id, target_amount, photo_path').order('name'),
      // One account per email now — a salesperson's login may have any home department.
      supabase.from('app_users').select('id, full_name, email, is_active').order('full_name'),
    ]);
    const err = p.error ?? u.error;
    if (err) { setError(err.message); setLoading(false); return; }
    setPeople((p.data ?? []) as SalesPerson[]);
    setLogins((u.data ?? []) as LoginUser[]);
    setLoading(false);
  };

  useEffect(() => { void fetchAll(); }, []);

  const activeCount = people.filter((p) => p.is_active).length;
  const totalTarget = people.reduce((s, p) => s + Number(p.target_amount), 0);
  const loginName = (id: string | null) => (id ? logins.find((u) => u.id === id)?.full_name ?? '—' : null);

  const th: React.CSSProperties = {
    padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate,
    letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB',
  };

  if (loading) {
    return <div style={{ padding: '60px 20px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading sales team…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard accent label="Salespeople" value={String(people.length)} sub={`${activeCount} active`} />
        <KPICard label="Combined Target" value={fmtMoney(totalTarget)} sub="Team sales goal" />
        <KPICard label="Linked Logins" value={String(people.filter((p) => p.user_id).length)} sub="Have platform access" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: C.slate }}>Manage your salespeople, set their sales target (KPI), and link them to a platform login.</div>
        {canEdit && (
          <button onClick={() => setModal({ mode: 'new' })}
            style={{ marginLeft: 'auto', padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Add Salesperson
          </button>
        )}
      </div>

      {people.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px dashed #EBEBEB', padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'inline-flex' }}><UserCog size={32} strokeWidth={1.5} color={C.slate} /></div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>No salespeople yet</div>
          <div style={{ fontSize: 12, color: C.slate }}>Add your first salesperson to start building the pipeline.</div>
        </div>
      ) : (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Salesperson', 'Email', 'Sales Target', 'Platform Login', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} onClick={() => canEdit && setModal({ mode: 'edit', person: p })} style={{ borderBottom: '1px solid #F3F3F3', cursor: canEdit ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => { if (canEdit) e.currentTarget.style.background = '#FAFAFA'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <td style={{ padding: '13px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar path={p.photo_path} name={p.name} />
                      <span style={{ fontWeight: 700 }}>{p.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '13px 16px', color: C.slate }}>{p.email || '—'}</td>
                  <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>{Number(p.target_amount) > 0 ? fmtMoney(Number(p.target_amount)) : '—'}</td>
                  <td style={{ padding: '13px 16px', color: p.user_id ? '#1a1a1a' : C.slate }}>
                    {p.user_id ? loginName(p.user_id) : <span style={{ fontSize: 12 }}>Not linked</span>}
                  </td>
                  <td style={{ padding: '13px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: p.is_active ? '#E4F3E3' : '#F3F3F3', color: p.is_active ? '#1B512D' : '#767B77' }}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', color: C.slate, fontSize: 12 }}>{canEdit ? 'Edit' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <SalesPersonModal
          person={modal.mode === 'edit' ? modal.person : null}
          logins={logins}
          takenLoginIds={new Set(people.filter((p) => p.user_id).map((p) => p.user_id as string))}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); void fetchAll(); }}
        />
      )}
    </div>
  );
}

function SalesPersonModal({ person, logins, takenLoginIds, canEdit, canDelete, onClose, onSaved }: {
  person: SalesPerson | null;
  logins: LoginUser[];
  takenLoginIds: Set<string>;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = person === null;
  const readOnly = !canEdit;
  const [form, setForm] = useState(() => ({
    name: person?.name ?? '',
    email: person?.email ?? '',
    target_amount: person?.target_amount ?? 0,
    user_id: person?.user_id ?? '',
    is_active: person?.is_active ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(person?.photo_path ?? null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(person?.photo_path ? photoUrl(person.photo_path) : null);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    setError(null);
    setCropFile(f);
  };

  // Logins available to link: not already taken by another salesperson.
  const availableLogins = logins.filter((u) => u.id === person?.user_id || !takenLoginIds.has(u.id));

  const canSave = !!form.name.trim() && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    let path = photoPath;
    if (photoFile) {
      const safe = photoFile.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const p = `sp_${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage.from('sales-photos').upload(p, photoFile, { upsert: true, contentType: photoFile.type });
      if (upErr) { setError(`Photo upload failed: ${upErr.message}`); setSaving(false); return; }
      path = p;
    }
    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      target_amount: Math.max(0, Number(form.target_amount) || 0),
      user_id: form.user_id || null,
      is_active: form.is_active,
      photo_path: path,
    };
    const { error: err } = isNew
      ? await supabase.from('sales_people').insert(payload)
      : await supabase.from('sales_people').update(payload).eq('id', person.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  const handleDelete = async () => {
    if (!person) return;
    setSaving(true);
    const { error: err } = await supabase.from('sales_people').delete().eq('id', person.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const input: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: readOnly ? '#F9F9F9' : C.white, boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, width: 480, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{isNew ? 'Add Salesperson' : person.name}</div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F3F3', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: C.slate }}>×</button>
        </div>

        {error && (
          <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>
        )}

        {/* Profile picture */}
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
              : <Avatar path={null} name={form.name || '?'} size={64} />}
            {!readOnly && (
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
            )}
          </div>
        )}

        <div>
          <label style={label}>Name</label>
          <input value={form.name} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" style={input} />
        </div>
        <div>
          <label style={label}>Email</label>
          <input value={form.email} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="email@evone.com" style={input} />
        </div>
        <div>
          <label style={label}>Sales Target / KPI ($)</label>
          <input type="number" min={0} step="0.01" value={form.target_amount} disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, target_amount: Number(e.target.value) }))} placeholder="0.00" style={input} />
          <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>Won-value goal — tracked against actuals in the Sales Dashboard.</div>
        </div>
        <div>
          <label style={label}>Platform Login</label>
          <select value={form.user_id} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))} style={{ ...input, fontFamily: 'Figtree' }}>
            <option value="">— Not linked —</option>
            {availableLogins.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name} ({u.email}){u.is_active ? '' : ' · disabled'}</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>When linked, that user sees only this salesperson's pipeline on sign-in.</div>
        </div>
        {!readOnly && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1a1a1a', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} style={{ width: 16, height: 16, accentColor: C.green }} />
            Active (selectable on quotes)
          </label>
        )}

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#C0321A', flex: 1, minWidth: 160 }}>Remove {person?.name}? Their existing quotes keep their name.</span>
            <button onClick={() => setConfirmDelete(false)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleDelete} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, Remove</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
          {!isNew && canDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ marginRight: 'auto', padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Remove
            </button>
          )}
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button onClick={handleSave} disabled={!canSave}
              style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#A5D6A7', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {!isNew ? null : <Plus size={14} strokeWidth={2.5} />}
              {saving ? 'Saving…' : isNew ? 'Add' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
