import { supabase } from './supabase';

// Branding + sender identities for the Charger Registry LTA inspection emails.
// Mirrors the Corporate CRM email design model: a shared logo/header/footer/accent
// wraps a plain-text message body, and sends use an admin-managed sender identity.

export interface EmailBrand { logoUrl: string; headerTitle: string; footerText: string; accent: string; }

// Stored as a row in the shared crm_email_brand table, keyed separately from CRM.
export const LTA_BRAND_ID = 'lta_inspection';
export const DEFAULT_LTA_BRAND: EmailBrand = {
  logoUrl: '',
  headerTitle: 'EVOne Charger Registry',
  footerText: 'This is a notification from EVOne regarding your charger LTA inspection.',
  accent: '#2A9A47',
};

export async function fetchLtaBrand(): Promise<EmailBrand> {
  const { data } = await supabase.from('crm_email_brand').select('data').eq('id', LTA_BRAND_ID).maybeSingle();
  const stored = (data as { data?: Partial<EmailBrand> } | null)?.data ?? {};
  return { ...DEFAULT_LTA_BRAND, ...stored };
}

export function saveLtaBrand(brand: EmailBrand) {
  return supabase.from('crm_email_brand').upsert({ id: LTA_BRAND_ID, data: brand, updated_at: new Date().toISOString() });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Wrap a plain-text message body in the branded chrome (logo, header, footer).
export function buildLtaEmailHtml(bodyText: string, brand: EmailBrand): string {
  const safe = escapeHtml(bodyText).replace(/\n/g, '<br>');
  const accent = brand.accent || '#2A9A47';
  const title = (brand.headerTitle || '').trim();
  const header = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${escapeHtml(title || 'Logo')}" style="max-height:44px;max-width:220px;display:block;" />${title ? `<div style="margin-top:8px;color:#5B6B7A;font-size:13px;font-weight:600;">${escapeHtml(title)}</div>` : ''}`
    : `<span style="font-weight:700;color:${accent};font-size:20px;letter-spacing:-0.02em;">${escapeHtml(title || 'EVOne')}</span>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:0 16px;">
  <div style="border-top:4px solid ${accent};padding:18px 0 14px;">${header}</div>
  <div style="font-size:14px;line-height:1.65;">${safe}</div>
  ${brand.footerText ? `<div style="margin-top:26px;border-top:1px solid #EBEBEB;padding-top:12px;font-size:12px;color:#5B6B7A;">${escapeHtml(brand.footerText).replace(/\n/g, '<br>')}</div>` : ''}
</div>`;
}

export interface EmailSender { id: string; from_name: string; from_email: string; reply_to: string | null; }

export async function fetchSenders(): Promise<EmailSender[]> {
  const { data } = await supabase.from('email_senders').select('*').order('from_name');
  return (data as EmailSender[]) ?? [];
}
