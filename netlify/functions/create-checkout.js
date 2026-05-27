const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const https  = require('https');

// Send email via EmailJS REST API (free, no SMTP needed)
// OR via a simple mailto trick using Netlify's own email
function sendOrderEmail(orderText, customerName, total, method) {
  return new Promise(function(resolve) {
    // Use Stripe's own email notification + store full order in metadata
    // Additionally POST to a simple webhook if configured
    const webhookUrl = process.env.ORDER_WEBHOOK_URL;
    if (!webhookUrl) { resolve(); return; }

    const payload = JSON.stringify({
      text: '🍷 NEW ORDER PAID\n\n' + orderText,
      total: total,
      method: method,
      customer: customerName
    });

    const url = new URL(webhookUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, function(res) { resolve(); });
    req.on('error', function() { resolve(); });
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { total, currency, customerName, customerEmail, orderText, method } = JSON.parse(event.body);

    if (!total || total <= 0) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Invalid amount: ' + total })
      };
    }

    const paymentLabel = method === 'paypal' ? 'PayPal (+5%)' : 'Credit Card';
    const fullOrderText = orderText + '\n\n✅ PAYMENT CONFIRMED via ' + paymentLabel;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: method === 'paypal' ? ['paypal'] : ['card'],
      line_items: [{
        price_data: {
          currency: currency || 'eur',
          product_data: {
            name: 'Il Ciliegio — Ordine',
            description: customerName || 'Customer',
          },
          unit_amount: Math.round(total * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: customerEmail,
      receipt_email: customerEmail,  // Stripe sends receipt to customer
      metadata: {
        customer_name: customerName || '',
        order_summary: fullOrderText.substring(0, 500),
        payment_method: method || 'card',
        shop_notification: 'shop@ilciliegio.com',
      },
      success_url: 'https://ciliegio-shop.netlify.app/CiliegioShop.html?payment=success',
      cancel_url:  'https://ciliegio-shop.netlify.app/CiliegioShop.html?payment=cancel',
    });

    // Try to send webhook notification if configured
    await sendOrderEmail(fullOrderText, customerName, total, paymentLabel);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('Stripe error:', err.message);
    let userMessage = err.message;
    if (err.message && err.message.includes('paypal')) {
      userMessage = 'PayPal not enabled. Please activate PayPal in Stripe dashboard.';
    }
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: userMessage, type: err.type }),
    };
  }
};
