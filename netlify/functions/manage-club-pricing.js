const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const DEFAULTS = { entry: 70, core: 140, reserve: 280 };

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function validatePrices(p) {
  const out = {};
  for (const tier of ['entry', 'core', 'reserve']) {
    const v = Number(p[tier]);
    if (!Number.isFinite(v) || v <= 0) return { error: 'Prezzo non valido per il tier "' + tier + '".' };
    out[tier] = v;
  }
  return { prices: out };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Bad JSON' }); }

  connectLambda(event);
  const store = getStore('club');

  try {
    if (body.action === 'set') {
      const adminKey = process.env.PROMO_ADMIN_KEY;
      if (!adminKey) return json(500, { error: 'PROMO_ADMIN_KEY non configurata su Netlify.' });
      if (body.adminKey !== adminKey) return json(401, { error: 'Chiave amministratore non corretta.' });

      const { prices, error } = validatePrices(body.prices || {});
      if (error) return json(400, { error });
      prices.updatedAt = new Date().toISOString();
      await store.setJSON('pricing', prices);
      return json(200, { prices });
    }

    // default action: get (public, no key — letto anche dalla futura pagina di iscrizione cliente)
    const stored = await store.get('pricing', { type: 'json' });
    return json(200, { prices: stored || DEFAULTS });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
