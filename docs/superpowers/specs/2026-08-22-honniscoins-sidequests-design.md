# Honniscoins: Sidequests – design

**Mål:** Enkeltoppgaver hjemme. Forelder oppretter (tittel, beskrivelse, poeng, frist).
Sønn committer når ferdig → forelder godkjenner (poeng i potten) eller sender tilbake.

## Datamodell
Ny topp-nivå liste `quests: []`. Hver quest:
```
{
  id, title, desc, points,        // points = ett tall nå (trappetrinn = framtidig `tiers` + valgt trinn)
  due,                            // 'YYYY-MM-DD' eller null
  status,                         // 'open' | 'done' | 'approved'
  createdAt, createdBy,
  doneAt, approvedAt,             // tidsstempler for statusoverganger
  updatedAt,                      // LWW-anker for fletting
  removed                         // tombstone (sletting overlever fletting)
}
```

## Statusflyt
- Forelder oppretter → `open`.
- Sønn «Marker ferdig» → `done` (`doneAt`). Kan angre → `open`.
- Forelder **Godkjenn** → `approved` (`approvedAt`). Poeng teller nå i saldo.
- Forelder **Send tilbake** → `open` (nullstiller `doneAt`).
- **Forfalt** = avledet: `due < i dag` og `status !== 'approved'`. Rødt merke, fortsatt gjørbar.

## Poeng
`questPointsTotal(state)` = sum `points` for quests med `status === 'approved'` (ikke `removed`).
Inngår i `computeBalance`. Ventende (`done`) vises som «venter», teller ikke.

## Fletting
`quests` flettes LWW per id på `updatedAt` (ikke ren union) – statusendringer vinner nyest.
Sletting = `removed:true` + ny `updatedAt` (tombstone), filtreres bort i UI.

## Flater
- **Sønn – Sidequests-side:** seksjoner *Å gjøre* (åpne, med frist/forfalt + «Marker ferdig»),
  *Venter på godkjenning* (done + «Angre»), *Godkjent* (historikk). Bunn-nav badge = antall åpne.
- **Forelder – ny «Quests»-fane:** godkjenningskø øverst (Godkjenn / Send tilbake) med badge,
  opprett-skjema, liste over aktive quests (rediger/slett).

## Testing
Rene quest-funksjoner i `test/suite.js` (jsc): opprett/commit/angre/godkjenn/avvis/rediger/slett,
`questPointsTotal`, saldo-effekt, `isQuestOverdue`, flette-LWW, migrering fyller `quests`.
