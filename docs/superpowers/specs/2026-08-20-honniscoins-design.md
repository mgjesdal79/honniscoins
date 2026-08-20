# Honniscoins — designspec

**Dato:** 2026-08-20
**Status:** Godkjent design (klar for implementeringsplan)

## Formål

En liten PWA som hjelper en 12-åring å motivere seg for skolen. Sønnen vurderer
egen innsats per skoletime med en medalje (0/Fravær, Bronse, Sølv, Gull). Medaljer gir
interne poeng kalt **Honniscoins**. Poengene er bevisst **frakoblet** ekte kroner:
kr-verdien kan endres når som helst uten å endre poenghistorikken. Foreldre kan se en
**endringslogg** for etterrettelighet og kan overstyre vurderinger.

Appen er delt i to: en enkel del for sønnen og en foreldremodus bak PIN.

## Kjernebeslutninger (fra brainstorming)

| Tema | Valg |
|------|------|
| Pålogging/roller | Én delt lenke → «Hvem er du?» (Sønn/Forelder) → foreldremodus bak PIN. Rollevalg huskes lokalt. |
| Timeplan | Fast ukeplan Man–Fre (hver ukedag har sine 6–7 fag). |
| Vurdering | Sønn egenvurderer; foreldre kan overstyre (logges som forelder-endring). |
| Redigering av tidligere dager | Fritt for begge, men alt logges. |
| Ukedager | Kun Man–Fre. Helg finnes ikke i appen. |
| Timeplan-eier | Kun foreldre (PIN) kan endre selve timeplanen. |
| Saldo | Opptjent − innløst. Appen registrerer utbetalinger (coins innløst). |
| Backend | Gjenbruk Handleliste sitt Supabase-prosjekt, ny tabell + ny Edge Function. |
| Default-poeng | Bronse 1 / Sølv 2 / Gull 3 (0 og Fravær = 0). Endres i appen. |
| Streaks | Utenfor scope (neste runde). |

## Ærlig sikkerhetsavgrensning

Med delt lenke kan den som har lenken teknisk sett endre alt (blobben er lik for alle
klienter; rollevalg/PIN håndheves i frontend). Rollevalg + PIN hindrer «rot», ikke en
målbevisst 12-åring. Endringsloggen er ment for etterrettelighet og samtale — ikke som
juksesikkert bevis. Dette er akseptert.

## Arkitektur (gjenbruk av Handleliste-stacken)

- **Frontend:** én `index.html` (HTML/CSS/vanilla JS), ingen build-step, ingen rammeverk.
- **PWA:** `manifest.json` + ikon, `standalone`, mobil-først.
- **Hosting:** GitHub Pages, eget repo.
- **Backend:** Supabase via Edge Function som lagrer opake JSON-blobber. Frontend gjør
  ingen direkte DB-kall.
- **Datflyt:** Frontend → Edge Function → Supabase. Optimistisk lokal cache + debounce-
  lagring (~600 ms) + polling (~5 s) med hash-diff, som Handleliste.

### Backend-oppsett (prerequisite — deployes av bruker; deno/deploy kan ikke kjøres her)

- Ny tabell i eksisterende Supabase-prosjekt, speiler `list_items`:
  `honniscoins_rooms { room_token_hash text pk, data jsonb, settings jsonb, payouts jsonb, log jsonb, updated_at timestamptz }`
  (kan også lagres som én `data`-kolonne med under-nøkler — velges i implementeringsplanen).
- Ny Edge Function (speiler Handleliste sin) som leser/skriver denne tabellen med
  `room_token_hash`. `EDGE_FUNCTION_URL` legges i `index.html`.

## Roller og navigasjon

1. **«Hvem er du?»-skjerm** ved første åpning på en enhet: Sønn / Forelder.
   - Sønn → rett inn i sønnens del.
   - Forelder → PIN-skjerm → foreldremodus.
   - Valget lagres i `localStorage` (enhetsspesifikt), med mulighet for å bytte bruker.
2. PIN lagres i `settings.pin`. Første gang (ingen PIN satt): forelder setter PIN.

## Sønnens del (hovedskjerm)

- Viser **valgt dag** (default = i dag; hvis i dag er helg, hopp til nærmeste ukedag).
- Dagens fag hentes fra dagens frosne fagliste (se datamodell) eller fra malen hvis dagen
  ikke er «rørt» ennå.
- Per fag: fem tilstander — **○ ikke vurdert · 0/Fravær · 🥉 Bronse · 🥈 Sølv · 🥇 Gull**.
  - Start = «ikke vurdert» (0 poeng, teller ikke som fravær).
  - «0/Fravær» er et aktivt valg (0 poeng, markert som fravær).
- **Dagsnavigasjon:** bla venstre/høyre mellom ukedager (hopper over helg) + kalenderknapp
  for å velge dato.
- **Topp:** Honniscoins-saldo + liten «≈ X kr»-tekst (ved gjeldende kurs).
- **Dagsoppsummering:** f.eks. «+7 i dag».

## Foreldremodus (bak PIN)

- **Timeplan-oppsett:** rediger fagene per ukedag (Man–Fre). Endring i malen påvirker ikke
  dager som allerede har frosset sin fagliste.
- **Poengverdier:** Bronse/Sølv/Gull (0 og Fravær = 0). Default 1/2/3.
- **Kr-kurs:** «X kr per Honniscoin». Frakoblet poenghistorikk; endring gir kun ny visnings-
  verdi.
- **Utbetalinger:** registrer «vekslet inn N coins» (valgfri kr-notat + dato). Trekker fra
  saldo.
- **Overstyring:** endre en medalje for et fag/dag; logges med `actor='parent'`.
- **Endringslogg:** kronologisk (nyeste først): tidspunkt, hvem, fag+dag, fra→til, samt
  utbetalinger og innstillingsendringer.

## Datamodell (blob)

```json
{
  "settings": {
    "pin": "1234",
    "medalValues": { "bronse": 1, "solv": 2, "gull": 3 },
    "krPerCoin": 1.0,
    "timetable": {
      "mon": ["Norsk", "Matte", "Engelsk", "Naturfag", "Gym", "KRLE"],
      "tue": [], "wed": [], "thu": [], "fri": []
    },
    "schemaVersion": 1
  },
  "days": {
    "2026-08-20": {
      "subjects": ["Norsk", "Matte", "Engelsk", "Naturfag", "Gym", "KRLE"],
      "marks": {
        "0": { "medal": "gull",  "by": "son",    "updatedAt": "..." },
        "1": { "medal": "bronse","by": "parent", "updatedAt": "..." }
      }
    }
  },
  "payouts": [
    { "id": "p1", "coins": 100, "kr": 50, "note": "Kino", "at": "...", "by": "parent" }
  ],
  "log": [
    { "id": "l1", "at": "...", "actor": "son", "type": "grade",
      "day": "2026-08-20", "subject": "Norsk", "from": null, "to": "gull" }
  ]
}
```

- **Frossen fagliste:** når en dag først vurderes, kopieres den ukedagens fagliste inn i
  `days[dato].subjects`. Historikk blir dermed stabil selv om malen endres senere.
- **`marks` nøkkel** = indeks inn i dagens `subjects`.
- **`medal`** ∈ `null` (ikke vurdert) · `"0"` (fravær) · `"bronse"` · `"solv"` · `"gull"`.

### Saldo som generelt regnskap (forberedt for fremtid)

Saldo = **Σ(opptjent fra alle kilder) − Σ(brukt)**. Beregnes, lagres ikke.

- **Opptjeningskilder** (nå: skoletimer; senere: sidequests). Modelleres slik at nye kilder
  kan legges til uten migrering — saldofunksjonen summerer over en liste av kilder.
- **Bruk** modelleres som **typede poster** i én liste (ikke bare `payouts`). Hver post har en
  `type` (`"payout"` nå; `"purchase"` senere) og et antall `coins` som trekkes fra. `payouts`
  i modellen over er MVP-formen av dette; i implementeringsplanen vurderes om den skal hete
  `spend`/`ledger` fra start for å slippe rename senere.

## Synk / fletting

- `days`: fletting per fag-markering (`marks[idx]`), nyeste `updatedAt` vinner (LWW).
- `settings`: LWW på hele objektet (evt. per felt hvis nødvendig).
- `payouts` og `log`: **union på `id`** (append-only) — mister aldri en logglinje.

## Logg-hendelser (type)

- `grade` — medalje satt/endret (sønn eller forelder-overstyring).
- `payout` — utbetaling registrert.
- `settings` — endring av poengverdier, kr-kurs, timeplan eller PIN.

## Fremtidige utvidelser (bygges senere — arkitekturen skal støtte dem)

Disse skal IKKE bygges nå, men datamodellen og saldo-logikken forberedes så de kan legges
til uten smertefull migrering.

### Item shop (utbetaling som butikk)
- Foreldre legger inn **varer**: navn, **bilde**, pris i coins, **produktlenke**, aktiv/inaktiv.
  - `shopItems: [ { id, name, image, priceCoins, productUrl, active } ]`
  - `image` lagres som data-URL (base64) eller URL — avklares i planen (blob-størrelse).
- Sønn ser butikken; kan «**be om å kjøpe**» en vare. Det oppretter en **kjøpsforespørsel**
  som foreldre ser (med produktlenken, så de kan bestille varen).
- **Kjøp = typet bruks-post** (`type:"purchase"`) i bruks-lista → trekker coins fra saldo.
  - `purchases: [ { id, itemId, at, status, coinsSpent, irlKr, note } ]`
  - `status` ∈ f.eks. `requested` → `approved`/`rejected` → `fulfilled`.
- **IRL-oppgjør:** en vare kan koste mer enn han har. Da kan kjøpet dekkes **delvis av coins og
  resten av «IRL-penger»** (mellomlegg bokført i `irlKr`). Coins trekkes for coin-andelen;
  kr-andelen er kun bokføring (påvirker ikke poenghistorikk). Alt logges.

### Sidequests (ekstra oppdrag, ikke nødvendigvis skolerelatert)
- Foreldre lager oppdrag med en coin-belønning; sønn fullfører → coins opptjent.
  - `quests: [ { id, title, rewardCoins, active, ... } ]` og fullføringer som **opptjeningskilde**.
- Fordi saldo allerede summerer over flere opptjeningskilder, kommer dette inn uten migrering.

### Andre
- **Streaks** (neste runde).
- Push-varsler / påminnelser (krever server-side push — vurderes separat).

## Utenfor scope (nå)

- Alt under «Fremtidige utvidelser» over.
- Fuskesikker autentisering.

## Design / tema (godkjent via skisser)

Mørkt tema, mobil-først. Skisser: `mockups/skisser.html`.

- Bakgrunn sort (`#050505`/`#000`), tekst hvit (`#ffffff`), dempet `#9fb3cf`.
- Uthevede flater i mørkeblå: `--surface #0b1a33`, `--surface-2 #0f2547`, kantlinje `--line #1c3a63`.
- Aksent (knapper/aktiv): `--accent #3b6fe0`.
- Medaljefarger: bronse `#cd7f32`, sølv `#cfd6dd`, gull `#ffce3a`; «positiv» grønn `#3ddc97`.
- Skjermer skissert: (1) Hvem er du, (2) Sønnens dag, (3) PIN, (4) Poeng/utbetaling,
  (5) Endringslogg, (6) Timeplan-oppsett. Bruker: «designet er veldig fint».

## Åpne detaljer til implementeringsplanen

- Nøyaktig tabell-layout (én `data`-kolonne vs. flere kolonner).
- Hvor mye av loggen som vises (paginering/tak) og evt. GC av gamle logglinjer.
- Navngiving av bruks-lista (`payouts` vs. generell `spend`/`ledger` fra start), gitt at item
  shop-kjøp kommer senere.
