# Auto-fullføring av rutiner – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rutine-instanser fullføres automatisk når alle deloppgaver er huket av — poeng > 0 går til godkjenning, 0-coins blir «✓ ferdig» med én gang og kan vekkes ved å hake av igjen.

**Architecture:** Ren logikk i `js/logic.js` (`toggleQuestSubtask` blir inngangspunkt for auto-avansering + vekk; `commitQuest` ruter 0-coins-rutiner til ny `completed`-status). UI i `js/app.js` (`sonRoutineCard` grener på status; «I dag» inkluderer `completed`). Tester i `test/suite.js`.

**Tech Stack:** Vanilla ES-moduler, ingen build. Tester kjøres med JavaScriptCore (`jsc`).

**Referanse-spec:** `docs/superpowers/specs/2026-09-14-honniscoins-rutiner-auto-fullfor-design.md`

**Testkommando (hele suiten):**
`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`

**Parse-sjekk app.js (uten DOM):**
`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js` → `ReferenceError: document` = OK (syntaks fin); `SyntaxError` = feil.

---

## Task 1: `commitQuest` ruter 0-coins-rutiner til `completed`

Rutiner uten deloppgaver beholder en manuell «Marker som ferdig»-knapp. Når en slik
rutine har 0 poeng skal den bli `completed` (ingen godkjenning), ikke `done`.

**Files:**
- Modify: `js/logic.js:819-829` (`commitQuest`)
- Test: `test/suite.js` (ny funksjon i `tests`-arrayen, før `];` på linje 1519)

- [ ] **Step 1: Write the failing tests**

Legg til disse to funksjonene i `tests`-arrayen i `test/suite.js` (rett før den avsluttende `];`, husk komma mellom funksjoner):

```javascript
    function commitQuest_zero_coin_routine_becomes_completed() {
      let s = L.defaultState();
      s.quests.push({ id: 'r0', title: 'Huskeliste', points: 0, status: 'open', source: 'routine', routineId: 'r', routineDate: '2026-09-14', subtasks: [], removed: false, updatedAt: 't0', doneAt: null });
      s = L.commitQuest(s, { id: 'r0', actor: 'son' }, { now: 't1', id: 'l1' });
      eq('0-coins rutine -> completed', s.quests[0].status, 'completed');
      eq('doneAt satt', s.quests[0].doneAt, 't1');
      eq('logg complete', s.log.find((e) => e.action === 'complete').quest, 'r0');
    },
    function commitQuest_pointed_routine_still_done() {
      let s = L.defaultState();
      s.quests.push({ id: 'r5', title: 'Rutine', points: 5, status: 'open', source: 'routine', routineId: 'r', routineDate: '2026-09-14', subtasks: [], removed: false, updatedAt: 't0', doneAt: null });
      s = L.commitQuest(s, { id: 'r5', actor: 'son' }, { now: 't1', id: 'l1' });
      eq('poeng-rutine -> done', s.quests[0].status, 'done');
      eq('logg done', s.log.find((e) => e.action === 'done').quest, 'r5');
    },
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL på `commitQuest_zero_coin_routine_becomes_completed` («completed» != «done»).

- [ ] **Step 3: Implement**

Erstatt hele `commitQuest` i `js/logic.js` (linje 819-829) med:

```javascript
// Sønn markerer ferdig (commit): open -> done (eller completed for 0-coins-rutine).
export function commitQuest(state, { id, actor = 'son' }, ctx) {
  const s = clone(state);
  const i = findQuestIdx(s, id);
  if (i < 0) return s;
  if (!allSubtasksDone(s.quests[i])) return s; // alle subtasks må være huket av
  const q = s.quests[i];
  const zeroRoutine = q.source === 'routine' && (Number(q.points) || 0) === 0;
  q.status = zeroRoutine ? 'completed' : 'done';
  q.doneAt = ctx.now;
  q.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'quest', action: zeroRoutine ? 'complete' : 'done', quest: id, title: q.title });
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS (0 failed). Eksisterende `commit_and_approve_adds_points` (manuell quest, ingen `source`) skal fortsatt gi `done`.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutiner): commitQuest ruter 0-coins-rutine til completed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `toggleQuestSubtask` auto-avanserer og vekker rutiner

Når siste deloppgave hukes av: rutine → `done` (poeng > 0) eller `completed` (0 coins).
Når en `completed`-rutine får en boks fjernet: → `open` (vekk), gated til i dag/framtid.

**Files:**
- Modify: `js/logic.js:844-853` (`toggleQuestSubtask`)
- Test: `test/suite.js` (nye funksjoner i `tests`-arrayen)

- [ ] **Step 1: Write the failing tests**

Legg til i `tests`-arrayen i `test/suite.js`:

```javascript
    function toggle_last_subtask_pointed_routine_auto_done() {
      let s = L.defaultState();
      s.quests.push({ id: 'r5', title: 'Sekk', points: 5, status: 'open', source: 'routine', routineId: 'r', routineDate: '2026-09-14', removed: false, updatedAt: 't0', doneAt: null, subtasks: [{ id: 'a', text: 'x', done: true }, { id: 'b', text: 'y', done: false }] });
      s = L.toggleQuestSubtask(s, { id: 'r5', subId: 'b', actor: 'son' }, { now: '2026-09-14T08:00:00.000Z', id: 'l1' });
      eq('siste boks -> done', s.quests[0].status, 'done');
      eq('doneAt satt', s.quests[0].doneAt, '2026-09-14T08:00:00.000Z');
      eq('logg done', s.log.find((e) => e.action === 'done').quest, 'r5');
    },
    function toggle_last_subtask_zero_coin_routine_auto_completed() {
      let s = L.defaultState();
      s.quests.push({ id: 'r0', title: 'Huskeliste', points: 0, status: 'open', source: 'routine', routineId: 'r', routineDate: '2026-09-14', removed: false, updatedAt: 't0', doneAt: null, subtasks: [{ id: 'a', text: 'x', done: true }, { id: 'b', text: 'y', done: false }] });
      s = L.toggleQuestSubtask(s, { id: 'r0', subId: 'b', actor: 'son' }, { now: '2026-09-14T08:00:00.000Z', id: 'l1' });
      eq('siste boks -> completed', s.quests[0].status, 'completed');
      eq('logg complete', s.log.find((e) => e.action === 'complete').quest, 'r0');
    },
    function toggle_non_last_subtask_stays_open() {
      let s = L.defaultState();
      s.quests.push({ id: 'r5', title: 'Sekk', points: 5, status: 'open', source: 'routine', routineId: 'r', routineDate: '2026-09-14', removed: false, updatedAt: 't0', doneAt: null, subtasks: [{ id: 'a', text: 'x', done: false }, { id: 'b', text: 'y', done: false }] });
      s = L.toggleQuestSubtask(s, { id: 'r5', subId: 'a', actor: 'son' }, { now: '2026-09-14T08:00:00.000Z', id: 'l1' });
      eq('ikke ferdig -> open', s.quests[0].status, 'open');
    },
    function uncheck_completed_routine_wakes_to_open() {
      let s = L.defaultState();
      s.quests.push({ id: 'r0', title: 'Huskeliste', points: 0, status: 'completed', source: 'routine', routineId: 'r', routineDate: '2026-09-14', removed: false, updatedAt: 't0', doneAt: 't0', subtasks: [{ id: 'a', text: 'x', done: true }, { id: 'b', text: 'y', done: true }] });
      s = L.toggleQuestSubtask(s, { id: 'r0', subId: 'a', actor: 'son' }, { now: '2026-09-14T09:00:00.000Z', id: 'l1' });
      eq('avhuking vekker -> open', s.quests[0].status, 'open');
      eq('doneAt nullstilt', s.quests[0].doneAt, null);
      eq('logg undo', s.log.find((e) => e.action === 'undo').quest, 'r0');
    },
    function uncheck_completed_routine_past_date_stays_completed() {
      let s = L.defaultState();
      s.quests.push({ id: 'r0', title: 'Huskeliste', points: 0, status: 'completed', source: 'routine', routineId: 'r', routineDate: '2026-09-10', removed: false, updatedAt: 't0', doneAt: 't0', subtasks: [{ id: 'a', text: 'x', done: true }, { id: 'b', text: 'y', done: true }] });
      s = L.toggleQuestSubtask(s, { id: 'r0', subId: 'a', actor: 'son' }, { now: '2026-09-14T09:00:00.000Z', id: 'l1' });
      eq('passert dag -> forblir completed', s.quests[0].status, 'completed');
    },
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL (auto-avansering ikke implementert ennå → status forblir `open`/`completed`).

- [ ] **Step 3: Implement**

Erstatt hele `toggleQuestSubtask` i `js/logic.js` (linje 844-853) med:

```javascript
// Sønn veksler én subtask. Bumper quest.updatedAt så fletting (LWW) synker riktig.
// For rutine-instanser: siste avhuking auto-avanserer (done/completed); å fjerne en
// avhuking på en completed 0-coins-rutine vekker den tilbake til open.
export function toggleQuestSubtask(state, { id, subId, actor = 'son' }, ctx) {
  const s = clone(state);
  const i = findQuestIdx(s, id);
  if (i < 0) return s;
  const q = s.quests[i];
  const st = (q.subtasks || []).find((x) => x.id === subId);
  if (!st) return s;
  st.done = !st.done;
  q.updatedAt = ctx.now;
  if (q.source === 'routine' && q.status !== 'approved') {
    const subs = q.subtasks || [];
    const allDone = subs.length > 0 && subs.every((x) => x.done);
    if (q.status === 'open' && allDone) {
      const zero = (Number(q.points) || 0) === 0;
      q.status = zero ? 'completed' : 'done';
      q.doneAt = ctx.now;
      s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'quest', action: zero ? 'complete' : 'done', quest: id, title: q.title });
    } else if (q.status === 'completed' && !allDone) {
      const todayIso = (ctx.now || '').slice(0, 10);
      if (!(q.routineDate && todayIso && q.routineDate < todayIso)) {
        q.status = 'open';
        q.doneAt = null;
        s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'quest', action: 'undo', quest: id, title: q.title });
      }
    }
  }
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS (0 failed). Eksisterende `toggleQuestSubtask_flips_and_bumps` (manuell quest, ingen `source`) uendret.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutiner): auto-avanser ved siste avhuking + vekk completed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Sønn-UI – `sonRoutineCard` grener på status + «I dag» inkluderer `completed`

**Files:**
- Modify: `js/app.js:623-666` (`sonRoutineCard`)
- Modify: `js/app.js:744` (`openToday` i `renderRutinerPage`)
- Modify: `js/app.js:2089` (logg-map: legg til `complete`)

- [ ] **Step 1: Erstatt `sonRoutineCard`**

Erstatt hele `sonRoutineCard` (linje 623-666) med:

```javascript
function sonRoutineCard(q, today, open) {
  const subs = q.subtasks || [];
  const done = subs.filter((st) => st.done).length, tot = subs.length;
  const tomorrow = (q.routineDate || '') > today;
  const waiting = q.status === 'done';
  const completed = q.status === 'completed';
  // Framdriftsstripe (kollapset kort) kun for åpne rutiner i gang med deloppgaver.
  const showBar = q.status === 'open' && tot > 0;
  const pill = waiting
    ? `<span class="rtpill wait">⏳ til godkjenning</span>`
    : completed
      ? `<span class="rtpill ok">✓ ferdig</span>`
      : showBar
        ? ''
        : `<span class="rtpill">å gjøre</span>`;
  const badge = tomorrow ? `<span class="qrec lead" style="margin:0">🌙 i morgen</span>` : '';
  const pct = tot ? Math.round((done / tot) * 100) : 0;
  const prog = showBar
    ? `<div class="rtprog"><div class="progbar ${done > 0 ? 'part' : ''}"><i style="width:${pct}%"></i></div><span class="rtprogtxt">${done}/${tot} gjort</span></div>`
    : '';
  let body;
  if (waiting) {
    body = `
    ${sonSubtaskList(q, false)}
    <div class="qmeta"><span class="qdue wait">⏳ Sendt til godkjenning</span></div>
    <div class="btnrow">
      <button class="btn ghost qbtn" data-uncommit="${q.id}">Angre</button>
    </div>`;
  } else if (completed) {
    // Ferdig 0-coins-rutine: redigerbare deloppgaver (avhuking vekker → open).
    // Uten deloppgaver finnes ingen boks å hake av → egen «Angre»-knapp.
    body = `
    ${sonSubtaskList(q, true)}
    ${tot === 0 ? `<div class="btnrow"><button class="btn ghost qbtn" data-uncommit="${q.id}">Angre</button></div>` : ''}`;
  } else {
    // open: deloppgave-rutiner auto-fullfører ved siste avhuking (ingen «ferdig»-knapp);
    // rutiner uten deloppgaver beholder manuell «Marker som ferdig».
    body = `
    ${sonSubtaskList(q, true)}
    <div class="btnrow">
      ${tot === 0 ? `<button class="btn good qbtn" data-commit="${q.id}">🔒 Marker som ferdig</button>` : ''}
      <button class="btn ghost qbtn" data-skip="${q.id}">🚫 Ikke gjort</button>
    </div>`;
  }
  return `<div class="rtcard ${open ? 'open' : ''} ${waiting ? 'wait' : completed ? 'done' : ''}">
    <button class="rthead" data-rtoggle="${q.id}">
      <span class="rtic">🔁</span>
      <span class="rtttl">${escapeHtml(q.title)}</span>
      <span class="rtsum">${badge}${pill}<span class="rtchev">▾</span></span>
    </button>
    ${prog}
    <div class="rtbody" ${open ? '' : 'hidden'}>${body}</div>
  </div>`;
}
```

- [ ] **Step 2: Inkluder `completed` i «I dag»**

I `renderRutinerPage`, erstatt linje 744:

```javascript
  const openToday = todays.filter((q) => q.status === 'open');
```

med (åpne øverst, ferdige nederst):

```javascript
  const openToday = todays
    .filter((q) => q.status === 'open' || q.status === 'completed')
    .sort((a, b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0));
```

- [ ] **Step 3: Legg til `complete` i logg-map**

I quest-grenen av logg-rendringen (linje 2081-2089), legg til en linje i `map`-objektet rett etter `done:`-linjen:

```javascript
          complete: `✓ Fullførte ${t}`,
```

- [ ] **Step 4: Parse-sjekk app.js**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: ... document ...` (OK — syntaks fin). Hvis `SyntaxError`: fiks før commit.

- [ ] **Step 5: Kjør hele testsuiten (regresjon)**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: PASS (0 failed).

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat(rutiner): sønn-UI viser «✓ ferdig», auto-fullføring uten knapp

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Manuell verifisering i nettleser + APP_VERSION-bump

**Files:**
- Modify: `index.html` (`APP_VERSION`)

- [ ] **Step 1: Bump APP_VERSION**

Finn linjen: `grep -n "APP_VERSION" index.html`
Øk versjonsstrengen ett hakk (samme format som eksisterende verdi, f.eks. `b57` → `b58`).

- [ ] **Step 2: Manuell test (localStorage-modus, tom URL-hash)**

Åpne `index.html` i nettleser uten `#r=`-hash. Som forelder: lag/aktiver en rutine med deloppgaver og **0 poeng**, og en med **5 poeng**. Bytt til sønn → Rutiner-fanen. Verifiser:
  1. Åpen deloppgave-rutine har **ingen** «Marker som ferdig»-knapp, kun «🚫 Ikke gjort».
  2. Huk av alle deloppgaver på **0-poeng**-rutinen → den får «✓ ferdig»-pille og blir stående nederst i «I dag». Fjern en avhuking → den blir «å gjøre»/åpen igjen (vekket).
  3. Huk av alle på **5-poeng**-rutinen → den flytter til «Venter på godkjenning» med «Angre»-knapp (ingen manuelt klikk trengtes).
  4. Forelder → Rutiner-fanen: 5-poeng-rutinen ligger i godkjenningskøen; 0-poeng-rutinen gjør IKKE (ingenting å godkjenne). Badge teller kun den med poeng.
  5. En rutine **uten** deloppgaver (0 poeng): «Marker som ferdig» → «✓ ferdig» direkte (ingen godkjenning), med «Angre»-knapp.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "chore: bump APP_VERSION for rutine-auto-fullføring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Oppdater CLAUDE.md + åpne PR

**Files:**
- Modify: `CLAUDE.md` (rutine-seksjonen)

- [ ] **Step 1: Dokumentér i CLAUDE.md**

Legg til et kort punkt under «Daglige rutiner» som beskriver: ny `completed`-status for 0-coins-rutiner; auto-avansering i `toggleQuestSubtask` (siste avhuking → `done`/`completed`, avhuking igjen vekker `completed`→`open`, gated til i dag); `commitQuest` ruter 0-coins-rutiner uten deloppgaver til `completed`; «I dag» viser `completed`; deloppgave-rutiner har ikke lenger «Marker som ferdig»-knapp. Oppdater assertion-tallet i «Testing»-seksjonen (nye tester i Task 1–2).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: oppdater CLAUDE.md for rutine-auto-fullføring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 3: Push branch + åpne PR**

```bash
git push -u origin spec/rutiner-auto-fullfor
```

Deretter (eget kall):

```bash
gh pr create --base main --title "Auto-fullføring av rutiner når alt er huket av" --body "$(cat <<'EOF'
## Hva
Rutine-instanser fullføres automatisk når alle deloppgaver er huket av:
- Poeng > 0 → rett til godkjenning (ingen manuelt «Marker som ferdig»-klikk).
- 0 coins → «✓ ferdig» med én gang (ny `completed`-status, ingen godkjenning); hak av en deloppgave igjen for å vekke den.

Deloppgave-rutiner mister «Marker som ferdig»-knappen (avhuking er handlingen); rutiner uten deloppgaver beholder den.

## Test
- Nye rene-logikk-tester i `test/suite.js` (auto-avansering, vekk, 0-coins/poeng-ruting, dato-gate).
- Manuell nettlesertest utført.

Spec: `docs/superpowers/specs/2026-09-14-honniscoins-rutiner-auto-fullfor-design.md`
Plan: `docs/superpowers/plans/2026-09-14-honniscoins-rutiner-auto-fullfor.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notater for utfører
- **Deploy-regler (CLAUDE.md):** `git add -A` og `git push` til main er blokkert. Bruk konkrete filstier (som over) og jobb på branchen `spec/rutiner-auto-fullfor` (allerede opprettet). Merge via `gh pr merge` etter review.
- **Rekkefølge:** Task 1–2 er ren TDD-logikk og må være grønne før UI (Task 3).
- **`completed` er terminal og påvirker ikke** `routinesRemaining`/`overlappingRoutineIds`/`expireStaleRoutineInstances` (alle ser kun `open`) eller saldo (`questPointsTotal` teller kun `approved`; 0-coins gir 0). Ingen migrering.
