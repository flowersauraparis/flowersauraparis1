AURA — panier + checkout

Cette version utilise le panier comme source des articles et le serveur Netlify comme source de vérité des prix.
Le checkout Stripe recrée chaque ligne avec les prix catalogues : 20€ / 40€ / 70€ / 100€, rose à l’unité, doudou, options du bouquet personnalisé et livraison.

Netlify requis :
- Build publish = site
- Functions = netlify/functions
- Variable : STRIPE_SECRET_KEY
