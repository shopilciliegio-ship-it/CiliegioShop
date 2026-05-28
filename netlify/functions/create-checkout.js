const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { total, currency, customerName, customerEmail, orderText, method } = JSON.parse(event.body);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: method === 'paypal' ? ['paypal'] : ['card'],
      line_items: [{
        price_data: {
          currency: currency || 'eur',
          product_data: {
            name: 'Il Ciliegio - Ordine',
            description: (customerName || 'Customer').substring(0, 100),
          },
          unit_amount: Math.round(total * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: customerEmail || '',
      receipt_email: customerEmail || '',
      metadata: {
        customer_name: (customerName || '').substring(0, 100),
        order_summary: (orderText || '').substring(0, 500),
        payment_method: method || 'card',
      },
      success_url: 'https://ciliegio-shop.netlify.app/CiliegioShop.html?payment=success',
      cancel_url:  'https://ciliegio-shop.netlify.app/CiliegioShop.html?payment=cancel',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};