# Handoff notes (start here in a new chat)

Last updated: 12 Oct 2026. Read this first, then `README.md` for how the code works.

## About the owner
- A novice. Wants **numbered, step-by-step instructions with exact links** and
  what to click. Prefers short replies.
- Windows 8.1, **Chrome 109** and **Firefox 115** (old: some modern dashboards
  break in Chrome 109; Firefox usually works). Mouse wheel is broken.
- Against Stripe and PayPal, hence **Paddle** (merchant of record).
- Wants their personal name hidden: the public seller name is
  **Kramerica Industries** (site footer, Paddle trading name).

## What exists
- Extension **Post-by-Post for Reddit** (MV3), version **0.5.1**, repo
  `gordo007/post-by-post`, branch `main`. Tests: `npm test` (46 passing).
  Builds: `npm run build` → `dist/post-by-post-{chrome,firefox}-<version>.zip`
  (Firefox build sets `strict_min_version` 115).
- Website **https://postbypost.app** (domain at Cloudflare Registrar), served
  by the Cloudflare Worker `post-by-post`, auto-deployed from `main`
  (`npx wrangler deploy`, no build command; settings in `wrangler.jsonc`).
  `/api/verify` checks license keys with Paddle (`worker/index.mjs`).
  Unlinked page https://postbypost.app/check checks a key by hand (support).
- Email **support@postbypost.app** forwards to the owner's Gmail
  (Cloudflare Email Routing). Working.
- Pro costs **$3.99 one-time**. License key = the Paddle transaction ID (`txn_…`).

## Paddle IDs (none of these are secret)
| | Sandbox (old, for testing) | Live (on the site since 12 Oct 2026) |
|---|---|---|
| Dashboard | https://sandbox-vendors.paddle.com | https://vendors.paddle.com |
| Price ID | `pri_01m4awmrgacaa31s1yqqqbrcd0` | `pri_01m4cc8gaek1hq4njx5237rd7n` |
| Product ID | `pro_01m4ap6z5dz89yhr2ystqssfxr` | `pro_01m4cc42znpx329hqhfpwavpfw` |
| Client-side token | `test_4509231d6c8e613994ca16ae20f` | `live_19bab355a6d9d79e2d7d5183c76` |

- API keys are **secret** and never go in the repo or in chat. The **live**
  API key is stored in Cloudflare as the Secret `PADDLE_API_KEY` (Workers &
  Pages → post-by-post → Settings → Variables and secrets). Paddle API keys
  expire: check its expiry date in Paddle → Developer tools → Authentication
  and replace it before then, or license checks start failing.
- `keep_vars: true` in `wrangler.jsonc` stops deploys wiping that variable.

## Status
- Sandbox purchase tested end to end in Firefox: checkout → key shown →
  Pro unlocked in the extension. ✅
- Paddle Live: product and price created ✅, client-side token created ✅,
  account verification **Complete** ✅, website approval **Approved** ✅,
  default payment link saved ✅, live API key stored in Cloudflare as a
  **Secret** `PADDLE_API_KEY` ✅ (set from the owner's phone: desktop browsers
  couldn't tick Cloudflare's Secret option), `go-live` merged into `main` ✅.
- PayPal stays enabled at checkout (owner is fine with it: Paddle owns that
  PayPal account; payouts to the owner are by bank transfer).

## Next steps, in order
1. (Done: domain approved, payment link saved, go-live merged, live key set.)
2. (Done 12 Oct: real $3.99 live purchase `txn_01m4pvwyg312tpa8p0z2fmdb3b`
   went through, then was fully refunded; https://postbypost.app/check now
   reports it "Not valid", so the live API key and refund check work.)
3. Optional: disable PayPal under Checkout settings → Payment methods.
4. Store launch. **Chrome Web Store: LIVE since 14 Oct 2026** (approved in
   one day), version 0.5.1, item ID `pkgplalclecancaongbdlljdoojgnhim`:
   https://chromewebstore.google.com/detail/post-by-post-for-reddit/pkgplalclecancaongbdlljdoojgnhim
   Publisher "Kramerica Industries", trader account; Google's trader
   verification is still pending (owner lacks a proof-of-address document;
   listing shows "non-trader" until verified). Dashboard:
   https://chrome.google.com/webstore/devconsole (works in Firefox 115).
   Listing text and form answers: `store/listing.md`; images: `store/images/`
   (`node scripts/store-images.js` remakes them). Homepage buttons now link
   to the store and to buy.html.
5. Next: Firefox Add-ons (`dist/post-by-post-firefox-<version>.zip`), then
   Edge Add-ons. Change the homepage button from "Coming soon" to the
   store link, and link a Buy button.
