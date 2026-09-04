# Flere daglige rutiner (generelt mal-system) – Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Generaliser den ene daglige rutinen til en liste av maler (`settings.routines`) med per-mal ukedag-plan; pre-fyll sekk/matbag/gymbag; forelder-UI for add/rediger/slett.

**Architecture:** `settings.dailyRoutine` → `settings.routines: [{id,title,points,subtasks,weekdays,enabled,updatedAt}]`. `migrate` folder gammel mal inn (id `routine`, beholder legacy instans-id) og seeder de tre (guard `routinesSeeded`). `generateDailyRoutines` lager én instans per aktiv mal hvis dagens `weekdayKey` er i malens `weekdays`. Instansen er fortsatt en vanlig quest (+`routineId`).

**Tech Stack:** Vanilla ES-moduler. Logikk i `js/logic.js`, DOM i `js/app.js`, CSS/versjon i `index.html`, tester i `test/suite.js` (jsc).

**Spec:** `docs/superpowers/specs/2026-09-04-honniscoins-flere-rutiner-design.md`

**Testkommando:** `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
**Parse-sjekk app.js:** `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js` → `ReferenceError` om `document` = OK; `SyntaxError` = feil.
**Konvensjoner:** branch; `git add <konkrete filer>` (aldri `-A`); trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; norsk.

**Fakta (verifisert):** `weekdayKey(iso)` → `'mon'|'tue'|'wed'|'thu'|'fri'|null`. Dagens generering bruker id `routine-<dato>`. `defaultState.settings.dailyRoutine` på rad ~36; `migrate` dailyRoutine-blokk rad ~475-477; `return generateDailyRoutine` rad ~489; `generateDailyRoutine` rad ~425-457; `setDailyRoutine` rad ~607-618. app.js: sønn-badge rad ~542-545; renderPoengTab routine-HTML rad ~1245-1257 og binding rad ~1286-1319; import med `setDailyRoutine` rad ~10.

---

### Task 0: Branch

```bash
git switch main && git pull --ff-only
git switch -c feat/flere-rutiner
```

---

### Task 1: Datamodell + migrering (routines[], fold + seed)

**Files:** Modify `js/logic.js` (`defaultState` ~36, `migrate` ~475-477); Test `test/suite.js`.

- [ ] **Step 1: Skriv feilende tester** (legg i `tests`-arrayet; erstatt gamle `dailyRoutine_default_shape`/`dailyRoutine_migrate_fills_missing` med disse):

```javascript
    function routines_default_shape() {
      const s = L.defaultState();
      eq('routines default []', s.settings.routines, []);
      eq('routinesSeeded default false', s.settings.routinesSeeded, false);
      eq('ingen dailyRoutine igjen', s.settings.dailyRoutine, undefined);
    },
    function migrate_folds_legacy_dailyRoutine() {
      const s = L.defaultState();
      s.settings.routines = [];
      s.settings.routinesSeeded = true; // isoler folde-logikken fra seeding
      s.settings.dailyRoutine = { enabled: true, title: 'Rydd', points: 12, subtasks: [{ id: 'a', text: 'x' }], updatedAt: 't' };
      const m = L.migrate(s, '2026-09-05'); // lørdag → ingen generering
      const r = m.settings.routines.find((x) => x.id === 'routine');
      eq('foldet inn', !!r, true);
      eq('beholder title', r.title, 'Rydd');
      eq('beholder points', r.points, 12);
      eq('weekdays man-fre', r.weekdays, ['mon', 'tue', 'wed', 'thu', 'fri']);
      eq('beholder enabled', r.enabled, true);
      eq('dailyRoutine slettet', m.settings.dailyRoutine, undefined);
    },
    function migrate_seeds_three_routines() {
      const s = L.defaultState();
      const m = L.migrate(s, '2026-09-05'); // lørdag → ingen generering
      const ids = m.settings.routines.map((r) => r.id);
      ok('sekk seeded', ids.includes('routine-sekk'));
      ok('matbag seeded', ids.includes('routine-matbag'));
      ok('gymbag seeded', ids.includes('routine-gymbag'));
      const gym = m.settings.routines.find((r) => r.id === 'routine-gymbag');
      eq('gymbag uten tirsdag', gym.weekdays, ['mon', 'wed', 'thu', 'fri']);
      eq('routinesSeeded satt', m.settings.routinesSeeded, true);
    },
    function migrate_seed_idempotent_and_respects_delete() {
      const s = L.defaultState();
      const m1 = L.migrate(s, '2026-09-05');
      // forelder sletter gymbag
      m1.settings.routines = m1.settings.routines.filter((r) => r.id !== 'routine-gymbag');
      const m2 = L.migrate(m1, '2026-09-05');
      eq('gymbag kommer ikke tilbake', m2.settings.routines.filter((r) => r.id === 'routine-gymbag').length, 0);
      eq('sekk ikke duplisert', m2.settings.routines.filter((r) => r.id === 'routine-sekk').length, 1);
    },
```

- [ ] **Step 2: Kjør tester – forvent FAIL.**

- [ ] **Step 3: Endre `defaultState`** – bytt `dailyRoutine`-linja (~36) med:

```javascript
      routines: [],
      routinesSeeded: false,
```

- [ ] **Step 4: Endre `migrate`** – bytt hele blokka (~475-477):

```javascript
  if (!s.settings.dailyRoutine) {
    s.settings.dailyRoutine = { enabled: false, title: 'Rydd opp etter skolen', points: 10, subtasks: [], updatedAt: null };
  }
```

med:

```javascript
  if (!Array.isArray(s.settings.routines)) s.settings.routines = [];
  // Fold gammel enkelt-mal (settings.dailyRoutine) inn i routines-lista.
  if (s.settings.dailyRoutine) {
    if (!s.settings.routines.some((r) => r.id === 'routine')) {
      const d = s.settings.dailyRoutine;
      s.settings.routines.push({
        id: 'routine',
        title: d.title,
        points: d.points,
        subtasks: (d.subtasks || []).map((st) => ({ id: st.id, text: st.text })),
        weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        enabled: d.enabled,
        updatedAt: d.updatedAt || null,
      });
    }
    delete s.settings.dailyRoutine;
  }
  // Engangs-seed av familiens tre morgen-rutiner (guardet mot re-add etter sletting).
  if (!s.settings.routinesSeeded) {
    const seedRoutine = (id, title, points, weekdays) => {
      if (!s.settings.routines.some((r) => r.id === id)) {
        s.settings.routines.push({ id, title, points, subtasks: [], weekdays, enabled: true, updatedAt: null });
      }
    };
    seedRoutine('routine-sekk', 'Pakk sekken', 5, ['mon', 'tue', 'wed', 'thu', 'fri']);
    seedRoutine('routine-matbag', 'Pakk matbagen', 5, ['mon', 'tue', 'wed', 'thu', 'fri']);
    seedRoutine('routine-gymbag', 'Pakk gymbagen', 5, ['mon', 'wed', 'thu', 'fri']);
    s.settings.routinesSeeded = true;
  }
```

(La `return generateDailyRoutine(s, todayIso);` stå urørt i denne tasken – byttes i Task 2.)

- [ ] **Step 5: Kjør tester – forvent PASS** (bortsett fra evt. gamle generering-tester som byttes i Task 2 – hvis noen feiler pga. manglende `dailyRoutine`, la dem stå til Task 2, ELLER kommenter dem ut nå og skriv om i Task 2. Foretrukket: skriv om generering-testene i Task 2; her skal minst de nye Task 1-testene passere.)

Merk: Eksisterende `generateDailyRoutine_*`- og `setDailyRoutine_*`-tester leser gammelt API og vil feile nå. Behold `return generateDailyRoutine` (som fortsatt leser `settings.dailyRoutine` = undefined → returnerer uendret), så migrate ikke krasjer. De gamle generering/mutasjon-testene skrives om i Task 2/Task 3. For at suiten skal være grønn ved commit i Task 1: **fjern** de gamle `generateDailyRoutine_*`, `migrate_runs_generation` og `setDailyRoutine_updates_and_stamps`-testene nå (de erstattes i Task 2/3).

- [ ] **Step 6: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutiner): settings.routines[] + migrering (fold + seed tre)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `generateDailyRoutines` (multi) + wire migrate

**Files:** Modify `js/logic.js` (erstatt `generateDailyRoutine` ~425-457; `migrate` return ~489); Test `test/suite.js`.

- [ ] **Step 1: Skriv feilende tester** (nye generering-tester):

```javascript
    function generateDailyRoutines_creates_per_active_routine() {
      const s = L.defaultState();
      s.settings.routines = [
        { id: 'routine-sekk', title: 'Pakk sekken', points: 5, subtasks: [{ id: 'm', text: 'Bøker' }], weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], enabled: true, updatedAt: 't' },
        { id: 'routine-gymbag', title: 'Gymbag', points: 5, subtasks: [], weekdays: ['mon', 'wed', 'thu', 'fri'], enabled: true, updatedAt: 't' },
      ];
      s.settings.routinesSeeded = true;
      const m = L.generateDailyRoutines(s, '2026-09-04'); // fredag
      const inst = m.quests.filter((q) => q.source === 'routine');
      eq('to instanser på fredag', inst.length, 2);
      const sekk = inst.find((q) => q.id === 'routine-sekk-2026-09-04');
      eq('sekk id', !!sekk, true);
      eq('routineId satt', sekk.routineId, 'routine-sekk');
      eq('subtasks kopiert', sekk.subtasks, [{ id: 'routine-sekk-2026-09-04-0', text: 'Bøker', done: false }]);
    },
    function generateDailyRoutines_gymbag_skips_tuesday() {
      const s = L.defaultState();
      s.settings.routines = [{ id: 'routine-gymbag', title: 'Gymbag', points: 5, subtasks: [], weekdays: ['mon', 'wed', 'thu', 'fri'], enabled: true, updatedAt: 't' }];
      s.settings.routinesSeeded = true;
      const tue = L.generateDailyRoutines(s, '2026-09-01'); // tirsdag
      eq('ingen gymbag tirsdag', tue.quests.filter((q) => q.source === 'routine').length, 0);
      const wed = L.generateDailyRoutines(s, '2026-09-02'); // onsdag
      eq('gymbag onsdag', wed.quests.filter((q) => q.source === 'routine').length, 1);
    },
    function generateDailyRoutines_disabled_and_weekend() {
      const s = L.defaultState();
      s.settings.routines = [{ id: 'routine-sekk', title: 'Sekk', points: 5, subtasks: [], weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], enabled: false, updatedAt: 't' }];
      s.settings.routinesSeeded = true;
      eq('disabled → ingen', L.generateDailyRoutines(s, '2026-09-04').quests.filter((q) => q.source === 'routine').length, 0);
      const s2 = JSON.parse(JSON.stringify(s));
      s2.settings.routines[0].enabled = true;
      eq('helg → ingen', L.generateDailyRoutines(s2, '2026-09-05').quests.filter((q) => q.source === 'routine').length, 0);
    },
    function generateDailyRoutines_idempotent_and_legacy_id() {
      const s = L.defaultState();
      s.settings.routines = [{ id: 'routine', title: 'Rydd', points: 10, subtasks: [], weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], enabled: true, updatedAt: 't' }];
      s.settings.routinesSeeded = true;
      const m1 = L.generateDailyRoutines(s, '2026-09-04');
      eq('legacy id-kompat', m1.quests[0].id, 'routine-2026-09-04');
      const m2 = L.generateDailyRoutines(m1, '2026-09-04');
      eq('idempotent', m2.quests.filter((q) => q.source === 'routine').length, 1);
    },
    function migrate_runs_multi_generation() {
      const s = L.defaultState();
      const m = L.migrate(s, '2026-09-04'); // fredag → sekk+matbag+gymbag alle aktive
      eq('migrate genererer 3', m.quests.filter((q) => q.source === 'routine').length, 3);
    },
```

- [ ] **Step 2: Kjør tester – forvent FAIL** (`generateDailyRoutines` finnes ikke).

- [ ] **Step 3: Erstatt `generateDailyRoutine`** (hele ~425-457) med:

```javascript
// Genererer rutine-instanser for i dag (hverdag) fra aktive maler hvis ingen finnes.
// Deterministiske id-er (migrate har ingen ctx.id) gir idempotens + trygg fletting.
export function generateDailyRoutines(state, todayIso) {
  const s = clone(state);
  if (!todayIso) return s;
  const wk = weekdayKey(todayIso);
  if (wk === null) return s; // kun hverdag
  const routines = (s.settings && s.settings.routines) || [];
  if (!Array.isArray(s.quests)) s.quests = [];
  if (!Array.isArray(s.log)) s.log = [];
  const stamp = `${todayIso}T00:00:00.000Z`;
  for (const r of routines) {
    if (!r || r.enabled !== true) continue;
    if (!Array.isArray(r.weekdays) || !r.weekdays.includes(wk)) continue;
    const qid = `${r.id}-${todayIso}`;
    if (s.quests.some((q) => q.id === qid)) continue; // idempotent
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
      routineId: r.id,
      routineDate: todayIso,
      subtasks,
    });
    s.log.push({ id: `log-${qid}`, at: stamp, actor: 'system', type: 'quest', action: 'create', quest: qid, title: r.title, source: 'routine' });
  }
  return s;
}
```

- [ ] **Step 4: Wire migrate** – bytt `return generateDailyRoutine(s, todayIso);` (~489) med:

```javascript
  return generateDailyRoutines(s, todayIso);
```

- [ ] **Step 5: Kjør tester – forvent PASS** (alle).

- [ ] **Step 6: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutiner): generateDailyRoutines (per-mal ukedag) + wire migrate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Mutasjoner add/update/deleteRoutine (erstatt setDailyRoutine)

**Files:** Modify `js/logic.js` (erstatt `setDailyRoutine` ~607-618); Test `test/suite.js`.

- [ ] **Step 1: Skriv feilende tester:**

```javascript
    function addRoutine_appends_and_stamps() {
      const s0 = L.defaultState();
      s0.settings.routines = [];
      const s = L.addRoutine(s0, { routine: { id: 'r-new', title: 'Test', points: 7, weekdays: ['mon', 'fri'] } }, { now: 't1', id: 'r-new' });
      eq('lagt til', s.settings.routines.length, 1);
      eq('felt', [s.settings.routines[0].title, s.settings.routines[0].points, s.settings.routines[0].weekdays, s.settings.routines[0].enabled], ['Test', 7, ['mon', 'fri'], true]);
      eq('settings bumpet', s.settings.updatedAt, 't1');
      eq('original uendret', s0.settings.routines.length, 0);
    },
    function updateRoutine_patches_and_stamps() {
      const s0 = L.defaultState();
      s0.settings.routines = [{ id: 'r1', title: 'A', points: 5, subtasks: [], weekdays: ['mon', 'tue'], enabled: true, updatedAt: 't0' }];
      const s = L.updateRoutine(s0, { id: 'r1', patch: { title: 'B', points: 9, weekdays: ['wed'], enabled: false, subtasks: [{ id: 's', text: 'x' }] } }, { now: 't2', id: 'l1' });
      const r = s.settings.routines[0];
      eq('patchet', [r.title, r.points, r.weekdays, r.enabled, r.subtasks], ['B', 9, ['wed'], false, [{ id: 's', text: 'x' }]]);
      eq('routine.updatedAt', r.updatedAt, 't2');
      eq('settings.updatedAt', s.settings.updatedAt, 't2');
    },
    function deleteRoutine_removes_and_stamps() {
      const s0 = L.defaultState();
      s0.settings.routines = [{ id: 'r1', title: 'A', points: 5, subtasks: [], weekdays: ['mon'], enabled: true, updatedAt: 't0' }];
      const s = L.deleteRoutine(s0, { id: 'r1' }, { now: 't3', id: 'l1' });
      eq('fjernet', s.settings.routines.length, 0);
      eq('settings bumpet', s.settings.updatedAt, 't3');
    },
```

- [ ] **Step 2: Kjør tester – forvent FAIL.**

- [ ] **Step 3: Erstatt `setDailyRoutine`** (hele ~607-618) med:

```javascript
// Forelder legger til ny rutine-mal.
export function addRoutine(state, { routine = {} }, ctx) {
  const s = clone(state);
  if (!Array.isArray(s.settings.routines)) s.settings.routines = [];
  s.settings.routines.push({
    id: routine.id || ctx.id,
    title: routine.title || 'Ny rutine',
    points: Number(routine.points) || 0,
    subtasks: (routine.subtasks || []).map((st) => ({ id: st.id, text: st.text })),
    weekdays: Array.isArray(routine.weekdays) ? routine.weekdays.slice() : ['mon', 'tue', 'wed', 'thu', 'fri'],
    enabled: routine.enabled !== false,
    updatedAt: ctx.now,
  });
  s.settings.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor: 'parent', type: 'routine', action: 'add' });
  return s;
}

// Forelder oppdaterer en rutine-mal.
export function updateRoutine(state, { id, patch }, ctx) {
  const s = clone(state);
  const r = (s.settings.routines || []).find((x) => x.id === id);
  if (!r) return s;
  if ('title' in patch) r.title = patch.title;
  if ('points' in patch) r.points = Number(patch.points) || 0;
  if ('enabled' in patch) r.enabled = !!patch.enabled;
  if ('weekdays' in patch) r.weekdays = (patch.weekdays || []).slice();
  if ('subtasks' in patch) r.subtasks = (patch.subtasks || []).map((st) => ({ id: st.id, text: st.text }));
  r.updatedAt = ctx.now;
  s.settings.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor: 'parent', type: 'routine', action: 'edit', routine: id });
  return s;
}

// Forelder sletter en rutine-mal.
export function deleteRoutine(state, { id }, ctx) {
  const s = clone(state);
  s.settings.routines = (s.settings.routines || []).filter((x) => x.id !== id);
  s.settings.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor: 'parent', type: 'routine', action: 'delete', routine: id });
  return s;
}
```

- [ ] **Step 4: Kjør tester – forvent PASS.**

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(rutiner): add/update/deleteRoutine (erstatter setDailyRoutine)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Forelder-UI (liste av mal-kort + ukedag-piller) + sønn-badge

**Files:** Modify `js/app.js` (import ~10; sønn-badge ~542-545; `renderPoengTab` HTML ~1245-1257 + binding ~1286-1319).

- [ ] **Step 1: Import** – bytt `setDailyRoutine` i quest-import-gruppa med `addRoutine, updateRoutine, deleteRoutine`.

- [ ] **Step 2: Sønn-badge** – bytt teksten «🔁 Daglig ·» til «🔁 Rutine ·» i `routineBadge` (~544).

- [ ] **Step 3: Bytt routine-HTML** i `renderPoengTab` – erstatt blokka fra `<div class="sec">Daglig rutine...` t.o.m. dens `</div>` (rad ~1245-1257) med:

```javascript
    <div class="sec">Daglige rutiner</div>
    <div id="routinesHost"></div>
    <button class="btn ghost" id="rtAddRoutine" style="margin-top:6px">＋ Ny rutine</button>
    <div class="muted" style="font-size:.78rem;margin:8px 2px 0">Endring gjelder neste dag rutinen er aktiv. Dagens instans finjusterer du i Quests-fanen.</div>
```

- [ ] **Step 4: Bytt binding** – erstatt hele blokka fra `// Arbeidskopi av malen ...` (rad ~1286) t.o.m. `document.getElementById('rtAdd').onclick = () => { ... };` (rad ~1319, dvs. FØR `renderPayoutSection(...)`) med:

```javascript
  const WD = [['mon', 'Man'], ['tue', 'Tir'], ['wed', 'Ons'], ['thu', 'Tor'], ['fri', 'Fre']];
  const renderRoutines = () => {
    const rhost = document.getElementById('routinesHost');
    const routines = App.state.settings.routines || [];
    if (!routines.length) {
      rhost.innerHTML = '<div class="muted" style="font-size:.85rem;padding:6px 2px">Ingen rutiner ennå.</div>';
      return;
    }
    rhost.innerHTML = routines.map((r) => `
      <div class="card" data-rid="${r.id}" style="margin-bottom:10px">
        <label class="row" style="border:none"><div class="lbl">På</div>
          <input type="checkbox" data-r-enabled ${r.enabled ? 'checked' : ''}></label>
        <div class="row"><div class="lbl">Tittel</div>
          <input class="inp" data-r-title style="width:auto;flex:1;text-align:left" value="${escapeHtml(r.title)}"></div>
        <div class="row"><div class="lbl">Reward 🪙</div>
          <input class="inp" data-r-points type="number" min="0" value="${r.points}"></div>
        <div class="lbl" style="margin:8px 2px 4px">Ukedager</div>
        <div class="wdrow">${WD.map(([k, lbl]) => `<button class="wdpill ${(r.weekdays || []).includes(k) ? 'on' : ''}" data-wd="${k}">${lbl}</button>`).join('')}</div>
        <div class="lbl" style="margin:10px 2px 4px">Deloppgaver</div>
        <div data-r-subs></div>
        <button class="btn ghost" data-r-addsub style="margin-top:6px">+ Legg til deloppgave</button>
        <button class="link" data-r-del style="color:var(--bad);margin-top:10px;display:block">🗑 Slett rutine</button>
      </div>`).join('');
    rhost.querySelectorAll('[data-rid]').forEach((card) => {
      const id = card.dataset.rid;
      const upd = (patch) => { App.state = updateRoutine(App.state, { id, patch }, { now: nowIso(), id: newId() }); save(); };
      card.querySelector('[data-r-enabled]').onchange = (e) => upd({ enabled: e.target.checked });
      card.querySelector('[data-r-title]').onchange = (e) => upd({ title: e.target.value });
      card.querySelector('[data-r-points]').onchange = (e) => upd({ points: Number(e.target.value) });
      card.querySelectorAll('[data-wd]').forEach((b) => {
        b.onclick = () => {
          const r = (App.state.settings.routines || []).find((x) => x.id === id);
          const cur = new Set(r ? r.weekdays || [] : []);
          const k = b.dataset.wd;
          if (cur.has(k)) cur.delete(k); else cur.add(k);
          upd({ weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'].filter((x) => cur.has(x)) });
          renderRoutines();
        };
      });
      const subsBox = card.querySelector('[data-r-subs]');
      const r0 = (App.state.settings.routines || []).find((x) => x.id === id);
      const subs = r0 ? (r0.subtasks || []).map((st) => ({ id: st.id, text: st.text })) : [];
      const renderRSubs = () => {
        subsBox.innerHTML = subs.map((st, i) => `
          <div class="row" style="gap:8px">
            <input class="inp" style="width:auto;flex:1;text-align:left" data-sti="${i}" value="${escapeHtml(st.text)}">
            <button class="link" data-stdel="${i}" style="color:var(--bad)">✕</button>
          </div>`).join('') || '<div class="muted" style="font-size:.8rem">Ingen deloppgaver.</div>';
        subsBox.querySelectorAll('[data-sti]').forEach((inp) => {
          inp.onchange = () => { subs[Number(inp.dataset.sti)].text = inp.value; upd({ subtasks: subs }); };
        });
        subsBox.querySelectorAll('[data-stdel]').forEach((b) => {
          b.onclick = () => { subs.splice(Number(b.dataset.stdel), 1); upd({ subtasks: subs }); renderRSubs(); };
        });
      };
      renderRSubs();
      card.querySelector('[data-r-addsub]').onclick = () => { subs.push({ id: newId(), text: '' }); upd({ subtasks: subs }); renderRSubs(); };
      card.querySelector('[data-r-del]').onclick = () => {
        if (!confirm('Slette denne rutinen?')) return;
        App.state = deleteRoutine(App.state, { id }, { now: nowIso(), id: newId() });
        save();
        renderRoutines();
      };
    });
  };
  renderRoutines();
  document.getElementById('rtAddRoutine').onclick = () => {
    App.state = addRoutine(App.state, { routine: { title: 'Ny rutine', points: 5 } }, { now: nowIso(), id: newId() });
    save();
    renderRoutines();
  };
```

(La `renderPayoutSection(document.getElementById('payoutHost'));` stå urørt rett etter.)

- [ ] **Step 5: Parse-sjekk app.js** (forvent `ReferenceError` om `document`).

- [ ] **Step 6: Kjør logikk-tester** (skal fortsatt passere).

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "feat(rutiner): forelder-liste med ukedag-piller + add/slett, sønn-badge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: CSS (ukedag-piller) + APP_VERSION

**Files:** Modify `index.html`.

- [ ] **Step 1: Legg til CSS** (etter `.subprog`-regelen, bruk faktiske CSS-vars i fila; disse med fallback):

```css
  .wdrow{display:flex;gap:6px;flex-wrap:wrap}
  .wdpill{padding:6px 0;width:44px;text-align:center;border-radius:8px;font-size:.78rem;font-weight:700;background:var(--surface-2,#0f2547);border:1px solid var(--line);color:var(--muted);cursor:pointer}
  .wdpill.on{background:var(--accent,#3b6fe0);color:#fff;border-color:var(--accent,#3b6fe0)}
```

- [ ] **Step 2: Bump APP_VERSION** (følg eksisterende mønster, f.eks. `b30 · flere rutiner`).

- [ ] **Step 3: Kjør testkommando (PASS) + parse-sjekk app.js.**

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(rutiner): CSS ukedag-piller + bump APP_VERSION

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Dokumentasjon

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1:** Oppdater «Daglig rutine»-avsnittet (under Sidequests) til flere rutiner:
  `settings.routines[]` (id/title/points/subtasks/`weekdays`/enabled/updatedAt) + `routinesSeeded`,
  migrering (fold `dailyRoutine`→id `routine` legacy-kompat, seed sekk/matbag/gymbag),
  `generateDailyRoutines` (per-mal ukedag, deterministiske id-er `<routineId>-<dato>`),
  `addRoutine`/`updateRoutine`/`deleteRoutine` (bumper `settings.updatedAt`), forelder-UI
  (liste + ukedag-piller i Poeng-fanen), sønn-badge «🔁 Rutine». Referer ny spec + plan.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: dokumenter flere daglige rutiner (mal-system)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Manuell verifisering (localStorage-modus)

- [ ] Åpne appen (tom URL). Forelder → Poeng: se «Daglige rutiner» med Rydd opp + sekk + matbag + gymbag.
- [ ] Sjekk gymbag: bare Man/Ons/Tor/Fre markert. Toggle en ukedag, endre poeng/tittel, legg til deloppgave, slett en rutine (kommer ikke tilbake ved reload).
- [ ] Last på nytt → Sønn → Sidequests: instanser for dagens ukedag med «🔁 Rutine»-badge. På tirsdag skal gymbag IKKE dukke opp.
- [ ] Huk av/committer, godkjenn som forelder, saldo øker.

---

### Task 8: Push + PR + merge + deploy

- [ ] `git push -u origin feat/flere-rutiner`
- [ ] `gh pr create --base main --title "Flere daglige rutiner (mal-system m/ ukedag-plan)" --body "..."`
- [ ] `gh pr merge feat/flere-rutiner --merge --delete-branch` → `git switch main && git pull --ff-only`
- [ ] Verifiser GitHub Pages (cache-buster): APP_VERSION + ny logikk.

---

## Self-review (utført)

- **Spec-dekning:** datamodell+migrering (T1), generering per-mal/ukedag (T2), mutasjoner (T3),
  forelder-UI+sønn-badge (T4), CSS (T5), docs (T6). Fletting via settings-LWW (mutasjoner bumper
  `settings.updatedAt`) + `mergeQuestList` (uendret).
- **Placeholder-scan:** all kode konkret; PR-body fylles ut i T8.
- **Type-konsistens:** mal `{id,title,points,subtasks:[{id,text}],weekdays:['mon'..'fri'],enabled,updatedAt}`
  og instans `{...quest, source:'routine', routineId, routineDate, subtasks:[{id,text,done}]}` er like
  i T1/T2/T3/T4. `weekdayKey`-strenger brukt konsekvent. Legacy id `routine` → `routine-<dato>` bevart.
