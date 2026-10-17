# Handoff notes (start here in a new chat)

Last updated: 17 Oct 2026. Read this first, then `README.md` for how the code
works. **Follow the owner's rules in `CLAUDE.md` before every instruction.**

## About the owner
- Novice. Numbered steps, short replies, **always a direct link**; when no
  link is possible, guide from the biggest thing on screen down to smaller
  ones. Always pick the easiest, maintenance-free solution (see `CLAUDE.md`).
- Windows 8.1, **Chrome 109** and **Firefox 115** (old; some dashboards break
  in Chrome 109, Firefox usually works). Mouse wheel is broken: use End,
  Home, Page Down. Cloudflare's "Secret" checkbox only works from the phone.
- Against Stripe and PayPal, hence **Paddle** (merchant of record).
- Public seller name: **Kramerica Industries** (site footer, Paddle,
  Chrome Web Store, Firefox Add-ons). Exception: Google's trader details
  (real name, address, phone) are shown to EU visitors; the owner accepted
  this. A registered business would be needed to replace them.

## Status: launched ✅ (nothing needs regular attention)
| | Where | State |
|---|---|---|
| Chrome Web Store | https://chromewebstore.google.com/detail/post-by-post-for-reddit/pkgplalclecancaongbdlljdoojgnhim | **Live**, v0.5.2, verified trader |
| Firefox Add-ons | https://addons.mozilla.org/firefox/addon/post-by-post/ | v0.5.2 **submitted 17 Oct**, awaiting review |
| Edge Add-ons | – | **Skipped**: Microsoft sign-up failed ("Not Authorized"); Edge users can install from the Chrome Web Store |
| Website | https://postbypost.app | Live; "Add to Chrome" + "Buy Pro" buttons |
| Payments | https://vendors.paddle.com | Live, $3.99 one-time |
| License check | `worker/index.mjs` + D1 | Runs on Paddle notifications; **no expiring key** |
| Support email | support@postbypost.app | Forwards to the owner's Gmail |

## How it fits together
- Extension **Post-by-Post for Reddit** (MV3), repo `gordo007/post-by-post`,
  branch `main`. Tests: `npm test` (56 passing). Build: `npm run build` →
  `dist/post-by-post-{chrome,firefox}-<version>.zip`. Store images and
  listing text: `store/` (`node scripts/store-images.js` remakes images).
- Website + server: Cloudflare Worker `post-by-post`, **auto-deployed from
  `main`** (settings in `wrangler.jsonc`; static site in `site/`).
- Buying: postbypost.app/buy → Paddle checkout → page shows the license key
  (`txn_…`) and hands it to the extension, which unlocks Pro.
- Licenses: Paddle sends every sale/refund to
  `https://postbypost.app/api/paddle-webhook` (notification destination
  "Post-by-Post licenses", 4 events). The Worker stores them in the D1
  database `post-by-post-licenses`; `/api/verify` answers from it. Signed with
  the Cloudflare Secret `PADDLE_WEBHOOK_SECRET`, which **never expires**.
- The old Paddle API key (Cloudflare Secret `PADDLE_API_KEY`, expires
  10 Jan 2027) is only a fallback now. **Let it expire; ignore Paddle's
  expiry emails.** Buyers who already unlocked Pro keep it even on errors.
- Support tool: https://postbypost.app/check checks a key by hand. Lost
  keys: Paddle → Transactions.

## Paddle IDs (none secret; secrets never go in the repo or chat)
| | Sandbox (testing only) | Live |
|---|---|---|
| Dashboard | https://sandbox-vendors.paddle.com | https://vendors.paddle.com |
| Price ID | `pri_01m4awmrgacaa31s1yqqqbrcd0` | `pri_01m4cc8gaek1hq4njx5237rd7n` |
| Product ID | `pro_01m4ap6z5dz89yhr2ystqssfxr` | `pro_01m4cc42znpx329hqhfpwavpfw` |
| Client-side token | `test_4509231d6c8e613994ca16ae20f` | `live_19bab355a6d9d79e2d7d5183c76` |

## Accounts (all under the owner's Gmail)
- Chrome Web Store dashboard: https://chrome.google.com/webstore/devconsole
- Firefox developer hub: https://addons.mozilla.org/developers/addons
  (two-step login with Google Authenticator; backup codes saved by owner)
- Cloudflare: https://dash.cloudflare.com (Worker, D1, domain, email)
- Paddle: https://vendors.paddle.com (the owner's password app once filled the
  sandbox password here and caused a lockout; check the saved entry)
- GitHub: https://github.com/gordo007/post-by-post

## What we did (12–17 Oct 2026)
1. Went live with Paddle; real purchase + refund tested.
2. Made store images and listing text; Chrome Web Store account ($5),
   trader verification; submitted and **approved in one day** (14 Oct).
3. Homepage buttons now link to the store and the buy page.
4. Fixed a bug where store users saw "Developer: unlock Pro" (free Pro);
   shipped as 0.5.2.
5. Submitted to Firefox Add-ons (17 Oct). Tried Edge; Microsoft refused.
6. Replaced the expiring-API-key license check with Paddle notifications +
   D1, so licensing runs with no upkeep.

## Optional loose ends (none urgent)
- When Mozilla approves Firefox: add a Firefox button to the homepage, and
  replace the Firefox listing's privacy sentence "Nothing is stored on our
  servers" with: "Our server keeps a list of Pro order numbers and whether
  each was paid or refunded, as reported by Paddle. No personal details."
- Owner's free Pro: Paddle → Catalog → Discounts → 100% code (usage limit 1),
  then buy at https://postbypost.app/buy for $0. This also proves the
  notification → D1 chain end to end (a row appears in the `licenses` table).
- Optional: disable PayPal in Paddle checkout settings.
- Cloudflare's PR preview check always shows red ("Build: Failed", 0 s); it's
  the preview setup, not the code. Production deploys from `main` work.
