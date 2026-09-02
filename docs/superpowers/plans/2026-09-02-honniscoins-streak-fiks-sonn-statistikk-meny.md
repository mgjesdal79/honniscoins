# Streak-fiks + statistikk for sønn + kompakt forelder-meny — implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (valgt: inline). Steps bruker checkbox (`- [ ]`).

**Goal:** Fikse gull/sølv-streaken (utfylte timer teller, «0» bryter, syk/blank pauser), vise statistikk for sønn nederst på Poeng-siden i responsiv bredde, og gjøre forelder-menyen til kompakte ikon+tekst-faner.

**Architecture:** Ren logikk-endring i `js/logic.js` (kun `lessonSequence`), gjenbruk av statistikk-rendring i `js/app.js`, CSS i `index.html`. Ingen datamodell-migrering.

**Tech Stack:** Vanilla ES-moduler, jsc for test.

**Spec:** `docs/superpowers/specs/2026-09-02-honniscoins-streak-fiks-sonn-statistikk-meny-design.md`

---

### Task 1: Streak — nye tester (rødt)

**Files:**
- Test: `test/suite.js` (legg til etter `streak_ongoing_flags`, før neste blokk)

- [ ] **Step 1: Skriv de tre feilende testene**

Legg inn etter `streak_ongoing_flags`-funksjonen (rundt linje 167):

```js
    function streak_sick_day_counts_filled_hours() {
      const s = L.defaultState();
      s.days['2026-10-05'] = lockedDay(['A', 'B'], { 0: 'gull', 1: 'gull' });
      // syk-dag, låst, 2 gulltimer utfylt + resten blankt (gyldig fravær resten av dagen)
      s.days['2026-10-06'] = { subjects: ['A', 'B', 'C', 'D'], marks: { 0: { medal: 'gull' }, 1: { medal: 'gull' } }, sick: true, locked: true, lockedAt: 't' };
      s.days['2026-10-07'] = lockedDay(['A'], { 0: 'gull' });
      eq('syk-dag utfylte timer teller (gull best 5)', L.goldStreakInfo(s, '2026-10').allTimeBest, 5);
    },
    function streak_blank_hour_pauses() {
      const s = L.defaultState();
      s.days['2026-10-05'] = lockedDay(['A', 'B', 'C'], { 0: 'gull', 2: 'gull' }); // time 1 blank
      eq('blank time pauser (gull best 2)', L.goldStreakInfo(s, '2026-10').allTimeBest, 2);
    },
    function streak_fravaer_breaks() {
      const s = L.defaultState();
      s.days['2026-10-05'] = lockedDay(['A', 'B', 'C'], { 0: 'gull', 1: '0', 2: 'gull' });
      eq('fravær «0» bryter (gull best 1)', L.goldStreakInfo(s, '2026-10').allTimeBest, 1);
    },
```

- [ ] **Step 2: Kjør — verifiser at de feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL — `streak_sick_day_counts_filled_hours` (får 3, ikke 5, fordi syk-dag hoppes over) og `streak_blank_hour_pauses` (får 1, ikke 2, fordi blank nullstiller i dag).

- [ ] **Step 3: Ikke commit ennå** (grønt kommer i Task 2)

---

### Task 2: Streak — ny `lessonSequence` (grønt)

**Files:**
- Modify: `js/logic.js` (funksjonen `lessonSequence`, ca. linje 372–387)

- [ ] **Step 1: Erstatt `lessonSequence`**

Bytt ut hele funksjonen med:

```js
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
```

- [ ] **Step 2: Kjør alle tester — verifiser grønt**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: alle grønne (de 4 gamle streak-testene + 3 nye).

- [ ] **Step 3: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "fix(streak): utfylte timer teller, «0» bryter, syk/blank pauser"
```

---

### Task 3: Gjenbrukbar statistikk-rendring

**Files:**
- Modify: `js/app.js` (`renderStatistikkTab`, ca. linje 1321–1356)

- [ ] **Step 1: Trekk ut `statContentHtml` og refaktorer `renderStatistikkTab`**

Erstatt `renderStatistikkTab` med to funksjoner:

```js
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
```

`bindStatChips`, `statCard` og alle `svg*`-funksjonene er uendret.

- [ ] **Step 2: Parse-sjekk**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `Exception: ReferenceError: Can't find variable: document` (= syntaks OK).

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "refactor(stat): trekk ut statContentHtml for gjenbruk"
```

---

### Task 4: Statistikk på sønnens Poeng-side + responsiv bredde

**Files:**
- Modify: `js/app.js` (`renderPoengPage` ca. 418–466, `bindStatChips`-kall, `routeToView` ca. 1497)

- [ ] **Step 1: Pakk inn eksisterende Poeng-innhold i `narrowcol` og legg til statistikk-seksjon**

I `renderPoengPage`, endre `host.innerHTML = ` ... slik at alt dagens innhold pakkes i `<div class="narrowcol">...</div>`, og legg statistikk-seksjonen etter den. Bytt ut den avsluttende delen:

Fra (slutten av innerHTML):
```js
    <div class="sec">🥇 Gull-streak (timer på rad)</div>
    ${statGrid(gd)}`;
}
```

Til:
```js
    <div class="sec">🥇 Gull-streak (timer på rad)</div>
    ${statGrid(gd)}
    </div>
    <div class="sec">📊 Statistikk</div>
    ${statContentHtml(s)}`;
  bindStatChips(host);
}
```

Og legg inn `<div class="narrowcol">` rett etter `host.innerHTML = \``:
```js
  host.innerHTML = `
    <div class="narrowcol">
    <div class="balance">
```

(Åpner `narrowcol` før `.balance`, lukkes med den nye `</div>` etter gull-streaken.)

- [ ] **Step 2: Toggle `body.statwide` for sønnens Poeng-side i `routeToView`**

Erstatt `wide`-linja i `routeToView`:

```js
  const wide = (App.role === 'parent' && App.parentUnlocked && App.parentTab === 'stat')
    || (App.role === 'son' && App.sonPage === 'poeng');
  document.body.classList.toggle('statwide', wide);
```

- [ ] **Step 3: Parse-sjekk**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: ... document` (OK).

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(stat): statistikk nederst på sønnens Poeng-side + responsiv bredde"
```

---

### Task 5: Forelder-meny — ikon + kort tekst + narrowcol-CSS

**Files:**
- Modify: `js/app.js` (`renderParentHome` tabs-array + bar-mapping, ca. 632–646)
- Modify: `index.html` (CSS: `.tabbar .t`, ny `.narrowcol`, bump `APP_VERSION`)

- [ ] **Step 1: Utvid tabs-array med ikon + kort etikett**

I `renderParentHome`, bytt `tabs` og `bar`:

```js
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
```

- [ ] **Step 2: Restyle `.tabbar .t` til ikon+tekst + legg til `.narrowcol`**

I `index.html`, erstatt linje 56:
```js
  .tabbar .t{flex:1;padding:9px;border-radius:9px;font-size:.8rem;font-weight:700;color:var(--muted);background:transparent;border:none}
```
med:
```js
  .tabbar{gap:3px;padding:4px}
  .tabbar .t{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 2px;border-radius:9px;color:var(--muted);background:transparent;border:none}
  .tabbar .t .ti{font-size:1.15rem;line-height:1}
  .tabbar .t .tl{font-size:.6rem;font-weight:700;letter-spacing:.01em}
```

Legg til `.narrowcol` i statistikk-CSS-blokken (etter `body.statwide`-regelen):
```js
  .narrowcol{max-width:480px;margin:0 auto}
```

- [ ] **Step 3: Bump APP_VERSION**

Erstatt:
```js
    window.APP_VERSION = '2026.09.01 (b21 · statistikk full bredde)';
```
med:
```js
    window.APP_VERSION = '2026.09.02 (b22 · streak-fiks + sønn-statistikk + meny)';
```

- [ ] **Step 4: Parse-sjekk + full test**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js` → `ReferenceError: ... document` (OK).
Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js` → alle grønne.

- [ ] **Step 5: Commit**

```bash
git add js/app.js index.html
git commit -m "feat(ui): kompakt ikon+tekst forelder-meny + narrowcol + bump b22"
```

---

### Task 6: Deploy + verifisering

- [ ] **Step 1: Push branch + PR + merge**

```bash
git push -u origin feat/streak-og-statistikk-sonn
gh pr create --base main --title "Streak-fiks + statistikk for sønn + kompakt forelder-meny" --body "..."
gh pr merge feat/streak-og-statistikk-sonn --merge --delete-branch
git switch main && git pull --ff-only
```

- [ ] **Step 2: Vent på Pages-bygg og verifiser live**

Poll `gh api repos/mgjesdal79/honniscoins/pages/builds/latest` til `built`, deretter:
```bash
curl -s "https://mgjesdal79.github.io/honniscoins/index.html?cb=$RANDOM" | grep -o "APP_VERSION = '[^']*'"
```
Expected: `2026.09.02 (b22 · ...)`. Sjekk også `js/app.js` for `statContentHtml` og `js/logic.js` er oppdatert.
