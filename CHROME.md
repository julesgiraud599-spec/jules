# Recherche Chrome : installer et connecter Claude Code, Chrome et Glacier

## Architecture

```
Claude Code ──(MCP, stdio)──► bridge/index.js (pont local, sur votre ordinateur)
                                   │ WebSocket 127.0.0.1:8765 + jeton secret
                                   ▼
                     Extension Chrome « Glacier » (dossier extension/)
                                   │ lit les pages Vinted / AliExpress / Temu ouvertes dans VOTRE Chrome
                                   ▼ HTTPS + clé d'API Glacier (jamais de cookies)
                     Glacier : /api/chrome/* → page « Recherche Chrome »
```

**Trois façons de lancer une recherche :**
1. Claude Code : « Trouve-moi les 10 meilleurs produits à vendre sur Vinted aujourd'hui ».
2. Glacier, page **Recherche Chrome**, bouton « Lancer dans Chrome ».
3. L'extension : « Lancer une recherche » ou « Analyser cette page ».

**Si Chrome est fermé**, les recherches lancées depuis Glacier et celles de la tâche quotidienne attendent jusqu'à 8 h, puis passent en « Expirée » avec la raison. Elles ne font jamais semblant d'avoir été exécutées.

## Règles de sécurité appliquées

- Une seule page chargée toutes les 3,5 à 5 secondes, 80 pages par heure au maximum, dans un onglet en arrière-plan.
- **Arrêt immédiat** sur un CAPTCHA, une vérification anti-robot (DataDome, Cloudflare, AliExpress) ou une page de connexion. Vous la résolvez vous-même, puis vous relancez.
- Lecture du contenu **visible** uniquement. Aucun mot de passe, cookie ni jeton de session n'est lu ou transmis.
- Le pont n'écoute que sur `127.0.0.1` et exige un jeton secret.
- Claude Code ne peut rien faire tant que vous n'avez pas coché « Autoriser Claude Code » dans l'extension. Il ne peut ouvrir que des pages Vinted, AliExpress ou Temu en https.
- Les conditions d'utilisation de Vinted interdisent la collecte automatisée. Utilisez cet outil pour vos propres recherches, à petite échelle et à rythme humain. Le risque vis-à-vis de Vinted reste le vôtre.

## Installation (une seule fois)

### 1. Prérequis
- Google Chrome, version 116 ou plus récente.
- Node.js 20 ou plus récent (https://nodejs.org).
- Claude Code installé sur votre ordinateur.
- Le projet Glacier sur votre ordinateur :

  ```bash
  git clone https://github.com/julesgiraud599-spec/jules.git glacier
  ```

  ```bash
  cd glacier/bridge && npm install
  ```

### 2. Clé d'API Glacier
Dans Glacier, ouvrez **Paramètres → Recherche Chrome → Créer une clé d'API**, puis copiez la clé `glc_…`. Elle n'est affichée qu'une fois.

### 3. Installer l'extension dans Chrome
1. Ouvrez `chrome://extensions`.
2. Activez le **Mode développeur** (en haut à droite).
3. Cliquez sur **Charger l'extension non empaquetée** et choisissez le dossier `glacier/extension`.
4. Épinglez l'extension « Glacier » (icône puzzle, puis l'épingle).

### 4. Connecter Claude Code
1. Récupérez le jeton du pont :

   ```bash
   node bridge/index.js token
   ```

2. Définissez l'adresse de Glacier et la clé d'API (macOS ou Linux ; sous Windows, utilisez `setx`). Remplacez les deux valeurs par les vôtres :

   ```bash
   export GLACIER_URL="https://votre-glacier.vercel.app"
   ```

   ```bash
   export GLACIER_API_KEY="glc_votre_cle"
   ```

3. Lancez Claude Code **dans le dossier glacier**. Le fichier `.mcp.json` du projet déclare le serveur `glacier-chrome`, et Claude Code vous demande de l'approuver au premier lancement :

   ```bash
   claude
   ```

   Vérifiez ensuite avec la commande `/mcp` : « glacier-chrome » doit apparaître comme connecté.

### 5. Régler l'extension
Cliquez sur l'icône Glacier, puis sur **Réglages** :
1. Collez le **jeton du pont** (étape 4.1).
2. Indiquez l'**adresse de Glacier** et la **clé d'API**.
3. Cliquez sur **Enregistrer**, puis sur **Tester Glacier**.
4. Cochez **« Autoriser Claude Code à piloter Chrome »**.

La ligne « Claude Code » passe au vert quand Claude Code est lancé. La ligne « Glacier » passe au vert à la première vérification, dans la minute.

### 6. Vous connecter vous-même
Ouvrez Vinted, AliExpress et Temu dans Chrome et connectez-vous à la main si vous le souhaitez. L'extension utilise votre navigateur tel quel. Elle ne voit jamais vos identifiants.

## Utilisation

- **Dans Claude Code**, demandez par exemple :
  - « Trouve-moi les 10 meilleurs produits à vendre sur Vinted aujourd'hui. Cherche : pince à cheveux XXL, écharpe à franges, sac demi-lune, bonnet côtelé, chouchous satin. »

    Claude utilise `run_product_research`, puis `glacier_top_products`.
  - « Analyse le marché Vinted pour "pince crabe" » → `analyze_market`.
  - « Vérifie ce lien Temu » → `verify_product_link`.
- **Dans Glacier**, page Recherche Chrome :
  - Saisissez des mots-clés, puis cliquez sur **Lancer dans Chrome**.
  - Les résultats montrent les annonces Vinted, puis les produits fournisseurs avec leur lien (Vérifié, À vérifier manuellement ou Invalide), la correspondance, le prix et la marge.
  - **Ajouter à Product Research** crée la fiche produit. Sur la fiche, **C'est le bon produit**, puis **Ajouter au Top 10 du jour**.
- **Chaque jour** : dans Paramètres, renseignez vos « Mots-clés recherchés chaque jour dans Chrome ». La tâche quotidienne les met en file, et Chrome les exécute dès qu'il est ouvert.

## Outils MCP disponibles

| Outil | Rôle |
|---|---|
| `connection_status` | Indique si l'extension est connectée et si Glacier est configuré |
| `get_open_tabs` | Liste les onglets ouverts |
| `open_website` | Ouvre une page Vinted, AliExpress ou Temu |
| `search_vinted`, `search_aliexpress`, `search_temu` | Lit les résultats visibles d'une recherche |
| `extract_product_data` | Lit une fiche produit ou une page de recherche ouverte |
| `verify_product_link` | Ouvre la fiche et vérifie qu'elle existe, sans redirection, avec un produit disponible et le bon titre |
| `compare_products` | Classe des produits fournisseurs selon leur ressemblance textuelle avec l'annonce Vinted |
| `analyze_market` | Donne les statistiques Vinted observées (les favoris ne sont pas des ventes) |
| `run_product_research` | Enchaîne Vinted, AliExpress et Temu, vérifie les liens et envoie le tout à Glacier |
| `save_to_glacier` | Envoie un résultat à Glacier |
| `glacier_top_products` | Donne le classement Glacier |

## Limites connues

- **Temu** : depuis un serveur de test, la page de recherche s'affiche vide (protection contre les navigateurs automatisés). Les sélecteurs Temu n'ont donc été validés que sur des pages de test. Dans votre Chrome, c'est à vérifier dès la première recherche. Si rien n'est lu, utilisez « Analyser cette page » sur une recherche Temu ouverte par vous.
- **AliExpress** : les fiches produit affichent souvent une vérification anti-robot. L'extension s'arrête alors et marque le lien « À vérifier manuellement ». Hors de France, les prix sont en dollars et ne sont pas utilisés pour les marges.
- **Comparaison des photos** : elle nécessite `ANTHROPIC_API_KEY` dans Glacier. Sans elle, une correspondance reste « incertaine » jusqu'à votre confirmation.
- Les sites changent leur code régulièrement. Si une donnée n'apparaît plus, l'extension renvoie « null », jamais une valeur inventée. Les extracteurs sont dans `extension/extractors.js`.

## Tests

```bash
node tests/extension/run.mjs
```

Ce test lance Chromium avec l'extension, le pont MCP (client MCP officiel) et Glacier. Il couvre les pages de test, le CAPTCHA, la file d'attente Glacier et les vrais sites. Glacier doit tourner sur `GLACIER_URL`, par défaut `http://localhost:3100`.
