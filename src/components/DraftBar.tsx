import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { C } from '../theme';
import { DRAFT_HOURS } from '../lib/draft';

interface DraftBarProps {
  /** What a clear removes, e.g. "the title, 3 items and notes". */
  summary: string;
  onClear: () => void;
}

export function DraftBar({ summary, onClear }: DraftBarProps) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 32 }}>
      <span style={{ fontSize: 11, color: C.slate, marginRight: 'auto' }}>
        Draft kept on this device for {DRAFT_HOURS} hours — safe to switch tabs.
      </span>
      {confirm ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#FDEAEA', borderRadius: 10, padding: '4px 4px 4px 12px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#C0321A' }}>Clear {summary}?</span>
          <button type="button" onClick={() => setConfirm(false)}
            style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={() => { setConfirm(false); onClear(); }}
            style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, clear all</button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Trash2 size={12} strokeWidth={2.25} /> Clear all
        </button>
      )}
    </div>
  );
}
