import { useState } from 'react';
import { C } from '../theme';
import { Logo } from '../components/Logo';
import { Power, Users, Database } from 'lucide-react';
import { DEPARTMENT_LABELS, type Department } from '../permissions';
import { ScreenSettings } from './Settings';
import { ScreenDBHealth } from './DBHealth';

const DEPARTMENTS: Department[] = ['cpo', 'sales', 'tech', 'pm'];

// Hidden cross-department console reached via superadmin_login (the 1234 entry).
// Centralizes Users & Permissions (per department) and DB Health for everyone.
export function SuperAdminConsole({ onSignOut }: { onSignOut: () => void }) {
  const [view, setView] = useState<'users' | 'dbhealth'>('users');
  const [dept, setDept] = useState<Department>('cpo');

  const tabBtn = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 18px', borderRadius: 10,
    border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    background: active ? C.green : 'transparent', color: active ? C.white : C.slate,
  });

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: C.seasalt }}>
      {/* Top bar */}
      <div style={{ background: C.white, borderBottom: '1px solid #EBEBEB', padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 10 }}>
        <Logo height={30} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.white, background: C.green, padding: '3px 10px', borderRadius: 99, letterSpacing: '0.04em' }}>SUPERADMIN</span>
        <div style={{ flex: 1 }} />
        <button onClick={onSignOut}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <Power size={14} strokeWidth={2.25} /> Sign out
        </button>
      </div>

      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>Superadmin Console</div>
          <div style={{ fontSize: 13, color: C.slate, marginTop: 2 }}>Manage users, roles &amp; permissions across every department, and database health.</div>
        </div>

        {/* View switch */}
        <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
          <button onClick={() => setView('users')} style={tabBtn(view === 'users')}>
            <Users size={15} strokeWidth={2.25} /> Users &amp; Permissions
          </button>
          <button onClick={() => setView('dbhealth')} style={tabBtn(view === 'dbhealth')}>
            <Database size={15} strokeWidth={2.25} /> DB Health
          </button>
        </div>

        {view === 'users' && (
          <>
            {/* Department selector */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {DEPARTMENTS.map((d) => (
                <button key={d} onClick={() => setDept(d)}
                  style={{
                    padding: '8px 16px', borderRadius: 99, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${dept === d ? C.green : '#EBEBEB'}`,
                    background: dept === d ? C.green : C.white, color: dept === d ? C.white : C.slate,
                  }}>
                  {DEPARTMENT_LABELS[d]}
                </button>
              ))}
            </div>
            <ScreenSettings key={dept} departmentOverride={dept} />
          </>
        )}

        {view === 'dbhealth' && <ScreenDBHealth />}
      </div>
    </div>
  );
}
