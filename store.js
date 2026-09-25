/**
 * OGxISAI License store — SQLite
 * ─────────────────────────────
 * Keys are persisted in a local SQLite file (server/data/keys.db).
 * No external database needed. On Render's free tier the disk is
 * ephemeral, so set SEED_KEYS to recreate permanent keys on every boot
 * or attach a persistent disk mounted at server/data.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ADMIN_KEY      = process.env.ADMIN_KEY || 'dev-admin-CHANGE-ME';
const ADMIN_USER     = process.env.ADMIN_USER || 'OG';
const ADMIN_PASS     = process.env.ADMIN_PASS || 'OG@098';
const SESSION_SECRET = process.env.SESSION_SECRET || ADMIN_KEY;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 120000;
/* Feature tiers: 'pro' unlocks EVERYTHING (sound quality + all powers). */
const FEATURES = { pro: ['all'] };
const SEED     = (process.env.SEED_KEYS || 'OGX-C966DD-BBA4F1-1AEBBD')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'keys.db');

let db = null;

function genKey() {
  const block = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `OGX-${block()}-${block()}-${block()}`;
}

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS keys (
      key              TEXT PRIMARY KEY,
      plan             TEXT NOT NULL DEFAULT 'pro',
      created_at       INTEGER NOT NULL,
      expires_at       INTEGER,
      active           INTEGER NOT NULL DEFAULT 1,
      device_id        TEXT,
      note             TEXT,
      verifications    INTEGER NOT NULL DEFAULT 0,
      last_verified_at INTEGER
    );
  `);
  for (const k of SEED) {
    const r = get(k);
    if (r) { r.active = 1; upsert(r); }
    else { const f = freshRecord('pro', 0, 'seed'); f.key = k; upsert(f); }
  }
  // safety: remove any accidental rows where the key ended up NULL
  db.prepare('DELETE FROM keys WHERE key IS NULL OR key = \'\'').run();
  return db;
}

function freshRecord(plan, days, note) {
  return {
    key: null, plan,
    createdAt: Date.now(),
    expiresAt: days && days > 0 ? Date.now() + days * 86400000 : null,
    active: true,
    deviceId: null,
    note: note || null,
    verifications: 0,
    lastVerifiedAt: null,
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
    verifications: r.verifications,
    lastVerifiedAt: r.last_verified_at,
  };
}

function get(k) {
  if (!db) return null;
  return rowToRec(db.prepare('SELECT * FROM keys WHERE key = ?').get(k));
}

function upsert(rec) {
  db.prepare(`
    INSERT INTO keys (key, plan, created_at, expires_at, active, device_id, note, verifications, last_verified_at)
    VALUES (@key, @plan, @createdAt, @expiresAt, @active, @deviceId, @note, @verifications, @lastVerifiedAt)
    ON CONFLICT(key) DO UPDATE SET
      plan=excluded.plan, expires_at=excluded.expires_at, active=excluded.active,
      device_id=excluded.device_id, note=excluded.note,
      verifications=excluded.verifications, last_verified_at=excluded.last_verified_at
  `).run({
    key: rec.key, plan: rec.plan, createdAt: rec.createdAt, expiresAt: rec.expiresAt,
    active: rec.active ? 1 : 0, deviceId: rec.deviceId || null, note: rec.note || null,
    verifications: rec.verifications || 0, lastVerifiedAt: rec.lastVerifiedAt || null,
  });
}

/** Mint a brand-new license key that you give to a buyer. */
function create({ plan = 'pro', days = 0, note = '' } = {}) {
  let k;
  do { k = genKey(); } while (get(k));
  const rec = freshRecord(plan, days, note);
  rec.key = k;
  upsert(rec);
  return { key: k, record: rowToRec(db.prepare('SELECT * FROM keys WHERE key = ?').get(k)) };
}

/** Validate a key the extension sends. Releases all powers when valid. */
function verify(key, deviceId) {
  key = String(key || '').trim().toUpperCase();
  const rec = get(key);
  if (!rec) return { valid: false, code: 'INVALID', message: 'Invalid license key.' };
  if (!rec.active) return { valid: false, code: 'REVOKED', message: 'This license key has been revoked.' };
  if (rec.expiresAt && Date.now() > rec.expiresAt) {
    return { valid: false, code: 'EXPIRED', message: 'This license key has expired.' };
  }
  if (rec.deviceId && deviceId && rec.deviceId !== deviceId) {
    return { valid: false, code: 'DEVICE', message: 'This license key is already activated on another device.' };
  }
  if (!rec.deviceId && deviceId) rec.deviceId = deviceId;
  rec.lastVerifiedAt = Date.now();
  rec.verifications = (rec.verifications || 0) + 1;
  upsert(rec);

  return {
    valid: true,
    code: 'OK',
    message: 'License validated.',
    plan: rec.plan,
    features: FEATURES[rec.plan] || [],
    powers: FEATURES[rec.plan] || [],
    expiresAt: rec.expiresAt,
    deviceId: rec.deviceId || deviceId || null,
  };
}

function revoke(k) {
  k = String(k || '').trim().toUpperCase();
  const rec = get(k);
  if (rec) { rec.active = false; upsert(rec); }
  return !!rec;
}

function activate(k) {
  k = String(k || '').trim().toUpperCase();
  const rec = get(k);
  if (!rec || (rec.expiresAt && Date.now() > rec.expiresAt)) return false;
  rec.active = true;
  upsert(rec);
  return true;
}

function unbind(k) {
  k = String(k || '').trim().toUpperCase();
  const rec = get(k);
  if (!rec) return false;
  rec.deviceId = null;
  upsert(rec);
  return true;
}

function statusOf(rec) {
  if (!rec) return 'missing';
  if (!rec.active) return 'revoked';
  if (rec.expiresAt && Date.now() > rec.expiresAt) return 'expired';
  return 'active';
}

function list() {
  const rows = db.prepare('SELECT * FROM keys ORDER BY created_at DESC').all();
  return rows.map((r) => {
    const rec = rowToRec(r);
    return { ...rec, status: statusOf(rec) };
  });
}

function remove(k) {
  k = String(k || '').trim().toUpperCase();
  const existed = !!get(k);
  if (existed) db.prepare('DELETE FROM keys WHERE key = ?').run(k);
  return existed;
}
/* ── Signed, short-lived session tokens ────────────────────
   The client must keep re-verifying (heartbeat). Because every
   refresh looks the key up in the store again, revoking the key
   invalidates every live token on the next refresh. */
function b64u(s) { return Buffer.from(String(s)).toString('base64url'); }
function b64d(s) { return Buffer.from(String(s), 'base64url').toString('utf8'); }

function signSession({ key, deviceId, plan, exp }) {
  const body = b64u(JSON.stringify({ key, dev: deviceId, plan, exp }));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function parseSession(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    const expect = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    if (!sig || expect !== sig) return null;
    const payload = JSON.parse(b64d(body));
    if (!payload || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) { return null; }
}

module.exports = {
  ADMIN_KEY,
  ADMIN_USER,
  ADMIN_PASS,
  SESSION_TTL_MS,
  init,
  create,
  verify,
  revoke,
  activate,
  unbind,
  statusOf,
  remove,
  list,
  signSession,
  parseSession,
};