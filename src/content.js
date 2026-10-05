// Post-by-Post: snap Reddit feed scrolling to one post at a time.
// Runs as a content script on reddit.com. No build step, no dependencies.
(() => {
  'use strict';

  // Reddit's markup changes now and then; if snapping stops working, start here.
  const POST_SELECTOR = [
    'shreddit-post', // new Reddit feeds (home, popular, subreddits)
    '[data-testid="search-post-unit"]', // new Reddit search results
    '#siteTable > .thing.link', // old-style layout
  ].join(',');
  const HEADER_SELECTOR = 'reddit-header-large, header, #header';

  // Paths where snapping is active: home, popular/all, subreddits, search.
  // Post detail pages (/comments/) and everything else scroll normally.
  const FEED_PATHS = [
    /^\/$/,
    /^\/(best|hot|new|top|rising)\/?$/,
    /^\/r\/[^/]+(\/(best|hot|new|top|rising|controversial))?\/?$/,
    /^\/(r\/[^/]+\/)?search\/?$/,
  ];

  const GAP = 8; // px of breathing room between the header and the post
  const EDGE = 2; // px tolerance when comparing positions
  const WHEEL_THRESHOLD = 40; // px of wheel travel before a gesture snaps
  const GESTURE_IDLE_MS = 160; // wheel silence that ends one gesture (trackpad inertia)
  const SNAP_TIMEOUT_MS = 1500; // fallback for browsers that miss 'scrollend'
  const SCROLLBAR_IDLE_MS = 150; // stillness after releasing the scrollbar before snapping
  const PAGE_KEYS = { ' ': 1, PageDown: 1, PageUp: -1 }; // Shift+Space goes up
  const SPACE_CONTROLS = 'button, summary, video, audio, [role="button"], [role="checkbox"], [role="switch"]';

  // Settings come from src/settings.js (PBP), loaded before this file.
  let settings = PBP.effective(PBP.DEFAULTS);
  function reloadSettings() {
    PBP.load().then((stored) => {
      settings = PBP.effective(stored);
      scheduleAutoScroll();
    });
  }
  try {
    reloadSettings();
    chrome.storage.onChanged.addListener(reloadSettings);
  } catch {
    // Storage unavailable (e.g. extension reloaded under the page): keep defaults.
  }

  function isActive() {
    return settings.enabled && !document.fullscreenElement && FEED_PATHS.some((re) => re.test(location.pathname));
  }

  // Top-level posts in document order, skipping hidden ones and posts nested in other posts.
  function getPosts() {
    return [...document.querySelectorAll(POST_SELECTOR)].filter(
      (el) => el.offsetHeight > 0 && !el.parentElement?.closest(POST_SELECTOR),
    );
  }

  // Viewport y where a post's top edge should land: just below any fixed/sticky header.
  function snapLine() {
    let bottom = 0;
    for (const el of document.querySelectorAll(HEADER_SELECTOR)) {
      const { position } = getComputedStyle(el);
      if (position !== 'fixed' && position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.top <= EDGE && r.height > 0 && r.height < innerHeight / 3) bottom = Math.max(bottom, r.bottom);
    }
    return bottom + GAP;
  }

  // The post currently crossing the snap line, if any.
  function currentPost(posts, line) {
    return posts.find((p) => {
      const r = p.getBoundingClientRect();
      return r.top <= line + EDGE && r.bottom > line + EDGE;
    });
  }

  // --- Snapping -------------------------------------------------------------

  let snapTarget = null; // post being scrolled to; lets rapid presses chain correctly
  let snapTimer = 0;

  // When a snap finishes, nudge the post exactly into place. A snap can land a
  // little off if it was redirected mid-scroll, or if images above it loaded
  // and changed the layout while it was moving.
  function endSnap() {
    const target = snapTarget;
    snapTarget = null;
    clearTimeout(snapTimer);
    if (!target?.isConnected) return;
    const off = target.getBoundingClientRect().top - snapLine();
    if (Math.abs(off) > 1) scrollBy({ top: off, behavior: 'auto' });
  }
  addEventListener('scrollend', endSnap);

  // Scroll to the next (dir = 1) or previous (dir = -1) post. Returns false if there is none.
  function step(dir) {
    const posts = getPosts();
    const line = snapLine();
    let target;

    const i = snapTarget ? posts.indexOf(snapTarget) : -1;
    if (i !== -1) {
      target = posts[i + dir];
    } else if (dir > 0) {
      target = posts.find((p) => p.getBoundingClientRect().top > line + EDGE);
    } else {
      target = posts.findLast((p) => p.getBoundingClientRect().top < line - EDGE);
    }
    if (!target) return false;
    snapTo(target, line);
    return true;
  }

  function snapTo(target, line) {
    const top = scrollY + target.getBoundingClientRect().top - line;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    snapTarget = target;
    clearTimeout(snapTimer);
    snapTimer = setTimeout(endSnap, SNAP_TIMEOUT_MS);
    scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }

  // Snap to whichever post's top is closest to the snap line. Used after the
  // user scrolls some other way (e.g. the scrollbar) and leaves a post cut off.
  function snapNearest() {
    if (!isActive()) return;
    const line = snapLine();
    let best;
    let bestDist = Infinity;
    for (const p of getPosts()) {
      const dist = Math.abs(p.getBoundingClientRect().top - line);
      if (dist < bestDist) [best, bestDist] = [p, dist];
    }
    // Already aligned, or in the middle of a tall post with no edge nearby: leave it.
    if (!best || bestDist <= EDGE || bestDist > innerHeight / 2) return;
    snapTo(best, line);
  }

  // True while the user is partway through a post taller than the screen, so
  // the wheel should scroll normally and let them read it.
  function readingTallPost(dir) {
    const line = snapLine();
    const post = currentPost(getPosts(), line);
    if (!post) return false;
    const r = post.getBoundingClientRect();
    if (dir > 0) return r.bottom > innerHeight + EDGE;
    // Scrolling up: read normally until the post's top is within a screen, then snap to it.
    return r.top < line - innerHeight;
  }

  // --- Wheel / trackpad -------------------------------------------------------

  let wheelTotal = 0;
  let lastWheelAt = 0;
  let gestureSnapped = false;

  // True if the wheel event happens over an inner element (modal, menu, text box)
  // that can still scroll in that direction itself.
  function overScrollableChild(e, dir) {
    for (const node of e.composedPath()) {
      if (!(node instanceof Element) || node === document.body || node === document.documentElement) continue;
      const { overflowY } = getComputedStyle(node);
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      if (node.scrollHeight <= node.clientHeight + 1) continue;
      const canScroll =
        dir > 0 ? node.scrollTop + node.clientHeight < node.scrollHeight - 1 : node.scrollTop > 0;
      if (canScroll) return true;
    }
    return false;
  }

  function onWheel(e) {
    if (!isActive() || e.defaultPrevented || e.ctrlKey) return; // ctrl+wheel = zoom
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // horizontal scroll
    const dir = Math.sign(e.deltaY);
    if (!dir || overScrollableChild(e, dir)) return;

    const now = performance.now();
    if (now - lastWheelAt > GESTURE_IDLE_MS || Math.sign(wheelTotal) !== dir) {
      wheelTotal = 0;
      gestureSnapped = false;
    }
    lastWheelAt = now;

    // One snap per gesture: swallow the rest of it, including trackpad inertia.
    if (gestureSnapped) return e.preventDefault();
    if (!snapTarget && readingTallPost(dir)) return; // native scroll

    const pixels = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
    wheelTotal += pixels;
    if (Math.abs(wheelTotal) < WHEEL_THRESHOLD) return e.preventDefault();

    // No post in that direction (top of page, or end of the loaded feed): scroll
    // normally so Reddit can load more posts.
    if (step(dir)) {
      gestureSnapped = true;
      e.preventDefault();
    }
  }

  // --- Scrollbar ---------------------------------------------------------------
  // Clicking or dragging the page scrollbar fires no wheel or key events, so we
  // wait until the user lets go and the page stops moving, then snap to the nearest post.

  let scrollbar = 'idle'; // 'idle' | 'held' | 'released'
  let scrollbarTimer = 0;

  function onPageScrollbar(e) {
    // The page scrollbar sits outside <html>'s client area.
    return e.clientX >= document.documentElement.clientWidth || e.clientY >= document.documentElement.clientHeight;
  }

  function snapWhenScrollStops() {
    clearTimeout(scrollbarTimer);
    scrollbarTimer = setTimeout(() => {
      if (scrollbar !== 'released') return;
      scrollbar = 'idle';
      snapNearest();
    }, SCROLLBAR_IDLE_MS);
  }

  addEventListener(
    'mousedown',
    (e) => {
      scrollbar = e.button === 0 && isActive() && onPageScrollbar(e) ? 'held' : 'idle';
    },
    { capture: true },
  );
  addEventListener(
    'mouseup',
    () => {
      if (scrollbar !== 'held') return;
      scrollbar = 'released';
      snapWhenScrollStops();
    },
    { capture: true },
  );
  addEventListener('scroll', () => scrollbar === 'released' && snapWhenScrollStops(), { passive: true });

  // --- Keyboard ---------------------------------------------------------------

  function isTyping(e) {
    return isTextField(e.composedPath()[0]);
  }

  function isTextField(el) {
    if (!(el instanceof Element)) return false;
    return (
      el.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
      !!el.closest('[contenteditable=""], [contenteditable="true"], [role="textbox"]')
    );
  }

  // Space presses a focused button, checkbox or media player; leave that alone.
  function isSpaceControl(e) {
    const el = e.composedPath()[0];
    return el instanceof Element && !!el.closest(SPACE_CONTROLS);
  }

  // Direction for a key we handle, or 0.
  function keyDirection(e) {
    if (e.key in PAGE_KEYS) {
      if (e.key === ' ' && isSpaceControl(e)) return 0;
      return e.key === ' ' && e.shiftKey ? -1 : PAGE_KEYS[e.key];
    }
    if (e.shiftKey) return 0;
    const key = PBP.normalizeKey(e.key);
    if (settings.nextKeys.includes(key)) return 1;
    if (settings.prevKeys.includes(key)) return -1;
    return 0;
  }

  function onKeyDown(e) {
    if (!isActive() || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    const dir = keyDirection(e);
    if (!dir) return;
    // Page keys page through a post taller than the screen, like the wheel does.
    if (e.key in PAGE_KEYS && !snapTarget && readingTallPost(dir)) return;
    if (step(dir)) {
      e.preventDefault();
      e.stopPropagation(); // keep Reddit's own shortcuts from also acting on the key
    }
  }

  addEventListener('wheel', onWheel, { passive: false, capture: true });
  addEventListener('keydown', onKeyDown, { capture: true });

  // --- Auto-scroll (Pro) --------------------------------------------------------
  // Every N seconds, move to the next post. Any wheel, key or click restarts the
  // countdown, so it never moves the page while the user is doing something.
  // It also waits while the tab is hidden or a text box has focus.

  let autoTimer = 0;

  function scheduleAutoScroll() {
    clearTimeout(autoTimer);
    if (settings.autoScroll) autoTimer = setTimeout(autoScrollTick, settings.autoScrollSeconds * 1000);
  }

  function deepActiveElement() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function autoScrollTick() {
    if (isActive() && !document.hidden && !isTextField(deepActiveElement()) && !step(1)) {
      // End of the loaded feed: scroll a little so Reddit loads more posts.
      scrollBy({ top: innerHeight / 2, behavior: 'smooth' });
    }
    scheduleAutoScroll();
  }

  for (const type of ['wheel', 'keydown', 'mousedown', 'touchstart']) {
    addEventListener(type, scheduleAutoScroll, { capture: true, passive: true });
  }

  // One line in the DevTools console, to confirm which version is running and what it sees.
  setTimeout(() => {
    const version = chrome.runtime?.getManifest?.().version ?? '?';
    console.info(
      `[Post-by-Post ${version}] active on this page: ${isActive()}, posts found: ${getPosts().length}, ` +
        `snap line: ${Math.round(snapLine())}px`,
    );
  }, 2000);
})();
