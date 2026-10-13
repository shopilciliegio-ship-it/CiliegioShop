// Generatore dei CSV per l'import ordini in Mexal.
// Funzioni pure: partono dai dati strutturati dell'ordine (orderData, vedi buildOrderData in CiliegioShop.html)
// e producono fino a tre file:
//   - anagrafica : 1 riga con i dati del cliente (e del destinatario se diverso) per registrarlo in Mexal
//   - prodotti   : le righe dei prodotti (fattura prodotti)
//   - spese      : spese di trasporto e dazi (fattura spedizione) - solo se ci sono
// Regole fiscali fissate con Luca (13/10/2026):
//   Italia + UE   : listino 1, prezzi SENZA IVA (scorporati dal prezzo dello shop), l'IVA la calcola Mexal
//                   in base all'aliquota del prodotto; trasporto scorporato al 22%.
//   Extra-UE      : listino 3, prezzi pieni dello shop, esenzione N08,1 sui prodotti, N09 sul trasporto,
//                   S15 sui dazi.
//   Omaggi        : riga al prezzo pieno di listino, sconto 100%, esenzione S15 (in entrambe le zone).
//   Sconti        : in Mexal sono SULLA RIGA (% su ogni riga), mai come riga separata.
//   Arrotondamenti: 2 decimali; il prezzo unitario viene scelto in modo che il totale riga di Mexal
//                   (imponibile + IVA) sia il piu' vicino possibile a quanto ha pagato il cliente.
//                   La differenza residua (di solito 1 centesimo) viene riportata nel riepilogo: si chiude
//                   con un abbuono in Mexal.

const RULES = {
  euCountries: ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
    'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'],
  priceList: { domestic: 1, extra: 3 },
  vatShipping: 22,
  exemption: { extraProducts: 'N08,1', extraShipping: 'N09', duties: 'S15', gift: 'S15' },
  code: { shipping: '001', duties: 'TAX 10%' },
  maxRoundingDiff: 0.05   // oltre questa differenza (EUR) il riepilogo segnala un problema
};

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

let CODES = {};
try { CODES = require('./mexal-codes.json'); } catch (e) { CODES = {}; }

function destination(od) {
  return (od.shipTo && od.shipTo.countryCode) || (od.customer && od.customer.countryCode) || '';
}

function zoneOf(od) {
  const d = destination(od);
  if (d === 'IT') return 'IT';
  if (RULES.euCountries.indexOf(d) >= 0) return 'EU';
  return 'EXTRA-EU';
}

function discountPct(od) {
  if (typeof od.discountPct === 'number') return od.discountPct;
  const prod = Number(od.prodTotal) || 0;
  return prod > 0 && Number(od.discount) > 0 ? r2(Number(od.discount) / prod * 100) : 0;
}

// Sceglie il prezzo unitario netto (2 decimali) che, dopo sconto di riga e IVA calcolati come fa Mexal,
// si avvicina di piu' al totale pagato dal cliente (targetGross). A parita' di distanza preferisce
// l'eccesso (si chiude con un abbuono di 1 centesimo).
function bestNetUnit(unitGross, qty, ratePct, discPct, targetGross) {
  const u0 = r2(unitGross / (1 + ratePct / 100));
  let best = null;
  for (let k = -3; k <= 3; k++) {
    const u = r2(u0 + k / 100);
    if (u < 0) continue;
    const net = r2(qty * u * (1 - discPct / 100));
    const vat = r2(net * ratePct / 100);
    const gross = r2(net + vat);
    const err = r2(gross - targetGross);
    if (!best || Math.abs(err) < Math.abs(best.err) - 1e-9 || (Math.abs(Math.abs(err) - Math.abs(best.err)) < 1e-9 && err > best.err)) {
      best = { unit: u, net: net, vat: vat, gross: gross, err: err };
    }
  }
  return best;
}

function buildProductLines(od, zone, problems) {
  const domestic = zone !== 'EXTRA-EU';
  const d = discountPct(od);
  const rows = [];
  (od.lines || []).forEach(function(l, i) {
    const qty = Number(l.qty) || 0;
    const isGift = l.gift === 1 || Number(l.unit) === 0;
    const base = { line: i + 1, code: l.code || '', description: CODES[l.code] || l.name || '', qty: qty };
    if (isGift) {
      const list = Number(l.listPrice);
      if (!(list > 0)) problems.push('omaggio senza prezzo di listino: ' + (l.code || l.id));
      rows.push(Object.assign(base, { unit: r2(list || 0), disc: 100, vatRate: '', exemption: RULES.exemption.gift,
        shopTotal: 0, mexalTotal: 0, gift: true }));
      return;
    }
    const unitGross = Number(l.unit);
    const shopTotal = r2(qty * unitGross * (1 - d / 100));
    if (!domestic) {
      const net = r2(qty * unitGross * (1 - d / 100));
      rows.push(Object.assign(base, { unit: r2(unitGross), disc: d, vatRate: '', exemption: RULES.exemption.extraProducts,
        shopTotal: shopTotal, mexalTotal: net }));
      return;
    }
    const rate = Number(l.vat);
    if (l.vat === undefined || l.vat === null || l.vat === '' || !(rate >= 0)) {
      problems.push('manca l\'aliquota IVA del prodotto ' + (l.code || l.id));
      rows.push(Object.assign(base, { unit: '', disc: d, vatRate: '', exemption: '', shopTotal: shopTotal, mexalTotal: NaN }));
      return;
    }
    const b = bestNetUnit(unitGross, qty, rate, d, shopTotal);
    rows.push(Object.assign(base, { unit: b.unit, disc: d, vatRate: rate, exemption: '', shopTotal: shopTotal, mexalTotal: b.gross }));
  });
  return rows;
}

function buildExpenseLines(od, zone, problems) {
  const domestic = zone !== 'EXTRA-EU';
  const rows = [];
  const ship = Number(od.shipping) || 0;
  const duties = Number(od.duties) || 0;
  let n = 0;
  if (ship > 0) {
    const base = { line: ++n, code: RULES.code.shipping, description: od.shippingLabel ? 'Spese di spedizione - ' + od.shippingLabel : 'Spese di spedizione', qty: 1, disc: 0 };
    if (domestic) {
      const b = bestNetUnit(ship, 1, RULES.vatShipping, 0, r2(ship));
      rows.push(Object.assign(base, { unit: b.unit, vatRate: RULES.vatShipping, exemption: '', shopTotal: r2(ship), mexalTotal: b.gross }));
    } else {
      rows.push(Object.assign(base, { unit: r2(ship), vatRate: '', exemption: RULES.exemption.extraShipping, shopTotal: r2(ship), mexalTotal: r2(ship) }));
    }
  }
  if (duties > 0) {
    if (domestic) problems.push('dazi presenti per una destinazione Italia/UE (' + duties + ' EUR): verificare');
    rows.push({ line: ++n, code: RULES.code.duties, description: CODES[RULES.code.duties] || 'Dazi doganali', qty: 1, disc: 0,
      unit: r2(duties), vatRate: '', exemption: RULES.exemption.duties, shopTotal: r2(duties), mexalTotal: r2(duties) });
  }
  return rows;
}

// ---- CSV ----
function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csv(columns, rows) {
  const NL = String.fromCharCode(13) + String.fromCharCode(10);
  return [columns.join(',')].concat(rows.map(function(r) { return columns.map(function(c) { return esc(r[c]); }).join(','); })).join(NL) + NL;
}
const money = (n) => (n === '' || n === null || n === undefined || Number.isNaN(n)) ? '' : Number(n).toFixed(2);

const DOC_COLUMNS = ['OrderNumber', 'DocType', 'OrderDate', 'PaymentMethod', 'CustomerSurname', 'CustomerName', 'FiscalId',
  'PriceList', 'Line', 'Code', 'Description', 'Qty', 'UnitPrice', 'DiscountPct', 'VatRate', 'Exemption', 'ShopLineTotal'];

const ANAG_COLUMNS = ['OrderNumber', 'OrderDate', 'Surname', 'Name', 'FiscalId', 'TaxCode', 'Email', 'Phone', 'Address', 'Zip', 'City',
  'Province', 'State', 'StateCode', 'Country', 'CountryCode', 'FiscalZone', 'PriceList', 'DefaultExemption', 'Language',
  'ShipToName', 'ShipToSurname', 'ShipToPhone', 'ShipToAddress', 'ShipToZip', 'ShipToCity', 'ShipToState', 'ShipToStateCode',
  'ShipToCountry', 'ShipToCountryCode'];

function docRows(kind, rows, ctx) {
  return rows.map(function(r) {
    return { OrderNumber: ctx.orderNumber, DocType: kind, OrderDate: ctx.orderDate, PaymentMethod: ctx.paymentMethod,
      CustomerSurname: ctx.od.customer.surname, CustomerName: ctx.od.customer.name, FiscalId: ctx.od.customer.fiscalId,
      PriceList: ctx.priceList, Line: r.line, Code: r.code, Description: r.description, Qty: r.qty, UnitPrice: money(r.unit),
      DiscountPct: r.disc, VatRate: r.vatRate, Exemption: r.exemption, ShopLineTotal: money(r.shopTotal) };
  });
}

/**
 * @param {object} od   dati strutturati dell'ordine
 * @param {object} meta { orderNumber, orderDate (YYYY-MM-DD), paymentMethod }
 * @returns {{ok:boolean, problems:string[], files:{name:string,content:string}[], summary:object}}
 */
function buildMexalCsv(od, meta) {
  const problems = [];
  if (!od || !od.customer || !Array.isArray(od.lines)) return { ok: false, problems: ['dati ordine mancanti'], files: [], summary: {} };
  if (od.quote) return { ok: false, problems: ['richiesta di preventivo: nessun CSV'], files: [], summary: {} };
  const zone = zoneOf(od);
  const priceList = zone === 'EXTRA-EU' ? RULES.priceList.extra : RULES.priceList.domestic;
  const ctx = { od: od, orderNumber: meta.orderNumber || '', orderDate: meta.orderDate || '', paymentMethod: meta.paymentMethod || '', priceList: priceList };

  const prod = buildProductLines(od, zone, problems);
  const exp = buildExpenseLines(od, zone, problems);

  const sum = (rows, k) => r2(rows.reduce(function(t, r) { return t + (Number.isNaN(r[k]) ? 0 : Number(r[k])); }, 0));
  const shopProducts = r2(Number(od.prodTotal) - Number(od.discount || 0));
  const diffProducts = r2(sum(prod, 'mexalTotal') - shopProducts);
  const diffExpenses = r2(sum(exp, 'mexalTotal') - r2(Number(od.shipping || 0) + Number(od.duties || 0)));
  if (Math.abs(diffProducts) > RULES.maxRoundingDiff) problems.push('differenza prodotti Mexal/shop di ' + diffProducts.toFixed(2) + ' EUR (oltre la tolleranza)');
  if (Math.abs(diffExpenses) > RULES.maxRoundingDiff) problems.push('differenza spese Mexal/shop di ' + diffExpenses.toFixed(2) + ' EUR (oltre la tolleranza)');

  const c = od.customer, st = od.shipTo;
  const anag = [{
    OrderNumber: ctx.orderNumber, OrderDate: ctx.orderDate, Surname: c.surname, Name: c.name, FiscalId: c.fiscalId, TaxCode: c.taxCode || '',
    Email: c.email, Phone: c.phone, Address: c.address, Zip: c.zip, City: c.city, Province: c.province, State: c.state,
    StateCode: c.stateCode || '', Country: c.country, CountryCode: c.countryCode, FiscalZone: zone, PriceList: priceList,
    DefaultExemption: zone === 'EXTRA-EU' ? RULES.exemption.extraProducts : '', Language: c.countryCode === 'IT' ? 'it' : 'en',
    ShipToName: st ? st.name : '', ShipToSurname: st ? st.surname : '', ShipToPhone: st ? st.phone : '', ShipToAddress: st ? st.address : '',
    ShipToZip: st ? st.zip : '', ShipToCity: st ? st.city : '', ShipToState: st ? st.state : '', ShipToStateCode: st ? (st.stateCode || '') : '',
    ShipToCountry: st ? st.country : '', ShipToCountryCode: st ? st.countryCode : ''
  }];

  const tag = (ctx.orderNumber || 'ordine').replace(/[^A-Za-z0-9_-]/g, '');
  const files = [{ name: tag + '_anagrafica.csv', content: csv(ANAG_COLUMNS, anag) }];
  if (prod.length) files.push({ name: tag + '_prodotti.csv', content: csv(DOC_COLUMNS, docRows('PRODOTTI', prod, ctx)) });
  if (exp.length) files.push({ name: tag + '_spese.csv', content: csv(DOC_COLUMNS, docRows('SPESE', exp, ctx)) });

  return {
    ok: problems.length === 0,
    problems: problems,
    files: files,
    summary: { zone: zone, priceList: priceList, productsShop: shopProducts, productsMexal: sum(prod, 'mexalTotal'), diffProducts: diffProducts,
      expensesShop: r2(Number(od.shipping || 0) + Number(od.duties || 0)), expensesMexal: sum(exp, 'mexalTotal'), diffExpenses: diffExpenses }
  };
}

module.exports = { buildMexalCsv, RULES, zoneOf, discountPct, bestNetUnit };
