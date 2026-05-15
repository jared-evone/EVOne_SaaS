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
