import { useState } from 'react';
import { C } from '../theme';
import { Logo } from '../components/Logo';

export type Role = 'tech' | 'sales' | 'cpo' | 'super_admin';

export const ROLE_LABELS: Record<Role, string> = {
  tech:        'Technical Service',
  sales:       'Sales',
  cpo:         'CPO',
  super_admin: 'Super Admin',
};

interface RoleOption {
  id: Role;
  label: string;
  icon: string;
  description: string;
}

const ROLES: RoleOption[] = [
  { id: 'tech',        label: 'Technical Service', icon: '⚙', description: 'Installations, maintenance, technician dispatch' },
  { id: 'sales',       label: 'Sales',             icon: '◐', description: 'Quotations, proposals, customer pipeline' },
  { id: 'cpo',         label: 'CPO',               icon: '⚡', description: 'Charge point operations & energy oversight' },
  { id: 'super_admin', label: 'Super Admin',       icon: '⊞', description: 'Full system access across all modules' },
];

interface LoginProps {
  onLogin: (role: Role) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [role, setRole] = useState<Role>('super_admin');
  const [email, setEmail] = useState('admin@evone.com.my');
  const [password, setPassword] = useState('');

  const submit = () => onLogin(role);

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: C.seasalt,
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          background: C.white,
          borderRadius: 20,
          border: '1px solid #EBEBEB',
          padding: 36,
          boxShadow: '0 12px 40px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* Logo + heading */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <Logo height={44} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>
              Sign in to EVOne
            </div>
            <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>
              Select your role to continue
            </div>
          </div>
        </div>

        {/* Role cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {ROLES.map((r) => {
            const isActive = role === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 14,
                  border: `2px solid ${isActive ? C.green : '#EBEBEB'}`,
                  background: isActive ? C.honeydew : C.white,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'Figtree',
                  transition: 'border-color .15s, background .15s',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: isActive ? C.green : '#F3F3F3',
                    color: isActive ? C.white : C.slate,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {r.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: isActive ? C.green : '#1a1a1a' }}>
                    {r.label}
                  </div>
                  <div style={{ fontSize: 11, color: C.slate, marginTop: 2, lineHeight: 1.4 }}>
                    {r.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <label
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: C.slate,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'block',
                marginBottom: 6,
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@evone.com.my"
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 10,
                border: '1px solid #EBEBEB',
                fontFamily: 'Figtree',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.slate,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Password
              </label>
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                style={{ fontSize: 11, fontWeight: 600, color: C.green, textDecoration: 'none' }}
              >
                Forgot?
              </a>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 10,
                border: '1px solid #EBEBEB',
                fontFamily: 'Figtree',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              padding: '13px 24px',
              borderRadius: 12,
              border: 'none',
              background: C.green,
              color: C.white,
              fontFamily: 'Figtree',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              marginTop: 4,
            }}
          >
            Sign in as {ROLE_LABELS[role]}
          </button>
        </form>

        <div
          style={{
            fontSize: 11,
            color: C.slate,
            textAlign: 'center',
            background: C.seasalt,
            border: '1px dashed #EBEBEB',
            borderRadius: 10,
            padding: '10px 14px',
            lineHeight: 1.5,
          }}
        >
          All roles currently route to the Super Admin dashboard.
          <br />
          Role-specific views will be built out next.
        </div>
      </div>
    </div>
  );
}
