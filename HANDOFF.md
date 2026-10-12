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
- Email **support@postbypost.app** forwards to the owner's Gmail
  (Cloudflare Email Routing). Working.
- Pro costs **$3.99 one-time**. License key = the Paddle transaction ID (`txn_…`).

## Paddle IDs (none of these are secret)
| | Sandbox (live on the site now) | Live (prepared, not deployed) |
|---|---|---|
| Dashboard | https://sandbox-vendors.paddle.com | https://vendors.paddle.com |
| Price ID | `pri_01m4awmrgacaa31s1yqqqbrcd0` | `pri_01m4cc8gaek1hq4njx5237rd7n` |
| Product ID | `pro_01m4ap6z5dz89yhr2ystqssfxr` | `pro_01m4cc42znpx329hqhfpwavpfw` |
| Client-side token | `test_4509231d6c8e613994ca16ae20f` | `live_19bab355a6d9d79e2d7d5183c76` |

- API keys are **secret** and never go in the repo or in chat. The Sandbox
  API key is stored in Cloudflare as the variable `PADDLE_API_KEY` (plain
  variable, because the Secret checkbox wouldn't tick in Firefox; acceptable
  for a read-only Sandbox key). It expires ~Jan 2027.
- `keep_vars: true` in `wrangler.jsonc` stops deploys wiping that variable.

## Status
- Sandbox purchase tested end to end in Firefox: checkout → key shown →
  Pro unlocked in the extension. ✅
- Paddle Live: product and price created ✅, client-side token created ✅,
  account verification **Complete** ✅, website approval for postbypost.app
  **In review** ⏳ (check https://vendors.paddle.com/settings/website-approval).
- Default payment link `https://postbypost.app/buy` in Live Checkout settings
  could not be saved until the domain is approved.

## Next steps, in order
1. When the domain is approved: save the Default payment link at
   https://vendors.paddle.com/checkout-settings.
2. Merge branch **`go-live`** into `main` (it switches `wrangler.jsonc` to
   `PADDLE_ENV: production` + live price, and `site/buy.html` to the live
   environment, token and price). Cloudflare deploys it automatically.
3. Owner creates a **live API key** in Paddle (Developer tools →
   Authentication → API keys; read permission on transactions and
   adjustments is enough), and replaces `PADDLE_API_KEY` in the Cloudflare
   Worker settings, **as a Secret if at all possible, with no screenshots of
   the key**. Then delete the Sandbox value.
4. Owner makes one real $3.99 purchase, checks Pro unlocks, then refunds it
   in Paddle and checks the weekly re-check would lock it (optional).
5. Optional: disable PayPal under Checkout settings → Payment methods.
6. Store launch: screenshots, Chrome Web Store developer account ($5),
   listing text in `store/listing.md`, privacy in `PRIVACY.md`; then Firefox
   Add-ons and Edge. Change the homepage button from "Coming soon" to the
   store link, and link a Buy button.
