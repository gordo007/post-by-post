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
