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

$('back').addEventListener('click', async () => {
  if (state.es) { state.es.close(); state.es = null; }
  try { await home(); } catch {}
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
  $('tts-toggle').classList.toggle('on', state.tts);
  if (!state.tts) speechSynthesis.cancel();
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

function sheetSection(title) {
  const sec = document.createElement('section');
  sec.className = 'sheet-sec';
  const h = document.createElement('h4');
  h.textContent = title;
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
  const abil = sheetSection('Abilities');
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
  const profs = sheetSection('Proficiencies');
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
    const sec = sheetSection('Spellcasting');
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
    const sec = sheetSection('Features');
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
    const sec = sheetSection('Condition');
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
    const sec = sheetSection('Equipment');
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
    const sec = sheetSection('Notes');
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
      `<span class="lbl">${label}<small>${Math.round(16 * scale)} px and up</small></span>`;
    b.addEventListener('click', () => applyTextScale(scale));
    wrap.appendChild(b);
  }
})();

applyTextScale(textScale, false); // sync pressed states with the pre-paint value

function openSettings() {
  const el = $('settings');
  // sit just below whichever bar is visible — the bar grows with text scale
  const bar = document.querySelector('#home:not([hidden]) .bar, #table:not([hidden]) .bar');
  if (bar) el.style.top = `calc(${Math.round(bar.getBoundingClientRect().bottom)}px + 6px)`;
  el.hidden = false;
}
function closeSettings() { $('settings').hidden = true; }
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
