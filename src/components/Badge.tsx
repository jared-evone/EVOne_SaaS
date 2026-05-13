import { C } from '../theme';

const map: Record<string, { bg: string; color: string }> = {
  Completed:     { bg: '#E4F3E3', color: C.green },
  Pending:       { bg: '#FFF8E1', color: '#B07D00' },
  'In Progress': { bg: '#E3F0FF', color: '#1A62C0' },
  Cancelled:     { bg: '#FDEAEA', color: '#C0321A' },
  Active:        { bg: '#E4F3E3', color: C.green },
  Inactive:      { bg: '#F3F3F3', color: C.slate },
  Overdue:       { bg: '#FDEAEA', color: '#C0321A' },
};

export function Badge({ status }: { status: string }) {
  const s = map[status] ?? { bg: '#F3F3F3', color: C.slate };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 10px',
        borderRadius: 99,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}
