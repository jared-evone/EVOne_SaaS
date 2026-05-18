import { supabase } from '../../lib/supabase';
import type { PortalAccount, PortalDocument, DocType, PortalStatementData } from './types';
import { hashPassword } from './portalAuth';

// ── Accounts ─────────────────────────────────────────────────────

export async function listAccounts(): Promise<PortalAccount[]> {
  const { data, error } = await supabase
    .from('customer_portal_accounts')
    .select('*, crm_companies(name)')
    .order('email');
  if (error) throw error;
  return (data as PortalAccount[]) ?? [];
}

export async function createAccount(args: {
  company_id: string;
  email: string;
  password: string;
  salt: string;
}): Promise<void> {
  const password_hash = await hashPassword(args.salt, args.password);
  const { error } = await supabase.from('customer_portal_accounts').insert({
    company_id: args.company_id,
    email: args.email.trim().toLowerCase(),
    password_hash,
    password_salt: args.salt,
  });
  if (error) throw error;
}

export async function updateAccountPassword(
  id: string,
  newSalt: string,
  newPassword: string,
): Promise<void> {
  const password_hash = await hashPassword(newSalt, newPassword);
  const { error } = await supabase
    .from('customer_portal_accounts')
    .update({ password_hash, password_salt: newSalt, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function updateAccountEmail(id: string, email: string): Promise<void> {
  const { error } = await supabase
    .from('customer_portal_accounts')
    .update({ email: email.trim().toLowerCase(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabase.from('customer_portal_accounts').delete().eq('id', id);
  if (error) throw error;
}

// Pre-create empty (credentials-less) accounts for every company that doesn't yet
// have one. Returns how many were created.
export async function seedAccountsForAllCompanies(): Promise<number> {
  const [coRes, exRes] = await Promise.all([
    supabase.from('crm_companies').select('id'),
    supabase.from('customer_portal_accounts').select('company_id'),
  ]);
  if (coRes.error) throw coRes.error;
  if (exRes.error) throw exRes.error;
  const have = new Set((exRes.data ?? []).map((r) => (r as { company_id: string }).company_id));
  const toCreate = (coRes.data ?? [])
    .map((c) => (c as { id: string }).id)
    .filter((id) => !have.has(id));
  if (toCreate.length === 0) return 0;
  const { error } = await supabase
    .from('customer_portal_accounts')
    .insert(toCreate.map((company_id) => ({ company_id, email: null, password_hash: null, password_salt: null })));
  if (error) throw error;
  return toCreate.length;
}

// Fill in email + freshly hashed password on an existing precreated row.
export async function configureAccount(id: string, email: string, salt: string, password: string): Promise<void> {
  const password_hash = await hashPassword(salt, password);
  const { error } = await supabase
    .from('customer_portal_accounts')
    .update({
      email: email.trim().toLowerCase(),
      password_hash,
      password_salt: salt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function findAccountByEmail(email: string): Promise<PortalAccount | null> {
  const { data, error } = await supabase
    .from('customer_portal_accounts')
    .select('*, crm_companies(name)')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return (data as PortalAccount) ?? null;
}

export async function recordLogin(accountId: string): Promise<void> {
  await supabase
    .from('customer_portal_accounts')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', accountId);
}

// ── Documents ────────────────────────────────────────────────────

export async function listDocumentsForCompany(companyId: string): Promise<PortalDocument[]> {
  const { data, error } = await supabase
    .from('customer_portal_documents')
    .select('*')
    .eq('company_id', companyId)
    .order('billing_month', { ascending: false })
    .order('doc_type');
  if (error) throw error;
  return (data as PortalDocument[]) ?? [];
}

export async function countFleetForCompany(companyId: string): Promise<{ vehicles: number; spDrivers: number }> {
  const [v, d] = await Promise.all([
    supabase.from('crm_vehicles').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('crm_sp_drivers').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
  ]);
  if (v.error) throw v.error;
  if (d.error) throw d.error;
  return { vehicles: v.count ?? 0, spDrivers: d.count ?? 0 };
}

export async function countDocsByCompany(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('customer_portal_documents')
    .select('company_id');
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as { company_id: string }[]) {
    counts[r.company_id] = (counts[r.company_id] ?? 0) + 1;
  }
  return counts;
}

export async function nextInvoiceSeq(billingMonth: string): Promise<number> {
  const { data, error } = await supabase
    .from('customer_portal_documents')
    .select('invoice_number')
    .eq('billing_month', billingMonth)
    .eq('doc_type', 'invoice');
  if (error) throw error;
  const nums = (data ?? [])
    .map((r) => {
      const m = (r as { invoice_number: string | null }).invoice_number?.match(/-(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter((n) => Number.isFinite(n));
  const maxSeq = nums.length > 0 ? Math.max(...nums) : 0;
  return maxSeq + 1;
}

export function makeInvoiceNumber(billingMonth: string, seq: number): string {
  return `INV-${billingMonth}-${String(seq).padStart(4, '0')}`;
}

export async function deleteDocument(id: string): Promise<void> {
  const { error } = await supabase.from('customer_portal_documents').delete().eq('id', id);
  if (error) throw error;
}

// Manually upload a statement PDF for a (company, billing_month). Used when the
// admin wants to override or backfill outside the Generate flow. statement_data
// is a minimal placeholder — the in-app StatementView modal will render empty
// breakdowns but the PDF download still works.
export async function uploadStatementForCompany(args: {
  company_id: string;
  billing_month: string;
  pdf_base64: string;
  total_amount_override?: number;
  total_kwh_override?: number;
}): Promise<void> {
  const total_kwh    = args.total_kwh_override    ?? 0;
  const total_amount = args.total_amount_override ?? 0;
  const placeholder: PortalStatementData = {
    company: { id: args.company_id, name: '', base_rate: 0, threshold_kwh: 0, discounted_rate: 0 },
    goparkinRows: [],
    spRows: [],
    totalKwh: total_kwh,
    appliedRate: 0,
    totalAmount: total_amount,
  };
  await upsertDocument({
    company_id: args.company_id,
    billing_month: args.billing_month,
    doc_type: 'statement',
    invoice_number: null,
    statement_data: placeholder,
    pdf_base64: args.pdf_base64,
    total_kwh,
    total_amount,
    applied_rate: 0,
    issued_by: 'admin',
  });
}

// Upload an externally-generated invoice PDF for a (company, billing_month).
// If a published statement exists for the same key, inherits its totals so the
// invoices table displays consistent numbers. Otherwise falls back to whatever
// the admin entered, then 0.
export async function uploadInvoiceForCompany(args: {
  company_id: string;
  billing_month: string;
  invoice_number: string;
  pdf_base64: string;
  total_amount_override?: number;
  total_kwh_override?: number;
}): Promise<void> {
  const { data: stmt, error: stmtErr } = await supabase
    .from('customer_portal_documents')
    .select('statement_data, total_kwh, total_amount, applied_rate')
    .eq('company_id', args.company_id)
    .eq('billing_month', args.billing_month)
    .eq('doc_type', 'statement')
    .maybeSingle();
  if (stmtErr) throw stmtErr;

  const total_kwh    = args.total_kwh_override    ?? (stmt as { total_kwh?: number } | null)?.total_kwh    ?? 0;
  const total_amount = args.total_amount_override ?? (stmt as { total_amount?: number } | null)?.total_amount ?? 0;
  const applied_rate = (stmt as { applied_rate?: number } | null)?.applied_rate ?? 0;
  const statement_data = (stmt as { statement_data?: unknown } | null)?.statement_data ?? {
    company: { id: args.company_id, name: '', base_rate: 0, threshold_kwh: 0, discounted_rate: 0 },
    goparkinRows: [],
    spRows: [],
    totalKwh: total_kwh,
    appliedRate: applied_rate,
    totalAmount: total_amount,
  };

  await upsertDocument({
    company_id: args.company_id,
    billing_month: args.billing_month,
    doc_type: 'invoice',
    invoice_number: args.invoice_number.trim() || null,
    statement_data: statement_data as PortalStatementData,
    pdf_base64: args.pdf_base64,
    total_kwh,
    total_amount,
    applied_rate,
    issued_by: 'admin',
  });
}

export async function upsertDocument(args: {
  company_id: string;
  billing_month: string;
  doc_type: DocType;
  invoice_number: string | null;
  statement_data: PortalStatementData;
  pdf_base64: string;
  total_kwh: number;
  total_amount: number;
  applied_rate: number;
  issued_by: string;
}): Promise<void> {
  const { error } = await supabase
    .from('customer_portal_documents')
    .upsert(
      {
        ...args,
        issued_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,billing_month,doc_type' },
    );
  if (error) throw error;
}

// ── PDF base64 helpers ───────────────────────────────────────────

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // strip "data:application/pdf;base64,"
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function downloadPdfFromBase64(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
