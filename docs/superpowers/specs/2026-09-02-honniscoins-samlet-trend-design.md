# Samlet «Utvikling over tid» (dag/uke + fag + periode) — design

**Dato:** 2026-09-02
**Status:** Godkjent (variant A), bygget direkte

De to nesten-like kortene «Utvikling over tid» (dag) og «Uke for uke» (uke) slås sammen
til **ett** trend-kort med oppløsnings-toggle, felles fagvelger og en periode-kontroll som
styrer **hele** Stat-siden.

## Valg (variant A — avklart med Martin)
- **Én periode for hele Stat-siden.** Chips: `Siste 30 d` / `Siste 90 d` / `Alle` /
  `Egendefinert`. «Egendefinert» viser to `input[type=date]` (Fra/Til). Perioden driver
  alle seks kortene (som før).
- **Standard = Siste 30 d + Dag.**
- **Oppløsning kun på trend-kortet:** toggle `Dag` / `Uke`.
- **Fagvelger (Totalt / enkeltfag)** gjelder trend-kortet i begge oppløsninger.
- **Lang periode → kun uke:** når valgt periode er **> 60 dager** (`STAT_MAX_DAY_SPAN`),
  tvinges uke-visning og `Dag`-knappen blir dempet/inaktiv med hint «Lang periode → uke-visning».
  For `Alle`/åpen ende måles spennet på faktisk data (første→siste record).

## Logikk (`js/logic.js`, ren + testet)
- `periodBounds(period, todayIso)` — utvidet med `'d30'` (siste 30 dager inkl. i dag);
  `'d90'`/`'month'`/`'all'` uendret.
- `statDailyTotal(records, subjectKey)` — nytt valgfritt `subjectKey` (null/`'__all__'` =
  alle fag), speiler `statWeeklyTotal`. Bakoverkompatibel (ett-args kall = alle fag).

## UI-state (`js/app.js`)
- `statPeriod: 'd30' | 'd90' | 'all' | 'custom'` (default `'d30'`).
- `statFrom` / `statTo` — egendefinert range (`'YYYY-MM-DD'`, default settes til siste 30 d
  første gang «Egendefinert» velges).
- `statGran: 'day' | 'week'` (default `'day'`).
- `statSubject: '__all__' | subjectKey` — erstatter tidligere `statWeekSubject`.
- Helpere: `statBounds(today)` (presets + custom), `periodSpanDays(bounds, recs)`,
  `statTrendControls(...)`. Select-id endret `statWeekSubject` → `statSubject`.

## Kortrekkefølge
Trend-kortet flyttet **først** (hovedvisningen), deretter Innsats per fag / etter tid på
dagen / Ukedag×time / Medaljefordeling. «Uke for uke» som eget kort er fjernet.

## CSS (`index.html`)
- `.statperiod` av-scopet fra `#ptab` (gjelder nå både forelder-Stat og sønn-Poeng).
- Nytt: `.statrange` (dato-inputs), `.stattoolbar`/`.statgranwrap`/`.statgran`(`.on`/`.off`)
  (Dag/Uke-pille), `.statghint`.

## Testing (`test/suite.js`)
- `periodBounds('d30', …)` → 30 dager.
- `statDailyTotal_subjectFilter`: alle fag / kun ett fag / fag uten treff.
- Full suite grønn (256).
