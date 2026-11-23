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

## 2. Fonctionnalités

- **Product Research** : fiches produit, annonces Vinted suivies avec historique des relevés, nombre d'annonces concurrentes, offres fournisseurs (API AliExpress ou saisie), filtres (fournisseur, catégorie, prix d'achat max, revente min/max, marge min, favoris, score, concurrence, ancienneté) et barre de recherche.
- **Fiche produit** : photo, catégorie, fournisseur, bouton « Voir le produit fournisseur », prix d'achat, prix moyen Vinted, prix conseillé, marge brute et %, marge nette estimée, favoris, demande, concurrence, ventes confirmées, évolution, délai de vente observé, score sur 100 avec détail par critère et taux de données disponibles, date de détection, bouton favoris.
- **Score sur 100** (`src/lib/scoring.ts`) : demande (favoris) 25, ventes confirmées 20, marge 20, concurrence 15, évolution 10, rapport demande/offre 10. C'est une moyenne pondérée **des seuls critères disponibles**, multipliée par `0,6 + 0,4 × confiance` pour pénaliser les fiches peu renseignées.
- **10 produits par jour** (`src/lib/engine.ts → runDaily`) : rafraîchissement AliExpress, recalcul des scores, top 10 sans répétition (délai réglable, 14 jours par défaut), analyses IA, notification in-app et webhook (Discord, Slack, ntfy). Si moins de 10 produits sont éligibles, la sélection en contient moins, et c'est indiqué.
- **IA (Claude)** : pour chaque produit, pourquoi il peut se vendre, tendance passagère ou durable, concurrence, prix conseillé, marge espérée, verdict, risques (dont la contrefaçon) et conseils d'annonce. Elle ne reçoit que les données réellement observées.
- **Comptabilité** : ventes (option prélèvement de stock), frais, remboursements (avec remise en stock), dépenses, stock, cotisations micro-entreprise estimées, 7 graphiques, calendrier mensuel, exports CSV et Excel.
- **Comptes** : inscription et connexion (bcrypt + session JWT httpOnly), toutes les données sont isolées par utilisateur.

## 3. Installation

```bash
npm install
cp .env.example .env    # puis renseigner AUTH_SECRET (openssl rand -hex 32) et CRON_SECRET
npx prisma db push
npm run dev             # http://localhost:3000
```

Variables optionnelles :
- `ANTHROPIC_API_KEY` : analyses IA (modèle `claude-opus-5-5`, avec repli automatique en cas de refus).
- `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`, `ALIEXPRESS_TRACKING_ID` : compte sur https://openservice.aliexpress.com, application de type « Affiliates », puis récupération du tracking ID dans le portail Affiliés AliExpress.

## 4. Tâche quotidienne

Trois façons de la lancer, au choix :
1. **Vercel** : `vercel.json` appelle `/api/cron/daily` chaque jour à 6 h UTC. Définissez `CRON_SECRET` dans le projet : Vercel envoie automatiquement `Authorization: Bearer $CRON_SECRET`.
2. **Serveur ou VPS** : crontab `0 7 * * * cd /chemin/glacier && npm run daily`.
3. **Planificateur externe** : `curl -H "Authorization: Bearer $CRON_SECRET" https://votre-domaine/api/cron/daily`.

Bouton manuel : page **Produits du jour**, « Lancer / Régénérer la sélection ». Le journal de chaque exécution se trouve dans **Historique**.

## 5. Passer sur Supabase (Postgres)

Dans `prisma/schema.prisma`, mettez `provider = "postgresql"`, puis `DATABASE_URL` = chaîne de connexion Supabase (pooler), puis `npx prisma db push`. Aucun autre changement n'est nécessaire.

## 6. Tests

```bash
npm test         # tests unitaires : score, absence de données inventées, marges, compta, signature AliExpress
npm run lint     # vérification TypeScript
npm run build
```

## 7. Rappels légaux

- Revendre régulièrement des articles neufs achetés pour la revente est une activité commerciale : compte **Vinted Pro** et statut de micro-entrepreneur.
- Vinted transmet les données des vendeurs au fisc (DAC7 : au-delà de 30 ventes ou 2 000 € par an).
- Uniquement des produits **sans marque** : aucun logo, nom ni design protégé.
