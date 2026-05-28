const https = require('https');

function stripeRequest(path, data, secretKey) {
  return new Promise(function(resolve, reject) {
    const payload = Object.keys(data).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]);
    }).join('&');

    const options = {
      hostname: 'api.stripe.com',
      path: path,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, function(res) {
      let body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Invalid JSON: ' + body)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  console.log('--- create-checkout called ---');
  console.log('Method:', event.httpMethod);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  console.log('Body received:', event.body ? event.body.substring(0, 200) : 'EMPTY');

  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    console.log('Secret key present:', !!secretKey, '| prefix:', secretKey ? secretKey.substring(0,7) : 'NONE');

    if (!secretKey) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured' })
      };
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch(e) {
      console.error('JSON parse error:', e.message);
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Invalid JSON body: ' + e.message })
      };
    }

    console.log('Parsed body:', JSON.stringify(body));

    const { total, currency, customerName, customerEmail, orderText, method } = body;

    console.log('total:', total, '| method:', method, '| currency:', currency);

    if (!total || total <= 0) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Invalid amount: ' + total })
      };
    }

    const cur = currency || 'eur';
    const amount = Math.round(total * 100);
    console.log('Calling Stripe with amount:', amount, cur);

    const params = {
      'payment_method_types[]': method === 'paypal' ? 'paypal' : 'card',
      'line_items[0][price_data][currency]': cur,
      'line_items[0][price_data][product_data][name]': 'Il Ciliegio — Ordine',
      'line_items[0][price_data][product_data][description]': customerName || 'Customer',
      'line_items[0][price_data][unit_amount]': amount,
      'line_items[0][quantity]': 1,
      'mode': 'payment',
      'customer_email': customerEmail || '',
      'receipt_email': customerEmail || '',
      'metadata[customer_name]': customerName || '',
      'metadata[order_summary]': (orderText || '').substring(0, 500),
      'metadata[payment_method]': method || 'card',
      'success_url': 'https://ciliegio-shop.netlify.app/CiliegioShop.html?payment=success',
      'cancel_url': 'https://ciliegio-shop.netlify.app/CiliegioShop.html?payment=cancel',
    };

    const session = await stripeRequest('/v1/checkout/sessions', params, secretKey);
    console.log('Stripe response:', JSON.stringify(session).substring(0, 200));

    if (session.error) {
      console.error('Stripe error:', session.error.message);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: session.error.message })
      };
    }

    console.log('Session URL:', session.url);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('Function error:', err.message);
    console.error('Stack:', err.stack);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
