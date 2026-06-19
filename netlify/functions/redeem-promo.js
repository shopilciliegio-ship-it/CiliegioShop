const { getStore } = require('@netlify/blobs');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

function checkValid(promo) {
  if (!promo) return 'notfound';
  if (!promo.active) return 'inactive';
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() < Date.now()) return 'expired';
  if (promo.maxUses != null && (promo.usesCount || 0) >= promo.maxUses) return 'usedup';
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Bad JSON' }); }

  const code = normalizeCode(body.code);
  if (!code) return json(400, { valid: false, reason: 'notfound' });

  const store = getStore('promos');

  try {
    const promo = await store.get(code, { type: 'json' });
    const reason = checkValid(promo);
    if (reason) return json(200, { valid: false, reason });

    if (body.action === 'consume') {
      promo.usesCount = (promo.usesCount || 0) + 1;
      if (promo.maxUses != null && promo.usesCount >= promo.maxUses) promo.active = false;
      await store.setJSON(code, promo);
      return json(200, { valid: true });
    }

    // default action: validate (read-only)
    return json(200, {
      valid: true,
      promo: { code: promo.code, type: promo.type, percent: promo.percent, bottles: promo.bottles },
    });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
