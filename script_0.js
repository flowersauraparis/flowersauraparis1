
/* =========================================================
   AURA — PANIER CLIENT
   Panier persistant + quantités + checkout Stripe via Netlify Function.
   ========================================================= */
window.AuraCart = (() => {
  const STORAGE_KEY = 'flowersaura_cart_v1';
  let items = [];

  const el = id => document.getElementById(id);
  const money = n => (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',') + '€';

  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      items = Array.isArray(parsed) ? parsed.filter(x => x && x.id && Number(x.qty) > 0) : [];
    }catch{ items = []; }
    render();
  }

  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    render();
  }

  function totalQty(){ return items.reduce((sum,i)=>sum + Number(i.qty || 0),0); }
  function subtotal(){ return items.reduce((sum,i)=>sum + Number(i.unitPrice || 0) * Number(i.qty || 0),0); }
  function shipping(){ return subtotal() > 0 && subtotal() < 50 ? 5 : 0; }

  function sameItem(a,b){ return a.key && b.key ? a.key === b.key : a.id === b.id && JSON.stringify(a.meta||{}) === JSON.stringify(b.meta||{}); }

  function add(itemOrId, name, unitPrice, qty=1, meta={}, type='fixed'){
    const item = (itemOrId && typeof itemOrId === 'object')
      ? itemOrId
      : { id:itemOrId, name, unitPrice, qty, meta, type };
    const clean = {
      key: item.key || item.id,
      id: String(item.id),
      name: String(item.name),
      unitPrice: Number(item.unitPrice),
      qty: Math.max(1, Number(item.qty || 1)),
      type: item.type || 'fixed',
      meta: item.meta || {}
    };
    if(!Number.isFinite(clean.unitPrice) || clean.unitPrice < 0) return;
    const existing = items.find(i => sameItem(i, clean));
    if(existing) existing.qty += clean.qty;
    else items.push(clean);
    save();
    open();
  }

  function change(key, delta){
    const item = items.find(i => i.key === key);
    if(!item) return;
    item.qty += delta;
    if(item.qty <= 0) items = items.filter(i => i.key !== key);
    save();
  }

  function remove(key){
    items = items.filter(i => i.key !== key);
    save();
  }

  function escapeHtml(value){
    return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function metaText(item){
    const m = item.meta || {};
    if(item.type === 'composed'){
      const bits = [
        `${m.roses || ''} roses`,
        m.color || '',
        m.glitter === 'Sans paillettes' ? 'sans paillettes' : 'paillettes',
        m.packaging === 'Prestige' ? 'emballage prestige' : 'emballage classique',
        m.ribbon ? `ruban ${String(m.ribbon).toLowerCase()}` : '',
        ...(Array.isArray(m.extras) ? m.extras : [])
      ].filter(Boolean);
      return bits.join(' · ');
    }
    if(item.type === 'unit-rose') return `${m.color || 'Blanc'} · ${item.qty} rose${item.qty > 1 ? 's' : ''}`;
    return m.variant ? String(m.variant) : '';
  }

  function render(){
    const countEl = el('cart-count');
    const itemsEl = el('cart-items');
    const subEl = el('cart-subtotal');
    const shipEl = el('cart-shipping');
    const totalEl = el('cart-total');
    const checkoutBtn = el('cart-checkout');
    if(!countEl || !itemsEl || !subEl || !shipEl || !totalEl || !checkoutBtn) return;

    const qty = totalQty();
    countEl.textContent = qty;
    countEl.dataset.empty = qty ? 'false' : 'true';

    if(!items.length){
      itemsEl.innerHTML = '<p class="cart-empty">Ton panier est vide pour l\'instant.</p>';
    }else{
      itemsEl.innerHTML = items.map(item => `
        <div class="cart-item" data-key="${escapeHtml(item.key)}">
          <div class="cart-item-info">
            <div class="cart-item-name">${escapeHtml(item.name)}</div>
            <div class="cart-item-meta">${escapeHtml(metaText(item))}</div>
            <div class="cart-item-row">
              <div class="cart-qty">
                <button type="button" data-cart-action="minus" aria-label="Retirer une unité">−</button>
                <span>${item.qty}</span>
                <button type="button" data-cart-action="plus" aria-label="Ajouter une unité">+</button>
              </div>
              <div class="cart-item-price">${money(item.unitPrice * item.qty)}</div>
            </div>
            <button class="cart-remove" type="button" data-cart-action="remove">Supprimer</button>
          </div>
        </div>`).join('');
    }

    const sub = subtotal();
    const ship = shipping();
    subEl.textContent = money(sub);
    shipEl.textContent = ship ? money(ship) : 'Offerte';
    totalEl.textContent = money(sub + ship);
    checkoutBtn.disabled = !items.length;
  }

  function open(){ el('cart-drawer')?.classList.add('is-open'); el('cart-overlay')?.classList.add('is-open'); document.body.style.overflow='hidden'; }
  function close(){ el('cart-drawer')?.classList.remove('is-open'); el('cart-overlay')?.classList.remove('is-open'); document.body.style.overflow=''; }

  async function checkout(){
    const err = el('cart-error');
    if(err){ err.style.display='none'; err.textContent=''; }
    if(!items.length) return;
    const btn = el('cart-checkout');
    btn.disabled = true;
    btn.textContent = 'Préparation de votre commande…';
    try{
      const response = await fetch('/.netlify/functions/create-checkout', {
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({items})
      });
      const raw = await response.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if(!response.ok || !data.url){
        const fallback = response.status === 404
          ? 'La fonction de paiement n’est pas déployée sur Netlify. Vérifie que le dossier netlify/functions est bien présent dans le dépôt.'
          : (data.error || raw || 'Impossible de préparer le paiement.');
        throw new Error(fallback);
      }
      window.location.href = data.url;
    }catch(error){
      if(err){ err.textContent = error.message || 'Une erreur est survenue.'; err.style.display='block'; }
      btn.disabled = false;
      btn.textContent = 'Valider le panier';
    }
  }

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-cart-action]');
    if(action){
      const row = action.closest('.cart-item');
      const key = row?.dataset.key;
      if(!key) return;
      const type = action.dataset.cartAction;
      if(type === 'plus') change(key, 1);
      if(type === 'minus') change(key, -1);
      if(type === 'remove') remove(key);
    }
  });

  el('cart-open')?.addEventListener('click', open);
  el('cart-close')?.addEventListener('click', close);
  el('cart-overlay')?.addEventListener('click', close);
  el('cart-checkout')?.addEventListener('click', checkout);
  document.addEventListener('keydown', e => { if(e.key === 'Escape') close(); });

  window.addEventListener('storage', load);
  load();

  return { add, open, close, items:()=>items.slice() };
})();

function addComposedBouquetToCart(){
  const count = document.querySelector('#opt-count .pill.active');
  const color = document.querySelector('#opt-color .swatch.active');
  const glitter = document.querySelector('#opt-glitter .pill.active');
  const packaging = document.querySelector('#opt-packaging .pill.active');
  const ribbon = document.querySelector('#opt-ribbon .swatch.active');
  if(!count) return;
  const extras = Array.from(document.querySelectorAll('#personnalise .check-pill input[type="checkbox"]:checked')).map(cb => {
    const extra = cb.dataset.extra;
    if(extra === 'Initiale'){
      const letter = document.getElementById('initiale-letter')?.value.trim().toUpperCase();
      return letter ? `Initiale (${letter})` : 'Initiale';
    }
    return extra;
  });
  const meta = {
    roses: count.dataset.value,
    color: color?.dataset.value || 'Blanc',
    glitter: glitter?.dataset.value || 'Oui, incluses',
    packaging: packaging?.dataset.value || 'Classique',
    ribbon: ribbon?.dataset.value || 'Blanc',
    extras
  };
  const key = `composed-${meta.roses}-${meta.color}-${meta.glitter}-${meta.packaging}-${meta.ribbon}-${extras.join('|')}`;
  AuraCart.add({
    key,
    id:'bouquet-compose',
    name:`Bouquet ${meta.roses} roses`,
    unitPrice:Number(document.getElementById('total-price')?.textContent.replace('€','').replace(',','.')) || Number(count.dataset.price) || 0,
    type:'composed',
    meta
  });
  const button = document.getElementById('add-composed-cart');
  if(button){ button.classList.add('is-added'); button.textContent='✓ Ajouté'; setTimeout(()=>{button.classList.remove('is-added');button.textContent='+ Panier';},1200); }
}

function addUnitRoseToCart(){
  const qty = Number(document.getElementById('unit-qty')?.textContent || 1);
  const color = document.querySelector('#unit-color .swatch.active')?.title || 'Blanc';
  AuraCart.add({
    key:`unit-rose-${color}`,
    id:'rose-unit',
    name:'Rose à l’unité',
    unitPrice:4,
    qty,
    type:'unit-rose',
    meta:{color}
  });
}

  function seedGlitter(id, count){
    const el = document.getElementById(id);
    if(!el) return;
    for(let i=0;i<count;i++){
      const s = document.createElement('span');
      s.style.left = Math.random()*100+'%';
      s.style.top = Math.random()*100+'%';
      s.style.animationDelay = (Math.random()*3.4)+'s';
      el.appendChild(s);
    }
  }
  seedGlitter('glitter-hero', 22);
  seedGlitter('glitter-order', 16);

  document.querySelectorAll('.swatches').forEach(group=>{
    group.addEventListener('click', e=>{
      const s = e.target.closest('.swatch');
      if(!s) return;
      group.querySelectorAll('.swatch').forEach(el=>el.classList.remove('active'));
      s.classList.add('active');
    });
  });
  document.querySelectorAll('.pill-row').forEach(group=>{
    group.addEventListener('click', e=>{
      const p = e.target.closest('.pill');
      if(!p) return;
      group.querySelectorAll('.pill').forEach(el=>el.classList.remove('active'));
      p.classList.add('active');
      updateTotal();
    });
  });

  // ---- bouquet configurator ----
  const totalEl = document.getElementById('total-price');
  const initialeCheckbox = document.getElementById('opt-initiale');
  const initialeInput = document.getElementById('initiale-letter');

  // ---- price formatting (French style, keeps decimals only when needed) ----
  function formatPrice(n){
    n = Math.round(n * 100) / 100;
    return (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + '€';
  }

  // ---- map each rose count to its real Stripe payment link ----
  // Une fois les options ajoutées sur Stripe, le total s'y calcule automatiquement.
  const bouquetLinks = {
    '20': 'https://buy.stripe.com/3cI8wPfZXfdS3S699heIw01',
    '40': 'https://buy.stripe.com/00w5kDaFDd5K74i719eIw02',
    '70': 'https://buy.stripe.com/aFa14n7tr4ze2O2bhpeIw03',
    '100': 'https://buy.stripe.com/eVqdR9eVTghW3S699heIw04'
  };
  const payNowBtn = document.getElementById('pay-now');

  function updateTotal(){
    if(!totalEl) return;
    const countPill = document.querySelector('#opt-count .pill.active');
    const packagingPill = document.querySelector('#opt-packaging .pill.active');
    let total = countPill ? parseFloat(countPill.dataset.price) : 0;
    total += packagingPill ? parseFloat(packagingPill.dataset.price) : 0;
    document.querySelectorAll('.check-pill input[type="checkbox"]').forEach(cb=>{
      if(cb.checked) total += parseFloat(cb.dataset.price);
    });
    totalEl.textContent = formatPrice(total);
    const shipEl = document.getElementById('shipping-note');
    if(shipEl){
      shipEl.textContent = total >= 50
        ? 'Livraison à domicile offerte (commande ≥ 50€) ✓'
        : '+ 5€ de livraison à domicile (offerte dès 50€ d\'achat)';
    }
    if(payNowBtn){
      const countPill2 = document.querySelector('#opt-count .pill.active');
      const count = countPill2 ? countPill2.dataset.value : '20';
      payNowBtn.href = bouquetLinks[count] || bouquetLinks['20'];
      payNowBtn.textContent = 'Payer maintenant — ' + count + ' roses';
    }
  }

  document.querySelectorAll('#opt-count, #opt-packaging').forEach(g=>{
    g.addEventListener('click', updateTotal);
  });
  document.querySelectorAll('.check-pill input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener('change', updateTotal);
  });
  if(initialeCheckbox && initialeInput){
    initialeCheckbox.addEventListener('change', ()=>{
      initialeInput.style.display = initialeCheckbox.checked ? 'block' : 'none';
    });
  }
  updateTotal();

  // ---- roses à l'unité ----
  const unitQtyEl = document.getElementById('unit-qty');
  const unitTotalEl = document.getElementById('unit-total');
  let unitQty = 1;
  const unitPrice = 4;
  function renderUnit(){
    if(!unitQtyEl) return;
    unitQtyEl.textContent = unitQty;
    const total = unitQty * unitPrice;
    unitTotalEl.textContent = formatPrice(total);
    const shipEl = document.getElementById('unit-shipping-note');
    if(shipEl){
      shipEl.textContent = total >= 50
        ? 'Livraison à domicile offerte (commande ≥ 50€) ✓'
        : '+ 5€ de livraison à domicile (offerte dès 50€ d\'achat)';
    }
  }
  document.getElementById('unit-minus')?.addEventListener('click', ()=>{
    unitQty = Math.max(1, unitQty - 1); renderUnit();
  });
  document.getElementById('unit-plus')?.addEventListener('click', ()=>{
    unitQty = unitQty + 1; renderUnit();
  });

  renderUnit();

  // ---- copy order details (to paste in the Stripe checkout field) ----
  document.getElementById('copy-recap')?.addEventListener('click', ()=>{
    const count = document.querySelector('#opt-count .pill.active')?.dataset.value || '';
    const color = document.querySelector('#opt-color .swatch.active')?.dataset.value || '';
    const glitter = document.querySelector('#opt-glitter .pill.active')?.dataset.value || '';
    const packaging = document.querySelector('#opt-packaging .pill.active')?.dataset.value || '';
    const ribbon = document.querySelector('#opt-ribbon .swatch.active')?.dataset.value || '';
    const extras = Array.from(document.querySelectorAll('.check-pill input[type="checkbox"]:checked'))
      .map(cb=>{
        if(cb.dataset.extra === 'Initiale' && initialeInput.value) return 'Initiale (' + initialeInput.value + ')';
        return cb.dataset.extra;
      });
    const total = totalEl.textContent;
    const recap = `Commande Flowersaura Paris :
- ${count} roses ${color}
- Paillettes : ${glitter}
- Emballage : ${packaging}
- Ruban (offert) : ${ribbon}
- Suppléments : ${extras.length ? extras.join(', ') : 'aucun'}
Total : ${total}`;
    navigator.clipboard?.writeText(recap).then(()=>{
      const conf = document.getElementById('copy-confirm');
      if(conf){ conf.style.display = 'block'; setTimeout(()=>conf.style.display='none', 4000); }
    });
  });
// Product galleries: arrows + dots for all bouquet cards
document.querySelectorAll('[data-gallery]').forEach(gallery=>{
  const track=gallery.querySelector('.gallery-track');
  const slides=[...gallery.querySelectorAll('.gallery-slide')];
  const dots=[...gallery.querySelectorAll('.gallery-dot')];
  if(!track || slides.length<2) return;
  let index=0;
  const render=()=>{
    track.style.transform=`translateX(-${index*100}%)`;
    slides.forEach((slide,i)=>slide.classList.toggle('is-active',i===index));
    dots.forEach((dot,i)=>dot.classList.toggle('is-active',i===index));
  };
  gallery.querySelector('.gallery-prev')?.addEventListener('click',()=>{index=(index-1+slides.length)%slides.length;render()});
  gallery.querySelector('.gallery-next')?.addEventListener('click',()=>{index=(index+1)%slides.length;render()});
  dots.forEach((dot,i)=>dot.addEventListener('click',()=>{index=i;render()}));
  let startX=0;
  gallery.addEventListener('touchstart',e=>{startX=e.changedTouches[0].clientX},{passive:true});
  gallery.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-startX;if(Math.abs(dx)>35){index=dx<0?(index+1)%slides.length:(index-1+slides.length)%slides.length;render()}},{passive:true});
  render();
});

// Mobile navigation
  document.querySelector('.menu-btn')?.addEventListener('click',()=>{
    const nav=document.querySelector('.nav-links'); if(!nav) return;
    nav.classList.toggle('mobile-open');
  });
