# Honniscoins – Flere daglige rutiner (generelt mal-system) – design

**Dato:** 2026-09-04
**Status:** Godkjent design, klar for implementeringsplan
**Bygger på:** `2026-09-04-honniscoins-daglig-rutine-design.md` (generaliserer den ene malen til en liste)

## Bakgrunn og mål

Forelder vil ha flere gjentakende morgen-rutiner i tillegg til «Rydd opp etter skolen»:

- **Pakk sekken** – hver hverdag (man–fre)
- **Pakk matbagen** – hver hverdag (man–fre)
- **Pakk gymbagen** – alle hverdager **unntatt tirsdag** (man/ons/tor/fre)

Gymbagens plan (skip tirsdag) passer ikke inn i dagens hardkodede «alle hverdager»-regel.
Derfor generaliseres den ene malen (`settings.dailyRoutine`) til en **liste av maler**
(`settings.routines`) der hver mal har sin egen **ukedag-plan**. Forelder kan legge til,
redigere og slette maler i Poeng-fanen.

## Kjernebeslutninger

1. **Generelt mal-system** (ikke hardkode tre nye). `settings.routines: []`.
2. **Per-mal ukedag-plan** (`weekdays`), reuser `weekdayKey`-strengene `'mon'..'fri'`.
3. **Tre separate kort** (sekk / matbag / gymbag), ikke sammenslått.
4. **Pre-fyll de tre** ved migrering, guardet med engangs-flagg `settings.routinesSeeded`
   (kommer ikke tilbake om forelder sletter en). Familie-spesifikt innhold – ryddes ved
   framtidig flerbruker.
5. Instansen er fortsatt en **vanlig quest** (arver commit/godkjenn/poeng/arkiv/logg/fletting).

## Datamodell

### Malen: `settings.routines[]`

```js
settings.routines = [
  {
    id,                                  // stabil id; migrert «Rydd opp» = 'routine'
    title,
    points,
    subtasks: [ { id, text } ],          // valgfritt; tom = «ett trykk = ferdig»
    weekdays: ['mon','tue','wed','thu','fri'],  // hvilke hverdager malen gjelder
    enabled,
    updatedAt,
  }
]
settings.routinesSeeded = true           // engangs seed-guard
```

- Bor under `settings` → flettes med settings-LWW (hele objektet). **Alle mal-mutasjoner
  bumper `settings.updatedAt`** (ellers kan endringen tapes i settings-løpet).
- `settings.dailyRoutine` (gammel enkelt-mal) **fjernes** etter at den er foldet inn i lista.

### Instansen: uendret quest + `routineId`

```js
{
  // ...alle eksisterende quest-felt
  source: 'routine',
  routineDate: 'YYYY-MM-DD',
  routineId: '<malens id>',   // NYTT: sporing tilbake til malen
  subtasks: [ { id, text, done } ],
}
```

## Migrering (`migrate`, kjøres i `loadState`)

Erstatter dagens `dailyRoutine`-default-blokk:

1. `if (!Array.isArray(s.settings.routines)) s.settings.routines = [];`
2. **Fold inn gammel enkelt-mal** hvis `s.settings.dailyRoutine` finnes og ingen mal med
   `id==='routine'` finnes: push `{ id:'routine', title, points, subtasks:[{id,text}],
   weekdays:['mon','tue','wed','thu','fri'], enabled, updatedAt }`. Slett så `dailyRoutine`.
3. **Engangs-seed** hvis `!s.settings.routinesSeeded`: legg til (kun hvis id ikke finnes):
   - `routine-sekk` «Pakk sekken», 5 🪙, man–fre, enabled
   - `routine-matbag` «Pakk matbagen», 5 🪙, man–fre, enabled
   - `routine-gymbag` «Pakk gymbagen», 5 🪙, man/ons/tor/fre, enabled
   - sett `s.settings.routinesSeeded = true`.
4. Til slutt `return generateDailyRoutines(s, todayIso);`

Idempotent: id-guardene + seed-flagget gjør at gjentatt migrering ikke lager duplikat, og at
en slettet seed-mal ikke kommer tilbake.

## Generering: `generateDailyRoutines(state, todayIso)`

Erstatter `generateDailyRoutine` (entall). Deterministiske id-er (migrate har ingen `ctx.id`):

- quest-id `` `${routine.id}-${todayIso}` `` → «Rydd opp» (id `routine`) gir `routine-<dato>`
  = **identisk med gammel id** → ingen duplikat på overgangsdagen.
- subtask-id `` `${qid}-${n}` ``; log-id `` `log-${qid}` ``.

Regler:

1. Helg (`weekdayKey(todayIso)===null`) → ingen generering.
2. For hver mal i `settings.routines`: hopp over hvis `enabled !== true` eller
   `!weekdays.includes(weekdayKey(todayIso))`.
3. Hopp over hvis quest med `qid` alt finnes (idempotent).
4. Ellers push instans (`source:'routine'`, `routineId`, `routineDate`, kopierte subtasks
   `done:false`) + deterministisk logg-oppføring.

Fortsatt **kun for i dag**, ingen backfill.

## Mutasjoner (rene fn i `logic.js`)

Erstatter `setDailyRoutine`. Alle bumper `routine.updatedAt` (der relevant) **og**
`settings.updatedAt`, og logger `type:'routine'`:

- `addRoutine(state, { routine }, ctx)` – legger til ny mal (id fra `ctx.id` hvis ikke satt;
  default `weekdays:['mon'..'fri']`, `enabled:true`, tom `subtasks`). `action:'add'`.
- `updateRoutine(state, { id, patch }, ctx)` – patch `title`/`points`/`enabled`/`weekdays`/
  `subtasks`; normaliserer subtasks til `{id,text}`, points til `Number()||0`. `action:'edit'`.
- `deleteRoutine(state, { id }, ctx)` – fjerner malen fra lista. `action:'delete'`.

Uendret: `allSubtasksDone`, `commitQuest`-gating, `toggleQuestSubtask`, `updateQuest`
(subtasks-patch for dagens instans).

## UI

### Forelder – Poeng-fanen (`renderPoengTab`)

«Daglig rutine»-seksjonen blir **«Daglige rutiner»** – en liste av mal-kort:

- Per kort: på/av-bryter, tittel, poeng, **ukedag-piller** (Man Tir Ons Tor Fre – klikkbare,
  markert = på), deloppgave-editor (samme som før), og **🗑 Slett rutine**.
- **＋ Ny rutine** nederst (kaller `addRoutine`, re-render).
- Info-tekst: «Endring gjelder neste dag rutinen er aktiv. Dagens instans finjusterer du i
  Quests-fanen.»
- Redigering lagres via `updateRoutine` (arbeidskopi per kort, som før).

### Sønn – Sidequests-siden

Ingen logikk-endring (instanskortet rendrer alle rutine-quests generisk). Kun badge-tekst:
«🔁 Daglig · \<dato\>» → **«🔁 Rutine · \<dato\>»** (gymbagen er ikke hver dag).

## Fletting

- `settings.routines` + `routinesSeeded`: settings-LWW (hele objektet) på `settings.updatedAt`
  → derfor bumper alle mal-mutasjoner `settings.updatedAt`.
- Instanser: vanlige quests → `mergeQuestList` (LWW per id). Deterministiske id-er hindrer
  duplikat på tvers av enheter.

## Testing (`test/suite.js`, rene DOM-frie tester)

- Migrering: fold `dailyRoutine`→`routines` (id 'routine', weekdays man–fre, behold felt);
  seed de tre (riktige weekdays, gymbag uten 'tue'); `routinesSeeded` settes; idempotent
  (kjør to ganger → ingen duplikat); slettet seed kommer ikke tilbake (flag satt).
- Generering: én instans per aktiv mal hvis ukedag matcher; gymbag genereres **ikke** på
  tirsdag men **ja** på man/ons/tor/fre; disabled → ingen; idempotent; legacy id-kompat
  (`routine`-mal → `routine-<dato>`); helg → ingen; subtasks kopiert med `done:false`.
- Mutasjoner: `addRoutine`/`updateRoutine`/`deleteRoutine` endrer lista riktig og bumper
  `settings.updatedAt`; `updateRoutine` normaliserer subtasks/points.
- Poeng: godkjent rutine-instans teller i saldo som vanlig quest (uendret).

## Filer som berøres

- `js/logic.js` – `defaultState` (routines/routinesSeeded), `migrate` (fold+seed+kall),
  `generateDailyRoutines` (erstatter entall), `addRoutine`/`updateRoutine`/`deleteRoutine`
  (erstatter `setDailyRoutine`).
- `js/app.js` – `renderPoengTab` (liste av mal-kort + ukedag-piller + add/delete), imports,
  sønn-badge-tekst.
- `index.html` – CSS for ukedag-piller (`.wdpill`/`.wdpill.on`); `APP_VERSION`.
- `test/suite.js` – oppdaterte + nye tester (gamle `generateDailyRoutine`/`setDailyRoutine`-
  tester skrives om til nytt API).
- `CLAUDE.md` – oppdater «Daglig rutine»-avsnittet til flere rutiner.

## Eksplisitt utenfor scope (future)

Uendret fra forrige spec: ferie-modus, «første mandag i mnd»-planer, flerbruker/deling.
Ved flerbruker må engangs-seedingen av de tre familie-rutinene fjernes/gjøres per-rom.
