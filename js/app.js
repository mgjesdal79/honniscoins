import { getRoom, loadState, scheduleSave, startPolling } from './store.js';
import {
  isoDate, nearestWeekday, stepWeekday, weekdayKey, subjectsForDate,
  setMark, setSick, addPayout, logSettingsChange, computeBalance, formatKr, WEEKDAY_KEYS,
  isWeekLocked, attendanceStreakInfo, classifyDay, dailyTotal, weeklyTotal,
  weekdaysOf, daySubjectsMatchTimetable, resyncSubjects,
} from './logic.js';

const el = document.getElementById('app');
const room = getRoom();

const App = {
  state: null,
  room,
  role: localStorage.getItem('honniscoins:role') || null, // 'son' | 'parent' | null
  parentUnlocked: false,
  currentDate: nearestWeekday(isoDate(new Date())),
  parentTab: 'uke',
};

// --- hjelpere ------------------------------------------------------------

function save() {
  scheduleSave(App.room, () => App.state);
}
function nowIso() {
  return new Date().toISOString();
}
function newId() {
  return crypto.randomUUID();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const MEDAL_BTNS = [
  { medal: '0', cls: 'zero', label: '0' },
  { medal: 'bronse', cls: 'b', label: '🥉' },
  { medal: 'solv', cls: 's', label: '🥈' },
  { medal: 'gull', cls: 'g', label: '🥇' },
];
const WD_NAME = { mon: 'Mandag', tue: 'Tirsdag', wed: 'Onsdag', thu: 'Torsdag', fri: 'Fredag' };
const MEDAL_LABEL = { 0: '0 Fravær', bronse: '🥉 Bronse', solv: '🥈 Sølv', gull: '🥇 Gull' };

function fmtDayLabel(iso) {
  const wk = weekdayKey(iso);
  const [, m, d] = iso.split('-');
  return { wd: WD_NAME[wk] || '', dm: `${Number(d)}.${Number(m)}` };
}
function medalLabel(m) {
  return m == null ? '–' : MEDAL_LABEL[m] || m;
}

// --- rollevalg -----------------------------------------------------------

function setRole(role) {
  App.role = role;
  if (role) localStorage.setItem('honniscoins:role', role);
  else localStorage.removeItem('honniscoins:role');
  App.parentUnlocked = false;
  routeToView();
}

function renderWho() {
  el.innerHTML = `
    <div class="who">
      <div><div class="logo">🪙</div><h1>Honniscoins</h1><div class="muted">Velg hvem du er</div></div>
      <div class="role" id="roleSon"><span class="em">🧒</span><div><b>Sønn</b><span>Timeplan og medaljer</span></div></div>
      <div class="role" id="roleParent"><span class="em">👨‍👩‍👦</span><div><b>Forelder</b><span>Innstillinger og logg · kode</span></div></div>
    </div>`;
  document.getElementById('roleSon').onclick = () => setRole('son');
  document.getElementById('roleParent').onclick = () => setRole('parent');
}

// --- sønnens dag ---------------------------------------------------------

function renderSon() {
  const s = App.state,
    date = App.currentDate;
  const today = isoDate(new Date());
  const locked = App.role === 'son' && isWeekLocked(date, today);
  const subjects = subjectsForDate(s, date);
  const marks = (s.days[date] && s.days[date].marks) || {};
  const isSick = !!(s.days[date] && s.days[date].sick);
  const bal = computeBalance(s);
  const streak = attendanceStreakInfo(s, today);
  const wTot = weeklyTotal(s, date);
  const dTot = dailyTotal(s, date);
  const cls = classifyDay(s, date);
  const { wd, dm } = fmtDayLabel(date);

  const lessons = subjects.length
    ? subjects
        .map((name, i) => {
          const cur = marks[String(i)] ? marks[String(i)].medal : null;
          const btns = MEDAL_BTNS.map(
            (b) =>
              `<button class="m ${b.cls} ${cur === b.medal ? 'sel' : ''}" data-idx="${i}" data-medal="${b.medal}"${
                locked ? ' disabled' : ''
              }>${b.label}</button>`
          ).join('');
          return `<div class="lesson"><div class="name">${escapeHtml(name)}</div><div class="medals">${btns}</div></div>`;
        })
        .join('')
    : `<div class="card muted">Ingen fag satt opp for ${wd || 'denne dagen'}. En forelder kan legge inn timeplanen.</div>`;

  const canSync = App.role === 'parent' && !daySubjectsMatchTimetable(s, date);
  const who = App.role === 'parent' ? '👨‍👩‍👦 Forelder (overstyrer)' : '🧒 Sønn';
  const brand =
    App.role === 'son'
      ? `<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin:2px 0 10px">
          <img src="icon-192.png" alt="" width="40" height="40" style="border-radius:10px">
          <b style="font-size:1.2rem">Honniscoins</b>
        </div>`
      : '';
  const dayStatus = isSick
    ? '🤒 Merket syk/fri'
    : cls === 'present'
    ? `✅ Hel dag til stede · +${streak.bonusPerDay}`
    : cls === 'broken'
    ? '⚠️ Fravær uten syk-merking'
    : subjects.length
    ? '⏳ Ikke ferdig vurdert'
    : '';

  el.innerHTML = `
    ${brand}
    <div class="topbar"><span class="muted">${who}</span>
      <button class="link" id="switchUser">Bytt bruker</button></div>
    <div class="balance">
      <div class="coins">${bal} <small>Honniscoins</small></div>
      <div class="kr">≈ ${formatKr(bal, s.settings.krPerCoin)} · denne uka +${wTot}</div>
      <div class="kr">🔥 Oppmøte-streak: ${streak.length} ${streak.length === 1 ? 'dag' : 'dager'} · +${streak.bonusPerDay}/dag</div>
    </div>
    <div class="daynav">
      <button class="arrow" id="prevDay">‹</button>
      <div class="today"><b>${wd}</b><div class="d">${dm} · <input type="date" id="datePick" value="${date}"></div></div>
      <button class="arrow" id="nextDay">›</button>
    </div>
    ${locked ? '<div class="card muted" style="margin-bottom:10px">🔒 Låst uke – be en forelder om å endre.</div>' : ''}
    ${canSync ? `<div class="card" style="margin-bottom:10px;border-color:var(--gold)">
      <div style="font-size:.85rem;margin-bottom:8px">⚠️ Fagene her stemmer ikke med timeplanen. Trolig frosset før timeplanen var ferdig.</div>
      <button class="btn ghost" id="syncSubjects">Synk fag fra timeplan</button></div>` : ''}
    <div class="row" style="border:none;padding:2px 4px 10px">
      <div class="lbl muted" style="font-size:.82rem">${dayStatus}</div>
      <button class="pill" id="sickToggle"${locked ? ' disabled' : ''} style="${
        isSick ? 'color:var(--gold);border-color:var(--gold)' : ''
      }">${isSick ? '🤒 Syk/fri: på' : '🤒 Merk syk/fri'}</button>
    </div>
    <div id="lessons">${lessons}</div>
    ${subjects.length ? `<div class="daysum">+${dTot} Honniscoins i dag</div>` : ''}`;

  document.getElementById('prevDay').onclick = () => {
    App.currentDate = stepWeekday(date, -1);
    routeToView();
  };
  document.getElementById('nextDay').onclick = () => {
    App.currentDate = stepWeekday(date, 1);
    routeToView();
  };
  document.getElementById('datePick').onchange = (e) => {
    App.currentDate = nearestWeekday(e.target.value);
    routeToView();
  };
  document.getElementById('switchUser').onclick = () => setRole(null);
  const syncBtn = document.getElementById('syncSubjects');
  if (syncBtn)
    syncBtn.onclick = () => {
      App.state = resyncSubjects(App.state, { date, actor: 'parent' }, { now: nowIso(), id: newId() });
      save();
      routeToView();
    };
  const sickBtn = document.getElementById('sickToggle');
  if (sickBtn)
    sickBtn.onclick = () => {
      if (locked) return;
      const actor = App.role === 'parent' ? 'parent' : 'son';
      App.state = setSick(App.state, { date, sick: !isSick, actor }, { now: nowIso(), id: newId() });
      save();
      routeToView();
    };
  el.querySelectorAll('.m').forEach(
    (btn) =>
      (btn.onclick = () => {
        if (locked) return;
        const idx = Number(btn.dataset.idx);
        const cur = marks[String(idx)] ? marks[String(idx)].medal : null;
        const medal = cur === btn.dataset.medal ? null : btn.dataset.medal; // toggle av = null
        const actor = App.role === 'parent' ? 'parent' : 'son';
        App.state = setMark(App.state, { date, idx, medal, actor }, { now: nowIso(), id: newId() });
        save();
        routeToView();
      })
  );
}

// --- foreldre: kode-gate -------------------------------------------------

function renderParent() {
  if (!App.parentUnlocked) return renderPin();
  return renderParentHome();
}

function renderPin() {
  const hasPin = !!App.state.settings.pin;
  let entry = '';
  const draw = () => {
    const dots = [0, 1, 2, 3].map((i) => `<div class="pindot ${i < entry.length ? 'on' : ''}"></div>`).join('');
    el.innerHTML = `
      <div class="topbar"><span class="muted">👨‍👩‍👦 Forelder</span>
        <button class="link" id="switchUser">Bytt bruker</button></div>
      <div class="pinwrap">
        <div style="text-align:center"><div style="font-size:1.8rem">🔒</div>
          <b id="pinTitle">${hasPin ? 'Foreldremodus' : 'Lag en kode'}</b>
          <div class="muted">${hasPin ? 'Skriv koden' : 'Velg en 4-sifret kode'}</div></div>
        <div class="pindots">${dots}</div>
        <div class="keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="key" data-k="${n}">${n}</button>`).join('')}
          <button class="key blank"></button>
          <button class="key" data-k="0">0</button>
          <button class="key" data-k="del">⌫</button>
        </div>
      </div>`;
    document.getElementById('switchUser').onclick = () => setRole(null);
    el.querySelectorAll('.key[data-k]').forEach(
      (b) =>
        (b.onclick = () => {
          const k = b.dataset.k;
          if (k === 'del') entry = entry.slice(0, -1);
          else if (entry.length < 4) entry += k;
          if (entry.length === 4) return submit();
          draw();
        })
    );
  };
  const submit = () => {
    if (!hasPin) {
      App.state.settings.pin = entry;
      App.state.settings.updatedAt = nowIso();
      App.state = logSettingsChange(
        App.state,
        { actor: 'parent', field: 'pin', from: null, to: 'satt' },
        { now: nowIso(), id: newId() }
      );
      save();
      App.parentUnlocked = true;
      return routeToView();
    }
    if (entry === App.state.settings.pin) {
      App.parentUnlocked = true;
      return routeToView();
    }
    entry = '';
    draw();
    document.getElementById('pinTitle').textContent = 'Feil kode – prøv igjen';
  };
  draw();
}

// --- foreldre: hjem + faner ----------------------------------------------

let editWeekday = 'mon';

function renderParentHome() {
  const tabs = [
    ['uke', 'Uke'],
    ['dag', 'Dag'],
    ['timeplan', 'Timeplan'],
    ['poeng', 'Poeng'],
    ['logg', 'Logg'],
  ];
  if (App.parentTab === 'dag') return renderSon(); // forelder ser dag-skjerm (overstyring)
  const bar = tabs
    .map(([k, l]) => `<button class="t ${App.parentTab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`)
    .join('');
  el.innerHTML = `
    <div class="topbar"><span class="muted">👨‍👩‍👦 Forelder</span>
      <button class="link" id="switchUser">Bytt bruker</button></div>
    <div class="tabbar">${bar}</div>
    <div id="ptab"></div>`;
  document.getElementById('switchUser').onclick = () => setRole(null);
  el.querySelectorAll('.t[data-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        App.parentTab = b.dataset.tab;
        routeToView();
      })
  );
  const host = document.getElementById('ptab');
  if (App.parentTab === 'uke') return renderUkeTab(host);
  if (App.parentTab === 'timeplan') return renderTimeplanTab(host);
  if (App.parentTab === 'poeng') return renderPoengTab(host);
  if (App.parentTab === 'logg') return renderLoggTab(host);
}

// Ukesoppsummering: saldo + streak øverst, så man–fre med status og dagstotal.
function renderUkeTab(host) {
  const s = App.state;
  const today = isoDate(new Date());
  const days = weekdaysOf(today);
  const bal = computeBalance(s);
  const streak = attendanceStreakInfo(s, today);
  const wTot = weeklyTotal(s, today);

  const rows = days
    .map((d) => {
      const cls = classifyDay(s, d);
      const day = s.days[d];
      const sick = !!(day && day.sick);
      const subjects = subjectsForDate(s, d);
      const dTot = dailyTotal(s, d);
      const { wd, dm } = fmtDayLabel(d);
      const status = sick
        ? '🤒 Syk/fri'
        : cls === 'present'
        ? '✅ Hel dag til stede'
        : cls === 'broken'
        ? '⚠️ Fravær uten syk'
        : subjects.length
        ? '⏳ Ikke ferdig vurdert'
        : '– ingen fag';
      const isToday = d === today;
      return `<button class="row" data-goday="${d}" style="width:100%;background:transparent;color:var(--text);border:none;border-bottom:1px solid #10233f;font-family:var(--font)">
        <div style="text-align:left"><div class="lbl">${wd}${isToday ? ' · i dag' : ''}</div>
          <div class="muted" style="font-size:.74rem">${dm} · ${status}</div></div>
        <div class="pill">+${dTot}</div></button>`;
    })
    .join('');

  host.innerHTML = `
    <div class="balance">
      <div class="coins">${bal} <small>Honniscoins</small></div>
      <div class="kr">≈ ${formatKr(bal, s.settings.krPerCoin)} · denne uka +${wTot}</div>
      <div class="kr">🔥 Oppmøte-streak: ${streak.length} ${streak.length === 1 ? 'dag' : 'dager'} · +${streak.bonusPerDay}/dag</div>
    </div>
    <div class="sec">Denne uka</div>
    ${rows}`;
  host.querySelectorAll('[data-goday]').forEach(
    (b) =>
      (b.onclick = () => {
        App.currentDate = b.dataset.goday;
        App.parentTab = 'dag';
        routeToView();
      })
  );
}

function renderTimeplanTab(host) {
  const tt = App.state.settings.timetable;
  const wdBtns = WEEKDAY_KEYS.map(
    (k) =>
      `<button class="pill" data-wd="${k}" style="${
        k === editWeekday ? 'background:var(--accent);border-color:var(--accent)' : ''
      }">${WD_NAME[k].slice(0, 3)}</button>`
  ).join(' ');
  const list = (tt[editWeekday] || [])
    .map(
      (name, i) => `
    <div class="row"><input class="inp wide" data-i="${i}" value="${escapeHtml(name)}">
      <button class="link" data-del="${i}">Fjern</button></div>`
    )
    .join('');
  host.innerHTML = `
    <div style="display:flex;gap:6px;margin:2px 0 10px;flex-wrap:wrap">${wdBtns}</div>
    ${list || '<div class="muted" style="padding:8px 4px">Ingen fag denne dagen.</div>'}
    <button class="btn ghost" id="addSubj" style="margin-top:12px">+ Legg til fag</button>`;
  host.querySelectorAll('.pill[data-wd]').forEach(
    (b) =>
      (b.onclick = () => {
        editWeekday = b.dataset.wd;
        routeToView();
      })
  );
  host.querySelectorAll('.inp[data-i]').forEach((inp) => {
    // Marker hele teksten ved fokus (tab/klikk) så man bare kan skrive over.
    inp.onfocus = () => inp.select();
    inp.onchange = () => {
      tt[editWeekday][Number(inp.dataset.i)] = inp.value.trim();
      App.state.settings.updatedAt = nowIso();
      save();
    };
  });
  host.querySelectorAll('[data-del]').forEach(
    (b) =>
      (b.onclick = () => {
        tt[editWeekday].splice(Number(b.dataset.del), 1);
        App.state.settings.updatedAt = nowIso();
        save();
        routeToView();
      })
  );
  document.getElementById('addSubj').onclick = () => {
    tt[editWeekday].push('Nytt fag');
    App.state.settings.updatedAt = nowIso();
    save();
    routeToView();
  };
}

function renderPoengTab(host) {
  const s = App.state,
    v = s.settings.medalValues;
  host.innerHTML = `
    <div class="sec">Poengverdier</div>
    <div class="card" style="padding:2px 12px">
      <div class="row"><div class="lbl">🥉 Bronse</div><input class="inp" id="vBronse" type="number" min="0" value="${v.bronse}"></div>
      <div class="row"><div class="lbl">🥈 Sølv</div><input class="inp" id="vSolv" type="number" min="0" value="${v.solv}"></div>
      <div class="row" style="border:none"><div class="lbl">🥇 Gull</div><input class="inp" id="vGull" type="number" min="0" value="${v.gull}"></div>
    </div>
    <div class="sec">Kroneverdi (frakoblet poeng)</div>
    <div class="card" style="padding:2px 12px">
      <div class="row" style="border:none"><div class="lbl">Kr per Honniscoin</div>
        <input class="inp" id="krRate" type="number" min="0" step="0.5" value="${s.settings.krPerCoin}"></div>
    </div>
    <div id="payoutHost"></div>`;
  const bind = (id, field) => {
    document.getElementById(id).onchange = (e) => {
      const from = v[field];
      const to = Number(e.target.value);
      if (to === from) return;
      v[field] = to;
      s.settings.updatedAt = nowIso();
      App.state = logSettingsChange(App.state, { actor: 'parent', field, from, to }, { now: nowIso(), id: newId() });
      save();
    };
  };
  bind('vBronse', 'bronse');
  bind('vSolv', 'solv');
  bind('vGull', 'gull');
  document.getElementById('krRate').onchange = (e) => {
    const from = s.settings.krPerCoin,
      to = Number(e.target.value);
    if (to === from) return;
    s.settings.krPerCoin = to;
    s.settings.updatedAt = nowIso();
    App.state = logSettingsChange(
      App.state,
      { actor: 'parent', field: 'krPerCoin', from, to },
      { now: nowIso(), id: newId() }
    );
    save();
  };
  renderPayoutSection(document.getElementById('payoutHost'));
}

function renderPayoutSection(host) {
  const s = App.state;
  const rows = (s.payouts || [])
    .slice()
    .reverse()
    .map((p) => {
      const krTxt = p.kr != null ? ` · ${formatKr(p.kr, 1)}` : '';
      return `<div class="row"><div class="lbl">${escapeHtml(p.note || 'Utbetaling')}
      <span class="muted" style="font-size:.72rem">${krTxt}</span></div>
      <div class="pill" style="color:var(--bad)">−${p.coins}</div></div>`;
    })
    .join('');
  host.innerHTML = `
    <div class="sec">Utbetalinger (innløste coins)</div>
    <div class="card" style="padding:2px 12px">
      ${rows || '<div class="muted" style="padding:8px 4px">Ingen utbetalinger ennå.</div>'}
      <div class="row" style="border:none;flex-wrap:wrap;gap:6px">
        <input class="inp" id="poCoins" type="number" min="1" placeholder="coins" style="width:80px">
        <input class="inp" id="poKr" type="number" min="0" placeholder="kr" style="width:70px">
        <input class="inp wide" id="poNote" placeholder="notat (f.eks. Kino)" style="flex:1;min-width:120px">
        <button class="btn" id="poAdd" style="width:auto;padding:8px 14px">Registrer</button>
      </div>
    </div>`;
  document.getElementById('poAdd').onclick = () => {
    const coins = Number(document.getElementById('poCoins').value);
    if (!coins || coins <= 0) return;
    const krRaw = document.getElementById('poKr').value;
    const kr = krRaw === '' ? null : Number(krRaw);
    const note = document.getElementById('poNote').value.trim();
    App.state = addPayout(App.state, { coins, kr, note, by: 'parent' }, { now: nowIso(), id: newId() });
    save();
    routeToView();
  };
}

function fmtLogWhen(iso) {
  const d = new Date(iso);
  const day = isoDate(d),
    today = isoDate(new Date());
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (day === today) return `i dag ${hm}`;
  const [, m, dd] = day.split('-');
  return `${Number(dd)}.${Number(m)} ${hm}`;
}

function renderLoggTab(host) {
  const log = (App.state.log || [])
    .slice()
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
    .slice(0, 200);
  if (!log.length) {
    host.innerHTML = '<div class="muted" style="padding:12px 4px">Ingen hendelser ennå.</div>';
    return;
  }
  host.innerHTML = log
    .map((e) => {
      const tag = `<span class="tag ${e.actor}">${e.actor === 'parent' ? 'Forelder' : 'Sønn'}</span>`;
      const when = `<span>${fmtLogWhen(e.at)}</span>`;
      let txt = '';
      if (e.type === 'grade') {
        const dl = fmtDayLabel(e.day);
        txt =
          `${escapeHtml(e.subject || '')} (${dl.wd.slice(0, 3).toLowerCase()} ${dl.dm}): ${medalLabel(
            e.from
          )} → <b>${medalLabel(e.to)}</b>` + (e.actor === 'parent' ? ' <span class="muted">(overstyrt)</span>' : '');
      } else if (e.type === 'payout') {
        txt = `Utbetaling: <b>−${e.coins} Honniscoins</b>${e.note ? ' · «' + escapeHtml(e.note) + '»' : ''}`;
      } else if (e.type === 'settings') {
        const names = { bronse: 'Bronse', solv: 'Sølv', gull: 'Gull', krPerCoin: 'Kr-kurs', pin: 'Kode' };
        txt = `Endret ${names[e.field] || e.field}: ${e.from} → <b>${e.to}</b>`;
      } else if (e.type === 'sick') {
        const dl = fmtDayLabel(e.day);
        txt = `${e.to ? 'Merket <b>syk/fri</b>' : 'Fjernet syk/fri'} (${dl.wd.slice(0, 3).toLowerCase()} ${dl.dm})`;
      } else if (e.type === 'resync') {
        const dl = fmtDayLabel(e.day);
        txt =
          `Synket fag med timeplan (${dl.wd.slice(0, 3).toLowerCase()} ${dl.dm}): ${e.from} → <b>${e.to} fag</b>` +
          (e.dropped ? ` <span class="muted">(${e.dropped} medalje${e.dropped === 1 ? '' : 'r'} falt bort)</span>` : '');
      }
      return `<div class="logitem"><div class="meta">${tag}${when}</div><div class="txt">${txt}</div></div>`;
    })
    .join('');
}

// --- ruter + oppstart ----------------------------------------------------

function routeToView() {
  if (!App.role) return renderWho();
  if (App.role === 'son') return renderSon();
  return renderParent();
}

async function init() {
  document.getElementById('appVersion').textContent = `${window.APP_VERSION} · rom ${App.room.slice(0, 10)}…`;
  App.state = await loadState(App.room);
  startPolling(
    App.room,
    () => App.state,
    (merged) => {
      // Ikke forstyrr en pågående redigering: hvis et tekstfelt er i fokus,
      // vent til brukeren er ferdig (neste poll tar det) så vi ikke stjeler fokus.
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      App.state = merged;
      routeToView();
    }
  );
  routeToView();
}
init();

// Bytt rom uten manuell reload: hvis en ny #r=-lenke limes inn i en åpen fane,
// laster vi siden på nytt så riktig rom hentes fra skyen.
window.addEventListener('hashchange', () => {
  const m = location.hash.match(/[#&]r=([^&]+)/);
  const newRoom = m ? decodeURIComponent(m[1]) : null;
  if (newRoom && newRoom !== App.room) location.reload();
});

// eksponert for feilsøking i konsollen
window.App = App;
window.routeToView = routeToView;
