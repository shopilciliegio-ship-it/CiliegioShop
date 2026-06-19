const { getStore } = require('@netlify/blobs');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MAX_CODE_LEN = 24;

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

function validatePromo(p) {
  const code = normalizeCode(p.code);
  if (!code || code.length > MAX_CODE_LEN) return { error: 'Codice non valido (1-' + MAX_CODE_LEN + ' caratteri, lettere/numeri).' };

  if (p.type !== 'percent' && p.type !== 'bottles') return { error: 'Tipo promo non valido.' };

  const out = {
    code,
    type: p.type,
    mode: p.mode === 'recurring' ? 'recurring' : 'single',
    active: p.active !== false,
  };

  if (p.type === 'percent') {
    const pct = Number(p.percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { error: 'Percentuale non valida (1-100).' };
    out.percent = pct;
  } else {
    const b = Number(p.bottles);
    if (![1, 2, 3].includes(b)) return { error: 'Numero bottiglie omaggio non valido (1, 2 o 3).' };
    out.bottles = b;
  }

  if (out.mode === 'recurring') {
    if (p.maxUses !== undefined && p.maxUses !== null && p.maxUses !== '') {
      const mu = Number(p.maxUses);
      if (!Number.isFinite(mu) || mu < 1) return { error: 'Numero massimo utilizzi non valido.' };
      out.maxUses = mu;
    } else {
      out.maxUses = null;
    }
    if (p.expiresAt) {
      const d = new Date(p.expiresAt);
      if (isNaN(d.getTime())) return { error: 'Data di scadenza non valida.' };
      out.expiresAt = d.toISOString();
    } else {
      out.expiresAt = null;
    }
  } else {
    out.maxUses = 1;
    out.expiresAt = null;
  }

  return { promo: out };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const adminKey = process.env.PROMO_ADMIN_KEY;
  if (!adminKey) return json(500, { error: 'PROMO_ADMIN_KEY non configurata su Netlify.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Bad JSON' }); }

  if (body.adminKey !== adminKey) return json(401, { error: 'Chiave amministratore non corretta.' });

  const store = getStore('promos');
  const action = body.action;

  try {
    if (action === 'list') {
      const { blobs } = await store.list();
      const promos = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
      return json(200, { promos: promos.filter(Boolean) });
    }

    if (action === 'create') {
      const { promo, error } = validatePromo(body.promo || {});
      if (error) return json(400, { error });
      const existing = await store.get(promo.code, { type: 'json' });
      promo.usesCount = existing ? existing.usesCount || 0 : 0;
      promo.createdAt = existing ? existing.createdAt : new Date().toISOString();
      await store.setJSON(promo.code, promo);
      return json(200, { promo });
    }

    if (action === 'setActive') {
      const code = normalizeCode(body.code);
      const existing = await store.get(code, { type: 'json' });
      if (!existing) return json(404, { error: 'Promo non trovata.' });
      existing.active = !!body.active;
      await store.setJSON(code, existing);
      return json(200, { promo: existing });
    }

    if (action === 'delete') {
      const code = normalizeCode(body.code);
      await store.delete(code);
      return json(200, { ok: true });
    }

    return json(400, { error: 'Azione non valida.' });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
