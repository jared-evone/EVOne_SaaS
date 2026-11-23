import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { Search, ChevronDown } from 'lucide-react';

export interface SelectOption { value: string; label: string; sub?: string }

// Brand-styled dropdown with a search box — for lists too long for a native
// <select> (customers, sites, chargers). Closes on outside click; the search
// filters on label + sub.
export function SearchSelect({ value, options, onChange, disabled, placeholder, emptyText, loading, up, addNewLabel, onAddNew }: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyText?: string;
  loading?: boolean;
  /** Prefer opening upwards — for controls near the bottom of a modal. */
  up?: boolean;
  /** When set, a sticky "+ addNewLabel" row appears under the options; clicking
   *  it closes the dropdown and hands over the typed query as a prefill. */
  addNewLabel?: string;
  onAddNew?: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  // The menu is position:FIXED at the control's place on screen (as FilterSelect
  // does), so it overlays the page: a modal's scroll area can't cut it off. It
  // opens on the side with room, caps its list to that room, and follows the
  // control when something scrolls or the window resizes.
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; listMax: number } | null>(null);
  const hasAdd = !!(onAddNew && addNewLabel);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const chrome = 64 + (hasAdd ? 46 : 0); // search box, padding, the add-new row
      const below = window.innerHeight - r.bottom - chrome - 10;
      const above = r.top - chrome - 10;
      const goUp = up ? (above >= 180 || above >= below) : (below < 180 && above > below);
      const next: { left: number; width: number; top?: number; bottom?: number; listMax: number } = {
        left: r.left, width: r.width,
        top: goUp ? undefined : r.bottom + 6,
        bottom: goUp ? window.innerHeight - r.top + 6 : undefined,
        listMax: Math.max(96, Math.min(240, goUp ? above : below)),
      };
      setPos((p) => (p && p.left === next.left && p.width === next.width && p.top === next.top && p.bottom === next.bottom && p.listMax === next.listMax ? p : next));
    };
    // Scrolling the menu's own option list doesn't move the control.
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) place(); };
    place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', place); };
  }, [open, up, hasAdd]);

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
      {open && !disabled && pos && (
        <div style={{
          position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 1300, boxSizing: 'border-box',
          background: C.white, border: '1px solid #EBEBEB', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,.14)', padding: 6, display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ position: 'relative' }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              style={{ width: '100%', padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.seasalt, boxSizing: 'border-box' }} />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={13} /></span>
          </div>
          <div style={{ maxHeight: pos.listMax, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
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
          {onAddNew && addNewLabel && (
            <button type="button"
              onClick={() => { const query = q.trim(); setOpen(false); onAddNew(query); }}
              style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: '1px dashed #C8E6C9', background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              + {addNewLabel}{q.trim() ? ` “${q.trim()}”` : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
