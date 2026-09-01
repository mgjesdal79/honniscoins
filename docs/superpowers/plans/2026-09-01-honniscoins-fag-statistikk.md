# Fag-statistikk (forelder) – Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ny forelder-fane «📊 Statistikk» som viser fem beskrivende analyser av sønnens egen-vurderte innsats per fag (per fag, etter timenummer, ukedag×time-heatmap, utvikling over tid, medaljefordeling), med periode-velger.

**Architecture:** Ren aggregeringslogikk i `js/logic.js` (DOM-/nett-fri, enhetstestet i `test/suite.js`). All aggregering bygger på én avledet liste `effortRecords(state)`; de fem `stat*`-funksjonene tar denne records-lista (etter periode-filtrering) og returnerer ferdige tall. `js/app.js` rendrer fanen som inline-SVG bygget fra aggregatene (strengbasert, som resten av app.js). Ingen nye state-felt, ingen migrering, ingen fletting-endringer.

**Tech Stack:** Vanilla ES-moduler, ingen build. Tester kjøres med `jsc`. Diagrammer er håndlaget inline-SVG. Farger følger dataviz-paletten (se `mockups/fag-statistikk.html`).

**Spec:** `docs/superpowers/specs/2026-09-01-honniscoins-fag-statistikk-design.md`
**Visuell referanse:** `mockups/fag-statistikk.html` (ferdig, falske data)

---

## Databetydnings-regler (gjelder ALLE oppgaver)

- Kun `days[date].locked === true` teller. Ulåste dager utelates.
- `sick`-dager hoppes over.
- Kun medalje ∈ {`bronse`,`solv`,`gull`} teller. `'0'` (fravær) og `null` (ikke vurdert) utelates fra ALT.
- Innsats-score er fast: `bronse=1, solv=2, gull=3` (uavhengig av `settings.medalValues`).
- Fag grupperes på `subject.trim().toLowerCase()`; vist etikett = hyppigste skrivemåte. Tomt fagnavn utelates.
- `position` = heltall fra `marks`-nøkkelen (1. time = 0).

## Filstruktur

- **`js/logic.js`** (modify): nye eksporter `EFFORT_SCORE`, `effortRecords`, `periodBounds`, `filterRecordsByPeriod`, `statBySubject`, `statByPosition`, `statHeatmap`, `statTrend`, `statMedalDistribution`. Legges etter homework-seksjonen, før `mergeState`-blokken er ikke nødvendig – legg dem nederst i fila etter siste homework-funksjon.
- **`test/suite.js`** (modify): nye testfunksjoner i `tests`-arrayet.
- **`js/app.js`** (modify): importer stat-funksjonene; ny `App.statPeriod`; registrer `['stat','Statistikk']` i forelder-fanene; ny `renderStatistikkTab(host)` + SVG-byggere.
- **`index.html`** (modify): CSS for statistikk-layout (bred container, rutenett, periode-chips) + bump `APP_VERSION`.

---

## Task 1: `EFFORT_SCORE` + `effortRecords`

**Files:**
- Modify: `js/logic.js` (legg til nederst i fila)
- Test: `test/suite.js`

- [ ] **Step 1: Write the failing test**

Legg denne funksjonen inn i `tests`-arrayet i `test/suite.js` (f.eks. rett før den avsluttende `];` som lukker arrayet):

```js
function effortRecords_filters_and_maps() {
  const s = L.defaultState();
  // låst, present: 1. time Matte gull, 2. time Norsk bronse
  s.days['2026-09-01'] = { subjects: ['Matte', 'Norsk'], marks: { 0: { medal: 'gull' }, 1: { medal: 'bronse' } }, locked: true, lockedAt: 't' };
  // ulåst -> skal ignoreres helt
  s.days['2026-09-02'] = { subjects: ['Matte'], marks: { 0: { medal: 'gull' } } };
  // låst men fravær/ikke-vurdert -> ingen records
  s.days['2026-09-03'] = { subjects: ['Matte', 'Gym'], marks: { 0: { medal: '0' }, 1: { medal: null } }, locked: true, lockedAt: 't' };
  // låst, sick -> hoppes over
  s.days['2026-09-04'] = { subjects: ['Matte'], marks: { 0: { medal: 'gull' } }, locked: true, lockedAt: 't', sick: true };
  const recs = L.effortRecords(s).sort((a, b) => a.position - b.position);
  eq('antall records', recs.length, 2);
  eq('rec0', recs[0], { date: '2026-09-01', weekday: 'tue', position: 0, subjectKey: 'matte', subjectLabel: 'Matte', medal: 'gull', score: 3 });
  eq('rec1 score', recs[1].score, 1);
  eq('EFFORT_SCORE', L.EFFORT_SCORE, { bronse: 1, solv: 2, gull: 3 });
}
```

(2026-09-01 er en tirsdag → `weekday: 'tue'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL – `L.effortRecords is not a function` (eller lignende).

- [ ] **Step 3: Write minimal implementation**

Legg til nederst i `js/logic.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS (alle tester grønne, inkl. `effortRecords_filters_and_maps`).

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(stat): effortRecords + EFFORT_SCORE for fag-statistikk"
```

---

## Task 2: Periode-filtrering (`periodBounds` + `filterRecordsByPeriod`)

**Files:**
- Modify: `js/logic.js`
- Test: `test/suite.js`

- [ ] **Step 1: Write the failing test**

Legg til i `tests`-arrayet:

```js
function periodFiltering() {
  eq('all -> åpen', L.periodBounds('all', '2026-09-15'), { from: null, to: null });
  eq('month -> fra 01', L.periodBounds('month', '2026-09-15'), { from: '2026-09-01', to: '2026-09-15' });
  eq('d90 -> 90 dager', L.periodBounds('d90', '2026-09-15'), { from: '2026-06-18', to: '2026-09-15' });
  const recs = [{ date: '2026-06-01' }, { date: '2026-09-10' }, { date: '2026-09-20' }];
  eq('filter month', L.filterRecordsByPeriod(recs, { from: '2026-09-01', to: '2026-09-15' }).map((r) => r.date), ['2026-09-10']);
  eq('filter all', L.filterRecordsByPeriod(recs, { from: null, to: null }).length, 3);
}
```

(90 dager tilbake fra 2026-09-15 inklusiv = 2026-06-18.)

- [ ] **Step 2: Run test to verify it fails**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL – `L.periodBounds is not a function`.

- [ ] **Step 3: Write minimal implementation**

Legg til i `js/logic.js` (rett etter `effortRecords`; bruker den modul-private `parseIso`/`isoDate`):

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(stat): periodBounds + filterRecordsByPeriod"
```

---

## Task 3: `statBySubject`

**Files:**
- Modify: `js/logic.js`
- Test: `test/suite.js`

- [ ] **Step 1: Write the failing test**

```js
function statBySubject_basics() {
  const recs = [
    { subjectKey: 'matte', subjectLabel: 'Matte', score: 1 },
    { subjectKey: 'matte', subjectLabel: 'matte', score: 3 }, // ulik staving -> samme fag
    { subjectKey: 'norsk', subjectLabel: 'Norsk', score: 2 },
  ];
  const r = L.statBySubject(recs);
  eq('overall snitt', r.overallAvg, 2); // (1+3+2)/3
  eq('overall n', r.n, 3);
  // sortert synkende på snitt: Matte (2) før Norsk (2)? like -> stabil på n desc
  eq('antall fag', r.subjects.length, 2);
  const matte = r.subjects.find((x) => x.subjectKey === 'matte');
  eq('matte snitt', matte.avg, 2);
  eq('matte n', matte.n, 2);
  eq('matte label = hyppigste', matte.subjectLabel, 'Matte');
  eq('tom input', L.statBySubject([]), { subjects: [], overallAvg: 0, n: 0 });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL – `L.statBySubject is not a function`.

- [ ] **Step 3: Write minimal implementation**

Legg til i `js/logic.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(stat): statBySubject (snitt per fag + totalsnitt)"
```

---

## Task 4: `statByPosition`

**Files:**
- Modify: `js/logic.js`
- Test: `test/suite.js`

- [ ] **Step 1: Write the failing test**

```js
function statByPosition_basics() {
  const recs = [
    { position: 0, score: 3 }, { position: 0, score: 1 },
    { position: 2, score: 2 },
  ];
  const r = L.statByPosition(recs);
  eq('antall posisjoner', r.length, 2);
  eq('pos0', r[0], { position: 0, avg: 2, n: 2 });
  eq('pos2', r[1], { position: 2, avg: 2, n: 1 });
  eq('tom', L.statByPosition([]), []);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL – `L.statByPosition is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(stat): statByPosition (snitt per timenummer)"
```

---

## Task 5: `statHeatmap`

**Files:**
- Modify: `js/logic.js`
- Test: `test/suite.js`

- [ ] **Step 1: Write the failing test**

```js
function statHeatmap_basics() {
  const recs = [
    { weekday: 'mon', position: 0, score: 3 },
    { weekday: 'mon', position: 0, score: 1 }, // snitt 2
    { weekday: 'fri', position: 1, score: 1 },
  ];
  const r = L.statHeatmap(recs);
  eq('positions', r.positions, [0, 1]);
  eq('weekdays', r.weekdays, ['mon', 'tue', 'wed', 'thu', 'fri']);
  eq('mon x pos0', r.cell.mon[0], { avg: 2, n: 2 });
  eq('mon x pos1 tom', r.cell.mon[1], null);
  eq('fri x pos1', r.cell.fri[1], { avg: 1, n: 1 });
  eq('tom', L.statHeatmap([]), { positions: [], weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], cell: { mon: {}, tue: {}, wed: {}, thu: {}, fri: {} } });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL – `L.statHeatmap is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(stat): statHeatmap (ukedag x timenummer)"
```

---

## Task 6: `statTrend`

**Files:**
- Modify: `js/logic.js`
- Test: `test/suite.js`

- [ ] **Step 1: Write the failing test**

```js
function statTrend_basics() {
  const recs = [
    { date: '2026-08-10', subjectKey: 'matte', subjectLabel: 'Matte', score: 1 },
    { date: '2026-08-20', subjectKey: 'matte', subjectLabel: 'Matte', score: 3 }, // aug snitt Matte=2, total=2
    { date: '2026-09-01', subjectKey: 'matte', subjectLabel: 'Matte', score: 2 },
    { date: '2026-09-01', subjectKey: 'norsk', subjectLabel: 'Norsk', score: 2 }, // sep total=2
  ];
  const r = L.statTrend(recs, ['matte']);
  eq('måneder', r.months, ['2026-08', '2026-09']);
  const total = r.series.find((s) => s.key === '__total__');
  eq('total label', total.label, 'Totalt');
  eq('total verdier', total.values, [2, 2]);
  const matte = r.series.find((s) => s.key === 'matte');
  eq('matte label', matte.label, 'Matte');
  eq('matte verdier', matte.values, [2, 2]);
  eq('tom', L.statTrend([], []), { months: [], series: [] });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL – `L.statTrend is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// focusKeys = liste med subjectKey som skal få egen linje (i tillegg til totalt).
// Hvis utelatt: de to fagene med flest records.
export function statTrend(records, focusKeys) {
  const recs = records || [];
  if (!recs.length) return { months: [], series: [] };
  if (!focusKeys) {
    const by = statBySubject(recs).subjects; // sortert avg desc, tie n desc
    focusKeys = by.slice().sort((a, b) => b.n - a.n).slice(0, 2).map((x) => x.subjectKey);
  }
  const months = [...new Set(recs.map((r) => r.date.slice(0, 7)))].sort();
  const labelFor = {};
  for (const r of recs) if (!labelFor[r.subjectKey]) labelFor[r.subjectKey] = r.subjectLabel;

  const avgFor = (pred) => {
    const map = {}; // month -> {sum,n}
    for (const r of recs) {
      if (!pred(r)) continue;
      const m = r.date.slice(0, 7);
      const e = (map[m] = map[m] || { sum: 0, n: 0 });
      e.sum += r.score; e.n += 1;
    }
    return months.map((m) => (map[m] ? map[m].sum / map[m].n : null));
  };

  const series = [{ key: '__total__', label: 'Totalt', values: avgFor(() => true) }];
  for (const key of focusKeys) {
    series.push({ key, label: labelFor[key] || key, values: avgFor((r) => r.subjectKey === key) });
  }
  return { months, series };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(stat): statTrend (månedlig snitt, totalt + fokus-fag)"
```

---

## Task 7: `statMedalDistribution`

**Files:**
- Modify: `js/logic.js`
- Test: `test/suite.js`

- [ ] **Step 1: Write the failing test**

```js
function statMedalDistribution_basics() {
  const recs = [
    { subjectKey: 'matte', subjectLabel: 'Matte', medal: 'gull', score: 3 },
    { subjectKey: 'matte', subjectLabel: 'Matte', medal: 'solv', score: 2 },
    { subjectKey: 'matte', subjectLabel: 'Matte', medal: 'bronse', score: 1 },
    { subjectKey: 'matte', subjectLabel: 'Matte', medal: 'gull', score: 3 },
  ];
  const r = L.statMedalDistribution(recs);
  eq('ett fag', r.length, 1);
  eq('n', r[0].n, 4);
  eq('gull andel', r[0].gull, 0.5);
  eq('solv andel', r[0].solv, 0.25);
  eq('bronse andel', r[0].bronse, 0.25);
  eq('label', r[0].subjectLabel, 'Matte');
  eq('tom', L.statMedalDistribution([]), []);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL – `L.statMedalDistribution is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// Andeler gull/solv/bronse per fag (fravær/null er allerede ute av records).
// Sortert som statBySubject (snitt synkende) for visuell konsistens med Visning 1.
export function statMedalDistribution(records) {
  const order = statBySubject(records).subjects.map((s) => s.subjectKey);
  const map = new Map(); // key -> { label:Map, gull, solv, bronse, n }
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(stat): statMedalDistribution (gull/solv/bronse-andeler)"
```

---

## Task 8: Registrer Statistikk-fanen + periode-state + skjelett

**Files:**
- Modify: `js/app.js` (import-blokk 2–14; `App`-objekt ~19–31; `renderParentHome` ~627–664)
- Verifiser: `jsc -m js/app.js` (parse-sjekk)

- [ ] **Step 1: Utvid import fra logic.js**

I `js/app.js`, legg til stat-funksjonene i import-blokken (linje 2–14). Legg til en ny linje før den avsluttende `} from './logic.js';`:

```js
  effortRecords, periodBounds, filterRecordsByPeriod,
  statBySubject, statByPosition, statHeatmap, statTrend, statMedalDistribution,
```

- [ ] **Step 2: Legg til periode-state i `App`**

I `App`-objektet (rett etter `parentTab: 'uke',`), legg til:

```js
  statPeriod: 'all', // 'all' | 'month' | 'd90' – Statistikk-fanen
```

- [ ] **Step 3: Registrer fanen og rut til den**

I `renderParentHome`, utvid `tabs`-arrayet med Statistikk etter Logg:

```js
  const tabs = [
    ['uke', 'Uke'],
    ['dag', 'Dag'],
    ['timeplan', 'Timeplan'],
    ['quests', 'Quests'],
    ['poeng', 'Poeng'],
    ['logg', 'Logg'],
    ['stat', 'Statistikk'],
  ];
```

Og legg til rutingen sammen med de andre `if (App.parentTab === ...)`-linjene:

```js
  if (App.parentTab === 'stat') return renderStatistikkTab(host);
```

- [ ] **Step 4: Legg til skjelett `renderStatistikkTab` med periode-velger + tomtilstand**

Legg til denne funksjonen i `js/app.js` (f.eks. rett etter `renderLoggTab`, før `routeToView`):

```js
function renderStatistikkTab(host) {
  const today = isoDate(new Date());
  const bounds = periodBounds(App.statPeriod, today);
  const recs = filterRecordsByPeriod(effortRecords(App.state), bounds);

  const periods = [['month', 'Denne måneden'], ['d90', 'Siste 90 dager'], ['all', 'Alt']];
  const chips = periods
    .map(([k, l]) => `<button class="statchip ${App.statPeriod === k ? 'on' : ''}" data-p="${k}">${l}</button>`)
    .join('');

  if (!recs.length) {
    host.innerHTML = `
      <div class="statperiod">${chips}</div>
      <div class="card statempty">📊 Ingen data ennå for valgt periode.<br>
        <span class="muted">Lås noen dager med medaljer først – kun låste dager teller.</span></div>`;
    bindStatChips(host);
    return;
  }

  const bySub = statBySubject(recs);
  const byPos = statByPosition(recs);
  const heat = statHeatmap(recs);
  const trend = statTrend(recs);
  const dist = statMedalDistribution(recs);

  host.innerHTML = `
    <div class="statperiod">${chips}</div>
    <div class="statgrid">
      ${statCard('Innsats per fag', 'Snitt-medalje per fag (🥇3 🥈2 🥉1)', svgBySubject(bySub))}
      ${statCard('Innsats etter når på dagen', 'Snitt per timenummer', svgByPosition(byPos))}
      ${statCard('Ukedag × time', 'Snitt per ukedag og timenummer', svgHeatmap(heat), true)}
      ${statCard('Utvikling over tid', 'Månedlig snitt: totalt + mest brukte fag', svgTrend(trend), true)}
      ${statCard('Medaljefordeling per fag', 'Andel gull/sølv/bronse', svgDistribution(dist))}
    </div>`;
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
```

- [ ] **Step 5: Midlertidige stub-SVG-byggere (så parse går før Task 9)**

Legg til rett under `renderStatistikkTab` (erstattes med ekte i Task 9):

```js
function svgBySubject() { return ''; }
function svgByPosition() { return ''; }
function svgHeatmap() { return ''; }
function svgTrend() { return ''; }
function svgDistribution() { return ''; }
```

- [ ] **Step 6: Parse-sjekk**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: Can't find variable: document` (= syntaks OK). Hvis `SyntaxError` → fiks.

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "feat(stat): registrer Statistikk-fane + periode-velger + tomtilstand"
```

---

## Task 9: SVG-byggere for de fem visningene

**Files:**
- Modify: `js/app.js` (erstatt stubbene fra Task 8)
- Verifiser: `jsc -m js/app.js` + manuell nettleser-sjekk

Alle byggere returnerer en SVG-streng. Farger hentes fra CSS-variabler definert i Task 10 (`var(--...)`), så lys/mørk følger appen. `escapeHtml(s)` finnes allerede i app.js (linje 44) for tekst-escaping – bruk den på fagnavn.

- [ ] **Step 1: Erstatt stubbene med ekte byggere**

Erstatt de fem stub-funksjonene fra Task 8 Step 5 med:

```js
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
```

- [ ] **Step 2: Bekreft at `escapeHtml` finnes**

Run: `grep -n "function escapeHtml" js/app.js`
Expected: én treff (linje 44). Den brukes til fagnavn-escaping i byggerne. (Ingen ny hjelper trengs.)

- [ ] **Step 3: Parse-sjekk**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: Can't find variable: document` (= syntaks OK).

- [ ] **Step 4: Full test-kjøring (logikk uendret, skal fortsatt være grønn)**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: alle tester PASS.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat(stat): SVG-byggere for de fem statistikk-visningene"
```

---

## Task 10: CSS + APP_VERSION

**Files:**
- Modify: `index.html` (CSS-blokk; `APP_VERSION` ~176)

- [ ] **Step 1: Legg til statistikk-CSS**

Legg til i `<style>`-blokken i `index.html` (etter `.tabbar`-reglene, ca. linje 57–127). Fargevariablene gjenbruker der det finnes app-vars, og definerer stat-spesifikke:

```css
  /* Statistikk (forelder, laptop-orientert) */
  #ptab .statperiod{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 12px}
  .statchip{font:600 .8rem var(--font);border:1px solid #10233f;background:transparent;color:var(--muted);border-radius:999px;padding:6px 14px;cursor:pointer}
  .statchip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
  .statgrid{display:grid;grid-template-columns:1fr;gap:16px}
  @media (min-width:820px){
    .statgrid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .statgrid .span2{grid-column:1 / -1}
  }
  .statc{padding:14px 16px}
  .stath{font-weight:700;font-size:.95rem}
  .stats{font-size:.74rem;margin-bottom:8px}
  .statempty{padding:26px 16px;text-align:center;line-height:1.5}
  .statsvg{display:block;width:100%;height:auto;overflow:visible}
  .statsvg .axl{fill:var(--muted);font-size:11px}
  .statsvg .axv{fill:var(--text);font-size:12px;font-weight:600}
  .statsvg .axn{fill:var(--muted);font-size:10px}
  .statsvg .axc{font-size:11px;font-weight:600}
  .statsvg .axs{font-size:12px;font-weight:600}
  .statsvg text{font-family:var(--font)}
  /* dataviz-farger */
  .statgrid{--s1:#2a78d6;--s2:#eb6834;--good:#0ca30c;--bad:#d03b3b;
    --grid:#10233f;--ink:#f4f7fb;--ink2:#9fb2c9;--null:#0d1b30;
    --gull:#eda100;--solv:#9aa0a6;--bronse:#b0703c;
    --seq1:#123252;--seq2:#184f95;--seq3:#256abf;--seq4:#3987e5;--seq5:#86b6ef}
```

Merk: appen har mørk bakgrunn, så `--ink/--ink2/--null/--grid`-verdiene over er valgt for mørk flate. Juster om nødvendig etter visuell sjekk (Task 11).

- [ ] **Step 2: Bump APP_VERSION**

Endre linje ~176:

```js
    window.APP_VERSION = '2026.09.01 (b20 · fag-statistikk)';
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(stat): CSS for statistikk-layout + bump APP_VERSION b20"
```

---

## Task 11: Verifisering (test + manuell)

**Files:** ingen (verifisering)

- [ ] **Step 1: Full logikk-test**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: alle tester PASS (nå ~202+ tester).

- [ ] **Step 2: Parse-sjekk app.js**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: Can't find variable: document`.

- [ ] **Step 3: Manuell nettleser-sjekk (laptop)**

Åpne appen lokalt (localStorage-modus, tom URL-hash), logg inn som forelder, seed noen låste dager med medaljer via konsollen om nødvendig:

```js
// i devtools-konsoll, localStorage-modus:
App.state.days['2026-08-25'] = { subjects:['Matte','Norsk','Gym'], marks:{0:{medal:'bronse'},1:{medal:'solv'},2:{medal:'gull'}}, locked:true, lockedAt:'t' };
routeToView();
```

Sjekk i «📊 Statistikk»-fanen:
- Periode-chips bytter (Denne måneden / Siste 90 dager / Alt) og re-rendrer.
- Alle fem visningene tegnes uten overlapp; heatmap + trend i full bredde på laptop.
- Tomtilstand vises når periode ikke har data.
- Ingen fravær/0 synlig noe sted.

- [ ] **Step 4: Sluttcommit (kun hvis justeringer gjort i Step 3)**

```bash
git add -p
git commit -m "fix(stat): visuelle justeringer etter nettleser-sjekk"
```

---

## Deploy (etter godkjenning – følg CLAUDE.md miljøregler)

Jobb på branch (allerede `docs/fag-statistikk-spec` eller ny feature-branch), stage konkrete filer (aldri `-A`), push, `gh pr create --base main`, merge, `git switch main && git pull --ff-only`. Verifiser GitHub Pages med cache-buster på `index.html`, `js/app.js`, `js/logic.js`.

---

## Self-review-notat (utført)

- **Spec-dekning:** Fane forelder-only (Task 8) ✓; effortRecords + regler (Task 1) ✓; kun låste/ikke-syke (Task 1) ✓; fravær/null helt ute (Task 1, 7) ✓; fast 1/2/3-skala (Task 1) ✓; fag-normalisering + hyppigste etikett (Task 3, 7) ✓; periode-velger i v1 (Task 2, 8, 10) ✓; alle fem visninger (Task 3–7 logikk, Task 9 SVG) ✓; laptop-rutenett (Task 10) ✓; tomtilstand (Task 8) ✓; `n` synlig (Task 9) ✓; tester (Task 1–7) ✓.
- **Ingen oppmøte/fravær-måling** (bevisst ikke-mål) – ivaretatt ved at `'0'` aldri inngår.
- **Type-konsistens:** `subjectKey`/`subjectLabel`/`avg`/`n`/`position`/`score`/`cell`/`positions`/`weekdays`/`months`/`series.values` brukt likt på tvers av logikk- og render-oppgaver.
