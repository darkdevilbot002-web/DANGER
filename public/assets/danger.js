/* ═══════════════════════════════════════════════════════════════════════
   DANGER MIC KEY — control panel
   Vanilla ES2019, no build step, no external dependencies.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BASE   = location.origin;
const LS     = { token: 'danger_token', user: 'danger_user', theme: 'danger_theme' };
const state  = { keys: [], filter: 'all', plan: '', sort: { col: 'createdAt', dir: -1 }, selected: new Set() };

/* ─── Token helpers ───────────────────────────────────────────────── */
const token    = () => localStorage.getItem(LS.token) || '';
const setToken = (t) => t ? localStorage.setItem(LS.token, t) : localStorage.removeItem(LS.token);
const setUser  = (u) => u ? localStorage.setItem(LS.user, u) : localStorage.removeItem(LS.user);

/* ─── Toasts ──────────────────────────────────────────────────────── */
const TOAST_ICON = { ok: '&#10003;', err: '&#10005;', info: 'i', warn: '!' };
function toast(kind, title, text, ms) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = '<span class="ti">' + TOAST_ICON[kind] + '</span>' +
                 '<span class="tt"><b>' + esc(title) + '</b>' +
                 (text ? '<span>' + esc(text) + '</span>' : '') + '</span>';
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  $('#toasts').appendChild(el);
  setTimeout(kill, ms || 3600);
  el.addEventListener('click', kill);
}

/* ─── Modal plumbing ──────────────────────────────────────────────── */
let _lastFocus = null;
function openModal(id) {
  _lastFocus = document.activeElement;
  const m = $('#' + id);
  m.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  const f = m.querySelector('input:not([type=hidden]),select,button:not(.ghost):not(.mx)');
  if (f) setTimeout(() => f.focus(), 40);
}
function closeModal(id) {
  const m = $('#' + id);
  if (m) m.classList.remove('hidden');
  if (!$$('.ovl:not(.hidden),.drawer:not(.hidden)').length) document.body.style.overflow = '';
  if (_lastFocus && _lastFocus.focus) _lastFocus.focus();
}
$$('.ovl').forEach((o) => o.addEventListener('mousedown', (e) => { if (e.target === o) closeModal(o.id); }));
$$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));

/* Promise-based confirm (replaces window.confirm) */
let _cfResolve = null;
function confirmDlg({ title, sub, body, yes, danger = true }) {
  $('#cfTitle').textContent = title || 'Are you sure?';
  $('#cfSub').textContent  = sub  || 'This cannot be undone';
  /* The key is escaped before being injected so buyer notes can never inject HTML. */
  $('#cfBody').innerHTML   = esc(body || '');
  const y = $('#cfYes');
  y.textContent = yes || 'Confirm';
  y.className = 'btn ' + (danger ? 'btn-danger' : 'btn-warn');
  openModal('cfOvl');
  return new Promise((r) => { _cfResolve = r; });
}
$('#cfYes').addEventListener('click', () => { closeModal('cfOvl'); if (_cfResolve) _cfResolve(true); });
$('#cfNo').addEventListener('click',  () => { closeModal('cfOvl'); if (_cfResolve) _cfResolve(false); });

/* ─── Theme ───────────────────────────────────────────────────────── */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(LS.theme, t);
  $('#themeIcon').innerHTML = '<use href="#i-' + (t === 'dark' ? 'sun' : 'moon') + '"></use>';
  $('#themeBtn').title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}
applyTheme(localStorage.getItem(LS.theme) ||
  (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
$('#themeBtn').addEventListener('click', () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

/* ─── API ─────────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'POST',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token() ? { Authorization: 'Bearer ' + token() } : {}),
    body: opts.method === 'GET' ? undefined : JSON.stringify(opts.body || {}),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  if (res.status === 401) {
    signOut(json && json.error);
    throw new Error((json && json.error) || 'Session expired — log in again.');
  }
  if (!res.ok || (json && json.error)) throw new Error((json && json.error) || ('HTTP ' + res.status));
  return json;
}

/* ─── Auth ────────────────────────────────────────────────────────── */
function afterAuth() {
  const on = !!token();
  $('#loginView').classList.toggle('hidden', on);
  $('#appView').classList.toggle('hidden', !on);
  $('#whoChip').style.display = on ? 'flex' : 'none';
  $('#logoutBtn').style.display = on ? 'inline-flex' : 'none';
  const u = localStorage.getItem(LS.user) || 'admin';
  $('#whoName').textContent = u;
  $('#whoAv').textContent = (u[0] || 'D').toUpperCase();
}
function signOut(msg) {
  setToken(null); setUser(null);
  state.keys = []; state.selected.clear();
  afterAuth();
  closeModal('mkOvl'); closeModal('cfOvl'); closeModal('kwOvl'); closeModal('setOvl');
  if (msg) {
    $('#loginMsg').className = 'msg err';
    $('#loginMsg').textContent = msg;
    toast('err', 'Signed out', msg, 5000);
  }
}

/* ─── Login ───────────────────────────────────────────────────────── */
$('#pwEye').addEventListener('click', () => {
  const i = $('#admPass');
  i.type = i.type === 'password' ? 'text' : 'password';
  i.focus();
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#loginMsg'), btn = $('#loginBtn');
  const user = $('#admUser').value.trim();
  const pass = $('#admPass').value;
  if (!user || !pass) {
    msg.className = 'msg err'; msg.textContent = 'Enter both the operator id and passphrase.'; return;
  }
  msg.className = 'msg loading'; msg.textContent = 'Verifying credentials…';
  btn.classList.add('is-loading'); btn.disabled = true;
  try {
    const r = await api('/api/auth/login', { body: { username: user, password: pass } });
    setToken(r.token); setUser(r.user);
    msg.className = 'msg ok'; msg.textContent = 'Welcome back, ' + r.user + '.';
    $('#admPass').value = '';
    afterAuth();
    await refreshAll();
    toast('ok', 'Authenticated', 'Signed in as ' + r.user);
  } catch (err) {
    msg.className = 'msg err'; msg.textContent = err.message;
    $('#admPass').select();
  } finally {
    btn.classList.remove('is-loading'); btn.disabled = false;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/auth/logout'); } catch (_) { /* token may already be dead */ }
  signOut();
  toast('info', 'Signed out', 'Your session token was cleared from this browser.');
});

/* ─── Formatting ──────────────────────────────────────────────────── */
function relTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const diff = Date.now() - ts, abs = Math.abs(diff), fut = diff < 0;
  let s, u;
  if (abs < 6e4)     { s = Math.round(abs / 1e3);  u = 's'; }
  else if (abs < 36e5){ s = Math.round(abs / 6e4);  u = 'm'; }
  else if (abs < 864e5){ s = Math.round(abs / 36e5); u = 'h'; }
  else               { s = Math.round(abs / 864e5); u = 'd'; }
  return d.toLocaleString() + (fut ? ' (in ' + s + u + ')' : ' (' + s + u + ' ago)');
}
const shortTime = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const shortDev  = (d) => (!d ? '' : (d.length > 16 ? d.slice(0, 8) + '…' + d.slice(-4) : d));

function copyText(text) {
  const ok = () => toast('ok', 'Copied', text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok).catch(() => legacy());
  } else legacy();
  function legacy() {
    const t = document.createElement('textarea');
    t.value = text; t.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); ok(); } catch (_) { toast('err', 'Copy failed', 'Select it manually.'); }
    t.remove();
  }
}

/* ─── Data loading ────────────────────────────────────────────────── */
function setLive(ok) {
  $('#pulse').classList.toggle('off', !ok);
  $('#liveTxt').textContent = ok ? 'LIVE' : 'OFFLINE';
}

async function loadKeys(silent) {
  if (!token()) return;
  if (!silent) $('#refreshBtn').classList.add('spin');
  try {
    state.keys = await api('/api/keys', { method: 'GET' });
    /* Drop selections for keys that no longer exist. */
    const live = new Set(state.keys.map((k) => k.key));
    state.selected.forEach((k) => { if (!live.has(k)) state.selected.delete(k); });
    renderAll();
    setLive(true);
  } catch (e) {
    if (/log in again/i.test(e.message)) return;
    setLive(false);
    toast('err', 'Could not load keys', e.message, 5000);
  } finally {
    $('#refreshBtn').classList.remove('spin');
  }
}

async function loadStats() {
  if (!token()) return;
  try {
    renderStats(await api('/api/stats', { method: 'GET', body: { days: 14 } }));
  } catch (_) { /* stats are decorative — never block the table on them */ }
}

async function loadFeed() {
  if (!token()) return;
  try {
    renderFeed(await api('/api/audit?limit=40', { method: 'GET' }));
  } catch (_) { /* ignore */ }
}

async function refreshAll() {
  await Promise.all([loadKeys(true), loadStats(), loadFeed()]);
}

/* ─── Render: stats + chart + feed ────────────────────────────────── */
let CHART_DATA = null;

function renderStats(s) {
  CHART_DATA = s;
  const c = s.counts;
  $('#sTotal').textContent   = c.total;
  $('#sActive').textContent  = c.active;
  $('#sExpired').textContent = c.expired;
  $('#sRevoked').textContent = c.revoked;
  $('#sBound').textContent   = c.bound;
  drawChart(s.series || []);
  $('#uptime').textContent = 'uptime ' + fmtUptime(s.uptimeSec || 0) +
    ' · ' + s.totalVerifications + ' lifetime checks';
}
function fmtUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  if (d) return d + 'd ' + h + 'h';
  if (h) return h + 'h ' + m + 'm';
  return m + 'm ' + (sec % 60) + 's';
}

/** Lightweight grouped bar chart drawn as SVG (no chart library needed). */
function drawChart(series) {
  const el = $('#chart');
  if (!series || !series.length) { el.innerHTML = ''; return; }
  const W = 100, H = 100, pad = { t: 6, r: 2, b: 16, l: 2 };
  const max = Math.max(1, ...series.map((d) => Math.max(d.verifications, d.mints, d.rejects)));
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const slot = innerW / series.length;
  const bw = Math.min(2.4, (slot - 1.2) / 3);
  const h = (v) => (v / max) * innerH;

  let bars = '', labels = '';
  series.forEach((d, i) => {
    const x = pad.l + i * slot + 0.6;
    const set = [
      { v: d.verifications, fill: 'var(--ok)' },
      { v: d.mints, fill: 'var(--info)' },
      { v: d.rejects, fill: 'var(--bad)' },
    ];
    set.forEach((s, j) => {
      const bh = h(s.v);
      if (bh <= 0) return;
      bars += '<rect class="bar" x="' + (x + j * (bw + 0.3)).toFixed(2) + '" y="' +
        (pad.t + innerH - bh).toFixed(2) + '" width="' + bw.toFixed(2) + '" height="' + bh.toFixed(2) +
        '" rx="0.6" fill="' + s.fill + '"><title>' + d.day + ' · ' +
        ['verifications', 'mints', 'rejects'][j] + ': ' + s.v + '</title></rect>';
    });
    /* Label every 3rd day so the axis stays readable. */
    if (i % 3 === 0 || i === series.length - 1) {
      labels += '<text class="ax-l" x="' + (x + bw).toFixed(2) + '" y="' + (H - 5) +
        '" text-anchor="middle">' + d.day.slice(5) + '</text>';
    }
  });

  const grid = [0, 0.5, 1].map((f) =>
    '<line class="grid-l" x1="' + pad.l + '" y1="' + (pad.t + innerH * (1 - f)).toFixed(2) +
    '" x2="' + (W - pad.r) + '" y2="' + (pad.t + innerH * (1 - f)).toFixed(2) + '"/>').join('');

  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" ' +
    'aria-label="Verification activity over the last 14 days">' + grid + bars + labels + '</svg>';
}

const FEED_ICON = {
  'key.create': ['var(--ok)', '+'], 'key.bulk_create': ['var(--ok)', '+'],
  'key.revoke': ['var(--bad)', '&#10005;'], 'key.activate': ['var(--ok)', '&#10003;'],
  'key.unbind': ['var(--warn)', '&#8644;'], 'key.delete': ['var(--bad)', '&#128465;'],
  'key.edit': ['var(--info)', '&#9998;'], 'key.extend': ['var(--warn)', '&#8635;'],
  'key.bulk_revoke': ['var(--bad)', '&#10005;'], 'key.bulk_activate': ['var(--ok)', '&#10003;'],
  'key.bulk_unbind': ['var(--warn)', '&#8644;'], 'key.bulk_delete': ['var(--bad)', '&#128465;'],
  'auth.login': ['var(--info)', '&#128274;'], 'auth.logout': ['var(--info)', '&#128682;'],
  'auth.password_changed': ['var(--vio)', '&#128273;'], 'auth.lockout': ['var(--bad)', '&#128274;'],
  'audit.clear': ['var(--dm)', '&#128683;'], 'key.purge': ['var(--bad)', '&#128465;'],
};
function renderFeed(rows) {
  const el = $('#feed');
  if (!rows || !rows.length) {
    el.innerHTML = '<li class="empty-feed">No activity recorded yet.</li>';
    return;
  }
  el.innerHTML = rows.map((r) => {
    const meta = FEED_ICON[r.action] || ['var(--dm)', '•'];
    return '<li><span class="f-ic" style="color:' + meta[0] + '">' + meta[1] + '</span>' +
      '<span class="f-txt"><span class="f-act">' + esc(r.action.replace(/[._]/g, ' ')) + '</span>' +
      '<span class="f-meta">' + esc(r.key || r.detail || '—') + '</span></span>' +
      '<span class="f-time">' + shortTime(r.at) + '</span></li>';
  }).join('');
}

/* ─── Render: keys table ──────────────────────────────────────────── */
function renderAll() { renderCounts(); renderKeys(); renderBulkBar(); }

function renderCounts() {
  const all = state.keys;
  const nBound = all.filter((k) => !!k.deviceId).length;
  $('#nAll').textContent     = all.length;
  $('#nActive').textContent  = all.filter((k) => k.status === 'active').length;
  $('#nExpired').textContent = all.filter((k) => k.status === 'expired').length;
  $('#nRevoked').textContent = all.filter((k) => k.status === 'revoked').length;
  $('#nBoundC').textContent  = nBound;
  $('#nUnboundC').textContent = all.length - nBound;
}

function visibleKeys() {
  const q = ($('#keyFilter').value || '').toUpperCase().trim();
  const plan = state.plan;
  const list = state.keys.filter((k) => {
    if (state.filter === 'unbound') { if (k.deviceId) return false; }
    else if (state.filter === 'bound') { if (!k.deviceId) return false; }
    else if (state.filter !== 'all' && k.status !== state.filter) return false;
    if (plan && k.plan !== plan) return false;
    if (!q) return true;
    return (k.key || '').toUpperCase().includes(q) ||
           (k.note || '').toUpperCase().includes(q) ||
           (k.email || '').toUpperCase().includes(q) ||
           (k.deviceId || '').toUpperCase().includes(q);
  });
  const { col, dir } = state.sort;
  return list.sort((a, b) => {
    if (col === 'status') { const x = a.status, y = b.status; return (x > y ? 1 : x < y ? -1 : 0) * dir; }
    if (col === 'note' || col === 'key' || col === 'plan' || col === 'deviceId') {
      const x = (a[col] || '').toLowerCase(), y = (b[col] || '').toLowerCase();
      return x < y ? -dir : x > y ? dir : 0;
    }
    const x = a[col] || 0, y = b[col] || 0;
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
}

function renderKeys() {
  const list = visibleKeys();
  const body = $('#keysBody');
  const scroll = $('#tscroll'), empty = $('#emptyState');

  $('#cntLabel').textContent = list.length + ' of ' + state.keys.length + ' shown';
  $$('thead th[data-s]').forEach((th) => {
    const on = th.dataset.s === state.sort.col;
    if (on) th.dataset.act = ''; else delete th.dataset.act;
    const ar = th.querySelector('.ar');
    if (ar) ar.innerHTML = on ? (state.sort.dir === 1 ? '&#9650;' : '&#9660;') : '&#9650;';
  });

  if (!list.length) {
    scroll.classList.add('hidden');
    empty.classList.remove('hidden');
    const filtered = state.keys.length > 0;
    $('#emptyTitle').textContent = filtered ? 'No matching keys' : 'No keys yet';
    $('#emptyText').textContent  = filtered
      ? 'Try a different search term, status or plan filter.'
      : 'Mint your first license key to get started.';
    return;
  }
  scroll.classList.remove('hidden');
  empty.classList.add('hidden');

  body.innerHTML = list.map((k) => {
    const st = k.status;
    const bound = !!k.deviceId;
    const dev = bound
      ? '<span class="dev dev-on" title="Bound to ' + esc(k.deviceId) + '">' +
          '<svg class="i"><use href="#i-lock"></use></svg><span class="dev-id">' + esc(shortDev(k.deviceId)) + '</span></span>'
      : '<span class="dev dev-off" title="Not bound to any device — this key can activate anywhere">' +
          '<svg class="i"><use href="#i-unlock"></use></svg>Unbound</span>';
    const exp = k.expiresAt
      ? '<span title="' + esc(relTime(k.expiresAt)) + '">' + esc(new Date(k.expiresAt).toLocaleDateString()) + '</span>' +
        '<span class="sub">' + (st === 'expired' ? 'expired' : 'in ' + k.daysLeft + 'd') + '</span>'
      : '<span class="muted">Never</span><span class="sub">lifetime</span>';
    const note = (k.note || k.email)
      ? '<span class="trunc" title="' + esc((k.note || '') + (k.email ? ' · ' + k.email : '')) + '">' +
        esc(k.note || k.email) + '</span>'
      : '<span class="muted">—</span>';
    const sel = state.selected.has(k.key);
    return '<tr data-key="' + esc(k.key) + '"' + (sel ? ' class="sel-row"' : '') + '>' +
      '<td class="col-chk"><input type="checkbox" data-chk="' + esc(k.key) + '"' + (sel ? ' checked' : '') +
        ' aria-label="Select ' + esc(k.key) + '"></td>' +
      '<td class="kcell"><code data-copy="' + esc(k.key) + '" title="Click to copy">' + esc(k.key) + '</code></td>' +
      '<td><span class="pill p-' + esc(k.plan) + '">' + esc(k.planLabel) + '</span></td>' +
      '<td><span class="bdg b-' + esc(st) + '">' + esc(st) + '</span></td>' +
      '<td><span class="muted" title="' + esc(relTime(k.createdAt)) + '">' +
        esc(new Date(k.createdAt).toLocaleDateString()) + '</span></td>' +
      '<td>' + exp + '</td>' +
      '<td>' + note + '</td>' +
      '<td>' + dev + '</td>' +
      '<td><span class="muted">' + (k.verifications || 0) + '</span></td>' +
      '<td><div class="acts">' +
        '<button class="ib" data-act="detail" title="Details"><svg class="i"><use href="#i-search"></use></svg></button>' +
        '<button class="ib" data-act="edit" title="Edit plan / buyer"><svg class="i"><use href="#i-edit"></use></svg></button>' +
        (bound ? '<button class="ib warn" data-act="unbind" title="Unbind device"><svg class="i"><use href="#i-unlock"></use></svg></button>' : '') +
        (st === 'revoked'
          ? '<button class="ib ok" data-act="activate" title="Re-activate"><svg class="i"><use href="#i-check"></use></svg></button>'
          : '<button class="ib bad" data-act="revoke" title="Revoke"><svg class="i"><use href="#i-ban"></use></svg></button>') +
        '<button class="ib bad solid-danger" data-act="delete" title="Delete forever"><svg class="i"><use href="#i-trash"></use></svg></button>' +
      '</div></td></tr>';
  }).join('');
}

function renderBulkBar() {
  const n = state.selected.size;
  $('#bulkBar').classList.toggle('hidden', n === 0);
  $('#bulkCount').textContent = n;
  const all = visibleKeys();
  const chk = $('#chkAll');
  chk.checked = n > 0 && all.length > 0 && all.every((k) => state.selected.has(k.key));
  chk.indeterminate = n > 0 && !chk.checked;
}

function flashRow(key) {
  const tr = $('tr[data-key="' + CSS.escape(key) + '"]', $('#keysBody'));
  if (tr) { tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash'); }
}

/* ─── Key actions ─────────────────────────────────────────────────── */
const ACTION_COPY = {
  revoke: {
    dlg: { title: 'Revoke this key?', sub: 'Powers die within ~1 second',
           body: '\n\nThe buyer loses the engine on their next heartbeat. You can re-activate it later.', yes: 'Revoke key' },
    ok: 'Key revoked', okSub: 'Powers are off now.', err: 'Revoke failed',
  },
  activate: { dlg: null, ok: 'Key re-activated', okSub: '', err: 'Activate failed' },
  unbind: {
    dlg: { title: 'Unbind the device?', sub: 'The key can then activate elsewhere',
           body: '\n\nThe bound device ID is cleared so the key works on a new device. Use this when a buyer reinstalls or loses their device.', yes: 'Unbind device' },
    ok: 'Device unbound', okSub: '', err: 'Unbind failed',
  },
  delete: {
    dlg: { title: 'Delete this key?', sub: 'This cannot be undone',
           body: '\n\nThe key is removed from the database. Any buyer using it loses access immediately.', yes: 'Delete forever' },
    ok: 'Key deleted', okSub: '', err: 'Delete failed',
  },
};

async function runAction(key, action) {
  const copy = ACTION_COPY[action];
  if (!copy) return;
  if (copy.dlg) {
    /* The key is rendered as escaped text, then the shared blurb is appended. */
    const yes = await confirmDlg({
      title: copy.dlg.title, sub: copy.dlg.sub,
      body: '<b>' + esc(key) + '</b>' + esc(copy.dlg.body),
      yes: copy.dlg.yes,
    });
    if (!yes) return;
  }
  try {
    await api('/api/keys/' + encodeURIComponent(key) + '/' + action);
    toast('ok', copy.ok, [key, copy.okSub].filter(Boolean).join(' — '));
    await Promise.all([loadKeys(true), loadStats(), loadFeed()]);
    flashRow(key);
    if (!$('#kwOvl').classList.contains('hidden')) openDetail(key);
  } catch (e) {
    toast('err', copy.err, e.message);
  }
}

const BULK_COPY = {
  revoke:   { t: 'Revoke',   s: 'Powers die within ~1 second', b: '\n\nAll selected keys will lose the engine.', y: 'Revoke all' },
  activate: { t: 'Activate', s: 'Restores access',             b: '',                                        y: 'Activate all' },
  unbind:   { t: 'Unbind',   s: 'Keys become device-free',
              b: '\n\nThe bound device ID is cleared for every selected key.', y: 'Unbind all' },
  delete:   { t: 'Delete',   s: 'This cannot be undone',
              b: '\n\nAll selected keys are removed from the database.', y: 'Delete all' },
};

async function runBulk(action) {
  const keys = Array.from(state.selected);
  if (!keys.length) return;
  const c = BULK_COPY[action];
  if (!c) return;
  const listHtml = keys.map((k) => '<b>' + esc(k) + '</b>').join('\n');
  const yes = await confirmDlg({
    title: c.t + ' ' + keys.length + ' key' + (keys.length > 1 ? 's' : '') + '?',
    sub: c.s, body: listHtml + esc(c.b), yes: c.y,
  });
  if (!yes) return;
  try {
    const r = await api('/api/keys/bulk', { body: { action, keys } });
    state.selected.clear();
    toast(r.failed.length ? 'warn' : 'ok',
      r.failed.length ? 'Partially applied' : 'Bulk ' + c.t.toLowerCase() + ' complete',
      r.count + ' of ' + r.requested + ' succeeded' + (r.failed.length ? ' · ' + r.failed.length + ' failed' : ''),
      r.failed.length ? 6000 : 3600);
    await Promise.all([loadKeys(true), loadStats(), loadFeed()]);
  } catch (e) {
    toast('err', 'Bulk ' + c.t.toLowerCase() + ' failed', e.message);
  }
}

/* ─── Key detail drawer ───────────────────────────────────────────── */
let KW_KEY = null;

function kwBodyHtml(k, history) {
  return '<dl class="kw-grid">' +
      '<dt>Status</dt><dd><span class="bdg b-' + esc(k.status) + '">' + esc(k.status) + '</span></dd>' +
      '<dt>Plan</dt><dd>' + esc(k.planLabel) + ' <span class="muted">(' + esc(k.plan) + ')</span></dd>' +
      '<dt>Created</dt><dd title="' + esc(relTime(k.createdAt)) + '">' + esc(relTime(k.createdAt)) + '</dd>' +
      '<dt>Expires</dt><dd>' + (k.expiresAt
          ? esc(new Date(k.expiresAt).toLocaleString()) + ' <span class="muted">(' + k.daysLeft + 'd left)</span>'
          : '<span class="muted">Never — lifetime</span>') + '</dd>' +
      '<dt>Device</dt><dd>' + (k.deviceId
          ? '<span class="dev dev-on" title="' + esc(k.deviceId) + '"><svg class="i"><use href="#i-lock"></use></svg>' +
            '<span class="dev-id">' + esc(shortDev(k.deviceId)) + '</span></span>' +
            '<div class="kv-full mono">' + esc(k.deviceId) + '</div>'
          : '<span class="dev dev-off"><svg class="i"><use href="#i-unlock"></use></svg>Unbound</span>' +
            '<div class="kv-note">Not tied to any device — it can activate on the first machine that uses it.</div>') + '</dd>' +
      '<dt>Buyer</dt><dd>' + esc(k.note || '—') + '</dd>' +
      '<dt>Email</dt><dd>' + esc(k.email || '—') + '</dd>' +
      '<dt>Checks</dt><dd>' + (k.verifications || 0) +
        (k.lastVerifiedAt ? ' <span class="muted">· last ' + esc(shortTime(k.lastVerifiedAt)) + '</span>' : '') + '</dd>' +
    '</dl>' +
    '<div class="kw-edit">' +
      '<div class="field full"><label>Plan</label><select class="inp" id="kwPlan">' +
        ['pro', 'elite', 'lifetime'].map((p) =>
          '<option value="' + p + '"' + (k.plan === p ? ' selected' : '') + '>' +
          p.charAt(0).toUpperCase() + p.slice(1) + '</option>').join('') +
      '</select></div>' +
      '<div class="field full"><label>Buyer / note</label>' +
        '<input class="inp" id="kwNote" maxlength="80" value="' + esc(k.note || '') + '"></div>' +
      '<div class="field full"><label>Email</label>' +
        '<input class="inp" id="kwEmail" maxlength="120" value="' + esc(k.email || '') + '"></div>' +
      '<div class="full"><button class="btn btn-ghost btn-sm" id="kwSave">Save changes</button></div>' +
    '</div>' +
    '<div class="kw-sec"><h4>History</h4>' +
      (history && history.length
        ? '<ul class="hist">' + history.map((h) =>
            '<li><span class="h-when">' + shortTime(h.at) + '</span><span class="h-what">' +
            esc(h.action.replace(/[._]/g, ' ')) +
            (h.detail ? ' <span class="h-detail">· ' + esc(h.detail) + '</span>' : '') + '</span></li>').join('') + '</ul>'
        : '<p class="muted">No history recorded.</p>') +
    '</div>';
}

async function openDetail(key) {
  KW_KEY = key;
  $('#kwSub').textContent = key;
  $('#kwBody').innerHTML = '<p class="muted">Loading…</p>';
  openModal('kwOvl');
  try {
    const r = await api('/api/keys/' + encodeURIComponent(key), { method: 'GET' });
    $('#kwSub').textContent = r.record.key;
    $('#kwBody').innerHTML = kwBodyHtml(r.record, r.history);
    $('#kwSave').addEventListener('click', async () => {
      const btn = $('#kwSave');
      btn.disabled = true;
      try {
        await api('/api/keys/' + encodeURIComponent(r.record.key), {
          method: 'PATCH',
          body: { plan: $('#kwPlan').value, note: $('#kwNote').value, email: $('#kwEmail').value },
        });
        toast('ok', 'Key updated', r.record.key);
        await Promise.all([loadKeys(true), loadStats(), loadFeed()]);
        openDetail(r.record.key);
      } catch (e) { toast('err', 'Update failed', e.message); btn.disabled = false; }
    });
  } catch (e) {
    $('#kwBody').innerHTML = '<p class="msg err">' + esc(e.message) + '</p>';
  }
}

$('#kwExtend').addEventListener('click', async () => {
  if (!KW_KEY) return;
  const days = prompt('Extend by how many days? (0 = make lifetime)', '30');
  if (days === null) return;
  const n = parseInt(days, 10) || 0;
  try {
    await api('/api/keys/' + encodeURIComponent(KW_KEY) + '/extend', { body: { days: n, fromNow: true } });
    toast('ok', 'Expiry updated', n === 0 ? KW_KEY + ' is now lifetime' : KW_KEY + ' +' + n + 'd');
    await Promise.all([loadKeys(true), loadStats(), loadFeed()]);
    openDetail(KW_KEY);
  } catch (e) { toast('err', 'Extend failed', e.message); }
});

/* ─── Mint a key ──────────────────────────────────────────────────── */
/* Snapshot the pristine form so it can be restored after a successful mint. */
const MK_HTML = $('#mkForm').innerHTML;
const MK_FOOT = $('#mkFoot').innerHTML;

function bindCreateForm() {
  $$('.preset', $('#mkOvl')).forEach((p) => p.addEventListener('click', () => {
    $('#days').value = p.dataset.d;
    $$('.preset', $('#mkOvl')).forEach((o) => o.setAttribute('aria-selected', 'false'));
    p.setAttribute('aria-selected', 'true');
  }));
  $('#days').addEventListener('input', () => {
    $$('.preset', $('#mkOvl')).forEach((o) =>
      o.setAttribute('aria-selected', String(o.dataset.d === $('#days').value)));
  });
  $('#mkGo').addEventListener('click', mintKey);
}
function openCreate() {
  $('#mkForm').innerHTML = MK_HTML;
  $('#mkFoot').innerHTML = MK_FOOT;
  $('#makeMsg').className = 'msg';
  $('#makeMsg').textContent = '';
  bindCreateForm();
  openModal('mkOvl');
}

async function mintKey() {
  if (!token()) { toast('err', 'Not signed in', 'Log in first.'); return; }
  const btn = $('#mkGo'), m = $('#makeMsg');
  const raw = ($('#days').value || '').trim();
  const days = raw === '' ? '' : parseInt(raw, 10);
  if (raw !== '' && (isNaN(days) || days < 0)) {
    m.className = 'msg err'; m.textContent = 'Enter 0 or a positive number of days.'; return;
  }
  const count = Math.max(1, Math.min(100, parseInt($('#count').value, 10) || 1));
  const body = { plan: $('#plan').value, note: $('#note').value.trim(), email: $('#email').value.trim() };
  if (days !== '') body.days = days;
  if (count > 1) body.count = count;

  btn.disabled = true; m.className = 'msg loading'; m.textContent = 'Minting…';
  try {
    const r = await api('/api/keys', { body });
    const keys = r.count ? r.keys : [r.key];
    const rec = r.record || r.records[0];
    const valid = days === '' || days === 0;
    $('#mkForm').innerHTML =
      '<div class="result">' +
        '<small>Send ' + (keys.length > 1 ? 'these keys' : 'this key') + ' to the buyer — click to copy</small>' +
        '<code class="kk" data-copy="' + esc(keys[0]) + '">' + esc(keys[0]) + '</code>' +
        '<small>' + (valid ? 'Lifetime access · never expires'
                           : 'Valid for ' + days + ' days · expires ' + new Date(rec.expiresAt).toLocaleDateString()) +
        (keys.length > 1 ? ' · ' + keys.length + ' keys minted' : '') + '</small>' +
        (keys.length > 1
          ? '<div class="minted-list">' + keys.map((k) => '<code data-copy="' + esc(k) + '">' + esc(k) + '</code>').join('') + '</div>'
          : '') +
      '</div>';
    $('#mkFoot').innerHTML =
      '<button class="btn btn-ghost" type="button" data-close="mkOvl">Close</button>' +
      '<button class="btn btn-danger" type="button" id="mkAgain">Mint another</button>';
    $('#mkAgain').addEventListener('click', openCreate);
    $$('[data-copy]', $('#mkOvl')).forEach((el) =>
      el.addEventListener('click', () => copyText(el.dataset.copy)));
    toast('ok', 'Key' + (keys.length > 1 ? 's' : '') + ' created', keys[0] + (valid ? ' — lifetime' : ' — ' + days + 'd'));
    await Promise.all([loadKeys(true), loadStats(), loadFeed()]);
  } catch (e) {
    m.className = 'msg err'; m.textContent = e.message;
  } finally {
    if (btn.isConnected) btn.disabled = false;
  }
}
$('#newBtn').addEventListener('click', openCreate);

/* ─── Change passphrase ───────────────────────────────────────────── */
$('#pwNew').addEventListener('input', () => {
  const v = $('#pwNew').value;
  let score = 0;
  if (v.length >= 8) score++;
  if (v.length >= 12) score++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
  if (/\d/.test(v)) score++;
  if (/[^A-Za-z0-9]/.test(v)) score++;
  const fill = $('#pwMeter');
  fill.style.width = (score / 5 * 100) + '%';
  fill.style.background = score <= 2 ? 'var(--bad)' : score <= 3 ? 'var(--warn)' : 'var(--ok)';
});
$('#pwGo').addEventListener('click', async () => {
  const m = $('#pwMsg');
  const cur = $('#pwCur').value, next = $('#pwNew').value, rep = $('#pwRep').value;
  if (next.length < 8) { m.className = 'msg err'; m.textContent = 'New passphrase must be at least 8 characters.'; return; }
  if (next !== rep)  { m.className = 'msg err'; m.textContent = 'The two new passphrases do not match.'; return; }
  const btn = $('#pwGo');
  btn.disabled = true; m.className = 'msg loading'; m.textContent = 'Updating…';
  try {
    const r = await api('/api/auth/password', { body: { current: cur, next } });
    m.className = 'msg ok'; m.textContent = r.message;
    toast('ok', 'Passphrase changed', 'Sign in again with the new one.');
    setTimeout(() => { closeModal('setOvl'); signOut(); $('#loginMsg').textContent = 'Passphrase changed — log in again.'; }, 1600);
  } catch (e) {
    m.className = 'msg err'; m.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

/* ─── CSV export ──────────────────────────────────────────────────── */
$('#exportBtn').addEventListener('click', () => {
  const list = visibleKeys();
  if (!list.length) { toast('err', 'Nothing to export', 'No keys match the current filter.'); return; }
  const head = ['key', 'plan', 'status', 'createdAt', 'expiresAt', 'note', 'email', 'deviceId', 'verifications'];
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = [head.join(',')].concat(list.map((k) => [
    k.key, k.plan, k.status, new Date(k.createdAt).toISOString(),
    k.expiresAt ? new Date(k.expiresAt).toISOString() : '',
    k.note || '', k.email || '', k.deviceId || '', k.verifications || 0,
  ].map(q).join(','))).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'danger-keys-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('ok', 'Exported ' + list.length + ' key(s)', 'CSV downloaded.');
});

/* ─── Command palette ─────────────────────────────────────────────── */
const COMMANDS = [
  { id: 'new',      label: 'Mint a new key',             icon: 'i-plus',    kbd: 'N', run: openCreate },
  { id: 'refresh',  label: 'Refresh everything',         icon: 'i-refresh', kbd: 'R', run: () => refreshAll() },
  { id: 'active',   label: 'Show active keys',           icon: 'i-checkc',  kbd: '',  run: () => setFilter('active') },
  { id: 'expired',  label: 'Show expired keys',          icon: 'i-clock',   kbd: '',  run: () => setFilter('expired') },
  { id: 'revoked',  label: 'Show revoked keys',          icon: 'i-ban',     kbd: '',  run: () => setFilter('revoked') },
  { id: 'bound',    label: 'Show bound devices',         icon: 'i-lock',    kbd: '',  run: () => setFilter('bound') },
  { id: 'unbound',  label: 'Show unbound keys',          icon: 'i-unlock',  kbd: '',  run: () => setFilter('unbound') },
  { id: 'all',      label: 'Show all keys',              icon: 'i-key',     kbd: '',  run: () => setFilter('all') },
  { id: 'export',   label: 'Export filtered keys (CSV)', icon: 'i-download',kbd: '',  run: () => $('#exportBtn').click() },
  { id: 'theme',    label: 'Toggle light / dark theme',  icon: 'i-moon',    kbd: '',  run: () => $('#themeBtn').click() },
  { id: 'pw',       label: 'Change passphrase',          icon: 'i-shield',  kbd: '',  run: () => openModal('setOvl') },
  { id: 'revokeSel',label: 'Revoke all selected keys',   icon: 'i-ban',     kbd: '',
    run: () => state.selected.size ? runBulk('revoke') : toast('info', 'Nothing selected', 'Tick some keys first.') },
  { id: 'unbindSel',label: 'Unbind all selected keys',   icon: 'i-unlock',  kbd: '',
    run: () => state.selected.size ? runBulk('unbind') : toast('info', 'Nothing selected', 'Tick some keys first.') },
  { id: 'delSel',   label: 'Delete all selected keys',   icon: 'i-trash',   kbd: '',
    run: () => state.selected.size ? runBulk('delete') : toast('info', 'Nothing selected', 'Tick some keys first.') },
  { id: 'logout',   label: 'Sign out',                   icon: 'i-out',     kbd: '',  run: () => $('#logoutBtn').click() },
];
let cmdIndex = 0, cmdFiltered = COMMANDS;

function renderCommands() {
  const q = $('#cmdInput').value.toLowerCase().trim();
  cmdFiltered = COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  if (!cmdFiltered.length) {
    $('#cmdList').innerHTML = '<li class="empty-feed">No matching command.</li>';
    return;
  }
  cmdIndex = Math.max(0, Math.min(cmdIndex, cmdFiltered.length - 1));
  $('#cmdList').innerHTML = cmdFiltered.map((c, i) =>
    '<li data-cmd="' + c.id + '" aria-selected="' + (i === cmdIndex) + '">' +
    '<svg class="i"><use href="#' + c.icon + '"></use></svg>' + esc(c.label) +
    (c.kbd ? '<span class="c-kbd">' + esc(c.kbd) + '</span>' : '') + '</li>').join('');
}
function runCommand(c) {
  closeModal('cmdOvl');
  $('#cmdInput').value = '';
  if (c) c.run();
}
function openCmd() { cmdIndex = 0; renderCommands(); openModal('cmdOvl'); setTimeout(() => $('#cmdInput').focus(), 40); }
$('#cmdBtn').addEventListener('click', openCmd);
$('#cmdInput').addEventListener('input', () => { cmdIndex = 0; renderCommands(); });
$('#cmdList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-cmd]');
  if (li) runCommand(COMMANDS.find((c) => c.id === li.dataset.cmd));
});
$('#cmdInput').addEventListener('keydown', (e) => {
  const n = Math.max(1, cmdFiltered.length);
  if (e.key === 'ArrowDown')      { e.preventDefault(); cmdIndex = (cmdIndex + 1) % n; renderCommands(); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); cmdIndex = (cmdIndex - 1 + n) % n; renderCommands(); }
  else if (e.key === 'Enter')     { e.preventDefault(); runCommand(cmdFiltered[cmdIndex]); }
});

/* ─── Table wiring ────────────────────────────────────────────────── */
function setFilter(f) {
  state.filter = f;
  $$('#chips .chip').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.f === f)));
  renderKeys();
}
$$('#chips .chip').forEach((c) => c.addEventListener('click', () => setFilter(c.dataset.f)));
$('#planFilter').addEventListener('change', (e) => { state.plan = e.target.value; renderKeys(); renderBulkBar(); });
$('#keyFilter').addEventListener('input', () => { renderKeys(); renderBulkBar(); });
$('#refreshBtn').addEventListener('click', () => { refreshAll(); toast('info', 'Refreshing…', '', 1200); });

$$('thead th[data-s]').forEach((th) => th.addEventListener('click', () => {
  const c = th.dataset.s;
  if (state.sort.col === c) state.sort.dir *= -1;
  else state.sort = { col: c, dir: ['createdAt', 'expiresAt', 'verifications'].includes(c) ? -1 : 1 };
  renderKeys();
}));

/* One delegated listener for every action button in the table. */
$('#keysBody').addEventListener('click', (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) { copyText(copy.dataset.copy); return; }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const key = btn.closest('tr').dataset.key;
  const act = btn.dataset.act;
  if (act === 'detail') openDetail(key);
  else if (act === 'edit') openDetail(key);
  else runAction(key, act);
});

$('#keysBody').addEventListener('change', (e) => {
  const chk = e.target.closest('input[data-chk]');
  if (!chk) return;
  if (chk.checked) state.selected.add(chk.dataset.chk); else state.selected.delete(chk.dataset.chk);
  chk.closest('tr').classList.toggle('sel-row', chk.checked);
  renderBulkBar();
});

$('#chkAll').addEventListener('change', (e) => {
  visibleKeys().forEach((k) => {
    if (e.target.checked) state.selected.add(k.key); else state.selected.delete(k.key);
  });
  renderKeys();
  renderBulkBar();
});

$('#bulkClear').addEventListener('click', () => { state.selected.clear(); renderKeys(); renderBulkBar(); });
$$('[data-bulk]').forEach((b) => b.addEventListener('click', () => runBulk(b.dataset.bulk)));

$('#clearAuditBtn').addEventListener('click', async () => {
  const yes = await confirmDlg({
    title: 'Clear the activity log?', sub: 'This cannot be undone',
    body: 'Every recorded action (logins, mints, revokes) is permanently removed from the audit table.',
    yes: 'Clear log',
  });
  if (!yes) return;
  try {
    const r = await api('/api/audit', { method: 'DELETE' });
    toast('ok', 'Activity log cleared', r.cleared + ' entries removed.');
    await Promise.all([loadStats(), loadFeed()]);
  } catch (e) { toast('err', 'Clear failed', e.message); }
});

/* ─── Keyboard shortcuts ──────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  /* Ctrl/Cmd+K opens the palette from anywhere, even while typing. */
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault(); openCmd(); return;
  }
  if (e.key === 'Escape') {
    if (!$('#cmdOvl').classList.contains('hidden')) { closeModal('cmdOvl'); return; }
    if (!$('#cfOvl').classList.contains('hidden')) { $('#cfNo').click(); return; }
    $$('.ovl:not(.hidden),.drawer:not(.hidden)').forEach((o) => closeModal(o.id));
    return;
  }
  if (typing || !token()) return;
  if (e.key === '/') { e.preventDefault(); $('#keyFilter').focus(); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openCreate(); }
  else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); refreshAll(); }
});

/* ─── Boot ────────────────────────────────────────────────────────── */
bindCreateForm();
afterAuth();
if (token()) refreshAll();
setInterval(() => { if (token() && document.visibilityState === 'visible') refreshAll(); }, 15000);
