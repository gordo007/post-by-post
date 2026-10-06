// End-to-end tests for the popup and Pro features. Run with: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LINE, launch, open: openIn, openPopup, settled, topOf } = require('./helpers');

let context;
test.before(async () => {
  context = await launch();
});
test.after(() => context?.close());

const open = (urlPath) => openIn(context, urlPath);

// Fresh popup with all settings back to defaults (free plan).
async function freshPopup() {
  const popup = await openPopup(context);
  await popup.evaluate(() => new Promise((r) => chrome.storage.sync.clear(r)));
  await popup.reload();
  await popup.waitForTimeout(200);
  return popup;
}

async function unlockPro(popup) {
  await popup.check('#devPro');
  await popup.waitForSelector('body.pro');
}

async function setKey(popup, dir, slot, key) {
  await popup.click(`.key[data-dir="${dir}"][data-slot="${slot}"]`);
  await popup.keyboard.press(key);
  await popup.waitForTimeout(150);
}

test('free plan: Pro controls are locked and show the defaults', async () => {
  const popup = await freshPopup();
  assert.equal(await popup.textContent('#plan'), 'Free');
  for (const sel of ['#enabled', '#autoScroll', '#seconds', '#resetKeys', '.key']) {
    assert.equal(await popup.locator(sel).first().isDisabled(), true, `${sel} should be locked`);
  }
  assert.deepEqual(await popup.locator('.key').allTextContents(), ['J', '↓', 'K', '↑']);
  assert.equal(await popup.isVisible('#upsell'), true);
  assert.equal(await popup.isVisible('#devRow'), true, 'developer unlock shows for unpacked installs');
  await popup.close();
});

test('custom hotkeys: a new key works and the replaced key stops working', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  await setKey(popup, 'nextKeys', 0, 'n');
  await setKey(popup, 'prevKeys', 0, 'p');
  assert.deepEqual(await popup.locator('.key').allTextContents(), ['N', '↓', 'P', '↑']);

  const page = await open();
  await page.keyboard.press('j'); // no longer a hotkey
  assert.equal(await settled(page), 0);
  await page.keyboard.press('n');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.keyboard.press('n');
  assert.equal(await topOf(page, 'p1'), LINE);
  await page.keyboard.press('p');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.close();
  await popup.close();
});

test('a key moved to the other direction is removed from the first', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  await setKey(popup, 'prevKeys', 0, 'j'); // J was "next"; now it's "previous"
  assert.deepEqual(await popup.locator('.key').allTextContents(), ['↓', '—', 'J', '↑']);
  await popup.close();
});

test('reserved keys and Escape do not change a hotkey', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  await setKey(popup, 'nextKeys', 0, 'Space');
  await setKey(popup, 'nextKeys', 0, 'Escape');
  assert.deepEqual(await popup.locator('.key').allTextContents(), ['J', '↓', 'K', '↑']);
  await popup.close();
});

test('losing Pro falls back to the default keys', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  await setKey(popup, 'nextKeys', 0, 'n');
  await popup.uncheck('#devPro');
  await popup.waitForSelector('body:not(.pro)');

  const page = await open();
  await page.keyboard.press('j');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.close();
  await popup.close();
});

test('the on/off switch stops and restarts snapping', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  await popup.uncheck('#enabled');

  const page = await open();
  await page.keyboard.press('j');
  assert.equal(await settled(page), 0, 'snapping is off');

  await popup.check('#enabled');
  await page.waitForTimeout(200);
  await page.keyboard.press('j');
  assert.equal(await topOf(page, 'p0'), LINE, 'snapping is back on without reloading the page');
  await page.close();
  await popup.close();
});

test('auto-scroll moves to the next post on a timer', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  await popup.fill('#seconds', '1'); // below the minimum: clamped to 3
  await popup.press('#seconds', 'Enter');
  await popup.locator('#seconds').blur();
  assert.equal(await popup.inputValue('#seconds'), '3');
  await popup.check('#autoScroll');

  const page = await open();
  await page.waitForTimeout(2000);
  assert.equal(await settled(page), 0, 'nothing happens before the interval');
  await page.waitForTimeout(1800);
  assert.equal(await topOf(page, 'p0'), LINE, 'first tick');
  await page.waitForTimeout(3300);
  assert.equal(await topOf(page, 'p1'), LINE, 'second tick');
  await page.close();
  await popup.close();
});

test('auto-scroll waits while the user is typing', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  await popup.fill('#seconds', '3');
  await popup.locator('#seconds').blur();
  await popup.check('#autoScroll');

  const page = await open();
  await page.click('#box');
  await page.waitForTimeout(3600);
  assert.equal(await settled(page), 0);
  await page.close();
  await popup.close();
});

test('auto-scroll is off on the free plan even if it was saved as on', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  await popup.fill('#seconds', '3');
  await popup.locator('#seconds').blur();
  await popup.check('#autoScroll');
  await popup.uncheck('#devPro');

  const page = await open();
  await page.waitForTimeout(3600);
  assert.equal(await settled(page), 0);
  await page.close();
  await popup.close();
});

test('Space pauses auto-scroll and Space again resumes it', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  await popup.fill('#seconds', '3');
  await popup.locator('#seconds').blur();
  await popup.check('#autoScroll');

  const page = await open();
  const status = () =>
    page.evaluate(() => document.querySelector('post-by-post-status')?.shadowRoot.textContent.trim() ?? null);

  await page.keyboard.press('Space');
  assert.match(await status(), /paused/, 'a paused label shows');
  await page.waitForTimeout(4000);
  assert.equal(await settled(page), 0, 'nothing moves while paused, and Space itself did not scroll');
  assert.match(await status(), /paused/, 'the label stays while paused');

  await page.keyboard.press('Space');
  assert.match(await status(), /resumed/);
  await page.waitForTimeout(3600);
  assert.equal(await topOf(page, 'p0'), LINE, 'auto-scroll runs again');
  assert.equal(await status(), null, 'the resumed label fades away');
  await page.close();
  await popup.close();
});

test('with auto-scroll off, Space still moves to the next post', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  const page = await open();
  await page.keyboard.press('Space');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.close();
  await popup.close();
});

test('turning auto-scroll off clears a pause', async () => {
  const popup = await freshPopup();
  await unlockPro(popup);
  await popup.fill('#seconds', '3');
  await popup.locator('#seconds').blur();
  await popup.check('#autoScroll');

  const page = await open();
  await page.keyboard.press('Space'); // pause
  await popup.uncheck('#autoScroll');
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => !!document.querySelector('post-by-post-status')),
    false,
    'the paused label goes away',
  );
  await page.keyboard.press('Space'); // a normal Space again
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.close();
  await popup.close();
});
