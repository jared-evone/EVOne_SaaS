import { useEffect, useState } from 'react';
import { C } from '../theme';
import { Upload as UploadIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  analyzeRegistryInvoicePdf, matchCustomer, normKey,
  type RawInvoice, type CustomerLite,
} from './registryInvoice';

const PROJECT_FILES_BUCKET = 'project-files';
const NEW = '__new__';
const EXTRACT_CONCURRENCY = 3;

interface ProjectLite { id: string; name: string; customer_id: string | null }

interface InvRow {
  id: string;
  file: File;
  fileName: string;
  // extracted (editable)
  invoiceNumber: string;
  invoiceDate: string;          // YYYY-MM-DD or ''
  amount: string;               // form string
  billToName: string;
  billingAddress: string;
  contactName: string;
  // resolution
  customerSel: string;          // '' | customerId | NEW
  registrySel: string;          // '' | projectId | NEW
  confidence: 'high' | 'medium' | 'low';
  errored: boolean;
}

const CONF: Record<InvRow['confidence'], { bg: string; color: string; label: string }> = {
  high:   { bg: '#E4F3E3', color: '#1B512D', label: 'High match' },
  medium: { bg: '#FFF8E1', color: '#B07D00', label: 'Check match' },
  low:    { bg: '#FDEAEA', color: '#C0321A', label: 'No match' },
};

function blobToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function InvoiceIngestModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [contactsByCustomer, setContactsByCustomer] = useState<Map<string, string[]>>(new Map());
  const [projectsByCustomer, setProjectsByCustomer] = useState<Map<string, ProjectLite[]>>(new Map());
  const [rows, setRows] = useState<InvRow[]>([]);
  const [parsing, setParsing] = useState<{ done: number; total: number } | null>(null);
  const [committing, setCommitting] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ attached: number; registries: number; customers: number; skipped: number; errors: string[] } | null>(null);

  const loadRefs = async () => {
    const [{ data: cs }, { data: cc }, { data: ps }] = await Promise.all([
      supabase.from('customers').select('id, name, address').order('name'),
      supabase.from('customer_contacts').select('customer_id, name'),
      supabase.from('projects').select('id, name, customer_id'),
    ]);
    setCustomers((cs ?? []) as CustomerLite[]);
    const cmap = new Map<string, string[]>();
    for (const r of (cc ?? []) as Array<{ customer_id: string; name: string | null }>) {
      if (!r.name) continue;
      const arr = cmap.get(r.customer_id) ?? []; arr.push(r.name); cmap.set(r.customer_id, arr);
    }
    setContactsByCustomer(cmap);
    const pmap = new Map<string, ProjectLite[]>();
    for (const p of (ps ?? []) as ProjectLite[]) {
      if (!p.customer_id) continue;
      const arr = pmap.get(p.customer_id) ?? []; arr.push(p); pmap.set(p.customer_id, arr);
    }
    setProjectsByCustomer(pmap);
  };
  useEffect(() => { void loadRefs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const defaultRegistry = (customerSel: string): string => {
    if (customerSel === NEW) return NEW;
    if (!customerSel) return '';
    const projs = projectsByCustomer.get(customerSel) ?? [];
    return projs.length === 1 ? projs[0].id : projs.length === 0 ? NEW : ''; // >1 → force pick
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setError(null); setResult(null);
    setParsing({ done: 0, total: files.length });
    const names = customers.map((c) => c.name);
    const out: InvRow[] = new Array(files.length);
    let done = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const i = cursor++;
        const file = files[i];
        let ex: RawInvoice | null = null;
        let errored = false;
        try {
          const b64 = await blobToBase64(file);
          ex = await analyzeRegistryInvoicePdf(b64, names);
        } catch (err) {
          errored = true;
          setError(`Some files could not be analysed: ${(err as Error).message ?? 'unknown error'}`);
        }
        const inv: RawInvoice = ex ?? { companyName: '', billingAddress: '', contactName: '', invoiceNumber: '', invoiceDate: '', totalAmount: null };
        const m = matchCustomer(inv, customers, contactsByCustomer);
        const customerSel = m.customerId ?? '';
        out[i] = {
          id: `${i}-${file.name}`,
          file, fileName: file.name,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          amount: inv.totalAmount != null ? inv.totalAmount.toFixed(2) : '',
          billToName: inv.companyName,
          billingAddress: inv.billingAddress,
          contactName: inv.contactName,
          customerSel,
          registrySel: defaultRegistry(customerSel),
          confidence: m.confidence,
          errored,
        };
        done++;
        setParsing({ done, total: files.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(EXTRACT_CONCURRENCY, files.length) }, worker));
    setRows((prev) => [...prev, ...out]);
    setParsing(null);
  };

  const patch = (id: string, p: Partial<InvRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));

  const onCustomer = (id: string, value: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, customerSel: value, registrySel: defaultRegistry(value) } : r)));

  const isReady = (r: InvRow): boolean => {
    if (!r.invoiceNumber.trim()) return false;
    if (r.customerSel === NEW) return r.billToName.trim().length > 0; // registry forced NEW
    if (!r.customerSel) return false;
    return r.registrySel === NEW || !!r.registrySel;
  };
  const ready = rows.filter(isReady);
  const needAttention = rows.length - ready.length;

  // Rows that will CREATE a new registry are coalesced per customer at commit time, so
  // many invoices for the same not-yet-registered company land in ONE registry. Compute
  // the grouping here so the UI can show it (and the "will create" counts in the summary).
  const rowGroupKey = (r: InvRow): string | null => {
    if (r.customerSel === NEW) return `new:${normKey(r.billToName)}`;     // new customer → one new registry
    if (r.customerSel && r.registrySel === NEW) return r.customerSel;     // existing customer, new registry
    return null;
  };
  const groupCount = new Map<string, number>();
  for (const r of rows) { const k = rowGroupKey(r); if (k) groupCount.set(k, (groupCount.get(k) ?? 0) + 1); }
  const newRegistryKeys = new Set<string>();
  const newCustomerKeys = new Set<string>();
  for (const r of ready) {
    const k = rowGroupKey(r); if (k) newRegistryKeys.add(k);
    if (r.customerSel === NEW) newCustomerKeys.add(`new:${normKey(r.billToName)}`);
  }

  const commit = async () => {
    if (!ready.length) return;
    setError(null); setResult(null);
    setCommitting({ done: 0, total: ready.length });
    let attached = 0, registriesCreated = 0, customersCreated = 0, skipped = 0;
    const errors: string[] = [];
    const newCustomerByKey = new Map<string, string>();   // normKey(name) → customerId created this run
    const newRegistryByCustomer = new Map<string, string>(); // customerId → projectId created this run
    const committedKeys = new Set<string>();              // `${projectId}|${invoiceNumber}` this run

    for (let i = 0; i < ready.length; i++) {
      const r = ready[i];
      setCommitting({ done: i, total: ready.length });
      try {
        // 1. Resolve customer.
        let customerId: string;
        if (r.customerSel === NEW) {
          const key = normKey(r.billToName);
          const cached = newCustomerByKey.get(key);
          if (cached) customerId = cached;
          else {
            const { data: cust, error: cErr } = await supabase.from('customers')
              .insert({ name: r.billToName.trim(), type: 'commercial', address: r.billingAddress.trim() || null, notes: null })
              .select('id').single();
            if (cErr || !cust) { errors.push(`${r.fileName}: customer — ${cErr?.message ?? 'failed'}`); continue; }
            customerId = cust.id; customersCreated++;
            newCustomerByKey.set(key, customerId);
            if (r.contactName.trim()) {
              await supabase.from('customer_contacts').insert({ customer_id: customerId, name: r.contactName.trim(), position: 0 });
            }
          }
        } else {
          customerId = r.customerSel;
        }

        // 2. Resolve registry (project). A brand-new customer always gets a new registry.
        const registryChoice = r.customerSel === NEW ? NEW : r.registrySel;
        let projectId: string;
        if (registryChoice === NEW) {
          const cached = newRegistryByCustomer.get(customerId);
          if (cached) projectId = cached;
          else {
            const cName = customers.find((c) => c.id === customerId)?.name ?? r.billToName.trim() ?? 'Registry';
            const { data: proj, error: pErr } = await supabase.from('projects')
              .insert({ customer_id: customerId, name: cName, status: 'active', notes: 'Created from invoice import' })
              .select('id').single();
            if (pErr || !proj) { errors.push(`${r.fileName}: registry — ${pErr?.message ?? 'failed'}`); continue; }
            projectId = proj.id; registriesCreated++;
            newRegistryByCustomer.set(customerId, projectId);
          }
        } else {
          projectId = registryChoice;
        }

        // 3. Dedupe by (project, invoice number) — within this run and against the DB.
        const invNo = r.invoiceNumber.trim();
        const dupeKey = `${projectId}|${invNo.toLowerCase()}`;
        if (committedKeys.has(dupeKey)) { skipped++; continue; }
        const { data: existing } = await supabase.from('project_files')
          .select('id').eq('project_id', projectId).eq('section', 'invoices').eq('invoice_number', invNo).limit(1);
        if (existing && existing.length) { skipped++; committedKeys.add(dupeKey); continue; }

        // 4. Upload the PDF, then 5. insert the document row (rollback storage on failure).
        const path = `${projectId}/invoices/${crypto.randomUUID()}.pdf`;
        const { error: upErr } = await supabase.storage.from(PROJECT_FILES_BUCKET)
          .upload(path, r.file, { contentType: r.file.type || 'application/pdf' });
        if (upErr) { errors.push(`${r.fileName}: upload — ${upErr.message}`); continue; }
        const { error: rowErr } = await supabase.from('project_files').insert({
          project_id: projectId, section: 'invoices', filename: r.fileName, storage_path: path,
          mime_type: r.file.type || 'application/pdf', size_bytes: r.file.size,
          invoice_number: invNo, invoice_date: r.invoiceDate || null,
          total_amount: r.amount.trim() ? parseFloat(r.amount) : null,
          bill_to_name: r.billToName.trim() || null, billing_address: r.billingAddress.trim() || null,
        });
        if (rowErr) {
          await supabase.storage.from(PROJECT_FILES_BUCKET).remove([path]);
          errors.push(`${r.fileName}: ${rowErr.message}`); continue;
        }
        committedKeys.add(dupeKey);
        attached++;
      } catch (e) {
        errors.push(`${r.fileName}: ${(e as Error).message ?? 'error'}`);
      }
    }

    setCommitting(null);
    setResult({ attached, registries: registriesCreated, customers: customersCreated, skipped, errors });
    const doneIds = new Set(ready.map((r) => r.id));
    setRows((rs) => rs.filter((r) => !doneIds.has(r.id)));
    await loadRefs();   // pick up customers/registries created this run
    await onDone();
  };

  const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: C.white };
  const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.slate, letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid #F3F3F3', verticalAlign: 'top' };

  const busy = !!parsing || !!committing;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 1120, maxWidth: '96vw', height: rows.length ? '92vh' : undefined, maxHeight: '92vh', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Bulk Upload Invoices</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2, maxWidth: 760, lineHeight: 1.5 }}>
              Drop a batch of NetSuite invoice PDFs — Claude reads each, matches it to a customer & registry, and attaches the PDF to that registry's invoice documents. No match → create a customer + registry, prefilled for your approval. Review every row before importing.
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px', borderRadius: 12, border: `1.5px dashed ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', flexShrink: 0, opacity: busy ? 0.6 : 1 }}>
          <UploadIcon size={16} strokeWidth={2.25} />
          {rows.length ? 'Add more invoice PDFs' : 'Select invoice PDFs (you can pick many)'}
          <input type="file" accept="application/pdf,.pdf" multiple disabled={busy} style={{ display: 'none' }} onChange={handleFiles} />
        </label>

        {parsing && <div style={{ background: C.seasalt, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.slate, fontWeight: 600, flexShrink: 0 }}>Reading PDFs with Claude… {parsing.done} / {parsing.total}</div>}
        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{error}</div>}
        {result && (
          <div style={{ background: C.honeydew, color: '#1B512D', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
            ✓ {result.attached} invoice{result.attached !== 1 ? 's' : ''} attached · {result.registries} registr{result.registries !== 1 ? 'ies' : 'y'} created · {result.customers} customer{result.customers !== 1 ? 's' : ''} created · {result.skipped} skipped (duplicate)
            {result.errors.length > 0 && <div style={{ color: '#C0321A', marginTop: 6, fontWeight: 500 }}>{result.errors.length} issue{result.errors.length !== 1 ? 's' : ''}: {result.errors.slice(0, 4).join(' · ')}{result.errors.length > 4 ? ' …' : ''}</div>}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: C.slate, display: 'flex', gap: 14, flexWrap: 'wrap', flexShrink: 0 }}>
              <span><strong style={{ color: '#1a1a1a' }}>{rows.length}</strong> file{rows.length !== 1 ? 's' : ''}</span>
              <span><strong style={{ color: C.green }}>{ready.length}</strong> ready</span>
              {(newCustomerKeys.size > 0 || newRegistryKeys.size > 0) && (
                <span style={{ color: C.slate }}>will create <strong style={{ color: '#1a1a1a' }}>{newCustomerKeys.size}</strong> customer{newCustomerKeys.size !== 1 ? 's' : ''} · <strong style={{ color: '#1a1a1a' }}>{newRegistryKeys.size}</strong> registr{newRegistryKeys.size !== 1 ? 'ies' : 'y'}</span>
              )}
              {needAttention > 0 && <span style={{ color: '#B07D00', fontWeight: 700 }}>{needAttention} need a customer, registry or invoice no.</span>}
            </div>

            <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'auto', flex: 1, minHeight: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1040 }}>
                <thead>
                  <tr style={{ background: C.seasalt, position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={th}>File / Bill-to</th>
                    <th style={th}>Match</th>
                    <th style={{ ...th, minWidth: 200 }}>Customer</th>
                    <th style={{ ...th, minWidth: 180 }}>Registry</th>
                    <th style={th}>Invoice No.</th>
                    <th style={th}>Date</th>
                    <th style={th}>Amount</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const conf = CONF[r.confidence];
                    const complete = isReady(r);
                    const projs = r.customerSel && r.customerSel !== NEW ? (projectsByCustomer.get(r.customerSel) ?? []) : [];
                    const gk = rowGroupKey(r);
                    const sharedNew = gk ? (groupCount.get(gk) ?? 1) : 1; // how many invoices share this new registry
                    return (
                      <tr key={r.id} style={{ background: complete ? 'transparent' : '#FFFCF5' }}>
                        <td style={{ ...td, maxWidth: 210 }}>
                          <div title={r.fileName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1a1a1a' }}>{r.fileName}</div>
                          {r.customerSel === NEW ? (
                            <input value={r.billToName} onChange={(e) => patch(r.id, { billToName: e.target.value })} placeholder="New customer name"
                              style={{ ...inputStyle, marginTop: 4, fontWeight: 600 }} />
                          ) : (
                            <div style={{ fontSize: 10, color: C.slate, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${r.billToName}${r.billingAddress ? ' · ' + r.billingAddress : ''}`}>
                              {r.billToName || <span style={{ color: '#C0321A' }}>no bill-to read</span>}
                            </div>
                          )}
                          {r.errored && <div style={{ fontSize: 10, color: '#C0321A', marginTop: 2 }}>Analysis failed — fill manually</div>}
                        </td>
                        <td style={td}>
                          <span style={{ background: conf.bg, color: conf.color, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>{conf.label}</span>
                        </td>
                        <td style={td}>
                          <select value={r.customerSel} onChange={(e) => onCustomer(r.id, e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            <option value="">— Select customer —</option>
                            <option value={NEW}>+ Create new customer</option>
                            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </td>
                        <td style={td}>
                          {r.customerSel === NEW ? (
                            <span style={{ fontSize: 11, color: C.slate, fontStyle: 'italic' }}>New registry (auto)</span>
                          ) : !r.customerSel ? (
                            <span style={{ fontSize: 11, color: C.slate }}>—</span>
                          ) : (
                            <select value={r.registrySel} onChange={(e) => patch(r.id, { registrySel: e.target.value })}
                              style={{ ...inputStyle, cursor: 'pointer', background: r.registrySel ? C.white : '#FDEAEA' }}>
                              {projs.length !== 1 && <option value="">— Pick registry —</option>}
                              {projs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              <option value={NEW}>+ Create new registry</option>
                            </select>
                          )}
                          {gk && sharedNew > 1 && (
                            <div style={{ fontSize: 10, color: C.green, fontWeight: 700, marginTop: 4 }}>
                              ↳ one shared registry · {sharedNew} invoices
                            </div>
                          )}
                        </td>
                        <td style={td}>
                          <input value={r.invoiceNumber} onChange={(e) => patch(r.id, { invoiceNumber: e.target.value })} placeholder="Invoice no."
                            style={{ ...inputStyle, minWidth: 110 }} />
                        </td>
                        <td style={td}>
                          <input type="date" value={r.invoiceDate} onChange={(e) => patch(r.id, { invoiceDate: e.target.value })}
                            style={{ ...inputStyle, minWidth: 130 }} />
                        </td>
                        <td style={td}>
                          <input type="number" step="0.01" value={r.amount} onChange={(e) => patch(r.id, { amount: e.target.value })} placeholder="Optional"
                            style={{ ...inputStyle, minWidth: 90 }} />
                        </td>
                        <td style={td}>
                          <button onClick={() => removeRow(r.id)} disabled={busy}
                            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>Remove</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          {committing && <span style={{ marginRight: 'auto', fontSize: 13, color: C.green, fontWeight: 700 }}>Importing {committing.done} / {committing.total}…</span>}
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Close</button>
          <button onClick={() => void commit()} disabled={busy || ready.length === 0}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: (busy || ready.length === 0) ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: (busy || ready.length === 0) ? 'default' : 'pointer' }}>
            {committing ? 'Importing…' : `Import ${ready.length} Invoice${ready.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
