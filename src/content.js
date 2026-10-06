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
  const SCROLLBAR_NUDGE = 0.25; // scrollbar moves under this share of the screen are fine adjustments
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
  // Small adjustments are left alone: clicks on the scrollbar's arrow buttons,
  // and any scrollbar move shorter than a quarter of the screen (e.g. nudging
  // down to see a post's votes and comments).

  let scrollbar = 'idle'; // 'idle' | 'held' | 'released'
  let scrollbarTimer = 0;
  let scrollbarStartY = 0;

  function onPageScrollbar(e) {
    // The page scrollbar sits outside <html>'s client area.
    return e.clientX >= document.documentElement.clientWidth || e.clientY >= document.documentElement.clientHeight;
  }

  // The ▲/▼ buttons at the ends of a classic scrollbar are about as tall as it is wide.
  function onScrollbarArrow(e) {
    const width = innerWidth - document.documentElement.clientWidth;
    if (width <= 0 || e.clientX < document.documentElement.clientWidth) return false;
    return e.clientY <= width || e.clientY >= document.documentElement.clientHeight - width;
  }

  function snapWhenScrollStops() {
    clearTimeout(scrollbarTimer);
    scrollbarTimer = setTimeout(() => {
      if (scrollbar !== 'released') return;
      scrollbar = 'idle';
      if (Math.abs(scrollY - scrollbarStartY) >= innerHeight * SCROLLBAR_NUDGE) snapNearest();
    }, SCROLLBAR_IDLE_MS);
  }

  addEventListener(
    'mousedown',
    (e) => {
      const track = e.button === 0 && isActive() && onPageScrollbar(e) && !onScrollbarArrow(e);
      scrollbar = track ? 'held' : 'idle';
      scrollbarStartY = scrollY;
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
    // While auto-scroll is on, Space pauses and resumes it instead of moving.
    if (settings.autoScroll && e.key === ' ' && !e.shiftKey && !isSpaceControl(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) {
        setAutoPaused(!autoPaused);
        log(`Space: auto-scroll ${autoPaused ? 'paused' : 'resumed'}`);
      }
      return;
    }
    if (settings.autoScroll && e.key === ' ') {
      log('Space: left to the page (a button, player or other control has focus)', e.composedPath()[0]);
    }
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
  // Space pauses and resumes it (per tab); a label shows while it's paused.

  let autoTimer = 0;
  let autoPaused = false;

  function scheduleAutoScroll() {
    clearTimeout(autoTimer);
    if (!settings.autoScroll) setAutoPaused(false, { quiet: true });
    if (settings.autoScroll && !autoPaused) {
      autoTimer = setTimeout(autoScrollTick, settings.autoScrollSeconds * 1000);
    }
  }

  function setAutoPaused(paused, { quiet = false } = {}) {
    if (paused === autoPaused) return;
    autoPaused = paused;
    try {
      if (!quiet) showStatus(paused ? 'Auto-scroll paused · Space to resume' : 'Auto-scroll resumed', paused);
      else hideStatus();
    } catch (err) {
      // Never let the on-screen indicator break pausing itself.
      console.error('[Post-by-Post] could not show the pause indicator:', err);
    }
    scheduleAutoScroll();
  }

  // Pause/resume feedback: a YouTube-style icon that flashes in the middle of
  // the screen, plus a label at the bottom that stays while paused. It's shown
  // in the browser's top layer (a popover), above everything on the page, so
  // nothing on Reddit can cover or clip it. In a shadow root so Reddit's
  // styles can't change it, and built without innerHTML.
  const OVERLAY_CSS = `
    .icon { position: fixed; left: 50%; top: 50%; width: 96px; height: 96px; margin: -48px 0 0 -48px;
      border-radius: 50%; background: rgba(0, 0, 0, 0.55); display: flex; align-items: center;
      justify-content: center; opacity: 0; transform: scale(0.85); transition: opacity 0.25s, transform 0.25s; }
    .icon.show { opacity: 1; transform: scale(1); }
    .bar { width: 11px; height: 38px; margin: 0 6px; border-radius: 2px; background: #fff; }
    .play { width: 0; height: 0; margin-left: 10px; border-left: 34px solid #fff;
      border-top: 21px solid transparent; border-bottom: 21px solid transparent; }
    .label { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); white-space: nowrap;
      padding: 8px 16px; border-radius: 999px; background: rgba(26, 26, 27, 0.92); color: #fff;
      font: 600 14px/1.3 system-ui, sans-serif; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3); display: none; }
    .label.show { display: block; }
  `;
  // Pinned with !important so no page style can hide or move the overlay
  // (older browsers without popovers rely on this alone).
  const HOST_STYLE = {
    display: 'block', position: 'fixed', inset: '0', top: '0', left: '0', width: '100%', height: '100%',
    margin: '0', padding: '0', border: '0', background: 'transparent', overflow: 'visible',
    'pointer-events': 'none', 'z-index': '2147483647', visibility: 'visible', opacity: '1',
    transform: 'none', filter: 'none', 'clip-path': 'none', contain: 'none', isolation: 'isolate',
  };

  let overlay = null;
  let flashTimer = 0;
  let labelTimer = 0;

  function div(className) {
    const el = document.createElement('div');
    el.className = className;
    return el;
  }

  function getOverlay() {
    if (overlay) return overlay;
    const host = document.createElement('post-by-post-overlay');
    for (const [prop, value] of Object.entries(HOST_STYLE)) host.style.setProperty(prop, value, 'important');
    if ('popover' in host) host.popover = 'manual';
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    const icon = div('icon');
    const label = div('label');
    label.setAttribute('role', 'status');
    host.attachShadow({ mode: 'open' }).append(style, icon, label);
    overlay = { host, icon, label };
    return overlay;
  }

  function showStatus(text, paused) {
    const { host, icon, label } = getOverlay();
    // Attached to <html>, outside <body>, so body styles can't affect it.
    if (!host.isConnected || host.parentNode !== document.documentElement) document.documentElement.append(host);
    if ('popover' in host && !host.matches(':popover-open')) host.showPopover();

    icon.replaceChildren(...(paused ? [div('bar'), div('bar')] : [div('play')]));
    icon.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => icon.classList.remove('show'), 800);

    label.textContent = text;
    label.classList.add('show');
    clearTimeout(labelTimer);
    if (!paused) labelTimer = setTimeout(hideStatus, 1500);
    if (paused) setTimeout(reportOverlay, 300);
  }

  // Diagnostics: where the pause label is and what (if anything) covers it.
  function reportOverlay() {
    if (!overlay) return;
    const { host, label } = overlay;
    const h = getComputedStyle(host);
    const l = getComputedStyle(label);
    const r = label.getBoundingClientRect();
    const describe = (el) => {
      if (!el) return 'nothing';
      const cs = getComputedStyle(el);
      return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}` +
        `${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}` +
        ` (position ${cs.position}, z-index ${cs.zIndex})`;
    };
    const covering = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    log(
      `overlay check: attached ${host.isConnected} to ${host.parentNode?.nodeName}, ` +
        `host display ${h.display} visibility ${h.visibility} opacity ${h.opacity} z ${h.zIndex} ` +
        `size ${host.offsetWidth}x${host.offsetHeight}; label display ${l.display} at ` +
        `${Math.round(r.x)},${Math.round(r.y)} size ${Math.round(r.width)}x${Math.round(r.height)}; ` +
        `window ${innerWidth}x${innerHeight}; topmost element there: ${describe(covering)}`,
    );
  }

  function hideStatus() {
    clearTimeout(flashTimer);
    clearTimeout(labelTimer);
    if (!overlay) return;
    overlay.icon.classList.remove('show');
    overlay.label.classList.remove('show');
    if ('popover' in overlay.host && overlay.host.matches(':popover-open')) overlay.host.hidePopover();
    overlay.host.remove();
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

  // Diagnostics in the DevTools console (filter by "Post-by-Post").
  function log(...args) {
    console.info('[Post-by-Post]', ...args);
  }

  setTimeout(() => {
    const version = chrome.runtime?.getManifest?.().version ?? '?';
    const browser = navigator.userAgent.match(/(Chrome|Firefox|Edg)\/[\d.]+/g)?.join(' ') ?? navigator.userAgent;
    log(
      `${version} on ${browser}. Active on this page: ${isActive()}, posts found: ${getPosts().length}, ` +
        `snap line: ${Math.round(snapLine())}px, auto-scroll: ${settings.autoScroll}, ` +
        `top-layer overlay supported: ${'popover' in HTMLElement.prototype}`,
    );
  }, 2000);
})();
