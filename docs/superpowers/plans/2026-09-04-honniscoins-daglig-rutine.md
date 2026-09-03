# Daglig rutine (gjentakende «rydd opp»-sidequest) – Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Én fast, redigerbar mal genererer automatisk én avkryssbar «rydd opp»-sidequest per hverdag, uten manuell oppretting.

**Architecture:** Malen bor i `settings.dailyRoutine`. Hver hverdag genererer `migrate()` (kalt i `loadState`) én vanlig quest-instans (med ekstra felt `source:'routine'`, `routineDate`, `subtasks[]`), som arver all eksisterende quest-maskineri (commit/godkjenn/poeng/arkiv/fletting). Sønn huker av subtasks; alle må være huket av før «Marker som gjort». Forelder styrer malen i en ny seksjon i Poeng-fanen.

**Tech Stack:** Vanilla ES-moduler (no build). Ren logikk i `js/logic.js`, DOM i `js/app.js`, CSS/versjon i `index.html`. Tester i `test/suite.js`, kjørt med `jsc`.

**Spec:** `docs/superpowers/specs/2026-09-04-honniscoins-daglig-rutine-design.md`

---

## Filstruktur

- `js/logic.js` – ny ren logikk: default-felt (`defaultState`/`migrate`), `allSubtasksDone`, `setDailyRoutine`, `generateDailyRoutine`, `commitQuest`-gating, `toggleQuestSubtask`, utvidet `updateQuest`.
- `js/app.js` – sønnens instans-kort (`renderSidequestsPage`) + forelderens «Daglig rutine»-seksjon (`renderPoengTab`); nye imports fra logic.
- `index.html` – CSS for subtask-checklist og mal-editor; `APP_VERSION`-bump.
- `test/suite.js` – nye rene tester.
- `CLAUDE.md` – nytt «Daglig rutine»-avsnitt.

**Testkommando (bruk overalt der «Kjør tester» står):**
`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`

**Parse-sjekk app.js (DOM-fri):**
`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Forventet: `ReferenceError: ... document ...` = OK (syntaks fin). `SyntaxError` = feil.

**Konvensjoner (fra CLAUDE.md):** Jobb på branch. `git add <konkrete filer>` (aldri `-A`). Commit-trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Norsk i UI/commit.

---

### Task 0: Opprett arbeidsbranch

- [ ] **Step 1: Lag branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/daglig-rutine
```

---

### Task 1: Default-felt `settings.dailyRoutine`

**Files:**
- Modify: `js/logic.js` (`defaultState` ~rad 28-38, `migrate` ~rad 426-451)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende tester**

Legg til disse to funksjonene i `tests`-arrayet i `test/suite.js` (f.eks. rett etter `defaultState_shape`):

```javascript
    function dailyRoutine_default_shape() {
      const s = L.defaultState();
      eq('routine enabled default false', s.settings.dailyRoutine.enabled, false);
      eq('routine title default', s.settings.dailyRoutine.title, 'Rydd opp etter skolen');
      eq('routine points default', s.settings.dailyRoutine.points, 10);
      eq('routine subtasks default', s.settings.dailyRoutine.subtasks, []);
    },
    function dailyRoutine_migrate_fills_missing() {
      const s = L.defaultState();
      delete s.settings.dailyRoutine;
      const m = L.migrate(s, '2026-09-04');
      eq('migrate adds routine', !!m.settings.dailyRoutine, true);
      eq('migrate routine disabled', m.settings.dailyRoutine.enabled, false);
      ok('migrate keeps existing routine', (() => {
        const s2 = L.defaultState();
        s2.settings.dailyRoutine = { enabled: true, title: 'Egen', points: 20, subtasks: [{ id: 'a', text: 'x' }], updatedAt: 't' };
        const m2 = L.migrate(s2, '2026-09-04');
        return m2.settings.dailyRoutine.title === 'Egen' && m2.settings.dailyRoutine.points === 20;
      })());
    },
```

- [ ] **Step 2: Kjør tester – forvent FAIL**

Kjør testkommandoen. Forventet: de to nye testene feiler (`dailyRoutine` er undefined).

- [ ] **Step 3: Legg til default i `defaultState`**

I `js/logic.js`, inne i `defaultState()`s `settings`-objekt (etter `docendoIcalId`-linja, før `schemaVersion`):

```javascript
      dailyRoutine: { enabled: false, title: 'Rydd opp etter skolen', points: 10, subtasks: [], updatedAt: null },
```

- [ ] **Step 4: Fyll default i `migrate`**

I `js/logic.js`, i `migrate()`, rett etter linja `if (!s.settings.docendoIcalId) s.settings.docendoIcalId = ...;`:

```javascript
  if (!s.settings.dailyRoutine) {
    s.settings.dailyRoutine = { enabled: false, title: 'Rydd opp etter skolen', points: 10, subtasks: [], updatedAt: null };
  }
```

- [ ] **Step 5: Kjør tester – forvent PASS**

Kjør testkommandoen. Forventet: alle tester passerer.

- [ ] **Step 6: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutine): default settings.dailyRoutine + migrering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `allSubtasksDone(quest)`

**Files:**
- Modify: `js/logic.js` (i Sidequests-seksjonen, etter `isQuestOverdue` ~rad 472)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

Legg til i `tests`-arrayet:

```javascript
    function allSubtasksDone_cases() {
      eq('ingen subtasks -> true', L.allSubtasksDone({ title: 'x' }), true);
      eq('tom liste -> true', L.allSubtasksDone({ subtasks: [] }), true);
      eq('delvis -> false', L.allSubtasksDone({ subtasks: [{ done: true }, { done: false }] }), false);
      eq('alle -> true', L.allSubtasksDone({ subtasks: [{ done: true }, { done: true }] }), true);
    },
```

- [ ] **Step 2: Kjør tester – forvent FAIL**

Forventet: `allSubtasksDone` er ikke definert.

- [ ] **Step 3: Implementer**

I `js/logic.js`, etter `isQuestOverdue(...)`:

```javascript
// Alle subtasks huket av? (Ingen/tom liste teller som ferdig.)
export function allSubtasksDone(quest) {
  const subs = (quest && quest.subtasks) || [];
  return subs.every((st) => !!st.done);
}
```

- [ ] **Step 4: Kjør tester – forvent PASS**

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutine): allSubtasksDone-hjelper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `setDailyRoutine(state, {patch}, ctx)`

**Files:**
- Modify: `js/logic.js` (etter `deleteQuest` ~rad 558)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```javascript
    function setDailyRoutine_updates_and_stamps() {
      const s0 = L.defaultState();
      const s = L.setDailyRoutine(s0, { patch: { enabled: true, title: 'Rydd', points: 15, subtasks: [{ id: 's1', text: 'Heng opp jakke' }] } }, { now: 't1', id: 'r1' });
      eq('enabled', s.settings.dailyRoutine.enabled, true);
      eq('title', s.settings.dailyRoutine.title, 'Rydd');
      eq('points', s.settings.dailyRoutine.points, 15);
      eq('subtasks', s.settings.dailyRoutine.subtasks, [{ id: 's1', text: 'Heng opp jakke' }]);
      eq('updatedAt stamped', s.settings.dailyRoutine.updatedAt, 't1');
      eq('original uendret', s0.settings.dailyRoutine.enabled, false);
    },
```

- [ ] **Step 2: Kjør tester – forvent FAIL**

- [ ] **Step 3: Implementer**

I `js/logic.js`, etter `deleteQuest(...)`:

```javascript
// Forelder oppdaterer malen for daglig rutine.
export function setDailyRoutine(state, { patch, actor = 'parent' }, ctx) {
  const s = clone(state);
  const r = s.settings.dailyRoutine || (s.settings.dailyRoutine = { enabled: false, title: 'Rydd opp etter skolen', points: 10, subtasks: [], updatedAt: null });
  if ('enabled' in patch) r.enabled = !!patch.enabled;
  if ('title' in patch) r.title = patch.title;
  if ('points' in patch) r.points = Number(patch.points) || 0;
  if ('subtasks' in patch) r.subtasks = (patch.subtasks || []).map((st) => ({ id: st.id, text: st.text }));
  r.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'routine', action: 'edit' });
  return s;
}
```

- [ ] **Step 4: Kjør tester – forvent PASS**

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutine): setDailyRoutine-mutasjon

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `generateDailyRoutine(state, todayIso)` + kall i `migrate`

**Files:**
- Modify: `js/logic.js` (ny fn før `migrate` eller etter; kall på slutten av `migrate`)
- Test: `test/suite.js`

Deterministiske id-er (migrate har ingen `ctx.id`): quest-id `routine-<date>`, subtask-id `routine-<date>-<n>`, log-id `log-routine-<date>`. Tidsstempel = `<date>T00:00:00.000Z`.

- [ ] **Step 1: Skriv feilende tester**

```javascript
    function generateDailyRoutine_weekday_creates() {
      const s = L.defaultState();
      s.settings.dailyRoutine = { enabled: true, title: 'Rydd', points: 15, subtasks: [{ id: 'm1', text: 'Jakke' }, { id: 'm2', text: 'Sekk' }], updatedAt: 't' };
      const m = L.generateDailyRoutine(s, '2026-09-04'); // fredag
      const inst = m.quests.filter((q) => q.source === 'routine');
      eq('én instans', inst.length, 1);
      eq('deterministisk id', inst[0].id, 'routine-2026-09-04');
      eq('routineDate', inst[0].routineDate, '2026-09-04');
      eq('status open', inst[0].status, 'open');
      eq('points fra mal', inst[0].points, 15);
      eq('subtasks kopiert, done=false', inst[0].subtasks, [
        { id: 'routine-2026-09-04-0', text: 'Jakke', done: false },
        { id: 'routine-2026-09-04-1', text: 'Sekk', done: false },
      ]);
    },
    function generateDailyRoutine_weekend_skips() {
      const s = L.defaultState();
      s.settings.dailyRoutine = { enabled: true, title: 'Rydd', points: 15, subtasks: [], updatedAt: 't' };
      const m = L.generateDailyRoutine(s, '2026-09-05'); // lørdag
      eq('ingen instans i helg', m.quests.filter((q) => q.source === 'routine').length, 0);
    },
    function generateDailyRoutine_disabled_skips() {
      const s = L.defaultState();
      s.settings.dailyRoutine = { enabled: false, title: 'Rydd', points: 15, subtasks: [], updatedAt: 't' };
      const m = L.generateDailyRoutine(s, '2026-09-04');
      eq('ingen instans når disabled', m.quests.filter((q) => q.source === 'routine').length, 0);
    },
    function generateDailyRoutine_idempotent() {
      const s = L.defaultState();
      s.settings.dailyRoutine = { enabled: true, title: 'Rydd', points: 15, subtasks: [], updatedAt: 't' };
      const m1 = L.generateDailyRoutine(s, '2026-09-04');
      const m2 = L.generateDailyRoutine(m1, '2026-09-04');
      eq('fortsatt kun én', m2.quests.filter((q) => q.source === 'routine').length, 1);
    },
    function generateDailyRoutine_no_backfill() {
      const s = L.defaultState();
      s.settings.dailyRoutine = { enabled: true, title: 'Rydd', points: 15, subtasks: [], updatedAt: 't' };
      const m = L.generateDailyRoutine(s, '2026-09-04'); // fredag
      eq('kun for i dag', m.quests.filter((q) => q.routineDate === '2026-09-03').length, 0);
    },
    function migrate_runs_generation() {
      const s = L.defaultState();
      s.settings.dailyRoutine = { enabled: true, title: 'Rydd', points: 15, subtasks: [], updatedAt: 't' };
      const m = L.migrate(s, '2026-09-04'); // fredag
      eq('migrate genererer', m.quests.filter((q) => q.source === 'routine').length, 1);
    },
```

- [ ] **Step 2: Kjør tester – forvent FAIL**

- [ ] **Step 3: Implementer `generateDailyRoutine`**

I `js/logic.js`, legg til rett FØR `export function migrate(...)`:

```javascript
// Genererer én rutine-instans for i dag (hverdag) hvis malen er på og ingen finnes.
// Deterministiske id-er (migrate har ingen ctx.id) gir idempotens + trygg fletting.
export function generateDailyRoutine(state, todayIso) {
  const s = clone(state);
  const r = s.settings && s.settings.dailyRoutine;
  if (!r || r.enabled !== true) return s;
  if (!todayIso || weekdayKey(todayIso) === null) return s; // kun hverdag
  if (!Array.isArray(s.quests)) s.quests = [];
  const qid = `routine-${todayIso}`;
  if (s.quests.some((q) => q.id === qid)) return s; // idempotent
  const stamp = `${todayIso}T00:00:00.000Z`;
  const subtasks = (r.subtasks || []).map((st, i) => ({ id: `${qid}-${i}`, text: st.text, done: false }));
  s.quests.push({
    id: qid,
    title: r.title,
    desc: '',
    points: Number(r.points) || 0,
    due: null,
    status: 'open',
    createdAt: stamp,
    createdBy: 'system',
    doneAt: null,
    approvedAt: null,
    updatedAt: stamp,
    removed: false,
    source: 'routine',
    routineDate: todayIso,
    subtasks,
  });
  if (!Array.isArray(s.log)) s.log = [];
  s.log.push({ id: `log-routine-${todayIso}`, at: stamp, actor: 'system', type: 'quest', action: 'create', quest: qid, title: r.title, source: 'routine' });
  return s;
}
```

- [ ] **Step 4: Kall generering på slutten av `migrate`**

I `js/logic.js`, i `migrate()`, bytt den avsluttende `return s;` (rad ~451) med:

```javascript
  return generateDailyRoutine(s, todayIso);
```

- [ ] **Step 5: Kjør tester – forvent PASS**

- [ ] **Step 6: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutine): daglig generering av instans i migrate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `commitQuest`-gating på subtasks

**Files:**
- Modify: `js/logic.js` (`commitQuest` ~rad 561-570)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende tester**

```javascript
    function commitQuest_blocked_until_subtasks_done() {
      let s = L.defaultState();
      s.quests.push({ id: 'r1', title: 'Rydd', points: 15, status: 'open', updatedAt: 't0', removed: false, subtasks: [{ id: 'a', text: 'x', done: false }] });
      const s2 = L.commitQuest(s, { id: 'r1', actor: 'son' }, { now: 't1', id: 'l1' });
      eq('ikke committet når subtask åpen', s2.quests[0].status, 'open');
    },
    function commitQuest_allowed_when_subtasks_done() {
      let s = L.defaultState();
      s.quests.push({ id: 'r1', title: 'Rydd', points: 15, status: 'open', updatedAt: 't0', removed: false, subtasks: [{ id: 'a', text: 'x', done: true }] });
      const s2 = L.commitQuest(s, { id: 'r1', actor: 'son' }, { now: 't1', id: 'l1' });
      eq('committet når alle subtasks done', s2.quests[0].status, 'done');
    },
```

- [ ] **Step 2: Kjør tester – forvent FAIL**

Forventet: første test feiler (dagens `commitQuest` setter alltid `done`).

- [ ] **Step 3: Implementer gating**

I `js/logic.js`, i `commitQuest()`, rett etter `if (i < 0) return s;`:

```javascript
  if (!allSubtasksDone(s.quests[i])) return s; // alle subtasks må være huket av
```

- [ ] **Step 4: Kjør tester – forvent PASS**

Kjør hele suiten. Forventet: alle passerer (også de eksisterende commit-testene, som bruker quests uten subtasks).

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutine): commitQuest krever alle subtasks huket av

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `toggleQuestSubtask(state, {id, subId}, ctx)`

**Files:**
- Modify: `js/logic.js` (etter `uncommitQuest` ~rad 582)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```javascript
    function toggleQuestSubtask_flips_and_bumps() {
      let s = L.defaultState();
      s.quests.push({ id: 'r1', title: 'Rydd', points: 15, status: 'open', updatedAt: 't0', removed: false, subtasks: [{ id: 'a', text: 'x', done: false }, { id: 'b', text: 'y', done: false }] });
      const s2 = L.toggleQuestSubtask(s, { id: 'r1', subId: 'a', actor: 'son' }, { now: 't1', id: 'l1' });
      eq('a huket av', s2.quests[0].subtasks[0].done, true);
      eq('b uendret', s2.quests[0].subtasks[1].done, false);
      eq('updatedAt bumpet', s2.quests[0].updatedAt, 't1');
      const s3 = L.toggleQuestSubtask(s2, { id: 'r1', subId: 'a', actor: 'son' }, { now: 't2', id: 'l2' });
      eq('a av igjen', s3.quests[0].subtasks[0].done, false);
    },
```

- [ ] **Step 2: Kjør tester – forvent FAIL**

- [ ] **Step 3: Implementer**

I `js/logic.js`, etter `uncommitQuest(...)`:

```javascript
// Sønn veksler én subtask. Bumper quest.updatedAt så fletting (LWW) synker riktig.
export function toggleQuestSubtask(state, { id, subId, actor = 'son' }, ctx) {
  const s = clone(state);
  const i = findQuestIdx(s, id);
  if (i < 0) return s;
  const st = (s.quests[i].subtasks || []).find((x) => x.id === subId);
  if (!st) return s;
  st.done = !st.done;
  s.quests[i].updatedAt = ctx.now;
  return s;
}
```

- [ ] **Step 4: Kjør tester – forvent PASS**

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutine): toggleQuestSubtask

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Utvid `updateQuest` til å håndtere `subtasks`

Lar forelder finjustere dagens instans (deloppgaver) uten å røre malen.

**Files:**
- Modify: `js/logic.js` (`updateQuest` ~rad 535-547)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```javascript
    function updateQuest_can_set_subtasks() {
      let s = L.defaultState();
      s.quests.push({ id: 'r1', title: 'Rydd', points: 15, status: 'open', updatedAt: 't0', removed: false, subtasks: [{ id: 'a', text: 'x', done: true }] });
      const s2 = L.updateQuest(s, { id: 'r1', patch: { subtasks: [{ id: 'a', text: 'x', done: true }, { id: 'c', text: 'z', done: false }] } }, { now: 't1', id: 'l1' });
      eq('subtasks satt', s2.quests[0].subtasks.length, 2);
      eq('ny subtask', s2.quests[0].subtasks[1], { id: 'c', text: 'z', done: false });
    },
```

- [ ] **Step 2: Kjør tester – forvent FAIL**

- [ ] **Step 3: Implementer**

I `js/logic.js`, i `updateQuest()`, rett etter linja `if ('due' in patch) q.due = patch.due || null;`:

```javascript
  if ('subtasks' in patch) {
    q.subtasks = (patch.subtasks || []).map((st) => ({ id: st.id, text: st.text, done: !!st.done }));
  }
```

- [ ] **Step 4: Kjør tester – forvent PASS**

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutine): updateQuest kan sette subtasks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Sønn-UI – instans-kort med avkryssbare subtasks

**Files:**
- Modify: `js/app.js` (import ~rad 9-10; `renderSidequestsPage` ~rad 517-589)

- [ ] **Step 1: Utvid imports fra logic**

I `js/app.js`, i import-blokka, endre quest-linja (rad ~9-10) til å inkludere de nye funksjonene. Legg til `allSubtasksDone, toggleQuestSubtask` i quest-import-gruppa:

```javascript
  activeQuests, isQuestOverdue, questPointsPending, questArchiveSplit, allSubtasksDone,
  addQuest, updateQuest, deleteQuest, commitQuest, uncommitQuest, approveQuest, rejectQuest, toggleQuestSubtask,
```

- [ ] **Step 2: Bytt `questCard`-funksjonen for open-grenen**

I `renderSidequestsPage`, erstatt hele `questCard`-funksjonen (rad ~535-559) med denne (legger til subtask-checklist + badge + gating i open-kort; done/approved uendret men viser badge):

```javascript
  const routineBadge = (q) =>
    q.source === 'routine'
      ? `<span class="qrec">🔁 Daglig · ${routineDateLabel(q.routineDate)}</span>`
      : '';
  const subtaskList = (q, interactive) => {
    const subs = q.subtasks || [];
    if (!subs.length) return q.desc ? `<div class="qdesc">${escapeHtml(q.desc)}</div>` : '';
    const done = subs.filter((st) => st.done).length;
    const items = subs.map((st) =>
      `<li class="${st.done ? 'done' : ''}">
         <button class="subchk ${st.done ? 'on' : ''}" ${interactive ? `data-sub="${q.id}|${st.id}"` : 'disabled'}>${st.done ? '✓' : ''}</button>
         <span>${escapeHtml(st.text)}</span>
       </li>`).join('');
    return `<ul class="subs">${items}</ul><div class="subprog">${done} av ${subs.length} gjort</div>`;
  };
  const questCard = (q, kind) => {
    const overdue = isQuestOverdue(q, today);
    const pts = `<span class="qpts">+${q.points} 🪙</span>`;
    if (kind === 'open') {
      const ready = allSubtasksDone(q);
      return `<div class="qcard ${overdue ? 'over' : ''}">
        <div class="qtop"><b class="qtitle">${escapeHtml(q.title)}</b>${pts}</div>
        ${routineBadge(q)}
        ${subtaskList(q, true)}
        <div class="qmeta">${questDueLabel(q.due, today)}</div>
        <button class="btn qbtn" data-commit="${q.id}" ${ready ? '' : 'disabled'}>${ready ? '🔒 Marker som ferdig' : 'Huk av alle først'}</button>
      </div>`;
    }
    if (kind === 'done') {
      return `<div class="qcard done">
        <div class="qtop"><b class="qtitle">${escapeHtml(q.title)}</b>${pts}</div>
        ${routineBadge(q)}
        ${subtaskList(q, false)}
        <div class="qmeta"><span class="qdue wait">⏳ Sendt til godkjenning</span></div>
        <button class="btn ghost qbtn" data-uncommit="${q.id}">Angre</button>
      </div>`;
    }
    return `<div class="qcard approved">
      <div class="qtop"><b class="qtitle">${escapeHtml(q.title)}</b>${pts}</div>
      ${routineBadge(q)}
      <div class="qmeta"><span class="qdue ok">✅ Godkjent · lagt i potten</span></div>
    </div>`;
  };
```

- [ ] **Step 3: Bind subtask-avkryssing**

I `renderSidequestsPage`, rett etter `[data-uncommit]`-binding-blokka (rad ~581-588), legg til:

```javascript
  host.querySelectorAll('[data-sub]').forEach(
    (b) =>
      (b.onclick = () => {
        const [qid, subId] = b.dataset.sub.split('|');
        App.state = toggleQuestSubtask(App.state, { id: qid, subId, actor: 'son' }, { now: nowIso(), id: newId() });
        save();
        renderSon();
      })
  );
```

- [ ] **Step 4: Legg til `routineDateLabel`-hjelper**

I `js/app.js`, i hjelpere-seksjonen (nær `nowIso`/`newId`, ~rad 45), legg til:

```javascript
function routineDateLabel(iso) {
  if (!iso) return '';
  const wd = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'][new Date(iso + 'T00:00:00').getDay()];
  const [y, m, d] = iso.split('-');
  const mn = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'][Number(m) - 1];
  return `${wd} ${Number(d)}. ${mn}`;
}
```

- [ ] **Step 5: Parse-sjekk app.js**

Kjør parse-sjekk-kommandoen. Forventet: `ReferenceError` om `document` (ikke `SyntaxError`).

- [ ] **Step 6: Kjør logikk-tester (skal fortsatt passere)**

Kjør testkommandoen. Forventet: alle passerer.

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "feat(rutine): sønn-instanskort med avkryssbare subtasks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Forelder-UI – «Daglig rutine»-seksjon i Poeng-fanen

**Files:**
- Modify: `js/app.js` (import ~rad 9; `renderPoengTab` ~rad 1196-1240)

- [ ] **Step 1: Utvid import med `setDailyRoutine`**

I `js/app.js`, legg `setDailyRoutine` til i quest-import-gruppa (samme linje som `addQuest ...`):

```javascript
  addQuest, updateQuest, deleteQuest, commitQuest, uncommitQuest, approveQuest, rejectQuest, toggleQuestSubtask, setDailyRoutine,
```

- [ ] **Step 2: Legg «Daglig rutine»-kort i `renderPoengTab`-HTML**

I `renderPoengTab`, i `host.innerHTML`-malen, legg dette rett FØR `<div id="payoutHost"></div>`:

```javascript
    <div class="sec">Daglig rutine (rydd opp etter skolen)</div>
    <div class="card" id="routineCard">
      <label class="row" style="border:none"><div class="lbl">På hverdager</div>
        <input type="checkbox" id="rtEnabled" ${s.settings.dailyRoutine.enabled ? 'checked' : ''}></label>
      <div class="row"><div class="lbl">Tittel</div>
        <input class="inp" id="rtTitle" style="width:auto;flex:1;text-align:left" value="${escapeHtml(s.settings.dailyRoutine.title)}"></div>
      <div class="row"><div class="lbl">Reward 🪙</div>
        <input class="inp" id="rtPoints" type="number" min="0" value="${s.settings.dailyRoutine.points}"></div>
      <div class="lbl" style="margin:10px 2px 6px">Deloppgaver</div>
      <div id="rtSubs"></div>
      <button class="btn ghost" id="rtAdd" style="margin-top:6px">+ Legg til deloppgave</button>
      <div class="muted" style="font-size:.78rem;margin-top:10px">Endring gjelder neste hverdag. Dagens instans finjusterer du i Quests-fanen.</div>
    </div>
```

- [ ] **Step 3: Legg til rendering + binding for rutine-kortet**

I `renderPoengTab`, rett før `renderPayoutSection(...)`-kallet på slutten, legg til:

```javascript
  // Arbeidskopi av malen (redigeres lokalt, lagres via setDailyRoutine).
  const rt = {
    enabled: s.settings.dailyRoutine.enabled,
    title: s.settings.dailyRoutine.title,
    points: s.settings.dailyRoutine.points,
    subtasks: (s.settings.dailyRoutine.subtasks || []).map((st) => ({ id: st.id, text: st.text })),
  };
  const saveRoutine = () => {
    App.state = setDailyRoutine(App.state, { patch: rt, actor: 'parent' }, { now: nowIso(), id: newId() });
    save();
  };
  const renderSubs = () => {
    const box = document.getElementById('rtSubs');
    box.innerHTML = rt.subtasks.map((st, i) =>
      `<div class="row" style="gap:8px">
         <input class="inp" style="width:auto;flex:1;text-align:left" data-sti="${i}" value="${escapeHtml(st.text)}">
         <button class="link" data-stdel="${i}" style="color:var(--bad)">✕</button>
       </div>`).join('') || '<div class="muted" style="font-size:.8rem">Ingen deloppgaver ennå.</div>';
    box.querySelectorAll('[data-sti]').forEach((inp) => {
      inp.onchange = () => { rt.subtasks[Number(inp.dataset.sti)].text = inp.value; saveRoutine(); };
    });
    box.querySelectorAll('[data-stdel]').forEach((b) => {
      b.onclick = () => { rt.subtasks.splice(Number(b.dataset.stdel), 1); saveRoutine(); renderSubs(); };
    });
  };
  renderSubs();
  document.getElementById('rtEnabled').onchange = (e) => { rt.enabled = e.target.checked; saveRoutine(); };
  document.getElementById('rtTitle').onchange = (e) => { rt.title = e.target.value; saveRoutine(); };
  document.getElementById('rtPoints').onchange = (e) => { rt.points = Number(e.target.value); saveRoutine(); };
  document.getElementById('rtAdd').onclick = () => {
    rt.subtasks.push({ id: newId(), text: '' });
    saveRoutine();
    renderSubs();
  };
```

- [ ] **Step 4: Parse-sjekk app.js**

Kjør parse-sjekk-kommandoen. Forventet: `ReferenceError` om `document` (ikke `SyntaxError`).

- [ ] **Step 5: Kjør logikk-tester (skal fortsatt passere)**

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat(rutine): forelder-editor for daglig rutine i Poeng-fanen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: CSS + APP_VERSION

**Files:**
- Modify: `index.html` (CSS-blokk; `APP_VERSION`)

- [ ] **Step 1: Legg til CSS**

I `index.html`, i `<style>`-blokka (etter `.qcard`-relaterte regler; hvis de ikke finnes, legg nederst i style-blokka):

```css
  .qrec{display:inline-block;font-size:.68rem;font-weight:800;padding:3px 8px;border-radius:999px;background:#122a52;color:#8fb4ff;border:1px solid #2c5db8;margin:2px 0 6px}
  .subs{list-style:none;margin:8px 0 4px;padding:0;display:flex;flex-direction:column;gap:7px}
  .subs li{display:flex;align-items:center;gap:9px;font-size:.92rem}
  .subs li.done span{color:var(--muted);text-decoration:line-through}
  .subchk{width:22px;height:22px;flex:0 0 auto;border-radius:7px;border:2px solid var(--line);background:transparent;color:#04120b;font-size:.8rem;font-weight:800;padding:0}
  .subchk.on{background:var(--good);border-color:var(--good)}
  .subprog{font-size:.76rem;color:var(--muted);margin:2px 2px 0}
```

- [ ] **Step 2: Bump APP_VERSION**

I `index.html`, finn `APP_VERSION`-linja og øk verdien (f.eks. patch/minutt-stempel etter eksisterende mønster).

- [ ] **Step 3: Parse-/testsjekk**

Kjør testkommandoen (forvent PASS) og parse-sjekk app.js.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(rutine): CSS for subtask-checklist + badge, bump APP_VERSION

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Manuell verifisering i localStorage-modus

**Files:** ingen (kun kjøring)

- [ ] **Step 1: Åpne appen lokalt (tom URL = localStorage-modus)**

Åpne `index.html` i nettleser (uten `#r=`). Gå til Forelder → Poeng-fanen.

- [ ] **Step 2: Sett opp malen**

Skru på «På hverdager», sett tittel + reward, legg til 2-3 deloppgaver.

- [ ] **Step 3: Verifiser generering**

Last siden på nytt (så `loadState`→`migrate` kjører). Bytt til Sønn → Sidequests. Forventet på en hverdag: ett kort med 🔁-badge, dato, deloppgaver og låst «Marker som ferdig».

- [ ] **Step 4: Verifiser gating + godkjenning**

Huk av alle deloppgaver → knappen låses opp → «Marker som ferdig». Gå til Forelder → Quests → godkjenn. Verifiser at saldo (topp-logo «Honniscoins: X 🪙») øker med reward.

---

### Task 12: Oppdater dokumentasjon

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Legg til «Daglig rutine»-avsnitt**

Under Sidequests-seksjonen i `CLAUDE.md`, legg til et kort avsnitt: datamodell (`settings.dailyRoutine` + instans-felt `source:'routine'`/`routineDate`/`subtasks`), generering i `migrate` (kun hverdag/i dag, deterministiske id-er, idempotent), `allSubtasksDone`-gating på commit, `toggleQuestSubtask`, `setDailyRoutine`, plassering (sønn-instanskort + forelder-editor i Poeng-fanen), og «future»-punktene (ferie-modus, generelt recurring-system, flerbruker). Referer spec + denne planen.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: dokumenter daglig rutine (gjentakende sidequest)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Push + PR + merge + deploy-verifisering

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/daglig-rutine
```

- [ ] **Step 2: Opprett PR**

```bash
gh pr create --base main --title "Daglig rutine: gjentakende rydd-opp-sidequest med subtasks" --body "Implementerer spec 2026-09-04-honniscoins-daglig-rutine. Mal i settings.dailyRoutine → daglig instans (hverdag) med avkryssbare subtasks, commit-gating, forelder-editor i Poeng-fanen.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Merge**

```bash
gh pr merge feat/daglig-rutine --merge --delete-branch
git switch main && git pull --ff-only
```

- [ ] **Step 4: Verifiser på GitHub Pages**

Vent 1-2 min. Åpne live-URL med cache-buster og bekreft `APP_VERSION` (`index.html`) + at ny logikk er lastet (`js/app.js`/`js/logic.js`). Sett opp malen i et testrom og bekreft generering på en hverdag.

---

## Self-review (utført ved planskriving)

- **Spec-dekning:** Datamodell (T1), allSubtasksDone (T2), setDailyRoutine (T3), generering/hverdag/idempotens/no-backfill (T4), commit-gating (T5), toggleQuestSubtask (T6), instans-redigering (T7), sønn-UI (T8), forelder-editor i Poeng-fanen (T9), CSS (T10), fletting dekkes av eksisterende `mergeQuestList`/settings-LWW + deterministiske id-er (T4), tester (T1-T7), docs + future-punkter (T12). Alle spec-seksjoner har oppgave.
- **Placeholder-scan:** ingen TBD/TODO; all kode er konkret.
- **Type-konsistens:** `settings.dailyRoutine.{enabled,title,points,subtasks:[{id,text}],updatedAt}` og instans `{...quest, source:'routine', routineDate, subtasks:[{id,text,done}]}` er identiske i T1/T3/T4/T7/T8/T9. `allSubtasksDone`, `toggleQuestSubtask`, `setDailyRoutine`, `generateDailyRoutine`, `routineDateLabel` navngis konsistent mellom logic, tester og app.
