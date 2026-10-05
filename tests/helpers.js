// Shared test setup: load the unpacked extension into Chromium and serve a
// fake Reddit feed at reddit.com URLs, so the content script runs exactly as
// in production.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = fs.realpathSync(path.resolve(__dirname, '..'));
const FEED = fs.readFileSync(path.join(__dirname, 'fixtures', 'feed.html'), 'utf8');
const LINE = 56 + 8; // fixture header height + GAP in content.js

async function launch() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbp-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', // full Chromium; the headless shell can't load extensions
    ignoreDefaultArgs: ['--hide-scrollbars'], // real scrollbars, for the scrollbar tests
    viewport: { width: 1000, height: 800 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  await context.route('https://www.reddit.com/**', (route) => route.fulfill({ contentType: 'text/html', body: FEED }));
  return context;
}

// Chrome derives an unpacked extension's ID from its folder path:
// SHA-256 of the path, first 32 hex digits, with 0-f mapped to a-p.
function extensionId() {
  const hex = crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

async function open(context, urlPath = '/r/test/') {
  const page = await context.newPage();
  await page.goto(`https://www.reddit.com${urlPath}`);
  await page.waitForTimeout(300); // let the content script attach
  return page;
}

async function openPopup(context) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId()}/src/popup.html`);
  await page.waitForSelector('#plan');
  await page.waitForTimeout(200); // let it read storage
  return page;
}

// Wait until scrollY has held still for three checks in a row (smooth
// scrolling crawls through its last few pixels), then return it.
async function settled(page) {
  let last = -1;
  let still = 0;
  for (let i = 0; i < 50; i++) {
    const y = await page.evaluate(() => scrollY);
    still = y === last ? still + 1 : 0;
    if (still === 2) return y;
    last = y;
    await page.waitForTimeout(100);
  }
  return last;
}

async function topOf(page, id) {
  await settled(page);
  return page.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top), id);
}

module.exports = { LINE, launch, open, openPopup, settled, topOf };
