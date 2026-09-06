# Honniscoins Shop – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bygg en fungerende shop der sønn kan bruke Honniscoins på premier via request→commit, med V-bucks-inspirert utseende, delt ønskeliste, reservasjon, permanent kjøpshistorikk og epost-varsel.

**Architecture:** All forretningslogikk som rene funksjoner i `js/logic.js` (testes DOM-fritt), rendering/binding i `js/app.js`, CSS i `index.html`. To topp-nivå-lister: `shopItems` (mutabel katalog, LWW per id) og `purchases` (uforanderlig kvitteringsbok som driver «brukt»-saldo, LWW per id for `hidden`). Epost sendes via ny `notify`-action i Supabase edge-funksjonen, kalt fra klienten som stille side-effekt.

**Tech Stack:** Vanilla ES-moduler, ingen build. Tester kjøres med `jsc` (JavaScriptCore). Spec: `docs/superpowers/specs/2026-09-06-honniscoins-shop-design.md`.

---

## Referanse: kjør testene

Alltid samme kommando (fra repo-rot):
```
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js
```
Forventet ved suksess: linje som `OK: <N>/<N>` (ingen `FAIL`-linjer). Parse-sjekk app.js:
```
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js
```
Forventet: `ReferenceError: document ...` (= syntaks OK). `SyntaxError` = feil.

Tester legges til som funksjons-entries i `tests`-arrayet i `test/suite.js` (bruk `eq(name, actual, expected)` og `ok(name, cond)`). Mønster for en mutasjonstest:
```js
function shop_example() {
  const ctx = { now: '2026-09-06T10:00:00.000Z', id: 'x1' };
  const s0 = L.defaultState();
  const s1 = L.addShopItem(s0, { title: 'Test', price: 10, priceSet: true, by: 'parent' }, ctx);
  eq('lagt til', s1.shopItems.length, 1);
}
```

---

## Task 1: State-defaults for shop (`shopItems`, `purchases`, `notifyEmail`)

**Files:**
- Modify: `js/logic.js` (`defaultState` ~26-48, `migrate` ~526-587)
- Test: `test/suite.js`

- [ ] **Step 1: Write failing tests**

Legg inn i `tests`-arrayet i `test/suite.js`:
```js
function shop_defaultState_shape() {
  const s = L.defaultState();
  eq('shopItems default []', s.shopItems, []);
  eq('purchases default []', s.purchases, []);
  eq('notifyEmail default null', s.settings.notifyEmail, null);
},
function shop_migrate_fills_defaults() {
  const s = L.migrate({ settings: {}, days: {}, log: [] }, '2026-09-06');
  eq('shopItems fylt', Array.isArray(s.shopItems), true);
  eq('purchases fylt', Array.isArray(s.purchases), true);
},
```

- [ ] **Step 2: Run tests, verify FAIL**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: FAIL på `shopItems default []` (undefined ≠ []).

- [ ] **Step 3: Implement**

I `defaultState()` sin returnerte `settings`-blokk, legg til etter `docendoIcalId`-linja:
```js
      notifyEmail: null,
```
I `defaultState()` sin retur, etter `homework: [],`:
```js
    shopItems: [],
    purchases: [],
```
I `migrate()`, rett før `const stamp = ...`-linja (~573), legg til:
```js
  if (!Array.isArray(s.shopItems)) s.shopItems = [];
  if (!Array.isArray(s.purchases)) s.purchases = [];
  if (s.settings.notifyEmail === undefined) s.settings.notifyEmail = null;
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: alle PASS.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(shop): state-defaults for shopItems/purchases/notifyEmail"
```

---

## Task 2: LWW-fletting av `shopItems` og `purchases`

**Files:**
- Modify: `js/logic.js` (`mergeState` ~1030-1032, ny hjelper `mergeById`)
- Test: `test/suite.js`

- [ ] **Step 1: Write failing tests**
```js
function shop_merge_lww_shopItems() {
  const local = { shopItems: [{ id: 'a', title: 'Gammel', status: 'available', updatedAt: '2026-01-01' }] };
  const remote = { shopItems: [{ id: 'a', title: 'Ny', status: 'requested', updatedAt: '2026-02-01' }] };
  const out = L.mergeState(local, remote);
  eq('nyeste vinner', out.shopItems[0].title, 'Ny');
  eq('status nyeste', out.shopItems[0].status, 'requested');
},
function shop_merge_lww_delete_wins() {
  const local = { shopItems: [{ id: 'a', title: 'X', updatedAt: '2026-02-01', removed: false }] };
  const remote = { shopItems: [{ id: 'a', title: 'X', updatedAt: '2026-03-01', removed: true }] };
  const out = L.mergeState(local, remote);
  eq('sletting nyest vinner', out.shopItems[0].removed, true);
},
function shop_merge_lww_purchases_hidden() {
  const local = { purchases: [{ id: 'p', price: 10, updatedAt: '2026-02-01', hidden: false }] };
  const remote = { purchases: [{ id: 'p', price: 10, updatedAt: '2026-03-01', hidden: true }] };
  const out = L.mergeState(local, remote);
  eq('hidden nyest vinner', out.purchases[0].hidden, true);
},
```

- [ ] **Step 2: Run tests, verify FAIL**

Expected: FAIL — union-by-id beholder «Gammel» (første), så `title` blir `'Gammel'`.

- [ ] **Step 3: Implement**

I `js/logic.js`, ved siden av `mergeQuestList` (~1036), legg til generisk hjelper:
```js
// LWW per id på updatedAt. Poster som kun finnes én side tas med.
function mergeById(a = [], b = []) {
  const map = new Map();
  for (const x of a || []) map.set(x.id, clone(x));
  for (const x of b || []) {
    const cur = map.get(x.id);
    if (!cur || (x.updatedAt || '') > (cur.updatedAt || '')) map.set(x.id, clone(x));
  }
  return [...map.values()];
}
```
Erstatt i `mergeState` blokka (~1029-1032):
```js
  // fremtidige felt flettes allerede (bygges ikke nå):
  for (const key of ['shopItems', 'purchases']) {
    if (local[key] || remote[key]) out[key] = unionById(local[key], remote[key]);
  }
```
med:
```js
  // shop: LWW per id på updatedAt (statusendringer/sletting/hidden vinner nyest)
  for (const key of ['shopItems', 'purchases']) {
    if (local[key] || remote[key]) out[key] = mergeById(local[key], remote[key]);
  }
```

- [ ] **Step 4: Run tests, verify PASS**

Run testene. Expected: alle PASS.

- [ ] **Step 5: Commit**
```bash
git add js/logic.js test/suite.js
git commit -m "feat(shop): LWW-fletting av shopItems og purchases"
```

---

## Task 3: Saldo-funksjoner (`shopSpentTotal`, `reservedTotal`, `availableBalance`) + `computeBalance`

**Files:**
- Modify: `js/logic.js` (ny fn-blokk; `computeBalance` ~67-76)
- Test: `test/suite.js`

- [ ] **Step 1: Write failing tests**
```js
function shop_spent_and_balance() {
  const s = L.defaultState();
  s.purchases = [{ id: 'p1', price: 30, hidden: false }, { id: 'p2', price: 20, hidden: true }];
  eq('shopSpentTotal teller alle', L.shopSpentTotal(s), 50);
},
function shop_reserved_total() {
  const s = L.defaultState();
  s.shopItems = [
    { id: 'a', price: 10, status: 'requested', removed: false },
    { id: 'b', price: 5, status: 'available', removed: false },
    { id: 'c', price: 7, status: 'requested', removed: true },
  ];
  eq('kun requested & !removed', L.reservedTotal(s), 10);
},
function shop_available_balance() {
  const s = L.defaultState();
  s.days = { '2026-09-01': { subjects: ['a'], marks: { 0: { medal: 'gull' } }, locked: true, lockedAt: 't' } };
  s.shopItems = [{ id: 'a', price: 1, status: 'requested', removed: false }];
  const bal = L.computeBalance(s);
  eq('available = balance - reservert', L.availableBalance(s), bal - 1);
},
function shop_computeBalance_subtracts_purchases() {
  const s = L.defaultState();
  s.days = { '2026-09-01': { subjects: ['a'], marks: { 0: { medal: 'gull' } }, locked: true, lockedAt: 't' } };
  const before = L.computeBalance(s);
  s.purchases = [{ id: 'p1', price: 2, hidden: false }];
  eq('kjøp trekkes fra saldo', L.computeBalance(s), before - 2);
},
```

- [ ] **Step 2: Run tests, verify FAIL**

Expected: FAIL — `L.shopSpentTotal is not a function`.

- [ ] **Step 3: Implement**

I `js/logic.js`, rett etter `computeSpent` (~64), legg til:
```js
export function shopSpentTotal(state) {
  return (state.purchases || []).reduce((a, p) => a + (Number(p.price) || 0), 0);
}
export function reservedTotal(state) {
  return (state.shopItems || [])
    .filter((it) => !it.removed && it.status === 'requested')
    .reduce((a, it) => a + (Number(it.price) || 0), 0);
}
```
Endre `computeBalance` (~67-76) til å trekke fra kjøp:
```js
export function computeBalance(state) {
  return (
    computeEarned(state) +
    streakBonusTotal(state) +
    weeklyStreakBonusTotal(state) +
    questPointsTotal(state) +
    homeworkPointsTotal(state) -
    computeSpent(state) -
    shopSpentTotal(state)
  );
}
```
Legg til `availableBalance` rett etter `computeBalance`:
```js
export function availableBalance(state) {
  return computeBalance(state) - reservedTotal(state);
}
```

- [ ] **Step 4: Run tests, verify PASS**

Expected: alle PASS.

- [ ] **Step 5: Commit**
```bash
git add js/logic.js test/suite.js
git commit -m "feat(shop): saldo-funksjoner (spent/reservert/available) + computeBalance"
```

---

## Task 4: Vare-livssyklus del 1 – add / setPrice / update / delete

**Files:**
- Modify: `js/logic.js` (nye fn + intern `findShopIdx`)
- Test: `test/suite.js`

- [ ] **Step 1: Write failing tests**
```js
function shop_addShopItem_son_wish() {
  const ctx = { now: '2026-09-06T10:00:00.000Z', id: 'i1' };
  const s = L.addShopItem(L.defaultState(), { title: 'Drone', link: 'http://x', color: 'blue', by: 'son' }, ctx);
  const it = s.shopItems[0];
  eq('status wish', it.status, 'wish');
  eq('priceSet false', it.priceSet, false);
  eq('createdBy son', it.createdBy, 'son');
  eq('logget', s.log[s.log.length - 1].type, 'shop');
},
function shop_addShopItem_parent_available() {
  const ctx = { now: '2026-09-06T10:00:00.000Z', id: 'i2' };
  const s = L.addShopItem(L.defaultState(), { title: 'Spill', price: 60, priceSet: true, by: 'parent' }, ctx);
  eq('status available', s.shopItems[0].status, 'available');
  eq('pris satt', s.shopItems[0].price, 60);
},
function shop_setShopPrice_activates() {
  const c1 = { now: '2026-09-06T10:00:00.000Z', id: 'i3' };
  let s = L.addShopItem(L.defaultState(), { title: 'Bok', by: 'son' }, c1);
  s = L.setShopPrice(s, { id: 'i3', price: 25 }, { now: '2026-09-06T11:00:00.000Z', id: 'l1' });
  eq('pris satt', s.shopItems[0].price, 25);
  eq('priceSet true', s.shopItems[0].priceSet, true);
  eq('status available', s.shopItems[0].status, 'available');
},
function shop_updateShopItem_patch() {
  const c1 = { now: '2026-09-06T10:00:00.000Z', id: 'i4' };
  let s = L.addShopItem(L.defaultState(), { title: 'Gammel', price: 10, priceSet: true, by: 'parent' }, c1);
  s = L.updateShopItem(s, { id: 'i4', patch: { title: 'Ny', color: 'orange' } }, { now: '2026-09-06T11:00:00.000Z', id: 'l2' });
  eq('tittel oppdatert', s.shopItems[0].title, 'Ny');
  eq('farge oppdatert', s.shopItems[0].color, 'orange');
},
function shop_deleteShopItem_tombstone() {
  const c1 = { now: '2026-09-06T10:00:00.000Z', id: 'i5' };
  let s = L.addShopItem(L.defaultState(), { title: 'X', by: 'son' }, c1);
  s = L.deleteShopItem(s, { id: 'i5', by: 'son' }, { now: '2026-09-06T11:00:00.000Z', id: 'l3' });
  eq('removed true', s.shopItems[0].removed, true);
},
```

- [ ] **Step 2: Run tests, verify FAIL**

Expected: FAIL — `L.addShopItem is not a function`.

- [ ] **Step 3: Implement**

I `js/logic.js`, legg til en ny seksjon (f.eks. rett før `mergeById`-hjelperen eller etter homework-blokka). Bruk `clone` og `s.log.push` som resten av fila:
```js
// --- Shop -----------------------------------------------------------------
// shopItems: 'wish' (sønn, uten pris) -> 'available' (pris satt) -> 'requested'.
// purchases: uforanderlig kvitteringsbok (driver shopSpentTotal). Sletting = removed-tombstone.

function findShopIdx(s, id) {
  return (s.shopItems || []).findIndex((x) => x.id === id);
}

export function addShopItem(state, { title, link = '', image = null, color = null, price = 0, priceSet = false, by = 'parent' }, ctx) {
  const s = clone(state);
  if (!Array.isArray(s.shopItems)) s.shopItems = [];
  const priced = !!priceSet && Number(price) > 0;
  s.shopItems.push({
    id: ctx.id,
    title,
    link: link || '',
    image: image || null,
    color: color || null,
    price: Number(price) || 0,
    priceSet: priced,
    status: priced ? 'available' : 'wish',
    createdBy: by,
    createdAt: ctx.now,
    requestedAt: null,
    updatedAt: ctx.now,
    removed: false,
  });
  s.log.push({ id: ctx.id, at: ctx.now, actor: by, type: 'shop', action: 'add', item: ctx.id, title });
  return s;
}

export function setShopPrice(state, { id, price }, ctx) {
  const s = clone(state);
  const i = findShopIdx(s, id);
  if (i < 0) return s;
  s.shopItems[i].price = Number(price) || 0;
  s.shopItems[i].priceSet = true;
  if (s.shopItems[i].status === 'wish') s.shopItems[i].status = 'available';
  s.shopItems[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor: 'parent', type: 'shop', action: 'price', item: id, title: s.shopItems[i].title });
  return s;
}

export function updateShopItem(state, { id, patch, actor = 'parent' }, ctx) {
  const s = clone(state);
  const i = findShopIdx(s, id);
  if (i < 0) return s;
  const it = s.shopItems[i];
  if ('title' in patch) it.title = patch.title;
  if ('link' in patch) it.link = patch.link || '';
  if ('image' in patch) it.image = patch.image || null;
  if ('color' in patch) it.color = patch.color || null;
  if ('price' in patch) { it.price = Number(patch.price) || 0; it.priceSet = it.price > 0; if (it.priceSet && it.status === 'wish') it.status = 'available'; }
  it.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'shop', action: 'edit', item: id, title: it.title });
  return s;
}

export function deleteShopItem(state, { id, by = 'parent' }, ctx) {
  const s = clone(state);
  const i = findShopIdx(s, id);
  if (i < 0) return s;
  s.shopItems[i].removed = true;
  s.shopItems[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor: by, type: 'shop', action: 'delete', item: id, title: s.shopItems[i].title });
  return s;
}
```

- [ ] **Step 4: Run tests, verify PASS**

Expected: alle PASS.

- [ ] **Step 5: Commit**
```bash
git add js/logic.js test/suite.js
git commit -m "feat(shop): livssyklus add/setPrice/update/delete"
```

---

## Task 5: Vare-livssyklus del 2 – request / cancel / commit / hidePurchase

**Files:**
- Modify: `js/logic.js` (nye fn i Shop-seksjonen)
- Test: `test/suite.js`

- [ ] **Step 1: Write failing tests**
```js
// Hjelper: state med nok saldo (én låst gull-dag = 3 coins).
function shopStateWithCoins() {
  const s = L.defaultState();
  s.days = { '2026-09-01': { subjects: ['a', 'b'], marks: { 0: { medal: 'gull' }, 1: { medal: 'gull' } }, locked: true, lockedAt: 't' } };
  return s; // 6 coins
}
```
```js
function shop_requestShopItem_gated_by_affordability() {
  const c = { now: '2026-09-06T10:00:00.000Z', id: 'i1' };
  let s = L.addShopItem(shopStateWithCoins(), { title: 'Dyr', price: 999, priceSet: true, by: 'parent' }, c);
  const s2 = L.requestShopItem(s, { id: 'i1' }, { now: '2026-09-06T11:00:00.000Z', id: 'r1' });
  eq('ikke råd -> uendret status', s2.shopItems[0].status, 'available');
},
function shop_requestShopItem_ok() {
  const c = { now: '2026-09-06T10:00:00.000Z', id: 'i2' };
  let s = L.addShopItem(shopStateWithCoins(), { title: 'Billig', price: 5, priceSet: true, by: 'parent' }, c);
  s = L.requestShopItem(s, { id: 'i2' }, { now: '2026-09-06T11:00:00.000Z', id: 'r2' });
  eq('status requested', s.shopItems[0].status, 'requested');
  eq('requestedAt satt', !!s.shopItems[0].requestedAt, true);
  eq('reservert', L.reservedTotal(s), 5);
},
function shop_cancelShopRequest() {
  const c = { now: '2026-09-06T10:00:00.000Z', id: 'i3' };
  let s = L.addShopItem(shopStateWithCoins(), { title: 'B', price: 5, priceSet: true, by: 'parent' }, c);
  s = L.requestShopItem(s, { id: 'i3' }, { now: 't2', id: 'r3' });
  s = L.cancelShopRequest(s, { id: 'i3' }, { now: 't3', id: 'r4' });
  eq('tilbake til available', s.shopItems[0].status, 'available');
  eq('ingen reservasjon', L.reservedTotal(s), 0);
},
function shop_commitShopPurchase() {
  const c = { now: '2026-09-06T10:00:00.000Z', id: 'i4' };
  let s = L.addShopItem(shopStateWithCoins(), { title: 'Kjøp', price: 4, priceSet: true, color: 'green', by: 'parent' }, c);
  s = L.requestShopItem(s, { id: 'i4' }, { now: 't2', id: 'r5' });
  const balFør = L.computeBalance(s);
  s = L.commitShopPurchase(s, { id: 'i4' }, { now: 't3', id: 'pu1' });
  eq('item fjernet', s.shopItems[0].removed, true);
  eq('purchase skrevet', s.purchases.length, 1);
  eq('snapshot tittel', s.purchases[0].title, 'Kjøp');
  eq('saldo trukket', L.computeBalance(s), balFør - 4);
  eq('ingen reservasjon igjen', L.reservedTotal(s), 0);
},
function shop_hidePurchase_still_counts() {
  const c = { now: '2026-09-06T10:00:00.000Z', id: 'i5' };
  let s = L.addShopItem(shopStateWithCoins(), { title: 'K', price: 3, priceSet: true, by: 'parent' }, c);
  s = L.requestShopItem(s, { id: 'i5' }, { now: 't2', id: 'r6' });
  s = L.commitShopPurchase(s, { id: 'i5' }, { now: 't3', id: 'pu2' });
  const pid = s.purchases[0].id;
  s = L.hidePurchase(s, { id: pid, hidden: true }, { now: 't4', id: 'l9' });
  eq('hidden true', s.purchases[0].hidden, true);
  eq('teller fortsatt', L.shopSpentTotal(s), 3);
},
```

- [ ] **Step 2: Run tests, verify FAIL**

Expected: FAIL — `L.requestShopItem is not a function`.

- [ ] **Step 3: Implement**

I Shop-seksjonen i `js/logic.js`, legg til (bruker `availableBalance` fra Task 3):
```js
export function requestShopItem(state, { id, actor = 'son' }, ctx) {
  const s = clone(state);
  const i = findShopIdx(s, id);
  if (i < 0) return s;
  const it = s.shopItems[i];
  if (it.status !== 'available' || !it.priceSet) return s;
  if (availableBalance(s) < (Number(it.price) || 0)) return s; // råd-sperre
  it.status = 'requested';
  it.requestedAt = ctx.now;
  it.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'shop', action: 'request', item: id, title: it.title });
  return s;
}

export function cancelShopRequest(state, { id, actor = 'son' }, ctx) {
  const s = clone(state);
  const i = findShopIdx(s, id);
  if (i < 0) return s;
  if (s.shopItems[i].status !== 'requested') return s;
  s.shopItems[i].status = 'available';
  s.shopItems[i].requestedAt = null;
  s.shopItems[i].updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor, type: 'shop', action: 'cancel', item: id, title: s.shopItems[i].title });
  return s;
}

export function commitShopPurchase(state, { id, by = 'parent' }, ctx) {
  const s = clone(state);
  const i = findShopIdx(s, id);
  if (i < 0) return s;
  const it = s.shopItems[i];
  if (it.status !== 'requested') return s;
  if (!Array.isArray(s.purchases)) s.purchases = [];
  s.purchases.push({
    id: ctx.id,
    itemId: it.id,
    title: it.title,
    image: it.image || null,
    color: it.color || null,
    price: Number(it.price) || 0,
    at: ctx.now,
    by,
    hidden: false,
    updatedAt: ctx.now,
  });
  it.removed = true;
  it.status = 'committed';
  it.updatedAt = ctx.now;
  s.log.push({ id: ctx.id, at: ctx.now, actor: by, type: 'shop', action: 'commit', item: id, title: it.title, price: it.price });
  return s;
}

export function hidePurchase(state, { id, hidden = true }, ctx) {
  const s = clone(state);
  const p = (s.purchases || []).find((x) => x.id === id);
  if (!p) return s;
  p.hidden = !!hidden;
  p.updatedAt = ctx.now;
  return s;
}
```

- [ ] **Step 4: Run tests, verify PASS**

Expected: alle PASS.

- [ ] **Step 5: Commit**
```bash
git add js/logic.js test/suite.js
git commit -m "feat(shop): request/cancel/commit/hidePurchase"
```

---

## Task 6: Avledede visnings-hjelpere

**Files:**
- Modify: `js/logic.js` (Shop-seksjonen)
- Test: `test/suite.js`

- [ ] **Step 1: Write failing tests**
```js
function shop_derived_helpers() {
  const s = L.defaultState();
  s.shopItems = [
    { id: 'a', status: 'available', removed: false },
    { id: 'b', status: 'wish', removed: false },
    { id: 'c', status: 'requested', removed: false },
    { id: 'd', status: 'available', removed: true },
  ];
  s.purchases = [
    { id: 'p1', at: '2026-01-01', hidden: false },
    { id: 'p2', at: '2026-03-01', hidden: true },
  ];
  eq('activeShopItems', L.activeShopItems(s).map((x) => x.id), ['a', 'b', 'c']);
  eq('available', L.shopItemsByStatus(s, 'available').map((x) => x.id), ['a']);
  eq('wish', L.shopItemsByStatus(s, 'wish').map((x) => x.id), ['b']);
  eq('requested', L.shopItemsByStatus(s, 'requested').map((x) => x.id), ['c']);
  eq('activePurchases nyest først', L.activePurchases(s).map((x) => x.id), ['p2', 'p1']);
  eq('visiblePurchases skjuler hidden', L.visiblePurchases(s).map((x) => x.id), ['p1']);
},
```

- [ ] **Step 2: Run tests, verify FAIL**

Expected: FAIL — `L.activeShopItems is not a function`.

- [ ] **Step 3: Implement**

I Shop-seksjonen i `js/logic.js`:
```js
export function activeShopItems(state) {
  return (state.shopItems || []).filter((x) => !x.removed);
}
export function shopItemsByStatus(state, status) {
  return activeShopItems(state).filter((x) => x.status === status);
}
export function activePurchases(state) {
  return (state.purchases || []).slice().sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}
export function visiblePurchases(state) {
  return activePurchases(state).filter((p) => !p.hidden);
}
```

- [ ] **Step 4: Run tests, verify PASS**

Expected: alle PASS.

- [ ] **Step 5: Commit**
```bash
git add js/logic.js test/suite.js
git commit -m "feat(shop): avledede visnings-hjelpere"
```

---

## Task 7: Bilde-resize-hjelper (klient-side, `app.js`)

**Files:**
- Modify: `js/app.js` (ny helper nær andre util-fn, f.eks. etter `newId` ~50)

Merk: DOM-avhengig (canvas), testes manuelt i nettleser i Task 12. Parse-sjekk med jsc.

- [ ] **Step 1: Implement helper**

I `js/app.js`, legg til:
```js
// Leser en bildefil, tegner den kvadratisk (contain, transparent padding) på et
// 400x400 canvas og returnerer en base64 PNG-dataURL (beholder transparens).
function resizeImageToSquarePng(file, size = 400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('lesefeil'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('bildefeil'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.min(size / img.width, size / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        ctx.drawImage(img, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
```

Legg også til farge-paletten (nær toppen, etter `SON_PAGES`-blokka ~166):
```js
// Forhåndsdefinerte kort-farger (id -> gradient bak produktbildet).
const SHOP_COLORS = [
  { id: 'green', grad: 'radial-gradient(120% 120% at 50% 0,#39d353,#0f8a2e)' },
  { id: 'blue', grad: 'radial-gradient(120% 120% at 50% 0,#37a6ff,#1660c0)' },
  { id: 'purple', grad: 'radial-gradient(120% 120% at 50% 0,#b06bff,#6a27b8)' },
  { id: 'orange', grad: 'radial-gradient(120% 120% at 50% 0,#ff9f43,#e0621a)' },
];
const shopGrad = (id) => (SHOP_COLORS.find((c) => c.id === id) || SHOP_COLORS[0]).grad;
```

- [ ] **Step 2: Parse-sjekk**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: ... document ...` (syntaks OK). Ikke `SyntaxError`.

- [ ] **Step 3: Commit**
```bash
git add js/app.js
git commit -m "feat(shop): bilde-resize-hjelper + farge-palett"
```

---

## Task 8: CSS for shop-kort (`index.html`)

**Files:**
- Modify: `index.html` (CSS i `<style>`, legg til nederst i regelblokka før `</style>`)

- [ ] **Step 1: Add CSS**

Legg til i `index.html` sin `<style>`:
```css
  /* --- shop --- */
  .shopbal{display:flex;justify-content:space-between;align-items:center;background:linear-gradient(160deg,var(--surface-2),var(--surface));border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;margin-bottom:14px}
  .shopbal .big{font-size:1.4rem;font-weight:800;color:var(--gold)}
  .shopbal .res{font-size:.78rem;color:var(--muted);text-align:right}
  .shopbal .res b{color:var(--gold)}
  .shopgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .shopcard{border-radius:18px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 6px 18px rgba(0,0,0,.45);border:none}
  .shopcard .img{height:118px;display:flex;align-items:center;justify-content:center;position:relative}
  .shopcard .img img{max-width:82%;max-height:82%;object-fit:contain}
  .shopcard .img .ph{font-size:3rem}
  .shopcard .body{background:#0d1f3d;padding:10px;flex:1;display:flex;flex-direction:column;gap:8px}
  .shopcard .ttl{font-weight:800;font-size:.92rem;line-height:1.15}
  .shopcard .price{display:flex;align-items:center;gap:4px;font-weight:800;color:var(--gold);font-size:1rem}
  .shopbuy{margin-top:auto;background:var(--gold);color:#1a1400;border:none;border-radius:10px;padding:9px;font-weight:800;font-size:.9rem;width:100%}
  .shopbuy.lock{background:#26324a;color:#7f93b3}
  .shopreq{display:flex;gap:11px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:10px;margin-bottom:8px}
  .shopreq .th{width:46px;height:46px;border-radius:10px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;overflow:hidden}
  .shopreq .th img{width:100%;height:100%;object-fit:contain}
  .shopreq .info{flex:1;min-width:0}
  .shopreq .info b{font-size:.9rem}
  .shopreq .info .s{font-size:.76rem;color:var(--muted)}
  .shopreq .info .s.res{color:var(--gold);font-weight:700}
  .shophist{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:4px 12px}
  .shophist .hrow{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);font-size:.86rem}
  .shophist .hrow:last-child{border-bottom:none}
  .shophist .hrow .d{color:var(--muted);font-size:.74rem}
  .shophist .hrow .amt{color:var(--gold);font-weight:800}
  .shophist .htot{display:flex;justify-content:space-between;padding:11px 0 6px;font-weight:800}
  .shophist .htot .amt{color:var(--gold)}
  .shopadd{width:100%;background:transparent;border:1px dashed var(--line);color:var(--muted);border-radius:14px;padding:13px;font-weight:700;margin-top:10px}
  .colorpick{display:flex;gap:8px;margin:8px 0}
  .colorpick .sw{width:30px;height:30px;border-radius:9px;border:2px solid transparent;cursor:pointer}
  .colorpick .sw.sel{border-color:#fff}
```

- [ ] **Step 2: Commit**
```bash
git add index.html
git commit -m "feat(shop): CSS for shop-kort (Variant A)"
```

---

## Task 9: Sønnens Shop-side (`renderShopPage` + bindinger)

**Files:**
- Modify: `js/app.js` (`renderShopPage` ~650-659 erstattes; imports fra logic ~1-18)

- [ ] **Step 1: Utvid logic-import**

Øverst i `js/app.js` (import-blokka som slutter ~18), legg til navnene som brukes:
`addShopItem, updateShopItem, deleteShopItem, setShopPrice, requestShopItem, cancelShopRequest, commitShopPurchase, hidePurchase, shopItemsByStatus, activeShopItems, activePurchases, visiblePurchases, shopSpentTotal, reservedTotal, availableBalance`.

- [ ] **Step 2: Erstatt `renderShopPage`**

Erstatt hele `renderShopPage`-funksjonen (~650-659) med:
```js
function renderShopPage(host) {
  const bal = computeBalance(App.state);
  const reserved = reservedTotal(App.state);
  const forSale = shopItemsByStatus(App.state, 'available');
  const requested = shopItemsByStatus(App.state, 'requested');
  const wishes = shopItemsByStatus(App.state, 'wish');
  const purchases = visiblePurchases(App.state);
  const spent = shopSpentTotal(App.state);
  const avail = availableBalance(App.state);

  const cardHtml = (it) => {
    const canBuy = avail >= (it.price || 0);
    const imgInner = it.image ? `<img src="${it.image}" alt="">` : `<span class="ph">🎁</span>`;
    const btn = canBuy
      ? `<button class="shopbuy" data-buy="${it.id}">Kjøp</button>`
      : `<button class="shopbuy lock" disabled>Mangler ${(it.price || 0) - avail} 🪙</button>`;
    return `<div class="shopcard">
      <div class="img" style="background:${shopGrad(it.color)}">${imgInner}</div>
      <div class="body">
        <div class="ttl">${escapeHtml(it.title)}</div>
        <div class="price">🪙 ${it.price || 0}</div>
        ${it.link ? `<a class="link" href="${it.link}" target="_blank" rel="noopener">Se produkt</a>` : ''}
        ${btn}
      </div></div>`;
  };

  const reqHtml = (it) => `<div class="shopreq">
    <div class="th">${it.image ? `<img src="${it.image}" alt="">` : '🎁'}</div>
    <div class="info"><b>${escapeHtml(it.title)}</b><div class="s res">${it.price || 0} 🪙 reservert</div></div>
    <button class="undo" data-cancel="${it.id}">Angre</button></div>`;

  const wishHtml = (it) => `<div class="shopreq">
    <div class="th">${it.image ? `<img src="${it.image}" alt="">` : '🎁'}</div>
    <div class="info"><b>${escapeHtml(it.title)}</b><div class="s">Venter på pris</div></div>
    <button class="undo" data-shopdel="${it.id}">Fjern</button></div>`;

  const histRows = purchases.map((p) =>
    `<div class="hrow"><div><b>${escapeHtml(p.title)}</b><div class="d">${monthLabel ? formatShopDate(p.at) : p.at}</div></div>
     <div style="display:flex;align-items:center;gap:10px"><span class="amt">−${p.price || 0} 🪙</span>
     <button class="link" data-phide="${p.id}">skjul</button></div></div>`
  ).join('');

  host.innerHTML = `
    <div class="shopbal"><div><div class="big">${bal} 🪙</div></div>
      <div class="res">Tilgjengelig: <b>${avail}</b>${reserved ? `<br>${reserved} reservert` : ''}</div></div>

    ${forSale.length ? `<div class="sec">Til salgs</div><div class="shopgrid">${forSale.map(cardHtml).join('')}</div>` : ''}
    ${requested.length ? `<div class="sec">Venter på deg (reservert)</div>${requested.map(reqHtml).join('')}` : ''}
    ${wishes.length ? `<div class="sec">Mine ønsker (uten pris)</div>${wishes.map(wishHtml).join('')}` : ''}

    <div class="sec">Kjøpt · brukt totalt</div>
    <div class="shophist">${histRows || '<div class="hrow"><span class="muted">Ingen kjøp ennå</span></div>'}
      <div class="htot"><div>Brukt totalt</div><div class="amt">${spent} 🪙</div></div></div>

    <button class="shopadd" id="shopAddBtn">＋ Legg til ønske</button>
    <div id="shopAddForm"></div>`;

  bindSonShop(host);
}

// Norsk kort dato for kjøpshistorikk (gjenbruker monthLabel om tilgjengelig).
function formatShopDate(iso) {
  const d = (iso || '').slice(0, 10);
  return d || '';
}
```

- [ ] **Step 3: Legg til bindinger + tilføy-skjema**

Legg til (rett etter `renderShopPage`/`formatShopDate`):
```js
function bindSonShop(host) {
  host.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => {
    App.state = requestShopItem(App.state, { id: b.dataset.buy, actor: 'son' }, { now: nowIso(), id: newId() });
    save(); routeToView();
    notifyPurchaseRequest(b.dataset.buy);
  }));
  host.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => {
    App.state = cancelShopRequest(App.state, { id: b.dataset.cancel, actor: 'son' }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
  host.querySelectorAll('[data-shopdel]').forEach((b) => (b.onclick = () => {
    App.state = deleteShopItem(App.state, { id: b.dataset.shopdel, by: 'son' }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
  host.querySelectorAll('[data-phide]').forEach((b) => (b.onclick = () => {
    App.state = hidePurchase(App.state, { id: b.dataset.phide, hidden: true }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
  const addBtn = document.getElementById('shopAddBtn');
  if (addBtn) addBtn.onclick = () => renderShopAddForm(document.getElementById('shopAddForm'), 'son');
}

// Delt tilføy-skjema (sønn: ønske uten pris; forelder: med pris). role: 'son'|'parent'.
function renderShopAddForm(box, role) {
  if (!box) return;
  let pickedColor = SHOP_COLORS[0].id;
  let pickedImage = null;
  const swatches = SHOP_COLORS.map((c) =>
    `<span class="sw ${c.id === pickedColor ? 'sel' : ''}" data-col="${c.id}" style="background:${c.grad}"></span>`).join('');
  box.innerHTML = `
    <div class="card" style="margin-top:10px">
      <input class="inp wide" id="shopTitle" placeholder="Tittel (f.eks. LEGO-sett)" style="width:100%;margin-bottom:8px">
      <input class="inp wide" id="shopLink" placeholder="Lenke til produkt (valgfri)" style="width:100%;margin-bottom:8px">
      ${role === 'parent' ? `<label>Pris <input class="inp" id="shopPrice" type="number" min="0" placeholder="coins"></label>` : ''}
      <div class="colorpick">${swatches}</div>
      <input type="file" id="shopImg" accept="image/*" style="margin-bottom:8px">
      <div style="display:flex;gap:8px">
        <button class="btn good" id="shopSave">Legg til</button>
        <button class="btn ghost" id="shopCancelAdd">Avbryt</button>
      </div>
    </div>`;
  box.querySelectorAll('.sw').forEach((sw) => (sw.onclick = () => {
    pickedColor = sw.dataset.col;
    box.querySelectorAll('.sw').forEach((x) => x.classList.toggle('sel', x === sw));
  }));
  const fileInput = document.getElementById('shopImg');
  fileInput.onchange = async () => {
    if (fileInput.files && fileInput.files[0]) {
      try { pickedImage = await resizeImageToSquarePng(fileInput.files[0]); } catch { pickedImage = null; }
    }
  };
  document.getElementById('shopCancelAdd').onclick = () => { box.innerHTML = ''; };
  document.getElementById('shopSave').onclick = () => {
    const title = document.getElementById('shopTitle').value.trim();
    if (!title) return;
    const link = document.getElementById('shopLink').value.trim();
    const price = role === 'parent' ? Number(document.getElementById('shopPrice').value) || 0 : 0;
    App.state = addShopItem(App.state, {
      title, link, image: pickedImage, color: pickedColor,
      price, priceSet: role === 'parent' && price > 0, by: role,
    }, { now: nowIso(), id: newId() });
    save(); routeToView();
  };
}
```

Legg til en midlertidig stub for `notifyPurchaseRequest` (erstattes i Task 11) rett etter `bindSonShop`:
```js
function notifyPurchaseRequest(itemId) { /* fylles i Task 11 */ }
```

- [ ] **Step 4: Parse-sjekk + manuell test**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js`
Expected: `ReferenceError: ... document ...` (OK).
Manuelt (localStorage-modus, åpne `index.html`): som sønn → Shop-siden viser saldo, «Legg til ønske» fungerer, ønske dukker opp under «Mine ønsker».

- [ ] **Step 5: Commit**
```bash
git add js/app.js
git commit -m "feat(shop): sønnens shop-side (kort, request, ønsker, historikk)"
```

---

## Task 10: Forelderens Shop-fane (badge + `renderShopTab` + bindinger)

**Files:**
- Modify: `js/app.js` (`renderParentHome` tabs ~730-767)

- [ ] **Step 1: Legg fanen i tab-lista + badge + dispatch**

I `renderParentHome` (~728), rett etter `pendingQuests`-linja, legg til:
```js
  const pendingShop = shopItemsByStatus(App.state, 'requested').length;
```
I `tabs`-arrayet (~730), legg inn en Shop-rad før `['logg', ...]`:
```js
    ['shop', '🛒', 'Shop'],
```
I badge-linja i `.map(...)` (~741), utvid til også å vise shop-badge:
```js
      const badge = (k === 'quests' && pendingQuests) ? `<span class="navbadge">${pendingQuests}</span>`
        : (k === 'shop' && pendingShop) ? `<span class="navbadge">${pendingShop}</span>` : '';
```
I dispatch-blokka (~761-767), legg til:
```js
  if (App.parentTab === 'shop') return renderShopTab(host);
```

- [ ] **Step 2: Implement `renderShopTab`**

Legg til (f.eks. rett etter `renderQuestsTab` eller nær `renderShopPage`):
```js
function renderShopTab(host) {
  const requested = shopItemsByStatus(App.state, 'requested');
  const wishes = shopItemsByStatus(App.state, 'wish');
  const active = activeShopItems(App.state).filter((x) => x.status === 'available');

  const reqCard = (it) => `<div class="card" style="margin-bottom:8px">
    <div style="display:flex;gap:10px;align-items:center">
      <div class="shopreq"><div class="th" style="background:${shopGrad(it.color)}">${it.image ? `<img src="${it.image}" alt="">` : '🎁'}</div></div>
      <div style="flex:1;min-width:0"><b>${escapeHtml(it.title)}</b>
        <div class="muted" style="font-size:.8rem">${it.price || 0} 🪙${it.link ? ` · <a class="link" href="${it.link}" target="_blank" rel="noopener">åpne lenke</a>` : ''}</div></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn good" data-shopcommit="${it.id}">Bestilt – trekk coins</button>
      <button class="btn ghost" data-shopreject="${it.id}">Avvis</button>
    </div></div>`;

  const wishCard = (it) => `<div class="card" style="margin-bottom:8px">
    <b>${escapeHtml(it.title)}</b>${it.link ? ` · <a class="link" href="${it.link}" target="_blank" rel="noopener">lenke</a>` : ''}
    <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
      <input class="inp" type="number" min="0" placeholder="coins" data-priceinput="${it.id}">
      <button class="btn good" data-setprice="${it.id}">Sett pris</button>
      <button class="btn ghost" data-shopdelp="${it.id}">Slett</button>
    </div></div>`;

  const activeCard = (it) => `<div class="card" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
    <div><b>${escapeHtml(it.title)}</b> <span class="muted">· ${it.price || 0} 🪙</span></div>
    <button class="link" data-shopdelp="${it.id}">slett</button></div>`;

  host.innerHTML = `
    ${requested.length ? `<div class="sec">Forespørsler</div>${requested.map(reqCard).join('')}` : '<div class="muted" style="margin:10px 2px">Ingen forespørsler.</div>'}
    ${wishes.length ? `<div class="sec">Sett pris (sønnens ønsker)</div>${wishes.map(wishCard).join('')}` : ''}
    <div class="sec">Aktive varer</div>${active.length ? active.map(activeCard).join('') : '<div class="muted" style="margin-bottom:8px">Ingen aktive varer.</div>'}
    <button class="shopadd" id="shopAddBtnP">＋ Legg til vare</button>
    <div id="shopAddFormP"></div>`;

  host.querySelectorAll('[data-shopcommit]').forEach((b) => (b.onclick = () => {
    App.state = commitShopPurchase(App.state, { id: b.dataset.shopcommit, by: 'parent' }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
  host.querySelectorAll('[data-shopreject]').forEach((b) => (b.onclick = () => {
    App.state = cancelShopRequest(App.state, { id: b.dataset.shopreject, actor: 'parent' }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
  host.querySelectorAll('[data-setprice]').forEach((b) => (b.onclick = () => {
    const inp = host.querySelector(`[data-priceinput="${b.dataset.setprice}"]`);
    const price = Number(inp && inp.value) || 0;
    if (price <= 0) return;
    App.state = setShopPrice(App.state, { id: b.dataset.setprice, price }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
  host.querySelectorAll('[data-shopdelp]').forEach((b) => (b.onclick = () => {
    App.state = deleteShopItem(App.state, { id: b.dataset.shopdelp, by: 'parent' }, { now: nowIso(), id: newId() });
    save(); routeToView();
  }));
  const addBtn = document.getElementById('shopAddBtnP');
  if (addBtn) addBtn.onclick = () => renderShopAddForm(document.getElementById('shopAddFormP'), 'parent');
}
```

- [ ] **Step 3: Parse-sjekk + manuell test**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js` → OK.
Manuelt: forelder → ny 🛒-fane. Legg til vare med pris → dukker opp som sønnens «Til salgs». Sønn kjøper → badge på forelderens Shop-fane → «Bestilt – trekk coins» → saldo trukket, vare i sønnens «Kjøpt».

- [ ] **Step 4: Commit**
```bash
git add js/app.js
git commit -m "feat(shop): forelderens shop-fane (forespørsler, sett pris, aktive varer)"
```

---

## Task 11: Epost-varsling (`notify`-action)

**Files:**
- Modify: `js/store.js` (ny `notifyRequest`), `js/app.js` (`notifyPurchaseRequest`-stub fra Task 9)
- Modify: Supabase edge-funksjon `clever-function` (utenfor repo — dokumenteres her)

- [ ] **Step 1: Klient – `notifyRequest` i store.js**

I `js/store.js`, legg til:
```js
// Stille varsling ved kjøpsforespørsel. Feiler lydløst (badge er primær kanal).
export async function notifyRequest(room, payload) {
  if (!EDGE()) return false;
  try {
    const r = await fetch(EDGE(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room, action: 'notify', ...payload }),
    });
    return (await r.json()).ok === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Klient – fyll `notifyPurchaseRequest` i app.js**

Sjekk import fra `./store.js` øverst i `app.js` og legg til `notifyRequest`. Erstatt stubben fra Task 9 med:
```js
function notifyPurchaseRequest(itemId) {
  const it = (App.state.shopItems || []).find((x) => x.id === itemId);
  const email = App.state.settings && App.state.settings.notifyEmail;
  if (!it || !email) return;
  notifyRequest(getRoom(), { to: email, title: it.title, link: it.link || '', price: it.price || 0 });
}
```
Sjekk at `getRoom` er importert fra `./store.js` (legg til om nødvendig).

- [ ] **Step 3: Innstilling for epost i Settings-fanen**

I `renderPoengTab` (Settings-fanen), legg til et felt for `settings.notifyEmail`. Finn et passende sted og legg inn:
```js
    <div class="sec">Varsling</div>
    <label>Epost for shop-varsler
      <input class="inp wide" id="notifyEmail" type="email" style="width:100%"
        value="${escapeHtml(App.state.settings.notifyEmail || '')}" placeholder="din@epost.no"></label>
```
og binding (nær de andre settings-bindingene i samme funksjon):
```js
  const emailInp = document.getElementById('notifyEmail');
  if (emailInp) emailInp.onchange = () => {
    App.state.settings.notifyEmail = emailInp.value.trim() || null;
    App.state.settings.updatedAt = nowIso();
    save();
  };
```

- [ ] **Step 4: Edge-funksjon – `notify`-action (Supabase, utenfor repo)**

I `clever-function` (Deno), legg til håndtering av `action === 'notify'` som sender epost via Resend. Deploy separat:
```ts
if (body.action === 'notify') {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key || !body.to) return new Response(JSON.stringify({ ok: false }), { headers });
  const html = `Ny kjøpsforespørsel: <b>${body.title}</b> (${body.price} coins).` +
    (body.link ? ` <a href="${body.link}">${body.link}</a>` : '');
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('NOTIFY_FROM') || 'Honniscoins <onboarding@resend.dev>',
      to: body.to, subject: `Honniscoins: ${body.title}`, html,
    }),
  });
  return new Response(JSON.stringify({ ok: true }), { headers });
}
```
Sett env i Supabase: `RESEND_API_KEY`, evt. `NOTIFY_FROM`.

- [ ] **Step 5: Parse-sjekk + manuell test**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js` → OK.
Manuelt: sett epost i Settings; sønn sender forespørsel → epost mottas (krever deployet edge-funksjon + Resend-nøkkel). Uten nøkkel/epost: ingen feil i UI.

- [ ] **Step 6: Commit**
```bash
git add js/app.js js/store.js
git commit -m "feat(shop): epost-varsel ved kjøpsforespørsel + notifyEmail-innstilling"
```

---

## Task 12: APP_VERSION-bump + full verifisering

**Files:**
- Modify: `index.html` (`APP_VERSION` ~254)

- [ ] **Step 1: Kjør full testsuite**

Run: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
Expected: alle PASS (333 gamle + nye shop-tester).

- [ ] **Step 2: Bump APP_VERSION**

I `index.html` (~254), oppdater strengen, f.eks.:
```js
    window.APP_VERSION = '2026.09.06 (b41 · shop: kjøp med coins, request/commit, epost-varsel)';
```

- [ ] **Step 3: Manuell ende-til-ende (localStorage-modus)**

Åpne `index.html`. Sjekk:
- Forelder legger til vare (bilde, farge, pris) → synlig for sønn i «Til salgs».
- Sønn med for lite coins → knapp «Mangler N 🪙» (låst).
- Sønn med nok → «Kjøp» → «Venter på deg (reservert)», tilgjengelig-tallet synker, ekte saldo uendret.
- Forelder Shop-fane badge → «Bestilt – trekk coins» → ekte saldo synker, vare i sønnens «Kjøpt» + «Brukt totalt».
- Sønn «skjul» i Kjøpt → kort borte, «Brukt totalt» uendret.
- Sønn legger til ønske uten pris → forelder «Sett pris» → blir kjøpbart.
- «Avvis» på forespørsel → tilbake til «Til salgs».

- [ ] **Step 4: Commit + PR**
```bash
git add index.html
git commit -m "chore(shop): bump APP_VERSION"
git push -u origin feat/shop-design
```
Deretter (egne kall):
```bash
gh pr create --base main --title "Shop: kjøp med Honniscoins (request/commit, epost-varsel)" --body "Implementerer shop iht. spec 2026-09-06. V-bucks-inspirert, delt ønskeliste, reservasjon, permanent kjøpshistorikk, epost-varsel."
```
Etter grønn CI/manuell review:
```bash
gh pr merge feat/shop-design --merge --delete-branch
git switch main && git pull --ff-only
```

- [ ] **Step 5: Verifiser deploy (GitHub Pages, ~1-2 min latens)**

Åpne live-URL med cache-buster på `index.html`, `js/app.js`, `js/logic.js` (`?cb=<tall>`). Sjekk APP_VERSION + at shop virker.

Merk: Supabase edge-funksjon (`notify`) deployes separat (Task 11 steg 4) for at epost skal virke i produksjon.

---

## Self-review (utført under skriving)

- **Spec-dekning:** datamodell (Task 1), LWW-fletting (Task 2), saldo/reservasjon/råd (Task 3), livssyklus (Task 4-5), avledede hjelpere (Task 6), bilde-resize (Task 7), CSS (Task 8), sønn-UI (Task 9), forelder-UI + badge (Task 10), varsling + notifyEmail (Task 11), APP_VERSION + verifisering (Task 12). Alle spec-seksjoner dekket.
- **Type-konsistens:** funksjonsnavn og felt (`priceSet`, `status`, `requestedAt`, `hidden`, `itemId`) er identiske på tvers av tasks. `shopGrad`/`SHOP_COLORS` definert i Task 7 før bruk i Task 9-10. `notifyPurchaseRequest` stubbes i Task 9, fylles i Task 11.
- **YAGNI:** ingen tiers/kategorier/SMS/Storage.
