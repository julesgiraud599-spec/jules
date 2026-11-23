import { db } from "./db";
import { computeScore, type ScoreResult } from "./scoring";
import { aliexpressConfigured, searchAliExpress } from "./aliexpress";
import { aiConfigured, analyzeProduct, AI_MODEL } from "./ai";
import { notify } from "./notify";
import { dayKey, NA } from "./format";

const productInclude = {
  listings: { include: { snapshots: true } },
  offers: true,
} as const;

export async function scoreProduct(productId: string): Promise<ScoreResult> {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { ...productInclude, user: true } });
  return computeScore(p.listings, p.competitorCount, p.offers, p.user);
}

/** Recalcule et enregistre le score d'un produit. */
export async function recomputeProduct(productId: string) {
  const r = await scoreProduct(productId);
  await db.product.update({
    where: { id: productId },
    data: {
      score: r.score, scoreConfidence: r.confidence, scoreBreakdown: JSON.stringify(r.components),
      avgVintedPrice: r.metrics.avgSoldPrice ?? r.metrics.avgPrice,
      recommendedPrice: r.metrics.recommendedPrice, purchasePrice: r.metrics.purchaseCost,
      grossMargin: r.metrics.grossMargin, marginPct: r.metrics.marginPct,
      totalFavorites: r.metrics.totalFavorites, demandLevel: r.demandLevel, competitionLevel: r.competitionLevel,
      computedAt: new Date(),
    },
  });
  return r;
}

/** Recherche les offres AliExpress correspondantes via l'API officielle. */
export async function refreshAliExpress(productId: string) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const results = await searchAliExpress(p.keywords, 10);
  const top = results.slice(0, 5);
  for (const r of top) {
    await db.supplierOffer.upsert({
      where: { productId_supplier_url: { productId, supplier: "ALIEXPRESS", url: r.url } },
      create: { productId, supplier: "ALIEXPRESS", title: r.title, url: r.url, price: r.price, imageUrl: r.imageUrl, externalId: r.externalId, salesVolume: r.salesVolume, rating: r.rating, source: "API" },
      update: { price: r.price, salesVolume: r.salesVolume, rating: r.rating, title: r.title, imageUrl: r.imageUrl, fetchedAt: new Date() },
    });
  }
  if (!p.imageUrl && top[0]?.imageUrl) await db.product.update({ where: { id: productId }, data: { imageUrl: top[0].imageUrl } });
  return top.length;
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
      prix_moyen: v(r.metrics.avgPrice), prix_moyen_vendus: v(r.metrics.avgSoldPrice),
      prix_min: v(r.metrics.minPrice), prix_max: v(r.metrics.maxPrice),
      delai_de_vente_observe_jours: v(r.metrics.observedDaysToSell),
      titres_annonces: p.listings.slice(0, 15).map((l) => `${l.title} — ${l.price} € — ${l.status === "SOLD" ? "VENDU" : "en ligne"} — ${l.favorites ?? "?"} favoris`),
    },
    fournisseurs: p.offers.map((o) => ({ fournisseur: o.supplier, titre: o.title, prix: o.price, port: v(o.shipping), ventes_fournisseur: v(o.salesVolume), correspondance_verifiee: o.confirmed })),
    calculs: {
      prix_conseille_algorithme: v(r.metrics.recommendedPrice), cout_achat: v(r.metrics.purchaseCost),
      marge_brute: v(r.metrics.grossMargin), marge_pct: v(r.metrics.marginPct), marge_nette_estimee: v(r.metrics.netMargin),
      score: v(r.score), confiance_donnees_pct: r.confidence,
    },
  };
}

export async function generateAnalysis(productId: string) {
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY non configurée.");
  const content = await analyzeProduct(await buildAiPayload(productId));
  return db.aIAnalysis.create({ data: { productId, content: JSON.stringify(content), model: AI_MODEL } });
}

/**
 * Pipeline quotidien :
 * 1. Rafraîchit les offres AliExpress (API officielle) des produits suivis.
 * 2. Recalcule tous les scores à partir des données Vinted observées.
 * 3. Sélectionne les 10 meilleures opportunités non proposées récemment.
 * 4. Génère l'analyse IA des produits sélectionnés.
 * 5. Notifie l'utilisateur.
 */
export async function runDaily(userId: string, opts: { force?: boolean } = {}) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const date = dayKey();
  const existing = await db.dailySelection.findUnique({ where: { userId_date: { userId, date } } });
  if (existing && !opts.force) return { skipped: true, selectionId: existing.id, count: 0 };

  const job = await db.jobRun.create({ data: { userId, type: "DAILY", status: "RUNNING" } });
  const log: string[] = [];
  let hadErrors = false;
  try {
    const products = await db.product.findMany({ where: { userId } });
    log.push(`${products.length} produit(s) suivi(s).`);

    if (aliexpressConfigured()) {
      for (const p of products) {
        try { log.push(`AliExpress « ${p.name} » : ${await refreshAliExpress(p.id)} offre(s).`); }
        catch (e) { hadErrors = true; log.push(`AliExpress « ${p.name} » : ERREUR ${(e as Error).message}`); }
      }
    } else log.push("API AliExpress non configurée : offres fournisseurs non rafraîchies (seules les offres saisies sont utilisées).");

    for (const p of products) await recomputeProduct(p.id);

    const cooldownStart = new Date(Date.now() - user.repeatCooldownDays * 86_400_000);
    const recent = await db.dailySelectionItem.findMany({
      where: { selection: { userId, createdAt: { gte: cooldownStart }, ...(existing ? { id: { not: existing.id } } : {}) } },
      select: { productId: true },
    });
    const excluded = new Set(recent.map((r) => r.productId));
    const candidates = await db.product.findMany({
      where: { userId, score: { not: null, gte: user.minDailyScore }, purchasePrice: { not: null }, listings: { some: {} } },
      orderBy: [{ score: "desc" }, { scoreConfidence: "desc" }],
    });
    const eligible = candidates.filter((c) => !excluded.has(c.id));
    const picked = eligible.slice(0, 10);
    log.push(`${candidates.length} candidat(s) éligible(s), ${candidates.length - eligible.length} exclu(s) car déjà proposés sous ${user.repeatCooldownDays} jours, ${picked.length} sélectionné(s).`);

    if (existing) await db.dailySelection.delete({ where: { id: existing.id } });
    const note = picked.length < 10
      ? `Seulement ${picked.length} produit(s) remplissent les critères (annonces Vinted observées + offre fournisseur). Ajoutez des observations pour compléter la sélection.`
      : null;
    const selection = await db.dailySelection.create({
      data: { userId, date, note, items: { create: picked.map((p, i) => ({ productId: p.id, rank: i + 1, score: p.score as number })) } },
    });

    if (aiConfigured()) {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      for (const p of picked) {
        const recentAnalysis = await db.aIAnalysis.findFirst({ where: { productId: p.id, createdAt: { gte: weekAgo } } });
        if (recentAnalysis) continue;
        try { await generateAnalysis(p.id); log.push(`Analyse IA générée : « ${p.name} ».`); }
        catch (e) { hadErrors = true; log.push(`Analyse IA « ${p.name} » : ERREUR ${(e as Error).message}`); }
      }
    } else log.push("ANTHROPIC_API_KEY non configurée : analyses IA non générées.");

    await db.user.update({ where: { id: userId }, data: { lastDailyRunAt: new Date() } });
    await notify(userId, `Sélection du ${date} disponible`,
      picked.length ? `${picked.length} opportunité(s) sélectionnée(s). Meilleur score : ${picked[0].score}/100 (${picked[0].name}).` : "Aucun produit ne remplit encore les critères de sélection.",
      "/daily");
    await db.jobRun.update({ where: { id: job.id }, data: { status: hadErrors ? "PARTIAL" : "SUCCESS", log: log.join("\n"), finishedAt: new Date() } });
    return { skipped: false, selectionId: selection.id, count: picked.length };
  } catch (e) {
    await db.jobRun.update({ where: { id: job.id }, data: { status: "ERROR", error: (e as Error).message, log: log.join("\n"), finishedAt: new Date() } });
    throw e;
  }
}

export async function runDailyForAllUsers(force = false) {
  const users = await db.user.findMany({ select: { id: true, email: true } });
  const results = [];
  for (const u of users) {
    try { results.push({ user: u.id, ...(await runDaily(u.id, { force })) }); }
    catch (e) { results.push({ user: u.id, error: (e as Error).message }); }
  }
  return results;
}
