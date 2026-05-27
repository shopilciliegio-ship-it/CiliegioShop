// Netlify Function: Stripe webhook → sends email via Brevo
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const https  = require('https');

function sendBrevoEmail(subject, htmlContent) {
  return new Promise(function(resolve, reject) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) { console.log('No BREVO_API_KEY set'); resolve(); return; }

    const payload = JSON.stringify({
      sender:     { name: 'Il Ciliegio Shop', email: 'shop@ilciliegio.com' },
      to:         [{ email: 'shop@ilciliegio.com', name: 'Il Ciliegio' }],
      subject:    subject,
      htmlContent: htmlContent
    });

    const options = {
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers: {
        'api-key':       apiKey,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        console.log('Brevo response:', res.statusCode, data);
        resolve();
      });
    });
    req.on('error', function(e) {
      console.error('Brevo error:', e.message);
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const sig           = event.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let stripeEvent;
    if (webhookSecret && sig) {
      stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
    } else {
      stripeEvent = JSON.parse(event.body);
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

      const htmlContent = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#D4AF37;border-bottom:2px solid #D4AF37;padding-bottom:8px">
            🍷 New Paid Order — Il Ciliegio Shop
          </h2>
          <p><strong>Customer:</strong> ${customerName}</p>
          <p><strong>Email:</strong> ${customerEmail}</p>
          <p><strong>Amount:</strong> ${amount} ${currency}</p>
          <p><strong>Payment:</strong> ✅ ${paymentLabel}</p>
          <hr/>
          <h3>Order Details:</h3>
          <pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap">${orderSummary}</pre>
          <hr/>
          <p style="color:#888;font-size:12px">
            This order has been paid. Please prepare and ship it.
          </p>
        </div>
      `;

      await sendBrevoEmail(subject, htmlContent);
      console.log('Email sent for order:', customerName, amount, currency);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ received: true })
    };

  } catch (err) {
    console.error('Webhook error:', err.message);
    return { statusCode: 400, body: 'Webhook error: ' + err.message };
  }
};