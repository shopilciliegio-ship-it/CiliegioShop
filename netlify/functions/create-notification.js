const https  = require('https');
const crypto = require('crypto');

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

function buildEmailHtml(isShop, customerName, customerEmail, customerPhone, customerAddress, paymentLabel, amount, currency, orderProducts, orderTotals) {
  var gold = '#D4AF37';

  var products = orderProducts ? orderProducts.split('|').map(function(p){ return p.trim(); }).filter(Boolean) : [];
  var totals = orderTotals ? orderTotals.split('|').map(function(t){ return t.trim(); }).filter(Boolean) : [];

  var header = '<div style="background:#111;padding:24px 20px;text-align:center">' +
    '<div style="color:' + gold + ';font-size:24px;font-weight:bold;letter-spacing:3px;font-family:Georgia,serif">IL CILIEGIO</div>' +
    '<div style="color:#888;font-size:11px;letter-spacing:4px;margin-top:4px">AZIENDA AGRICOLA</div>' +
    '</div>';

  var title = isShop
    ? '<h2 style="color:' + gold + ';font-size:18px;margin:0 0 4px 0">🍷 New Paid Order</h2>' +
      '<p style="color:#666;font-size:12px;margin:0 0 20px 0">This order has been paid — please prepare and ship it.</p>'
    : '<h2 style="color:' + gold + ';font-size:18px;margin:0 0 8px 0">🍷 Thank you, ' + customerName + '!</h2>' +
      '<p style="color:#555;font-size:13px;margin:0 0 20px 0">Your payment of <strong>' + amount + ' ' + currency + '</strong> via <strong>' + paymentLabel + '</strong> has been confirmed. We will contact you shortly to arrange shipping.</p>';

  var customerRows =
    '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee;width:120px"><strong>Name</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerName + '</td></tr>' +
    '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee"><strong>Email</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerEmail + '</td></tr>' +
    (customerPhone ? '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee"><strong>Phone</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerPhone + '</td></tr>' : '') +
    (customerAddress ? '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee"><strong>Address</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerAddress + '</td></tr>' : '') +
    '<tr><td style="padding:6px 12px;font-size:13px"><strong>Payment</strong></td><td style="padding:6px 12px;font-size:13px">✅ ' + paymentLabel + '</td></tr>';

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

async function buildMosPdf(customerName, customerEmail, customerPhone, customerAddress, orderProducts, orderTotals) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

  // Name → firstName, lastName, shipment code (PATTAROL)
  const nameParts = customerName.trim().split(/\s+/);
  const lastName  = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0];
  const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';
  const shipmentCode = (lastName + (firstName ? firstName[0] : '')).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Address: "Via Roma 1, 53100 Siena, Italy" or "Via Roma 1, 53100 Siena, Italy (SI)"
  let street = '', zip = '', city = '', stateCountry = '';
  if (customerAddress) {
    const parts = customerAddress.split(/,\s*/);
    street = parts[0] || '';
    if (parts.length >= 2) {
      const m = parts[1].trim().match(/^(\d+)\s+(.+)$/);
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

  // Build PDF (A4 portrait)
  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([595, 842]);
  const W = 595, H = 842;
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const K  = rgb(0, 0, 0);
  const W_ = rgb(1, 1, 1);
  const LG = rgb(0.92, 0.92, 0.92);
  const DG = rgb(0.15, 0.15, 0.15);
  const MG = rgb(0.55, 0.55, 0.55);

  const txt = function(s, x, y, sz, fn, cl) {
    page.drawText(String(s || ''), { x: x, y: y, size: sz || 9, font: fn || fontR, color: cl || K });
  };
  const rct = function(x, y, w, h, fill, bc, bw) {
    page.drawRectangle({ x: x, y: y, width: w, height: h,
      ...(fill !== null && fill !== undefined ? { color: fill } : {}),
      ...(bc   !== null && bc   !== undefined ? { borderColor: bc, borderWidth: bw || 0.5 } : {}) });
  };
  const hln = function(x1, y, x2, th) {
    page.drawLine({ start: { x: x1, y: y }, end: { x: x2, y: y }, thickness: th || 0.5, color: MG });
  };
  const vln = function(x, y1, y2, th) {
    page.drawLine({ start: { x: x, y: y1 }, end: { x: x, y: y2 }, thickness: th || 0.5, color: MG });
  };

  let y = H - 35;

  // Header
  txt('FIERAMENTE', 30, y, 20, fontB, DG);
  txt('MERCHANT ORDER SHEET', 30, y - 14, 8, fontR, MG);
  txt('www.fieramente.biz', 30, y - 24, 8, fontR, rgb(0.3, 0.3, 0.7));
  rct(390, y - 22, 175, 28, LG, MG, 0.5);
  txt('SHIPMENT CODE', 397, y - 10, 7, fontR, MG);
  txt(shipmentCode, 397, y - 22, 12, fontB, K);
  y -= 45;

  hln(30, y, W - 30, 0.5);
  y -= 12;

  // Sender box
  rct(30, y - 55, 175, 58, LG, MG, 0.5);
  txt('SENDER', 36, y - 8,  7, fontR, MG);
  txt('SIENA WINE SRL',                    36, y - 20, 8, fontB, K);
  txt('Via Uopini, 94',                    36, y - 31, 8, fontR, K);
  txt('Monteriggioni - 53035 - Siena',     36, y - 42, 8, fontR, K);
  txt('P.IVA 01511110528  SDI 5RUO82D',   36, y - 53, 7, fontR, MG);
  y -= 70;

  // Recipient header bar
  rct(30, y - 2, W - 60, 14, DG);
  txt('RECIPIENT', 36, y + 1, 8, fontB, W_);
  y -= 16;

  // Field helper: label above, value on underline
  const fld = function(label, val, fx, fy, fw, keepCase) {
    txt(label, fx, fy + 10, 7, fontR, MG);
    hln(fx, fy, fx + fw, 0.5);
    txt(keepCase ? (val || '') : (val || '').toUpperCase(), fx, fy + 1, 9, fontB, K);
  };

  fld('FIRST NAME', firstName, 30, y, 240);
  fld('LAST NAME',  lastName,  285, y, W - 315);
  y -= 24;
  fld('ADDRESS', street, 30, y, W - 60);
  y -= 24;
  fld('CITY',           city,         30,  y, 210);
  fld('ZIP CODE',       zip,          255, y, 110);
  fld('STATE / COUNTRY', stateCountry, 380, y, W - 410);
  y -= 24;
  fld('PHONE', customerPhone, 30,  y, 250);
  fld('EMAIL', customerEmail, 295, y, W - 325, true);
  y -= 32;

  hln(30, y, W - 30, 0.5);
  y -= 10;

  // Products table header
  rct(30, y - 2, W - 60, 14, DG);
  txt('QTY',                         36,  y + 1, 8, fontB, W_);
  txt('DESCRIPTION OF THE GOODS',   110,  y + 1, 8, fontB, W_);
  txt('VALUE',                       510,  y + 1, 8, fontB, W_);
  y -= 16;

  const RH = 16, C1 = 105, C2 = 505;
  const emptyR  = products.length > 12 ? 1 : 2;
  const totalR  = products.length + emptyR;
  const tableTopY = y;

  for (var i = 0; i < totalR; i++) {
    const ry = y - i * RH;
    if (i % 2 === 0) rct(30, ry - RH + 2, W - 60, RH, LG);
    hln(30, ry - RH + 2, W - 30, 0.3);
    vln(C1, ry - RH + 2, ry + 2, 0.3);
    vln(C2, ry - RH + 2, ry + 2, 0.3);
    if (i < products.length) {
      const p = products[i];
      txt(String(p.qty), 55, ry - RH + 5, 9, fontB, K);
      const nm = p.name.length > 65 ? p.name.slice(0, 65) + '..' : p.name;
      txt(nm.toUpperCase(), 110, ry - RH + 5, 9, fontR, K);
      if (p.lineValue > 0) txt('€ ' + p.lineValue.toFixed(2), 508, ry - RH + 5, 9, fontR, K);
    }
  }
  rct(30, tableTopY - totalR * RH + 2, W - 60, 26 + totalR * RH, null, MG, 0.5);
  y = tableTopY - totalR * RH - 13;

  // Shipping instructions header
  rct(30, y - 2, W - 60, 14, DG);
  txt('SHIPPING INSTRUCTIONS', 36, y + 1, 8, fontB, W_);
  y -= 24;

  // Checkboxes
  const isStd = shippingType === 'STANDARD';
  const isExp = !isStd;
  rct(30,  y, 12, 12, isStd ? DG : W_, MG, 1);
  if (isStd) txt('X', 33, y + 2, 8, fontB, W_);
  txt('STANDARD', 48, y + 2, 9, fontB, K);

  rct(140, y, 12, 12, isExp ? DG : W_, MG, 1);
  if (isExp) txt('X', 143, y + 2, 8, fontB, W_);
  txt('EXPRESS 30', 158, y + 2, 9, fontB, K);
  y -= 28;

  // Shipping cost + cartons
  rct(30,  y - 10, 195, 32, LG, MG, 0.5);
  txt('TOTAL SHIPPING CHARGES', 36, y + 14, 7, fontR, MG);
  txt('€ ' + shippingCost, 36, y - 5, 11, fontB, K);

  rct(245, y - 10, 140, 32, LG, MG, 0.5);
  txt('NUMBER OF CARTONS', 250, y + 14, 7, fontR, MG);
  txt(String(cartons), 250, y - 5, 11, fontB, K);
  y -= 52;

  // Footer
  const d  = new Date();
  const ds = String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
  txt('Date: ' + ds, 30, y, 8, fontR, MG);
  txt('Il Ciliegio — Azienda Agricola  |  shop@ilciliegio.com', 30, y - 14, 8, fontR, MG);

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

  const brevoKey      = process.env.BREVO_API_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig           = event.headers['stripe-signature'];

  if (webhookSecret && sig && !verifyStripeSignature(event.body, sig, webhookSecret)) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: 'Bad JSON' }; }

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
    const amount          = (s.amount_total / 100).toFixed(2);
    const currency        = (s.currency || 'eur').toUpperCase();
    const paymentLabel    = paymentMethod === 'paypal' ? 'PayPal (+5%)' : paymentMethod === 'direct_sale' ? 'Direct Sale (Paid at Farm)' : 'Credit Card';

    const subjectShop     = '🍷 New Order — ' + customerName + ' — ' + amount + ' ' + currency;
    const subjectCustomer = '🍷 Order confirmed — Il Ciliegio Shop';

    const shopHtml     = buildEmailHtml(true,  customerName, customerEmail, customerPhone, customerAddress, paymentLabel, amount, currency, orderProducts, orderTotals);
    const customerHtml = buildEmailHtml(false, customerName, customerEmail, customerPhone, customerAddress, paymentLabel, amount, currency, orderProducts, orderTotals);

    // Generate MOS Fieramente PDF attachment
    let mosAttachment = null;
    try {
      mosAttachment = await buildMosPdf(customerName, customerEmail, customerPhone, customerAddress, orderProducts, orderTotals);
      console.log('MOS PDF generated:', mosAttachment.name);
    } catch(e) {
      console.error('MOS PDF error:', e.message);
    }

    if (brevoKey) {
      await sendEmail('shop@ilciliegio.com', 'Il Ciliegio', subjectShop, shopHtml, brevoKey, mosAttachment);
      await sendEmail('shop.ilciliegio@gmail.com', 'Il Ciliegio CRM', subjectShop, shopHtml, brevoKey);
      if (customerEmail) {
        await sendEmail(customerEmail, customerName, subjectCustomer, customerHtml, brevoKey);
      }
    }
    console.log('Done:', customerName, amount, currency);
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) };
};
