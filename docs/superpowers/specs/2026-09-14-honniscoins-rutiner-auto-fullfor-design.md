# Honniscoins – auto-fullføring av rutiner når alt er huket av

**Dato:** 2026-09-14
**Status:** Design godkjent, klar for plan

## Problem / motivasjon

I dag må sønnen hake av alle deloppgavene i en rutine OG deretter trykke «🔒 Marker
som ferdig» for å sende rutinen videre. Det siste klikket er overflødig — når alt er
huket av, *er* rutinen gjort. For 0-coins-rutiner (rene «huskelister» uten poeng) er
det i tillegg meningsløst at de må innom forelderens godkjenningskø.

Ønsket oppførsel: når **alt er huket av**, avanserer rutinen automatisk:
- **Poeng > 0** → rett til godkjenning (som i dag, men uten det manuelle klikket).
- **Poeng === 0** → ferdigstilt med én gang (ingen godkjenning), men kan «vekkes opp
  igjen» ved å hake av en deloppgave på nytt.

Gjelder **kun rutine-instanser** (`source==='routine'`). Manuelle sidequests og lekser
er uendret.

## Domenemodell-endringer

### Ny status: `completed`
Rutine-instanser får en ny terminal-status `'completed'` (i tillegg til dagens
`open` / `done` / `approved` / `skipped`). Brukes KUN for 0-coins-rutiner som er gjort.
Betydning: «ferdig, ingen godkjenning nødvendig, ingen poeng».

Verifisert at `completed` ikke bryter eksisterende avledet logikk:
- `routinesRemaining` teller kun `status==='open'` → badge synker riktig når en rutine
  fullføres (også 0-coins).
- `overlappingRoutineIds` ser kun `open` → en `completed` instans blokkerer ikke neste
  dags instans.
- `expireStaleRoutineInstances` rører kun `open` → `completed` er terminal og røres ikke.
- `questPointsTotal` teller kun `approved`; 0-coins gir uansett 0 → ingen saldoeffekt.
- Fletting: rutiner flettes LWW per id på `updatedAt` → statusovergangen vinner nyest
  som alle andre quest-endringer.

Ingen migrering nødvendig (ny status oppstår kun ved nye handlinger; gamle instanser
er allerede `open`/`done`/`approved`/`skipped`).

## Logikk (js/logic.js)

### `toggleQuestSubtask` – ett inngangspunkt for auto-avansering
Etter at en deloppgave er vekslet (og `quest.updatedAt` bumpet):

Kun for `q.source==='routine'` og `q.status !== 'approved'`:

1. **Auto-avansér:** hvis `q.status==='open'`, listen har ≥1 deloppgave, og *alle* nå er
   avhuket (`allSubtasksDone`):
   - `points > 0` → `status='done'`, `doneAt=ctx.now`, logg `type:'quest' action:'done'`.
   - `points === 0` → `status='completed'`, `doneAt=ctx.now`, logg
     `type:'quest' action:'complete'`.
2. **Vekk (revert):** hvis `q.status==='completed'` og *ikke* lenger alle avhuket →
   `status='open'`, `doneAt=null`, logg `action:'undo'`. Gated til
   `q.routineDate >= i dag` (utledet fra `ctx.now`, som `unskipRoutineInstance`) — en
   passert dags rutine kan ikke vekkes.

Manuelle quests har ingen deloppgaver → `subId` finnes ikke → tidlig retur uendret, så
denne fn påvirker dem ikke.

### `commitQuest` – 0-coins-rutiner uten deloppgaver
`commitQuest` beholdes for rutiner UTEN deloppgaver (de har fortsatt en manuell knapp)
og for manuelle sidequests. Utvides slik:
- `isRoutineQuest(q) && points === 0` → `status='completed'` (logg `action:'complete'`).
- Ellers uendret → `status='done'` (logg `action:'done'`).

`allSubtasksDone`-gaten beholdes. `uncommitQuest` er uendret (setter status→`open`) og
gjenbrukes for å vekke en `completed` rutine uten deloppgaver.

## UI (js/app.js)

### `sonRoutineCard(q, today, open)` – grener på status
- **`open`:**
  - *med deloppgaver:* redigerbar deloppgaveliste + framdriftsstripe (uendret) + kun
    «🚫 Ikke gjort». **«🔒 Marker som ferdig» fjernes** — avhuking av siste boks er
    handlingen. (Den var uansett `disabled` til alt var huket av.)
  - *uten deloppgaver:* behold «🔒 Marker som ferdig» + «🚫 Ikke gjort» (ingenting å
    auto-trigge).
- **`done`** (>0 coins, venter godkjenning): uendret — read-only deloppgaver,
  «⏳ til godkjenning»-pille, «Angre» (`data-uncommit`).
- **`completed`** (0 coins, ferdig): «✓ ferdig»-pille (`.rtpill.ok`), **redigerbare
  deloppgaver** (avhuking vekker → open). Rutine uten deloppgaver får en «Angre»-knapp
  (`data-uncommit`, reuser `uncommitQuest`) siden det ikke finnes en boks å hake av.

### `renderRutinerPage(host)` – «I dag» inkluderer `completed`
`openToday` blir `todays.filter(q => q.status==='open' || q.status==='completed')`,
sortert så `open` ligger øverst og `completed` («✓ ferdig») nederst. Øvrige seksjoner
(For i morgen / Venter på godkjenning / Ikke gjort / Godkjent-arkiv) uendret.

`completed` dukker IKKE opp i forelderens godkjenningskø (`renderRutinerTab`) og teller
ikke i badges (begge filtrerer `status==='done'`).

### Logg
Ny `complete`-nøkkel i quest-map i logg-rendringen: `✓ Fullførte «…»`. Auto-`done`
gjenbruker eksisterende «🔒 Meldte ferdig»-tekst.

### CSS
Ingen nye klasser. Gjenbruker `.rtpill.ok` for «✓ ferdig».

## Testing (test/suite.js)

Nye assertions (alle med `source:'routine'` + deloppgaver der relevant):
- Avhuking av siste deloppgave på en >0-coins-rutine → `status==='done'`.
- Avhuking av siste deloppgave på en 0-coins-rutine → `status==='completed'`.
- Avhuking av en deloppgave igjen på en `completed`-rutine → `status==='open'`
  (vekk); og gated: `routineDate < i dag` → forblir `completed`.
- Ikke-siste avhuking → forblir `open` (ingen for tidlig avansering).
- `commitQuest` på rutine uten deloppgaver + 0 coins → `completed`; + >0 coins → `done`.
- Manuell sidequest (ingen deloppgaver) via `commitQuest` → `done` (uendret).
- `routinesRemaining` / `overlappingRoutineIds` uberørt av `completed`-instanser.

## Ikke i scope (YAGNI)
- Forelder-visning av `completed`-rutiner (ingen handling nødvendig; de ruller ut som
  dag-bundne instanser).
- Endring av manuelle sidequests eller lekser.
- Auto-avansering for rutiner uten deloppgaver (fortsatt manuell knapp).
