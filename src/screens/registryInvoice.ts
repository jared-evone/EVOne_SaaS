// Registry-invoice ingestion helpers. Each invoice PDF is read by Claude via the
// `analyze-registry-invoice` Supabase Edge Function (the Anthropic key lives there as a
// server secret). This module exposes the extraction call plus the fuzzy matching used to
// route an invoice's bill-to party to an existing customer in the `customers` table.

import { supabase } from '../lib/supabase';

export interface RawInvoice {
  companyName: string;
  billingAddress: string;
  contactName: string;
  invoiceNumber: string;
  invoiceDate: string;       // 'YYYY-MM-DD' or ''
  totalAmount: number | null;
}

export interface CustomerLite {
  id: string;
  name: string;
  address: string | null;
}

export interface CustomerMatch {
  customerId: string | null;
  score: number;             // 0..1
  confidence: 'high' | 'medium' | 'low';
}

interface EdgeResult {
  company_name?: string;
  billing_address?: string;
  contact_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  total_amount?: number | null;
  error?: string;
}

export function normKey(s: string): string {
  return (s || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(pte\.?|ltd\.?|limited|llp|co\.?|corporation|inc\.?|pl)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function normName(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Dice coefficient on bigrams of the normalised names (0..1).
export function diceSim(aRaw: string, bRaw: string): number {
  const a = normKey(aRaw), b = normKey(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
    return m;
  };
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  for (const [g, n] of A) { total += n; if (B.has(g)) inter += Math.min(n, B.get(g)!); }
  for (const [, n] of B) total += n;
  return total ? (2 * inter) / total : 0;
}

const postal = (s: string | null) => (s || '').match(/\b\d{6}\b/)?.[0] ?? '';

// Match an invoice's bill-to party to a customer. Name similarity drives the score;
// a shared SG postal code in the billing address, or a contact name that appears among
// the customer's contacts, nudges confidence up. Returns the best candidate.
export function matchCustomer(
  inv: RawInvoice,
  customers: CustomerLite[],
  contactsByCustomer: Map<string, string[]>,
): CustomerMatch {
  if (!inv.companyName.trim()) return { customerId: null, score: 0, confidence: 'low' };
  const invPostal = postal(inv.billingAddress);
  const invContact = normName(inv.contactName);

  let best: { id: string; score: number } | null = null;
  for (const c of customers) {
    let s = diceSim(inv.companyName, c.name);
    if (invPostal && postal(c.address) === invPostal) s += 0.12;
    if (invContact) {
      const names = contactsByCustomer.get(c.id) ?? [];
      if (names.some((n) => { const nn = normName(n); return nn && (nn === invContact || nn.includes(invContact) || invContact.includes(nn)); })) s += 0.1;
    }
    s = Math.min(1, s);
    if (!best || s > best.score) best = { id: c.id, score: s };
  }
  if (!best || best.score < 0.4) return { customerId: best && best.score >= 0.4 ? best.id : null, score: best?.score ?? 0, confidence: 'low' };
  const confidence = best.score >= 0.985 ? 'high' : best.score >= 0.6 ? 'medium' : 'low';
  return { customerId: confidence === 'low' ? null : best.id, score: best.score, confidence };
}

export async function analyzeRegistryInvoicePdf(base64Pdf: string, customerNames: string[]): Promise<RawInvoice> {
  const { data, error } = await supabase.functions.invoke<EdgeResult>('analyze-registry-invoice', {
    body: { base64Pdf, customerNames },
  });
  if (error) throw new Error(error.message ?? 'analyze-registry-invoice function failed');
  if (!data) throw new Error('analyze-registry-invoice returned no data');
  if (data.error) throw new Error(data.error);

  const date = String(data.invoice_date ?? '').trim();
  return {
    companyName: String(data.company_name ?? '').trim(),
    billingAddress: String(data.billing_address ?? '').trim(),
    contactName: String(data.contact_name ?? '').trim(),
    invoiceNumber: String(data.invoice_number ?? '').trim(),
    invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    totalAmount: typeof data.total_amount === 'number' && isFinite(data.total_amount) ? data.total_amount : null,
  };
}
