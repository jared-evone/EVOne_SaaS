// Bulk-invoice helper: each invoice PDF is read by Claude via the `analyze-invoice`
// Supabase Edge Function (which holds the Anthropic key as a server secret — the key
// never reaches the browser). The function returns the billed company, billing month,
// invoice number and total; here we resolve the company name back to a CRM id and
// grade match confidence.

import { supabase } from '../../lib/supabase';

export type Confidence = 'high' | 'medium' | 'low';

export interface InvoiceExtraction {
  companyId: string | null;
  confidence: Confidence;
  billingMonth: string;   // 'YYYY-MM' or ''
  invoiceNumber: string;
  amount: string;         // formatted for the form input, '' if unknown
}

interface Company { id: string; name: string; }

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolveCompany(name: string, companies: Company[]): { id: string | null; exact: boolean } {
  const n = normName(name);
  if (!n) return { id: null, exact: false };
  for (const c of companies) if (normName(c.name) === n) return { id: c.id, exact: true };
  for (const c of companies) {
    const cn = normName(c.name);
    if (cn && (cn.includes(n) || n.includes(cn))) return { id: c.id, exact: false };
  }
  return { id: null, exact: false };
}

interface EdgeResult {
  company_name?: string;
  billing_month?: string;
  invoice_number?: string;
  total_amount?: number | null;
  error?: string;
}

export async function analyzeInvoicePdf(
  base64Pdf: string,
  companies: Company[],
): Promise<InvoiceExtraction> {
  const { data, error } = await supabase.functions.invoke<EdgeResult>('analyze-invoice', {
    body: { base64Pdf, companyNames: companies.map((c) => c.name) },
  });
  if (error) throw new Error(error.message ?? 'analyze-invoice function failed');
  if (!data) throw new Error('analyze-invoice returned no data');
  if (data.error) throw new Error(data.error);

  const { id, exact } = resolveCompany(String(data.company_name ?? ''), companies);
  const month = String(data.billing_month ?? '');
  const amountNum = typeof data.total_amount === 'number' && isFinite(data.total_amount) ? data.total_amount : undefined;

  return {
    companyId: id,
    confidence: id ? (exact ? 'high' : 'medium') : 'low',
    billingMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : '',
    invoiceNumber: String(data.invoice_number ?? '').trim(),
    amount: amountNum != null ? amountNum.toFixed(2) : '',
  };
}
