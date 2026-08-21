// Delt testsuite – ren logikk, ingen DOM. Kjøres i nettleser (tests.js) og via jsc (run-jsc.js).
import * as L from '../js/logic.js';

export function runTests() {
  const results = [];
  const eq = (name, actual, expected) =>
    results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  // Hjelper: en låst dag med gitte medaljer (idx -> medal).
  const lockedDay = (subjects, medals) => {
    const marks = {};
    Object.keys(medals).forEach((i) => (marks[i] = { medal: medals[i] }));
    return { subjects, marks, locked: true, lockedAt: 't' };
  };

  const tests = [
    // --- poeng ---
    function medalPoints_basics() {
      const v = L.DEFAULT_MEDAL_VALUES;
      eq('null -> 0', L.medalPoints(null, v), 0);
      eq('"0"/fravaer -> 0', L.medalPoints('0', v), 0);
      eq('bronse -> 1', L.medalPoints('bronse', v), 1);
      eq('solv -> 2', L.medalPoints('solv', v), 2);
      eq('gull -> 3', L.medalPoints('gull', v), 3);
    },
    function defaultState_shape() {
      const s = L.defaultState();
      eq('schemaVersion', s.settings.schemaVersion, 2);
      eq('krPerCoin', s.settings.krPerCoin, 1);
      eq('medalValues', s.settings.medalValues, { bronse: 1, solv: 2, gull: 3 });
      eq('timetable keys', Object.keys(s.settings.timetable), ['mon', 'tue', 'wed', 'thu', 'fri']);
      eq('bonus present', !!s.settings.bonus.silverTiers, true);
      eq('weekLocks empty', s.weekLocks, {});
      eq('days empty', s.days, {});
    },
    function balance_earned_minus_spent() {
      const s = L.defaultState();
      s.days['2026-08-20'] = lockedDay(['A', 'B'], { 0: 'gull', 1: 'bronse' }); // present
      s.days['2026-08-21'] = lockedDay(['A'], { 0: '0' }); // fravaer -> broken
      s.payouts.push({ id: 'p1', coins: 1 });
      eq('earned (medaljer)', L.computeEarned(s), 4); // 3 + 1 + 0
      eq('spent', L.computeSpent(s), 1);
      eq('streak-bonus', L.streakBonusTotal(s), 1); // 08-20 present -> +1, 08-21 broken
      eq('balance', L.computeBalance(s), 4); // 4 + 1 + 0 - 1
    },

    // --- lås styrer alt ---
    function locking_gates_earned() {
      const s = L.defaultState();
      s.days['2026-10-05'] = { subjects: ['A'], marks: { 0: { medal: 'gull' } } }; // ulåst
      eq('ulåst -> 0', L.computeEarned(s), 0);
      eq('ulåst dagstotal 0', L.dailyTotal(s, '2026-10-05'), 0);
      s.days['2026-10-05'].locked = true;
      s.days['2026-10-05'].lockedAt = 't';
      eq('låst -> teller', L.computeEarned(s), 3);
      eq('låst dagstotal', L.dailyTotal(s, '2026-10-05'), 4); // 3 + oppmøte 1
    },
    function lockDay_freezes_and_logs() {
      const s = L.defaultState();
      s.settings.timetable.mon = ['A', 'B'];
      const s2 = L.lockDay(s, { date: '2026-08-03', locked: true, actor: 'son' }, { now: 't', id: 'l1' });
      eq('fag frosset', s2.days['2026-08-03'].subjects, ['A', 'B']);
      eq('låst', s2.days['2026-08-03'].locked, true);
      eq('lockedAt', s2.days['2026-08-03'].lockedAt, 't');
      eq('logg lock', s2.log[0], { id: 'l1', at: 't', actor: 'son', type: 'lock', day: '2026-08-03', to: true });
      const s3 = L.lockDay(s2, { date: '2026-08-03', locked: false, actor: 'son' }, { now: 't2', id: 'l2' });
      eq('åpnet igjen', s3.days['2026-08-03'].locked, false);
    },
    function closeWeek_locks_all_and_marks() {
      const s = L.defaultState();
      s.settings.timetable.mon = ['A'];
      const s2 = L.closeWeek(s, { weekIso: '2026-10-07', actor: 'son' }, { now: 't', id: 'c1' });
      eq('uke merket avsluttet', s2.weekLocks['2026-10-05'].closed, true);
      eq('alle 5 dager låst', L.weekdaysOf('2026-10-07').every((d) => s2.days[d].locked === true), true);
      eq('logg weekclose', s2.log[0].type, 'weekclose');
      eq('isWeekClosed', L.isWeekClosed(s2, '2026-10-08'), true);
    },
    function canSonEditDay_windows() {
      const s = L.defaultState();
      const today = '2026-10-14'; // onsdag
      ok('inneværende uke', L.canSonEditDay(s, '2026-10-14', today) === true);
      ok('inneværende fredag', L.canSonEditDay(s, '2026-10-16', today) === true);
      ok('forrige uke åpen', L.canSonEditDay(s, '2026-10-07', today) === true);
      ok('eldre uke -> nei', L.canSonEditDay(s, '2026-09-28', today) === false);
      const prevWs = L.weekStartIso('2026-10-07');
      s.weekLocks[prevWs] = { closed: true, at: 't' };
      ok('forrige uke lukket -> nei', L.canSonEditDay(s, '2026-10-07', today) === false);
    },

    // --- ukesbonus sølv/gull ---
    function weeklyMedalCounts_gull_counts_as_solv() {
      const s = L.defaultState();
      s.days['2026-10-05'] = lockedDay(['A', 'B', 'C'], { 0: 'gull', 1: 'solv', 2: 'bronse' });
      const c = L.weeklyMedalCounts(s, '2026-10-05');
      eq('gull', c.gull, 1);
      eq('solv', c.solv, 1);
      eq('bronse', c.bronse, 1);
      eq('sølvtimer = solv+gull', c.silverHours, 2);
      eq('gulltimer', c.goldHours, 1);
    },
    function tierBonus_highest_reached() {
      eq('under', L.tierBonus(9, L.DEFAULT_BONUS.goldTiers), 0);
      eq('10', L.tierBonus(10, L.DEFAULT_BONUS.goldTiers), 10);
      eq('25 -> 20', L.tierBonus(25, L.DEFAULT_BONUS.goldTiers), 20);
      eq('30 -> 30', L.tierBonus(30, L.DEFAULT_BONUS.goldTiers), 30);
    },
    function weeklyStreakBonus_stacks_silver_and_gold() {
      const s = L.defaultState();
      const marks = {};
      for (let i = 0; i < 30; i++) marks[i] = { medal: 'gull' };
      s.days['2026-10-05'] = { subjects: Array(30).fill('X'), marks, locked: true, lockedAt: 't' };
      const wb = L.weeklyStreakBonus(s, '2026-10-05');
      eq('gulltimer 30', wb.counts.goldHours, 30);
      eq('sølvtimer 30', wb.counts.silverHours, 30);
      eq('gull-bonus', wb.gold, 30);
      eq('sølv-bonus', wb.silver, 10);
      eq('total stables', wb.total, 40);
      eq('sum over uker', L.weeklyStreakBonusTotal(s), 40);
    },
    function weeklyStreakBonus_silver_only_tier() {
      const s = L.defaultState();
      const marks = {};
      for (let i = 0; i < 15; i++) marks[i] = { medal: 'solv' };
      s.days['2026-10-05'] = { subjects: Array(15).fill('X'), marks, locked: true, lockedAt: 't' };
      const wb = L.weeklyStreakBonus(s, '2026-10-05');
      eq('sølv +5', wb.silver, 5);
      eq('gull 0', wb.gold, 0);
    },

    // --- ekte streak: timer på rad ---
    function silverStreak_and_gold_streak_runs() {
      const s = L.defaultState();
      s.days['2026-10-05'] = lockedDay(['A', 'B', 'C'], { 0: 'gull', 1: 'gull', 2: 'solv' });
      s.days['2026-10-06'] = lockedDay(['A', 'B'], { 0: 'gull', 1: 'bronse' });
      s.days['2026-10-07'] = lockedDay(['A'], { 0: 'gull' });
      const sv = L.silverStreakInfo(s, '2026-10');
      eq('sølv all-time (4)', sv.allTimeBest, 4); // gull,gull,solv,gull, så bronse bryter
      eq('sølv nå (1)', sv.current, 1);
      eq('sølv måned', sv.monthBest, 4);
      const gd = L.goldStreakInfo(s, '2026-10');
      eq('gull all-time (2)', gd.allTimeBest, 2); // gull,gull så solv bryter
      eq('gull nå (1)', gd.current, 1);
    },
    function streak_gap_breaks() {
      const s = L.defaultState();
      s.days['2026-10-05'] = lockedDay(['A'], { 0: 'gull' });
      s.days['2026-10-06'] = { subjects: ['A'], marks: { 0: { medal: 'gull' } } }; // ULÅST -> hull
      s.days['2026-10-07'] = lockedDay(['A'], { 0: 'gull' });
      eq('hull bryter (best 1)', L.silverStreakInfo(s, '2026-10').allTimeBest, 1);
    },
    function streak_sick_pauses() {
      const s = L.defaultState();
      s.days['2026-10-05'] = lockedDay(['A'], { 0: 'gull' });
      s.days['2026-10-06'] = { subjects: ['A'], marks: {}, sick: true, locked: true, lockedAt: 't' };
      s.days['2026-10-07'] = lockedDay(['A'], { 0: 'gull' });
      eq('syk pauser (best 2)', L.silverStreakInfo(s, '2026-10').allTimeBest, 2);
    },
    function streak_ongoing_flags() {
      const s = L.defaultState();
      s.days['2026-10-05'] = lockedDay(['A', 'B'], { 0: 'gull', 1: 'gull' });
      s.days['2026-10-06'] = lockedDay(['A'], { 0: 'gull' });
      const sv = L.silverStreakInfo(s, '2026-10');
      eq('nå = 3', sv.current, 3);
      ok('pågående', sv.currentOngoing === true);
      ok('måned pågående', sv.monthBestOngoing === true);
    },

    // --- migrering ---
    function migrate_locks_existing_content() {
      const s = L.defaultState();
      delete s.settings.bonus;
      delete s.weekLocks;
      s.days['2026-08-20'] = { subjects: ['A'], marks: { 0: { medal: 'gull' } } };
      s.days['2026-08-24'] = { subjects: ['A'], marks: {} }; // tomt -> ikke låst
      const m = L.migrate(s, '2026-08-25');
      eq('bonus fylt', !!m.settings.bonus.silverTiers, true);
      eq('weekLocks fylt', m.weekLocks, {});
      eq('dag m/innhold låst', m.days['2026-08-20'].locked, true);
      eq('tom dag ikke låst', m.days['2026-08-24'].locked, undefined);
      eq('input urørt', s.days['2026-08-20'].locked, undefined);
    },

    // --- dato / ukedag ---
    function iso_and_weekday() {
      eq('isoDate', L.isoDate(new Date(2026, 7, 20)), '2026-08-20');
      eq('weekday thu', L.weekdayKey('2026-08-20'), 'thu');
      eq('weekday sat -> null', L.weekdayKey('2026-08-22'), null);
      eq('weekday mon', L.weekdayKey('2026-08-24'), 'mon');
    },
    function step_skips_weekend() {
      eq('fri +1 -> mon', L.stepWeekday('2026-08-21', 1), '2026-08-24');
      eq('mon -1 -> fri', L.stepWeekday('2026-08-24', -1), '2026-08-21');
    },
    function nearest_weekday() {
      eq('sat -> mon', L.nearestWeekday('2026-08-22'), '2026-08-24');
      eq('thu stays', L.nearestWeekday('2026-08-20'), '2026-08-20');
    },

    // --- frosne fag + setMark ---
    function subjectsForDate_template_then_frozen() {
      const s = L.defaultState();
      s.settings.timetable.thu = ['Norsk', 'Matte'];
      eq('template used', L.subjectsForDate(s, '2026-08-20'), ['Norsk', 'Matte']);
      s.days['2026-08-20'] = { subjects: ['Norsk', 'Matte'], marks: {} };
      s.settings.timetable.thu = ['Helt', 'Andre', 'Fag'];
      eq('frozen wins', L.subjectsForDate(s, '2026-08-20'), ['Norsk', 'Matte']);
    },
    function setMark_freezes_and_logs() {
      const s = L.defaultState();
      s.settings.timetable.thu = ['Norsk', 'Matte'];
      const s2 = L.setMark(s, { date: '2026-08-20', idx: 0, medal: 'gull', actor: 'son' }, { now: 'T', id: 'L1' });
      eq('day frozen on first mark', s2.days['2026-08-20'].subjects, ['Norsk', 'Matte']);
      eq('mark set', s2.days['2026-08-20'].marks['0'].medal, 'gull');
      eq('log entry', s2.log[0], {
        id: 'L1', at: 'T', actor: 'son', type: 'grade', day: '2026-08-20', subject: 'Norsk', from: null, to: 'gull',
      });
      eq('input untouched', s.days, {});
    },

    // --- utbetaling ---
    function addPayout_deducts_and_logs() {
      let s = L.defaultState();
      s.days['2026-08-20'] = lockedDay(['A'], { 0: 'gull' }); // 3 + oppmøte 1
      s = L.addPayout(s, { coins: 2, kr: 2, note: 'Godteri', by: 'parent' }, { now: 't', id: 'p1' });
      eq('payout stored', s.payouts[0], { id: 'p1', coins: 2, kr: 2, note: 'Godteri', at: 't', by: 'parent' });
      eq('balance after', L.computeBalance(s), 2); // 3 + 1 - 2
    },
    function formatKr_output() {
      eq('whole', L.formatKr(128, 1), '128 kr');
      eq('decimal', L.formatKr(5, 1.5), '7,50 kr');
    },

    // --- fletting ---
    function merge_days_lww_per_mark() {
      const a = L.defaultState();
      const b = L.defaultState();
      a.days['d1'] = { subjects: ['X'], marks: { 0: { medal: 'bronse', updatedAt: '2026-01-01' } } };
      b.days['d1'] = { subjects: ['X'], marks: { 0: { medal: 'gull', updatedAt: '2026-02-01' }, 1: { medal: 'solv', updatedAt: '2026-01-15' } } };
      const m = L.mergeState(a, b);
      eq('newer mark wins', m.days['d1'].marks['0'].medal, 'gull');
      eq('other mark kept', m.days['d1'].marks['1'].medal, 'solv');
    },
    function merge_locked_lww() {
      const a = L.defaultState();
      const b = L.defaultState();
      a.days['d1'] = { subjects: ['X'], marks: {}, locked: false, lockedAt: '2026-01-01' };
      b.days['d1'] = { subjects: ['X'], marks: {}, locked: true, lockedAt: '2026-02-01' };
      eq('nyere lås vinner', L.mergeState(a, b).days['d1'].locked, true);
      eq('rekkefølge-uavhengig', L.mergeState(b, a).days['d1'].locked, true);
    },
    function merge_weekLocks_lww() {
      const a = L.defaultState();
      const b = L.defaultState();
      a.weekLocks['2026-10-05'] = { closed: false, at: '2026-01-01' };
      b.weekLocks['2026-10-05'] = { closed: true, at: '2026-02-01' };
      eq('nyere ukelås vinner', L.mergeState(a, b).weekLocks['2026-10-05'].closed, true);
      eq('rekkefølge-uavhengig', L.mergeState(b, a).weekLocks['2026-10-05'].closed, true);
    },
    function merge_log_payouts_union_by_id() {
      const a = L.defaultState();
      const b = L.defaultState();
      a.log = [{ id: '1' }, { id: '2' }];
      b.log = [{ id: '2' }, { id: '3' }];
      eq('log union ids', L.mergeState(a, b).log.map((x) => x.id).sort(), ['1', '2', '3']);
    },
    function merge_settings_lww() {
      const a = L.defaultState();
      const b = L.defaultState();
      a.settings.krPerCoin = 1; a.settings.updatedAt = '2026-01-01';
      b.settings.krPerCoin = 2; b.settings.updatedAt = '2026-02-01';
      eq('newer settings wins', L.mergeState(a, b).settings.krPerCoin, 2);
    },
    function merge_handles_null_remote() {
      const a = L.defaultState();
      a.settings.krPerCoin = 5;
      eq('null remote -> local', L.mergeState(a, null).settings.krPerCoin, 5);
    },

    // --- streaks: klassifisering ---
    function classifyDay_states() {
      const s = L.defaultState();
      s.days['2026-08-20'] = { subjects: ['A', 'B'], marks: { 0: { medal: 'bronse' }, 1: { medal: 'gull' } } };
      eq('alle >= bronse -> present', L.classifyDay(s, '2026-08-20'), 'present');
      s.days['2026-08-21'] = { subjects: ['A'], marks: { 0: { medal: '0' } } };
      eq('0/fravaer -> broken', L.classifyDay(s, '2026-08-21'), 'broken');
      s.days['2026-08-24'] = { subjects: ['A', 'B'], marks: { 0: { medal: 'gull' } } };
      eq('blank time -> paused', L.classifyDay(s, '2026-08-24'), 'paused');
    },

    // --- streaks: opptrapping ---
    function attendanceBonusForPosition_ladder() {
      eq('pos1', L.attendanceBonusForPosition(1), 1);
      eq('pos10', L.attendanceBonusForPosition(10), 1);
      eq('pos11', L.attendanceBonusForPosition(11), 2);
      const ladder = [{ from: 1, pts: 1 }, { from: 11, pts: 2 }, { from: 21, pts: 3 }];
      eq('pos21 custom', L.attendanceBonusForPosition(21, ladder), 3);
    },
    function streak_escalation_two_tiers() {
      const s = L.defaultState();
      let d = '2026-08-03'; // mandag
      for (let i = 0; i < 12; i++) {
        s.days[d] = lockedDay(['A'], { 0: 'bronse' });
        d = L.stepWeekday(d, 1);
      }
      const info = L.attendanceStreakInfo(s);
      eq('lengde 12', info.length, 12);
      eq('bonus/dag = +2 etter 10', info.bonusPerDay, 2);
      eq('bonusTotal 10*1 + 2*2', info.bonusTotal, 14);
    },
    function streak_pause_keeps_break_resets() {
      const s = L.defaultState();
      s.days['2026-08-03'] = lockedDay(['A'], { 0: 'gull' }); // present
      s.days['2026-08-04'] = { subjects: ['A'], marks: {}, sick: true, locked: true, lockedAt: 't' }; // paused
      s.days['2026-08-05'] = lockedDay(['A'], { 0: 'bronse' }); // present
      eq('pause bryter ikke', L.attendanceStreakInfo(s).length, 2);
      s.days['2026-08-06'] = lockedDay(['A'], { 0: '0' }); // broken
      eq('brudd nullstiller', L.attendanceStreakInfo(s).length, 0);
      s.days['2026-08-07'] = lockedDay(['A'], { 0: 'solv' }); // present
      eq('bygger opp igjen', L.attendanceStreakInfo(s).length, 1);
    },
    function unlocked_gap_breaks_attendance() {
      const s = L.defaultState();
      s.days['2026-08-03'] = lockedDay(['A'], { 0: 'gull' });
      s.days['2026-08-04'] = { subjects: ['A'], marks: { 0: { medal: 'gull' } } }; // ULÅST hull
      s.days['2026-08-05'] = lockedDay(['A'], { 0: 'gull' });
      eq('hull bryter oppmøte', L.attendanceStreakInfo(s).length, 1);
    },

    // --- totaler ---
    function totals_day_and_week() {
      const s = L.defaultState();
      s.days['2026-08-03'] = lockedDay(['A'], { 0: 'gull' }); // 3 + bonus 1
      s.days['2026-08-04'] = lockedDay(['A'], { 0: 'bronse' }); // 1 + bonus 1
      eq('dagstotal man', L.dailyTotal(s, '2026-08-03'), 4);
      eq('dagstotal tir', L.dailyTotal(s, '2026-08-04'), 2);
      eq('ukestotal', L.weeklyTotal(s, '2026-08-05'), 6);
    },

    // --- ukelås (dato) ---
    function week_start_and_lock() {
      eq('weekStart tor', L.weekStartIso('2026-08-20'), '2026-08-17');
      eq('weekStart man', L.weekStartIso('2026-08-24'), '2026-08-24');
      ok('forrige uke laast', L.isWeekLocked('2026-08-20', '2026-08-24') === true);
      ok('samme uke ikke laast', L.isWeekLocked('2026-08-24', '2026-08-26') === false);
    },

    // --- syk-mutasjon ---
    function setSick_toggles_and_logs() {
      const s = L.defaultState();
      s.settings.timetable.mon = ['A'];
      const s2 = L.setSick(s, { date: '2026-08-03', sick: true, actor: 'son' }, { now: 't1', id: 'k1' });
      eq('sick satt', s2.days['2026-08-03'].sick, true);
      eq('sickAt', s2.days['2026-08-03'].sickAt, 't1');
      const s3 = L.setSick(s2, { date: '2026-08-03', sick: false, actor: 'parent' }, { now: 't2', id: 'k2' });
      eq('sick fjernet', 'sick' in s3.days['2026-08-03'], false);
    },
    function merge_sick_lww() {
      const a = L.defaultState();
      const b = L.defaultState();
      a.days['d1'] = { subjects: ['X'], marks: {}, sick: true, sickAt: '2026-01-01' };
      b.days['d1'] = { subjects: ['X'], marks: {}, sickAt: '2026-02-01' };
      eq('nyere fjerning vinner', 'sick' in L.mergeState(a, b).days['d1'], false);
    },

    // --- ukesdager ---
    function weekdaysOf_returns_mon_to_fri() {
      eq('fra torsdag', L.weekdaysOf('2026-08-20'), ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21']);
    },

    // --- re-synk av fag ---
    function daySubjectsMatchTimetable_detects_drift() {
      const s = L.defaultState();
      s.settings.timetable.mon = ['A', 'B', 'C'];
      ok('ikke frosset -> match', L.daySubjectsMatchTimetable(s, '2026-08-24') === true);
      s.days['2026-08-24'] = { subjects: ['A'], marks: { 0: { medal: 'gull' } } };
      ok('frosset og ulik -> ingen match', L.daySubjectsMatchTimetable(s, '2026-08-24') === false);
    },
    function resyncSubjects_reorder_moves_mark_by_name() {
      const s = L.defaultState();
      s.settings.timetable.mon = ['Matte', 'Testfag'];
      s.days['2026-08-24'] = { subjects: ['Testfag'], marks: { 0: { medal: 'solv', updatedAt: 't0' } } };
      const s2 = L.resyncSubjects(s, { date: '2026-08-24', actor: 'parent' }, { now: 't1', id: 'r2' });
      eq('medalje flyttet til ny indeks', s2.days['2026-08-24'].marks['1'].medal, 'solv');
      eq('ingen medalje på 0', s2.days['2026-08-24'].marks['0'], undefined);
    },
    function resyncSubjects_drops_removed_subject() {
      const s = L.defaultState();
      s.settings.timetable.mon = ['Matte'];
      s.days['2026-08-24'] = { subjects: ['Gammelt', 'Matte'], marks: { 0: { medal: 'gull', updatedAt: 't0' }, 1: { medal: 'bronse', updatedAt: 't0' } } };
      const s2 = L.resyncSubjects(s, { date: '2026-08-24', actor: 'parent' }, { now: 't1', id: 'r3' });
      eq('kun Matte igjen', s2.days['2026-08-24'].subjects, ['Matte']);
      eq('bronse flyttet til 0', s2.days['2026-08-24'].marks['0'].medal, 'bronse');
      eq('dropped talt', s2.log[0].dropped, 1);
    },

    function logic_module_loads() {
      ok('logic module loads', L.APP_LOGIC_VERSION === 1);
    },
  ];

  for (const t of tests) {
    try {
      t();
    } catch (e) {
      results.push({ name: t.name + ' (threw)', pass: false, actual: String(e) });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  return { passed, total: results.length, results };
}
