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

export function computeBalance(state) {
  return computeEarned(state) - computeSpent(state);
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
