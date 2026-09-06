# Honniscoins – Shop (design)

**Dato:** 2026-09-06
**Status:** Godkjent design → klar for plan

## Konsept

Shopen erstatter dagens placeholder på sønnens 🛒-side og gir ham et sted å bruke
opptjente Honniscoins på ekte premier. Utseendet er inspirert av V-bucks-butikken i
Fortnite (fargesprakende kort med produktbilde + gul kjøp-knapp), fordi sønnen liker
det utseendet.

Delt ønskeliste: **både forelder og sønn** kan legge til/fjerne varer i hovedshopen.
Sønnens egne varer er «ukjøpbare» til forelder har satt/bekreftet pris (økonomien
styres av forelder). Kjøp går via request → commit, samme mønster som quests/lekser.

### Flyt
1. Forelder eller sønn legger til en vare (bilde, tittel, link, farge, pris).
   - Legger *sønn* til uten bekreftet pris → vare i status `wish` (ingen kjøp-knapp).
   - Legger *forelder* til med pris → status `available`.
2. Forelder setter/bekrefter pris på `wish`-varer → `available`.
3. Sønn trykker «Kjøp» (kun hvis han har råd) → status `requested`; coins **reserveres
   visuelt**; forelder varsles (badge i appen + epost).
4. Forelder bestiller varen i virkeligheten (klikker linken) og trykker
   «Bestilt – trekk coins» → **commit**: en post skrives til den permanente
   `purchases`-kvitteringsboka og coins trekkes permanent; varen forlater shopen.
5. Committede kjøp vises i sønnens **«Kjøpt»**-oversikt + en permanent kjøpshistorikk
   («brukt totalt»). Sønn kan rydde bort kort i visningen uten at beløpet/historikken
   forsvinner.

## Datamodell

To topp-nivå-lister (begge finnes allerede i flette-scaffoldet i `mergeState`).

### `shopItems` – katalogen/ønskelista (redigerbar av begge)
```
{
  id, title, link,
  image,            // base64 PNG (transparent, kvadratisk 400x400), kan mangle
  color,            // valgt fra forhåndsdefinert palett (se under)
  price,            // tall (coins); 0/undefined hvis ikke satt
  priceSet,         // bool – true når forelder har bekreftet pris
  status,           // 'wish' | 'available' | 'requested'
  createdBy,        // 'son' | 'parent'
  createdAt, requestedAt,
  updatedAt, removed
}
```
- `wish`: lagt til av sønn uten bekreftet pris → **ingen kjøp-knapp**.
- `available`: har bekreftet pris → kjøp-knapp aktiv (gatet av råd).
- `requested`: sønn har bedt om kjøp → coins reservert, forelder varslet.

### `purchases` – permanent kvitteringsbok (skrives ved commit, aldri slettet)
```
{
  id, itemId,
  title, image, color, price,   // snapshot så «Kjøpt»-kort kan rendres etter at item er fjernet
  at, by,                       // 'parent' (den som committer)
  hidden,                       // sønn kan skjule kort i «Kjøpt»-visning (teller fortsatt)
  updatedAt
}
```
- **Kilden til «brukt»-beløpet.** Slettes aldri → coins kan ikke «refunderes ved sletting».
- `hidden` er ren visning; skjuler kortet i kort-griden, men beløp/historikk står fast.

### Farge-palett (forhåndsdefinert)
Minst fire gradient-farger (grønn, blå, lilla, oransje) som i V-bucks-mockupen; kan
utvides. Den som legger til varen velger farge. Default = første farge hvis ikke valgt.
Palett-definisjonen ligger som konstant i `app.js` (id → gradient-CSS), `color` lagrer id-en.

### Fletting
Både `shopItems` og `purchases` flettes **LWW per id på `updatedAt`** (som quests/lekser
via `mergeQuestList`-mønsteret) — jeg endrer scaffoldet fra union-by-id, slik at
statusendringer, pris-setting, sletting og `hidden` vinner nyest. Ny generisk hjelper
`mergeById(a,b)` (eller gjenbruk av eksisterende mønster).

### Innstillinger
- `settings.notifyEmail` – forelderens epostadresse for varsling (tom = ingen epost, kun badge).

### Migrering (`migrate`)
- Sørg for at `state.shopItems` og `state.purchases` finnes (default `[]`).
- Ingen dataendring på eksisterende felt.

## Saldo, reservasjon og råd-sperre (rene fn i `logic.js`)

- `shopSpentTotal(state)` = Σ `purchases[].price` (alle, uansett `hidden`).
- `computeBalance` utvides: `… − computeSpent(state) − shopSpentTotal(state)`.
- `reservedTotal(state)` = Σ pris på `shopItems` med `status:'requested'` (teller **ikke**
  i ekte saldo, kun i «tilgjengelig»-tallet).
- `availableBalance(state)` = `computeBalance(state) − reservedTotal(state)`.
- Råd-sperre: kjøp-knapp aktiv kun når `availableBalance ≥ price`. Ren avledet sjekk;
  `requestShopItem` håndhever samme regel (returnerer uendret state hvis ikke råd).

## Livssyklus (rene fn i `logic.js`, alle bumper `updatedAt`, logger `type:'shop'`)

- `addShopItem(state, {title, link, image, color, price, priceSet, by}, ctx)`
  → `available` hvis `priceSet && price>0`, ellers `wish`.
- `setShopPrice(state, {id, price}, ctx)` → setter pris, `priceSet:true`, `wish→available`.
- `updateShopItem(state, {id, patch}, ctx)` → tittel/link/image/color/price.
- `deleteShopItem(state, {id}, ctx)` → `removed:true`-tombstone (begge roller).
- `requestShopItem(state, {id}, ctx)` → gatet (available + råd) → `requested`, `requestedAt`.
- `cancelShopRequest(state, {id}, ctx)` → `requested→available` (sønn eller forelder).
- `commitShopPurchase(state, {id}, ctx)` → push `purchases`-post (snapshot), item `removed:true`.
- `hidePurchase(state, {id, hidden}, ctx)` → setter `hidden` (ren visning, bumper `updatedAt`).

Avledet: `activeShopItems(state)` (!removed), `shopItemsByStatus`, `activePurchases(state)`
(sortert `at` desc), `visiblePurchases(state)` (!hidden).

## UI

### Sønn – Shop-siden (`renderShopPage`, erstatter placeholder)
- Topp: saldo + «Tilgjengelig: X · Y reservert» når noe er reservert.
- **Til salgs**: kort-grid (Variant A – se stil under). Kort: gradient-bilde-område med
  transparent PNG (`object-fit:contain`), tittel, pris-pill, «Kjøp»-knapp (låst/grå med
  «Mangler N 🪙» ved for lite; skjult/umulig ved manglende pris). Trykk kort → detalj med
  produktlink + «Send kjøpsforespørsel».
- **Venter på deg (reservert)**: hans `requested`-varer, «Angre» (`cancelShopRequest`).
- **Mine ønsker (uten pris)**: hans `wish`-varer som venter på pris.
- **Kjøpt**: prunbare kort (`hidePurchase`) + permanent historikk-liste «dato · vare · −pris»
  og «Brukt totalt».
- **＋ Legg til ønske**: bilde-opplasting (resize→square PNG), tittel, link, farge-velger,
  valgfritt prisforslag.

### Forelder – ny Shop-fane (🛒), badge = antall `requested`
Legges sist/høyre-aktig i `App.parentTab` (ny nøkkel `'shop'`).
- **Forespørsler** (kø): bilde, tittel, klikkbar link (for å bestille), pris →
  «Bestilt – trekk coins» (`commitShopPurchase`) / «Avvis» (`cancelShopRequest`).
- **Sett pris**: sønnens `wish`-varer → sett pris (`setShopPrice`).
- **Aktive varer** + **＋ Legg til vare** (bilde, tittel, link, farge, pris).

### Topp-saldo (`brandHtml`)
Uendret – viser alltid ekte saldo «Honniscoins: X 🪙». Reservert/tilgjengelig vises kun
inne i shopen.

### Stil (Variant A – fargesprakende)
- Hvert kort: farge-gradient bak bilde-området, mørk info-del under, gul «Kjøp»-knapp
  (`--gold`). Transparent PNG «flyter» på gradienten.
- Referanse-mockup: `.superpowers/brainstorm/shop-mockup.html` (Variant A). Endelig
  mockup kan flyttes til `mockups/shop.html` under implementering.
- Nye CSS-klasser i `index.html` (f.eks. `.shopgrid`/`.shopcard`/`.shopimg`/`.shopbuy`/
  `.shophist`).

## Bilde-håndtering (klient-side, `app.js`)

- Helper `resizeImageToSquarePng(file) → Promise<dataUrl>`:
  - Tegn bildet på et 400×400 `<canvas>`, **behold transparens** (ingen bakgrunnsfyll).
  - Ikke-kvadratisk kilde → **pad med transparens** (contain, sentrert), ikke beskåret.
  - Eksporter som **PNG** (`canvas.toDataURL('image/png')`).
- Lagres som base64 i `shopItems[].image`. Anbefaling i UI: ≥400×400 kvadratisk PNG med
  transparent bakgrunn.
- Blob-størrelse: PNG > JPEG, men «ikke mange varer samtidig» holder blobben liten.

## Varsling (badge + epost)

- **Badge (primær):** forelder Shop-fane viser antall `requested` (som quests/lekser).
- **Epost (sekundær):** ved `requestShopItem` kaller klienten (app.js/store.js) en ny
  `notify`-action i edge-funksjonen `clever-function` med `{title, link, price}`.
  - Edge-funksjonen sender epost via **Resend** (env `RESEND_API_KEY`, from-adresse env,
    to = `settings.notifyEmail`).
  - Feiler eposten skal det feile **stille** i klienten (badge er uansett primær).
  - Ingen epost sendes hvis `settings.notifyEmail` er tom.
- Edge-funksjonen forblir ellers en generisk blob-store; `notify` er en ren
  side-effekt-action (leser ikke/skriver ikke blobben).

## Testing (`test/suite.js`, kjør med jsc)

Nye tester for alle rene fn: add/set-price/update/delete, request (inkl. råd-sperre +
reservasjon), cancel, commit (skriver purchase + fjerner item + trekker saldo), hidePurchase
(skjuler men teller fortsatt), `shopSpentTotal`/`reservedTotal`/`availableBalance`,
`computeBalance`-integrasjon, og `mergeById` LWW for shopItems/purchases (statusendring +
sletting + hidden vinner nyest). Husk `locked:true` på testdager som skal gi poeng.

## Avgrensning (YAGNI – ikke bygget nå)

- Trappetrinn-priser, rabatter/«extra»-badge, kategorier.
- Supabase Storage for bilder (bruker base64-thumbnail).
- SMS-varsling (kun epost + badge).
- Automatisk levering/bekreftelse fra sønn av mottatt vare.

## Deploy

Vanlig branch-flyt (dcg-restriksjoner). Bump `APP_VERSION` i `index.html`.
Edge-funksjon-endring (`notify` + Resend-env) deployes til Supabase separat.
