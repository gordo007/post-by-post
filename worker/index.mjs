// postbypost.app server code: confirms Pro license keys, and records Pro sales
// and refunds as Paddle reports them. Everything else on the domain is the
// static website in site/.
//
// POST /api/verify          {"key": "txn_..."}  ->  {"pro": true | false}
// POST /api/paddle-webhook  Paddle notifications (sales and refunds)
//
// A license key is the Paddle transaction ID of a Pro purchase. "pro" is true
// when that transaction is paid, includes the Pro price, and has no approved
// refund or chargeback.
//
// Paddle sends every sale and refund to /api/paddle-webhook, signed with a
// secret that never expires, and they are kept in a D1 database. /api/verify
// answers from that database, so no expiring Paddle API key is needed. While
// PADDLE_API_KEY is still set and valid, keys the database hasn't seen are
// also looked up in Paddle's API (and remembered); once it expires, that
// fallback simply stops being used.
//
// Configuration (wrangler.jsonc, plus secrets set in the Cloudflare dashboard):
//   PADDLE_ENV             "sandbox" or "production"
//   PRO_PRICE_ID           the Paddle price ID of Post-by-Post Pro
//   DB                     D1 database binding (license records)
//   PADDLE_WEBHOOK_SECRET  secret, the Paddle notification destination's secret key
//   PADDLE_API_KEY         optional secret, read-only Paddle API key (fallback)

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
const REVOKING = ['refund', 'chargeback']; // approved adjustments that take Pro away
const SIGNATURE_MAX_AGE_S = 300; // reject replayed notifications older than this

// Right after checkout the buy page may ask before Paddle's notification has
// arrived, so an unknown key is re-checked for a little while before "no".
const WAIT_MS = 15000;
const WAIT_STEP_MS = 1500;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/verify') return handleVerify(request, env);
    if (pathname === '/api/paddle-webhook') return handleWebhook(request, env);
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
  if (!env.PRO_PRICE_ID || (!env.DB && !env.PADDLE_API_KEY)) return json({ error: 'not_configured' }, 503);

  try {
    return json({ pro: await isValidLicense(key, env) });
  } catch (err) {
    console.error('verify failed:', err.message);
    return json({ error: 'upstream_error' }, 502);
  }
}

export async function isValidLicense(key, env) {
  const known = await getRecord(env, key);
  if (known) return isPro(known);

  if (env.PADDLE_API_KEY) {
    try {
      const record = await askPaddle(key, env);
      if (record?.paid) await putRecord(env, key, record); // unpaid ones may still complete
      return record ? isPro(record) : false;
    } catch (err) {
      if (!env.DB) throw err; // no database to fall back on
      console.error('Paddle API fallback failed:', err.message); // e.g. the key expired
    }
  }

  // Not seen yet: give Paddle's notification a moment to arrive.
  const waitMs = env.LICENSE_WAIT_MS ?? WAIT_MS;
  for (let waited = 0; waited < waitMs; waited += WAIT_STEP_MS) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(WAIT_STEP_MS, waitMs - waited)));
    const record = await getRecord(env, key);
    if (record) return isPro(record);
  }
  return false;
}

const isPro = (record) => record.paid === 1 && record.revoked === 0;

// Look a transaction up in Paddle's API. Returns a record, or null if Paddle
// has no such transaction.
async function askPaddle(key, env) {
  const base = PADDLE_API[env.PADDLE_ENV] ?? PADDLE_API.sandbox;
  const get = async (path) => {
    const res = await fetch(base + path, { headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Paddle ${path.split('?')[0]} returned ${res.status}`);
    return (await res.json()).data ?? null;
  };

  const txn = await get(`/transactions/${encodeURIComponent(key)}`);
  if (!txn) return null;
  const paid = PAID.includes(txn.status) && hasProPrice(txn, env);
  if (!paid) return { paid: 0, revoked: 0 };
  const refunds = await get(`/adjustments?transaction_id=${encodeURIComponent(key)}&action=refund&status=approved`);
  return { paid: 1, revoked: refunds?.length ? 1 : 0 };
}

const hasProPrice = (txn, env) => Boolean(txn.items?.some((item) => item.price?.id === env.PRO_PRICE_ID));

// --- Paddle notifications ------------------------------------------------------

async function handleWebhook(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!env.DB || !env.PADDLE_WEBHOOK_SECRET) return json({ error: 'not_configured' }, 503);

  const raw = await request.text();
  if (!(await signatureIsValid(request.headers.get('Paddle-Signature'), raw, env.PADDLE_WEBHOOK_SECRET))) {
    return json({ error: 'bad_signature' }, 401);
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const data = event?.data ?? {};

  if (event?.event_type === 'transaction.paid' || event?.event_type === 'transaction.completed') {
    if (typeof data.id === 'string' && hasProPrice(data, env)) await markPaid(env, data.id.toLowerCase());
  } else if (event?.event_type === 'adjustment.created' || event?.event_type === 'adjustment.updated') {
    if (typeof data.transaction_id === 'string' && data.status === 'approved') {
      const txn = data.transaction_id.toLowerCase();
      if (REVOKING.includes(data.action)) await setRevoked(env, txn, 1);
      if (data.action === 'chargeback_reverse') await setRevoked(env, txn, 0);
    }
  }
  return json({ ok: true }); // other event types are acknowledged and ignored
}

// Paddle-Signature: "ts=1671552777;h1=<hex HMAC-SHA256 of `${ts}:${body}`>"
async function signatureIsValid(header, raw, secret) {
  const parts = String(header ?? '').split(';').map((p) => p.split('='));
  const ts = parts.find(([k]) => k === 'ts')?.[1];
  const signatures = parts.filter(([k]) => k === 'h1').map(([, v]) => v);
  if (!ts || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > SIGNATURE_MAX_AGE_S) return false;

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${raw}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return signatures.some((sig) => sameString(sig, expected));
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- License records (D1) ------------------------------------------------------

const ready = new WeakSet(); // databases whose table has been created
async function db(env) {
  if (!ready.has(env.DB)) {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS licenses (txn TEXT PRIMARY KEY, paid INTEGER NOT NULL, revoked INTEGER NOT NULL, updated_at TEXT NOT NULL)',
    ).run();
    ready.add(env.DB);
  }
  return env.DB;
}

async function getRecord(env, txn) {
  if (!env.DB) return null;
  return (await db(env)).prepare('SELECT paid, revoked FROM licenses WHERE txn = ?').bind(txn).first();
}

async function putRecord(env, txn, { paid, revoked }) {
  if (!env.DB) return;
  await (await db(env))
    .prepare('INSERT OR REPLACE INTO licenses (txn, paid, revoked, updated_at) VALUES (?, ?, ?, ?)')
    .bind(txn, paid, revoked, new Date().toISOString())
    .run();
}

async function markPaid(env, txn) {
  await (await db(env))
    .prepare(
      'INSERT INTO licenses (txn, paid, revoked, updated_at) VALUES (?, 1, 0, ?) ' +
        'ON CONFLICT(txn) DO UPDATE SET paid = 1, updated_at = excluded.updated_at',
    )
    .bind(txn, new Date().toISOString())
    .run();
}

async function setRevoked(env, txn, revoked) {
  await (await db(env))
    .prepare(
      'INSERT INTO licenses (txn, paid, revoked, updated_at) VALUES (?, 0, ?, ?) ' +
        'ON CONFLICT(txn) DO UPDATE SET revoked = excluded.revoked, updated_at = excluded.updated_at',
    )
    .bind(txn, revoked, new Date().toISOString())
    .run();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
