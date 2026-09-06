// Cette fonction tourne sur le serveur (pas dans le navigateur).
// Elle reçoit les choix de la cliente, calcule le prix exact, et crée
// une vraie session de paiement Stripe pour ce montant précis.

const PRICES = {
  roses: { '20': 24.90, '40': 39.90, '70': 64.90, '100': 79.90 },
  packaging: { 'Classique': 0, 'Prestige': 10.00 },
  couronne: 3.90,
  doudou: 1.90,
  initiale: 2.90,
  shippingFlat: 5.00,
  freeShippingFrom: 50.00
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Corps de requête invalide' };
  }

  const roseCount = String(data.roseCount || '20');
  const color = data.color || 'Blanc';
  const glitter = data.glitter || 'Avec paillettes';
  const ribbon = data.ribbon || 'Blanc';
  const packaging = data.packaging || 'Classique';
  const couronne = !!data.couronne;
  const doudou = !!data.doudou;
  const initiale = !!data.initiale;
  const initialeLetter = (data.initialeLetter || '').slice(0, 3);

  // ---- calcul du prix, fait ici, sur le serveur : la cliente ne peut pas le modifier ----
  const basePrice = PRICES.roses[roseCount] ?? PRICES.roses['20'];
  const packagingPrice = PRICES.packaging[packaging] ?? 0;

  const line_items = [
    {
      price_data: {
        currency: 'eur',
        product_data: {
          name: `Bouquet ${roseCount} roses`,
          description: `Couleur : ${color} · Paillettes : ${glitter} · Ruban : ${ribbon} (offert) · Emballage : ${packaging}`
        },
        unit_amount: Math.round(basePrice * 100)
      },
      quantity: 1
    }
  ];

  if (packagingPrice > 0) {
    line_items.push({
      price_data: {
        currency: 'eur',
        product_data: { name: 'Emballage prestige' },
        unit_amount: Math.round(packagingPrice * 100)
      },
      quantity: 1
    });
  }
  if (couronne) {
    line_items.push({
      price_data: {
        currency: 'eur',
        product_data: { name: 'Couronne' },
        unit_amount: Math.round(PRICES.couronne * 100)
      },
      quantity: 1
    });
  }
  if (doudou) {
    line_items.push({
      price_data: {
        currency: 'eur',
        product_data: { name: 'Mini doudou' },
        unit_amount: Math.round(PRICES.doudou * 100)
      },
      quantity: 1
    });
  }
  if (initiale) {
    line_items.push({
      price_data: {
        currency: 'eur',
        product_data: {
          name: 'Initiale' + (initialeLetter ? ` (${initialeLetter})` : '')
        },
        unit_amount: Math.round(PRICES.initiale * 100)
      },
      quantity: 1
    });
  }

  const subtotal = line_items.reduce((sum, li) => sum + li.price_data.unit_amount * li.quantity, 0) / 100;
  const shippingCost = subtotal >= PRICES.freeShippingFrom ? 0 : PRICES.shippingFlat;

  if (shippingCost > 0) {
    line_items.push({
      price_data: {
        currency: 'eur',
        product_data: { name: 'Livraison à domicile' },
        unit_amount: Math.round(shippingCost * 100)
      },
      quantity: 1
    });
  }

  const origin = event.headers.origin || event.headers.referer || 'https://flowersauraparis.netlify.app';
  const baseUrl = origin.replace(/\/$/, '');

  // ---- construction du corps de requête pour l'API Stripe (sans dépendance npm) ----
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', `${baseUrl}/?paiement=succes`);
  params.append('cancel_url', `${baseUrl}/?paiement=annule`);
  params.append('shipping_address_collection[allowed_countries][]', 'FR');
  params.append('phone_number_collection[enabled]', 'true');

  line_items.forEach((li, i) => {
    params.append(`line_items[${i}][price_data][currency]`, li.price_data.currency);
    params.append(`line_items[${i}][price_data][product_data][name]`, li.price_data.product_data.name);
    if (li.price_data.product_data.description) {
      params.append(`line_items[${i}][price_data][product_data][description]`, li.price_data.product_data.description);
    }
    params.append(`line_items[${i}][price_data][unit_amount]`, li.price_data.unit_amount);
    params.append(`line_items[${i}][quantity]`, li.quantity);
  });

  try {
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await resp.json();

    if (!resp.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: session.error?.message || 'Erreur Stripe' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
