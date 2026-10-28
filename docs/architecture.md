# Honniscoins – feature-arkitektur (detaljer)

Dette er de dype feature-beskrivelsene som før lå i `CLAUDE.md`. De er flyttet hit for å
holde `CLAUDE.md` under kontekst-grensa. `CLAUDE.md` har en kort peker til hver seksjon —
les den relevante seksjonen her når en oppgave gjelder den biten.

Kjernearkitektur, domenemodell, testing, deploy og konvensjoner ligger fortsatt i `CLAUDE.md`.

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
- **Generering (`generateDailyRoutines`, kalt i `migrate`):** én instans per aktiv mal hvis
  dagens `weekdayKey` er i malens `weekdays`; deterministiske id-er `<routineId>-<dato>` (id
  `routine` → legacy `routine-<dato>`); kun i dag (ingen backfill); idempotent via `mergeQuestList`
  (LWW). **«Vis fra dagen før» (`settings.routines[].leadDay`, default false):** når på lages OGSÅ
  morgendagens instans (`makeInstance(r, tomorrowIso)`) — slik dukker f.eks. en mandagsrutine opp
  hos sønnen søndag kveld i seksjonen «For i morgen 🌙».
- **Utløp av gamle instanser (`expireStaleRoutineInstances`, kalt i `migrate` FØR generering, b56):**
  rutine-instanser er dag-bundet. En instans hvis `routineDate < i dag` som fortsatt står `open`
  (aldri gjort/skippet — f.eks. sykdom uten å trykke «Ikke gjort») merkes automatisk `skipped`
  (`skippedBy:'system'`, deterministisk today-stamp så det vinner fletting uten flip-flop; idempotent
  via guard `status==='open'`). **Hvorfor:** ellers henger den for alltid som datoløs «aktiv quest»
  hos forelder OG blokkerer nye instanser — `overlappingRoutineIds` regner den som rutinens tidligste
  åpne og skjuler dagens/morgendagens instans (var rotårsak til «nye rutiner dukker ikke opp»).
- **Instans-felt (utover vanlig quest):** `source:'routine'`, `routineId`, `routineDate:'YYYY-MM-DD'`,
  `subtasks:[{id,text,done}]`. Manuelle quests har ingen `subtasks`/`source` → all UI/logikk
  tåler manglende subtasks (tom liste).
- **Mutasjoner (rene fn i logic.js):** `addRoutine(state,{routine},ctx)` (legger til ny mal),
  `updateRoutine(state,{id,patch},ctx)` (oppdaterer mal), `deleteRoutine(state,{id},ctx)`
  (fjerner mal) — erstatter `setDailyRoutine`. **`addRoutine`/`updateRoutine` genererer instanser
  STRAKS (b55):** begge returnerer `syncOpenRoutineInstances(generateDailyRoutines(s, today), today,
  ctx.now)`, så ny/aktivert rutine — eller å skru på `leadDay` — materialiserer dagens/morgendagens
  instans med én gang (lander i blobben, flettes til sønnen som quest uten full reload). `updateRoutine`
  synker i tillegg eksisterende åpne instanser mot malen. Alle bumper `settings.updatedAt` og logger
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
- **Auto-fullføring når alt er huket av (b58):** rutine-instanser avanserer automatisk når
  siste deloppgave hukes av — INGEN «Marker som ferdig»-klikk for deloppgave-rutiner (knappen
  er fjernet for dem; rutiner UTEN deloppgaver beholder den). Regel i `toggleQuestSubtask`
  (ren fn): rutine + status `open` + alle deloppgaver avhuket → `done` (poeng > 0, til
  godkjenning) eller ny terminal-status **`completed`** (0 coins, ingen godkjenning). Å fjerne
  en avhuking på en `completed`-rutine **vekker** den (`completed → open`), gated til
  `routineDate >= i dag` (som `unskipRoutineInstance`; passert `completed`-rutine er helt
  låst — toggle er no-op via tidlig retur før mutasjon). `commitQuest` ruter også 0-coins-
  rutiner (uten deloppgaver) til `completed`. `completed` er son-terminal: teller ikke i
  saldo (`questPointsTotal` kun `approved`; 0-coins = 0), rører ikke `routinesRemaining`/
  `overlappingRoutineIds`/`expireStaleRoutineInstances` (alle ser kun `open`), og dukker IKKE
  opp i forelderens godkjenningskø/badge (`status==='done'`). Ingen migrering. UI: `completed`
  vises i sønnens **«I dag»** (etter åpne) med «✓ ferdig»-pille (`.rtpill.ok`) og redigerbare
  deloppgaver (avhuking vekker); logg-action `complete` → «✓ Fullførte …».
- **Future (ikke bygget):** ferie-modus (skru av rating + rutine på gitte datoer), flerbruker/deling.
- **Spec/plan:** `docs/superpowers/specs/2026-09-04-honniscoins-flere-rutiner-design.md`,
  `docs/superpowers/plans/2026-09-04-honniscoins-flere-rutiner.md`;
  `docs/superpowers/specs/2026-09-14-honniscoins-rutiner-auto-fullfor-design.md`,
  `docs/superpowers/plans/2026-09-14-honniscoins-rutiner-auto-fullfor.md`.

## Lekser (skolelekser per dag)
- **Konsept:** forelder registrerer lekser (fag, tekst, poeng, hvilke dager). Sønn «committer»
  når ferdig → forelder godkjenner (poeng i potten) eller sender tilbake. Samme livssyklus som
  Sidequests.
- **To typer over flere dager (erstatter «hele uka»-toggelen):**
  - **Én innlevering** (matteark til fredag): **én** post med `days:[datoer]`, delt fullføring —
    vises på hver dag som påminnelse, gjort/godkjent én gang = gjort-gjort overalt, **poeng én gang**.
    `date` = frist (siste dag i `days`). Badge «📄 frist <dag>».
  - **Daglig oppgave** (les litt hver dag): **N** poster (én per dag) med delt `groupId`, egne
    poeng/status per dag; gjort mandag ≠ gjort tirsdag; godkjennes per dag. Badge «🔁 daglig».
- **Datamodell:** topp-nivå `homework: []`. Hver: `{id, date, days?, groupId, subject, text, points,
  status, hidden, source, docendoUid, edited, doneAt, approvedAt, createdAt, createdBy, updatedAt,
  removed}`. `days` settes KUN på én-innlevering over flere dager; `groupId` KUN på daglig-serier
  (`null` ellers). Helper `homeworkDays(h)` = `days?.length ? days : [date]` — all dag-filtrering
  bruker denne. `status ∈ {open, done, approved}`. `source ∈ {manual, docendo}`.
  (`wholeWeek`-feltet er fjernet; `migrate` stripper det fra gamle poster.)
- **Poeng teller KUN ved `status==='approved' && !hidden`** (`homeworkPointsTotal`, inngår i
  `computeBalance`). Ventende (`done`) vises separat via `homeworkPointsPending`, teller ikke i
  saldo. Én innlevering = én post → teller én gang; daglig = N poster → per godkjent dag.
- **Innstillinger:** `settings.homeworkPoints` (default 5, brukes som standard-poeng ved add),
  `settings.docendoIcalId` (default `519a0908-ed7d-47ed-8667-dea07343b693`, for Fase 2).
- **Livssyklus (logic.js, rene fn):** `addHomework(state,{date,days,mode,...})` — `mode:'once'`
  lager én post (m/ `days` når >1 dag), `mode:'daily'` lager N poster m/ delt `groupId` og
  deterministiske id-er `${ctx.id}-${dato}`. `updateHomework` (forelder; setter `edited:true`;
  `days`-patch erstatter gammel `wholeWeek`-patch), `deleteHomework` (én post),
  `deleteHomeworkGroup({groupId})` (hele daglig-serien), `commitHomework`/`uncommitHomework`
  (sønn: open↔done), `approveHomework`/`rejectHomework` (forelder: done→approved / done→open),
  `hideHomework` (skjul/vis uten sletting). Avledet: `activeHomework` (!removed), `homeworkDays`,
  `homeworkForWeek(state, iso)` (!hidden, tar med multi-dag hvis én dag treffer uka, sortert
  dato→fag). Sletting = `removed:true`-tombstone. Alle logger `type:'homework'`.
- **Fletting:** `homework` flettes **LWW per id** på `updatedAt` (`mergeHomeworkList`) — som
  quests, ikke union — så statusendringer og sletting vinner nyest.
- **UI:** sønn i **Uken**-siden (`homeworkSectionHtml`) viser **kun valgt dags** lekser under en
  dominerende **«📚 Lekser»**-tittel (`.hwtitle`) — ingen dag/uke-toggle lenger (multi-dag-leksa
  dukker uansett opp på hver av sine dager). «📄 frist»/«🔁 daglig»-merker; filtrerer via
  `homeworkDays`. Forelder i **Dag**-fanen (`parentHomeworkHtml`): godkjenningskø + «Legg til»-
  skjema med **type-velger** `#hwNewType` (📄 én innlevering / 🔁 daglig) + **ukedag-avhuking**
  `.hwNewDay` for gjeldende uke + dynamisk poeng-etikett `#hwPtsLabel`; liste med
  **sammenleggbare kort** (`.rhead`/`.rbody`/`.rchev`, samme mønster som rutiner; header = fag +
  merke + status·poeng, kropp = tekst + knapper; ekspander-tilstand i `App.homeworkOpen`, ren
  visning, ikke persistert), rediger/skjul/slett, «🗑 Slett serie» på daglig-poster, flytt-piler
  skjult for multi-dag. Poeng-siden viser `homeworkPointsPending` («📚 X 💰 fra lekser venter på
  godkjenning»).
- **Sønnens «gjør ferdig»-knapp:** tekst «Marker som gjort» (imperativ, ikke «✓ Gjort» som
  leste som status) + grønn `.btn.good` (klassen manglet før → falt tilbake til blå nav-stil).
- **Inline redigering (forelder):** «✏️ Rediger» rendrer rediger-skjemaet DER leksa står i lista
  (`editFormFor(h)` når `h.id === App.editHwId`), ikke øverst i seksjonen — unngår scroll til
  toppen. Skjemaet har `id="hwEditForm"` + accent-ramme og `scrollIntoView` ved åpning. Samme
  input-id-er (`hwSubject`/`hwText`/`hwPoints`/`hwSave`/`hwCancel`) + ukedag-avhuking `.hwEditDay`
  (kun på én-innlevering, ikke på daglig-serie-instans). (Sidequests i Quests-fanen har fortsatt
  skjema-på-toppen.)
- **Docendo-import = Fase 2 (utsatt):** auto-import fra Docendo ICS-feed (proxy-edge-function +
  `parseIcs`/`homeworkFromIcs`/`mergeHomeworkImport` + «Hent lekser»-knapp) er planlagt, ikke
  bygget. Lekser legges foreløpig inn manuelt (evt. seedet i rom via engangs-skript).
- **Spec:** `docs/superpowers/specs/2026-08-23-honniscoins-lekser-design.md` (opprinnelig);
  `docs/superpowers/specs/2026-09-04-honniscoins-lekser-flere-dager-typer-design.md` (flere dager
  + to typer, erstatter «hele uka»-toggelen). Plan: `docs/superpowers/plans/2026-08-23-honniscoins-lekser.md`
  (Fase 1 = Task 1–11 manuelt, Fase 2 = Task 12–15 Docendo). Mockup: `mockups/lekser-v2.html`.

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
  4. `statHeatmap` — **time × ukedag** (`svgHeatmap`, span2): **timenummer = rader, ukedager =
     kolonner** (snudd b50 etter ønske). **Farge = intuitiv divergerende
     skala svakt→sterkt** (rød `--hm1` → grå `--hm2/--hm3` → grønn `--hm4/--hm5`), *ikke* den
     gamle blå enkelt-hue `--seq*`-rampen. `idx(avg)=round((avg-1)/2·4)` mapper snitt 1–3 til de
     5 trinnene; lysheten øker monotont med verdien (lesbart også ved rød/grønn-fargeblindhet),
     tallet i cella er ekstra kanal, + `.statlegend` «Svakt 🥉 / Middels 🥈 / Sterkt 🥇». Lyse
     grønn-trinn får mørk celletekst.
  5. `statMedalDistribution` — andel gull/sølv/bronse per fag (`svgDistribution`).
- **Dagsfordeling-kort (`svgDayComposition`, ligger RETT UNDER «Utvikling over tid»):** én
  **like høy** stolpe per låst dag (100 %-stablet) — fargene viser *andelen* av dagens timer,
  ikke volum. Segmenter nedenfra→opp: gull → sølv → bronse → **gyldig fravær** (`--valid`, turkis)
  → **ugyldig fravær «0»** (`--invalid`, rød) → **tom/ikke fylt** (`--tom`, grå rest). Ny ren fn
  `dayComposition(state, subjectKey)` i logic.js teller per låst dag `{date,weekday,gull,solv,
  bronse,valid,invalid,tom,total}` — til forskjell fra `effortRecords` tar den med fravær OG tomme
  timer. Regel per time-slot (subjects+marks-indekser): medalje→medalje, `'0'`→invalid, uvurdert
  på **syk** dag→valid (gyldig fravær; syk-med-medalje teller fortsatt som medalje), uvurdert på
  ikke-syk dag→tom. Filtreres på periode via `filterRecordsByPeriod` (dato). CSS-vars `--valid`/
  `--invalid`/`--tom` i `.statgrid`. Prototype: `mockups/utvikling-fordeling-prototype.html`.
- **UI-plassering:** forelder i egen **Stat**-fane (`renderStatistikkTab`); sønn nederst på
  **Poeng**-siden. Begge kaller `statContentHtml(state)` + `bindStatChips(host)` (binder
  periode-chips, custom-datoinputs, Dag/Uke-toggle og fag-`<select>#statSubject`).
- **Bredde:** statistikk bryter ut av mobil-bredden på laptop via `body.statwide` (togglet i
  `routeToView` for forelder-Stat-fane ELLER sønn-Poeng), `@media (min-width:820px)` gir
  2-kolonners `.statgrid` (`.span2` = full bredde). **Alle fem kortene bruker nå `span2`** (b50)
  → stablet i full bredde etter hverandre, også på laptop. Sønnens Poeng-innhold ligger i `.narrowcol`.
- **Mobil-lesbarhet:** SVG-ene har fast `viewBox`-bredde `STAT_VBW` (modul-var i app.js).
  `statContentHtml` setter `STAT_NARROW = !matchMedia('(min-width:820px)')` og `STAT_VBW =
  narrow ? 380 : 800` FØR grafene bygges. Smal viewBox ⇒ 1 SVG-enhet ≈ 1 skjermpiksel, så
  teksten skaleres ikke ned til ~6px. Alle `svg*`-fn bruker `const W = STAT_VBW`; `svgWrap`
  legger klassen `narrow` på `<svg>` → `.statsvg.narrow`-regler bumper skriftstørrelsene.
  Laptop (≥820px) er uendret (W=800). Re-render skjer via `routeToView` (ikke på ren
  vindus-resize — kjent, ubetydelig).
- **SVG-hjelpere (app.js):** `svgWrap`, `niceMax` (pen y-akse), `effortColor`, `hourLabel`,
  `weekSelectHtml`. dataviz-palett tilpasset mørkt tema (`--s1`/`--s2`/`--grid`/`--gull`/
  `--solv`/`--bronse`/heatmap `--hm1..--hm5`). `.statsel`/`.statselwrap` = mørk nedtrekk;
  `.statperiod` av-scopet fra `#ptab` (gjelder både forelder og sønn).
- **Spec:** `docs/superpowers/specs/2026-09-02-honniscoins-utvikling-daglig-ukentlig-design.md`
  (opprinnelig daglig total + uke-for-uke);
  `docs/superpowers/specs/2026-09-02-honniscoins-streak-fiks-sonn-statistikk-meny-design.md`
  (sønn-tilgang + ikon-meny + streak-fiks);
  `docs/superpowers/specs/2026-09-02-honniscoins-samlet-trend-design.md`
  (sammenslått trend-kort: dag/uke-toggle + felles fagvelger + én periode m/ custom range).

## Shop (kjøp premier med Honniscoins)
- **Konsept:** erstatter placeholderen på sønnens 🛒-side. V-bucks-inspirerte fargekort
  (Variant A). **Delt ønskeliste:** både forelder OG sønn legger til/fjerner varer. Kjøp går
  via request → commit (samme mønster som quests/lekser); forelder styrer økonomien.
- **Flyt:** forelder/sønn legger til vare (bilde, tittel, link, farge, pris) → sønnens varer
  uten pris = `wish` (ingen kjøp-knapp) til forelder setter pris → `available` → sønn «Kjøp»
  (kun hvis råd) → `requested` (coins **reservert visuelt** + forelder varsles badge+epost) →
  forelder bestiller IRL + «Bestilt – trekk coins» → **commit**: post i `purchases`-boka,
  coins trukket permanent, varen forlater shopen. Sønn ser «Kjøpt» + «brukt totalt».
- **Datamodell (to topp-nivå-lister):**
  - `shopItems: []` — `{id, title, link, image (base64 PNG), color, price, priceSet, status,
    createdBy, createdAt, requestedAt, updatedAt, removed}`. `status ∈ {wish, available,
    requested}`.
  - `purchases: []` — permanent kvitteringsbok (skrives ved commit, aldri slettet):
    `{id, itemId, title, image, color, price (snapshot), at, by, hidden, updatedAt}`. `hidden`
    = ren visning (sønn kan rydde bort kort; beløp/historikk står fast).
- **Poeng/saldo (rene fn):** `shopSpentTotal` = Σ `purchases[].price` (uansett hidden) trekkes
  i `computeBalance`. `reservedTotal` = Σ pris på `requested`-varer (teller IKKE i ekte saldo).
  `availableBalance = computeBalance − reservedTotal`. Kjøp-knapp gatet på `availableBalance ≥
  price`; `requestShopItem` håndhever samme regel (returnerer uendret state hvis ikke råd).
- **Livssyklus (logic.js, rene fn, bumper updatedAt, logger `type:'shop'`):** `addShopItem`
  (`available` hvis `priceSet && price>0`, ellers `wish`), `setShopPrice`, `updateShopItem`
  (price-patch: `wish↔available`-veksling når pris settes/nullstilles), `deleteShopItem`
  (tombstone), `requestShopItem` (gatet), `cancelShopRequest`, `commitShopPurchase` (atomisk:
  push purchase-snapshot + item `removed:true`+`status:'committed'`), `hidePurchase`,
  `moveShopItem(state,{id,dir},ctx)` (b65). Avledet: `activeShopItems`, `shopItemsByStatus`,
  `activePurchases` (sortert `at` desc), `visiblePurchases`.
- **Rekkefølge (b65):** hver vare har et valgfritt `order`-felt (heltall). `addShopItem` stempler
  `order: nextShopOrder(state)` (max+1). `shopItemsByStatus` sorterer med `shopOrderCmp`
  (`order` stigende; varer uten `order` sist, fallback `createdAt` → eldre blobber uten feltet er
  stabile). **`moveShopItem`** bytter en «Til salgs» (`available`) vare med nabo opp/ned: normaliserer
  listen til sammenhengende 0..N `order`, bytter de to indeksene, og bumper `updatedAt` KUN på varene
  som faktisk endret seg (minimal flette-churn). Fletting via `mergeById` (LWW per id) holder
  rekkefølgen sync-trygg — array-posisjon ville ikke overlevd fletting. **Både sønn og forelder**
  kan omrokere (▲/▼-piller, `.shopmove`/`.smv`), kun på `available`-varer; pilene er disablet ved
  kanten og skjult når < 2 varer.
- **Fletting:** `shopItems`/`purchases` flettes **LWW per id** (`mergeById`) — statusendring/
  sletting/hidden/`order` vinner nyest.
- **Bilder:** `resizeImageToSquarePng(file, size=400)` (app.js) → transparent kvadratisk 400×400
  PNG (contain/sentrert), lagres base64 i `shopItems[].image`. **Blob-vekst boundet:**
  `pruneShopImages(state, keep=SHOP_IMG_KEEP=20)` beholder base64 kun på de 20 nyeste kjøpene,
  nuller eldre; kalt SIST i `migrate` (`return pruneShopImages(out);` etter `pruneLog`).
- **Farger:** `SHOP_COLORS` i app.js = **16 gradienter** (green/blue/purple/orange +
  red/pink/rose/yellow/lime/teal/cyan/indigo + nøytrale black/graydark/graylight/white),
  `color` lagrer id-en, `shopGrad(id)` slår opp. Delt fargevelger (`.colorpick` m/ `flex-wrap`)
  i `renderShopAddForm` (sønn + forelder).
- **Lenker saniteres:** `safeShopHref(url)` — kun `http(s)://`, ellers `#` (blokkerer
  `javascript:`/`data:`); escapes via `escapeHtml`.
- **UI:** sønn `renderShopPage`/`bindSonShop` (seksjoner Til salgs / reservert / ønsker / Kjøpt +
  `renderShopAddForm`). Forelder ny **Shop-fane** 🛒 (`renderShopTab`, `App.parentTab='shop'`,
  badge = antall `requested`): forespørsler-kø (commit/avvis), sett pris på `wish`, aktive varer.
- **Rediger vare (tittel/lenke/pris/farge/bilde):** `renderShopAddForm(box, role, item)` er delt
  av tilføy OG rediger — `item` satt = rediger-modus (forhåndsutfylt). Kaller `updateShopItem`
  (patch inkl. `price`, som veksler `wish↔available`) ved rediger, ellers `addShopItem`. Helper
  `openShopEdit(containerId, itemId, role)` åpner skjemaet i tilføy-containeren (`shopAddForm`/
  `shopAddFormP`) + `scrollIntoView`. Rediger-knapp (`.btn good .shopedit`) på sønnens
  til-salgs-kort (`data-shopedit`) og forelderens ønske-/aktive-kort (`data-shopeditp`); IKKE på
  `requested` (i flukt/reservert).
- **Pris i skjemaet (b54):** prisfelt vises for **BEGGE roller** (sønn + forelder), både ved
  opprett OG rediger — begge kan foreslå/endre pris. Tom pris = `wish` (ønske uten pris);
  `price>0` ⇒ `priceSet:true` ⇒ `available`. Feltet er **prominent**: gull-innrammet
  (`.inp.shopprice`, `border:2px var(--gold)`), **halv bredde** med «coins» til høyre
  (`.shopfld`/`.shopprice-row`/`.shopprice-unit`) — INGEN stepper, INGEN forslag (bevisst valg).
- **Bilde-panel + levende preview (b54):** «Bilde av premien» er et eget luftig panel
  (`.shopimgsec`, skillestrek + egen overskrift). Under vises et **mini shop-kort-preview**
  (`.shopcard.shoppv`) som speiler ekte kort: bilde/🎁-placeholder mot valgt bakgrunnsgradient +
  tittel + pris («Ingen pris ennå» = `.price.none` når tom). `syncPreview()` oppdaterer live ved
  endring av tittel/pris/farge/bilde. Bildeopplasting = tydelig `.filebtn`-knapp
  («📷 Last opp/Bytt bilde») + «Fjern bilde»-lenke i `.shopimgbtns`. Prototype:
  `mockups/shop-skjema-prototype.html`.
- **Coins vises som 💰** (pengesekk) i hele UI-et — IKKE 🪙 sølvmynt (byttet b46).
- **Varsling:** `settings.notifyEmail` (tom = kun badge). `requestShopItem` → `notifyRequest(room,
  {to,title,link,price})` i store.js → POST `action:'notify'` til edge-funksjonen; feiler stille.
  **Edge-funksjonen (`notify`+Resend) må deployes SEPARAT** — dokumentert i
  `docs/superpowers/specs/shop-edge-notify.md` (env `RESEND_API_KEY`, `NOTIFY_FROM`). Ikke bygget/
  deployet ennå per nå; badge er primær.
- **Spec/plan:** `docs/superpowers/specs/2026-09-06-honniscoins-shop-design.md`,
  `docs/superpowers/plans/2026-09-06-honniscoins-shop.md`.

## Banken (sparekonto + fond) — sønnen investerer opptjente coins
- **Konsept:** sønnen velger mellom to produkter for opptjente coins. Begge frie inn/ut (ingen
  hard lås); vekst akkumulerer over tid.
  - **🏦 Sparekonto** — lineær rente, garantert. Rente stemples per innskudd (`entry.rate`);
    forelder setter sats i Settings.
  - **📈 Fond** — deterministisk simulert indekskurve (`navForDate`), ±3 %/dag «rails».
    **INNSATS-DREVET (b63):** kursen vokser tydelig de ukene gutten tjener ferske innsats-poeng
    (medaljekvalitet på LÅSTE, ikke-syke dager), forsterket av streak; ellers bare svak grunn-drift
    (~+0,6 %/uke) → passiv/hamstret saldo lønner seg IKKE. Coins/saldo er URØRT (innsats speiles,
    forbrukes ikke). Vist verdi **aldri under innskudd** (gulv på principal — papirtap av gevinst,
    ikke av innskudd). Se egen «Innsats-drevet fond + ferie»-blokk nedenfor.
- **Ledger-fold-arkitektur (viktig):** én append-only `bank.ledger` er SANNHETEN; all verdi/
  holdning er RENE funksjoner av ledger + dato (deterministisk, flettevennlig). Ingen lagret
  saldo. Fletting: `bank.ledger` via **union-by-id** (append-only, som `log`/`payouts`);
  `settings.bank` via settings-LWW. Migrering (`migrate`): sikrer `bank={ledger:[]}` +
  `settings.bank={savingsWeeklyRate:0.02}` og (b63) fond-defaults `fundBaseWeeklyRate:0.006`,
  `fundNeutralWeeklyRate:0.02`, `fundEffortMult:1`, `vacations:[]` (rører ikke `savingsWeeklyRate`).
- **Datamodell:** topp-nivå `bank.ledger:[]`, hver: `{id, product:'savings'|'fund',
  type:'deposit'|'withdraw', amount, date:'YYYY-MM-DD', at, by, rate?}` (`rate` kun på
  savings-innskudd). `settings.bank.savingsWeeklyRate` (brøk, default 0.02 = 2 %/uke).
- **Rene fn (logic.js):** kurve `navForDate(state, iso)` (b63: nå STATE-drevet, ikke ren
  dato-fn; epoke 2024-01-01, NAV=100, seeded støy, `BANK_FUND_*`-konstanter). Sparekonto:
  `foldSavings`→lotter, `savingsLotValue`
  (`amount×(1+rate×uker)`, uker = dager/7 desimal → vokser DAGLIG), `savingsValue(state,date)`,
  `savingsPrincipal`. Fond: `foldFund`→`{units,principal}`, `fundMarketValue(state,date)`,
  `fundValue(state,date)`=`max(units×nav, principal)`. Uttak reduserer eldste lotter først
  (savings, behold date/rate) / units+principal proporsjonalt med `f=amount/V` (fund).
  Saldo: `netInBank`=Σinn−Σut (dato-uavhengig), `spendable`=`availableBalance` (nå bank-bevisst),
  `bankValue(state,date)`, `totalWealth(state,date)`. Mutasjoner: `depositBank`/`withdrawBank`
  (`{product,amount,by}`, floorer beløp, deposit gatet på `availableBalance`, withdraw gatet på
  produktverdi; logger `type:'bank'`). Historikk: `bankHistoryRange(state,from,to)` (nyeste
  først; `from=null`→fra første hendelse; datoer før første hendelse klippes; guard 1000 dager),
  `bankHistory(state,today,days=14)` delegerer, `bankTransactions(state)` (nyeste først).
- **Saldo-integrasjon (elegant):** `availableBalance` trekker nå fra `netInBank` → shop-gating
  (både `renderShopPage` `canBuy` OG `requestShopItem`) respekterer automatisk penger i banken.
  Topp-logo (`brandHtml`) viser **`totalWealth`** (ledig + bank), ikke bare saldo.
- **UI (sønn):** Poeng-siden heter **Penger** 💰 (SON_PAGES) med tre sub-tabs
  (`App.sonMoneyTab ∈ {oversikt, bank, stat}`, `.subtabs`/`.subtab`): **Oversikt** (saldo/bonus/
  streaks), **🏦 Bank**, **📊 Statistikk** (stats flyttet hit fra bunnen av Oversikt; `body.statwide`
  gjelder KUN på stat-fanen). Bank-visning (`renderBankView`/`bindBankView`): formue-header,
  produktkort m/ sparkline (`fundSparklineSvg`, siste 30 dager NAV) + dagsendring, inn/ut-skjema
  (`stepperHtml`, råd-/verdi-sperre), transaksjonsliste, + knapp til **egen dag-for-dag-side**
  (`App.bankView ∈ {main, history}`; `renderBankHistoryView`/`bindBankHistory`) med periode-chips
  (Siste 30 d / 90 d / Alle / Egendefinert, `App.bankPeriod`/`bankFrom`/`bankTo`, gjenbruker
  `.statchip`/`.statperiod`/`.statrange`; default 30 d) + tabell (Spare/Fond/Totalt, dagsendring).
  Sub-tab-bytte nullstiller `bankView` til `main`. CSS: `.bankcard`/`.bankhead`/`.bankval`/`.gain`
  (`.up`/`.down`)/`.spark`/`.bankform`/`.bankrow`(+`.head`/`.now`/`-d`/`-v`/`-t`).
- **UI (forelder):** Settings (`renderPoengTab`) har «🏦 Bank»-seksjon → **Sparerente (%/uke)**
  (`#savRate` stepper, lagres som brøk `pct/100`, bumper `settings.updatedAt`; gjelder kun NYE
  innskudd — eksisterende lotter beholder stemplet rate). Logg-gren (`renderLoggTab`,
  `type:'bank'`): «🏦 Satte inn/Tok ut … i sparekonto/fond».
- **v2 (ikke bygget):** forelder-oversikt (kun visning) over sønnens bank.
- **Spec/plan:** `docs/superpowers/specs/2026-09-24-honniscoins-bank-renter-fond-design.md`,
  `docs/superpowers/plans/2026-09-24-honniscoins-bank-renter-fond.md`.

### Innsats-drevet fond + ferie-modus (b63)
- **Intensjon:** appens mål er å få gutten på skolen og yte, ikke å vokse penger. Fondet er «en
  aksje i deg selv» — det HOPPER de ukene han gjør det bra, kryper ellers, og går som et vanlig
  fond i ferien. Guttens coins/saldo er HELT urørt (innsats speiles i kursen, forbrukes ikke;
  ingen dobbelttelling, ingen migrering av opptjente coins).
- **Formel (per dag `d` fra epoken, i `navSeries`):** ferie-dag → `nøytral_drift/7 + støy`;
  ellers → `grunn_drift/7 + (innsats_løft × streak_faktor)/7 + støy`; alt kappet ±`BANK_FUND_CAP`
  (±3 %/dag). `nav *= 1 + r_d`.
  - **innsats_løft(uke)** = `min(BANK_FUND_EFFORT_CAP, fundEffortStrength(state) × weekEffortScore)`.
    `weekEffortScore(state, ws)` = Σ medaljescore (`EFFORT_SCORE` 🥇3/🥈2/🥉1) på LÅSTE, ikke-syke,
    **ikke-ferie** dager i uka (via `effortRecords`). `fundEffortStrength(state)` skalerer med
    tunbar `settings.bank.fundEffortMult`.
  - **streak_faktor(uke)** = `1 + BANK_FUND_STREAK_STEP × min(fundStreakWeeks, BANK_FUND_STREAK_CAP)`
    (default 0,05/uke, tak 10 uker ⇒ maks ×1,5). `fundStreakWeeks` teller sammenhengende uker med
    innsats bakover; **full ferie-uke PAUSER** (bryter ikke), en ikke-ferie null-innsats-uke
    NULLSTILLER. (Partiell ferie-uke = vanlig uke → null skole-innsats der nullstiller — bevisst.)
- **Konstanter (logic.js, IKKE i Settings):** `BANK_FUND_BASE_WEEKLY 0.006`,
  `BANK_FUND_NEUTRAL_WEEKLY 0.02`, `BANK_FUND_EFFORT_PER_POINT 0.0016`, `BANK_FUND_EFFORT_CAP 0.04`,
  `BANK_FUND_STREAK_STEP 0.05`, `BANK_FUND_STREAK_CAP 10`, `BANK_FUND_VOL 0.005` (senket fra 0.02
  så INNSATS DOMINERER tilfeldig børs-støy — bevisst brukervalg), `BANK_FUND_CAP 0.03`.
- **Ferie:** `settings.bank.vacations = [{id, from:'YYYY-MM-DD', to:'YYYY-MM-DD'}]` (inklusive begge
  ender). `isVacationDay(state, iso)` = iso i minst én periode. Håndteres PER DAG i foldingen (tåler
  fridager midt i uka / ukeskille). Datastrukturen er gjenbrukbar for senere ferie-modus (rutiner/
  rating — ikke bygget). Mutasjoner `addVacation(state,{from,to},ctx)` (normaliserer from≤to, tom
  fra/til = no-op) / `removeVacation(state,{id},ctx)` — bumper `settings.updatedAt`, logger
  `type:'bank'` (`vacation-add`/`vacation-remove`).
- **Ytelse/memo:** dagens per-iso-cache erstattet. `navSeries` bygger HELE kurven i ett sveip fra
  epoken, memoisert (`_navMemo`) på `navSignature(state)` = {end (i dag), tunables, `fundEffortMult`,
  `JSON.stringify(vacations)`, antall låste dager + siste låste dato, per-record effort-key}.
  Invalideres ved lås/medalje/ferie/tunable-endring. `navForDate(state,iso)` slår opp i serien.
  `fundEndIso` bruker UTC (`toISOString`) → signaturen skifter ved UTC-midnatt; i NO gir det en
  kosmetisk ~1–2 t forsinkelse rett etter lokal midnatt (faller til gårsdagens NAV, ingen krasj) —
  matcher eksisterende UTC-stil i `bankHistoryRange`. Serie-bygging O(uker²×records) — YAGNI.
- **`fundWeekStatus(state, today)`** (for UI): `{mode:'vacation'|'active'|'idle', weeklyPct,
  streakWeeks, effort}` — driver medvinds-linja.
- **UI (sønn, `renderBankView`):** medvinds-linje rett under sparklinjen på fond-kortet:
  ferie «🌴 Ferie — vanlig børsuke» (`.wind.vac`), aktiv «📈 +X % medvind denne uka — sterk innsats!
  🔥 streak ×N» (`.wind.up`, streak-bit kun når streakWeeks>1), rolig «🌱 Rolig uke — fondet kryper»
  (`.wind`). Sparklinjen rally-er nå synlig i gode uker.
- **UI (forelder, Settings `renderPoengTab` → 🏦 Bank):** `#fundBase` (grunn-drift %/uke, `<input
  type=number>`, lagres `/100`) + `#fundMult` (innsats-styrke ×, `stepperHtml`, lagres rått) +
  **🌴 Ferieperioder**-kort `#vacBox` fylt av top-level `renderVacations(s)`: sorterte rader
  (`from – to` + `.btn.tiny[data-vacdel]` Slett) + add-rad (`#vacFrom`/`#vacTo` date + `#vacAdd`),
  wirer `addVacation`/`removeVacation` med `{now:nowIso(), id:newId()}` + `save()` + re-render.
  CSS `.vacrow`/`.vacrow.vacadd`/`.btn.tiny`, `.wind`(+`.up`/`.vac`).
- **Migreringskonsekvens:** eksisterende fond-innskudd reberegnes under ny kurve, men gulvet
  `max(marked, principal)` beskytter selve innskuddet → ingen datatap. Synlig streak-visning
  (Nå/All-time i Penger) er URØRT; fondet leser sin egen ferie-bevisste streak via `fundStreakWeeks`.
- **Spec/plan:** `docs/superpowers/specs/2026-09-29-honniscoins-fond-innsats-ferie-design.md`,
  `docs/superpowers/plans/2026-09-29-honniscoins-fond-innsats-ferie.md`.
