# Glacier : product research Vinted et comptabilité

SaaS Next.js 15 / TypeScript / Prisma pour repérer des produits **sans marque** à fort potentiel sur Vinted, retrouver le produit chez AliExpress, Temu ou SHEIN, recevoir une sélection quotidienne de 10 opportunités et tenir sa comptabilité de revendeur.

---

## 1. Faisabilité de la collecte de données (à lire en premier)

| Source | Accès officiel ? | Ce que fait Glacier |
|---|---|---|
| **Vinted** | ❌ Pas d'API publique ni de programme partenaire « données de marché ». Les CGU interdisent la collecte automatisée (robots, scrapers). | **Aucun scraping.** Vous relevez les annonces que vous voyez (formulaire ou import CSV/tableur) : lien, prix, favoris, vues si affichées, statut « Vendu ». Chaque mise à jour crée un **relevé daté**, et c'est ce qui permet de mesurer l'évolution de la demande. |
| **AliExpress** | ✅ **API officielle Affiliés** (Open Platform, `aliexpress.affiliate.product.query`) | Recherche automatique des produits correspondants (prix EUR, livraison FR, photo, ventes 30 jours). Elle s'active avec vos clés App Key / App Secret. |
| **Temu** | ❌ Programme d'affiliation, mais pas d'API catalogue publique | Lien + prix saisis par vous, avec un bouton qui ouvre directement la recherche Temu. |
| **SHEIN** | ❌ Programme d'affiliation, mais pas d'API catalogue publique | Idem Temu. |

**Conséquences, en toute transparence :**
- La « détection automatique » sur Vinted n'est pas possible légalement sans API. Glacier automatise tout le reste : calculs, score, croisement fournisseurs via l'API AliExpress, sélection des 10 produits, analyse IA, notifications, historique. La matière première Vinted vient de vos observations. En pratique : une recherche Vinted, 5 annonces relevées, environ 2 minutes par produit.
- Le moteur **n'invente jamais de chiffres** : un champ inconnu affiche « Non disponible » et le critère correspondant est exclu du score. Les **ventes confirmées** (annonces vues « Vendu ») sont séparées des **signaux de demande** (favoris, vues).
- Les tendances sont calculées sur **vos** observations. Ce n'est pas un échantillon représentatif de tout Vinted.
- Si vous obtenez un jour une source Vinted autorisée (partenariat, export officiel), il suffit d'écrire des `VintedListing` + `ListingSnapshot`. Tout le reste fonctionne tel quel.

## 2. Liens fournisseurs et correspondance Vinted (moteur vérifié)

**Statut de chaque lien** : « Vérifié », « À vérifier manuellement » ou « Invalide » (`src/lib/links.ts`).

1. URL valide, en https.
2. Domaine appartenant au fournisseur (aliexpress.com, temu.com, shein.com/fr).
3. Fiche produit uniquement : les pages de recherche, de catégorie et d'accueil sont refusées, ainsi que les boutiques Temu étrangères. Un identifiant produit doit figurer dans l'URL. L'URL est enregistrée sous sa forme canonique, sans paramètres de suivi.
4. La page est chargée et chaque redirection est contrôlée : un 404, une redirection vers l'accueil ou vers un autre produit, ou la mention « plus au catalogue » rendent le lien invalide.
5. Le titre de la page est comparé au produit attendu.
6. Pour AliExpress, la vérification passe par l'API officielle (`productdetail.get`, avec livraison France) : elle confirme l'existence du produit, son prix actuel et sa disponibilité.

« Vérifié » exige une preuve : réponse de l'API officielle, page lue et concordante, ou votre confirmation (« C'est le bon produit », après avoir ouvert le lien). Si le site bloque les robots, ce qui est le cas de Temu, SHEIN et des pages AliExpress, le lien reste « À vérifier manuellement ». Chaque nuit, les liens sont revérifiés.

**Correspondance** (`src/lib/matching.ts`), notée sur 100 :
- comparaison des photos Vinted et fournisseur par l'IA (vision), poids 50 ;
- titre et caractéristiques, poids 25 ;
- couleurs, poids 15 ;
- dimensions, poids 10.

Un verdict visuel « différent » écarte l'offre. Sans comparaison visuelle ni confirmation de votre part, la correspondance reste « incertaine ».

**Top 10** : un produit n'y entre que s'il réunit des favoris Vinted relevés, une correspondance « même produit » et un lien « Vérifié ». S'il y a moins de 10 produits éligibles, la page l'indique avec les raisons d'exclusion. Elle n'est jamais complétée artificiellement.

**Score sur 100** :

| Critère | Poids |
|---|---|
| Demande observée | 30 |
| Demande / concurrence | 20 |
| Marge | 20 |
| Fiabilité de la correspondance | 15 |
| Stabilité de la tendance | 10 |
| Disponibilité fournisseur | 5 |

Les critères sans données sont exclus. Le score est ensuite multiplié par `0,3 + 0,7 × confiance`, et plafonné à 40 sans favoris relevés.

**Limites** :
- Vinted n'a pas d'API : les annonces sont relevées par vous.
- Temu et SHEIN n'ont pas d'API catalogue : leurs liens se confirment à la main.
- La recherche par image n'existe pas dans l'API Affiliés AliExpress standard. La correspondance visuelle se fait donc sur les candidats trouvés par mots-clés.

## 3. Fonctionnalités

- **Product Research** : fiches produit, annonces Vinted suivies avec historique des relevés, nombre d'annonces concurrentes, offres fournisseurs (API AliExpress ou saisie), filtres (fournisseur, catégorie, prix d'achat max, revente min/max, marge min, favoris, score, concurrence, ancienneté) et barre de recherche.
- **Fiche produit** : photo, catégorie, fournisseur, bouton « Voir le produit fournisseur », prix d'achat, prix moyen Vinted, prix conseillé, marge brute et %, marge nette estimée, favoris, demande, concurrence, ventes confirmées, évolution, délai de vente observé, score sur 100 avec détail par critère et taux de données disponibles, date de détection, bouton favoris.
- **10 produits par jour** (`src/lib/engine.ts → runDaily`) : rafraîchissement AliExpress, recalcul des scores, top 10 sans répétition (délai réglable, 14 jours par défaut), analyses IA, notification in-app et webhook (Discord, Slack, ntfy). Si moins de 10 produits sont éligibles, la sélection en contient moins, et c'est indiqué.
- **IA (Claude)** : pour chaque produit, pourquoi il peut se vendre, tendance passagère ou durable, concurrence, prix conseillé, marge espérée, verdict, risques (dont la contrefaçon) et conseils d'annonce. Elle ne reçoit que les données réellement observées.
- **Comptabilité** : ventes (option prélèvement de stock), frais, remboursements (avec remise en stock), dépenses, stock, cotisations micro-entreprise estimées, 7 graphiques, calendrier mensuel, exports CSV et Excel.
- **Comptes** : inscription et connexion (bcrypt + session JWT httpOnly), toutes les données sont isolées par utilisateur.

## 4. Installation

Mise en ligne (Vercel + Supabase) : voir **[DEPLOIEMENT.md](DEPLOIEMENT.md)**.

En local (il faut un PostgreSQL : Supabase gratuit ou Postgres installé) :

```bash
npm install
cp .env.example .env    # renseigner DATABASE_URL, DIRECT_URL, AUTH_SECRET (openssl rand -hex 32), CRON_SECRET
npx prisma db push
npm run dev             # http://localhost:3000
```

Variables optionnelles :
- `ANTHROPIC_API_KEY` : analyses IA (modèle `claude-opus-5-5`, avec repli automatique en cas de refus).
- `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`, `ALIEXPRESS_TRACKING_ID` : compte sur https://openservice.aliexpress.com, application de type « Affiliates », puis récupération du tracking ID dans le portail Affiliés AliExpress.

## 5. Tâche quotidienne

Trois façons de la lancer, au choix :
1. **Vercel** : `vercel.json` appelle `/api/cron/daily` chaque jour à 6 h UTC. Définissez `CRON_SECRET` dans le projet : Vercel envoie automatiquement `Authorization: Bearer $CRON_SECRET`.
2. **Serveur ou VPS** : crontab `0 7 * * * cd /chemin/glacier && npm run daily`.
3. **Planificateur externe** : `curl -H "Authorization: Bearer $CRON_SECRET" https://votre-domaine/api/cron/daily`.

Bouton manuel : page **Produits du jour**, « Lancer / Régénérer la sélection ». Le journal de chaque exécution se trouve dans **Historique**.

## 6. Base de données

PostgreSQL via Prisma. Supabase en production : `DATABASE_URL` = pooler (port 6543, `?pgbouncer=true`), `DIRECT_URL` = connexion directe ou « Session » (port 5432). Les tables sont créées automatiquement au déploiement (`npm run vercel-build` → `prisma db push`).

## 7. Tests

```bash
npm test         # tests unitaires : score, absence de données inventées, marges, compta, signature AliExpress
npm run lint     # vérification TypeScript
npm run build
```

## 8. Rappels légaux

- Revendre régulièrement des articles neufs achetés pour la revente est une activité commerciale : compte **Vinted Pro** et statut de micro-entrepreneur.
- Vinted transmet les données des vendeurs au fisc (DAC7 : au-delà de 30 ventes ou 2 000 € par an).
- Uniquement des produits **sans marque** : aucun logo, nom ni design protégé.
