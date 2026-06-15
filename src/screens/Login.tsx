import { useState } from 'react';
import { C } from '../theme';
import { Logo } from '../components/Logo';
import { supabase, setAppToken } from '../lib/supabase';
import { type Department, DEPARTMENT_LABELS, type SignedInUser } from '../permissions';
import { Wrench, Handshake, Zap, FolderKanban, type LucideIcon } from 'lucide-react';

interface DepartmentCard {
  id: Department;
  label: string;
  icon: LucideIcon;
}

const DEPARTMENTS: DepartmentCard[] = [
  { id: 'tech',  label: DEPARTMENT_LABELS.tech,  icon: Wrench },
  { id: 'sales', label: DEPARTMENT_LABELS.sales, icon: Handshake },
  { id: 'cpo',   label: DEPARTMENT_LABELS.cpo,   icon: Zap },
  { id: 'pm',    label: DEPARTMENT_LABELS.pm,    icon: FolderKanban },
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

    // Verification happens server-side (passwords are bcrypt-hashed and never sent
    // to the browser). The RPC returns the safe user fields only on a correct match.
    const { data, error: err } = await supabase.rpc('app_login', {
      p_department: department,
      p_email: email.trim().toLowerCase(),
      p_password: password,
    });

    setBusy(false);

    if (err) { setError(err.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) { setError('Incorrect email or password.'); return; }

    // Attach the signed token (if the server has a JWT secret configured) so all
    // subsequent requests are authenticated rather than anonymous.
    setAppToken(row.token ?? null);

    onLogin({
      id:        row.id,
      email:     row.email,
      full_name: row.full_name,
      department: row.department as Department,
      role_id:   row.role_id,
      role_name: row.role_name,
      role_label: row.role_label,
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          {DEPARTMENTS.map((d) => {
            const isActive = department === d.id;
            const Icon = d.icon;
            return (
              <button key={d.id} onClick={() => setDepartment(d.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, minWidth: 0,
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
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
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
            style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: busy ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', marginTop: 4 }}>
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
