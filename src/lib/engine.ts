import { db } from "./db";
import { computeScore, type ScoreResult } from "./scoring";
import { aliexpressConfigured, searchAliExpress, productDetails } from "./aliexpress";
import { aiConfigured, analyzeProduct, AI_MODEL } from "./ai";
import { checkLink, type Supplier } from "./links";
import { computeMatch, compareImages, type Visual } from "./matching";
import { notify } from "./notify";
import { dayKey, NA } from "./format";

const productInclude = {
  listings: { include: { snapshots: true } },
  offers: true,
} as const;

export async function scoreProduct(productId: string): Promise<ScoreResult> {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { ...productInclude, user: true } });
  return computeScore(p.listings, p.competitorCount, p.offers, p.user, p.recentListings);
}

/** Recalcule et enregistre le score d'un produit. */
export async function recomputeProduct(productId: string) {
  const r = await scoreProduct(productId);
  await db.product.update({
    where: { id: productId },
    data: {
      score: r.score, scoreConfidence: r.confidence, scoreBreakdown: JSON.stringify(r.components), selectionBlocker: r.blocker,
      avgVintedPrice: r.metrics.avgSoldPrice ?? r.metrics.avgPrice,
      recommendedPrice: r.metrics.recommendedPrice, purchasePrice: r.metrics.purchaseCost,
      grossMargin: r.metrics.grossMargin, marginPct: r.metrics.marginPct,
      totalFavorites: r.metrics.totalFavorites, demandLevel: r.demandLevel, competitionLevel: r.competitionLevel,
      computedAt: new Date(),
    },
  });
  return r;
}

/** Photo et titres Vinted servant de référence pour la correspondance. */
async function vintedReference(productId: string) {
  const listings = await db.vintedListing.findMany({ where: { productId }, orderBy: { favorites: { sort: "desc", nulls: "last" } } });
  const ref = listings.find((l) => l.photoUrl?.startsWith("https://"));
  return { titles: listings.map((l) => l.title), photo: ref?.photoUrl ?? null, refTitle: ref?.title ?? listings[0]?.title ?? "" };
}

async function visualCheck(photo: string | null, images: string[], refTitle: string, supplierTitle: string): Promise<{ visual: Visual | null; note: string | null }> {
  if (!photo) return { visual: null, note: "Pas de photo Vinted de référence" };
  if (!images.length) return { visual: null, note: "Pas de photo fournisseur" };
  if (!aiConfigured()) return { visual: null, note: "IA non configurée" };
  try { return { visual: await compareImages(photo, images, { vintedTitle: refTitle, supplierTitle }), note: null }; }
  catch (e) { return { visual: null, note: (e as Error).message }; }
}

/** (Re)calcule la correspondance d'une offre avec le produit Vinted. */
export async function rematchOffer(offerId: string) {
  const o = await db.supplierOffer.findUniqueOrThrow({ where: { id: offerId } });
  const ref = await vintedReference(o.productId);
  const { visual, note } = await visualCheck(ref.photo, o.imageUrl ? [o.imageUrl] : [], ref.refTitle, o.title);
  const m = computeMatch({ vintedTitles: ref.titles, supplierTitle: o.title, visual, userConfirmed: o.confirmed });
  await db.supplierOffer.update({ where: { id: offerId }, data: { matchStatus: m.status, matchScore: m.score, matchDetail: JSON.stringify({ signals: m.signals, visualNote: note }) } });
  return m;
}

/** Vérifie le lien d'une offre (API officielle pour AliExpress, sinon lecture de la page). */
export async function verifyOffer(offerId: string) {
  const o = await db.supplierOffer.findUniqueOrThrow({ where: { id: offerId } });
  const now = new Date();
  if (o.supplier === "ALIEXPRESS" && o.externalId && aliexpressConfigured()) {
    try {
      const found = (await productDetails([o.externalId])).get(o.externalId);
      const steps = [{ step: "API officielle AliExpress", ok: Boolean(found), detail: found ? `Produit ${o.externalId} trouvé, ${found.price} €` : `Produit ${o.externalId} introuvable ou non livrable en France` }];
      await db.supplierOffer.update({ where: { id: offerId }, data: found
        ? { linkStatus: "VERIFIED", linkVerifiedBy: "API", linkCheckedAt: now, linkCheckDetail: JSON.stringify({ steps, reason: "Vérifié par l'API officielle AliExpress" }), url: found.url, affiliateUrl: found.affiliateUrl, price: found.price, available: true, finalUrl: found.url, imageUrl: o.imageUrl ?? found.imageUrl }
        : { linkStatus: "INVALID", linkVerifiedBy: "API", linkCheckedAt: now, linkCheckDetail: JSON.stringify({ steps, reason: "Produit introuvable via l'API officielle AliExpress" }), available: false } });
      return found ? "VERIFIED" : "INVALID";
    } catch (e) { /* l'API a échoué : on tente la lecture de la page */ void e; }
  }
  const c = await checkLink(o.url, o.supplier as Supplier, o.title);
  // Une confirmation de l'utilisateur n'est annulée que par une preuve d'invalidité.
  const keepUser = o.linkVerifiedBy === "USER" && o.linkStatus === "VERIFIED" && c.status !== "INVALID";
  await db.supplierOffer.update({
    where: { id: offerId },
    data: {
      linkStatus: keepUser ? "VERIFIED" : c.status,
      linkVerifiedBy: keepUser ? "USER" : c.verifiedBy,
      linkCheckedAt: now,
      linkCheckDetail: JSON.stringify({ steps: c.steps, reason: keepUser ? `Confirmé par vous (dernier contrôle automatique : ${c.reason})` : c.reason }),
      finalUrl: c.finalUrl,
      available: c.available ?? o.available,
      ...(c.canonicalUrl ? { url: c.canonicalUrl } : {}),
      ...(c.externalId ? { externalId: c.externalId } : {}),
    },
  });
  return keepUser ? "VERIFIED" : c.status;
}

/**
 * Recherche AliExpress (API officielle) à partir des annonces Vinted du produit.
 * Chaque candidat est comparé au produit Vinted ; les produits différents sont écartés, pas enregistrés.
 */
export async function findAliExpressMatches(productId: string, log: (s: string) => void = () => {}) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const ref = await vintedReference(productId);
  if (!ref.titles.length) { log(`« ${p.name} » : aucune annonce Vinted, recherche fournisseur ignorée.`); return { kept: 0, rejected: 0 }; }
  const results = await searchAliExpress(p.keywords, 20);
  // Pré-filtre par le texte, puis comparaison visuelle des 6 meilleurs seulement (coût maîtrisé).
  const pre = results
    .map((r) => ({ r, m: computeMatch({ vintedTitles: ref.titles, supplierTitle: r.title }) }))
    .filter((x) => x.m.status !== "REJECTED")
    .sort((a, b) => (b.m.score ?? 0) - (a.m.score ?? 0))
    .slice(0, 6);
  let kept = 0, rejected = results.length - pre.length;
  for (const { r } of pre) {
    const { visual, note } = await visualCheck(ref.photo, r.images, ref.refTitle, r.title);
    const m = computeMatch({ vintedTitles: ref.titles, supplierTitle: r.title, visual });
    if (m.status === "REJECTED") { rejected++; continue; }
    const data = {
      title: r.title, price: r.price, imageUrl: r.imageUrl, externalId: r.externalId, salesVolume: r.salesVolume, rating: r.rating, affiliateUrl: r.affiliateUrl,
      linkStatus: "VERIFIED", linkVerifiedBy: "API", linkCheckedAt: new Date(), finalUrl: r.url, available: true,
      linkCheckDetail: JSON.stringify({ steps: [{ step: "API officielle AliExpress", ok: true, detail: `Produit ${r.externalId} renvoyé par l'API` }], reason: "Vérifié par l'API officielle AliExpress" }),
      matchStatus: m.status, matchScore: m.score, matchDetail: JSON.stringify({ signals: m.signals, visualNote: note }), fetchedAt: new Date(),
    };
    await db.supplierOffer.upsert({
      where: { productId_supplier_url: { productId, supplier: "ALIEXPRESS", url: r.url } },
      create: { productId, supplier: "ALIEXPRESS", url: r.url, source: "API", ...data },
      update: data,
    });
    kept++;
  }
  log(`AliExpress « ${p.name} » : ${results.length} résultat(s), ${kept} conservé(s), ${rejected} écarté(s) (produit différent).`);
  return { kept, rejected };
}

/** Données envoyées à l'IA : uniquement ce qui a été réellement observé. */
export async function buildAiPayload(productId: string) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { ...productInclude } });
  const r = await scoreProduct(productId);
  const v = <T,>(x: T | null | undefined) => (x === null || x === undefined ? NA : x);
  return {
    produit: { nom: p.name, categorie: p.category, mots_cles: p.keywords },
    vinted: {
      annonces_suivies: r.metrics.observedListings,
      ventes_confirmees: r.metrics.confirmedSales,
      taux_de_vente_pct: v(r.metrics.sellThrough),
      favoris_total: v(r.metrics.totalFavorites),
      favoris_median: v(r.metrics.medianFavorites),
      vues_total: v(r.metrics.totalViews),
      croissance_favoris_par_jour: v(r.metrics.favoritesGrowthPerDay),
      annonces_concurrentes: v(r.metrics.competitorCount),
      annonces_recentes: v(r.metrics.recentListings),
      prix_moyen: v(r.metrics.avgPrice), prix_moyen_vendus: v(r.metrics.avgSoldPrice),
      prix_min: v(r.metrics.minPrice), prix_max: v(r.metrics.maxPrice),
      delai_de_vente_observe_jours: v(r.metrics.observedDaysToSell),
      titres_annonces: p.listings.slice(0, 15).map((l) => `${l.title} — ${l.price} € — ${l.status === "SOLD" ? "VENDU" : "en ligne"} — ${l.favorites ?? "?"} favoris`),
    },
    fournisseurs: p.offers.map((o) => ({ fournisseur: o.supplier, titre: o.title, prix: o.price, port: v(o.shipping), ventes_fournisseur: v(o.salesVolume), lien: o.linkStatus, correspondance: o.matchStatus, score_correspondance: v(o.matchScore) })),
    calculs: {
      prix_conseille_algorithme: v(r.metrics.recommendedPrice), cout_achat: v(r.metrics.purchaseCost),
      marge_brute: v(r.metrics.grossMargin), marge_pct: v(r.metrics.marginPct), marge_nette_estimee: v(r.metrics.netMargin),
      score: v(r.score), confiance_donnees_pct: r.confidence, blocage_top10: v(r.blocker),
    },
  };
}

export async function generateAnalysis(productId: string) {
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY non configurée.");
  const content = await analyzeProduct(await buildAiPayload(productId));
  return db.aIAnalysis.create({ data: { productId, content: JSON.stringify(content), model: AI_MODEL } });
}

/**
 * Pipeline quotidien (tourne sans que l'utilisateur soit connecté : cron Vercel, crontab ou npm run daily) :
 * 1. Recherche des correspondances AliExpress (API officielle) pour chaque produit suivi.
 * 2. Revérification des liens fournisseurs (API AliExpress ou lecture de la page).
 * 3. Recalcul de la correspondance des offres non comparées.
 * 4. Recalcul des scores.
 * 5. Sélection du Top 10 (produits éligibles uniquement, sans doublon récent) + raisons d'exclusion.
 * 6. Analyse IA des produits sélectionnés.
 * 7. Notification.
 */
export async function runDaily(userId: string, opts: { force?: boolean } = {}) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const date = dayKey();
  const existing = await db.dailySelection.findUnique({ where: { userId_date: { userId, date } } });
  if (existing && !opts.force) return { skipped: true, selectionId: existing.id, count: 0 };

  const job = await db.jobRun.create({ data: { userId, type: "DAILY", status: "RUNNING" } });
  const log: string[] = [];
  const say = (s: string) => log.push(s);
  let hadErrors = false;
  try {
    const products = await db.product.findMany({ where: { userId } });
    say(`${products.length} produit(s) suivi(s).`);
    say("Vinted : aucune API publique ni accès autorisé — les annonces proviennent de vos relevés (saisie ou import).");

    if (aliexpressConfigured()) {
      for (const p of products) {
        try { await findAliExpressMatches(p.id, say); }
        catch (e) { hadErrors = true; say(`AliExpress « ${p.name} » : ERREUR ${(e as Error).message}`); }
      }
    } else say("API AliExpress non configurée : pas de recherche fournisseur automatique (seules les offres saisies sont utilisées).");

    const stale = new Date(Date.now() - 20 * 3_600_000);
    const offers = await db.supplierOffer.findMany({ where: { product: { userId }, OR: [{ linkCheckedAt: null }, { linkCheckedAt: { lt: stale } }] } });
    const counts: Record<string, number> = {};
    for (const o of offers) {
      try { const s = await verifyOffer(o.id); counts[s] = (counts[s] ?? 0) + 1; }
      catch (e) { hadErrors = true; say(`Vérification du lien ${o.url} : ERREUR ${(e as Error).message}`); }
    }
    say(`Liens revérifiés : ${offers.length} (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "aucun"}).`);

    const pending = await db.supplierOffer.findMany({ where: { product: { userId }, matchStatus: "PENDING" } });
    for (const o of pending) { try { await rematchOffer(o.id); } catch (e) { hadErrors = true; say(`Correspondance ${o.title} : ERREUR ${(e as Error).message}`); } }

    for (const p of products) await recomputeProduct(p.id);

    const cooldownStart = new Date(Date.now() - user.repeatCooldownDays * 86_400_000);
    const recent = await db.dailySelectionItem.findMany({
      where: { selection: { userId, createdAt: { gte: cooldownStart }, ...(existing ? { id: { not: existing.id } } : {}) } },
      select: { productId: true },
    });
    const excludedRecent = new Set(recent.map((r) => r.productId));
    const all = await db.product.findMany({ where: { userId }, orderBy: [{ score: { sort: "desc", nulls: "last" } }, { scoreConfidence: "desc" }] });
    const reasons = new Map<string, number>();
    const bump = (k: string) => reasons.set(k, (reasons.get(k) ?? 0) + 1);
    const picked = [];
    for (const p of all) {
      if (p.selectionBlocker) { bump(p.selectionBlocker); continue; }
      if (p.score === null || p.score < user.minDailyScore) { bump(`Score inférieur au minimum (${user.minDailyScore})`); continue; }
      if (excludedRecent.has(p.id)) { bump(`Déjà proposé ces ${user.repeatCooldownDays} derniers jours`); continue; }
      if (picked.length < 10) picked.push(p);
    }
    const why = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} × ${k}`).join(" · ");
    say(`${picked.length} produit(s) sélectionné(s). Exclus : ${why || "aucun"}.`);

    if (existing) await db.dailySelection.delete({ where: { id: existing.id } });
    const note = picked.length < 10
      ? `${picked.length} produit(s) seulement remplissent toutes les conditions (favoris Vinted relevés, correspondance fournisseur fiable, lien vérifié). Produits écartés : ${why || "aucun produit suivi"}.`
      : null;
    const selection = await db.dailySelection.create({
      data: { userId, date, note, items: { create: picked.map((p, i) => ({ productId: p.id, rank: i + 1, score: p.score as number })) } },
    });

    if (aiConfigured()) {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      for (const p of picked) {
        if (await db.aIAnalysis.findFirst({ where: { productId: p.id, createdAt: { gte: weekAgo } } })) continue;
        try { await generateAnalysis(p.id); say(`Analyse IA générée : « ${p.name} ».`); }
        catch (e) { hadErrors = true; say(`Analyse IA « ${p.name} » : ERREUR ${(e as Error).message}`); }
      }
    } else say("ANTHROPIC_API_KEY non configurée : analyses IA et comparaisons visuelles désactivées.");

    await db.user.update({ where: { id: userId }, data: { lastDailyRunAt: new Date() } });
    await notify(userId, `Top 10 du ${date} disponible`,
      picked.length ? `${picked.length} opportunité(s) vérifiée(s). Meilleur score : ${picked[0].score}/100 (${picked[0].name}).` : "Aucun produit ne remplit encore toutes les conditions de fiabilité.",
      "/daily");
    await db.jobRun.update({ where: { id: job.id }, data: { status: hadErrors ? "PARTIAL" : "SUCCESS", log: log.join("\n"), finishedAt: new Date() } });
    return { skipped: false, selectionId: selection.id, count: picked.length };
  } catch (e) {
    await db.jobRun.update({ where: { id: job.id }, data: { status: "ERROR", error: (e as Error).message, log: log.join("\n"), finishedAt: new Date() } });
    throw e;
  }
}

export async function runDailyForAllUsers(force = false) {
  const users = await db.user.findMany({ select: { id: true } });
  const results = [];
  for (const u of users) {
    try { results.push({ user: u.id, ...(await runDaily(u.id, { force })) }); }
    catch (e) { results.push({ user: u.id, error: (e as Error).message }); }
  }
  return results;
}
