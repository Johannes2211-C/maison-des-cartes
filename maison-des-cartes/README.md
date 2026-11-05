# Maison des Cartes

Boutique immersive en 3D de cartes cadeaux numériques : façade d’accueil, intérieur explorable à hauteur humaine, catalogue classique filtrable, sélecteur de montant 20–100 €, panier, paiement PayPal JavaScript SDK avec création, vérification et capture côté serveur, gestion des commandes et livraison sécurisée des codes.

## Démarrage

Prérequis : **Node.js 22.13 ou plus récent**. Aucune dépendance npm à installer (serveur `node:http`, base `node:sqlite`, Three.js r187 fourni dans `public/vendor/three/`).

```bash
cp .env.example .env      # puis complétez (voir ci-dessous)
npm start                 # http://localhost:3000
npm test                  # 9 tests d’intégration du serveur
npm run check:images      # état des visuels et des droits par produit
```

## Ce qui est opérationnel

| Fonction | État |
|---|---|
| Façade 3D, entrée animée par la porte, intérieur (5 rayons + vitrines + accueil) | ✅ |
| Navigation ZQSD / WASD / flèches (touches physiques : fonctionne en AZERTY et QWERTY), glisser pour regarder, clic sur le sol pour s’y rendre, raccourcis de rayons | ✅ |
| Mobile : joystick discret, glisser pour regarder, toucher une carte ou le sol, rendu allégé automatique | ✅ |
| Clic sur une carte → approche douce puis fiche produit (panneau latéral / feuille mobile) | ✅ |
| Sélecteur de montant (curseur 20–100 €, pas de 1 €, saisie directe, valeurs rapides ; aimantation sur les valeurs commercialisées pour les cartes à montant fixe) | ✅ |
| Panier (montant, quantité, prix unitaire et total, modification, suppression), conservé dans le navigateur | ✅ |
| ACHETER → fondu → boutons PayPal à la place, retour possible ; COMMANDER (panier) → même transition, une seule transaction | ✅ (logique testée ; affichage réel des boutons à vérifier avec vos identifiants) |
| Serveur : recalcul des prix, refus des montants non commercialisés, création de commande PayPal, capture, contrôle montant/devise/référence, statuts, idempotence | ✅ testé avec une API PayPal simulée |
| Livraison : codes importés chiffrés AES-256-GCM, réservation avant paiement, remise uniquement après capture confirmée, page commande protégée par jeton, e-mail | ✅ |
| Catalogue classique avec filtres par catégorie et recherche | ✅ |

## À configurer avant la mise en production

1. **PayPal** — créez une application sur https://developer.paypal.com/dashboard/applications, puis renseignez `PAYPAL_CLIENT_ID` et `PAYPAL_CLIENT_SECRET` (mode `PAYPAL_ENV=sandbox` pour les tests, `live` ensuite). Le secret ne quitte jamais le serveur. Recommandé : déclarez un webhook vers `https://votre-domaine/api/paypal/webhook` (événements `PAYMENT.CAPTURE.*`) et renseignez `PAYPAL_WEBHOOK_ID`.
   Test Sandbox : ajoutez une carte, cliquez sur ACHETER, payez avec un compte acheteur Sandbox ; la page « Commande MDC-… » doit afficher « Paiement confirmé ».
2. **Visuels officiels des cartes** — voir la section suivante. Sans eux, aucun produit n’est publié en production.
3. **Livraison des codes** — par défaut `DELIVERY_MODE=manual` : la commande payée est enregistrée « en préparation » et l’équipe remet les codes via l’API d’administration. Pour une remise automatique : `DELIVERY_MODE=inventory`, `CODES_ENCRYPTION_KEY=$(openssl rand -base64 32)`, puis `npm run codes:import -- codes.csv` (colonnes `product_id,value_eur,code`, codes fournis par votre distributeur). Les montants proposés au client se limitent alors aux valeurs en stock.
4. **E-mails** — `EMAIL_PROVIDER=resend` ou `brevo`, `EMAIL_API_KEY`, `EMAIL_FROM` (domaine vérifié), `MERCHANT_EMAIL` pour être prévenu de chaque commande payée.
5. **Mentions légales et CGV** — compléter les passages surlignés des pages `/conditions` et `/mentions-legales` (`public/js/ui/views.js`).
6. **Montants** — les valeurs de `data/products.json` ont été relevées en novembre 2026 chez des revendeurs (sources dans chaque fiche). Les produits marqués `"toConfirm": true` (Steam, App Store & iTunes, Netflix, Spotify, Zalando, Microsoft 365) doivent être alignés sur le catalogue de votre distributeur.
7. **Production** — `NODE_ENV=production`, HTTPS (reverse proxy Nginx/Caddy), `ADMIN_TOKEN`, sauvegarde de `data/*.sqlite`.

## Visuels officiels des cartes

Les visuels de cartes cadeaux sont des œuvres et marques protégées : leur usage commercial est réservé aux revendeurs autorisés, qui les reçoivent de leur distributeur (kit média, API catalogue). Je n’ai pas pu vérifier de droit d’usage pour votre boutique, et l’environnement de développement ne permettait pas de les télécharger ; **aucun visuel n’a donc été intégré, et aucun n’a été inventé.**

Pour chaque produit, déposez le visuel fourni par votre distributeur sous `public/images/cards/<id>.webp` (ou `.png`, `.jpg`, `.avif`) et déclarez sa source dans `public/images/cards/rights.json` (modèle : `rights.example.json`, fichier jamais servi au public). Les proportions d’origine sont respectées automatiquement dans les vitrines 3D, la fiche produit et le panier.

| id | Produit | Fichier attendu |
|---|---|---|
| steam | Carte Steam | `steam.webp` |
| playstation | Carte PlayStation Store | `playstation.webp` |
| xbox | Carte cadeau Xbox | `xbox.webp` |
| nintendo | Carte Nintendo eShop | `nintendo.webp` |
| apple | Carte cadeau Apple | `apple.webp` |
| app-store-itunes | Carte App Store & iTunes (remplacée en France par la carte Apple) | `app-store-itunes.webp` |
| google-play | Carte Google Play | `google-play.webp` |
| netflix | Carte cadeau Netflix | `netflix.webp` |
| spotify | Carte cadeau Spotify | `spotify.webp` |
| amazon | Carte cadeau Amazon.fr | `amazon.webp` |
| fnac-darty | E-carte cadeau Fnac Darty | `fnac-darty.webp` |
| zalando | Carte cadeau Zalando | `zalando.webp` |
| microsoft-365-basic | Microsoft 365 Basic · 1 an | `microsoft-365-basic.webp` |
| microsoft-365-personnel | Microsoft 365 Personnel · 1 an | `microsoft-365-personnel.webp` |

En développement (`NODE_ENV` ≠ `production`), les produits sans visuel s’affichent avec une carte neutre portant la mention « Aperçu de développement — visuel officiel non intégré », pour pouvoir tester le parcours. En production, ils ne sont pas publiés (ni en vitrine, ni au catalogue).

## Administration

```bash
# Commandes
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://votre-domaine/api/admin/orders
# État des visuels, du stock et de PayPal
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://votre-domaine/api/admin/report
# Remise manuelle des codes d'une commande payée (itemId : identifiant de ligne)
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"codes":[{"itemId":1,"code":"XXXX-XXXX"}]}' https://votre-domaine/api/admin/orders/MDC-…/codes
```

Statuts de commande : `EN_ATTENTE`, `PAIEMENT_CONFIRME`, `PAIEMENT_REFUSE`, `PAIEMENT_ANNULE`, `ERREUR_TECHNIQUE`. Un code n’est jamais délivré avant `PAIEMENT_CONFIRME`.

## Architecture

```
server/
  index.js            serveur HTTP, API, fichiers statiques, en-têtes de sécurité (CSP compatible PayPal)
  config.js           configuration (.env)
  lib/catalog.js      produits, contrôle visuels + droits, validation des montants, prix
  lib/orders.js       calcul serveur, commandes, capture PayPal, statuts, webhooks
  lib/paypal.js       client REST PayPal Orders v2 (OAuth, create, capture, vérification webhook)
  lib/delivery.js     stock de codes chiffrés, réservation, remise, e-mails
  lib/db.js           schéma SQLite
  scripts/            import des codes, contrôle des visuels, génération des textures
data/products.json    catalogue (catégories, montants, conditions, sources)
public/
  index.html, css/main.css
  js/app.js           routage et assemblage
  js/core/            API, panier, formats
  js/ui/              fiche produit, sélecteur de montant, panier, PayPal, catalogue, commande
  js/store/           3D : matériaux, architecture et mobilier, signalétique, déplacements, scène
  textures/           textures architecturales générées (remplaçables par des PBR photographiques CC0)
  images/cards/       visuels officiels des cartes (à fournir)
tests/                tests d’intégration
```

Rendu 3D : Three.js (WebGL), matériaux PBR, éclairage par spots encastrés à 3000 K et gorges lumineuses, réflexions capturées depuis la boutique elle-même, ombres douces sur ordinateur. Le rendu s’arrête quand rien ne bouge (économie de batterie) et un mode allégé est choisi automatiquement sur mobile (`?qualite=haute` ou `?qualite=basse` pour forcer). Si WebGL est indisponible ou trop lent, le visiteur est orienté vers le catalogue.
