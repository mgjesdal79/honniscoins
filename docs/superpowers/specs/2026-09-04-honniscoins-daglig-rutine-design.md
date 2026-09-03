# Honniscoins – Daglig rutine (gjentakende «rydd opp»-sidequest) – design

**Dato:** 2026-09-04
**Status:** Godkjent design, klar for implementeringsplan

## Bakgrunn og mål

Forelder vil insentivere at sønn ordner seg selv når han kommer hjem fra skolen. I stedet for
å opprette en ny sidequest manuelt hver dag, skal det finnes **én fast, redigerbar mal** som
automatisk genererer én sidequest-instans per hverdag. Innholdet (deloppgaver) og coin-belønning
varierer, så forelder må enkelt kunne styre malens standardinnhold og finjustere dagens instans.

Deloppgaver representeres som **avkryssbare subtasks** (ikke én lang fritekst), både for å gjøre
det tydelig hva som gjenstår og for å gi sønn en følelse av framgang.

## Kjernebeslutninger (fra idémyldring)

1. **Én fast mal** – ingen opprett/slett-UI for flere maler nå.
2. **Kun hverdager (man–fre)** – fast regel, ingen ukedag-velger i UI.
3. **Avkryssbare subtasks, én samlet reward** – rører ikke dagens poeng-/godkjenn-modell
   (poeng er fortsatt ett tall på quest'en).
4. **Alle subtasks må hukes av** før sønn kan trykke «Marker som gjort». Forelder godkjenner
   fortsatt til slutt.
5. **Mal-editoren ligger i Poeng-fanen** (der de andre innstillingene allerede bor), som en ny
   «Daglig rutine»-seksjon med av/på-bryter.

## Arkitektur

Følger prosjektets etablerte lagdeling:

- **`js/logic.js`** – all ny ren logikk (generering, subtask-toggling, commit-gating, mal-CRUD).
  Rene funksjoner av `state`; mutasjoner tar `ctx={now,id}` og returnerer ny state.
- **`js/store.js`** – uendret utover at `migrate()` (kalt i `loadState`) nå også genererer dagens
  rutine-instans. `migrate` mottar allerede `today`.
- **`js/app.js`** – DOM/rendering: sønnens instans-kort (Sidequests-siden) + forelderens
  «Daglig rutine»-seksjon (Poeng-fanen).
- **`index.html`** – ny CSS for subtask-checklist og mal-editor; `APP_VERSION` bumpes ved deploy.

### Prinsipp: instansen ER en vanlig quest

En rutine-instans er en ordinær `quests[]`-oppføring. Dermed arves *all* eksisterende maskineri
uten ny livssyklus: `commit`/`approve`/`reject`, `questPointsTotal` (saldo), `questArchiveSplit`
(arkiv), logg (`type:'quest'`) og fletting (`mergeQuestList`, LWW per id på `updatedAt`).

## Datamodell

### Malen: `settings.dailyRoutine`

```js
settings.dailyRoutine = {
  enabled: false,          // av/på-bryter
  title: 'Rydd opp etter skolen',
  points: 10,              // coin-reward for hele quest'en
  subtasks: [              // mal-deloppgaver (uten done-flagg)
    { id, text }
  ],
  updatedAt,               // ISO – for fletting
}
```

- Bor under `settings`; flettes med `settings`-flettingen (LWW). Ingen ny flette-regel.
- `migrate` fyller default (`enabled:false`, tomt/eksempel-innhold) hvis feltet mangler, slik at
  eksisterende rom ikke krasjer. Ingen destruktiv migrering.

### Instansen: utvidet quest

En rutine-instans er en vanlig quest med tre ekstra felt utover dagens quest-skjema:

```js
{
  // ...alle eksisterende quest-felt (id, title, points, status, createdAt, updatedAt, ...)
  source: 'routine',              // skiller rutine-instanser fra manuelle quests
  routineDate: 'YYYY-MM-DD',      // idempotens-nøkkel (dagen instansen gjelder)
  subtasks: [ { id, text, done } ],
}
```

- Manuelle quests har `source` udefinert (eller `'manual'`) og typisk ingen `subtasks`.
  All ny UI/logikk må tåle at `subtasks` mangler (behandles som tom liste).
- Subtasks kopieres fra malen **by value med nye id-er** ved generering → mal og instans er
  fullstendig frikoblet.

## Livssyklus: generering

I `migrate(state, today)`:

1. Hvis `settings.dailyRoutine?.enabled !== true` → gjør ingenting.
2. Hvis `today` **ikke** er en hverdag (man–fre) → gjør ingenting.
3. Hvis det allerede finnes en quest med `source==='routine' && routineDate===today` → gjør
   ingenting (idempotent; trygt å kjøre `migrate` ved hver last).
4. Ellers: opprett én ny quest fra malen:
   - `title`, `points` fra malen; `subtasks` kopiert by value (nye id-er, `done:false`).
   - `source:'routine'`, `routineDate:today`, `status:'open'`, `createdBy:'system'`.
   - Logg `type:'quest'`, `action:'create'` (evt. med markør `source:'routine'`).

**Kun for i dag** – vi backfiller aldri glemte dager. Åpnes ikke appen en dag, lages ingen
instans for den dagen. Dette unngår spam av gamle instanser.

> Merk: `migrate` tar `today`, men får ikke noen `ctx.id` slik mutasjonsfunksjonene i `logic.js`
> gjør. Derfor kan ikke instansen få en tilfeldig id inne i `migrate`. I stedet brukes
> **deterministiske id-er** fra datoen: `routine-<date>` for quest'en og `routine-<date>-<n>` for
> hver subtask. Det gir naturlig idempotens: gjentatte migreringer på samme enhet lager ikke
> duplikat, og to enheter som genererer samme dag produserer samme id → `mergeQuestList` (LWW)
> kolliderer ikke og fletter dem til én.

## Regler (ren logikk i `logic.js`)

- `allSubtasksDone(quest)` → `true` hvis quest har ingen subtasks, ellers hvis alle
  `subtasks[].done === true`.
- `commitQuest` utvides: returnerer uendret state hvis `!allSubtasksDone(quest)` (gating).
  UI låser i tillegg «Marker som gjort»-knappen, men logikken er sannhetskilden.
- `toggleQuestSubtask(state, { id, subId, actor:'son' }, ctx)`: veksler `done` på én subtask,
  bumper `quest.updatedAt` (så `mergeQuestList` LWW synker riktig). Logges ikke (for støyete)
  eller logges lett – avgjøres i plan; default: ikke logg hver avkryssing.
- Forelder-mal-CRUD:
  - `setDailyRoutine(state, { patch }, ctx)` – oppdaterer `settings.dailyRoutine`
    (enabled/title/points/subtasks), bumper `settings.dailyRoutine.updatedAt`.
- Forelder-instans-redigering: eksisterende `updateQuest`-patch utvides til å håndtere
  `subtasks` (sette hele lista) i tillegg til dagens felt, slik at forelder kan finjustere
  dagens instans (coins/deloppgaver) uten å røre malen.

Avledet visning:
- Instanser dukker opp i sønnens Sidequests «Å gjøre» og i forelderens Quests-liste som vanlige
  quests (ingen ny henting kreves).

## UI

### Sønn – Sidequests-siden (`renderSidequestsPage`)
- Instans-kortet får:
  - Badge «🔁 Daglig · <ukedag> <dato>» (rutine-markør + `routineDate`).
  - Coin-reward øverst til høyre.
  - Avkryssbar subtask-liste (checkbox + tekst; huket av = grønn + gjennomstreket).
  - Framgangsteller «X av N gjort».
  - «Marker som gjort» låst (disabled) til `allSubtasksDone` er sann.
- Manuelle quests uten subtasks rendres som før (bakoverkompatibelt).

### Forelder – Poeng-fanen (`renderPoengTab`)
- Ny «Daglig rutine»-seksjon:
  - Av/på-bryter (`enabled`).
  - Tittel-input.
  - Coin-stepper (`points`).
  - Redigerbar deloppgave-liste: legg til / slett per linje (dra-rekkefølge er «nice to have»,
    ikke påkrevd i første versjon).
  - Info-boks: «Endrer du malen gjelder det neste hverdag. Dagens instans finjusterer du i
    Quests-fanen.»
- Dagens instans redigeres i den vanlige Quests-fanens quest-liste (via utvidet `updateQuest`).

## Fletting

- `settings.dailyRoutine`: følger `settings`-flettingen (LWW).
- Rutine-instanser: vanlige quests → `mergeQuestList` (LWW per id på `updatedAt`). Fordi
  subtask-toggling bumper `quest.updatedAt`, synkes avkryssinger korrekt uten per-subtask-fletting.
- Deterministiske instans-id-er (`routine-<date>`) gjør at to enheter som genererer samme dag
  produserer samme id → fletting kolliderer ikke og lager ikke duplikat.

## Testing (`test/suite.js`, rene DOM-frie tester)

Kjøres med `jsc -m test/run-jsc.js`.

- Generering:
  - Hverdag + enabled + ingen eksisterende → én instans lages, med kopierte subtasks (nye id-er).
  - Helg → ingen instans.
  - `enabled:false` → ingen instans.
  - Idempotens: kjør `migrate` to ganger samme dag → fortsatt kun én instans.
  - Backfill: hopp over en dag → ingen instans for den hoppede dagen.
- `allSubtasksDone`: tom liste → true; delvis → false; alle → true.
- `commitQuest`-gating: nekter når ikke alle subtasks er huket av; tillater når alle er.
- `toggleQuestSubtask`: veksler `done`, bumper `updatedAt`.
- Frikobling: rediger malen etter generering → dagens instans er uendret; rediger instansen →
  malen er uendret.
- Poeng: godkjent rutine-instans teller i `questPointsTotal`/saldo som en vanlig quest.

## Eksplisitt utenfor scope (future)

Bygges **ikke** nå, men datamodellen skal ikke stenge for det:

1. **Ferie-modus** – overordnet konsept for å skru av både rating-/medalje-opplegget og
   rutine-genereringen på gitte datoer (f.eks. høstferie). Sannsynlig plassering: `settings`.
2. **Generelt recurring-system** – flere brukerdefinerte maler med ulike planer
   (spesifikke datoer / valgte ukedager / «første mandag i måneden» osv.), med opprett/rediger/
   slett-UI. Dagens én-mal-modell (`settings.dailyRoutine`) kan da generaliseres til en liste
   uten destruktiv migrering.
3. **Flerbruker / deling** – åpne appen for andre familier (flere har spurt). Påvirker
   rom-modellen bredt; egen utredning.

## Filer som berøres

- `js/logic.js` – generering i `migrate`, `allSubtasksDone`, `commitQuest`-gating,
  `toggleQuestSubtask`, `setDailyRoutine`, utvidet `updateQuest`, default i `migrate`.
- `js/app.js` – sønn-instanskort i `renderSidequestsPage`, «Daglig rutine»-seksjon i
  `renderPoengTab`, binding for subtask-avkryssing og mal-redigering.
- `index.html` – CSS for checklist + mal-editor; `APP_VERSION`.
- `test/suite.js` – nye tester.
- Dokumentasjon: `CLAUDE.md` oppdateres med Daglig rutine-avsnittet ved implementering.
