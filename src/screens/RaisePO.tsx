import { useEffect, useMemo, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { Search, Plus, Trash2, Send, Pencil, Package, Mail, RefreshCw } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  unit_price: number;
  supplier: string | null;
  description: string | null;
  is_active: boolean;
}

interface POLine { key: string; product_id: string | null; name: string; unit: string; unit_price: number; qty: number; }
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
  status: 'pending' | 'approved' | 'rejected' | 'sent_to_finance';
  approval_token: string;
  decided_at: string | null;
  email_status: string | null;
  email_error: string | null;
  forwarded_at: string | null;
  created_by: string | null;
  created_by_id: string | null;
  created_at: string;
}

interface POSettings {
  id: string;
  subject: string;
  body: string;
  approver_email: string | null;
  finance_email: string | null;
  from_address: string | null;
  reply_to: string | null;
}

const money = (n: number) => '$' + (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/po-decision`;

const STATUS_STYLE: Record<PurchaseOrder['status'], { bg: string; color: string; label: string }> = {
  pending:         { bg: '#FFF8E1', color: '#B07D00', label: 'Pending approval' },
  approved:        { bg: '#E4F3E3', color: '#1B512D', label: 'Approved' },
  rejected:        { bg: '#FDEAEA', color: '#C0321A', label: 'Rejected' },
  sent_to_finance: { bg: '#E3F0FF', color: '#1A62C0', label: 'Sent to finance' },
};

let lineSeq = 0;
const newKey = () => `l-${Date.now()}-${lineSeq++}`;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

// Build the approval email HTML: intro + line table + approve/reject buttons.
function buildPoEmail(po: PurchaseOrder, settings: POSettings, salesman: string): string {
  const fill = (t: string) => t
    .replace(/\{\{\s*po_number\s*\}\}/gi, po.po_number)
    .replace(/\{\{\s*title\s*\}\}/gi, po.title)
    .replace(/\{\{\s*salesman\s*\}\}/gi, salesman)
    .replace(/\{\{\s*supplier\s*\}\}/gi, po.supplier ?? '—')
    .replace(/\{\{\s*total\s*\}\}/gi, money(po.subtotal));
  const intro = esc(fill(settings.body)).replace(/\n/g, '<br>');
  const approveUrl = `${FN_BASE}?token=${po.approval_token}&action=approve`;
  const rejectUrl = `${FN_BASE}?token=${po.approval_token}&action=reject`;
  const rows = po.lines.map((l) => `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;">${esc(l.name)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;text-align:right;">${l.qty} ${esc(l.unit)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;text-align:right;">${money(l.unit_price)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;text-align:right;font-weight:700;">${money(l.qty * l.unit_price)}</td></tr>`).join('');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
    <div style="font-size:18px;font-weight:800;color:${C.green};">Purchase Order ${esc(po.po_number)}</div>
    <div style="font-size:14px;color:#5B6B7A;margin:2px 0 16px;">${esc(po.title)}${po.supplier ? ` · ${esc(po.supplier)}` : ''}</div>
    <div style="font-size:14px;line-height:1.6;margin-bottom:16px;">${intro}</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #EBEBEB;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#F7FAFC;">
        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#5B6B7A;text-transform:uppercase;">Item</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#5B6B7A;text-transform:uppercase;">Qty</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#5B6B7A;text-transform:uppercase;">Unit Price</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#5B6B7A;text-transform:uppercase;">Total</th>
      </tr></thead><tbody>${rows}</tbody></table>
    <div style="text-align:right;font-size:16px;font-weight:800;color:${C.green};margin:12px 0 22px;">Total: ${money(po.subtotal)}</div>
    <div style="text-align:center;">
      <a href="${approveUrl}" style="display:inline-block;background:${C.green};color:#fff;text-decoration:none;font-weight:700;padding:12px 30px;border-radius:10px;margin:0 6px;">Approve</a>
      <a href="${rejectUrl}" style="display:inline-block;background:#C0321A;color:#fff;text-decoration:none;font-weight:700;padding:12px 30px;border-radius:10px;margin:0 6px;">Reject</a>
    </div>
    <div style="text-align:center;color:#5B6B7A;font-size:12px;margin-top:18px;">Raised by ${esc(salesman)} · EVOne Purchase Orders</div>
  </div>`;
}

// ── Root ──────────────────────────────────────────────────────────

type Tab = 'raise' | 'track' | 'products' | 'template';

export function ScreenRaisePO() {
  const { can, user } = usePermissions();
  const canEdit = can('raise_po', 'can_edit');
  const canDelete = can('raise_po', 'can_delete');

  const [products, setProducts] = useState<Product[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [settings, setSettings] = useState<POSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('raise');

  const fetchAll = async () => {
    const [{ data: p }, { data: o }, { data: s }] = await Promise.all([
      supabase.from('po_products').select('*').order('category').order('name'),
      supabase.from('purchase_orders').select('*').eq('created_by_id', user.id).order('created_at', { ascending: false }),
      supabase.from('po_settings').select('*').eq('id', 'default').maybeSingle(),
    ]);
    setProducts((p as Product[]) ?? []);
    setPos((o as unknown as PurchaseOrder[]) ?? []);
    setSettings((s as POSettings) ?? { id: 'default', subject: '', body: '', approver_email: null, finance_email: null, from_address: null, reply_to: null });
    setLoading(false);
  };
  useEffect(() => { void fetchAll(); }, []);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  const pending = pos.filter((p) => p.status === 'pending').length;
  const tabs: [Tab, string][] = [['raise', 'Raise PO'], ['track', `My POs${pos.length ? ` · ${pos.length}` : ''}`]];
  if (canEdit) { tabs.push(['products', 'Product Catalog'], ['template', 'Email Template']); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="My Purchase Orders" value={String(pos.length)} sub="raised by me" accent />
        <KPICard label="Pending Approval" value={String(pending)} sub="awaiting the boss" />
        <KPICard label="Products" value={String(products.filter((p) => p.is_active).length)} sub="in the catalog" />
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

      {tab === 'raise' && <RaiseTab products={products} settings={settings!} onSent={async () => { await fetchAll(); setTab('track'); }} />}
      {tab === 'track' && <TrackTab pos={pos} settings={settings!} onRefresh={fetchAll} />}
      {tab === 'products' && canEdit && <ProductsTab products={products} canDelete={canDelete} onRefresh={fetchAll} />}
      {tab === 'template' && canEdit && <TemplateTab settings={settings!} onRefresh={fetchAll} />}
    </div>
  );
}

// ── Raise PO ──────────────────────────────────────────────────────

function RaiseTab({ products, settings, onSent }: { products: Product[]; settings: POSettings; onSent: () => Promise<void> }) {
  const { user } = usePermissions();
  const [title, setTitle] = useState('');
  const [supplier, setSupplier] = useState('');
  const [approver, setApprover] = useState(settings.approver_email ?? '');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<POLine[]>([]);
  const [catFilter, setCatFilter] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = products.filter((p) => p.is_active);
  const cats = [...new Set(active.map((p) => p.category))].sort((a, b) => a.localeCompare(b));
  const shown = catFilter ? active.filter((p) => p.category === catFilter) : active;
  const grouped = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of shown) { const a = m.get(p.category) ?? []; a.push(p); m.set(p.category, a); }
    for (const [, arr] of m) arr.sort((a, b) => a.unit_price - b.unit_price);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const addProduct = (p: Product) => setLines((prev) => {
    const ex = prev.find((l) => l.product_id === p.id);
    if (ex) return prev.map((l) => (l.key === ex.key ? { ...l, qty: l.qty + 1 } : l));
    // A product's supplier fills the PO supplier if not yet set.
    if (!supplier && p.supplier) setSupplier(p.supplier);
    return [...prev, { key: newKey(), product_id: p.id, name: p.name, unit: p.unit, unit_price: p.unit_price, qty: 1 }];
  });
  const updateLine = (key: string, patch: Partial<POLine>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const canSend = lines.length > 0 && !!approver.trim() && /@/.test(approver) && !sending;

  const send = async () => {
    setSending(true);
    setError(null);
    const { data: created, error: insErr } = await supabase.from('purchase_orders').insert({
      title: title.trim() || 'Untitled PO',
      supplier: supplier.trim() || null,
      approver_email: approver.trim(),
      finance_email: settings.finance_email,
      lines: lines.map(({ key, ...rest }) => rest),
      subtotal,
      notes: notes.trim() || null,
      status: 'pending',
      email_status: 'queued',
      created_by: user.full_name || user.email,
      created_by_id: user.id,
    }).select('*').single();
    if (insErr || !created) { setSending(false); setError(insErr?.message ?? 'Could not create the PO.'); return; }

    const po = created as unknown as PurchaseOrder;
    const html = buildPoEmail(po, settings, user.full_name || user.email);
    const subject = (settings.subject || 'Purchase Order {{po_number}} — approval needed')
      .replace(/\{\{\s*po_number\s*\}\}/gi, po.po_number).replace(/\{\{\s*title\s*\}\}/gi, po.title);
    let emailErr: string | null = null;
    try {
      const { data: r, error: fnErr } = await supabase.functions.invoke('send-customer-email', {
        body: { to: [approver.trim()], subject, html, from: settings.from_address || undefined, replyTo: settings.reply_to || undefined },
      });
      emailErr = (r as { error?: string } | null)?.error ?? fnErr?.message ?? null;
    } catch (e) { emailErr = (e as Error).message || 'send failed'; }
    await supabase.from('purchase_orders').update({ email_status: emailErr ? 'failed' : 'sent', email_error: emailErr }).eq('id', po.id);

    setSending(false);
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
          <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Add products</div>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">All categories</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {active.length === 0 ? (
            <div style={{ padding: '30px 14px', textAlign: 'center', color: C.slate, fontSize: 12 }}>No products yet. An admin adds them in <strong>Product Catalog</strong>.</div>
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
                      <span style={{ display: 'block', fontSize: 11, color: C.slate }}>{money(p.unit_price)} / {p.unit}{p.supplier ? ` · ${p.supplier}` : ''}</span>
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
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '18px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>PO Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chargers for Blk 123 project" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Supplier</label>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Approver (boss) email</label>
            <input type="email" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="boss@evone.com" style={inputStyle} />
          </div>
        </div>

        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Item', 'Unit Price', 'Qty', 'Unit', 'Line Total', ''].map((h) => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: h === 'Item' ? 'left' : 'right', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} style={{ borderBottom: '1px solid #F3F3F3' }}>
                  <td style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{l.name}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                    <input type="text" inputMode="decimal" value={l.unit_price} onChange={(e) => updateLine(l.key, { unit_price: parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
                      style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, textAlign: 'right', outline: 'none', background: C.white }} />
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                    <input type="text" inputMode="decimal" value={l.qty} onChange={(e) => updateLine(l.key, { qty: Math.max(0, parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0) })}
                      style={{ width: 64, padding: '6px 8px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, textAlign: 'right', outline: 'none', background: C.white }} />
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 13, color: C.slate }}>{l.unit}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>{money(l.qty * l.unit_price)}</td>
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
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>PO Total</span>
              <span style={{ fontSize: 24, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>{money(subtotal)}</span>
            </div>
            <div>
              <label style={labelStyle}>Notes to approver</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'Figtree' }} />
            </div>
            <button onClick={send} disabled={!canSend}
              style={{ marginTop: 4, padding: '11px', borderRadius: 10, border: 'none', background: canSend ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 14, fontWeight: 700, cursor: canSend ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Send size={14} strokeWidth={2.25} /> {sending ? 'Sending…' : 'Send for approval'}
            </button>
            {!/@/.test(approver) && lines.length > 0 && <div style={{ fontSize: 11, color: C.slate, textAlign: 'center' }}>Enter the approver's email to send.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Track (My POs) ────────────────────────────────────────────────

function TrackTab({ pos, settings, onRefresh }: { pos: PurchaseOrder[]; settings: POSettings; onRefresh: () => Promise<void> }) {
  const { user } = usePermissions();
  const [open, setOpen] = useState<PurchaseOrder | null>(null);
  const [busy, setBusy] = useState(false);

  const resend = async (po: PurchaseOrder) => {
    if (!po.approver_email) return;
    setBusy(true);
    const html = buildPoEmail(po, settings, po.created_by || user.full_name);
    const subject = (settings.subject || 'Purchase Order {{po_number}} — approval needed')
      .replace(/\{\{\s*po_number\s*\}\}/gi, po.po_number).replace(/\{\{\s*title\s*\}\}/gi, po.title);
    let emailErr: string | null = null;
    try {
      const { data: r, error } = await supabase.functions.invoke('send-customer-email', {
        body: { to: [po.approver_email], subject, html, from: settings.from_address || undefined, replyTo: settings.reply_to || undefined },
      });
      emailErr = (r as { error?: string } | null)?.error ?? error?.message ?? null;
    } catch (e) { emailErr = (e as Error).message; }
    await supabase.from('purchase_orders').update({ email_status: emailErr ? 'failed' : 'sent', email_error: emailErr }).eq('id', po.id);
    setBusy(false);
    await onRefresh();
    if (emailErr) window.alert(`Resend failed: ${emailErr}`);
  };

  const forwardToFinance = async (po: PurchaseOrder) => {
    const finance = po.finance_email || settings.finance_email;
    if (!finance) { window.alert('No finance email is set. Add one in the Email Template tab.'); return; }
    setBusy(true);
    const html = buildPoEmail(po, settings, po.created_by || user.full_name)
      + `<div style="max-width:600px;margin:16px auto 0;font-family:sans-serif;font-size:13px;color:#1B512D;background:#E4F3E3;border-radius:10px;padding:12px 16px;">Approved by the boss — please proceed to send this PO to the supplier.</div>`;
    let emailErr: string | null = null;
    try {
      const { data: r, error } = await supabase.functions.invoke('send-customer-email', {
        body: { to: [finance], subject: `Approved PO ${po.po_number} — please send to supplier`, html, from: settings.from_address || undefined, replyTo: settings.reply_to || undefined },
      });
      emailErr = (r as { error?: string } | null)?.error ?? error?.message ?? null;
    } catch (e) { emailErr = (e as Error).message; }
    if (emailErr) { setBusy(false); window.alert(`Could not email finance: ${emailErr}`); return; }
    await supabase.from('purchase_orders').update({ status: 'sent_to_finance', forwarded_at: new Date().toISOString() }).eq('id', po.id);
    setBusy(false);
    setOpen(null);
    await onRefresh();
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
                  onClick={() => setOpen(po)}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{po.po_number}</div>
                    <div style={{ fontSize: 12, color: C.slate }}>{po.title}</div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#1a1a1a' }}>{po.supplier || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green, textAlign: 'right' }}>{money(po.subtotal)}</td>
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
        <PODetailModal po={open} busy={busy} onResend={() => resend(open)} onForward={() => forwardToFinance(open)} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function ClipboardEmpty() {
  return <div style={{ marginBottom: 10 }}><Package size={30} strokeWidth={1.5} style={{ color: C.slate }} /></div>;
}

function PODetailModal({ po, busy, onResend, onForward, onClose }: { po: PurchaseOrder; busy: boolean; onResend: () => void; onForward: () => void; onClose: () => void }) {
  const st = STATUS_STYLE[po.status];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 560, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{po.po_number} · {po.title}</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{po.supplier || 'No supplier'} · to {po.approver_email}</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 99, background: st.bg, color: st.color }}>{st.label}</span>
          {po.decided_at && <span style={{ fontSize: 12, color: C.slate }}>on {new Date(po.decided_at).toLocaleString('en-GB')}</span>}
        </div>

        <div style={{ background: C.seasalt, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {po.lines.map((l, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #EBEBEB' }}>
                  <td style={{ padding: '8px 12px', fontSize: 13, color: '#1a1a1a' }}>{l.name}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: C.slate, textAlign: 'right', whiteSpace: 'nowrap' }}>{l.qty} {l.unit} × {money(l.unit_price)}</td>
                  <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 700, color: C.green, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(l.qty * l.unit_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Total</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: C.green }}>{money(po.subtotal)}</span>
        </div>
        {po.notes && <div style={{ fontSize: 13, color: C.slate }}><strong style={{ color: '#1a1a1a' }}>Notes:</strong> {po.notes}</div>}
        {po.email_status === 'failed' && po.email_error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12 }}>Email failed: {po.email_error}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {po.status === 'pending' && (
            <button onClick={onResend} disabled={busy}
              style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={13} /> Resend to approver
            </button>
          )}
          {po.status === 'approved' && (
            <button onClick={onForward} disabled={busy}
              style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Mail size={13} /> {busy ? 'Sending…' : 'Forward to finance'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Product Catalog (admin) ───────────────────────────────────────

function ProductsTab({ products, canDelete, onRefresh }: { products: Product[]; canDelete: boolean; onRefresh: () => Promise<void> }) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const visible = products
    .filter((p) => { const q = search.toLowerCase(); return !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.supplier ?? '').toLowerCase().includes(q); })
    .sort((a, b) => a.category.localeCompare(b.category) || a.unit_price - b.unit_price);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        <button onClick={() => setAdding(true)} style={{ marginLeft: 'auto', padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Add Product</button>
      </div>
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Product', 'Category', 'Supplier', 'Unit', 'Unit Price', 'Status', ''].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: h === 'Unit Price' ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer', opacity: p.is_active ? 1 : 0.55 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={() => setEditing(p)}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{p.name}</div>
                  {p.description && <div style={{ fontSize: 11, color: C.slate }}>{p.description}</div>}
                </td>
                <td style={{ padding: '12px 16px' }}><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: C.seasalt, border: '1px solid #EBEBEB', color: C.slate }}>{p.category}</span></td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#1a1a1a' }}>{p.supplier || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: C.slate }}>{p.unit}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green, textAlign: 'right' }}>{money(p.unit_price)}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: p.is_active ? '#E4F3E3' : '#F3F3F3', color: p.is_active ? '#1B512D' : '#767B77' }}>{p.is_active ? 'Active' : 'Hidden'}</span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <button onClick={(e) => { e.stopPropagation(); setEditing(p); }} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Pencil size={12} /> Edit</button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>{products.length === 0 ? 'No products yet. Click “+ Add Product”.' : 'No products match your search.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {adding && <ProductModal title="Add Product" canDelete={false} initial={{ name: '', category: 'Chargers', supplier: '', unit: 'unit', unit_price: 0, description: '', is_active: true }}
        onSave={async (d) => { await supabase.from('po_products').insert(d); await onRefresh(); }} onClose={() => setAdding(false)} />}
      {editing && <ProductModal key={editing.id} title="Edit Product" canDelete={canDelete}
        initial={{ name: editing.name, category: editing.category, supplier: editing.supplier ?? '', unit: editing.unit, unit_price: editing.unit_price, description: editing.description ?? '', is_active: editing.is_active }}
        onSave={async (d) => { await supabase.from('po_products').update({ ...d, updated_at: new Date().toISOString() }).eq('id', editing.id); await onRefresh(); }}
        onDelete={async () => { await supabase.from('po_products').delete().eq('id', editing.id); await onRefresh(); }}
        onClose={() => setEditing(null)} />}
    </div>
  );
}

interface ProductForm { name: string; category: string; supplier: string; unit: string; unit_price: number; description: string; is_active: boolean; }

function ProductModal({ initial, title, canDelete, onSave, onDelete, onClose }: { initial: ProductForm; title: string; canDelete: boolean; onSave: (d: ProductForm) => Promise<void>; onDelete?: () => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState<ProductForm>(initial);
  const [priceStr, setPriceStr] = useState(initial.unit_price ? String(initial.unit_price) : '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canSave = !!form.name.trim() && !saving;
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };
  const UNITS = ['unit', 'each', 'set', 'meter', 'roll', 'box', 'lot'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 480, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>
        <div><label style={label}>Product Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 22kW AC Charger" style={input} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={label}>Category</label><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Chargers" style={input} /></div>
          <div><label style={label}>Supplier</label><input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Optional" style={input} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={label}>Unit</label>
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} style={{ ...input, cursor: 'pointer' }}>
              {[...new Set([form.unit, ...UNITS])].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div><label style={label}>Unit Price ($)</label>
            <input type="text" inputMode="decimal" value={priceStr} onChange={(e) => { const c = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); setPriceStr(c); setForm({ ...form, unit_price: parseFloat(c) || 0 }); }} placeholder="0.00" style={input} />
          </div>
        </div>
        <div><label style={label}>Remark (optional)</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. model / spec" style={input} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#1a1a1a', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} style={{ width: 16, height: 16, accentColor: C.green, cursor: 'pointer' }} /> Available when raising a PO
        </label>
        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this product?</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={async () => { await onDelete!(); onClose(); }} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, Delete</button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {onDelete && canDelete && !confirmDelete && <button onClick={() => setConfirmDelete(true)} style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button disabled={!canSave} onClick={async () => { setSaving(true); await onSave(form); setSaving(false); onClose(); }} style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Email Template (admin) ────────────────────────────────────────

function TemplateTab({ settings, onRefresh }: { settings: POSettings; onRefresh: () => Promise<void> }) {
  const [form, setForm] = useState<POSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
  const input: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('po_settings').update({
      subject: form.subject, body: form.body, approver_email: form.approver_email || null,
      finance_email: form.finance_email || null, from_address: form.from_address || null, reply_to: form.reply_to || null,
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
        <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Approval email</div>
        <div><label style={label}>Subject</label><input value={form.subject} onChange={(e) => { setForm({ ...form, subject: e.target.value }); setSaved(false); }} style={input} /></div>
        <div>
          <label style={label}>Message to approver</label>
          <textarea value={form.body} onChange={(e) => { setForm({ ...form, body: e.target.value }); setSaved(false); }} rows={5} style={{ ...input, resize: 'vertical', lineHeight: 1.6, fontFamily: 'Figtree' }} />
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>Placeholders: <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{po_number}}'}</code> <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{title}}'}</code> <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{salesman}}'}</code> <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{supplier}}'}</code> <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{total}}'}</code>. The item table and Approve/Reject buttons are added automatically.</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={label}>Default approver (boss)</label><input type="email" value={form.approver_email ?? ''} onChange={(e) => { setForm({ ...form, approver_email: e.target.value }); setSaved(false); }} placeholder="boss@evone.com" style={input} /></div>
          <div><label style={label}>Finance email</label><input type="email" value={form.finance_email ?? ''} onChange={(e) => { setForm({ ...form, finance_email: e.target.value }); setSaved(false); }} placeholder="finance@evone.com" style={input} /></div>
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
            { id: '', po_number: 'PO-2026-0001', title: form.subject ? 'Sample PO' : 'Sample PO', supplier: 'Acme Supplies', approver_email: '', finance_email: '', lines: [{ product_id: null, name: '22kW AC Charger', unit: 'unit', unit_price: 1800, qty: 2 }, { product_id: null, name: 'Installation', unit: 'lot', unit_price: 600, qty: 1 }], subtotal: 4200, notes: '', status: 'pending', approval_token: 'preview', decided_at: null, email_status: null, email_error: null, forwarded_at: null, created_by: 'You', created_by_id: '', created_at: '' },
            form, 'You',
          ) }} />
      </div>
    </div>
  );
}
