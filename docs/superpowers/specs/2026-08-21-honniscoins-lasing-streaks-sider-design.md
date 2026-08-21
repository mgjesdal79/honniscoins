# Honniscoins: låsing, sølv/gull-streaks og flere sider – design

**Mål:** Gjøre «lås dagen» (commit) til mekanismen som gjør en dag tellende, legge til
ukesbonus + ekte timer-på-rad-streaks for sølv og gull, og dele sønn-appen inn i flere sider
(Uken / Poeng / Sidequests) som kan utvides.

**Arkitektur:** Alt beregnes fortsatt som rene funksjoner av `state`. Det eneste nye som lagres
er `days[date].locked` (+ `lockedAt`) og `weekLocks[weekStart]` (+ `at`) samt `settings.bonus`
(trappene). Streaks, bonuser og rekorder er avledet – ingen ny merge-risiko.

## Datamodell

```
days[date].locked : bool         // committet av sønn (eller forelder). + lockedAt (ISO) for LWW-merge
weekLocks[weekStart] = { closed: bool, at: ISO, by }   // uka avsluttet (sønn får kun visning)
settings.bonus = {
  attendanceLadder: [{from:1,pts:1},{from:11,pts:2}],   // bronse/oppmøte – utvidbar trapp
  silverTiers:      [{min:15,pts:5},{min:30,pts:10}],
  goldTiers:        [{min:10,pts:10},{min:20,pts:20},{min:30,pts:30}],
}
```

## Regler

### Lås = commit (styrer ALL poenggiving)
- En dags medaljepoeng, bronse-streak, ukesbonus og ekte streaks teller **kun når dagen er låst**.
- Sønn låser dager manuelt (+ «Lås hele uka»). Kan åpne igjen så lenge uka er redigerbar for ham.
- Sønn kan redigere: inneværende uke + forrige uke (til den avsluttes). Eldre uker: kun visning.
- Forelder kan redigere/låse/åpne alt, også gamle uker.
- **Mandag-prompt:** første gang sønn åpner appen i en ny uke og forrige uke ikke er avsluttet,
  spør appen «Ferdig med forrige uke? Lås den». Lås = alle gjenstående dager låses «som de står»
  + uka merkes avsluttet.

### Ukesbonus (over låste dager i uka)
- `sølvtimer = antall sølv + antall gull`, `gulltimer = antall gull`.
- Sølv: ≥15 → +5, ≥30 → +10. Gull: ≥10 → +10, ≥20 → +20, ≥30 → +30. Høyeste trinn per farge.
- Sølv- og gull-bonus **stables** (30 gull ⇒ +30 gull + 10 sølv = +40).

### Ekte streak (timer på rad, kronologisk over låste dager)
- Sølv-streak = timer på rad som er sølv eller gull. Gull-streak = timer på rad som er gull.
- Hull (ulåst fortidsdag) eller blank/bronse/fravær bryter. Syk-dag pauser (bryter ikke).
- Viser **Nå / All-time best / Best denne måneden** for sølv og gull. Pågående merkes «⏳».

### Bronse-streak
- Data-drevet trapp (`attendanceLadder`) så trinnene kan utvides senere uten kodeendring.

## Sider (sønn)
Én pager-komponent (knapperad nederst + sveip, prikker for posisjon):
- **Uken:** ukestrip (alle 5 dager, poengsum + 🔒 på låste), stor aktiv dag, store medaljeknapper
  (fylles ved valg), nedtonet syke-lenke, «Lås dagen».
- **Poeng:** saldo, ukesbonus, bronse-/sølv-/gull-streaks.
- **Sidequests:** placeholder. Side-register gjør det lett å legge til flere sider.

## Migrering
Eksisterende dager (fra før låsing fantes) med medaljer/syk merkes `locked = true` ved innlasting,
så opptjente poeng ikke forsvinner. `settings.bonus` og `weekLocks` fylles med default hvis de mangler.

## Testing
Ren logikk testes via `jsc` (JavaScriptCore, ES-moduler) mot `test/suite.js`, og i nettleser via
`test/tests.html`. Verifisering = alle grønne.
