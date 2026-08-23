# Honniscoins – Lekser (design)

**Dato:** 2026-08-23
**Status:** Design til gjennomgang

## Formål

En todelt lekse-funksjon som (1) **stimulerer** sønnen til å gjøre lekser via poeng, og
(2) gir ham en **oversikt** over hvilke lekser han har og på hvilke dager. Forelder legger inn
lekser og setter poeng per lekse. Kilden er skolens Docendo-kalender (åpen), slik at leksene kan
**hentes automatisk** i stedet for å tastes inn manuelt.

## Kilde: Docendo

- Kalender-URL (visning): `https://app.docendo.no/calendar/519a0908-ed7d-47ed-8667-dea07343b693#/`
- Åpen ICS-feed: `https://app.docendo.no/calendars/ical/519a0908-ed7d-47ed-8667-dea07343b693`
  - Fullt skoleår, ~2177 `VEVENT`.
  - Felt: `DTSTART` (UTC, f.eks. `20270601T061000Z`), `SUMMARY` (`"Fag, 8B"`), `LOCATION`,
    `DESCRIPTION` (HTML = **elevforberedelse**; tom for Lunsj/Friminutt/Pauser).
  - ICS er linje-foldet (fortsettelseslinjer starter med mellomrom/tab → må «unfoldes») og escapet
    (`\,`→`,`, `\;`→`;`, `\n`→linjeskift, `\\`→`\`).
- **Kun `DESCRIPTION` (elevforberedelse) med ikke-tomt innhold blir en lekse.** Timer uten
  elevforberedelse (Lunsj, Friminutt, vanlige timer uten forberedelse) hoppes over.
- **CORS:** feeden har ingen CORS-header → nettleseren kan ikke hente den direkte. Vi trenger en
  liten server-side proxy.

## Beslutninger (avklart med bruker)

| Tema | Valg |
|---|---|
| Import | Blanding: **forelder starter import selv i appen**, kan gå inn etterpå og justere |
| Filtrering | **Auto med opt-out** – alt med ikke-tom elevforberedelse blir lekse; forelder kan skjule/slette |
| Belønning | **Sønn huker av → forelder godkjenner** (open→done→approved, som Sidequests) |
| Plassering | **Integrert i «Uken»-siden** hos sønn |
| Sønn-visning | **Dag-for-dag default**, toggle til **«Hele uka (fag)»** (gruppert per fag) |
| Hele uka | Lekse som gjelder hele uka er en **vanlig lekse på sin dag** med lite **«🗓 hele uka»-merke** (ikke pinned/egen seksjon) |
| Sticky topp | **Ja** – ukenr + dagstripe (+ segment-toggle) blir stående ved scroll |
| Redigering av importert lekse | **Ja – endringer beskyttes** mot overskriving ved ny import |
| Proxy-deploy | Bruker deployer edge-funksjonen selv |

## Arkitektur

Følger prosjektets lagdeling (vanilla, no-build, ES-moduler):

- **`docendo-proxy` (ny Supabase edge function)** – minimal CORS-proxy.
  - Input: `{ ical_id }`. Whitelist host = `app.docendo.no` (unngår åpen proxy).
  - Henter `https://app.docendo.no/calendars/ical/<ical_id>`, returnerer **rå ICS-tekst** +
    CORS-headere. Ingen parsing server-side.
- **`js/logic.js`** – all parsing/filtrering/fletting/livssyklus (rene funksjoner, testbare):
  - `parseIcs(text)` → liste av events `{uid, start, summary, location, description}` (unfold +
    unescape + HTML-strip av description).
  - `homeworkFromIcs(text, {from, to})` → lekse-kandidater i datointervall der description ≠ tom.
    Utleder `date` (YYYY-MM-DD fra `DTSTART`), `subject` (fag fra `SUMMARY`), `text`.
  - `mergeHomeworkImport(existing, imported, ctx)` → idempotent fletting (se «Import-semantikk»).
  - Livssyklus: `addHomework`, `updateHomework`, `deleteHomework`, `hideHomework`,
    `commitHomework` (sønn: open→done), `uncommitHomework` (done→open),
    `approveHomework` (done→approved), `rejectHomework` (done→open).
  - Utvalg/aggregat: `homeworkForWeek(state, ws)`, `homeworkPointsPending(state)`, og
    `homeworkPointsTotal` inn i `computeBalance`.
- **`js/store.js`** – ingen endring i kontrakt; ny liste flettes med samme mønster som `quests`
  (union-by-id, LWW per felt på `updatedAt`).
- **`js/app.js`** – DOM/rendering: sønn «Uken»-integrasjon (sticky topp, dag/uke-toggle),
  forelder «Dag»-fane (hent-knapp, godkjenning, poeng, skjul/slett, manuell add, rediger).
- **`index.html`** – ny CSS (gjenbruk fra mockup), `window.DOCENDO_PROXY_URL`, bump `APP_VERSION`.

## Datamodell

Ny topp-nivå liste `homework: []`. Hver lekse:

```js
{
  id,                 // stabil id
  date,               // 'YYYY-MM-DD'
  subject,            // fag, f.eks. 'Tysk'
  text,               // elevforberedelse (ren tekst)
  points,             // poeng ved godkjenning (default settings.homeworkPoints)
  status,             // 'open' | 'done' | 'approved'
  wholeWeek: false,   // vises med «🗓 hele uka»-merke
  hidden: false,      // opt-out (skjult for sønn, ikke slettet)
  source,             // 'docendo' | 'manual'
  docendoUid,         // for idempotent import (kun source='docendo')
  edited: false,      // forelder har endret → beskyttet mot re-import
  doneAt, approvedAt, // tidsstempler
  updatedAt,          // LWW-flettenøkkel
  removed: false      // soft-delete (tombstone for fletting)
}
```

Settings:
- `settings.docendoIcalId` – kalender-id (default den kjente id-en).
- `settings.homeworkPoints` – default poeng per lekse (default `5`).

## Import-semantikk (idempotent, trygg re-import)

`mergeHomeworkImport(existing, imported, ctx)`:
- **Match på `docendoUid`.** Ny uid → ny lekse (`source:'docendo'`, `status:'open'`,
  `points = settings.homeworkPoints`).
- **Eksisterende uid:**
  - **Aldri auto-slett.** Bevar alltid `status`, `doneAt`, `approvedAt`, `hidden`, `points`.
  - Hvis `edited === true`: la `subject`/`text` stå **urørt** (bruker-endringer beskyttes).
  - Hvis `edited === false`: oppdater `subject`/`text` fra Docendo hvis endret.
- **Forsvinner fra Docendo:** leksen slettes **ikke** automatisk (forelder kan skjule/slette selv).
- Kun events med ikke-tom elevforberedelse importeres (auto opt-out via `hidden`).

## Poeng

- Poeng teller **kun** når `status === 'approved'` og `hidden !== true`.
- `homeworkPointsTotal` legges til i `computeBalance`.
- `homeworkPointsPending` (sum av `done`, ikke godkjent) vises på Poeng-siden, som quests.

## UI

### Sønn – «Uken»
- Sticky topp: logo m/saldo, ukenavigasjon (‹ ›), dagstripe (📚 på dager med lekser),
  segment-toggle **«📅 Dag for dag» / «📚 Hele uka (fag)»**.
- Default dag-for-dag: leksekort for valgt dag; lekse med `wholeWeek` får «🗓 hele uka»-merke.
- Hele uka (fag): kort gruppert per fag, dag vises som liten tag.
- Kort: fag + poeng + tekst + **«✓ Gjort»**-knapp. Etter «Gjort»: «⏳ Sendt til godkjenning»
  med «Angre». Etter godkjenning: «✅ Godkjent · lagt i potten».

### Forelder – «Dag»-fane
- **«📚 Hent lekser fra Docendo»**-knapp (trigger import for uken/intervallet).
- Godkjenningskø (approve/reject) for `done`-lekser.
- Per lekse: rediger (fag/tekst/poeng/«🗓 Gjelder hele uka»), skjul (opt-out), slett, manuell add.
- Redigert lekse merkes «endret – beskyttet»; ny import lar den stå urørt.

## Fletting (store.js)
- `homework` behandles som append-/oppdater-liste: **union-by-id**, **LWW per felt** på `updatedAt`
  (identisk mønster som `quests`). Soft-delete via `removed:true` tombstone.

## Migrering (`migrate` i loadState)
- Fyll `homework: []` hvis mangler.
- Fyll `settings.docendoIcalId` (kjent default) og `settings.homeworkPoints = 5` hvis mangler.
- Ingen historiske lekser å konvertere (ny funksjon).

## Testing
- Nye rene-logikk-tester i `test/suite.js`:
  - `parseIcs`: unfold, unescape, HTML-strip, tom description.
  - `homeworkFromIcs`: datointervall, fag-uttrekk, hopper over tom forberedelse.
  - `mergeHomeworkImport`: ny uid, re-import bevarer status/poeng/hidden, `edited` beskytter tekst,
    ingen auto-slett, idempotens (kjør to ganger → uendret).
  - Livssyklus + poeng: `approved` gir poeng, `done`/`open` gir ikke; `hidden` ekskluderes.
- Kjør: `jsc -m test/run-jsc.js`. Parse-sjekk app.js: `jsc -m js/app.js`.

## Sikkerhet / begrensninger
- Proxy **må** whitelist `app.docendo.no` (ikke åpen proxy).
- Elevforberedelse kan inneholde HTML → strippes til ren tekst i `parseIcs`.
- Ingen PII lagres utover det som allerede finnes (fag/tekst/datoer).

## Ikke i scope (YAGNI)
- Automatisk bakgrunns-import (kun manuell trigger fra forelder).
- Push-varsler / påminnelser.
- Vedlegg fra Docendo.
