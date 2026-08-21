# Honniscoins – Streaks (Streak #1: Oppmøte-streak) – Design

**Dato:** 2026-08-21
**Status:** Godkjent design, klar for implementasjonsplan

## Mål

Innføre et streak-system i Honniscoins som motiverer til jevnt oppmøte og daglig
selvvurdering. Systemet skal tåle **flere streak-typer** over tid, men vi designer og
lanserer **én type om gangen**. Første type er **Oppmøte-streak**.

Samtidig innfører vi **låsing av poeng per uke** og **tre totaler** (dag / uke / total),
slik at gamle poeng ikke kan manipuleres av sønnen.

---

## 1. Oppmøte-streak – regler

### Klassifisering av en skoledag
Hver skoledag (man–fre) er én av tre tilstander, utledet av medaljene + syk-merket:

- **Til stede** – **alle** timene den dagen har **minst Bronse**. Gir bonus, øker streaken.
- **Pause** – dagen er **blank** (ikke ferdig vurdert) **eller** merket **syk**.
  Bryter *ikke* streaken og gir *ingen* bonus. Streaken fortsetter uforstyrret over
  slike dager (helger hoppes også over).
- **Brudd** (streak → 0) – dagen har **0/Fravær på minst én time** og er **ikke merket syk**
  (uunnskyldt fravær).

Streaken er en **ren funksjon av historikken** – regnes alltid på nytt fra medaljer +
syk-merker. Ingen skjult tilstand.

### Bonus og opptrapping
- **+1 Honniscoin** per til stede-dag fra start.
- Etter **10 til stede-dager** (to uker) → **+2 per dag**. Der stopper opptrappingen.
- «10 til stede-dager» telles som til stede-dager i den gjeldende streaken. Pause-dager
  (syk/blank) teller **ikke** med, men nullstiller **ikke**. Et brudd nullstiller telleren.
- Streak-bonus er en **egen post**, adskilt fra medaljepoeng (medaljepoeng og kr-kurs
  fungerer som før).

### Syk-merking
- **Ett trykk «Syk/fri»** på dag-skjermen merker hele dagen som unnskyldt.
- Effekt: fjerner attendance-bonus for dagen **og** verner mot brudd (0/Fravær blir unnskyldt).
- Medaljepoeng som eventuelt allerede er gitt den dagen, teller fortsatt (syk-merket
  påvirker kun streaken, ikke medaljepoeng-summen).
- **Hvem:** både sønn og forelder. Sønnen merker syk for **inneværende uke**. Forelder kan
  når som helst (også i låste uker) via foreldremodus.

---

## 2. Låsing per uke + tre totaler

### Ukentlig lås
- **Inneværende uke (man–fre) er redigerbar** av sønnen: vurdere timer + merke syk.
- **Når uka er omme, låses den automatisk.** Lås utledes av **ukenummer/dato** – ingen
  egen lås-tilstand lagres, ingen knapp å huske.
- **Låste uker kan kun forelder endre**, og endringer logges (eksisterende logg + `actor:'parent'`).
- «Inneværende uke» bestemmes av enhetens dato.

### Tre totaler (vises på dag-skjermen)
- **Dagstotal** – opptjent i dag (medaljepoeng + evt. streak-bonus for dagen).
- **Ukestotal** – opptjent denne uka.
- **Total-total = saldo** – **alt opptjent − alt utbetalt**, med en linje som viser
  **hvor mye inneværende uke bidrar med** til totalen.
- Utbetalinger (cash-out) trekkes fra total-total → gjeldende saldo (som dagens
  `balance = earned − spent`, nå utvidet med streak-bonus i `earned`).

---

## 3. Datamodell

Utvider eksisterende blob (bakoverkompatibelt):

- `days["YYYY-MM-DD"].sick: true` – valgfritt flagg per dag.
- **Ingen** eksplisitt lås-felt – lås utledes av dato vs. ukenummer.
- Streak-lengde og bonus **lagres ikke** – beregnes i `logic.js`.

`computeEarned` utvides til å inkludere total streak-bonus, slik at `computeBalance`
(= earned − spent) automatisk blir riktig saldo.

### Fremtid (bygges IKKE nå, men modellen skal tåle det)
- **Streak freeze:** et antall «freeze» sønnen kan tjene opp og bruke på en dag som ellers
  ville brutt streaken. Reserverer plass i modellen (f.eks. `settings.freezes` + per-dag
  `frozenByToken`), men implementeres senere.
- **Flere streak-typer:** logikken legges opp generisk nok til at nye typer kan legges til.

---

## 4. Logikk (rene, testbare funksjoner i `logic.js`)

Planen vil detaljere signaturer; på designnivå trengs blant annet:

- `weekKey(iso)` / `weekStart(iso)` – identifisere ISO-uke (man-start).
- `isWeekLocked(iso, todayIso)` – er uka til `iso` låst for sønn-redigering?
- `classifyDay(state, iso)` → `'present' | 'paused' | 'broken'`.
- `attendanceStreak(state, uptoIso)` → `{ length, bonusPerDay }` (opptrapping innebygd).
- `streakBonusTotal(state)` – sum av per-dag-bonus over alle til stede-dager.
- `dailyTotal(state, iso)`, `weeklyTotal(state, iso)` – opptjent i periode.
- `setSick(state, {date, sick, actor}, ctx)` – mutasjon som logger endringen.

Alt dette er rene funksjoner med enhetstester i `test/tests.js` (kjøres i nettleser på
`/test/tests.html`), på linje med eksisterende logikk.

---

## 5. UI

- **Dag-skjerm (sønn og forelder-«Dag»-fane):**
  - «Syk/fri»-knapp per dag (aktiv kun for redigerbare/inneværende uke for sønn;
    alltid for forelder).
  - Streak-status: nåværende streak-lengde + gjeldende bonus (+1/+2), og en indikator når
    en dag er til stede.
  - De **tre totalene** (dag / uke / total-med-saldo).
- **Låste dager** vises som skrivebeskyttet for sønn (medalje-/syk-knapper deaktivert),
  med en liten «låst»-indikator. Forelder kan fortsatt endre.
- Foreldremodus trenger ingen ny fane – «Dag»-fanen gir allerede sønnens grensesnitt med
  overstyring.

---

## 6. Avgrensning (YAGNI – ikke nå)

- Streak freeze (kun modell-plass).
- Andre streak-typer enn Oppmøte-streak.
- Automatisk utbetaling / kr-håndtering utover eksisterende utbetalingsseksjon.
