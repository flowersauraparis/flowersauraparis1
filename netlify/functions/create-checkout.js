exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({error:'Méthode non autorisée'}) };

  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw new Error('STRIPE_SECRET_KEY est manquante dans Netlify.');

    const body = JSON.parse(event.body || '{}');
    const input = Array.isArray(body.items) ? body.items : [];
    if (!input.length) throw new Error('Le panier est vide.');

    const bases = {
      'bouquet-20': {name:'Bouquet 20 roses', cents:2490},
      'bouquet-40': {name:'Bouquet 40 roses', cents:3990},
      'bouquet-70': {name:'Bouquet 70 roses', cents:6490},
      'bouquet-100': {name:'Bouquet 100 roses', cents:7990},
      'rose-unit': {name:"Rose à l'unité", cents:400},
      'doudou': {name:'Doudou Love gonflable', cents:1000}
    };
    const extras = {Couronne:390,'Mini doudou':290,Initiale:390};
    const packaging={Classique:0,Prestige:990};
    const allowedColors=['Blanc','Beige','Rose','Rouge','Bleu'];

    function custom(item){
      const o=item.options||{};
      const base={20:2490,40:3990,70:6490,100:7990};
      if(!base[o.roses]) throw new Error('Nombre de roses invalide.');
      if(!allowedColors.includes(o.color||'Blanc')) throw new Error('Couleur invalide.');
      const cents=base[o.roses]+(packaging[o.packaging]||0)+((Array.isArray(o.extras)?o.extras:[]).reduce((s,x)=>s+(extras[String(x).startsWith('Initiale')?'Initiale':x]||0),0));
      const meta=[`${o.roses} roses`,o.color||'Blanc',o.glitter||'Oui, incluses',o.packaging||'Classique',`ruban ${o.ribbon||'Blanc'}`,...(o.extras||[])].join(' · ');
      return {name:`Bouquet personnalisé · ${o.roses} roses`,cents,meta};
    }

    const lineItems=[];
    let subtotal=0;
    for (const raw of input) {
      const id=String(raw.id||'');
      const qty=Math.max(1,Math.min(99,Math.floor(Number(raw.qty)||1)));
      let p;
      if(id==='custom-bouquet') p=custom(raw);
      else if(bases[id]) p={name:bases[id].name,cents:bases[id].cents,meta:String(raw.meta||'')};
      else throw new Error(`Article inconnu: ${id}`);
      subtotal += p.cents*qty;
      lineItems.push({
        price_data:{currency:'eur',product_data:{name:p.name,description:p.meta||undefined},unit_amount:p.cents},
        quantity:qty
      });
    }
    if(subtotal<5000){
      lineItems.push({price_data:{currency:'eur',product_data:{name:'Livraison à domicile'},unit_amount:500},quantity:1});
    }

    const origin = event.headers?.origin || process.env.URL || 'https://flowersauraparis.com';
    const params = new URLSearchParams();
    params.set('mode','payment');
    params.set('success_url', origin + '/?paiement=succes');
    params.set('cancel_url', origin + '/?paiement=annule');
    params.set('billing_address_collection','required');
    params.set('shipping_address_collection[allowed_countries][0]','FR');
    lineItems.forEach((li,i)=>{
      params.set(`line_items[${i}][price_data][currency]`,li.price_data.currency);
      params.set(`line_items[${i}][price_data][product_data][name]`,li.price_data.product_data.name);
      if(li.price_data.product_data.description) params.set(`line_items[${i}][price_data][product_data][description]`,li.price_data.product_data.description);
      params.set(`line_items[${i}][price_data][unit_amount]`,String(li.price_data.unit_amount));
      params.set(`line_items[${i}][quantity]`,String(li.quantity));
    });

    const stripeRes=await fetch('https://api.stripe.com/v1/checkout/sessions',{
      method:'POST',
      headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/x-www-form-urlencoded'},
      body:params.toString()
    });
    const stripe=await stripeRes.json();
    if(!stripeRes.ok) throw new Error(stripe?.error?.message || 'Stripe a refusé la session de paiement.');

    return {statusCode:200,headers,body:JSON.stringify({url:stripe.url,subtotal:subtotal/100,shipping:subtotal<5000?5:0,total:(subtotal+(subtotal<5000?500:0))/100})};
  } catch (err) {
    return {statusCode:400,headers,body:JSON.stringify({error:err.message||'Erreur inconnue'})};
  }
};
