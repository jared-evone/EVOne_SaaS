import { C } from '../theme';

interface NavItemProps {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

export function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        borderRadius: 10,
        border: 'none',
        cursor: 'pointer',
        background: active ? C.honeydew : 'transparent',
        color: active ? C.green : C.slate,
        fontFamily: 'Figtree',
        fontSize: 14,
        fontWeight: active ? 700 : 500,
        width: '100%',
        textAlign: 'left',
        transition: 'background .15s, color .15s',
      }}
    >
      <span style={{ fontSize: 18, width: 20, textAlign: 'center' }}>{icon}</span>
      {label}
      {active && (
        <span
          style={{
            marginLeft: 'auto',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: C.green,
            flexShrink: 0,
          }}
        />
      )}
    </button>
  );
}
