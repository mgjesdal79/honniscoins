# Bank/fond: innskudd vs. avkastning + samlet formue-split (b66)

## Bakgrunn
Sønnen ønsker bedre oversikt i bank og fond: å se saldoen delt i **faktisk
innskudd** vs. **avkastning**. Sparekonto-kortet gjør dette allerede («verdi»,
«+X rente», «Innskutt: X»), men **fond-kortet gjør det ikke** — det viser bare
verdi, «% i dag», sparkline og «Markedsverdi». Han vil også ha en **samlet**
historie øverst: hvor mye han har satt inn, og hva det har blitt til.

All nødvendig data finnes allerede i `bank.ledger`-foldingen — dette er **ren
presentasjon**. Ingen datamodell-endring, ingen migrering.

## Scope (det som bygges)
1. **Fond-kortet** får samme innskudd/avkastning-split som sparekontoen.
2. **Samlet formue-split** øverst på bank-siden: «Innskutt X → +Z avkastning»,
   på tvers av spare + fond.

## Ikke i scope (bevisst utelatt)
- Dag-for-dag-tabellen (egne innskudd/avkastning-kolonner) — droppet.
- Omskriving av transaksjons-/bevegelses-lista — finnes allerede, beholdes som er.
- Endringer på sparekonto-kortet (fungerer allerede).

## Avgjørelser (avklart med bruker)
- **Marked under innskudd:** fondets viste verdi har gulv på innskudd
  (`fundValue = max(units×nav, principal)`), så avkastning vist mot denne verdien
  er aldri negativ. Når markedet er under innskudd vises **«+0 avkastning»** —
  samme format alltid, ingen egen beskyttelses-melding. (Den eksisterende
  «Markedsverdi: X»-linja viser fortsatt det rå markedet, så gulvet er synlig der.)
- **Split-omfang:** den samlede «innskutt → avkastning»-linja teller **kun det som
  står i banken** (spare + fond). Ledige coins telles ikke som innskudd (de har
  ingen avkastning).

## Design

### A. Ny ren funksjon (`js/logic.js`)
```js
export function fundPrincipal(state) {
  return foldFund(state).principal;
}
```
Symmetrisk med eksisterende `savingsPrincipal(state)`. Gjør innskuddet i fondet
lesbart uten å eksponere `foldFund`-internals i app.js.

### B. Fond-kortet (`renderBankView` i `js/app.js`)
```
const fPrin = fundPrincipal(s);
const fGain = Math.round(fVal - fPrin);   // ≥ 0 pga. gulvet
```
- Verdilinja: `${rnd(fVal)} 💰  <span class="gain up">+${fGain} avkastning</span>
  <span class="gain up|down">▲|▼ X % i dag</span>` (dagsendring beholdes).
- Muted-linja: `Innskutt: ${rnd(fPrin)} 💰 · Markedsverdi: ${rnd(fMkt)} 💰`
  (slår «Innskutt» sammen med den eksisterende «Markedsverdi» på én linje).

Mockup:
```
📈 Fond        Svinger — aldri under innskudd
240 💰   +40 avkastning   ▲ 1,2 % i dag
[∿∿∿ sparkline ∿∿∿]
📈 +3 % medvind denne uka — sterk innsats!
Innskutt: 200 💰 · Markedsverdi: 240 💰
[ Sett inn ]  [ Ta ut ]
```

### C. Samlet formue-split (`renderBankView`, øverste `.balance`)
```
const bankPrin = Math.round(savingsPrincipal(s) + fundPrincipal(s));
const bankGain = Math.round(bVal - (savingsPrincipal(s) + fundPrincipal(s)));
```
- Beholder: «Formue»-tallet (`totalWealth`) + «Ledig: X · I banken: Y».
- Ny linje under, **kun når `bankPrin > 0`** (unngå «Innskutt 0 → +0» når banken
  er tom): `Innskutt <b>${bankPrin} 💰</b> → <b class="gain up">+${bankGain} avkastning</b> 📈`.

`bVal` er `bankValue` = `savingsValue + fundValue`, og `bankPrin` =
`savingsPrincipal + fundPrincipal`, så `bankGain = rente + fond-gevinst ≥ 0`.

Mockup:
```
        320 💰
        Formue
 Ledig: 80 💰 · I banken: 240 💰
 Innskutt 200 💰 → +40 avkastning 📈
```

### D. Versjon
Bump `APP_VERSION` i `index.html` til `b66` med beskrivende tekst.

## Testing (`test/suite.js`)
- `fundPrincipal`: 0 på tom state; = sum innskudd etter `depositBank(fund)`;
  reduseres proporsjonalt etter `withdrawBank(fund)` (matcher `foldFund.principal`).
- Avkastning aldri negativ: `fundValue − fundPrincipal ≥ 0` også når NAV < innskudd
  (gulv-sjekk).
- Samlet: `bankValue − (savingsPrincipal + fundPrincipal)` ≥ 0 på en state med både
  spare- og fond-innskudd.
- Kjør: `jsc -m test/run-jsc.js` (alle grønne).

## Konsekvenser / notater
- Ren visning — ingen fletting, migrering eller lagret-saldo-endring.
- Mindre asymmetri bevisst beholdt: sparekonto-kortet skjuler «+rente» når < 1,
  mens fond alltid viser «+avkastning» (også 0) jf. avgjørelsen over. Akseptert.
