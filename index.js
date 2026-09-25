/**
 * OGxISAI License API  —  host this on Render
 * ─────────────────────────────────────────
 *  POST /api/verify        body { key, deviceId }     → buyer's popup verifies
 *  POST /api/keys          header x-admin-key ADMIN   → YOU mint a new key
 *  GET  /api/keys          header x-admin-key ADMIN   → list all keys
 *  POST /api/keys/revoke   body { key } + admin hdr   → kill a buyer's key
 */
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // allow the extension (running on any page) to call us
app.use(compression()); // gzip the 80KB engine payload for fast loads
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'))); // admin key page at /

/* Engine source is read ONCE at boot and served from memory (fast, no disk I/O per request). */
const ENGINE_FILE_PAYLOAD = path.join(__dirname, 'payload.js');
const ENGINE_FILE_INJECTOR = path.join(__dirname, 'sources', 'injector.js');
let ENGINE_CODE = null;
try {
  if (fs.existsSync(ENGINE_FILE_PAYLOAD)) {
    ENGINE_CODE = fs.readFileSync(ENGINE_FILE_PAYLOAD, 'utf8');
  } else if (fs.existsSync(ENGINE_FILE_INJECTOR)) {
    ENGINE_CODE = fs.readFileSync(ENGINE_FILE_INJECTOR, 'utf8');
  }
} catch (_) {}


function getEngineCode() {
  if (ENGINE_CODE) return ENGINE_CODE;
  try {
    if (fs.existsSync(ENGINE_FILE_PAYLOAD)) {
      ENGINE_CODE = fs.readFileSync(ENGINE_FILE_PAYLOAD, 'utf8');
    } else if (fs.existsSync(ENGINE_FILE_INJECTOR)) {
      ENGINE_CODE = fs.readFileSync(ENGINE_FILE_INJECTOR, 'utf8');
    }
  } catch (_) {}
  return ENGINE_CODE;
}

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] === store.ADMIN_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized: missing or bad x-admin-key.' });
}

app.get('/', (req, res) => res.json({ name: 'OGxISAI License API', status: 'ok', time: Date.now() }));
app.get('/healthz', (req, res) => res.json({ status: 'ok', time: Date.now() }));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === store.ADMIN_USER && password === store.ADMIN_PASS) {
    return res.json({ ok: true, token: store.ADMIN_KEY, user: username });
  }
  return res.status(401).json({ ok: false, error: 'Invalid admin credentials.' });
});

/* The actual powers engine is HOSTED HERE, never shipped to buyers.
   Only served after a valid key + device. Revoking the key stops this
   endpoint from returning the code → the buyer cannot load powers. */
app.post('/api/injector', async (req, res) => {
  const { key, deviceId } = req.body || {};
  const result = await store.verify(key, deviceId);
  if (!result.valid) return res.status(401).json(result);
  const code = getEngineCode();
  if (!code) return res.status(500).json({ valid: false, error: 'Engine source not found on server.' });
  res.json({ ok: true, code: code, plan: result.plan, expiresAt: result.expiresAt });
});


/* Buyers' extension posts the key here. */
app.post('/api/verify', async (req, res) => {
  const { key, deviceId } = req.body || {};
  const result = await store.verify(key, deviceId);
  res.status(result.valid ? 200 : 401).json(result);
});

/* ─── Server-authoritative session (this is what the extension uses) ───
   The client MUST refresh before the token expires. Every refresh re-checks
   the key in the store, so a revoked/expired key kills the session on the
   next heartbeat → the extension tears all powers down instantly. */

app.post('/api/session', async (req, res) => {
  const { key, deviceId } = req.body || {};
  const result = await store.verify(key, deviceId);
  if (!result.valid) return res.status(401).json(result);
  const exp = Date.now() + store.SESSION_TTL_MS;
  const token = store.signSession({
    key: (key || '').trim().toUpperCase(),
    deviceId: result.deviceId,
    plan: result.plan,
    exp,
  });
  res.json({ valid: true, token, plan: result.plan, features: result.features, expiresAt: result.expiresAt, ttlMs: store.SESSION_TTL_MS });
});

app.post('/api/session/refresh', async (req, res) => {
  const { token, key, deviceId } = req.body || {};
  const payload = store.parseSession(token);
  if (!payload) return res.status(401).json({ valid: false, code: 'BADTOKEN', message: 'Session expired or invalid.' });
  if (String(payload.key) !== String((key || '').trim().toUpperCase())) {
    return res.status(401).json({ valid: false, code: 'MISMATCH', message: 'Session does not match this key.' });
  }
  // Critical: re-verify against the store so device-binding + revocation stick immediately.
  const result = await store.verify(payload.key, payload.dev);
  if (!result.valid) return res.status(401).json(result);
  const exp = Date.now() + store.SESSION_TTL_MS;
  const next = store.signSession({ key: payload.key, deviceId: payload.dev, plan: result.plan, exp });
  res.json({ valid: true, token: next, plan: result.plan, features: result.features, expiresAt: result.expiresAt, ttlMs: store.SESSION_TTL_MS });
});

/* ── Admin only ─────────────────────────────────────────────── */
app.post('/api/keys', requireAdmin, async (req, res) => {
  const { plan = 'pro', days = 0, note = '' } = req.body || {};
  const data = await store.create({ plan, days, note });
  res.status(201).json(data);
});

app.get('/api/keys', requireAdmin, async (_req, res) => {
  res.json(await store.list());
});

app.post('/api/keys/revoke', requireAdmin, async (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required.' });
  const found = await store.revoke(key);
  return res.status(found ? 200 : 404).json({ ok: found, key });
});

app.post('/api/keys/activate', requireAdmin, async (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required.' });
  const ok = await store.activate(key);
  return res.status(ok ? 200 : 404).json({ ok, key });
});

app.post('/api/keys/unbind', requireAdmin, async (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required.' });
  const ok = await store.unbind(key);
  return res.status(ok ? 200 : 404).json({ ok, key });
});

app.post('/api/keys/delete', requireAdmin, async (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required.' });
  const ok = await store.remove(key);
  return res.status(ok ? 200 : 404).json({ ok, key });
});

async function start() {
  await store.init();
  app.listen(PORT, () => {
    console.log('OGxISAI license server running.');
    console.log(`  → port      : ${PORT}`);
    console.log('  → storage   : SQLite (server/data/keys.db)');
    console.log(`  → admin user: ${store.ADMIN_USER} (login on the / admin page)`);
    console.log(`  → ADMIN_KEY : ${store.ADMIN_KEY}`);
    console.log('  Mint a key:  curl -X POST https://<your-app>.onrender.com/api/keys -H "Content-Type: application/json" -H "x-admin-key: <ADMIN_KEY>" -d \'{"days":30}\'');
    startKeepAlive();
  });
}

/* ── Keep-alive ─────────────────────────────────────────────────────
   Render's FREE tier spins the instance down after ~15 min of no traffic,
   and waking takes 40-90s. If KEEPALIVE=1 and PUBLIC_URL is set, we ping
   our own /healthz every 5 minutes so buyers never hit a cold start.
   (A free external uptime pinger like UptimeRobot hitting the same URL
   works too and is even more reliable.) */
function startKeepAlive() {
  const on = process.env.KEEPALIVE === '1';
  const url = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (!on || !url) {
    console.log('  → keep-alive : off (set KEEPALIVE=1 + PUBLIC_URL to prevent Render cold starts)');
    return;
  }
  const ms = (Number(process.env.KEEPALIVE_MS) || 300000); // 5 min < 15 min idle cutoff
  const ping = () => { try { fetch(url + '/healthz').then((r) => console.log('keep-alive ping →', r.status === 200 ? 'warm' : ('HTTP ' + r.status))).catch(() => {}); } catch (_) {} };
  ping();
  setInterval(ping, ms);
  console.log(`keep-alive ON: pinging ${url}/healthz every ${ms}ms`);
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});