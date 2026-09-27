/**
 * DANGER MIC KEY — license store (SQLite, zero external DB)
 * ═══════════════════════════════════════════════════════════════════════
 * Owns every persistence concern:
 *   • admin accounts  — scrypt password hashes, lockout, last-login
 *   • license keys    — plan, expiry, device binding, lifecycle state
 *   • audit trail     — every admin action + every key state change
 *   • daily analytics — mints / verifications per day for the dashboard
 *   • signed tokens   — admin panel sessions + buyer license sessions
 *
 * node:sqlite is synchronous, so everything here is sync and the Express
 * layer just `await`s (a no-op) which keeps the API trivially correct.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

/* ─── Brand + configuration ─────────────────────────────────────────── */
const BRAND          = 'DANGER MIC KEY';
const KEY_PREFIX     = (process.env.KEY_PREFIX || 'DANGER').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DANGER';
const KEY_BLOCKS     = Math.max(2, Number(process.env.KEY_BLOCKS) || 3);
const KEY_BLOCK_LEN  = Math.max(4, Number(process.env.KEY_BLOCK_LEN) || 6);

const ADMIN_USER     = process.env.ADMIN_USER || 'danger';
const ADMIN_PASS     = process.env.ADMIN_PASS || 'DANGER@123';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 120000;            // buyer heartbeat
const ADMIN_TTL_MS   = Number(process.env.ADMIN_SESSION_TTL_MS) || 12 * 3600e3; // panel login
const LOGIN_MAX_FAIL = Number(process.env.LOGIN_MAX_FAILURES) || 5;
const LOGIN_LOCK_MS  = Number(process.env.LOGIN_LOCK_MS) || 15 * 60e3;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'danger.db');

/* Feature tiers. 'pro' keeps full backwards compatibility with older
   extension builds because it is the historical "unlock everything" plan. */
const PLANS = {
  pro:      { label: 'Pro',      days: 30,  features: ['all'] },
  elite:    { label: 'Elite',    days: 90,  features: ['all', 'priority'] },
  lifetime: { label: 'Lifetime', features: ['all', 'priority', 'lifetime'] },
};
const DEFAULT_PLAN = 'pro';
const FEATURES = { pro: ['all'], elite: ['all', 'priority'], lifetime: ['all', 'priority', 'lifetime'] };

/* Keys re-created on every boot (Render's free tier has an ephemeral disk). */
const SEED = (process.env.SEED_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);

/* Crockford-ish alphabet: no 0/O/1/I/L so a buyer can never mistype a key. */
const ALPHA = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

let db = null;
let SESSION_SECRET = process.env.SESSION_SECRET || '';

/* ─── Small helpers ─────────────────────────────────────────────────── */
const DAY_MS = 86400000;
const b64u = (s) => Buffer.from(String(s)).toString('base64url');
const b64d = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

function dayKey(ts) { return new Date(ts == null ? Date.now() : ts).toISOString().slice(0, 10); }
function block() {
  const bytes = crypto.randomBytes(KEY_BLOCK_LEN);
  let out = '';
  for (let i = 0; i < KEY_BLOCK_LEN; i++) out += ALPHA[bytes[i] % ALPHA.length];
  return out;
}
function genKey() {
  const parts = [];
  for (let i = 0; i < KEY_BLOCKS; i++) parts.push(block());
  return [KEY_PREFIX].concat(parts).join('-');
}

/** Accept messy buyer input: lowercase, spaces, or the dashes typed out. */
function normalizeKey(k) {
  const s = String(k == null ? '' : k).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  if (s.startsWith(KEY_PREFIX) && s.length > KEY_PREFIX.length) {
    const body = s.slice(KEY_PREFIX.length);
    if (body.length === KEY_BLOCKS * KEY_BLOCK_LEN) {
      const parts = [];
      for (let i = 0; i < KEY_BLOCKS; i++) parts.push(body.slice(i * KEY_BLOCK_LEN, (i + 1) * KEY_BLOCK_LEN));
      return KEY_PREFIX + '-' + parts.join('-');
    }
    return KEY_PREFIX + '-' + body;
  }
  return s;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pw), salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + dk.toString('hex');
}
function verifyPassword(pw, stored) {
  try {
    const [alg, saltHex, hashHex] = String(stored || '').split('$');
    if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
    const want = Buffer.from(hashHex, 'hex');
    const got = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), want.length);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch (_) { return false; }
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a == null ? '' : a));
  const y = Buffer.from(String(b == null ? '' : b));
  if (x.length !== y.length || !x.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/* ─── Schema ────────────────────────────────────────────────────────── */
function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      username      TEXT PRIMARY KEY,
      pass_hash     TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'owner',
      created_at    INTEGER NOT NULL,
      last_login_at INTEGER,
      last_login_ip TEXT,
      failed_count  INTEGER NOT NULL DEFAULT 0,
      locked_until  INTEGER,
      token_version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS keys (
      key              TEXT PRIMARY KEY,
      plan             TEXT NOT NULL DEFAULT 'pro',
      created_at       INTEGER NOT NULL,
      expires_at       INTEGER,
      active           INTEGER NOT NULL DEFAULT 1,
      device_id        TEXT,
      note             TEXT,
      email            TEXT,
      verifications    INTEGER NOT NULL DEFAULT 0,
      last_verified_at INTEGER,
      revoked_at       INTEGER,
      deleted_at       INTEGER
    );

    CREATE TABLE IF NOT EXISTS audit (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      at     INTEGER NOT NULL,
      actor  TEXT,
      action TEXT NOT NULL,
      key    TEXT,
      detail TEXT,
      ip     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at  ON audit(at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_key ON audit(key);

    CREATE TABLE IF NOT EXISTS daily_stats (
      day           TEXT PRIMARY KEY,
      mints         INTEGER NOT NULL DEFAULT 0,
      verifications INTEGER NOT NULL DEFAULT 0,
      rejects       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  /* Additive migrations so an older database upgrades in place. */
  const cols = db.prepare('PRAGMA table_info(keys)').all().map((c) => c.name);
  for (const col of ['email', 'revoked_at', 'deleted_at']) {
    if (!cols.includes(col)) db.exec('ALTER TABLE keys ADD COLUMN ' + col + (col === 'email' ? ' TEXT' : ' INTEGER'));
  }

  /* The owner account is seeded once; the password is only ever stored hashed. */
  if (!db.prepare('SELECT username FROM admins WHERE username = ?').get(ADMIN_USER)) {
    db.prepare("INSERT INTO admins (username, pass_hash, role, created_at) VALUES (?, ?, 'owner', ?)")
      .run(ADMIN_USER, hashPassword(ADMIN_PASS), Date.now());
  }

  /* Secret is persisted so restarts don't invalidate live panel sessions. */
  if (!SESSION_SECRET) {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'session_secret'").get();
    SESSION_SECRET = row && row.value ? row.value : crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('session_secret', ?)").run(SESSION_SECRET);
  }

  for (const k of SEED) {
    const rec = get(k);
    if (rec) { rec.active = true; rec.deletedAt = null; upsert(rec); }
    else { const f = freshRecord(PLANS[DEFAULT_PLAN].days, 'seeded on boot'); f.key = normalizeKey(k); upsert(f); }
  }
  db.exec("DELETE FROM keys WHERE key IS NULL OR key = ''");
  return db;
}

/* ─── Key records ───────────────────────────────────────────────────── */
function freshRecord(days, note, plan) {
  return {
    key: null,
    plan: plan || DEFAULT_PLAN,
    createdAt: Date.now(),
    expiresAt: days && days > 0 ? Date.now() + days * DAY_MS : null,
    active: true,
    deviceId: null,
    note: note || null,
    email: null,
    verifications: 0,
    lastVerifiedAt: null,
    revokedAt: null,
    deletedAt: null,
  };
}

function rowToRec(r) {
  if (!r) return null;
  return {
    key: r.key,
    plan: r.plan,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    active: !!r.active,
    deviceId: r.device_id,
    note: r.note,
    email: r.email,
    verifications: r.verifications,
    lastVerifiedAt: r.last_verified_at,
    revokedAt: r.revoked_at,
    deletedAt: r.deleted_at,
  };
}

function get(k) {
  if (!db) return null;
  const n = normalizeKey(k);
  if (!n) return null;
  const rec = rowToRec(db.prepare('SELECT * FROM keys WHERE key = ?').get(n));
  return rec && rec.deletedAt ? null : rec;
}

function upsert(rec) {
  db.prepare(`
    INSERT INTO keys (key, plan, created_at, expires_at, active, device_id, note, email,
                      verifications, last_verified_at, revoked_at, deleted_at)
    VALUES (@key, @plan, @createdAt, @expiresAt, @active, @deviceId, @note, @email,
            @verifications, @lastVerifiedAt, @revokedAt, @deletedAt)
    ON CONFLICT(key) DO UPDATE SET
      plan=excluded.plan, expires_at=excluded.expires_at, active=excluded.active,
      device_id=excluded.device_id, note=excluded.note, email=excluded.email,
      verifications=excluded.verifications, last_verified_at=excluded.last_verified_at,
      revoked_at=excluded.revoked_at, deleted_at=excluded.deleted_at
  `).run({
    key: rec.key, plan: rec.plan, createdAt: rec.createdAt, expiresAt: rec.expiresAt,
    active: rec.active ? 1 : 0, deviceId: rec.deviceId || null, note: rec.note || null,
    email: rec.email || null, verifications: rec.verifications || 0,
    lastVerifiedAt: rec.lastVerifiedAt || null, revokedAt: rec.revokedAt || null,
    deletedAt: rec.deletedAt || null,
  });
}

function bumpStat(field, day) {
  db.prepare(`INSERT INTO daily_stats (day, ${field}) VALUES (?, 1)
              ON CONFLICT(day) DO UPDATE SET ${field} = ${field} + 1`).run(day || dayKey());
}

/** Mint a brand-new license key that you hand to a buyer. */
function create({ plan = DEFAULT_PLAN, days, note = '', email = '' } = {}) {
  const p = PLANS[plan] ? plan : DEFAULT_PLAN;
  const d = (days === undefined || days === null || days === '')
    ? PLANS[p].days
    : Math.max(0, parseInt(days, 10) || 0);
  let k;
  do { k = genKey(); } while (get(k));
  const rec = freshRecord(d, note, p);
  rec.key = k;
  if (email) rec.email = String(email).trim();
  upsert(rec);
  bumpStat('mints');
  return { key: k, record: decorate(get(k)) };
}

/* ─── Verification (called by the buyer's extension) ───────────────── */
function verify(key, deviceId) {
  const rec = get(key);
  if (!rec) { bumpStat('rejects'); return { valid: false, code: 'INVALID', message: 'Invalid license key.' }; }
  if (!rec.active) { bumpStat('rejects'); return { valid: false, code: 'REVOKED', message: 'This license key has been revoked.' }; }
  if (rec.expiresAt && Date.now() > rec.expiresAt) {
    bumpStat('rejects');
    return { valid: false, code: 'EXPIRED', message: 'This license key has expired.' };
  }
  if (rec.deviceId && deviceId && rec.deviceId !== deviceId) {
    bumpStat('rejects');
    return { valid: false, code: 'DEVICE', message: 'This license key is already activated on another device.' };
  }
  if (!rec.deviceId && deviceId) rec.deviceId = deviceId;
  rec.lastVerifiedAt = Date.now();
  rec.verifications = (rec.verifications || 0) + 1;
  upsert(rec);
  bumpStat('verifications');

  return {
    valid: true,
    code: 'OK',
    message: 'License validated.',
    plan: rec.plan,
    features: FEATURES[rec.plan] || FEATURES[DEFAULT_PLAN],
    powers: FEATURES[rec.plan] || FEATURES[DEFAULT_PLAN],
    expiresAt: rec.expiresAt,
    deviceId: rec.deviceId || deviceId || null,
  };
}

/* ─── Lifecycle: revoke / activate / unbind / delete ───────────────── */
function statusOf(rec) {
  if (!rec) return 'missing';
  if (rec.deletedAt) return 'deleted';
  if (!rec.active) return 'revoked';
  if (rec.expiresAt && Date.now() > rec.expiresAt) return 'expired';
  return 'active';
}

/** Kill a buyer's powers. Idempotent. */
function revoke(k) {
  const rec = get(k);
  if (!rec) return false;
  if (!rec.active) return true;
  rec.active = false;
  rec.revokedAt = Date.now();
  upsert(rec);
  return true;
}

/** Undo a revoke. Fails if the key is already expired. */
function activate(k) {
  const rec = get(k);
  if (!rec) return false;
  if (rec.expiresAt && Date.now() > rec.expiresAt) return false;
  rec.active = true;
  rec.revokedAt = null;
  upsert(rec);
  return true;
}

/** Free the key from its device so it can activate elsewhere. */
function unbind(k) {
  const rec = get(k);
  if (!rec) return false;
  if (!rec.deviceId) return true;
  rec.deviceId = null;
  upsert(rec);
  return true;
}

/** Soft-delete: the row is retained so the audit trail keeps its context.
    `get()` hides it and `purgeDeleted()` is the only thing that erases it. */
function remove(k) {
  const rec = get(k);
  if (!rec) return false;
  if (rec.deletedAt) return true;
  rec.deletedAt = Date.now();
  rec.active = false;
  upsert(rec);
  return true;
}

/** Extend / shorten the expiry (from now, or from the current expiry). */
function extend(k, days, fromNow) {
  const rec = get(k);
  if (!rec) return null;
  const n = parseInt(days, 10);
  if (isNaN(n)) return null;
  if (n === 0) { rec.expiresAt = null; upsert(rec); return decorate(rec); }   // back to lifetime
  const base = fromNow ? Date.now() : Math.max(Date.now(), rec.expiresAt || Date.now());
  rec.expiresAt = base + n * DAY_MS;
  upsert(rec);
  return decorate(rec);
}

/** Edit the mutable metadata of a key. */
function edit(k, { plan, note, email } = {}) {
  const rec = get(k);
  if (!rec) return null;
  if (plan && PLANS[plan]) rec.plan = plan;
  if (note !== undefined) rec.note = String(note || '').trim() || null;
  if (email !== undefined) rec.email = String(email || '').trim() || null;
  upsert(rec);
  return decorate(rec);
}

/** Permanently purge soft-deleted rows (housekeeping). */
function purgeDeleted() {
  return Number(db.prepare('DELETE FROM keys WHERE deleted_at IS NOT NULL').run().changes || 0);
}

/* ─── Bulk + listing ────────────────────────────────────────────────── */
function runBulk(keys, fn) {
  const list = (Array.isArray(keys) ? keys : [keys]).map(normalizeKey).filter(Boolean);
  const ok = [], failed = [];
  for (const k of list) (fn(k) ? ok : failed).push(k);
  return { ok, failed, count: ok.length, requested: list.length };
}

const BULK_ACTIONS = { revoke, activate, unbind, delete: remove };

/** Apply one lifecycle action to many keys at once. */
function bulk(action, keys) {
  const fn = BULK_ACTIONS[action];
  if (!fn) return null;
  const res = runBulk(keys, fn);
  res.action = action;
  return res;
}

/** Attach the derived fields the API/UI relies on (status, plan label, days left). */
function decorate(rec) {
  if (!rec) return null;
  return {
    ...rec,
    status: statusOf(rec),
    planLabel: (PLANS[rec.plan] || PLANS[DEFAULT_PLAN]).label,
    daysLeft: rec.expiresAt ? Math.max(0, Math.ceil((rec.expiresAt - Date.now()) / DAY_MS)) : null,
  };
}

/** Fetch one key with its derived fields (status / planLabel / daysLeft). */
function getDetailed(k) { return decorate(get(k)); }

/** Key list with a derived status; soft-deleted rows are hidden by default. */
function list({ includeDeleted = false } = {}) {
  const rows = includeDeleted
    ? db.prepare('SELECT * FROM keys ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM keys WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
  return rows.map((r) => decorate(rowToRec(r)));
}

/* ─── Analytics ─────────────────────────────────────────────────────── */
function stats(days) {
  const span = Math.max(1, Math.min(90, parseInt(days, 10) || 14));
  const all = list({ includeDeleted: true });
  const live = all.filter((k) => k.status !== 'deleted');
  const now = Date.now();

  const buckets = [];
  for (let i = span - 1; i >= 0; i--) buckets.push({ day: dayKey(now - i * DAY_MS), mints: 0, verifications: 0, rejects: 0 });
  const byDay = new Map(buckets.map((b) => [b.day, b]));
  for (const row of db.prepare('SELECT * FROM daily_stats').all()) {
    const b = byDay.get(row.day);
    if (b) { b.mints = row.mints; b.verifications = row.verifications; b.rejects = row.rejects; }
  }

  const counts = { total: live.length, active: 0, expired: 0, revoked: 0, bound: 0, deleted: all.length - live.length };
  const byPlan = {};
  for (const k of live) {
    if (k.status === 'active') counts.active++;
    else if (k.status === 'expired') counts.expired++;
    else if (k.status === 'revoked') counts.revoked++;
    if (k.deviceId) counts.bound++;
    byPlan[k.plan] = (byPlan[k.plan] || 0) + 1;
  }

  return {
    counts,
    byPlan,
    series: buckets,
    expiringSoon: live
      .filter((k) => k.status === 'active' && k.expiresAt && k.expiresAt - now < 7 * DAY_MS)
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .slice(0, 8)
      .map((k) => ({ key: k.key, note: k.note, expiresAt: k.expiresAt, daysLeft: k.daysLeft })),
    totalVerifications: live.reduce((s, k) => s + (k.verifications || 0), 0),
    onlineDevices: counts.bound,
    serverTime: now,
    uptimeSec: Math.round(process.uptime()),
  };
}

/* ─── Audit log ─────────────────────────────────────────────────────── */
function audit({ actor = 'admin', action, key = null, detail = null, ip = null } = {}) {
  db.prepare('INSERT INTO audit (at, actor, action, key, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Date.now(), actor, action, key, detail ? String(detail).slice(0, 500) : null, ip);
}

function auditList({ limit = 60, key = null } = {}) {
  const n = Math.max(1, Math.min(500, parseInt(limit, 10) || 60));
  return key
    ? db.prepare('SELECT * FROM audit WHERE key = ? ORDER BY at DESC LIMIT ?').all(normalizeKey(key), n)
    : db.prepare('SELECT * FROM audit ORDER BY at DESC LIMIT ?').all(n);
}

function clearAudit() { return Number(db.prepare('DELETE FROM audit').run().changes || 0); }

/* ─── Admin authentication ──────────────────────────────────────────── */
function adminRow(username) {
  if (!db || !username) return null;
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username)) || null;
}

/** Password login with progressive lockout, and constant-ish timing. */
function adminLogin(username, password, ip) {
  const row = adminRow(username);
  if (!row) {
    /* Burn comparable time so a missing user isn't detectable by timing. */
    crypto.scryptSync(String(password || ''), 'decoy-salt-value', 64);
    return { ok: false, error: 'Invalid credentials.' };
  }
  if (row.locked_until && row.locked_until > Date.now()) {
    const secs = Math.ceil((row.locked_until - Date.now()) / 1000);
    return { ok: false, error: `Account locked. Try again in ${secs}s.`, locked: true, retryAfter: secs };
  }
  if (!verifyPassword(password, row.pass_hash)) {
    const failed = (row.failed_count || 0) + 1;
    const lock = failed >= LOGIN_MAX_FAIL ? Date.now() + LOGIN_LOCK_MS : null;
    db.prepare('UPDATE admins SET failed_count = ?, locked_until = ? WHERE username = ?')
      .run(failed, lock, row.username);
    if (lock) audit({ actor: row.username, action: 'auth.lockout', detail: 'too many failed logins', ip });
    return {
      ok: false,
      error: lock
        ? `Too many failed attempts. Locked for ${Math.round(LOGIN_LOCK_MS / 60000)} minutes.`
        : `Invalid credentials. ${LOGIN_MAX_FAIL - failed} attempt(s) left.`,
      remaining: lock ? 0 : LOGIN_MAX_FAIL - failed,
    };
  }
  db.prepare('UPDATE admins SET failed_count = 0, locked_until = NULL, last_login_at = ?, last_login_ip = ? WHERE username = ?')
    .run(Date.now(), ip || null, row.username);
  audit({ actor: row.username, action: 'auth.login', ip });
  return { ok: true, user: row.username, role: row.role, exp: Date.now() + ADMIN_TTL_MS, tv: row.token_version };
}

/** Change the admin password (requires the current one). */
function adminChangePassword(username, current, next) {
  const row = adminRow(username);
  if (!row) return { ok: false, error: 'Account not found.' };
  if (!verifyPassword(current, row.pass_hash)) {
    audit({ actor: username, action: 'auth.password_change_denied' });
    return { ok: false, error: 'Current password is incorrect.' };
  }
  if (!next || String(next).length < 8) return { ok: false, error: 'New password must be at least 8 characters.' };
  if (safeEqual(current, next)) return { ok: false, error: 'New password must be different from the current one.' };
  /* Bump token_version so every existing session dies immediately. */
  db.prepare('UPDATE admins SET pass_hash = ?, token_version = token_version + 1 WHERE username = ?')
    .run(hashPassword(next), username);
  audit({ actor: username, action: 'auth.password_changed' });
  return { ok: true };
}

/* ─── Signed tokens (admin panel + buyer licenses) ──────────────────── */
function signSession({ key, deviceId, plan, exp }) {
  const body = b64u(JSON.stringify({ key, dev: deviceId, plan, exp }));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function parseSession(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expect = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    if (!safeEqual(expect, sig)) return null;
    const payload = JSON.parse(b64d(body));
    if (!payload || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) { return null; }
}

/** Panel token: {sub, role, exp, tv}; `tv` is checked against the DB. */
function signAdmin({ user, role, exp, tv }) {
  const body = b64u(JSON.stringify({ sub: user, role, exp, tv }));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function parseAdmin(token) {
  const payload = parseSession(token);
  if (!payload || !payload.sub) return null;
  const row = adminRow(payload.sub);
  if (!row) return null;
  if ((row.token_version || 1) !== (payload.tv || 1)) return null;
  if (row.locked_until && row.locked_until > Date.now()) return null;
  return { user: row.username, role: row.role, exp: payload.exp };
}

module.exports = {
  /* config */
  BRAND, KEY_PREFIX, PLANS, DEFAULT_PLAN, ADMIN_USER, ADMIN_TTL_MS, SESSION_TTL_MS,
  LOGIN_MAX_FAIL, DB_FILE, DATA_DIR,
  /* lifecycle */
  init, create, get, getDetailed, list, verify, statusOf, revoke, activate, unbind, remove, extend, edit, bulk, purgeDeleted,
  /* analytics + audit */
  stats, audit, auditList, clearAudit,
  /* auth */
  adminLogin, adminChangePassword, signAdmin, parseAdmin, signSession, parseSession,
  /* utils */
  normalizeKey, genKey, dayKey,
};

