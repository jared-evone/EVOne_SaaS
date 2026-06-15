import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { useIsMobile } from '../lib/useIsMobile';
import { Search, ChevronDown, Handshake, FileUp, FileText, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────

export type QuoteStatus = 'Draft' | 'Sent' | 'Won' | 'Lost';
export const QUOTE_STATUSES: QuoteStatus[] = ['Draft', 'Sent', 'Won', 'Lost'];

export const QUOTE_STATUS_COLORS: Record<QuoteStatus, { bg: string; color: string }> = {
  Draft: { bg: '#F3F3F3', color: '#767B77' },
  Sent:  { bg: '#E3F0FF', color: '#1A62C0' },
  Won:   { bg: '#E4F3E3', color: '#1B512D' },
  Lost:  { bg: '#FDEAEA', color: '#C0321A' },
};

export interface Quote {
  id: string;
  ref: string;
  customer_id: string | null;
  customer_name: string;
  contact_name: string | null;
  contact_email: string | null;
  salesperson_id: string | null;
  salesperson_name: string;
  status: QuoteStatus;
  total: number;
  notes: string | null;
  quote_date: string;
  outcome_date: string | null;
  lost_reason: string | null;
  won_at: string | null;
  pdf_path: string | null;
  pdf_filename: string | null;
  files: QuoteFile[];
}

export interface QuoteFile {
  path: string;
  name: string;
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
  user_id: string | null;
}

export const fmtMoney = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const isDecided = (s: QuoteStatus) => s === 'Won' || s === 'Lost';

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
  const [adminView, setAdminView] = useState<string>('all'); // 'all' | salesperson id (admins only)
  const [month, setMonth] = useState<string>(''); // 'YYYY-MM' or '' (all)
  const [monthBasis, setMonthBasis] = useState<'created' | 'status'>('created');
  const [modal, setModal] = useState<{ mode: 'new' } | { mode: 'edit'; quote: Quote } | null>(null);

  const fetchAll = async () => {
    setError(null);
    const [q, c, cc, u] = await Promise.all([
      supabase.from('sales_quotations').select('*').order('quote_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name, email').order('name'),
      supabase.from('customer_contacts').select('customer_id, name, email, position, created_at').order('position').order('created_at'),
      supabase.from('sales_people').select('id, name, is_active, user_id').order('name'),
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
    setSalesUsers(((u.data ?? []) as Array<{ id: string; name: string; is_active: boolean; user_id: string | null }>).map((r) => ({ id: r.id, full_name: r.name, is_active: r.is_active, user_id: r.user_id })));
    setLoading(false);
  };

  useEffect(() => { void fetchAll(); }, []);

  const setStatus = async (quote: Quote, status: QuoteStatus) => {
    if (!canEdit || quote.status === status) return;
    // Lost needs a mandatory reason — open the modal pre-set to Lost rather than moving silently.
    if (status === 'Lost') {
      setModal({ mode: 'edit', quote: { ...quote, status: 'Lost', outcome_date: quote.outcome_date ?? todayStr() } });
      return;
    }
    // Dragging into Won stamps today as the outcome date (editable later in the modal).
    const outcome_date = isDecided(status) ? (quote.outcome_date ?? todayStr()) : null;
    const won_at = status === 'Won' ? new Date().toISOString() : null;
    setQuotes((qs) => qs.map((q) => (q.id === quote.id ? { ...q, status, outcome_date, won_at } : q)));
    const { error: err } = await supabase
      .from('sales_quotations')
      .update({ status, outcome_date, won_at, updated_at: new Date().toISOString() })
      .eq('id', quote.id);
    if (err) { setError(err.message); void fetchAll(); }
  };

  // The pipeline is each user's OWN leads. Map the signed-in login to their
  // salesperson record (linked in the Sales Manager tab); seeded rows share the id.
  const myPerson = salesUsers.find((u) => u.user_id === user.id || u.id === user.id) ?? null;
  // Department admins (delete access) can view any salesperson's pipeline (or all).
  const isAdmin = canDelete;
  const activeSales = salesUsers.filter((u) => u.is_active);

  const scoped = isAdmin
    ? (adminView === 'all' ? quotes : quotes.filter((q) => q.salesperson_id === adminView))
    : (myPerson ? quotes.filter((q) => q.salesperson_id === myPerson.id) : []);

  // When creating a new quote: the viewed salesperson (admin) or the signed-in user.
  const defaultPerson = isAdmin
    ? ((adminView !== 'all' ? salesUsers.find((u) => u.id === adminView) : myPerson) ?? myPerson ?? activeSales[0] ?? null)
    : myPerson;
  const canCreate = isAdmin ? activeSales.length > 0 : !!myPerson;

  // Filters (within the scoped pipeline)
  const visible = scoped.filter((q) => {
    if (statusFilter !== 'all' && q.status !== statusFilter) return false;
    if (month) {
      const d = monthBasis === 'status' ? q.outcome_date : q.quote_date;
      if (!d || !d.startsWith(month)) return false;
    }
    const s = search.trim().toLowerCase();
    if (s && !`${q.ref} ${q.customer_name} ${q.salesperson_name}`.toLowerCase().includes(s)) return false;
    return true;
  });

  // KPIs (scoped pipeline)
  const open = scoped.filter((q) => q.status === 'Draft' || q.status === 'Sent');
  const won = scoped.filter((q) => q.status === 'Won');
  const lost = scoped.filter((q) => q.status === 'Lost');
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
        <KPICard accent label="Pipeline Value" value={fmtMoney(pipelineValue)} sub={`${open.length} open quote${open.length === 1 ? '' : 's'}`} />
        <KPICard label="Won Value" value={fmtMoney(wonValue)} sub={`${won.length} won`} />
        <KPICard label="Engaging Leads" value={String(open.length)} sub={`${scoped.filter((q) => q.status === 'Sent').length} awaiting response`} />
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
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          title="Filter by month"
          style={{ padding: '6px 12px', borderRadius: 99, border: `1px solid ${month ? C.green : '#EBEBEB'}`, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, color: month ? C.green : C.slate, background: C.white, outline: 'none', cursor: 'pointer' }} />
        {month && (
          <>
            <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 10, padding: 3, border: '1px solid #EBEBEB' }}>
              {([['created', 'Created'], ['status', 'Status date']] as const).map(([b, l]) => (
                <button key={b} onClick={() => setMonthBasis(b)}
                  style={{ padding: '5px 12px', borderRadius: 8, border: 'none', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: monthBasis === b ? C.green : 'transparent', color: monthBasis === b ? C.white : C.slate }}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={() => setMonth('')} style={pill(false)}>Clear month</button>
          </>
        )}
        {isAdmin && (
          <div style={{ width: isMobile ? '100%' : 240 }}>
            <SearchSelect
              value={adminView}
              options={[
                { value: 'all', label: 'All salespeople' },
                ...salesUsers.map((u) => ({ value: u.id, label: u.is_active ? u.full_name : `${u.full_name} (inactive)` })),
              ]}
              onChange={setAdminView}
              placeholder="Viewing: All salespeople"
            />
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 10, padding: 3, border: '1px solid #EBEBEB' }}>
            {([['pipeline', 'Pipeline'], ['list', 'List']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ padding: '6px 14px', borderRadius: 8, border: 'none', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: view === k ? C.green : 'transparent', color: view === k ? C.white : C.slate }}>
                {l}
              </button>
            ))}
          </div>
          {canEdit && canCreate && (
            <button onClick={() => setModal({ mode: 'new' })}
              style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + New Quote
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading quotations…</div>
      ) : !isAdmin && !myPerson ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px dashed #EBEBEB', padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'inline-flex' }}><Handshake size={32} strokeWidth={1.5} color={C.slate} /></div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>Your login isn't linked to a salesperson</div>
          <div style={{ fontSize: 12, color: C.slate }}>Ask an admin to link your account in the Sales Manager tab to start managing your pipeline.</div>
        </div>
      ) : scoped.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px dashed #EBEBEB', padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'inline-flex' }}><Handshake size={32} strokeWidth={1.5} color={C.slate} /></div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>
            {isAdmin && adminView === 'all' ? 'No quotes yet' : 'No quotes in this pipeline yet'}
          </div>
          <div style={{ fontSize: 12, color: C.slate }}>Create a quote for a customer from the Customers tab.</div>
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
          salespersonId={defaultPerson?.id ?? ''}
          salespersonName={defaultPerson?.full_name ?? ''}
          salespeople={activeSales}
          lockSalesperson={!isAdmin}
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
                <span style={{ marginLeft: 'auto', fontSize: 11, color: C.slate, fontWeight: 600 }}>{fmtMoney(colValue)}</span>
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
                    {q.pdf_path && (
                      <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: C.honeydew, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>PDF</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.customer_name}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{fmtMoney(Number(q.total))}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.slate, overflow: 'hidden' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.salesperson_name}</span>
                    <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>{q.quote_date}</span>
                  </div>
                  {q.notes && q.notes.trim() && (
                    <div style={{ fontSize: 11, color: C.slate, background: C.seasalt, borderRadius: 8, padding: '6px 8px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>
                      {q.notes}
                    </div>
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
            {['Ref', 'Customer', 'Salesperson', 'Value', 'Status', 'Date', 'PDF'].map((h) => <th key={h} style={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => (
            <tr key={q.id} onClick={() => onOpen(q)} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>{q.ref}</td>
              <td style={{ padding: '13px 16px', fontWeight: 600 }}>{q.customer_name}</td>
              <td style={{ padding: '13px 16px', color: C.slate }}>{q.salesperson_name}</td>
              <td style={{ padding: '13px 16px', fontWeight: 700, color: C.green }}>{fmtMoney(Number(q.total))}</td>
              <td style={{ padding: '13px 16px' }}><QuoteBadge status={q.status} /></td>
              <td style={{ padding: '13px 16px', color: C.slate }}>{q.quote_date}</td>
              <td style={{ padding: '13px 16px', color: C.slate }}>{q.pdf_path ? '✓' : '—'}</td>
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

function QuoteModal({ quote, customers, salespersonId, salespersonName, salespeople, lockSalesperson, canEdit, canDelete, onClose, onSaved }: {
  quote: Quote | null;
  customers: CustomerOpt[];
  salespersonId: string;
  salespersonName: string;
  salespeople: SalesUser[];
  lockSalesperson: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = quote === null;
  const readOnly = !canEdit;

  const [form, setForm] = useState(() => ({
    customer_id: quote?.customer_id ?? '',
    customer_name: quote?.customer_name ?? '',
    contact_name: quote?.contact_name ?? '',
    contact_email: quote?.contact_email ?? '',
    salesperson_id: quote?.salesperson_id ?? salespersonId,
    salesperson_name: quote?.salesperson_name ?? salespersonName,
    status: quote?.status ?? ('Draft' as QuoteStatus),
    total: quote?.total ?? 0,
    notes: quote?.notes ?? '',
    quote_date: quote?.quote_date ?? todayStr(),
    outcome_date: quote?.outcome_date ?? '',
    lost_reason: quote?.lost_reason ?? '',
  }));

  // Picking Won/Lost reveals an editable status-change date (defaults to today);
  // Lost also requires a reason.
  const changeStatus = (status: QuoteStatus) =>
    setForm((f) => ({
      ...f,
      status,
      outcome_date: isDecided(status) ? (f.outcome_date || todayStr()) : '',
      lost_reason: status === 'Lost' ? f.lost_reason : '',
    }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Amount as free text so the user can type or PASTE "$50,000.00" / "50,000";
  // we strip everything but digits and a decimal point to derive the number.
  const [amountText, setAmountText] = useState(quote?.total ? String(quote.total) : '');
  const setAmount = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    setAmountText(cleaned);
    setForm((f) => ({ ...f, total: Number(cleaned) || 0 }));
  };
  // Files: already-uploaded ones kept on the quote, plus freshly-picked ones
  // pending upload. Back-compat: fall back to the legacy single pdf_path.
  const initialFiles: QuoteFile[] = quote?.files?.length
    ? quote.files
    : (quote?.pdf_path ? [{ path: quote.pdf_path, name: quote.pdf_filename ?? 'quotation.pdf' }] : []);
  const [existingFiles, setExistingFiles] = useState<QuoteFile[]>(initialFiles);
  const [newFiles, setNewFiles] = useState<File[]>([]);

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    const pdfs = picked.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length !== picked.length) setError('Only PDF files can be attached.');
    else setError(null);
    if (pdfs.length) setNewFiles((prev) => [...prev, ...pdfs]);
  };

  const viewFile = async (path: string) => {
    const { data } = await supabase.storage.from('sales-quotations').createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  const customerOptions: SelectOption[] = [
    ...customers.map((c) => ({ value: c.id, label: c.name })),
    ...(form.customer_id && !customers.some((c) => c.id === form.customer_id)
      ? [{ value: form.customer_id, label: `${form.customer_name} (removed)` }]
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

  const total = Math.max(0, Number(form.total) || 0);
  // Files are optional — a quote can be saved once a customer, salesperson and amount are set.
  // A Lost quote additionally requires a lost reason.
  const lostReasonOk = form.status !== 'Lost' || form.lost_reason.trim().length > 0;
  const canSave = !!form.customer_id && !!form.salesperson_id && total > 0 && lostReasonOk && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    // Upload any newly-picked files; keep the already-attached ones.
    const uploaded: QuoteFile[] = [];
    for (const file of newFiles) {
      const safe = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const path = `quote_${Date.now()}_${Math.round(performance.now() % 1000)}_${safe}`;
      const { error: upErr } = await supabase.storage.from('sales-quotations').upload(path, file, { upsert: true, contentType: 'application/pdf' });
      if (upErr) { setError(`Upload failed (${file.name}): ${upErr.message}`); setSaving(false); return; }
      uploaded.push({ path, name: file.name });
    }
    const files = [...existingFiles, ...uploaded];

    const payload = {
      customer_id: form.customer_id || null,
      customer_name: form.customer_name,
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      salesperson_id: form.salesperson_id || null,
      salesperson_name: form.salesperson_name,
      status: form.status,
      total,
      notes: form.notes || null,
      files,
      quote_date: form.quote_date || todayStr(),
      outcome_date: isDecided(form.status) ? (form.outcome_date || todayStr()) : null,
      lost_reason: form.status === 'Lost' ? form.lost_reason.trim() : null,
      // keep the legacy single-pdf columns in sync (first file) for list/Kanban badges
      pdf_path: files[0]?.path ?? null,
      pdf_filename: files[0]?.name ?? null,
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

        <div>
          <label style={label}>Status</label>
          <select value={form.status} disabled={readOnly} onChange={(e) => changeStatus(e.target.value as QuoteStatus)} style={input(readOnly)}>
            {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {isDecided(form.status) && (
          <div>
            <label style={label}>{form.status} Date</label>
            <input type="date" value={form.outcome_date} disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, outcome_date: e.target.value }))} style={input(readOnly)} />
            <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>When this quote was marked {form.status.toLowerCase()}.</div>
          </div>
        )}
        {form.status === 'Lost' && (
          <div>
            <label style={label}>Lost Reason <span style={{ color: '#C0321A' }}>*</span></label>
            <textarea value={form.lost_reason} disabled={readOnly} rows={2}
              onChange={(e) => setForm((f) => ({ ...f, lost_reason: e.target.value }))}
              placeholder="Why was this quote lost? (e.g. price, competitor, project cancelled)"
              style={{ ...input(readOnly), resize: 'vertical', lineHeight: 1.5, borderColor: form.lost_reason.trim() ? '#EBEBEB' : '#FDEAEA' }} />
            {!form.lost_reason.trim() && (
              <div style={{ fontSize: 11, color: '#C0321A', marginTop: 4 }}>A lost reason is required to save.</div>
            )}
          </div>
        )}

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
          {lockSalesperson || readOnly ? (
            <input value={form.salesperson_name} disabled style={input(true)} />
          ) : (
            <SearchSelect
              value={form.salesperson_id}
              options={[
                ...salespeople.map((u) => ({ value: u.id, label: u.full_name })),
                ...(form.salesperson_id && !salespeople.some((u) => u.id === form.salesperson_id)
                  ? [{ value: form.salesperson_id, label: `${form.salesperson_name} (inactive)` }]
                  : []),
              ]}
              onChange={(id) => {
                const u = salespeople.find((x) => x.id === id);
                setForm((f) => ({ ...f, salesperson_id: id, salesperson_name: u?.full_name ?? f.salesperson_name }));
              }}
              placeholder="— Select salesperson —"
            />
          )}
        </div>

        {/* Final amount */}
        <div>
          <label style={label}>Final Amount ($)</label>
          <input type="text" inputMode="decimal" value={amountText} disabled={readOnly}
            onChange={(e) => setAmount(e.target.value)}
            onPaste={(e) => { e.preventDefault(); setAmount(amountText + e.clipboardData.getData('text')); }}
            placeholder="0.00" style={{ ...input(readOnly), fontSize: 15, fontWeight: 700, color: C.green }} />
        </div>

        {/* Created date */}
        <div>
          <label style={label}>Created Date</label>
          <input type="date" value={form.quote_date} disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, quote_date: e.target.value }))} style={input(readOnly)} />
        </div>

        {/* Quotation files */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ ...label, marginBottom: 0 }}>Quotation Files (PDF)</label>
          {(existingFiles.length > 0 || newFiles.length > 0) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {existingFiles.map((f, i) => (
                <div key={`e-${f.path}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white }}>
                  <FileText size={14} color={C.slate} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <button type="button" onClick={() => void viewFile(f.path)} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>View</button>
                  {!readOnly && (
                    <button type="button" onClick={() => setExistingFiles((prev) => prev.filter((_, idx) => idx !== i))} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <X size={12} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              ))}
              {newFiles.map((f, i) => (
                <div key={`n-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: '1px dashed #CBD5DD', background: C.seasalt }}>
                  <FileUp size={14} color={C.slate} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>New</span>
                  {!readOnly && (
                    <button type="button" onClick={() => setNewFiles((prev) => prev.filter((_, idx) => idx !== i))} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <X size={12} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: C.slate }}>No files attached yet.</span>
          )}
          {!readOnly && (
            <label style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <FileUp size={14} strokeWidth={2.25} /> Add PDF{(existingFiles.length + newFiles.length) > 0 ? 's' : ''}
              <input type="file" accept="application/pdf" multiple style={{ display: 'none' }} onChange={pickFiles} />
            </label>
          )}
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
