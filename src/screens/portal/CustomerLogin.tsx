import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import { KPICard } from '../../components/KPICard';
import { StatementView } from '../CorporateInvoicing';
import { findAccountByEmail, recordLogin, listDocumentsForCompany, downloadPdfFromBase64, countFleetForCompany } from './portalDb';
import { verifyPassword } from './portalAuth';
import type { PortalAccount, PortalDocument, DocType } from './types';
import { Download as DownloadIcon } from 'lucide-react';

function fmtTs(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
}

function fmtAmt(n: number): string {
  return `$${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtKwh(n: number): string {
  return `${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh`;
}

interface Props {
  onLoginChange?: (account: PortalAccount | null) => void;
}

export function CustomerLogin({ onLoginChange }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [account, setAccount] = useState<PortalAccount | null>(null);

  useEffect(() => {
    onLoginChange?.(account);
  }, [account, onLoginChange]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const found = await findAccountByEmail(email);
      if (!found) { setErr('No account found for that email.'); return; }
      if (!found.password_hash || !found.password_salt) { setErr('This account has not been set up yet. Please contact your administrator.'); return; }
      const ok = await verifyPassword(found.password_salt, found.password_hash, password);
      if (!ok) { setErr('Incorrect password.'); return; }
      await recordLogin(found.id);
      setAccount({ ...found, last_login_at: new Date().toISOString() });
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (account) {
    return <CustomerDashboard account={account} onLogout={() => setAccount(null)} />;
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 20px' }}>
      <form onSubmit={handleLogin} style={{ background: C.white, borderRadius: 20, padding: 32, width: 420, boxShadow: '0 8px 32px rgba(0,0,0,.06)', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
          <Logo height={40} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>Customer Portal</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>Sign in to view your charging statements and invoices.</div>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>

        {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{err}</div>}

        <button type="submit" disabled={submitting || !email || !password}
          style={{ padding: '11px 24px', borderRadius: 10, border: 'none', background: submitting || !email || !password ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 14, fontWeight: 700, cursor: submitting ? 'default' : 'pointer' }}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>

        <div style={{ fontSize: 11, color: C.slate, textAlign: 'center', marginTop: 4 }}>
          Need access? Contact billing@evone.com.sg.
        </div>
      </form>
    </div>
  );
}

function CustomerDashboard({ account, onLogout }: { account: PortalAccount; onLogout: () => void }) {
  const [docs, setDocs] = useState<PortalDocument[]>([]);
  const [fleet, setFleet] = useState<{ vehicles: number; spDrivers: number }>({ vehicles: 0, spDrivers: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DocType>('statement');
  const [viewing, setViewing] = useState<PortalDocument | null>(null);

  useEffect(() => {
    Promise.all([
      listDocumentsForCompany(account.company_id).then(setDocs),
      countFleetForCompany(account.company_id).then(setFleet),
    ]).finally(() => setLoading(false));
  }, [account.company_id]);

  const visible = docs.filter((d) => d.doc_type === activeTab);
  const statementCount = docs.filter((d) => d.doc_type === 'statement').length;
  const invoiceCount = docs.filter((d) => d.doc_type === 'invoice').length;
  const cname = account.crm_companies?.name ?? '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Customer top bar */}
      <div style={{ background: C.green, borderRadius: 16, padding: '20px 24px', color: C.white, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 4 }}>Welcome</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{cname}</div>
          <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>Logged in as {account.email}</div>
        </div>
        <button onClick={onLogout}
          style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Sign Out
        </button>
      </div>

      {/* Registered fleet */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        <KPICard label="Registered GoParkin Vehicles" value={String(fleet.vehicles)} sub="vehicle plates on file" />
        <KPICard label="Registered SP Drivers"       value={String(fleet.spDrivers)} sub="driver emails on file" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
        {([
          ['statement', `My Statements (${statementCount})`],
          ['invoice', `My Invoices (${invoiceCount})`],
        ] as [DocType, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            style={{ padding: '8px 18px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: activeTab === id ? C.green : 'transparent', color: activeTab === id ? C.white : C.slate }}>
            {label}
          </button>
        ))}
      </div>

      {/* Documents */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: C.seasalt }}>
                  {[
                    'Billing Month',
                    activeTab === 'invoice' ? 'Invoice No.' : 'Energy',
                    'Total Amount',
                    'Issued',
                    '',
                  ].map((h) => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #F3F3F3' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green }}>{fmtMonth(d.billing_month)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#1a1a1a' }}>
                      {activeTab === 'invoice' ? (d.invoice_number ?? '—') : fmtKwh(d.total_kwh)}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green }}>{fmtAmt(d.total_amount)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate }}>{fmtTs(d.issued_at)}</td>
                    <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {d.doc_type === 'statement' && (
                          <button onClick={() => setViewing(d)}
                            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>View Details</button>
                        )}
                        <button onClick={() => downloadPdfFromBase64(d.pdf_base64, `${cname}_${d.billing_month}_${d.doc_type}.pdf`)}
                          style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><DownloadIcon size={12} strokeWidth={2.25} style={{display:"inline",verticalAlign:"-2px",marginRight:4}}/> PDF</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No {activeTab}s available yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && (
        <StatementView stmt={viewing.statement_data} billingMonth={viewing.billing_month} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
