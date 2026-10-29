// ogm-light — minimal player client for Open Game Master (cookie auth via proxy)
// innerHTML here is always fed through esc(); no raw server strings reach it.
'use strict';

const $ = (id) => document.getElementById(id);
const screens = { login: $('login'), home: $('home'), table: $('table') };
let state = {
  campaignId: null,
  campaignTitle: '',
  messages: [],        // ascending seq
  names: {},
  olderBefore: null,
  lastSeq: 0,
  es: null,
  kind: 'do',
  tts: localStorage.getItem('ogml_tts') === '1',
  sheet: null,
};

function show(name) {
  for (const k of Object.keys(screens)) screens[k].hidden = k !== name;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { show('login'); throw new Error(data.error || 'not signed in'); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------- login ---------- */

async function checkSession() {
  try {
    const me = await api('/api/auth/me');
    if (me.user) return home();
  } catch {}
  show('login');
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').hidden = true;
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('login-user').value.trim(),
        password: $('login-pass').value,
      }),
    });
    $('login-pass').value = '';
    home();
  } catch (err) {
    $('login-error').textContent = err.message;
    $('login-error').hidden = false;
  }
});

$('logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  show('login');
});

/* ---------- home ---------- */

async function home() {
  show('home');
  const list = $('campaign-list');
  list.innerHTML = '<p class="error">loading…</p>';
  try {
    const data = await api('/api/campaigns');
    list.innerHTML = '';
    if (!data.campaigns.length) {
      list.innerHTML = '<p class="error">No tables yet — create one in the full app.</p>';
      return;
    }
    for (const c of data.campaigns) {
      const b = document.createElement('button');
      b.className = 'campaign-card';
      const as = c.playingAs ? ` · playing ${c.playingAs.name || c.playingAs}` : '';
      const glance = c.glance?.scene ? ` — ${c.glance.scene}` : '';
      b.innerHTML = `<b>${esc(c.title || c.name || 'Untitled')}</b><small>${esc(String(as).replace('· playing null', ''))}${esc(glance)}</small>`;
      b.addEventListener('click', () => openTable(c));
      list.appendChild(b);
    }
  } catch (err) {
    list.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

/* ---------- table ---------- */

async function openTable(c) {
  state.campaignId = c.id;
  state.campaignTitle = c.title || c.name || 'Table';
  state.messages = [];
  state.lastSeq = 0;
  state.olderBefore = null;
  state.sheet = null;
  $('table-title').textContent = state.campaignTitle;
  $('tts-toggle').textContent = state.tts ? '🔊' : '🔇';
  $('tts-toggle').classList.toggle('on', state.tts);
  $('sheet').hidden = true;
  show('table');
  $('transcript').innerHTML = '';
  try {
    const data = await api(`/api/campaigns/${c.id}/messages?limit=30`);
    state.names = data.names || {};
    state.messages = (data.messages || []).slice().sort((a, b) => a.seq - b.seq);
    state.olderBefore = data.olderBefore;
    state.lastSeq = state.messages.length ? state.messages[state.messages.length - 1].seq : 0;
    for (const m of state.messages) renderMessage(m);
    $('transcript').scrollTop = $('transcript').scrollHeight;
    connectStream();
  } catch (err) {
    $('transcript').innerHTML = `<div class="msg system"><span class="body">${esc(err.message)}</span></div>`;
  }
}

$('back').addEventListener('click', () => {
  if (state.es) { state.es.close(); state.es = null; }
  home();
});

function connectStream() {
  if (state.es) state.es.close();
  const es = new EventSource(`/api/campaigns/${state.campaignId}/events?lastSeq=${state.lastSeq}`);
  state.es = es;
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (e.lastEventId) state.lastSeq = Math.max(state.lastSeq, Number(e.lastEventId) || 0);
    const msg = ev.message || ev.msg || (ev.seq && ev.content ? ev : null);
    if (msg && msg.seq && !state.messages.some((m) => m.seq === msg.seq)) {
      state.messages.push(msg);
      state.lastSeq = Math.max(state.lastSeq, msg.seq);
      renderMessage(msg);
    }
    if (msg?.characterId || ev.sheet) loadSheet();
  };
  es.onerror = () => { /* EventSource retries on its own */ };
}

/* ---------- rendering ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function whoFor(m) {
  if (m.authorType === 'dm') return 'DM';
  if (m.authorType === 'system') return '';
  return state.names[m.characterId] || state.names[m.userId] || 'Player';
}

function renderMessage(m) {
  const div = document.createElement('div');
  div.className = 'msg ' + m.authorType + (m.kind === 'ooc' ? ' ooc' : '');
  const who = whoFor(m);
  div.innerHTML = (who ? `<div class="who">${esc(who)}</div>` : '') +
    `<div class="body">${esc(m.content)}</div>`;
  const el = $('transcript');
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  el.appendChild(div);
  if (nearBottom || m.authorType !== 'player') {
    // keep the newest line visible unless the reader scrolled up mid-history
    if (nearBottom) el.scrollTop = el.scrollHeight;
    else if (m.authorType === 'dm') $('new-msgs').hidden = false;
  }
  if (m.authorType === 'dm' && state.tts) speak(m.content);
}

$('new-msgs').addEventListener('click', () => {
  $('new-msgs').hidden = true;
  $('transcript').scrollTop = $('transcript').scrollHeight;
});

/* ---------- composer ---------- */

document.querySelectorAll('#composer .seg button').forEach((b) => {
  b.addEventListener('click', () => {
    state.kind = b.dataset.kind;
    document.querySelectorAll('#composer .seg button').forEach((x) => x.classList.toggle('on', x === b));
    $('action-text').placeholder = { do: 'What do you do?', say: 'What do you say?', ooc: 'Out of character…' }[state.kind];
  });
});

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('action-text').value.trim();
  if (!text || !state.campaignId) return;
  $('send').disabled = true;
  try {
    await api(`/api/campaigns/${state.campaignId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ content: text, kind: state.kind }),
    });
    $('action-text').value = '';
    $('new-msgs').hidden = true;
    $('transcript').scrollTop = $('transcript').scrollHeight;
  } catch (err) {
    alert(err.message);
  } finally {
    $('send').disabled = false;
  }
});

// Enter sends; Shift+Enter newlines
$('action-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('send').click(); }
});

/* ---------- TTS ---------- */

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[*_`#]/g, ''));
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

$('tts-toggle').addEventListener('click', () => {
  state.tts = !state.tts;
  localStorage.setItem('ogml_tts', state.tts ? '1' : '0');
  $('tts-toggle').textContent = state.tts ? '🔊' : '🔇';
  $('tts-toggle').classList.toggle('on', state.tts);
  if (!state.tts) speechSynthesis.cancel();
});

/* ---------- sheet ---------- */

$('sheet-toggle').addEventListener('click', async () => {
  const el = $('sheet');
  if (!el.hidden) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '<h3>Sheet</h3><p class="error">loading…</p>';
  if (!state.sheet) await loadSheet();
  renderSheet();
});

async function loadSheet() {
  if (!state.campaignId) return;
  try {
    state.sheet = await api(`/api/campaigns/${state.campaignId}/sheet`);
    if (!$('sheet').hidden) renderSheet();
  } catch {}
}

const SHEET_FIELDS = [
  ['name', 'Name'], ['className', 'Class'], ['level', 'Level'], ['raceName', 'Race'],
  ['backgroundName', 'Background'], ['hp', 'Max HP'], ['currentHp', 'HP'], ['xp', 'XP'],
  ['ac', 'AC'], ['speed', 'Speed'],
];

function renderSheet() {
  const el = $('sheet');
  const s = state.sheet?.sheet || state.sheet || {};
  el.innerHTML = '<h3>Sheet</h3>';
  if (s.currentHp != null) {
    const hp = document.createElement('div');
    hp.className = 'hp';
    hp.textContent = `${s.currentHp} / ${s.hp ?? '?'}`;
    el.appendChild(hp);
  }
  for (const [key, label] of SHEET_FIELDS) {
    if (s[key] == null || key === 'currentHp') continue;
    const row = document.createElement('div');
    row.className = 'kv';
    row.innerHTML = `<b>${label}</b><span>${esc(s[key])}</span>`;
    el.appendChild(row);
  }
}

/* ---------- boot ---------- */

document.addEventListener('visibilitychange', () => {
  // A phone that slept for an hour gets a fresh page of history, not a
  // day-old SSE replay: cheapest reliable catch-up for marathon play.
  if (document.visibilityState === 'visible' && state.campaignId) {
    if (state.es) state.es.close();
    openTable({ id: state.campaignId, title: state.campaignTitle });
  }
});

checkSession();
