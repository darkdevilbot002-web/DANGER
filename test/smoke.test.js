/**
 * DANGER MIC KEY — end-to-end smoke test
 * ══════════════════════════════════════════════════════════════════════
 * Boots the real Express app against a throwaway SQLite file and exercises
 * the whole surface: auth, minting, verification, device binding, revoke,
 * activate, unbind, delete, bulk ops, stats and the audit trail.
 *
 *   npm test          (or: node test/smoke.test.js)
 */
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

/* Isolate the test from the real data dir BEFORE requiring the store. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'danger-test-'));
process.env.DATA_DIR = TMP;
process.env.ADMIN_USER = 'tester';
process.env.ADMIN_PASS = 'test-pass-123';
process.env.SESSION_SECRET = 'test-secret-do-not-use';

const store = require('../store');
const { app } = require('../index');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; console.log('  \u2717 ' + name + '\n      ' + e.message); }
}

function req(server, method, url, body, token) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, method, path: url,
      headers: Object.assign({ 'Content-Type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {}),
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  await store.init();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  console.log('\n  DANGER MIC KEY — smoke test\n  ' + '\u2500'.repeat(52));

  /* ── Meta ── */
  const health = await req(server, 'GET', '/healthz');
  check('GET /healthz is ok', () => assert.strictEqual(health.status, 200));

  const info = await req(server, 'GET', '/api/info');
  check('GET /api/info exposes brand + plans', () => {
    assert.strictEqual(info.body.brand, 'DANGER MIC KEY');
    assert.ok(info.body.plans.length >= 3);
  });

  /* ── Auth ── */
  const badLogin = await req(server, 'POST', '/api/auth/login', { username: 'tester', password: 'nope' });
  check('login with a wrong password is rejected', () => assert.strictEqual(badLogin.status, 401));

  const login = await req(server, 'POST', '/api/auth/login', { username: 'tester', password: 'test-pass-123' });
  check('login with the right password returns a token', () => {
    assert.strictEqual(login.status, 200);
    assert.ok(login.body.token, 'token missing');
  });
  const token = login.body.token;

  const noAuth = await req(server, 'GET', '/api/keys');
  check('admin routes reject anonymous callers', () => assert.strictEqual(noAuth.status, 401));

  const badToken = await req(server, 'GET', '/api/keys', null, 'forged.token');
  check('admin routes reject a forged token', () => assert.strictEqual(badToken.status, 401));

  const me = await req(server, 'GET', '/api/auth/me', null, token);
  check('GET /api/auth/me identifies the caller', () => assert.strictEqual(me.body.user, 'tester'));

  /* ── Minting ── */
  const mint = await req(server, 'POST', '/api/keys', { plan: 'pro', days: 30, note: 'Tester', email: 't@x.io' }, token);
  check('POST /api/keys mints a DANGER- prefixed key', () => {
    assert.strictEqual(mint.status, 201);
    assert.match(mint.body.key, /^DANGER-[A-Z2-9]{6}-[A-Z2-9]{6}-[A-Z2-9]{6}$/);
  });
  const key = mint.body.key;

  const bulk = await req(server, 'POST', '/api/keys', { plan: 'elite', days: 0, count: 3 }, token);
  check('POST /api/keys with count mints several keys', () => {
    assert.strictEqual(bulk.body.count, 3);
    assert.strictEqual(bulk.body.keys.length, 3);
  });

  /* ── Buyer-side verification ── */
  const v1 = await req(server, 'POST', '/api/verify', { key, deviceId: 'device-A' });
  check('a fresh key verifies and binds the device', () => {
    assert.strictEqual(v1.body.valid, true);
    assert.strictEqual(v1.body.deviceId, 'device-A');
    assert.deepStrictEqual(v1.body.features, ['all']);
  });

  const messy = await req(server, 'POST', '/api/verify', { key: key.toLowerCase().replace(/-/g, ''), deviceId: 'device-A' });
  check('verification tolerates lowercase / missing dashes', () => assert.strictEqual(messy.body.valid, true));

  const otherDev = await req(server, 'POST', '/api/verify', { key, deviceId: 'device-B' });
  check('a second device is rejected with code DEVICE', () => {
    assert.strictEqual(otherDev.status, 401);
    assert.strictEqual(otherDev.body.code, 'DEVICE');
  });

  const injector = await req(server, 'POST', '/api/injector', { key, deviceId: 'device-A' });
  check('/api/injector releases the engine for a valid key', () => {
    assert.strictEqual(injector.status, 200);
    assert.ok(injector.body.code.length > 100, 'engine code missing');
  });

  const session = await req(server, 'POST', '/api/session', { key, deviceId: 'device-A' });
  check('/api/session issues a signed license token', () => assert.ok(session.body.token));

  const refreshed = await req(server, 'POST', '/api/session/refresh', { token: session.body.token, key });
  check('/api/session/refresh renews the token', () => {
    assert.strictEqual(refreshed.body.valid, true);
    assert.ok(refreshed.body.token);
  });

  /* ── Revoke ── */
  const rev = await req(server, 'POST', '/api/keys/' + key + '/revoke', {}, token);
  check('revoke succeeds', () => assert.strictEqual(rev.body.record.status, 'revoked'));

  const vRev = await req(server, 'POST', '/api/verify', { key, deviceId: 'device-A' });
  check('a revoked key fails verification with code REVOKED', () => {
    assert.strictEqual(vRev.status, 401);
    assert.strictEqual(vRev.body.code, 'REVOKED');
  });

  const injRev = await req(server, 'POST', '/api/injector', { key, deviceId: 'device-A' });
  check('a revoked key gets NO engine code', () => assert.strictEqual(injRev.status, 401));

  const reAct = await req(server, 'POST', '/api/keys/' + key + '/activate', {}, token);
  check('activate restores a revoked key', () => assert.strictEqual(reAct.body.record.status, 'active'));

  /* ── Unbind ── */
  const unb = await req(server, 'POST', '/api/keys/' + key + '/unbind', {}, token);
  check('unbind clears the bound device', () => assert.strictEqual(unb.body.record.deviceId, null));

  const vOther = await req(server, 'POST', '/api/verify', { key, deviceId: 'device-B' });
  check('after unbind the key works on a different device', () => {
    assert.strictEqual(vOther.body.valid, true);
    assert.strictEqual(vOther.body.deviceId, 'device-B');
  });

  /* ── Edit / extend ── */
  const patch = await req(server, 'PATCH', '/api/keys/' + key, { plan: 'lifetime', note: 'VIP buyer' }, token);
  check('PATCH /api/keys edits plan + note', () => {
    assert.strictEqual(patch.body.record.plan, 'lifetime');
    assert.strictEqual(patch.body.record.note, 'VIP buyer');
  });

  const ext = await req(server, 'POST', '/api/keys/' + key + '/extend', { days: 10, fromNow: true }, token);
  check('extend pushes the expiry out by 10 days', () => {
    const days = Math.round((ext.body.record.expiresAt - Date.now()) / 864e5);
    assert.strictEqual(days, 10);
  });

  const extZero = await req(server, 'POST', '/api/keys/' + key + '/extend', { days: 0 }, token);
  check('extend with days=0 makes a key lifetime', () => assert.strictEqual(extZero.body.record.expiresAt, null));

  /* ── Bulk ── */
  const bulkRev = await req(server, 'POST', '/api/keys/bulk', { action: 'revoke', keys: bulk.body.keys }, token);
  check('bulk revoke hits every key in the batch', () => assert.strictEqual(bulkRev.body.count, 3));

  const bulkAct = await req(server, 'POST', '/api/keys/bulk', { action: 'activate', keys: bulk.body.keys }, token);
  check('bulk activate restores them', () => assert.strictEqual(bulkAct.body.count, 3));

  const badAction = await req(server, 'POST', '/api/keys/bulk', { action: 'explode', keys: bulk.body.keys }, token);
  check('bulk rejects an unknown action', () => assert.strictEqual(badAction.status, 400));

  /* ── Delete ── */
  const del = await req(server, 'POST', '/api/keys/' + key + '/delete', {}, token);
  check('delete soft-deletes the key', () => assert.strictEqual(del.status, 200));

  const gone = await req(server, 'GET', '/api/keys/' + key, null, token);
  check('a deleted key is no longer found', () => assert.strictEqual(gone.status, 404));

  const delAgain = await req(server, 'POST', '/api/keys/' + key + '/delete', {}, token);
  check('deleting a missing key returns 404', () => assert.strictEqual(delAgain.status, 404));

  /* ── Stats + audit ── */
  const stats = await req(server, 'GET', '/api/stats', null, token);
  check('GET /api/stats returns counts + a 14-day series', () => {
    assert.strictEqual(stats.body.series.length, 14);
    assert.ok(stats.body.counts.total >= 3);
    assert.ok(stats.body.byPlan);
  });

  const audit = await req(server, 'GET', '/api/audit?limit=100', null, token);
  check('GET /api/audit returns the action trail', () => {
    assert.ok(audit.body.length > 5, 'expected several audit rows');
    assert.ok(audit.body.some((a) => a.action === 'key.revoke'));
  });

  /* ── Password change ── */
  const wrongPw = await req(server, 'POST', '/api/auth/password', { current: 'wrong', next: 'brand-new-pass' }, token);
  check('password change rejects a wrong current password', () => assert.strictEqual(wrongPw.status, 400));

  const shortPw = await req(server, 'POST', '/api/auth/password', { current: 'test-pass-123', next: 'short' }, token);
  check('password change enforces a minimum length', () => assert.strictEqual(shortPw.status, 400));

  const newPw = await req(server, 'POST', '/api/auth/password', { current: 'test-pass-123', next: 'brand-new-pass' }, token);
  check('password change succeeds', () => assert.strictEqual(newPw.status, 200));

  const oldToken = await req(server, 'GET', '/api/keys', null, token);
  check('changing the password kills existing sessions', () => assert.strictEqual(oldToken.status, 401));

  const relogin = await req(server, 'POST', '/api/auth/login', { username: 'tester', password: 'brand-new-pass' });
  check('login works with the new password', () => assert.strictEqual(relogin.status, 200));

  /* ── Lockout ── */
  let locked = false;
  for (let i = 0; i < 8 && !locked; i++) {
    const r = await req(server, 'POST', '/api/auth/login', { username: 'tester', password: 'bad-' + i });
    if (r.body.locked || /locked/i.test(r.body.error || '')) locked = true;
  }
  check('repeated bad logins eventually lock the account', () => assert.ok(locked));

  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

  console.log('  ' + '\u2500'.repeat(52));
  console.log(`  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('\n  Smoke test crashed:', e && e.stack);
  process.exit(1);
});
