/**
 * DANGER MIC KEY — license / auth API  (host on Render, Railway, Fly, or locally)
 * ══════════════════════════════════════════════════════════════════════
 * BUYER-FACING (no auth — the extension calls these)
 *   POST /api/verify            { key, deviceId }   → validate a key
 *   POST /api/session           { key, deviceId }   → short-lived signed token
 *   POST /api/session/refresh   { token, key }      → re-check before expiry
 *   POST /api/injector          { key, deviceId }   → engine source (valid keys only)
 *
 * ADMIN (Bearer token from POST /api/auth/login)
 *   POST   /api/auth/login | /api/auth/logout | /api/auth/password
 *   GET    /api/auth/me
 *   GET    /api/keys | /api/stats | /api/audit
 *   POST   /api/keys                      → mint one or many
 *   POST   /api/keys/:key/revoke|activate|unbind|delete
 *   POST   /api/keys/bulk                 → { action, keys[] }
 *   PATCH  /api/keys/:key                 → plan / note / email
 *   POST   /api/keys/:key/extend          → { days, fromNow }
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
const VERSION = require('./package.json').version;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '64kb' }));

/* Security headers. The panel is fully self-hosted (no CDN), so a strict
   CSP costs nothing and meaningfully hardens the admin surface. */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/* Engine source is read ONCE at boot and served from memory (no disk I/O per
   request). It is never shipped to buyers — only a valid key unlocks it. */
const ENGINE_FILES = [path.join(__dirname, 'payload.js'), path.join(__dirname, 'sources', 'injector.js')];
let ENGINE_CODE = null;
function getEngineCode() {
  if (ENGINE_CODE) return ENGINE_CODE;
  for (const f of ENGINE_FILES) {
    try {
      if (fs.existsSync(f)) { ENGINE_CODE = fs.readFileSync(f, 'utf8'); break; }
    } catch (_) {}
  }
  return ENGINE_CODE;
}
getEngineCode();

/* ─── Helpers ───────────────────────────────────────────────────────── */
const ip = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;
const err = (res, code, message) => res.status(code).json({ ok: false, error: message });

/** Extract the panel token from the Authorization header or a query/body field. */
function readToken(req) {
  const h = req.headers.authorization || '';
  if (/^Bearer /i.test(h)) return h.slice(7).trim();
  if (req.headers['x-admin-token']) return String(req.headers['x-admin-token']);
  return (req.body && req.body.token) || (req.query && req.query.token) || '';
}

/** Gate every admin route. Attaches req.admin = { user, role, exp }. */
function requireAdmin(req, res, next) {
  const session = store.parseAdmin(readToken(req));
  if (!session) return err(res, 401, 'Unauthorized: session missing, expired or invalid.');
  req.admin = session;
  next();
}

/** Log an admin action to the audit trail. */
function log(req, action, key, detail) {
  store.audit({ actor: req.admin ? req.admin.user : 'system', action, key, detail, ip: ip(req) });
}

/* ─── Meta ──────────────────────────────────────────────────────────── */
app.get('/', (_req, res) => res.json({ name: store.BRAND, status: 'ok', version: VERSION, time: Date.now() }));
app.get('/healthz', (_req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()), time: Date.now() }));

/** Public brand/config info the extension can read to render its lock screen. */
app.get('/api/info', (_req, res) => res.json({
  brand: store.BRAND,
  keyPrefix: store.KEY_PREFIX,
  plans: Object.entries(store.PLANS).map(([id, p]) => ({ id, ...p })),
  sessionTtlMs: store.SESSION_TTL_MS,
}));

/* ─── Admin authentication ──────────────────────────────────────────── */
/** Legacy alias so older tooling that posts to /api/login still works. */
const loginHandler = (req, res) => {
  const { username, password } = req.body || {};
  const result = store.adminLogin(username, password, ip(req));
  if (!result.ok) return err(res, 401, result.error);
  const token = store.signAdmin({ user: result.user, role: result.role, exp: result.exp, tv: result.tv });
  res.json({ ok: true, token, user: result.user, role: result.role, expiresAt: result.exp });
};
app.post('/api/auth/login', loginHandler);
app.post('/api/login', loginHandler);

app.post('/api/auth/logout', requireAdmin, (req, res) => {
  log(req, 'auth.logout');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({ ok: true, user: req.admin.user, role: req.admin.role, expiresAt: req.admin.exp });
});

app.post('/api/auth/password', requireAdmin, (req, res) => {
  const { current, next } = req.body || {};
  const result = store.adminChangePassword(req.admin.user, current, next);
  if (!result.ok) return err(res, 400, result.error);
  log(req, 'auth.password_changed');
  res.json({ ok: true, message: 'Password updated. All other sessions were signed out.' });
});

/* ─── Buyer-facing: license verification & engine release ──────────── */
app.post('/api/verify', (req, res) => {
  const { key, deviceId } = req.body || {};
  const result = store.verify(key, deviceId);
  res.status(result.valid ? 200 : 401).json(result);
});

app.post('/api/session', (req, res) => {
  const { key, deviceId } = req.body || {};
  const result = store.verify(key, deviceId);
  if (!result.valid) return res.status(401).json(result);
  const exp = Date.now() + store.SESSION_TTL_MS;
  const token = store.signSession({
    key: store.normalizeKey(key),
    deviceId: result.deviceId,
    plan: result.plan,
    exp,
  });
  res.json({ valid: true, token, plan: result.plan, features: result.features, expiresAt: result.expiresAt, ttlMs: store.SESSION_TTL_MS });
});

app.post('/api/session/refresh', (req, res) => {
  const { token, key } = req.body || {};
  const payload = store.parseSession(token);
  if (!payload) return res.status(401).json({ valid: false, code: 'BADTOKEN', message: 'Session expired or invalid.' });
  if (String(payload.key) !== store.normalizeKey(key)) {
    return res.status(401).json({ valid: false, code: 'MISMATCH', message: 'Session does not match this key.' });
  }
  /* Re-verify against the store so revocation / device binding bite at once. */
  const result = store.verify(payload.key, payload.dev);
  if (!result.valid) return res.status(401).json(result);
  const exp = Date.now() + store.SESSION_TTL_MS;
  const next = store.signSession({ key: payload.key, deviceId: payload.dev, plan: result.plan, exp });
  res.json({ valid: true, token: next, plan: result.plan, features: result.features, expiresAt: result.expiresAt, ttlMs: store.SESSION_TTL_MS });
});

/* The engine is hosted here and never shipped to buyers. Revoke the key and
   this endpoint stops returning code → the buyer loses all powers. */
app.post('/api/injector', (req, res) => {
  const { key, deviceId } = req.body || {};
  const result = store.verify(key, deviceId);
  if (!result.valid) return res.status(401).json(result);
  const code = getEngineCode();
  if (!code) return res.status(500).json({ valid: false, error: 'Engine source not found on server.' });
  res.json({ ok: true, code, plan: result.plan, expiresAt: result.expiresAt, features: result.features });
});

/* ─── Admin: keys ───────────────────────────────────────────────────── */
app.get('/api/keys', requireAdmin, (req, res) => {
  const includeDeleted = req.query.deleted === '1' || req.query.deleted === 'true';
  res.json(store.list({ includeDeleted }));
});

/** Mint one key, or `count` keys in one go (bulk sales / giveaways). */
app.post('/api/keys', requireAdmin, (req, res) => {
  const { plan, days, note = '', email = '', count = 1 } = req.body || {};
  const n = Math.max(1, Math.min(100, parseInt(count, 10) || 1));
  const made = [];
  for (let i = 0; i < n; i++) made.push(store.create({ plan, days, note, email }));
  log(req, n === 1 ? 'key.create' : 'key.bulk_create', n === 1 ? made[0].key : null,
      n === 1 ? `${plan} ${days}d` : `${n} keys · ${plan}`);
  res.status(201).json(n === 1 ? made[0] : { count: n, keys: made.map((m) => m.key), records: made.map((m) => m.record) });
});

/** Extend (or clear, with days=0) the expiry.
    Registered BEFORE /:key/:action so "extend" isn't swallowed by it. */
app.post('/api/keys/:key/extend', requireAdmin, (req, res) => {
  const { days = 0, fromNow = false } = req.body || {};
  const key = store.normalizeKey(req.params.key);
  const record = store.extend(key, days, !!fromNow);
  if (!record) return err(res, 404, `Key ${key} not found.`);
  log(req, 'key.extend', key, `${days}d${fromNow ? ' from now' : ''}`);
  res.json({ ok: true, record });
});

/** Single-key actions: /api/keys/:key/revoke | activate | unbind | delete */
const ACTIONS = {
  revoke:   { fn: store.revoke,   audit: 'key.revoke',   verb: 'revoked' },
  activate: { fn: store.activate, audit: 'key.activate', verb: 're-activated' },
  unbind:   { fn: store.unbind,   audit: 'key.unbind',   verb: 'device unbound' },
  delete:   { fn: store.remove,   audit: 'key.delete',   verb: 'deleted' },
};

app.post('/api/keys/:key/:action', requireAdmin, (req, res) => {
  const action = ACTIONS[req.params.action];
  if (!action) return err(res, 404, `Unknown action "${req.params.action}".`);
  const key = store.normalizeKey(req.params.key);
  const found = action.fn(key);
  if (!found) return err(res, 404, `Key ${key} not found, or the action is not allowed in its current state.`);
  log(req, action.audit, key, action.verb);
  res.json({ ok: true, key, action: req.params.action, record: store.getDetailed(key) });
});

/** Apply one action to many keys at once. */
app.post('/api/keys/bulk', requireAdmin, (req, res) => {
  const { action, keys } = req.body || {};
  const result = store.bulk(action, keys);
  if (!result) return err(res, 400, 'action must be one of: revoke, activate, unbind, delete.');
  if (!result.requested) return err(res, 400, 'keys[] is required.');
  log(req, 'key.bulk_' + action, null, `${result.count}/${result.requested} succeeded`);
  res.json({ ok: true, ...result });
});

/** Edit plan / note / email. */
app.patch('/api/keys/:key', requireAdmin, (req, res) => {
  const { plan, note, email } = req.body || {};
  const key = store.normalizeKey(req.params.key);
  const record = store.edit(key, { plan, note, email });
  if (!record) return err(res, 404, `Key ${key} not found.`);
  log(req, 'key.edit', key, `plan=${record.plan}`);
  res.json({ ok: true, record });
});

/** Look up one key + its full audit history. */
app.get('/api/keys/:key', requireAdmin, (req, res) => {
  const key = store.normalizeKey(req.params.key);
  const record = store.getDetailed(key);
  if (!record) return err(res, 404, `Key ${key} not found.`);
  res.json({ record, history: store.auditList({ key, limit: 50 }) });
});

/* ─── Admin: analytics + audit ──────────────────────────────────────── */
app.get('/api/stats', requireAdmin, (req, res) => res.json(store.stats(req.query.days)));

app.get('/api/audit', requireAdmin, (req, res) => {
  res.json(store.auditList({ limit: req.query.limit || 60, key: req.query.key || null }));
});

app.delete('/api/audit', requireAdmin, (req, res) => {
  const n = store.clearAudit();
  log(req, 'audit.clear', null, `${n} rows`);
  res.json({ ok: true, cleared: n });
});

/** Housekeeping: permanently erase soft-deleted keys. */
app.post('/api/keys/purge', requireAdmin, (req, res) => {
  const n = store.purgeDeleted();
  log(req, 'key.purge', null, `${n} rows`);
  res.json({ ok: true, purged: n });
});

/* ─── Errors ────────────────────────────────────────────────────────── */
app.use('/api', (_req, res) => err(res, 404, 'Unknown API endpoint.'));

/* eslint-disable-next-line no-unused-vars */
app.use((e, _req, res, _next) => {
  console.error('[danger] unhandled error:', e && e.message);
  if (res.headersSent) return;
  err(res, 500, 'Internal server error.');
});

/* ─── Keep-alive ──────────────────────────────────────────────────────
   Render's FREE tier spins the instance down after ~15 min of idle traffic
   and waking takes 40-90s. With KEEPALIVE=1 + PUBLIC_URL we ping our own
   /healthz every KEEPALIVE_MS so buyers never hit a cold start. */
function startKeepAlive() {
  const url = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (process.env.KEEPALIVE !== '1' || !url) {
    console.log('  → keep-alive : off (set KEEPALIVE=1 + PUBLIC_URL to prevent cold starts)');
    return;
  }
  const ms = Number(process.env.KEEPALIVE_MS) || 300000; // 5 min < 15 min cutoff
  const ping = () => {
    fetch(url + '/healthz')
      .then((r) => console.log('  keep-alive →', r.status === 200 ? 'warm' : 'HTTP ' + r.status))
      .catch(() => {});
  };
  ping();
  setInterval(ping, ms);
  console.log(`  → keep-alive : ON, pinging ${url}/healthz every ${ms}ms`);
}

async function start() {
  await store.init();
  const engine = getEngineCode();
  app.listen(PORT, () => {
    console.log('');
    console.log(`  ██ ${store.BRAND} — license server v${VERSION}`);
    console.log('  ──────────────────────────────────────────────');
    console.log(`  → panel     : http://localhost:${PORT}`);
    console.log(`  → storage   : ${store.DB_FILE}`);
    console.log(`  → key format: ${store.KEY_PREFIX}-XXXXXX-XXXXXX-XXXXXX`);
    console.log(`  → engine    : ${engine ? (engine.length / 1024).toFixed(1) + ' KB loaded' : 'NOT FOUND'}`);
    console.log(`  → admin user: ${store.ADMIN_USER}   (password from ADMIN_PASS)`);
    console.log(`  → plans     : ${Object.keys(store.PLANS).join(', ')}`);
    startKeepAlive();
    console.log('');
  });
}

if (require.main === module) {
  start().catch((e) => {
    console.error('[danger] failed to start:', e && e.message);
    process.exit(1);
  });
}

module.exports = { app, start };
