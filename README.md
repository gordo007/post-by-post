# Post-by-Post for Reddit

A browser extension that scrolls Reddit one post at a time. Each scroll of the
wheel or trackpad, and each press of a navigation key, lands the next post
exactly at the top of the screen, just below Reddit's header. You never end up
between two half-visible posts.

## Features (v0.1, Step 1)

- **Snap-scrolling:** one wheel or trackpad flick moves exactly one post.
  Trackpad momentum is absorbed, so you don't skip several posts at once.
- **Header offset:** posts line up just below Reddit's sticky top bar.
- **Keyboard:** `J` / `↓` for the next post, `K` / `↑` for the previous one.
  `Space` / `Page Down` and `Shift+Space` / `Page Up` also move a post at a
  time (inside a very long post they page through it first). Quick repeated
  presses step through posts one after another. Space still presses a
  focused button.
- **Precise landing:** if an image loads mid-scroll and shifts the layout,
  the post is nudged exactly into place when the scroll ends.
- **Scrollbar:** click the scrollbar track or drag its thumb, and when you
  let go the page settles on the nearest post. The ▲/▼ arrow buttons and
  small nudges (under a quarter of the screen) are left alone, so you can
  fine-tune, e.g. to see a post's votes and comments.
- **Tall posts:** if a post is taller than the screen, the wheel scrolls
  normally until you reach its end, then snaps to the next post.
- **Leaves other scrolling alone:** typing in comment or search boxes,
  scrolling inside menus and modals, zooming with ctrl+wheel, and scrolling
  sideways all behave as usual.
- **Infinite scroll:** past the last loaded post, the wheel scrolls normally
  so Reddit can load more.
- **Active on** Home, Popular/All, subreddit feeds (with any sort), and
  Search. It stays off on post detail pages and everywhere else.

## Pro features (v0.3, in testing)

Click the Post-by-Post icon in the browser toolbar to open the menu.

- **On/off switch:** pause snapping without uninstalling.
- **Auto-scroll:** move to the next post every 3–120 seconds. Any wheel,
  key or click restarts the countdown, and it waits while you type or the
  tab is in the background. While it's on, **Space pauses and resumes it**
  (a YouTube-style pause icon flashes and a label stays while paused); with it off, Space moves one post as usual.
- **Custom hotkeys:** click a key button, then press the key you want (Esc
  cancels). Each direction has two slots. Space, Page Up/Down, Tab, Enter
  and similar keys can't be assigned, as they already have jobs.

On the free plan these controls are locked and the defaults apply.
**Payments aren't connected yet.** The Pro check lives in one function,
`isPro()` in `src/settings.js`, where a payment method's license check will
go. Until then, unpacked (developer) installs show a **Developer: unlock
Pro** switch at the bottom of the menu for testing. Store installs never
see it.

## Install for testing

**Chrome / Edge / Brave**
1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

**Firefox** (121 or later)
1. Run `npm run build` (Firefox needs an add-on ID that only the Firefox
   build adds; the root `manifest.json` stays Chrome-clean).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and select `dist/firefox/manifest.json`.

Then open reddit.com and scroll.

## Development

```bash
npm install
npm test        # loads the extension into Chromium against a fake Reddit feed
npm run build   # builds Chrome and Firefox store zips into dist/
```

The code that finds Reddit's posts and header is at the top of
`src/content.js` (`POST_SELECTOR`, `HEADER_SELECTOR`). If Reddit changes its
markup and snapping stops working, update those selectors.

## Roadmap

- Connect a payment method to `isPro()` (Stripe and PayPal excluded).
