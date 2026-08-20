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
- **Saldo** = Σ(medaljepoeng over alle dager/fag) − Σ(payouts.coins). Beregnes, lagres ikke.

## Synk / fletting

- `days`: fletting per fag-markering (`marks[idx]`), nyeste `updatedAt` vinner (LWW).
- `settings`: LWW på hele objektet (evt. per felt hvis nødvendig).
- `payouts` og `log`: **union på `id`** (append-only) — mister aldri en logglinje.

## Logg-hendelser (type)

- `grade` — medalje satt/endret (sønn eller forelder-overstyring).
- `payout` — utbetaling registrert.
- `settings` — endring av poengverdier, kr-kurs, timeplan eller PIN.

## Utenfor scope (nå)

- **Streaks** (neste runde).
- Push-varsler / påminnelser.
- Fuskesikker autentisering.

## Åpne detaljer til implementeringsplanen

- Nøyaktig tabell-layout (én `data`-kolonne vs. flere kolonner).
- Hvor mye av loggen som vises (paginering/tak) og evt. GC av gamle logglinjer.
- Design/farger (egen palett; ikke gjenbruk av Handleliste sine butikkfarger).
