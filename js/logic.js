// Ren logikk for Honniscoins. Ingen DOM, ingen nettverk, ingen globaler.
// Alt her er rene funksjoner (bortsett fra der en ctx={now,id} injiseres for testbarhet),
// og dette er den eneste fila med enhetstester.

export const APP_LOGIC_VERSION = 1;

export const MEDALS = { NONE: null, ZERO: '0', BRONSE: 'bronse', SOLV: 'solv', GULL: 'gull' };
export const DEFAULT_MEDAL_VALUES = { bronse: 1, solv: 2, gull: 3 };
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

// --- Poeng ---------------------------------------------------------------

export function medalPoints(medal, medalValues = DEFAULT_MEDAL_VALUES) {
  if (medal === 'bronse') return medalValues.bronse || 0;
  if (medal === 'solv') return medalValues.solv || 0;
  if (medal === 'gull') return medalValues.gull || 0;
  return 0; // null (ikke vurdert) og '0' (fravær) gir 0
}

export const DEFAULT_BONUS = {
  attendanceLadder: [{ from: 1, pts: 1 }, { from: 11, pts: 2 }], // bronse/oppmøte-trapp (utvidbar)
  silverTiers: [{ min: 15, pts: 5 }, { min: 30, pts: 10 }], // ukesbonus sølvtimer (sølv+gull)
  goldTiers: [{ min: 10, pts: 10 }, { min: 20, pts: 20 }, { min: 30, pts: 30 }], // ukesbonus gulltimer
};

export function defaultState() {
  return {
    settings: {
      pin: null,
      medalValues: { ...DEFAULT_MEDAL_VALUES },
      krPerCoin: 1,
      timetable: { mon: [], tue: [], wed: [], thu: [], fri: [] },
      bonus: JSON.parse(JSON.stringify(DEFAULT_BONUS)),
      homeworkPoints: 5,
      docendoIcalId: '519a0908-ed7d-47ed-8667-dea07343b693',
      schemaVersion: 2,
      updatedAt: null,
    },
    days: {},
    weekLocks: {},
    payouts: [],
    quests: [],
    homework: [],
    log: [],
  };
}

// Kun LÅSTE dager teller (lås = commit).
export function computeEarned(state) {
  const v = state.settings.medalValues;
  let sum = 0;
  for (const date of Object.keys(state.days || {})) {
    if (!state.days[date].locked) continue;
    const marks = state.days[date].marks || {};
    for (const idx of Object.keys(marks)) sum += medalPoints(marks[idx].medal, v);
  }
  return sum;
}

export function computeSpent(state) {
  return (state.payouts || []).reduce((a, p) => a + (p.coins || 0), 0);
}

// Saldo = medaljepoeng + oppmøte-bonus + ukesbonus + godkjente quests − utbetalinger.
export function computeBalance(state) {
  return (
    computeEarned(state) +
    streakBonusTotal(state) +
    weeklyStreakBonusTotal(state) +
    questPointsTotal(state) +
    homeworkPointsTotal(state) -
    computeSpent(state)
  );
}

// --- Dato / ukedag -------------------------------------------------------

// Lokale datoer på formen 'YYYY-MM-DD'.
export function isoDate(d) {
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, '0'),
    day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 0=søn..6=lør -> nøkkel eller null i helg
export function weekdayKey(iso) {
  const dow = parseIso(iso).getDay();
  return ({ 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' })[dow] || null;
}

export function stepWeekday(iso, dir) {
  const d = parseIso(iso);
  do {
    d.setDate(d.getDate() + (dir >= 0 ? 1 : -1));
  } while (weekdayKey(isoDate(d)) === null);
  return isoDate(d);
}

export function nearestWeekday(iso) {
  const d = parseIso(iso);
  while (weekdayKey(isoDate(d)) === null) d.setDate(d.getDate() + 1);
  return isoDate(d);
}

// --- Frosne fag + mutasjoner (rene: returnerer NY state) -----------------

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function subjectsForDate(state, iso) {
  const day = (state.days || {})[iso];
  if (day && Array.isArray(day.subjects)) return day.subjects;
  const wk = weekdayKey(iso);
  if (!wk) return [];
  return (state.settings.timetable[wk] || []).slice();
}

// ctx = { now: ISO-streng, id: unik id } — injiseres for testbarhet.
export function setMark(state, { date, idx, medal, actor }, ctx) {
  const s = clone(state);
  if (!s.days[date]) s.days[date] = { subjects: subjectsForDate(state, date), marks: {} };
  const key = String(idx);
  const prev = s.days[date].marks[key] ? s.days[date].marks[key].medal : null;
  s.days[date].marks[key] = { medal, by: actor, updatedAt: ctx.now };
  const subject = s.days[date].subjects[idx] ?? null;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'grade', day: date, subject, from: prev, to: medal });
  return s;
}

export function addPayout(state, { coins, kr = null, note = '', by = 'parent' }, ctx) {
  const s = clone(state);
  s.payouts.push({ id: ctx.id, coins, kr, note, at: ctx.now, by });
  s.log.push({ id: ctx.id, at: ctx.now, actor: by, type: 'payout', coins, note });
  return s;
}

export function logSettingsChange(state, { actor, field, from, to }, ctx) {
  const s = clone(state);
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'settings', field, from, to });
  return s;
}

export function formatKr(coins, krPerCoin) {
  const v = coins * krPerCoin;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
  return `${s} kr`;
}

// --- Streaks: oppmøte-streak, ukelås, totaler ----------------------------

// Mandag-startet uke. Returnerer ISO-dato for mandagen i uka som `iso` ligger i.
export function weekStartIso(iso) {
  const d = parseIso(iso);
  const dow = d.getDay(); // 0=søn..6=lør
  const diff = dow === 0 ? -6 : 1 - dow; // flytt til mandag
  d.setDate(d.getDate() + diff);
  return isoDate(d);
}

// En uke er låst for sønn-redigering hvis den ligger før inneværende uke.
export function isWeekLocked(iso, todayIso) {
  return weekStartIso(iso) < weekStartIso(todayIso);
}

// De fem skoledagene (man–fre) i uka som `iso` ligger i, som ISO-datoer.
export function weekdaysOf(iso) {
  const start = parseIso(weekStartIso(iso));
  const out = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(isoDate(d));
  }
  return out;
}

// Klassifiser en skoledag ut fra medaljer + syk-flagg:
//   'present' = alle timer minst Bronse (gir bonus, øker streak)
//   'broken'  = 0/Fravær på minst én time og IKKE syk (nullstiller streak)
//   'paused'  = blank/ufullstendig, syk, helg eller ingen fag (bryter ikke, ingen bonus)
export function classifyDay(state, iso) {
  if (!weekdayKey(iso)) return 'paused';
  const subjects = subjectsForDate(state, iso);
  if (subjects.length === 0) return 'paused';
  const day = (state.days || {})[iso];
  if (day && day.sick) return 'paused';
  const marks = (day && day.marks) || {};
  let allPresent = true;
  for (let i = 0; i < subjects.length; i++) {
    const m = marks[String(i)] ? marks[String(i)].medal : null;
    if (m === '0') return 'broken';
    if (m !== 'bronse' && m !== 'solv' && m !== 'gull') allPresent = false;
  }
  return allPresent ? 'present' : 'paused';
}

// Trappe-oppslag: høyeste trinn der posisjon n har nådd `from`.
export function attendanceBonusForPosition(n, ladder = DEFAULT_BONUS.attendanceLadder) {
  let pts = 0;
  for (const step of ladder) if (n >= step.from) pts = step.pts;
  return pts;
}

function attendanceLadder(state) {
  return (state.settings.bonus && state.settings.bonus.attendanceLadder) || DEFAULT_BONUS.attendanceLadder;
}

// Låste skoledager, sortert.
function lockedDates(state) {
  return Object.keys(state.days || {})
    .filter((d) => weekdayKey(d) && state.days[d].locked)
    .sort();
}

// Sammenhengende rekke skoledager fra første til siste LÅSTE dag (t.o.m. uptoIso).
// Ulåste skoledager i intervallet er «hull» og tas med (behandles som brudd av kallerne).
function scoringDaySequence(state, uptoIso) {
  const locked = lockedDates(state).filter((d) => !uptoIso || d <= uptoIso);
  if (!locked.length) return [];
  const first = locked[0];
  const end = locked[locked.length - 1];
  const out = [];
  let d = first;
  for (let i = 0; i < 6000 && d <= end; i++) {
    out.push(d);
    d = stepWeekday(d, 1);
  }
  return out;
}

// Går gjennom låste dager i rekkefølge og returnerer per-dato bonus + løpende streak.
// Kun låste dager vurderes; ulåste dager i intervallet bryter streaken.
function bonusByDate(state, uptoIso) {
  const dates = scoringDaySequence(state, uptoIso);
  const ladder = attendanceLadder(state);
  const map = {};
  let count = 0;
  for (const d of dates) {
    const c = state.days[d] && state.days[d].locked ? classifyDay(state, d) : 'broken';
    if (c === 'present') {
      count += 1;
      map[d] = attendanceBonusForPosition(count, ladder);
    } else if (c === 'broken') {
      count = 0;
      map[d] = 0;
    } else {
      map[d] = 0;
    }
  }
  return { map, count };
}

// Oppsummering av oppmøte-streaken t.o.m. `uptoIso` (default: hele historikken).
export function attendanceStreakInfo(state, uptoIso) {
  const { map, count } = bonusByDate(state, uptoIso);
  let bonusTotal = 0;
  for (const d of Object.keys(map)) bonusTotal += map[d];
  return { length: count, bonusPerDay: attendanceBonusForPosition(count || 1, attendanceLadder(state)), bonusTotal };
}

// --- Låsing (commit) -----------------------------------------------------

export function isDayLocked(state, iso) {
  const day = (state.days || {})[iso];
  return !!(day && day.locked);
}

export function isWeekClosed(state, iso) {
  const wl = (state.weekLocks || {})[weekStartIso(iso)];
  return !!(wl && wl.closed);
}

// Sønn kan redigere inneværende + forrige uke (til den avsluttes). Eldre = kun visning.
export function canSonEditDay(state, iso, todayIso) {
  const ws = weekStartIso(iso);
  const cur = weekStartIso(todayIso);
  if (ws >= cur) return true;
  const prev = weekStartIso(stepWeekday(cur, -1));
  if (ws === prev) return !isWeekClosed(state, iso);
  return false;
}

// Lås/åpne en dag. Fryser fag ved første lås (som setMark). Ren funksjon.
export function lockDay(state, { date, locked, actor }, ctx) {
  const s = clone(state);
  if (!s.days[date]) s.days[date] = { subjects: subjectsForDate(state, date), marks: {} };
  s.days[date].locked = !!locked;
  s.days[date].lockedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'lock', day: date, to: !!locked });
  return s;
}

// Avslutt en uke: lås alle fem skoledager «som de står» + merk uka avsluttet.
export function closeWeek(state, { weekIso, actor }, ctx) {
  const s = clone(state);
  const ws = weekStartIso(weekIso);
  for (const d of weekdaysOf(weekIso)) {
    if (!s.days[d]) s.days[d] = { subjects: subjectsForDate(state, d), marks: {} };
    s.days[d].locked = true;
    s.days[d].lockedAt = ctx.now;
  }
  if (!s.weekLocks) s.weekLocks = {};
  s.weekLocks[ws] = { closed: true, at: ctx.now, by: actor };
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'weekclose', week: ws });
  return s;
}

// Åpne en avsluttet uke igjen (forelder).
export function reopenWeek(state, { weekIso, actor }, ctx) {
  const s = clone(state);
  const ws = weekStartIso(weekIso);
  if (!s.weekLocks) s.weekLocks = {};
  s.weekLocks[ws] = { closed: false, at: ctx.now, by: actor };
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'weekopen', week: ws });
  return s;
}

// --- Ukesbonus: sølv/gull-timer -----------------------------------------

// Teller medaljer over LÅSTE dager i uka som `iso` ligger i.
export function weeklyMedalCounts(state, iso) {
  const ws = weekStartIso(iso);
  let bronse = 0, solv = 0, gull = 0;
  for (const d of Object.keys(state.days || {})) {
    if (weekStartIso(d) !== ws || !state.days[d].locked) continue;
    const marks = state.days[d].marks || {};
    for (const idx of Object.keys(marks)) {
      const m = marks[idx].medal;
      if (m === 'bronse') bronse += 1;
      else if (m === 'solv') solv += 1;
      else if (m === 'gull') gull += 1;
    }
  }
  return { bronse, solv, gull, silverHours: solv + gull, goldHours: gull };
}

// Høyeste trinn nådd (min-terskler). tiers = [{min,pts}, ...].
export function tierBonus(count, tiers = []) {
  let pts = 0;
  for (const t of tiers) if (count >= t.min) pts = Math.max(pts, t.pts);
  return pts;
}

// Ukesbonus for uka som `iso` ligger i. Sølv og gull stables.
export function weeklyStreakBonus(state, iso) {
  const c = weeklyMedalCounts(state, iso);
  const b = state.settings.bonus || DEFAULT_BONUS;
  const silver = tierBonus(c.silverHours, b.silverTiers || DEFAULT_BONUS.silverTiers);
  const gold = tierBonus(c.goldHours, b.goldTiers || DEFAULT_BONUS.goldTiers);
  return { silver, gold, total: silver + gold, counts: c };
}

// Sum ukesbonus over alle uker med låste dager (inngår i saldo).
export function weeklyStreakBonusTotal(state) {
  const weeks = new Set();
  for (const d of Object.keys(state.days || {})) if (state.days[d].locked) weeks.add(weekStartIso(d));
  let sum = 0;
  for (const w of weeks) sum += weeklyStreakBonus(state, w).total;
  return sum;
}

// --- Ekte streak: timer på rad ------------------------------------------

// Kronologisk sekvens av UTFYLTE medaljetimer over låste dager (også syke).
// Ulåst dag i intervallet = {break:true} (hull). «0» (fravær u/gyldig grunn) =
// {break:true} (brudd). Blank time og syk-dagens blanke timer hoppes over (pause).
// Ren funksjon.
export function lessonSequence(state, uptoIso) {
  const days = scoringDaySequence(state, uptoIso);
  const seq = [];
  for (const d of days) {
    const day = state.days[d];
    if (!day || !day.locked) { seq.push({ date: d, break: true }); continue; }
    const subjects = subjectsForDate(state, d);
    const marks = day.marks || {};
    for (let i = 0; i < subjects.length; i++) {
      const m = marks[String(i)] ? marks[String(i)].medal : null;
      if (m === 'bronse' || m === 'solv' || m === 'gull') seq.push({ date: d, idx: i, medal: m });
      else if (m === '0') seq.push({ date: d, idx: i, break: true });
      // null/blank = hopp over (pause); syk-dagens blanke timer havner også her
    }
  }
  return seq;
}

// Regn ut nå/all-time/måned for en «treff»-funksjon over timesekvensen.
export function hourStreak(state, isHit, monthPrefix, uptoIso) {
  const seq = lessonSequence(state, uptoIso);
  let cur = 0, best = 0;
  for (const e of seq) {
    if (!e.break && isHit(e)) { cur += 1; if (cur > best) best = cur; }
    else cur = 0;
  }
  let mcur = 0, mbest = 0;
  for (const e of seq) {
    const inMonth = !e.break && e.date && monthPrefix && e.date.slice(0, 7) === monthPrefix;
    if (inMonth && isHit(e)) { mcur += 1; if (mcur > mbest) mbest = mcur; }
    else mcur = 0;
  }
  return {
    current: cur,
    currentOngoing: cur > 0,
    allTimeBest: best,
    monthBest: mbest,
    monthBestOngoing: cur > 0 && mbest > 0 && mcur === mbest,
  };
}

export function silverStreakInfo(state, monthPrefix, uptoIso) {
  return hourStreak(state, (e) => e.medal === 'solv' || e.medal === 'gull', monthPrefix, uptoIso);
}
export function goldStreakInfo(state, monthPrefix, uptoIso) {
  return hourStreak(state, (e) => e.medal === 'gull', monthPrefix, uptoIso);
}

// --- Migrering av eldre state -------------------------------------------

// Fyller manglende felt og markerer eksisterende dager med innhold som låst,
// så opptjente poeng ikke forsvinner når «lås styrer alt» tas i bruk. Ren funksjon.
export function migrate(state, todayIso) {
  const s = clone(state);
  const def = DEFAULT_BONUS;
  if (!s.settings.bonus) s.settings.bonus = JSON.parse(JSON.stringify(def));
  else {
    if (!s.settings.bonus.attendanceLadder) s.settings.bonus.attendanceLadder = [...def.attendanceLadder];
    if (!s.settings.bonus.silverTiers) s.settings.bonus.silverTiers = [...def.silverTiers];
    if (!s.settings.bonus.goldTiers) s.settings.bonus.goldTiers = [...def.goldTiers];
  }
  if (!s.weekLocks) s.weekLocks = {};
  if (!Array.isArray(s.quests)) s.quests = [];
  if (!Array.isArray(s.homework)) s.homework = [];
  if (s.settings.homeworkPoints == null) s.settings.homeworkPoints = 5;
  if (!s.settings.docendoIcalId) s.settings.docendoIcalId = '519a0908-ed7d-47ed-8667-dea07343b693';
  const stamp = (todayIso || '2000-01-01') + 'T00:00:00.000Z';
  for (const d of Object.keys(s.days || {})) {
    const day = s.days[d];
    if (day.locked === undefined) {
      const hasContent = (day.marks && Object.keys(day.marks).length > 0) || day.sick;
      if (hasContent) {
        day.locked = true;
        if (!day.lockedAt) day.lockedAt = stamp;
      }
    }
  }
  return s;
}

// Total streak-bonus over hele historikken (inngår i saldo).
export function streakBonusTotal(state) {
  return attendanceStreakInfo(state).bonusTotal;
}

// --- Sidequests ----------------------------------------------------------
// status: 'open' -> (sønn commit) 'done' -> (forelder) 'approved'.
// Send tilbake / angre setter status tilbake til 'open'. Sletting = removed-tombstone.
// `points` er ett tall nå; framtidig trappetrinn blir `tiers` + valgt trinn ved commit.

// Aktive (ikke-slettede) quests.
export function activeQuests(state) {
  return (state.quests || []).filter((q) => !q.removed);
}

// Forfalt = frist passert og ikke godkjent (fortsatt gjørbar – kun et merke).
export function isQuestOverdue(quest, todayIso) {
  return !!(quest && !quest.removed && quest.due && quest.status !== 'approved' && quest.due < todayIso);
}

// Poeng fra godkjente quests (inngår i saldo). Ventende (done) teller ikke.
export function questPointsTotal(state) {
  return activeQuests(state)
    .filter((q) => q.status === 'approved')
    .reduce((a, q) => a + (Number(q.points) || 0), 0);
}

// Poeng som venter på godkjenning (kun visning).
export function questPointsPending(state) {
  return activeQuests(state)
    .filter((q) => q.status === 'done')
    .reduce((a, q) => a + (Number(q.points) || 0), 0);
}

function findQuestIdx(s, id) {
  return (s.quests || []).findIndex((q) => q.id === id);
}

// Opprett quest (forelder). ctx.id blir quest-id.
export function addQuest(state, { title, desc = '', points, due = null, actor = 'parent' }, ctx) {
  const s = clone(state);
  if (!Array.isArray(s.quests)) s.quests = [];
  s.quests.push({
    id: ctx.id,
    title,
    desc,
    points: Number(points) || 0,
    due: due || null,
    status: 'open',
    createdAt: ctx.now,
    createdBy: actor,
    doneAt: null,
    approvedAt: null,
    updatedAt: ctx.now,
    removed: false,
  });
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'quest', action: 'create', quest: ctx.id, title });
  return s;
}

// Rediger felt på en quest (forelder).
export function updateQuest(state, { id, patch, actor = 'parent' }, ctx) {
  const s = clone(state);
  const i = findQuestIdx(s, id);
  if (i < 0) return s;
  const q = s.quests[i];
  if ('title' in patch) q.title = patch.title;
  if ('desc' in patch) q.desc = patch.desc;
  if ('points' in patch) q.points = Number(patch.points) || 0;
  if ('due' in patch) q.due = patch.due || null;
  q.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'quest', action: 'edit', quest: id, title: q.title });
  return s;
}

// Slett quest (tombstone som overlever fletting).
export function deleteQuest(state, { id, actor = 'parent' }, ctx) {
  const s = clone(state);
  const i = findQuestIdx(s, id);
  if (i < 0) return s;
  s.quests[i].removed = true;
  s.quests[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'quest', action: 'delete', quest: id, title: s.quests[i].title });
  return s;
}

// Sønn markerer ferdig (commit): open -> done.
export function commitQuest(state, { id, actor = 'son' }, ctx) {
  const s = clone(state);
  const i = findQuestIdx(s, id);
  if (i < 0) return s;
  s.quests[i].status = 'done';
  s.quests[i].doneAt = ctx.now;
  s.quests[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'quest', action: 'done', quest: id, title: s.quests[i].title });
  return s;
}

// Sønn angrer ferdigmelding: done -> open.
export function uncommitQuest(state, { id, actor = 'son' }, ctx) {
  const s = clone(state);
  const i = findQuestIdx(s, id);
  if (i < 0) return s;
  s.quests[i].status = 'open';
  s.quests[i].doneAt = null;
  s.quests[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'quest', action: 'undo', quest: id, title: s.quests[i].title });
  return s;
}

// Forelder godkjenner: done -> approved (poeng teller nå).
export function approveQuest(state, { id, actor = 'parent' }, ctx) {
  const s = clone(state);
  const i = findQuestIdx(s, id);
  if (i < 0) return s;
  s.quests[i].status = 'approved';
  s.quests[i].approvedAt = ctx.now;
  s.quests[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'quest', action: 'approve', quest: id, title: s.quests[i].title, points: s.quests[i].points });
  return s;
}

// Forelder sender tilbake: done -> open (nullstiller ferdigmelding).
export function rejectQuest(state, { id, note = '', actor = 'parent' }, ctx) {
  const s = clone(state);
  const i = findQuestIdx(s, id);
  if (i < 0) return s;
  s.quests[i].status = 'open';
  s.quests[i].doneAt = null;
  s.quests[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'quest', action: 'reject', quest: id, title: s.quests[i].title, note });
  return s;
}

// Medaljepoeng for én enkelt dag.
function dayMedalPoints(state, iso) {
  const day = (state.days || {})[iso];
  if (!day) return 0;
  const v = state.settings.medalValues;
  const marks = day.marks || {};
  let s = 0;
  for (const idx of Object.keys(marks)) s += medalPoints(marks[idx].medal, v);
  return s;
}

// Opptjent på én dag = medaljepoeng + oppmøte-bonus. Kun hvis dagen er låst.
export function dailyTotal(state, iso) {
  if (!(state.days[iso] && state.days[iso].locked)) return 0;
  const { map } = bonusByDate(state, iso);
  return dayMedalPoints(state, iso) + (map[iso] || 0);
}

// Opptjent i uka som `iso` ligger i (man–fre) = medaljepoeng + oppmøte-bonus + ukesbonus.
export function weeklyTotal(state, iso) {
  const ws = weekStartIso(iso);
  const { map } = bonusByDate(state);
  let sum = 0;
  for (const d of Object.keys(state.days || {})) {
    if (weekStartIso(d) === ws && state.days[d].locked) sum += dayMedalPoints(state, d) + (map[d] || 0);
  }
  return sum + weeklyStreakBonus(state, iso).total;
}

// Merk (eller fjern) syk/fri for en dag. sickAt lagres for konfliktfri fletting.
export function setSick(state, { date, sick, actor }, ctx) {
  const s = clone(state);
  if (!s.days[date]) s.days[date] = { subjects: subjectsForDate(state, date), marks: {} };
  const prev = !!s.days[date].sick;
  if (sick) s.days[date].sick = true;
  else delete s.days[date].sick;
  s.days[date].sickAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'sick', day: date, from: prev, to: !!sick });
  return s;
}

// --- Re-synk av en dags fag med timeplanen -------------------------------

// True hvis dagen ikke er «frosset», eller de frosne fagene er identiske med
// gjeldende timeplan for ukedagen. False = fagene har kommet ut av synk.
export function daySubjectsMatchTimetable(state, iso) {
  const day = (state.days || {})[iso];
  if (!day || !Array.isArray(day.subjects)) return true; // ikke frosset -> leser live
  const wk = weekdayKey(iso);
  const tt = wk ? state.settings.timetable[wk] || [] : [];
  if (day.subjects.length !== tt.length) return false;
  return day.subjects.every((s, i) => s === tt[i]);
}

// Oppdater en dags frosne fag fra gjeldende timeplan. Medaljer flyttes til riktig
// rad via fagnavn; medaljer for fag som ikke lenger finnes forsvinner (telles i logg).
// Flyttede medaljer får ny updatedAt så de vinner ved fletting mot andre enheter.
// Ren funksjon (returnerer NY state).
export function resyncSubjects(state, { date, actor }, ctx) {
  const s = clone(state);
  const wk = weekdayKey(date);
  const newSubjects = wk ? (s.settings.timetable[wk] || []).slice() : [];
  const day = s.days[date] || { subjects: [], marks: {} };
  const oldSubjects = Array.isArray(day.subjects) ? day.subjects : [];
  const oldMarks = day.marks || {};
  const newMarks = {};
  const used = new Set();
  let dropped = 0;
  for (const idx of Object.keys(oldMarks)) {
    const name = oldSubjects[Number(idx)];
    let target = -1;
    for (let j = 0; j < newSubjects.length; j++) {
      if (newSubjects[j] === name && !used.has(j)) {
        target = j;
        break;
      }
    }
    if (target === -1) {
      dropped += 1;
      continue;
    }
    used.add(target);
    newMarks[String(target)] = { ...oldMarks[idx], updatedAt: ctx.now };
  }
  s.days[date] = { ...day, subjects: newSubjects, marks: newMarks };
  s.log.push({
    id: ctx.id, at: ctx.now, actor, type: 'resync', day: date,
    from: oldSubjects.length, to: newSubjects.length, dropped,
  });
  return s;
}

// --- Fletting (LWW dager/innstillinger + union logg/utbetaling) -----------

function unionById(arrA = [], arrB = []) {
  const map = new Map();
  for (const x of arrA) map.set(x.id, x);
  for (const x of arrB) if (!map.has(x.id)) map.set(x.id, x); // A vinner ved lik id (append-only)
  return [...map.values()];
}

export function mergeState(local, remote) {
  if (!remote) return clone(local);
  if (!local) return clone(remote);
  const out = clone(local);

  // settings: LWW på updatedAt (mangler updatedAt = eldst)
  const lu = local.settings.updatedAt || '',
    ru = remote.settings.updatedAt || '';
  out.settings = ru > lu ? clone(remote.settings) : clone(local.settings);

  // days: union av datoer; per dato union av marks, nyeste updatedAt vinner
  out.days = clone(local.days || {});
  for (const date of Object.keys(remote.days || {})) {
    if (!out.days[date]) {
      out.days[date] = clone(remote.days[date]);
      continue;
    }
    const rm = remote.days[date].marks || {},
      lm = out.days[date].marks || {};
    for (const idx of Object.keys(rm)) {
      const lMark = lm[idx];
      if (!lMark || (rm[idx].updatedAt || '') > (lMark.updatedAt || '')) lm[idx] = clone(rm[idx]);
    }
    out.days[date].marks = lm;
    if (!out.days[date].subjects && remote.days[date].subjects)
      out.days[date].subjects = clone(remote.days[date].subjects);
    // syk-flagg: LWW på sickAt (mangler sickAt = eldst)
    if ((remote.days[date].sickAt || '') > (out.days[date].sickAt || '')) {
      if (remote.days[date].sick) out.days[date].sick = true;
      else delete out.days[date].sick;
      out.days[date].sickAt = remote.days[date].sickAt;
    }
    // lås-flagg: LWW på lockedAt
    if ((remote.days[date].lockedAt || '') > (out.days[date].lockedAt || '')) {
      out.days[date].locked = !!remote.days[date].locked;
      out.days[date].lockedAt = remote.days[date].lockedAt;
    }
  }

  // weekLocks: LWW per uke på `at`
  out.weekLocks = clone(local.weekLocks || {});
  for (const w of Object.keys(remote.weekLocks || {})) {
    const lw = out.weekLocks[w],
      rw = remote.weekLocks[w];
    if (!lw || (rw.at || '') > (lw.at || '')) out.weekLocks[w] = clone(rw);
  }

  // append-only lister: union på id
  out.log = unionById(local.log, remote.log);
  out.payouts = unionById(local.payouts, remote.payouts);
  // quests: LWW per id på updatedAt (statusendringer/sletting vinner nyest)
  if (local.quests || remote.quests) out.quests = mergeQuestList(local.quests, remote.quests);
  // homework: LWW per id på updatedAt (som quests)
  if (local.homework || remote.homework) out.homework = mergeHomeworkList(local.homework, remote.homework);
  // fremtidige felt flettes allerede (bygges ikke nå):
  for (const key of ['shopItems', 'purchases']) {
    if (local[key] || remote[key]) out[key] = unionById(local[key], remote[key]);
  }
  return out;
}

// LWW per quest på updatedAt. Nye quests (kun én side) tas med.
function mergeQuestList(a = [], b = []) {
  const map = new Map();
  for (const q of a || []) map.set(q.id, clone(q));
  for (const q of b || []) {
    const cur = map.get(q.id);
    if (!cur || (q.updatedAt || '') > (cur.updatedAt || '')) map.set(q.id, clone(q));
  }
  return [...map.values()];
}

// --- Lekser (homework) ---------------------------------------------------
// status: 'open' -> (sønn) 'done' -> (forelder) 'approved'.
// Poeng teller kun ved 'approved' og hidden !== true. Sletting = removed-tombstone.
// source: 'manual' | 'docendo'. Redigert lekse (edited=true) beskyttes mot re-import.

export function activeHomework(state) {
  return (state.homework || []).filter((h) => !h.removed);
}

export function homeworkPointsTotal(state) {
  return activeHomework(state)
    .filter((h) => h.status === 'approved' && !h.hidden)
    .reduce((a, h) => a + (Number(h.points) || 0), 0);
}

export function homeworkPointsPending(state) {
  return activeHomework(state)
    .filter((h) => h.status === 'done' && !h.hidden)
    .reduce((a, h) => a + (Number(h.points) || 0), 0);
}

// Ikke-skjulte lekser i uka som `iso` ligger i, sortert på dato deretter fag.
export function homeworkForWeek(state, iso) {
  const ws = weekStartIso(iso);
  return activeHomework(state)
    .filter((h) => !h.hidden && h.date && weekStartIso(h.date) === ws)
    .sort((a, b) => (a.date === b.date ? String(a.subject || '').localeCompare(String(b.subject || '')) : a.date < b.date ? -1 : 1));
}

function findHomeworkIdx(s, id) {
  return (s.homework || []).findIndex((h) => h.id === id);
}

// Opprett lekse (forelder eller import). ctx.id blir lekse-id.
export function addHomework(state, { date, subject = '', text = '', points, wholeWeek = false, source = 'manual', docendoUid = null, actor = 'parent' }, ctx) {
  const s = clone(state);
  if (!Array.isArray(s.homework)) s.homework = [];
  const pts = points == null ? (s.settings.homeworkPoints ?? 5) : Number(points) || 0;
  s.homework.push({
    id: ctx.id,
    date,
    subject,
    text,
    points: pts,
    status: 'open',
    wholeWeek: !!wholeWeek,
    hidden: false,
    source,
    docendoUid,
    edited: false,
    doneAt: null,
    approvedAt: null,
    createdAt: ctx.now,
    createdBy: actor,
    updatedAt: ctx.now,
    removed: false,
  });
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'homework', action: 'create', hw: ctx.id, subject, date });
  return s;
}

// Rediger lekse (forelder). Setter edited=true (beskyttes mot re-import).
export function updateHomework(state, { id, patch, actor = 'parent' }, ctx) {
  const s = clone(state);
  const i = findHomeworkIdx(s, id);
  if (i < 0) return s;
  const h = s.homework[i];
  if ('subject' in patch) h.subject = patch.subject;
  if ('text' in patch) h.text = patch.text;
  if ('points' in patch) h.points = Number(patch.points) || 0;
  if ('date' in patch) h.date = patch.date;
  if ('wholeWeek' in patch) h.wholeWeek = !!patch.wholeWeek;
  h.edited = true;
  h.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'homework', action: 'edit', hw: id, subject: h.subject });
  return s;
}

// Slett lekse (tombstone som overlever fletting).
export function deleteHomework(state, { id, actor = 'parent' }, ctx) {
  const s = clone(state);
  const i = findHomeworkIdx(s, id);
  if (i < 0) return s;
  s.homework[i].removed = true;
  s.homework[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'homework', action: 'delete', hw: id, subject: s.homework[i].subject });
  return s;
}

// Skjul/vis lekse (opt-out uten sletting).
export function hideHomework(state, { id, hidden, actor = 'parent' }, ctx) {
  const s = clone(state);
  const i = findHomeworkIdx(s, id);
  if (i < 0) return s;
  s.homework[i].hidden = !!hidden;
  s.homework[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'homework', action: hidden ? 'hide' : 'show', hw: id, subject: s.homework[i].subject });
  return s;
}

// Sønn markerer ferdig: open -> done.
export function commitHomework(state, { id, actor = 'son' }, ctx) {
  const s = clone(state);
  const i = findHomeworkIdx(s, id);
  if (i < 0) return s;
  s.homework[i].status = 'done';
  s.homework[i].doneAt = ctx.now;
  s.homework[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'homework', action: 'done', hw: id, subject: s.homework[i].subject });
  return s;
}

// Sønn angrer: done -> open.
export function uncommitHomework(state, { id, actor = 'son' }, ctx) {
  const s = clone(state);
  const i = findHomeworkIdx(s, id);
  if (i < 0) return s;
  s.homework[i].status = 'open';
  s.homework[i].doneAt = null;
  s.homework[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'homework', action: 'undo', hw: id, subject: s.homework[i].subject });
  return s;
}

// Forelder godkjenner: done -> approved (poeng teller nå).
export function approveHomework(state, { id, actor = 'parent' }, ctx) {
  const s = clone(state);
  const i = findHomeworkIdx(s, id);
  if (i < 0) return s;
  s.homework[i].status = 'approved';
  s.homework[i].approvedAt = ctx.now;
  s.homework[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'homework', action: 'approve', hw: id, subject: s.homework[i].subject, points: s.homework[i].points });
  return s;
}

// Forelder sender tilbake: done -> open.
export function rejectHomework(state, { id, note = '', actor = 'parent' }, ctx) {
  const s = clone(state);
  const i = findHomeworkIdx(s, id);
  if (i < 0) return s;
  s.homework[i].status = 'open';
  s.homework[i].doneAt = null;
  s.homework[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'homework', action: 'reject', hw: id, subject: s.homework[i].subject, note });
  return s;
}

// LWW per lekse på updatedAt. Nye lekser (kun én side) tas med.
function mergeHomeworkList(a = [], b = []) {
  const map = new Map();
  for (const h of a || []) map.set(h.id, clone(h));
  for (const h of b || []) {
    const cur = map.get(h.id);
    if (!cur || (h.updatedAt || '') > (cur.updatedAt || '')) map.set(h.id, clone(h));
  }
  return [...map.values()];
}

// --- Fag-statistikk (forelder, kun visning) ------------------------------

export const EFFORT_SCORE = { bronse: 1, solv: 2, gull: 3 };

// Flat liste med innsats-records fra LÅSTE, ikke-syke dager.
// Kun bronse/solv/gull teller; fravær ('0') og ikke-vurdert (null) utelates.
export function effortRecords(state) {
  const days = (state && state.days) || {};
  const out = [];
  for (const date of Object.keys(days)) {
    const day = days[date];
    if (!day || day.locked !== true || day.sick) continue;
    const wd = weekdayKey(date);
    const subjects = Array.isArray(day.subjects) ? day.subjects : [];
    const marks = day.marks || {};
    for (const key of Object.keys(marks)) {
      const medal = marks[key] ? marks[key].medal : null;
      const score = EFFORT_SCORE[medal];
      if (score === undefined) continue; // null og '0' hoppes over
      const raw = subjects[Number(key)];
      const label = (raw == null ? '' : String(raw)).trim();
      if (!label) continue;
      out.push({
        date,
        weekday: wd,
        position: Number(key),
        subjectKey: label.toLowerCase(),
        subjectLabel: label,
        medal,
        score,
      });
    }
  }
  return out;
}

// Periode-grenser for statistikk. 'all' | 'month' | 'd90'. todayIso = 'YYYY-MM-DD'.
export function periodBounds(period, todayIso) {
  if (period === 'month') return { from: todayIso.slice(0, 8) + '01', to: todayIso };
  if (period === 'd90') {
    const d = parseIso(todayIso);
    d.setDate(d.getDate() - 89); // 90 dager inklusiv i dag
    return { from: isoDate(d), to: todayIso };
  }
  return { from: null, to: null }; // 'all'
}

export function filterRecordsByPeriod(records, bounds) {
  const { from, to } = bounds || {};
  return (records || []).filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}

// Intern: velg hyppigste skrivemåte for et fag.
function pickLabel(labelCounts) {
  let best = null, bestN = -1;
  for (const [label, n] of labelCounts) {
    if (n > bestN) { best = label; bestN = n; }
  }
  return best;
}

export function statBySubject(records) {
  const map = new Map(); // key -> { sum, n, labels:Map }
  let totalSum = 0, totalN = 0;
  for (const r of records || []) {
    let e = map.get(r.subjectKey);
    if (!e) { e = { sum: 0, n: 0, labels: new Map() }; map.set(r.subjectKey, e); }
    e.sum += r.score; e.n += 1;
    e.labels.set(r.subjectLabel, (e.labels.get(r.subjectLabel) || 0) + 1);
    totalSum += r.score; totalN += 1;
  }
  const subjects = [...map.entries()].map(([key, e]) => ({
    subjectKey: key,
    subjectLabel: pickLabel(e.labels),
    avg: e.sum / e.n,
    n: e.n,
  }));
  subjects.sort((a, b) => b.avg - a.avg || b.n - a.n);
  return { subjects, overallAvg: totalN ? totalSum / totalN : 0, n: totalN };
}

export function statByPosition(records) {
  const map = new Map(); // position -> { sum, n }
  for (const r of records || []) {
    let e = map.get(r.position);
    if (!e) { e = { sum: 0, n: 0 }; map.set(r.position, e); }
    e.sum += r.score; e.n += 1;
  }
  return [...map.entries()]
    .map(([position, e]) => ({ position, avg: e.sum / e.n, n: e.n }))
    .sort((a, b) => a.position - b.position);
}

export function statHeatmap(records) {
  const acc = {}; // wd -> pos -> {sum,n}
  for (const k of WEEKDAY_KEYS) acc[k] = {};
  let maxPos = -1;
  for (const r of records || []) {
    if (!acc[r.weekday]) continue; // helg e.l. finnes normalt ikke
    let e = acc[r.weekday][r.position];
    if (!e) { e = { sum: 0, n: 0 }; acc[r.weekday][r.position] = e; }
    e.sum += r.score; e.n += 1;
    if (r.position > maxPos) maxPos = r.position;
  }
  const positions = [];
  for (let p = 0; p <= maxPos; p++) positions.push(p);
  const cell = {};
  for (const wd of WEEKDAY_KEYS) {
    cell[wd] = {};
    for (const p of positions) {
      const e = acc[wd][p];
      cell[wd][p] = e ? { avg: e.sum / e.n, n: e.n } : null;
    }
  }
  return { positions, weekdays: [...WEEKDAY_KEYS], cell };
}

// focusKeys = liste med subjectKey som skal få egen linje (i tillegg til totalt).
// Hvis utelatt: de to fagene med flest records.
// Sum innsats-poeng per LÅST dag. Ett punkt per dag. Sortert på dato.
export function statDailyTotal(records) {
  const byDate = {};
  for (const r of records || []) byDate[r.date] = (byDate[r.date] || 0) + r.score;
  return Object.keys(byDate).sort().map((date) => ({ date, total: byDate[date] }));
}

// Sum innsats-poeng per uke (mandag-startet). subjectKey null/'__all__' = alle fag.
// Sammenhengende uker fra første til siste uke i records (uker uten poeng = 0).
export function statWeeklyTotal(records, subjectKey) {
  const recs = records || [];
  if (!recs.length) return [];
  const all = subjectKey == null || subjectKey === '__all__';
  const sum = {};
  let firstW = null, lastW = null;
  for (const r of recs) {
    const w = weekStartIso(r.date);
    if (firstW === null || w < firstW) firstW = w;
    if (lastW === null || w > lastW) lastW = w;
    if (all || r.subjectKey === subjectKey) sum[w] = (sum[w] || 0) + r.score;
  }
  const out = [];
  let w = firstW;
  for (let i = 0; i < 520 && w <= lastW; i++) {
    out.push({ week: w, total: sum[w] || 0 });
    const d = parseIso(w); d.setDate(d.getDate() + 7); w = isoDate(d);
  }
  return out;
}

// Andeler gull/solv/bronse per fag (fravær/null er allerede ute av records).
// Sortert som statBySubject (snitt synkende) for visuell konsistens med Visning 1.
export function statMedalDistribution(records) {
  const order = statBySubject(records).subjects.map((s) => s.subjectKey);
  const map = new Map(); // key -> { labels:Map, gull, solv, bronse, n }
  for (const r of records || []) {
    let e = map.get(r.subjectKey);
    if (!e) { e = { labels: new Map(), gull: 0, solv: 0, bronse: 0, n: 0 }; map.set(r.subjectKey, e); }
    if (r.medal === 'gull') e.gull++;
    else if (r.medal === 'solv') e.solv++;
    else if (r.medal === 'bronse') e.bronse++;
    e.n++;
    e.labels.set(r.subjectLabel, (e.labels.get(r.subjectLabel) || 0) + 1);
  }
  return order.map((key) => {
    const e = map.get(key);
    return {
      subjectKey: key,
      subjectLabel: pickLabel(e.labels),
      n: e.n,
      gull: e.gull / e.n,
      solv: e.solv / e.n,
      bronse: e.bronse / e.n,
    };
  });
}
