/* ═══════════════════════════════════════════════════════════════════════
   DANGER MIC KEY — console UI regression checks
   ═══════════════════════════════════════════════════════════════════════
   These are static assertions over the shipped console assets. They exist to
   catch the class of bug that only shows up in a browser (an inverted
   closeModal, a dangling bindCreateForm, a label that contradicts the
   server's own record) without needing a headless browser.

     node test/ui.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const js   = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'danger.js'), 'utf8');
const css  = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'danger.css'), 'utf8');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (detail ? '\n      ' + detail : '')); }
}

console.log('\n  DANGER MIC KEY — console UI checks\n  ' + '\u2500'.repeat(52));

/* ── The bug from the screenshot: closeModal removed 'hidden' ── */
const closeBody = (js.match(/function closeModal\(id\) \{[\s\S]*?\n\}/) || [''])[0];
t('closeModal ADDS the hidden class (not removes it)',
  /classList\.add\('hidden'\)/.test(closeBody) && !/classList\.remove\('hidden'\)/.test(closeBody),
  'closeModal must add .hidden, otherwise "Close" re-opens the modal');

t('openModal REMOVES the hidden class',
  /function openModal[\s\S]{0,220}classList\.remove\('hidden'\)/.test(js));

t('data-close is delegated so buttons injected after load still work',
  /document\.addEventListener\('click'[\s\S]{0,200}closest\('\[data-close\]'\)/.test(js) &&
  !/\$\$\('\[data-close\]'\)\.forEach\(\(b\) => b\.addEventListener/.test(js),
  'a direct querySelectorAll bind misses the mint result\'s Close button');

/* ── Re-binding the mint form on every open stacked listeners ── */
t('no per-open bindCreateForm() re-binding',
  !/bindCreateForm/.test(js),
  'the mint form is rebuilt via innerHTML; rebinding stacks duplicate listeners');
t('mint presets + button are delegated from #mkOvl',
  /\$\('#mkOvl'\)\.addEventListener\('click'/.test(js));
t('no dangling bindCreateForm() at boot',
  !/^\s*bindCreateForm\(\);/m.test(js));

/* ── The lifetime label contradicted the server's record ── */
t('mint result derives lifetime from the SERVER record, not the form',
  /const isLifetime = !rec\.expiresAt/.test(js),
  'an empty "days" field falls back to the plan default, so the form check lied');
t('mint result no longer uses the old `valid` heuristic',
  !/const valid = days === '' \|\| days === 0;/.test(js));

/* ── Confirm dialog must not escape our own markup ── */
const cfBody = (js.match(/\$\('#cfBody'\)\.innerHTML\s*=\s*([^;]+);/) || [, ''])[1];
t('confirm dialog injects trusted HTML (keys render bold, not as <b>)',
  !/esc\(/.test(cfBody), 'esc() here turned our <b> tags into visible text');
t('single-key confirm escapes the key it interpolates',
  /'<b>' \+ esc\(key\) \+ '<\/b>'/.test(js));
t('bulk confirm escapes each key it interpolates',
  /keys\.map\(\(k\) => '<b>' \+ esc\(k\) \+ '<\/b>'\)/.test(js));

/* ── Bound / unbound must be visible ── */
t('unbound rows render a labelled UNBOUND pill',
  /dev dev-off[\s\S]{0,160}Unbound<\/span>/.test(js));
t('bound rows render a labelled pill with a lock icon',
  /dev dev-on[\s\S]{0,200}i-lock/.test(js));
t('.dev-off has its own high-contrast colour (not grey-on-grey)',
  /\.dev-off\{[^}]*var\(--vio\)/.test(css));
t('locked icon exists in the sprite', /id="i-lock"/.test(html));
t('Bound chip has a live count', /id="nBoundC"/.test(html) && /id="nUnboundC"/.test(html));
t('bound filter is handled in visibleKeys()',
  /state\.filter === 'bound'/.test(js));

/* ── Close button should look like a real control ── */
t('close button is styled as a circle', /\.mx\{[^}]*border-radius:50%/.test(css));
t('close button has a hover state', /\.mx:hover\{/.test(css));

/* ── Element / id integrity ── */
const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g)).map((m) => m[1]));
/* Some nodes are injected at runtime via innerHTML (drawer form, mint result),
   so they legitimately don't exist in the static HTML. */
const injected = new Set(Array.from(js.matchAll(/\bid=\\?"([A-Za-z0-9_-]+)\\?"/g)).map((m) => m[1]));
const refs = new Set(Array.from(js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)).map((m) => m[1]));
const missing = Array.from(refs).filter((r) => !ids.has(r) && !injected.has(r));
t('every $("#id") exists in the HTML or is injected by the JS',
  missing.length === 0, 'missing: ' + missing.join(', '));

const icons = new Set(Array.from(html.matchAll(/id="(i-[a-z]+)"/g)).map((m) => m[1]));
const used  = new Set(Array.from(js.matchAll(/href="#(i-[a-z]+)"/g)).map((m) => m[1]));
const missIcons = Array.from(used).filter((i) => !icons.has(i));
t('every icon referenced by the JS is defined in the sprite', missIcons.length === 0, 'missing: ' + missIcons.join(', '));

const dataClose = new Set(Array.from(html.matchAll(/data-close="([^"]+)"/g)).map((m) => m[1]));
t('every data-close target exists', Array.from(dataClose).every((d) => ids.has(d)));

/* ── Every modal must have a way out ── */
const overlays = Array.from(html.matchAll(/<div class="(?:ovl|drawer)[^"]*" id="([A-Za-z0-9_-]+)"/g)).map((m) => m[1]);
t('every overlay/drawer can be dismissed', overlays.length > 0 && overlays.every((o) => dataClose.has(o)),
  'missing a data-close on: ' + overlays.filter((o) => !dataClose.has(o)).join(', '));

/* ── No leftover dev artefacts ── */
t('no __APPEND__ markers left in the console', !/__APPEND__|__MORE__/.test(html + js + css));
t('no native prompt() left in the UI', !/\bprompt\(/.test(js));

console.log('  ' + '\u2500'.repeat(52));
console.log(`  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
