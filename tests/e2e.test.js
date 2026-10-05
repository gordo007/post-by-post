// End-to-end tests for snapping (free features). Run with: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LINE, launch, open: openIn, settled, topOf } = require('./helpers');

let context;
test.before(async () => {
  context = await launch();
});
test.after(() => context?.close());

const open = (urlPath) => openIn(context, urlPath);

test('J / K and arrow keys move one post at a time, below the header', async () => {
  const page = await open();
  await page.keyboard.press('j');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.keyboard.press('j');
  assert.equal(await topOf(page, 'p1'), LINE);
  await page.keyboard.press('ArrowDown');
  assert.equal(await topOf(page, 'p2'), LINE);
  await page.keyboard.press('k');
  assert.equal(await topOf(page, 'p1'), LINE);
  await page.keyboard.press('ArrowUp');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.close();
});

test('rapid key presses chain instead of repeating the same post', async () => {
  const page = await open();
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  assert.equal(await topOf(page, 'p2'), LINE);
  await page.close();
});

test('keys typed into a text box do not navigate', async () => {
  const page = await open();
  await page.click('#box');
  await page.keyboard.type('jjkk');
  assert.equal(await settled(page), 0);
  assert.equal(await page.inputValue('#box'), 'jjkk');
  await page.close();
});

test('one wheel gesture snaps exactly one post, even with many events', async () => {
  const page = await open();
  await page.mouse.move(500, 400);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 30); // a trackpad-style burst
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.waitForTimeout(250); // pause ends the gesture
  await page.mouse.wheel(0, 100);
  assert.equal(await topOf(page, 'p1'), LINE);
  await page.waitForTimeout(250);
  await page.mouse.wheel(0, -100);
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.close();
});

test('posts taller than the screen scroll normally until their end', async () => {
  const page = await open();
  for (const _ of [0, 1, 2]) await page.keyboard.press('j');
  assert.equal(await topOf(page, 'p2'), LINE);
  const before = await settled(page);
  await page.mouse.move(500, 400);
  await page.mouse.wheel(0, 100);
  const after = await settled(page);
  assert.ok(after > before && after - before < 200, `expected a small native scroll, got ${after - before}px`);
  assert.ok((await topOf(page, 'p2')) < LINE, 'still reading post 2');
  await page.close();
});

test('wheel over an inner scroll area scrolls that area, not the feed', async () => {
  const page = await open();
  for (const _ of [0, 1, 2, 3]) await page.keyboard.press('j');
  assert.equal(await topOf(page, 'p3'), LINE);
  const before = await settled(page);
  const box = await page.locator('#scroller').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(300);
  assert.equal(await settled(page), before);
  assert.ok((await page.locator('#scroller').evaluate((el) => el.scrollTop)) > 0);
  await page.close();
});

test('past the last post the wheel scrolls normally (so Reddit can load more)', async () => {
  const page = await open();
  for (const _ of [0, 1, 2, 3, 4]) await page.keyboard.press('j');
  assert.equal(await topOf(page, 'p4'), LINE);
  const before = await settled(page);
  await page.mouse.move(500, 400);
  await page.mouse.wheel(0, 100);
  assert.ok((await settled(page)) > before);
  await page.close();
});

test('works on home, popular, search; stays off on post pages', async () => {
  for (const p of ['/', '/r/popular/', '/search/?q=cats', '/r/test/top/']) {
    const page = await open(p);
    await page.keyboard.press('j');
    assert.equal(await topOf(page, 'p0'), LINE, `snapping on ${p}`);
    await page.close();
  }
  const page = await open('/r/test/comments/abc123/some_post/');
  await page.keyboard.press('j');
  assert.equal(await settled(page), 0);
  await page.close();
});

// Viewport x of the page scrollbar, or null if this browser draws overlay scrollbars.
async function scrollbarX(page) {
  const { client, inner } = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    inner: innerWidth,
  }));
  return inner > client ? Math.round((client + inner) / 2) : null;
}

test('clicking the scrollbar track snaps to the nearest post', async () => {
  const page = await open();
  const x = await scrollbarX(page);
  assert.ok(x, 'expected a classic scrollbar in the test browser');
  await page.keyboard.press('j');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.mouse.click(x, 700); // page down via the track
  await page.waitForTimeout(300);
  await settled(page);
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll('shreddit-post')].map((p) => Math.round(p.getBoundingClientRect().top)),
  );
  assert.ok(tops.includes(LINE), `a post should sit at the snap line, got tops ${tops}`);
  await page.close();
});

test('dragging the scrollbar thumb snaps on release', async () => {
  const page = await open();
  const x = await scrollbarX(page);
  await page.mouse.move(x, 20);
  await page.mouse.down();
  await page.mouse.move(x, 70, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await settled(page);
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll('shreddit-post')].map((p) => Math.round(p.getBoundingClientRect().top)),
  );
  assert.ok((await page.evaluate(() => scrollY)) > 0, 'the drag should have scrolled');
  assert.ok(tops.includes(LINE), `a post should sit at the snap line, got tops ${tops}`);
  await page.close();
});

test('clicking inside the page does not snap', async () => {
  const page = await open();
  await page.evaluate(() => scrollTo(0, 500)); // deliberately between posts
  await page.mouse.click(500, 400);
  await page.waitForTimeout(400);
  assert.equal(await settled(page), 500);
  await page.close();
});

test('Space / Page Down go to the next post, Shift+Space / Page Up to the previous', async () => {
  const page = await open();
  await page.keyboard.press('Space');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.keyboard.press('PageDown');
  assert.equal(await topOf(page, 'p1'), LINE);
  await page.keyboard.press('Shift+Space');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageUp');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.close();
});

test('page keys page through a tall post, then snap to the next one', async () => {
  const page = await open();
  for (const _ of [0, 1, 2]) await page.keyboard.press('j');
  assert.equal(await topOf(page, 'p2'), LINE);
  await page.keyboard.press('PageDown');
  const top = await topOf(page, 'p2');
  assert.ok(top < LINE - 300, `expected a normal page-down inside post 2, top is ${top}`);
  // Keep paging until post 3 arrives; it must arrive exactly at the snap line.
  let presses = 1;
  while ((await topOf(page, 'p3')) > LINE && presses < 8) {
    await page.keyboard.press('PageDown');
    presses++;
  }
  assert.equal(await topOf(page, 'p3'), LINE);
  assert.ok(presses >= 3, `post 2 should take several pages to read, took ${presses}`);
  await page.close();
});

test('Space on a focused button presses the button instead of scrolling', async () => {
  const page = await open();
  await page.focus('#btn');
  await page.keyboard.press('Space');
  assert.equal(await page.getAttribute('#btn', 'data-clicks'), '1');
  await page.close();
});

test('a snap still lands exactly when the layout shifts mid-scroll', async () => {
  const page = await open();
  await page.keyboard.press('j'); // to post 0
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.keyboard.press('j'); // start scrolling to post 1...
  await page.evaluate(() => { document.getElementById('p0').style.height = '420px'; }); // ...an image loads above it
  assert.equal(await topOf(page, 'p1'), LINE);
  await page.close();
});

test('J then K in quick succession lands exactly', async () => {
  const page = await open();
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  assert.equal(await topOf(page, 'p0'), LINE);
  await page.close();
});
