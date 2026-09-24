# Honniscoins – «Banken»: sparekonto (rente) + fond (simulert indeks)

**Dato:** 2026-09-24
**Status:** Design godkjent, klar for plan

## Formål

La sønnen sette opptjente coins «i arbeid» og lære forskjellen på **trygg sparing** og
**investering**. To produkter han fritt kan putte coins inn i og ta ut av:

- **Sparekonto** — garantert, lineær rente. Kjedelig, men trygt.
- **Fond** — følger en simulert kursindeks som svinger opp og ned. Spennende, men med
  «papirtap» av gevinst. Aldri under innskudd.

Kjerne-lærdom: papirgevinst er ikke ekte før du selger; grådighet straffes ved at gevinst kan
forsvinne; trygg sparing vokser sakte men sikkert.

## Avklarte designvalg (fra brainstorming)

1. **To produkter, sønnen velger** — sparekonto (rente) + fond (indeks).
2. **Simulert kurve**, ikke ekte indeks — deterministisk, full kontroll på rails, ingen
   nett-avhengighet.
3. **Fond-nedside = «kan tape gevinst, ikke innskudd»** — vist verdi har gulv på innskudd;
   fullt uttak gir minst innskuddet tilbake.
4. **Fritt inn/ut for begge, vekst over tid** — ingen hard bindingstid. «Nedsiden» er at
   coins i banken ikke kan brukes i shop, og at fondsgevinst kan forsvinne igjen.
5. **Fondskurs: daglig, små svingninger** — maks ±3 % per dag (rails), svak positiv drift.
6. **Egen Bank-plass, men ryddig bunn-nav** → «Penger»-hub (se UI).
7. **Sparerente: 2 %/uke lineært (default), forelder-justerbar.** Fond-parametre er faste.

## Arkitektur: alt utledes fra en append-only bank-bok (ledger-fold)

Følger appens etablerte mønster (rene fn i `logic.js`, append-only + union-fletting som
`log`/`payouts`). **Én append-only bok er sannheten; all verdi/beholdning regnes ut som rene
funksjoner over boka + dagens dato.** Ingen lagret saldo eller kursserie → determinisme og
konfliktfri sync.

### Datamodell (nytt topp-nivå)

```
bank: {
  ledger: [
    { id, product, type, amount, date, rate?, at, by }
  ]
}
```

- `product ∈ {'savings','fund'}`
- `type ∈ {'deposit','withdraw'}`
- `amount` — coins flyttet (positivt heltall)
- `date` — `'YYYY-MM-DD'` hendelsen gjelder (styrer rente-/kurs-beregning; = i dag ved
  handling)
- `rate` — **kun på `savings`-`deposit`**: ukesrenten som gjaldt da, stemplet inn
  (forward-only; endrer forelder renten senere påvirker ikke gamle innskudd)
- `at` — ISO-tidsstempel (fletting/sortering), `by ∈ {'son','parent'}`
- `id` — unik; **flettes union-by-id** (som `log`/`payouts`) → aldri konflikt

Boka er liten (få innskudd/uttak) → folding ved render er billig; kan memoiseres senere hvis
nødvendig.

### Fondskurs: `navForDate(iso)` (ren, deterministisk)

- Fast **epoke-dato** og fast **seed** (kode-konstanter). NAV(epoke) = 100.
- For hver dag `d` etter epoken: `r(d) = DRIFT + VOL · støy(d)`, **klippet til ±0,03**
  (`FUND_DAILY_CAP`). `støy(d) ∈ [-1,1]` = deterministisk hash av `seed + d`.
- `navForDate(iso)` = `100 × Π (1 + r(d))` for d fra epoke til iso.
- **Foreslåtte konstanter:** `FUND_DRIFT = 0.0035` (~+0,35 %/dag ≈ +2,5 %/uke forventet),
  `FUND_VOL` satt så typiske dager havner godt innenfor ±3 %, `FUND_DAILY_CAP = 0.03`.
  Justeres i kode ved behov; **aldri forelder-styrt** (ville endret fortiden retroaktivt).
- **Rails-garanti:** siden en holdning = `units × nav`, og NAV beveger seg ≤3 %/dag, kan
  ingen holdning hoppe mer enn ~3 % på én dag.
- Fold/beregning må aldri lime rå tallrekker i fil (pipelock/SSN — se Konvensjoner); ikke et
  problem her siden serien beregnes, ikke hardkodes.

### Produkt 1: Sparekonto (lineær rente)

Folde `savings`-hendelser kronologisk (etter `date`, så `at`) til en liste **lotter**
`{amount, date, rate}`:

- `deposit` → push lott.
- `withdraw W` → trekk fra lottene (eldste først): for hver lott, ta
  `min(W_igjen, lottVerdi(lott, hendelsesdato))`; reduser lotten proporsjonalt
  (`amount *= (1 − tatt/lottVerdi)`), behold `date`/`rate` så resten fortsetter å tjene rente.
- `lottVerdi(lott, iso)` = `amount × (1 + rate × uker(lott.date → iso))`
  (lineær/enkel rente, `rate` = ukesrente, `uker` = dager/7).
- `savingsValue(state, today)` = Σ `lottVerdi(lott, today)` over gjenværende lotter.
- `savingsPrincipal` = Σ gjenværende `amount` (til visning «innskutt»).

Withdrawals foldes med **hendelsens** dato (deterministisk uansett når det beregnes).

### Produkt 2: Fond (units + gulv)

Folde `fund`-hendelser kronologisk til `{units, principal}`:

- `deposit C` (dato d) → `units += C / navForDate(d)`; `principal += C`.
- `withdraw W` (dato d) → mot **gulvet vist verdi** `V = max(units × navForDate(d), principal)`;
  fraksjon `f = W / V`; `units *= (1−f)`; `principal *= (1−f)`. (Fullt uttak: `f=1` →
  utbetaling `V ≥ principal`, beholdning nullstilles.)
- `fundMarketValue(state, today)` = `units × navForDate(today)`.
- `fundValue(state, today)` = `max(fundMarketValue, principal)` ← **gulv**; sønnen ser aldri
  under innskudd, kun papirtap *av gevinst*.
- Gating på uttak: `W ≤ fundValue(today)`.

### Saldo-integrasjon (utvider `computeBalance`)

- `netInBank(state)` = Σ `deposit.amount` − Σ `withdraw.amount` (faktiske coins, begge
  produkter). Positiv = netto parkert; negativ = realisert gevinst tilbake i sirkulasjon.
- **`spendable(state, today)`** = `computeBalance(state) − reservedTotal(state) − netInBank(state)`
  ← det shop/utbetaling bruker; coins i banken (og reservert) kan ikke brukes.
- **`bankValue(state, today)`** = `savingsValue + fundValue`.
- **`totalWealth(state, today)`** = `spendable + bankValue`.
  - Vekst/gevinst øker `bankValue` → øker `totalWealth`.
  - Uttak av gevinst gjør `netInBank` negativ → coins tilbake i `spendable`. Ingen coins
    «mintes» utenfor boka; regnestykket balanserer alltid.
- **Gating:** innskudd `≤ spendable`; `depositBank`/`withdrawBank` håndhever samme regel
  (returnerer uendret state hvis ikke råd / ugyldig beløp), som `requestShopItem`.

> Merk (bevisst, akseptert): med gulv + fritt uttak kan sønnen ikke tape på fondet. Fondet
> «vinner» derfor nesten alltid over sparekonto på sikt. Greit for en barne-app: fondet er
> det spennende/volatile, sparekonto er trygt og **garantert**. Lærdommen ligger i
> svingningene, ikke i faktisk tap av innskudd.

### Livssyklus (rene fn i `logic.js`)

- `depositBank(state, {product, amount, by}, ctx)` — validerer `amount>0` og `≤ spendable`;
  for `savings` stempler gjeldende `settings.bank.savingsWeeklyRate` som `rate`; pusher
  ledger-`deposit`; logger `type:'bank'`.
- `withdrawBank(state, {product, amount, by}, ctx)` — validerer mot produktverdi; pusher
  ledger-`withdraw`; logger `type:'bank'`.
- Avledet (alle rene, dato-parametrisert): `navForDate`, `foldSavings`, `foldFund`,
  `savingsValue`, `savingsPrincipal`, `fundMarketValue`, `fundValue`, `netInBank`,
  `bankValue`, `spendable`, `totalWealth`.
- Ingen sletting/tombstones nødvendig (append-only; uttak er egne hendelser).

### Innstillinger

- `settings.bank.savingsWeeklyRate` — default `0.02` (2 %/uke). Forelder-justerbar; stemples
  per innskudd (forward-only).
- Fond-parametre er kode-konstanter (ikke i settings).

### Migrering (`migrate`)

- Legg til `bank: {ledger: []}` hvis mangler.
- Legg til `settings.bank = {savingsWeeklyRate: 0.02}` hvis mangler.
- Ingen data å konvertere (ny funksjon). Eksisterende rom får tom bank → `netInBank=0`,
  `spendable=computeBalance−reservedTotal` som før.

### Fletting

- `bank.ledger` flettes **union-by-id** (gjenbruk `mergeById`/samme mønster som `log`/
  `payouts`). Append-only → ingen LWW-konflikter. `settings.bank` følger settings-LWW.

## UI

### Bunn-nav: «Penger»-hub (5 ikoner beholdt)

Slå sammen dagens **Poeng 💵** og nye **Bank 🏦** til én fane **Penger 💰** med under-faner
øverst på siden — samme under-fane-mønster som forelder-visningen alt bruker.

```
📅 Uken   💰 Penger   ⭐ Oppdrag   🔁 Rutiner   🛒 Shop
              └─ [ Oversikt | Bank ]
```

- `SON_PAGES` beholder 5 sider; «poeng»-siden får intern under-fane-tilstand
  `App.sonMoneyTab ∈ {oversikt, bank}` (ren visning, ikke persistert).
- **Oversikt** = dagens Poeng-side uendret (saldo, utbetalinger, statistikk).
- **Bank** = ny visning (under).

### Bank-visning (sønn)

- **Topp – formue:** «Formue: X 💰», delt i **Ledig** (`spendable`) / **I banken**
  (`bankValue`).
- **Kort 1 – 🏦 Sparekonto:** innskutt, opptjent rente, samlet verdi «X 💰 (+Y i rente)»;
  knapper **Sett inn** / **Ta ut**; tekst «Trygt — vokser garantert».
- **Kort 2 – 📈 Fond:** dagens verdi, endring i dag (grønn/rød pil + %), liten **sparkline**
  (gjenbruk `svg`-hjelpere fra Stat), knapper **Sett inn** / **Ta ut**; tekst «Svinger —
  aldri under det du satte inn».
- **Inn/ut-dialog:** beløp via `stepperHtml`/felt, gated på **Ledig** (inn) / produktverdi
  (ut); bekreft. Feil (for lite / ugyldig) vises inline.

### Forelder

- I **Penger/Settings-fanen**: felt for **sparerente** (% per uke) via stepper/felt +
  liten read-only oversikt over hva sønnen har i banken (sparekonto-verdi, fond-verdi,
  total). Fond-parametre vises ikke (faste).

### Logg

- `renderLoggTab` får en `type:'bank'`-gren: «💰 Satte inn/ut X i sparekonto/fond».

## Testing

- Rene fn i `test/suite.js` (`runTests()`, jsc): `navForDate` determinisme + ±3 %-cap;
  sparekonto lineær rente + partielt uttak (eldste-først, rente fortsetter); fond
  units/gulv/uttak (fullt uttak ≥ innskudd, papirtap av gevinst men aldri under innskudd);
  `netInBank`/`spendable`/`totalWealth`-balanse gjennom innskudd→vekst→uttak;
  gating (innskudd > spendable = no-op); union-fletting av `bank.ledger`; migrering.
- Kjør: `jsc -m test/run-jsc.js`; parse-sjekk `jsc -m js/app.js`.

## Deploy

- Bump `APP_VERSION` i `index.html`.
- Branch + spesifikke filer (dcg blokkerer push til main og `git add -A`), PR → merge.

## Avgrensninger / YAGNI

- **Ingen** hard bindingstid, ingen ekte indeks, ingen reelt tap av innskudd.
- **Ingen** compounding (lineær rente er bevisst valgt).
- Fremtidig (ikke bygget): bindingstid-produkt, flere fond/indekser, «utbytte», ferie-modus.
