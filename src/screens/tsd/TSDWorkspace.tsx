import { useState } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import { TechApp } from './TechApp';
import { TSDAdminApp } from './TSDAdminApp';

export type SubRole = 'tech' | 'admin';

interface TSDWorkspaceProps {
  onSignOut: () => void;
}

const SUB_ROLES: { id: SubRole; label: string; icon: string; description: string }[] = [
  { id: 'tech',  label: 'Technician',  icon: '🛠',  description: 'Pick up work orders, execute jobs, fill the on-site report' },
  { id: 'admin', label: 'Super Admin', icon: '⊞',  description: 'Manage work orders, customers, form templates, and PIC review' },
];

export function TSDWorkspace({ onSignOut }: TSDWorkspaceProps) {
  const [active, setActive] = useState<SubRole | null>(null);

  const back = () => setActive(null);

  if (active === 'tech')  return <TechApp     onBack={back} onSignOut={onSignOut} />;
  if (active === 'admin') return <TSDAdminApp onBack={back} onSignOut={onSignOut} />;

  // Sub-role selector
  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: C.seasalt,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top bar */}
      <header
        style={{
          height: 60,
          flexShrink: 0,
          background: C.white,
          borderBottom: '1px solid #EBEBEB',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 14,
        }}
      >
        <Logo height={28} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: 99,
            background: C.honeydew,
            color: C.green,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Technical Service Dept.
        </span>
        <button
          onClick={onSignOut}
          style={{
            marginLeft: 'auto',
            padding: '7px 14px',
            borderRadius: 8,
            border: '1px solid #EBEBEB',
            background: 'transparent',
            color: C.slate,
            fontFamily: 'Figtree',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ⏻ Sign out
        </button>
      </header>

      {/* Body */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
        }}
      >
        <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: C.green,
                letterSpacing: '-0.02em',
              }}
            >
              TSD Workspace
            </div>
            <div style={{ fontSize: 13, color: C.slate, marginTop: 6 }}>
              Choose how you want to use the system today
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {SUB_ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => setActive(r.id)}
                style={{
                  background: C.white,
                  border: '1px solid #EBEBEB',
                  borderRadius: 16,
                  padding: '28px 22px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'Figtree',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  transition: 'box-shadow .15s, border-color .15s, transform .15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = C.green;
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.06)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#EBEBEB';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: C.honeydew,
                    color: C.green,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                  }}
                >
                  {r.icon}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.green, marginBottom: 4 }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>{r.description}</div>
                </div>
                <div
                  style={{
                    marginTop: 'auto',
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.green,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  Enter →
                </div>
              </button>
            ))}
          </div>

          <div
            style={{
              fontSize: 11,
              color: C.slate,
              textAlign: 'center',
              background: C.white,
              border: '1px dashed #EBEBEB',
              borderRadius: 12,
              padding: '12px 16px',
              lineHeight: 1.6,
            }}
          >
            Sub-roles share the same backing data — what a technician submits, the PIC sees instantly.
            <br />
            Switch back from any view via the “TSD Workspace” button.
          </div>
        </div>
      </div>
    </div>
  );
}
