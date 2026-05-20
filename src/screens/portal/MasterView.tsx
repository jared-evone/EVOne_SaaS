import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { StatementView } from '../CorporateInvoicing';
import { listAccounts, listDocumentsForCompany, countDocsByCompany, downloadPdfFromBase64, blobToBase64, uploadInvoiceForCompany, uploadStatementForCompany, deleteDocument } from './portalDb';
import type { PortalAccount, PortalDocument, DocType } from './types';

function fmtTs(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
}

function fmtAmt(n: number): string {
  return `$${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtKwh(n: number): string {
  return `${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh`;
}

interface AccountWithCount {
  account: PortalAccount;
  docCount: number;
}

function FieldLabel({ children }: { children: string }) {
  return (
    <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
      {children}
    </label>
  );
}

interface UploadDocumentModalProps {
  docType: DocType;
  companyId: string;
  companyName: string;
  existingMonths: string[];
  prefilled: { billingMonth?: string; totalKwh?: number; totalAmount?: number };
  onClose: () => void;
  onUploaded: () => void;
}

function UploadDocumentModal({ docType, companyId, companyName, existingMonths, prefilled, onClose, onUploaded }: UploadDocumentModalProps) {
  const [billingMonth, setBillingMonth] = useState(prefilled.billingMonth ?? existingMonths[0] ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [totalAmount, setTotalAmount] = useState(prefilled.totalAmount != null ? String(prefilled.totalAmount) : '');
  const [totalKwh, setTotalKwh] = useState(prefilled.totalKwh != null ? String(prefilled.totalKwh) : '');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isInvoice = docType === 'invoice';
  const docLabel = isInvoice ? 'Invoice' : 'Statement';
  const canSubmit = !!billingMonth && (!isInvoice || !!invoiceNumber.trim()) && !!file && !saving;

  const handleSubmit = async () => {
    if (!file) return;
    setErr(null);
    setSaving(true);
    try {
      const b64 = await blobToBase64(file);
      const amtOverride = totalAmount.trim() ? parseFloat(totalAmount) : undefined;
      const kwhOverride = totalKwh.trim()    ? parseFloat(totalKwh)    : undefined;
      if (isInvoice) {
        await uploadInvoiceForCompany({
          company_id: companyId,
          billing_month: billingMonth,
          invoice_number: invoiceNumber,
          pdf_base64: b64,
          total_amount_override: amtOverride,
          total_kwh_override: kwhOverride,
        });
      } else {
        await uploadStatementForCompany({
          company_id: companyId,
          billing_month: billingMonth,
          pdf_base64: b64,
          total_amount_override: amtOverride,
          total_kwh_override: kwhOverride,
        });
      }
      onUploaded();
      onClose();
    } catch (e) {
      setErr((e as Error).message ?? 'Upload failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 520, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Upload {docLabel}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div style={{ fontSize: 13, color: '#1a1a1a' }}>
          For <strong>{companyName}</strong>. Re-uploading for the same billing month replaces the previous {docLabel.toLowerCase()}.
        </div>
        {!isInvoice && (
          <div style={{ fontSize: 12, color: C.slate, background: '#FFF8E1', borderRadius: 10, padding: '10px 14px' }}>
            Manually-uploaded statements will not have the per-vehicle breakdown shown in the "View" modal — only the PDF download will be available.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: isInvoice ? '1fr 1fr' : '1fr 1fr', gap: 14 }}>
          <div>
            <FieldLabel>Billing Month</FieldLabel>
            <input type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }} />
          </div>
          {isInvoice && (
            <div>
              <FieldLabel>Invoice No.</FieldLabel>
              <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-2026-04-0001"
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          )}
          <div>
            <FieldLabel>Total Amount (SGD)</FieldLabel>
            <input type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder={isInvoice ? 'Auto from statement' : 'Optional'}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <FieldLabel>Total kWh</FieldLabel>
            <input type="number" step="0.01" value={totalKwh} onChange={(e) => setTotalKwh(e.target.value)} placeholder={isInvoice ? 'Auto from statement' : 'Optional'}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        <div>
          <FieldLabel>{`${docLabel} PDF`}</FieldLabel>
          <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }} />
          {file && <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)</div>}
        </div>

        {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={!canSubmit}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSubmit ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default' }}>
            {saving ? 'Uploading…' : `Upload ${docLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MasterView() {
  const [accounts, setAccounts] = useState<AccountWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docs, setDocs] = useState<PortalDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<DocType>('statement');
  const [viewing, setViewing] = useState<PortalDocument | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState<DocType | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [list, counts] = await Promise.all([listAccounts(), countDocsByCompany()]);
        setAccounts(list.map((account) => ({ account, docCount: counts[account.company_id] ?? 0 })));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) { setDocs([]); return; }
    const account = accounts.find((a) => a.account.id === selectedId)?.account;
    if (!account) return;
    setDocsLoading(true);
    listDocumentsForCompany(account.company_id)
      .then(setDocs)
      .finally(() => setDocsLoading(false));
  }, [selectedId, accounts, refreshKey]);

  const filtered = accounts.filter((a) => {
    const q = search.toLowerCase();
    return (a.account.email ?? '').toLowerCase().includes(q)
      || (a.account.crm_companies?.name ?? '').toLowerCase().includes(q);
  });

  const selected = accounts.find((a) => a.account.id === selectedId);
  const visibleDocs = docs.filter((d) => d.doc_type === activeTab);
  const statementCount = docs.filter((d) => d.doc_type === 'statement').length;
  const invoiceCount = docs.filter((d) => d.doc_type === 'invoice').length;

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  if (accounts.length === 0) {
    return (
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '60px 24px', textAlign: 'center', color: C.slate }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>◉</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: '#1a1a1a' }}>No customer accounts yet</div>
        <div style={{ fontSize: 13 }}>Use the Accounts tab to create the first portal account.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
      {/* Left list */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 14, borderBottom: '1px solid #F3F3F3' }}>
          <div style={{ position: 'relative' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company or email…"
              style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
          </div>
        </div>
        <div style={{ maxHeight: '70vh', overflowY: 'auto', padding: 8 }}>
          {filtered.map(({ account, docCount }) => {
            const isSelected = account.id === selectedId;
            return (
              <div key={account.id} onClick={() => setSelectedId(account.id)}
                style={{ padding: 12, borderRadius: 12, marginBottom: 4, cursor: 'pointer',
                  background: isSelected ? C.honeydew : 'transparent',
                  border: isSelected ? `1.5px solid ${C.green}` : '1.5px solid transparent' }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = C.seasalt; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? C.green : '#1a1a1a', marginBottom: 2 }}>
                  {account.crm_companies?.name ?? '—'}
                </div>
                <div style={{ fontSize: 11, color: account.email ? C.slate : '#B07D00', fontFamily: account.email ? 'monospace' : 'Figtree', fontStyle: account.email ? 'normal' : 'italic', marginBottom: 6 }}>
                  {account.email ?? 'Awaiting setup'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.slate }}>
                  <span>{docCount} doc{docCount !== 1 ? 's' : ''}</span>
                  <span>Last login: {account.last_login_at ? new Date(account.last_login_at).toLocaleDateString('en-SG') : 'never'}</span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: C.slate, fontSize: 12 }}>No matches</div>
          )}
        </div>
      </div>

      {/* Right detail */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!selected && (
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '60px 24px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
            Select an account on the left to view its issued documents.
          </div>
        )}
        {selected && (
          <>
            {/* Account header */}
            <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em', marginBottom: 4 }}>
                {selected.account.crm_companies?.name ?? '—'}
              </div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12, color: C.slate }}>
                <span>Email: <strong style={{ color: selected.account.email ? '#1a1a1a' : '#B07D00' }}>{selected.account.email ?? 'Awaiting setup'}</strong></span>
                <span>Last login: <strong style={{ color: '#1a1a1a' }}>{fmtTs(selected.account.last_login_at)}</strong></span>
                <span>Created: <strong style={{ color: '#1a1a1a' }}>{fmtTs(selected.account.created_at)}</strong></span>
              </div>
            </div>

            {/* Tabs + invoice upload */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB' }}>
                {([
                  ['statement', `Statements (${statementCount})`],
                  ['invoice', `Invoices (${invoiceCount})`],
                ] as [DocType, string][]).map(([id, label]) => (
                  <button key={id} onClick={() => setActiveTab(id)}
                    style={{ padding: '8px 18px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      background: activeTab === id ? C.green : 'transparent', color: activeTab === id ? C.white : C.slate }}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={() => setUploadingDoc(activeTab)}
                style={{ marginLeft: 'auto', padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                ⬆ Upload {activeTab === 'invoice' ? 'Invoice' : 'Statement'}
              </button>
            </div>

            {/* Documents table */}
            <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
              {docsLoading ? (
                <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: C.seasalt }}>
                        {[
                          'Billing Month',
                          activeTab === 'invoice' ? 'Invoice No.' : 'Total kWh',
                          activeTab === 'invoice' ? 'Total kWh' : 'Applied Rate',
                          'Total Amount',
                          'Issued',
                          '',
                        ].map((h) => (
                          <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDocs.map((d) => (
                        <tr key={d.id} style={{ borderBottom: '1px solid #F3F3F3' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                          <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green }}>{fmtMonth(d.billing_month)}</td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#1a1a1a' }}>
                            {activeTab === 'invoice' ? (d.invoice_number ?? '—') : fmtKwh(d.total_kwh)}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#1a1a1a' }}>
                            {activeTab === 'invoice' ? fmtKwh(d.total_kwh) : `$${Number(d.applied_rate).toFixed(3)}/kWh`}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green }}>{fmtAmt(d.total_amount)}</td>
                          <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate }}>{fmtTs(d.issued_at)}</td>
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                            {confirmDeleteId === d.id ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => setConfirmDeleteId(null)}
                                  style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                                <button onClick={async () => {
                                  try {
                                    await deleteDocument(d.id);
                                    setConfirmDeleteId(null);
                                    setRefreshKey((k) => k + 1);
                                  } catch (e) {
                                    alert(`Delete failed: ${(e as Error).message}`);
                                  }
                                }}
                                  style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Confirm Delete</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 6 }}>
                                {d.doc_type === 'statement' && (
                                  <button onClick={() => setViewing(d)}
                                    style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>View</button>
                                )}
                                <button onClick={() => {
                                  const cname = selected.account.crm_companies?.name ?? 'company';
                                  downloadPdfFromBase64(d.pdf_base64, `${cname}_${d.billing_month}_${d.doc_type}.pdf`);
                                }}
                                  style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>⬇ PDF</button>
                                <button onClick={() => setConfirmDeleteId(d.id)}
                                  style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #FDEAEA', background: C.white, color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {visibleDocs.length === 0 && (
                        <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No {activeTab}s issued for this customer yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {viewing && (
        <StatementView
          stmt={viewing.statement_data}
          billingMonth={viewing.billing_month}
          onClose={() => setViewing(null)}
        />
      )}

      {uploadingDoc && selected && (
        <UploadDocumentModal
          docType={uploadingDoc}
          companyId={selected.account.company_id}
          companyName={selected.account.crm_companies?.name ?? '—'}
          existingMonths={[...new Set(docs.filter((d) => d.doc_type === 'statement').map((d) => d.billing_month))]}
          prefilled={(() => {
            const latestStmt = docs.find((d) => d.doc_type === 'statement');
            return uploadingDoc === 'invoice' && latestStmt
              ? { billingMonth: latestStmt.billing_month, totalKwh: latestStmt.total_kwh, totalAmount: latestStmt.total_amount }
              : {};
          })()}
          onClose={() => setUploadingDoc(null)}
          onUploaded={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
