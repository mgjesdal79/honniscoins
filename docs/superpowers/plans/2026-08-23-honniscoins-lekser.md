# Lekser – Implementasjonsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Legge til lekser i Honniscoins: forelder registrerer lekser per dag med poeng, sønn ser oversikt (dag/uke) og huker av → forelder godkjenner. Auto-import fra Docendo kommer i fase 2.

**Architecture:** Ren logikk (datamodell, livssyklus, poeng, fletting) i `js/logic.js` som testbare rene funksjoner; DOM/rendering i `js/app.js`; CSS + versjon i `index.html`. Ny topp-nivå liste `homework: []` som flettes LWW-per-id (som `quests`). Docendo-proxy og ICS-parsing er isolert til fase 2 og påvirker ikke fase 1.

**Tech Stack:** Vanilla ES-moduler (no-build), jsc som testrunner, Supabase Edge Function (kun fase 2).

**Prioritet:** Fase 1 (manuell registrering) er viktigst og skal ferdigstilles først, så neste ukes lekser kan legges inn. Fase 2 (Docendo-auto-import) haster ikke.

**Kommandoer:**
- Tester: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
- Parse-sjekk app.js: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js` → `ReferenceError: document` = OK, `SyntaxError` = feil.
- Deploy: branch → `git add <konkrete filer>` → commit (trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`) → push → `gh pr create --base main` → `gh pr merge <branch> --merge --delete-branch` → `git switch main && git pull --ff-only`. (dcg blokkerer push-til-main og `git add -A`.)

---

## Fil-struktur

- `js/logic.js` (modify) — datamodell (`defaultState`), `migrate`, poeng inn i `computeBalance`, homework-livssyklus, `mergeHomeworkList` + kobling i `mergeState`.
- `test/suite.js` (modify) — nye tester for homework-logikk.
- `js/app.js` (modify) — import av nye fn, `App.homeworkView`, lekse-seksjon i `renderUkenPage` (sønn), lekse-UI i `renderDayBody` (forelder), pending-linje i Poeng, logg-håndtering av `type:'homework'`.
- `index.html` (modify) — CSS for lekser (gjenbruk fra `mockups/lekser-v2.html`), bump `APP_VERSION`.
- `CLAUDE.md` (modify) — dokumentere lekser (til slutt).

**Fase 2 (senere):**
- `supabase/docendo-proxy/index.ts` (create) — CORS-proxy edge function.
- `js/logic.js` (modify) — `parseIcs`, `homeworkFromIcs`, `mergeHomeworkImport`.
- `test/suite.js` (modify) — ICS-parse/import-tester.
- `js/app.js` + `index.html` (modify) — «Hent lekser fra Docendo»-knapp + `DOCENDO_PROXY_URL`.

---

# FASE 1 – Manuell registrering (prioritet)

## Task 1: Datamodell + migrering i logic.js

**Files:**
- Modify: `js/logic.js` (`defaultState` ~rad 26-43, `migrate` ~rad 419-442)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

Legg til i `test/suite.js` (i eksisterende `runTests`-oppsett, samme stil som andre tester):

```js
// --- Lekser: datamodell + migrering ---
test('defaultState har homework og homework-innstillinger', () => {
  const s = L.defaultState();
  assert(Array.isArray(s.homework), 'homework er en liste');
  assertEq(s.homework.length, 0);
  assertEq(s.settings.homeworkPoints, 5);
  assert(typeof s.settings.docendoIcalId === 'string', 'docendoIcalId finnes');
});

test('migrate fyller homework og homework-innstillinger', () => {
  const bare = { settings: {}, days: {}, log: [] };
  const s = L.migrate(bare, '2026-08-24');
  assert(Array.isArray(s.homework), 'homework fylt');
  assertEq(s.settings.homeworkPoints, 5);
  assert(typeof s.settings.docendoIcalId === 'string', 'docendoIcalId fylt');
});
```

- [ ] **Step 2: Kjør testen – verifiser at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL (homework mangler i defaultState/migrate).

- [ ] **Step 3: Implementer**

I `defaultState()` (`js/logic.js`), legg til i `settings`-objektet (etter `bonus`-linja):

```js
      homeworkPoints: 5,
      docendoIcalId: '519a0908-ed7d-47ed-8667-dea07343b693',
```

og legg til i det returnerte state-objektet (etter `quests: [],`):

```js
    homework: [],
```

I `migrate()` (etter `if (!Array.isArray(s.quests)) s.quests = [];`), legg til:

```js
  if (!Array.isArray(s.homework)) s.homework = [];
  if (s.settings.homeworkPoints == null) s.settings.homeworkPoints = 5;
  if (!s.settings.docendoIcalId) s.settings.docendoIcalId = '519a0908-ed7d-47ed-8667-dea07343b693';
```

- [ ] **Step 4: Kjør testen – verifiser at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS (alle tester grønne).

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat: homework-datamodell + migrering"
```

---

## Task 2: Homework-utvalg og poeng i logic.js

**Files:**
- Modify: `js/logic.js` (ny seksjon etter Sidequests-blokken; `computeBalance` ~rad 62-70)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```js
// --- Lekser: utvalg + poeng ---
const HW_CTX = (n, id) => ({ now: n, id });
function stateWithHomework(items) {
  const s = L.defaultState();
  s.homework = items;
  return s;
}
test('activeHomework filtrerer bort removed', () => {
  const s = stateWithHomework([
    { id: 'a', removed: false, status: 'open' },
    { id: 'b', removed: true, status: 'open' },
  ]);
  assertEq(L.activeHomework(s).length, 1);
  assertEq(L.activeHomework(s)[0].id, 'a');
});
test('homeworkPointsTotal teller kun approved og ikke-skjulte', () => {
  const s = stateWithHomework([
    { id: 'a', status: 'approved', points: 10, hidden: false },
    { id: 'b', status: 'approved', points: 5, hidden: true },
    { id: 'c', status: 'done', points: 7, hidden: false },
  ]);
  assertEq(L.homeworkPointsTotal(s), 10);
});
test('homeworkPointsPending teller kun done og ikke-skjulte', () => {
  const s = stateWithHomework([
    { id: 'a', status: 'done', points: 5, hidden: false },
    { id: 'b', status: 'done', points: 3, hidden: true },
    { id: 'c', status: 'approved', points: 9, hidden: false },
  ]);
  assertEq(L.homeworkPointsPending(s), 5);
});
test('computeBalance inkluderer approved lekser', () => {
  const s = stateWithHomework([{ id: 'a', status: 'approved', points: 8, hidden: false }]);
  assertEq(L.computeBalance(s), 8);
});
test('homeworkForWeek gir ikke-skjulte lekser i uka, sortert på dato', () => {
  const s = stateWithHomework([
    { id: 'a', date: '2026-08-25', status: 'open', hidden: false, removed: false },
    { id: 'b', date: '2026-08-24', status: 'open', hidden: false, removed: false },
    { id: 'c', date: '2026-08-24', status: 'open', hidden: true, removed: false },
    { id: 'd', date: '2026-09-01', status: 'open', hidden: false, removed: false },
  ]);
  const wk = L.homeworkForWeek(s, '2026-08-24');
  assertEq(wk.map((h) => h.id).join(','), 'b,a');
});
```

- [ ] **Step 2: Kjør testen – verifiser at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL (funksjonene finnes ikke).

- [ ] **Step 3: Implementer**

Legg til øverst i en ny `// --- Lekser ---`-seksjon i `js/logic.js` (f.eks. rett etter `mergeQuestList` på slutten, eller etter Sidequests-blokken):

```js
// --- Lekser (homework) ---------------------------------------------------
// status: 'open' -> (sønn) 'done' -> (forelder) 'approved'.
// Poeng teller kun ved 'approved' og hidden !== true. Sletting = removed-tombstone.

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
```

I `computeBalance` (rad 62-70), legg til `homeworkPointsTotal(state) +` i summen:

```js
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
```

- [ ] **Step 4: Kjør testen – verifiser at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat: homework-utvalg + poeng i saldo"
```

---

## Task 3: Homework-livssyklus (forelder-mutasjoner) i logic.js

**Files:**
- Modify: `js/logic.js` (lekser-seksjonen)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```js
// --- Lekser: forelder-mutasjoner ---
test('addHomework oppretter open lekse med default poeng', () => {
  const s0 = L.defaultState();
  const s = L.addHomework(s0, { date: '2026-08-24', subject: 'Tysk', text: 'Øv tall 0-20' }, HW_CTX('2026-08-24T10:00:00Z', 'h1'));
  assertEq(s.homework.length, 1);
  const h = s.homework[0];
  assertEq(h.id, 'h1');
  assertEq(h.status, 'open');
  assertEq(h.points, 5);
  assertEq(h.source, 'manual');
  assertEq(h.wholeWeek, false);
  assertEq(h.hidden, false);
  assertEq(h.edited, false);
  assertEq(h.removed, false);
  assertEq(s.log[s.log.length - 1].type, 'homework');
});
test('addHomework respekterer eksplisitt poeng og wholeWeek', () => {
  const s = L.addHomework(L.defaultState(), { date: '2026-08-24', subject: 'KRLE', text: 'x', points: 10, wholeWeek: true }, HW_CTX('t', 'h2'));
  assertEq(s.homework[0].points, 10);
  assertEq(s.homework[0].wholeWeek, true);
});
test('updateHomework endrer felt og setter edited=true', () => {
  let s = L.addHomework(L.defaultState(), { date: '2026-08-24', subject: 'Tysk', text: 'a' }, HW_CTX('t', 'h1'));
  s = L.updateHomework(s, { id: 'h1', patch: { text: 'b', points: 7, wholeWeek: true } }, HW_CTX('t2', 'log1'));
  assertEq(s.homework[0].text, 'b');
  assertEq(s.homework[0].points, 7);
  assertEq(s.homework[0].wholeWeek, true);
  assertEq(s.homework[0].edited, true);
});
test('deleteHomework setter removed-tombstone', () => {
  let s = L.addHomework(L.defaultState(), { date: '2026-08-24', subject: 'Tysk', text: 'a' }, HW_CTX('t', 'h1'));
  s = L.deleteHomework(s, { id: 'h1' }, HW_CTX('t2', 'log1'));
  assertEq(s.homework[0].removed, true);
  assertEq(L.activeHomework(s).length, 0);
});
test('hideHomework skjuler og viser igjen', () => {
  let s = L.addHomework(L.defaultState(), { date: '2026-08-24', subject: 'Tysk', text: 'a' }, HW_CTX('t', 'h1'));
  s = L.hideHomework(s, { id: 'h1', hidden: true }, HW_CTX('t2', 'log1'));
  assertEq(s.homework[0].hidden, true);
  s = L.hideHomework(s, { id: 'h1', hidden: false }, HW_CTX('t3', 'log2'));
  assertEq(s.homework[0].hidden, false);
});
```

- [ ] **Step 2: Kjør testen – verifiser at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL.

- [ ] **Step 3: Implementer**

Legg til i lekser-seksjonen i `js/logic.js`:

```js
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
```

- [ ] **Step 4: Kjør testen – verifiser at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat: homework forelder-livssyklus (add/update/delete/hide)"
```

---

## Task 4: Homework-livssyklus (sønn/godkjenning) i logic.js

**Files:**
- Modify: `js/logic.js` (lekser-seksjonen)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```js
// --- Lekser: sønn + godkjenning ---
function oneOpenHw() {
  return L.addHomework(L.defaultState(), { date: '2026-08-24', subject: 'Tysk', text: 'a' }, HW_CTX('t', 'h1'));
}
test('commitHomework: open -> done', () => {
  let s = oneOpenHw();
  s = L.commitHomework(s, { id: 'h1' }, HW_CTX('t2', 'l1'));
  assertEq(s.homework[0].status, 'done');
  assertEq(s.homework[0].doneAt, 't2');
});
test('uncommitHomework: done -> open', () => {
  let s = L.commitHomework(oneOpenHw(), { id: 'h1' }, HW_CTX('t2', 'l1'));
  s = L.uncommitHomework(s, { id: 'h1' }, HW_CTX('t3', 'l2'));
  assertEq(s.homework[0].status, 'open');
  assertEq(s.homework[0].doneAt, null);
});
test('approveHomework: done -> approved gir poeng', () => {
  let s = L.commitHomework(oneOpenHw(), { id: 'h1' }, HW_CTX('t2', 'l1'));
  s = L.approveHomework(s, { id: 'h1' }, HW_CTX('t3', 'l2'));
  assertEq(s.homework[0].status, 'approved');
  assertEq(s.homework[0].approvedAt, 't3');
  assertEq(L.homeworkPointsTotal(s), 5);
});
test('rejectHomework: done -> open', () => {
  let s = L.commitHomework(oneOpenHw(), { id: 'h1' }, HW_CTX('t2', 'l1'));
  s = L.rejectHomework(s, { id: 'h1' }, HW_CTX('t3', 'l2'));
  assertEq(s.homework[0].status, 'open');
  assertEq(s.homework[0].doneAt, null);
});
```

- [ ] **Step 2: Kjør testen – verifiser at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL.

- [ ] **Step 3: Implementer**

Legg til i lekser-seksjonen i `js/logic.js`:

```js
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
```

- [ ] **Step 4: Kjør testen – verifiser at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat: homework sønn-livssyklus + godkjenning"
```

---

## Task 5: Fletting av homework i mergeState

**Files:**
- Modify: `js/logic.js` (`mergeState` ~rad 679-736, ny `mergeHomeworkList` ved siden av `mergeQuestList`)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```js
// --- Lekser: fletting (LWW per id) ---
test('mergeState fletter homework LWW per id', () => {
  const a = L.defaultState();
  a.homework = [{ id: 'h1', status: 'open', points: 5, updatedAt: '2026-08-24T09:00:00Z', removed: false }];
  const b = L.defaultState();
  b.homework = [
    { id: 'h1', status: 'done', points: 5, updatedAt: '2026-08-24T10:00:00Z', removed: false }, // nyere vinner
    { id: 'h2', status: 'open', points: 5, updatedAt: '2026-08-24T08:00:00Z', removed: false }, // kun i b
  ];
  const m = L.mergeState(a, b);
  const byId = Object.fromEntries(m.homework.map((h) => [h.id, h]));
  assertEq(byId.h1.status, 'done');
  assert(byId.h2, 'h2 tatt med');
});
test('mergeState bevarer removed-tombstone for homework', () => {
  const a = L.defaultState();
  a.homework = [{ id: 'h1', status: 'open', updatedAt: '2026-08-24T09:00:00Z', removed: false }];
  const b = L.defaultState();
  b.homework = [{ id: 'h1', status: 'open', updatedAt: '2026-08-24T10:00:00Z', removed: true }];
  const m = L.mergeState(a, b);
  assertEq(m.homework.find((h) => h.id === 'h1').removed, true);
});
```

- [ ] **Step 2: Kjør testen – verifiser at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL (homework flettes ikke ennå).

- [ ] **Step 3: Implementer**

I `mergeState`, etter quests-linja (`if (local.quests || remote.quests) out.quests = mergeQuestList(...)`), legg til:

```js
  // homework: LWW per id på updatedAt (som quests)
  if (local.homework || remote.homework) out.homework = mergeHomeworkList(local.homework, remote.homework);
```

Og legg til en ny funksjon ved siden av `mergeQuestList`:

```js
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
```

- [ ] **Step 4: Kjør testen – verifiser at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat: fletting av homework (LWW per id)"
```

---

## Task 6: CSS for lekser i index.html

**Files:**
- Modify: `index.html` (CSS-blokk + `APP_VERSION`)

- [ ] **Step 1: Legg til CSS**

Finn `<style>`-blokken i `index.html` og legg til (gjenbruk klassenavn fra `mockups/lekser-v2.html` slik at markup blir enkelt; juster kun der eksisterende klasser kolliderer):

```css
/* Lekser */
.hwsec{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:16px 2px 8px;font-weight:800;display:flex;align-items:center;gap:6px}
.hwseg{display:flex;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:3px;margin:10px 0 4px}
.hwseg .s{flex:1;text-align:center;padding:7px 2px;border-radius:8px;font-size:.78rem;font-weight:800;color:var(--muted);background:transparent;border:none;font-family:inherit}
.hwseg .s.on{background:var(--accent);color:#fff}
.hwcard{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:10px 12px;margin-bottom:9px}
.hwcard.done{border-color:var(--gold)}
.hwcard.approved{opacity:.6}
.hwtop{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.hwsubj{font-weight:800;font-size:.95rem}
.hwtext{color:var(--muted);font-size:.85rem;margin:5px 0 9px;line-height:1.4}
.hwpts{flex:none;background:#152c1f;color:var(--good);border:1px solid var(--good);border-radius:10px;padding:2px 8px;font-weight:800;font-size:.78rem;white-space:nowrap}
.weektag{font-size:.66rem;color:#c3b9ff;font-weight:800;background:#171438;border:1px solid #3a2f7a;border-radius:7px;padding:1px 6px;white-space:nowrap;margin-left:6px}
.hwdaytag{font-size:.68rem;color:var(--muted);font-weight:700;background:var(--surface-2);border:1px solid var(--line);border-radius:7px;padding:1px 6px;margin-left:6px}
.hwedited{font-size:.66rem;color:#c3b9ff;font-weight:800;background:#171438;border:1px solid #3a2f7a;border-radius:7px;padding:1px 6px}
.hwsubjhead{display:flex;align-items:center;gap:7px;margin:14px 2px 7px;font-weight:800;font-size:.95rem}
```

Bruk eksisterende `.btn`, `.btn.ghost`, `.muted`, `.card`, `.inp` som allerede finnes i index.html. Hvis `.hwcard`/`.hwtop`/`.hwtext` allerede skulle finnes fra tidligere, la de eksisterende stå og hopp over duplikatene.

- [ ] **Step 2: Bump APP_VERSION**

Finn `window.APP_VERSION` og sett ny verdi:

```js
window.APP_VERSION = '2026.08.23 (b17 · Lekser)';
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "style: CSS for lekser + bump APP_VERSION b17"
```

---

## Task 7: Import + App-state for lekser i app.js

**Files:**
- Modify: `js/app.js` (import-blokk rad 2, `App`-objekt rad 16)

- [ ] **Step 1: Utvid import fra logic.js**

Legg til disse navnene i `import { ... } from './logic.js';` (rad 2-…):

```
homeworkForWeek, homeworkPointsPending, activeHomework,
addHomework, updateHomework, deleteHomework, hideHomework,
commitHomework, uncommitHomework, approveHomework, rejectHomework,
```

- [ ] **Step 2: Legg til visnings-state**

I `App`-objektet (rad 16-…), legg til felt:

```js
  homeworkView: 'day', // 'day' | 'week' – sønn Uken-lekser
  editHwId: null,      // forelder redigerer lekse
```

- [ ] **Step 3: Parse-sjekk**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: document ...` (import/syntaks OK). Hvis `SyntaxError`: rett før videre.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: importer homework-fn + App-state for lekser"
```

---

## Task 8: Sønn – lekse-seksjon i «Uken» (dag/uke-toggle, hele-uka-merke, commit)

**Files:**
- Modify: `js/app.js` (`renderUkenPage` ~rad 223-350)

- [ ] **Step 1: Legg til en hjelpe-renderer for lekser**

Legg til en ny funksjon rett før `renderUkenPage` i `js/app.js`:

```js
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
    if (h.status === 'open') action = `<button class="btn good" data-hwdone="${h.id}">✓ Gjort</button>`;
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
```

- [ ] **Step 2: Sett inn seksjonen i markup**

I `renderUkenPage`, i `host.innerHTML`-malen, legg til lekse-seksjonen inne i `<div class="activeday">`, rett etter `<div style="margin-top:14px">${lockBtn}</div>` og før `${closeWeekBtn}`:

```js
      ${homeworkSectionHtml(s, date, App.homeworkView)}
```

- [ ] **Step 3: Bind hendelser**

Nederst i `renderUkenPage` (etter de eksisterende `document.getElementById(...)`-bindingene, f.eks. rett før funksjonens `}`), legg til:

```js
  host.querySelectorAll('[data-hwview]').forEach((b) => (b.onclick = () => { App.homeworkView = b.dataset.hwview; renderSon(); }));
  host.querySelectorAll('[data-hwdone]').forEach((b) => (b.onclick = () => {
    App.state = commitHomework(App.state, { id: b.dataset.hwdone }, { now: nowIso(), id: newId() });
    save(); renderSon();
  }));
  host.querySelectorAll('[data-hwundo]').forEach((b) => (b.onclick = () => {
    App.state = uncommitHomework(App.state, { id: b.dataset.hwundo }, { now: nowIso(), id: newId() });
    save(); renderSon();
  }));
```

- [ ] **Step 4: Parse-sjekk**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: document` (OK). Rett evt. `SyntaxError`.

- [ ] **Step 5: Manuell røyktest (valgfritt, i nettleser)**

Åpne `test/tests.html` eller appen lokalt; bekreft at Uken viser lekse-seksjon når det finnes lekser og at toggle bytter dag/uke.

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat: sønn ser lekser i Uken (dag/uke-toggle, hele-uka-merke, gjort)"
```

---

## Task 9: Forelder – lekse-UI i «Dag»-fanen (add/rediger/poeng/skjul/slett + godkjenning)

**Files:**
- Modify: `js/app.js` (`renderDayBody` ~rad 656-744)

- [ ] **Step 1: Les gjeldende renderDayBody**

Åpne `js/app.js` rad 656-744 for å se hvor dagens innhold rendres og hvilken variabel som holder valgt dato (samme mønster som `renderUkenPage`: `App.currentDate`).

- [ ] **Step 2: Legg til en forelder-lekse-renderer**

Legg til en funksjon rett før `renderDayBody`:

```js
// Forelder: HTML for lekse-administrasjon på valgt dag.
function parentHomeworkHtml(s, date) {
  const all = activeHomework(s).filter((h) => h.date === date);
  const pending = activeHomework(s).filter((h) => h.status === 'done');

  const pendingHtml = pending.length
    ? `<div class="hwsec">⏳ Til godkjenning <span class="badge">${pending.length}</span></div>` +
      pending.map((h) => `<div class="hwcard done">
        <div class="hwtop"><span class="hwsubj">${escapeHtml(h.subject)}</span><span class="hwpts">+${h.points} 🪙</span></div>
        ${h.text ? `<div class="hwtext">${escapeHtml(h.text)}</div>` : ''}
        <div style="display:flex;gap:8px">
          <button class="btn good" data-hwapprove="${h.id}" style="flex:1">✓ Godkjenn</button>
          <button class="btn ghost" data-hwreject="${h.id}" style="flex:1">↩︎ Send tilbake</button>
        </div></div>`).join('')
    : '';

  const editing = App.editHwId ? all.find((h) => h.id === App.editHwId) : null;
  const editForm = editing
    ? `<div class="hwsec">✏️ Rediger lekse ${editing.edited ? '<span class="hwedited">endret – beskyttet</span>' : ''}</div>
       <div class="hwcard">
         <input class="inp" id="hwSubject" value="${escapeHtml(editing.subject)}" placeholder="Fag">
         <textarea class="inp" id="hwText" placeholder="Beskrivelse">${escapeHtml(editing.text)}</textarea>
         <label class="muted" style="display:block;margin:2px 0 8px">Poeng <input class="inp" id="hwPoints" type="number" value="${editing.points}" style="width:80px;display:inline-block"></label>
         <label class="muted" style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><input type="checkbox" id="hwWeek" ${editing.wholeWeek ? 'checked' : ''}> 🗓 Gjelder hele uka</label>
         <div style="display:flex;gap:8px">
           <button class="btn" id="hwSave" style="flex:1">💾 Lagre</button>
           <button class="btn ghost" id="hwCancel" style="flex:1">Avbryt</button>
         </div>
       </div>`
    : `<div class="hwsec">➕ Legg til lekse</div>
       <div class="hwcard">
         <input class="inp" id="hwNewSubject" placeholder="Fag (f.eks. Tysk)">
         <textarea class="inp" id="hwNewText" placeholder="Hva skal gjøres?"></textarea>
         <label class="muted" style="display:block;margin:2px 0 8px">Poeng <input class="inp" id="hwNewPoints" type="number" value="${s.settings.homeworkPoints ?? 5}" style="width:80px;display:inline-block"></label>
         <label class="muted" style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><input type="checkbox" id="hwNewWeek"> 🗓 Gjelder hele uka</label>
         <button class="btn" id="hwAdd">➕ Legg til på ${fmtDayLabel(date).dm}</button>
       </div>`;

  const listHtml = all.length
    ? `<div class="hwsec">📚 Lekser · ${fmtDayLabel(date).dm}</div>` +
      all.map((h) => `<div class="hwcard${h.hidden ? ' approved' : ''}">
        <div class="hwtop"><span class="hwsubj">${escapeHtml(h.subject)}${h.wholeWeek ? '<span class="weektag">🗓 hele uka</span>' : ''}${h.hidden ? '<span class="hwdaytag">skjult</span>' : ''}</span><span class="hwpts">+${h.points} 🪙</span></div>
        ${h.text ? `<div class="hwtext">${escapeHtml(h.text)}</div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn ghost" data-hwedit="${h.id}">✏️ Rediger</button>
          <button class="btn ghost" data-hwhide="${h.id}" data-hidden="${h.hidden ? '1' : '0'}">${h.hidden ? '👁 Vis' : '🙈 Skjul'}</button>
          <button class="btn ghost" data-hwdel="${h.id}">🗑 Slett</button>
        </div></div>`).join('')
    : `<div class="muted" style="margin:2px">Ingen lekser på denne dagen ennå.</div>`;

  return `${pendingHtml}${editForm}${listHtml}`;
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
    save(); renderParentHome();
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
    save(); renderParentHome();
  };
  const cancel = host.querySelector('#hwCancel');
  if (cancel) cancel.onclick = () => { App.editHwId = null; renderParentHome(); };
  host.querySelectorAll('[data-hwedit]').forEach((b) => (b.onclick = () => { App.editHwId = b.dataset.hwedit; renderParentHome(); }));
  host.querySelectorAll('[data-hwdel]').forEach((b) => (b.onclick = () => {
    App.state = deleteHomework(App.state, { id: b.dataset.hwdel }, { now: nowIso(), id: newId() });
    save(); renderParentHome();
  }));
  host.querySelectorAll('[data-hwhide]').forEach((b) => (b.onclick = () => {
    App.state = hideHomework(App.state, { id: b.dataset.hwhide, hidden: b.dataset.hidden !== '1' }, { now: nowIso(), id: newId() });
    save(); renderParentHome();
  }));
  host.querySelectorAll('[data-hwapprove]').forEach((b) => (b.onclick = () => {
    App.state = approveHomework(App.state, { id: b.dataset.hwapprove }, { now: nowIso(), id: newId() });
    save(); renderParentHome();
  }));
  host.querySelectorAll('[data-hwreject]').forEach((b) => (b.onclick = () => {
    App.state = rejectHomework(App.state, { id: b.dataset.hwreject }, { now: nowIso(), id: newId() });
    save(); renderParentHome();
  }));
}
```

- [ ] **Step 3: Kall renderer + binding i renderDayBody**

I `renderDayBody`, finn stedet der dagens `host.innerHTML` settes. Legg lekse-blokken til på slutten av den eksisterende malen (bruk samme dato-variabel som funksjonen bruker for valgt dag – kall den `date` her):

```js
  // …eksisterende innhold… deretter:
  host.insertAdjacentHTML('beforeend', parentHomeworkHtml(App.state, date));
```

Hvis `renderDayBody` bygger `innerHTML` som én streng, legg i stedet `${parentHomeworkHtml(App.state, date)}` til i malen. Etter at DOM er satt, kall bindingen sammen med de andre `bind*`-kallene i funksjonen:

```js
  bindParentHomework(host, date);
```

- [ ] **Step 4: Parse-sjekk**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: document` (OK). Rett `SyntaxError` om nødvendig.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: forelder administrerer lekser i Dag-fanen"
```

---

## Task 10: Poeng-side viser ventende lekse-poeng + logg-håndtering

**Files:**
- Modify: `js/app.js` (`renderPoengPage` ~rad 353, `renderLoggTab` ~rad 1068)

- [ ] **Step 1: Vis ventende lekse-poeng**

I `renderPoengPage` (sønn) og/eller `renderPoengTab` (forelder), der `questPointsPending` allerede vises, legg til en tilsvarende linje. Finn den eksisterende quests-pending-linja og legg ved siden:

```js
  const hwPending = homeworkPointsPending(s);
```

og i malen, der quest-pending vises:

```js
  ${hwPending ? `<div class="muted">⏳ Lekser til godkjenning: +${hwPending} 🪙</div>` : ''}
```

(Importer `homeworkPointsPending` – gjort i Task 7.)

- [ ] **Step 2: Håndter homework i loggen**

I `renderLoggTab`, der `e.type === 'quest'` håndteres, legg til en gren for `e.type === 'homework'`:

```js
    if (e.type === 'homework') {
      const labels = { create: 'la til lekse', edit: 'endret lekse', delete: 'slettet lekse', hide: 'skjulte lekse', show: 'viste lekse', done: 'meldte ferdig', undo: 'angret ferdig', approve: 'godkjente lekse', reject: 'sendte tilbake' };
      return `${escapeHtml(e.subject || 'Lekse')} – ${labels[e.action] || e.action}${e.points ? ` (+${e.points} 🪙)` : ''}`;
    }
```

Tilpass returformatet til den faktiske strukturen i `renderLoggTab` (returner samme type verdi som quest-grenen gjør – ren tekst eller HTML-fragment).

- [ ] **Step 3: Parse-sjekk**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: document` (OK).

- [ ] **Step 4: Kjør alle tester**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS (alle grønne).

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: ventende lekse-poeng på Poeng-siden + logg for lekser"
```

---

## Task 11: Deploy fase 1 + verifiser live

**Files:** (ingen nye endringer – deploy av det som er committet)

- [ ] **Step 1: Push branch + PR**

```bash
git push -u origin feat/lekser
gh pr create --base main --title "feat: lekser (manuell registrering, fase 1)" --body "$(cat <<'EOF'
Lekser fase 1: forelder registrerer lekser per dag med poeng (Dag-fanen), sønn ser oversikt i Uken (dag/uke-toggle, «🗓 hele uka»-merke) og huker av → forelder godkjenner. Poeng teller kun ved godkjenning. Docendo-auto-import kommer i fase 2.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Merge + synk main**

```bash
gh pr merge feat/lekser --merge --delete-branch && git switch main && git pull --ff-only
```

- [ ] **Step 3: Verifiser live (etter ~1-2 min Pages-cache)**

Åpne appen, sjekk `APP_VERSION = b17`, legg til en lekse som forelder på en dag neste uke, bytt til sønn, se at leksen vises i Uken, huk av «Gjort», godkjenn som forelder, bekreft at saldo øker. Bruk cache-buster ved behov: `?cb=<tall>`.

- [ ] **Step 4: Oppdater CLAUDE.md**

Legg til en «## Lekser»-seksjon (etter «## Sidequests») som dokumenterer datamodell (`homework[]`), poeng kun ved `approved`, LWW-per-id fletting, sønn Uken-integrasjon med dag/uke-toggle + «hele uka»-merke, forelder Dag-fane, og at Docendo-import er fase 2. Oppdater testantall. Deploy CLAUDE.md via egen branch/PR.

---

# FASE 2 – Docendo-auto-import (haster ikke)

> Bygges etter at fase 1 er i produksjon og verifisert. Isolert fra fase 1: alt legger seg oppå eksisterende `homework[]`.

## Task 12: docendo-proxy edge function

**Files:**
- Create: `supabase/docendo-proxy/index.ts`

- [ ] **Step 1: Skriv proxyen**

```ts
// Supabase Edge Function: docendo-proxy
// CORS-proxy for Docendo ICS-feed. Whitelister host for å unngå åpen proxy.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { ical_id } = await req.json();
    if (!ical_id || !/^[a-f0-9-]{36}$/i.test(ical_id)) {
      return new Response(JSON.stringify({ error: 'ugyldig ical_id' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } });
    }
    const url = `https://app.docendo.no/calendars/ical/${ical_id}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Honniscoins/1.0' } });
    if (!r.ok) {
      return new Response(JSON.stringify({ error: `docendo ${r.status}` }), { status: 502, headers: { ...CORS, 'content-type': 'application/json' } });
    }
    const text = await r.text();
    return new Response(JSON.stringify({ ics: text }), { headers: { ...CORS, 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/docendo-proxy/index.ts
git commit -m "feat: docendo-proxy edge function (CORS, host-whitelist)"
```

- [ ] **Step 3: Deploy (bruker gjør dette selv)**

Dokumentér i PR-teksten: `supabase functions deploy docendo-proxy` og noter funksjons-URL. URL settes i `index.html` som `window.DOCENDO_PROXY_URL` i Task 15.

---

## Task 13: parseIcs + homeworkFromIcs i logic.js

**Files:**
- Modify: `js/logic.js` (lekser-seksjonen)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```js
// --- Lekser: ICS-parsing ---
const ICS_SAMPLE = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:evt-1@docendo',
  'DTSTART:20260824T061000Z',
  'SUMMARY:Tysk\\, 8B',
  'DESCRIPTION:Kunne hilse. Tall 0-20.',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:evt-2@docendo',
  'DTSTART:20260824T080000Z',
  'SUMMARY:Lunsj\\, 8B',
  'DESCRIPTION:',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:evt-3@docendo',
  'DTSTART:20260826T090000Z',
  'SUMMARY:KRLE\\, 8B',
  'DESCRIPTION:Gjør ferdig',
  ' forklaringene.',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseIcs unfolder og unescaper events', () => {
  const evts = L.parseIcs(ICS_SAMPLE);
  assertEq(evts.length, 3);
  assertEq(evts[0].summary, 'Tysk, 8B');
  assertEq(evts[2].description, 'Gjør ferdig forklaringene.'); // foldet linje slått sammen
});
test('homeworkFromIcs tar kun events med ikke-tom forberedelse i intervall', () => {
  const hw = L.homeworkFromIcs(ICS_SAMPLE, { from: '2026-08-24', to: '2026-08-28' });
  assertEq(hw.length, 2); // Lunsj (tom description) filtrert bort
  assertEq(hw[0].date, '2026-08-24');
  assertEq(hw[0].subject, 'Tysk');
  assertEq(hw[0].docendoUid, 'evt-1@docendo');
  assertEq(hw[1].subject, 'KRLE');
});
test('homeworkFromIcs respekterer datointervall', () => {
  const hw = L.homeworkFromIcs(ICS_SAMPLE, { from: '2026-08-24', to: '2026-08-25' });
  assertEq(hw.length, 1); // KRLE 26. utenfor
  assertEq(hw[0].subject, 'Tysk');
});
```

- [ ] **Step 2: Kjør testen – verifiser at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL.

- [ ] **Step 3: Implementer**

Legg til i lekser-seksjonen i `js/logic.js`:

```js
// Slå sammen foldede ICS-linjer (fortsettelse starter med mellomrom/tab).
function unfoldIcs(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}
function unescapeIcs(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
function stripHtml(s) {
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

// Parser ICS-tekst til events {uid, start('YYYYMMDD...'), date('YYYY-MM-DD'), summary, description}.
export function parseIcs(text) {
  const lines = unfoldIcs(text).split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const rawKey = line.slice(0, idx);
    const key = rawKey.split(';')[0].toUpperCase();
    const val = unescapeIcs(line.slice(idx + 1));
    if (key === 'UID') cur.uid = val;
    else if (key === 'DTSTART') { cur.start = val; cur.date = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`; }
    else if (key === 'SUMMARY') cur.summary = val;
    else if (key === 'DESCRIPTION') cur.description = stripHtml(val);
  }
  return events;
}

// Fag fra SUMMARY "Fag, 8B" -> "Fag".
function subjectFromSummary(summary) {
  return String(summary || '').split(',')[0].trim();
}

// Lekse-kandidater fra ICS i [from, to] (inklusiv) med ikke-tom forberedelse.
export function homeworkFromIcs(text, { from, to }) {
  return parseIcs(text)
    .filter((e) => e.date && e.description && e.description.trim() !== '')
    .filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
    .map((e) => ({ docendoUid: e.uid, date: e.date, subject: subjectFromSummary(e.summary), text: e.description }))
    .sort((a, b) => (a.date === b.date ? a.subject.localeCompare(b.subject) : a.date < b.date ? -1 : 1));
}
```

- [ ] **Step 4: Kjør testen – verifiser at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat: parseIcs + homeworkFromIcs (Docendo)"
```

---

## Task 14: mergeHomeworkImport (idempotent, trygg re-import)

**Files:**
- Modify: `js/logic.js` (lekser-seksjonen)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```js
// --- Lekser: import-fletting ---
const IMP = [
  { docendoUid: 'u1', date: '2026-08-24', subject: 'Tysk', text: 'A' },
  { docendoUid: 'u2', date: '2026-08-25', subject: 'Mat', text: 'B' },
];
test('mergeHomeworkImport legger til nye lekser som open', () => {
  const s = L.mergeHomeworkImport(L.defaultState(), IMP, HW_CTX('t', 'imp'));
  assertEq(L.activeHomework(s).length, 2);
  assertEq(s.homework[0].status, 'open');
  assertEq(s.homework[0].source, 'docendo');
  assertEq(s.homework[0].points, 5);
});
test('mergeHomeworkImport er idempotent (samme uid to ganger)', () => {
  let s = L.mergeHomeworkImport(L.defaultState(), IMP, HW_CTX('t', 'imp'));
  s = L.mergeHomeworkImport(s, IMP, HW_CTX('t2', 'imp2'));
  assertEq(L.activeHomework(s).length, 2);
});
test('mergeHomeworkImport bevarer status/poeng/hidden ved re-import', () => {
  let s = L.mergeHomeworkImport(L.defaultState(), IMP, HW_CTX('t', 'imp'));
  const id = s.homework[0].id;
  s = L.approveHomework(s, { id }, HW_CTX('t1', 'a'));
  s = L.updateHomework(s, { id, patch: { points: 20 } }, HW_CTX('t1b', 'u'));
  s = L.mergeHomeworkImport(s, IMP, HW_CTX('t2', 'imp2'));
  const h = s.homework.find((x) => x.docendoUid === 'u1');
  assertEq(h.status, 'approved');
  assertEq(h.points, 20);
});
test('mergeHomeworkImport lar edited tekst stå urørt', () => {
  let s = L.mergeHomeworkImport(L.defaultState(), IMP, HW_CTX('t', 'imp'));
  const id = s.homework[0].id;
  s = L.updateHomework(s, { id, patch: { text: 'MIN TEKST' } }, HW_CTX('t1', 'u'));
  const changed = [{ docendoUid: 'u1', date: '2026-08-24', subject: 'Tysk', text: 'NY DOCENDO-TEKST' }];
  s = L.mergeHomeworkImport(s, changed, HW_CTX('t2', 'imp2'));
  assertEq(s.homework.find((x) => x.docendoUid === 'u1').text, 'MIN TEKST');
});
test('mergeHomeworkImport oppdaterer uendret (ikke-edited) tekst fra Docendo', () => {
  let s = L.mergeHomeworkImport(L.defaultState(), IMP, HW_CTX('t', 'imp'));
  const changed = [{ docendoUid: 'u1', date: '2026-08-24', subject: 'Tysk', text: 'OPPDATERT' }];
  s = L.mergeHomeworkImport(s, changed, HW_CTX('t2', 'imp2'));
  assertEq(s.homework.find((x) => x.docendoUid === 'u1').text, 'OPPDATERT');
});
test('mergeHomeworkImport sletter ikke lekser som forsvinner fra Docendo', () => {
  let s = L.mergeHomeworkImport(L.defaultState(), IMP, HW_CTX('t', 'imp'));
  s = L.mergeHomeworkImport(s, [IMP[0]], HW_CTX('t2', 'imp2')); // u2 mangler nå
  assertEq(L.activeHomework(s).length, 2); // begge beholdes
});
```

- [ ] **Step 2: Kjør testen – verifiser at den feiler**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL.

- [ ] **Step 3: Implementer**

Legg til i lekser-seksjonen i `js/logic.js`:

```js
// Idempotent import fra Docendo. Matcher på docendoUid.
// - Ny uid: legg til som open, source='docendo', default poeng.
// - Eksisterende uid: bevar status/poeng/hidden; oppdater subject/text kun hvis !edited.
// - Aldri auto-slett lekser som mangler i importen.
// `imported` = liste fra homeworkFromIcs. ctx.id-basis + løpenr gir stabile nye id-er.
export function mergeHomeworkImport(state, imported, ctx) {
  const s = clone(state);
  if (!Array.isArray(s.homework)) s.homework = [];
  let seq = 0;
  for (const imp of imported || []) {
    const i = s.homework.findIndex((h) => h.docendoUid && h.docendoUid === imp.docendoUid);
    if (i < 0) {
      s.homework.push({
        id: `${ctx.id}-${seq++}`,
        date: imp.date,
        subject: imp.subject || '',
        text: imp.text || '',
        points: s.settings.homeworkPoints ?? 5,
        status: 'open',
        wholeWeek: false,
        hidden: false,
        source: 'docendo',
        docendoUid: imp.docendoUid,
        edited: false,
        doneAt: null,
        approvedAt: null,
        createdAt: ctx.now,
        createdBy: 'import',
        updatedAt: ctx.now,
        removed: false,
      });
      s.log.push({ id: `${ctx.id}-l${seq}`, at: ctx.now, actor: 'import', type: 'homework', action: 'import-add', hw: imp.docendoUid, subject: imp.subject, date: imp.date });
    } else {
      const h = s.homework[i];
      if (!h.edited) {
        let changed = false;
        if (h.subject !== (imp.subject || '')) { h.subject = imp.subject || ''; changed = true; }
        if (h.text !== (imp.text || '')) { h.text = imp.text || ''; changed = true; }
        if (h.date !== imp.date) { h.date = imp.date; changed = true; }
        if (changed) h.updatedAt = ctx.now;
      }
      // status/poeng/hidden bevares alltid; removed forblir som den er.
    }
  }
  return s;
}
```

- [ ] **Step 4: Kjør testen – verifiser at den passerer**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat: mergeHomeworkImport (idempotent, beskyttet re-import)"
```

---

## Task 15: «Hent lekser fra Docendo»-knapp i app.js + URL i index.html

**Files:**
- Modify: `index.html` (ny `window.DOCENDO_PROXY_URL`, bump APP_VERSION)
- Modify: `js/app.js` (import `homeworkFromIcs`, `mergeHomeworkImport`; knapp i `renderDayBody`/`parentHomeworkHtml`)

- [ ] **Step 1: Legg til proxy-URL i index.html**

Ved siden av `window.EDGE_FUNCTION_URL`, legg til (fyll inn URL fra Task 12-deploy):

```js
window.DOCENDO_PROXY_URL = ''; // f.eks. 'https://<prosjekt>.supabase.co/functions/v1/docendo-proxy'
```

Bump versjon: `window.APP_VERSION = '2026.08.23 (b18 · Lekser Docendo-import)';`

- [ ] **Step 2: Utvid import i app.js**

Legg til `homeworkFromIcs, mergeHomeworkImport,` i import fra `./logic.js`.

- [ ] **Step 3: Legg til hent-knapp + handler**

Øverst i `parentHomeworkHtml` (Task 9), legg til en knapp foran resten (kun hvis URL finnes):

```js
  const importBtn = window.DOCENDO_PROXY_URL
    ? `<button class="btn" id="hwImport" style="margin-bottom:10px">📚 Hent lekser fra Docendo (denne uka)</button>`
    : '';
```

og inkluder `${importBtn}` først i den returnerte strengen.

I `bindParentHomework`, legg til handler (bruker `weekdaysOf` og `isoDate` fra logic.js – importer `weekdaysOf` om ikke allerede importert):

```js
  const imp = host.querySelector('#hwImport');
  if (imp) imp.onclick = async () => {
    imp.disabled = true; imp.textContent = 'Henter …';
    try {
      const r = await fetch(window.DOCENDO_PROXY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ical_id: App.state.settings.docendoIcalId }),
      });
      const { ics, error } = await r.json();
      if (error || !ics) throw new Error(error || 'tomt svar');
      const week = weekdaysOf(date);
      const items = homeworkFromIcs(ics, { from: week[0], to: week[4] });
      App.state = mergeHomeworkImport(App.state, items, { now: nowIso(), id: newId() });
      save(); renderParentHome();
    } catch (e) {
      imp.disabled = false; imp.textContent = '📚 Hent lekser fra Docendo (denne uka)';
      alert('Kunne ikke hente lekser: ' + e.message);
    }
  };
```

- [ ] **Step 4: Parse-sjekk + tester**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js` → `ReferenceError: document` (OK).
Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js` → PASS.

- [ ] **Step 5: Commit + deploy fase 2**

```bash
git add js/app.js index.html
git commit -m "feat: Hent lekser fra Docendo-knapp (fase 2)"
git push -u origin feat/lekser-docendo
gh pr create --base main --title "feat: lekser Docendo-import (fase 2)" --body "$(cat <<'EOF'
Fase 2: docendo-proxy edge function + ICS-parsing/import. Forelder henter ukens lekser fra Docendo med ett trykk; import er idempotent og beskytter manuelle endringer, status og poeng. Krever at docendo-proxy er deployet og DOCENDO_PROXY_URL satt i index.html.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge feat/lekser-docendo --merge --delete-branch && git switch main && git pull --ff-only
```

- [ ] **Step 6: Verifiser live**

Deploy `docendo-proxy` (bruker), sett `DOCENDO_PROXY_URL`, bekreft at «Hent lekser» fyller ukens lekser og at re-import ikke overskriver godkjente/redigerte lekser.

---

## Self-review-notat

- **Spec-dekning:** datamodell (Task 1), poeng/saldo (Task 2), forelder-livssyklus (Task 3), sønn/godkjenning (Task 4), fletting (Task 5), UI sønn (Task 8), UI forelder (Task 9), Poeng/logg (Task 10), Docendo-proxy (Task 12), ICS-parse (Task 13), import-semantikk (Task 14), hent-knapp (Task 15). Prioritet manuell-først dekket ved fase-inndeling.
- **Navnekonsistens:** `homework`, `homeworkForWeek`, `homeworkPointsTotal/Pending`, `activeHomework`, `addHomework/updateHomework/deleteHomework/hideHomework/commitHomework/uncommitHomework/approveHomework/rejectHomework`, `mergeHomeworkList`, `parseIcs/homeworkFromIcs/mergeHomeworkImport`, `App.homeworkView`, `App.editHwId`. Brukt konsistent på tvers av tasks.
- **Ingen placeholders:** all kode er komplett; UI-innsettingssteg (Task 9/10) ber leser tilpasse til eksisterende mal-struktur, men gir konkret kode og innsettingspunkt.
