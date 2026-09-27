# DANGER MIC KEY

A self-hosted **license key server + admin console** for selling mic tools. You mint
keys here, ship buyers only the client, and a valid key unlocks the engine that is
hosted on **this** server and never shipped to anyone.

```
  mint key  →  send to buyer  →  buyer pastes it  →  engine released
       ↑                                             │
       └──────── revoke = powers die in ~1s ─────────┘
```

---

## ✨ What's inside

**Real authentication** (not a shared secret header)
- Passwords hashed with **scrypt** — never stored in plain text
- **Signed, expiring** panel sessions (HMAC-SHA256, 12 h default)
- **Lockout** after 5 failed logins (15 min)
- Change the passphrase from the UI; doing so **kills every other session**
- Session secret persisted in the DB so restarts don't log you out

**Key lifecycle**
| Action | Effect |
|---|---|
| **Revoke** | Engine stops being released — buyer loses powers on their next heartbeat |
| **Activate** | Undo a revoke (blocked on expired keys) |
| **Unbind** | Frees the key from its device so it can activate elsewhere |
| **Delete** | Soft-deletes the row (audit history survives); `purge` erases for good |
| **Bulk** | Any of the above across many keys at once |
| **Edit / Extend** | Change plan, buyer, email, or push the expiry out (`days: 0` = lifetime) |

**Console UI**
- Hazard-tape industrial theme, light + dark
- Live stat cards, a 14-day verifications/mints/rejects chart, and a real activity feed
- Search, status + plan filters, sortable columns, **multi-select with a bulk action bar**
- Key detail drawer with per-key history
- **Command palette** (`Ctrl`/`⌘` + `K`), CSV export, toasts
- Shortcuts: `/` search · `N` new key · `R` refresh

**Security**
- `X-Frame-Options: DENY`, `nosniff`, strict **CSP** (no CDN, nothing third-party)
- `trust proxy` enabled, admin routes take a **Bearer token** only
- Soft-delete keeps an audit trail of every admin action

---

## 🚀 Deploy on Render

1. **New → Blueprint** → pick this repo. `render.yaml` is picked up automatically.
2. Set the environment variables it asks for — at minimum `ADMIN_PASS`.
   (Set `ADMIN_USER` too if you don't want the default `danger`.)
3. Deploy, then open the URL and log in.

> **Storage** — keys live in a SQLite file at `data/danger.db`. Render's **free**
> tier has an ephemeral disk, so a restart wipes runtime-created keys. Two fixes:
> set `SEED_KEYS` to recreate permanent keys on every boot, **or** attach a
> **persistent disk** mounted at `DATA_DIR` (default `/var/data`).

### Cold starts
Free instances sleep after ~15 min idle and take 40–90 s to wake. Set
`KEEPALIVE=1` + `PUBLIC_URL` and the server pings its own `/healthz` every 5 min.
(An external uptime pinger works just as well.)

---

## ⚙️ Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_USER` | `danger` | Operator id for the panel |
| `ADMIN_PASS` | `DANGER@123` | Passphrase — **change this** |
| `SESSION_SECRET` | *(generated & persisted)* | Signs panel + license tokens |
| `ADMIN_SESSION_TTL_MS` | `43200000` (12 h) | Panel login lifetime |
| `SESSION_TTL_MS` | `120000` (2 min) | Buyer heartbeat window |
| `LOGIN_MAX_FAILURES` | `5` | Failed logins before lockout |
| `LOGIN_LOCK_MS` | `900000` (15 min) | Lockout duration |
| `KEY_PREFIX` | `DANGER` | Key prefix, e.g. `DANGER-XXXXXX-XXXXXX-XXXXXX` |
| `DATA_DIR` | `./data` | SQLite location |
| `SEED_KEYS` | *(none)* | Keys recreated on every boot |
| `KEEPALIVE` / `PUBLIC_URL` | `0` / — | Prevent free-tier cold starts |

> The owner account is seeded **once**. After that the stored scrypt hash wins,
> so change the passphrase from the panel (or delete `data/danger.db` to reset).

---

## 🔌 API

### Buyer-facing (no auth — the client calls these)
```http
POST /api/verify           { key, deviceId }   → validate
POST /api/session          { key, deviceId }   → short-lived signed token
POST /api/session/refresh  { token, key }      → re-check before expiry
POST /api/injector         { key, deviceId }   → engine source (valid keys only)
```
Verification is **forgiving about input** — lowercase, spaces, or missing dashes
all work — but **strict about the device**: a key bound elsewhere returns `DEVICE`.

### Admin (Bearer token from `/api/auth/login`)
```bash
BASE=https://danger-mic-key.onrender.com

# 1. log in
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"danger","password":"YOUR_PASS"}' | jq -r .token)

# 2. mint (add "count":5 for a batch)
curl -X POST $BASE/api/keys -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"plan":"pro","days":30,"note":"Ramesh"}'

# 3. list / inspect / analytics
curl $BASE/api/keys   -H "Authorization: Bearer $TOKEN"
curl $BASE/api/stats  -H "Authorization: Bearer $TOKEN"
curl $BASE/api/audit  -H "Authorization: Bearer $TOKEN"

# 4. lifecycle
curl -X POST $BASE/api/keys/DANGER-XXXXXX-XXXXXX-XXXXXX/revoke   -H "Authorization: Bearer $TOKEN"
curl -X POST $BASE/api/keys/DANGER-XXXXXX-XXXXXX-XXXXXX/unbind   -H "Authorization: Bearer $TOKEN"
curl -X POST $BASE/api/keys/DANGER-XXXXXX-XXXXXX-XXXXXX/activate -H "Authorization: Bearer $TOKEN"
curl -X POST $BASE/api/keys/DANGER-XXXXXX-XXXXXX-XXXXXX/delete   -H "Authorization: Bearer $TOKEN"

# 5. bulk
curl -X POST $BASE/api/keys/bulk -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"revoke","keys":["DANGER-...","DANGER-..."]}'

# 6. edit / extend
curl -X PATCH $BASE/api/keys/DANGER-XXXXXX-XXXXXX-XXXXXX \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"plan":"lifetime","note":"VIP"}'
curl -X POST $BASE/api/keys/DANGER-XXXXXX-XXXXXX-XXXXXX/extend \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"days":30,"fromNow":true}'
```

### Plans
| Plan | Default | Features |
|---|---|---|
| `pro` | 30 days | `all` |
| `elite` | 90 days | `all`, `priority` |
| `lifetime` | ∞ | `all`, `priority`, `lifetime` |

---

## 💻 Run locally

```bash
npm install
npm start          # http://localhost:3000  (credentials printed on boot)
npm test           # 38 end-to-end API tests
npm run generate -- pro 30 "Ramesh" 5   # mint 5 keys offline
```

**Files**
```
index.js              Express API + security headers + keep-alive
store.js              SQLite: keys, admins (scrypt), audit, daily stats, tokens
generate.js           offline key minting CLI
payload.js            the engine, served only to valid keys
public/index.html     console markup
public/assets/        console CSS + JS
test/smoke.test.js    end-to-end suite
render.yaml           one-click Render blueprint
```

---

## ⚠️ Notes

- Requires **Node ≥ 22.5** (uses the built-in `node:sqlite`).
- Keys are generated from a 32-character alphabet with **no `0/O/1/I/L`**, so a
  buyer can never mistype one.
- `DELETE`d keys are soft-deleted on purpose — `POST /api/keys/purge` erases them
  permanently.
- **Never** commit `data/`, `.env`, or a live token. `.gitignore` already covers it.

MIT