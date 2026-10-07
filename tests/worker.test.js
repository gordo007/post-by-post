// Unit tests for worker/index.mjs (the postbypost.app purchase check), with
// Paddle's API mocked. Run with: npm test
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const PRICE = 'pri_pro';
const ENV = {
  PADDLE_ENV: 'sandbox',
  PRO_PRICE_ID: PRICE,
  PADDLE_API_KEY: 'pdl_test_key',
  ASSETS: { fetch: async () => new Response('static page') },
};

let worker;
let paddle; // path -> data array the fake Paddle API returns
let calls;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  worker ??= (await import('../worker/index.mjs')).default;
  calls = [];
  paddle = {};
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization });
    const { pathname, search } = new URL(url);
    const key = pathname + search;
    if (paddle.fail) return new Response('{}', { status: 500 });
    return Response.json({ data: paddle[key] ?? [] });
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

function buyer({ price = PRICE, refunded = false } = {}) {
  paddle['/customers?email=buyer%40example.com'] = [{ id: 'ctm_1' }];
  paddle['/transactions?customer_id=ctm_1&status=completed&per_page=50'] = [
    { id: 'txn_1', items: [{ price: { id: price } }] },
  ];
  paddle['/adjustments?transaction_id=txn_1&action=refund&status=approved'] = refunded ? [{ id: 'adj_1' }] : [];
}

test('a completed purchase of Pro unlocks', async () => {
  buyer();
  const res = await verify({ email: '  Buyer@Example.com ' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { pro: true });
  assert.ok(calls.every((c) => c.url.startsWith('https://sandbox-api.paddle.com/')));
  assert.ok(calls.every((c) => c.auth === 'Bearer pdl_test_key'));
});

test('a refunded purchase does not unlock', async () => {
  buyer({ refunded: true });
  assert.deepEqual(await (await verify({ email: 'buyer@example.com' })).json(), { pro: false });
});

test('a purchase of some other price does not unlock', async () => {
  buyer({ price: 'pri_other' });
  assert.deepEqual(await (await verify({ email: 'buyer@example.com' })).json(), { pro: false });
});

test('an unknown email does not unlock', async () => {
  assert.deepEqual(await (await verify({ email: 'nobody@example.com' })).json(), { pro: false });
});

test('production mode calls the live Paddle API', async () => {
  buyer();
  await verify({ email: 'buyer@example.com' }, { ...ENV, PADDLE_ENV: 'production' });
  assert.ok(calls.every((c) => c.url.startsWith('https://api.paddle.com/')));
});

test('bad input is rejected without calling Paddle', async () => {
  assert.equal((await verify({ email: 'not-an-email' })).status, 400);
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
  assert.equal((await verify({ email: 'buyer@example.com' }, { ...ENV, PADDLE_API_KEY: '' })).status, 503);
  paddle.fail = true;
  assert.equal((await verify({ email: 'buyer@example.com' })).status, 502);
});

test('other paths are served from the static site', async () => {
  const res = await worker.fetch(new Request('https://postbypost.app/terms.html'), ENV);
  assert.equal(await res.text(), 'static page');
});
