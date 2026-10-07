// postbypost.app server code: one endpoint that confirms Pro license keys with Paddle.
// Everything else on the domain is the static website in site/.
//
// POST /api/verify  {"key": "txn_..."}  ->  {"pro": true | false}
//
// A license key is the Paddle transaction ID of a Pro purchase. "pro" is true
// when that transaction is paid/completed, includes the Pro price, and has no
// approved refund. Nothing is stored here: each check asks Paddle directly.
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
  'Access-Control-Allow-Origin': '*', // the extension calls this from its own origin
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const KEY_RE = /^txn_[a-z0-9]{20,40}$/;
const PAID = ['paid', 'completed']; // "paid" briefly precedes "completed" right after checkout

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
  const key = String(body?.key ?? '').trim().toLowerCase();
  if (!KEY_RE.test(key)) return json({ error: 'invalid_key' }, 400);
  if (!env.PADDLE_API_KEY || !env.PRO_PRICE_ID) return json({ error: 'not_configured' }, 503);

  try {
    return json({ pro: await isValidLicense(key, env) });
  } catch (err) {
    console.error('verify failed:', err.message);
    return json({ error: 'upstream_error' }, 502);
  }
}

export async function isValidLicense(key, env) {
  const base = PADDLE_API[env.PADDLE_ENV] ?? PADDLE_API.sandbox;
  const get = async (path) => {
    const res = await fetch(base + path, { headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Paddle ${path.split('?')[0]} returned ${res.status}`);
    return (await res.json()).data ?? null;
  };

  const txn = await get(`/transactions/${encodeURIComponent(key)}`);
  if (!txn || !PAID.includes(txn.status)) return false;
  if (!txn.items?.some((item) => item.price?.id === env.PRO_PRICE_ID)) return false;
  const refunds = await get(`/adjustments?transaction_id=${encodeURIComponent(key)}&action=refund&status=approved`);
  return !refunds?.length;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
