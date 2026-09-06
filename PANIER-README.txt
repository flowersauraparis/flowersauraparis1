AURA — panier + checkout Stripe

1. Remplacer le contenu du dépôt GitHub par ce projet.
2. Conserver site/, netlify/, netlify.toml et package.json à la racine.
3. Dans Netlify > Environment variables, conserver STRIPE_SECRET_KEY.
4. Netlify doit redéployer après le commit.

Le panier est client-side et le paiement multi-articles est créé par la fonction Netlify /netlify/functions/create-checkout.js.
