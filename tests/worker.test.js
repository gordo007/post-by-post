// Unit tests for worker/index.mjs (the postbypost.app license check), with
// Paddle's API mocked. Run with: npm test
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const PRICE = 'pri_pro';
const KEY = 'txn_01h8xyzabcdefghijklmnopqrs';
const ENV = {
  PADDLE_ENV: 'sandbox',
  PRO_PRICE_ID: PRICE,
  PADDLE_API_KEY: 'pdl_test_key',
  ASSETS: { fetch: async () => new Response('static page') },
};

let worker;
let paddle; // path -> { status, data } the fake Paddle API returns
let calls;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  worker ??= (await import('../worker/index.mjs')).default;
  calls = [];
  paddle = {};
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization });
    const { pathname, search } = new URL(url);
    if (paddle.fail) return new Response('{}', { status: 500 });
    const hit = paddle[pathname + search];
    if (!hit) return new Response('{"error":{"code":"not_found"}}', { status: 404 });
    return Response.json({ data: hit });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function verify(body, env = ENV, method = 'POST') {
  const init = { method };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return worker.fetch(new Request('https://postbypost.app/api/verify', init), env);
}

function purchase({ status = 'completed', price = PRICE, refunded = false } = {}) {
  paddle[`/transactions/${KEY}`] = { id: KEY, status, items: [{ price: { id: price } }] };
  paddle[`/adjustments?transaction_id=${KEY}&action=refund&status=approved`] = refunded ? [{ id: 'adj_1' }] : [];
}

const pro = async (body, env) => (await (await verify(body, env)).json()).pro;

test('a completed Pro purchase unlocks', async () => {
  purchase();
  const res = await verify({ key: `  ${KEY.toUpperCase()} ` });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { pro: true });
  assert.ok(calls.every((c) => c.url.startsWith('https://sandbox-api.paddle.com/')));
  assert.ok(calls.every((c) => c.auth === 'Bearer pdl_test_key'));
});

test('a purchase that is paid but not yet completed unlocks', async () => {
  purchase({ status: 'paid' });
  assert.equal(await pro({ key: KEY }), true);
});

test('unpaid, refunded, or other-product transactions do not unlock', async () => {
  purchase({ status: 'ready' });
  assert.equal(await pro({ key: KEY }), false);
  purchase({ refunded: true });
  assert.equal(await pro({ key: KEY }), false);
  purchase({ price: 'pri_other' });
  assert.equal(await pro({ key: KEY }), false);
});

test('an unknown key does not unlock', async () => {
  assert.equal(await pro({ key: 'txn_01h8xyzabcdefghijklmnozzz' }), false);
});

test('production mode calls the live Paddle API', async () => {
  purchase();
  await verify({ key: KEY }, { ...ENV, PADDLE_ENV: 'production' });
  assert.ok(calls.length > 0 && calls.every((c) => c.url.startsWith('https://api.paddle.com/')));
});

test('malformed keys and requests are rejected without calling Paddle', async () => {
  for (const key of ['', 'hello', 'txn_short', 'txn_../../customers', 'buyer@example.com']) {
    assert.equal((await verify({ key })).status, 400, `key ${JSON.stringify(key)}`);
  }
  assert.equal((await verify('{oops')).status, 400);
  assert.equal((await verify(undefined, ENV, 'GET')).status, 405);
  assert.equal(calls.length, 0);
});

test('CORS preflight is allowed so the extension can call the API', async () => {
  const res = await verify(undefined, ENV, 'OPTIONS');
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('a missing API key or a Paddle outage returns an error, not "pro: false"', async () => {
  assert.equal((await verify({ key: KEY }, { ...ENV, PADDLE_API_KEY: '' })).status, 503);
  paddle.fail = true;
  assert.equal((await verify({ key: KEY })).status, 502);
});

test('other paths are served from the static site', async () => {
  const res = await worker.fetch(new Request('https://postbypost.app/terms.html'), ENV);
  assert.equal(await res.text(), 'static page');
});

// --- Paddle notifications + the license database --------------------------------

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const SECRET = 'pdl_ntfset_test_secret';

// A Cloudflare D1 stand-in backed by an in-memory SQLite database.
function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const bound = (args) => ({
        first: async () => stmt.get(...args) ?? null,
        run: async () => stmt.run(...args),
      });
      return { ...bound([]), bind: (...args) => bound(args) };
    },
  };
}

// The webhook-only setup: no Paddle API key at all.
const dbEnv = (extra = {}) => ({
  ...ENV,
  PADDLE_API_KEY: '',
  PADDLE_WEBHOOK_SECRET: SECRET,
  DB: fakeD1(),
  LICENSE_WAIT_MS: 0,
  ...extra,
});

function notify(env, event, { secret = SECRET, ts = Math.floor(Date.now() / 1000), signature } = {}) {
  const body = JSON.stringify(event);
  const h1 = signature ?? crypto.createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
  return worker.fetch(
    new Request('https://postbypost.app/api/paddle-webhook', {
      method: 'POST',
      headers: { 'Paddle-Signature': `ts=${ts};h1=${h1}` },
      body,
    }),
    env,
  );
}

const sale = (price = PRICE, type = 'transaction.completed') => ({
  event_type: type,
  data: { id: KEY, status: 'completed', items: [{ price: { id: price } }] },
});
const adjustment = (action, status = 'approved') => ({
  event_type: 'adjustment.updated',
  data: { id: 'adj_1', action, status, transaction_id: KEY },
});

test('a Pro sale reported by Paddle unlocks without any API key', async () => {
  const env = dbEnv();
  assert.equal((await notify(env, sale())).status, 200);
  assert.equal(await pro({ key: KEY }, env), true);
  assert.equal(calls.length, 0, 'Paddle API not called');
});

test('"transaction.paid" counts as a sale; other products do not unlock', async () => {
  const env = dbEnv();
  await notify(env, sale(PRICE, 'transaction.paid'));
  assert.equal(await pro({ key: KEY }, env), true);
  const other = dbEnv();
  await notify(other, sale('pri_other'));
  assert.equal(await pro({ key: KEY }, other), false);
});

test('approved refunds and chargebacks lock Pro again; pending ones do not', async () => {
  const env = dbEnv();
  await notify(env, sale());
  await notify(env, adjustment('refund', 'pending_approval'));
  assert.equal(await pro({ key: KEY }, env), true);
  await notify(env, adjustment('refund'));
  assert.equal(await pro({ key: KEY }, env), false);

  const charged = dbEnv();
  await notify(charged, sale());
  await notify(charged, adjustment('chargeback'));
  assert.equal(await pro({ key: KEY }, charged), false);
  await notify(charged, adjustment('chargeback_reverse'));
  assert.equal(await pro({ key: KEY }, charged), true);
});

test('a refund reported before the sale still wins', async () => {
  const env = dbEnv();
  await notify(env, adjustment('refund'));
  await notify(env, sale());
  assert.equal(await pro({ key: KEY }, env), false);
});

test('notifications with a bad, missing, or stale signature are rejected', async () => {
  const env = dbEnv();
  assert.equal((await notify(env, sale(), { secret: 'wrong' })).status, 401);
  assert.equal((await notify(env, sale(), { signature: '' })).status, 401);
  assert.equal((await notify(env, sale(), { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
  const unsigned = await worker.fetch(
    new Request('https://postbypost.app/api/paddle-webhook', { method: 'POST', body: JSON.stringify(sale()) }),
    env,
  );
  assert.equal(unsigned.status, 401);
  assert.equal(await pro({ key: KEY }, env), false, 'nothing was recorded');
});

test('the notification endpoint needs the database and secret configured', async () => {
  assert.equal((await notify({ ...dbEnv(), DB: undefined }, sale())).status, 503);
  assert.equal((await notify({ ...dbEnv(), PADDLE_WEBHOOK_SECRET: '' }, sale())).status, 503);
});

test('an unknown key does not unlock with the database alone', async () => {
  assert.equal(await pro({ key: KEY }, dbEnv()), false);
});

test('a key checked right after checkout waits for Paddle\'s notification', async () => {
  const env = dbEnv({ LICENSE_WAIT_MS: 5000 });
  const answer = pro({ key: KEY }, env);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await notify(env, sale());
  assert.equal(await answer, true);
});

test('while the API key works, purchases it confirms are remembered', async () => {
  const env = dbEnv({ PADDLE_API_KEY: 'pdl_test_key' });
  purchase();
  assert.equal(await pro({ key: KEY }, env), true);
  paddle = {}; // Paddle forgets / the key stops working
  paddle.fail = true;
  assert.equal(await pro({ key: KEY }, env), true, 'answered from the database');
});

test('an expired API key does not break checks once the database is set up', async () => {
  const env = dbEnv({ PADDLE_API_KEY: 'pdl_expired_key' });
  paddle.fail = true; // every API call errors, like an expired key
  await notify(env, sale());
  assert.equal((await verify({ key: KEY }, env)).status, 200);
  assert.equal(await pro({ key: KEY }, env), true);
  assert.equal(await pro({ key: 'txn_01h8xyzabcdefghijklmnozzz' }, env), false, 'unknown keys get "no", not an error');
});
