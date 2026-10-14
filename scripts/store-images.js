// Makes the store images into store/images/:
//   screenshot-1-snap.png   1280x800  how snapping works (illustration)
//   screenshot-2-menu.png   1280x800  the real Pro menu
//   promo-small.png          440x280  small promo tile
// Usage: node scripts/store-images.js (needs Playwright's Chromium).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = fs.realpathSync(path.resolve(__dirname, '..'));
const OUT = path.join(ROOT, 'store', 'images');
const ICON = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'icons', 'icon128.png')).toString('base64');
const ACCENT = '#ff4500';

// Same derivation as tests/helpers.js: unpacked extension ID from its path.
function extensionId() {
  const hex = crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: #1a1a1b; }
  .frame { display: flex; align-items: center; gap: 64px; padding: 0 88px; background: linear-gradient(135deg, #fff4ef, #ffe2d6); }
  .copy { flex: 1; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 22px; margin-bottom: 28px; }
  .brand img { width: 44px; height: 44px; }
  h1 { font-size: 52px; line-height: 1.1; margin: 0 0 20px; letter-spacing: -0.5px; }
  h1 em { font-style: normal; color: ${ACCENT}; }
  p { font-size: 22px; line-height: 1.45; color: #4a4d50; margin: 0 0 12px; }
  kbd { font: 600 18px "Segoe UI", system-ui, sans-serif; background: #fff; border: 1px solid #d6d8da; border-bottom-width: 3px; border-radius: 6px; padding: 1px 9px; }
`;

function page(width, height, css, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .frame { width: ${width}px; height: ${height}px; } ${css}</style></head><body>${body}</body></html>`;
}

// A neutral browser window with a feed, the top post snapped under the header.
function snapShot() {
  const card = (h, lines, img) => `
    <div class="card" style="height:${h}px">
      <div class="meta"><span class="dot"></span><span class="bar" style="width:120px"></span></div>
      ${lines.map((w) => `<span class="bar title" style="width:${w}%"></span>`).join('')}
      ${img ? `<div class="img" style="height:${img}px"></div>` : ''}
      <div class="actions"><span class="pill"></span><span class="pill"></span><span class="pill"></span></div>
    </div>`;
  const css = `
    .win { width: 560px; height: 640px; background: #fff; border-radius: 12px; overflow: hidden; position: relative;
           box-shadow: 0 24px 60px rgba(120, 40, 0, .18), 0 2px 6px rgba(0,0,0,.08); }
    .chrome { height: 36px; background: #eceef0; display: flex; align-items: center; gap: 7px; padding: 0 14px; }
    .chrome i { width: 11px; height: 11px; border-radius: 50%; background: #c8cacc; }
    .site { height: 52px; border-bottom: 1px solid #e6e8ea; display: flex; align-items: center; padding: 0 18px; gap: 12px; }
    .site .logo { width: 30px; height: 30px; border-radius: 50%; background: #d9dbdd; }
    .site .search { flex: 1; height: 30px; border-radius: 15px; background: #f1f3f5; }
    .feed { padding: 8px 40px; background: #fff; }
    .card { border: 1px solid #e6e8ea; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; overflow: hidden; }
    .card.snapped { outline: 3px solid ${ACCENT}; outline-offset: -1px; }
    .meta { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .dot { width: 22px; height: 22px; border-radius: 50%; background: #ffd2bf; }
    .bar { display: block; height: 10px; border-radius: 5px; background: #e3e5e7; }
    .bar.title { height: 14px; background: #c9ccd0; margin-bottom: 8px; }
    .img { border-radius: 10px; background: linear-gradient(135deg, #ffd9c7, #ffb999); margin: 10px 0; }
    .actions { display: flex; gap: 8px; margin-top: 10px; }
    .pill { width: 64px; height: 24px; border-radius: 12px; background: #f1f3f5; }
    .tag { position: absolute; right: 18px; top: 96px; background: ${ACCENT}; color: #fff; font-weight: 600;
           font-size: 15px; padding: 5px 12px; border-radius: 999px; }
  `;
  const body = `<div class="frame">
    <div class="copy">
      <div class="brand"><img src="${ICON}">Post-by-Post for Reddit</div>
      <h1>One scroll.<br><em>One post.</em></h1>
      <p>Every flick of the wheel lands the next post exactly at the top of the screen.</p>
      <p>No more stopping between two half-visible posts.</p>
      <p style="margin-top:22px"><kbd>J</kbd> <kbd>↓</kbd> next &nbsp; <kbd>K</kbd> <kbd>↑</kbd> previous</p>
    </div>
    <div class="win">
      <div class="chrome"><i></i><i></i><i></i></div>
      <div class="site"><span class="logo"></span><span class="search"></span></div>
      <div class="feed">
        <div class="snapped card" style="height:470px; border-color:transparent">
          <div class="meta"><span class="dot"></span><span class="bar" style="width:120px"></span></div>
          <span class="bar title" style="width:85%"></span><span class="bar title" style="width:55%"></span>
          <div class="img" style="height:310px"></div>
          <div class="actions"><span class="pill"></span><span class="pill"></span><span class="pill"></span></div>
        </div>
        ${card(200, [70, 40], 0)}
      </div>
      <span class="tag">Lined up perfectly</span>
    </div>
  </div>`;
  return page(1280, 800, css, body);
}

function menuShot(popupPng) {
  const css = `
    .pop { width: 600px; border-radius: 14px; box-shadow: 0 24px 60px rgba(120, 40, 0, .18), 0 2px 6px rgba(0,0,0,.08); }
    ul { list-style: none; padding: 0; margin: 8px 0 0; }
    li { font-size: 21px; line-height: 1.45; color: #4a4d50; margin-bottom: 14px; padding-left: 30px; position: relative; }
    li::before { content: "✓"; position: absolute; left: 0; color: ${ACCENT}; font-weight: 700; }
    li b { color: #1a1a1b; }
  `;
  const body = `<div class="frame">
    <div class="copy">
      <div class="brand"><img src="${ICON}">Post-by-Post Pro</div>
      <h1>Make it <em>yours</em></h1>
      <ul>
        <li><b>Auto-scroll:</b> hands-free, one post every 3–120 seconds. Space pauses it.</li>
        <li><b>Custom hotkeys:</b> pick your own keys for next and previous.</li>
        <li><b>On/off switch:</b> pause snapping without uninstalling.</li>
      </ul>
      <p style="margin-top:18px"><b style="color:#1a1a1b">$3.99 once.</b> No subscription.</p>
    </div>
    <img class="pop" src="data:image/png;base64,${popupPng.toString('base64')}">
  </div>`;
  return page(1280, 800, css, body);
}

function promoTile() {
  const css = `
    .frame { flex-direction: column; justify-content: center; gap: 0; padding: 0 32px; text-align: center; }
    img { width: 84px; height: 84px; margin-bottom: 14px; }
    h1 { font-size: 34px; margin: 0 0 8px; }
    p { font-size: 17px; margin: 0; }
  `;
  const body = `<div class="frame">
    <img src="${ICON}">
    <h1>One scroll. <em>One post.</em></h1>
    <p>Post-by-Post for Reddit</p>
  </div>`;
  return page(440, 280, css, body);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbp-img-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', // full Chromium; the headless shell can't load extensions
    colorScheme: 'light',
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });

  // The real popup, with Pro unlocked and auto-scroll on.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId()}/src/popup.html`);
  await popup.evaluate(
    () =>
      new Promise((resolve) =>
        chrome.storage.sync.set(
          { license: { key: 'txn_example', checkedAt: Date.now() }, autoScroll: true, autoScrollSeconds: 8 },
          resolve,
        ),
      ),
  );
  await popup.reload();
  await popup.waitForTimeout(300);
  await popup.addStyleTag({ content: '#devRow { display: none !important; }' });
  const popupPng = await popup.locator('body').screenshot();

  const shots = [
    ['screenshot-1-snap.png', snapShot(), 1280, 800],
    ['screenshot-2-menu.png', menuShot(popupPng), 1280, 800],
    ['promo-small.png', promoTile(), 440, 280],
  ];
  // Render at 1x: the store wants these exact pixel sizes.
  const browser = await chromium.launch();
  for (const [name, html, width, height] of shots) {
    const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await p.setContent(html);
    await p.screenshot({ path: path.join(OUT, name) });
    console.log(`made store/images/${name}`);
  }
  await browser.close();
  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
