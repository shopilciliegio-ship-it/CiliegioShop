const https = require('https');

// Small, dependency-free relay for client-side "silent failure" alerts
// (e.g. a zip→city lookup or address check that threw/timed out without the
// customer ever seeing it). Kept separate from create-notification.js so it
// doesn't pull in pdf-lib/@netlify/blobs for what is just a one-line email.
function sendEmail(toEmail, toName, subject, html, brevoKey) {
  return new Promise(function(resolve) {
    const data = {
      sender: { name: 'Il Ciliegio Shop', email: 'luca@sienawine.it' },
      to:     [{ email: toEmail, name: toName }],
      subject: subject,
      htmlContent: html
    };
    const payload = JSON.stringify(data);
    const options = {
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers:  { 'api-key': brevoKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(options, function(res) {
      res.on('data', function() {});
      res.on('end', function() { resolve(); });
    });
    req.on('error', function(e) { console.error('notify-error email failed:', e.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) return { statusCode: 200, body: 'ok' };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: 'Bad JSON' }; }

  const context = String(payload.context || 'unknown').slice(0, 100);
  const url     = String(payload.url || '').slice(0, 500);
  const ts      = String(payload.ts || new Date().toISOString());
  const details = JSON.stringify(payload.details || {}, null, 2).slice(0, 4000);

  const html =
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
    '<h2 style="color:#D4AF37">⚠️ CiliegioShop — silent client-side error</h2>' +
    '<p><strong>Context:</strong> ' + esc(context) + '</p>' +
    '<p><strong>When:</strong> ' + esc(ts) + '</p>' +
    '<p><strong>Page:</strong> ' + esc(url) + '</p>' +
    '<pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap;font-size:12px">' + esc(details) + '</pre>' +
    '</div>';

  await sendEmail('shop@ilciliegio.com', 'Il Ciliegio', '⚠️ CiliegioShop errore silenzioso — ' + context, html, brevoKey);

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) };
};
