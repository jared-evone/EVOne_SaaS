import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import { SearchSelect } from '../../components/SearchSelect';
import { supabase } from '../../lib/supabase';
import type { SignedInUser } from '../../permissions';
import { Lock, Power, CheckCircle2, FolderClosed } from 'lucide-react';
import {
  useInvCore, insertRequest, usableTotal, fmtD, todayISO, REQ_DEPARTMENTS, REQ_META, REQUEST_LINKS,
  Pill, Field, ErrorBanner, ItemSelect, inputStyle, primaryBtn, ghostBtn,
  type InvRequest,
} from './invShared';

interface StockRequestPageProps {
  user: SignedInUser;
  preset: string;
  onSignOut: () => void;
}

interface CustomerOpt { id: string; name: string; address: string | null; }

interface Submitted { pr_no: string; what: string; company: string; }

// Reached from a request link / QR (?stockRequest=<slug>) once signed in: a
// phone-friendly request form whose submissions land in Requests & Delivery.
export function StockRequestPage({ user, preset, onSignOut }: StockRequestPageProps) {
  const link = REQUEST_LINKS.find((l) => l.slug === preset.toLowerCase()) ?? REQUEST_LINKS[0];
  const me = user.full_name || user.email;
  const { items, locations, onHand, loading, error: coreErr } = useInvCore();

  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  useEffect(() => {
    void supabase.from('customers').select('id, name, address').order('name')
      .then(({ data }) => setCustomers((data as CustomerOpt[]) ?? []));
  }, []);

  const [mine, setMine] = useState<InvRequest[]>([]);
  const loadMine = async () => {
    const { data } = await supabase.from('inv_requests').select('*').eq('employee', me).order('created_at', { ascending: false }).limit(8);
    setMine((data as InvRequest[]) ?? []);
  };
  useEffect(() => { void loadMine(); }, [me]);

  const blank = (department: string) => ({ department, customer_id: '', delivery_address: '', item_id: '', item_name: '', qty: '1', required_by: '', remarks: '' });
  const [f, setF] = useState(() => blank(link.department));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Submitted | null>(null);

  const customer = customers.find((c) => c.id === f.customer_id);
  const item = items.find((i) => i.id === f.item_id);

  const pickCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    if (c) setF((x) => ({ ...x, customer_id: c.id, delivery_address: c.address ?? '' }));
  };

  const submit = async () => {
    const qty = Number(f.qty);
    if (!f.department) { setErr('Pick your department.'); return; }
    if (!customer) { setErr('Pick the company from the customer list.'); return; }
    if (!item && !f.item_name.trim()) { setErr('Pick an item, or describe what you need.'); return; }
    if (!Number.isInteger(qty) || qty <= 0) { setErr('Quantity must be a whole number above zero.'); return; }
    setBusy(true);
    setErr(null);
    const itemName = (item ? item.name : f.item_name).trim();
    const res = await insertRequest({
      submitted_on: todayISO(), employee: me, department: f.department,
      customer_id: customer.id, company_project: customer.name,
      delivery_address: f.delivery_address.trim() || null,
      item_id: item?.id ?? null, item_name: itemName,
      qty, required_by: f.required_by || null, remarks: f.remarks.trim() || null,
      created_by: me,
    });
    setBusy(false);
    if (res.error || !res.pr_no) { setErr(res.error ?? 'Could not submit the request.'); return; }
    setDone({ pr_no: res.pr_no, what: `${qty} × ${itemName}`, company: customer.name });
    setF(blank(f.department));
    void loadMine();
  };

  const card: React.CSSProperties = { background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14 };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: C.seasalt }}>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 16px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Logo height={28} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me}</span>
            <button onClick={onSignOut} style={{ ...ghostBtn, padding: '7px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Power size={12} /> Sign out
            </button>
          </div>
        </div>

        {done ? (
          <div style={{ ...card, alignItems: 'center', textAlign: 'center', padding: 28 }}>
            <CheckCircle2 size={40} strokeWidth={1.75} color={C.green} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.slate }}>Request submitted</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: C.green, letterSpacing: '-0.04em', lineHeight: 1, marginTop: 8 }}>{done.pr_no}</div>
            </div>
            <div style={{ fontSize: 13, color: '#1a1a1a' }}>{done.what}<div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>for {done.company}</div></div>
            <div style={{ fontSize: 12, color: C.slate }}>The inventory team has it now. Its status shows below as it moves along.</div>
            <button onClick={() => setDone(null)} style={{ ...primaryBtn(), padding: '10px 24px' }}>Raise another request</button>
          </div>
        ) : (
          <div style={card}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>Request stock</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>Fill in what you need. It goes straight to the inventory team.</div>
            </div>
            <ErrorBanner text={coreErr} />
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <Field label="Requested by">
                    <div title="Your signed-in account" style={{ ...inputStyle, background: C.seasalt, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Lock size={12} color={C.slate} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me}</span>
                    </div>
                  </Field>
                  <Field label="Department">
                    <SearchSelect value={f.department} placeholder="Select department"
                      options={REQ_DEPARTMENTS.map((d) => ({ value: d, label: d }))}
                      onChange={(v) => setF({ ...f, department: v })} />
                  </Field>
                </div>
                <Field label="Company">
                  <SearchSelect value={f.customer_id}
                    options={customers.map((c) => ({ value: c.id, label: c.name, sub: c.address ?? undefined }))}
                    onChange={pickCustomer} placeholder="Select customer…" emptyText="No customers match" />
                </Field>
                <Field label="Deliver to" hint={customer ? (f.delivery_address === (customer.address ?? '') ? "Customer's address — change it for a site or self collect" : 'Changed from the customer address') : undefined}>
                  <input value={f.delivery_address} onChange={(e) => setF({ ...f, delivery_address: e.target.value })} placeholder="Filled from the customer's address" style={inputStyle} />
                </Field>
                <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Field label="Item" hint={item ? `${usableTotal(onHand, item.id, locations)} in stock` : 'Not listed? Choose "Not in the item list" and describe it'}>
                    <ItemSelect items={items} value={f.item_id} onChange={(v) => setF({ ...f, item_id: v })} allowNone noneLabel="Not in the item list" />
                  </Field>
                  {!f.item_id && (
                    <Field label="Describe the item">
                      <input value={f.item_name} onChange={(e) => setF({ ...f, item_name: e.target.value })} placeholder="e.g. Hici - Control Module - ZM029" style={inputStyle} />
                    </Field>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="Qty"><input type="number" min="1" step="1" inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} style={inputStyle} /></Field>
                    <Field label="Required by"><input type="date" value={f.required_by} onChange={(e) => setF({ ...f, required_by: e.target.value })} style={inputStyle} /></Field>
                  </div>
                </div>
                <Field label="Remarks"><input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} placeholder="Optional" style={inputStyle} /></Field>
                <ErrorBanner text={err} />
                <button onClick={() => void submit()} disabled={busy} style={{ ...primaryBtn(busy), padding: '12px 24px', fontSize: 14 }}>
                  {busy ? 'Submitting…' : 'Submit request'}
                </button>
              </>
            )}
          </div>
        )}

        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Your recent requests</div>
          {mine.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 0', color: C.slate, fontSize: 12 }}>
              <FolderClosed size={32} strokeWidth={1.5} color={C.slate} />
              Nothing yet — your requests will show here.
            </div>
          ) : mine.map((r) => {
            const meta = REQ_META[r.status];
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 12, borderTop: '1px solid #F3F3F3' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{r.pr_no} <span style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>· {fmtD(r.submitted_on)}</span></div>
                  <div style={{ fontSize: 12, color: '#1a1a1a', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.qty} × {r.item_name}</div>
                  {r.company_project && <div style={{ fontSize: 11, color: C.slate, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company_project}</div>}
                </div>
                <Pill bg={meta.bg} color={meta.color}>{r.status === 'legacy' ? 'Migrated' : meta.label}</Pill>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
