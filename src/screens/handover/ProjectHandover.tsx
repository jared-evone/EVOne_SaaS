import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, X, ArrowLeft, Download, Trash2, ClipboardCheck, FileUp, Paperclip, Pencil, Check, RotateCcw } from 'lucide-react';
import { C } from '../../theme';
import { KPICard } from '../../components/KPICard';
import { SearchSelect } from '../../components/SearchSelect';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../permissions';
import { RegistryHandoff } from './RegistryHandoff';
import {
  BRANDS, FILE_KINDS, LANDLORD_DOCS, PLATFORMS, SCOPE_LABEL, FLOOR_LABEL, SECTION_TITLES, DC_SPECS,
  kwOptionsFor, ampsOf, isDc, blankState, normaliseState, buildChecklist, templateChecklist, progressOf, paymentStatus,
  chargerCount, totalLoad, lewGrade, ltaFeeTotal, ltaFeePer, installLists, chargerFromItemName, onPlatform, blewInvolved,
  DEFAULT_PM_USER_ID, CABLE_CATEGORY, NOTE_KINDS, namesQuote, followQuoteNo,
  type HandoverState, type HandoverCharger, type HandoverInfo, type FlagKey, type CheckSection, type CheckItem, type ChecklistCustom, type CheckOwner, type NoteKind,
  type PendingItem, type PendingOwner, type FileKind, type Brand,
} from './handoverRules';

// Project Handover (Sales → Project Manager). One row per job in
// sales_handovers, linked to the won quotation it came from; the checklist is
// built from the options chosen here (see handoverRules.ts).

type HandoverStatus = 'Draft' | 'Handed over' | 'In progress' | 'Completed';
const STATUSES: HandoverStatus[] = ['Draft', 'Handed over', 'In progress', 'Completed'];
const STATUS_COLORS: Record<HandoverStatus, { bg: string; color: string }> = {
  Draft:         { bg: '#F3F3F3', color: '#767B77' },
  'Handed over': { bg: '#E3F0FF', color: '#1A62C0' },
  'In progress': { bg: '#FFF8E1', color: '#B07D00' },
  Completed:     { bg: '#E4F3E3', color: '#1B512D' },
};
const BUCKET = 'sales-handover-docs';

interface HandoverRow {
  id: string;
  quote_id: string | null;
  customer_id: string | null;
  company: string;
  salesperson_id: string | null;
  sales: string | null;
  pm: string | null;
  hdate: string | null;
  status: HandoverStatus;
  state: unknown;
  checks: Record<string, boolean> | null;
  done: number;
  total: number;
  created_by: string | null;
  updated_at: string;
}
interface QuotePdf { path: string; name: string; quote_no?: string | null }
interface WonQuote {
  id: string; ref: string; status: string; customer_id: string | null; customer_name: string; salesperson_id: string | null; salesperson_name: string;
  won_final_price: number | null; ehvcg: boolean | null;
  pdf_path: string | null; pdf_filename: string | null; files: QuotePdf[] | null;
  versions: { pdf_path?: string | null; pdf_filename?: string | null; files?: QuotePdf[] | null }[] | null;
}
const QUOTE_COLS = 'id, ref, status, customer_id, customer_name, salesperson_id, salesperson_name, won_final_price, ehvcg, pdf_path, pdf_filename, files, versions';
const QUOTE_BUCKET = 'sales-quotations';
/** Every quotation PDF attached to the sale, across all its versions (older rows keep theirs in files / pdf_path). */
const quotePdfs = (q: WonQuote | undefined): QuotePdf[] => {
  if (!q) return [];
  const all: QuotePdf[] = [
    ...(Array.isArray(q.versions) ? q.versions : []).flatMap((v) => (v.files?.length ? v.files : v.pdf_path ? [{ path: v.pdf_path, name: v.pdf_filename ?? 'quotation.pdf' }] : [])),
    ...(Array.isArray(q.files) ? q.files : []),
    ...(q.pdf_path ? [{ path: q.pdf_path, name: q.pdf_filename ?? 'quotation.pdf' }] : []),
  ];
  const seen = new Set<string>();
  return all.filter((f) => !!f?.path && !seen.has(f.path) && !!seen.add(f.path));
};
/** How an attached quotation is named on screen: the quotation no. keyed in on the sale, else the EV1QO number in the file name, else the file name. */
const quoteDocLabel = (f: QuotePdf) =>
  f.quote_no?.trim() || f.name.match(/EV1QO[-_ ]?\d+(?:[-_ ]?v\d+)?/i)?.[0] || f.name.replace(/\.pdf$/i, '');
/** The quotation number(s) the Sales Pipeline holds for a sale — '' while no quotation is attached to it. */
const pipelineQuoteNo = (q: WonQuote | undefined) => [...new Set(quotePdfs(q).map(quoteDocLabel))].join(' / ');
/** What a picker shows under a won quotation: who sold it and its final price. */
const quoteSub = (q: WonQuote) => `${q.salesperson_name}${q.won_final_price ? ` · ${money(q.won_final_price)} after GST` : ''}`;
/** Opens a stored file in a new tab; returns what went wrong if it can't. */
async function openStored(bucket: string, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data) return error?.message ?? 'unknown error';
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  return null;
}
const money = (n: number) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
interface Refs {
  quotes: WonQuote[];
  customers: { id: string; name: string; address: string | null; type: string | null }[];
  salespeople: { id: string; name: string }[];
  accounts: { id: string; full_name: string | null; email: string }[];
  /** Main cable sizes, from the Quote Machine catalogue. */
  cables: string[];
}
/** The name the default Project Manager goes by in the PM picker ('' if that account is gone). */
const defaultPmName = (refs: Refs) => {
  const a = refs.accounts.find((x) => x.id === DEFAULT_PM_USER_ID);
  return a ? (a.full_name || a.email) : '';
};

type EditCard = 'B' | 'C' | 'D';
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDateTime = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? 'No date' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };
const cardStyle: React.CSSProperties = { background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14 };
const ghostBtn: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };

function Pill({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: bg, color, whiteSpace: 'nowrap' }}>{children}</span>;
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.slate, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}
function Seg<T extends string>({ value, options, onChange, disabled }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map(([v, t]) => (
        <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)}
          style={{ padding: '8px 12px', borderRadius: 8, border: value === v ? 'none' : '1px solid #EBEBEB', background: value === v ? C.green : C.white, color: value === v ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
          {t}
        </button>
      ))}
    </div>
  );
}
function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)}
      style={{ padding: '7px 12px', borderRadius: 99, border: `1px solid ${on ? C.green : '#EBEBEB'}`, background: on ? C.honeydew : C.white, color: on ? C.green : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
      {on ? '✓ ' : ''}{label}
    </button>
  );
}

export function ScreenProjectHandover() {
  const { can, user, isAdmin } = usePermissions();
  const canEdit = can('sales_handover', 'can_edit');
  const canDelete = can('sales_handover', 'can_delete');
  const me = user.full_name || user.email;

  const [rows, setRows] = useState<HandoverRow[]>([]);
  const [refs, setRefs] = useState<Refs>({ quotes: [], customers: [], salespeople: [], accounts: [], cables: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | HandoverStatus>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const [h, q, c, sp, u, cb] = await Promise.all([
      supabase.from('sales_handovers').select('*').order('updated_at', { ascending: false }),
      // Every status, not just Won: a handover stays linked (and keeps showing the
      // sale's PDFs) if its quote is later moved in the pipeline. Pickers list Won only.
      supabase.from('sales_quotations').select(QUOTE_COLS).order('quote_date', { ascending: false }),
      supabase.from('customers').select('id, name, address, type').order('name'),
      supabase.from('sales_people').select('id, name').order('name'),
      supabase.from('app_users').select('id, full_name, email, is_active').order('full_name'),
      supabase.from('quote_catalog_items').select('name').eq('category', CABLE_CATEGORY).eq('is_active', true),
    ]);
    const err = h.error ?? q.error ?? c.error ?? sp.error ?? u.error;
    if (err) { setError(err.message); setLoading(false); return; }
    setError(null);
    setRows((h.data ?? []) as HandoverRow[]);
    setRefs({
      quotes: (q.data ?? []) as WonQuote[],
      customers: (c.data ?? []) as Refs['customers'],
      salespeople: (sp.data ?? []) as Refs['salespeople'],
      accounts: ((u.data ?? []) as (Refs['accounts'][number] & { is_active: boolean | null })[]).filter((a) => a.is_active !== false),
      // Smallest conductor first; the list is only a convenience, so a failed read just leaves it empty.
      cables: [...new Set(((cb.data ?? []) as { name: string }[]).map((x) => x.name.trim()).filter(Boolean))]
        .sort((a, b) => (Number(a.match(/x(\d+)\s*mm/i)?.[1]) || 0) - (Number(b.match(/x(\d+)\s*mm/i)?.[1]) || 0) || a.localeCompare(b)),
    });
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const quoteRef = (id: string | null) => (id ? refs.quotes.find((q) => q.id === id)?.ref ?? null : null);
  const quoteDocs = (id: string | null) => (id ? quotePdfs(refs.quotes.find((q) => q.id === id)) : []);
  const ql = search.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!ql) return true;
    const st = normaliseState(r.state);
    return [r.company, r.sales, r.pm, quoteRef(r.quote_id), ...quoteDocs(r.quote_id).flatMap((f) => [quoteDocLabel(f), f.name]), st.info.quote, st.info.site, st.info.contractor].join(' ').toLowerCase().includes(ql);
  });

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.slate, fontSize: 13 }}>Loading…</div>;

  const open = openId ? rows.find((r) => r.id === openId) ?? null : null;
  if (open) {
    return (
      <HandoverEditor key={open.id} row={open} refs={refs} canEdit={canEdit} canDelete={canDelete} isAdmin={isAdmin} me={me}
        takenQuoteIds={rows.filter((r) => r.id !== open.id && r.quote_id).map((r) => r.quote_id as string)}
        onBack={async () => { setOpenId(null); await load(); }} />
    );
  }

  const count = (s: HandoverStatus) => rows.filter((r) => r.status === s).length;
  const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#1a1a1a', verticalAlign: 'top' };
  const pill = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 99, border: active ? 'none' : '1px solid #EBEBEB', background: active ? C.green : C.white, color: active ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        <KPICard label="Handovers" value={String(rows.length)} sub="Sales to Project Manager" accent />
        <KPICard label="Draft" value={String(count('Draft'))} sub="not handed over yet" />
        <KPICard label="In progress" value={String(count('Handed over') + count('In progress'))} sub="with the Project Manager" />
        <KPICard label="Completed" value={String(count('Completed'))} sub="closed jobs" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 240 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, quote, PM…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        {(['all', ...STATUSES] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} style={pill(statusFilter === s)}>{s === 'all' ? 'All' : s}</button>
        ))}
        {canEdit && (
          <button onClick={() => setCreating(true)}
            style={{ marginLeft: 'auto', padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> New handover
          </button>
        )}
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Company', 'Quotation · EVOne quotation', 'Sales', 'Project Manager', 'Handover', 'Checklist', 'Status', 'Payment'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const st = normaliseState(r.state);
              const pay = paymentStatus(st, r.checks ?? {});
              const sc = STATUS_COLORS[r.status] ?? STATUS_COLORS.Draft;
              const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
              const docs = quoteDocs(r.quote_id);
              return (
                <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <td style={td}>
                    <div style={{ fontWeight: 700, color: C.green }}>{r.company || 'Untitled handover'}</div>
                    {st.info.site && <div style={{ fontSize: 12, color: C.slate, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.info.site}</div>}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {quoteRef(r.quote_id) ?? (st.info.quote || '—')}
                    {!r.quote_id && <div style={{ fontSize: 11, color: '#B45309', fontWeight: 700 }}>Not linked</div>}
                    {st.ehvcg && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: '#F0E8FF', color: '#6B21A8', letterSpacing: '0.04em' }}>EHVCG</span>}
                    {docs.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, marginTop: 3 }}>
                        {docs.slice(0, 3).map((f) => (
                          <button key={f.path} type="button" title={`Open ${f.name}`}
                            onClick={(e) => { e.stopPropagation(); void openStored(QUOTE_BUCKET, f.path).then((err) => { if (err) setError(`Could not open the quotation: ${err}`); }); }}
                            style={{ border: 'none', background: 'none', padding: 0, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: 220 }}>
                            <Paperclip size={11} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quoteDocLabel(f)}</span>
                          </button>
                        ))}
                        {docs.length > 3 && <span style={{ fontSize: 11, color: C.slate }}>+{docs.length - 3} more</span>}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, color: C.slate }}>{r.sales || '—'}</td>
                  <td style={{ ...td, color: C.slate }}>{r.pm || '—'}</td>
                  <td style={{ ...td, color: C.slate, whiteSpace: 'nowrap' }}>{fmtDate(r.hdate)}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 80, height: 6, borderRadius: 99, background: '#EBEBEB', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: C.green }} /></div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.slate, whiteSpace: 'nowrap' }}>{r.done}/{r.total}</span>
                    </div>
                  </td>
                  <td style={td}><Pill bg={sc.bg} color={sc.color}>{r.status}</Pill></td>
                  <td style={td}>{st.info.contractor.trim()
                    ? <Pill bg={pay.cleared ? '#E4F3E3' : '#FFF0E0'} color={pay.cleared ? '#1B512D' : '#B45309'}>{pay.cleared ? 'Cleared' : 'On hold'}</Pill>
                    : <span style={{ fontSize: 12, color: C.slate }}>—</span>}</td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '48px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                <ClipboardCheck size={32} strokeWidth={1.5} color={C.slate} style={{ display: 'block', margin: '0 auto 10px' }} />
                {rows.length ? 'No handovers match these filters.' : 'No handovers yet. Start one from a won quotation with "New handover".'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <NewHandoverModal refs={refs} rows={rows} me={me}
          onClose={() => setCreating(false)}
          onOpenExisting={(id) => { setCreating(false); setOpenId(id); }}
          onCreated={async (id) => { setCreating(false); await load(); setOpenId(id); }} />
      )}
    </div>
  );
}

// Everything a won quotation can tell a new handover. Only used to fill blanks.
async function prefillFromQuote(q: WonQuote, refs: Refs): Promise<{ state: HandoverState; company: string }> {
  const s = blankState();
  const cust = q.customer_id ? refs.customers.find((c) => c.id === q.customer_id) : undefined;
  const company = cust?.name ?? q.customer_name;
  s.info.project = company;
  s.info.quoteSynced = pipelineQuoteNo(q);
  s.info.quote = s.info.quoteSynced || q.ref;
  s.info.sales = q.salesperson_name;
  s.info.hdate = todayISO();
  s.info.site = cust?.address ?? '';
  s.ehvcg = !!q.ehvcg;
  const [contacts, lines] = await Promise.all([
    q.customer_id ? supabase.from('customer_contacts').select('name, phone, position').eq('customer_id', q.customer_id).order('position').order('created_at') : Promise.resolve({ data: [] as { name: string | null; phone: string | null }[] }),
    supabase.from('sales_order_lines').select('item_name, qty').eq('quote_id', q.id).order('position').order('created_at'),
  ]);
  const cs = ((contacts.data ?? []) as { name: string | null; phone: string | null }[]).filter((c) => c.name || c.phone).map((c) => ({ name: c.name ?? '', phone: c.phone ?? '' }));
  if (cs.length) s.contacts = cs;
  s.chargers = ((lines.data ?? []) as { item_name: string; qty: number }[]).map((l) => chargerFromItemName(l.item_name, l.qty));
  return { state: s, company };
}

function NewHandoverModal({ refs, rows, me, onClose, onCreated, onOpenExisting }: {
  refs: Refs; rows: HandoverRow[]; me: string;
  onClose: () => void; onCreated: (id: string) => Promise<void>; onOpenExisting: (id: string) => void;
}) {
  const [quoteId, setQuoteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const quote = refs.quotes.find((q) => q.id === quoteId);
  const existing = quoteId ? rows.find((r) => r.quote_id === quoteId) : undefined;

  const create = async (blank: boolean) => {
    setBusy(true);
    setErr(null);
    let state = blankState();
    let company = '';
    if (!blank && quote) ({ state, company } = await prefillFromQuote(quote, refs));
    else state.info.hdate = todayISO();
    if (!state.info.pm.trim()) state.info.pm = defaultPmName(refs);
    const { done, total } = progressOf(state, {});
    const { data, error } = await supabase.from('sales_handovers').insert({
      quote_id: blank ? null : quote?.id ?? null, customer_id: blank ? null : quote?.customer_id ?? null,
      company, salesperson_id: blank ? null : quote?.salesperson_id ?? null,
      sales: state.info.sales || null, pm: state.info.pm || null, hdate: state.info.hdate || null,
      status: 'Draft', state, checks: {}, done, total, created_by: me,
    }).select('id').single();
    setBusy(false);
    if (error || !data) { setErr(error?.message ?? 'Could not create the handover.'); return; }
    await onCreated((data as { id: string }).id);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 520, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>New handover</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>Pick the won quotation — the client, salesperson, contacts and chargers are filled in from it. A quotation that already has a handover isn't listed.</div>
          </div>
          <button onClick={onClose} disabled={busy} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree', flexShrink: 0 }}>×</button>
        </div>
        <Field label="Won quotation">
          <SearchSelect value={quoteId} onChange={setQuoteId} placeholder="Select a won quotation…" emptyText="No won quotations match"
            options={refs.quotes.filter((q) => q.status === 'Won' && !rows.some((r) => r.quote_id === q.id)).map((q) => ({ value: q.id, label: `${q.ref} · ${q.customer_name}`, sub: quoteSub(q) }))} />
        </Field>
        {quote && !existing && (
          <div style={{ fontSize: 12, color: C.slate, marginTop: -8 }}>
            {(() => { const n = quotePdfs(quote).length; return n ? `${n} quotation PDF${n === 1 ? '' : 's'} attached to this sale ${n === 1 ? 'comes' : 'come'} across with it.` : 'No quotation PDF is attached to this sale yet.'; })()}
          </div>
        )}
        {existing && (
          <div style={{ background: '#FFF8E1', color: '#B07D00', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 180 }}>{quote?.ref} already has a handover ({existing.status}).</span>
            <button onClick={() => onOpenExisting(existing.id)} style={{ ...ghostBtn, borderColor: '#B07D00', color: '#B07D00' }}>Open it</button>
          </div>
        )}
        {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={() => void create(true)} disabled={busy} style={ghostBtn}>Start blank (no quotation)</button>
          <button onClick={() => void create(false)} disabled={busy || !quote}
            style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: busy || !quote ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: busy || !quote ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Creating…' : 'Create handover'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Draft {
  company: string;
  quote_id: string | null;
  customer_id: string | null;
  salesperson_id: string | null;
  status: HandoverStatus;
  state: HandoverState;
  checks: Record<string, boolean>;
}

function HandoverEditor({ row, refs, canEdit, canDelete, isAdmin, me, takenQuoteIds, onBack }: {
  row: HandoverRow; refs: Refs; canEdit: boolean; canDelete: boolean; isAdmin: boolean; me: string;
  /** Quotations other handovers are already linked to — not offered here. */
  takenQuoteIds: string[];
  onBack: () => Promise<void>;
}) {
  const [doc, setDoc] = useState<Draft>(() => ({
    company: row.company, quote_id: row.quote_id, customer_id: row.customer_id, salesperson_id: row.salesperson_id,
    status: STATUSES.includes(row.status) ? row.status : 'Draft', state: normaliseState(row.state), checks: row.checks ?? {},
  }));
  const ro = !canEdit;
  // Autosave: every change is saved shortly after it is made. The save only
  // lands if nobody else has saved since this copy was loaded (updated_at
  // guard) — otherwise it stops and asks for a reload instead of overwriting.
  const [save, setSave] = useState<'saved' | 'dirty' | 'saving' | 'error' | 'conflict'>('saved');
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const version = useRef(row.updated_at);
  const latest = useRef(doc);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  latest.current = doc;

  const flush = async () => {
    if (!dirty.current || inFlight.current || ro) return;
    inFlight.current = true;
    dirty.current = false;
    setSave('saving');
    const d = latest.current;
    const { done, total } = progressOf(d.state, d.checks);
    const { data, error } = await supabase.from('sales_handovers').update({
      company: d.company.trim(), quote_id: d.quote_id, customer_id: d.customer_id, salesperson_id: d.salesperson_id,
      sales: d.state.info.sales.trim() || null, pm: d.state.info.pm.trim() || null, hdate: d.state.info.hdate || null,
      status: d.status, state: d.state, checks: d.checks, done, total, updated_at: new Date().toISOString(),
    }).eq('id', row.id).eq('updated_at', version.current).select('updated_at');
    inFlight.current = false;
    if (error) { dirty.current = true; setSave('error'); setSaveErr(error.message); return; }
    if (!data?.length) { setSave('conflict'); return; }
    version.current = (data[0] as { updated_at: string }).updated_at;
    if (dirty.current) void flush(); else setSave('saved');
  };
  const change = (fn: (d: Draft) => Draft) => {
    if (ro || save === 'conflict') return;
    setDoc(fn);
    dirty.current = true;
    setSave('dirty');
  };
  useEffect(() => {
    if (save !== 'dirty') return;
    const t = window.setTimeout(() => { void flush(); }, 900);
    return () => window.clearTimeout(t);
  }, [doc, save]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = doc.state;
  const setState = (fn: (s: HandoverState) => HandoverState) => change((d) => ({ ...d, state: fn(d.state) }));
  const setInfo = (patch: Partial<HandoverInfo>) => setState((x) => ({ ...x, info: { ...x.info, ...patch } }));
  const setFlag = (k: FlagKey, v: boolean) => setState((x) => ({ ...x, c: { ...x.c, [k]: v } }));

  // A handover with no Project Manager yet takes the default one (DEFAULT_PM_USER_ID in the rules).
  useEffect(() => {
    if (ro || doc.status === 'Completed' || doc.state.info.pm.trim()) return;
    const pm = defaultPmName(refs);
    if (pm) setInfo({ pm });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const checklist = useMemo(() => buildChecklist(s), [s]);
  // The checklist starts from the template for the options picked. Whoever
  // created the handover (or a department admin) can then reword, remove or
  // add items in each section — kept in state.custom, so the PDF and the
  // progress count follow. A removed template item is only hidden here.
  const canCustomise = !ro && (isAdmin || (!!row.created_by && row.created_by === me));
  const template = useMemo(() => templateChecklist(s), [s]);
  const [editing, setEditing] = useState<ReadonlySet<EditCard>>(new Set());
  const setCustom = (fn: (c: ChecklistCustom) => ChecklistCustom) => setState((x) => ({ ...x, custom: fn(x.custom) }));
  const toggleEditing = (card: EditCard) => {
    if (editing.has(card)) {
      // Done: drop blank rows and rewordings that match the template again.
      const tpl = new Map(template.map((i) => [i.id, i.text]));
      const cu = s.custom;
      const text = Object.fromEntries(Object.entries(cu.text).filter(([id, t]) => t.trim() && t.trim() !== tpl.get(id)));
      const added = cu.added.filter((a) => a.text.trim());
      if (Object.keys(text).length !== Object.keys(cu.text).length || added.length !== cu.added.length) setCustom((c) => ({ ...c, text, added }));
    }
    setEditing((e) => { const n = new Set(e); if (n.has(card)) n.delete(card); else n.add(card); return n; });
  };
  const { done, total } = progressOf(s, doc.checks);
  const pay = paymentStatus(s, doc.checks);
  const grade = lewGrade(s);
  const dcBrands = [...new Set(s.chargers.filter((c) => Number(c.qty) > 0 && isDc(c.kw)).map((c) => c.brand))];
  const cpo = s.ownership === 'cpo';
  const sitesFilled = [s.info.site, s.info.site2, s.info.site3, s.info.site4].map((a, i) => ({ n: String(i + 1) as HandoverCharger['site'], a })).filter((x) => x.a.trim() || x.n === '1');
  // The linked sale is re-read when this handover opens and whenever the window
  // comes back into focus, so everything shown from the Sales Pipeline (the
  // quotation number, its PDFs, the final price, the warranty) is current.
  const [freshQuote, setFreshQuote] = useState<WonQuote | null>(null);
  const [saleTick, setSaleTick] = useState(0);
  useEffect(() => {
    const id = doc.quote_id;
    if (!id) { setFreshQuote(null); return; }
    let live = true;
    const read = () => {
      void supabase.from('sales_quotations').select(QUOTE_COLS).eq('id', id).maybeSingle()
        .then(({ data }) => { if (live && data) setFreshQuote(data as unknown as WonQuote); });
      setSaleTick((n) => n + 1);
    };
    read();
    window.addEventListener('focus', read);
    return () => { live = false; window.removeEventListener('focus', read); };
  }, [doc.quote_id]);
  const linkedQuote = doc.quote_id ? (freshQuote && freshQuote.id === doc.quote_id ? freshQuote : refs.quotes.find((q) => q.id === doc.quote_id)) : undefined;
  const salesPdfs = quotePdfs(linkedQuote);

  // The quotation number follows the Sales Pipeline: when the sale's quotation
  // changes there, it changes here. What someone typed by hand (a PO number,
  // say) is never replaced — the field then says the two differ and offers the
  // pipeline's number. A completed handover is left as it was.
  const liveQuoteNo = pipelineQuoteNo(linkedQuote);
  const quoteTyped = s.info.quote.trim();
  const quoteFollows = !liveQuoteNo || !quoteTyped || namesQuote(quoteTyped, liveQuoteNo);
  useEffect(() => {
    if (ro || doc.status === 'Completed' || !linkedQuote) return;
    const change = followQuoteNo(s.info, liveQuoteNo, linkedQuote.ref);
    if (change) setInfo(change);
  }, [linkedQuote?.id, liveQuoteNo, doc.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploadKind, setUploadKind] = useState<FileKind>('Quotation');

  // The warranty sold with each charger is read from the sale (Sales Pipeline / Order Book), not kept here.
  const [saleLines, setSaleLines] = useState<{ item_name: string; qty: number; warranty_years: number | null }[]>([]);
  useEffect(() => {
    if (!doc.quote_id) { setSaleLines([]); return; }
    let live = true;
    void supabase.from('sales_order_lines').select('item_name, qty, warranty_years').eq('quote_id', doc.quote_id).order('position').order('created_at')
      .then(({ data }) => { if (live) setSaleLines((data ?? []) as { item_name: string; qty: number; warranty_years: number | null }[]); });
    return () => { live = false; };
  }, [doc.quote_id, saleTick]);
  const warrantyOf = (c: HandoverCharger): string => {
    const mine = saleLines.filter((l) => { const x = chargerFromItemName(l.item_name, l.qty); return x.brand === c.brand && x.kw === c.kw; });
    if (!mine.length) return '';
    const years = new Map<number, number>();
    for (const l of mine) if (l.warranty_years != null) years.set(Number(l.warranty_years), (years.get(Number(l.warranty_years)) ?? 0) + Number(l.qty));
    if (!years.size) return 'warranty not set on the sale';
    return `${[...years].map(([y, q]) => (years.size > 1 ? `${q} × ${y}-year` : `${y}-year`)).join(' · ')} warranty`;
  };

  const warrantyYearsFor = (c: HandoverCharger): string => {
    const years = new Set(saleLines.filter((l) => { const x = chargerFromItemName(l.item_name, l.qty); return x.brand === c.brand && x.kw === c.kw && l.warranty_years != null; }).map((l) => Number(l.warranty_years)));
    return years.size === 1 ? String([...years][0]) : '';
  };

  const [noteDraft, setNoteDraft] = useState<Record<NoteKind, string>>({ pm: '', status: '' });
  const [dropNote, setDropNote] = useState<string | null>(null);
  const noteCard = (key: string, title: string, body: string, onDelete: () => void) => (
    <div key={key} style={{ background: C.seasalt, borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 10, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</div>
        {!ro && dropNote !== key && (
          <button type="button" title="Delete this note" onClick={() => setDropNote(key)}
            style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}><Trash2 size={13} /></button>
        )}
      </div>
      <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginTop: 2 }}>{body}</div>
      {dropNote === key && (
        <div style={{ marginTop: 8, background: '#FDEAEA', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 140, fontSize: 12, fontWeight: 600, color: '#C0321A' }}>Delete this note? It can't be brought back.</span>
          <button type="button" onClick={() => setDropNote(null)} style={{ ...ghostBtn, padding: '5px 10px' }}>Cancel</button>
          <button type="button" onClick={() => { onDelete(); setDropNote(null); }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, delete</button>
        </div>
      )}
    </div>
  );
  const addNote = (kind: NoteKind) => {
    const text = noteDraft[kind].trim();
    if (!text) return;
    setState((x) => ({ ...x, noteLog: [...x.noteLog, { id: `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, text, at: new Date().toISOString(), by: me }] }));
    setNoteDraft((d) => ({ ...d, [kind]: '' }));
  };

  // Linking a quotation fills only what is still blank — nothing typed is replaced.
  const linkQuote = async (id: string) => {
    const q = refs.quotes.find((x) => x.id === id);
    if (!q) { change((d) => ({ ...d, quote_id: null })); return; }
    const pre = await prefillFromQuote(q, refs);
    change((d) => {
      const cur = d.state;
      const info = { ...cur.info };
      for (const k of ['project', 'quote', 'sales', 'site'] as const) if (!info[k].trim()) info[k] = pre.state.info[k];
      return {
        ...d, quote_id: q.id, customer_id: q.customer_id ?? d.customer_id, salesperson_id: q.salesperson_id ?? d.salesperson_id,
        company: d.company.trim() || pre.company,
        state: {
          ...cur, info,
          contacts: cur.contacts.some((c) => c.name.trim() || c.phone.trim()) ? cur.contacts : pre.state.contacts,
          chargers: cur.chargers.length ? cur.chargers : pre.state.chargers,
          ehvcg: cur.ehvcg || pre.state.ehvcg,
        },
      };
    });
    const n = quotePdfs(q).length;
    setNote(`Linked to ${q.ref}. Blank fields were filled from the quotation; anything already typed was kept.${n ? ` Its ${n} quotation PDF${n === 1 ? ' is' : 's are'} under Documents.` : ''}`);
  };

  const upload = async (list: FileList | null, kind: FileKind = uploadKind) => {
    if (!list?.length) return;
    setBusy(true);
    const added: HandoverState['files'] = [];
    let failed: string | null = null;
    for (const file of Array.from(list)) {
      if (file.size > 25 * 1024 * 1024) { failed = `${file.name} is over 25 MB.`; continue; }
      const path = `${row.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (error) { failed = `${file.name}: ${error.message}`; continue; }
      added.push({ path, name: file.name, kind, at: new Date().toISOString(), by: me });
    }
    setBusy(false);
    if (added.length) setState((x) => ({ ...x, files: [...x.files, ...added] }));
    setNote(failed ? `Could not upload — ${failed}` : `${added.length} file${added.length === 1 ? '' : 's'} uploaded.`);
  };
  const openFile = async (path: string, bucket: string = BUCKET) => {
    const err = await openStored(bucket, path);
    if (err) setNote(`Could not open the file: ${err}`);
  };
  const removeFile = async (path: string) => {
    setState((x) => ({ ...x, files: x.files.filter((f) => f.path !== path) }));
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) setNote(`Removed from the handover, but the stored file could not be deleted: ${error.message}`);
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      const { handoverPdfBlob } = await import('./HandoverPDF');
      const blob = await handoverPdfBlob({ company: doc.company, status: doc.status, state: s, checks: doc.checks, evoneQuotes: salesPdfs.map(quoteDocLabel) });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Project Handover - ${(doc.company || 'untitled').replace(/[\\/:*?"<>|]+/g, ' ')}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setNote(`Could not build the PDF: ${(e as Error).message}`);
    }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    const { error } = await supabase.from('sales_handovers').delete().eq('id', row.id);
    if (error) { setBusy(false); setNote(`Could not delete: ${error.message}`); return; }
    if (s.files.length) await supabase.storage.from(BUCKET).remove(s.files.map((f) => f.path));
    setBusy(false);
    await onBack();
  };

  const back = async () => { await flush(); await onBack(); };
  const sign = (who: 'sales' | 'pm') => change((d) => ({
    ...d,
    status: who === 'sales' && d.status === 'Draft' ? 'Handed over' : d.status,
    state: { ...d.state, signoff: { ...(d.state.signoff ?? {}), [who]: { by: me, at: new Date().toISOString() } } },
  }));
  const unsign = (who: 'sales' | 'pm') => setState((x) => ({ ...x, signoff: { ...(x.signoff ?? {}), [who]: null } }));

  const sc = STATUS_COLORS[doc.status];
  const grid = (min = 220): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 });
  const text = (k: keyof HandoverInfo, placeholder?: string, type = 'text') => (
    <input type={type} value={s.info[k]} disabled={ro} placeholder={placeholder} onChange={(e) => setInfo({ [k]: e.target.value })} style={inputStyle} />
  );
  const heading = (t: string, extra?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{t}</div>
      {extra}
    </div>
  );
  const editBtn = (card: EditCard) => (canCustomise ? (
    <button type="button" onClick={() => toggleEditing(card)}
      style={{ ...ghostBtn, marginLeft: 'auto', padding: '6px 12px', ...(editing.has(card) ? { background: C.green, borderColor: C.green, color: C.white } : {}) }}>
      {editing.has(card) ? <><Check size={13} /> Done</> : <><Pencil size={13} /> Edit items</>}
    </button>
  ) : null);
  const editRows = (sec: CheckSection) => {
    const tpl = template.filter((i) => i.section === sec);
    const hidden = tpl.filter((i) => s.custom.removed.includes(i.id));
    const added = s.custom.added.filter((a) => a.section === sec);
    const setAdded = (id: string, patch: Partial<ChecklistCustom['added'][number]>) => setCustom((c) => ({ ...c, added: c.added.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    const iconBtn: React.CSSProperties = { width: 36, height: 36, borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 };
    const del: React.CSSProperties = { ...iconBtn, borderColor: '#FDEAEA', color: '#C0321A' };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tpl.filter((i) => !s.custom.removed.includes(i.id)).map((i) => {
          const over = s.custom.text[i.id];
          return (
            <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input value={over ?? i.text} onChange={(e) => setCustom((c) => ({ ...c, text: { ...c.text, [i.id]: e.target.value } }))} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
              {over !== undefined && over.trim() !== i.text && (
                <button type="button" title="Back to the template wording" onClick={() => setCustom((c) => { const t = { ...c.text }; delete t[i.id]; return { ...c, text: t }; })} style={iconBtn}><RotateCcw size={14} /></button>
              )}
              <button type="button" title="Remove this item" onClick={() => setCustom((c) => ({ ...c, removed: [...c.removed, i.id] }))} style={del}><Trash2 size={14} /></button>
            </div>
          );
        })}
        {added.map((a) => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input value={a.text} autoFocus={!a.text} placeholder="New checklist item" onChange={(e) => setAdded(a.id, { text: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 0, borderColor: C.green }} />
            {sec === 'B' && (
              <button type="button" title="Who does this — tap to switch" onClick={() => setAdded(a.id, { owner: a.owner === 'Sales' ? 'PE' : 'Sales' })}
                style={{ ...iconBtn, width: 'auto', padding: '0 10px', fontFamily: 'Figtree', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: a.owner === 'Sales' ? C.opal : C.slate }}>{a.owner}</button>
            )}
            <button type="button" title="Delete this item" onClick={() => setCustom((c) => ({ ...c, added: c.added.filter((x) => x.id !== a.id) }))} style={del}><Trash2 size={14} /></button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={{ ...ghostBtn, borderStyle: 'dashed', borderColor: C.green, color: C.green }}
            onClick={() => setCustom((c) => ({ ...c, added: [...c.added, { id: `x_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, section: sec, text: '', owner: (sec === 'C' ? 'Contractor' : 'PE') as CheckOwner }] }))}>
            <Plus size={13} /> Add an item
          </button>
          {hidden.length > 0 && (
            <button type="button" style={ghostBtn} title={hidden.map((i) => i.text).join('\n')}
              onClick={() => setCustom((c) => ({ ...c, removed: c.removed.filter((id) => !hidden.some((i) => i.id === id)) }))}>
              <RotateCcw size={13} /> Put back {hidden.length} removed
            </button>
          )}
        </div>
      </div>
    );
  };
  const checkRows = (sec: CheckSection, showOwner = false) => {
    if (canCustomise && editing.has(sec === 'B' || sec === 'C' ? sec : 'D')) return editRows(sec);
    const items = checklist.filter((i) => i.section === sec);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((i: CheckItem) => {
          const on = !!doc.checks[i.id];
          return (
            <label key={i.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', borderRadius: 10, cursor: ro ? 'default' : 'pointer', background: on ? C.honeydew : 'transparent' }}>
              <input type="checkbox" checked={on} disabled={ro} onChange={(e) => change((d) => ({ ...d, checks: { ...d.checks, [i.id]: e.target.checked } }))}
                style={{ width: 18, height: 18, accentColor: C.green, marginTop: 1, flexShrink: 0, cursor: ro ? 'default' : 'pointer' }} />
              <span style={{ flex: 1, fontSize: 13, color: '#1a1a1a', lineHeight: 1.45 }}>{i.text}</span>
              {showOwner && <span style={{ fontSize: 10, fontWeight: 700, color: i.owner === 'Sales' ? C.opal : C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0, marginTop: 3 }}>{i.owner}</span>}
            </label>
          );
        })}
        {items.length === 0 && <div style={{ fontSize: 13, color: C.slate, padding: '6px 10px' }}>Nothing applies yet.</div>}
      </div>
    );
  };
  const sectionCount = (sec: CheckSection[]) => {
    const items = checklist.filter((i) => sec.includes(i.section));
    return <span style={{ fontSize: 12, fontWeight: 700, color: C.slate }}>{items.filter((i) => doc.checks[i.id]).length}/{items.length}</span>;
  };
  const lists = s.scope === 'install' ? installLists(s) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ ...cardStyle, padding: '16px 20px', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <button onClick={() => void back()} style={ghostBtn}><ArrowLeft size={14} /> All handovers</button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.company || 'Untitled handover'}</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
            {linkedQuote ? linkedQuote.ref : s.info.quote || 'No quotation linked'} · {done}/{total} checked ·{' '}
            <span style={{ fontWeight: 700, color: save === 'error' || save === 'conflict' ? '#C0321A' : save === 'saved' ? C.green : C.slate }}>
              {ro ? 'View only' : save === 'saved' ? 'All changes saved' : save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved changes…' : save === 'error' ? 'Not saved' : 'Out of date'}
            </span>
          </div>
        </div>
        <div style={{ width: 170 }}>
          <SearchSelect value={doc.status} disabled={ro} onChange={(v) => change((d) => ({ ...d, status: v as HandoverStatus }))}
            options={STATUSES.map((x) => ({ value: x, label: x }))} />
        </div>
        <Pill bg={sc.bg} color={sc.color}>{doc.status}</Pill>
        <button onClick={() => void downloadPdf()} disabled={busy} style={{ ...ghostBtn, borderColor: C.green, color: C.green }}><Download size={13} /> PDF</button>
        {canDelete && <button onClick={() => setConfirmDelete(true)} style={{ ...ghostBtn, borderColor: '#FDEAEA', color: '#C0321A' }}><Trash2 size={13} /> Delete</button>}
      </div>

      {save === 'conflict' && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 220 }}>Someone else saved this handover while you had it open. Your last change was not saved, so nothing of theirs was overwritten.</span>
          <button onClick={() => void onBack()} style={{ ...ghostBtn, borderColor: '#C0321A', color: '#C0321A' }}>Reload</button>
        </div>
      )}
      {save === 'error' && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>Could not save: {saveErr}. Your changes are still on screen — <button onClick={() => void flush()} style={{ border: 'none', background: 'none', padding: 0, color: '#C0321A', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'Figtree', fontSize: 13 }}>try again</button>.</div>}
      {confirmDelete && (
        <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this handover and its {s.files.length} uploaded file{s.files.length === 1 ? '' : 's'}? This can't be undone.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmDelete(false)} style={ghostBtn}>Cancel</button>
            <button onClick={() => void remove()} disabled={busy} style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, delete</button>
          </div>
        </div>
      )}
      {note && (
        <div style={{ background: C.honeydew, color: C.green, borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{note}</span>
          <button onClick={() => setNote(null)} style={{ border: 'none', background: 'none', color: C.green, cursor: 'pointer', display: 'inline-flex', padding: 0 }}><X size={14} /></button>
        </div>
      )}

      {/* Job set-up */}
      <div style={cardStyle}>
        {heading('Job set-up', <span style={{ fontSize: 12, color: C.slate }}>The checklist below is built from these choices{canCustomise ? ' — use Edit items on a section to change it for this job' : ''}.</span>)}
        <div style={grid(240)}>
          <Field label="Won quotation" hint={linkedQuote
            ? `Sale by ${linkedQuote.salesperson_name}${linkedQuote.won_final_price ? ` · final price after GST ${money(linkedQuote.won_final_price)}` : ''}${linkedQuote.status !== 'Won' ? ` · now ${linkedQuote.status} in the pipeline` : ''}`
            : 'Link the sale this job belongs to'}>
            <SearchSelect value={doc.quote_id ?? ''} disabled={ro} onChange={(v) => void linkQuote(v)} placeholder="Not linked" emptyText="No won quotations match"
              options={[{ value: '', label: 'Not linked' }, ...refs.quotes.filter((q) => (q.status === 'Won' && !takenQuoteIds.includes(q.id)) || q.id === doc.quote_id).map((q) => ({ value: q.id, label: `${q.ref} · ${q.customer_name}`, sub: quoteSub(q) }))]} />
          </Field>
          <Field label="Client">
            <SearchSelect value={doc.customer_id ?? ''} disabled={ro} placeholder="Select customer…" emptyText="No customers match"
              options={[{ value: '', label: 'Not linked to a customer' }, ...refs.customers.map((c) => ({ value: c.id, label: c.name, sub: c.address ?? undefined }))]}
              onChange={(v) => {
                const c = refs.customers.find((x) => x.id === v);
                change((d) => ({
                  ...d, customer_id: c?.id ?? null, company: c ? c.name : d.company,
                  state: c ? { ...d.state, info: { ...d.state.info, project: c.name, site: d.state.info.site.trim() || (c.address ?? '') } } : d.state,
                }));
              }} />
          </Field>
          <Field label="Company / project name">
            <input value={doc.company} disabled={ro} onChange={(e) => change((d) => ({ ...d, company: e.target.value, state: { ...d.state, info: { ...d.state.info, project: e.target.value } } }))} style={inputStyle} />
          </Field>
          <Field label="Sales">
            <SearchSelect value={s.info.sales} disabled={ro} placeholder="Select salesperson…"
              options={[...new Set([...refs.salespeople.map((p) => p.name), ...(s.info.sales ? [s.info.sales] : [])])].map((n) => ({ value: n, label: n }))}
              onChange={(v) => { setInfo({ sales: v }); change((d) => ({ ...d, salesperson_id: refs.salespeople.find((p) => p.name === v)?.id ?? d.salesperson_id })); }}
              addNewLabel="Use a name not in the list" onAddNew={(q) => { if (q.trim()) setInfo({ sales: q.trim() }); }} />
          </Field>
          <Field label="Project Manager / PE">
            <SearchSelect value={s.info.pm} disabled={ro} placeholder="Select the Project Manager…"
              options={[...new Set([...refs.accounts.map((a) => a.full_name || a.email), ...(s.info.pm ? [s.info.pm] : [])])].map((n) => ({ value: n, label: n }))}
              onChange={(v) => setInfo({ pm: v })}
              addNewLabel="Use a name not in the list" onAddNew={(q) => { if (q.trim()) setInfo({ pm: q.trim() }); }} />
          </Field>
          <Field label="Handover date">{text('hdate', undefined, 'date')}</Field>
        </div>

        <div style={grid(240)}>
          <Field label="Quotation no.">
            {text('quote', 'e.g. EV1QO-003325')}
            {liveQuoteNo && (quoteFollows
              ? <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>Follows the Sales Pipeline</div>
              : (
                <div style={{ fontSize: 11, color: '#B45309', marginTop: 4, lineHeight: 1.4 }}>
                  The Sales Pipeline has {liveQuoteNo}.
                  {!ro && <>{' '}<button type="button" onClick={() => setInfo({ quote: liveQuoteNo, quoteSynced: liveQuoteNo })} style={{ border: 'none', background: 'none', padding: 0, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Use it</button></>}
                </div>
              ))}
          </Field>
          <Field label="EHVCG project?">
            <Seg value={s.ehvcg ? 'yes' : 'no'} disabled={ro} options={[['no', 'No'], ['yes', 'Yes — EHVCG']] as const} onChange={(v) => setState((x) => ({ ...x, ehvcg: v === 'yes' }))} />
          </Field>
          <Field label="EVOne quotation">
            <div style={{ minHeight: 38, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {salesPdfs.map((f) => (
                <button key={f.path} type="button" title={`Open ${f.name}`} onClick={() => void openFile(f.path, QUOTE_BUCKET)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', padding: '7px 12px', borderRadius: 99, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  <Paperclip size={12} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quoteDocLabel(f)}</span>
                </button>
              ))}
              {salesPdfs.length === 0 && (
                <span style={{ fontSize: 12, fontWeight: linkedQuote ? 600 : 400, color: linkedQuote ? '#B45309' : C.slate }}>
                  {linkedQuote ? `None attached to ${linkedQuote.ref} yet` : 'Link a won quotation to show it'}
                </span>
              )}
            </div>
          </Field>
          {s.ehvcg && (
            <Field label="EHVCG quotation">
              <div style={{ minHeight: 38, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Toggle on={s.ehvcgSame} disabled={ro} label="Same as the EVOne quotation" onChange={(v) => setState((x) => ({ ...x, ehvcgSame: v }))} />
                {!s.ehvcgSame && s.files.filter((f) => f.kind === 'EHVCG quotation').map((f) => (
                  <span key={f.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', padding: '5px 6px 5px 10px', borderRadius: 99, border: `1px solid ${C.green}`, background: C.white }}>
                    <button type="button" onClick={() => void openFile(f.path)} title={`Uploaded by ${f.by}`}
                      style={{ border: 'none', background: 'none', padding: 0, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <Paperclip size={12} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{f.name.replace(/\.pdf$/i, '')}</span>
                    </button>
                    {!ro && <button type="button" title="Remove file" onClick={() => void removeFile(f.path)} style={{ width: 20, height: 20, borderRadius: 99, border: 'none', background: C.seasalt, color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={11} strokeWidth={3} /></button>}
                  </span>
                ))}
                {!s.ehvcgSame && !ro && (
                  <label style={{ ...ghostBtn, padding: '7px 12px', borderRadius: 99, borderStyle: 'dashed', borderColor: C.green, color: C.green, cursor: busy ? 'default' : 'pointer' }}>
                    <FileUp size={12} /> {busy ? 'Uploading…' : 'Attach PDF'}
                    <input type="file" multiple disabled={busy} accept="application/pdf" style={{ display: 'none' }} onChange={(e) => { void upload(e.target.files, 'EHVCG quotation'); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            </Field>
          )}
        </div>

        <div style={grid(260)}>
          {(['site', 'site2', 'site3', 'site4'] as const).map((k, i) => (
            (i === 0 || s.info[k].trim() || s.info[(['site', 'site2', 'site3'] as const)[i - 1]].trim()) && (
              <Field key={k} label={`Site ${i + 1} address`}>{text(k, i === 0 ? 'Installation address' : 'Leave blank if not needed')}</Field>
            )
          ))}
        </div>

        <div>
          <label style={labelStyle}>Site contact(s)</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {s.contacts.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 32px', gap: 8 }}>
                <input value={c.name} disabled={ro} placeholder="Name" style={inputStyle}
                  onChange={(e) => setState((x) => ({ ...x, contacts: x.contacts.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
                <input value={c.phone} disabled={ro} placeholder="Phone" inputMode="tel" style={inputStyle}
                  onChange={(e) => setState((x) => ({ ...x, contacts: x.contacts.map((y, j) => (j === i ? { ...y, phone: e.target.value } : y)) }))} />
                {!ro && s.contacts.length > 1 ? (
                  <button type="button" title="Remove contact" onClick={() => setState((x) => ({ ...x, contacts: x.contacts.filter((_, j) => j !== i) }))}
                    style={{ width: 32, height: 36, borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={14} /></button>
                ) : <span />}
              </div>
            ))}
            {!ro && <button type="button" onClick={() => setState((x) => ({ ...x, contacts: [...x.contacts, { name: '', phone: '' }] }))} style={{ ...ghostBtn, alignSelf: 'flex-start' }}><Plus size={13} /> Add contact</button>}
          </div>
        </div>

        {/* Documents */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Documents</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>{s.files.length + salesPdfs.length} file{s.files.length + salesPdfs.length === 1 ? '' : 's'}</span>
          </div>
          {linkedQuote && (
            <div>
              <div style={{ ...labelStyle, marginBottom: 6 }}>Quotation · from the Sales Pipeline ({linkedQuote.ref})</div>
              {salesPdfs.length ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {salesPdfs.map((f) => (
                    <button key={f.path} type="button" onClick={() => void openFile(f.path, QUOTE_BUCKET)} title={f.quote_no ? `Quotation no. ${f.quote_no}` : 'Attached to the sale'}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', padding: '5px 10px', borderRadius: 99, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      <Paperclip size={12} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{f.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, fontWeight: 600, color: '#B45309' }}>No quotation PDF is attached to {linkedQuote.ref} yet — attach it on the quote in the Sales Pipeline and it appears here.</div>
              )}
              {salesPdfs.length > 0 && <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>These belong to the quote — add or change them in the Sales Pipeline.</div>}
            </div>
          )}
          {!ro && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ width: 230 }}>
                <SearchSelect value={uploadKind} onChange={(v) => setUploadKind(v as FileKind)} options={FILE_KINDS.map((k) => ({ value: k, label: k }))} />
              </div>
              <label style={{ ...ghostBtn, borderColor: C.green, color: C.green, cursor: busy ? 'default' : 'pointer' }}>
                <FileUp size={13} /> {busy ? 'Uploading…' : `Upload ${uploadKind.toLowerCase()}`}
                <input type="file" multiple disabled={busy} accept="application/pdf,image/*" style={{ display: 'none' }} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
              </label>
              <span style={{ fontSize: 11, color: C.slate }}>PDF or photos, up to 25 MB each</span>
            </div>
          )}
          {FILE_KINDS.filter((k) => s.files.some((f) => f.kind === k)).map((k) => (
            <div key={k}>
              <div style={{ ...labelStyle, marginBottom: 6 }}>{k}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {s.files.filter((f) => f.kind === k).map((f) => (
                  <span key={f.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', padding: '5px 6px 5px 10px', borderRadius: 99, border: '1px solid #EBEBEB', background: C.honeydew }}>
                    <button type="button" onClick={() => void openFile(f.path)} title={`Uploaded by ${f.by}`}
                      style={{ border: 'none', background: 'none', padding: 0, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <Paperclip size={12} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{f.name}</span>
                    </button>
                    {!ro && <button type="button" title="Remove file" onClick={() => void removeFile(f.path)} style={{ width: 20, height: 20, borderRadius: 99, border: 'none', background: C.white, color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={11} strokeWidth={3} /></button>}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {s.files.length === 0 && <div style={{ fontSize: 13, color: C.slate }}>Nothing uploaded here yet — {linkedQuote ? '' : 'quotation, '}cable routing, signed completion form, commissioning photos.</div>}
        </div>

        {/* Chargers */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Chargers</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>
              {chargerCount(s)} charger{chargerCount(s) === 1 ? '' : 's'} · {totalLoad(s)} A total · LEW Grade {grade ?? '—'} · LTA fee S${ltaFeeTotal(s).toLocaleString()}
            </span>
          </div>
          {s.chargers.map((c, i) => {
            const set = (patch: Partial<HandoverCharger>) => setState((x) => ({ ...x, chargers: x.chargers.map((y, j) => (j === i ? { ...y, ...patch } : y)) }));
            const dc = isDc(c.kw);
            return (
              <div key={i} style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, alignItems: 'end' }}>
                  <Field label="Brand">
                    <SearchSelect value={c.brand} disabled={ro} options={BRANDS.map((b) => ({ value: b, label: b }))}
                      onChange={(v) => { const b = v as Brand; set({ brand: b, kw: kwOptionsFor(b).includes(c.kw) ? c.kw : kwOptionsFor(b)[0] }); }} />
                  </Field>
                  <Field label="Rating">
                    <SearchSelect value={c.kw} disabled={ro} onChange={(v) => set({ kw: v })}
                      options={kwOptionsFor(c.brand).map((k) => ({ value: k, label: `${k} kW ${isDc(k) ? 'DC' : 'AC'}`, sub: `${ampsOf(k)} A each` }))} />
                  </Field>
                  <Field label="Qty">
                    <input type="number" min={1} step={1} value={c.qty} disabled={ro} onChange={(e) => set({ qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} style={inputStyle} />
                  </Field>
                  <Field label="Site">
                    <SearchSelect value={c.site} disabled={ro} onChange={(v) => set({ site: v as HandoverCharger['site'] })}
                      options={sitesFilled.map((x) => ({ value: x.n, label: `Site ${x.n}`, sub: x.a || undefined }))} />
                  </Field>
                  {!ro && (
                    <button type="button" title="Remove charger" onClick={() => setState((x) => ({ ...x, chargers: x.chargers.filter((_, j) => j !== i) }))}
                      style={{ height: 38, borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700 }}>
                      <X size={13} /> Remove
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {c.brand === 'Other' && <input value={c.other} disabled={ro} placeholder="Brand and model" onChange={(e) => set({ other: e.target.value })} style={{ ...inputStyle, width: 240 }} />}
                  {!dc && <Seg value={c.variant} disabled={ro} onChange={(v) => set({ variant: v })} options={[['Standard', 'Standard'], ['Premium', 'Premium']] as const} />}
                  {!dc && <Toggle on={c.stand} disabled={ro} label="Charger stand needed" onChange={(v) => set({ stand: v })} />}
                  <span style={{ fontSize: 12, color: C.slate }}>{ampsOf(c.kw) * Number(c.qty)} A · LTA S${ltaFeePer(c.kw, s.ltaAccess) * Number(c.qty)}</span>
                  {warrantyOf(c) && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: C.honeydew, color: C.green, whiteSpace: 'nowrap' }} title="From the charger lines on the sale (Sales Pipeline / Order Book)">{warrantyOf(c)}</span>}
                </div>
              </div>
            );
          })}
          {s.chargers.length === 0 && <div style={{ fontSize: 13, color: C.slate }}>No chargers yet — add what this job installs.</div>}
          {!ro && (
            <button type="button" onClick={() => setState((x) => ({ ...x, chargers: [...x.chargers, { brand: 'Hiconics', kw: '22', qty: 1, other: '', variant: 'Standard', stand: false, site: '1' }] }))}
              style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 10, border: `1px dashed ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={13} strokeWidth={2.5} /> Add a charger
            </button>
          )}
        </div>

        <div style={grid(260)}>
          <Field label="Ownership"><Seg value={s.ownership} disabled={ro} onChange={(v) => setState((x) => ({ ...x, ownership: v }))} options={[['customer', 'Customer-owned'], ['cpo', 'CPO site']] as const} /></Field>
          <Field label="Job scope"><Seg value={s.scope} disabled={ro} onChange={(v) => setState((x) => ({ ...x, scope: v }))} options={[['full', 'Full (from MSR)'], ['half', 'Half (from isolator)'], ['install', 'Install only']] as const} /></Field>
          {s.scope === 'half' && <Field label="Upstream protection"><Seg value={s.halfProt} disabled={ro} onChange={(v) => setState((x) => ({ ...x, halfProt: v }))} options={[['mccb', 'BLEW confirms MCCB'], ['db', 'Customer adds DB']] as const} /></Field>}
          <Field label="Floor"><Seg value={s.floor} disabled={ro} onChange={(v) => setState((x) => ({ ...x, floor: v }))} options={[['concrete', 'Concrete'], ['grass', 'Grass'], ['asphalt', 'Asphalt']] as const} /></Field>
          <Field label="Charger status"><Seg value={s.chargerStatus} disabled={ro} onChange={(v) => setState((x) => ({ ...x, chargerStatus: v }))} options={[['Ordered', 'Ordered'], ['In transit', 'In transit'], ['In warehouse', 'In warehouse']] as const} /></Field>
          <Field label="Delivery date">{text('ddate', undefined, 'date')}</Field>
          <Field label="Logistics">{text('logistics', 'e.g. lorry crane, delivered to site')}</Field>
          {!cpo && <Field label="On a charging platform?"><Seg value={s.platform} disabled={ro} onChange={(v) => setState((x) => ({ ...x, platform: v }))} options={[['no', 'No'], ['yes', 'Yes'], ['maybe', 'Maybe']] as const} /></Field>}
          {(cpo || s.platform !== 'no') && (
            <Field label="Platform" hint={cpo ? 'CPO sites always go on a platform' : undefined}>
              <SearchSelect value={s.info.platformName} disabled={ro} placeholder="Select platform…" onChange={(v) => setInfo({ platformName: v })}
                options={[...new Set([...PLATFORMS, ...(s.info.platformName ? [s.info.platformName] : [])])].map((p) => ({ value: p, label: p }))} />
            </Field>
          )}
          {(cpo || s.platform !== 'no' || s.info.platformNotes.trim() !== '') && <Field label="Platform notes">{text('platformNotes')}</Field>}
          <Field label="LTA fee borne by"><Seg value={s.ltaPayer} disabled={ro} onChange={(v) => setState((x) => ({ ...x, ltaPayer: v }))} options={[['EVOne', 'EVOne'], ['Customer', 'Customer']] as const} /></Field>
          <Field label="LTA access"><Seg value={s.ltaAccess} disabled={ro} onChange={(v) => setState((x) => ({ ...x, ltaAccess: v }))} options={[['open', 'Non-restricted'], ['restricted', 'Restricted (landed)']] as const} /></Field>
        </div>

        <div>
          <label style={labelStyle}>Site works</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([['msb', 'MSB modification'], ['plinth', 'Plinth (customer prefers)'], ['bollard', 'Bollards'], ['paint', 'Paint charging lots'], ['excavation', 'Excavation / trenching'], ['traffic', 'Traffic management'], ['cctv', 'CCTV'], ['shutdown', 'Power shutdown (BLEW)']] as [FlagKey, string][])
              .filter(([k]) => k !== 'msb' || s.scope === 'full')
              .map(([k, t]) => <Toggle key={k} on={!!s.c[k]} disabled={ro} label={t} onChange={(v) => setFlag(k, v)} />)}
            {cpo && <Toggle on={!!s.c.lightbox} disabled={ro} label="Lightbox" onChange={(v) => setFlag('lightbox', v)} />}
            {cpo && <Toggle on={!!s.c.extraLight} disabled={ro} label="Extra lighting" onChange={(v) => setFlag('extraLight', v)} />}
          </div>
        </div>
        <div style={grid(200)}>
          {s.scope === 'full' && (
            <Field label="Main cable size">
              <SearchSelect value={s.info.cable} disabled={ro} placeholder="Select the cable size…" emptyText="No cable sizes match"
                options={[{ value: '', label: 'Not decided yet' }, ...[...new Set([...refs.cables, ...(s.info.cable ? [s.info.cable] : [])])].map((n) => ({ value: n, label: n }))]}
                onChange={(v) => setInfo({ cable: v })}
                addNewLabel="Use a size not in the list" onAddNew={(q) => { if (q.trim()) setInfo({ cable: q.trim() }); }} />
            </Field>
          )}
          {(s.scope !== 'install' || s.info.cableLen.trim() !== '') && <Field label="Cable run (m)">{text('cableLen', 'e.g. 60')}</Field>}
          {s.scope === 'full' && s.c.msb && <Field label="MSB from (A)">{text('msbFrom', 'e.g. 200')}</Field>}
          {s.scope === 'full' && s.c.msb && <Field label="MSB to (A)">{text('msbTo', 'e.g. 400')}</Field>}
          {s.c.bollard && <Field label="Bollards (qty)">{text('bollards', 'e.g. 4')}</Field>}
          {s.c.paint && <Field label="Lots to paint">{text('lots', 'e.g. 2')}</Field>}
          {s.c.paint && <Field label="Paint colour">{text('paintColour', 'e.g. green with white logo')}</Field>}
          {s.c.shutdown && <Field label="BLEW phone">{text('blewPhone')}</Field>}
          {(s.c.shutdown || s.scope === 'half') && <Field label="BLEW fee borne by"><Seg value={s.blewPayer} disabled={ro} onChange={(v) => setState((x) => ({ ...x, blewPayer: v }))} options={[['EVOne', 'EVOne'], ['Customer', 'Customer']] as const} /></Field>}
        </div>
        <div style={grid(260)}>
          <Field label="Landlord documents">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {LANDLORD_DOCS.map((d) => <Toggle key={d.key} on={!!s.d[d.key]} disabled={ro} label={d.key} onChange={(v) => setState((x) => ({ ...x, d: { ...x.d, [d.key]: v } }))} />)}
            </div>
          </Field>
          <Field label="Other landlord documents">{text('otherDocs', 'e.g. insurance, worker list')}</Field>
        </div>
        {s.scope === 'install' && (
          <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Installation job only — who provides what</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([['cpPlinth', 'Customer: cement plinth'], ['cpCable', 'Customer: cables to plinth'], ['cpIsolator', 'Customer: upstream isolator / DB'], ['cpTrench', 'Customer: trenching / containment'], ['niBlew', 'Not inclusive: BLEW fees']] as [FlagKey, string][])
                .map(([k, t]) => <Toggle key={k} on={!!s.c[k]} disabled={ro} label={t} onChange={(v) => setFlag(k, v)} />)}
            </div>
            <div style={grid(260)}>
              <Field label="Customer also provides">{text('cpOther')}</Field>
              <Field label="Also not inclusive">{text('niOther')}</Field>
            </div>
          </div>
        )}
        <div style={grid(300)}>
          {NOTE_KINDS.map((k) => {
            const earlier = s.info[k.legacy].trim();
            const entries = s.noteLog.filter((n) => n.kind === k.key).slice().reverse();
            const draft = noteDraft[k.key];
            return (
              <div key={k.key} style={{ minWidth: 0 }}>
                <label style={labelStyle}>{k.label}</label>
                {!ro && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <textarea value={draft} rows={2} placeholder="Write a note, then Add note" onChange={(e) => setNoteDraft((d) => ({ ...d, [k.key]: e.target.value }))} style={{ ...inputStyle, flex: 1, minWidth: 0, resize: 'vertical', lineHeight: 1.5 }} />
                    <button type="button" disabled={!draft.trim()} onClick={() => addNote(k.key)}
                      style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: draft.trim() ? C.green : '#A5D6A7', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Plus size={13} /> Add note
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {entries.map((n) => noteCard(n.id, `${fmtDateTime(n.at)}${n.by ? ` · ${n.by}` : ''}`, n.text,
                    () => setState((x) => ({ ...x, noteLog: x.noteLog.filter((y) => y.id !== n.id) }))))}
                  {earlier && noteCard(`earlier:${k.key}`, 'Earlier note · no date recorded', earlier, () => setInfo({ [k.legacy]: '' }))}
                  {entries.length === 0 && !earlier && <div style={{ fontSize: 12, color: C.slate }}>No notes yet.</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* A · Summary */}
      <div style={cardStyle}>
        {heading('A · Project summary')}
        <div style={grid(200)}>
          {([
            ['Chargers', `${chargerCount(s)}`], ['Total load', `${totalLoad(s)} A`], ['LEW grade', grade ? `Grade ${grade}` : '—'],
            ['LTA registration fee', `S$${ltaFeeTotal(s).toLocaleString()} · ${s.ltaPayer}`], ['Job scope', SCOPE_LABEL[s.scope]], ['Floor', FLOOR_LABEL[s.floor]],
            ['Platform', onPlatform(s) ? s.info.platformName || 'Yes' : s.platform === 'maybe' ? 'Maybe' : 'No'], ['BLEW involved', blewInvolved(s) ? `Yes · fee by ${s.blewPayer}` : 'No'],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} style={{ background: C.seasalt, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
        {dcBrands.filter((b): b is Exclude<Brand, 'Other'> => b !== 'Other').map((b) => (
          <div key={b} style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5 }}>
            <b style={{ color: C.opal }}>{b} DC</b> — door clearance: {DC_SPECS[b].clearance}. Plinth / cable opening: {DC_SPECS[b].plinth}.
          </div>
        ))}
        {lists && (
          <div style={grid(260)}>
            {([["EVOne LEW work scope (per charger)", lists.evone], ["Customer's electrical contractor to provide", lists.customer], ['Not inclusive', lists.notInclusive]] as const).map(([t, rowsOf]) => (
              <div key={t} style={{ background: C.seasalt, borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.opal, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{t}</div>
                {rowsOf.length ? rowsOf.map((r) => <div key={r} style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5 }}>• {r}</div>) : <div style={{ fontSize: 13, color: C.slate }}>Nothing selected</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>{heading(SECTION_TITLES.B, <>{sectionCount(['B'])}{editBtn('B')}</>)}{checkRows('B', true)}</div>

      <div style={cardStyle}>
        {heading(SECTION_TITLES.C, <>{sectionCount(['C'])}{editBtn('C')}</>)}
        <div style={{ fontSize: 12, color: C.slate }}>Brief the contractor on every item before work starts. They sign the acknowledgement on the printed PDF.</div>
        <div style={grid(220)}>
          <Field label="Contractor">{text('contractor', 'Contractor company')}</Field>
        </div>
        {checkRows('C')}
      </div>

      <div style={cardStyle}>
        {heading('D · Turn-on day and commissioning', <>{sectionCount(['D1', 'D2'])}{editBtn('D')}</>)}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.opal, textTransform: 'uppercase', letterSpacing: '0.05em' }}>PE to prepare</div>
        {checkRows('D1')}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.opal, textTransform: 'uppercase', letterSpacing: '0.05em' }}>On turn-on day</div>
        {checkRows('D2')}
      </div>

      {/* E · Pending */}
      <div style={cardStyle}>
        {heading('E · Pending items', <span style={{ fontSize: 12, fontWeight: 700, color: C.slate }}>{s.pending.filter((p) => !p.closed && p.item.trim()).length} open</span>)}
        {s.pending.map((p, i) => {
          const set = (patch: Partial<PendingItem>) => setState((x) => ({ ...x, pending: x.pending.map((y, j) => (j === i ? { ...y, ...patch } : y)) }));
          return (
            <div key={i} style={{ background: p.closed ? C.honeydew : C.seasalt, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={grid(220)}>
                <input value={p.item} disabled={ro} placeholder="Pending item" onChange={(e) => set({ item: e.target.value })} style={inputStyle} />
                <input value={p.solution} disabled={ro} placeholder="Solution / next step" onChange={(e) => set({ solution: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ width: 160 }}>
                  <SearchSelect value={p.owner} disabled={ro} onChange={(v) => set({ owner: v as PendingOwner })}
                    options={(['Contractor', 'EVOne', 'Customer', 'Landlord'] as PendingOwner[]).map((o) => ({ value: o, label: o }))} />
                </div>
                <input type="date" value={p.due} disabled={ro} onChange={(e) => set({ due: e.target.value })} style={{ ...inputStyle, width: 170 }} />
                <Toggle on={p.closed} disabled={ro} label="Closed" onChange={(v) => set({ closed: v })} />
                {!ro && <button type="button" onClick={() => setState((x) => ({ ...x, pending: x.pending.filter((_, j) => j !== i) }))} style={{ ...ghostBtn, marginLeft: 'auto', borderColor: '#FDEAEA', color: '#C0321A' }}><X size={13} /> Remove</button>}
              </div>
            </div>
          );
        })}
        {s.pending.length === 0 && <div style={{ fontSize: 13, color: C.slate }}>No pending items.</div>}
        {!ro && <button type="button" onClick={() => setState((x) => ({ ...x, pending: [...x.pending, { item: '', solution: '', owner: 'Contractor', due: '', closed: false }] }))} style={{ ...ghostBtn, alignSelf: 'flex-start' }}><Plus size={13} /> Add pending item</button>}
      </div>

      {/* F · Payment */}
      <div style={cardStyle}>
        {heading('F · Contractor completion & payment', s.info.contractor.trim() ? <Pill bg={pay.cleared ? '#E4F3E3' : '#FFF0E0'} color={pay.cleared ? '#1B512D' : '#B45309'}>{pay.cleared ? 'Cleared for payment' : 'Payment on hold'}</Pill> : undefined)}
        <div style={grid(220)}>
          <Field label="Agreed price (S$, excl. GST)">{text('contractorPrice', 'e.g. 4500')}</Field>
          <Field label="Contractor quote ref">{text('contractorQuote')}</Field>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {([
            [pay.briefingDone, 'Every contractor item in Section C is ticked'],
            [pay.openPending === 0, pay.openPending === 0 ? 'No pending item owned by the contractor is open' : `${pay.openPending} pending item${pay.openPending === 1 ? '' : 's'} owned by the contractor still open`],
            [pay.formUploaded, 'Signed completion form uploaded (Documents below)'],
          ] as [boolean, string][]).map(([ok, t]) => (
            <div key={t} style={{ fontSize: 13, fontWeight: 600, color: ok ? '#1B512D' : '#B45309' }}>{ok ? '✓' : '○'} {t}</div>
          ))}
        </div>
      </div>

      {/* Charger Registry details */}
      <div style={cardStyle}>
        <RegistryHandoff state={s} setState={setState} ro={ro} me={me} company={doc.company} customerId={doc.customer_id}
          isResidential={refs.customers.find((c) => c.id === doc.customer_id)?.type === 'residential'}
          warrantyYearsFor={warrantyYearsFor} onNote={setNote} />
      </div>

      {/* G · Sign-off */}
      <div style={cardStyle}>
        {heading('G · Sign-off', <span style={{ fontSize: 12, color: C.slate }}>Sales and Project Manager only</span>)}
        <div style={grid(280)}>
          {([['sales', 'Sales', s.info.sales], ['pm', 'Project Manager', s.info.pm]] as const).map(([who, title, name]) => {
            const sig = s.signoff?.[who];
            return (
              <div key={who} style={{ background: sig ? C.honeydew : C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}{name ? ` · ${name}` : ''}</div>
                {sig ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>✓ Signed by {sig.by}</div>
                    <div style={{ fontSize: 12, color: C.slate }}>{new Date(sig.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                    {!ro && <button type="button" onClick={() => unsign(who)} style={{ ...ghostBtn, alignSelf: 'flex-start' }}>Undo sign-off</button>}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: C.slate }}>{who === 'sales' ? 'Sales confirms the handover is complete and correct.' : 'The Project Manager accepts the job.'}</div>
                    {!ro && (
                      <button type="button" onClick={() => sign(who)}
                        style={{ alignSelf: 'flex-start', padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                        Sign as {title} ({me})
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
