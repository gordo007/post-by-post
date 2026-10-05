// Builds store-ready packages into dist/:
//   dist/post-by-post-chrome-<version>.zip   (Chrome, Edge, Brave)
//   dist/post-by-post-firefox-<version>.zip  (Firefox: adds its add-on ID)
// manifest.json in the repo root stays Chrome-clean, so "Load unpacked"
// shows no warnings. Requires the `zip` command.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const FILES = ['src', 'icons'];
const FIREFOX_SETTINGS = {
  gecko: { id: 'post-by-post@extension', strict_min_version: '121.0' },
};

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
fs.rmSync(DIST, { recursive: true, force: true });

for (const [browser, extra] of [
  ['chrome', {}],
  ['firefox', { browser_specific_settings: FIREFOX_SETTINGS }],
]) {
  const dir = path.join(DIST, browser);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FILES) fs.cpSync(path.join(ROOT, f), path.join(dir, f), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, ...extra }, null, 2) + '\n');
  const zip = path.join(DIST, `post-by-post-${browser}-${manifest.version}.zip`);
  execFileSync('zip', ['-qr', zip, '.'], { cwd: dir });
  console.log(`built ${path.relative(ROOT, zip)}`);
}
