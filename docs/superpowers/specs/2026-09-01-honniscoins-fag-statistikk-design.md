# Honniscoins – Fag-statistikk (forelder) – design

**Dato:** 2026-09-01
**Status:** Godkjent konsept, klar for implementeringsplan
**Mockup:** `mockups/fag-statistikk.html` (falske data, viser alle fem visninger)

## Formål

Gi **forelderen** innsikt i sønnens egen-vurderte innsats per fag over tid, for å
kunne se (a) hvilke fag han rater seg høyt/lavt i, og (b) mønstre i tid – f.eks.
om innsatsen synker utover dagen, eller om det finnes ett fast «svakt punkt» i uka.

Ren visnings-/analysefunksjon. Endrer ikke poeng, medaljer eller noen annen tilstand.

## Avgrensning (scope)

- **Kun forelder.** Ligger som en forelder-fane; sønnen ser aldri forelder-faner.
- **Fag = timer i timeplanen** (`days[date].subjects[idx]`). Lekse-fag (`homework[].subject`)
  er et eget fritekst-domene og holdes **utenfor** denne funksjonen.
- **Leser bare eksisterende data.** Ingen nye felt i state, ingen migrering, ingen
  fletting-endringer.
- **Ikke mobil-først.** I motsetning til resten av appen designes denne fanen for
  **laptop/nettleser-bredde** (se «Layout»). Den skal degradere akseptabelt på smal
  skjerm, men optimaliseres for bred.

## Datagrunnlag

### Kilde
Alt bygges fra `state.days` (flatt objekt nøklet `'YYYY-MM-DD'`). Hver dag har:
- `subjects: string[]` – frossen fagliste, rekkefølge = timerekkefølge (idx 0 = 1. time).
- `marks: { [idx]: { medal, by, updatedAt } }` – medalje per time-indeks.
- `locked: boolean`, `sick: true?`.

Medaljer: `MEDALS = {NONE:null, ZERO:'0', BRONSE:'bronse', SOLV:'solv', GULL:'gull'}`.

### Innsats-score (medalje → tall)
`gull = 3`, `solv = 2`, `bronse = 1`. Brukes for snitt/heatmap/trend.
(Merk: dette er en **fast innsats-skala for statistikk**, uavhengig av
`settings.medalValues` som styrer poeng. Statistikken handler om vurderingsnivå,
ikke kroneverdi.)

### Databetydnings-regler (låst i dette designet)
1. **Kun låste dager teller.** `days[date].locked !== true` → dagen utelates helt.
   (Lås = commit; ulåste medaljer er foreløpige.)
2. **Kun vurderte timer med medalje teller** – medalje ∈ {`bronse`,`solv`,`gull`}.
   Både `'0'` (fravær) og `null` (ikke vurdert) holdes **utenfor alle visninger**.
   Statistikken handler kun om innsats når han faktisk er til stede.
3. **Fravær måles ikke i denne funksjonen.** Oppmøte/tilstedeværelse er en egen
   dimensjon som eventuelt tas et annet sted senere (se «Bevisste ikke-mål»).
4. **Fag-normalisering:** grupper på `subject.trim()` + `toLowerCase()` som nøkkel,
   men vis den hyppigst forekommende skrivemåten som etikett. (Fagnavn er fritekst
   og kan variere i staving over tid.)
5. **Tomme/blanke fagnavn** (`''` etter trim) utelates.

### Kjerne-funksjon (ren, i `js/logic.js`)
Én avledet funksjon bygger en flat liste med «innsats-records», som alle fem
visningene aggregerer fra:

```
effortRecords(state) -> [{ date, weekday, position, subjectKey, subjectLabel, medal, score }]
```
- Itererer `days`, filtrerer på `locked`, hopper over `sick`-dager.
- `weekday`: ukedag-nøkkel utledet fra dato (`mon`..`fri`; helg finnes normalt ikke).
- `position`: heltall fra `marks`-nøkkel (0-basert; 1. time = 0).
- `score`: kun satt for bronse/solv/gull; `'0'`/`null` gir `score = null`.

Aggregerings-funksjoner (rene, bygger på `effortRecords`), én per visning:
- `statBySubject(state)` → per fag: `{subjectLabel, avg, n}` (n = antall scorede timer),
  pluss totalsnitt (`overallAvg`).
- `statByPosition(state)` → per timenummer: `{position, avg, n}`.
- `statHeatmap(state)` → matrise `[weekday][position] = {avg, n} | null`.
- `statTrend(state)` → per måned (`'YYYY-MM'`): totalsnitt + snitt for et lite,
  konfigurerbart sett fag (default: de to med flest timer). `{month, overall, perSubject}`.
- `statMedalDistribution(state)` → per fag: andeler `{gull, solv, bronse}`,
  normalisert til 1. `'0'` (fravær) og `null` ekskluderes fra nevneren.

Alle funksjoner tar hele `state` og er DOM-/nett-frie → testbare i `test/suite.js`.

## Visninger (UI)

Fem visninger, alle rene SVG generert i JS (vanilla, ingen deps), fargelagt etter
dataviz-paletten (allerede i mockupen). `n` vises der det er plass; lav `n` skjules
ikke, men er synlig så forelderen selv vurderer usikkerhet.

1. **Innsats per fag** – rangerte horisontale stolper, snitt-medalje per fag.
   Grønn ≥ 2,2 / rød < 1,6 / blå ellers. Stiplet totalsnitt-linje. `n` bak hvert fag.
2. **Innsats etter når på dagen** – stolper per timenummer (1.–N. time). Samme
   fargeterskler.
3. **Ukedag × time (heatmap)** – rader = man–fre, kolonner = timenummer, celle
   fargelagt sekvensielt (blå-rampe) etter snitt. Tom celle = ingen time. Tallet i
   cella.
4. **Utvikling over tid** – linjediagram, månedlig snitt: totalt + utvalgte fag,
   direkte-merket ved siste punkt (ingen egen boks nødvendig for ≤ 4 linjer).
5. **Medaljefordeling per fag** – 100 % stablede stolper (gull/sølv/bronse) med
   forklaring. Fravær vises ikke.

### Layout (laptop-orientert)
- Bred container (bredere enn app-ens vanlige mobil-bredde), sentrert.
- Diagrammene i et **responsivt rutenett** (f.eks. to kolonner på bred skjerm),
  ikke én smal kolonne. Heatmap og trend kan gå i full bredde.
- På smal skjerm faller rutenettet til én kolonne (graceful degradation), men det er
  ikke den primære konteksten.
- SVG bruker `viewBox` + `width:100%` så diagrammene skalerer.

### Tidsrom (periode-velger, med i v1)
Standard: **hele historikken**. En enkel periode-velger øverst (Denne måneden /
Siste 90 dager / Alt) filtrerer `effortRecords` på dato før aggregering. Alle fem
visningene respekterer valgt periode. (Visning 4 «utvikling over tid» viser
månedene innenfor valgt periode.)

### Tomtilstand
Hvis ingen låste dager med scorede timer finnes: vis en vennlig «Ingen data ennå –
lås noen dager med medaljer først»-melding i stedet for tomme diagrammer.

## Arkitektur / filer

- `js/logic.js` – nye rene funksjoner: `effortRecords` + de fem `stat*`-funksjonene.
  Konstant `EFFORT_SCORE = {bronse:1, solv:2, gull:3}` her.
- `js/app.js` – ny `renderStatistikkTab()` (SVG-bygging som i mockupen, men fra ekte
  aggregater), registrer fanen i forelder-fane-listen (📊 Statistikk, etter Logg).
  Binding for fane-bytte + periode-velger (holder valgt periode i `App`-state og
  re-rendrer).
- `index.html` – kun CSS for statistikk-layout (bred container + rutenett) + bump
  `APP_VERSION` ved deploy.
- `test/suite.js` – tester for alle `stat*`-funksjonene (låst/ulåst filtrering,
  fravær/null-håndtering, fag-normalisering, posisjon/ukedag-aggregering).
- `mockups/fag-statistikk.html` – referanse for utseende (allerede laget).

## Testing

Følger prosjektets mønster (rene logikk-tester, `jsc -m test/run-jsc.js`). Dekk minst:
- Ulåst dag utelates; låst dag teller.
- `'0'` (fravær) og `null` utenfor ALLE visninger, også medaljefordelingen.
- Fag med ulik staving/mellomrom slås sammen; hyppigste etikett vises.
- Posisjon-aggregering (rett time-indeks) og ukedag-aggregering (rett dag).
- Trend grupperer på riktig `'YYYY-MM'`.
- Periode-velger filtrerer records på dato før aggregering.
- Tomtilstand: ingen data → aggregater tomme uten kræsj.

## Bevisste ikke-mål (YAGNI)

- **Ingen oppmøte-/fraværsmåling her.** Fravær holdes helt utenfor. Tilstedeværelse
  er en egen dimensjon som eventuelt tas et annet sted senere.
- Ingen samkjøring av lekse-fag og timeplan-fag.
- Ingen eksport/PDF, ingen deling.
- Ingen konfigurerbar innsats-skala (fast 1/2/3).
- Ingen sammenligning mot andre / eksterne benchmarks.
- Ingen prediksjon/anbefalinger – bare beskrivende statistikk.
