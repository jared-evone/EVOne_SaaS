import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { C } from '../../theme';
import { supabase } from '../../lib/supabase';
import { Search, Check, X, Pencil, Trash2, Plus } from 'lucide-react';
import { SearchSelect, type SelectOption } from '../../components/SearchSelect';

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
  contact_name?: string | null;
  contact_phone?: string | null;
  void_do_nos?: string[] | null;
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
  customer_id?: string | null;
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

// ── Requests ─────────────────────────────────────────────────────

// Departments that raise stock requests.
export const REQ_DEPARTMENTS = ['Sales', 'Technical', 'CPO'];

export const REQ_META: Record<InvRequest['status'], { label: string; bg: string; color: string }> = {
  legacy:    { label: 'Migrated — status not tracked', bg: '#F3F3F3', color: '#767B77' },
  pending:   { label: 'Pending',   bg: '#FFF8E1', color: '#B07D00' },
  approved:  { label: 'Approved',  bg: '#E3F0FF', color: '#1A62C0' },
  fulfilled: { label: 'Fulfilled', bg: '#E4F3E3', color: '#1B512D' },
  cancelled: { label: 'Cancelled', bg: '#FDEAEA', color: '#C0321A' },
};

// Shareable request links (?stockRequest=<slug>). The link grants nothing on
// its own — the visitor signs in with their own account before the form shows.
export const REQUEST_LINKS: { slug: string; label: string; department: string }[] = [
  { slug: 'any', label: 'Any department', department: '' },
  ...REQ_DEPARTMENTS.map((d) => ({ slug: d.toLowerCase(), label: d, department: d })),
];
export const requestLinkUrl = (slug: string) => `${window.location.origin}${window.location.pathname}?stockRequest=${slug}`;

// New requests get the next PR-YYYY-NNNN. Two people submitting at the same
// moment can race for one number, so a unique-key clash re-reads and retries.
export async function insertRequest(row: Record<string, unknown>): Promise<{ pr_no?: string; error?: string }> {
  const year = todayISO().slice(0, 4);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: last, error: readErr } = await supabase.from('inv_requests').select('pr_no').like('pr_no', `PR-${year}-%`).order('pr_no', { ascending: false }).limit(1);
    if (readErr) return { error: readErr.message };
    const n = Number(((last ?? [])[0] as { pr_no: string } | undefined)?.pr_no.split('-')[2] ?? 0) + 1;
    const pr_no = `PR-${year}-${String(n).padStart(4, '0')}`;
    const { error } = await supabase.from('inv_requests').insert({ ...row, pr_no, status: 'pending' });
    if (!error) return { pr_no };
    if (error.code !== '23505') return { error: error.message };
  }
  return { error: 'Could not assign a PR number — please submit again.' };
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

// ── Customers (read-only here) ───────────────────────────────────
// Requests name the company, the person to contact and the delivery address;
// all three default from Customers and can be changed per request.

export interface CustomerOpt { id: string; name: string; address: string | null; }
export interface ContactOpt { customer_id: string; name: string; phone: string | null; position: number; }

export function useCustomerDirectory() {
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [contacts, setContacts] = useState<ContactOpt[]>([]);
  useEffect(() => {
    void Promise.all([
      supabase.from('customers').select('id, name, address').order('name'),
      supabase.from('customer_contacts').select('customer_id, name, phone, position').order('position').order('created_at'),
    ]).then(([c, k]) => {
      setCustomers((c.data as CustomerOpt[]) ?? []);
      setContacts((k.data as ContactOpt[]) ?? []);
    });
  }, []);
  const contactsOf = useCallback((customerId: string) => contacts.filter((k) => k.customer_id === customerId), [contacts]);
  return { customers, contactsOf };
}

// Searchable pick of the customer's contacts (phone underneath), defaulting to
// the first one. A name not on file can be typed in for this request only.
export function ContactField({ value, phone, contacts, hasCustomer, onChange, disabled }: {
  value: string; phone: string; contacts: ContactOpt[]; hasCustomer: boolean;
  onChange: (name: string, phone: string) => void; disabled?: boolean;
}) {
  const options: SelectOption[] = contacts.map((k) => ({ value: k.name, label: k.name, sub: k.phone ?? undefined }));
  if (value && !contacts.some((k) => k.name === value)) options.push({ value, label: value, sub: 'Not on the customer record' });
  return (
    <Field label="Contact person" hint={phone ? `Tel ${phone}` : hasCustomer && contacts.length === 0 ? 'No contact on file for this customer — type a name' : undefined}>
      <SearchSelect value={value} options={options} disabled={disabled || !hasCustomer}
        placeholder={hasCustomer ? 'Select contact…' : 'Pick the company first'} emptyText="No contacts match"
        onChange={(v) => onChange(v, contacts.find((k) => k.name === v)?.phone ?? '')}
        addNewLabel="Use a name not on file" onAddNew={(q) => { if (q.trim()) onChange(q.trim(), ''); }} />
    </Field>
  );
}

// Delivery address defaults to the customer's address on file (Customers).
// It can be changed for one request (a site, self collect) and put back in
// one click; the customer record itself is never edited from here.
export function DeliverToField({ value, onChange, addressOnFile, hasCustomer, disabled }: {
  value: string; onChange: (v: string) => void; addressOnFile: string | null | undefined; hasCustomer: boolean; disabled?: boolean;
}) {
  const onFile = (addressOnFile ?? '').trim();
  const changed = hasCustomer && value.trim() !== onFile;
  return (
    <div style={{ minWidth: 0 }}>
      <label style={labelStyle}>Deliver to</label>
      <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        placeholder={hasCustomer && !onFile ? 'No address on file — type one' : "Filled from the customer's address"} style={inputStyle} />
      {hasCustomer && (
        <div style={{ fontSize: 11, color: C.slate, marginTop: 4, lineHeight: 1.5 }}>
          {!onFile ? 'This customer has no address on file.'
            : !changed ? 'Address on file for this customer — change it for a site or self collect'
            : (
              <>
                Changed for this request. On file: {onFile}
                {!disabled && (
                  <button type="button" onClick={() => onChange(onFile)}
                    style={{ marginLeft: 8, border: 'none', background: 'none', padding: 0, color: C.green, fontWeight: 700, fontSize: 11, fontFamily: 'Figtree', cursor: 'pointer' }}>
                    Use address on file
                  </button>
                )}
              </>
            )}
        </div>
      )}
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
export function ItemSelect({ items, value, onChange, allowNone, noneLabel = 'Select item', disabled, up }: {
  items: InvItem[]; value: string; onChange: (id: string) => void; allowNone?: boolean; noneLabel?: string; disabled?: boolean; up?: boolean;
}) {
  const active = items.filter((i) => i.active || i.id === value);
  const cats = [...new Set(active.map((i) => i.category || 'Uncategorised'))];
  const options: SelectOption[] = [
    ...(allowNone ? [{ value: '', label: noneLabel }] : []),
    ...cats.flatMap((c) => active.filter((i) => (i.category || 'Uncategorised') === c).map((i) => ({
      value: i.id, label: itemLabel(i, items), sub: [c, i.brand].filter(Boolean).join(' · '),
    }))),
  ];
  return <SearchSelect value={value} options={options} onChange={onChange} disabled={disabled} up={up} placeholder={noneLabel} emptyText="No items match" />;
}

// Usable locations, each showing what that item has there.
export function LocationSelect({ locations, value, onChange, itemId, onHand, includeUnusable, placeholder = 'Select location', up }: {
  locations: InvLocation[]; value: string; onChange: (id: string) => void;
  itemId?: string | null; onHand?: OnHand; includeUnusable?: boolean; placeholder?: string; up?: boolean;
}) {
  const options: SelectOption[] = locations.filter((l) => includeUnusable || l.usable).map((l) => ({
    value: l.id, label: l.name, sub: itemId && onHand ? `${qtyAt(onHand, itemId, l.id)} on hand` : undefined,
  }));
  return <SearchSelect value={value} options={options} onChange={onChange} up={up} placeholder={placeholder} emptyText="No locations match" />;
}

// ── Admin-managed pick-lists (Brand, Category, Supplier) ─────────
// Records store the text; the list only drives the dropdown. Renaming goes
// through inv_rename_lookup so every record using the old name follows.

export interface LookupRow { id: string; name: string; sort_order: number; }
export type LookupKind = 'brand' | 'category' | 'supplier';
const LOOKUP_META: Record<LookupKind, { table: string; noun: string; plural: string }> = {
  brand:    { table: 'inv_brands',     noun: 'brand',    plural: 'Brands' },
  category: { table: 'inv_categories', noun: 'category', plural: 'Categories' },
  supplier: { table: 'inv_suppliers',  noun: 'supplier', plural: 'Suppliers' },
};

export function useLookupRows(kind: LookupKind) {
  const [rows, setRows] = useState<LookupRow[]>([]);
  const reload = useCallback(async () => {
    const { data } = await supabase.from(LOOKUP_META[kind].table).select('*').order('sort_order').order('name');
    setRows((data as LookupRow[]) ?? []);
  }, [kind]);
  useEffect(() => { void reload(); }, [reload]);
  return { rows, reload };
}

// Searchable dropdown over a managed list. Admins get "+ Add new …" inline;
// everyone else can only pick existing entries.
export function LookupSelect({ kind, value, options, isAdmin, onChange, onAdded, disabled }: {
  kind: LookupKind; value: string; options: LookupRow[]; isAdmin: boolean;
  onChange: (v: string) => void; onAdded: () => Promise<void>; disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const { table, noun, plural } = LOOKUP_META[kind];
  const inList = options.some((o) => o.name === value);

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    const existing = options.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (existing) { onChange(existing.name); setAdding(false); setDraft(''); return; }
    const { error } = await supabase.from(table).insert({ name, sort_order: Math.max(0, ...options.map((o) => o.sort_order)) + 1 });
    if (error) { setErr(error.message); return; }
    await onAdded();
    onChange(name);
    setAdding(false);
    setDraft('');
    setErr(null);
  };

  if (adding) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder={`New ${noun}`}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); if (e.key === 'Escape') setAdding(false); }}
            style={inputStyle} />
          <button type="button" onClick={() => void add()} title="Add" style={{ ...primaryBtn(!draft.trim()), padding: '0 12px' }}><Check size={14} /></button>
          <button type="button" onClick={() => { setAdding(false); setDraft(''); }} title="Cancel" style={{ ...ghostBtn, padding: '0 10px' }}><X size={14} /></button>
        </div>
        {err && <div style={{ fontSize: 11, color: '#C0321A' }}>{err}</div>}
      </div>
    );
  }
  const opts: SelectOption[] = [
    ...options.map((o) => ({ value: o.name, label: o.name })),
    ...(value && !inList ? [{ value, label: `${value} (not in list)` }] : []),
  ];
  return (
    <SearchSelect value={value} options={opts} onChange={onChange} disabled={disabled}
      placeholder={`Select ${noun}`} emptyText={`No ${plural.toLowerCase()} match`}
      addNewLabel={isAdmin ? `Add new ${noun}` : undefined}
      onAddNew={isAdmin ? (q) => { setDraft(q); setAdding(true); } : undefined} />
  );
}

// Admin editor for one list: rename (follows through to every record), add,
// and remove entries nothing uses.
export function LookupList({ kind, rows, unit, usage, onChanged }: {
  kind: LookupKind; rows: LookupRow[]; unit: string; usage: (name: string) => number; onChanged: () => Promise<void>;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { table, noun, plural } = LOOKUP_META[kind];

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) { setErr(error.message.includes('duplicate') ? `That ${noun} already exists.` : error.message); return false; }
    await onChanged();
    return true;
  };
  const insertNew = () => run(() => supabase.from(table).insert({ name: newName.trim(), sort_order: Math.max(0, ...rows.map((x) => x.sort_order)) + 1 }));

  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ ...labelStyle, marginBottom: 2 }}>{plural}</div>
      {rows.map((r) => {
        const n = usage(r.name);
        return (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '6px 8px' }}>
            {editId === r.id ? (
              <>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditId(null); }}
                  style={{ ...inputStyle, padding: '5px 8px', fontSize: 12.5 }} />
                <button disabled={busy} title="Save"
                  onClick={async () => { if (await run(() => supabase.rpc('inv_rename_lookup', { p_kind: kind, p_id: r.id, p_new: draft }))) setEditId(null); }}
                  style={{ border: 'none', background: C.green, color: C.white, borderRadius: 8, padding: '5px 8px', cursor: 'pointer', display: 'inline-flex' }}><Check size={13} /></button>
                <button onClick={() => setEditId(null)} title="Cancel" style={{ border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', padding: 4 }}><X size={13} /></button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                <span style={{ fontSize: 11, color: C.slate, whiteSpace: 'nowrap' }}>{n} {unit}{n === 1 ? '' : 's'}</span>
                <button onClick={() => { setEditId(r.id); setDraft(r.name); }} title="Rename" style={{ border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', padding: 4 }}><Pencil size={13} /></button>
                <button disabled={busy || n > 0} title={n > 0 ? `In use by ${n} ${unit}${n === 1 ? '' : 's'} — reassign them first` : `Remove ${noun}`}
                  onClick={() => void run(() => supabase.from(table).delete().eq('id', r.id))}
                  style={{ border: 'none', background: 'transparent', color: n > 0 ? '#D5DDE3' : '#C0321A', cursor: n > 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', padding: 4 }}><Trash2 size={13} /></button>
              </>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`New ${noun}`}
          onKeyDown={async (e) => { if (e.key === 'Enter' && newName.trim() && await insertNew()) setNewName(''); }}
          style={{ ...inputStyle, padding: '6px 10px', fontSize: 12.5 }} />
        <button disabled={busy || !newName.trim()}
          onClick={async () => { if (await insertNew()) setNewName(''); }}
          style={{ ...primaryBtn(busy || !newName.trim()), padding: '0 12px', display: 'inline-flex', alignItems: 'center' }}><Plus size={14} /></button>
      </div>
      {err && <div style={{ fontSize: 11, color: '#C0321A' }}>{err}</div>}
    </div>
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
