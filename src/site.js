// Runs on postbypost.app. After checkout, the buy page posts the new license
// key here so Pro unlocks without the buyer having to copy and paste it.
//
// Page -> extension:  { type: 'post-by-post:license', key }
// Extension -> page:  { type: 'post-by-post:result', status: 'unlocked' | 'invalid' | 'error' }
(() => {
  'use strict';

  addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type !== 'post-by-post:license') return;

    let status;
    try {
      status = (await PBP.activateLicense(event.data.key)) ? 'unlocked' : 'invalid';
    } catch {
      status = 'error';
    }
    window.postMessage({ type: 'post-by-post:result', status }, location.origin);
  });

  // Let the page know the extension is installed, so it can tailor its instructions.
  document.documentElement.dataset.postByPost = chrome.runtime.getManifest().version;
})();
