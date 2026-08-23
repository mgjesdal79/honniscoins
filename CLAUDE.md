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
- **Ekte streak:** timer på rad (sølv = sølv|gull, gull = gull), kronologisk over låste dager.
  Syk pauser (bryter ikke). Viser Nå / All-time / Denne måneden (+ ⏳ pågående).
- **Migrering** (`migrate`, kjøres i `loadState`): fyller `settings.bonus`/`weekLocks` og låser
  eksisterende dager med innhold, så gamle opptjente poeng ikke forsvinner.
- **Sønn-sider (pager):** Uken / Poeng (💵) / Sidequests (⭐) / Shop (🛒) — bunn-nav + sveip +
  prikker (`SON_PAGES` i app.js). Sidequests-ikonet har badge = antall åpne quests. Shop er
  fortsatt placeholder.
- **Uke-stripe-badge (`renderUkenPage`):** låst dag = «🔒 +X» (grønn), ulåst dag med opptjente
  poeng = «~X» (dempet, klasse `.b.prev`), tom/ingen poeng = «·». Ikke bare «·» overalt.
- **Forelder-faner:** Uke / Dag / Timeplan / **Quests** / Poeng / Logg. Dag-fanen har lås/åpne-dag
  og lås/åpne-uke. Quests-fanen har badge = antall quests til godkjenning.

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
- **Frist-velger (forelder):** datostepper med standard = i dag, `‹`/`›` = ±1 dag, trykk midtfeltet
  (transparent `input[type=date]` over) åpner kalender, «Fjern frist»/«Sett frist (i dag)» veksler.
  Arbeids-frist holdes i closure-var `due` og oppdaterer kun visningen (nullstiller ikke
  tittel/beskrivelse/poeng).
- **Spec:** `docs/superpowers/specs/2026-08-22-honniscoins-sidequests-design.md`.
  Mockup: `mockups/sidequests.html`.

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

## Testing
- Ren logikk: `test/suite.js` (delt, DOM-fri, `runTests()`). 195 tester per nå (inkl. sidequests
  og lekser).
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
