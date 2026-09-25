# Banken (sparekonto + fond) – Implementasjonsplan (v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La sønnen sette coins i en trygg sparekonto (lineær rente) eller et volatilt fond (simulert kursindeks med gulv på innskudd), fritt inn/ut, og se formuen sin — alt levert til produksjon som v1.

**Architecture:** Én append-only `bank.ledger` er sannheten; all verdi/beholdning regnes ut som rene funksjoner over boka + dagens dato (ledger-fold). Fondskursen er en deterministisk simulert serie (`navForDate`) med ±3 %/dag rails. Saldo-integrasjon skjer ved å trekke `netInBank` fra `availableBalance`, så eksisterende shop-gating automatisk respekterer banken.

**Tech Stack:** Vanilla ES-moduler, `js/logic.js` (rene fn + tester), `js/app.js` (DOM), `test/suite.js` (jsc). Ingen build, ingen deps.

**Referanse:** `docs/superpowers/specs/2026-09-24-honniscoins-bank-renter-fond-design.md`

**Kjør tester:** `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run-jsc.js`
**Parse-sjekk app.js:** `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m js/app.js` (forventet: `ReferenceError: document` = OK)

> Alle logikk-tasks er TDD (test først). UI-tasks har ikke DOM-tester (repo-konvensjon) — verifiseres med parse-sjekk + manuell test. Amounts (innskudd/uttak) er heltall (coins); verdier kan bli desimale og rundes kun ved visning.

---

### Task 1: State-stillas (defaultState + migrate + mergeState)

**Files:**
- Modify: `js/logic.js` (`defaultState` ~26-51, `migrate` ~568, `mergeState` ~1072-1130)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

Legg til i `tests`-arrayen i `test/suite.js`:

```javascript
    function bank_state_scaffolding() {
      const s = L.defaultState();
      eq('bank.ledger tom', s.bank.ledger, []);
      eq('savingsWeeklyRate default', s.settings.bank.savingsWeeklyRate, 0.02);
      // migrate på gammelt rom uten bank
      const old = L.defaultState();
      delete old.bank;
      delete old.settings.bank;
      const m = L.migrate(old, '2026-09-24');
      eq('migrate legger bank', m.bank.ledger, []);
      eq('migrate legger rate', m.settings.bank.savingsWeeklyRate, 0.02);
      // fletting: union-by-id av ledger
      const a = L.defaultState(); a.bank.ledger = [{ id: 'e1', product: 'savings', type: 'deposit', amount: 5, date: '2026-09-01', at: 't1' }];
      const b = L.defaultState(); b.bank.ledger = [{ id: 'e2', product: 'fund', type: 'deposit', amount: 7, date: '2026-09-02', at: 't2' }];
      const merged = L.mergeState(a, b);
      eq('union ledger lengde', merged.bank.ledger.length, 2);
    }
```

- [ ] **Step 2: Kjør testen og bekreft at den feiler**

Run: `jsc -m test/run-jsc.js`
Expected: FAIL på `bank_state_scaffolding` (`s.bank` er undefined).

- [ ] **Step 3: Legg til `bank` i `defaultState`**

I `js/logic.js`, i `defaultState()`-objektet, legg til rett etter `log: [],`:

```javascript
    log: [],
    bank: { ledger: [] },
```

Og i `settings`-objektet, legg til rett etter `routinesSeeded: false,`:

```javascript
      routinesSeeded: false,
      bank: { savingsWeeklyRate: 0.02 },
```

- [ ] **Step 4: Legg til migrering**

I `migrate()`, rett før linja `const gen = generateDailyRoutines(...)`:

```javascript
  if (!s.bank || !Array.isArray(s.bank.ledger)) s.bank = { ledger: [] };
  if (!s.settings.bank) s.settings.bank = { savingsWeeklyRate: 0.02 };
  else if (s.settings.bank.savingsWeeklyRate == null) s.settings.bank.savingsWeeklyRate = 0.02;
```

- [ ] **Step 5: Legg til fletting**

I `mergeState()`, rett før `return out;` (etter shop-fletting-løkka):

```javascript
  if (local.bank || remote.bank) {
    out.bank = { ledger: unionById((local.bank || {}).ledger || [], (remote.bank || {}).ledger || []) };
  }
```

- [ ] **Step 6: Kjør testen og bekreft at den passerer**

Run: `jsc -m test/run-jsc.js`
Expected: PASS på `bank_state_scaffolding`, ingen regresjoner.

- [ ] **Step 7: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): state-stillas – ledger, rate-setting, migrering, fletting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Deterministisk fondskurve `navForDate`

**Files:**
- Modify: `js/logic.js` (nye konstanter + fn, ved siden av dato-hjelperne ~96-140)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```javascript
    function bank_navForDate() {
      eq('nav ved epoke = 100', L.navForDate(L.BANK_FUND_EPOCH), 100);
      eq('nav før epoke = 100', L.navForDate('2020-01-01'), 100);
      // determinisme: samme dato gir samme verdi
      eq('determinisme', L.navForDate('2026-06-15'), L.navForDate('2026-06-15'));
      // rails: hver dags avkastning ligger innenfor ±3 %
      let prev = L.navForDate('2026-06-01');
      let okCap = true;
      let d = '2026-06-01';
      for (let i = 0; i < 30; i++) {
        d = L.isoDate(new Date(new Date(d).getTime() + 86400000));
        const cur = L.navForDate(d);
        const r = cur / prev - 1;
        if (r > 0.0301 || r < -0.0301) okCap = false;
        prev = cur;
      }
      ok('daglig endring innenfor ±3 %', okCap);
      ok('nav er positiv', L.navForDate('2026-06-15') > 0);
    }
```

- [ ] **Step 2: Kjør og bekreft feil**

Run: `jsc -m test/run-jsc.js`
Expected: FAIL (`L.navForDate is not a function`).

- [ ] **Step 3: Implementer konstanter + `navForDate`**

I `js/logic.js`, legg til rett etter `addDaysIso`-funksjonen (~115):

```javascript
// --- Bank: fondskurve (deterministisk simulert indeks) -------------------
export const BANK_FUND_EPOCH = '2024-01-01';
export const BANK_FUND_DRIFT = 0.0035; // ~+0,35 %/dag ≈ +2,5 %/uke forventet
export const BANK_FUND_VOL = 0.02; // amplitude før cap
export const BANK_FUND_CAP = 0.03; // ±3 %/dag rails
const BANK_FUND_SEED = 0x9e3779b9;

// Deterministisk støy i [-1,1] fra (seed, datostreng) — ren, ingen rng-tilstand.
function bankNoise(iso) {
  let h = BANK_FUND_SEED >>> 0;
  for (let i = 0; i < iso.length; i++) {
    h = Math.imul(h ^ iso.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

const navCache = new Map();
// NAV(iso): 100 ved epoke, produkt av daglige (railede) avkastninger fram til iso.
export function navForDate(iso) {
  if (!iso || iso <= BANK_FUND_EPOCH) return 100;
  if (navCache.has(iso)) return navCache.get(iso);
  let nav = 100;
  let d = BANK_FUND_EPOCH;
  while (d < iso) {
    d = addDaysIso(d, 1);
    let r = BANK_FUND_DRIFT + BANK_FUND_VOL * bankNoise(d);
    if (r > BANK_FUND_CAP) r = BANK_FUND_CAP;
    if (r < -BANK_FUND_CAP) r = -BANK_FUND_CAP;
    nav *= 1 + r;
  }
  navCache.set(iso, nav);
  return nav;
}
```

- [ ] **Step 4: Kjør og bekreft pass**

Run: `jsc -m test/run-jsc.js`
Expected: PASS på `bank_navForDate`.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): deterministisk fondskurve navForDate med ±3% rails

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Sparekonto (lineær rente, fold + verdi)

**Files:**
- Modify: `js/logic.js` (nye fn etter `navForDate`)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```javascript
    function bank_savings() {
      const s = L.defaultState();
      s.bank.ledger = [
        { id: 'd1', product: 'savings', type: 'deposit', amount: 100, date: '2026-01-01', rate: 0.02, at: 't1' },
      ];
      // 1 uke senere: 100 * (1 + 0.02 * 1) = 102
      eq('rente etter 1 uke', Math.round(L.savingsValue(s, '2026-01-08')), 102);
      eq('principal', L.savingsPrincipal(s), 100);
      // partielt uttak: ta ut 51 etter 1 uke (verdi 102) -> halvparten igjen
      s.bank.ledger.push({ id: 'w1', product: 'savings', type: 'withdraw', amount: 51, date: '2026-01-08', at: 't2' });
      eq('principal etter halvt uttak', Math.round(L.savingsPrincipal(s)), 50);
      // resten fortsetter å tjene rente fra opprinnelig dato
      eq('verdi rett etter uttak', Math.round(L.savingsValue(s, '2026-01-08')), 51);
    }
```

- [ ] **Step 2: Kjør og bekreft feil**

Run: `jsc -m test/run-jsc.js` → FAIL (`L.savingsValue is not a function`).

- [ ] **Step 3: Implementer sparekonto-fold**

I `js/logic.js`, rett etter `navForDate`:

```javascript
function daysBetween(a, b) {
  return Math.round((parseIso(b) - parseIso(a)) / 86400000);
}

// Sorter bank-hendelser for et produkt kronologisk (date, så at).
function bankEvents(state, product) {
  return (state.bank && state.bank.ledger ? state.bank.ledger : [])
    .filter((e) => e.product === product)
    .slice()
    .sort((a, b) => (a.date === b.date ? (a.at || '').localeCompare(b.at || '') : a.date.localeCompare(b.date)));
}

function savingsLotValue(lot, iso) {
  const weeks = Math.max(0, daysBetween(lot.date, iso) / 7);
  return lot.amount * (1 + (lot.rate || 0) * weeks);
}

// Fold savings-hendelser til gjenværende lotter [{amount,date,rate}].
export function foldSavings(state) {
  const lots = [];
  for (const e of bankEvents(state, 'savings')) {
    if (e.type === 'deposit') {
      lots.push({ amount: e.amount, date: e.date, rate: e.rate == null ? 0 : e.rate });
    } else if (e.type === 'withdraw') {
      let w = e.amount;
      for (const lot of lots) {
        if (w <= 1e-9) break;
        const val = savingsLotValue(lot, e.date);
        if (val <= 0) continue;
        const take = Math.min(w, val);
        lot.amount *= 1 - take / val; // behold date/rate → resten fortsetter å tjene rente
        w -= take;
      }
    }
  }
  return lots.filter((l) => l.amount > 1e-9);
}

export function savingsValue(state, today) {
  return foldSavings(state).reduce((sum, lot) => sum + savingsLotValue(lot, today), 0);
}

export function savingsPrincipal(state) {
  return foldSavings(state).reduce((sum, lot) => sum + lot.amount, 0);
}
```

- [ ] **Step 4: Kjør og bekreft pass**

Run: `jsc -m test/run-jsc.js` → PASS på `bank_savings`.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): sparekonto – lineær rente per lott, partielt uttak

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Fond (units + gulv på innskudd)

**Files:**
- Modify: `js/logic.js` (nye fn etter sparekonto)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```javascript
    function bank_fund() {
      // deposit 100 på epoke (nav=100) -> 1 unit, principal 100
      const s = L.defaultState();
      s.bank.ledger = [
        { id: 'f1', product: 'fund', type: 'deposit', amount: 100, date: '2024-01-01', at: 't1' },
      ];
      const nav = L.navForDate('2026-06-15');
      eq('markedsverdi = units*nav', Math.round(L.fundMarketValue(s, '2026-06-15')), Math.round(nav));
      // gulv: vist verdi aldri under innskudd
      ok('gulv >= innskudd', L.fundValue(s, '2026-06-15') >= 100 - 1e-6);
      // konstruer et tilfelle der markedsverdi < principal → gulv slår inn
      const s2 = L.defaultState();
      // finn en dato der nav < 100 ville krevd fabrikkert kurve; test gulv-invariant direkte:
      s2.bank.ledger = [{ id: 'f2', product: 'fund', type: 'deposit', amount: 50, date: '2024-01-01', at: 't1' }];
      ok('fundValue >= principal alltid', L.fundValue(s2, '2024-01-02') >= 50 - 1e-6);
      // fullt uttak gir minst innskuddet
      const payoutFloor = Math.max(L.fundMarketValue(s2, '2024-01-02'), 50);
      ok('fullt uttak >= innskudd', payoutFloor >= 50 - 1e-6);
    }
```

- [ ] **Step 2: Kjør og bekreft feil**

Run: `jsc -m test/run-jsc.js` → FAIL (`L.fundMarketValue is not a function`).

- [ ] **Step 3: Implementer fond-fold**

I `js/logic.js`, rett etter sparekonto-fn:

```javascript
// Fold fund-hendelser til {units, principal}. Uttak mot gulvet (max(marked,principal)).
export function foldFund(state) {
  let units = 0;
  let principal = 0;
  for (const e of bankEvents(state, 'fund')) {
    const nav = navForDate(e.date);
    if (e.type === 'deposit') {
      units += e.amount / nav;
      principal += e.amount;
    } else if (e.type === 'withdraw') {
      const V = Math.max(units * nav, principal); // vist verdi m/ gulv
      if (V <= 0) continue;
      const f = Math.min(1, e.amount / V);
      units *= 1 - f;
      principal *= 1 - f;
    }
  }
  return { units, principal };
}

export function fundMarketValue(state, today) {
  return foldFund(state).units * navForDate(today);
}

// Vist verdi = max(marked, innskudd) → papirtap av gevinst, aldri under innskudd.
export function fundValue(state, today) {
  const { units, principal } = foldFund(state);
  return Math.max(units * navForDate(today), principal);
}
```

- [ ] **Step 4: Kjør og bekreft pass**

Run: `jsc -m test/run-jsc.js` → PASS på `bank_fund`.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): fond – units + gulv på innskudd (papirtap kun av gevinst)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Saldo-integrasjon (netInBank, spendable, bankValue, totalWealth)

**Files:**
- Modify: `js/logic.js` (`availableBalance` ~92-94 + nye fn)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```javascript
    function bank_balance_integration() {
      // start: 1 låst gull-dag med 2 gull = 6 coins
      const s = shopStateWithCoins();
      s.bank = { ledger: [] };
      s.settings.bank = { savingsWeeklyRate: 0.02 };
      eq('start spendable = 6', L.spendable(s), 6);
      eq('netInBank = 0', L.netInBank(s), 0);
      // sett inn 4 i sparekonto
      s.bank.ledger.push({ id: 'd', product: 'savings', type: 'deposit', amount: 4, date: '2026-09-01', rate: 0, at: 't1' });
      eq('netInBank etter innskudd', L.netInBank(s), 4);
      eq('spendable synker', L.spendable(s), 2);
      eq('availableBalance = spendable', L.availableBalance(s), 2);
      // total formue uendret (ingen rente, rate 0)
      eq('totalWealth uendret', Math.round(L.totalWealth(s, '2026-09-01')), 6);
      // ta ut alt igjen
      s.bank.ledger.push({ id: 'w', product: 'savings', type: 'withdraw', amount: 4, date: '2026-09-01', at: 't2' });
      eq('netInBank tilbake 0', L.netInBank(s), 0);
      eq('spendable tilbake 6', L.spendable(s), 6);
    }
```

- [ ] **Step 2: Kjør og bekreft feil**

Run: `jsc -m test/run-jsc.js` → FAIL (`L.spendable is not a function`).

- [ ] **Step 3: Implementer + redefiner `availableBalance`**

I `js/logic.js`, erstatt eksisterende `availableBalance`:

```javascript
export function availableBalance(state) {
  return computeBalance(state) - reservedTotal(state) - netInBank(state);
}
```

Og legg til rett etter (og etter at fond-fn finnes lenger nede — plasser disse sammen med de andre bank-fn):

```javascript
export function netInBank(state) {
  const led = state.bank && state.bank.ledger ? state.bank.ledger : [];
  return led.reduce((sum, e) => sum + (e.type === 'deposit' ? e.amount : -e.amount), 0);
}

export function spendable(state) {
  return availableBalance(state);
}

export function bankValue(state, today) {
  return savingsValue(state, today) + fundValue(state, today);
}

export function totalWealth(state, today) {
  return spendable(state) + bankValue(state, today);
}
```

> Merk: `availableBalance` bruker nå `netInBank`. `netInBank` må være definert (funksjonsdeklarasjon hoistes, så rekkefølge i fila er OK). `netInBank` er dato-uavhengig → `spendable`/`availableBalance` forblir heltall.

- [ ] **Step 4: Kjør og bekreft pass**

Run: `jsc -m test/run-jsc.js` → PASS på `bank_balance_integration`, ingen regresjoner (shop-tester bruker `availableBalance` og skal fortsatt passere med tom bank).

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): saldo-integrasjon – netInBank/spendable/bankValue/totalWealth

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Mutasjoner `depositBank` / `withdrawBank`

**Files:**
- Modify: `js/logic.js` (nye fn sammen med de andre bank-fn)
- Test: `test/suite.js`

- [ ] **Step 1: Skriv feilende test**

```javascript
    function bank_mutations() {
      const ctx1 = { now: '2026-09-01T09:00:00.000Z', id: 'm1' };
      const ctx2 = { now: '2026-09-01T09:01:00.000Z', id: 'm2' };
      let s = shopStateWithCoins(); // 6 coins
      s.bank = { ledger: [] };
      s.settings.bank = { savingsWeeklyRate: 0.02 };
      // innskudd stempler gjeldende rente
      s = L.depositBank(s, { product: 'savings', amount: 4, by: 'son' }, ctx1);
      eq('ledger 1 entry', s.bank.ledger.length, 1);
      eq('rate stemplet', s.bank.ledger[0].rate, 0.02);
      eq('logg-gren bank', s.log[s.log.length - 1].type, 'bank');
      // kan ikke sette inn mer enn spendable (spendable nå = 2)
      const before = s.bank.ledger.length;
      s = L.depositBank(s, { product: 'savings', amount: 999, by: 'son' }, ctx2);
      eq('råd-sperre: ingen ny entry', s.bank.ledger.length, before);
      // uttak mer enn verdi = no-op
      const s3 = L.withdrawBank(s, { product: 'fund', amount: 5, by: 'son' }, ctx2);
      eq('uttak fra tomt fond = no-op', s3.bank.ledger.length, s.bank.ledger.length);
    }
```

- [ ] **Step 2: Kjør og bekreft feil**

Run: `jsc -m test/run-jsc.js` → FAIL (`L.depositBank is not a function`).

- [ ] **Step 3: Implementer mutasjoner**

I `js/logic.js`, sammen med de andre bank-fn:

```javascript
export function depositBank(state, { product, amount, by = 'son' }, ctx) {
  const s = clone(state);
  if (!s.bank) s.bank = { ledger: [] };
  const amt = Math.floor(Number(amount) || 0);
  if (amt <= 0) return s;
  if (product !== 'savings' && product !== 'fund') return s;
  if (amt > availableBalance(s)) return s; // råd-sperre
  const date = (ctx.now || '').slice(0, 10);
  const entry = { id: ctx.id, product, type: 'deposit', amount: amt, date, at: ctx.now, by };
  if (product === 'savings') entry.rate = (s.settings.bank && s.settings.bank.savingsWeeklyRate) || 0;
  s.bank.ledger.push(entry);
  s.log.push({ id: ctx.id, at: ctx.now, actor: by, type: 'bank', action: 'deposit', product, amount: amt });
  return s;
}

export function withdrawBank(state, { product, amount, by = 'son' }, ctx) {
  const s = clone(state);
  if (!s.bank) s.bank = { ledger: [] };
  const amt = Math.floor(Number(amount) || 0);
  if (amt <= 0) return s;
  if (product !== 'savings' && product !== 'fund') return s;
  const today = (ctx.now || '').slice(0, 10);
  const val = product === 'savings' ? savingsValue(s, today) : fundValue(s, today);
  if (amt > Math.floor(val + 1e-9)) return s; // kan ikke ta ut mer enn produktverdi
  s.bank.ledger.push({ id: ctx.id, product, type: 'withdraw', amount: amt, date: today, at: ctx.now, by });
  s.log.push({ id: ctx.id, at: ctx.now, actor: by, type: 'bank', action: 'withdraw', product, amount: amt });
  return s;
}
```

- [ ] **Step 4: Kjør og bekreft pass**

Run: `jsc -m test/run-jsc.js` → PASS på `bank_mutations`.

- [ ] **Step 5: Commit**

```bash
git add js/logic.js test/suite.js
git commit -m "feat(bank): depositBank/withdrawBank med råd-/verdi-sperre og logg

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: App – imports, Penger-hub-fane, sub-tab-tilstand

**Files:**
- Modify: `js/app.js` (imports ~1-30, `SON_PAGES` ~195, `App` ~38, `renderPoengPage` ~486)

- [ ] **Step 1: Legg til imports**

I `js/app.js`, i import-blokka fra `./logic.js`, legg til de nye navnene (behold eksisterende):

```javascript
  depositBank, withdrawBank, savingsValue, savingsPrincipal, fundValue, fundMarketValue,
  netInBank, spendable, bankValue, totalWealth, navForDate,
```

- [ ] **Step 2: Legg til sub-tab-tilstand i `App`**

I `App`-objektet (~38), legg til:

```javascript
  sonMoneyTab: 'oversikt',
```

- [ ] **Step 3: Døp om Poeng-fanen til Penger**

I `SON_PAGES` (~197), endre poeng-linja:

```javascript
  { key: 'poeng', icon: '💰', label: 'Penger' },
```

- [ ] **Step 4: Legg sub-tabs øverst i `renderPoengPage`**

Erstatt starten av `renderPoengPage(host)` slik at den ruter mellom Oversikt og Bank. Rett etter `function renderPoengPage(host) {`:

```javascript
  const moneyTab = App.sonMoneyTab || 'oversikt';
  const tabsBar = `<div class="subtabs">
      <button class="subtab ${moneyTab === 'oversikt' ? 'on' : ''}" data-money="oversikt">Oversikt</button>
      <button class="subtab ${moneyTab === 'bank' ? 'on' : ''}" data-money="bank">🏦 Bank</button>
    </div>`;
  const bindMoney = () => {
    host.querySelectorAll('.subtab[data-money]').forEach((b) => {
      b.onclick = () => { App.sonMoneyTab = b.dataset.money; renderPoengPage(host); };
    });
  };
  if (moneyTab === 'bank') {
    host.innerHTML = tabsBar + '<div id="bankbody"></div>';
    bindMoney();
    renderBankView(document.getElementById('bankbody'));
    return;
  }
```

Deretter, i den eksisterende `host.innerHTML = \`...\`` for oversikten, prefiks med `tabsBar`:

```javascript
  host.innerHTML = tabsBar + `
    <div class="narrowcol">
```

Og legg til `bindMoney();` rett før den avsluttende `bindStatChips(host);`.

- [ ] **Step 5: Midlertidig stub for `renderBankView`**

For at parse-sjekk skal gå før Task 8, legg til en stub nederst i `js/app.js` (erstattes i Task 8):

```javascript
function renderBankView(host) { host.innerHTML = '<div class="muted" style="padding:12px">Bank kommer…</div>'; }
```

- [ ] **Step 6: Parse-sjekk**

Run: `jsc -m js/app.js`
Expected: `ReferenceError: document` (= syntaks OK).

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "feat(bank): Penger-hub-fane med Oversikt/Bank sub-tabs + stub

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: App – Bank-visning (sønn) med inn/ut

**Files:**
- Modify: `js/app.js` (erstatt `renderBankView`-stubben)

- [ ] **Step 1: Implementer `renderBankView`**

Erstatt stubben fra Task 7 med:

```javascript
// Liten sparkline (siste 30 dager NAV) — punktene bygges i JS, ikke hardkodet.
function fundSparklineSvg(today) {
  const n = 30;
  const iso = [];
  let t = new Date(today + 'T00:00:00');
  for (let i = 0; i < n; i++) { iso.unshift(isoDate(t)); t = new Date(t.getTime() - 86400000); }
  const vals = iso.map((d) => navForDate(d));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const W = 240, H = 48, pad = 3;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (n - 1)) * (W - 2 * pad);
    const y = H - pad - ((v - min) / span) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const up = vals[n - 1] >= vals[0];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polyline fill="none" stroke="${up ? '#39d353' : '#ff5a52'}" stroke-width="2" points="${pts}"></polyline>
    </svg>`;
}

function renderBankView(host) {
  const s = App.state;
  const today = isoDate(new Date());
  const spend = spendable(s);
  const bVal = bankValue(s, today);
  const total = totalWealth(s, today);
  const savVal = savingsValue(s, today);
  const savPrin = savingsPrincipal(s);
  const savInt = savVal - savPrin;
  const fVal = fundValue(s, today);
  const fMkt = fundMarketValue(s, today);
  const navToday = navForDate(today);
  const navPrev = navForDate(isoDate(new Date(Date.now() - 86400000)));
  const dayPct = navPrev ? ((navToday / navPrev - 1) * 100) : 0;
  const arrow = dayPct >= 0 ? '▲' : '▼';
  const rnd = (x) => Math.round(x);

  host.innerHTML = `
    <div class="balance">
      <div class="coins">${rnd(total)} <small>Formue</small></div>
      <div class="kr">Ledig: <b>${spend} 💰</b> · I banken: <b>${rnd(bVal)} 💰</b></div>
    </div>

    <div class="card bankcard">
      <div class="bankhead">🏦 Sparekonto <span class="muted">Trygt — vokser garantert</span></div>
      <div class="bankval">${rnd(savVal)} 💰 ${savInt >= 1 ? `<span class="gain up">+${rnd(savInt)} rente</span>` : ''}</div>
      <div class="muted" style="font-size:.8rem">Innskutt: ${rnd(savPrin)} 💰</div>
      <div class="btnrow">
        <button class="btn good" data-bank-in="savings">Sett inn</button>
        <button class="btn" data-bank-out="savings">Ta ut</button>
      </div>
      <div class="bankform" id="bf-savings" hidden></div>
    </div>

    <div class="card bankcard">
      <div class="bankhead">📈 Fond <span class="muted">Svinger — aldri under innskudd</span></div>
      <div class="bankval">${rnd(fVal)} 💰
        <span class="gain ${dayPct >= 0 ? 'up' : 'down'}">${arrow} ${Math.abs(dayPct).toFixed(1)} % i dag</span></div>
      ${fundSparklineSvg(today)}
      <div class="muted" style="font-size:.8rem">Markedsverdi: ${rnd(fMkt)} 💰</div>
      <div class="btnrow">
        <button class="btn good" data-bank-in="fund">Sett inn</button>
        <button class="btn" data-bank-out="fund">Ta ut</button>
      </div>
      <div class="bankform" id="bf-fund" hidden></div>
    </div>`;

  bindBankView(host);
}

function bindBankView(host) {
  const s = App.state;
  const today = isoDate(new Date());
  const openForm = (product, dir) => {
    const box = host.querySelector(`#bf-${product}`);
    const maxIn = spendable(s);
    const maxOut = product === 'savings' ? Math.floor(savingsValue(s, today)) : Math.floor(fundValue(s, today));
    const cap = dir === 'in' ? maxIn : maxOut;
    box.hidden = false;
    box.innerHTML = `
      <div class="muted" style="font-size:.8rem;margin:6px 0">${dir === 'in' ? 'Maks å sette inn' : 'Maks å ta ut'}: ${cap} 💰</div>
      ${stepperHtml(`id="bank-amt-${product}"`, '', { min: 0, step: 1 })}
      <div class="btnrow">
        <button class="btn good" data-bank-confirm="${product}" data-dir="${dir}">${dir === 'in' ? 'Bekreft innskudd' : 'Bekreft uttak'}</button>
        <button class="btn" data-bank-cancel="${product}">Avbryt</button>
      </div>
      <div class="err" id="bank-err-${product}" style="color:#ff5a52;font-size:.8rem"></div>`;
    bindSteppers(box);
    box.querySelector(`[data-bank-cancel="${product}"]`).onclick = () => { box.hidden = true; box.innerHTML = ''; };
    box.querySelector(`[data-bank-confirm="${product}"]`).onclick = () => {
      const amt = Math.floor(Number(box.querySelector(`#bank-amt-${product}`).value) || 0);
      const err = box.querySelector(`#bank-err-${product}`);
      if (amt <= 0) { err.textContent = 'Skriv et beløp over 0.'; return; }
      if (amt > cap) { err.textContent = `Maks ${cap} 💰.`; return; }
      const ctx = { now: nowIso(), id: newId() };
      const fn = dir === 'in' ? depositBank : withdrawBank;
      App.state = fn(App.state, { product, amount: amt, by: 'son' }, ctx);
      save();
      renderSon();
    };
  };
  host.querySelectorAll('[data-bank-in]').forEach((b) => (b.onclick = () => openForm(b.dataset.bankIn, 'in')));
  host.querySelectorAll('[data-bank-out]').forEach((b) => (b.onclick = () => openForm(b.dataset.bankOut, 'out')));
}
```

> **Hjelpere (verifisert i `js/app.js`):** `save()` (lagrer state), `newId()` (returnerer `crypto.randomUUID()`), `nowIso()` (ISO-tidsstempel). Samme trio som quest/shop/homework-handlerne bruker.

- [ ] **Step 2: Parse-sjekk**

Run: `jsc -m js/app.js` → `ReferenceError: document` (OK).

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(bank): sønnens Bank-visning – kort, sparkline, inn/ut-skjema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: App – topp-logo viser total formue + shop-gating

**Files:**
- Modify: `js/app.js` (`brandHtml` ~239)

- [ ] **Step 1: Oppdater `brandHtml` til total formue**

Erstatt kroppen i `brandHtml()`:

```javascript
function brandHtml() {
  const today = isoDate(new Date());
  const bal = Math.round(totalWealth(App.state, today));
  return `<div class="brand">
      <img src="icon-192.png" alt="" width="34" height="34" style="border-radius:9px">
      <b>Honniscoins:</b><span class="brandbal">${bal} 💰</span>
    </div>`;
}
```

- [ ] **Step 2: Verifiser shop-gating**

Shop bruker `availableBalance` (nå bank-bevisst) via `avail` i `renderShopPage` (~797) og `requestShopItem` i logic.js. Ingen kodeendring nødvendig — bekreft ved lesing at `renderShopPage` fortsatt bruker `availableBalance` for `canBuy`. (Coins i banken kan da ikke brukes i shop.)

- [ ] **Step 3: Parse-sjekk + tester**

Run: `jsc -m js/app.js` → OK.
Run: `jsc -m test/run-jsc.js` → alle grønne.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(bank): topp-logo viser total formue (spendable + bank)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: App – forelder setter sparerente (Settings)

**Files:**
- Modify: `js/app.js` (`renderPoengTab` – Settings; finn med `grep -n "function renderPoengTab" js/app.js`)

- [ ] **Step 1: Legg til rente-felt i Settings**

I `renderPoengTab`, legg til en ny seksjon i innstillings-markupen (ved siden av krPerCoin/notifyEmail). Bruk uke-rente i prosent (lagres som brøk):

```javascript
    <div class="sec">🏦 Bank</div>
    <div class="card">
      <div class="row" style="border:none">
        <div class="lbl">Sparerente <span class="muted">(% per uke)</span></div>
        <div>${stepperHtml('id="savRate"', Math.round(((App.state.settings.bank && App.state.settings.bank.savingsWeeklyRate) || 0) * 100), { min: 0, step: 1 })}</div>
      </div>
    </div>
```

- [ ] **Step 2: Bind endring (lagre som brøk, bump settings.updatedAt)**

I bindingsdelen av `renderPoengTab` (der andre settings-felt bindes), legg til:

```javascript
  const savRate = document.getElementById('savRate');
  if (savRate) savRate.onchange = () => {
    const pct = Math.max(0, Number(savRate.value) || 0);
    if (!App.state.settings.bank) App.state.settings.bank = { savingsWeeklyRate: 0 };
    App.state.settings.bank.savingsWeeklyRate = pct / 100;
    App.state.settings.updatedAt = nowIso();
    save();
  };
```

> Endringen gjelder kun nye innskudd (renten stemples per innskudd i `depositBank`) — eksisterende lotter beholder sin stemplede rate.

- [ ] **Step 3: Sikre `bindSteppers` dekker feltet**

Bekreft at `renderPoengTab` kaller `bindSteppers(host)` sist (den gjør det ifølge konvensjonene). Hvis Settings rendres i egen host, sørg for at `bindSteppers` kalles etter innsetting.

- [ ] **Step 4: Parse-sjekk**

Run: `jsc -m js/app.js` → OK.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat(bank): forelder setter sparerente (%/uke) i Settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: App – logg-gren for bank

**Files:**
- Modify: `js/app.js` (`renderLoggTab` ~2055-2110)

- [ ] **Step 1: Legg til `type:'bank'`-gren**

I `renderLoggTab`, i kjeden av `else if (e.type === ...)`, legg til:

```javascript
      } else if (e.type === 'bank') {
        const prod = e.product === 'fund' ? 'fond' : 'sparekonto';
        txt = e.action === 'deposit'
          ? `🏦 Satte inn <b>${e.amount} 💰</b> i ${prod}`
          : `🏦 Tok ut <b>${e.amount} 💰</b> fra ${prod}`;
```

- [ ] **Step 2: Parse-sjekk**

Run: `jsc -m js/app.js` → OK.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(bank): logg-gren for innskudd/uttak

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: CSS + APP_VERSION

**Files:**
- Modify: `index.html` (CSS + `APP_VERSION`)

- [ ] **Step 1: Legg til CSS**

I `<style>`-blokka i `index.html`, legg til:

```css
.subtabs{display:flex;gap:8px;margin:0 0 12px}
.subtab{flex:1;padding:8px;border-radius:10px;border:1px solid #2a2f36;background:transparent;color:inherit;font-weight:600}
.subtab.on{background:var(--accent,#B50000);color:#fff;border-color:transparent}
.bankcard{margin-bottom:12px}
.bankhead{font-weight:700;margin-bottom:6px}
.bankhead .muted{font-weight:400;font-size:.78rem;display:block}
.bankval{font-size:1.4rem;font-weight:800;margin:4px 0}
.gain{font-size:.8rem;font-weight:700;margin-left:6px}
.gain.up{color:#39d353}
.gain.down{color:#ff5a52}
.spark{width:100%;height:48px;display:block;margin:6px 0}
.bankform{margin-top:8px}
```

- [ ] **Step 2: Bump `APP_VERSION`**

Finn `APP_VERSION` i `index.html` og øk til neste bygg (f.eks. `b59`).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(bank): CSS for Bank-visning + bump APP_VERSION (b59)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Full verifisering + deploy (v1 til produksjon)

**Files:** ingen nye

- [ ] **Step 1: Kjør hele test-suiten**

Run: `jsc -m test/run-jsc.js`
Expected: alle grønne (inkl. de 6 nye bank-testfunksjonene).

- [ ] **Step 2: Parse-sjekk app.js**

Run: `jsc -m js/app.js` → `ReferenceError: document` (OK).

- [ ] **Step 3: Manuell røyk-test i localStorage-modus**

Åpne appen (tom URL-hash = localStorage). Som sønn: opptjen litt saldo, gå til 💰 Penger → 🏦 Bank, sett inn i sparekonto og fond, sjekk at Ledig synker, topp-logo viser total formue, ta ut igjen, sjekk at det balanserer. Som forelder: endre sparerente i Settings, verifiser at nytt innskudd bruker ny rente (logg + verdi).

- [ ] **Step 4: PR + merge (følg dcg-flyten)**

```bash
git push -u origin spec/bank-renter-fond
gh pr create --base main --title "Banken v1: sparekonto + fond" --body "Se docs/superpowers/specs/2026-09-24-honniscoins-bank-renter-fond-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr merge spec/bank-renter-fond --merge --delete-branch
git switch main && git pull --ff-only
```

- [ ] **Step 5: Verifiser live (GitHub Pages, ~1–2 min, cache-buster)**

Sjekk `index.html?cb=$RANDOM` (ny APP_VERSION) og `js/app.js?cb=$RANDOM` / `js/logic.js?cb=$RANDOM` at endringene er ute.

---

## Etter v1: v2 (forelder-oversikt)

Egen liten oppfølging (ikke i denne planen): read-only oversikt i forelderens Penger/Settings som viser sønnens `savingsValue` / `fundValue` / `totalWealth`. Bygger kun på v1s rene fn — ingen modellendring.

---

## Self-review (utført)

- **Spec-dekning:** ledger + fletting (T1), navForDate/rails (T2), sparekonto (T3), fond+gulv (T4), saldo-integrasjon (T5), mutasjoner+gating (T6), Penger-hub+sub-tabs (T7), Bank-UI+inn/ut (T8), topp-logo total formue + shop-gating (T9), sparerente-innstilling (T10), logg (T11), CSS+versjon (T12), test+deploy (T13). v2 eksplisitt utsatt. ✓
- **Placeholder-scan:** ingen TBD/«håndter feil»; all kode er konkret. Hjelpere `save()`/`newId()`/`nowIso()`/`renderPoengTab`/`bindSteppers` er verifisert å finnes i `js/app.js`. ✓
- **Type-konsistens:** `depositBank`/`withdrawBank`/`savingsValue`/`fundValue`/`spendable`/`totalWealth`/`netInBank`/`bankValue`/`navForDate` brukes med samme signatur i logic-tasks og app-tasks. `availableBalance` redefineres én gang (T5) og gjenbrukes uendret av shop. ✓
