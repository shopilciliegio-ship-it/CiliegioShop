// Generatore dei CSV per l'import ordini in Mexal.
// Funzioni pure: partono dai dati strutturati dell'ordine (orderData, vedi buildOrderData in CiliegioShop.html)
// e producono fino a tre file:
//   - anagrafica : 1 riga con i dati del cliente (e del destinatario se diverso) per registrarlo in Mexal
//   - prodotti   : le righe dei prodotti (fattura prodotti)
//   - spese      : spese di trasporto e dazi (fattura spedizione) - solo se ci sono
// Regole fissate con Luca (13/10/2026):
//   Italia + UE   : listino 1, prezzi SENZA IVA (scorporati dal prezzo dello shop), l'IVA la calcola Mexal
//                   in base all'aliquota del prodotto; trasporto scorporato al 22%.
//   Extra-UE      : listino 3, prezzi pieni dello shop, esenzione N08,1 sui prodotti, N09 sul trasporto,
//                   S15 sui dazi. Tutto il mondo fuori UE, USA compresi.
//   Omaggi        : riga al prezzo pieno di listino, sconto 100%, esenzione S15 (in entrambe le zone).
//   Sconti        : in Mexal sono SULLA RIGA (% su ogni riga), mai come riga separata.
//   Zona fiscale  : quella della DESTINAZIONE, anche se il cliente e' di un'altra zona.
//   Registrazione : ordini A (app, carta/PayPal) come gli ordini dello shop online (causale 8, serie 1,
//                   magazzino 1, centro 2); ordini T (tablet, Paid at Farm) causale 1 Vendita, serie 2,
//                   magazzino 1, centro 1 "vendita diretta" (serve alla registrazione corretta di OX e fattura).
//   Arrotondamenti: prezzi a 2 decimali, una riga = un solo prezzo. I prezzi unitari sono scelti in modo che il
//                   totale del documento (imponibile + IVA calcolata riga per riga, come fa Mexal) sia il piu' vicino
//                   possibile a quanto ha pagato il cliente. Il residuo (1-2 centesimi) e' riportato nelle colonne
//                   Abbuono e si chiude con un abbuono in Mexal.

const RULES = {
  euCountries: ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
    'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'],
  priceList: { domestic: 1, extra: 3 },
  vatShipping: 22,
  exemption: { extraProducts: 'N08,1', extraShipping: 'N09', duties: 'S15', gift: 'S15' },
  code: { shipping: '001', duties: 'TAX 10%' },
  // causale / serie / magazzino / centro di costo-ricavo per canale
  channels: {
    A: { name: 'App (carta/PayPal) - come shop online', causale: '8', serie: '1', magazzino: '1', centro: '2' },
    T: { name: 'Tablet (Paid at Farm) - vendita diretta', causale: '1', serie: '2', magazzino: '1', centro: '1' }
  },
  maxRoundingDiff: 0.10   // oltre questo scarto (EUR) sul totale del documento il riepilogo segnala un problema
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

function channelOf(meta) {
  if (meta.channel === 'T' || meta.channel === 'A') return meta.channel;
  if (/direct/i.test(meta.paymentMethod || '')) return 'T';
  return String(meta.orderNumber || '').charAt(0).toUpperCase() === 'T' ? 'T' : 'A';
}

function discountPct(od) {
  if (typeof od.discountPct === 'number') return od.discountPct;
  const prod = Number(od.prodTotal) || 0;
  return prod > 0 && Number(od.discount) > 0 ? r2(Number(od.discount) / prod * 100) : 0;
}

// Totale (imponibile + IVA) del documento, calcolato come Mexal: l'IVA e' calcolata RIGA PER RIGA
// (confermato dai tecnici di Luca il 13/10/2026): per ogni riga imponibile = qta x prezzo x (1 - sconto),
// IVA = imponibile x aliquota, entrambi arrotondati al centesimo, poi si sommano le righe.
function docTotalDomestic(items, units) {
  return r2(items.reduce(function(t, it, i) {
    const net = r2(it.qty * units[i] * (1 - it.disc / 100));
    return t + net + r2(net * Number(it.rate) / 100);
  }, 0));
}

// Sceglie i prezzi unitari netti (2 decimali, una riga = un prezzo) in modo che il totale del documento sia il piu'
// vicino possibile a `paid`. Parte dal prezzo "ideale" (lordo / (1+aliquota)) e prova spostamenti di pochi centesimi
// riga per riga. A parita' di scarto preferisce l'eccesso (si chiude con un abbuono) e prezzi piu' vicini all'ideale.
function optimizeUnits(items, paid) {
  const ideal = items.map(function(it) { return r2(it.unitGross / (1 + it.rate / 100)); });
  let units = ideal.slice();
  const score = function(u) {
    const diff = r2(docTotalDomestic(items, u) - paid);
    const drift = u.reduce(function(t, x, i) { return t + Math.abs(x - ideal[i]); }, 0);
    return { diff: diff, key: [Math.abs(diff), diff < 0 ? 1 : 0, drift] };
  };
  const better = function(a, b) {   // a migliore di b?
    for (let i = 0; i < 3; i++) { if (a.key[i] < b.key[i] - 1e-9) return true; if (a.key[i] > b.key[i] + 1e-9) return false; }
    return false;
  };
  let cur = score(units);
  for (let pass = 0; pass < 30; pass++) {
    let improved = false;
    for (let i = 0; i < items.length; i++) {
      for (let k = -3; k <= 3; k++) {
        const u = r2(ideal[i] + k / 100);
        if (u < 0 || u === units[i]) continue;
        const trial = units.slice(); trial[i] = u;
        const s = score(trial);
        if (better(s, cur)) { units = trial; cur = s; improved = true; }
      }
    }
    if (!improved) break;
  }
  return { units: units, diff: cur.diff };
}

function buildProductLines(od, zone, problems) {
  const domestic = zone !== 'EXTRA-EU';
  const d = discountPct(od);
  const rows = [];
  const domItems = [];   // righe soggette a scorporo, da ottimizzare insieme
  (od.lines || []).forEach(function(l, i) {
    const qty = Number(l.qty) || 0;
    const isGift = l.gift === 1 || Number(l.unit) === 0;
    const base = { line: i + 1, code: l.code || '', description: CODES[l.code] || l.name || '', qty: qty };
    if (isGift) {
      const list = Number(l.listPrice);
      if (!(list > 0)) problems.push('omaggio senza prezzo di listino: ' + (l.code || l.id));
      rows.push(Object.assign(base, { unit: r2(list || 0), disc: 100, vatRate: '', exemption: RULES.exemption.gift, shopTotal: 0, gift: true }));
      return;
    }
    const unitGross = Number(l.unit);
    const shopTotal = r2(qty * unitGross * (1 - d / 100));
    if (!domestic) {
      rows.push(Object.assign(base, { unit: r2(unitGross), disc: d, vatRate: '', exemption: RULES.exemption.extraProducts, shopTotal: shopTotal }));
      return;
    }
    const rate = Number(l.vat);
    if (l.vat === undefined || l.vat === null || l.vat === '' || !(rate >= 0)) {
      problems.push('manca l\'aliquota IVA del prodotto ' + (l.code || l.id));
      rows.push(Object.assign(base, { unit: '', disc: d, vatRate: '', exemption: '', shopTotal: shopTotal }));
      return;
    }
    const row = Object.assign(base, { unit: 0, disc: d, vatRate: rate, exemption: '', shopTotal: shopTotal });
    rows.push(row);
    domItems.push({ row: row, qty: qty, unitGross: unitGross, rate: rate, disc: d });
  });

  const shopProducts = r2(Number(od.prodTotal) - Number(od.discount || 0));
  let mexalTotal;
  if (!domestic) {
    mexalTotal = r2(rows.reduce(function(t, r) { return t + (r.gift ? 0 : r2(r.qty * r.unit * (1 - r.disc / 100))); }, 0));
  } else if (domItems.length && !problems.length) {
    const opt = optimizeUnits(domItems, shopProducts);
    domItems.forEach(function(it, i) { it.row.unit = opt.units[i]; });
    mexalTotal = docTotalDomestic(domItems, opt.units);
  } else {
    mexalTotal = NaN;
  }
  return { rows: rows, paid: shopProducts, mexalTotal: mexalTotal };
}

function buildExpenseLines(od, zone, problems) {
  const domestic = zone !== 'EXTRA-EU';
  const rows = [];
  const ship = Number(od.shipping) || 0;
  const duties = Number(od.duties) || 0;
  let n = 0, mexalTotal = 0;
  if (ship > 0) {
    const base = { line: ++n, code: RULES.code.shipping, description: od.shippingLabel ? 'Spese di spedizione - ' + od.shippingLabel : 'Spese di spedizione', qty: 1, disc: 0 };
    if (domestic) {
      const opt = optimizeUnits([{ qty: 1, unitGross: ship, rate: RULES.vatShipping, disc: 0 }], r2(ship));
      rows.push(Object.assign(base, { unit: opt.units[0], vatRate: RULES.vatShipping, exemption: '', shopTotal: r2(ship) }));
      mexalTotal += docTotalDomestic([{ qty: 1, rate: RULES.vatShipping, disc: 0 }], opt.units);
    } else {
      rows.push(Object.assign(base, { unit: r2(ship), vatRate: '', exemption: RULES.exemption.extraShipping, shopTotal: r2(ship) }));
      mexalTotal += r2(ship);
    }
  }
  if (duties > 0) {
    if (domestic) problems.push('dazi presenti per una destinazione Italia/UE (' + duties + ' EUR): verificare');
    rows.push({ line: ++n, code: RULES.code.duties, description: CODES[RULES.code.duties] || 'Dazi doganali', qty: 1, disc: 0,
      unit: r2(duties), vatRate: '', exemption: RULES.exemption.duties, shopTotal: r2(duties) });
    mexalTotal += r2(duties);
  }
  return { rows: rows, paid: r2(ship + duties), mexalTotal: r2(mexalTotal) };
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

const DOC_COLUMNS = ['OrderNumber', 'DocType', 'OrderDate', 'PaymentMethod', 'Causale', 'Serie', 'Warehouse', 'CostCenter',
  'CustomerSurname', 'CustomerName', 'FiscalId', 'PriceList', 'Line', 'Code', 'Description', 'Qty', 'UnitPrice', 'DiscountPct',
  'VatRate', 'Exemption', 'ShopLineTotal', 'DocPaidByCustomer', 'DocTotalMexal', 'Abbuono'];

const ANAG_COLUMNS = ['OrderNumber', 'OrderDate', 'Surname', 'Name', 'FiscalId', 'TaxCode', 'Email', 'Phone', 'Address', 'Zip', 'City',
  'Province', 'State', 'StateCode', 'Country', 'CountryCode', 'FiscalZone', 'PriceList', 'DefaultExemption', 'Language',
  'ShipToName', 'ShipToSurname', 'ShipToPhone', 'ShipToAddress', 'ShipToZip', 'ShipToCity', 'ShipToState', 'ShipToStateCode',
  'ShipToCountry', 'ShipToCountryCode'];

function docRows(kind, doc, ctx) {
  const abb = Number.isNaN(doc.mexalTotal) ? '' : money(r2(doc.mexalTotal - doc.paid));
  return doc.rows.map(function(r) {
    return { OrderNumber: ctx.orderNumber, DocType: kind, OrderDate: ctx.orderDate, PaymentMethod: ctx.paymentMethod,
      Causale: ctx.ch.causale, Serie: ctx.ch.serie, Warehouse: ctx.ch.magazzino, CostCenter: ctx.ch.centro,
      CustomerSurname: ctx.od.customer.surname, CustomerName: ctx.od.customer.name, FiscalId: ctx.od.customer.fiscalId,
      PriceList: ctx.priceList, Line: r.line, Code: r.code, Description: r.description, Qty: r.qty, UnitPrice: money(r.unit),
      DiscountPct: r.disc, VatRate: r.vatRate, Exemption: r.exemption, ShopLineTotal: money(r.shopTotal),
      DocPaidByCustomer: money(doc.paid), DocTotalMexal: money(doc.mexalTotal), Abbuono: abb };
  });
}

/**
 * @param {object} od   dati strutturati dell'ordine
 * @param {object} meta { orderNumber, orderDate (YYYY-MM-DD), paymentMethod, channel? ('A'|'T') }
 * @returns {{ok:boolean, problems:string[], files:{name:string,content:string}[], summary:object}}
 */
function buildMexalCsv(od, meta) {
  const problems = [];
  meta = meta || {};
  if (!od || !od.customer || !Array.isArray(od.lines)) return { ok: false, problems: ['dati ordine mancanti'], files: [], summary: {} };
  if (od.quote) return { ok: false, problems: ['richiesta di preventivo: nessun CSV'], files: [], summary: {} };
  const zone = zoneOf(od);
  const priceList = zone === 'EXTRA-EU' ? RULES.priceList.extra : RULES.priceList.domestic;
  const channel = channelOf(meta);
  const ctx = { od: od, orderNumber: meta.orderNumber || '', orderDate: meta.orderDate || '', paymentMethod: meta.paymentMethod || '',
    priceList: priceList, ch: RULES.channels[channel] };

  const prod = buildProductLines(od, zone, problems);
  const exp = buildExpenseLines(od, zone, problems);

  const diffProducts = Number.isNaN(prod.mexalTotal) ? NaN : r2(prod.mexalTotal - prod.paid);
  const diffExpenses = r2(exp.mexalTotal - exp.paid);
  if (Math.abs(diffProducts) > RULES.maxRoundingDiff) problems.push('abbuono prodotti di ' + diffProducts.toFixed(2) + ' EUR (oltre ' + RULES.maxRoundingDiff.toFixed(2) + ')');
  if (Math.abs(diffExpenses) > RULES.maxRoundingDiff) problems.push('abbuono spese di ' + diffExpenses.toFixed(2) + ' EUR (oltre ' + RULES.maxRoundingDiff.toFixed(2) + ')');

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
  if (prod.rows.length) files.push({ name: tag + '_prodotti.csv', content: csv(DOC_COLUMNS, docRows('PRODOTTI', prod, ctx)) });
  if (exp.rows.length) files.push({ name: tag + '_spese.csv', content: csv(DOC_COLUMNS, docRows('SPESE', exp, ctx)) });

  return {
    ok: problems.length === 0,
    problems: problems,
    files: files,
    summary: { zone: zone, channel: channel, priceList: priceList,
      productsPaid: prod.paid, productsMexal: prod.mexalTotal, abbuonoProducts: diffProducts,
      expensesPaid: exp.paid, expensesMexal: exp.mexalTotal, abbuonoExpenses: diffExpenses }
  };
}

module.exports = { buildMexalCsv, RULES, zoneOf, discountPct, optimizeUnits, docTotalDomestic };
