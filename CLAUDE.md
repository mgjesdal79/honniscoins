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
  append-only lister (`log`, `payouts`). **`quests`**, **`homework`** og **`shopItems`/
  `purchases`** flettes derimot **LWW per id** på `updatedAt` (`mergeQuestList`/
  `mergeHomeworkList`/`mergeById`) — ikke union — så statusendringer og sletting vinner nyest.
- **Logg = ren visning** (ingen beregning leser `state.log`; kun fletting + `renderLoggTab`
  som viser øverste 200). Lagres i sin helhet i rom-blobben → for å hindre uendelig vekst
  **beskjæres den til de nyeste `LOG_KEEP` (200) hendelsene** via ren fn `pruneLog`, kalt sist
  i `migrate` (etter fletting + rutine-generering). Kapper både lokal cache og neste
  remote-lagring; matcher visningens tak. NB: `renderLoggTab` har ingen gren for `type:'routine'`
  (rutine-mal-endringer blir usynlige rader), og rutine-instansens auto-`quest create` bruker
  `actor:'system'` som tag-koden viser som «Sønn» — kjent støy, men ruller ut av 200-vinduet.
- Topp-logo (`brandHtml()` i app.js) viser **alltid saldo**: «Honniscoins: X 💰», både for sønn
  (over bunn-nav) og forelder (over faner). Regnes via `computeBalance` ved hver render.

## Domenemodell (viktig)
- **Lås = commit, styrer ALT.** Kun `days[date].locked` gir poeng: medaljer, oppmøte-streak,
  ukesbonus og ekte streaks. Ulåst fortidsdag = «hull» som bryter streaks.
- **Medaljeverdier stemples ved lås (b64):** verdiene (🥉/🥈/🥉) fryses på dagen som
  `days[date].medalValues` når den låses (`lockDay`/`closeWeek`), speiler bankens rente-stempel.
  `computeEarned`/`dayMedalPoints` bruker `dayMedalValues(state,day)` = dagens stempel, fallback
  `settings.medalValues` for ustemplede. Slik påvirker en verdiendring KUN framtidige låser —
  tidligere opptjent er urørt. Fletting tar med stempelet når lås-LWW (`lockedAt`) vinner.
  `migrate` fryser eksisterende låste dager på gjeldende verdi FØR en engangs-bump til
  **bronse 3 / sølv 4 / gull 5** (guardet av `settings.medalBump35`). Settings-UI (`#vBronse`/
  `#vSolv`/`#vGull`) skriver fortsatt `settings.medalValues` (= framtidige låser).
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
- **Sønn-sider (pager):** Uken 📅 / Poeng 💵 / **Oppdrag** ⭐ / **Rutiner** 🔁 / Shop 🛒 —
  bunn-nav + sveip + prikker (`SON_PAGES` i app.js). **Rutiner har egen fane** (skilt ut fra
  Oppdrag fordi rutine-instansene druknet blant manuelle quests). Oppdrag-badge = antall åpne
  **manuelle** quests; Rutiner-badge = `routinesRemaining(state,today)` (åpne rutine-instanser i
  dag). Shop lar sønn bruke opptjente coins på ekte premier (se «## Shop»).
- **Oppdrag vs Rutiner (sønn):** `renderSidequestsPage` viser KUN manuelle quests
  (`!isRoutineQuest(q)`), `renderRutinerPage` KUN rutine-instanser (`isRoutineQuest(q)` =
  `q.source==='routine'`). Godkjent-arkivet er delt likt: manuelle godkjente havner i Oppdrag,
  rutine-godkjente i Rutiner (`approvedArchiveHtml(state, cardFn, filter)` +
  `questArchiveSplit(state, n, filter)` tar nå et valgfritt `filter`-predikat). Delte
  byggeklosser: `sonSubtaskList`, `sonQuestCard` (enkelt manuelt kort), `sonRoutineCard`
  (sammenleggbart), `bindSonQuestHandlers` (felles handler-binding for begge sider). Nye rene fn
  i logic.js: `isRoutineQuest`, `routineInstancesForDate`, `routinesRemaining`.
- **Rutine-kort (sammenleggbart):** `sonRoutineCard` — klikkbar header (🔁 + tittel +
  status-pille + stor rund ▾-chevron) + kropp med avkryssbar subtask-liste og «Marker som
  ferdig»/«🚫 Ikke gjort». **Default kollapset**; manuell toggle per kort, flere kan være åpne
  samtidig (ingen accordion). Åpen-tilstand i `App.routineSonOpen` (ren visning, ikke persistert,
  keyet på instans-id via `data-rtoggle`). Rutiner-siden har seksjoner: I dag / For i morgen 🌙 /
  **Venter på godkjenning** (også sammenleggbare rutine-kort, `sonRoutineCard` med `status:'done'`
  → ⏳-pille + «Angre») / Ikke gjort / Godkjent-arkiv. **Framdriftsstripe på kollapset kort
  (b57):** rutiner som er i gang viser en `.progbar`-stripe (full bredde, under tittelen, «to
  linjer») + `X/Y gjort`-tekst i STEDET for «X/Y»-ratiopilla — raskt visuelt innblikk i hvor mye
  som gjenstår. Delvis = gull-gradient (`.progbar.part`), tom/0 % = grå. Ferdig → «✓ ferdig»-pille,
  til-godkjenning → «⏳ til godkjenning»-pille, rutine uten deloppgaver → «å gjøre»-pille (ingen
  stripe). Stripa vises KUN kollapset (`.rtcard.open .rtprog{display:none}`) — åpent kort viser
  deloppgavelista + «X av N gjort» i stedet. (Ren tekst-ratio ble fjernet b49 som støy; b57 gir en
  visuell stripe i stedet.) CSS: `.rtcard`/`.rthead`/`.rtic`/`.rtttl`/`.rtsum`/`.rtpill`(+`.wait`)/
  `.rtchev`/`.rtprog`/`.rtprogtxt`/`.progbar`(+`.part`)/`.rtbody`/`.btnrow`.
- **Uke-stripe-badge (`renderUkenPage`):** låst dag = «🔒 +X» (grønn), ulåst dag med opptjente
  poeng = «~X» (dempet, klasse `.b.prev`), tom/ingen poeng = «·». Ikke bare «·» overalt.
- **Forelder-meny (`renderParentHome`):** **permanent 3-kolonners rutenett** (`.pgrid`, IKKE
  sticky, klasse `.gt`/`.gti`/`.gtl`) med 9 seksjoner — IKKE lenger én bred fane-rad (byttet b49
  fordi 9 punkter ble for bredt): Uke 📅 / Dag 📝 / Plan 🗓 / **Quests** ⭐ / **Rutiner** 🔁 /
  Shop 🛒 / Logg 📋 / Stat 📊 / **Settings** ⚙️ (`App.parentTab ∈ {uke,dag,timeplan,quests,
  rutiner,shop,poeng,logg,stat}`). Settings intern nøkkel er fortsatt `'poeng'`.
- **Rutiner-fane (forelder, `renderRutinerTab`):** rutine-mal-styringen (Daglige rutiner: på/av,
  tittel, poeng, ukedag-piller, deloppgave-editor m/ dra-og-slipp, «vis fra dagen før», slett,
  «＋ Ny rutine») er **flyttet ut av Settings** til egen 🔁 Rutiner-fane. Badge = antall rutine-
  instanser til godkjenning. `renderPoengTab` (Settings) har nå kun: poengverdier, kr/coin,
  varslings-epost, utbetalinger.
- Dag-fanen har lås/åpne-dag og lås/åpne-uke. Quests-fanen har badge = antall quests til
  godkjenning. (Sønnens egen «Poeng»-side 💵 er urørt.)

## Feature-detaljer → docs/architecture.md
De dype feature-beskrivelsene er flyttet til `docs/architecture.md` for å holde denne fila
under kontekst-grensa. Les den relevante seksjonen der når oppgaven gjelder biten:
- **Sidequests** (enkeltoppgaver hjemme) — datamodell, livssyklus, arkiv, frist-velger.
- **Daglige rutiner** (gjentakende sidequests) — maler, generering/utløp, auto-fullføring.
- **Lekser** (skolelekser per dag) — to typer (én innlevering / daglig), livssyklus, UI.
- **Statistikk** (innsats-analyse) — effort-poeng, periode, fem kort, dagsfordeling, SVG.
- **Shop** (kjøp premier) — flyt, datamodell, saldo/reservasjon, bilder, farger, varsling.
- **Banken** (sparekonto + fond) + **innsats-drevet fond + ferie (b63)** — ledger-fold,
  kurve, saldo-integrasjon, UI, ferie-modus.

Kjerne (arkitektur, domenemodell, testing, deploy, konvensjoner) ligger fortsatt under.

## Testing
- Ren logikk: `test/suite.js` (delt, DOM-fri, `runTests()`). 567/567 grønne per nå (inkl.
  medaljeverdi-stempling b64: lås/uke-lås-stempel, frys av tidligere opptjent ved verdiendring,
  migrate-frys+bump, flette-bevaring; + sidequests
  m/arkiv, lekser, rutiner inkl. rekkefølge/tekst-synk + egen-fane-helpere
  (`routineInstancesForDate`/`routinesRemaining`/arkiv-filter) + leadDay/straks-generering ved
  add/update + `expireStaleRoutineInstances`-utløp (b55/b56) + auto-fullføring/vekk (`completed`,
  b58), shop m/saldo·reservasjon·commit·
  fletting·bilde-patch, logg-beskjæring, statistikk/streak og **banken** (b59–b62:
  `navForDate`/rails, sparekonto-fold, fond-gulv, saldo-integrasjon, mutasjoner,
  `bankHistoryRange`/`bankTransactions`) + **innsats-drevet fond + ferie** (b63:
  `isVacationDay`/ferie-defaults, `weekEffortScore`/`fundStreakWeeks` (ferie-pause),
  state-drevet `navForDate`/god>slapp>null-uke + ferie-nøytral, `fundWeekStatus`,
  `addVacation`/`removeVacation`)).
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
- **Tall-stepper (`stepperHtml`/`bindSteppers` i app.js):** gjenbrukbar − [felt] + med store
  48px-knapper og smalt sentrert felt (skjuler native spinner). Brukes på alle små heltalls-felt:
  quest-poeng (`#qPoints`), lekse-poeng (`#hwPoints`/`#hwNewPoints`), rutine-poeng
  (`data-r-points`) og poengverdier (`#vBronse`/`#vSolv`/`#vGull`). `stepperHtml(attrs, value,
  {min,step})` beholder en ekte `<input>` med samme id/attributt (så eksisterende `.value`-lesing
  virker); − / + oppdaterer feltet og sender `input`+`change` (så onchange-handlere fyres av
  knappene også). `bindSteppers(host)` er idempotent (`data-bound`) og kalles sist i
  `renderQuestsTab`/`bindParentHomework`/`renderPoengTab` + per rutine-kort. CSS `.stepper`/`.sbtn`/
  `.sval` i index.html. Shop-pris + kr/coin beholdt som skrivefelt (store/desimale tall). Krever
  ikke migrering. Prototype: `mockups/quest-poeng-prototyper.html`.
- Design-spec: `docs/superpowers/specs/2026-08-21-honniscoins-lasing-streaks-sider-design.md`.
  Klikkbar mockup: `mockups/skisser.html`.
