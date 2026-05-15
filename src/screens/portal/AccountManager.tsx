import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { CompanySelect } from '../CorporateCRM';
import type { CRMCompany } from '../CorporateInvoicing';
import { supabase } from '../../lib/supabase';
import {
  listAccounts, createAccount, updateAccountPassword, updateAccountEmail, deleteAccount,
} from './portalDb';
import { generatePassword, randomSalt } from './portalAuth';
import type { PortalAccount } from './types';

function FieldLabel({ children }: { children: string }) {
  return (
    <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
      {children}
    </label>
  );
}

function fmtTs(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

interface NewAccountModalProps {
  companies: CRMCompany[];
  existingCompanyIds: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}

function NewAccountModal({ companies, existingCompanyIds, onClose, onSaved }: NewAccountModalProps) {
  const [companyId, setCompanyId] = useState('');
  const [email, setEmail] = useState('');
  const [generatedPassword] = useState(() => generatePassword());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const available = companies.filter((c) => !existingCompanyIds.has(c.id));

  const handleSave = async () => {
    setErr(null);
    if (!companyId) { setErr('Pick a company.'); return; }
    if (!email.trim()) { setErr('Email is required.'); return; }
    setSaving(true);
    try {
      await createAccount({ company_id: companyId, email, salt: randomSalt(), password: generatedPassword });
      setDone(true);
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to create account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 480, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>New Customer Portal Account</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {!done && (
          <>
            <div>
              <FieldLabel>Company</FieldLabel>
              <CompanySelect value={companyId} companies={available} onChange={setCompanyId} />
              {available.length < companies.length && (
                <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>
                  {companies.length - available.length} company already has an account and is hidden.
                </div>
              )}
            </div>
            <div>
              <FieldLabel>Login Email</FieldLabel>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com"
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ background: C.seasalt, borderRadius: 12, padding: 16 }}>
              <FieldLabel>Generated Password</FieldLabel>
              <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: C.green, padding: '10px 14px', background: C.white, borderRadius: 8, border: '1px solid #EBEBEB' }}>
                {generatedPassword}
              </div>
              <div style={{ fontSize: 11, color: C.slate, marginTop: 8 }}>
                Copy this now — it is hashed on save and cannot be retrieved later.
              </div>
            </div>

            {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving || !companyId || !email.trim()}
                style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: companyId && email.trim() && !saving ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          </>
        )}

        {done && (
          <>
            <div style={{ background: C.honeydew, color: C.green, borderRadius: 12, padding: 16, fontSize: 13, fontWeight: 600 }}>
              Account created. Share these credentials with the customer.
            </div>
            <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <FieldLabel>Email</FieldLabel>
                <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#1a1a1a' }}>{email}</div>
              </div>
              <div>
                <FieldLabel>Password</FieldLabel>
                <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: C.green }}>{generatedPassword}</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => { onSaved(); onClose(); }}
                style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface ResetPasswordModalProps {
  account: PortalAccount;
  onClose: () => void;
  onSaved: () => void;
}

function ResetPasswordModal({ account, onClose, onSaved }: ResetPasswordModalProps) {
  const [newPassword] = useState(() => generatePassword());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleReset = async () => {
    setErr(null);
    setSaving(true);
    try {
      await updateAccountPassword(account.id, randomSalt(), newPassword);
      setDone(true);
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to reset password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 460, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Reset Password</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        <div style={{ fontSize: 13, color: '#1a1a1a' }}>
          Account: <strong>{account.email}</strong> ({account.crm_companies?.name ?? '—'})
        </div>

        {!done && (
          <>
            <div style={{ background: C.seasalt, borderRadius: 12, padding: 16 }}>
              <FieldLabel>New Password</FieldLabel>
              <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: C.green, padding: '10px 14px', background: C.white, borderRadius: 8, border: '1px solid #EBEBEB' }}>
                {newPassword}
              </div>
              <div style={{ fontSize: 11, color: C.slate, marginTop: 8 }}>
                The previous password will stop working immediately. Copy this now.
              </div>
            </div>

            {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleReset} disabled={saving}
                style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: saving ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </>
        )}

        {done && (
          <>
            <div style={{ background: C.honeydew, color: C.green, borderRadius: 12, padding: 16, fontSize: 13, fontWeight: 600 }}>
              Password reset. Share the new credentials below.
            </div>
            <div style={{ background: C.seasalt, borderRadius: 12, padding: 16 }}>
              <FieldLabel>New Password</FieldLabel>
              <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: C.green }}>{newPassword}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => { onSaved(); onClose(); }}
                style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface EditEmailModalProps {
  account: PortalAccount;
  onClose: () => void;
  onSaved: () => void;
}

function EditEmailModal({ account, onClose, onSaved }: EditEmailModalProps) {
  const [email, setEmail] = useState(account.email);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setErr(null);
    if (!email.trim()) { setErr('Email is required.'); return; }
    setSaving(true);
    try {
      await updateAccountEmail(account.id, email);
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to update email.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 440, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Update Email</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>
        <div>
          <FieldLabel>Login Email</FieldLabel>
          <input value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: saving ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AccountManager() {
  const [accounts, setAccounts] = useState<PortalAccount[]>([]);
  const [companies, setCompanies] = useState<CRMCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<PortalAccount | null>(null);
  const [editingEmail, setEditingEmail] = useState<PortalAccount | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [a, c] = await Promise.all([
        listAccounts(),
        supabase.from('crm_companies').select('*').order('name').then((r) => (r.data as CRMCompany[]) ?? []),
      ]);
      setAccounts(a);
      setCompanies(c);
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const existingCompanyIds = new Set(accounts.map((a) => a.company_id));

  const handleDelete = async (id: string) => {
    try {
      await deleteAccount(id);
      setConfirmDeleteId(null);
      await refresh();
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to delete.');
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading accounts…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{err}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Customer Portal Accounts</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{accounts.length} account{accounts.length !== 1 ? 's' : ''} · one per company</div>
        </div>
        <button onClick={() => setAdding(true)}
          style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + New Account
        </button>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['Company', 'Email', 'Last Login', 'Created', ''].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #F3F3F3' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{a.crm_companies?.name ?? '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: C.green, fontFamily: 'monospace' }}>{a.email}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate }}>{fmtTs(a.last_login_at)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate }}>{fmtTs(a.created_at)}</td>
                  <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                    {confirmDeleteId === a.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setConfirmDeleteId(null)}
                          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={() => handleDelete(a.id)}
                          style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Confirm Delete</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setEditingEmail(a)}
                          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Edit Email</button>
                        <button onClick={() => setResetting(a)}
                          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid ' + C.green, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Reset Password</button>
                        <button onClick={() => setConfirmDeleteId(a.id)}
                          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #FDEAEA', background: C.white, color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No portal accounts yet. Create one to invite your first customer.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <NewAccountModal companies={companies} existingCompanyIds={existingCompanyIds} onClose={() => setAdding(false)} onSaved={refresh} />}
      {resetting && <ResetPasswordModal account={resetting} onClose={() => setResetting(null)} onSaved={refresh} />}
      {editingEmail && <EditEmailModal account={editingEmail} onClose={() => setEditingEmail(null)} onSaved={refresh} />}
    </div>
  );
}
