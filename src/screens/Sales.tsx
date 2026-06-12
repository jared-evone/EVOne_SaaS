import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { useIsMobile } from '../lib/useIsMobile';
import { Search, ChevronDown, Handshake, Plus, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────

export type QuoteStatus = 'Draft' | 'Sent' | 'Won' | 'Lost';
export const QUOTE_STATUSES: QuoteStatus[] = ['Draft', 'Sent', 'Won', 'Lost'];

export const QUOTE_STATUS_COLORS: Record<QuoteStatus, { bg: string; color: string }> = {
  Draft: { bg: '#F3F3F3', color: '#767B77' },
  Sent:  { bg: '#E3F0FF', color: '#1A62C0' },
  Won:   { bg: '#E4F3E3', color: '#1B512D' },
  Lost:  { bg: '#FDEAEA', color: '#C0321A' },
};

export interface QuoteItem {
  description: string;
  qty: number;
  unit_price: number;
}

export interface Quote {
  id: string;
  ref: string;
  customer_id: string | null;
  customer_name: string;
  contact_name: string | null;
  contact_email: string | null;
  salesperson_id: string | null;
  salesperson_name: string;
  type: 'Quotation' | 'Proposal';
  status: QuoteStatus;
  items: QuoteItem[];
  discount: number;
  total: number;
  notes: string | null;
  quote_date: string;
  expiry_date: string | null;
  won_at: string | null;
}

interface CustomerOpt {
  id: string;
  name: string;
  email: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
}

interface SalesUser {
  id: string;
  full_name: string;
  is_active: boolean;
}

// Quick-pick catalog for line items (prices in RM, install included).
const CATALOG: { label: string; price: number }[] = [
  { label: '7kW AC Home Charger (incl. installation)', price: 4800 },
  { label: '22kW AC Commercial Charger (incl. installation)', price: 9200 },
  { label: '50kW DC Fast Charger (incl. installation)', price: 68000 },
];

export const fmtRM = (n: number) => `RM ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export const calcTotal = (items: QuoteItem[], discount: number) => {
  const sub = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
  return Math.max(0, sub * (1 - (Number(discount) || 0) / 100));
};

const todayIso = () => new Date().toISOString().slice(0, 10);
export const isExpired = (q: Quote) => q.status === 'Sent' && !!q.expiry_date && q.expiry_date < todayIso();

// ── Brand searchable dropdown (local copy of the TSD pattern) ─────

interface SelectOption { value: string; label: string; }

function SearchSelect({ value, options, onChange, disabled, placeholder }: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
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
  const filtered = ql ? options.filter((o) => o.label.toLowerCase().includes(ql)) : options;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled} onClick={() => { setOpen((o) => !o); setQ(''); }}
        style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${open ? C.green : '#EBEBEB'}`, background: disabled ? '#F9F9F9' : C.white, fontFamily: 'Figtree', fontSize: 13, cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? '#1a1a1a' : C.slate }}>
          {selected?.label ?? placeholder ?? 'Select…'}
        </span>
        <ChevronDown size={16} strokeWidth={2.25} style={{ color: C.slate, flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && !disabled && (
        <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 60, top: 'calc(100% + 6px)', background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.14)', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              style={{ width: '100%', padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.seasalt, boxSizing: 'border-box' }} />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={13} /></span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px', textAlign: 'center', color: C.slate, fontSize: 12 }}>No matches</div>
            ) : filtered.map((o) => {
              const active = o.value === value;
              return (
                <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.seasalt; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  style={{ flexShrink: 0, width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: active ? C.honeydew : 'transparent', color: active ? C.green : '#1a1a1a', fontFamily: 'Figtree', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────

export function ScreenSales() {
  const { can, user } = usePermissions();
  const canEdit = can('sales', 'can_edit');
  const canDelete = can('sales', 'can_delete');
  const isMobile = useIsMobile();

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [salesUsers, setSalesUsers] = useState<SalesUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<'pipeline' | 'list'>('pipeline');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | QuoteStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'Quotation' | 'Proposal'>('all');
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'mine'>('all');
  const [modal, setModal] = useState<{ mode: 'new' } | { mode: 'edit'; quote: Quote } | null>(null);

  const fetchAll = async () => {
    setError(null);
    const [q, c, cc, u] = await Promise.all([
      supabase.from('sales_quotations').select('*').order('quote_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name, email').order('name'),
      supabase.from('customer_contacts').select('customer_id, name, email, position, created_at').order('position').order('created_at'),
      supabase.from('app_users').select('id, full_name, is_active').eq('department', 'sales').order('full_name'),
    ]);
    const err = q.error ?? c.error ?? cc.error ?? u.error;
    if (err) { setError(err.message); setLoading(false); return; }
    setQuotes((q.data ?? []) as Quote[]);
    const firstContact = new Map<string, { name: string | null; email: string | null }>();
    for (const row of (cc.data ?? []) as Array<{ customer_id: string; name: string | null; email: string | null }>) {
      if (!firstContact.has(row.customer_id)) firstContact.set(row.customer_id, { name: row.name, email: row.email });
    }
    setCustomers(((c.data ?? []) as Array<{ id: string; name: string; email: string | null }>).map((row) => ({
      ...row,
      contact_name: firstContact.get(row.id)?.name ?? null,
      contact_email: firstContact.get(row.id)?.email ?? row.email,
    })));
    setSalesUsers((u.data ?? []) as SalesUser[]);
    setLoading(false);
  };

  useEffect(() => { void fetchAll(); }, []);

  const setStatus = async (quote: Quote, status: QuoteStatus) => {
    if (!canEdit || quote.status === status) return;
    const won_at = status === 'Won' ? new Date().toISOString() : null;
    setQuotes((qs) => qs.map((q) => (q.id === quote.id ? { ...q, status, won_at } : q)));
    const { error: err } = await supabase
      .from('sales_quotations')
      .update({ status, won_at, updated_at: new Date().toISOString() })
      .eq('id', quote.id);
    if (err) { setError(err.message); void fetchAll(); }
  };

  // Filters
  const visible = quotes.filter((q) => {
    if (statusFilter !== 'all' && q.status !== statusFilter) return false;
    if (typeFilter !== 'all' && q.type !== typeFilter) return false;
    if (ownerFilter === 'mine' && q.salesperson_id !== user.id) return false;
    const s = search.trim().toLowerCase();
    if (s && !`${q.ref} ${q.customer_name} ${q.salesperson_name}`.toLowerCase().includes(s)) return false;
    return true;
  });

  // KPIs
  const open = quotes.filter((q) => q.status === 'Draft' || q.status === 'Sent');
  const won = quotes.filter((q) => q.status === 'Won');
  const lost = quotes.filter((q) => q.status === 'Lost');
  const pipelineValue = open.reduce((s, q) => s + Number(q.total), 0);
  const wonValue = won.reduce((s, q) => s + Number(q.total), 0);
  const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : null;

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 99, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', border: active ? 'none' : '1px solid #EBEBEB',
    background: active ? C.green : C.white, color: active ? C.white : C.slate,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard accent label="Pipeline Value" value={fmtRM(pipelineValue)} sub={`${open.length} open quote${open.length === 1 ? '' : 's'}`} />
        <KPICard label="Won Value" value={fmtRM(wonValue)} sub={`${won.length} won`} />
        <KPICard label="Awaiting Response" value={String(quotes.filter((q) => q.status === 'Sent').length)} sub="quotes sent" />
        <KPICard label="Win Rate" value={winRate === null ? '—' : `${winRate}%`} sub={`${won.length} won · ${lost.length} lost`} />
      </div>

      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: isMobile ? '100%' : 220 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ref / customer…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}>
            <Search size={14} />
          </span>
        </div>
        {(['all', ...QUOTE_STATUSES] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} style={pill(statusFilter === s)}>{s === 'all' ? 'All' : s}</button>
        ))}
        <span style={{ width: 1, height: 22, background: '#EBEBEB' }} />
        {(['all', 'Quotation', 'Proposal'] as const).map((t) => (
          <button key={t} onClick={() => setTypeFilter(t)} style={pill(typeFilter === t)}>{t === 'all' ? 'All types' : t}</button>
        ))}
        <span style={{ width: 1, height: 22, background: '#EBEBEB' }} />
        <button onClick={() => setOwnerFilter(ownerFilter === 'mine' ? 'all' : 'mine')} style={pill(ownerFilter === 'mine')}>Mine</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 10, padding: 3, border: '1px solid #EBEBEB' }}>
            {([['pipeline', 'Pipeline'], ['list', 'List']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ padding: '6px 14px', borderRadius: 8, border: 'none', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: view === k ? C.green : 'transparent', color: view === k ? C.white : C.slate }}>
                {l}
              </button>
            ))}
          </div>
          {canEdit && (
            <button onClick={() => setModal({ mode: 'new' })}
              style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + New Quote
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading quotations…</div>
      ) : quotes.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px dashed #EBEBEB', padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'inline-flex' }}><Handshake size={32} strokeWidth={1.5} color={C.slate} /></div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>No quotations yet</div>
          <div style={{ fontSize: 12, color: C.slate }}>Create your first quote for a customer from the Customers tab.</div>
        </div>
      ) : view === 'pipeline' ? (
        <PipelineBoard quotes={visible} canEdit={canEdit} onOpen={(q) => setModal({ mode: 'edit', quote: q })} onDropStatus={setStatus} />
      ) : (
        <QuoteTable quotes={visible} onOpen={(q) => setModal({ mode: 'edit', quote: q })} />
      )}

      {modal && (
        <QuoteModal
          quote={modal.mode === 'edit' ? modal.quote : null}
          customers={customers}
          salesUsers={salesUsers}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); void fetchAll(); }}
        />
      )}
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────

function QuoteBadge({ status }: { status: QuoteStatus }) {
  const sc = QUOTE_STATUS_COLORS[status];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: sc.bg, color: sc.color }}>
      {status}
    </span>
  );
}

// ── Kanban pipeline ──────────────────────────────────────────────

function PipelineBoard({ quotes, canEdit, onOpen, onDropStatus }: {
  quotes: Quote[];
  canEdit: boolean;
  onOpen: (q: Quote) => void;
  onDropStatus: (q: Quote, s: QuoteStatus) => void;
}) {
  const [dragOver, setDragOver] = useState<QuoteStatus | null>(null);

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${QUOTE_STATUSES.length}, minmax(230px, 1fr))`, gap: 12, minWidth: 720 }}>
        {QUOTE_STATUSES.map((status) => {
          const col = quotes.filter((q) => q.status === status);
          const colValue = col.reduce((s, q) => s + Number(q.total), 0);
          const sc = QUOTE_STATUS_COLORS[status];
          const isTarget = dragOver === status;
          return (
            <div key={status}
              onDragOver={canEdit ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOver !== status) setDragOver(status); } : undefined}
              onDragLeave={canEdit ? () => setDragOver((d) => (d === status ? null : d)) : undefined}
              onDrop={canEdit ? (e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData('text/plain');
                const q = quotes.find((x) => x.id === id);
                if (q) onDropStatus(q, status);
              } : undefined}
              style={{
                background: isTarget ? C.honeydew : C.seasalt,
                border: `1.5px solid ${isTarget ? C.green : 'transparent'}`,
                borderRadius: 14, padding: 10, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 220,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: sc.color, background: sc.bg, padding: '3px 10px', borderRadius: 99 }}>{status}</span>
                <span style={{ fontSize: 11, color: C.slate, fontWeight: 700 }}>{col.length}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: C.slate, fontWeight: 600 }}>{fmtRM(colValue)}</span>
              </div>
              {col.map((q) => (
                <button key={q.id}
                  draggable={canEdit}
                  onDragStart={canEdit ? (e) => { e.dataTransfer.setData('text/plain', q.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
                  onClick={() => onOpen(q)}
                  style={{
                    textAlign: 'left', background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: '12px 14px',
                    cursor: canEdit ? 'grab' : 'pointer', fontFamily: 'Figtree', display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>{q.ref}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: q.type === 'Proposal' ? '#FFF0E0' : C.honeydew, color: q.type === 'Proposal' ? '#B45309' : C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{q.type}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.customer_name}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{fmtRM(Number(q.total))}</div>
                  <div style={{ fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.salesperson_name}</div>
                  {isExpired(q) && (
                    <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 700, color: '#C0321A', background: '#FDEAEA', padding: '2px 8px', borderRadius: 99 }}>
                      Expired {q.expiry_date}
                    </span>
                  )}
                </button>
              ))}
              {col.length === 0 && (
                <div style={{ padding: '18px 8px', textAlign: 'center', fontSize: 11, color: C.slate, border: '1px dashed #E0E5E9', borderRadius: 10 }}>
                  {canEdit ? 'Drop quotes here' : 'Empty'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── List view ────────────────────────────────────────────────────

function QuoteTable({ quotes, onOpen }: { quotes: Quote[]; onOpen: (q: Quote) => void }) {
  const th: React.CSSProperties = {
    padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate,
    letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB',
  };
  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.seasalt }}>
            {['Ref', 'Type', 'Customer', 'Salesperson', 'Value', 'Status', 'Quote Date', 'Expiry'].map((h) => <th key={h} style={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => (
            <tr key={q.id} onClick={() => onOpen(q)} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>{q.ref}</td>
              <td style={{ padding: '13px 16px', color: C.slate }}>{q.type}</td>
              <td style={{ padding: '13px 16px', fontWeight: 600 }}>{q.customer_name}</td>
              <td style={{ padding: '13px 16px', color: C.slate }}>{q.salesperson_name}</td>
              <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>{fmtRM(Number(q.total))}</td>
              <td style={{ padding: '13px 16px' }}><QuoteBadge status={q.status} /></td>
              <td style={{ padding: '13px 16px', color: C.slate }}>{q.quote_date}</td>
              <td style={{ padding: '13px 16px', color: isExpired(q) ? '#C0321A' : C.slate, fontWeight: isExpired(q) ? 700 : 400 }}>
                {q.expiry_date ?? '—'}{isExpired(q) ? ' · expired' : ''}
              </td>
            </tr>
          ))}
          {quotes.length === 0 && (
            <tr><td colSpan={8} style={{ padding: '32px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No quotes match the filters.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Create / edit modal ──────────────────────────────────────────

function QuoteModal({ quote, customers, salesUsers, canEdit, canDelete, onClose, onSaved }: {
  quote: Quote | null;
  customers: CustomerOpt[];
  salesUsers: SalesUser[];
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = usePermissions();
  const isNew = quote === null;
  const readOnly = !canEdit;

  const [form, setForm] = useState(() => ({
    customer_id: quote?.customer_id ?? '',
    customer_name: quote?.customer_name ?? '',
    contact_name: quote?.contact_name ?? '',
    contact_email: quote?.contact_email ?? '',
    salesperson_id: quote?.salesperson_id ?? user.id,
    salesperson_name: quote?.salesperson_name ?? user.full_name,
    type: quote?.type ?? ('Quotation' as 'Quotation' | 'Proposal'),
    status: quote?.status ?? ('Draft' as QuoteStatus),
    items: quote?.items?.length ? quote.items.map((it) => ({ ...it })) : [{ description: '', qty: 1, unit_price: 0 }],
    discount: quote?.discount ?? 0,
    notes: quote?.notes ?? '',
    quote_date: quote?.quote_date ?? todayIso(),
    expiry_date: quote?.expiry_date ?? '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const customerOptions: SelectOption[] = [
    ...customers.map((c) => ({ value: c.id, label: c.name })),
    ...(form.customer_id && !customers.some((c) => c.id === form.customer_id)
      ? [{ value: form.customer_id, label: `${form.customer_name} (removed)` }]
      : []),
  ];
  const userOptions: SelectOption[] = [
    ...salesUsers.filter((u) => u.is_active).map((u) => ({ value: u.id, label: u.full_name })),
    ...(form.salesperson_id && !salesUsers.some((u) => u.is_active && u.id === form.salesperson_id)
      ? [{ value: form.salesperson_id, label: `${form.salesperson_name} (inactive)` }]
      : []),
  ];

  const pickCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    if (!c) { setForm((f) => ({ ...f, customer_id: id })); return; }
    setForm((f) => ({
      ...f,
      customer_id: c.id,
      customer_name: c.name,
      contact_name: f.contact_name || (c.contact_name ?? ''),
      contact_email: f.contact_email || (c.contact_email ?? ''),
    }));
  };

  const updateItem = (i: number, patch: Partial<QuoteItem>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));
  const addItem = (prefill?: { label: string; price: number }) =>
    setForm((f) => ({ ...f, items: [...f.items, { description: prefill?.label ?? '', qty: 1, unit_price: prefill?.price ?? 0 }] }));
  const removeItem = (i: number) =>
    setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const subtotal = form.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
  const total = calcTotal(form.items, Number(form.discount));

  const validItems = form.items.filter((it) => it.description.trim() !== '');
  const canSave = !!form.customer_id && !!form.salesperson_id && validItems.length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const payload = {
      customer_id: form.customer_id || null,
      customer_name: form.customer_name,
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      salesperson_id: form.salesperson_id || null,
      salesperson_name: form.salesperson_name,
      type: form.type,
      status: form.status,
      items: validItems.map((it) => ({ description: it.description.trim(), qty: Math.max(1, Number(it.qty) || 1), unit_price: Math.max(0, Number(it.unit_price) || 0) })),
      discount: Math.min(100, Math.max(0, Number(form.discount) || 0)),
      total,
      notes: form.notes || null,
      quote_date: form.quote_date,
      expiry_date: form.expiry_date || null,
      won_at: form.status === 'Won' ? (quote?.won_at ?? new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = isNew
      ? await supabase.from('sales_quotations').insert(payload)
      : await supabase.from('sales_quotations').update(payload).eq('id', quote.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  const handleDelete = async () => {
    if (!quote) return;
    setSaving(true);
    const { error: err } = await supabase.from('sales_quotations').delete().eq('id', quote.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const input = (disabled = false): React.CSSProperties => ({
    width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB',
    fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: disabled ? '#F9F9F9' : C.white, boxSizing: 'border-box',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, width: 640, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{isNew ? 'New Quote' : quote.ref}</div>
            {!isNew && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>Created {quote.quote_date}</div>}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#F3F3F3', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: C.slate }}>×</button>
        </div>

        {error && (
          <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={label}>Type</label>
            <select value={form.type} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'Quotation' | 'Proposal' }))} style={input(readOnly)}>
              <option value="Quotation">Quotation</option>
              <option value="Proposal">Proposal</option>
            </select>
          </div>
          <div>
            <label style={label}>Status</label>
            <select value={form.status} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as QuoteStatus }))} style={input(readOnly)}>
              {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Customer */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={label}>Customer</label>
            <SearchSelect value={form.customer_id} options={customerOptions} onChange={pickCustomer} disabled={readOnly} placeholder="— Select customer —" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div>
              <label style={label}>Contact Name</label>
              <input value={form.contact_name} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} style={input(readOnly)} />
            </div>
            <div>
              <label style={label}>Contact Email</label>
              <input value={form.contact_email} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} style={input(readOnly)} />
            </div>
          </div>
        </div>

        <div>
          <label style={label}>Salesperson</label>
          <SearchSelect value={form.salesperson_id} options={userOptions}
            onChange={(id) => {
              const u = salesUsers.find((x) => x.id === id);
              setForm((f) => ({ ...f, salesperson_id: id, salesperson_name: u?.full_name ?? f.salesperson_name }));
            }}
            disabled={readOnly} placeholder="— Select salesperson —" />
        </div>

        {/* Line items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ ...label, marginBottom: 0 }}>Line Items</label>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 480, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 110px 110px 32px', gap: 8, fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 2px' }}>
                <span>Description</span><span>Qty</span><span>Unit Price</span><span style={{ textAlign: 'right' }}>Subtotal</span><span />
              </div>
              {form.items.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 110px 110px 32px', gap: 8, alignItems: 'center' }}>
                  <input value={it.description} disabled={readOnly} placeholder="Item description"
                    onChange={(e) => updateItem(i, { description: e.target.value })} style={input(readOnly)} />
                  <input type="number" min={1} value={it.qty} disabled={readOnly}
                    onChange={(e) => updateItem(i, { qty: Number(e.target.value) })} style={input(readOnly)} />
                  <input type="number" min={0} value={it.unit_price} disabled={readOnly}
                    onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) })} style={input(readOnly)} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.green, textAlign: 'right' }}>{fmtRM((Number(it.qty) || 0) * (Number(it.unit_price) || 0))}</span>
                  {!readOnly ? (
                    <button onClick={() => removeItem(i)} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={12} strokeWidth={2.5} />
                    </button>
                  ) : <span />}
                </div>
              ))}
            </div>
          </div>
          {!readOnly && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => addItem()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                <Plus size={12} strokeWidth={2.5} /> Add item
              </button>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>From catalog:</span>
              {CATALOG.map((p) => (
                <button key={p.label} onClick={() => addItem(p)} title={p.label}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  {p.label.split(' (')[0]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Totals */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: C.slate }}>Subtotal</span><span style={{ fontWeight: 600 }}>{fmtRM(subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: C.slate }}>Discount (%)</span>
            <input type="number" min={0} max={100} value={form.discount} disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, discount: Number(e.target.value) }))}
              style={{ ...input(readOnly), width: 90, textAlign: 'right' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, color: C.green, borderTop: '1px solid #EBEBEB', paddingTop: 8 }}>
            <span>Total</span><span>{fmtRM(total)}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={label}>Quote Date</label>
            <input type="date" value={form.quote_date} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, quote_date: e.target.value }))} style={input(readOnly)} />
          </div>
          <div>
            <label style={label}>Expiry Date</label>
            <input type="date" value={form.expiry_date} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))} style={input(readOnly)} />
          </div>
        </div>

        <div>
          <label style={label}>Notes</label>
          <textarea value={form.notes} disabled={readOnly} rows={2} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            style={{ ...input(readOnly), resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#C0321A', flex: 1, minWidth: 160 }}>Delete {quote?.ref}? This cannot be undone.</span>
            <button onClick={() => setConfirmDelete(false)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleDelete} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, Delete</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
          {!isNew && canDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ marginRight: 'auto', padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Delete
            </button>
          )}
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button onClick={handleSave} disabled={!canSave}
              style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#A5D6A7', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'not-allowed' }}>
              {saving ? 'Saving…' : isNew ? 'Create quote' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
