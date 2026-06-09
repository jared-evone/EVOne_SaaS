// Supabase Edge Function: analyze-invoice
// Reads an invoice PDF with Claude and returns the billed company, billing month,
// invoice number and total. The Anthropic API key lives here as a server secret
// (ANTHROPIC_API_KEY) and never reaches the browser bundle.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy analyze-invoice
//
// The browser calls this via supabase.functions.invoke('analyze-invoice', { body }).

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

    const { base64Pdf, companyNames } = await req.json().catch(() => ({}));
    if (!base64Pdf || typeof base64Pdf !== 'string') {
      return json({ error: 'Missing base64Pdf in request body.' });
    }

    const list = (Array.isArray(companyNames) ? companyNames : [])
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
          description: 'Record the fields extracted from this invoice PDF.',
          input_schema: {
            type: 'object',
            properties: {
              company_name: {
                type: 'string',
                description: 'The customer/company this invoice is billed TO. Copy the single closest name VERBATIM from the provided company list. Empty string if none plausibly match.',
              },
              billing_month: {
                type: 'string',
                description: 'The billing period month in YYYY-MM format, e.g. "2026-05". Use the invoice/statement period, not the print date. Empty string if not determinable.',
              },
              invoice_number: {
                type: 'string',
                description: 'The invoice number / reference exactly as printed, e.g. "INV-2605001". Empty string if none.',
              },
              total_amount: {
                type: 'number',
                description: 'The total amount payable, as a plain number (no currency symbol or commas). Omit if not present.',
              },
            },
            required: ['company_name', 'billing_month', 'invoice_number'],
          },
        }],
        tool_choice: { type: 'tool', name: 'record_invoice' },
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
            { type: 'text', text: `Read this invoice and call record_invoice with the extracted fields.\n\nKnown companies — for company_name, copy the closest match VERBATIM from this list (whoever the invoice is billed to):\n${list}` },
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
      billing_month: String(input.billing_month ?? ''),
      invoice_number: String(input.invoice_number ?? ''),
      total_amount: typeof input.total_amount === 'number' ? input.total_amount : null,
    });
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unexpected error' });
  }
});
