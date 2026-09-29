# Innsats-drevet fond + ferie-modus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La fondskursen vokse tydelig de ukene gutten tjener ferske innsats-poeng (medaljer på låste dager) med streak-forsterkning, kun krype ellers, og gå i nøytral markedsdrift i forelder-markerte ferieperioder.

**Architecture:** `navForDate` gjøres state-avhengig: kursen foldes fortsatt deterministisk dag for dag fra epoken, men hver dags avkastning = grunn-drift + (ukens innsats-løft × streak-faktor) + støy, eller nøytral drift på feriedager. Alt er rene funksjoner av flettet state + dato; hele NAV-serien bygges i ett sveip og memoiseres på en state-signatur. Guttens coins/saldo er urørt.

**Tech Stack:** Vanilla ES-moduler (ingen build). Ren logikk i `js/logic.js`, DOM/rendering i `js/app.js`, delt DOM-fri testsuite i `test/suite.js` kjørt med JavaScriptCore (`jsc`).

**Spec:** `docs/superpowers/specs/2026-09-29-honniscoins-fond-innsats-ferie-design.md`

---

## Filstruktur

- **`js/logic.js`** — all ny ren logikk: ferie-helper, uke-innsats/streak, ny `navForDate`, `fundWeekStatus`, `addVacation`/`removeVacation`, migrerings-defaults. Endrer eksisterende `foldFund`/`fundMarketValue`/`fundValue`.
- **`js/app.js`** — oppdaterte `navForDate`-kallsteder (ny signatur), medvinds-linje på guttens fond-kort, Settings-kontroller (grunn-drift, innsats-styrke, ferieperioder).
- **`test/suite.js`** — nye tester + oppdatering av eksisterende bank-tester til ny `navForDate`-signatur.
- **`index.html`** — `APP_VERSION`-bump + litt CSS for medvinds-linje og ferie-rader.

Testkommando (alltid): `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Parse-sjekk app.js: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js` → forventet `ReferenceError: document` (OK), ikke `SyntaxError`.

---

## Task 1: Ferie-datastruktur, migrerings-defaults og `isVacationDay`

**Files:**
- Modify: `js/logic.js` (migrate ~826-828, ny helper nær bank-koden ~280)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

Legg til denne test-funksjonen i `tests`-arrayen i `test/suite.js` (rett før den avsluttende `];` på linje ~1715, etter `bank_history_transactions`):

```javascript
    function bank_vacation_defaults_and_helper() {
      // migrate fyller nye fond-defaults uten å røre savingsWeeklyRate
      const m = L.migrate({ settings: {}, days: {}, log: [] }, '2026-09-29');
      eq('base default', m.settings.bank.fundBaseWeeklyRate, 0.006);
      eq('neutral default', m.settings.bank.fundNeutralWeeklyRate, 0.02);
      eq('effort mult default', m.settings.bank.fundEffortMult, 1);
      eq('vacations default', m.settings.bank.vacations, []);
      eq('savingsWeeklyRate urørt', m.settings.bank.savingsWeeklyRate, 0.02);
      // isVacationDay: inklusive begge ender
      const s = L.defaultState();
      s.settings.bank.vacations = [{ id: 'v1', from: '2026-10-05', to: '2026-10-09' }];
      ok('start-dag er ferie', L.isVacationDay(s, '2026-10-05'));
      ok('slutt-dag er ferie', L.isVacationDay(s, '2026-10-09'));
      ok('dag i midten er ferie', L.isVacationDay(s, '2026-10-07'));
      ok('dag før er ikke ferie', !L.isVacationDay(s, '2026-10-04'));
      ok('dag etter er ikke ferie', !L.isVacationDay(s, '2026-10-10'));
      ok('tom ferieliste = aldri ferie', !L.isVacationDay(L.defaultState(), '2026-10-07'));
    }
```

- [ ] **Step 2: Kjør testen og bekreft at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL — `bank_vacation_defaults_and_helper (threw)` med `L.isVacationDay is not a function` (og feil på nye defaults).

- [ ] **Step 3: Legg til `isVacationDay` i `js/logic.js`**

Sett inn rett etter `withdrawBank`-funksjonen (etter linje ~279, før `bankTransactions`):

```javascript
// En dato er "ferie" hvis den ligger i minst én forelder-markert periode (inklusive ender).
export function isVacationDay(state, iso) {
  const vs = (state.settings && state.settings.bank && state.settings.bank.vacations) || [];
  return vs.some((v) => v && v.from && v.to && iso >= v.from && iso <= v.to);
}
```

- [ ] **Step 4: Utvid `migrate` med nye bank-defaults**

I `js/logic.js`, finn blokken (linje ~826-828):

```javascript
  if (!s.bank || !Array.isArray(s.bank.ledger)) s.bank = { ledger: [] };
  if (!s.settings.bank) s.settings.bank = { savingsWeeklyRate: 0.02 };
  else if (s.settings.bank.savingsWeeklyRate == null) s.settings.bank.savingsWeeklyRate = 0.02;
```

Legg til rett etter den blokken:

```javascript
  const bk = s.settings.bank;
  if (bk.fundBaseWeeklyRate == null) bk.fundBaseWeeklyRate = BANK_FUND_BASE_WEEKLY;
  if (bk.fundNeutralWeeklyRate == null) bk.fundNeutralWeeklyRate = BANK_FUND_NEUTRAL_WEEKLY;
  if (bk.fundEffortMult == null) bk.fundEffortMult = 1;
  if (!Array.isArray(bk.vacations)) bk.vacations = [];
```

- [ ] **Step 5: Legg til konstantene (brukes her og i Task 2/3)**

I `js/logic.js`, finn eksisterende konstantblokk (linje ~120-124). Erstatt linjen `export const BANK_FUND_DRIFT = 0.0035; // ...` med de nye konstantene (behold `BANK_FUND_VOL`, `BANK_FUND_CAP`, `BANK_FUND_SEED`):

```javascript
export const BANK_FUND_BASE_WEEKLY = 0.006; // grunn-drift ~+0,6 %/uke (passiv kryp)
export const BANK_FUND_NEUTRAL_WEEKLY = 0.02; // ferie/nøytral ~+2 %/uke (vanlig børsuke)
export const BANK_FUND_EFFORT_PER_POINT = 0.0016; // ukebidrag per innsats-poeng
export const BANK_FUND_EFFORT_CAP = 0.04; // maks ukentlig innsats-løft (+4 %)
export const BANK_FUND_STREAK_STEP = 0.05; // forsterkning per streak-uke
export const BANK_FUND_STREAK_CAP = 10; // maks streak-uker som teller (×1,5)
```

(Selve `navForDate`-omskrivingen som bruker disse gjøres i Task 3 — foreløpig kompilerer koden, men gammel `navForDate` står igjen til Task 3.)

- [ ] **Step 6: Kjør testen og bekreft at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: `bank_vacation_defaults_and_helper` PASS. (Eksisterende `bank_defaultState`-test kan fortsatt passere; den sjekker kun `savingsWeeklyRate`.)

- [ ] **Step 7: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): ferie-datastruktur, fond-defaults og isVacationDay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Uke-innsats og ferie-bevisst streak

**Files:**
- Modify: `js/logic.js` (nye rene fn nær innsats/effort-koden ~1761)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

Legg til i `tests`-arrayen i `test/suite.js`:

```javascript
    function bank_week_effort_and_streak() {
      // Hjelper: lås en uke (man–fre) med gitt medalje på én fag-time per dag.
      const mkWeek = (s, monday, medal) => {
        for (const d of L.weekdaysOf(monday)) {
          s.days[d] = { locked: true, subjects: ['Matte'], marks: { '0': { medal } } };
        }
        return s;
      };
      // Én gull-uke: 5 dager × score 3 = 15
      let s = L.defaultState();
      mkWeek(s, '2026-09-07', 'gull'); // uke som starter man 07.09.2026
      eq('gull-uke innsats = 15', L.weekEffortScore(s, '2026-09-07'), 15);
      // sølv-uke lavere enn gull-uke
      let s2 = L.defaultState();
      mkWeek(s2, '2026-09-07', 'solv');
      ok('sølv < gull', L.weekEffortScore(s2, '2026-09-07') < L.weekEffortScore(s, '2026-09-07'));
      // feriedager teller ikke i innsats
      let s3 = L.defaultState();
      mkWeek(s3, '2026-09-07', 'gull');
      s3.settings.bank.vacations = [{ id: 'v', from: '2026-09-07', to: '2026-09-11' }];
      eq('hel ferieuke = 0 innsats', L.weekEffortScore(s3, '2026-09-07'), 0);
      // streak: tre gode uker på rad → streak 3 i siste uke
      let s4 = L.defaultState();
      mkWeek(s4, '2026-09-07', 'gull');
      mkWeek(s4, '2026-09-14', 'gull');
      mkWeek(s4, '2026-09-21', 'gull');
      eq('streak 3 uker', L.fundStreakWeeks(s4, '2026-09-21'), 3);
      // en tom (låst, kun fravær) uke i midten resetter streaken
      let s5 = L.defaultState();
      mkWeek(s5, '2026-09-07', 'gull');
      for (const d of L.weekdaysOf('2026-09-14')) s5.days[d] = { locked: true, subjects: ['Matte'], marks: { '0': { medal: '0' } } };
      mkWeek(s5, '2026-09-21', 'gull');
      eq('reset → streak 1 i siste uke', L.fundStreakWeeks(s5, '2026-09-21'), 1);
      // ferieuke i midten PAUSER (bryter ikke) streaken
      let s6 = L.defaultState();
      mkWeek(s6, '2026-09-07', 'gull');
      mkWeek(s6, '2026-09-21', 'gull');
      s6.settings.bank.vacations = [{ id: 'v', from: '2026-09-14', to: '2026-09-18' }];
      eq('ferie pauser → streak 2', L.fundStreakWeeks(s6, '2026-09-21'), 2);
    }
```

- [ ] **Step 2: Kjør testen og bekreft at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL — `L.weekEffortScore is not a function`.

- [ ] **Step 3: Implementer `weekEffortScore` og `fundStreakWeeks`**

I `js/logic.js`, sett inn rett etter `effortRecords`-funksjonen (etter linje ~1761):

```javascript
// Sum av innsats-score (🥇3/🥈2/🥉1) på låste, ikke-syke, IKKE-ferie dager i uka som `ws` ligger i.
export function weekEffortScore(state, ws) {
  const start = weekStartIso(ws);
  let sum = 0;
  for (const r of effortRecords(state)) {
    if (weekStartIso(r.date) !== start) continue;
    if (isVacationDay(state, r.date)) continue;
    sum += r.score;
  }
  return sum;
}

// Antall sammenhengende gode uker t.o.m. uka `ws` (inklusive). Regel per uke, kronologisk fra
// første uke med låst skoledag: hel-ferieuke PAUSER (teller ikke, resetter ikke); uke med
// innsats > 0 øker; annen uke (låst men 0 innsats, eller gap) resetter til 0.
export function fundStreakWeeks(state, ws) {
  const target = weekStartIso(ws);
  const locked = Object.keys(state.days || {})
    .filter((d) => weekdayKey(d) && state.days[d].locked)
    .sort();
  if (!locked.length) return 0;
  let w = weekStartIso(locked[0]);
  let run = 0;
  let guard = 0;
  while (w <= target && guard < 1000) {
    const vacWeek = weekdaysOf(w).every((d) => isVacationDay(state, d));
    if (vacWeek) {
      // pause: la run stå
    } else if (weekEffortScore(state, w) > 0) {
      run += 1;
    } else {
      run = 0;
    }
    if (w === target) return run;
    w = addDaysIso(w, 7);
    guard++;
  }
  return run;
}
```

- [ ] **Step 4: Kjør testen og bekreft at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: `bank_week_effort_and_streak` PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): uke-innsats-score og ferie-bevisst streak

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: State-drevet `navForDate` (innsats + streak + ferie)

**Files:**
- Modify: `js/logic.js` (fjern gammel `navForDate`/`navCache`; ny serie-bygger; oppdater `foldFund`/`fundMarketValue`/`fundValue`)
- Test: `test/suite.js` (oppdater eksisterende `bank_navForDate` + `bank_fund`; ny kurvetest)

- [ ] **Step 1: Oppdater eksisterende tester til ny signatur + skriv ny kurvetest**

I `test/suite.js`, i `bank_navForDate`: erstatt alle `L.navForDate(<iso>)` med `L.navForDate(S, <iso>)` der `S = L.defaultState()`. Konkret, bytt ut hele funksjonen med:

```javascript
    function bank_navForDate() {
      const S = L.defaultState();
      eq('nav ved epoke = 100', L.navForDate(S, L.BANK_FUND_EPOCH), 100);
      eq('nav før epoke = 100', L.navForDate(S, '2020-01-01'), 100);
      eq('determinisme', L.navForDate(S, '2026-06-15'), L.navForDate(S, '2026-06-15'));
      let prev = L.navForDate(S, '2026-06-01');
      let okCap = true;
      let d = '2026-06-01';
      for (let i = 0; i < 30; i++) {
        d = L.isoDate(new Date(new Date(d).getTime() + 86400000));
        const cur = L.navForDate(S, d);
        const r = cur / prev - 1;
        if (r > 0.0301 || r < -0.0301) okCap = false;
        prev = cur;
      }
      ok('daglig endring innenfor ±3 %', okCap);
      ok('nav er positiv', L.navForDate(S, '2026-06-15') > 0);
    }
```

I `bank_fund`: erstatt `const nav = L.navForDate('2026-06-15');` med `const nav = L.navForDate(s, '2026-06-15');`.

Legg til ny kurvetest i `tests`-arrayen:

```javascript
    function bank_curve_effort_driven() {
      const mkWeek = (s, monday, medal) => {
        for (const d of L.weekdaysOf(monday)) s.days[d] = { locked: true, subjects: ['Matte'], marks: { '0': { medal } } };
        return s;
      };
      // Ukesvekst måles man→man (7 dager) for å isolere én ukes bidrag.
      const weekGain = (s, monday) => L.navForDate(s, L.addDaysIso(monday, 7)) / L.navForDate(s, monday) - 1;
      const gull = mkWeek(L.defaultState(), '2026-09-07', 'gull');
      const bronse = mkWeek(L.defaultState(), '2026-09-07', 'bronse');
      const idle = L.defaultState(); // ingen innsats
      const ferie = L.defaultState();
      ferie.settings.bank.vacations = [{ id: 'v', from: '2026-09-07', to: '2026-09-13' }];
      const gGain = weekGain(gull, '2026-09-07');
      const bGain = weekGain(bronse, '2026-09-07');
      const iGain = weekGain(idle, '2026-09-07');
      const fGain = weekGain(ferie, '2026-09-07');
      ok('god uke > bronse-uke', gGain > bGain);
      ok('bronse-uke > slapp uke', bGain > iGain);
      ok('ferie-uke > slapp uke (nøytral)', fGain > iGain);
      ok('slapp uke kryper (liten positiv)', iGain > 0 && iGain < 0.02);
      // streak forsterker: samme gull-uke gir mer vekst når den følger to gode uker
      const streaked = L.defaultState();
      mkWeek(streaked, '2026-08-24', 'gull');
      mkWeek(streaked, '2026-08-31', 'gull');
      mkWeek(streaked, '2026-09-07', 'gull');
      ok('streak-uke > enkeltstående gull-uke', weekGain(streaked, '2026-09-07') > gGain + 1e-9);
      // gulv fortsatt intakt selv med lav drift
      const s = L.defaultState();
      s.bank.ledger = [{ id: 'f', product: 'fund', type: 'deposit', amount: 50, date: '2024-01-01', at: 't1' }];
      ok('fond aldri under innskudd', L.fundValue(s, '2026-09-07') >= 50 - 1e-6);
    }
```

- [ ] **Step 2: Kjør testene og bekreft at de feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL — `bank_navForDate`/`bank_fund` feiler nå på arity (gammel `navForDate` ignorerer første arg og tolker state-objektet som iso → NaN/feil), og `bank_curve_effort_driven` feiler (kurven er ennå ikke innsats-drevet).

- [ ] **Step 3: Fjern gammel kurve-kode**

I `js/logic.js`, slett `const navCache = new Map();` (linje ~139) og hele den gamle `navForDate`-funksjonen (linje ~140-155, kommentaren `// NAV(iso): ...` t.o.m. dens `}`).

- [ ] **Step 4: Legg til settings-lesere + ny serie-bygger + ny `navForDate`**

Sett inn der den gamle `navForDate` sto (etter `bankNoise`, før `daysBetween`):

```javascript
function fundBaseWeekly(state) {
  const b = state.settings && state.settings.bank;
  return b && b.fundBaseWeeklyRate != null ? b.fundBaseWeeklyRate : BANK_FUND_BASE_WEEKLY;
}
function fundNeutralWeekly(state) {
  const b = state.settings && state.settings.bank;
  return b && b.fundNeutralWeeklyRate != null ? b.fundNeutralWeeklyRate : BANK_FUND_NEUTRAL_WEEKLY;
}
// Effektiv innsats-styrke = default per-poeng × forelder-multiplikator (default 1).
export function fundEffortStrength(state) {
  const b = state.settings && state.settings.bank;
  const mult = b && b.fundEffortMult != null ? b.fundEffortMult : 1;
  return BANK_FUND_EFFORT_PER_POINT * mult;
}

// Siste dato serien må dekke: max(i dag, siste ledger-dato).
function fundEndIso(state) {
  let end = new Date().toISOString().slice(0, 10);
  const led = (state.bank && state.bank.ledger) || [];
  for (const e of led) if (e.date > end) end = e.date;
  return end;
}

// Billig, men kollisjonssikker signatur: fanger innsats-fordeling, ferie, tunables og sluttdato.
function navSignature(state, end) {
  const b = (state.settings && state.settings.bank) || {};
  const days = state.days || {};
  let lockedCount = 0;
  let last = '';
  for (const d of Object.keys(days)) {
    if (days[d].locked && weekdayKey(d)) {
      lockedCount++;
      if (d > last) last = d;
    }
  }
  const effKey = effortRecords(state)
    .map((r) => r.date + '.' + r.position + '.' + r.score)
    .sort()
    .join(',');
  return [
    end,
    fundBaseWeekly(state),
    fundNeutralWeekly(state),
    fundEffortStrength(state),
    JSON.stringify(b.vacations || []),
    lockedCount,
    last,
    effKey,
  ].join('|');
}

let _navMemo = { sig: null, series: null, end: null };

// Bygger hele NAV-serien (Map iso→nav) fra epoke til `end`, memoisert på state-signatur.
function navSeries(state) {
  const end = fundEndIso(state);
  const sig = navSignature(state, end);
  if (_navMemo.sig === sig) return _navMemo;
  const base = fundBaseWeekly(state);
  const neutral = fundNeutralWeekly(state);
  const strength = fundEffortStrength(state);
  const metricsByWeek = new Map();
  const wk = (ws) => {
    if (!metricsByWeek.has(ws)) {
      metricsByWeek.set(ws, {
        effort: weekEffortScore(state, ws),
        streak: fundStreakWeeks(state, ws),
      });
    }
    return metricsByWeek.get(ws);
  };
  const series = new Map();
  let nav = 100;
  let d = BANK_FUND_EPOCH;
  let guard = 0;
  while (d < end && guard < 6000) {
    d = addDaysIso(d, 1);
    let r;
    const noise = BANK_FUND_VOL * bankNoise(d);
    if (isVacationDay(state, d)) {
      r = neutral / 7 + noise;
    } else {
      const m = wk(weekStartIso(d));
      const lift = Math.min(BANK_FUND_EFFORT_CAP, strength * m.effort);
      const factor = 1 + BANK_FUND_STREAK_STEP * Math.min(m.streak, BANK_FUND_STREAK_CAP);
      r = base / 7 + (lift * factor) / 7 + noise;
    }
    if (r > BANK_FUND_CAP) r = BANK_FUND_CAP;
    if (r < -BANK_FUND_CAP) r = -BANK_FUND_CAP;
    nav *= 1 + r;
    series.set(d, nav);
  }
  _navMemo = { sig, series, end };
  return _navMemo;
}

// NAV(state, iso): 100 ved/ før epoke; ellers slås opp i den memoiserte serien.
export function navForDate(state, iso) {
  if (!iso || iso <= BANK_FUND_EPOCH) return 100;
  const memo = navSeries(state);
  if (memo.series.has(iso)) return memo.series.get(iso);
  return memo.series.get(memo.end) || 100; // iso etter slutt → siste kjente verdi
}
```

- [ ] **Step 5: Oppdater `foldFund`, `fundMarketValue`, `fundValue` til ny signatur**

I `js/logic.js`:
- I `foldFund` (linje ~208): `const nav = navForDate(e.date);` → `const nav = navForDate(state, e.date);`
- I `fundMarketValue` (linje ~224): `return foldFund(state).units * navForDate(today);` → `return foldFund(state).units * navForDate(state, today);`
- I `fundValue` (linje ~230): `return Math.max(units * navForDate(today), principal);` → `return Math.max(units * navForDate(state, today), principal);`

- [ ] **Step 6: Kjør testene og bekreft at de passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: `bank_navForDate`, `bank_fund`, `bank_curve_effort_driven`, `bank_history_transactions` og resten PASS.

- [ ] **Step 7: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): innsats- og streak-drevet fondskurve med ferie-nøytral drift

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `fundWeekStatus` (medvinds-status for UI)

**Files:**
- Modify: `js/logic.js` (ny ren fn nær `fundStreakWeeks`)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

Legg til i `tests`-arrayen i `test/suite.js`:

```javascript
    function bank_week_status() {
      const mkWeek = (s, monday, medal) => {
        for (const d of L.weekdaysOf(monday)) s.days[d] = { locked: true, subjects: ['Matte'], marks: { '0': { medal } } };
        return s;
      };
      // slapp uke → mode 'idle'
      const idle = L.fundWeekStatus(L.defaultState(), '2026-09-09');
      eq('idle mode', idle.mode, 'idle');
      ok('idle positiv men liten', idle.weeklyPct > 0 && idle.weeklyPct < 2);
      // god uke → mode 'active', høyere prosent
      const g = mkWeek(L.defaultState(), '2026-09-07', 'gull');
      const act = L.fundWeekStatus(g, '2026-09-09');
      eq('active mode', act.mode, 'active');
      ok('active > idle', act.weeklyPct > idle.weeklyPct);
      // hel ferieuke → mode 'vacation', nøytral prosent (~2)
      const f = L.defaultState();
      f.settings.bank.vacations = [{ id: 'v', from: '2026-09-07', to: '2026-09-11' }];
      const vac = L.fundWeekStatus(f, '2026-09-09');
      eq('vacation mode', vac.mode, 'vacation');
      ok('vacation ~ nøytral 2 %', Math.abs(vac.weeklyPct - 2) < 0.001);
    }
```

- [ ] **Step 2: Kjør testen og bekreft at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL — `L.fundWeekStatus is not a function`.

- [ ] **Step 3: Implementer `fundWeekStatus`**

I `js/logic.js`, sett inn rett etter `fundStreakWeeks`:

```javascript
// Status for uka `today` ligger i — til guttens medvinds-linje.
// Returnerer { mode:'vacation'|'active'|'idle', weeklyPct, streakWeeks, effort }.
export function fundWeekStatus(state, today) {
  const ws = weekStartIso(today);
  const allVac = weekdaysOf(ws).every((d) => isVacationDay(state, d));
  if (allVac) {
    return { mode: 'vacation', weeklyPct: fundNeutralWeekly(state) * 100, streakWeeks: 0, effort: 0 };
  }
  const effort = weekEffortScore(state, ws);
  const streakWeeks = fundStreakWeeks(state, ws);
  const lift = Math.min(BANK_FUND_EFFORT_CAP, fundEffortStrength(state) * effort);
  const factor = 1 + BANK_FUND_STREAK_STEP * Math.min(streakWeeks, BANK_FUND_STREAK_CAP);
  const weekly = fundBaseWeekly(state) + lift * factor;
  return { mode: effort > 0 ? 'active' : 'idle', weeklyPct: weekly * 100, streakWeeks, effort };
}
```

- [ ] **Step 4: Kjør testen og bekreft at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: `bank_week_status` PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): fundWeekStatus for medvinds-linje

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `addVacation` / `removeVacation` (forelder-mutasjoner)

**Files:**
- Modify: `js/logic.js` (nye rene fn nær `isVacationDay`)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

Legg til i `tests`-arrayen i `test/suite.js`:

```javascript
    function bank_vacation_mutations() {
      const ctx1 = { now: '2026-09-29T09:00:00.000Z', id: 'v1' };
      const ctx2 = { now: '2026-09-29T09:01:00.000Z', id: 'v2' };
      let s = L.defaultState();
      s = L.addVacation(s, { from: '2026-10-05', to: '2026-10-09' }, ctx1);
      eq('én ferieperiode', s.settings.bank.vacations.length, 1);
      eq('id satt', s.settings.bank.vacations[0].id, 'v1');
      eq('updatedAt bumpet', s.settings.updatedAt, ctx1.now);
      eq('logg-gren bank', s.log[s.log.length - 1].type, 'bank');
      // omvendt rekkefølge normaliseres (from <= to)
      let s2 = L.addVacation(L.defaultState(), { from: '2026-12-31', to: '2026-12-20' }, ctx1);
      eq('normalisert from', s2.settings.bank.vacations[0].from, '2026-12-20');
      eq('normalisert to', s2.settings.bank.vacations[0].to, '2026-12-31');
      // tom fra/til = no-op
      const s3 = L.addVacation(L.defaultState(), { from: '', to: '2026-10-09' }, ctx1);
      eq('tom from = ingen periode', s3.settings.bank.vacations.length, 0);
      // fjerning
      const removed = L.removeVacation(s, { id: 'v1' }, ctx2);
      eq('ferie fjernet', removed.settings.bank.vacations.length, 0);
    }
```

- [ ] **Step 2: Kjør testen og bekreft at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL — `L.addVacation is not a function`.

- [ ] **Step 3: Implementer `addVacation` og `removeVacation`**

I `js/logic.js`, sett inn rett etter `isVacationDay`:

```javascript
export function addVacation(state, { from, to }, ctx) {
  const s = clone(state);
  if (!s.settings.bank) s.settings.bank = {};
  if (!Array.isArray(s.settings.bank.vacations)) s.settings.bank.vacations = [];
  if (!from || !to) return s;
  const a = from <= to ? from : to;
  const b = from <= to ? to : from;
  s.settings.bank.vacations.push({ id: ctx.id, from: a, to: b });
  s.settings.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor: 'parent', type: 'bank', action: 'vacation-add', from: a, to: b });
  return s;
}

export function removeVacation(state, { id }, ctx) {
  const s = clone(state);
  const vs = (s.settings.bank && s.settings.bank.vacations) || [];
  s.settings.bank.vacations = vs.filter((v) => v.id !== id);
  s.settings.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor: 'parent', type: 'bank', action: 'vacation-remove', vid: id });
  return s;
}
```

- [ ] **Step 4: Kjør testen og bekreft at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: `bank_vacation_mutations` PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): addVacation/removeVacation forelder-mutasjoner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Oppdater `navForDate`-kallsteder i app.js (ny signatur)

**Files:**
- Modify: `js/app.js` (`fundSparklineSvg` ~571-589, `renderBankView` ~603-604)

- [ ] **Step 1: Oppdater `fundSparklineSvg` til å sende state**

I `js/app.js`, i `fundSparklineSvg` (linje ~576), bytt:

```javascript
  const vals = iso.map((d) => navForDate(d));
```

til:

```javascript
  const vals = iso.map((d) => navForDate(App.state, d));
```

- [ ] **Step 2: Oppdater `renderBankView`**

I `js/app.js` (linje ~603-604), bytt:

```javascript
  const navToday = navForDate(today);
  const navPrev = navForDate(isoDate(new Date(Date.now() - 86400000)));
```

til:

```javascript
  const navToday = navForDate(s, today);
  const navPrev = navForDate(s, isoDate(new Date(Date.now() - 86400000)));
```

- [ ] **Step 3: Parse-sjekk app.js**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: document ...` (OK — syntaks fin). Ikke `SyntaxError`.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "fix(bank): send state til navForDate i app.js (ny signatur)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Medvinds-linje på guttens fond-kort

**Files:**
- Modify: `js/app.js` (import ~22-23, `renderBankView` ~626-637), `index.html` (CSS)

- [ ] **Step 1: Importer `fundWeekStatus`**

I `js/app.js`, i import-blokken fra `./logic.js` (linje ~22-23), legg `fundWeekStatus` til i lista (f.eks. etter `navForDate,`):

```javascript
  netInBank, spendable, bankValue, totalWealth, navForDate, fundWeekStatus,
```

- [ ] **Step 2: Bygg medvinds-HTML og sett den inn på fond-kortet**

I `js/app.js`, i `renderBankView`, legg til rett før `host.innerHTML = \`` (etter linje ~607, etter `const rnd = ...`):

```javascript
  const ws = fundWeekStatus(s, today);
  const pct = ws.weeklyPct.toFixed(1).replace('.', ',');
  const streakBit = ws.streakWeeks > 1 ? ` 🔥 streak ×${ws.streakWeeks}` : '';
  const windText =
    ws.mode === 'vacation' ? '🌴 Ferie — vanlig børsuke'
    : ws.mode === 'active' ? `📈 +${pct} % medvind denne uka — sterk innsats!${streakBit}`
    : '🌱 Rolig uke — fondet kryper';
  const windClass = ws.mode === 'active' ? 'wind up' : ws.mode === 'vacation' ? 'wind vac' : 'wind';
```

Deretter, i fond-kortets HTML, legg medvinds-linja inn rett etter `${fundSparklineSvg(today)}` (linje ~630):

```javascript
      ${fundSparklineSvg(today)}
      <div class="${windClass}">${windText}</div>
```

- [ ] **Step 3: Legg til CSS**

I `index.html`, legg til nær de andre `.bankcard`-reglene:

```css
.wind{font-size:.82rem;margin:6px 0 2px;color:var(--muted);}
.wind.up{color:#39d353;font-weight:600;}
.wind.vac{color:#f0c674;}
```

- [ ] **Step 4: Parse-sjekk app.js**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: document ...` (OK). Ikke `SyntaxError`.

- [ ] **Step 5: Commit**

```bash
git add js/app.js index.html
git commit -m "feat(bank): medvinds-linje på guttens fond-kort

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Forelder-Settings — tunables + ferieperioder

**Files:**
- Modify: `js/app.js` (import ~22-23, `renderPoengTab` bank-seksjon ~2057-2061, handlere ~2100-2107), `index.html` (CSS)

- [ ] **Step 1: Importer `addVacation`/`removeVacation`**

I `js/app.js`, i import-blokken fra `./logic.js` (nær linje ~22), legg til `addVacation, removeVacation,` i lista.

- [ ] **Step 2: Utvid bank-seksjonen i `renderPoengTab`**

I `js/app.js`, finn bank-seksjonen (linje ~2057-2061):

```javascript
    <div class="sec">🏦 Bank</div>
    <div class="card" style="padding:2px 12px">
      <div class="row" style="border:none"><div class="lbl">Sparerente <span class="muted">(% per uke)</span></div>
        ${stepperHtml('id="savRate"', Math.round(((s.settings.bank && s.settings.bank.savingsWeeklyRate) || 0) * 100), { min: 0, step: 1 })}</div>
    </div>
```

Erstatt de fire linjene over med følgende (rent template-HTML — ingen JS-kall inne i strengen). Dette legger til grunn-drift + innsats-styrke i bank-kortet og en tom ferie-container `#vacBox` som fylles av `renderVacations` i Step 3:

```javascript
    <div class="sec">🏦 Bank</div>
    <div class="card" style="padding:2px 12px">
      <div class="row" style="border:none"><div class="lbl">Sparerente <span class="muted">(% per uke)</span></div>
        ${stepperHtml('id="savRate"', Math.round(((s.settings.bank && s.settings.bank.savingsWeeklyRate) || 0) * 100), { min: 0, step: 1 })}</div>
      <div class="row" style="border:none"><div class="lbl">Fond grunn-drift <span class="muted">(% per uke)</span></div>
        <input class="inp" id="fundBase" type="number" min="0" step="0.1" style="width:90px"
          value="${(((s.settings.bank && s.settings.bank.fundBaseWeeklyRate) ?? 0.006) * 100).toFixed(1)}"></div>
      <div class="row" style="border:none"><div class="lbl">Innsats-styrke <span class="muted">(× normal)</span></div>
        ${stepperHtml('id="fundMult"', (s.settings.bank && s.settings.bank.fundEffortMult) ?? 1, { min: 0, step: 0.5 })}</div>
    </div>
    <div class="sec">🌴 Ferieperioder <span class="muted">(fond → nøytral, streak pauser)</span></div>
    <div class="card" id="vacBox" style="padding:8px 12px"></div>
```

**Viktig:** dette er kun en utvidelse av HTML-en INNE i den eksisterende `host.innerHTML = \`...\``-strengen. Ikke rør den avsluttende `` \`; `` eller resten av malen (`Varsling`, `payoutHost`). Selve utfyllingen av `#vacBox` skjer via `renderVacations(s)`-kallet du legger til i Step 3 (etter at `host.innerHTML` er satt).

- [ ] **Step 3: Legg til `renderVacations`-helper og handlere**

I `js/app.js`, rett før `renderPayoutSection(...)`-kallet på slutten av `renderPoengTab` (linje ~2108), legg til handlere for de nye feltene + ferielista:

```javascript
  const fundBase = document.getElementById('fundBase');
  if (fundBase) fundBase.onchange = () => {
    if (!s.settings.bank) s.settings.bank = {};
    s.settings.bank.fundBaseWeeklyRate = Math.max(0, Number(fundBase.value) || 0) / 100;
    s.settings.updatedAt = nowIso();
    save();
  };
  const fundMult = document.getElementById('fundMult');
  if (fundMult) fundMult.onchange = () => {
    if (!s.settings.bank) s.settings.bank = {};
    s.settings.bank.fundEffortMult = Math.max(0, Number(fundMult.value) || 0);
    s.settings.updatedAt = nowIso();
    save();
  };
  renderVacations(s);
```

Legg til selve `renderVacations`-funksjonen som en ny top-level funksjon i `js/app.js` (f.eks. rett etter `renderPoengTab`):

```javascript
function renderVacations(s) {
  const box = document.getElementById('vacBox');
  if (!box) return;
  const vs = (s.settings.bank && s.settings.bank.vacations) || [];
  const rows = vs
    .slice()
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((v) => `<div class="vacrow"><span>${v.from} – ${v.to}</span>
      <button class="btn tiny" data-vacdel="${v.id}">Slett</button></div>`)
    .join('');
  box.innerHTML = `${rows || '<div class="muted" style="font-size:.82rem">Ingen ferieperioder.</div>'}
    <div class="vacrow vacadd">
      <input class="inp" id="vacFrom" type="date">
      <input class="inp" id="vacTo" type="date">
      <button class="btn good tiny" id="vacAdd">＋ Legg til ferie</button>
    </div>`;
  box.querySelectorAll('[data-vacdel]').forEach((b) => {
    b.onclick = () => {
      App.state = removeVacation(App.state, { id: b.dataset.vacdel }, { now: nowIso(), id: newId() });
      save();
      renderVacations(App.state);
    };
  });
  const addBtn = document.getElementById('vacAdd');
  if (addBtn) addBtn.onclick = () => {
    const from = document.getElementById('vacFrom').value;
    const to = document.getElementById('vacTo').value;
    if (!from || !to) return;
    App.state = addVacation(App.state, { from, to }, { now: nowIso(), id: newId() });
    save();
    renderVacations(App.state);
  };
}
```

- [ ] **Step 4: Legg til CSS for ferie-rader**

I `index.html`, nær `.bankcard`-reglene:

```css
.vacrow{display:flex;align-items:center;gap:8px;padding:4px 0;justify-content:space-between;}
.vacrow.vacadd{flex-wrap:wrap;margin-top:6px;}
.btn.tiny{padding:4px 10px;font-size:.8rem;width:auto;}
```

- [ ] **Step 5: Parse-sjekk app.js**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: document ...` (OK). Ikke `SyntaxError`.

- [ ] **Step 6: Commit**

```bash
git add js/app.js index.html
git commit -m "feat(bank): Settings — grunn-drift, innsats-styrke og ferieperioder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Full verifisering, versjon-bump og deploy

**Files:**
- Modify: `index.html` (`APP_VERSION`)

- [ ] **Step 1: Kjør hele testsuiten**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: alle tester PASS (0 feil). Noter nytt antall assertions.

- [ ] **Step 2: Parse-sjekk begge JS-filer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: document` (OK).
Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/logic.js`
Expected: ingen `SyntaxError` (skriptet kjører rent / ingen output er OK).

- [ ] **Step 3: Bump `APP_VERSION`**

I `index.html`, finn `APP_VERSION`-konstanten og øk den ett hakk (følg eksisterende `bNN`-mønster, f.eks. `b62` → `b63`).

- [ ] **Step 4: Manuell nettleser-verifisering (localStorage-modus)**

Åpne appen lokalt (tom URL = localStorage). Sjekk som forelder: Settings viser grunn-drift, innsats-styrke og ferie-liste; legg til en ferieperiode; den vises. Sjekk som sønn: Penger → 🏦 Bank → fond-kortet viser medvinds-linje; sparklinjen tegnes. Sett inn litt i fondet og bekreft at verdi/gulv ser riktig ut.

- [ ] **Step 5: Commit versjon-bump**

```bash
git add index.html
git commit -m "chore: bump APP_VERSION for innsats-drevet fond + ferie

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Push branch og opprett PR** (følg deploy-reglene i CLAUDE.md — aldri `git add -A`, aldri push direkte til main)

```bash
git push -u origin feat/fond-innsats-ferie
```

```bash
gh pr create --base main --title "Innsats-drevet fond + ferie-modus" --body "$(cat <<'EOF'
## Sammendrag
- Fondskursen vokser tydelig de ukene gutten tjener ferske innsats-poeng (medaljekvalitet på låste dager), med streak-forsterkning; kryper ellers.
- Forelder kan blinke ut ferieperioder (fra–til) i Settings → de dagene får fondet nøytral markedsdrift og streaken pauser.
- Guttens fond-kort viser en medvinds-linje som speiler uka.

## Test
- Ren logikk: `jsc -m test/run-jsc.js` — alle tester grønne.
- Parse-sjekk app.js/logic.js.
- Manuell nettleser-sjekk (forelder-Settings + sønn-bank).

Spec: `docs/superpowers/specs/2026-09-29-honniscoins-fond-innsats-ferie-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Merge og oppdater main** (når PR er grønn/godkjent)

```bash
gh pr merge feat/fond-innsats-ferie --merge --delete-branch
git switch main && git pull --ff-only
```

- [ ] **Step 8: Verifiser på GitHub Pages** (latens ~1–2 min, cache per fil)

Sjekk `index.html` (APP_VERSION) og `js/logic.js`/`js/app.js` med cache-buster (`?cb=$RANDOM`) at ny versjon er ute.

---

## Merknader

- **Ytelse:** `navSeries` bygges kun når state-signaturen endres (memo), så tunge re-render (sparkline = 30 kall) treffer cachen. Serie-byggingen er O(uker² × records) på rebuild — helt greit for ~2–3 års data. Optimaliser kun ved påvist behov (YAGNI).
- **Migrering:** eksisterende fond-innskudd reberegnes under den nye kurven; gulvet `max(marked, principal)` beskytter selve innskuddet. Ingen datatap.
- **Nedside:** ingen straff på kursen — slappe uker gir bare grunn-drift. Bevisst valg (spec).
- **Synlig streak-visning** (Nå/All-time i Poeng/Penger) er URØRT; fondet leser sin egen ferie-bevisste streak via `fundStreakWeeks`.
```
