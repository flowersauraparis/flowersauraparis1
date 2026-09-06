exports.handler = async (event) => {
  const json = (statusCode, body) => ({
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  });

  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Méthode non autorisée.' });

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return json(500, { error: 'STRIPE_SECRET_KEY est absente des variables Netlify.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Panier invalide.' });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length || items.length > 50) {
    return json(400, { error: 'Panier vide ou trop volumineux.' });
  }

  const basePrices = {
    'bouquet-20': 24.90,
    'bouquet-40': 39.90,
    'bouquet-70': 64.90,
    'bouquet-100': 79.90,
    'doudou': 10.00
  };
  const composedBase = { '20':24.90, '40':39.90, '70':64.90, '100':79.90 };
  const extraPrices = {
    'Couronne': 3.90,
    'Mini doudou': 2.90,
    'Initiale': 3.90,
    'Emballage prestige': 9.90,
    'Carte à brûler': 3.90
  };

  const safeText = (v, fallback='') => String(v ?? fallback).slice(0, 500);
  const positiveInt = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(1, Math.min(20, Math.floor(n))) : 1;
  };

  const lineItems = [];
  let subtotalCents = 0;

  try {
    for (const item of items) {
      const qty = positiveInt(item.qty);
      let unitCents;
      let name;
      let description = '';

      if (item.type === 'composed' || item.id === 'bouquet-compose') {
        const m = item.meta && typeof item.meta === 'object' ? item.meta : {};
        const roses = String(m.roses || '');
        if (composedBase[roses] == null) throw new Error('Format de bouquet personnalisé invalide.');
        unitCents = Math.round(composedBase[roses] * 100);
        if (m.packaging === 'Prestige') unitCents += 990;

        const extras = Array.isArray(m.extras) ? m.extras : [];
        for (const extra of extras) {
          const raw = String(extra);
          const key = raw.startsWith('Initiale') ? 'Initiale' : raw;
          if (extraPrices[key] == null) throw new Error('Supplément invalide dans le panier.');
          unitCents += Math.round(extraPrices[key] * 100);
        }

        name = `Bouquet ${roses} roses personnalisé`;
        description = [m.color, m.glitter, m.packaging, m.ribbon, extras.join(', ')].filter(Boolean).join(' · ');
      } else if (item.id === 'rose-unit' || item.type === 'unit-rose') {
        unitCents = 400;
        const color = safeText(item.meta?.color, 'Blanc');
        name = 'Rose à l’unité';
        description = `Couleur : ${color}`;
      } else if (Object.prototype.hasOwnProperty.call(basePrices, item.id)) {
        unitCents = Math.round(basePrices[item.id] * 100);
        name = item.id === 'doudou'
          ? 'Doudou Love gonflable'
          : `Bouquet ${item.id.replace('bouquet-', '')} roses`;
      } else {
        throw new Error('Article inconnu dans le panier.');
      }

      subtotalCents += unitCents * qty;
      lineItems.push({
        amount: unitCents,
        quantity: qty,
        name: safeText(name),
        description: safeText(description)
      });
    }
  } catch (err) {
    return json(400, { error: err.message || 'Panier invalide.' });
  }

  const shippingCents = subtotalCents > 0 && subtotalCents < 5000 ? 500 : 0;
  if (shippingCents) {
    lineItems.push({ amount: shippingCents, quantity: 1, name: 'Livraison à domicile', description: 'Livraison en France' });
  }

  const siteUrl = (event.headers && (event.headers.origin || event.headers.Origin))
    || process.env.URL
    || 'https://flowersauraparis.netlify.app';

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${siteUrl}/merci.html`);
  params.set('cancel_url', `${siteUrl}/#collection`);
  params.set('locale', 'fr');
  params.set('billing_address_collection', 'auto');
  params.set('phone_number_collection[enabled]', 'true');
  params.set('shipping_address_collection[allowed_countries][0]', 'FR');

  lineItems.forEach((line, i) => {
    params.set(`line_items[${i}][price_data][currency]`, 'eur');
    params.set(`line_items[${i}][price_data][unit_amount]`, String(line.amount));
    params.set(`line_items[${i}][price_data][product_data][name]`, line.name);
    if (line.description) params.set(`line_items[${i}][price_data][product_data][description]`, line.description);
    params.set(`line_items[${i}][quantity]`, String(line.quantity));
  });

  try {
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const stripeData = await stripeResponse.json();
    if (!stripeResponse.ok || !stripeData.url) {
      console.error('Stripe API error:', stripeData);
      return json(502, { error: stripeData?.error?.message || 'Stripe n’a pas pu créer le paiement.' });
    }

    return json(200, { url: stripeData.url });
  } catch (err) {
    console.error('Stripe network error:', err);
    return json(502, { error: 'Impossible de joindre Stripe depuis Netlify.' });
  }
};
