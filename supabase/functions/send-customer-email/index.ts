// Supabase Edge Function: send-customer-email
// Sends a single notification email through Resend, from a verified-domain sender.
// The sender (from) and reply-to can be supplied per-request from the app, falling
// back to the RESEND_FROM / RESEND_REPLY_TO secrets if set.
// Secrets:  RESEND_API_KEY (required), RESEND_FROM (optional), RESEND_REPLY_TO (optional)
// The "from" domain must be verified in Resend (DNS records added at Vodien).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json({ error: 'RESEND_API_KEY is not configured on the server.' });

    const { to, cc, subject, html, from: fromBody, replyTo } = await req.json().catch(() => ({}));

    const from = (typeof fromBody === 'string' && fromBody.trim()) ? fromBody.trim() : Deno.env.get('RESEND_FROM');
    if (!from) return json({ error: 'No sender (from) address provided.' });

    const toList = (Array.isArray(to) ? to : [to]).filter((e: unknown) => typeof e === 'string' && e.trim());
    if (toList.length === 0) return json({ error: 'No recipient (to) provided.' });
    if (!subject || !html) return json({ error: 'Missing subject or html body.' });

    const ccList = (Array.isArray(cc) ? cc : []).filter((e: unknown) => typeof e === 'string' && e.trim());

    const payload: Record<string, unknown> = { from, to: toList, subject, html };
    if (ccList.length > 0) payload.cc = ccList;
    const reply = (typeof replyTo === 'string' && replyTo.trim()) ? replyTo.trim() : Deno.env.get('RESEND_REPLY_TO');
    if (reply) payload.reply_to = reply;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: `Resend ${res.status}: ${(data?.message ?? JSON.stringify(data)).slice?.(0, 300) ?? 'send failed'}` });
    }
    return json({ id: data?.id ?? null });
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unexpected error' });
  }
});
