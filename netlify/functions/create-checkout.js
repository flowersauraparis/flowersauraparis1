const https = require('https');

function stripeCreateSession(secret, params) {
  return new Promise((resolve, reject) => {
    const body = params.toString();
    const req = https.request({
      hostname: 'api.stripe.com',
      path: '/v1/checkout/sessions',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode || 500, data: JSON.parse(data || '{}') });
        } catch {
          resolve({ statusCode: res.statusCode || 500, data: { error: { message: 'Réponse Stripe invalide.' } } });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Stripe timeout')));
    req.write(body);
    req.end();
  });
}

const FIXED = Object.freeze({
  'bouquet-20': 2490,
  'bouquet-40': 3990,
  'bouquet-70': 6490,
  'bouquet-100': 7990,
  'doudou': 1000,
});
const COMPOSED = Object.freeze({ '20':2490, '40':3990, '70':6490, '100':7990 });
const EXTRAS = Object.freeze({
  'Couronne':390,
  'Mini doudou':290,
  'Initiale':390,
  'Emballage prestige':990,
  'Carte à brûler':390,
});
const UNIT_ROSE = 400;

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  },
  body: JSON.stringify(body),
});

const safe = (v, fallback='') => String(v ?? fallback).slice(0, 500);
const qtyOf = (v) => Number.isFinite(Number(v)) ? Math.max(1, Math.min(20, Math.floor(Number(v)))) : 1;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(204, {});
  if (event.httpMethod !== 'POST') return response(405, { error: 'Méthode non autorisée.' });

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return response(500, { error: 'STRIPE_SECRET_KEY est absente dans Netlify.' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Panier invalide.' });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) return response(400, { error: 'Le panier est vide.' });
  if (items.length > 50) return response(400, { error: 'Panier trop volumineux.' });

  let subtotalCents = 0;
  const lines = [];

  try {
    for (const item of items) {
      const id = String(item?.id || '');
      const type = String(item?.type || 'fixed');
      const qty = qtyOf(item?.qty);
      const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {};
      let unitCents;
      let name;
      let description = '';

      if (type === 'composed' || id === 'bouquet-compose') {
        const roses = String(meta.roses || '');
        if (!Object.prototype.hasOwnProperty.call(COMPOSED, roses)) throw new Error('Format personnalisé invalide.');
        unitCents = COMPOSED[roses];
        if (meta.packaging === 'Prestige') unitCents += EXTRAS['Emballage prestige'];
        for (const extraRaw of Array.isArray(meta.extras) ? meta.extras : []) {
          const extra = String(extraRaw);
          const key = extra.startsWith('Initiale') ? 'Initiale' : extra;
          if (!Object.prototype.hasOwnProperty.call(EXTRAS, key)) throw new Error(`Supplément invalide : ${key}`);
          unitCents += EXTRAS[key];
        }
        name = `Bouquet ${roses} roses personnalisé`;
        description = [meta.color, meta.glitter, meta.packaging, meta.ribbon, ...(Array.isArray(meta.extras) ? meta.extras : [])]
          .filter(Boolean).map(safe).join(' · ');
      } else if (id === 'rose-unit' || type === 'unit-rose') {
        unitCents = UNIT_ROSE;
        name = 'Rose à l’unité';
        description = `Couleur : ${safe(meta.color, 'Blanc')}`;
      } else if (Object.prototype.hasOwnProperty.call(FIXED, id)) {
        unitCents = FIXED[id];
        name = id === 'doudou' ? 'Doudou Love gonflable' : `Bouquet ${id.replace('bouquet-', '')} roses`;
      } else {
        throw new Error('Article inconnu dans le panier.');
      }

      subtotalCents += unitCents * qty;
      lines.push({ unitCents, qty, name: safe(name), description: safe(description) });
    }
  } catch (e) {
    return response(400, { error: e.message || 'Panier invalide.' });
  }

  const shippingCents = subtotalCents > 0 && subtotalCents < 5000 ? 500 : 0;
  if (shippingCents) {
    lines.push({ unitCents: 500, qty: 1, name: 'Livraison à domicile', description: 'Livraison en France' });
  }
  const totalCents = subtotalCents + shippingCents;

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${process.env.URL || 'https://flowersauraparis.netlify.app'}/merci.html`);
  params.set('cancel_url', `${process.env.URL || 'https://flowersauraparis.netlify.app'}/#collection`);
  params.set('locale', 'fr');
  params.set('billing_address_collection', 'auto');
  params.set('phone_number_collection[enabled]', 'true');
  params.set('shipping_address_collection[allowed_countries][0]', 'FR');
  params.set('metadata[cart_total_cents]', String(totalCents));

  lines.forEach((line, i) => {
    params.set(`line_items[${i}][price_data][currency]`, 'eur');
    params.set(`line_items[${i}][price_data][unit_amount]`, String(line.unitCents));
    params.set(`line_items[${i}][price_data][product_data][name]`, line.name);
    if (line.description) params.set(`line_items[${i}][price_data][product_data][description]`, line.description);
    params.set(`line_items[${i}][quantity]`, String(line.qty));
  });

  try {
    const result = await stripeCreateSession(secret, params);
    if (result.statusCode < 200 || result.statusCode >= 300 || !result.data?.url) {
      console.error('Stripe checkout error:', result.data);
      return response(502, { error: result.data?.error?.message || 'Stripe n’a pas pu créer le paiement.' });
    }
    return response(200, { url: result.data.url, totalCents });
  } catch (e) {
    console.error('Stripe request error:', e);
    return response(502, { error: 'Impossible de joindre Stripe depuis Netlify.' });
  }
};
