const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'No secret key' })
    };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Bad JSON: ' + e.message })
    };
  }

  const total = body.total;
  const method = body.method || 'card';
  const cur = body.currency || 'eur';
  const amount = Math.round(total * 100);
  const customerName = (body.customerName || 'Customer').substring(0, 100);
  const customerEmail = body.customerEmail || '';
  const orderText = (body.orderText || '').substring(0, 500);

  const formData = [
    'payment_method_types[]=' + (method === 'paypal' ? 'paypal' : 'card'),
    'line_items[0][price_data][currency]=' + cur,
    'line_items[0][price_data][product_data][name]=Il+Ciliegio+Ordine',
    'line_items[0][price_data][product_data][description]=' + encodeURIComponent(customerName),
    'line_items[0][price_data][unit_amount]=' + amount,
    'line_items[0][quantity]=1',
    'mode=payment',
    'customer_email=' + encodeURIComponent(customerEmail),
    'receipt_email=' + encodeURIComponent(customerEmail),
    'metadata[customer_name]=' + encodeURIComponent(customerName),
    'metadata[order_summary]=' + encodeURIComponent(orderText),
    'metadata[payment_method]=' + encodeURIComponent(method),
    'success_url=' + encodeURIComponent('https://ciliegio-shop.netlify.app/CiliegioShop.html?payment=success'),
    'cancel_url=' + encodeURIComponent('https://ciliegio-shop.netlify.app/CiliegioShop.html?payment=cancel'),
  ].join('&');

  return new Promise(function(resolve) {
    const options = {
      hostname: 'api.stripe.com',
      path: '/v1/checkout/sessions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': formData.length
      }
    };

    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          const session = JSON.parse(data);
          if (session.error) {
            resolve({
              statusCode: 500,
              headers: { 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ error: session.error.message })
            });
          } else {
            resolve({
              statusCode: 200,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ url: session.url })
            });
          }
        } catch(e) {
          resolve({
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Parse error: ' + e.message + ' | ' + data.substring(0,100) })
          });
        }
      });
    });

    req.on('error', function(e) {
      resolve({
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Request error: ' + e.message })
      });
    });

    req.write(formData);
    req.end();
  });
};