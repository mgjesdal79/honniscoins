# Honniscoins — Innsats-drevet fond + ferie-modus (design)

**Dato:** 2026-09-29
**Status:** Godkjent design, klar for plan
**Berører:** `js/logic.js` (bank-kurve, migrering, ferie), `js/app.js` (fond-kort, Settings), `test/suite.js`

## Bakgrunn og mål

Banken (sparekonto + fond) ble nylig satt opp
(`docs/superpowers/specs/2026-09-24-honniscoins-bank-renter-fond-design.md`). Fondet vokser i dag
via en **fast, dato-basert kurve** (`navForDate(iso)`) med innebygd positiv drift (~+2,5 %/uke).
Det betyr at pengene vokser **uansett** hva gutten gjør — passiv oppspart saldo lønner seg like
godt som fersk innsats. Det er på tvers av appens hovedintensjon: **få gutten til å gå på skolen
og yte best mulig.** Å vokse penger skal være en *bieffekt* av innsats, ikke et mål i seg selv.

**Mål:** La fondskursen utvikle seg positivt **når gutten tjener ferske poeng**. Fondet blir «en
aksje i deg selv»: det kryper litt av seg selv, men **hopper opp de ukene han gjør det bra**, og
en pågående streak gir ekstra medvind. Slappe uker → nær stillstand. Ferieuker → nøytral, vanlig
børsuke (ingen straff for å ikke yte når skolen er stengt).

Ikke-mål (bevisst utenfor scope nå): full ferie-modus som også skrur av rutiner/rating (kun
datastruktur forberedes); forelder-oversikt over sønnens bank; nedside/straff på kursen.

## Konsept (fortellingen til gutten)

> «Fondet ditt er som en aksje i deg selv. Det kryper litt oppover av seg selv, men det **hopper
> opp de ukene du gjør det bra på skolen** — og jo lengre streak, jo sterkere medvind. Slappe
> uker? Da står det nesten stille. I ferien går det som et helt vanlig fond.»

Guttens coins/saldo er **helt urørt** av dette — innsatsen *speiles* i fondet, den *forbrukes*
ikke. Ingen dobbelttelling av poeng, ingen migrering av opptjente coins.

## Domenemodell / formel

Kursen bygges fortsatt dag for dag fra epoken (`BANK_FUND_EPOCH = '2024-01-01'`, NAV=100), men
**daglig avkastning avhenger nå av innsats og ferie**:

For hver dag `d` fra epoken til i dag:

```
hvis d ligger i en ferieperiode:
    r_d = nøytral_drift_per_dag + støy            (vanlig børsuke, ingen innsats/straff)
ellers:
    r_d = grunn_drift_per_dag
        + innsats_løft_per_dag(uke(d)) × streak_faktor(uke(d))
        + støy
r_d kappes til ±BANK_FUND_CAP (±3 %/dag, som i dag)
nav *= 1 + r_d
```

Der:

- **grunn-drift:** senkes kraftig fra dagens ~+2,5 %/uke til **~+0,6 %/uke** (default), fordelt
  per dag. Så passiv/gammel saldo bare kryper. Fikser samtidig dagens «hamstring lønner seg».
- **nøytral-drift (ferie):** ~**+2 %/uke** (default), som et helt vanlig fond — verken
  innsats-bonus eller straff.
- **innsats-løft(uke):** basert på ukens **innsats-score** = Σ medaljescore på **låste, ikke-syke**
  dager den uka (🥇3 / 🥈2 / 🥉1, samme `EFFORT_SCORE` som Stat-siden, via `effortRecords`).
  `innsats_løft_uke = min(EFFORT_LØFT_TAK, innsats_styrke × innsats_score_uke)`, fordelt over
  ukens ikke-ferie-dager. En knalluke gir tydelig hopp (~+3–4 %), en tynn uke lite, en null-uke 0.
- **streak-faktor(uke):** en pågående oppmøte-/medalje-streak forsterker ukens løft:
  `1 + STREAK_FORSTERKNING × min(streak_uker, STREAK_TAK)` (default forsterkning ~0,05/uke, tak
  ~10 uker ⇒ maks ×1,5). Streaken leses deterministisk fra låste dager
  (`attendanceStreakInfo`-maskineriet).
- **støy:** beholdes liten for «børs-rugging» (dagens `BANK_FUND_VOL`/`bankNoise`), fortsatt
  kappet ±3 %/dag.
- **Nedside:** ingen straff utover at bonusen uteblir; grunn-drift holder det så vidt positivt.

**Bare låste dager teller** (lås = commit styrer alt) — inneværende, halvferdige uke bidrar med
innsats-løft først når dagene låses. Uker uten låste skoledager (uten å være ferie) gir 0
innsats-løft → bare grunn-drift.

### Ferieperioder

Ny konfig: `settings.bank.vacations = [{ id, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }]` (inklusive
begge ender). En dag er «ferie» hvis den ligger i minst én periode. Håndteres **per dag** i
kurs-foldingen, så perioder som dekker fridager midt i uka eller krysser ukeskille fungerer.
Datastrukturen er bevisst gjenbrukbar, så senere ferie-modus (rutiner/rating) kan lese samme
liste.

**Streak + ferie:** feriedager **pauser** streaken (bryter den ikke) — på samme måte som tomme
timer allerede pauser «ekte streak». En feriedag skal ikke telle som «hull» (ulåst fortidsdag)
som bryter streaken. Dette gjelder streak-lesingen som mater fond-forsterkningen; øvrig
streak-visning berøres minimalt (se «Åpne spørsmål»).

### Tunables (Settings, som `savingsWeeklyRate`)

- `settings.bank.fundBaseWeeklyRate` (default `0.006`) — grunn-drift.
- `settings.bank.fundEffortStrength` (default tunet så knalluke ≈ +3–4 %) — innsats-styrke.
- `settings.bank.fundNeutralWeeklyRate` (default `0.02`) — ferie/nøytral drift.
- `settings.bank.vacations` (default `[]`).
- Konstanter i logic.js (ikke i Settings, for å unngå rot): `EFFORT_LØFT_TAK`,
  `STREAK_FORSTERKNING`, `STREAK_TAK`.

## Arkitektur

I dag er `navForDate(iso)` en **ren dato-funksjon** med global cache. Den blir
**`navForDate(state, iso)`** — kursen foldes fortsatt deterministisk fra epoken, men henter ukens
innsats-score, streak og ferie-status fra `state` (låste dager + `settings.bank.vacations`).
Bevarer ledger-fold-filosofien:

- **Deterministisk** og **flettevennlig:** ingen ny lagret verdi; ren funksjon av flettet state +
  dato. Innsats kommer fra låste dager (allerede sannheten, flettet trygt).
- **Bare kalt for datoer ≤ i dag** (sparkline siste 30 d, historikk) → fremtiden har ingen innsats
  ennå, helt greit.
- **Ytelse:** dagens per-iso-cache må erstattes, fordi NAV nå avhenger av state. Bygg hele
  NAV-serien i **ett sveip** (fold fra epoke til i dag) og memoiser på en billig state-signatur
  (f.eks. `antall låste dager | siste låste dato | vacations-lengde/hash | tunables`). Invalideres
  når signaturen endres. Slå opp `navForDate(state, iso)` i den memoiserte serien.
- **Alle kallsteder** oppdateres til å sende `state`: `foldFund`, `fundMarketValue`, `fundValue`,
  `bankHistoryRange`, `fundSparklineSvg` m.fl.

**Migreringskonsekvens:** eksisterende fond-innskudd ble kjøpt mot den *gamle* kurven. Med den nye
kurven reberegnes papir-gevinsten deres (gulvet `max(marked, principal)` beskytter fortsatt selve
innskuddet). Med lite/ingen ekte fond-historikk hos gutten er dette ufarlig. `migrate` fyller nye
`settings.bank`-defaults (`fundBaseWeeklyRate`, `fundEffortStrength`, `fundNeutralWeeklyRate`,
`vacations`) uten å røre eksisterende `savingsWeeklyRate`.

## UI

### Gutten — fond-kortet (`renderBankView`/`bindBankView`)
- **Medvinds-linje** på fond-kortet som speiler inneværende uke:
  - god uke: «📈 +X % medvind denne uka — sterk innsats!» (+ «🔥 streak ×N» når streak-faktor > 1)
  - slapp uke: «🌱 Rolig uke — fondet kryper»
  - ferie: «🌴 Ferie — vanlig børsuke»
- Sparklinjen (`fundSparklineSvg`, siste 30 d NAV) vil nå **synlig rally-e i gode uker** og flate
  ut i slappe — et ekte visuelt speil av innsatsen. Tidligere gode uker vises som opptur.

### Forelder — Settings → 🏦 Bank (`renderPoengTab`)
- Steppere ved siden av dagens sparerente: **grunn-drift (%/uke)** (`fundBaseWeeklyRate`) og
  **innsats-styrke** (`fundEffortStrength`). Lagres som brøk der relevant, bumper
  `settings.updatedAt`.
- **Ferieperioder:** liste med fra–til dato-velgere, «＋ Legg til ferie» og slett per rad
  (gjenbruker dato-input-mønsteret fra frist-velgeren). `addVacation`/`removeVacation` (rene fn),
  bumper `settings.updatedAt`, logger `type:'bank'` (kort tekst).

## Testing (`test/suite.js`, ren logikk, DOM-fri)

- `navForDate(state, iso)` er deterministisk (samme state+iso → samme NAV).
- **god uke > slapp uke > null-uke** i kursvekst; **ferie-uke = nøytral** (høyere enn slapp,
  uavhengig av innsats-score).
- Innsats-løftet stiger med medaljekvalitet (gull-uke > sølv-uke > bronse-uke ved lik telling).
- Streak forsterker: samme ukeinnsats gir høyere løft med lengre pågående streak (opp til tak).
- Feriedag → nøytral drift; **streak pauser** over ferie (god streak før ferie fortsetter etter,
  brytes ikke).
- Lav grunn-drift ⇒ passiv saldo (ingen innsats, ingen ferie) bare kryper.
- **Gulvet beskytter fortsatt innskuddet** (`fundValue = max(marked, principal)`).
- Migrering: nye `settings.bank`-defaults fylles; eksisterende `savingsWeeklyRate` urørt.
- Kjør: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`.
- Husk `locked:true` på testdager som skal telle innsats.

## Åpne spørsmål / avklart

- **Signal:** innsats-poeng (medaljekvalitet) på låst uke **+** streak (avklart).
- **Nedside:** ingen straff, kun uteblitt bonus + lav grunn-drift (avklart).
- **Ferie fond-oppførsel:** nøytral markedsdrift (avklart).
- **Ferie streak:** pauser, bryter ikke (avklart).
- **Utblinking:** datoperioder (fra–til) i Settings (avklart).
- **Scope:** kun fond + streak nå; ferie-datastruktur gjenbrukbar for senere rutiner/rating
  (avklart).
- Detalj: om feriepause av streak også skal påvirke den **synlige** streak-visningen (Nå/All-time)
  eller kun fond-forsterkningen — avgjøres i planfasen (default: minst mulig endring i eksisterende
  streak-visning; fond leser sin egen ferie-bevisste streak).
