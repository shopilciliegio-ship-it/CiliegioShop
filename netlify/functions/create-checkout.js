const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Debug: check if key is loaded
  const keyLoaded = !!process.env.STRIPE_SECRET_KEY;
  const keyPrefix = process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.substring(0, 12) : 'MISSING';
  
  console.log('STRIPE_SECRET_KEY loaded:', keyLoaded, '| prefix:', keyPrefix);

  try {
    const body = JSON.parse(event.body);
    console.log('Request body:', JSON.stringify(body));

    const { total, currency, customerName, customerEmail, orderText, method } = body;

    if (!total || total <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid amount: ' + total })
      };
    }

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

    console.log('Session created:', session.id, '| URL:', session.url);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error type:', err.type);
    console.error('Stripe error message:', err.message);
    console.error('Stripe error code:', err.code);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: err.message,
        type: err.type,
        code: err.code
      }),
    };
  }
};
