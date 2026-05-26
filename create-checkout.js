const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { total, totalPaypal, currency, customerName, customerEmail, orderText, method } = JSON.parse(event.body);

    const amount = method === 'paypal' ? totalPaypal : total;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: method === 'paypal' ? ['paypal'] : ['card'],
      line_items: [{
        price_data: {
          currency: currency || 'eur',
          product_data: {
            name: 'Il Ciliegio — Order',
            description: customerName,
          },
          unit_amount: Math.round(amount * 100), // cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: customerEmail,
      metadata: {
        order_text: orderText.substring(0, 500), // Stripe metadata limit
        customer_name: customerName,
        payment_method: method,
      },
      success_url: 'https://YOUR_NETLIFY_URL/CiliegioShop.html?payment=success',
      cancel_url:  'https://YOUR_NETLIFY_URL/CiliegioShop.html?payment=cancel',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
