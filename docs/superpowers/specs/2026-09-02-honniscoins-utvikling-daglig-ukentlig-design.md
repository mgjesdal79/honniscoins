# «Utvikling over tid» → daglig total + ny ukentlig graf — design

**Dato:** 2026-09-02
**Status:** Godkjent design (bygges direkte)

Endrer statistikk-visning 4 og legger til en ny visning rett under. Gjelder både
forelder (Statistikk-fane) og sønn (Poeng-siden), siden begge deler `statContentHtml`.

## Bakgrunn
Innsats-poeng per medalje (uendret): 🥇 gull = 3, 🥈 sølv = 2, 🥉 bronse = 1.
Fravær («0») og null teller ikke (allerede ute av `effortRecords`). Kun låste,
ikke-syke dager inngår.

## 1. «Utvikling over tid» → sum innsats-poeng per dag (punkter)
- Erstatter dagens månedlige snitt-graf.
- Y = **sum av innsats-poeng** for dagen (f.eks. 4 gull + 2 sølv + 1 bronse =
  12+4+1 = **18**). Ett punkt per skoledag.
- Vises som **punkter uten forbindelseslinje** (scatter).
- Respekterer periode-velgeren (Denne måneden / Siste 90 dager / Alt).
- Y-akse dynamisk (0 → pent avrundet maks). X-akse med spredte datoetiketter.

### Logikk (`js/logic.js`)
Ny ren funksjon (erstatter `statTrend`):
```js
export function statDailyTotal(records) {
  const byDate = {};
  for (const r of records || []) byDate[r.date] = (byDate[r.date] || 0) + r.score;
  return Object.keys(byDate).sort().map((date) => ({ date, total: byDate[date] }));
}
```

## 2. Ny visning «Uke for uke» med fag-velger
- Rett under den daglige grafen.
- Y = sum innsats-poeng per **uke** (mandag-startet). Én søyle per uke.
- **Nedtrekksmeny** øverst i kortet: «Totalt» (alle fag) eller ett bestemt fag
  (Norsk, Engelsk, …). Valget styrer hva søylene summerer.
- Fag-alternativene hentes fra `statBySubject(recs).subjects` (samme fag som
  finnes i valgt periode). Standardvalg: «Totalt».
- Respekterer periode-velgeren. Sammenhengende uker fra første til siste uke i
  perioden (uker uten poeng = 0).

### Logikk (`js/logic.js`)
```js
export function statWeeklyTotal(records, subjectKey) {
  const recs = records || [];
  if (!recs.length) return [];
  const all = subjectKey == null || subjectKey === '__all__';
  const sum = {};
  let firstW = null, lastW = null;
  for (const r of recs) {
    const w = weekStartIso(r.date);
    if (firstW === null || w < firstW) firstW = w;
    if (lastW === null || w > lastW) lastW = w;
    if (all || r.subjectKey === subjectKey) sum[w] = (sum[w] || 0) + r.score;
  }
  const out = [];
  let w = firstW;
  for (let i = 0; i < 520 && w <= lastW; i++) {
    out.push({ week: w, total: sum[w] || 0 });
    const d = parseIso(w); d.setDate(d.getDate() + 7); w = isoDate(d);
  }
  return out;
}
```

### State + UI (`js/app.js`)
- Ny `App.statWeekSubject` (default `'__all__'`).
- `statContentHtml`: bytt trend-kortet med to kort:
  - `svgDailyTotal(statDailyTotal(recs))` — «Utvikling over tid» (span2).
  - fag-`<select>` + `svgWeeklyTotal(statWeeklyTotal(recs, App.statWeekSubject))` —
    «Uke for uke» (span2).
- `bindStatChips`: bind `#statWeekSubject`-endring → sett `App.statWeekSubject`,
  `routeToView()`.
- Nye SVG-byggere `svgDailyTotal` (scatter) og `svgWeeklyTotal` (søyler) + hjelper
  `niceMax(v)` for pen y-akse. Fjern `svgTrend`.
- Fjern `statTrend` fra import; legg til `statDailyTotal`, `statWeeklyTotal`.

### CSS (`index.html`)
- `.statsel` (nedtrekk, mørkt tema) + `.statselwrap{margin:2px 0 8px}`.

## Testing
- Erstatt `statTrend_basics` med `statDailyTotal_basics` (inkl. eksempelet 18) og
  `statWeeklyTotal_basics` (totalt + fag-filter + tom).
- Parse-sjekk app.js. Bump `APP_VERSION`. Deploy + Pages-verifisering.
