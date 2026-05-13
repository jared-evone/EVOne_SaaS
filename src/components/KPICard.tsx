import type { ReactNode } from 'react';
import { C } from '../theme';

interface KPICardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  trend?: ReactNode;
  trendUp?: boolean;
  chart?: ReactNode;
  accent?: boolean;
}

export function KPICard({ label, value, sub, trend, trendUp, chart, accent = false }: KPICardProps) {
  return (
    <div
      style={{
        background: accent ? C.green : C.white,
        borderRadius: 16,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        border: `1px solid ${accent ? C.green : '#EBEBEB'}`,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: accent ? 'rgba(255,255,255,0.7)' : C.slate,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: accent ? C.white : C.green,
          letterSpacing: '-0.04em',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: accent ? 'rgba(255,255,255,0.75)' : C.slate }}>{sub}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        {trend && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: trendUp ? (accent ? C.white : '#22a14b') : '#e05252',
              background: trendUp ? (accent ? 'rgba(255,255,255,0.18)' : '#E4F3E3') : '#fdeaea',
              padding: '2px 8px',
              borderRadius: 99,
            }}
          >
            {trendUp ? '↑' : '↓'} {trend}
          </span>
        )}
        {chart && <div style={{ opacity: 0.8 }}>{chart}</div>}
      </div>
    </div>
  );
}
