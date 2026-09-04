# Honniscoins – prosjektkontekst

PWA der sønn fører skoletimer og får medaljer/poeng («Honniscoins»); forelder styrer
timeplan, poengverdier og utbetalinger. Norsk UI. Live på GitHub Pages.

- **Repo/remote:** `github.com/mgjesdal79/honniscoins` (main = default branch)
- **Live:** https://mgjesdal79.github.io/honniscoins/
- **Rom-modell:** familiens data ligger i én blob per «rom», delt via URL-hash `#r=<id>`.
  Backend = Supabase Edge Function `clever-function` (`window.EDGE_FUNCTION_URL` i index.html).
  Tom URL = localStorage-modus (utvikling).

## Arkitektur (vanilla, no-build, ES-moduler)
- `js/logic.js` – **ren logikk, ingen DOM/nett/globaler.** Alt er rene funksjoner av `state`
  (mutasjoner tar `ctx={now,id}` for testbarhet og returnerer NY state). Eneste fila med tester.
- `js/store.js` – synk: localStorage-cache + remote, `mergeState`-fletting, debounce-lagring,
  polling. `loadState` kjører `migrate()` etter fletting.
- `js/app.js` – DOM/rendering. `App`-objekt holder `role`/`currentDate`/`sonPage`/`parentTab`.
- `index.html` – all CSS + `APP_VERSION` + `EDGE_FUNCTION_URL`. Bump `APP_VERSION` ved hver deploy.
- Fletting: LWW per felt (`updatedAt`/`sickAt`/`lockedAt`/`weekLocks[].at`), union-by-id for
  append-only lister (`log`, `payouts`, framtidige `shopItems`/`purchases`). **`quests`** flettes
  derimot **LWW per id** på `updatedAt` (`mergeQuestList`) — ikke union — så statusendringer og
  sletting vinner nyest.
- Topp-logo (`brandHtml()` i app.js) viser **alltid saldo**: «Honniscoins: X 🪙», både for sønn
  (over bunn-nav) og forelder (over faner). Regnes via `computeBalance` ved hver render.

## Domenemodell (viktig)
- **Lås = commit, styrer ALT.** Kun `days[date].locked` gir poeng: medaljer, oppmøte-streak,
  ukesbonus og ekte streaks. Ulåst fortidsdag = «hull» som bryter streaks.
- **Redigeringsvindu (sønn):** inneværende + forrige uke (til `weekLocks[ws].closed`). Eldre =
  kun visning for sønn; forelder redigerer alt (`canSonEditDay`). Mandag-prompt tilbyr å låse
  forrige uke (`closeWeek`).
- **Ukesbonus (stables):** sølvtimer = sølv+gull (≥15→+5, ≥30→+10); gulltimer (≥10→+10, ≥20→+20,
  ≥30→+30). Høyeste trinn per farge. Konfig i `settings.bonus` (silverTiers/goldTiers).
- **Oppmøte/bronse-bonus:** data-drevet trapp `settings.bonus.attendanceLadder` (utvidbar).
- **Ekte streak (moro-teller, gir INGEN poeng):** utfylte timer på rad (sølv = sølv|gull,
  gull = gull), kronologisk over låste dager via `lessonSequence` → `hourStreak` →
  `silverStreakInfo`/`goldStreakInfo`. **Alle utfylte timer teller uansett syk/ikke** (syk
  med medalje teller også); tomme/ufylte timer **pauser** (bryter ikke); **«0» (ugyldig
  fravær) BRYTER**; ulåst dag bryter. Viser Nå / All-time / Denne måneden (+ ⏳ pågående).
  NB: oppmøte-/bronse-streak (`attendanceStreakInfo`, `classifyDay`) er en SEPARAT, poeng-
  relevant streak (styres av lås som alt annet).
- **Migrering** (`migrate`, kjøres i `loadState`): fyller `settings.bonus`/`weekLocks` og låser
  eksisterende dager med innhold, så gamle opptjente poeng ikke forsvinner.
- **Sønn-sider (pager):** Uken / Poeng (💵) / Sidequests (⭐) / Shop (🛒) — bunn-nav + sveip +
  prikker (`SON_PAGES` i app.js). Sidequests-ikonet har badge = antall åpne quests. Shop er
  fortsatt placeholder.
- **Uke-stripe-badge (`renderUkenPage`):** låst dag = «🔒 +X» (grønn), ulåst dag med opptjente
  poeng = «~X» (dempet, klasse `.b.prev`), tom/ingen poeng = «·». Ikke bare «·» overalt.
- **Forelder-faner (ikon + kort tekst, `renderParentHome`):** Uke 📅 / Dag 📝 / Plan 🗓 /
  **Quests** ⭐ / Logg 📋 / **Stat** 📊 / **Settings** ⚙️ (`App.parentTab ∈ {uke,dag,timeplan,
  quests,poeng,logg,stat}`). Settings-fanen ligger **sist/høyre**; intern nøkkel er fortsatt
  `'poeng'` (`renderPoengTab`: kr/coin, daglige rutiner, utbetalinger) — kun etikett/ikon/plass
  er endret. Dag-fanen har lås/åpne-dag og lås/åpne-uke. Quests-fanen har badge = antall quests
  til godkjenning. (Sønnens egen «Poeng»-side 💵 er urørt.)

## Sidequests (enkeltoppgaver hjemme)
- **Konsept:** forelder oppretter oppgave (tittel, beskrivelse, poeng, frist). Sønn «committer»
  når ferdig → forelder godkjenner (poeng i potten) eller sender tilbake.
- **Datamodell:** topp-nivå `quests: []`. Hver: `{id, title, desc, points, due, status, createdAt,
  createdBy, doneAt, approvedAt, updatedAt, removed}`. `status ∈ {open, done, approved}`.
- **Poeng teller KUN ved `status==='approved'`** (`questPointsTotal`, inngår i `computeBalance`).
  Ventende (`done`) vises separat via `questPointsPending`, teller ikke i saldo.
- **Livssyklus (logic.js, rene fn):** `addQuest`/`updateQuest`/`deleteQuest` (forelder),
  `commitQuest`/`uncommitQuest` (sønn: open↔done), `approveQuest`/`rejectQuest` (forelder:
  done→approved / done→open). `isQuestOverdue` = avledet (`due < i dag` og ikke approved).
  Sletting = `removed:true`-tombstone (overlever fletting). Alle logger `type:'quest'`.
- **Ett poengtall nå** — arkitekturen åpner for trappetrinn senere (`tiers` + valgt trinn ved
  commit) uten migrering.
- **UI:** sønn `renderSidequestsPage` (seksjoner Å gjøre / Venter på godkjenning / Godkjent);
  forelder `renderQuestsTab` (godkjenningskø + opprett/rediger-skjema + aktive quests).
- **Arkiv av godkjente (`questArchiveSplit(state, n=5)`, ren fn):** «Godkjent» viser kun de
  **5 nyeste** (sortert `approvedAt`, fallback `createdAt`); resten ligger bak knappen
  **«📦 Vis arkiv (N)»**, månedsgruppert (`YYYY-MM`, nyeste først). Returnerer `{recent,
  months:[{month,items}], archiveCount}` — ingen migrering. Delt UI-helper `approvedArchiveHtml`
  (brukt av både sønn og forelder; forelder beholder rediger/slett per kort) + `monthLabel`
  (norsk måned-navn). `App.questArchiveOpen` = ren visningstilstand (ikke persistert).
  CSS: `.arkbtn`/`.arkmonth`. Spec: `docs/superpowers/specs/2026-09-02-honniscoins-sidequest-arkiv-design.md`.
- **Frist-velger (forelder):** datostepper med standard = i dag, `‹`/`›` = ±1 dag, trykk midtfeltet
  (transparent `input[type=date]` over) åpner kalender, «Fjern frist»/«Sett frist (i dag)» veksler.
  Arbeids-frist holdes i closure-var `due` og oppdaterer kun visningen (nullstiller ikke
  tittel/beskrivelse/poeng).
- **Spec:** `docs/superpowers/specs/2026-08-22-honniscoins-sidequests-design.md`.
  Mockup: `mockups/sidequests.html`.

## Daglige rutiner (gjentakende sidequests)
- **Konsept:** flere redigerbare maler genererer automatisk avkryssbare sidequests per
  hverdag (f.eks. «Pakk sekken», «Pakk gymbagen»), uten manuell oppretting. Instansen ER
  en vanlig quest → arver all quest-maskineri (commit/godkjenn/poeng/arkiv/logg/fletting).
- **Mal-datamodell:** `settings.routines = [{id, title, points, subtasks:[{id,text}],
  weekdays:['mon'..'fri'], enabled, updatedAt}]` + topp-nivå `settings.routinesSeeded`
  (engangs seed-guard). Flettes som hel-objekt settings-LWW → hver mal-mutasjon bumper
  `settings.updatedAt`.
- **Migrering (`migrate`):** folder gammel `settings.dailyRoutine` inn i lista (id `'routine'`,
  weekdays man–fre) og sletter den; seeder tre familie-rutiner guardet av `routinesSeeded`:
  `routine-sekk` «Pakk sekken» (man–fre), `routine-matbag` «Pakk matbagen» (man–fre),
  `routine-gymbag` «Pakk gymbagen» (man/ons/tor/fre — IKKE tirsdag), alle 5 poeng, enabled.
  Slettet seed kommer ikke tilbake.
- **Generering (`generateDailyRoutines`, kalt sist i `migrate`):** én instans per aktiv mal
  hvis dagens `weekdayKey` er i malens `weekdays`; deterministiske id-er `<routineId>-<dato>`
  (id `routine` → legacy `routine-<dato>`); kun i dag (ingen backfill); idempotent via
  `mergeQuestList` (LWW).
- **Instans-felt (utover vanlig quest):** `source:'routine'`, `routineId`, `routineDate:'YYYY-MM-DD'`,
  `subtasks:[{id,text,done}]`. Manuelle quests har ingen `subtasks`/`source` → all UI/logikk
  tåler manglende subtasks (tom liste).
- **Mutasjoner (rene fn i logic.js):** `addRoutine(state,{routine},ctx)` (legger til ny mal),
  `updateRoutine(state,{id,patch},ctx)` (oppdaterer mal), `deleteRoutine(state,{id},ctx)`
  (fjerner mal) — erstatter `setDailyRoutine`. Alle bumper `settings.updatedAt` og logger
  `type:'routine'`. Uendret: `allSubtasksDone(quest)` (tom liste = true), `commitQuest` gatet
  (sønn kan ikke markere ferdig før alle subtasks er huket av), `toggleQuestSubtask(state,
  {id,subId},ctx)` (bumper `quest.updatedAt`, logges ikke), `updateQuest` utvidet med
  `subtasks`-patch (finjustere dagens instans uten å røre malen).
- **UI:** sønn — instans-kort i Sidequests («🔁 Rutine · <dato>»-badge, avkryssbar subtask-liste,
  «X av N gjort», låst «Marker som ferdig» til alt er huket av; helper `routineDateLabel`).
  Forelder — «Daglige rutiner»-liste i **Settings-fanen** (mal-kort med på/av, tittel, poeng,
  ukedag-piller Man–Fre `.wdpill`, deloppgave-editor med **dra-og-slipp** (`.draghandle`/
  `.subrow`), slett, «＋ Ny rutine»). CSS: `.qrec`/`.subs`/`.subchk`/`.subprog`/`.wdrow`/
  `.wdpill`/`.draghandle`/`.subrow`. **Kortene er sammenleggbare** (`.rhead`/`.rbody`/`.rchev`):
  klikkbar header viser tittel + sammendrag (ukedager · antall deloppg. · poeng · «(av)»), kropp
  kollapset som standard. Ekspander-tilstand i `App.routineOpen` (ren visning, ikke persistert);
  ny rutine åpnes automatisk. Alle input-bindinger kjører også når kroppen er `hidden`.
- **Rekkefølge på deloppgaver:** forelder styrer sekvensen ved **dra-og-slipp** via ⠿-håndtaket
  (pointer-basert, touch + mus; DOM-rekkefølge leses ved slipp og skrives til
  `settings.routines[].subtasks`). `syncOpenRoutineInstances` synker
  dagens åpne instans og **bevarer sønnens «done» ved å matche på TEKST (ikke indeks)**, så
  omrokkering ikke flytter avkryssingen til feil oppgave (like tekster konsumeres i rekkefølge;
  ukjent/omdøpt tekst = ikke gjort).
- **Future (ikke bygget):** ferie-modus (skru av rating + rutine på gitte datoer), flerbruker/deling.
- **Spec/plan:** `docs/superpowers/specs/2026-09-04-honniscoins-flere-rutiner-design.md`,
  `docs/superpowers/plans/2026-09-04-honniscoins-flere-rutiner.md`.

## Lekser (skolelekser per dag)
- **Konsept:** forelder registrerer lekser per dag (fag, tekst, poeng, evt. «hele uka»). Sønn
  «committer» når ferdig → forelder godkjenner (poeng i potten) eller sender tilbake. Samme
  livssyklus som Sidequests.
- **Datamodell:** topp-nivå `homework: []`. Hver: `{id, date, subject, text, points, status,
  wholeWeek, hidden, source, docendoUid, edited, doneAt, approvedAt, createdAt, createdBy,
  updatedAt, removed}`. `status ∈ {open, done, approved}`. `source ∈ {manual, docendo}`.
- **Poeng teller KUN ved `status==='approved' && !hidden`** (`homeworkPointsTotal`, inngår i
  `computeBalance`). Ventende (`done`) vises separat via `homeworkPointsPending`, teller ikke i
  saldo. `wholeWeek` er kun et visnings-merke («🗓 hele uka») — leksa ligger som en ordinær lekse
  på sin dag, IKKE en pinnet seksjon.
- **Innstillinger:** `settings.homeworkPoints` (default 5, brukes som standard-poeng ved add),
  `settings.docendoIcalId` (default `519a0908-ed7d-47ed-8667-dea07343b693`, for Fase 2).
- **Livssyklus (logic.js, rene fn):** `addHomework`/`updateHomework`/`deleteHomework` (forelder;
  `updateHomework` setter `edited:true`), `commitHomework`/`uncommitHomework` (sønn: open↔done),
  `approveHomework`/`rejectHomework` (forelder: done→approved / done→open), `hideHomework`
  (skjul/vis uten sletting). Avledet: `activeHomework` (!removed), `homeworkForWeek(state, iso)`
  (!hidden, sortert dato→fag). Sletting = `removed:true`-tombstone. Alle logger `type:'homework'`.
- **Fletting:** `homework` flettes **LWW per id** på `updatedAt` (`mergeHomeworkList`) — som
  quests, ikke union — så statusendringer og sletting vinner nyest.
- **UI:** sønn i **Uken**-siden (`homeworkSectionHtml`, dag/uke-toggle, «🗓 hele uka»-merke);
  forelder i **Dag**-fanen (`parentHomeworkHtml`: godkjenningskø + «Legg til»-skjema øverst +
  liste med rediger/skjul/slett). Poeng-siden viser `homeworkPointsPending`
  («📚 X 🪙 fra lekser venter på godkjenning»).
- **Sønnens «gjør ferdig»-knapp:** tekst «Marker som gjort» (imperativ, ikke «✓ Gjort» som
  leste som status) + grønn `.btn.good` (klassen manglet før → falt tilbake til blå nav-stil).
- **Inline redigering (forelder):** «✏️ Rediger» rendrer rediger-skjemaet DER leksa står i lista
  (`editFormFor(h)` når `h.id === App.editHwId`), ikke øverst i seksjonen — unngår scroll til
  toppen. Skjemaet har `id="hwEditForm"` + accent-ramme og `scrollIntoView` ved åpning. Samme
  input-id-er (`hwSubject`/`hwText`/`hwPoints`/`hwWeek`/`hwSave`/`hwCancel`) som før, så
  `bindParentHomework` er uendret. (Sidequests i Quests-fanen har fortsatt skjema-på-toppen.)
- **Docendo-import = Fase 2 (utsatt):** auto-import fra Docendo ICS-feed (proxy-edge-function +
  `parseIcs`/`homeworkFromIcs`/`mergeHomeworkImport` + «Hent lekser»-knapp) er planlagt, ikke
  bygget. Lekser legges foreløpig inn manuelt (evt. seedet i rom via engangs-skript).
- **Spec:** `docs/superpowers/specs/2026-08-23-honniscoins-lekser-design.md`.
  Plan: `docs/superpowers/plans/2026-08-23-honniscoins-lekser.md` (Fase 1 = Task 1–11 manuelt,
  Fase 2 = Task 12–15 Docendo). Mockup: `mockups/lekser-v2.html`.

## Statistikk (innsats-analyse)
- **Innsats-poeng per medalje:** 🥇 gull = 3, 🥈 sølv = 2, 🥉 bronse = 1 (`EFFORT_SCORE`).
  Fravær («0») og null teller ikke. Kun **låste, ikke-syke** dager inngår.
- **Kilde (logic.js, rene fn):** `effortRecords(state)` → `[{date, weekday, position,
  subjectKey, subjectLabel, medal, score}]`.
- **Periode (styrer HELE Stat-siden):** `App.statPeriod ∈ {d30, d90, all, custom}`
  (default `'d30'` = siste 30 dager). `periodBounds(period, today)` (nå med `'d30'`) +
  `filterRecordsByPeriod(recs, bounds)`. **Egendefinert** (`'custom'`) bruker
  `App.statFrom`/`App.statTo` (dato-range); app-helper `statBounds(today)` velger preset
  vs. custom. Chips: `Siste 30 d / 90 d / Alle / Egendefinert`; sistnevnte viser to
  `input[type=date]` (`#statFrom`/`#statTo`, `.statrange`).
- **Fem visnings-kort (`statContentHtml`, delt av forelder + sønn):**
  1. **`Utvikling over tid`** — **samlet trend-kort** (ligger FØRST). Dag/Uke-toggle
     (`App.statGran ∈ {day,week}`, default `'day'`; pille `.statgran[data-g]`,
     `.stattoolbar`) + felles fagvelger (`weekSelectHtml` → `<select>#statSubject`,
     `App.statSubject`, «Totalt» = `'__all__'`) som gjelder BEGGE oppløsninger.
     - Dag: `statDailyTotal(recs, subjectKey)` → `svgDailyTotal` (stablede medalje-søyler).
     - Uke: `statWeeklyTotal(recs, subjectKey)` → `svgWeeklyTotal` (mandag-startet,
       sammenhengende uker med 0-fyll).
     - **Stablede søyler:** hvert segment = poeng-bidrag (antall × medaljescore), rekkefølge
       nederst→øverst **gull → sølv → bronse**, 2px luftgap, fargeforklaring `.statlegend`,
       verditall når få stolper. Begge fn returnerer `{…,total,gull,solv,bronse}` og tar
       valgfritt `subjectKey` (null/`'__all__'` = alle fag; bakoverkompatibelt).
     - **Lang periode → kun uke:** når spennet **> 60 dager** (`STAT_MAX_DAY_SPAN`, målt via
       `periodSpanDays(bounds, recs)`; åpen ende = faktisk data-spenn) tvinges uke og
       `Dag`-knappen dempes (`.statgran.off`) med hint. Toolbar bygges i `statTrendControls`.
     - Fag-valg faller tilbake til «Totalt» hvis valgt fag ikke finnes i perioden.
  2. `statBySubject` — snitt-medalje per fag (rangerte stolper, `svgBySubject`).
  3. `statByPosition` — snitt per timenummer (`svgByPosition`).
  4. `statHeatmap` — ukedag × time (`svgHeatmap`, span2).
  5. `statMedalDistribution` — andel gull/sølv/bronse per fag (`svgDistribution`).
- **UI-plassering:** forelder i egen **Stat**-fane (`renderStatistikkTab`); sønn nederst på
  **Poeng**-siden. Begge kaller `statContentHtml(state)` + `bindStatChips(host)` (binder
  periode-chips, custom-datoinputs, Dag/Uke-toggle og fag-`<select>#statSubject`).
- **Bredde:** statistikk bryter ut av mobil-bredden på laptop via `body.statwide` (togglet i
  `routeToView` for forelder-Stat-fane ELLER sønn-Poeng), `@media (min-width:820px)` gir
  2-kolonners `.statgrid` (`.span2` = full bredde). Sønnens Poeng-innhold ligger i `.narrowcol`.
- **SVG-hjelpere (app.js):** `svgWrap`, `niceMax` (pen y-akse), `effortColor`, `hourLabel`,
  `weekSelectHtml`. dataviz-palett tilpasset mørkt tema (`--s1`/`--s2`/`--grid`/`--gull`/
  `--solv`/`--bronse`). `.statsel`/`.statselwrap` = mørk nedtrekk; `.statperiod` av-scopet fra
  `#ptab` (gjelder både forelder og sønn).
- **Spec:** `docs/superpowers/specs/2026-09-02-honniscoins-utvikling-daglig-ukentlig-design.md`
  (opprinnelig daglig total + uke-for-uke);
  `docs/superpowers/specs/2026-09-02-honniscoins-streak-fiks-sonn-statistikk-meny-design.md`
  (sønn-tilgang + ikon-meny + streak-fiks);
  `docs/superpowers/specs/2026-09-02-honniscoins-samlet-trend-design.md`
  (sammenslått trend-kort: dag/uke-toggle + felles fagvelger + én periode m/ custom range).

## Testing
- Ren logikk: `test/suite.js` (delt, DOM-fri, `runTests()`). 304 tester per nå (inkl. sidequests
  m/arkiv, lekser, rutiner inkl. rekkefølge/tekst-synk og statistikk/streak).
- **Kjør:** `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
  (jsc støtter ES-moduler; ingen node/deno/bun i miljøet).
- Nettleser: `test/tests.html` (tynn renderer av samme suite).
- Parse-sjekk app.js uten DOM: `jsc -m js/app.js` → `ReferenceError: document` = OK (syntaks fin),
  `SyntaxError` = feil.
- Alltid: legg `locked:true` på testdager som SKAL telle poeng (lås styrer alt).

## Deploy (miljø-begrensninger — les nøye)
- **dcg blokkerer `git push` til main** og **`git add -A/--all`** → jobb på branch og stage
  spesifikke filer. Flyt:
  1. `git switch -c <branch>`
  2. `git add <konkrete filer>` (aldri `-A`)
  3. `git commit` (trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)
  4. `git push -u origin <branch>`
  5. `gh pr create --base main` (egen Bash-kall)
  6. `gh pr merge <branch> --merge --delete-branch`
  7. `git switch main && git pull --ff-only`
- **Rampart blokkerer pipet nedlasting** (`curl | grep`) → last til fil, grep separat.
- **GitHub Pages-latens ~1–2 min** og cacher per fil → verifiser både `index.html` (APP_VERSION)
  og `js/app.js`/`js/logic.js` med cache-buster (`?cb=$RANDOM`).
- **pipelock-hook:** unngå å lime rå tallrekker (f.eks. SVG path-data) inn i filer → falsk
  SSN-treff. Bruk base64 `data:`-URL ved behov.

## Konvensjoner
- Norsk i UI og commit-meldinger. Unngå «På'an» som entusiastisk (se global memory).
- Medaljeknapper: stil B = «fyll ved valg» (`.m.fill.sel` får farge). Sønn bruker store `.big`.
- Design-spec: `docs/superpowers/specs/2026-08-21-honniscoins-lasing-streaks-sider-design.md`.
  Klikkbar mockup: `mockups/skisser.html`.
