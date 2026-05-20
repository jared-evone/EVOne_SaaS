import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { searchOneMap, type OneMapResult } from '../lib/onemap';

interface OneMapAutocompleteProps {
  value: string;
  onChange: (text: string) => void;
  onPick:   (result: OneMapResult) => void;
  placeholder?: string;
}

export function OneMapAutocomplete({ value, onChange, onPick, placeholder }: OneMapAutocompleteProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<OneMapResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Debounced search keyed off `value`. Aborts in-flight fetches on rapid typing.
  useEffect(() => {
    if (value.trim().length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const t = window.setTimeout(async () => {
      const rows = await searchOneMap(value, controller.signal);
      if (!controller.signal.aborted) {
        setResults(rows);
        setLoading(false);
        setHighlight(0);
      }
    }, 300);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const pick = (r: OneMapResult) => {
    onPick(r);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(results.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter')   { e.preventDefault(); pick(results[highlight]); }
    else if (e.key === 'Escape')  { setOpen(false); }
  };

  const showDropdown = open && value.trim().length >= 3;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB',
          fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box',
        }}
      />
      {showDropdown && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: C.white, borderRadius: 12, border: '1px solid #EBEBEB',
          boxShadow: '0 8px 32px rgba(0,0,0,.12)', zIndex: 50,
          display: 'flex', flexDirection: 'column', maxHeight: 280, overflowY: 'auto',
        }}>
          {loading && (
            <div style={{ padding: '10px 14px', fontSize: 12, color: C.slate, textAlign: 'center' }}>Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div style={{ padding: '10px 14px', fontSize: 12, color: C.slate, textAlign: 'center' }}>
              No matching Singapore addresses
            </div>
          )}
          {!loading && results.map((r, i) => {
            const active = i === highlight;
            const meta = [r.postal && `S${r.postal}`, r.building].filter(Boolean).join(' · ');
            return (
              <div
                key={`${r.address}-${i}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                style={{
                  padding: '10px 14px', cursor: 'pointer',
                  background: active ? C.honeydew : 'transparent',
                  borderBottom: i < results.length - 1 ? '1px solid #F3F3F3' : undefined,
                }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: active ? C.green : '#1a1a1a', lineHeight: 1.35 }}>
                  {r.address}
                </div>
                {meta && (
                  <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{meta}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
