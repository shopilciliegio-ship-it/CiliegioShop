const https  = require('https');
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

async function consumePromo(code) {
  if (!code) return;
  try {
    const store = getStore('promos');
    const promo = await store.get(code, { type: 'json' });
    if (!promo) return;
    promo.usesCount = (promo.usesCount || 0) + 1;
    if (promo.maxUses != null && promo.usesCount >= promo.maxUses) promo.active = false;
    await store.setJSON(code, promo);
  } catch (e) { console.error('Promo consume error:', e.message); }
}

// Guards against two customers producing the same shipment code (e.g. two
// "Sala" family members): appends 2, 3, ... until a free code is found, and
// persists the choice so later orders keep avoiding it.
async function uniqueShipmentCode(baseCode) {
  try {
    const store = getStore('shipment-codes');
    let code = baseCode;
    let n = 2;
    while (await store.get(code) != null) {
      code = baseCode + n;
      n++;
    }
    await store.set(code, new Date().toISOString());
    return code;
  } catch (e) {
    console.error('Shipment code dedup error:', e.message);
    return baseCode;
  }
}

function verifyStripeSignature(payload, sig, secret) {
  try {
    const parts = sig.split(',');
    let timestamp = '';
    const signatures = [];
    parts.forEach(function(p) {
      const kv = p.split('=');
      if (kv[0] === 't') timestamp = kv[1];
      if (kv[0] === 'v1') signatures.push(kv[1]);
    });
    const expected = crypto.createHmac('sha256', secret)
      .update(timestamp + '.' + payload).digest('hex');
    return signatures.some(function(s) { return s === expected; });
  } catch(e) { return false; }
}

function buildEmailHtml(isShop, customerName, customerEmail, customerPhone, customerAddress, paymentLabel, amount, currency, orderProducts, orderTotals, isQuote) {
  var gold = '#D4AF37';

  var products = orderProducts ? orderProducts.split('|').map(function(p){ return p.trim(); }).filter(Boolean) : [];
  var totals = orderTotals ? orderTotals.split('|').map(function(t){ return t.trim(); }).filter(Boolean) : [];

  var header = '<div style="background:#111;padding:24px 20px;text-align:center">' +
    '<div style="color:' + gold + ';font-size:24px;font-weight:bold;letter-spacing:3px;font-family:Georgia,serif">IL CILIEGIO</div>' +
    '<div style="color:#888;font-size:11px;letter-spacing:4px;margin-top:4px">AZIENDA AGRICOLA</div>' +
    '</div>';

  var title = isQuote
    ? (isShop
        ? '<h2 style="color:' + gold + ';font-size:18px;margin:0 0 4px 0">🔔 New Order Request — No Payment Yet</h2>' +
          '<p style="color:#666;font-size:12px;margin:0 0 20px 0">We have no shipping rate for this country. Check feasibility, then contact the customer with a quote and a payment link.</p>'
        : '<h2 style="color:' + gold + ';font-size:18px;margin:0 0 8px 0">🍷 Thank you, ' + customerName + '!</h2>' +
          '<p style="color:#555;font-size:13px;margin:0 0 20px 0">We received your order request. <strong>No payment has been taken.</strong> We will check whether we can ship to your address and contact you shortly with a shipping quote and a payment link.</p>')
    : isShop
      ? '<h2 style="color:' + gold + ';font-size:18px;margin:0 0 4px 0">🍷 New Paid Order</h2>' +
        '<p style="color:#666;font-size:12px;margin:0 0 20px 0">This order has been paid — please prepare and ship it.</p>'
      : '<h2 style="color:' + gold + ';font-size:18px;margin:0 0 8px 0">🍷 Thank you, ' + customerName + '!</h2>' +
        '<p style="color:#555;font-size:13px;margin:0 0 20px 0">Your payment of <strong>' + amount + ' ' + currency + '</strong> via <strong>' + paymentLabel + '</strong> has been confirmed. We will contact you shortly to arrange shipping.</p>';

  var customerRows =
    '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee;width:120px"><strong>Name</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerName + '</td></tr>' +
    '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee"><strong>Email</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerEmail + '</td></tr>' +
    (customerPhone ? '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee"><strong>Phone</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerPhone + '</td></tr>' : '') +
    (customerAddress ? '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee"><strong>Address</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerAddress + '</td></tr>' : '') +
    '<tr><td style="padding:6px 12px;font-size:13px"><strong>Payment</strong></td><td style="padding:6px 12px;font-size:13px">' + (isQuote ? '⏳ ' : '✅ ') + paymentLabel + '</td></tr>';

  var productRows = products.map(function(p) {
    return '<tr><td style="padding:7px 12px;font-size:13px;border-bottom:1px solid #f5f5f5">' + p + '</td></tr>';
  }).join('');

  var totalRows = totals.map(function(t) {
    var isFinal = t.indexOf('FINAL TOTAL') >= 0;
    return '<tr><td style="padding:6px 12px;font-size:' + (isFinal ? '15' : '13') + 'px;' +
      (isFinal ? 'font-weight:bold;color:' + gold : 'color:#444') + '">' + t.replace(/\*/g, '') + '</td></tr>';
  }).join('');

  var body = '<div style="padding:24px 20px;font-family:Arial,sans-serif">' +
    title +
    '<div style="margin-bottom:20px">' +
    '<div style="background:' + gold + ';color:#000;font-size:11px;font-weight:bold;padding:6px 12px;letter-spacing:1px;text-transform:uppercase">Customer</div>' +
    '<table style="width:100%;border-collapse:collapse;border:1px solid #eee">' + customerRows + '</table>' +
    '</div>' +
    '<div style="margin-bottom:16px">' +
    '<div style="background:' + gold + ';color:#000;font-size:11px;font-weight:bold;padding:6px 12px;letter-spacing:1px;text-transform:uppercase">Products</div>' +
    '<table style="width:100%;border-collapse:collapse;border:1px solid #eee">' + productRows + '</table>' +
    '</div>' +
    (totalRows ? '<div><table style="width:100%;border-collapse:collapse;border:1px solid #eee">' + totalRows + '</table></div>' : '') +
    '</div>';

  var footer = '<div style="background:#f5f5f5;padding:12px;text-align:center;font-size:11px;color:#888;border-top:2px solid ' + gold + '">' +
    'Il Ciliegio — Azienda Agricola | <a href="mailto:shop@ilciliegio.com" style="color:' + gold + '">shop@ilciliegio.com</a></div>';

  return '<div style="max-width:600px;margin:0 auto;border:1px solid #ddd;border-radius:4px;overflow:hidden">' +
    header + body + footer + '</div>';
}

function buildClubEventHtml(title, facts) {
  var gold = '#D4AF37';
  var rows = Object.keys(facts).map(function(k) {
    return '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee;width:140px"><strong>' + k + '</strong></td>' +
      '<td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + (facts[k] || '—') + '</td></tr>';
  }).join('');
  return '<div style="max-width:600px;margin:0 auto;border:1px solid #ddd;border-radius:4px;overflow:hidden;font-family:Arial,sans-serif">' +
    '<div style="background:#111;padding:24px 20px;text-align:center">' +
    '<div style="color:' + gold + ';font-size:24px;font-weight:bold;letter-spacing:3px;font-family:Georgia,serif">IL CILIEGIO</div>' +
    '<div style="color:#888;font-size:11px;letter-spacing:4px;margin-top:4px">WINE CLUB</div></div>' +
    '<div style="padding:24px 20px">' +
    '<h2 style="color:' + gold + ';font-size:17px;margin:0 0 16px 0">' + title + '</h2>' +
    '<table style="width:100%;border-collapse:collapse;border:1px solid #eee">' + rows + '</table></div>' +
    '<div style="background:#f5f5f5;padding:12px;text-align:center;font-size:11px;color:#888;border-top:2px solid ' + gold + '">' +
    'Il Ciliegio — Azienda Agricola | <a href="mailto:shop@ilciliegio.com" style="color:' + gold + '">shop@ilciliegio.com</a></div></div>';
}

function sendEmail(toEmail, toName, subject, html, brevoKey, attachment) {
  return new Promise(function(resolve) {
    const data = {
      sender:      { name: 'Il Ciliegio Shop', email: 'luca@sienawine.it' },
      to:          [{ email: toEmail, name: toName }],
      subject:     subject,
      htmlContent: html
    };
    if (attachment) data.attachment = [attachment];
    const payload = JSON.stringify(data);
    const options = {
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers:  { 'api-key': brevoKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(options, function(res) {
      let d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() { console.log('Email to', toEmail, ':', res.statusCode); resolve(); });
    });
    req.on('error', function(e) { console.error('Email error:', e.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

function safeText(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E€]/g, '?');
}

async function buildMosPdf(customerName, customerEmail, customerPhone, customerAddress, orderProducts, orderTotals) {
  const { PDFDocument, StandardFonts, PDFName } = require('pdf-lib');
  const mosTemplateBase64 = require('./mos-template');

  // Name → firstName, lastName, shipment code (PATTAROL)
  const nameParts = customerName.trim().split(/\s+/);
  const lastName  = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0];
  const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';
  const baseShipmentCode = (lastName + (firstName ? firstName[0] : '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const shipmentCode = await uniqueShipmentCode(baseShipmentCode);

  // Address: "Via Roma 1, 53100 Siena, Italy" or "Via Roma 1, 53100 Siena, Italy (SI)"
  let street = '', zip = '', city = '', stateCountry = '';
  if (customerAddress) {
    const parts = customerAddress.split(/,\s*/);
    street = parts[0] || '';
    if (parts.length >= 2) {
      const m = parts[1].trim().match(/^(\d[\d-]*\d|\d)\s+(.+)$/);
      if (m) { zip = m[1]; city = m[2]; }
      else   { city = parts[1].trim(); }
    }
    if (parts.length >= 3) stateCountry = parts.slice(2).join(', ').trim();
  }

  // Products: "3x Brunello 2018 (€87.00)|1x Rosso 2020 (€28.00)"
  const products = (orderProducts || '').split('|').map(function(p) {
    p = p.trim();
    const m = p.match(/^(\d+)x\s+(.*?)\s*\(([^)]*)\)\s*$/);
    if (!m) return null;
    const qty = parseInt(m[1]);
    const unitPrice = m[3].startsWith('€') ? parseFloat(m[3].slice(1)) || 0 : 0;
    return { qty: qty, name: m[2], lineValue: qty * unitPrice };
  }).filter(Boolean);

  // Shipping type and cost from totals
  let shippingType = 'STANDARD', shippingCost = '0.00';
  (orderTotals || '').split('|').forEach(function(t) {
    if (!/shipping/i.test(t)) return;
    const tm = t.match(/Shipping\s*\(([^)]+)\)/i);
    if (tm) shippingType = /express/i.test(tm[1]) ? 'EXPRESS 30' : 'STANDARD';
    const pm = t.match(/€([\d.]+)/);
    if (pm) shippingCost = pm[1];
  });

  // Number of cartons: 6 bottles per carton
  const totalBottles = products.reduce(function(s, p) { return s + p.qty; }, 0);
  const cartons = Math.max(1, Math.ceil(totalBottles / 6));

  // Adjust shipping cost for MOS: -5€ for 3 or 6 bottles, -10€ for all other quantities
  const shippingDeduction = (totalBottles === 3 || totalBottles === 6) ? 5 : 10;
  shippingCost = Math.max(0, parseFloat(shippingCost) - shippingDeduction).toFixed(2);

  // Load the real Fieramente MOS form and fill its fields directly
  const pdfDoc  = await PDFDocument.load(Buffer.from(mosTemplateBase64, 'base64'));
  const measureFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const form    = pdfDoc.getForm();

  // Shrinks the font (down to a floor) so the value fits the field's own width,
  // since these single-line fields don't wrap and would otherwise overflow the box.
  const setTxt = function(fieldName, value, size) {
    const field = form.getTextField(fieldName);
    const text  = safeText(value || '');
    const maxW  = field.acroField.getWidgets()[0].getRectangle().width - 6;
    let fontSize = size || 9;
    while (fontSize > 5 && measureFont.widthOfTextAtSize(text, fontSize) > maxW) fontSize -= 0.5;
    field.setFontSize(fontSize);
    field.setText(text);
    // Widgets carry their own /DA (usually the original template's fixed size),
    // which otherwise wins over the field-level size we just set.
    field.acroField.getWidgets().forEach(function(w) { w.dict.delete(PDFName.of('DA')); });
  };
  const setChk = function(fieldName, checked) {
    const field = form.getCheckBox(fieldName);
    if (checked) field.check(); else field.uncheck();
  };

  setTxt('text_2othq', shipmentCode, 12);                                    // SHIPMENT CODE
  setTxt('text_4ezat', (firstName + ' ' + lastName).trim().toUpperCase());   // NAME
  setTxt('text_6daor', street.toUpperCase());                                // ADDRESS
  setTxt('text_7ktyf', city.toUpperCase());                                  // CITY
  setTxt('text_8iwze', zip);                                                 // ZIP CODE
  setTxt('text_9wqbl', stateCountry.toUpperCase());                          // STATE / COUNTRY
  setTxt('text_10cfnx', customerPhone);                                      // PHONE
  setTxt('text_11idhv', customerEmail);                                      // EMAIL

  // Product rows: template has 8 fixed rows (qty / description / value each)
  const rowFields = [
    ['text_12bmpo', 'text_13aijv', 'text_14tbmq'],
    ['text_15rbv',  'text_16uqhq', 'text_17hwko'],
    ['text_18oigy', 'text_19wznr', 'text_20cepq'],
    ['text_21mjuv', 'text_22sjlf', 'text_23ojur'],
    ['text_24koai', 'text_25nqpu', 'text_26ygjl'],
    ['text_27gutj', 'text_28gjvu', 'text_29tixe'],
    ['text_30tpqc', 'text_31fnze', 'text_32ayuh'],
    ['text_33otru', 'text_35udmd', 'text_36ktod']
  ];
  const rows = products.slice(0, rowFields.length - 1);
  if (products.length > rowFields.length - 1) {
    const overflow = products.slice(rowFields.length - 1);
    rows.push({
      qty: overflow.reduce(function(s, p) { return s + p.qty; }, 0),
      name: overflow.map(function(p) { return p.qty + 'x ' + p.name; }).join('; '),
      lineValue: overflow.reduce(function(s, p) { return s + p.lineValue; }, 0)
    });
  }
  rows.forEach(function(p, i) {
    const qf = rowFields[i][0], df = rowFields[i][1], vf = rowFields[i][2];
    setTxt(qf, String(p.qty));
    setTxt(df, p.name.toUpperCase());
    if (p.lineValue > 0) setTxt(vf, '€ ' + p.lineValue.toFixed(2));
  });

  setChk('checkbox_39nucj', true);                                 // INVOICE TO SENDER/WINERY
  setChk('checkbox_69dycu', shippingType === 'STANDARD');           // STANDARD
  setChk('checkbox_70pzpv', shippingType === 'EXPRESS 30');         // EXPRESS 30
  setTxt('text_75yffy', '€ ' + shippingCost);                       // TOTAL SHIPPING CHARGES
  setTxt('text_76wlyk', String(cartons));                          // NUMBER OF CARTONS

  const pdfBytes = await pdfDoc.save();
  return {
    content: Buffer.from(pdfBytes).toString('base64'),
    name: shipmentCode + '.pdf'
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  connectLambda(event);

  const brevoKey      = process.env.BREVO_API_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig           = event.headers['stripe-signature'];

  if (webhookSecret && sig && !verifyStripeSignature(event.body, sig, webhookSecret)) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: 'Bad JSON' }; }

  if (stripeEvent.type === 'checkout.session.completed' && stripeEvent.data.object.mode === 'subscription') {
    const s = stripeEvent.data.object;
    const m = s.metadata || {};
    const customerName    = m.customer_name    || 'Unknown';
    const customerEmail   = m.customer_email   || s.customer_email || '';
    const customerPhone   = m.customer_phone   || '';
    const customerAddress = m.customer_address || '';
    const tier             = m.wine_club_tier   || '';
    const amount           = (s.amount_total / 100).toFixed(2);
    const currency         = (s.currency || 'eur').toUpperCase();

    if (brevoKey) {
      const html = buildClubEventHtml('🍷 Nuovo abbonato Wine Club', {
        'Cliente': customerName, 'Email': customerEmail, 'Telefono': customerPhone,
        'Indirizzo': customerAddress, 'Tier': tier, 'Importo (ogni 4 mesi)': amount + ' ' + currency,
      });
      await sendEmail('shop@ilciliegio.com', 'Il Ciliegio', '🍷 Nuovo abbonato Wine Club — ' + customerName, html, brevoKey);
      await sendEmail('shop.ilciliegio@gmail.com', 'Il Ciliegio CRM', '🍷 Nuovo abbonato Wine Club — ' + customerName, html, brevoKey);
    }
    console.log('Wine Club subscription started:', customerName, tier);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) };
  }

  if (stripeEvent.type === 'invoice.payment_succeeded') {
    const inv = stripeEvent.data.object;
    if (inv.billing_reason === 'subscription_cycle' || inv.billing_reason === 'subscription_create') {
      const lineMeta = (inv.lines && inv.lines.data[0] && inv.lines.data[0].metadata) || {};
      const isRenewal = inv.billing_reason === 'subscription_cycle';
      if (brevoKey) {
        const html = buildClubEventHtml(isRenewal ? '🔁 Rinnovo Wine Club — prepara la spedizione' : '🍷 Primo pagamento Wine Club confermato', {
          'Cliente': lineMeta.customer_name || inv.customer_email || 'N/A',
          'Email': inv.customer_email || '',
          'Tier': lineMeta.wine_club_tier || '',
          'Importo': (inv.amount_paid / 100).toFixed(2) + ' ' + (inv.currency || 'eur').toUpperCase(),
        });
        if (isRenewal) await sendEmail('shop@ilciliegio.com', 'Il Ciliegio', '🔁 Rinnovo Wine Club', html, brevoKey);
      }
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) };
  }

  if (stripeEvent.type === 'invoice.payment_failed') {
    const inv = stripeEvent.data.object;
    if (brevoKey) {
      const html = buildClubEventHtml('⚠️ Pagamento Wine Club fallito', {
        'Email': inv.customer_email || '',
        'Importo': (inv.amount_due / 100).toFixed(2) + ' ' + (inv.currency || 'eur').toUpperCase(),
      });
      await sendEmail('shop@ilciliegio.com', 'Il Ciliegio', '⚠️ Pagamento Wine Club fallito', html, brevoKey);
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) };
  }

  if (stripeEvent.type === 'customer.subscription.deleted') {
    const sub = stripeEvent.data.object;
    const m = sub.metadata || {};
    if (brevoKey) {
      const html = buildClubEventHtml('Abbonamento Wine Club cancellato', {
        'Cliente': m.customer_name || 'N/A', 'Indirizzo': m.customer_address || '', 'Tier': m.wine_club_tier || '',
      });
      await sendEmail('shop@ilciliegio.com', 'Il Ciliegio', 'Abbonamento Wine Club cancellato', html, brevoKey);
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const s = stripeEvent.data.object;
    const m = s.metadata || {};

    const customerName    = m.customer_name    || 'Unknown';
    const customerEmail   = m.customer_email   || s.customer_email || '';
    const customerPhone   = m.customer_phone   || '';
    const customerAddress = m.customer_address || '';
    const orderProducts   = m.order_products   || '';
    const orderTotals     = m.order_totals     || '';
    const paymentMethod   = m.payment_method   || 'card';
    const promoCode       = m.promo_code       || '';
    const isQuoteRequest  = paymentMethod === 'quote_request';
    const amount          = (s.amount_total / 100).toFixed(2);
    const currency        = (s.currency || 'eur').toUpperCase();
    const paymentLabel    = paymentMethod === 'paypal' ? 'PayPal (+5%)' : paymentMethod === 'direct_sale' ? 'Direct Sale (Paid at Farm)' : isQuoteRequest ? 'Quote Requested (Not Paid)' : 'Credit Card';

    // Quote requests haven't been paid yet, so the promo isn't consumed here —
    // it will be consumed at actual checkout once we send the customer a payment link.
    if (!isQuoteRequest) await consumePromo(promoCode);

    const subjectShop     = isQuoteRequest
      ? '🔔 Order Request (no rate yet) — ' + customerName
      : '🍷 New Order — ' + customerName + ' — ' + amount + ' ' + currency;
    const subjectCustomer = isQuoteRequest
      ? '🍷 Order request received — Il Ciliegio Shop'
      : '🍷 Order confirmed — Il Ciliegio Shop';

    const shopHtml     = buildEmailHtml(true,  customerName, customerEmail, customerPhone, customerAddress, paymentLabel, amount, currency, orderProducts, orderTotals, isQuoteRequest);
    const customerHtml = buildEmailHtml(false, customerName, customerEmail, customerPhone, customerAddress, paymentLabel, amount, currency, orderProducts, orderTotals, isQuoteRequest);

    // Generate MOS Fieramente PDF attachment — skipped for quote requests since
    // shipping (and therefore the shipment paperwork) isn't confirmed yet.
    let mosAttachment = null;
    if (!isQuoteRequest) {
      try {
        mosAttachment = await buildMosPdf(customerName, customerEmail, customerPhone, customerAddress, orderProducts, orderTotals);
        console.log('MOS PDF generated:', mosAttachment.name);
      } catch(e) {
        console.error('MOS PDF error:', e.message);
      }
    }

    if (brevoKey) {
      await sendEmail('shop@ilciliegio.com', 'Il Ciliegio', subjectShop, shopHtml, brevoKey, mosAttachment);
      await sendEmail('shop.ilciliegio@gmail.com', 'Il Ciliegio CRM', subjectShop, shopHtml, brevoKey, mosAttachment);
      if (customerEmail) {
        await sendEmail(customerEmail, customerName, subjectCustomer, customerHtml, brevoKey);
      }
    }
    console.log('Done:', customerName, amount, currency);
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) };
};
