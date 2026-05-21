import { useState } from 'react';
import { C } from '../theme';
import { Logo } from '../components/Logo';
import { supabase } from '../lib/supabase';
import { type Department, DEPARTMENT_LABELS, type SignedInUser } from '../permissions';

interface DepartmentCard {
  id: Department;
  label: string;
  icon: string;
}

const DEPARTMENTS: DepartmentCard[] = [
  { id: 'tech',  label: DEPARTMENT_LABELS.tech,  icon: '⚙' },
  { id: 'sales', label: DEPARTMENT_LABELS.sales, icon: '◐' },
  { id: 'cpo',   label: DEPARTMENT_LABELS.cpo,   icon: '⚡' },
  { id: 'pm',    label: DEPARTMENT_LABELS.pm,    icon: '◉' },
];

interface LoginProps {
  onLogin: (user: SignedInUser) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [department, setDepartment] = useState<Department>('cpo');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { data, error: err } = await supabase
      .from('app_users')
      .select('id, email, full_name, department, role_id, password, is_active, app_roles(name, label)')
      .eq('department', department)
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    setBusy(false);

    if (err) { setError(err.message); return; }
    if (!data) { setError(`No account for "${email}" in ${DEPARTMENT_LABELS[department]}.`); return; }
    if (!data.is_active) { setError('This account has been disabled. Contact your department admin.'); return; }
    if (data.password !== password) { setError('Incorrect password.'); return; }

    const role = Array.isArray(data.app_roles) ? data.app_roles[0] : data.app_roles;
    if (!role) { setError('User has no role assigned. Contact your department admin.'); return; }

    onLogin({
      id:        data.id,
      email:     data.email,
      full_name: data.full_name,
      department: data.department as Department,
      role_id:   data.role_id,
      role_name: role.name,
      role_label: role.label,
    });
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.seasalt, padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 560, background: C.white, borderRadius: 20, border: '1px solid #EBEBEB', padding: 36, boxShadow: '0 12px 40px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <Logo height={44} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>Sign in to EVOne</div>
            <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>Select your department, then sign in</div>
          </div>
        </div>

        {/* Department cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {DEPARTMENTS.map((d) => {
            const isActive = department === d.id;
            return (
              <button key={d.id} onClick={() => setDepartment(d.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 16px', borderRadius: 14,
                  border: `2px solid ${isActive ? C.green : '#EBEBEB'}`,
                  background: isActive ? C.honeydew : C.white,
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'Figtree',
                  transition: 'border-color .15s, background .15s',
                }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: isActive ? C.green : '#F3F3F3',
                  color: isActive ? C.white : C.slate,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, fontWeight: 700, flexShrink: 0,
                }}>
                  {d.icon}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: isActive ? C.green : '#1a1a1a' }}>{d.label}</div>
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@evone.com.my"
              style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Password</label>
              <a href="#" onClick={(e) => e.preventDefault()}
                style={{ fontSize: 11, fontWeight: 600, color: C.green, textDecoration: 'none' }}>Forgot?</a>
            </div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {error && (
            <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>
          )}

          <button type="submit" disabled={busy}
            style={{ padding: '13px 24px', borderRadius: 12, border: 'none', background: busy ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', marginTop: 4 }}>
            {busy ? 'Signing in…' : `Sign in to ${DEPARTMENT_LABELS[department]}`}
          </button>
        </form>

        <div style={{ fontSize: 11, color: C.slate, textAlign: 'center', background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '10px 14px', lineHeight: 1.5 }}>
          Contact your department admin for access.
        </div>
      </div>
    </div>
  );
}
