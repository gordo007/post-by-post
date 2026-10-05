// Popup menu: Pro settings (on/off, auto-scroll, hotkeys) and the Pro unlock.
'use strict';

const $ = (id) => document.getElementById(id);
let state = { ...PBP.DEFAULTS };
let capturing = null; // the hotkey button waiting for a key press

async function render() {
  state = await PBP.load();
  const pro = PBP.isPro(state);
  const shown = PBP.effective(state); // free users see the defaults they actually get

  document.body.classList.toggle('pro', pro);
  $('plan').textContent = pro ? 'Pro' : 'Free';
  for (const el of document.querySelectorAll('[data-pro]')) el.disabled = !pro;

  $('enabled').checked = shown.enabled;
  $('autoScroll').checked = shown.autoScroll;
  $('seconds').value = state.autoScrollSeconds;
  for (const btn of document.querySelectorAll('.key')) {
    const key = shown[btn.dataset.dir][btn.dataset.slot];
    btn.textContent = key ? PBP.keyLabel(key) : '—';
    btn.classList.remove('capturing');
  }
  $('keyHint').hidden = true;
  $('devPro').checked = state.devPro;
}

$('enabled').addEventListener('change', (e) => PBP.save({ enabled: e.target.checked }));
$('autoScroll').addEventListener('change', (e) => PBP.save({ autoScroll: e.target.checked }));
$('seconds').addEventListener('change', (e) => {
  const seconds = PBP.clampSeconds(e.target.value);
  e.target.value = seconds;
  PBP.save({ autoScrollSeconds: seconds });
});
$('resetKeys').addEventListener('click', () =>
  PBP.save({ nextKeys: PBP.DEFAULTS.nextKeys, prevKeys: PBP.DEFAULTS.prevKeys }),
);
$('devPro').addEventListener('change', (e) => PBP.save({ devPro: e.target.checked }));

// --- Hotkey capture -----------------------------------------------------------

for (const btn of document.querySelectorAll('.key')) {
  btn.addEventListener('click', () => {
    capturing?.classList.remove('capturing');
    capturing = btn;
    btn.classList.add('capturing');
    btn.textContent = '…';
    $('keyHint').hidden = false;
  });
}

document.addEventListener(
  'keydown',
  (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    const btn = capturing;
    capturing = null;
    if (e.key === 'Escape') return render();
    if (e.ctrlKey || e.metaKey || e.altKey || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      capturing = btn; // ignore lone modifiers and shortcuts; keep waiting
      return;
    }
    const key = PBP.normalizeKey(e.key);
    if (PBP.RESERVED_KEYS.includes(key)) return render();

    const dir = btn.dataset.dir;
    const other = dir === 'nextKeys' ? 'prevKeys' : 'nextKeys';
    const keys = [...state[dir]];
    keys[Number(btn.dataset.slot)] = key;
    PBP.save({
      [dir]: [...new Set(keys.filter(Boolean))],
      [other]: state[other].filter((k) => k !== key), // a key can only do one thing
    });
  },
  true,
);

// --- Developer unlock ---------------------------------------------------------
// Shown only for unpacked installs, so the Pro features can be tested before
// a payment method is connected. Store installs never see it.
chrome.management.getSelf((self) => {
  $('devRow').hidden = self.installType !== 'development';
});

chrome.storage.onChanged.addListener(render);
render();
