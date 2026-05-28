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

    const shopHtml = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto">' +
      '<h2 style="color:#D4AF37;border-bottom:2px solid #D4AF37;padding-bottom:8px">🍷 New Paid Order — Il Ciliegio Shop</h2>' +
      '<p><strong>Customer:</strong> ' + customerName + '</p>' +
      '<p><strong>Email:</strong> ' + customerEmail + '</p>' +
      '<p><strong>Amount:</strong> ' + amount + ' ' + currency + '</p>' +
      '<p><strong>Payment:</strong> ✅ ' + paymentLabel + '</p>' +
      '<hr/><h3>Order Details:</h3>' +
      '<pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap">' + orderSummary + '</pre>' +
      '<hr/><p style="color:#888;font-size:12px">This order has been paid. Please prepare and ship it.</p></div>';

    const customerHtml = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto">' +
      '<h2 style="color:#D4AF37">🍷 Thank you for your order, ' + customerName + '!</h2>' +
      '<p>Your payment of <strong>' + amount + ' ' + currency + '</strong> via <strong>' + paymentLabel + '</strong> has been confirmed.</p>' +
      '<p>We will contact you shortly to arrange shipping.</p>' +
      '<hr/><h3>Your Order:</h3>' +
      '<pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap">' + orderSummary + '</pre>' +
      '<hr/><p style="color:#888;font-size:12px">Il Ciliegio — Azienda Agricola | shop@ilciliegio.com</p></div>';

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