import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { C } from '../../theme';
import { supabase } from '../../lib/supabase';
import { Search } from 'lucide-react';

// Standalone inventory: stock is only ever changed by inventory actions here.
// On-hand = sum of inv_movements per item × location (the inv_on_hand view).

export interface InvItem {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  reorder_point: number | null;
  reorder_qty: number | null;
  unit_price: number | null;
  notes: string | null;
  active: boolean;
  sort_order: number;
}

export interface InvLocation {
  id: string; name: string; code: string | null; usable: boolean; sort_order: number;
  /** Set on a spoilt (quarantine) bucket: the usable location it belongs to.
   *  Null on a non-usable location = spoilt units whose location was never recorded. */
  spoilt_for: string | null;
}

export interface InvMovement {
  id: string;
  item_id: string;
  location_id: string;
  qty: number;
  kind: MovementKind;
  moved_on: string;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export type MovementKind = 'opening' | 'receipt' | 'issue' | 'transfer_in' | 'transfer_out' | 'adjustment' | 'spoilt' | 'cannibalised' | 'return';

export interface InvRequest {
  id: string;
  pr_no: string;
  submitted_on: string;
  employee: string | null;
  department: string | null;
  customer_id: string | null;
  company_project: string | null;
  delivery_address: string | null;
  item_id: string | null;
  item_name: string;
  qty: number;
  required_by: string | null;
  remarks: string | null;
  status: 'legacy' | 'pending' | 'approved' | 'fulfilled' | 'cancelled';
  do_no: string | null;
  fulfilled_location_id: string | null;
  fulfilled_on: string | null;
  delivered_by: string | null;
  delivery_note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InvShipment {
  id: string;
  legacy_no: number | null;
  supplier: string | null;
  po_no: string | null;
  employee: string | null;
  customer: string | null;
  warranty: string | null;
  description: string;
  item_id: string | null;
  qty: number;
  mode: string | null;
  order_date: string | null;
  in_transit_date: string | null;
  eta: string | null;
  eta_note: string | null;
  status: 'ordered' | 'in_transit' | 'partial' | 'received' | 'cancelled';
  received_on: string | null;
  notes: string | null;
  legacy: boolean;
  created_at: string;
}

export interface InvGrn {
  id: string;
  shipment_id: string | null;
  po_no: string | null;
  received_on: string | null;
  supplier: string | null;
  item_id: string | null;
  item_name: string;
  qty_ordered: number | null;
  qty_received: number | null;
  location_id: string | null;
  condition: string | null;
  notes: string | null;
  status: 'pending' | 'received';
  posted: boolean;
  legacy: boolean;
  created_by: string | null;
  created_at: string;
}

export interface InvCannibal {
  id: string;
  cb_no: string;
  taken_on: string;
  part_item_id: string | null;
  part_name: string;
  qty: number;
  source: 'stock' | 'charger';
  source_location_id: string | null;
  donor_item_id: string | null;
  donor_note: string | null;
  used_for: string | null;
  charger_ref: string | null;
  reason: string | null;
  status: 'awaiting' | 'replenished' | 'written_off';
  replenished_on: string | null;
  replenish_note: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Core data: items, locations, on-hand ─────────────────────────

export type OnHand = Map<string, Map<string, number>>; // item_id → location_id → qty

export function useInvCore() {
  const [items, setItems] = useState<InvItem[]>([]);
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [onHand, setOnHand] = useState<OnHand>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [it, lo, oh] = await Promise.all([
      supabase.from('inv_items').select('*').order('sort_order').order('name'),
      supabase.from('inv_locations').select('*').order('sort_order'),
      supabase.from('inv_on_hand').select('item_id, location_id, qty'),
    ]);
    const err = it.error ?? lo.error ?? oh.error;
    if (err) setError(err.message);
    setItems((it.data as InvItem[]) ?? []);
    setLocations((lo.data as InvLocation[]) ?? []);
    const m: OnHand = new Map();
    for (const r of (oh.data ?? []) as { item_id: string; location_id: string; qty: number }[]) {
      let e = m.get(r.item_id);
      if (!e) { e = new Map(); m.set(r.item_id, e); }
      e.set(r.location_id, Number(r.qty));
    }
    setOnHand(m);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { items, locations, onHand, loading, error, reload };
}

export const qtyAt = (onHand: OnHand, itemId: string, locationId: string) => onHand.get(itemId)?.get(locationId) ?? 0;

export const usableTotal = (onHand: OnHand, itemId: string, locations: InvLocation[]) =>
  locations.filter((l) => l.usable).reduce((s, l) => s + qtyAt(onHand, itemId, l.id), 0);

// Disambiguate same-named items (e.g. "AC Charger Stand" from two brands).
export function itemLabel(item: InvItem | undefined | null, all: InvItem[]): string {
  if (!item) return '—';
  const dup = all.filter((i) => i.name.toLowerCase() === item.name.toLowerCase()).length > 1;
  return dup && item.brand ? `${item.name} (${item.brand})` : item.name;
}

// ── Formatting ───────────────────────────────────────────────────

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const fmtD = (s: string | null | undefined) =>
  s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  opening: 'Opening balance',
  receipt: 'Received',
  issue: 'Issued',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  adjustment: 'Admin correction',
  spoilt: 'Spoilt',
  cannibalised: 'Cannibalised',
  return: 'Returned',
};

export const MOVEMENT_COLORS: Record<MovementKind, { bg: string; color: string }> = {
  opening:      { bg: '#F3F3F3', color: '#767B77' },
  receipt:      { bg: '#E4F3E3', color: '#1B512D' },
  issue:        { bg: '#E3F0FF', color: '#1A62C0' },
  transfer_in:  { bg: '#F0E8FF', color: '#6B21A8' },
  transfer_out: { bg: '#F0E8FF', color: '#6B21A8' },
  adjustment:   { bg: '#FFF8E1', color: '#B07D00' },
  spoilt:       { bg: '#FDEAEA', color: '#C0321A' },
  cannibalised: { bg: '#FFF0E0', color: '#B45309' },
  return:       { bg: '#E4F3E3', color: '#1B512D' },
};

// ── Small UI pieces ──────────────────────────────────────────────

export const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
export const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };
export const primaryBtn = (disabled = false): React.CSSProperties => ({ padding: '9px 20px', borderRadius: 10, border: 'none', background: disabled ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap' });
export const ghostBtn: React.CSSProperties = { padding: '9px 16px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
export const pillBtn = (active: boolean): React.CSSProperties => ({ padding: '7px 14px', borderRadius: 99, border: active ? 'none' : '1px solid #EBEBEB', background: active ? C.green : C.white, color: active ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' });
export const thStyle: React.CSSProperties = { padding: '12px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap', background: C.seasalt };
export const tdStyle: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#1a1a1a', verticalAlign: 'top' };

export function Pill({ bg, color, children, title }: { bg: string; color: string; children: ReactNode; title?: string }) {
  return <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: bg, color, whiteSpace: 'nowrap' }}>{children}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function ErrorBanner({ text }: { text: string | null }) {
  if (!text) return null;
  return <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{text}</div>;
}

export function Modal({ title, subtitle, width = 560, onClose, children, footer }: {
  title: string; subtitle?: string; width?: number; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree', flexShrink: 0 }}>×</button>
        </div>
        {children}
        {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>
  );
}

// Native select grouped by category; same-named items carry their brand.
export function ItemSelect({ items, value, onChange, allowNone, noneLabel = '— Select item —', disabled }: {
  items: InvItem[]; value: string; onChange: (id: string) => void; allowNone?: boolean; noneLabel?: string; disabled?: boolean;
}) {
  const active = items.filter((i) => i.active || i.id === value);
  const cats = [...new Set(active.map((i) => i.category || 'Uncategorised'))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={{ ...inputStyle, cursor: disabled ? 'default' : 'pointer' }}>
      <option value="" disabled={!allowNone}>{noneLabel}</option>
      {cats.map((c) => (
        <optgroup key={c} label={c}>
          {active.filter((i) => (i.category || 'Uncategorised') === c).map((i) => (
            <option key={i.id} value={i.id}>{itemLabel(i, items)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// Usable locations, each showing what that item has there.
export function LocationSelect({ locations, value, onChange, itemId, onHand, includeUnusable, placeholder = '— Select location —' }: {
  locations: InvLocation[]; value: string; onChange: (id: string) => void;
  itemId?: string | null; onHand?: OnHand; includeUnusable?: boolean; placeholder?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
      <option value="" disabled>{placeholder}</option>
      {locations.filter((l) => includeUnusable || l.usable).map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}{itemId && onHand ? ` — ${qtyAt(onHand, itemId, l.id)} on hand` : ''}
        </option>
      ))}
    </select>
  );
}

export function SearchBox({ value, onChange, placeholder, width = 260 }: { value: string; onChange: (v: string) => void; placeholder: string; width?: number }) {
  return (
    <div style={{ position: 'relative', width, maxWidth: '100%' }}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}>
        <Search size={14} />
      </span>
    </div>
  );
}

export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
