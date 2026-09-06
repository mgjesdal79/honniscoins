# Rutiner: start dagen før + «ikke gjort»-lukking

**Dato:** 2026-09-06
**Status:** Godkjent design

## Problem

Noen rutiner (pakke sekk/matbag/gymbag) gir mest mening å gjøre **kvelden før**
skoledagen. I dag lages rutine-instansen kun på selve måldagen, og det finnes ikke
noe tidsbegrep i appen. Vi vil la utvalgte rutiner dukke opp dagen før — uten å gjøre
rutiner om til custom per-instans-oppsett, og uten å innføre klokkeslett.

Samtidig: hvis morgendagens instans dukker opp mens dagens fortsatt er åpen, ville to
instanser av samme rutine vises samtidig. Det er forvirrende. Vi trenger en ryddig måte
å lukke en instans som «ikke ble gjort».

## Beslutninger (fra brainstorming)

- **Dag-nivå, ikke klokkeslett.** «Dagen før» = 1 kalenderdag før måldagen (håndterer
  søndag→mandag). Ingen HH:MM.
- **Overlapp-regel: vent til forrige er lukket.** Neste dags instans holdes **skjult**
  til forrige instans av samme rutine er lukket (`done`/`approved`/`skipped`). Aldri to
  synlige samtidig.
- **Ingen auto-utløp.** Den opprinnelige «utgår 1400» droppes til fordel for en manuell
  «ikke gjort»-lukking. En glemt instans blokkerer neste til noen aktivt lukker den
  (bevisst ansvarlighet).
- **«Ikke gjort» kan settes av både sønn og forelder, og angres** så lenge dagen ikke
  er passert.

## Datamodell

### Mal (`settings.routines[]`)
Nytt felt:
- `leadDay: boolean` (default `false`). `true` = «Vis fra dagen før».

`migrate` fyller `leadDay:false` på eksisterende maler (inkl. de tre seedede) → ingen
atferdsendring før den skrus på. Endring bumper `settings.updatedAt` (settings-LWW som
andre mal-mutasjoner).

### Rutine-instans (quest med `source:'routine'`)
- `status` utvides: `{open, done, approved, skipped}`.
- `skippedAt: ISO | null`
- `skippedBy: 'son' | 'parent' | null`

Uendret: `routineDate`, deterministiske id-er `<routineId>-<dato>`, `subtasks`, fletting
via `mergeQuestList` (LWW per id på `updatedAt`). `skipped` er bare en ny status som
vinner nyest ved fletting.

### Poeng
`questPointsTotal` (approved) og `questPointsPending` (done) er allerede gatet — `skipped`
teller ingensteds. Ingen streak-effekt (rutiner gir uansett ikke medaljer). Ingen endring
i poengberegning.

## Generering (`generateDailyRoutines`)

I dag: lager kun instanser for `today`, returnerer tidlig på helg
(`weekdayKey === null`). Det brekker «søndag→mandag». Ny logikk:

- **Vindu:** for hver aktiv mal, generér instans for **dagens dato** (hvis i dag er en
  aktiv ukedag for malen) **og**, hvis `leadDay:true`, for **neste kalenderdag** hvis den
  er en aktiv ukedag for malen. Slik lages mandagens sekk på søndag.
- Fjern den tidlige helg-returen; sjekk aktiv-ukedag **per måldato** i stedet.
- Fortsatt idempotent via id `<routineId>-<dato>` + `mergeQuestList`; ingen backfill
  (kun i dag + evt. i morgen).

`syncOpenRoutineInstances` utvides fra `routineDate === todayIso` til «i dag eller i
morgen» slik at mal-endringer også slår gjennom på den tidlige instansen.

## Visning & overlapp-filter

Ny ren fn (logic.js), f.eks. `visibleRoutineInstances(state, todayIso)` eller en
filter-helper brukt av sønn-render:

- Grupperer instanser per `routineId`.
- Innen hver gruppe: vis kun den **tidligste åpne** (`status:'open'`) instansen etter
  `routineDate`. Senere åpne instanser holdes skjult til den tidligere er lukket
  (`status ∈ {done, approved, skipped}`).
- `done`/`approved`/`skipped` vises i sine egne seksjoner som før og slipper neste åpne
  fram.
- Manuelle quests (`source ≠ 'routine'`) er upåvirket.

### Sønn (`renderSidequestsPage`)
- Morgendags-instans (`routineDate > todayIso`) får merket **«🌙 for i morgen (tir)»**
  (helper `routineDateLabel` utvides) i stedet for «🔁 Rutine · <dato>».
- Ny handling på rutine-kortet: **«Ikke gjort»** (lukker uten poeng). En `skipped` instans
  for dagens/morgendagens dato vises dempet med **«Angre»/«Gjør likevel»**; etter at dagen
  er passert forsvinner den fra sønn-visning (kun i logg).

### Forelder
- I godkjenningskø/aktiv-liste: kan også merke instans «Ikke gjort» (rydde blokkerende
  gammel instans) og angre mens dagen ikke er passert.
- Settings-fanen (rutine-mal-kort): ny **«Vis fra dagen før»**-bryter ved siden av på/av.
  Kollapset header-sammendrag nevner «· fra dagen før» når på.

## Handlinger (rene fn i `logic.js`)

- `skipRoutineInstance(state, {id}, ctx)` → `status:'skipped'`, `skippedAt:ctx.now`,
  `skippedBy` (utledes av `ctx.actor`/rolle), bumper `updatedAt`, logger `type:'quest'`,
  `action:'skip'`.
- `unskipRoutineInstance(state, {id}, ctx)` → tilbake til `status:'open'`, nullstiller
  `skipped*`, bumper `updatedAt`, logger. **Gatet:** kun når `routineDate >= todayIso`.
- Begge kun for `source:'routine'`; ignorerer `approved` (kan ikke skippe noe som alt ga
  poeng).

## Testing

Nye tester i `test/suite.js` (utvider fra 333):
- **Generering:** `leadDay:true` lager morgendags-instans; søndag lager mandagens;
  `leadDay:false` lager ikke; idempotens; ingen backfill.
- **Overlapp:** to åpne instanser samme rutine → kun tidligste synlig; lukk tidligste
  (done/approved/skipped) → neste synlig; manuelle quests upåvirket.
- **Skip/unskip:** status/felt/logg; unskip gatet på passert dag; approved kan ikke
  skippes; poeng uendret (`skipped` teller ikke).
- **Migrering:** `leadDay:false` fylles på eksisterende maler.

## Ikke i scope (YAGNI)

- Klokkeslett/HH:MM-vinduer.
- Auto-utløp av u-gjorte instanser.
- Backfill av tidligere dager.
- Per-instans lead-konfig (lead bor kun på malen).
