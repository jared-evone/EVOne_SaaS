// Supabase Edge Function: analyze-registry-invoice
// Reads a NetSuite invoice PDF with Claude and returns the billed-to company, billing
// address, contact name, invoice number, invoice date and total — the header fields the
// Charger Registry needs to route the invoice to a registry (or prefill a new one).
// The Anthropic API key lives here as a server secret (ANTHROPIC_API_KEY) and never
// reaches the browser bundle. Sibling of `analyze-invoice` (the portal extractor); kept
// separate so the portal flow is untouched.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (already set; shared)
//   supabase functions deploy analyze-registry-invoice
//
// The browser calls this via supabase.functions.invoke('analyze-registry-invoice', { body }).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MODEL = 'claude-haiku-4-5-20251001';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });

    const { base64Pdf, customerNames } = await req.json().catch(() => ({}));
    if (!base64Pdf || typeof base64Pdf !== 'string') {
      return json({ error: 'Missing base64Pdf in request body.' });
    }

    const list = (Array.isArray(customerNames) ? customerNames : [])
      .map((n: string) => `- ${n}`)
      .join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        tools: [{
          name: 'record_invoice',
          description: 'Record the header fields extracted from this invoice PDF.',
          input_schema: {
            type: 'object',
            properties: {
              company_name: {
                type: 'string',
                description: 'The customer/company this invoice is billed TO (the "Bill To" / "Sold To" party, NOT the seller EVOne). If the known customer list below contains a clear match, copy that name VERBATIM; otherwise return the bill-to name exactly as printed. Empty string if none.',
              },
              billing_address: {
                type: 'string',
                description: 'The bill-to postal address as printed (single line, comma-separated). Empty string if not present.',
              },
              contact_name: {
                type: 'string',
                description: 'The attention/contact person named on the invoice for the bill-to party (e.g. "Attn: Jane Tan"). Empty string if none.',
              },
              invoice_number: {
                type: 'string',
                description: 'The invoice number / reference exactly as printed, e.g. "INV-2605001". Empty string if none.',
              },
              invoice_date: {
                type: 'string',
                description: 'The invoice date in YYYY-MM-DD format. Use the invoice/issue date, not the due date. Empty string if not determinable.',
              },
              total_amount: {
                type: 'number',
                description: 'The total amount payable, as a plain number (no currency symbol or commas). Omit if not present.',
              },
            },
            required: ['company_name', 'invoice_number'],
          },
        }],
        tool_choice: { type: 'tool', name: 'record_invoice' },
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
            { type: 'text', text: `Read this invoice and call record_invoice with the extracted fields. The seller is EVOne — extract the party the invoice is billed TO, never EVOne.\n\nKnown customers — for company_name, copy the closest match VERBATIM from this list when one plausibly matches the bill-to party; otherwise use the printed bill-to name:\n${list}` },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return json({ error: `Anthropic API ${res.status}: ${detail.slice(0, 300)}` });
    }

    const data = await res.json();
    const block = (data.content ?? []).find((b: { type: string }) => b.type === 'tool_use');
    const input = block?.input ?? {};
    return json({
      company_name: String(input.company_name ?? ''),
      billing_address: String(input.billing_address ?? ''),
      contact_name: String(input.contact_name ?? ''),
      invoice_number: String(input.invoice_number ?? ''),
      invoice_date: String(input.invoice_date ?? ''),
      total_amount: typeof input.total_amount === 'number' ? input.total_amount : null,
    });
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unexpected error' });
  }
});
