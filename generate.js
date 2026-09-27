/**
 * DANGER MIC KEY — offline key generator
 * ══════════════════════════════════════════════════════════════════════
 * Mints keys straight into the local SQLite store. Handy for offline use or
 * for seeding a fresh machine before you deploy.
 *
 *   node generate.js                       → pro, 30 days
 *   node generate.js pro 7                 → pro, 7 days
 *   node generate.js elite 0               → elite, lifetime
 *   node generate.js lifetime 0 "Ramesh"   → lifetime, note "Ramesh"
 *   node generate.js pro 30 "UPI" 5        → 5 keys at once
 *
 * For your deployed server use POST /api/keys instead so the key lands in the
 * live store (see README).
 */
'use strict';

const store = require('./store');

(async () => {
  const [plan = 'pro', days = '', note = '', count = '1'] = process.argv.slice(2);

  if (!store.PLANS[plan]) {
    console.error(`Unknown plan "${plan}". Available: ${Object.keys(store.PLANS).join(', ')}`);
    process.exit(1);
  }
  const d = days === '' ? store.PLANS[plan].days : Math.max(0, parseInt(days, 10) || 0);
  const n = Math.max(1, Math.min(100, parseInt(count, 10) || 1));

  await store.init();

  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(store.create({ plan, days: d, note: note || undefined }));
    store.audit({ actor: 'cli', action: 'key.create', key: out[i].key, detail: `${plan} ${d}d` });
  }

  console.log('');
  console.log(`  ██ ${store.BRAND} — minted ${out.length} key(s)`);
  console.log('  ──────────────────────────────────────────────');
  for (const { key, record } of out) {
    console.log(`  KEY     : ${key}`);
    console.log(`  plan    : ${record.planLabel} (${record.plan})`);
    console.log(`  expires : ${record.expiresAt ? new Date(record.expiresAt).toISOString() : 'never (lifetime)'}`);
    if (record.note) console.log(`  buyer   : ${record.note}`);
    console.log('  ──────────────────────────────────────────────');
  }
  console.log('  Send the key to the buyer — the engine only loads after a valid check.');
  console.log('');

  process.exit(0);
})().catch((e) => {
  console.error('[danger]', e && e.message);
  process.exit(1);
});
