/**
 * Recherche Chrome — côté serveur Glacier.
 * Reçoit les données lues par l'extension (jamais de cookies), calcule les correspondances,
 * et transforme un résultat validé en produit suivi (Product Research → Top 10).
 */
import crypto from "node:crypto";
import { db } from "./db";
import { computeMatch, compareImages, type Visual } from "./matching";
import { aiConfigured } from "./ai";
import { staticCheck, type Supplier } from "./links";
import { recomputeProduct } from "./engine";
import { median } from "./scoring";
import { dayKey } from "./format";

/* ------------------------------ clé d'API ------------------------------ */
export const hashKey = (k: string) => crypto.createHash("sha256").update(k).digest("hex");
export function newApiKey() { const key = "glc_" + crypto.randomBytes(24).toString("base64url"); return { key, hash: hashKey(key), prefix: key.slice(0, 10) }; }
export async function userFromRequest(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(glc_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  return db.user.findUnique({ where: { apiKeyHash: hashKey(m[1]) } });
}

/* ------------------------------ file d'attente ------------------------------ */
export const JOB_TTL_HOURS = 8;
export async function enqueueJobs(userId: string, keywords: string[], source: "DASHBOARD" | "DAILY") {
  const clean = [...new Set(keywords.map((k) => k.trim()).filter((k) => k.length >= 2))].slice(0, 15);
  const expiresAt = new Date(Date.now() + JOB_TTL_HOURS * 3_600_000);
  for (const keyword of clean) await db.chromeJob.create({ data: { userId, keyword, source, status: "QUEUED", expiresAt } });
  return clean.length;
}
export async function expireJobs(userId?: string) {
  const r = await db.chromeJob.updateMany({
    where: { ...(userId ? { userId } : {}), status: "QUEUED", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED", error: `Chrome n'était pas ouvert avec l'extension connectée pendant ${JOB_TTL_HOURS} h : recherche non effectuée.`, finishedAt: new Date() },
  });
  await db.chromeJob.updateMany({ where: { ...(userId ? { userId } : {}), status: "RUNNING", startedAt: { lt: new Date(Date.now() - 3_600_000) } }, data: { status: "ERROR", error: "La recherche s'est interrompue (Chrome fermé en cours de route ?)", finishedAt: new Date() } });
  return r.count;
}
export async function claimNextJob(userId: string) {
  await expireJobs(userId);
  await db.user.update({ where: { id: userId }, data: { chromeLastSeenAt: new Date() } });
  if (await db.chromeJob.findFirst({ where: { userId, status: "RUNNING" } })) return null;
  const job = await db.chromeJob.findFirst({ where: { userId, status: "QUEUED" }, orderBy: { createdAt: "asc" } });
  if (!job) return null;
  return db.chromeJob.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: new Date() } });
}

/* ------------------------------ ingestion ------------------------------ */
const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e6 ? v : null);
const int = (v: unknown) => { const n = num(v); return n === null ? null : Math.round(n); };
const httpsOnly = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v.slice(0, 1000) : null);
const photosOf = (a: unknown) => JSON.stringify((Array.isArray(a) ? a : [a]).map(httpsOnly).filter(Boolean).slice(0, 6));
const SITES = new Set(["VINTED", "ALIEXPRESS", "TEMU"]);

type AnyRec = Record<string, unknown>;

export async function ingest(userId: string, body: AnyRec) {
  const source = str(body.source, 20) ?? "MCP";
  const log = Array.isArray(body.log) ? body.log.map((l) => String(l).slice(0, 300)).slice(0, 200).join("\n") : "";
  let job = typeof body.jobId === "string" ? await db.chromeJob.findFirst({ where: { id: body.jobId, userId } }) : null;

  // 1. Lecture d'une seule page (bouton « Analyser cette page »)
  if (body.page && typeof body.page === "object") {
    const p = body.page as AnyRec;
    if (!SITES.has(String(p.site))) throw new Error("Page non reconnue");
    job ??= await db.chromeJob.create({ data: { userId, keyword: str((p.item as AnyRec)?.title, 80) ?? str(p.title, 80) ?? "Page analysée", source: "PAGE", status: "RUNNING", startedAt: new Date() } });
    const role = p.site === "VINTED" ? "VINTED" : "SUPPLIER";
    const items = p.item ? [p.item as AnyRec] : Array.isArray(p.items) ? (p.items as AnyRec[]) : [];
    for (const it of items.slice(0, 60)) await saveItem(job.id, role, String(p.site), it, p.pageType === "item" && role === "SUPPLIER" ? { status: "VERIFIED", reason: "Fiche ouverte dans Chrome" } : null);
    await db.chromeJob.update({ where: { id: job.id }, data: { status: "DONE", finishedAt: new Date(), resultCount: int(p.resultCount), log } });
    if (role === "SUPPLIER") await matchJob(job.id);
    return { jobId: job.id, items: items.length };
  }

  // 2. Résultat d'une recherche complète (pipeline)
  const r = (body.result ?? {}) as AnyRec;
  const keyword = str(r.keyword, 120);
  if (!keyword) throw new Error("Résultat sans mot-clé");
  job ??= await db.chromeJob.create({ data: { userId, keyword, source, status: "RUNNING", startedAt: new Date() } });
  const vinted = (r.vinted ?? null) as AnyRec | null;
  const vItems = Array.isArray(vinted?.items) ? (vinted!.items as AnyRec[]) : [];
  for (const it of vItems.slice(0, 60)) await saveItem(job.id, "VINTED", "VINTED", it, null);
  const sups = Array.isArray(r.suppliers) ? (r.suppliers as AnyRec[]) : [];
  for (const s of sups.slice(0, 20)) if (SITES.has(String(s.site)) && s.site !== "VINTED") await saveItem(job.id, "SUPPLIER", String(s.site), s, (s.link as { status?: string; reason?: string }) ?? null);
  const blocked = Array.isArray(r.blocked) ? (r.blocked as AnyRec[]).map((b) => ({ site: str(b.site, 20), reason: str(b.reason, 200) })) : [];
  const prices = vItems.map((i) => num(i.price)).filter((x): x is number => x !== null);
  const favs = vItems.map((i) => int(i.favorites)).filter((x): x is number => x !== null);
  const status = blocked.some((b) => b.site === "VINTED") ? "BLOCKED" : blocked.length ? "PARTIAL" : "DONE";
  await db.chromeJob.update({
    where: { id: job.id },
    data: { status, finishedAt: new Date(), log, resultCount: int(vinted?.resultCount), vintedRead: vItems.length, medianPrice: median(prices), favorites: favs.length ? favs.reduce((a, b) => a + b, 0) : null, blocked: blocked.length ? JSON.stringify(blocked) : null, error: status === "BLOCKED" ? `Vinted : ${blocked.find((b) => b.site === "VINTED")?.reason}` : null },
  });
  await matchJob(job.id);
  return { jobId: job.id, vinted: vItems.length, suppliers: sups.length, status };
}

async function saveItem(jobId: string, role: string, site: string, it: AnyRec, link: { status?: string; reason?: string } | null) {
  const url = httpsOnly(it.url);
  if (!url) return;
  let linkStatus = "PENDING", linkReason: string | null = null, finalUrl = url;
  if (role === "SUPPLIER") {
    const st = staticCheck(url, site as Supplier);
    if (!st.ok) { linkStatus = "INVALID"; linkReason = st.reason; }
    else {
      finalUrl = st.canonicalUrl!;
      linkStatus = ["VERIFIED", "MANUAL", "INVALID"].includes(String(link?.status)) ? String(link!.status) : "PENDING";
      linkReason = str(link?.reason, 300) ?? (linkStatus === "PENDING" ? "Lien lu dans une page de recherche, fiche non ouverte" : null);
    }
  }
  const text = it.text as { score?: number } | undefined;
  // Seuls les prix en euros servent aux marges ; un prix en dollars (site géolocalisé hors de France) est ignoré.
  const currency = str(it.currency, 5);
  const price = currency && currency !== "EUR" ? null : num(it.price);
  if (currency && currency !== "EUR" && role === "SUPPLIER") linkReason = [linkReason, `Prix affiché en ${currency} : ouvrez le site depuis la France pour obtenir le prix en euros`].filter(Boolean).join(" · ");
  await db.chromeItem.create({
    data: {
      jobId, role, site, url: finalUrl, externalId: str(it.id, 40), title: str(it.detailTitle, 300) ?? str(it.title, 300), price,
      favorites: int(it.favorites), orders: int(it.orders), photos: photosOf(it.photos ?? it.photo), seller: str((it.seller as AnyRec)?.name ?? it.seller, 80),
      available: typeof it.available === "boolean" ? it.available : null, linkStatus, linkReason, textScore: num(text?.score),
    },
  });
}

/** Correspondance des produits fournisseurs avec les annonces Vinted les plus suivies du même résultat. */
export async function matchJob(jobId: string) {
  const items = await db.chromeItem.findMany({ where: { jobId } });
  const vinted = items.filter((i) => i.role === "VINTED").sort((a, b) => (b.favorites ?? -1) - (a.favorites ?? -1)).slice(0, 5);
  const refTitles = vinted.map((v) => v.title).filter((t): t is string => Boolean(t));
  const refPhoto = vinted.map((v) => (JSON.parse(v.photos) as string[])[0]).find(Boolean) ?? null;
  const sups = items.filter((i) => i.role === "SUPPLIER" && i.linkStatus !== "INVALID");
  let visualBudget = 4;
  for (const s of sups) {
    let visual: Visual | null = null, note: string | null = null;
    const photos = JSON.parse(s.photos) as string[];
    if (refPhoto && photos.length && aiConfigured() && visualBudget > 0 && s.title) {
      visualBudget--;
      try { visual = await compareImages(refPhoto, photos, { vintedTitle: refTitles[0] ?? "", supplierTitle: s.title }); }
      catch (e) { note = (e as Error).message; }
    } else note = !refPhoto ? "Pas de photo Vinted" : !photos.length ? "Pas de photo fournisseur" : !aiConfigured() ? "IA non configurée : comparaison des photos impossible" : "Comparaison visuelle limitée aux meilleurs candidats";
    const m = refTitles.length ? computeMatch({ vintedTitles: refTitles, supplierTitle: s.title ?? "", visual }) : null;
    await db.chromeItem.update({ where: { id: s.id }, data: { matchStatus: m?.status ?? "PENDING", matchScore: m?.score ?? null, matchDetail: JSON.stringify({ signals: m?.signals ?? [], visualNote: note }) } });
  }
}

/* ------------------------------ vers Product Research / Top 10 ------------------------------ */
export async function addToResearch(userId: string, jobId: string, supplierItemId: string | null) {
  const job = await db.chromeJob.findFirst({ where: { id: jobId, userId }, include: { items: true } });
  if (!job) throw new Error("Recherche introuvable");
  const vinted = job.items.filter((i) => i.role === "VINTED" && i.price !== null);
  if (!vinted.length) throw new Error("Aucune annonce Vinted avec prix dans cette recherche");
  const sup = supplierItemId ? job.items.find((i) => i.id === supplierItemId && i.role === "SUPPLIER") : null;
  if (supplierItemId && !sup) throw new Error("Produit fournisseur introuvable");
  if (sup?.linkStatus === "INVALID") throw new Error("Ce lien fournisseur est invalide");

  const product = await db.product.create({ data: {
    userId, name: job.keyword.slice(0, 120), category: "Autre", keywords: job.keyword,
    imageUrl: (JSON.parse(sup?.photos ?? vinted[0].photos) as string[])[0] ?? null,
    notes: `Créé depuis la recherche Chrome du ${job.createdAt.toLocaleDateString("fr-FR")}.`,
    competitorCount: job.resultCount, competitorCountAt: job.resultCount !== null ? job.finishedAt ?? new Date() : null,
  } });
  if (job.resultCount !== null) await db.competitorSnapshot.create({ data: { productId: product.id, count: job.resultCount } });
  for (const v of vinted.slice(0, 30)) {
    const photo = (JSON.parse(v.photos) as string[])[0] ?? null;
    const listing = await db.vintedListing.upsert({
      where: { userId_url: { userId, url: v.url } },
      create: { userId, productId: product.id, url: v.url, title: v.title ?? "Annonce Vinted", price: v.price as number, favorites: v.favorites, photoUrl: photo, status: "ACTIVE" },
      update: { productId: product.id, price: v.price as number, favorites: v.favorites, ...(photo ? { photoUrl: photo } : {}) },
    });
    await db.listingSnapshot.create({ data: { listingId: listing.id, favorites: v.favorites, views: null, price: v.price as number, status: listing.status } });
  }
  if (sup && sup.price !== null) {
    await db.supplierOffer.create({ data: {
      productId: product.id, supplier: sup.site, url: sup.url, externalId: sup.externalId, title: sup.title ?? job.keyword, price: sup.price,
      imageUrl: (JSON.parse(sup.photos) as string[])[0] ?? null, source: "CHROME", confirmed: false, salesVolume: sup.orders, available: sup.available,
      linkStatus: sup.linkStatus, linkVerifiedBy: sup.linkStatus === "VERIFIED" ? "BROWSER" : null, linkCheckedAt: job.finishedAt,
      linkCheckDetail: JSON.stringify({ steps: [{ step: "Ouverture dans Chrome (extension)", ok: sup.linkStatus === "VERIFIED" ? true : sup.linkStatus === "INVALID" ? false : null, detail: sup.linkReason ?? "" }], reason: sup.linkReason ?? "" }),
      matchStatus: sup.matchStatus, matchScore: sup.matchScore, matchDetail: sup.matchDetail,
    } });
  }
  await db.chromeItem.updateMany({ where: { id: { in: [...vinted.map((v) => v.id), ...(sup ? [sup.id] : [])] } }, data: { productId: product.id } });
  await recomputeProduct(product.id);
  return product.id;
}

export async function addToToday(userId: string, productId: string) {
  const p = await db.product.findFirst({ where: { id: productId, userId } });
  if (!p) throw new Error("Produit introuvable");
  if (p.selectionBlocker) throw new Error(`Ce produit ne peut pas entrer dans le Top 10 : ${p.selectionBlocker}`);
  const date = dayKey();
  const sel = await db.dailySelection.upsert({ where: { userId_date: { userId, date } }, create: { userId, date }, update: {}, include: { items: true } });
  if (sel.items.some((i) => i.productId === productId)) throw new Error("Déjà dans le Top 10 du jour");
  if (sel.items.length >= 10) throw new Error("Le Top 10 du jour est complet");
  await db.dailySelectionItem.create({ data: { selectionId: sel.id, productId, rank: sel.items.length + 1, score: p.score ?? 0 } });
}
