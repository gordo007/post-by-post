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
  };

  const AUTO_SCROLL_SECONDS = { min: 3, max: 120 };

  // Keys that can't be used as custom hotkeys: they already page, type, or navigate.
  const RESERVED_KEYS = [' ', 'PageUp', 'PageDown', 'Tab', 'Enter', 'Escape', 'Home', 'End', 'Backspace'];

  // Pro unlock. No payment method is connected yet; when one is, its license
  // check goes here. Until then only a developer (unpacked) install can unlock
  // Pro, from the popup, for testing.
  function isPro(s) {
    return s.devPro === true;
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
    effective,
    load,
    save,
    normalizeKey,
    keyLabel,
    clampSeconds,
  };
})();
