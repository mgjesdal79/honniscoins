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

## Testing
- Ren logikk: `test/suite.js` (delt, DOM-fri, `runTests()`). 161 tester per nå (inkl. sidequests).
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
