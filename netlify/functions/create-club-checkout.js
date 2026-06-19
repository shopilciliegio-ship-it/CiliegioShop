const https = require('https');

const TIER_LABELS = { entry: 'Entry (3 bottiglie)', core: 'Core (6 bottiglie)', reserve: 'Reserve (12 bottiglie)' };

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
  catch (e) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Bad JSON' })
    };
  }

  const tier = TIER_LABELS[body.tier] ? body.tier : null;
  if (!tier) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Tier non valido' })
    };
  }

  const amount          = Math.round(Number(body.amount) * 100);
  const cur              = body.currency || 'eur';
  const customerName    = (body.customerName    || 'Customer').substring(0, 100);
  const customerEmail   = body.customerEmail   || '';
  const customerPhone   = (body.customerPhone   || '').substring(0, 50);
  const customerAddress = (body.customerAddress || '').substring(0, 200);

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Importo non valido' })
    };
  }

  const formData = [
    'payment_method_types[]=card',
    'line_items[0][price_data][currency]=' + encodeURIComponent(cur),
    'line_items[0][price_data][product_data][name]=' + encodeURIComponent('Il Ciliegio Wine Club - ' + TIER_LABELS[tier]),
    'line_items[0][price_data][recurring][interval]=month',
    'line_items[0][price_data][recurring][interval_count]=4',
    'line_items[0][price_data][unit_amount]=' + amount,
    'line_items[0][quantity]=1',
    'mode=subscription',
    'customer_email=' + encodeURIComponent(customerEmail),
    'metadata[wine_club_tier]=' + encodeURIComponent(tier),
    'metadata[customer_name]='    + encodeURIComponent(customerName),
    'metadata[customer_email]='   + encodeURIComponent(customerEmail),
    'metadata[customer_phone]='   + encodeURIComponent(customerPhone),
    'metadata[customer_address]=' + encodeURIComponent(customerAddress),
    'subscription_data[metadata][wine_club_tier]=' + encodeURIComponent(tier),
    'subscription_data[metadata][customer_name]='    + encodeURIComponent(customerName),
    'subscription_data[metadata][customer_address]=' + encodeURIComponent(customerAddress),
    'success_url=' + encodeURIComponent('https://ciliegio-shop.netlify.app/CiliegioShop.html?club=success'),
    'cancel_url=' + encodeURIComponent('https://ciliegio-shop.netlify.app/CiliegioShop.html?club=cancel'),
  ].join('&');

  return new Promise(function (resolve) {
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

    const req = https.request(options, function (res) {
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
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
        } catch (e) {
          resolve({
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Parse error: ' + data.substring(0, 200) })
          });
        }
      });
    });

    req.on('error', function (e) {
      resolve({
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: e.message })
      });
    });

    req.write(formData);
    req.end();
  });
};
