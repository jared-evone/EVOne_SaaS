import { C } from '../theme';
import type { LucideIcon } from 'lucide-react';

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  /** Active-state background — override when the item sits on a tinted surface
   *  (e.g. the honeydew Global chip) where the default honeydew would vanish. */
  activeBackground?: string;
}

export function NavItem({ icon: Icon, label, active, onClick, activeBackground }: NavItemProps) {
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
        background: active ? (activeBackground ?? C.honeydew) : 'transparent',
        color: active ? C.green : C.slate,
        fontFamily: 'Figtree',
        fontSize: 14,
        fontWeight: active ? 700 : 500,
        width: '100%',
        textAlign: 'left',
        transition: 'background .15s, color .15s',
      }}
    >
      <Icon size={18} strokeWidth={active ? 2.25 : 2} style={{ flexShrink: 0 }} />
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
