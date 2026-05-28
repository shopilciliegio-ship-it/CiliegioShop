// Stripe webhook → sends email via Brevo
// No external dependencies
const https = require('https');
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
    const signed = timestamp + '.' + payload;
    const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
    return signatures.some(function(s) { return s === expected; });
  } catch(e) { return false; }
}

function sendBrevoEmail(subject, htmlContent, brevoKey) {
  return new Promise(function(resolve) {
    const payload = JSON.stringify({
      sender:      { name: 'Il Ciliegio Shop', email: 'luca@sienawine.it' },
      to:          [{ email: 'shop@ilciliegio.com', name: 'Il Ciliegio' }],
      subject:     subject,
      htmlContent: htmlContent
    });

    const options = {
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers: {
        'api-key':        brevoKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        console.log('Brevo status:', res.statusCode, data.substring(0,100));
        resolve();
      });
    });
    req.on('error', function(e) { console.error('Brevo error:', e.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

function sendBrevoEmailToCustomer(subject, htmlContent, brevoKey, customerEmail, customerName) {
  return new Promise(function(resolve) {
    if (!customerEmail) { resolve(); return; }
    const payload = JSON.stringify({
      sender:      { name: 'Il Ciliegio Shop', email: 'luca@sienawine.it' },
      to:          [{ email: customerEmail, name: customerName || 'Customer' }],
      subject:     subject,
      htmlContent: htmlContent
    });

    const options = {
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers: {
        'api-key':        brevoKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        console.log('Brevo customer email status:', res.statusCode);
        resolve();
      });
    });
    req.on('error', function(e) { console.error('Brevo customer error:', e.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const brevoKey     = process.env.BREVO_API_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig           = event.headers['stripe-signature'];

  // Verify Stripe signature
  if (webhookSecret && sig) {
    if (!verifyStripeSignature(event.body, sig, webhookSecret)) {
      return { statusCode: 400, body: 'Invalid signature' };
    }
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session       = stripeEvent.data.object;
    const customerName  = (session.metadata && session.metadata.customer_name)  || 'Unknown';
    const orderSummary  = (session.metadata && session.metadata.order_summary)  || 'No details';
    const paymentMethod = (session.metadata && session.metadata.payment_method) || 'card';
    const customerEmail = session.customer_email || '';
    const amount        = (session.amount_total / 100).toFixed(2);
    const currency      = (session.currency || 'eur').toUpperCase();
    const paymentLabel  = paymentMethod === 'paypal' ? 'PayPal (+5%)' : 'Credit Card';

    const subject = '🍷 New Paid Order — ' + customerName + ' — ' + amount + ' ' + currency;

    // Parse order summary into structured lines
    var lines = orderSummary.split('\n');
    var productsHtml = '';
    var totalsHtml = '';
    var inProducts = false;
    lines.forEach(function(line) {
      line = line.trim();
      if (!line) return;
      if (line.indexOf('PRODUCTS:') >= 0) { inProducts = true; return; }
      if (line.indexOf('Products Total:') >= 0 || line.indexOf('Discount') >= 0 ||
          line.indexOf('Import Duties') >= 0 || line.indexOf('Shipping') >= 0 ||
          line.indexOf('FINAL TOTAL') >= 0) {
        inProducts = false;
        var isFinal = line.indexOf('FINAL TOTAL') >= 0;
        totalsHtml += '<tr><td style="padding:4px 8px;' + (isFinal?'font-weight:bold;font-size:15px;color:#D4AF37':'color:#555') + '">' +
          line.replace(/^-?\s*/, '') + '</td></tr>';
        return;
      }
      if (inProducts && line.indexOf('- ') === 0) {
        productsHtml += '<tr><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">' +
          line.substring(2) + '</td></tr>';
      }
    });

    var emailHeader = '<div style="background:#000;padding:20px;text-align:center">' +
      '<div style="color:#D4AF37;font-size:22px;font-weight:bold;letter-spacing:2px">IL CILIEGIO</div>' +
      '<div style="color:#888;font-size:11px;letter-spacing:3px">AZIENDA AGRICOLA</div></div>';

    var orderTable = '<table style="width:100%;border-collapse:collapse;margin:12px 0">' +
      '<thead><tr><td style="background:#f8f8f8;padding:8px;font-weight:bold;font-size:12px;color:#333;text-transform:uppercase;letter-spacing:1px">Products</td></tr></thead>' +
      '<tbody>' + productsHtml + '</tbody></table>' +
      '<table style="width:100%;border-collapse:collapse;margin:8px 0">' +
      '<tbody>' + totalsHtml + '</tbody></table>';

    var customerBlock = '<table style="width:100%;border-collapse:collapse;margin:12px 0;background:#f9f9f9;border-radius:6px">' +
      '<tr><td style="padding:8px 12px;font-size:12px"><strong>Name:</strong> ' + customerName + '</td></tr>' +
      '<tr><td style="padding:8px 12px;font-size:12px"><strong>Email:</strong> ' + customerEmail + '</td></tr>' +
      '<tr><td style="padding:8px 12px;font-size:12px"><strong>Payment:</strong> ✅ ' + paymentLabel + ' — ' + amount + ' ' + currency + '</td></tr>' +
      '</table>';

    var footer = '<div style="background:#f5f5f5;padding:12px;text-align:center;font-size:11px;color:#888;margin-top:20px">' +
      'Il Ciliegio — Azienda Agricola | <a href="mailto:shop@ilciliegio.com" style="color:#D4AF37">shop@ilciliegio.com</a></div>';

    var shopHtml = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:8px;overflow:hidden">' +
      emailHeader +
      '<div style="padding:20px">' +
      '<h2 style="color:#D4AF37;font-size:18px;margin-bottom:4px">🍷 New Paid Order</h2>' +
      '<p style="color:#888;font-size:12px;margin-top:0">This order has been paid — please prepare and ship it.</p>' +
      customerBlock + orderTable + '</div>' + footer + '</div>';

    var customerHtml = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:8px;overflow:hidden">' +
      emailHeader +
      '<div style="padding:20px">' +
      '<h2 style="color:#D4AF37;font-size:18px;margin-bottom:4px">🍷 Thank you for your order!</h2>' +
      '<p style="color:#555;font-size:14px">Dear <strong>' + customerName + '</strong>, your payment of <strong>' + amount + ' ' + currency + '</strong> via <strong>' + paymentLabel + '</strong> has been confirmed.</p>' +
      '<p style="color:#555;font-size:13px">We will contact you shortly to arrange shipping.</p>' +
      orderTable + '</div>' + footer + '</div>';

    if (brevoKey) {
      await sendBrevoEmail(subject, shopHtml, brevoKey);
      await sendBrevoEmailToCustomer(
        '🍷 Order confirmed — Il Ciliegio Shop',
        customerHtml, brevoKey, customerEmail, customerName
      );
    } else {
      console.log('No BREVO_API_KEY — skipping email');
    }

    console.log('Order processed:', customerName, amount, currency);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ received: true })
  };
};