const { test, expect } = require('@playwright/test');

const URL = 'https://ciliegio-shop.netlify.app/CiliegioShop.html';

// Attende che la splash screen finisca e il form di registrazione sia visibile.
// addInitScript inietta sessionStorage PRIMA che la pagina carichi, così il popup
// di installazione (che su mobile copre tutto) non viene mai mostrato.
async function waitForApp(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('ciliegio_install_dismissed', '1');
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await expect(page.locator('text=Customer Registration')).toBeVisible({ timeout: 35000 });
}

// Helper: compila tutto il form con dati italiani.
// Ordine degli input nel form (stabile, senza conditional rendering):
//   0: nationality  1: ZIP  2: First Name  3: Last Name  4: Address
//   5: City  6: Province/County  7: State/Region  8: Mobile  9: email user  10: email domain
// Nota: label:has-text("City") matcha anche il label ZIP (contiene "auto-fills city")
// → usiamo nth() per i campi senza placeholder
async function fillFormItaly(page) {
  const tb = () => page.getByRole('textbox'); // shorthand

  // 1. Nazionalità (ha placeholder)
  await tb().nth(0).click();
  await tb().nth(0).fill('ITAL');
  await page.locator('text=ITALY').first().click();
  await page.waitForTimeout(300);

  // 2. ZIP → trigger nominatim (placeholder ora "Enter ZIP…")
  await tb().nth(1).fill('50100');
  await tb().nth(1).blur();
  await page.waitForTimeout(2000); // attende risposta nominatim

  // 3. Nome e Cognome
  await tb().nth(2).fill('Mario');
  await tb().nth(3).fill('Rossi');

  // 4. Indirizzo (ha placeholder "Street, number…")
  await page.locator('input[placeholder="Street, number…"]').fill('Via Roma 1');

  // 5. Città / Provincia / Regione (nominatim potrebbe averle già compilate)
  if (!(await tb().nth(5).inputValue())) await tb().nth(5).fill('FIRENZE');
  if (!(await tb().nth(6).inputValue())) await tb().nth(6).fill('FI');
  if (!(await tb().nth(7).inputValue())) await tb().nth(7).fill('TOSCANA');

  // 6. Telefono (+39 già precompilato da pickCountry)
  await tb().nth(8).fill('+39 3334445566');

  // 7. Email
  await page.locator('input[placeholder="username"]').fill('test');
  await page.locator('input[placeholder="provider.com"]').fill('example.com');
}

// ── 1. CARICAMENTO APP ──────────────────────────────────────────

test('App carica senza schermata nera', async ({ page }) => {
  await page.addInitScript(() => { sessionStorage.setItem('ciliegio_install_dismissed', '1'); });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await expect(page.locator('#root')).not.toBeEmpty();
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.trim().length).toBeGreaterThan(10);
});

test('Logo Il Ciliegio è visibile', async ({ page }) => {
  await page.addInitScript(() => { sessionStorage.setItem('ciliegio_install_dismissed', '1'); });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  const imgVisible = await page.locator('#logo-img').isVisible().catch(() => false);
  const txtVisible = await page.locator('#logo-txt').isVisible().catch(() => false);
  expect(imgVisible || txtVisible).toBeTruthy();
});

test('Form registrazione appare dopo splash', async ({ page }) => {
  await waitForApp(page);
  await expect(page.locator('text=Customer Registration')).toBeVisible();
  await expect(page.locator('text=all fields are required')).toBeVisible();
});

// ── 2. FORM REGISTRAZIONE ───────────────────────────────────────

test('Nazionalità: autocomplete dropdown funziona', async ({ page }) => {
  await waitForApp(page);
  const natInput = page.locator('input[placeholder*="country name"]');
  await natInput.click();
  await natInput.fill('ITAL');
  await expect(page.locator('text=ITALY').first()).toBeVisible({ timeout: 5000 });
});

test('Form completo → Step 2 (Data Summary)', async ({ page }) => {
  await waitForApp(page);
  await fillFormItaly(page);
  const btn = page.locator('button', { hasText: 'Continue to Summary' });
  await expect(btn).toBeEnabled({ timeout: 8000 });
  await btn.click();
  await expect(page.locator('text=Data Summary')).toBeVisible({ timeout: 8000 });
});

// ── 3. STEP 2: RIEPILOGO ───────────────────────────────────────

test('Step 2: pulsanti Edit e Confirm visibili', async ({ page }) => {
  await waitForApp(page);
  await fillFormItaly(page);
  await page.locator('button', { hasText: 'Continue to Summary' }).click();
  await expect(page.locator('text=Data Summary')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('button', { hasText: 'Confirm & Go to Catalog' })).toBeVisible();
  await expect(page.locator('button', { hasText: 'Edit' })).toBeVisible();
});

// ── 4. STEP 3: CATALOGO ────────────────────────────────────────

test('Catalogo: prodotti visibili (almeno 5)', async ({ page }) => {
  await waitForApp(page);
  await fillFormItaly(page);
  await page.locator('button', { hasText: 'Continue to Summary' }).click();
  await page.locator('button', { hasText: 'Confirm & Go to Catalog' }).click();
  const first = page.locator('.prod-img, .prod-img-fallback').first();
  await expect(first).toBeVisible({ timeout: 15000 });
  const count = await page.locator('.prod-img, .prod-img-fallback').count();
  expect(count).toBeGreaterThan(5);
});

test('Catalogo: aggiunta prodotto al carrello', async ({ page }) => {
  await waitForApp(page);
  await fillFormItaly(page);
  await page.locator('button', { hasText: 'Continue to Summary' }).click();
  await page.locator('button', { hasText: 'Confirm & Go to Catalog' }).click();
  await expect(page.locator('.prod-img, .prod-img-fallback').first()).toBeVisible({ timeout: 15000 });
  const addBtn = page.locator('button', { hasText: '+ Add' }).first();
  await expect(addBtn).toBeVisible({ timeout: 5000 });
  await addBtn.click();
  // Dopo l'aggiunta deve comparire un totale in €
  await expect(page.locator('text=€').first()).toBeVisible({ timeout: 5000 });
});

// ── 5. LAYOUT E NAVIGAZIONE ────────────────────────────────────

test('Layout mobile: catalog-col e cart-col in colonna', async ({ page }) => {
  const vp = page.viewportSize();
  if (!vp || vp.width >= 768) { test.skip(); return; }
  await waitForApp(page);
  await fillFormItaly(page);
  await page.locator('button', { hasText: 'Continue to Summary' }).click();
  await page.locator('button', { hasText: 'Confirm & Go to Catalog' }).click();
  await expect(page.locator('.catalog-col').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.cart-col').first()).toBeVisible({ timeout: 5000 });
});

test('Bottone Home riporta alla registrazione', async ({ page }) => {
  await waitForApp(page);
  await fillFormItaly(page);
  await page.locator('button', { hasText: 'Continue to Summary' }).click();
  await page.locator('button', { hasText: 'Confirm & Go to Catalog' }).click();
  await expect(page.locator('.prod-img, .prod-img-fallback').first()).toBeVisible({ timeout: 15000 });
  await page.locator('button', { hasText: /Home/ }).click();
  await expect(page.locator('text=Customer Registration')).toBeVisible({ timeout: 5000 });
});
