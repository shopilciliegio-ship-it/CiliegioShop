# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: shop.spec.js >> App carica senza schermata nera
- Location: tests\shop.spec.js:58:1

# Error details

```
Error: expect(locator).not.toBeEmpty() failed

Locator: locator('#root')
Expected: not empty
Timeout: 12000ms
Error: element(s) not found

Call log:
  - Expect "not toBeEmpty" with timeout 12000ms
  - waiting for locator('#root')

```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | 
  3   | const URL = 'https://ciliegio-shop.netlify.app/CiliegioShop.html';
  4   | 
  5   | // Attende che la splash screen finisca e il form di registrazione sia visibile.
  6   | // addInitScript inietta sessionStorage PRIMA che la pagina carichi, così il popup
  7   | // di installazione (che su mobile copre tutto) non viene mai mostrato.
  8   | async function waitForApp(page) {
  9   |   await page.addInitScript(() => {
  10  |     sessionStorage.setItem('ciliegio_install_dismissed', '1');
  11  |   });
  12  |   await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  13  |   await expect(page.locator('text=Customer Registration')).toBeVisible({ timeout: 35000 });
  14  | }
  15  | 
  16  | // Helper: compila tutto il form con dati italiani.
  17  | // Ordine degli input nel form (stabile, senza conditional rendering):
  18  | //   0: nationality  1: ZIP  2: First Name  3: Last Name  4: Address
  19  | //   5: City  6: Province/County  7: State/Region  8: Mobile  9: email user  10: email domain
  20  | // Nota: label:has-text("City") matcha anche il label ZIP (contiene "auto-fills city")
  21  | // → usiamo nth() per i campi senza placeholder
  22  | async function fillFormItaly(page) {
  23  |   const tb = () => page.getByRole('textbox'); // shorthand
  24  | 
  25  |   // 1. Nazionalità (ha placeholder)
  26  |   await tb().nth(0).click();
  27  |   await tb().nth(0).fill('ITAL');
  28  |   await page.locator('text=ITALY').first().click();
  29  |   await page.waitForTimeout(300);
  30  | 
  31  |   // 2. ZIP → trigger nominatim (placeholder ora "Enter ZIP…")
  32  |   await tb().nth(1).fill('50100');
  33  |   await tb().nth(1).blur();
  34  |   await page.waitForTimeout(2000); // attende risposta nominatim
  35  | 
  36  |   // 3. Nome e Cognome
  37  |   await tb().nth(2).fill('Mario');
  38  |   await tb().nth(3).fill('Rossi');
  39  | 
  40  |   // 4. Indirizzo (ha placeholder "Street, number…")
  41  |   await page.locator('input[placeholder="Street, number…"]').fill('Via Roma 1');
  42  | 
  43  |   // 5. Città / Provincia / Regione (nominatim potrebbe averle già compilate)
  44  |   if (!(await tb().nth(5).inputValue())) await tb().nth(5).fill('FIRENZE');
  45  |   if (!(await tb().nth(6).inputValue())) await tb().nth(6).fill('FI');
  46  |   if (!(await tb().nth(7).inputValue())) await tb().nth(7).fill('TOSCANA');
  47  | 
  48  |   // 6. Telefono (+39 già precompilato da pickCountry)
  49  |   await tb().nth(8).fill('+39 3334445566');
  50  | 
  51  |   // 7. Email
  52  |   await page.locator('input[placeholder="username"]').fill('test');
  53  |   await page.locator('input[placeholder="provider.com"]').fill('example.com');
  54  | }
  55  | 
  56  | // ── 1. CARICAMENTO APP ──────────────────────────────────────────
  57  | 
  58  | test('App carica senza schermata nera', async ({ page }) => {
  59  |   await page.addInitScript(() => { sessionStorage.setItem('ciliegio_install_dismissed', '1'); });
  60  |   await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  61  |   await page.waitForTimeout(5000);
> 62  |   await expect(page.locator('#root')).not.toBeEmpty();
      |                                           ^ Error: expect(locator).not.toBeEmpty() failed
  63  |   const bodyText = await page.locator('body').innerText();
  64  |   expect(bodyText.trim().length).toBeGreaterThan(10);
  65  | });
  66  | 
  67  | test('Logo Il Ciliegio è visibile', async ({ page }) => {
  68  |   await page.addInitScript(() => { sessionStorage.setItem('ciliegio_install_dismissed', '1'); });
  69  |   await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  70  |   await page.waitForTimeout(3000);
  71  |   const imgVisible = await page.locator('#logo-img').isVisible().catch(() => false);
  72  |   const txtVisible = await page.locator('#logo-txt').isVisible().catch(() => false);
  73  |   expect(imgVisible || txtVisible).toBeTruthy();
  74  | });
  75  | 
  76  | test('Form registrazione appare dopo splash', async ({ page }) => {
  77  |   await waitForApp(page);
  78  |   await expect(page.locator('text=Customer Registration')).toBeVisible();
  79  |   await expect(page.locator('text=all fields are required')).toBeVisible();
  80  | });
  81  | 
  82  | // ── 2. FORM REGISTRAZIONE ───────────────────────────────────────
  83  | 
  84  | test('Nazionalità: autocomplete dropdown funziona', async ({ page }) => {
  85  |   await waitForApp(page);
  86  |   const natInput = page.locator('input[placeholder*="country name"]');
  87  |   await natInput.click();
  88  |   await natInput.fill('ITAL');
  89  |   await expect(page.locator('text=ITALY').first()).toBeVisible({ timeout: 5000 });
  90  | });
  91  | 
  92  | test('Form completo → Step 2 (Data Summary)', async ({ page }) => {
  93  |   await waitForApp(page);
  94  |   await fillFormItaly(page);
  95  |   const btn = page.locator('button', { hasText: 'Continue to Summary' });
  96  |   await expect(btn).toBeEnabled({ timeout: 8000 });
  97  |   await btn.click();
  98  |   await expect(page.locator('text=Data Summary')).toBeVisible({ timeout: 8000 });
  99  | });
  100 | 
  101 | // ── 3. STEP 2: RIEPILOGO ───────────────────────────────────────
  102 | 
  103 | test('Step 2: pulsanti Edit e Confirm visibili', async ({ page }) => {
  104 |   await waitForApp(page);
  105 |   await fillFormItaly(page);
  106 |   await page.locator('button', { hasText: 'Continue to Summary' }).click();
  107 |   await expect(page.locator('text=Data Summary')).toBeVisible({ timeout: 8000 });
  108 |   await expect(page.locator('button', { hasText: 'Confirm & Go to Catalog' })).toBeVisible();
  109 |   await expect(page.locator('button', { hasText: 'Edit' })).toBeVisible();
  110 | });
  111 | 
  112 | // ── 4. STEP 3: CATALOGO ────────────────────────────────────────
  113 | 
  114 | test('Catalogo: prodotti visibili (almeno 5)', async ({ page }) => {
  115 |   await waitForApp(page);
  116 |   await fillFormItaly(page);
  117 |   await page.locator('button', { hasText: 'Continue to Summary' }).click();
  118 |   await page.locator('button', { hasText: 'Confirm & Go to Catalog' }).click();
  119 |   const first = page.locator('.prod-img, .prod-img-fallback').first();
  120 |   await expect(first).toBeVisible({ timeout: 15000 });
  121 |   const count = await page.locator('.prod-img, .prod-img-fallback').count();
  122 |   expect(count).toBeGreaterThan(5);
  123 | });
  124 | 
  125 | test('Catalogo: aggiunta prodotto al carrello', async ({ page }) => {
  126 |   await waitForApp(page);
  127 |   await fillFormItaly(page);
  128 |   await page.locator('button', { hasText: 'Continue to Summary' }).click();
  129 |   await page.locator('button', { hasText: 'Confirm & Go to Catalog' }).click();
  130 |   await expect(page.locator('.prod-img, .prod-img-fallback').first()).toBeVisible({ timeout: 15000 });
  131 |   const addBtn = page.locator('button', { hasText: '+ Add' }).first();
  132 |   await expect(addBtn).toBeVisible({ timeout: 5000 });
  133 |   await addBtn.click();
  134 |   // Dopo l'aggiunta deve comparire un totale in €
  135 |   await expect(page.locator('text=€').first()).toBeVisible({ timeout: 5000 });
  136 | });
  137 | 
  138 | // ── 5. LAYOUT E NAVIGAZIONE ────────────────────────────────────
  139 | 
  140 | test('Layout mobile: catalog-col e cart-col in colonna', async ({ page }) => {
  141 |   const vp = page.viewportSize();
  142 |   if (!vp || vp.width >= 768) { test.skip(); return; }
  143 |   await waitForApp(page);
  144 |   await fillFormItaly(page);
  145 |   await page.locator('button', { hasText: 'Continue to Summary' }).click();
  146 |   await page.locator('button', { hasText: 'Confirm & Go to Catalog' }).click();
  147 |   await expect(page.locator('.catalog-col').first()).toBeVisible({ timeout: 15000 });
  148 |   await expect(page.locator('.cart-col').first()).toBeVisible({ timeout: 5000 });
  149 | });
  150 | 
  151 | test('Bottone Home riporta alla registrazione', async ({ page }) => {
  152 |   await waitForApp(page);
  153 |   await fillFormItaly(page);
  154 |   await page.locator('button', { hasText: 'Continue to Summary' }).click();
  155 |   await page.locator('button', { hasText: 'Confirm & Go to Catalog' }).click();
  156 |   await expect(page.locator('.prod-img, .prod-img-fallback').first()).toBeVisible({ timeout: 15000 });
  157 |   await page.locator('button', { hasText: /Home/ }).click();
  158 |   await expect(page.locator('text=Customer Registration')).toBeVisible({ timeout: 5000 });
  159 | });
  160 | 
```