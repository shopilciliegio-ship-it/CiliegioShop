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

function buildEmailHtml(isShop, customerName, customerEmail, customerPhone, customerAddress, paymentLabel, amount, currency, orderSummary) {
  // Parse order summary
  var lines = orderSummary.split('\n');
  var products = [];
  var totals = [];
  var inProducts = false;

  lines.forEach(function(line) {
    line = line.trim();
    if (!line) return;
    if (line.indexOf('PRODUCTS:') >= 0 || line.indexOf('*PRODUCTS:*') >= 0) { inProducts = true; return; }
    if (line.match(/^(Products Total|Discount|Import Duties|Shipping|FINAL TOTAL)/)) {
      inProducts = false;
      totals.push(line);
      return;
    }
    if (inProducts && line.indexOf('- ') === 0) {
      products.push(line.substring(2));
    }
  });

  var gold = '#D4AF37';

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
    '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee"><strong>Name</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerName + '</td></tr>' +
    '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee"><strong>Email</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerEmail + '</td></tr>' +
    (customerPhone ? '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee"><strong>Phone</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerPhone + '</td></tr>' : '') +
    (customerAddress ? '<tr><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee"><strong>Address</strong></td><td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee">' + customerAddress + '</td></tr>' : '') +
    '<tr><td style="padding:6px 12px;font-size:13px"><strong>Payment</strong></td><td style="padding:6px 12px;font-size:13px">✅ ' + paymentLabel + '</td></tr>';

  var productRows = products.map(function(p) {
    return '<tr><td style="padding:7px 12px;font-size:13px;border-bottom:1px solid #f5f5f5">' + p + '</td></tr>';
  }).join('');

  var totalRows = totals.map(function(t) {
    var isFinal = t.indexOf('FINAL TOTAL') >= 0;
    return '<tr><td style="padding:6px 12px;font-size:' + (isFinal?'15':'13') + 'px;' +
      (isFinal?'font-weight:bold;color:'+gold:'color:#444') + '">' + t.replace(/\*/g,'') + '</td></tr>';
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
    '<div>' +
    '<table style="width:100%;border-collapse:collapse;border:1px solid #eee">' + totalRows + '</table>' +
    '</div>' +
    '</div>';

  var footer = '<div style="background:#f5f5f5;padding:12px;text-align:center;font-size:11px;color:#888;border-top:2px solid ' + gold + '">' +
    'Il Ciliegio — Azienda Agricola | <a href="mailto:shop@ilciliegio.com" style="color:' + gold + '">shop@ilciliegio.com</a></div>';

  return '<div style="max-width:600px;margin:0 auto;border:1px solid #ddd;border-radius:4px;overflow:hidden">' +
    header + body + footer + '</div>';
}

function sendEmail(toEmail, toName, subject, html, brevoKey) {
  return new Promise(function(resolve) {
    const payload = JSON.stringify({
      sender:      { name: 'Il Ciliegio Shop', email: 'luca@sienawine.it' },
      to:          [{ email: toEmail, name: toName }],
      subject:     subject,
      htmlContent: html
    });
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
    const orderSummary    = m.order_summary    || '';
    const paymentMethod   = m.payment_method   || 'card';
    const amount          = (s.amount_total / 100).toFixed(2);
    const currency        = (s.currency || 'eur').toUpperCase();
    const paymentLabel    = paymentMethod === 'paypal' ? 'PayPal (+5%)' : 'Credit Card';

    const subjectShop     = '🍷 New Paid Order — ' + customerName + ' — ' + amount + ' ' + currency;
    const subjectCustomer = '🍷 Order confirmed — Il Ciliegio Shop';

    const shopHtml     = buildEmailHtml(true,  customerName, customerEmail, customerPhone, customerAddress, paymentLabel, amount, currency, orderSummary);
    const customerHtml = buildEmailHtml(false, customerName, customerEmail, customerPhone, customerAddress, paymentLabel, amount, currency, orderSummary);

    if (brevoKey) {
      await sendEmail('shop@ilciliegio.com', 'Il Ciliegio', subjectShop, shopHtml, brevoKey);
      if (customerEmail) {
        await sendEmail(customerEmail, customerName, subjectCustomer, customerHtml, brevoKey);
      }
    }
    console.log('Done:', customerName, amount, currency);
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) };
};
