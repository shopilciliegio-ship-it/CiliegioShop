const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

    // Card: use 'card' payment method
    // PayPal: requires PayPal to be enabled in Stripe dashboard
    const paymentMethods = method === 'paypal' ? ['paypal'] : ['card'];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: paymentMethods,
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
      metadata: {
        customer_name: customerName || '',
        order_summary: (orderText || '').substring(0, 500),
        payment_method: method || 'card',
      },
      success_url: 'https://ciliegio-shop.netlify.app/CiliegioShop.html?payment=success',
      cancel_url:  'https://ciliegio-shop.netlify.app/CiliegioShop.html?payment=cancel',
    });

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

    // PayPal not enabled
    let userMessage = err.message;
    if (err.message && err.message.includes('paypal')) {
      userMessage = 'PayPal not enabled. Please activate PayPal in your Stripe dashboard under Settings → Payment methods.';
    }

    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: userMessage,
        type: err.type,
      }),
    };
  }
};
