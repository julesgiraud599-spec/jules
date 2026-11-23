# Mettre Glacier en ligne (gratuit) : Supabase + Vercel

Durée : environ 10 minutes. Tu n'as rien à installer sur ton ordinateur.

## Étape 1 : créer la base de données (Supabase)

1. Va sur https://supabase.com, crée un compte, puis clique sur **New project**.
2. Nom : `glacier`. Choisis un **mot de passe de base de données** et **note-le**. Région : *West EU (Paris)*.
3. Une fois le projet prêt, clique sur **Connect** (en haut de la page du projet), onglet **ORMs**, puis choisis **Prisma**.
4. Copie les deux lignes affichées :
   - `DATABASE_URL=...6543/postgres?pgbouncer=true`
   - `DIRECT_URL=...5432/postgres`
   Remplace `[YOUR-PASSWORD]` par ton mot de passe dans les deux lignes.

## Étape 2 : déployer le site (Vercel)

1. Va sur https://vercel.com et connecte-toi **avec ton compte GitHub**.
2. Clique sur **Add New… → Project** et importe le dépôt `jules`.
3. Avant de cliquer sur Deploy, ouvre **Environment Variables** et ajoute :

| Nom | Valeur |
|---|---|
| `DATABASE_URL` | la ligne 6543 de Supabase |
| `DIRECT_URL` | la ligne 5432 de Supabase |
| `AUTH_SECRET` | une longue chaîne aléatoire (au moins 32 caractères) |
| `CRON_SECRET` | une autre chaîne aléatoire |

4. Clique sur **Deploy**. Après 2 ou 3 minutes, Vercel affiche l'adresse de ton site (`https://….vercel.app`).
5. Ouvre l'adresse, clique sur **Créer un compte**, et c'est en ligne.

## Étape 3 (facultatif) : activer l'IA et AliExpress

Dans Vercel → ton projet → **Settings → Environment Variables**, ajoute :
- `ANTHROPIC_API_KEY` : clé créée sur https://console.anthropic.com.
- `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`, `ALIEXPRESS_TRACKING_ID` : clés de l'API Affiliés sur https://openservice.aliexpress.com.
- `APP_URL` : l'adresse de ton site, pour les liens dans les notifications.

Puis **Deployments → ⋯ → Redeploy**.

## La sélection quotidienne

Elle se lance toute seule chaque jour à 6 h UTC (7 h ou 8 h à Paris), grâce à `vercel.json`. Tu peux aussi la lancer à la main depuis **Produits du jour**.
