/**
 * Local key generator (offline) — mints a key straight into the local store.
 *
 *   node generate.js            → pro, lifetime
 *   node generate.js pro 30     → pro, 30 days
 *   node generate.js pro 0 note → pro, lifetime, note "note"
 *
 * For your deployed Render server use the /api/keys admin endpoint (curl)
 * so the key lands in the live (Mongo/remote) store.
 */
'use strict';

const store = require('./store');

(async () => {
  const [plan = 'pro', days = 0, ...noteParts] = process.argv.slice(2);
  const note = noteParts.join(' ');

  await store.init();
  const { key, record } = await store.create({
    plan,
    days: parseInt(days, 10) || 0,
    note: note || undefined,
  });

  console.log('New license key created:');
  console.log('─────────────────────────────────────────────');
  console.log(`  KEY    : ${key}`);
  console.log(`  plan   : ${record.plan}`);
  console.log(`  expires: ${record.expiresAt ? new Date(record.expiresAt).toISOString() : 'never (lifetime)'}`);
  console.log('Send this key to the buyer — no free tier tricks survive.');

  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});