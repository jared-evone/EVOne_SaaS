import { useEffect, useMemo, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { Logo } from '../components/Logo';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { useScreenNav } from '../App';
import { readDraft, clearDraft, useDraftSync } from '../lib/draft';
import { DraftBar } from '../components/DraftBar';
import { SearchSelect } from '../components/SearchSelect';
import { Plus, Trash2, Send, Package, Mail, RefreshCw, Truck } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  unit_price: number;
  currency: string;
  supplier: string | null;
  description: string | null;
  is_active: boolean;
}

interface POLine {
  key: string; product_id: string | null; name: string; remark?: string | null; unit: string; unit_price: number; sell_price: number; qty: number; currency: string; supplier: string | null;
  /** Set when the line was added from a won quote's charger awaiting a PO (sales_order_lines.id) — linked to this PO once it is raised. */
  order_line_id?: string;
  /** Years of warranty to buy from the supplier for this line — shown on the PO and its emails. */
  warranty_years?: number | null;
}
const warrantyText = (y: number | null | undefined) => (y == null ? '' : `Warranty to order: ${y} year${y === 1 ? '' : 's'}`);

/** A charger on a won Sales quote that still needs a purchase order. */
interface AwaitingCharger {
  id: string; item_id: string | null; item_name: string; qty: number; warranty_years: number | null;
  quote_ref: string; customer_id: string | null; customer_name: string; won: string;
}
type StoredLine = Omit<POLine, 'key'>;

interface PurchaseOrder {
  id: string;
  po_number: string;
  title: string;
  supplier: string | null;
  approver_email: string | null;
  finance_email: string | null;
  lines: StoredLine[];
  subtotal: number;
  notes: string | null;
  currency: string;
  sell_subtotal: number;
  sell_currency: string;
  status: 'pending' | 'approved' | 'rejected' | 'sent_to_finance' | 'completed' | 'cancelled';
  approval_token: string;
  decided_at: string | null;
  finance_decided_at: string | null;
  decided_by?: string | null;
  finance_decided_by?: string | null;
  email_status: string | null;
  email_error: string | null;
  app_base: string | null;
  forwarded_at: string | null;
  created_by: string | null;
  created_by_id: string | null;
  created_at: string;
  customer_id?: string | null;
  customer_name?: string | null;
}

interface CustomerRef { id: string; name: string }

// Optional on a PO — stock replenishment has no customer. The Order Book shows
// it beside the PO title when a won quote's chargers are linked to a PO.
function CustomerSelect({ customers, value, onChange, disabled }: { customers: CustomerRef[]; value: string; onChange: (c: CustomerRef | null) => void; disabled?: boolean }) {
  return (
    <SearchSelect value={value} disabled={disabled} placeholder="No customer — stock / internal" emptyText="No customers match"
      options={[{ value: '', label: 'No customer — stock / internal' }, ...customers.map((c) => ({ value: c.id, label: c.name }))]}
      onChange={(v) => onChange(customers.find((c) => c.id === v) ?? null)} />
  );
}

interface POSettings {
  id: string;
  subject: string;
  body: string;
  approver_email: string | null;
  finance_email: string | null;
  /** Default CC — receives an FYI copy WITHOUT the Approve/Reject buttons. */
  cc_email: string | null;
  from_address: string | null;
  reply_to: string | null;
  /** Accounts that may approve or reject a PO, and accounts that handle the
   *  finance step. approver_email / finance_email hold those accounts' emails
   *  (comma-separated) — where the "PO waiting for you" notices are sent. */
  approver_user_ids?: string[] | null;
  finance_user_ids?: string[] | null;
}
interface PoAccount { id: string; full_name: string | null; email: string; is_active: boolean | null }
const toList = (s: string | null | undefined) => (s ?? '').split(/[,;]/).map((e) => e.trim()).filter((e) => /@/.test(e));
const accountLabel = (a: PoAccount) => a.full_name || a.email;

export const CURRENCIES: Record<string, { symbol: string; label: string }> = {
  SGD: { symbol: 'S$', label: 'SGD · Singapore Dollar' },
  CNY: { symbol: '¥', label: 'CNY · Chinese Yuan' },
  USD: { symbol: 'US$', label: 'USD · US Dollar' },
  MYR: { symbol: 'RM', label: 'MYR · Malaysian Ringgit' },
  EUR: { symbol: '€', label: 'EUR · Euro' },
};
const money = (n: number, currency = 'SGD') =>
  (CURRENCIES[currency]?.symbol ?? '$') + (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/po-decision`;

const STATUS_STYLE: Record<PurchaseOrder['status'], { bg: string; color: string; label: string }> = {
  pending:         { bg: '#FFF8E1', color: '#B07D00', label: 'Pending approval' },
  approved:        { bg: '#E4F3E3', color: '#1B512D', label: 'Approved' },
  rejected:        { bg: '#FDEAEA', color: '#C0321A', label: 'Rejected' },
  sent_to_finance: { bg: '#E3F0FF', color: '#1A62C0', label: 'With finance' },
  completed:       { bg: '#E4F3E3', color: '#1B512D', label: 'Completed' },
  cancelled:       { bg: '#F3F3F3', color: '#767B77', label: 'Cancelled' },
};

let lineSeq = 0;
const newKey = () => `l-${Date.now()}-${lineSeq++}`;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

// Build the approval email HTML: intro + line table + approve/reject buttons.
// `fyi` renders the CC copy: same PO details, but the Approve/Reject buttons are
// replaced by a note naming the approver — so only the addressed approver can act.
function buildPoEmail(po: PurchaseOrder, settings: POSettings, salesman: string, fyi = false): string {
  const fill = (t: string) => t
    .replace(/\{\{\s*po_number\s*\}\}/gi, po.po_number)
    .replace(/\{\{\s*title\s*\}\}/gi, po.title)
    .replace(/\{\{\s*salesman\s*\}\}/gi, salesman)
    .replace(/\{\{\s*supplier\s*\}\}/gi, po.supplier ?? '—')
    .replace(/\{\{\s*total\s*\}\}/gi, money(po.subtotal, po.currency));
  // Handle both real newlines and literal "\n" that may be stored in the template.
  const intro = esc(fill(settings.body)).replace(/\\n/g, '<br>').replace(/\n/g, '<br>');
  // Link to the app's decision page (renders reliably as HTML); it calls the
  // po-decision function to record the choice.
  const appBase = po.app_base || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
    <div style="font-size:18px;font-weight:800;color:${C.green};">Purchase Order ${esc(po.po_number)}</div>
    <div style="font-size:14px;color:#5B6B7A;margin:2px 0 16px;">${esc(po.title)}${po.supplier ? ` · ${esc(po.supplier)}` : ''}</div>
    <div style="font-size:14px;line-height:1.6;margin-bottom:16px;">${intro}</div>
    ${poItemsHtml(po)}
    ${fyi
      ? `<div style="text-align:center;background:#F7FAFC;border:1px dashed #D5DDE3;border-radius:10px;padding:12px 16px;font-size:13px;color:#5B6B7A;">This copy is for your information — approval sits with <b style="color:#1a1a1a;">${esc(settings.approver_email ?? po.approver_email ?? '')}</b>.</div>`
      : `<div style="text-align:center;">
      <a href="${appBase}" style="display:inline-block;background:${C.green};color:#fff;text-decoration:none;font-weight:700;padding:12px 30px;border-radius:10px;">Open EVOne to approve or reject</a>
      <div style="font-size:12px;color:#5B6B7A;margin-top:10px;">Sign in with your own account, then Inventory &rarr; Raise PO &rarr; All POs. Only the approver's account can decide.</div>
    </div>`}
    <div style="text-align:center;color:#5B6B7A;font-size:12px;margin-top:18px;">Raised by ${esc(salesman)} · EVOne Purchase Orders</div>
  </div>`;
}

// Shared item table + cost/sell totals block used by both the boss and finance emails.
function poItemsHtml(po: PurchaseOrder): string {
  const rows = po.lines.map((l) => {
    const remark = (l.remark ? `<div style="font-size:12px;color:#8A97A3;margin-top:2px;">${esc(l.remark).replace(/\n/g, '<br>')}</div>` : '')
      + (l.warranty_years != null ? `<div style="font-size:12px;font-weight:700;color:#6B21A8;margin-top:3px;">${esc(warrantyText(l.warranty_years))}</div>` : '');
    return `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;">${esc(l.name)}${remark}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;text-align:right;vertical-align:top;">${l.qty} ${esc(l.unit)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;text-align:right;vertical-align:top;">${money(l.unit_price, po.currency)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;text-align:right;font-weight:700;vertical-align:top;">${money(l.qty * l.unit_price, po.currency)}</td></tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;border:1px solid #EBEBEB;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#F7FAFC;">
        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#5B6B7A;text-transform:uppercase;">Item</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#5B6B7A;text-transform:uppercase;">Qty</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#5B6B7A;text-transform:uppercase;">Unit Price</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#5B6B7A;text-transform:uppercase;">Total</th>
      </tr></thead><tbody>${rows}</tbody></table>
    <div style="text-align:right;font-size:14px;color:#5B6B7A;margin:12px 0 2px;">Purchase cost: <b style="color:#1a1a1a;">${money(po.subtotal, po.currency)} ${esc(po.currency)}</b></div>
    ${po.sell_subtotal ? `<div style="text-align:right;font-size:14px;color:#5B6B7A;margin:2px 0;">Selling to customer: <b style="color:${C.green};">${money(po.sell_subtotal, po.sell_currency)} ${esc(po.sell_currency)}</b></div>
    ${po.sell_subtotal && po.sell_currency === po.currency ? `<div style="text-align:right;font-size:14px;color:#5B6B7A;margin:2px 0 22px;">Margin: <b style="color:#1a1a1a;">${money(po.sell_subtotal - po.subtotal, po.currency)}</b></div>` : '<div style="margin-bottom:22px;"></div>'}` : '<div style="margin-bottom:22px;"></div>'}`;
}

// FYI copies to the template's default CC list — same PO, no action buttons,
// so approve/complete links never leave the responsible person's inbox.
async function sendFyiCopies(po: PurchaseOrder, settings: POSettings, salesman: string, subject: string, kind: 'approval' | 'finance' = 'approval') {
  const ccList = (settings.cc_email ?? '').split(/[,;]/).map((e) => e.trim()).filter((e) => /@/.test(e));
  if (!ccList.length) return;
  try {
    await supabase.functions.invoke('send-customer-email', {
      body: {
        to: ccList,
        subject: `FYI: ${subject}`,
        html: kind === 'finance' ? buildFinanceEmail(po, salesman, settings, true) : buildPoEmail(po, settings, salesman, true),
        from: settings.from_address || undefined,
        replyTo: settings.reply_to || undefined,
      },
    });
  } catch (e) {
    console.error('PO FYI copy failed', e);
  }
}

// Finance email: no approve/reject — finance marks the PO completed (sent to
// supplier) or cancels it. Buttons point at the app decision page.
function buildFinanceEmail(po: PurchaseOrder, salesman: string, settings?: POSettings, fyi = false): string {
    const appBase = po.app_base || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
    <div style="font-size:18px;font-weight:800;color:${C.green};">Purchase Order ${esc(po.po_number)}</div>
    <div style="font-size:14px;color:#5B6B7A;margin:2px 0 16px;">${esc(po.title)}${po.supplier ? ` · ${esc(po.supplier)}` : ''}</div>
    <div style="font-size:14px;line-height:1.6;margin-bottom:16px;">This purchase order has been <b style="color:${C.green};">approved by management</b>. Please send it to the supplier, then mark it as completed in EVOne.</div>
    ${poItemsHtml(po)}
    ${fyi
      ? `<div style="text-align:center;background:#F7FAFC;border:1px dashed #D5DDE3;border-radius:10px;padding:12px 16px;font-size:13px;color:#5B6B7A;">This copy is for your information — the completed/cancel action sits with <b style="color:#1a1a1a;">${esc(settings?.finance_email ?? po.finance_email ?? 'finance')}</b>.</div>`
      : `<div style="text-align:center;">
      <a href="${appBase}" style="display:inline-block;background:${C.green};color:#fff;text-decoration:none;font-weight:700;padding:12px 30px;border-radius:10px;">Open EVOne to complete or cancel</a>
      <div style="font-size:12px;color:#5B6B7A;margin-top:10px;">Sign in with your own account, then Inventory &rarr; Raise PO &rarr; All POs. Only the finance account can move it on.</div>
    </div>`}
    <div style="text-align:center;color:#5B6B7A;font-size:12px;margin-top:18px;">Raised by ${esc(salesman)} · EVOne Purchase Orders</div>
  </div>`;
}

// ── Public decision page (opened from the approval email) ─────────

interface DecisionPO { po_number: string; title: string; supplier: string | null; subtotal: number; currency: string; created_by: string | null; status: string; }

type POAction = 'approve' | 'reject' | 'complete' | 'cancel';

// Which action pair a decision page offers, keyed by the current PO status.
// Boss decides pending POs (approve/reject); finance decides approved ones
// (mark completed / cancel).
const ACTION_META: Record<POAction, { label: string; positive: boolean; from: string[]; alt: POAction; heading: string; prompt: string }> = {
  approve:  { label: 'Approve',        positive: true,  from: ['pending'],                    alt: 'reject',  heading: 'Purchase order approval', prompt: 'Please approve or reject this purchase order.' },
  reject:   { label: 'Reject',         positive: false, from: ['pending'],                    alt: 'approve', heading: 'Purchase order approval', prompt: 'Please approve or reject this purchase order.' },
  complete: { label: 'Mark Completed', positive: true,  from: ['approved', 'sent_to_finance'], alt: 'cancel',  heading: 'Finance action',          prompt: 'Mark this purchase order as completed once it has been sent to the supplier, or cancel it.' },
  cancel:   { label: 'Cancel PO',      positive: false, from: ['approved', 'sent_to_finance'], alt: 'complete', heading: 'Finance action',         prompt: 'Mark this purchase order as completed once it has been sent to the supplier, or cancel it.' },
};

// Default action offered for a given live status when the link carries no decision.
const STATUS_ACTION: Record<string, POAction> = { pending: 'approve', approved: 'complete', sent_to_finance: 'complete' };

export function PODecisionPage({ token, decision }: { token: string; decision: string | null }) {
  const [po, setPo] = useState<DecisionPO | null>(null);
  const [phase, setPhase] = useState<'loading' | 'confirm' | 'done' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<POAction | null>(null);
  const preset: POAction | null = (['approve', 'reject', 'complete', 'cancel'] as const).find((a) => a === decision) ?? null;

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${FN_BASE}?token=${encodeURIComponent(token)}`).then((x) => x.json());
        if (r.error) { setErr(r.error); setPhase('error'); return; }
        setPo(r.po);
        // The action offered is the email's decision if it's still valid for the
        // current status, else whatever the live status naturally allows.
        const live: POAction | null = preset && ACTION_META[preset].from.includes(r.po.status)
          ? preset
          : STATUS_ACTION[r.po.status] ?? null;
        if (live) { setAction(live); setPhase('confirm'); }
        else { setResult(r.po.status); setPhase('done'); }
      } catch (e) { setErr((e as Error).message); setPhase('error'); }
    })();
  }, [token]);

  const decide = async (a: POAction) => {
    setBusy(true);
    try {
      const r = await fetch(`${FN_BASE}?token=${encodeURIComponent(token)}&action=${a}&confirm=1`).then((x) => x.json());
      if (r.error) { setErr(r.error); setPhase('error'); setBusy(false); return; }
      const fallback: Record<POAction, string> = { approve: 'approved', reject: 'rejected', complete: 'completed', cancel: 'cancelled' };
      setResult(r.po?.status ?? fallback[a]);
      setPhase('done');
    } catch (e) { setErr((e as Error).message); setPhase('error'); }
    setBusy(false);
  };

  const card: React.CSSProperties = { width: '100%', maxWidth: 460, background: C.white, borderRadius: 20, border: '1px solid #EBEBEB', padding: 32, boxShadow: '0 12px 40px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'stretch' };
  const wrap: React.CSSProperties = { minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.seasalt, padding: 20 };

  const summaryBox = po && (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>{po.po_number} · {po.title}</div>
      {po.supplier && <div style={{ fontSize: 13, color: C.slate, marginTop: 3 }}>Supplier: {po.supplier}</div>}
      {po.created_by && <div style={{ fontSize: 13, color: C.slate, marginTop: 2 }}>Raised by {po.created_by}</div>}
      <div style={{ fontSize: 13, color: C.slate, marginTop: 6 }}>Total: <strong style={{ color: '#1a1a1a', fontSize: 15 }}>{money(po.subtotal, po.currency)} {po.currency}</strong></div>
    </div>
  );

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}><Logo height={38} /></div>
        {phase === 'loading' && <div style={{ textAlign: 'center', color: C.slate, fontSize: 14, padding: 20 }}>Loading purchase order…</div>}
        {phase === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#C0321A', marginBottom: 8 }}>Can't open this PO</div>
            <div style={{ fontSize: 13, color: C.slate }}>{err}</div>
          </div>
        )}
        {phase === 'done' && po && (() => {
          const done: Record<string, { title: string; color: string; msg: string }> = {
            approved:        { title: 'Approved ✓',  color: C.green,    msg: 'This PO is approved and has been forwarded to finance to send to the supplier.' },
            sent_to_finance: { title: 'Approved ✓',  color: C.green,    msg: 'This PO is approved and has been forwarded to finance to send to the supplier.' },
            completed:       { title: 'Completed ✓', color: C.green,    msg: 'This PO has been completed and sent to the supplier.' },
            rejected:        { title: 'Rejected',    color: '#C0321A',  msg: 'This PO was rejected. The sales team has been notified.' },
            cancelled:       { title: 'Cancelled',   color: '#767B77',  msg: 'This PO was cancelled. The sales team has been notified.' },
          };
          const d = done[result ?? ''] ?? { title: 'Already decided', color: '#1a1a1a', msg: 'No further action is needed.' };
          return (
            <>
              <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 800, color: d.color }}>{d.title}</div>
              {summaryBox}
              <div style={{ textAlign: 'center', fontSize: 13, color: C.slate }}>{d.msg}</div>
            </>
          );
        })()}
        {phase === 'confirm' && po && action && (() => {
          const meta = ACTION_META[action];
          const alt = ACTION_META[meta.alt];
          return (
            <>
              <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, color: C.green }}>{meta.heading}</div>
              {summaryBox}
              <div style={{ textAlign: 'center', fontSize: 13, color: C.slate }}>{meta.prompt}</div>
              <button onClick={() => decide(action)} disabled={busy}
                style={{ padding: '13px', borderRadius: 12, border: 'none', background: meta.positive ? C.green : '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Recording…' : `Confirm ${meta.label}`}
              </button>
              <button onClick={() => decide(meta.alt)} disabled={busy}
                style={{ padding: '10px', borderRadius: 12, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {alt.label} instead
              </button>
            </>
          );
        })()}
        <div style={{ textAlign: 'center', fontSize: 11, color: C.slate }}>EVOne · Purchase Order Approval</div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────

type Tab = 'raise' | 'track' | 'template';

// Raise PO picks from the Stock Levels items (one item list for stock and
// purchasing); new items are only added in Inventory → Stock Levels.
interface InvItemRow {
  id: string; name: string; category: string | null; brand: string | null; unit: string; unit_price: number | null;
  currency: string; supplier: string | null; description: string | null; active: boolean;
}
const toProduct = (i: InvItemRow): Product => ({
  id: i.id, name: i.name, category: i.category || 'Uncategorised', unit: i.unit || 'unit', unit_price: Number(i.unit_price ?? 0),
  currency: i.currency || 'SGD', supplier: i.supplier, description: i.description, is_active: i.active,
});

export function ScreenRaisePO() {
  const { can } = usePermissions();
  const canEdit = can('raise_po', 'can_edit');
  const canDelete = can('raise_po', 'can_delete');

  const [products, setProducts] = useState<Product[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [settings, setSettings] = useState<POSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('raise');

  const [seeAll, setSeeAll] = useState(false);
  const [customers, setCustomers] = useState<CustomerRef[]>([]);
  const [accounts, setAccounts] = useState<PoAccount[]>([]);

  const fetchAll = async () => {
    const [{ data: p }, { data: s }, { data: cu }] = await Promise.all([
      supabase.from('inv_items').select('id, name, category, brand, unit, unit_price, currency, supplier, description, active').order('category').order('name'),
      supabase.from('po_settings').select('*').eq('id', 'default').maybeSingle(),
      supabase.from('customers').select('id, name').order('name'),
    ]);
    setCustomers((cu as CustomerRef[]) ?? []);
    const st = (s as POSettings) ?? { id: 'default', subject: '', body: '', approver_email: null, finance_email: null, cc_email: null, from_address: null, reply_to: null };
    // Everyone with Raise PO sees every PO and its status; who may act on one
    // is decided by the approver / finance accounts in the settings tab.
    const all = true;
    const [{ data: o }, { data: us }] = await Promise.all([
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('app_users').select('id, full_name, email, is_active').order('full_name'),
    ]);
    setAccounts((us as PoAccount[]) ?? []);
    setProducts(((p as InvItemRow[]) ?? []).map(toProduct));
    setPos((o as unknown as PurchaseOrder[]) ?? []);
    setSettings(st);
    setSeeAll(all);
    setLoading(false);
  };
  useEffect(() => { void fetchAll(); }, []);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  const pending = pos.filter((p) => p.status === 'pending').length;
  const tabs: [Tab, string][] = [['raise', 'Raise PO'], ['track', `${seeAll ? 'All POs' : 'My POs'}${pos.length ? ` · ${pos.length}` : ''}`]];
  if (canEdit) { tabs.push(['template', 'Approvers & Email']); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label={seeAll ? 'Purchase Orders' : 'My Purchase Orders'} value={String(pos.length)}
          sub={seeAll ? 'across the whole team' : 'raised by me'} accent />
        <KPICard label="Pending Approval" value={String(pending)} sub="awaiting the approver" />
        <KPICard label="Items" value={String(products.filter((p) => p.is_active).length)} sub="from Inventory · Stock Levels" />
      </div>

      <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: '8px 18px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: tab === id ? C.green : 'transparent', color: tab === id ? C.white : C.slate }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'raise' && <RaiseTab products={products} customers={customers} accounts={accounts} settings={settings!} onSent={async () => { await fetchAll(); setTab('track'); }} />}
      {tab === 'track' && <TrackTab pos={pos} customers={customers} accounts={accounts} settings={settings!} canEdit={canEdit} canDelete={canDelete} onRefresh={fetchAll} />}
      {tab === 'template' && canEdit && <TemplateTab settings={settings!} accounts={accounts} onRefresh={fetchAll} />}
    </div>
  );
}

// ── Raise PO ──────────────────────────────────────────────────────

interface RaiseDraft { title: string; notes: string; lines: POLine[]; customer?: CustomerRef | null }

function RaiseTab({ products, customers, accounts, settings, onSent }: { products: Product[]; customers: CustomerRef[]; accounts: PoAccount[]; settings: POSettings; onSent: () => Promise<void> }) {
  const { user } = usePermissions();
  const draftKey = `evone.draft.raise_po.${user.id}`;
  const [draft] = useState(() => readDraft<RaiseDraft>(draftKey));
  const [title, setTitle] = useState(draft?.title ?? '');
  const [customer, setCustomer] = useState<CustomerRef | null>(draft?.customer ?? null);
  // The approver accounts are chosen in the Approvers & Email tab; their emails get the "PO waiting" notice.
  const approverAccounts = accounts.filter((a) => (settings.approver_user_ids ?? []).includes(a.id));
  // Until an approver account is chosen, the notice still goes to the address
  // typed before accounts existed, so raising a PO is never blocked.
  const approver = approverAccounts.length ? approverAccounts.map((a) => a.email).join(', ') : (settings.approver_email ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const sellCurrency = 'SGD'; // customer is always billed in SGD
  const [lines, setLines] = useState<POLine[]>(() => (Array.isArray(draft?.lines) ? draft!.lines : []));
  const hasDraft = lines.length > 0 || !!title.trim() || !!notes.trim() || !!customer;
  useDraftSync(draftKey, { title, notes, lines, customer }, hasDraft);
  const clearAll = () => { clearDraft(draftKey); setTitle(''); setNotes(''); setLines([]); setCustomer(null); setPriceText({}); setError(null); };
  // What's typed in a price box, kept as text so "12." / "0.5" can be typed;
  // the line holds the parsed number.
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  const priceInput = (l: POLine, field: 'unit_price' | 'sell_price') => ({
    value: priceText[`${l.key}:${field}`] ?? String(l[field]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value.replace(/[^0-9.]/g, '');
      setPriceText((t) => ({ ...t, [`${l.key}:${field}`]: text }));
      updateLine(l.key, { [field]: parseFloat(text) || 0 });
    },
    onBlur: () => setPriceText((t) => { const n = { ...t }; delete n[`${l.key}:${field}`]; return n; }),
  });
  const [catFilter, setCatFilter] = useState('');
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = products.filter((p) => p.is_active);
  const cats = [...new Set(active.map((p) => p.category))].sort((a, b) => a.localeCompare(b));
  const ql = query.trim().toLowerCase();
  const shown = active.filter((p) => (!catFilter || p.category === catFilter)
    && (!ql || `${p.name} ${p.description ?? ''} ${p.supplier ?? ''}`.toLowerCase().includes(ql)));
  const grouped = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of shown) { const a = m.get(p.category) ?? []; a.push(p); m.set(p.category, a); }
    for (const [, arr] of m) arr.sort((a, b) => a.name.localeCompare(b.name));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const poCurrency = lines[0]?.currency ?? 'SGD';
  const poSupplier = lines.find((l) => l.supplier)?.supplier ?? ''; // a PO is for one supplier — taken from its items
  // Chargers on won Sales quotes with no PO yet (or whose PO was rejected /
  // cancelled). Adding one brings its quantity and warranty onto this PO and,
  // once the PO is raised, links the Order Book line to it.
  const [source, setSource] = useState<'items' | 'awaiting'>('items');
  const [awaiting, setAwaiting] = useState<AwaitingCharger[]>([]);
  const loadAwaiting = async () => {
    const [{ data: ol }, { data: qs }, { data: dead }] = await Promise.all([
      supabase.from('sales_order_lines').select('id, quote_id, item_id, item_name, qty, warranty_years, po_id, po_no, from_stock').eq('from_stock', false).order('created_at'),
      supabase.from('sales_quotations').select('id, ref, customer_id, customer_name, won_at, outcome_date').eq('status', 'Won'),
      supabase.from('purchase_orders').select('id').in('status', ['rejected', 'cancelled']),
    ]);
    const quoteById = new Map(((qs ?? []) as { id: string; ref: string; customer_id: string | null; customer_name: string; won_at: string | null; outcome_date: string | null }[]).map((q) => [q.id, q]));
    const deadPo = new Set(((dead ?? []) as { id: string }[]).map((d) => d.id));
    setAwaiting(((ol ?? []) as { id: string; quote_id: string; item_id: string | null; item_name: string; qty: number; warranty_years: number | null; po_id: string | null; po_no: string | null }[])
      .filter((l) => quoteById.has(l.quote_id) && (l.po_id ? deadPo.has(l.po_id) : !(l.po_no ?? '').trim()))
      .map((l) => {
        const q = quoteById.get(l.quote_id)!;
        return { id: l.id, item_id: l.item_id, item_name: l.item_name, qty: l.qty, warranty_years: l.warranty_years,
          quote_ref: q.ref, customer_id: q.customer_id, customer_name: (q.customer_id && customers.find((c) => c.id === q.customer_id)?.name) || q.customer_name,
          won: (q.won_at ?? q.outcome_date ?? '').slice(0, 10) };
      })
      .sort((a, b) => a.won.localeCompare(b.won)));
  };
  useEffect(() => { void loadAwaiting(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addAwaiting = (a: AwaitingCharger) => {
    const p = a.item_id ? products.find((x) => x.id === a.item_id) : undefined;
    const currency = p?.currency ?? lines[0]?.currency ?? 'SGD';
    const sup = lines.find((l) => l.supplier)?.supplier ?? null;
    if (lines.length && (lines[0].currency !== currency || (sup && p?.supplier && sup !== p.supplier))) {
      window.alert(`This PO is for ${sup || 'no supplier'} (${lines[0].currency}). ${a.item_name} is ${p?.supplier ? `from ${p.supplier}` : 'priced'} in ${currency} — raise it on its own PO, or remove the current items first.`);
      return;
    }
    if (lines.some((l) => l.order_line_id === a.id)) return;
    setLines((prev) => [...prev, {
      key: newKey(), product_id: p?.id ?? null, name: p?.name ?? a.item_name,
      remark: p?.description || null,
      unit: p?.unit ?? 'unit', unit_price: p?.unit_price ?? 0, sell_price: 0, qty: a.qty, currency, supplier: p?.supplier ?? null, order_line_id: a.id, warranty_years: a.warranty_years,
    }]);
    if (!customer && a.customer_id) { const c = customers.find((x) => x.id === a.customer_id); if (c) setCustomer(c); }
  };

  const addProduct = (p: Product) => setLines((prev) => {
    if (prev.length) {
      // Items with no supplier on file fit any PO; otherwise one supplier and one currency per PO.
      const sup = prev.find((l) => l.supplier)?.supplier ?? null;
      if (prev[0].currency !== p.currency || (sup && p.supplier && sup !== p.supplier)) {
        window.alert(`This PO is for ${sup || 'no supplier'} (${prev[0].currency}). Add items from the same supplier and currency, or remove the current items first. Set an item's supplier and currency in Inventory → Stock Levels.`);
        return prev;
      }
    }
    const ex = prev.find((l) => l.product_id === p.id && !l.order_line_id);
    if (ex) return prev.map((l) => (l.key === ex.key ? { ...l, qty: l.qty + 1 } : l));
    return [...prev, { key: newKey(), product_id: p.id, name: p.name, remark: p.description, unit: p.unit, unit_price: p.unit_price, sell_price: 0, qty: 1, currency: p.currency, supplier: p.supplier }];
  });
  const updateLine = (key: string, patch: Partial<POLine>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const sellSubtotal = lines.reduce((s, l) => s + l.qty * l.sell_price, 0);
  const canSend = lines.length > 0 && !!approver.trim() && /@/.test(approver) && !sending;

  const send = async () => {
    setSending(true);
    setError(null);
    const { data: created, error: insErr } = await supabase.from('purchase_orders').insert({
      title: title.trim() || 'Untitled PO',
      customer_id: customer?.id ?? null,
      customer_name: customer?.name ?? null,
      supplier: poSupplier || null,
      approver_email: approver.trim(),
      finance_email: settings.finance_email,
      lines: lines.map(({ key, ...rest }) => rest),
      subtotal,
      currency: poCurrency,
      sell_subtotal: sellSubtotal,
      sell_currency: sellCurrency,
      notes: notes.trim() || null,
      app_base: `${window.location.origin}${window.location.pathname}`,
      status: 'pending',
      email_status: 'queued',
      created_by: user.full_name || user.email,
      created_by_id: user.id,
    }).select('*').single();
    if (insErr || !created) { setSending(false); setError(insErr?.message ?? 'Could not create the PO.'); return; }

    const po = created as unknown as PurchaseOrder;
    const html = buildPoEmail(po, settings, user.full_name || user.email);
    const subject = `Purchase Order - ${po.supplier || 'No supplier'} - ${po.title}`;
    let emailErr: string | null = null;
    try {
      const { data: r, error: fnErr } = await supabase.functions.invoke('send-customer-email', {
        body: { to: toList(approver), subject, html, from: settings.from_address || undefined, replyTo: settings.reply_to || undefined },
      });
      emailErr = (r as { error?: string } | null)?.error ?? fnErr?.message ?? null;
    } catch (e) { emailErr = (e as Error).message || 'send failed'; }
    // The default CC gets a buttons-free FYI copy in a SEPARATE send, so the
    // Approve/Reject links never leave the approver's inbox. A CC failure
    // doesn't fail the PO.
    if (!emailErr) void sendFyiCopies(po, settings, user.full_name || user.email, subject);
    await supabase.from('purchase_orders').update({ email_status: emailErr ? 'failed' : 'sent', email_error: emailErr }).eq('id', po.id);

    // Tie each Order Book charger raised here to this PO. A failure only leaves
    // the link to be made by hand in the Order Book — the PO itself is saved.
    const linked = lines.map((l) => l.order_line_id).filter((x): x is string => !!x);
    let linkErr: string | null = null;
    if (linked.length) {
      const { error: le } = await supabase.from('sales_order_lines').update({ po_id: po.id, po_no: po.po_number, updated_at: new Date().toISOString() }).in('id', linked);
      linkErr = le?.message ?? null;
      // A warranty keyed in here is the one being bought — keep the Order Book in step.
      for (const l of lines) {
        if (linkErr || !l.order_line_id || l.warranty_years == null) continue;
        const { error: we } = await supabase.from('sales_order_lines').update({ warranty_years: l.warranty_years }).eq('id', l.order_line_id);
        if (we) linkErr = we.message;
      }
    }

    setSending(false);
    clearAll();
    void loadAwaiting();
    if (linkErr) window.alert(`PO ${po.po_number} was raised, but its chargers could not be linked in the Order Book (${linkErr}). Link them there by hand.`);
    if (emailErr) { setError(`PO ${po.po_number} saved, but the email failed: ${emailErr}. You can resend it from My POs.`); }
    await onSent();
  };

  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 16, alignItems: 'flex-start' }}>
      {/* Catalog picker */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '72vh' }}>
        <div style={{ padding: 14, borderBottom: '1px solid #F3F3F3', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Add items</div>
          <div style={{ display: 'flex', gap: 4, background: C.seasalt, borderRadius: 10, padding: 3 }}>
            {([['items', 'Stock Levels'], ['awaiting', `Awaiting PO${awaiting.length ? ` · ${awaiting.length}` : ''}`]] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setSource(id)}
                style={{ flex: 1, padding: '7px 8px', borderRadius: 8, border: 'none', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                  background: source === id ? C.green : 'transparent', color: source === id ? C.white : C.slate }}>
                {label}
              </button>
            ))}
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={source === 'awaiting' ? 'Search charger, quote, customer…' : 'Search items, models, suppliers…'} style={inputStyle} />
          {source === 'items' && (
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="">All categories</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {source === 'awaiting' && <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.4 }}>Chargers on won quotes with no PO yet. Adding one brings its quantity and warranty, and links it to this PO in the Order Book.</div>}
        </div>
        <div style={{ overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {source === 'awaiting' ? (() => {
            const list = awaiting.filter((a) => !ql || `${a.item_name} ${a.quote_ref} ${a.customer_name}`.toLowerCase().includes(ql));
            if (!list.length) return <div style={{ padding: '30px 14px', textAlign: 'center', color: C.slate, fontSize: 12 }}>{awaiting.length ? 'No chargers match.' : 'No chargers are awaiting a PO.'}</div>;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {list.map((a) => {
                  const added = lines.some((l) => l.order_line_id === a.id);
                  return (
                    <button key={a.id} type="button" onClick={() => addAwaiting(a)} disabled={added}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: 'none', background: added ? C.honeydew : 'transparent', cursor: added ? 'default' : 'pointer', textAlign: 'left', fontFamily: 'Figtree' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.qty} × {a.item_name}</span>
                        <span style={{ display: 'block', fontSize: 11, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.quote_ref} · {a.customer_name}</span>
                        <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: a.warranty_years != null ? '#6B21A8' : '#B45309' }}>
                          {a.warranty_years != null ? `${a.warranty_years}-yr warranty` : 'Warranty not set'}{!a.item_id ? ' · not in Stock Levels' : ''}
                        </span>
                      </span>
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: C.green, minWidth: 24, height: 24, padding: added ? '0 6px' : 0, borderRadius: 7, background: C.honeydew, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        {added ? 'Added' : <Plus size={14} strokeWidth={2.5} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })() : active.length === 0 ? (
            <div style={{ padding: '30px 14px', textAlign: 'center', color: C.slate, fontSize: 12 }}>No items yet. Add them in <strong>Inventory → Stock Levels</strong>.</div>
          ) : grouped.map(([cat, list]) => (
            <div key={cat}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '2px 8px 6px' }}>{cat}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {list.map((p) => (
                  <button key={p.id} onClick={() => addProduct(p)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.seasalt; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'Figtree' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      {p.description && <span style={{ display: 'block', fontSize: 11, color: C.slate, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</span>}
                      <span style={{ display: 'block', fontSize: 11, color: C.slate }}>{p.unit_price > 0 ? `${money(p.unit_price, p.currency)} / ${p.unit}` : 'No price on file — enter it on the PO'}{p.supplier ? ` · ${p.supplier}` : ''}</span>
                    </span>
                    <span style={{ width: 24, height: 24, borderRadius: 7, background: C.honeydew, color: C.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Plus size={14} strokeWidth={2.5} /></span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PO sheet */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>}
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>PO Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chargers for Blk 123 project" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Customer</label>
            <CustomerSelect customers={customers} value={customer?.id ?? ''} onChange={setCustomer} />
          </div>
          <div style={{ fontSize: 12, color: C.slate }}>
            Supplier: <strong style={{ color: '#1a1a1a' }}>{poSupplier || '— add an item to set the supplier —'}</strong>
          </div>
          <div style={{ fontSize: 12, color: C.slate }}>
            Approved in the app by <strong style={{ color: '#1a1a1a' }}>{approverAccounts.map(accountLabel).join(', ') || 'a department admin (no approver account chosen yet)'}</strong>
            {approverAccounts.length === 0 && <> · choose one in the <strong>Approvers & Email</strong> tab</>}
          </div>
        </div>

        {hasDraft && (
          <DraftBar onClear={clearAll}
            summary={[title.trim() && 'the title', customer && 'the customer', lines.length && `${lines.length} item${lines.length === 1 ? '' : 's'}`, notes.trim() && 'notes'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1')} />
        )}
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>Item</th>
                {[`Unit Cost (${poCurrency})`, 'Qty', 'Unit', 'Line Cost', ''].map((h, i) => (
                  <th key={i} style={{ padding: '11px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} style={{ borderBottom: '1px solid #F3F3F3' }}>
                  <td style={{ padding: '8px 14px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{l.name}</div>
                    {l.remark && <div style={{ fontSize: 12, color: C.slate, whiteSpace: 'pre-line', marginTop: 2 }}>{l.remark}</div>}
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, fontWeight: 700, color: l.warranty_years != null ? '#6B21A8' : C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Warranty to order
                      <input type="number" min={0} max={20} step={0.5} value={l.warranty_years ?? ''} placeholder="—" aria-label="Warranty years to order from the supplier"
                        onChange={(e) => { const n = Number(e.target.value); updateLine(l.key, { warranty_years: e.target.value === '' || !Number.isFinite(n) ? null : Math.min(20, Math.max(0, n)) }); }}
                        style={{ width: 64, padding: '4px 6px', borderRadius: 8, border: `1px solid ${l.warranty_years != null ? '#6B21A8' : '#EBEBEB'}`, fontFamily: 'Figtree', fontSize: 13, textAlign: 'right', outline: 'none', background: C.white }} />
                      yrs
                    </label>
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', verticalAlign: 'middle' }}>
                    <input type="text" inputMode="decimal" {...priceInput(l, 'unit_price')}
                      style={{ width: 88, padding: '6px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, textAlign: 'right', outline: 'none', background: C.white }} />
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', verticalAlign: 'middle' }}>
                    <input type="text" inputMode="decimal" value={l.qty} onChange={(e) => updateLine(l.key, { qty: Math.max(0, parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0) })}
                      style={{ width: 60, padding: '6px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, textAlign: 'right', outline: 'none', background: C.white }} />
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 13, color: C.slate, verticalAlign: 'middle' }}>{l.unit}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#1a1a1a', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{money(l.qty * l.unit_price, poCurrency)}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                    <button onClick={() => removeLine(l.key)} title="Remove" style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Add products from the catalog to build this PO.</td></tr>}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '18px 22px', width: 340, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 13, color: C.slate }}>Purchase cost <span style={{ fontSize: 11 }}>({poCurrency})</span></span>
              <span style={{ fontSize: 24, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>{money(subtotal, poCurrency)}</span>
            </div>
            <div>
              <label style={labelStyle}>Notes to approver</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'Figtree' }} />
            </div>
            <button onClick={send} disabled={!canSend}
              style={{ marginTop: 4, padding: '11px', borderRadius: 10, border: 'none', background: canSend ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 14, fontWeight: 700, cursor: canSend ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Send size={14} strokeWidth={2.25} /> {sending ? 'Sending…' : 'Send for approval'}
            </button>
            {!/@/.test(approver) && lines.length > 0 && <div style={{ fontSize: 11, color: C.slate, textAlign: 'center' }}>Choose the approver account in the Approvers & Email tab to send.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Track (My POs) ────────────────────────────────────────────────

function TrackTab({ pos, customers, accounts, settings, canEdit, canDelete, onRefresh }: { pos: PurchaseOrder[]; customers: CustomerRef[]; accounts: PoAccount[]; settings: POSettings; canEdit: boolean; canDelete: boolean; onRefresh: () => Promise<void> }) {
  const { user, isAdmin, can } = usePermissions();
  // Only the chosen accounts can act. Until someone is chosen for a step, a
  // department admin can, so a PO is never stuck with nobody able to move it.
  const approverIds = settings.approver_user_ids ?? [];
  const financeIds = settings.finance_user_ids ?? [];
  const canApprove = approverIds.length ? approverIds.includes(user.id) : isAdmin;
  const canFinance = financeIds.length ? financeIds.includes(user.id) : isAdmin;
  const namesOf = (ids: string[]) => accounts.filter((a) => ids.includes(a.id)).map(accountLabel).join(', ');
  const me = user.full_name && user.full_name !== user.email ? `${user.full_name} (${user.email})` : user.email;
  const customerName = (po: PurchaseOrder) => (po.customer_id && customers.find((c) => c.id === po.customer_id)?.name) || po.customer_name || null;
  const go = useScreenNav();
  const [open, setOpen] = useState<PurchaseOrder | null>(null);
  const [busy, setBusy] = useState(false);
  // In-modal feedback for resend / admin decisions — the old resend gave no
  // success signal at all, which read as "the button does nothing".
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  const openPo = (po: PurchaseOrder) => { setNotice(null); setOpen(po); };

  // Admin override: approve/reject in place of the boss (e.g. boss unavailable).
  // Approving hands the PO to finance straight away — the po-decision function
  // does the same when the boss approves from the email link.
  const manualDecision = async (po: PurchaseOrder, decision: 'approved' | 'rejected') => {
    setBusy(true);
    const decided_at = new Date().toISOString();
    const { data, error } = await supabase.from('purchase_orders')
      .update({ status: decision, decided_at, decided_by: me }).eq('id', po.id).eq('status', 'pending').select('id');
    if (error) { setBusy(false); setNotice({ text: `Could not update the PO: ${error.message}`, tone: 'err' }); return; }
    if (!data?.length) { setBusy(false); setNotice({ text: 'This PO was already decided elsewhere — the list has been refreshed.', tone: 'err' }); setOpen(null); await onRefresh(); return; }
    const by = user.full_name || user.email;
    if (decision === 'rejected') {
      setBusy(false);
      setOpen({ ...po, status: decision, decided_at });
      setNotice({ text: `Rejected by you (${by}).`, tone: 'ok' });
      await onRefresh();
      return;
    }
    const approved = { ...po, status: 'approved' as const, decided_at, decided_by: me };
    const r = await sendToFinance(approved);
    setBusy(false);
    if ('error' in r) {
      setOpen(approved);
      setNotice({ text: `Approved by you (${by}), but finance was not emailed — ${r.error} Use Forward to finance below to retry.`, tone: 'err' });
    } else {
      setOpen({ ...approved, status: 'sent_to_finance', forwarded_at: r.forwarded_at, finance_email: r.finance });
      setNotice({ text: `Approved by you (${by}) — finance has been notified (${r.finance}).`, tone: 'ok' });
    }
    await onRefresh();
  };

  // Admin stand-in for finance's "Mark completed" email link. Status
  // 'completed' fires the purchase_orders_to_shipments trigger, which turns
  // the PO lines into one Ordered shipment in Incoming Shipments.
  const completeAsAdmin = async (po: PurchaseOrder) => {
    setBusy(true);
    const finance_decided_at = new Date().toISOString();
    const { data, error } = await supabase.from('purchase_orders')
      .update({ status: 'completed', finance_decided_at, finance_decided_by: me }).eq('id', po.id).in('status', ['approved', 'sent_to_finance']).select('id');
    if (error) { setBusy(false); setNotice({ text: `Could not complete the PO: ${error.message}`, tone: 'err' }); return; }
    if (!data?.length) { setBusy(false); setNotice({ text: 'This PO changed status elsewhere — the list has been refreshed.', tone: 'err' }); setOpen(null); await onRefresh(); return; }
    const { count } = await supabase.from('inv_shipments').select('id', { count: 'exact', head: true }).eq('po_id', po.id);
    setBusy(false);
    setOpen({ ...po, status: 'completed', finance_decided_at, finance_decided_by: me });
    setNotice(count
      ? { text: `Marked completed by you (${user.full_name || user.email}) — ${count} item line${count === 1 ? '' : 's'} now in Incoming Shipments as Ordered.`, tone: 'ok' }
      : { text: 'Marked completed, but no shipment lines were created (no line has a quantity). Add the shipment by hand in Incoming Shipments.', tone: 'err' });
    await onRefresh();
  };

  const cancelByFinance = async (po: PurchaseOrder) => {
    setBusy(true);
    const finance_decided_at = new Date().toISOString();
    const { data, error } = await supabase.from('purchase_orders')
      .update({ status: 'cancelled', finance_decided_at, finance_decided_by: me }).eq('id', po.id).in('status', ['approved', 'sent_to_finance']).select('id');
    setBusy(false);
    if (error) { setNotice({ text: `Could not cancel the PO: ${error.message}`, tone: 'err' }); return; }
    if (!data?.length) { setNotice({ text: 'This PO changed status elsewhere — the list has been refreshed.', tone: 'err' }); setOpen(null); await onRefresh(); return; }
    setOpen({ ...po, status: 'cancelled', finance_decided_at, finance_decided_by: me });
    setNotice({ text: `Cancelled by you (${user.full_name || user.email}).`, tone: 'ok' });
    await onRefresh();
  };

  // Customer only — never rewrites the PO's lines or status.
  const setPoCustomer = async (po: PurchaseOrder, c: CustomerRef | null) => {
    setBusy(true);
    const { error } = await supabase.from('purchase_orders').update({ customer_id: c?.id ?? null, customer_name: c?.name ?? null }).eq('id', po.id);
    setBusy(false);
    if (error) { setNotice({ text: `Could not set the customer: ${error.message}`, tone: 'err' }); return; }
    setOpen({ ...po, customer_id: c?.id ?? null, customer_name: c?.name ?? null });
    setNotice({ text: c ? `Customer set to ${c.name}.` : 'Customer cleared.', tone: 'ok' });
    await onRefresh();
  };

  const deletePO = async (po: PurchaseOrder) => {
    setBusy(true);
    const { error } = await supabase.from('purchase_orders').delete().eq('id', po.id);
    setBusy(false);
    if (error) { window.alert(`Could not delete: ${error.message}`); return; }
    setOpen(null);
    await onRefresh();
  };

  // Addresses always come from the CURRENT Email Template — the values stored
  // on the PO row are only a record of where it went originally, kept as a
  // fallback for POs older than the template.
  const approverFor = (po: PurchaseOrder) => settings.approver_email || po.approver_email;
  const financeFor = (po: PurchaseOrder) => settings.finance_email || po.finance_email;

  const resend = async (po: PurchaseOrder) => {
    const approver = approverFor(po);
    if (!approver) { setNotice({ text: 'No approver account is chosen. Pick one in the Approvers & Email tab.', tone: 'err' }); return; }
    setBusy(true);
    const html = buildPoEmail(po, settings, po.created_by || user.full_name);
    const subject = `Purchase Order - ${po.supplier || 'No supplier'} - ${po.title}`;
    let emailErr: string | null = null;
    try {
      const { data: r, error } = await supabase.functions.invoke('send-customer-email', {
        body: { to: toList(approver), subject, html, from: settings.from_address || undefined, replyTo: settings.reply_to || undefined },
      });
      emailErr = (r as { error?: string } | null)?.error ?? error?.message ?? null;
      if (!emailErr) void sendFyiCopies(po, settings, po.created_by || user.full_name, subject);
    } catch (e) { emailErr = (e as Error).message; }
    await supabase.from('purchase_orders').update({ email_status: emailErr ? 'failed' : 'sent', email_error: emailErr, approver_email: approver }).eq('id', po.id);
    setBusy(false);
    setNotice(emailErr
      ? { text: `Resend failed: ${emailErr}`, tone: 'err' }
      : { text: `Approval notice resent to ${approver} at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`, tone: 'ok' });
    await onRefresh();
  };

  // Email finance the approved PO, then move it to 'sent_to_finance'.
  const sendToFinance = async (po: PurchaseOrder): Promise<{ error: string } | { finance: string; forwarded_at: string }> => {
    const finance = financeFor(po);
    if (!finance) return { error: 'No finance account is chosen. Pick one in the Approvers & Email tab.' };
    const html = buildFinanceEmail(po, po.created_by || user.full_name, settings);
    const subject = `Approved PO - ${po.supplier || 'No supplier'} - ${po.title}`;
    let emailErr: string | null = null;
    try {
      const { data: r, error } = await supabase.functions.invoke('send-customer-email', {
        body: { to: toList(finance), subject, html, from: settings.from_address || undefined, replyTo: settings.reply_to || undefined },
      });
      emailErr = (r as { error?: string } | null)?.error ?? error?.message ?? null;
      if (!emailErr) void sendFyiCopies(po, settings, po.created_by || user.full_name, subject, 'finance');
    } catch (e) { emailErr = (e as Error).message; }
    if (emailErr) return { error: `Could not email finance: ${emailErr}.` };
    const forwarded_at = new Date().toISOString();
    const { error } = await supabase.from('purchase_orders')
      .update({ status: 'sent_to_finance', forwarded_at, finance_email: finance }).eq('id', po.id);
    if (error) return { error: `Finance was emailed, but the PO status did not save: ${error.message}.` };
    return { finance, forwarded_at };
  };

  const forwardToFinance = async (po: PurchaseOrder) => {
    setBusy(true);
    const r = await sendToFinance(po);
    setBusy(false);
    if ('error' in r) { setNotice({ text: r.error, tone: 'err' }); return; }
    setOpen({ ...po, status: 'sent_to_finance', forwarded_at: r.forwarded_at, finance_email: r.finance });
    setNotice({ text: `Emailed to finance (${r.finance}).`, tone: 'ok' });
    await onRefresh();
  };

  // Re-send the finance email for a PO that is already with finance — no
  // status change, just the same email again (plus FYI copies).
  const resendFinance = async (po: PurchaseOrder) => {
    const finance = financeFor(po);
    if (!finance) { setNotice({ text: 'No finance account is chosen. Pick one in the Approvers & Email tab.', tone: 'err' }); return; }
    setBusy(true);
    const html = buildFinanceEmail(po, po.created_by || user.full_name, settings);
    const subject = `Approved PO - ${po.supplier || 'No supplier'} - ${po.title}`;
    let emailErr: string | null = null;
    try {
      const { data: r, error } = await supabase.functions.invoke('send-customer-email', {
        body: { to: toList(finance), subject, html, from: settings.from_address || undefined, replyTo: settings.reply_to || undefined },
      });
      emailErr = (r as { error?: string } | null)?.error ?? error?.message ?? null;
      if (!emailErr) void sendFyiCopies(po, settings, po.created_by || user.full_name, subject, 'finance');
    } catch (e) { emailErr = (e as Error).message; }
    if (!emailErr && po.finance_email !== finance) {
      await supabase.from('purchase_orders').update({ finance_email: finance }).eq('id', po.id);
    }
    setBusy(false);
    setNotice(emailErr
      ? { text: `Resend to finance failed: ${emailErr}`, tone: 'err' }
      : { text: `Finance email resent to ${finance} at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`, tone: 'ok' });
  };

  if (pos.length === 0) {
    return <div style={{ background: C.white, border: '1px dashed #EBEBEB', borderRadius: 16, padding: '48px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
      <ClipboardEmpty /> You haven't raised any POs yet. Build one in the <strong>Raise PO</strong> tab.
    </div>;
  }

  return (
    <>
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['PO', 'Supplier', 'Total', 'Status', 'Email', 'Raised', ''].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: h === 'Total' ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pos.map((po) => {
              const st = STATUS_STYLE[po.status];
              return (
                <tr key={po.id} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  onClick={() => openPo(po)}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{po.po_number}</div>
                    <div style={{ fontSize: 12, color: C.slate }}>{po.title}</div>
                    {customerName(po) && <div style={{ fontSize: 11, color: C.slate, marginTop: 1 }}>for <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{customerName(po)}</span></div>}
                    {po.created_by && po.created_by_id !== user.id && (
                      <div style={{ fontSize: 11, color: C.slate, marginTop: 1 }}>by <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{po.created_by}</span></div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#1a1a1a' }}>{po.supplier || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(po.subtotal, po.currency)} <span style={{ fontSize: 10, color: C.slate, fontWeight: 700 }}>{po.currency}</span></td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>{st.label}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: po.email_status === 'sent' ? '#1B512D' : po.email_status === 'failed' ? '#C0321A' : C.slate }}>
                      {po.email_status === 'sent' ? '✓ Sent' : po.email_status === 'failed' ? 'Failed' : 'Queued'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate, whiteSpace: 'nowrap' }}>{new Date(po.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    {po.email_status === 'failed' && po.status === 'pending' && (
                      <button onClick={() => resend(po)} disabled={busy} title="Resend approval email"
                        style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Resend</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <PODetailModal po={open} busy={busy} canDelete={canDelete} canApprove={canApprove} canFinance={canFinance} notice={notice}
          approverNames={namesOf(approverIds)} financeNames={namesOf(financeIds)} onCancel={() => cancelByFinance(open)}
          customers={customers} customerName={customerName(open)} canEditCustomer={canEdit} onSetCustomer={(c) => setPoCustomer(open, c)}
          financeEmail={financeFor(open)} approverEmail={approverFor(open)}
          onResend={() => resend(open)} onForward={() => forwardToFinance(open)}
          onResendFinance={() => resendFinance(open)}
          onManualDecision={(d) => manualDecision(open, d)}
          onComplete={() => completeAsAdmin(open)}
          onOpenShipments={can('inv_shipments', 'can_view') ? () => { setOpen(null); go('inv_shipments'); } : undefined}
          onDelete={() => deletePO(open)} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function ClipboardEmpty() {
  return <div style={{ marginBottom: 10 }}><Package size={30} strokeWidth={1.5} style={{ color: C.slate }} /></div>;
}

type StepState = 'done' | 'current' | 'pending' | 'error';
const fmtDT = (s: string | null) => (s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function POTimeline({ po, financeEmail, approverEmail }: { po: PurchaseOrder; financeEmail: string | null; approverEmail: string | null }) {
  const steps: { label: string; sub: string; state: StepState }[] = [];
  steps.push({ label: 'PO raised', sub: `by ${po.created_by ?? 'you'} · ${fmtDT(po.created_at)}`, state: 'done' });
  steps.push({
    label: 'Approver notified',
    sub: po.email_status === 'sent' ? `Sent to ${approverEmail ?? po.approver_email}` : po.email_status === 'failed' ? 'Send failed — resend below' : 'Queued to send',
    state: po.email_status === 'sent' ? 'done' : po.email_status === 'failed' ? 'error' : 'pending',
  });
  if (po.status === 'rejected') {
    steps.push({ label: 'Rejected by approver', sub: fmtDT(po.decided_at) || 'Declined', state: 'error' });
  } else {
    steps.push({
      label: po.status === 'pending' ? 'Awaiting approval' : 'Approved',
      sub: po.status === 'pending' ? 'The approver decides in the app' : [fmtDT(po.decided_at), po.decided_by && `by ${po.decided_by}`].filter(Boolean).join(' · '),
      state: po.status === 'pending' ? 'current' : 'done',
    });
    const forwarded = po.status === 'sent_to_finance' || po.status === 'completed' || po.status === 'cancelled' || !!po.forwarded_at;
    steps.push({
      label: 'Sent to finance',
      sub: po.forwarded_at
        ? `${fmtDT(po.forwarded_at)}${financeEmail ? ` · to ${financeEmail}` : ''}`
        : po.status === 'approved' ? `Ready — use the button below${financeEmail ? ` (goes to ${financeEmail})` : ''}`
        : po.status === 'completed' ? 'Skipped — completed in the app by an admin' : 'After approval',
      state: forwarded ? 'done' : po.status === 'approved' ? 'current' : 'pending',
    });
    if (po.status === 'cancelled') {
      steps.push({ label: 'Cancelled by finance', sub: fmtDT(po.finance_decided_at) || 'Cancelled', state: 'error' });
    } else {
      steps.push({
        label: po.status === 'completed' ? 'Completed — sent to supplier' : 'Finance sends to supplier',
        sub: po.status === 'completed' ? [fmtDT(po.finance_decided_at), po.finance_decided_by && `by ${po.finance_decided_by}`].filter(Boolean).join(' · ') : 'Finance marks it completed in the app',
        state: po.status === 'completed' ? 'done' : forwarded ? 'current' : 'pending',
      });
    }
  }

  const dot = (state: StepState) => {
    const base: React.CSSProperties = { width: 22, height: 22, borderRadius: 99, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 };
    if (state === 'done') return { ...base, background: C.green, color: C.white };
    if (state === 'error') return { ...base, background: '#C0321A', color: C.white };
    if (state === 'current') return { ...base, background: C.white, border: `2px solid ${C.green}`, color: C.green };
    return { ...base, background: '#EBEBEB', color: C.slate };
  };

  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Progress</div>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const lineColor = s.state === 'done' ? C.green : '#DDE3E8';
        return (
          <div key={i} style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={dot(s.state)}>{s.state === 'done' ? '✓' : s.state === 'error' ? '×' : s.state === 'current' ? '●' : ''}</div>
              {!last && <div style={{ width: 2, flex: 1, minHeight: 14, background: lineColor }} />}
            </div>
            <div style={{ paddingBottom: last ? 0 : 14, marginTop: 1 }}>
              <div style={{ fontSize: 13, fontWeight: s.state === 'current' ? 700 : 600, color: s.state === 'pending' ? C.slate : '#1a1a1a' }}>{s.label}</div>
              <div style={{ fontSize: 11, color: C.slate, marginTop: 1 }}>{s.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PODetailModal({ po, busy, canDelete, canApprove, canFinance, approverNames, financeNames, onCancel, notice, customers, customerName, canEditCustomer, onSetCustomer, financeEmail, approverEmail, onResend, onForward, onResendFinance, onManualDecision, onComplete, onOpenShipments, onDelete, onClose }: {
  po: PurchaseOrder;
  customers: CustomerRef[];
  customerName: string | null;
  canEditCustomer: boolean;
  onSetCustomer: (c: CustomerRef | null) => void;
  /** Addresses the sends actually use — current Email Template first, PO snapshot as fallback. */
  financeEmail: string | null;
  approverEmail: string | null;
  busy: boolean;
  canDelete: boolean;
  /** This account is an approver / a finance account (or stands in while none is chosen). */
  canApprove: boolean;
  canFinance: boolean;
  approverNames: string;
  financeNames: string;
  onCancel: () => void;
  notice: { text: string; tone: 'ok' | 'err' } | null;
  onResend: () => void;
  onForward: () => void;
  onResendFinance: () => void;
  onManualDecision: (decision: 'approved' | 'rejected') => void;
  onComplete: () => void;
  onOpenShipments?: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirmOverride, setConfirmOverride] = useState<'approved' | 'rejected' | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const shipLines = po.lines.filter((l) => Number(l.qty) > 0).length;
  const st = STATUS_STYLE[po.status];
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 560, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{po.po_number} · {po.title}</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{po.supplier || 'No supplier'} · to {approverEmail ?? po.approver_email}</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 99, background: st.bg, color: st.color }}>{st.label}</span>
          {po.decided_at && <span style={{ fontSize: 12, color: C.slate }}>on {new Date(po.decided_at).toLocaleString('en-GB')}</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer</span>
          {canEditCustomer
            ? <CustomerSelect customers={customers} value={po.customer_id ?? ''} disabled={busy} onChange={onSetCustomer} />
            : <span style={{ fontSize: 13, color: customerName ? '#1a1a1a' : C.slate }}>{customerName ?? 'No customer — stock / internal'}</span>}
        </div>

        <POTimeline po={po} financeEmail={financeEmail} approverEmail={approverEmail} />

        <div style={{ background: C.seasalt, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {po.lines.map((l, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #EBEBEB' }}>
                  <td style={{ padding: '8px 12px', fontSize: 13, color: '#1a1a1a', verticalAlign: 'top' }}>
                    <div>{l.name}</div>
                    {l.remark && <div style={{ fontSize: 12, color: C.slate, whiteSpace: 'pre-line', marginTop: 2 }}>{l.remark}</div>}
                    {l.warranty_years != null && <div style={{ fontSize: 12, fontWeight: 700, color: '#6B21A8', marginTop: 3 }}>{warrantyText(l.warranty_years)}</div>}
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: C.slate, textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{l.qty} {l.unit} × {money(l.unit_price, po.currency)}</td>
                  <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 700, color: C.green, textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{money(l.qty * l.unit_price, po.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, color: C.slate }}>Purchase cost <span style={{ fontSize: 11 }}>({po.currency})</span></span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a' }}>{money(po.subtotal, po.currency)}</span>
          </div>
          {po.sell_subtotal > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Sold to customer <span style={{ fontSize: 11, color: C.slate }}>({po.sell_currency})</span></span>
              <span style={{ fontSize: 20, fontWeight: 700, color: C.green }}>{money(po.sell_subtotal, po.sell_currency)}</span>
            </div>
          )}
        </div>
        {po.notes && <div style={{ fontSize: 13, color: C.slate }}><strong style={{ color: '#1a1a1a' }}>Notes:</strong> {po.notes}</div>}
        {po.email_status === 'failed' && po.email_error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12 }}>Email failed: {po.email_error}</div>}

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this purchase order? This can't be undone.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={onDelete} disabled={busy} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>{busy ? 'Deleting…' : 'Yes, delete'}</button>
            </div>
          </div>
        )}

        {notice && (
          <div style={{ background: notice.tone === 'ok' ? '#E4F3E3' : '#FDEAEA', color: notice.tone === 'ok' ? '#1B512D' : '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, fontWeight: 600, lineHeight: 1.5 }}>
            {notice.text}
          </div>
        )}

        {po.status === 'pending' && !canApprove && (
          <div style={{ background: '#FFF8E1', color: '#B07D00', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, fontWeight: 600 }}>
            Waiting for approval by {approverNames || 'the approver (none chosen yet — a department admin can decide)'}.
          </div>
        )}
        {(po.status === 'approved' || po.status === 'sent_to_finance') && !canFinance && (
          <div style={{ background: '#E3F0FF', color: '#1A62C0', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, fontWeight: 600 }}>
            Approved — with finance ({financeNames || 'none chosen yet — a department admin can complete it'}) to send to the supplier.
          </div>
        )}
        {/* Admin override — for when the boss can't action the email. Same
            transition the email link performs; the flow continues as normal. */}
        {canApprove && po.status === 'pending' && (
          <div style={{ background: C.seasalt, borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your approval</div>
            {confirmOverride ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: confirmOverride === 'approved' ? '#1B512D' : '#C0321A', flex: 1, minWidth: 200 }}>
                  {confirmOverride === 'approved'
                    ? 'Approve this PO? It moves to finance and they are notified.'
                    : 'Reject this PO?'}
                </span>
                <button onClick={() => setConfirmOverride(null)} disabled={busy}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => { onManualDecision(confirmOverride); setConfirmOverride(null); }} disabled={busy}
                  style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: confirmOverride === 'approved' ? C.green : '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
                  {busy ? 'Saving…' : confirmOverride === 'approved' ? 'Yes, approve' : 'Yes, reject'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: C.slate, flex: 1, minWidth: 200 }}>
                  You are the approver for purchase orders. Approving moves it to finance.
                </span>
                <button onClick={() => setConfirmOverride('approved')} disabled={busy}
                  style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Approve
                </button>
                <button onClick={() => setConfirmOverride('rejected')} disabled={busy}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Reject
                </button>
              </div>
            )}
          </div>
        )}

        {/* Admin stand-in for finance's email link: completing sends the PO
            lines to Incoming Shipments (purchase_orders_to_shipments trigger). */}
        {canFinance && (po.status === 'approved' || po.status === 'sent_to_finance') && (
          <div style={{ background: C.seasalt, borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Finance step</div>
            {confirmComplete ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1B512D', flex: 1, minWidth: 200 }}>
                  Mark this PO completed (sent to the supplier)? {shipLines} item line{shipLines === 1 ? '' : 's'} go{shipLines === 1 ? 'es' : ''} to Incoming Shipments as Ordered.
                  
                </span>
                <button onClick={() => setConfirmComplete(false)} disabled={busy}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => { onComplete(); setConfirmComplete(false); }} disabled={busy}
                  style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
                  {busy ? 'Saving…' : 'Yes, complete'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: C.slate, flex: 1, minWidth: 200 }}>
                  {po.status === 'approved'
                    ? 'Approved. Once it is sent to the supplier, mark it completed — it goes straight to Incoming Shipments.'
                    : 'Once it is sent to the supplier, mark it completed — it goes straight to Incoming Shipments.'}
                </span>
                <button onClick={() => setConfirmComplete(true)} disabled={busy}
                  style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Mark completed
                </button>
                {confirmCancel ? (
                  <>
                    <button onClick={() => setConfirmCancel(false)} disabled={busy}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Keep</button>
                    <button onClick={() => { onCancel(); setConfirmCancel(false); }} disabled={busy}
                      style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, cancel PO</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmCancel(true)} disabled={busy}
                    style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel PO
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {canDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Trash2 size={13} /> Delete PO
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {po.status === 'pending' && (
              <button onClick={onResend} disabled={busy}
                style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={13} /> {busy ? 'Resending…' : 'Resend to approver'}
              </button>
            )}
            {po.status === 'approved' && (canApprove || canFinance) && (
              <button onClick={onForward} disabled={busy}
                style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Mail size={13} /> {busy ? 'Sending…' : 'Forward to finance'}
              </button>
            )}
            {po.status === 'sent_to_finance' && (
              <button onClick={onResendFinance} disabled={busy} title={financeEmail ? `Resend to ${financeEmail}` : undefined}
                style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={13} /> {busy ? 'Resending…' : 'Resend to finance'}
              </button>
            )}
            {po.status === 'completed' && onOpenShipments && (
              <button onClick={onOpenShipments}
                style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Truck size={13} /> Open Incoming Shipments
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Email Template (admin) ────────────────────────────────────────

function TemplateTab({ settings, accounts, onRefresh }: { settings: POSettings; accounts: PoAccount[]; onRefresh: () => Promise<void> }) {
  const [form, setForm] = useState<POSettings>(settings);
  const emailsOf = (ids: string[]) => accounts.filter((a) => ids.includes(a.id)).map((a) => a.email).join(', ');
  // One account per step, picked from the brand dropdown. Stored as a
  // one-element list (the columns are arrays).
  const accountPicker = (field: 'approver_user_ids' | 'finance_user_ids', placeholder: string) => {
    const chosen = (form[field] ?? [])[0] ?? '';
    const pool = accounts.filter((a) => a.is_active !== false || a.id === chosen);
    return (
      <SearchSelect value={chosen} placeholder={placeholder} emptyText="No accounts match"
        options={[{ value: '', label: 'Not chosen — a department admin acts' }, ...pool.map((a) => ({ value: a.id, label: accountLabel(a), sub: a.email }))]}
        onChange={(v) => { setForm({ ...form, [field]: v ? [v] : [] }); setSaved(false); }} />
    );
  };
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('po_settings').update({
      subject: form.subject, body: form.body,
      approver_user_ids: form.approver_user_ids ?? [], finance_user_ids: form.finance_user_ids ?? [],
      // The chosen accounts' emails receive the "PO waiting for you" notices.
      // With nobody chosen for a step, its old typed address is left as it was.
      ...((form.approver_user_ids ?? []).length ? { approver_email: emailsOf(form.approver_user_ids ?? []) } : {}),
      ...((form.finance_user_ids ?? []).length ? { finance_email: emailsOf(form.finance_user_ids ?? []) } : {}),
      cc_email: form.cc_email || null,
      from_address: form.from_address || null, reply_to: form.reply_to || null,
      updated_at: new Date().toISOString(),
    }).eq('id', 'default');
    setSaving(false);
    if (error) { window.alert(error.message); return; }
    setSaved(true);
    await onRefresh();
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) 1fr', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Approvers & notification email</div>
        <div style={{ fontSize: 12, color: C.slate, background: C.seasalt, border: '1px dashed #EBEBEB', borderRadius: 10, padding: '8px 12px' }}>
          Subject is set automatically: <strong style={{ color: '#1a1a1a' }}>Purchase Order - [Supplier] - [PO Title]</strong>
        </div>
        <div>
          <label style={label}>Message in the approver's notification email</label>
          <textarea value={form.body} onChange={(e) => { setForm({ ...form, body: e.target.value }); setSaved(false); }} rows={5} style={{ ...input, resize: 'vertical', lineHeight: 1.6, fontFamily: 'Figtree' }} />
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>Sent to the approver account when a PO is raised — shown in the preview. Finance's notice (sent after approval) has fixed wording. Placeholders: <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{po_number}}'}</code> <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{title}}'}</code> <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{salesman}}'}</code> <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{supplier}}'}</code> <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{total}}'}</code>. The item table and a link to open EVOne are added automatically.</div>
        </div>
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={label}>Approver account</label>
            {accountPicker('approver_user_ids', 'Select the approver…')}
            <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>Only this account gets the Approve / Reject buttons on a pending PO.</div>
          </div>
          <div>
            <label style={label}>Finance account</label>
            {accountPicker('finance_user_ids', 'Select the finance account…')}
            <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>Only this account can mark an approved PO completed (which sends it to Incoming Shipments) or cancel it. It gets an email when a PO is approved — a notice only; everything is done in the app.</div>
          </div>
          <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5 }}>
            Everyone else with Raise PO can see every PO and its status, but not act on it. The chosen accounts need <strong>Raise PO</strong> ticked under Inventory in Settings to open this screen. While a step has nobody chosen, a department admin can act on it.
          </div>
        </div>
        <div>
          <label style={label}>CC on PO emails (comma-separated)</label>
          <input value={form.cc_email ?? ''} onChange={(e) => { setForm({ ...form, cc_email: e.target.value }); setSaved(false); }} placeholder="e.g. ops@evone.com, director@evone.com" style={input} />
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.5 }}>
            The approver and finance accounts get an email when a PO is waiting for them, with a link to open EVOne — approving and completing happen in the app. CC'd people get an FYI copy of both.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={label}>From address</label><input value={form.from_address ?? ''} onChange={(e) => { setForm({ ...form, from_address: e.target.value }); setSaved(false); }} placeholder="EVOne <po@evone.com.my>" style={input} /></div>
          <div><label style={label}>Reply-to</label><input value={form.reply_to ?? ''} onChange={(e) => { setForm({ ...form, reply_to: e.target.value }); setSaved(false); }} placeholder="Optional" style={input} /></div>
        </div>
        <div style={{ fontSize: 11, color: C.slate }}>The From domain must be verified in Resend, or leave blank to use the server default.</div>
        <button onClick={save} disabled={saving} style={{ alignSelf: 'flex-start', padding: '10px 24px', borderRadius: 10, border: 'none', background: saving ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Template'}</button>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Preview</div>
        <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, padding: 18 }}
          dangerouslySetInnerHTML={{ __html: buildPoEmail(
            { id: '', po_number: 'EV1PO-000250', title: 'Sample PO', supplier: 'Acme Supplies', approver_email: '', finance_email: '', currency: 'SGD', sell_subtotal: 0, sell_currency: 'SGD', lines: [{ product_id: null, name: '22kW AC Charger', remark: 'Model ABC-22\nOCPP 1.6J, Type 2 socket', unit: 'unit', unit_price: 1800, sell_price: 2300, qty: 2, currency: 'SGD', supplier: 'Acme Supplies' }, { product_id: null, name: 'Installation', remark: null, unit: 'lot', unit_price: 600, sell_price: 800, qty: 1, currency: 'SGD', supplier: 'Acme Supplies' }], subtotal: 4200, notes: '', status: 'pending', approval_token: 'preview', decided_at: null, finance_decided_at: null, email_status: null, email_error: null, app_base: null, forwarded_at: null, created_by: 'You', created_by_id: '', created_at: '' },
            form, 'You',
          ) }} />
      </div>
    </div>
  );
}
