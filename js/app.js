import { getRoom, loadState, scheduleSave, startPolling } from './store.js';
import {
  isoDate, nearestWeekday, stepWeekday, weekdayKey, subjectsForDate,
  setMark, setSick, addPayout, logSettingsChange, computeBalance, formatKr, WEEKDAY_KEYS,
  attendanceStreakInfo, classifyDay, dailyTotal, weeklyTotal,
  weekdaysOf, daySubjectsMatchTimetable, resyncSubjects,
  isDayLocked, isWeekClosed, canSonEditDay, lockDay, closeWeek, reopenWeek, weekStartIso,
  weeklyMedalCounts, weeklyStreakBonus, silverStreakInfo, goldStreakInfo,
  activeQuests, isQuestOverdue, questPointsPending,
  addQuest, updateQuest, deleteQuest, commitQuest, uncommitQuest, approveQuest, rejectQuest,
  homeworkForWeek, homeworkPointsPending, activeHomework,
  addHomework, updateHomework, deleteHomework, hideHomework,
  commitHomework, uncommitHomework, approveHomework, rejectHomework,
  effortRecords, periodBounds, filterRecordsByPeriod,
  statBySubject, statByPosition, statHeatmap, statTrend, statMedalDistribution,
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
  statPeriod: 'all', // 'all' | 'month' | 'd90' – Statistikk-fanen
  sonPage: localStorage.getItem('honniscoins:sonPage') || 'uken',
  mondayDismissed: false,
  editQuestId: null,
  homeworkView: 'day', // 'day' | 'week' – sønn Uken-lekser
  editHwId: null,      // forelder redigerer lekse
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
const WD_SHORT = { mon: 'Man', tue: 'Tir', wed: 'Ons', thu: 'Tor', fri: 'Fre' };
const MEDAL_LABEL = { 0: '0 Fravær', bronse: '🥉 Bronse', solv: '🥈 Sølv', gull: '🥇 Gull' };

function fmtDayLabel(iso) {
  const wk = weekdayKey(iso);
  const [, m, d] = iso.split('-');
  return { wd: WD_NAME[wk] || '', dm: `${Number(d)}.${Number(m)}` };
}
function medalLabel(m) {
  return m == null ? '–' : MEDAL_LABEL[m] || m;
}

// Kan den innloggede rollen redigere denne dagen nå?
function canEditDate(date) {
  if (App.role === 'parent') return true;
  return canSonEditDay(App.state, date, isoDate(new Date()));
}

// --- delt: fag-liste + bindinger (brukes av både sønn og forelder) --------

function lessonsHtml(s, date, { disabled, big }) {
  const subjects = subjectsForDate(s, date);
  const marks = (s.days[date] && s.days[date].marks) || {};
  const { wd } = fmtDayLabel(date);
  if (!subjects.length)
    return `<div class="card muted">Ingen fag satt opp for ${wd || 'denne dagen'}. En forelder kan legge inn timeplanen.</div>`;
  return subjects
    .map((name, i) => {
      const cur = marks[String(i)] ? marks[String(i)].medal : null;
      const btns = MEDAL_BTNS.map(
        (b) =>
          `<button class="m ${big ? 'fill big' : ''} ${b.cls} ${cur === b.medal ? 'sel' : ''}" data-idx="${i}" data-medal="${b.medal}"${
            disabled ? ' disabled' : ''
          }>${b.label}</button>`
      ).join('');
      return `<div class="lesson ${big ? 'lessonbig' : ''}"><div class="name">${escapeHtml(name)}</div><div class="medals">${btns}</div></div>`;
    })
    .join('');
}

function bindLessons(host, date, disabled) {
  host.querySelectorAll('.m').forEach(
    (btn) =>
      (btn.onclick = () => {
        if (disabled) return;
        const idx = Number(btn.dataset.idx);
        const marks = (App.state.days[date] && App.state.days[date].marks) || {};
        const cur = marks[String(idx)] ? marks[String(idx)].medal : null;
        const medal = cur === btn.dataset.medal ? null : btn.dataset.medal; // toggle av = null
        const actor = App.role === 'parent' ? 'parent' : 'son';
        App.state = setMark(App.state, { date, idx, medal, actor }, { now: nowIso(), id: newId() });
        save();
        routeToView();
      })
  );
}

function toggleSick(date, isSick, disabled) {
  if (disabled) return;
  const actor = App.role === 'parent' ? 'parent' : 'son';
  App.state = setSick(App.state, { date, sick: !isSick, actor }, { now: nowIso(), id: newId() });
  save();
  routeToView();
}

function toggleLock(date, locked) {
  const actor = App.role === 'parent' ? 'parent' : 'son';
  App.state = lockDay(App.state, { date, locked, actor }, { now: nowIso(), id: newId() });
  save();
  routeToView();
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

// --- SØNN: pager (Uken / Poeng / Sidequests) -----------------------------

const SON_PAGES = [
  { key: 'uken', icon: '📅', label: 'Uken' },
  { key: 'poeng', icon: '💵', label: 'Poeng' },
  { key: 'sidequests', icon: '⭐', label: 'Sidequests' },
  { key: 'shop', icon: '🛒', label: 'Shop' },
];

function setSonPage(key) {
  App.sonPage = key;
  localStorage.setItem('honniscoins:sonPage', key);
  routeToView();
}

// Topp-logo med alltid synlig saldo.
function brandHtml() {
  const bal = computeBalance(App.state);
  return `<div class="brand">
      <img src="icon-192.png" alt="" width="34" height="34" style="border-radius:9px">
      <b>Honniscoins:</b><span class="brandbal">${bal} 🪙</span>
    </div>`;
}

function renderSon() {
  const brand = brandHtml();
  const openQuests = activeQuests(App.state).filter((q) => q.status === 'open').length;
  const badgeFor = (key) => (key === 'sidequests' && openQuests ? `<span class="navbadge">${openQuests}</span>` : '');
  const dots = SON_PAGES.map((p) => `<span class="dot ${p.key === App.sonPage ? 'on' : ''}"></span>`).join('');
  const nav = SON_PAGES.map(
    (p) =>
      `<button class="pg ${p.key === App.sonPage ? 'on' : ''}" data-page="${p.key}">
        <span class="i">${p.icon}${badgeFor(p.key)}</span><span class="l">${p.label}</span></button>`
  ).join('');
  el.innerHTML = `
    ${brand}
    <div class="topbar"><span class="muted">🧒 Sønn</span>
      <button class="link" id="switchUser">Bytt bruker</button></div>
    <div id="page" class="page"></div>
    <div class="dots">${dots}</div>
    <div class="pagenav">${nav}</div>`;
  document.getElementById('switchUser').onclick = () => setRole(null);
  el.querySelectorAll('.pg[data-page]').forEach((b) => (b.onclick = () => setSonPage(b.dataset.page)));

  const host = document.getElementById('page');
  if (App.sonPage === 'uken') renderUkenPage(host);
  else if (App.sonPage === 'poeng') renderPoengPage(host);
  else if (App.sonPage === 'shop') renderShopPage(host);
  else renderSidequestsPage(host);

  bindSwipe(host);
}

function bindSwipe(host) {
  let x0 = null, y0 = null;
  host.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    x0 = t.clientX;
    y0 = t.clientY;
  }, { passive: true });
  host.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    const i = SON_PAGES.findIndex((p) => p.key === App.sonPage);
    const ni = dx < 0 ? i + 1 : i - 1;
    if (ni >= 0 && ni < SON_PAGES.length) setSonPage(SON_PAGES[ni].key);
  }, { passive: true });
}

function weekHasContent(s, iso) {
  return weekdaysOf(iso).some((d) => {
    const day = s.days[d];
    return day && ((day.marks && Object.keys(day.marks).length) || day.sick);
  });
}

// Uken: mandag-prompt + ukestrip (5 dager) + stor aktiv dag + lås.
// Sønn: HTML for lekse-seksjonen i Uken. view = 'day' | 'week'.
function homeworkSectionHtml(s, date, view) {
  const week = homeworkForWeek(s, date);
  if (week.length === 0) return '';
  const toggle = `<div class="hwseg">
      <button class="s ${view === 'day' ? 'on' : ''}" data-hwview="day">📅 Dag for dag</button>
      <button class="s ${view === 'week' ? 'on' : ''}" data-hwview="week">📚 Hele uka (fag)</button>
    </div>`;

  const card = (h, showDay) => {
    const weekTag = h.wholeWeek ? `<span class="weektag">🗓 hele uka</span>` : '';
    const dayTag = showDay ? `<span class="hwdaytag">${WD_SHORT[weekdayKey(h.date)]} ${fmtDayLabel(h.date).dm}</span>` : '';
    let action = '';
    if (h.status === 'open') action = `<button class="btn good" data-hwdone="${h.id}">Marker som gjort</button>`;
    else if (h.status === 'done') action = `<div class="muted">⏳ Sendt til godkjenning <button class="link" data-hwundo="${h.id}">Angre</button></div>`;
    else action = `<div class="muted">✅ Godkjent · lagt i potten</div>`;
    const cls = h.status === 'done' ? ' done' : h.status === 'approved' ? ' approved' : '';
    return `<div class="hwcard${cls}">
        <div class="hwtop"><span class="hwsubj">${escapeHtml(h.subject)}${weekTag}${dayTag}</span><span class="hwpts">+${h.points} 🪙</span></div>
        ${h.text ? `<div class="hwtext">${escapeHtml(h.text)}</div>` : ''}
        ${action}
      </div>`;
  };

  let body = '';
  if (view === 'day') {
    const forDay = week.filter((h) => h.date === date);
    body = forDay.length
      ? forDay.map((h) => card(h, false)).join('')
      : `<div class="muted" style="margin:2px">Ingen lekser denne dagen 🎉</div>`;
  } else {
    const bySubject = {};
    for (const h of week) (bySubject[h.subject || '—'] ||= []).push(h);
    body = Object.keys(bySubject).sort((a, b) => a.localeCompare(b)).map((subj) =>
      `<div class="hwsubjhead">📚 ${escapeHtml(subj)}</div>` + bySubject[subj].map((h) => card(h, true)).join('')
    ).join('');
  }

  return `<div class="hwsec">📚 Lekser</div>${toggle}${body}`;
}

function bindHomeworkSon(host) {
  host.querySelectorAll('[data-hwview]').forEach((b) => (b.onclick = () => { App.homeworkView = b.dataset.hwview; renderSon(); }));
  host.querySelectorAll('[data-hwdone]').forEach((b) => (b.onclick = () => {
    App.state = commitHomework(App.state, { id: b.dataset.hwdone }, { now: nowIso(), id: newId() });
    save(); renderSon();
  }));
  host.querySelectorAll('[data-hwundo]').forEach((b) => (b.onclick = () => {
    App.state = uncommitHomework(App.state, { id: b.dataset.hwundo }, { now: nowIso(), id: newId() });
    save(); renderSon();
  }));
}

function renderUkenPage(host) {
  const s = App.state;
  const today = isoDate(new Date());
  const date = App.currentDate;
  const weekDays = weekdaysOf(date);
  const editable = canEditDate(date);
  const locked = isDayLocked(s, date);
  const isSick = !!(s.days[date] && s.days[date].sick);
  const disabled = locked || !editable;
  const { wd, dm } = fmtDayLabel(date);
  const dTot = dailyTotal(s, date);

  // Mandag-prompt: ny uke, forrige uke ikke avsluttet og har innhold.
  const prevWeekDay = stepWeekday(weekStartIso(today), -1);
  const showMonday =
    weekdayKey(today) === 'mon' &&
    !App.mondayDismissed &&
    !isWeekClosed(s, prevWeekDay) &&
    weekHasContent(s, prevWeekDay);

  const strip = weekDays
    .map((d) => {
      const dl = fmtDayLabel(d);
      const dLocked = isDayLocked(s, d);
      const active = d === date;
      const dT = dailyTotal(s, d);
      const badge = dLocked ? `🔒 +${dT}` : dT > 0 ? `~${dT}` : '·';
      const bCls = !dLocked && dT > 0 ? ' prev' : '';
      return `<button class="wd ${active ? 'on' : ''} ${dLocked ? 'locked' : ''}" data-day="${d}">
        <span class="n">${WD_SHORT[weekdayKey(d)]}</span>
        <span class="b${bCls}">${badge}</span></button>`;
    })
    .join('');

  const canSync = App.role === 'parent' && !daySubjectsMatchTimetable(s, date);

  const lockBtn = editable
    ? locked
      ? `<button class="btn ghost" id="lockBtn">🔓 Åpne dagen for redigering</button>`
      : `<button class="btn" id="lockBtn">🔒 Lås dagen</button>`
    : `<div class="card muted" style="text-align:center">🔒 Denne uka er avsluttet – be en forelder om å endre.</div>`;

  const weekClosed = isWeekClosed(s, date);
  const closeWeekBtn =
    editable && !weekClosed
      ? `<button class="link" id="closeWeekBtn" style="display:block;margin:14px auto 0">Lås hele uka</button>`
      : '';

  host.innerHTML = `
    ${showMonday ? `<div class="card monday">
      <b>Ny uke! 🎉</b>
      <div class="muted" style="margin:4px 0 10px">Er du ferdig med forrige uke? Da låser vi den så streaken teller.</div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="mondayYes" style="flex:1">Ja, lås forrige uke</button>
        <button class="btn ghost" id="mondayNo" style="width:auto;padding:14px 16px">Senere</button>
      </div></div>` : ''}

    <div class="weeknav">
      <button class="arrow" id="prevWeek">‹</button>
      <div class="wlabel">Uke fra ${fmtDayLabel(weekStartIso(date)).dm}${weekClosed ? ' · 🔒 avsluttet' : ''}</div>
      <button class="arrow" id="nextWeek">›</button>
    </div>
    <div class="weekstrip">${strip}</div>

    <div class="activeday">
      <div class="ahead"><b>${wd}</b> <span class="muted">${dm}</span>
        ${locked ? '<span class="lockchip">🔒 låst</span>' : ''}</div>
      ${canSync ? `<div class="card" style="margin-bottom:10px;border-color:var(--gold)">
        <div style="font-size:.85rem;margin-bottom:8px">⚠️ Fagene stemmer ikke med timeplanen.</div>
        <button class="btn ghost" id="syncSubjects">Synk fag fra timeplan</button></div>` : ''}
      <div id="lessons">${lessonsHtml(s, date, { disabled, big: true })}</div>
      ${subjectsForDate(s, date).length ? `<div class="daysum">${locked ? `+${dTot} Honniscoins låst inn` : `${dTot} Honniscoins når du låser`}</div>` : ''}
      <div class="sickrow">
        <button class="sicklink" id="sickToggle"${disabled ? ' disabled' : ''}>${isSick ? '🤒 Syk/fri: på – trykk for å fjerne' : 'Var syk/fri denne dagen?'}</button>
      </div>
      <div style="margin-top:14px">${lockBtn}</div>
      ${closeWeekBtn}
      ${homeworkSectionHtml(s, date, App.homeworkView)}
    </div>`;

  // ukesnavigasjon + dagsvalg
  document.getElementById('prevWeek').onclick = () => {
    App.currentDate = stepWeekday(date, -5);
    renderSon();
  };
  document.getElementById('nextWeek').onclick = () => {
    App.currentDate = stepWeekday(date, 5);
    renderSon();
  };
  host.querySelectorAll('.wd[data-day]').forEach(
    (b) =>
      (b.onclick = () => {
        App.currentDate = b.dataset.day;
        renderSon();
      })
  );

  bindLessons(host, date, disabled);
  const sickBtn = document.getElementById('sickToggle');
  if (sickBtn) sickBtn.onclick = () => toggleSick(date, isSick, disabled);
  const lb = document.getElementById('lockBtn');
  if (lb) lb.onclick = () => toggleLock(date, !locked);
  const cw = document.getElementById('closeWeekBtn');
  if (cw)
    cw.onclick = () => {
      App.state = closeWeek(App.state, { weekIso: date, actor: App.role === 'parent' ? 'parent' : 'son' }, { now: nowIso(), id: newId() });
      save();
      renderSon();
    };
  const sy = document.getElementById('syncSubjects');
  if (sy)
    sy.onclick = () => {
      App.state = resyncSubjects(App.state, { date, actor: 'parent' }, { now: nowIso(), id: newId() });
      save();
      renderSon();
    };
  const my = document.getElementById('mondayYes');
  if (my)
    my.onclick = () => {
      App.state = closeWeek(App.state, { weekIso: prevWeekDay, actor: 'son' }, { now: nowIso(), id: newId() });
      App.mondayDismissed = true;
      save();
      renderSon();
    };
  const mn = document.getElementById('mondayNo');
  if (mn)
    mn.onclick = () => {
      App.mondayDismissed = true;
      renderSon();
    };
  bindHomeworkSon(host);
}

// Poeng: saldo + ukesbonus + bronse/sølv/gull-streaks.
function renderPoengPage(host) {
  const s = App.state;
  const today = isoDate(new Date());
  const bal = computeBalance(s);
  const wTot = weeklyTotal(s, today);
  const att = attendanceStreakInfo(s, today);
  const wc = weeklyMedalCounts(s, today);
  const wb = weeklyStreakBonus(s, today);
  const sv = silverStreakInfo(s, today.slice(0, 7), today);
  const gd = goldStreakInfo(s, today.slice(0, 7), today);
  const qPending = questPointsPending(s);
  const hwPending = homeworkPointsPending(s);

  const statGrid = (info) => `
    <div class="grid3">
      <div class="stat"><b>${info.current}</b><span>Nå${info.currentOngoing ? ' ⏳' : ''}</span></div>
      <div class="stat"><b>${info.allTimeBest}</b><span>All-time</span></div>
      <div class="stat"><b>${info.monthBest}</b><span>Denne mnd${info.monthBestOngoing ? ' ⏳' : ''}</span></div>
    </div>`;

  host.innerHTML = `
    <div class="narrowcol">
    <div class="balance">
      <div class="coins">${bal} <small>Honniscoins</small></div>
      <div class="kr">≈ ${formatKr(bal, s.settings.krPerCoin)} · denne uka +${wTot}</div>
      ${qPending ? `<div class="kr">⭐ ${qPending} 🪙 fra sidequests venter på godkjenning</div>` : ''}
      ${hwPending ? `<div class="kr">📚 ${hwPending} 🪙 fra lekser venter på godkjenning</div>` : ''}
    </div>

    <div class="sec">Ukesbonus (denne uka)</div>
    <div class="card">
      <div class="row"><div class="lbl">🥈 Sølvtimer <span class="muted">(sølv + gull)</span></div>
        <div><span class="pill">${wc.silverHours}</span> <b class="bonuspt">+${wb.silver}</b></div></div>
      <div class="row" style="border:none"><div class="lbl">🥇 Gulltimer</div>
        <div><span class="pill">${wc.goldHours}</span> <b class="bonuspt">+${wb.gold}</b></div></div>
      ${wb.total ? `<div class="daysum" style="margin-top:8px">+${wb.total} bonus denne uka</div>` : '<div class="muted" style="text-align:center;font-size:.78rem;margin-top:6px">Mål: 15 sølvtimer = +5 · 10 gulltimer = +10</div>'}
    </div>

    <div class="sec">🔥 Oppmøte-streak (bronse+)</div>
    <div class="card">
      <div class="row" style="border:none"><div class="lbl">På rad nå</div>
        <div><span class="pill">${att.length} ${att.length === 1 ? 'dag' : 'dager'}</span> <b class="bonuspt">+${att.bonusPerDay}/dag</b></div></div>
    </div>

    <div class="sec">🥈 Sølv-streak (timer på rad)</div>
    ${statGrid(sv)}

    <div class="sec">🥇 Gull-streak (timer på rad)</div>
    ${statGrid(gd)}
    </div>
    <div class="sec">📊 Statistikk</div>
    ${statContentHtml(s)}`;
  bindStatChips(host);
}

// Frist-tekst for en quest sett fra sønnen: forfalt (rødt), i dag, om N dager, dato.
function questDueLabel(due, todayIso) {
  if (!due) return '<span class="muted">Ingen frist</span>';
  const [, m, d] = due.split('-');
  const dm = `${Number(d)}.${Number(m)}`;
  if (due < todayIso) return `<span class="qdue over">⏰ Forfalt · ${dm}</span>`;
  if (due === todayIso) return `<span class="qdue soon">⏰ I dag!</span>`;
  const days = Math.round((new Date(due) - new Date(todayIso)) / 86400000);
  const cls = days <= 2 ? 'soon' : '';
  return `<span class="qdue ${cls}">⏰ ${days} ${days === 1 ? 'dag' : 'dager'} igjen · ${dm}</span>`;
}

function renderSidequestsPage(host) {
  const s = App.state;
  const today = isoDate(new Date());
  const quests = activeQuests(s);
  const open = quests.filter((q) => q.status === 'open');
  const done = quests.filter((q) => q.status === 'done');
  const approved = quests.filter((q) => q.status === 'approved');
  const pending = questPointsPending(s);

  if (!quests.length) {
    host.innerHTML = `
      <div class="empty">
        <div style="font-size:2.4rem">⭐</div>
        <b>Ingen sidequests ennå</b>
        <div class="muted">Her dukker ekstraoppdrag opp. Fullfør dem for bonus-coins!</div>
      </div>`;
    return;
  }

  const questCard = (q, kind) => {
    const overdue = isQuestOverdue(q, today);
    const pts = `<span class="qpts">+${q.points} 🪙</span>`;
    const desc = q.desc ? `<div class="qdesc">${escapeHtml(q.desc)}</div>` : '';
    if (kind === 'open') {
      return `<div class="qcard ${overdue ? 'over' : ''}">
        <div class="qtop"><b class="qtitle">${escapeHtml(q.title)}</b>${pts}</div>
        ${desc}
        <div class="qmeta">${questDueLabel(q.due, today)}</div>
        <button class="btn qbtn" data-commit="${q.id}">🔒 Marker som ferdig</button>
      </div>`;
    }
    if (kind === 'done') {
      return `<div class="qcard done">
        <div class="qtop"><b class="qtitle">${escapeHtml(q.title)}</b>${pts}</div>
        ${desc}
        <div class="qmeta"><span class="qdue wait">⏳ Sendt til godkjenning</span></div>
        <button class="btn ghost qbtn" data-uncommit="${q.id}">Angre</button>
      </div>`;
    }
    return `<div class="qcard approved">
      <div class="qtop"><b class="qtitle">${escapeHtml(q.title)}</b>${pts}</div>
      <div class="qmeta"><span class="qdue ok">✅ Godkjent · lagt i potten</span></div>
    </div>`;
  };

  const section = (title, list, kind) =>
    list.length ? `<div class="sec">${title}</div>${list.map((q) => questCard(q, kind)).join('')}` : '';

  host.innerHTML = `
    ${pending ? `<div class="qbanner">⏳ ${pending} 🪙 venter på godkjenning</div>` : ''}
    ${section(`Å gjøre (${open.length})`, open, 'open')}
    ${section('Venter på godkjenning', done, 'done')}
    ${section('Godkjent', approved, 'approved')}`;

  host.querySelectorAll('[data-commit]').forEach(
    (b) =>
      (b.onclick = () => {
        App.state = commitQuest(App.state, { id: b.dataset.commit, actor: 'son' }, { now: nowIso(), id: newId() });
        save();
        renderSon();
      })
  );
  host.querySelectorAll('[data-uncommit]').forEach(
    (b) =>
      (b.onclick = () => {
        App.state = uncommitQuest(App.state, { id: b.dataset.uncommit, actor: 'son' }, { now: nowIso(), id: newId() });
        save();
        renderSon();
      })
  );
}

function renderShopPage(host) {
  const bal = computeBalance(App.state);
  host.innerHTML = `
    <div class="empty">
      <div style="font-size:2.4rem">🛒</div>
      <b>Shop</b>
      <div class="muted">Kommer snart! Her kan du bruke Honniscoinsene dine på premier.</div>
      <div class="pill" style="margin-top:6px">Du har ${bal} 🪙</div>
    </div>`;
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
  const pendingQuests = activeQuests(App.state).filter((q) => q.status === 'done').length;
  const tabs = [
    ['uke', '📅', 'Uke'],
    ['dag', '📝', 'Dag'],
    ['timeplan', '🗓', 'Plan'],
    ['quests', '⭐', 'Quests'],
    ['poeng', '💵', 'Poeng'],
    ['logg', '📋', 'Logg'],
    ['stat', '📊', 'Stat'],
  ];
  const bar = tabs
    .map(([k, ic, l]) => {
      const badge = k === 'quests' && pendingQuests ? `<span class="navbadge">${pendingQuests}</span>` : '';
      return `<button class="t ${App.parentTab === k ? 'on' : ''}" data-tab="${k}">
        <span class="ti">${ic}${badge}</span><span class="tl">${l}</span></button>`;
    })
    .join('');
  el.innerHTML = `
    ${brandHtml()}
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
  if (App.parentTab === 'dag') return renderDayBody(host);
  if (App.parentTab === 'timeplan') return renderTimeplanTab(host);
  if (App.parentTab === 'quests') return renderQuestsTab(host);
  if (App.parentTab === 'poeng') return renderPoengTab(host);
  if (App.parentTab === 'logg') return renderLoggTab(host);
  if (App.parentTab === 'stat') return renderStatistikkTab(host);
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
      const dLocked = isDayLocked(s, d);
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
        <div style="text-align:left"><div class="lbl">${wd}${isToday ? ' · i dag' : ''} ${dLocked ? '🔒' : ''}</div>
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

// Forelder: HTML for lekse-administrasjon på valgt dag.
function parentHomeworkHtml(s, date) {
  const all = activeHomework(s).filter((h) => h.date === date);
  const pending = activeHomework(s).filter((h) => h.status === 'done' && !h.hidden);

  const pendingHtml = pending.length
    ? `<div class="hwsec">⏳ Lekser til godkjenning <span class="badge">${pending.length}</span></div>` +
      pending.map((h) => `<div class="hwcard done">
        <div class="hwtop"><span class="hwsubj">${escapeHtml(h.subject)}</span><span class="hwpts">+${h.points} 🪙</span></div>
        ${h.text ? `<div class="hwtext">${escapeHtml(h.text)}</div>` : ''}
        <div style="display:flex;gap:8px">
          <button class="btn good" data-hwapprove="${h.id}" style="flex:1">✓ Godkjenn</button>
          <button class="btn ghost" data-hwreject="${h.id}" style="flex:1">↩︎ Send tilbake</button>
        </div></div>`).join('')
    : '';

  // Rediger-skjema rendres INLINE der leksa står (ingen scroll til toppen).
  const editFormFor = (editing) => `<div class="hwcard" id="hwEditForm" style="border-color:var(--accent)">
         <div class="hwsubjhead" style="margin:0 0 8px">✏️ Rediger lekse ${editing.edited ? '<span class="hwedited">endret – beskyttet</span>' : ''}</div>
         <input class="inp" id="hwSubject" value="${escapeHtml(editing.subject)}" placeholder="Fag">
         <textarea class="inp" id="hwText" placeholder="Beskrivelse">${escapeHtml(editing.text)}</textarea>
         <label class="muted" style="display:block;margin:2px 0 8px">Poeng <input class="inp" id="hwPoints" type="number" value="${editing.points}" style="width:80px;display:inline-block"></label>
         <label class="muted" style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><input type="checkbox" id="hwWeek" ${editing.wholeWeek ? 'checked' : ''}> 🗓 Gjelder hele uka</label>
         <div style="display:flex;gap:8px">
           <button class="btn" id="hwSave" style="flex:1">💾 Lagre</button>
           <button class="btn ghost" id="hwCancel" style="flex:1">Avbryt</button>
         </div>
       </div>`;

  const addForm = `<div class="hwsec">➕ Legg til lekse</div>
       <div class="hwcard">
         <input class="inp" id="hwNewSubject" placeholder="Fag (f.eks. Tysk)">
         <textarea class="inp" id="hwNewText" placeholder="Hva skal gjøres?"></textarea>
         <label class="muted" style="display:block;margin:2px 0 8px">Poeng <input class="inp" id="hwNewPoints" type="number" value="${s.settings.homeworkPoints ?? 5}" style="width:80px;display:inline-block"></label>
         <label class="muted" style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><input type="checkbox" id="hwNewWeek"> 🗓 Gjelder hele uka</label>
         <button class="btn" id="hwAdd">➕ Legg til på ${fmtDayLabel(date).dm}</button>
       </div>`;

  const listHtml = all.length
    ? `<div class="hwsec">📚 Lekser · ${fmtDayLabel(date).dm}</div>` +
      all.map((h) => h.id === App.editHwId
        ? editFormFor(h)
        : `<div class="hwcard${h.hidden ? ' approved' : ''}">
        <div class="hwtop"><span class="hwsubj">${escapeHtml(h.subject)}${h.wholeWeek ? '<span class="weektag">🗓 hele uka</span>' : ''}${h.hidden ? '<span class="hwdaytag">skjult</span>' : ''}</span><span class="hwpts">+${h.points} 🪙</span></div>
        ${h.text ? `<div class="hwtext">${escapeHtml(h.text)}</div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn ghost" data-hwedit="${h.id}">✏️ Rediger</button>
          <button class="btn ghost" data-hwhide="${h.id}" data-hidden="${h.hidden ? '1' : '0'}">${h.hidden ? '👁 Vis' : '🙈 Skjul'}</button>
          <button class="btn ghost" data-hwdel="${h.id}">🗑 Slett</button>
        </div></div>`).join('')
    : `<div class="muted" style="margin:2px">Ingen lekser på denne dagen ennå.</div>`;

  return `<div class="hwsec" style="margin-top:20px">📚 LEKSER</div>${pendingHtml}${addForm}${listHtml}`;
}

// Bind forelder-lekse-hendelser (kalles etter innsetting i DOM).
function bindParentHomework(host, date) {
  const add = host.querySelector('#hwAdd');
  if (add) add.onclick = () => {
    const subject = host.querySelector('#hwNewSubject').value.trim();
    const text = host.querySelector('#hwNewText').value.trim();
    const points = host.querySelector('#hwNewPoints').value;
    const wholeWeek = host.querySelector('#hwNewWeek').checked;
    if (!subject && !text) return;
    App.state = addHomework(App.state, { date, subject, text, points, wholeWeek }, { now: nowIso(), id: newId() });
    save(); routeToView();
  };
  const save1 = host.querySelector('#hwSave');
  if (save1) save1.onclick = () => {
    const patch = {
      subject: host.querySelector('#hwSubject').value.trim(),
      text: host.querySelector('#hwText').value.trim(),
      points: host.querySelector('#hwPoints').value,
      wholeWeek: host.querySelector('#hwWeek').checked,
    };
    App.state = updateHomework(App.state, { id: App.editHwId, patch }, { now: nowIso(), id: newId() });
    App.editHwId = null;
    save(); routeToView();
  };
  const cancel = host.querySelector('#hwCancel');
  if (cancel) cancel.onclick = () => { App.editHwId = null; routeToView(); };
  host.querySelectorAll('[data-hwedit]').forEach((b) => (b.onclick = () => {
    App.editHwId = b.dataset.hwedit;
    routeToView();
    const f = document.getElementById('hwEditForm');
    if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  host.querySelectorAll('[data-hwdel]').forEach((b) => (b.onclick = () => {
    App.state = deleteHomework(App.state, { id: b.dataset.hwdel }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
  host.querySelectorAll('[data-hwhide]').forEach((b) => (b.onclick = () => {
    App.state = hideHomework(App.state, { id: b.dataset.hwhide, hidden: b.dataset.hidden !== '1' }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
  host.querySelectorAll('[data-hwapprove]').forEach((b) => (b.onclick = () => {
    App.state = approveHomework(App.state, { id: b.dataset.hwapprove }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
  host.querySelectorAll('[data-hwreject]').forEach((b) => (b.onclick = () => {
    App.state = rejectHomework(App.state, { id: b.dataset.hwreject }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
}

// Foreldrenes «Dag»-fane: samme fag-liste, men med lås/åpne + åpne-uke-kontroll.
function renderDayBody(host) {
  const s = App.state,
    date = App.currentDate;
  const today = isoDate(new Date());
  const locked = isDayLocked(s, date);
  const subjects = subjectsForDate(s, date);
  const isSick = !!(s.days[date] && s.days[date].sick);
  const disabled = locked; // forelder låser opp for å redigere
  const bal = computeBalance(s);
  const streak = attendanceStreakInfo(s, today);
  const wTot = weeklyTotal(s, date);
  const dTot = dailyTotal(s, date);
  const cls = classifyDay(s, date);
  const { wd, dm } = fmtDayLabel(date);
  const weekClosed = isWeekClosed(s, date);

  const canSync = !daySubjectsMatchTimetable(s, date);
  const dayStatus = isSick
    ? '🤒 Merket syk/fri'
    : cls === 'present'
    ? `✅ Hel dag til stede · +${streak.bonusPerDay}`
    : cls === 'broken'
    ? '⚠️ Fravær uten syk-merking'
    : subjects.length
    ? '⏳ Ikke ferdig vurdert'
    : '';

  host.innerHTML = `
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
    <div class="row" style="border:none;padding:2px 4px 8px">
      <div class="lbl muted" style="font-size:.82rem">${dayStatus}</div>
      <div style="display:flex;gap:6px">
        <button class="pill" id="sickToggle"${disabled ? ' disabled' : ''} style="${
          isSick ? 'color:var(--gold);border-color:var(--gold)' : ''
        }">${isSick ? '🤒 Syk/fri: på' : '🤒 Syk/fri'}</button>
        <button class="pill" id="lockBtn" style="${locked ? 'color:var(--good);border-color:var(--good)' : ''}">${locked ? '🔒 Låst' : '🔓 Ulåst'}</button>
      </div>
    </div>
    ${canSync ? `<div class="card" style="margin-bottom:10px;border-color:var(--gold)">
      <div style="font-size:.85rem;margin-bottom:8px">⚠️ Fagene her stemmer ikke med timeplanen.</div>
      <button class="btn ghost" id="syncSubjects">Synk fag fra timeplan</button></div>` : ''}
    <div id="lessons">${lessonsHtml(s, date, { disabled, big: false })}</div>
    ${subjects.length ? `<div class="daysum">${locked ? `+${dTot} Honniscoins låst` : `${dTot} Honniscoins (ikke låst)`}</div>` : ''}
    <div class="row" style="border:none;margin-top:10px">
      <div class="lbl muted" style="font-size:.8rem">${weekClosed ? '🔒 Uka er avsluttet' : 'Uka er åpen'}</div>
      <button class="link" id="weekToggle">${weekClosed ? 'Åpne uka igjen' : 'Lås hele uka'}</button>
    </div>
    ${parentHomeworkHtml(s, date)}`;

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
  const syncBtn = document.getElementById('syncSubjects');
  if (syncBtn)
    syncBtn.onclick = () => {
      App.state = resyncSubjects(App.state, { date, actor: 'parent' }, { now: nowIso(), id: newId() });
      save();
      routeToView();
    };
  document.getElementById('sickToggle').onclick = () => toggleSick(date, isSick, disabled);
  document.getElementById('lockBtn').onclick = () => toggleLock(date, !locked);
  document.getElementById('weekToggle').onclick = () => {
    App.state = weekClosed
      ? reopenWeek(App.state, { weekIso: date, actor: 'parent' }, { now: nowIso(), id: newId() })
      : closeWeek(App.state, { weekIso: date, actor: 'parent' }, { now: nowIso(), id: newId() });
    save();
    routeToView();
  };
  bindLessons(host, date, disabled);
  bindParentHomework(host, date);
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

// Forelder: godkjenningskø + opprett/rediger + aktive quests.
function renderQuestsTab(host) {
  const s = App.state;
  const today = isoDate(new Date());
  const quests = activeQuests(s);
  const done = quests.filter((q) => q.status === 'done');
  const open = quests.filter((q) => q.status === 'open');
  const approved = quests.filter((q) => q.status === 'approved');
  const editing = App.editQuestId ? quests.find((q) => q.id === App.editQuestId) : null;

  const dueTxt = (due) => {
    if (!due) return 'ingen frist';
    const [, m, d] = due.split('-');
    return `${Number(d)}.${Number(m)}`;
  };

  // Arbeids-frist for skjemaet (closure): ny quest = i dag, redigering = questens frist.
  let due = editing ? editing.due || null : today;

  const queueRows = done
    .map(
      (q) => `<div class="qcard done">
        <div class="qtop"><b class="qtitle">${escapeHtml(q.title)}</b><span class="qpts">+${q.points} 🪙</span></div>
        ${q.desc ? `<div class="qdesc">${escapeHtml(q.desc)}</div>` : ''}
        <div class="qmeta muted" style="font-size:.74rem">Frist: ${dueTxt(q.due)}</div>
        <div class="qrow">
          <button class="btn qbtn" data-approve="${q.id}">✅ Godkjenn</button>
          <button class="btn ghost qbtn" data-reject="${q.id}">↩︎ Send tilbake</button>
        </div>
      </div>`
    )
    .join('');

  const activeRows = [...open, ...approved]
    .map((q) => {
      const overdue = isQuestOverdue(q, today);
      const status =
        q.status === 'approved'
          ? '<span class="qdue ok">✅ Godkjent</span>'
          : overdue
          ? '<span class="qdue over">⏰ Forfalt</span>'
          : `<span class="muted" style="font-size:.74rem">Frist: ${dueTxt(q.due)}</span>`;
      return `<div class="qcard ${q.status === 'approved' ? 'approved' : ''}">
        <div class="qtop"><b class="qtitle">${escapeHtml(q.title)}</b><span class="qpts">+${q.points} 🪙</span></div>
        ${q.desc ? `<div class="qdesc">${escapeHtml(q.desc)}</div>` : ''}
        <div class="qmeta">${status}</div>
        <div class="qrow">
          <button class="btn ghost qbtn" data-edit="${q.id}">✏️ Rediger</button>
          <button class="btn ghost qbtn danger" data-del="${q.id}">🗑️ Slett</button>
        </div>
      </div>`;
    })
    .join('');

  host.innerHTML = `
    ${done.length ? `<div class="sec">Til godkjenning (${done.length})</div>${queueRows}` : ''}

    <div class="sec">${editing ? 'Rediger quest' : 'Ny quest'}</div>
    <div class="card" style="padding:12px">
      <input class="inp wide" id="qTitle" placeholder="Tittel (f.eks. Rydde garasjen)" style="width:100%;margin-bottom:8px" value="${editing ? escapeHtml(editing.title) : ''}">
      <textarea class="inp wide" id="qDesc" placeholder="Beskrivelse (valgfri)" rows="2" style="width:100%;margin-bottom:8px;resize:vertical">${editing ? escapeHtml(editing.desc || '') : ''}</textarea>
      <label class="lbl" style="margin-bottom:8px;display:block">Poeng
        <input class="inp" id="qPoints" type="number" min="0" value="${editing ? editing.points : ''}" placeholder="0" style="width:100%"></label>
      <div class="lbl" style="margin-bottom:6px">Frist</div>
      <div class="datestep" style="margin-bottom:6px">
        <button class="arrow" type="button" id="qDuePrev">‹</button>
        <div class="datemid">
          <b id="qDueWd"></b><span id="qDueDm" class="d"></span>
          <input type="date" id="qDue" class="dateover">
        </div>
        <button class="arrow" type="button" id="qDueNext">›</button>
      </div>
      <button class="link" id="qDueClear" type="button" style="margin-bottom:12px"></button>
      <div class="qrow">
        <button class="btn qbtn" id="qSave">${editing ? '💾 Lagre endringer' : '➕ Legg til quest'}</button>
        ${editing ? '<button class="btn ghost qbtn" id="qCancel">Avbryt</button>' : ''}
      </div>
    </div>

    ${open.length + approved.length ? `<div class="sec">Aktive quests</div>${activeRows}` : ''}`;

  host.querySelectorAll('[data-approve]').forEach(
    (b) =>
      (b.onclick = () => {
        App.state = approveQuest(App.state, { id: b.dataset.approve, actor: 'parent' }, { now: nowIso(), id: newId() });
        save();
        routeToView();
      })
  );
  host.querySelectorAll('[data-reject]').forEach(
    (b) =>
      (b.onclick = () => {
        App.state = rejectQuest(App.state, { id: b.dataset.reject, actor: 'parent' }, { now: nowIso(), id: newId() });
        save();
        routeToView();
      })
  );
  host.querySelectorAll('[data-edit]').forEach(
    (b) =>
      (b.onclick = () => {
        App.editQuestId = b.dataset.edit;
        routeToView();
      })
  );
  host.querySelectorAll('[data-del]').forEach(
    (b) =>
      (b.onclick = () => {
        App.state = deleteQuest(App.state, { id: b.dataset.del, actor: 'parent' }, { now: nowIso(), id: newId() });
        if (App.editQuestId === b.dataset.del) App.editQuestId = null;
        save();
        routeToView();
      })
  );
  // Frist-velger: dagens dato som standard, pil ±1 dag, eller trykk for kalender.
  const WD_FULL7 = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
  const localDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const stepDay = (iso, delta) => {
    const d = localDate(iso);
    d.setDate(d.getDate() + delta);
    return isoDate(d);
  };
  const refreshDue = () => {
    const wdEl = document.getElementById('qDueWd');
    const dmEl = document.getElementById('qDueDm');
    const clr = document.getElementById('qDueClear');
    if (due) {
      const d = localDate(due);
      const [, m, dd] = due.split('-');
      wdEl.textContent = WD_FULL7[d.getDay()];
      dmEl.textContent = ` · ${Number(dd)}.${Number(m)}.${d.getFullYear()}`;
      clr.textContent = 'Fjern frist';
    } else {
      wdEl.textContent = 'Ingen frist';
      dmEl.textContent = ' · trykk for å velge';
      clr.textContent = 'Sett frist (i dag)';
    }
    document.getElementById('qDue').value = due || '';
  };
  refreshDue();
  document.getElementById('qDuePrev').onclick = () => {
    due = stepDay(due || today, -1);
    refreshDue();
  };
  document.getElementById('qDueNext').onclick = () => {
    due = stepDay(due || today, 1);
    refreshDue();
  };
  document.getElementById('qDue').onchange = (e) => {
    due = e.target.value || null;
    refreshDue();
  };
  document.getElementById('qDueClear').onclick = () => {
    due = due ? null : today;
    refreshDue();
  };

  document.getElementById('qSave').onclick = () => {
    const title = document.getElementById('qTitle').value.trim();
    if (!title) return;
    const desc = document.getElementById('qDesc').value.trim();
    const points = Number(document.getElementById('qPoints').value) || 0;
    const ctx = { now: nowIso(), id: newId() };
    if (App.editQuestId) {
      App.state = updateQuest(App.state, { id: App.editQuestId, patch: { title, desc, points, due }, actor: 'parent' }, ctx);
      App.editQuestId = null;
    } else {
      App.state = addQuest(App.state, { title, desc, points, due, actor: 'parent' }, ctx);
    }
    save();
    routeToView();
  };
  const cancel = document.getElementById('qCancel');
  if (cancel)
    cancel.onclick = () => {
      App.editQuestId = null;
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
      } else if (e.type === 'lock') {
        const dl = fmtDayLabel(e.day);
        txt = `${e.to ? '🔒 Låste' : '🔓 Åpnet'} dagen (${dl.wd.slice(0, 3).toLowerCase()} ${dl.dm})`;
      } else if (e.type === 'weekclose') {
        txt = `🔒 Avsluttet uka (fra ${fmtDayLabel(e.week).dm})`;
      } else if (e.type === 'weekopen') {
        txt = `🔓 Åpnet uka igjen (fra ${fmtDayLabel(e.week).dm})`;
      } else if (e.type === 'quest') {
        const t = e.title ? `«${escapeHtml(e.title)}»` : 'quest';
        const map = {
          create: `⭐ Opprettet ${t}`,
          edit: `✏️ Redigerte ${t}`,
          delete: `🗑️ Slettet ${t}`,
          done: `🔒 Meldte ferdig ${t}`,
          undo: `↩︎ Angret ferdigmelding ${t}`,
          approve: `✅ Godkjente ${t}${e.points ? ` · <b>+${e.points}</b>` : ''}`,
          reject: `↩︎ Sendte tilbake ${t}${e.note ? ' · «' + escapeHtml(e.note) + '»' : ''}`,
        };
        txt = map[e.action] || `Quest ${t}`;
      } else if (e.type === 'homework') {
        const t = e.subject ? `«${escapeHtml(e.subject)}»` : 'lekse';
        const map = {
          create: `📚 La til lekse ${t}`,
          edit: `✏️ Redigerte lekse ${t}`,
          delete: `🗑️ Slettet lekse ${t}`,
          hide: `🙈 Skjulte lekse ${t}`,
          show: `👁 Viste lekse ${t}`,
          done: `🔒 Meldte ferdig ${t}`,
          undo: `↩︎ Angret ferdigmelding ${t}`,
          approve: `✅ Godkjente lekse ${t}${e.points ? ` · <b>+${e.points}</b>` : ''}`,
          reject: `↩︎ Sendte tilbake lekse ${t}${e.note ? ' · «' + escapeHtml(e.note) + '»' : ''}`,
          'import-add': `📥 Importerte lekse ${t}`,
        };
        txt = map[e.action] || `Lekse ${t}`;
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

// --- Statistikk (forelder, kun visning) ----------------------------------

// Returnerer periode-chips + statgrid (eller tomtilstand) som HTML-streng.
function statContentHtml(state) {
  const today = isoDate(new Date());
  const bounds = periodBounds(App.statPeriod, today);
  const recs = filterRecordsByPeriod(effortRecords(state), bounds);

  const periods = [['month', 'Denne måneden'], ['d90', 'Siste 90 dager'], ['all', 'Alt']];
  const chips = periods
    .map(([k, l]) => `<button class="statchip ${App.statPeriod === k ? 'on' : ''}" data-p="${k}">${l}</button>`)
    .join('');

  if (!recs.length) {
    return `
      <div class="statperiod">${chips}</div>
      <div class="card statempty">📊 Ingen data ennå for valgt periode.<br>
        <span class="muted">Lås noen dager med medaljer først – kun låste dager teller.</span></div>`;
  }

  const bySub = statBySubject(recs);
  const byPos = statByPosition(recs);
  const heat = statHeatmap(recs);
  const trend = statTrend(recs);
  const dist = statMedalDistribution(recs);

  return `
    <div class="statperiod">${chips}</div>
    <div class="statgrid">
      ${statCard('Innsats per fag', 'Snitt-medalje per fag (🥇3 🥈2 🥉1)', svgBySubject(bySub))}
      ${statCard('Innsats etter når på dagen', 'Snitt per timenummer', svgByPosition(byPos))}
      ${statCard('Ukedag × time', 'Snitt per ukedag og timenummer', svgHeatmap(heat), true)}
      ${statCard('Utvikling over tid', 'Månedlig snitt: totalt + mest brukte fag', svgTrend(trend), true)}
      ${statCard('Medaljefordeling per fag', 'Andel gull/sølv/bronse', svgDistribution(dist))}
    </div>`;
}

function renderStatistikkTab(host) {
  host.innerHTML = statContentHtml(App.state);
  bindStatChips(host);
}

function statCard(title, sub, svg, wide) {
  return `<div class="card statc ${wide ? 'span2' : ''}">
    <div class="stath">${title}</div><div class="muted stats">${sub}</div>${svg}</div>`;
}

function bindStatChips(host) {
  host.querySelectorAll('.statchip[data-p]').forEach(
    (b) => (b.onclick = () => { App.statPeriod = b.dataset.p; routeToView(); })
  );
}

// Felles: fargeterskel for innsats-snitt.
function effortColor(avg) {
  return avg >= 2.2 ? 'var(--good)' : avg < 1.6 ? 'var(--bad)' : 'var(--s1)';
}
function hourLabel(pos) { return (pos + 1) + '. time'; }

// Visning 1: rangerte horisontale stolper.
function svgBySubject(bySub) {
  const W = 800, H = Math.max(160, 40 + bySub.subjects.length * 34), L = 96, R = 54, T = 8, B = 22;
  const iw = W - L - R, ih = H - T - B, rowH = ih / bySub.subjects.length, bh = Math.min(24, rowH * 0.6);
  let g = '';
  for (let v = 0; v <= 3; v++) {
    const x = L + iw * (v / 3);
    g += `<line x1="${x}" y1="${T}" x2="${x}" y2="${T + ih}" stroke="var(--grid)"/>`;
    g += `<text x="${x}" y="${T + ih + 15}" text-anchor="middle" class="axl">${v}</text>`;
  }
  bySub.subjects.forEach((d, i) => {
    const cy = T + rowH * i + rowH / 2, w = iw * (d.avg / 3);
    g += `<text x="${L - 8}" y="${cy + 4}" text-anchor="end" class="axv">${escapeHtml(d.subjectLabel)}</text>`;
    g += `<rect x="${L}" y="${cy - bh / 2}" width="${Math.max(w, 2)}" height="${bh}" rx="5" fill="${effortColor(d.avg)}"/>`;
    g += `<text x="${L + w + 8}" y="${cy + 4}" class="axv">${d.avg.toFixed(1)}</text>`;
    g += `<text x="${W - 6}" y="${cy + 4}" text-anchor="end" class="axn">n=${d.n}</text>`;
  });
  const sx = L + iw * (bySub.overallAvg / 3);
  g += `<line x1="${sx}" y1="${T}" x2="${sx}" y2="${T + ih}" stroke="var(--ink2)" stroke-dasharray="4 4"/>`;
  return svgWrap(W, H, g);
}

// Visning 2: stolper per timenummer.
function svgByPosition(byPos) {
  const W = 800, H = 260, L = 40, R = 14, T = 12, B = 42, iw = W - L - R, ih = H - T - B;
  let g = '';
  for (let v = 0; v <= 3; v++) {
    const y = T + ih - ih * (v / 3);
    g += `<line x1="${L}" y1="${y}" x2="${L + iw}" y2="${y}" stroke="var(--grid)"/>`;
    g += `<text x="${L - 6}" y="${y + 4}" text-anchor="end" class="axl">${v}</text>`;
  }
  const bw = (iw / Math.max(1, byPos.length)) * 0.5;
  byPos.forEach((d, i) => {
    const cx = L + iw * ((i + 0.5) / byPos.length), bh = ih * (d.avg / 3);
    g += `<rect x="${cx - bw / 2}" y="${T + ih - bh}" width="${bw}" height="${bh}" rx="5" fill="${effortColor(d.avg)}"/>`;
    g += `<text x="${cx}" y="${T + ih - bh - 6}" text-anchor="middle" class="axv">${d.avg.toFixed(1)}</text>`;
    g += `<text x="${cx}" y="${T + ih + 15}" text-anchor="middle" class="axl">${hourLabel(d.position)}</text>`;
    g += `<text x="${cx}" y="${T + ih + 29}" text-anchor="middle" class="axn">n=${d.n}</text>`;
  });
  return svgWrap(W, H, g);
}

// Visning 3: heatmap ukedag x timenummer.
function svgHeatmap(heat) {
  const names = { mon: 'Man', tue: 'Tir', wed: 'Ons', thu: 'Tor', fri: 'Fre' };
  const cols = heat.positions.length || 1;
  const W = 800, H = 60 + heat.weekdays.length * 42, L = 46, R = 14, T = 26, B = 16;
  const iw = W - L - R, ih = H - T - B, cw = iw / cols, ch = ih / heat.weekdays.length, gap = 3;
  const ramp = ['--seq1', '--seq2', '--seq3', '--seq4', '--seq5'];
  const colorOf = (avg) => `var(${ramp[Math.min(4, Math.floor((avg / 3) * 5))]})`;
  let g = '';
  heat.positions.forEach((p, j) =>
    (g += `<text x="${L + cw * (j + 0.5)}" y="${T - 9}" text-anchor="middle" class="axl">${hourLabel(p)}</text>`));
  heat.weekdays.forEach((wd, i) => {
    g += `<text x="${L - 6}" y="${T + ch * (i + 0.5) + 4}" text-anchor="end" class="axl">${names[wd]}</text>`;
    heat.positions.forEach((p, j) => {
      const c = heat.cell[wd][p];
      const x = L + cw * j + gap / 2, y = T + ch * i + gap / 2;
      if (!c) {
        g += `<rect x="${x}" y="${y}" width="${cw - gap}" height="${ch - gap}" rx="5" fill="var(--null)" stroke="var(--grid)"/>`;
      } else {
        g += `<rect x="${x}" y="${y}" width="${cw - gap}" height="${ch - gap}" rx="5" fill="${colorOf(c.avg)}"/>`;
        g += `<text x="${L + cw * (j + 0.5)}" y="${T + ch * (i + 0.5) + 4}" text-anchor="middle" fill="${c.avg / 3 > 0.6 ? '#fff' : 'var(--ink)'}" class="axc">${c.avg.toFixed(1)}</text>`;
      }
    });
  });
  return svgWrap(W, H, g);
}

// Visning 4: linjediagram, månedlig snitt.
function svgTrend(trend) {
  const cols = ['var(--ink2)', 'var(--s1)', 'var(--s2)'];
  const W = 800, H = 260, L = 40, R = 70, T = 12, B = 30, iw = W - L - R, ih = H - T - B;
  const n = Math.max(1, trend.months.length - 1);
  const X = (i) => L + iw * (i / n), Y = (v) => T + ih - ih * (v / 3);
  let g = '';
  for (let v = 0; v <= 3; v++) {
    const y = Y(v);
    g += `<line x1="${L}" y1="${y}" x2="${L + iw}" y2="${y}" stroke="var(--grid)"/>`;
    g += `<text x="${L - 6}" y="${y + 4}" text-anchor="end" class="axl">${v}</text>`;
  }
  trend.months.forEach((m, i) =>
    (g += `<text x="${X(i)}" y="${T + ih + 18}" text-anchor="middle" class="axl">${m.slice(5)}</text>`));
  trend.series.forEach((s, si) => {
    const col = cols[si % cols.length];
    let prev = null, lastPt = null;
    s.values.forEach((v, i) => {
      if (v == null) { prev = null; return; }
      const pt = [X(i), Y(v)];
      if (prev) g += `<line x1="${prev[0]}" y1="${prev[1]}" x2="${pt[0]}" y2="${pt[1]}" stroke="${col}" stroke-width="${si === 0 ? 2.5 : 2}" stroke-linecap="round"/>`;
      g += `<circle cx="${pt[0]}" cy="${pt[1]}" r="3" fill="${col}"/>`;
      prev = pt; lastPt = pt;
    });
    if (lastPt) g += `<text x="${lastPt[0] + 7}" y="${lastPt[1] + 4}" fill="${col}" class="axs">${escapeHtml(s.label)}</text>`;
  });
  return svgWrap(W, H, g);
}

// Visning 5: 100 % stablet gull/sølv/bronse.
function svgDistribution(dist) {
  const W = 800, H = Math.max(160, 30 + dist.length * 36), L = 96, R = 14, T = 8, B = 20;
  const iw = W - L - R, ih = H - T - B, rowH = ih / dist.length, bh = Math.min(26, rowH * 0.6);
  const parts = [['gull', 'var(--gull)'], ['solv', 'var(--solv)'], ['bronse', 'var(--bronse)']];
  let g = '';
  dist.forEach((d, i) => {
    const cy = T + rowH * i + rowH / 2;
    g += `<text x="${L - 8}" y="${cy + 4}" text-anchor="end" class="axv">${escapeHtml(d.subjectLabel)}</text>`;
    let x = L;
    parts.forEach(([k, col]) => {
      const w = iw * d[k];
      g += `<rect x="${x}" y="${cy - bh / 2}" width="${Math.max(w - 2, 0)}" height="${bh}" fill="${col}"/>`;
      if (d[k] >= 0.12) g += `<text x="${x + w / 2}" y="${cy + 4}" text-anchor="middle" fill="#fff" class="axc">${Math.round(d[k] * 100)}%</text>`;
      x += w;
    });
  });
  return svgWrap(W, H, g);
}

function svgWrap(w, h, inner) {
  return `<svg class="statsvg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;
}

function routeToView() {
  // Statistikk bryter ut av mobil-bredden – ses på laptop (forelder-fane + sønn-Poeng).
  const wide = (App.role === 'parent' && App.parentUnlocked && App.parentTab === 'stat')
    || (App.role === 'son' && App.sonPage === 'poeng');
  document.body.classList.toggle('statwide', wide);
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
