# Streak-fiks + statistikk for sønn + kompakt forelder-meny — design

**Dato:** 2026-09-02
**Status:** Godkjent design (venter spec-gjennomlesning)

Tre sammenhengende endringer i denne runden. En større omtenkning av forelder-
navigasjonen (hvor statistikken bor for forelder) er utsatt til neste runde —
forelder beholder dagens egne Statistikk-fane nå.

---

## 1. Streak-fiks (ekte gull/sølv-streak)

### Problem
Den «ekte» time-streaken (`lessonSequence` → `hourStreak` → `silverStreakInfo`/
`goldStreakInfo`) er en motivasjons-teller som viser antall sølv-/gulltimer på rad.
Den gir **ingen poeng** — kun noe sønnen kan følge med på.

I dag gjør `lessonSequence` `if (day.sick) continue`, som hopper over **hele** den
syke dagen. Konkret feil: sønnen hadde 2 (gull)timer torsdag, så gyldig fravær
resten av dagen (dag låst, `sick:true`). De 2 gulltimene forsvinner helt fra
streaken fordi hele dagen hoppes over.

### Ny regel — «kun utfylte timer teller»
Gå gjennom **alle låste dager** (også syke). Per time:

| Time-innhold | Effekt på streak |
|---|---|
| Ekte medalje (bronse/sølv/gull) | Teller som en entry i rekka |
| «0» = fravær **uten** gyldig grunn (sønnens skulk-markering) | **Bryter** streaken (nullstiller) |
| Blank time (ingen medalje) | Pause — hoppes over, bryter ikke |
| Syk-dag (gyldig fravær, `day.sick`) sine blanke timer | Pause — hoppes over, bryter ikke |
| Ulåst fortidsdag (hull) | **Bryter** streaken (uendret — lås = commit styrer alt) |

En ikke-matchende medalje midt i en rekke nullstiller den aktuelle streaken (f.eks.
en sølv-time bryter en gull-streak; en bronse-time bryter en sølv-streak).

### Implementasjon (`js/logic.js`)
Erstatt `lessonSequence`:

```js
export function lessonSequence(state, uptoIso) {
  const days = scoringDaySequence(state, uptoIso);
  const seq = [];
  for (const d of days) {
    const day = state.days[d];
    if (!day || !day.locked) { seq.push({ date: d, break: true }); continue; } // ulåst = hull
    const subjects = subjectsForDate(state, d);
    const marks = day.marks || {};
    for (let i = 0; i < subjects.length; i++) {
      const m = marks[String(i)] ? marks[String(i)].medal : null;
      if (m === 'bronse' || m === 'solv' || m === 'gull') seq.push({ date: d, idx: i, medal: m });
      else if (m === '0') seq.push({ date: d, idx: i, break: true }); // fravær u/gyldig grunn = brudd
      // null/blank = hopp over (pause); syk-dagens blanke timer havner også her
    }
  }
  return seq;
}
```

`hourStreak` er uendret — den nullstiller allerede på `break`-entries og på
ikke-treff, både for «nå/all-time» og «denne måneden».

### Tester (`test/suite.js`)
Beholdes (skal fortsatt bestå): `silverStreak_and_gold_streak_runs`,
`streak_gap_breaks`, `streak_sick_pauses`, `streak_ongoing_flags`.

Nye:
- **`streak_sick_day_counts_filled_hours`**: låst syk-dag med 2 gulltimer utfylt +
  resten blankt, mellom to gulltimer på andre dager → gull all-time = 4.
- **`streak_blank_hour_pauses`**: låst dag `gull, blank, gull` → gull all-time = 2
  (blank pauser, bryter ikke).
- **`streak_fravaer_breaks`**: låst dag `gull, 0, gull` → gull all-time = 1
  («0» bryter).

---

## 2. Statistikk for sønn (nederst på Poeng-siden) + responsiv bredde

### Mål
Både sønn og forelder skal se statistikken i optimal bredde uansett mobil eller
laptop. Forelder beholder egen Statistikk-fane; sønn får statistikken nederst på
sin **Poeng-side** (`renderPoengPage`).

### Gjenbruk
Trekk statistikk-rendringen ut av `renderStatistikkTab` til en gjenbrukbar funksjon,
f.eks. `statContentHtml(state, period)` som returnerer periode-chips + `.statgrid`
med de fem SVG-visningene (uendret innhold). `bindStatChips(host)` gjenbrukes.

- **Forelder** (`renderStatistikkTab`): kaller `statContentHtml` som før.
- **Sønn** (`renderPoengPage`): legger en seksjon nederst:
  `<div class="sec">📊 Statistikk</div>` + `statContentHtml(...)`, under gull-streaken.
  Periode-state for sønn: gjenbruk `App.statPeriod` (delt med forelder — greit).

### Responsiv bredde
- `routeToView()` toggler `body.statwide` også når `App.role === 'son' &&
  App.sonPage === 'poeng'` (i tillegg til forelder-stat-fanen).
- På sønnens Poeng-side pakkes det **ikke-statistiske** innholdet (saldo, ukesbonus,
  oppmøte-streak, sølv/gull-streak) i en sentrert kolonne `<div class="narrowcol">`
  (`max-width:480px;margin:0 auto`), så det ikke strekkes når `body` går til 1160px
  på laptop. Statistikk-seksjonen ligger utenfor `narrowcol` og bruker full bredde.
- På mobil (<820px) slår `statwide`-media-query aldri inn → alt står i vanlig
  mobilbredde; `narrowcol` er da et no-op inne i 480px-body.

### CSS (`index.html`)
- `.narrowcol{max-width:480px;margin:0 auto}` (påvirker kun når body er bred).
- Ingen endring i eksisterende `.statgrid`/`@media (min-width:820px)`-regler.

---

## 3. Forelder-meny: ikon + kort tekst

### Problem
Forelder har 7 faner presset inn i 480px-kolonnen (Uke, Dag, Timeplan, Quests,
Poeng, Logg, Statistikk) — for trangt.

### Løsning
Kompakte faner med ikon over kort tekst, alt på én linje:

```
📅    📝    🗓    ⭐     💵     📋     📊
Uke   Dag   Plan  Quests Poeng  Logg  Stat
```

- `tabs`-arrayet i `renderParentHome` utvides med ikon + kort etikett per fane.
- `.tabbar .t` restyles: stable ikon + liten etikett, mindre font, mindre padding,
  så 7 faner får plass på 480px. Quests-badge (antall til godkjenning) beholdes.

---

## Testing / verifisering
- Ren logikk: `jsc -m test/run-jsc.js` — alle tester grønne (inkl. 3 nye streak-tester).
- Parse-sjekk: `jsc -m js/app.js` → `ReferenceError: ... document` = OK.
- Manuell: forelder-meny på laptop; sønnens Poeng-side (mobil + laptop) med
  statistikk-seksjon; streak-teller etter en syk-dag med utfylte timer.
- Bump `APP_VERSION` og deploy (branch → PR → merge → Pages-verifisering).

## Utenfor scope (neste runde)
- Ny navigasjonsstruktur for forelder (hvor statistikken bør bo for forelder).
