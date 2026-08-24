import { useEffect, useMemo, useRef, useState } from 'react';
import { C } from '../theme';
import { Search, ChevronDown, Check, X } from 'lucide-react';

export interface FilterOption { value: string; label: string; sub?: string }
export interface FilterGroup { key: string; label: string; options: FilterOption[] }

/** Active selections: group key → chosen values. */
export type FilterSelection = Record<string, string[]>;

export const selectionCount = (sel: FilterSelection) =>
  Object.values(sel).reduce((n, vs) => n + vs.length, 0);

// One dropdown covering every facet (type, technician, company, …) instead of a
// row of pills that grows without bound. Multi-select: values WITHIN a group are
// OR'd, groups are AND'd together — standard faceted filtering. The trigger
// summarises what's active so the toolbar stays a single line.
export function FilterSelect({ groups, selected, onChange, placeholder = 'All reports' }: {
  groups: FilterGroup[];
  selected: FilterSelection;
  onChange: (next: FilterSelection) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // The panel must OVERLAY the page, never extend it: cap the option list to the
  // viewport space below the trigger (or flip upward when that's too tight).
  const [listMax, setListMax] = useState(300);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const openPanel = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom - 70; // room under the trigger, minus panel chrome
      const above = r.top - 70;
      const up = below < 180 && above > below;
      setOpenUp(up);
      setListMax(Math.max(140, Math.min(300, (up ? above : below))));
    }
    setOpen(true);
    setQ('');
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const total = selectionCount(selected);

  // What the closed control says: name one or two picks, then fall back to a count.
  const summary = useMemo(() => {
    if (!total) return placeholder;
    const labels: string[] = [];
    for (const g of groups) {
      for (const v of selected[g.key] ?? []) {
        const o = g.options.find((x) => x.value === v);
        if (o) labels.push(o.label);
      }
    }
    if (labels.length <= 2) return labels.join(' · ');
    return `${labels[0]} +${labels.length - 1} more`;
  }, [groups, selected, total, placeholder]);

  const ql = q.trim().toLowerCase();
  const visibleGroups = groups
    .map((g) => ({
      ...g,
      options: ql
        ? g.options.filter((o) => o.label.toLowerCase().includes(ql) || (o.sub ?? '').toLowerCase().includes(ql))
        : g.options,
    }))
    .filter((g) => g.options.length > 0);

  const toggle = (groupKey: string, value: string) => {
    const cur = selected[groupKey] ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    const out = { ...selected };
    if (next.length) out[groupKey] = next; else delete out[groupKey];
    onChange(out);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        style={{
          width: '100%', padding: '8px 12px', borderRadius: 10,
          border: `1px solid ${open || total ? C.green : '#EBEBEB'}`,
          background: total ? C.honeydew : C.white,
          fontFamily: 'Figtree', fontSize: 12.5, fontWeight: total ? 700 : 400,
          color: total ? C.green : C.slate,
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          textAlign: 'left', boxSizing: 'border-box', outline: 'none',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary}
        </span>
        {total > 0 && (
          <span
            role="button"
            title="Clear filters"
            onClick={(e) => { e.stopPropagation(); onChange({}); }}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 99, background: C.green, color: C.white, flexShrink: 0 }}
          >
            <X size={10} strokeWidth={3} />
          </span>
        )}
        <ChevronDown size={15} strokeWidth={2.25} style={{ flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', left: 0, right: 0, zIndex: 60,
          top: openUp ? undefined : 'calc(100% + 6px)', bottom: openUp ? 'calc(100% + 6px)' : undefined,
          background: C.white, border: '1px solid #EBEBEB', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,.14)', padding: 6,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ position: 'relative' }}>
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter options…"
              style={{ width: '100%', padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.seasalt, boxSizing: 'border-box' }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}>
              <Search size={13} />
            </span>
          </div>

          <div style={{ maxHeight: listMax, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {visibleGroups.length === 0 && (
              <div style={{ padding: 12, textAlign: 'center', color: C.slate, fontSize: 12 }}>No matching filters</div>
            )}
            {visibleGroups.map((g) => (
              <div key={g.key}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '7px 10px 4px' }}>
                  {g.label}
                </div>
                {g.options.map((o) => {
                  const on = (selected[g.key] ?? []).includes(o.value);
                  return (
                    <button
                      key={o.value} type="button" onClick={() => toggle(g.key, o.value)}
                      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = C.seasalt; }}
                      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 10px', borderRadius: 8, border: 'none',
                        background: on ? C.honeydew : 'transparent',
                        color: on ? C.green : '#1a1a1a',
                        fontFamily: 'Figtree', fontSize: 12.5, fontWeight: on ? 700 : 500,
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span style={{
                        width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                        border: `1.5px solid ${on ? C.green : '#CBD5DD'}`,
                        background: on ? C.green : C.white,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {on && <Check size={10} strokeWidth={3.5} color={C.white} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.label}
                      </span>
                      {o.sub && <span style={{ fontSize: 11, color: C.slate, flexShrink: 0 }}>{o.sub}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
