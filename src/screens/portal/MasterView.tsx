import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { StatementView } from '../CorporateInvoicing';
import { listAccounts, listDocumentsForCompany, countDocsByCompany, downloadPdfFromBase64 } from './portalDb';
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

export function MasterView() {
  const [accounts, setAccounts] = useState<AccountWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docs, setDocs] = useState<PortalDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<DocType>('statement');
  const [viewing, setViewing] = useState<PortalDocument | null>(null);

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
  }, [selectedId, accounts]);

  const filtered = accounts.filter((a) => {
    const q = search.toLowerCase();
    return a.account.email.toLowerCase().includes(q)
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
                <div style={{ fontSize: 11, color: C.slate, fontFamily: 'monospace', marginBottom: 6 }}>{account.email}</div>
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
                <span>Email: <strong style={{ color: '#1a1a1a' }}>{selected.account.email}</strong></span>
                <span>Last login: <strong style={{ color: '#1a1a1a' }}>{fmtTs(selected.account.last_login_at)}</strong></span>
                <span>Created: <strong style={{ color: '#1a1a1a' }}>{fmtTs(selected.account.created_at)}</strong></span>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
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
                            </div>
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
    </div>
  );
}
