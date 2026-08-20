import * as L from '../js/logic.js';

const results = [];
function eq(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected });
}
function ok(name, cond) {
  results.push({ name, pass: !!cond });
}

function run(tests) {
  results.length = 0;
  for (const t of tests) {
    try {
      t();
    } catch (e) {
      results.push({ name: t.name + ' (threw)', pass: false, actual: String(e) });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  const root = document.getElementById('out');
  root.innerHTML =
    `<h2>${passed}/${results.length} PASS</h2>` +
    results
      .map(
        (r) =>
          `<div class="${r.pass ? 'p' : 'f'}">${r.pass ? '✅' : '❌'} ${r.name}` +
          (r.pass
            ? ''
            : `<pre>actual:   ${JSON.stringify(r.actual)}\nexpected: ${JSON.stringify(r.expected)}</pre>`) +
          `</div>`
      )
      .join('');
  results.forEach((r) => console.log((r.pass ? 'PASS' : 'FAIL') + ' — ' + r.name));
  document.title = `${passed}/${results.length} — Honniscoins tests`;
}

run([
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
    eq('schemaVersion', s.settings.schemaVersion, 1);
    eq('krPerCoin', s.settings.krPerCoin, 1);
    eq('medalValues', s.settings.medalValues, { bronse: 1, solv: 2, gull: 3 });
    eq('timetable keys', Object.keys(s.settings.timetable), ['mon', 'tue', 'wed', 'thu', 'fri']);
    eq('days empty', s.days, {});
    eq('payouts empty', s.payouts, []);
    eq('log empty', s.log, []);
  },
  function balance_earned_minus_spent() {
    const s = L.defaultState();
    s.days['2026-08-20'] = { subjects: ['A', 'B'], marks: { 0: { medal: 'gull' }, 1: { medal: 'bronse' } } };
    s.days['2026-08-21'] = { subjects: ['A'], marks: { 0: { medal: '0' } } }; // fravaer = 0
    s.payouts.push({ id: 'p1', coins: 1 });
    eq('earned', L.computeEarned(s), 4); // 3 + 1 + 0
    eq('spent', L.computeSpent(s), 1);
    eq('balance', L.computeBalance(s), 3);
  },

  // --- dato / ukedag ---
  function iso_and_weekday() {
    eq('isoDate', L.isoDate(new Date(2026, 7, 20)), '2026-08-20'); // 20. aug 2026 (torsdag)
    eq('weekday thu', L.weekdayKey('2026-08-20'), 'thu');
    eq('weekday sat -> null', L.weekdayKey('2026-08-22'), null);
    eq('weekday sun -> null', L.weekdayKey('2026-08-23'), null);
    eq('weekday mon', L.weekdayKey('2026-08-24'), 'mon');
  },
  function step_skips_weekend() {
    eq('fri +1 -> mon', L.stepWeekday('2026-08-21', 1), '2026-08-24');
    eq('mon -1 -> fri', L.stepWeekday('2026-08-24', -1), '2026-08-21');
    eq('thu +1 -> fri', L.stepWeekday('2026-08-20', 1), '2026-08-21');
  },
  function nearest_weekday() {
    eq('sat -> mon', L.nearestWeekday('2026-08-22'), '2026-08-24');
    eq('sun -> mon', L.nearestWeekday('2026-08-23'), '2026-08-24');
    eq('thu stays', L.nearestWeekday('2026-08-20'), '2026-08-20');
  },

  // --- frosne fag + setMark ---
  function subjectsForDate_template_then_frozen() {
    const s = L.defaultState();
    s.settings.timetable.thu = ['Norsk', 'Matte'];
    eq('template used', L.subjectsForDate(s, '2026-08-20'), ['Norsk', 'Matte']);
    eq('weekend empty', L.subjectsForDate(s, '2026-08-22'), []);
    s.days['2026-08-20'] = { subjects: ['Norsk', 'Matte'], marks: {} };
    s.settings.timetable.thu = ['Helt', 'Andre', 'Fag'];
    eq('frozen wins', L.subjectsForDate(s, '2026-08-20'), ['Norsk', 'Matte']);
  },
  function setMark_freezes_and_logs() {
    const s = L.defaultState();
    s.settings.timetable.thu = ['Norsk', 'Matte'];
    const ctx = { now: '2026-08-20T10:00:00Z', id: 'L1' };
    const s2 = L.setMark(s, { date: '2026-08-20', idx: 0, medal: 'gull', actor: 'son' }, ctx);
    eq('day frozen on first mark', s2.days['2026-08-20'].subjects, ['Norsk', 'Matte']);
    eq('mark set', s2.days['2026-08-20'].marks['0'].medal, 'gull');
    eq('mark by', s2.days['2026-08-20'].marks['0'].by, 'son');
    eq('mark updatedAt', s2.days['2026-08-20'].marks['0'].updatedAt, '2026-08-20T10:00:00Z');
    eq('log length', s2.log.length, 1);
    eq('log entry', s2.log[0], {
      id: 'L1', at: '2026-08-20T10:00:00Z', actor: 'son', type: 'grade',
      day: '2026-08-20', subject: 'Norsk', from: null, to: 'gull',
    });
    eq('input untouched', s.days, {});
  },
  function setMark_second_change_records_from() {
    const s = L.defaultState();
    s.settings.timetable.thu = ['Norsk'];
    let st = L.setMark(s, { date: '2026-08-20', idx: 0, medal: 'solv', actor: 'son' }, { now: 't1', id: 'a' });
    st = L.setMark(st, { date: '2026-08-20', idx: 0, medal: 'gull', actor: 'parent' }, { now: 't2', id: 'b' });
    eq('from previous', st.log[1].from, 'solv');
    eq('to new', st.log[1].to, 'gull');
    eq('actor parent', st.log[1].actor, 'parent');
    eq('mark by parent', st.days['2026-08-20'].marks['0'].by, 'parent');
  },

  // --- utbetaling / innstillingslogg / kr ---
  function addPayout_deducts_and_logs() {
    let s = L.defaultState();
    s.days['2026-08-20'] = { subjects: ['A'], marks: { 0: { medal: 'gull' } } }; // 3 opptjent
    s = L.addPayout(s, { coins: 2, kr: 2, note: 'Godteri', by: 'parent' }, { now: 't', id: 'p1' });
    eq('payout stored', s.payouts[0], { id: 'p1', coins: 2, kr: 2, note: 'Godteri', at: 't', by: 'parent' });
    eq('balance after', L.computeBalance(s), 1);
    eq('log payout', s.log[0], { id: 'p1', at: 't', actor: 'parent', type: 'payout', coins: 2, note: 'Godteri' });
  },
  function logSettingsChange_entry() {
    let s = L.defaultState();
    s = L.logSettingsChange(s, { actor: 'parent', field: 'gull', from: 2, to: 3 }, { now: 't', id: 's1' });
    eq('settings log', s.log[0], { id: 's1', at: 't', actor: 'parent', type: 'settings', field: 'gull', from: 2, to: 3 });
  },
  function formatKr_output() {
    eq('whole', L.formatKr(128, 1), '128 kr');
    eq('half', L.formatKr(128, 0.5), '64 kr');
    eq('decimal', L.formatKr(5, 1.5), '7,50 kr');
  },

  // --- fletting ---
  function merge_days_lww_per_mark() {
    const a = L.defaultState();
    const b = L.defaultState();
    a.days['d1'] = { subjects: ['X'], marks: { 0: { medal: 'bronse', by: 'son', updatedAt: '2026-01-01' } } };
    b.days['d1'] = {
      subjects: ['X'],
      marks: {
        0: { medal: 'gull', by: 'son', updatedAt: '2026-02-01' },
        1: { medal: 'solv', by: 'son', updatedAt: '2026-01-15' },
      },
    };
    const m = L.mergeState(a, b);
    eq('newer mark wins', m.days['d1'].marks['0'].medal, 'gull');
    eq('other mark kept', m.days['d1'].marks['1'].medal, 'solv');
  },
  function merge_log_payouts_union_by_id() {
    const a = L.defaultState();
    const b = L.defaultState();
    a.log = [{ id: '1', type: 'grade' }, { id: '2', type: 'grade' }];
    b.log = [{ id: '2', type: 'grade' }, { id: '3', type: 'grade' }];
    a.payouts = [{ id: 'p1', coins: 1 }];
    b.payouts = [{ id: 'p1', coins: 1 }, { id: 'p2', coins: 2 }];
    const m = L.mergeState(a, b);
    eq('log union ids', m.log.map((x) => x.id).sort(), ['1', '2', '3']);
    eq('payout union ids', m.payouts.map((x) => x.id).sort(), ['p1', 'p2']);
  },
  function merge_settings_lww() {
    const a = L.defaultState();
    const b = L.defaultState();
    a.settings.krPerCoin = 1;
    a.settings.updatedAt = '2026-01-01';
    b.settings.krPerCoin = 2;
    b.settings.updatedAt = '2026-02-01';
    eq('newer settings wins', L.mergeState(a, b).settings.krPerCoin, 2);
    eq('order-independent', L.mergeState(b, a).settings.krPerCoin, 2);
  },
  function merge_handles_null_remote() {
    const a = L.defaultState();
    a.settings.krPerCoin = 5;
    eq('null remote -> local', L.mergeState(a, null).settings.krPerCoin, 5);
  },

  function logic_module_loads() {
    ok('logic module loads', L.APP_LOGIC_VERSION === 1);
  },
]);
