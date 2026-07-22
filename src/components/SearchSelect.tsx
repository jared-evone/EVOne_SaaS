import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { Search, ChevronDown } from 'lucide-react';

export interface SelectOption { value: string; label: string; sub?: string }

// Brand-styled dropdown with a search box — for lists too long for a native
// <select> (customers, sites, chargers). Closes on outside click; the search
// filters on label + sub.
export function SearchSelect({ value, options, onChange, disabled, placeholder, emptyText, loading, up }: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyText?: string;
  loading?: boolean;
  /** Open upwards — for controls near the bottom of a modal. */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? options.filter((o) => o.label.toLowerCase().includes(ql) || (o.sub ?? '').toLowerCase().includes(ql))
    : options;

  const control: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 10,
    border: `1px solid ${open ? C.green : '#EBEBEB'}`,
    fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box',
    background: disabled ? C.seasalt : C.white,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    cursor: disabled ? 'default' : 'pointer', textAlign: 'left',
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled} onClick={() => { setOpen((o) => !o); setQ(''); }} style={control}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? '#1a1a1a' : C.slate }}>
          {loading ? 'Loading…' : selected?.label ?? placeholder ?? 'Select…'}
        </span>
        <ChevronDown size={16} strokeWidth={2.25} style={{ color: C.slate, flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && !disabled && (
        <div style={{
          position: 'absolute', left: 0, right: 0, zIndex: 60,
          top: up ? undefined : 'calc(100% + 6px)', bottom: up ? 'calc(100% + 6px)' : undefined,
          background: C.white, border: '1px solid #EBEBEB', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,.14)', padding: 6, display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ position: 'relative' }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              style={{ width: '100%', padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.seasalt, boxSizing: 'border-box' }} />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={13} /></span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px', textAlign: 'center', color: C.slate, fontSize: 12 }}>{emptyText ?? 'No matches'}</div>
            ) : filtered.map((o) => {
              const active = o.value === value;
              return (
                <button key={o.value || '__none'} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.seasalt; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  style={{ flexShrink: 0, width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: active ? C.honeydew : 'transparent', color: active ? C.green : '#1a1a1a', fontFamily: 'Figtree', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer', overflow: 'hidden' }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</div>
                  {o.sub && <div style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{o.sub}</div>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
