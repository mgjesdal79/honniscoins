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

export function defaultState() {
  return {
    settings: {
      pin: null,
      medalValues: { ...DEFAULT_MEDAL_VALUES },
      krPerCoin: 1,
      timetable: { mon: [], tue: [], wed: [], thu: [], fri: [] },
      schemaVersion: 1,
      updatedAt: null,
    },
    days: {},
    payouts: [],
    log: [],
  };
}

export function computeEarned(state) {
  const v = state.settings.medalValues;
  let sum = 0;
  for (const date of Object.keys(state.days || {})) {
    const marks = state.days[date].marks || {};
    for (const idx of Object.keys(marks)) sum += medalPoints(marks[idx].medal, v);
  }
  return sum;
}

export function computeSpent(state) {
  return (state.payouts || []).reduce((a, p) => a + (p.coins || 0), 0);
}

// Saldo = medaljepoeng + streak-bonus − utbetalinger (= total-total).
export function computeBalance(state) {
  return computeEarned(state) + streakBonusTotal(state) - computeSpent(state);
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

// Bonus per til stede-dag innenfor gjeldende streak: +1 for dag 1–10, +2 fra dag 11.
function bonusForPosition(n) {
  return n <= 10 ? 1 : 2;
}

// Går gjennom historikken i datorekkefølge og returnerer per-dato bonus + løpende streak.
function bonusByDate(state, uptoIso) {
  const dates = Object.keys(state.days || {})
    .filter((d) => !uptoIso || d <= uptoIso)
    .sort();
  const map = {};
  let count = 0;
  for (const d of dates) {
    const c = classifyDay(state, d);
    if (c === 'present') {
      count += 1;
      map[d] = bonusForPosition(count);
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
  return { length: count, bonusPerDay: count >= 10 ? 2 : 1, bonusTotal };
}

// Total streak-bonus over hele historikken (inngår i saldo).
export function streakBonusTotal(state) {
  return attendanceStreakInfo(state).bonusTotal;
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

// Opptjent på én dag = medaljepoeng + evt. streak-bonus for dagen.
export function dailyTotal(state, iso) {
  const { map } = bonusByDate(state, iso);
  return dayMedalPoints(state, iso) + (map[iso] || 0);
}

// Opptjent i uka som `iso` ligger i (man–fre) = medaljepoeng + streak-bonus.
export function weeklyTotal(state, iso) {
  const ws = weekStartIso(iso);
  const { map } = bonusByDate(state);
  let sum = 0;
  for (const d of Object.keys(state.days || {})) {
    if (weekStartIso(d) === ws) sum += dayMedalPoints(state, d) + (map[d] || 0);
  }
  return sum;
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
  }

  // append-only lister: union på id
  out.log = unionById(local.log, remote.log);
  out.payouts = unionById(local.payouts, remote.payouts);
  // fremtidige felt flettes allerede (bygges ikke nå):
  for (const key of ['shopItems', 'purchases', 'quests']) {
    if (local[key] || remote[key]) out[key] = unionById(local[key], remote[key]);
  }
  return out;
}
