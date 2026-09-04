# Honniscoins – Lekser over flere dager (to typer) – design

**Dato:** 2026-09-04
**Status:** Godkjent – klar for plan
**Erstatter:** «🗓 hele uka»-toggle fra `2026-08-23-honniscoins-lekser-design.md`

## Formål

Dagens lekse-modell har én post = én dag, og en `wholeWeek`-toggle som *kun* er et
visnings-merke (leksa ligger fortsatt på én dag). Det dekker ikke to reelle behov:

1. **Matteark til fredag** – én innlevering som skal *minne om seg selv* flere dager, men
   som er **gjort-gjort** når den er gjort én gang. Poeng gis én gang.
2. **«Les litt hver dag»** – en liten oppgave som dukker opp på flere dager, der **hver dag
   er sin egen oppgave** med egne poeng. Gjort mandag ≠ gjort tirsdag.

`wholeWeek`-toggelen fjernes. I stedet velger forelder **hvilke ukedager** leksa dukker opp
på, og **hvilken type** den er.

## Beslutninger (avklart med bruker)

| Tema | Valg |
|---|---|
| Dagvalg | **Huk av ukedager (Man–Fre) i den aktuelle uka** (med datoer). Default: kun valgt dag. |
| To typer | **Én innlevering** (delt fullføring, poeng én gang) og **Daglig oppgave** (egen oppgave + egne poeng per dag) |
| Godkjenning | **Per dag/oppgave, som i dag** (open→done→approved). Ingen auto-poeng. |
| Datamodell | **Approach A (hybrid):** daglig = N vanlige poster m/ `groupId`; én innlevering = én post m/ `days[]` |
| `wholeWeek` | **Fjernes** (migreres bort) |

## Datamodell (Approach A)

Beholder dagens lekse-post (se lekser-spec). Endringer:

- **Nytt felt `days: ['YYYY-MM-DD', …]`** – settes **kun på «Én innlevering»**. Sortert liste
  over datoene leksa vises på. `date` settes = **siste/høyeste** dato i `days` (frist), brukes
  til sortering og «frist»-merke.
- **Nytt felt `groupId`** – settes på **«Daglig oppgave»**-serier (én post per dag, alle med
  samme `groupId`). `null` for alt annet.
- **`wholeWeek` fjernes** fra modellen (migreres bort).

Tre gyldige former:

1. **Vanlig én-dags** (som i dag): `days` fraværende, `groupId: null`, `date` = dagen.
2. **Én innlevering:** *én* post med `days` (én eller flere dager), *én* `status`, *ett*
   `points`. Vises på hver dag i `days`.
3. **Daglig serie:** *N* vanlige poster (én per dag), delt `groupId`, hver med egen
   `status`/`points`/livssyklus.

**Sentral helper (ren fn):** `homeworkDays(h)` → `h.days && h.days.length ? h.days : [h.date]`.
All dag-filtrering (`homeworkForWeek`, dag-visning hos sønn og forelder) bruker denne, slik at
resten av logikken er uendret.

## Livssyklus & poeng – i hovedsak uendret

Fordi **daglig = vanlige poster** og **én innlevering = én post**, trengs *ingen* endring i:
`commitHomework` / `uncommitHomework` / `approveHomework` / `rejectHomework` /
`homeworkPointsTotal` / `homeworkPointsPending`.

- **Én innlevering** teller én gang (én post → `homeworkPointsTotal` teller den én gang).
  Commit/approve på hvilken som helst av dagene virker på den *samme* posten → «gjort-gjort».
- **Daglig** teller per godkjent dag (N poster → hver approved dag legger sine poeng).

**Ny ren fn:** `deleteHomeworkGroup(state, {groupId}, ctx)` → tombstone på alle poster i serien
(`removed:true`, bump `updatedAt`, logg `type:'homework'` `action:'delete-series'`).

## Oppretting (logic.js)

`addHomework` utvides til å ta `days: []` og `mode: 'once' | 'daily'` (default `'once'`;
manglende `days` ⇒ enkel én-dags som i dag):

- **`mode:'once'`** (eller ingen `days`): lag **én** post.
  - `days` = sorterte, avhukede datoer (kan være 1). `date` = siste dato i `days`
    (frist). `points` = totalt. `status:'open'`. `groupId:null`.
  - Hvis kun én dag valgt: `days` kan settes = `[date]` (helper faller uansett tilbake).
- **`mode:'daily'`** med `days.length`: lag **N** poster, én per dato.
  - Hver: `date` = dagen, `points` = poeng **per dag**, `groupId` = felles gruppe-id,
    `status:'open'`, `days` fraværende. Deterministiske id-er `${ctx.id}-${date}` for
    trygg fletting/idempotens.

Signatur (skisse):
```js
addHomework(state, { date, days = null, mode = 'once', subject, text, points,
                     source = 'manual', docendoUid = null, actor = 'parent' }, ctx)
```
Bakoverkompatibel: eksisterende kall uten `days`/`mode` gir samme resultat som før.

## UI – Forelder («Dag»-fane, `parentHomeworkHtml`)

**«Legg til»-skjema:**
- Fag, Beskrivelse (stor textarea, egen linje – allerede gjort), Poeng.
- **Ukedag-avhuking Man–Fre** for gjeldende uke, hver med dato (`.hwday`-piller/checkbox).
  Default: kun den valgte dagen huket av.
- **Type-velger:** to piller/radio – **«📄 Én innlevering»** (default) / **«🔁 Daglig oppgave»**.
- Poeng-etiketten bytter etter type: «Poeng» (én innlevering = totalt) vs «Poeng per dag»
  (daglig).
- Knapp: «➕ Legg til».

**Liste/kort:**
- Post vises på hver dag i `homeworkDays(h)` (dag-fanen filtrerer på gjeldende dag).
- **Én innlevering** over flere dager: «📄 frist <siste dag>»-merke + liten «vises: man·tir·fre».
  Flytt-piler (‹ ›) **skjules** for multi-dag (rediger styrer dagene). Enkel én-dags beholder piler.
- **Daglig serie:** «🔁 daglig»-merke; hver dags post beholder flytt-piler; serien får
  **«🗑 Slett serie»** (kaller `deleteHomeworkGroup`) i tillegg til «🗑 Slett» (kun den dagen).
- Rediger inline som i dag. For én innlevering endrer redigering den delte posten (alle dager).

## UI – Sønn («Uken», `homeworkSectionHtml`)

- **Én innlevering:** samme kort på hver av sine dager, med **«📄 frist <dag>»**-merke. Gjort én
  dag → «⏳ venter på godkjenning» og forsvinner som to-do fra de andre dagene. Godkjent →
  «✅ gjort» (samme post, teller én gang).
- **Daglig:** eget kort per dag med **«🔁 daglig»**-merke og egne poeng; gjort mandag påvirker
  ikke tirsdag.
- «Hele uka (fag)»-visningen viser hver post én gang (én innlevering dukker ikke opp N ganger
  der, siden det er én post).

## Fletting (store.js) – uendret

`homework` flettes fortsatt **LWW per id** (`mergeHomeworkList`). Daglig-serier er N poster med
egne id-er → flettes hver for seg. Én innlevering er én post → som før. `days`/`groupId` er
felt på posten og følger LWW.

## Migrering (`migrate` i loadState)

- **Fjern `wholeWeek`** fra alle eksisterende lekser (ingen atferdsendring – de blir vanlige
  én-dags via `homeworkDays`-fallback).
- Ingen `days`/`groupId` på gamle poster → helper faller tilbake til `[date]`.
- Ingen historikk å konvertere utover dette.

## Testing (nye rene-logikk-tester i `test/suite.js`)

- `homeworkDays`: fallback til `[date]` når `days` mangler/tom; returnerer `days` ellers.
- `addHomework` `mode:'once'` med flere `days` → **én** post, `date` = siste dag, vises på alle
  dager (`homeworkForWeek`/filtrering).
- `addHomework` `mode:'daily'` med flere `days` → **N** poster, felles `groupId`, hver med
  poeng per dag og egen `date`.
- **Én innlevering:** `commitHomework` på én dag → status `done` (gjelder alle dager, samme
  post); `approveHomework` → poeng **én gang** i `homeworkPointsTotal`.
- **Daglig:** commit/approve på én dag påvirker kun den dagens post; `homeworkPointsTotal`
  summerer per godkjent dag.
- `deleteHomeworkGroup` → alle poster i serien får `removed:true`; andre serier urørt.
- Migrering: post med `wholeWeek:true` → `wholeWeek` borte, oppfører seg som én-dags.
- Bakoverkompat: `addHomework` uten `days`/`mode` → samme som før.

## Ikke i scope (YAGNI)

- Docendo-import forblir Fase 2 og single-day (multi-dag/typer settes manuelt av forelder).
- Forfalls-/overdue-markering for én innlevering (kan komme senere).
- Redigering av «hele daglig-serien samtidig» (kun slett-serie nå; poeng/tekst justeres per dag
  eller ved å slette serie + opprette på nytt).
