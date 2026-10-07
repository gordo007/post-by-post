// Settings shared by the content script and the popup.
// Loaded before content.js (see manifest.json) and by popup.html.
// eslint-disable-next-line no-unused-vars
var PBP = (() => {
  'use strict';

  const DEFAULTS = {
    enabled: true, // Pro: on/off switch
    nextKeys: ['j', 'ArrowDown'], // Pro: custom hotkeys
    prevKeys: ['k', 'ArrowUp'],
    autoScroll: false, // Pro: auto-scroll mode
    autoScrollSeconds: 8,
    devPro: false, // developer-only Pro unlock, see isPro()
    license: null, // { email, checkedAt } once a purchase is confirmed
  };

  const API_BASE = 'https://postbypost.app';
  const RECHECK_MS = 7 * 24 * 60 * 60 * 1000; // re-confirm a purchase weekly (catches refunds)

  const AUTO_SCROLL_SECONDS = { min: 3, max: 120 };

  // Keys that can't be used as custom hotkeys: they already page, type, or navigate.
  const RESERVED_KEYS = [' ', 'PageUp', 'PageDown', 'Tab', 'Enter', 'Escape', 'Home', 'End', 'Backspace'];

  // Pro is unlocked by a purchase confirmed through postbypost.app (see
  // verifyPurchase), or, on developer (unpacked) installs only, by the
  // popup's developer switch.
  function isPro(s) {
    return s.devPro === true || Boolean(s.license?.email);
  }

  // Ask postbypost.app whether this email bought Pro. Resolves true/false;
  // rejects if the server can't be reached or answers with an error.
  async function verifyPurchase(email) {
    const res = await fetch(`${API_BASE}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 400) return false; // not a valid email
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body.pro === true;
  }

  function needsRecheck(license, now = Date.now()) {
    return Boolean(license?.email) && now - (license.checkedAt ?? 0) > RECHECK_MS;
  }

  // The settings that actually apply: free users get the defaults for every Pro setting.
  function effective(s) {
    if (isPro(s)) return s;
    return {
      ...s,
      enabled: DEFAULTS.enabled,
      nextKeys: DEFAULTS.nextKeys,
      prevKeys: DEFAULTS.prevKeys,
      autoScroll: DEFAULTS.autoScroll,
    };
  }

  function load() {
    return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, resolve));
  }

  function save(patch) {
    return new Promise((resolve) => chrome.storage.sync.set(patch, resolve));
  }

  // Letters are stored lowercase so J and j are the same hotkey.
  function normalizeKey(key) {
    return key.length === 1 ? key.toLowerCase() : key;
  }

  function keyLabel(key) {
    const names = { ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→' };
    return names[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  }

  function clampSeconds(n) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return DEFAULTS.autoScrollSeconds;
    return Math.min(AUTO_SCROLL_SECONDS.max, Math.max(AUTO_SCROLL_SECONDS.min, v));
  }

  return {
    DEFAULTS,
    AUTO_SCROLL_SECONDS,
    RESERVED_KEYS,
    isPro,
    verifyPurchase,
    needsRecheck,
    effective,
    load,
    save,
    normalizeKey,
    keyLabel,
    clampSeconds,
  };
})();
