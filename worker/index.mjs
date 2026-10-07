// postbypost.app server code: one endpoint that confirms Pro purchases with Paddle.
// Everything else on the domain is the static website in site/.
//
// POST /api/verify  {"email": "..."}  ->  {"pro": true | false}
//
// "pro" is true when that email has a completed Paddle purchase of the Pro
// price that hasn't been refunded. Nothing is stored here: each check asks
// Paddle directly.
//
// Configuration (wrangler.jsonc "vars", plus one secret set in the dashboard):
//   PADDLE_ENV      "sandbox" or "production"
//   PRO_PRICE_ID    the Paddle price ID of Post-by-Post Pro
//   PADDLE_API_KEY  secret, read-only Paddle API key

const PADDLE_API = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
};

const CORS = {
  'Access-Control-Allow-Origin': '*', // the extension popup calls this from its own origin
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/verify') return handleVerify(request, env);
    return env.ASSETS.fetch(request);
  },
};

async function handleVerify(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400);
  if (!env.PADDLE_API_KEY || !env.PRO_PRICE_ID) return json({ error: 'not_configured' }, 503);

  try {
    return json({ pro: await hasPurchasedPro(email, env) });
  } catch (err) {
    console.error('verify failed:', err.message);
    return json({ error: 'upstream_error' }, 502);
  }
}

// True if any Paddle customer with this email completed a purchase of the Pro
// price that has no approved refund.
export async function hasPurchasedPro(email, env) {
  const base = PADDLE_API[env.PADDLE_ENV] ?? PADDLE_API.sandbox;
  const get = async (path) => {
    const res = await fetch(base + path, { headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}` } });
    if (!res.ok) throw new Error(`Paddle ${path.split('?')[0]} returned ${res.status}`);
    return (await res.json()).data ?? [];
  };

  const customers = await get(`/customers?email=${encodeURIComponent(email)}`);
  for (const customer of customers) {
    const transactions = await get(
      `/transactions?customer_id=${encodeURIComponent(customer.id)}&status=completed&per_page=50`,
    );
    for (const txn of transactions) {
      if (!txn.items?.some((item) => item.price?.id === env.PRO_PRICE_ID)) continue;
      const refunds = await get(
        `/adjustments?transaction_id=${encodeURIComponent(txn.id)}&action=refund&status=approved`,
      );
      if (refunds.length === 0) return true;
    }
  }
  return false;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
