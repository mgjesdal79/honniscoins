# Arkivering av godkjente sidequests — design

**Dato:** 2026-09-02
**Status:** Godkjent design (bygges direkte)

Godkjente sidequests hoper seg opp i det uendelige både på sønnens Sidequests-side og
forelderens Quests-fane. Denne endringen viser kun de **5 nyeste** godkjente og legger
resten i et **månedsfordelt arkiv** bak en «Vis arkiv»-knapp.

## Omfang (avklart)
- **«Ferdigstilt» = kun godkjente** (`status === 'approved'`). «Venter på godkjenning»
  (done) og «Å gjøre» (open) er uendret og alltid fullt synlige.
- Gjelder **både sønn og forelder**.
- Arkivet er **skjult bak en «Vis arkiv (N)»-knapp**, med måneder som underoverskrifter.

## Logikk (`js/logic.js`, ren + testet)
Ny funksjon (ingen migrering — bruker eksisterende felt):
```js
// Deler godkjente quests i «siste N» + månedsgruppert arkiv (nyeste først).
export function questArchiveSplit(state, n = 5) {
  const approved = activeQuests(state)
    .filter((q) => q.status === 'approved')
    .sort((a, b) =>
      (b.approvedAt || b.createdAt || '').localeCompare(a.approvedAt || a.createdAt || ''));
  const recent = approved.slice(0, n);
  const rest = approved.slice(n);
  const byMonth = {};
  for (const q of rest) {
    const month = (q.approvedAt || q.createdAt || '').slice(0, 7) || '0000-00';
    (byMonth[month] = byMonth[month] || []).push(q);
  }
  const months = Object.keys(byMonth)
    .sort((a, b) => b.localeCompare(a))
    .map((month) => ({ month, items: byMonth[month] }));
  return { recent, months, archiveCount: rest.length };
}
```
- `approvedAt` er ISO-tidsstempel (`nowIso()` = `new Date().toISOString()`), så
  `.slice(0, 7)` gir `YYYY-MM`. Fallback til `createdAt` for eldre quests uten approvedAt.

## UI-state (`js/app.js`)
- Ny `App.questArchiveOpen` (default `false`) — ren visningstilstand, ikke persistert.
  Toggles ved klikk på arkiv-knappen → re-render (`routeToView()`).
- Hjelper `monthLabel('2026-08')` → `'August 2026'` (norske månedsnavn).

## Sønn (`renderSidequestsPage`)
- «Godkjent»-seksjonen bruker `questArchiveSplit(s)`:
  - Viser `recent` (≤5) som i dag.
  - Hvis `archiveCount > 0`: knapp **«📦 Vis arkiv (N)»** (→ «Skjul arkiv» når åpen).
    Åpen: hver måned rendres med `.arkmonth`-overskrift (`monthLabel`) + questkortene.

## Forelder (`renderQuestsTab`)
- Dagens «aktive»-liste (`[...open, ...approved]`) splittes:
  - `open` (+ forfalte) vises alltid som nå, med rediger/slett.
  - Godkjente får egen blokk med samme **5 nyeste + «Vis arkiv»**-mønster (rediger/slett
    beholdt på hvert kort).
- «Til godkjenning»-køen (done) er uendret.

## CSS (`index.html`)
- Gjenbruker `.qcard`/`.sec`. Nytt: `.arkbtn` (arkiv-knapp, dempet/ghost) og `.arkmonth`
  (måned-underoverskrift, mindre + dempet).

## Testing (`test/suite.js`)
Nye rene tester for `questArchiveSplit`:
- (a) ≤5 godkjente → `recent` = alle, `months` tomt, `archiveCount` 0.
- (b) >5 godkjente → 5 i `recent`, resten månedsgruppert nyeste-først.
- (c) sortering på `approvedAt` (nyeste først), fallback `createdAt`.
- (d) ingen godkjente → `recent` tomt, `months` tomt, `archiveCount` 0.

Parse-sjekk app.js. Bump `APP_VERSION`. Deploy + Pages-verifisering.
