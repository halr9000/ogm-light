// ogm-light — minimal player client for Open Game Master (cookie auth via proxy)
// innerHTML here is always fed through esc(); no raw server strings reach it.
'use strict';

const $ = (id) => document.getElementById(id);
const screens = { login: $('login'), home: $('home'), table: $('table') };
// narration mode: 'tap' (per-line play buttons) | 'auto' (follows the DM).
// Migrates the old on/off toggle ('ogml_tts'); 'off' folded into 'tap'.
function narrateMode() {
  const saved = localStorage.getItem('ogml_narrate');
  if (saved === 'tap' || saved === 'auto') return saved;
  return localStorage.getItem('ogml_tts') === '1' ? 'auto' : 'tap';
}
let state = {
  campaignId: null,
  campaignTitle: '',
  messages: [],        // ascending seq
  names: {},
  olderBefore: null,
  lastSeq: 0,
  es: null,
  kind: 'do',
  narrate: narrateMode(),
  sheet: null,
  narration: {},       // messageId -> same-origin mp3 url (server-rendered takes)
  audio: null,         // currently playing audio element
  playBtn: null,       // play button of the line now sounding
  pendingAuto: null,   // dm passage waiting for its take (auto mode)
  whisperIds: new Set(),
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
  if (res.status === 401) { show('login'); throw new Error(`${data.error || 'not signed in'} (${opts.method || 'GET'} ${path})`); }
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
    try { await home(); }
    catch (e) { $('login-error').textContent = 'login ok but ' + e.message; $('login-error').hidden = false; }
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
      b.innerHTML = `<i class="ra ra-scroll-unfurled" aria-hidden="true"></i><b>${esc(c.title || c.name || 'Untitled')}</b><small>${esc(String(as).replace('· playing null', ''))}${esc(glance)}</small>`;
      b.addEventListener('click', () => openTable(c));
      list.appendChild(b);
    }
  } catch (err) {
    list.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    throw err;
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
  sheetError = '';
  $('table-title').textContent = state.campaignTitle;
  $('sheet').hidden = true;
  show('table');
  $('transcript').innerHTML = '';
  try {
    // Snapshot, private line with the GM, and narration takes in one round.
    const [data, wp, camp] = await Promise.all([
      api(`/api/campaigns/${c.id}/messages?limit=30`),
      api(`/api/campaigns/${c.id}/whispers`).catch(() => null),
      api(`/api/campaigns/${c.id}`).catch(() => null),
    ]);
    state.names = data.names || {};
    state.messages = (data.messages || []).slice().sort((a, b) => a.seq - b.seq);
    state.olderBefore = data.olderBefore;
    state.lastSeq = state.messages.length ? state.messages[state.messages.length - 1].seq : 0;
    state.narration = camp?.narrationAudio || {};
    state.whisperIds = new Set();
    renderTimeline(wp?.whispers ? wp.whispers.slice().reverse() : []);
    connectStream();
  } catch (err) {
    $('transcript').innerHTML = `<div class="msg system"><span class="body">${esc(err.message)}</span></div>`;
  }
}

$('back').addEventListener('click', async () => {
  if (state.es) { state.es.close(); state.es = null; }
  try { await home(); } catch {}
});

// The stream speaks named SSE events; onmessage only catches unnamed ones,
// so each type that matters the client gets its own listener.
function connectStream() {
  if (state.es) state.es.close();
  const es = new EventSource(`/api/campaigns/${state.campaignId}/events?lastSeq=${state.lastSeq}`);
  state.es = es;
  const onMessage = (e) => {
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
  for (const type of ['message_added', 'message_updated']) es.addEventListener(type, onMessage);
  es.addEventListener('whisper_activity', () => { refreshWhispers(); });
  // a freshly rendered take just landed: file it, and sound it if auto mode
  // was waiting for exactly this passage
  es.addEventListener('tts_ready', (e) => {
    try {
      const p = JSON.parse(e.data);
      if (p.messageId && p.url) {
        state.narration[p.messageId] = p.url;
        if (state.pendingAuto === p.messageId && state.narrate === 'auto') {
          state.pendingAuto = null;
          const m = state.messages.find((x) => x.id === p.messageId);
          if (m) playMessage(m);
        }
      }
    } catch {}
  });
  // The server fell too far behind to replay: rebuild from a fresh snapshot.
  es.addEventListener('resync', () => { openTable({ id: state.campaignId, title: state.campaignTitle }); });
  es.onmessage = onMessage;
  es.onerror = () => { /* EventSource retries on its own */ };
}

async function refreshWhispers() {
  try {
    const wp = await api(`/api/campaigns/${state.campaignId}/whispers`);
    for (const w of (wp.whispers || []).slice().reverse()) {
      if (!state.whisperIds.has(w.id)) renderWhisper(w);
    }
  } catch { /* the next whisper_activity retries */ }
}

// Transcript order: table messages and the private line interleave by time.
function renderTimeline(whispers) {
  const events = [
    ...state.messages.map((m) => ({ t: Date.parse(m.createdAt || '') || 0, m })),
    ...whispers.map((w) => ({ t: Date.parse(w.createdAt || '') || 0, w })),
  ].sort((a, b) => a.t - b.t);
  for (const e of events) e.w ? renderWhisper(e.w) : renderMessage(e.m);
  $('transcript').scrollTop = $('transcript').scrollHeight;
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

// Markdown-lite for DM prose: speaker beats and roll markers become quiet
// labels, *italics* and **bold** render. Input is esc()'d first, so the
// tags below are the only markup that can reach innerHTML.
function richBody(text) {
  let s = esc(text)
    .replace(/\[roll:[0-9a-f-]+\]\n?/gi, '')
    .replace(/(^^|\n)\[([^[\]|]+?)\s*\|\s*([^[\]]+)\]\s*/g, '$1<span class="beat">$2 · $3</span> ')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
  return s;
}

function appendMsg(div, m) {
  const el = $('transcript');
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  el.appendChild(div);
  if (nearBottom || m.authorType !== 'player') {
    // keep the newest line visible unless the reader scrolled up mid-history
    if (nearBottom) el.scrollTop = el.scrollHeight;
    else if (m.authorType === 'dm') $('new-msgs').hidden = false;
  }
}

function renderMessage(m, live = false) {
  const div = document.createElement('div');
  div.className = 'msg ' + m.authorType + (m.kind === 'ooc' ? ' ooc' : '');
  const who = whoFor(m);
  const body = m.authorType === 'dm' ? richBody(m.content) : esc(m.content);
  div.innerHTML = (who ? `<div class="who"><span>${esc(who)}</span></div>` : '') +
    `<div class="body">${body}</div>`;
  if (m.authorType === 'dm') addPlayBtn(div, m);
  appendMsg(div, m);
  if (m.authorType === 'dm' && state.narrate === 'auto' && live) autoPlay(m);
}

// The private line with the GM, set apart from table talk.
function renderWhisper(w) {
  state.whisperIds.add(w.id);
  const div = document.createElement('div');
  div.className = 'msg whisper ' + (w.direction === 'to_player' ? 'from-dm' : 'to-dm');
  const who = w.direction === 'to_player' ? 'GM' : (state.names[w.characterId] || 'You');
  const body = w.direction === 'to_player' ? richBody(w.content) : esc(w.content);
  div.innerHTML = `<div class="who"><span>${esc(who)}</span></div><div class="body">${body}</div>`;
  if (w.direction === 'to_player') addPlayBtn(div, w);
  appendMsg(div, { authorType: 'player' });
}

$('new-msgs').addEventListener('click', () => {
  $('new-msgs').hidden = true;
  $('transcript').scrollTop = $('transcript').scrollHeight;
});

/* ---------- composer ---------- */

const PLACEHOLDERS = { do: 'What do you do?', say: 'What do you say?', ooc: 'Out of character…', gm: 'Whisper to the GM…' };

const seg = document.querySelector('#composer .seg');
function collapseSeg() { seg.classList.remove('expanded'); }

document.querySelectorAll('#composer .seg-track button').forEach((b) => {
  b.addEventListener('click', () => {
    state.kind = b.dataset.kind;
    document.querySelectorAll('#composer .seg-track button').forEach((x) => x.classList.toggle('on', x === b));
    $('action-text').placeholder = PLACEHOLDERS[state.kind];
    if (state.kind === 'gm') {
      $('action-text').focus();
    } else {
      collapseSeg();
    }
  });
});

$('seg-more').addEventListener('click', () => {
  seg.classList.toggle('expanded');
  if (seg.classList.contains('expanded')) $('action-text').focus();
});

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('action-text').value.trim();
  if (!text || !state.campaignId) return;
  $('send').disabled = true;
  try {
    if (state.kind === 'gm') {
      await api(`/api/campaigns/${state.campaignId}/whispers`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      });
      collapseSeg();
      refreshWhispers();
    } else {
      await api(`/api/campaigns/${state.campaignId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ content: text, kind: state.kind }),
      });
    }
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

/* ---------- narration audio ---------- */

// every reply the player can hear gets a small play button, GM whispers included
const PLAY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.5 5.2v13.6a.75.75 0 0 0 1.16.63l10.2-6.8a.75.75 0 0 0 0-1.26l-10.2-6.8a.75.75 0 0 0-1.16.63Z"/></svg>';
const PAUSE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.5 5h3.4v14H7.5zM13.1 5h3.4v14h-3.4z"/></svg>';

function addPlayBtn(div, m) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'play-btn';
  b.dataset.mid = m.id;
  b.setAttribute('aria-label', 'Play narration');
  b.innerHTML = PLAY_SVG;
  b.addEventListener('click', () => playMessage(m, b));
  div.querySelector('.who').appendChild(b);
}

// one line at a time: stop whatever is sounding, then play this reply —
// the server's take when one exists, a fresh render for DM prose on demand,
// the browser voice when the server has nothing for the line.
async function playMessage(m, btn) {
  if (state.playBtn === btn) { stopAudio(true); return; }
  stopAudio(false);
  state.playBtn = btn || null;
  if (btn) btn.classList.add('on');
  let url = state.narration[m.id];
  if (!url && m.authorType === 'dm') {
    if (btn) btn.classList.add('busy');
    try {
      const r = await api(`/api/campaigns/${state.campaignId}/messages/${m.id}/narrate`, { method: 'POST' });
      url = r.url;
      state.narration[m.id] = url;
    } catch { url = null; }
    if (btn) btn.classList.remove('busy');
  }
  if (url) playAudio(url, m);
  else synthSpeak(m.content);
}

function playAudio(url, m) {
  const a = new Audio(url);
  state.audio = a;
  showPlaybar();
  a.addEventListener('timeupdate', () => {
    if (!seeking && a.duration) {
      $('pb-seek').value = String(Math.round((a.currentTime / a.duration) * 1000));
    }
  });
  a.addEventListener('ended', finishTrack);
  a.addEventListener('error', () => { finishTrack(); synthSpeak(m.content); });
  a.play().catch(() => { finishTrack(); synthSpeak(m.content); });
}

function finishTrack() {
  // the controls fade once the line is done; nothing lingers
  const pb = $('playbar');
  pb.classList.add('hide');
  setTimeout(() => { pb.hidden = true; }, 600);
  clearPlaying();
  state.audio = null;
}

function showPlaybar() {
  const pb = $('playbar');
  pb.hidden = false;
  pb.classList.remove('hide');
  $('pb-seek').value = '0';
  setPbIcon(true);
}

function clearPlaying() {
  if (state.playBtn) { state.playBtn.classList.remove('on', 'busy'); state.playBtn = null; }
}

function stopAudio(hideBar) {
  if (state.audio) { state.audio.pause(); state.audio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  clearPlaying();
  if (hideBar) {
    const pb = $('playbar');
    pb.classList.add('hide');
    setTimeout(() => { pb.hidden = true; }, 600);
  }
}

function synthSpeak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(
    text.replace(/\[roll:[^\]]*\]/gi, '').replace(/^\[[^\]]*\]\s*/, '').replace(/[*_`#]/g, ''),
  );
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

// auto: sound each new DM passage as its take lands
function autoPlay(m) {
  if (state.narration[m.id]) playMessage(m);
  else state.pendingAuto = m.id;
}

/* playbar: pause and seek, visible only while a track plays */

let seeking = false;
function setPbIcon(playing) {
  $('pb-toggle').innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  $('pb-toggle').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}
$('pb-toggle').addEventListener('click', () => {
  const a = state.audio;
  if (!a) return;
  if (a.paused) { a.play(); setPbIcon(true); }
  else { a.pause(); setPbIcon(false); }
});
const seek = $('pb-seek');
seek.addEventListener('pointerdown', () => { seeking = true; });
seek.addEventListener('pointerup', () => { seeking = false; });
seek.addEventListener('input', () => {
  const a = state.audio;
  if (a && a.duration) a.currentTime = (Number(seek.value) / 1000) * a.duration;
});

/* ---------- sheet ---------- */

$('sheet-toggle').addEventListener('click', async () => {
  const el = $('sheet');
  if (!el.hidden) { el.hidden = true; return; }
  el.hidden = false;
  if (!state.sheet) {
    el.innerHTML = '<h3 class="sheet-name">Sheet</h3><p class="error">loading…</p>';
    await loadSheet(); // renders the sheet, or the error, itself
    return;
  }
  renderSheet();
});

let sheetError = '';
async function loadSheet() {
  if (!state.campaignId) return;
  try {
    const data = await api(`/api/campaigns/${state.campaignId}/sheet`);
    state.sheet = data.sheet || data;
    sheetError = '';
  } catch (err) {
    if (/not signed in/.test(err.message)) return; // api() already bounced to login
    sheetError = err.message;
  }
  if (!$('sheet').hidden) renderSheet();
}

const ABILITIES = [['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA']];
const SAVE_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const SKILL_NAMES = {
  acrobatics: 'Acrobatics', animal_handling: 'Animal Handling', arcana: 'Arcana',
  athletics: 'Athletics', deception: 'Deception', history: 'History', insight: 'Insight',
  intimidation: 'Intimidation', investigation: 'Investigation', medicine: 'Medicine',
  nature: 'Nature', perception: 'Perception', performance: 'Performance',
  persuasion: 'Persuasion', religion: 'Religion', sleight_of_hand: 'Sleight of Hand',
  stealth: 'Stealth', survival: 'Survival',
};
const SPELL_ABILITY = { int: 'INT', wis: 'WIS', cha: 'CHA' };
const mod = (score) => Math.floor(((Number(score) || 10) - 10) / 2);
const signed = (n) => (n >= 0 ? '+' : '') + n;
const pretty = (id, names) => names[id] || String(id).replace(/_/g, ' ');

function sheetSection(title, icon) {
  const sec = document.createElement('section');
  sec.className = 'sheet-sec';
  const h = document.createElement('h4');
  if (icon) {
    const i = document.createElement('i');
    i.className = `ra ${icon}`;
    i.setAttribute('aria-hidden', 'true');
    h.appendChild(i);
  }
  h.appendChild(document.createTextNode(title));
  sec.appendChild(h);
  return sec;
}

function chip(text, cls = '') {
  const c = document.createElement('span');
  c.className = ('chip ' + cls).trim();
  c.textContent = text;
  return c;
}

function renderSheet() {
  const el = $('sheet');
  el.innerHTML = '';
  const s = state.sheet || {};

  // the drawer covers the top bar's right-hand buttons, so it needs its own close
  const close = document.createElement('button');
  close.className = 'sheet-close';
  close.setAttribute('aria-label', 'Close sheet');
  close.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>';
  close.addEventListener('click', () => { el.hidden = true; });
  el.appendChild(close);

  if (sheetError && !state.sheet) {
    el.insertAdjacentHTML('beforeend', `<p class="error">${esc(sheetError)}</p>`);
    return;
  }
  if (!state.sheet) {
    el.insertAdjacentHTML('beforeend', '<p class="error">loading…</p>');
    return;
  }

  const identity = document.createElement('h3');
  identity.className = 'sheet-name';
  identity.textContent = s.name || 'Unnamed';
  el.appendChild(identity);

  const who = [s.race, [s.class, s.subclass].filter(Boolean).join(' · '), s.alignment]
    .filter(Boolean).join(' — ');
  const lvl = s.level != null ? `Level ${s.level}` : '';
  const sub = document.createElement('p');
  sub.className = 'sheet-sub';
  sub.textContent = [who, lvl].filter(Boolean).join(' · ');
  el.appendChild(sub);

  // vitals
  const prof = 2 + Math.floor(((s.level || 1) - 1) / 4);
  const dexMod = mod(s.abilities?.dex);
  const wisMod = mod(s.abilities?.wis);
  const skills = s.proficiencies?.skills || [];
  const pp = 10 + wisMod + (skills.includes('perception') ? prof : 0);
  const hd = s.hitDice || {};
  const vitals = document.createElement('div');
  vitals.className = 'sheet-vitals';
  const hpTxt = `${s.currentHp ?? '?'} / ${s.maxHp ?? '?'}`;
  vitals.innerHTML = `
    <div class="sheet-hp"><b>${esc(hpTxt)}</b><span>hit points${s.tempHp ? ` · ${esc(s.tempHp)} temp` : ''}</span></div>
    <div class="stat-grid">
      <div><b>${esc(s.ac ?? '?')}</b><span>AC</span></div>
      <div><b>${esc(s.speed ?? '?')}</b><span>speed</span></div>
      <div><b>${signed(dexMod)}</b><span>init</span></div>
      <div><b>${signed(pp)}</b><span>pass perc</span></div>
      <div><b>${esc(hd.total != null ? `${hd.total - (hd.spent || 0)}/${hd.total}` : '?')}</b><span>hit dice${hd.die ? ` ${esc(hd.die)}` : ''}</span></div>
      <div><b>${esc(s.xp ?? '—')}</b><span>xp</span></div>
    </div>`;
  el.appendChild(vitals);

  // ability scores
  const abil = sheetSection('Abilities', 'ra-muscle-up');
  const abilGrid = document.createElement('div');
  abilGrid.className = 'abil-grid';
  for (const [key, label] of ABILITIES) {
    const score = s.abilities?.[key];
    const d = document.createElement('div');
    d.innerHTML = `<b>${esc(score ?? '—')}</b><span>${label}<i>${score != null ? signed(mod(score)) : ''}</i></span>`;
    abilGrid.appendChild(d);
  }
  abil.appendChild(abilGrid);
  el.appendChild(abil);

  // saves + skills (trained only; the full list is the full app's problem)
  const profs = sheetSection('Proficiencies', 'ra-aware');
  const saveList = (s.proficiencies?.saves || []).map((k) => pretty(k, SAVE_NAMES));
  const skillList = skills.map((k) => pretty(k, SKILL_NAMES) + ((s.proficiencies?.expertise || []).includes(k) ? ' ●' : ''));
  if (saveList.length || skillList.length) {
    if (saveList.length) {
      const row = document.createElement('p');
      row.className = 'prof-line';
      row.innerHTML = '<b>Saves</b> ';
      row.appendChild(chip(saveList.join(', '), 'plain'));
      profs.appendChild(row);
    }
    if (skillList.length) {
      const row = document.createElement('p');
      row.className = 'prof-line';
      row.innerHTML = '<b>Skills</b> ';
      row.appendChild(chip(skillList.join(', '), 'plain'));
      profs.appendChild(row);
    }
    const lang = (s.proficiencies?.languages || []).concat(s.proficiencies?.tools || []);
    if (lang.length) {
      const row = document.createElement('p');
      row.className = 'prof-line';
      row.innerHTML = '<b>Languages &amp; tools</b> ';
      row.appendChild(chip(lang.join(', '), 'plain'));
      profs.appendChild(row);
    }
    el.appendChild(profs);
  }

  // spellcasting
  const sp = s.spellcasting;
  if (sp) {
    const sec = sheetSection('Spellcasting', 'ra-scroll-unfurled');
    const ab = SPELL_ABILITY[sp.ability] || '—';
    const abMod = sp.ability ? mod(s.abilities?.[sp.ability]) : 0;
    const head = document.createElement('p');
    head.className = 'prof-line';
    head.innerHTML = `<b>${esc(ab)}</b> DC ${8 + prof + abMod} · attack ${signed(prof + abMod)}`;
    sec.appendChild(head);
    const slots = sp.slots || {};
    for (const lvlKey of Object.keys(slots).sort((a, b) => a - b)) {
      const { max, used } = slots[lvlKey] || {};
      if (!max) continue;
      const left = Math.max(0, (max || 0) - (used || 0));
      const row = document.createElement('div');
      row.className = 'slot-row';
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < left ? 'full' : ''}"></i>`).join('');
      const n = Number(lvlKey);
      row.innerHTML = `<b>${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}</b><span class="slotbar">${pips}</span><small>${left}/${max}</small>`;
      sec.appendChild(row);
    }
    const spellChips = (title, list) => {
      if (!list?.length) return;
      const row = document.createElement('p');
      row.className = 'prof-line';
      row.innerHTML = `<b>${title}</b> `;
      row.appendChild(chip(list.join(', '), 'plain'));
      sec.appendChild(row);
    };
    spellChips('Cantrips', sp.cantrips);
    spellChips('Prepared', sp.prepared);
    spellChips('Known', sp.known);
    spellChips('Spellbook', sp.spellbook);
    el.appendChild(sec);
  }

  // features & feats
  const feats = (s.features || []).concat(s.feats || []);
  if (feats.length) {
    const sec = sheetSection('Features', 'ra-pawn');
    const list = document.createElement('ul');
    list.className = 'feat-list';
    for (const f of feats) {
      const li = document.createElement('li');
      const src = f.source ? ` <small>${esc(f.source)}${f.level ? ` · lv ${esc(f.level)}` : ''}</small>` : '';
      li.innerHTML = `${esc(f.name || f)}${src}`;
      list.appendChild(li);
    }
    sec.appendChild(list);
    el.appendChild(sec);
  }

  // conditions & resources
  const conds = (s.conditions || []).map(String).filter(Boolean);
  if (s.exhaustion) conds.push(`Exhaustion ${s.exhaustion}`);
  if (s.concentratingOn) conds.push(`Concentrating: ${s.concentratingOn}`);
  const resKeys = Object.keys(s.resources || {}).filter((k) => s.resources[k]?.max);
  if (conds.length || resKeys.length) {
    const sec = sheetSection('Condition', 'ra-player-pain');
    for (const c of conds) sec.appendChild(chip(c, 'bad'));
    for (const k of resKeys) {
      const r = s.resources[k];
      sec.appendChild(chip(`${pretty(k.replace(/^racial_/, ''), {})} ${r.max - (r.used || 0)}/${r.max}`));
    }
    el.appendChild(sec);
  }

  // equipment + purse
  const gear = s.equipment || [];
  if (gear.length || s.gold != null) {
    const sec = sheetSection('Equipment', 'ra-ammo-bag');
    if (gear.length) {
      const wrap = document.createElement('div');
      wrap.className = 'chips';
      for (const g of gear) wrap.appendChild(chip(g.qty > 1 ? `${g.name} ×${g.qty}` : g.name));
      sec.appendChild(wrap);
    }
    if (s.gold != null || s.copper != null) {
      const purse = document.createElement('p');
      purse.className = 'prof-line';
      purse.innerHTML = `<b>Purse</b> ${esc(s.gold ?? 0)} gp${s.copper ? ` ${esc(s.copper)} cp` : ''}`;
      sec.appendChild(purse);
    }
    el.appendChild(sec);
  }

  // notes
  if (s.notes || s.backstory) {
    const sec = sheetSection('Notes', 'ra-quill-ink');
    const d = document.createElement('details');
    if (s.notes) {
      const n = document.createElement('p');
      n.className = 'sheet-note';
      n.textContent = s.notes;
      d.appendChild(n);
    }
    if (s.backstory) {
      const sum = document.createElement('summary');
      sum.textContent = 'Backstory';
      d.appendChild(sum);
      const b = document.createElement('p');
      b.className = 'sheet-note';
      b.textContent = s.backstory;
      d.appendChild(b);
    }
    sec.appendChild(d);
    el.appendChild(sec);
  }
}

/* ---------- settings: text size (strict 16px floor) ---------- */

const TEXT_SIZES = [
  { scale: 1, label: 'Default' },
  { scale: 1.25, label: 'Large' },
  { scale: 1.5, label: 'Larger' },
  { scale: 1.75, label: 'Largest' },
];
// The floor lives in CSS (html font-size: max(16px, …)) and is repeated here:
// a corrupted stored value can only ever clamp UP to readable, never down.
const clampScale = (v) => Math.min(1.75, Math.max(1, Number(v) || 1));
let textScale = clampScale(localStorage.getItem('ogml_textscale'));

function applyTextScale(v, save = true) {
  textScale = clampScale(v);
  document.documentElement.style.setProperty('--textscale', textScale);
  if (save) {
    try { localStorage.setItem('ogml_textscale', String(textScale)); } catch {}
    flashSettings(TEXT_SIZES.find(t => t.scale === textScale).label + ' text.');
  }
  for (const b of document.querySelectorAll('#textsize-opts .size-opt'))
    b.setAttribute('aria-pressed', String(clampScale(b.dataset.scale) === textScale));
}

(function buildSettings() {
  const wrap = $('textsize-opts');
  for (const { scale, label } of TEXT_SIZES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'size-opt';
    b.dataset.scale = scale;
    b.innerHTML = // esc() not needed: only literals below reach innerHTML
      `<span class="sample" style="font-size:calc(1rem * ${scale})">A</span>` +
      `<span class="lbl">${label}</span>`;
    b.addEventListener('click', () => applyTextScale(scale));
    wrap.appendChild(b);
  }
})();

applyTextScale(textScale, false); // sync pressed states with the pre-paint value

/* ---------- settings: narration typeface (Lora / Cormorant / IM Fell) ---------- */

// labels render in their own face; ids map to html[data-serif]
const NARRATE_FACES = [
  { id: 'lora', label: 'Lora', css: "'Lora', Georgia, serif" },
  { id: 'cormorant', label: 'Cormorant', css: "'Cormorant Garamond', Georgia, serif" },
  { id: 'fell', label: 'IM Fell', css: "'IM Fell English', Georgia, serif" },
];
function narrateFace() {
  const f = localStorage.getItem('ogml_face');
  return NARRATE_FACES.some(x => x.id === f) ? f : 'lora';
}
function applyFace(id, save = true) {
  if (id === 'lora') delete document.documentElement.dataset.serif;
  else document.documentElement.dataset.serif = id;
  if (save) {
    try { localStorage.setItem('ogml_face', id); } catch {}
    flashSettings(NARRATE_FACES.find(x => x.id === id).label + ' type.');
  }
  for (const b of document.querySelectorAll('#face-opts .face-opt'))
    b.setAttribute('aria-pressed', String(b.dataset.face === narrateFace()));
}

(function buildFaces() {
  const wrap = $('face-opts');
  for (const { id, label, css } of NARRATE_FACES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'face-opt';
    b.dataset.face = id;
    b.style.fontFamily = css;
    b.textContent = label;
    b.addEventListener('click', () => applyFace(id));
    wrap.appendChild(b);
  }
  applyFace(narrateFace(), false); // sync pressed states with the pre-paint value
})();

/* ---------- settings: narration (on demand / auto) ---------- */

const NARRATE_MODES = [
  { id: 'tap', label: 'On demand narration' },
  { id: 'auto', label: 'Automatic narration' },
];
// one line of flash on change, then gone — the labels stay in the buttons
const NARRATE_FLASH = { tap: 'On demand narration.', auto: 'Automatic narration.' };

function syncNarrateOpts() {
  for (const b of document.querySelectorAll('#narrate-opts .narrate-opt'))
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.narrate));
}

(function buildNarrate() {
  const wrap = $('narrate-opts');
  for (const { id, label } of NARRATE_MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'narrate-opt';
    b.dataset.mode = id;
    b.textContent = label;
    b.addEventListener('click', () => setNarrate(id));
    wrap.appendChild(b);
  }
  syncNarrateOpts();
})();

function setNarrate(mode) {
  state.narrate = mode;
  try {
    localStorage.setItem('ogml_narrate', mode);
    localStorage.removeItem('ogml_tts');
  } catch {}
  syncNarrateOpts();
  flashSettings(NARRATE_FLASH[mode]);
}

let flashTimer = null;
function flashSettings(text) {
  const el = $('settings-flash');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function openSettings() {
  const el = $('settings');
  // sit just below whichever bar is visible — the bar grows with text scale
  const bar = document.querySelector('#home:not([hidden]) .bar, #table:not([hidden]) .bar');
  if (bar) el.style.top = `calc(${Math.round(bar.getBoundingClientRect().bottom)}px + 6px)`;
  el.hidden = false;
}
function closeSettings() { $('settings').hidden = true; }
// tap anywhere outside the open sheet closes it
document.addEventListener('click', (e) => {
  const el = $('sheet');
  if (el.hidden) return;
  if (e.target.closest('#sheet') || e.target.closest('#sheet-toggle')) return;
  el.hidden = true;
});
for (const b of document.querySelectorAll('.settings-open')) b.addEventListener('click', openSettings);
$('settings-close').addEventListener('click', closeSettings);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });
document.addEventListener('click', (e) => {
  if ($('settings').hidden) return;
  if (e.target.closest('#settings') || e.target.closest('.settings-open')) return;
  closeSettings();
});

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
