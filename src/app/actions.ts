"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { recomputeProduct, refreshAliExpress, generateAnalysis, runDaily } from "@/lib/engine";
import { SUPPLIERS } from "@/lib/format";

export type ActionState = { ok?: boolean; error?: string; message?: string } | undefined;

const str = (f: FormData, k: string) => (f.get(k) ?? "").toString().trim();
const optNum = (f: FormData, k: string) => {
  const v = str(f, k).replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Valeur invalide pour « ${k} ».`);
  return n;
};
const reqNum = (f: FormData, k: string, label: string) => {
  const n = optNum(f, k);
  if (n === null) throw new Error(`${label} est obligatoire.`);
  return n;
};
const optInt = (f: FormData, k: string) => { const n = optNum(f, k); return n === null ? null : Math.round(n); };
const optUrl = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!v) return null;
  try { const u = new URL(v); if (!/^https?:$/.test(u.protocol)) throw 0; return u.toString(); }
  catch { throw new Error(`URL invalide : ${v}`); }
};
const dateOr = (f: FormData, k: string) => { const v = str(f, k); const d = v ? new Date(v) : new Date(); if (isNaN(+d)) throw new Error("Date invalide."); return d; };

async function guard(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try { return (await fn()) ?? { ok: true }; }
  catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    return { error: (e as Error).message || "Erreur inattendue." };
  }
}
async function ownProduct(userId: string, productId: string) {
  const p = await db.product.findFirst({ where: { id: productId, userId } });
  if (!p) throw new Error("Produit introuvable.");
  return p;
}

/* ------------------------------ Authentification ------------------------------ */

const Creds = z.object({ email: z.string().email("Email invalide."), password: z.string().min(8, "Mot de passe : 8 caractères minimum.") });

export async function registerAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const parsed = Creds.safeParse({ email: str(f, "email").toLowerCase(), password: str(f, "password") });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    if (await db.user.findUnique({ where: { email: parsed.data.email } })) return { error: "Un compte existe déjà avec cet email." };
    const user = await db.user.create({ data: { email: parsed.data.email, name: str(f, "name") || null, passwordHash: await hashPassword(parsed.data.password) } });
    await createSession(user.id);
    redirect("/dashboard");
  });
}

export async function loginAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await db.user.findUnique({ where: { email: str(f, "email").toLowerCase() } });
    if (!user || !(await verifyPassword(str(f, "password"), user.passwordHash))) return { error: "Identifiants incorrects." };
    await createSession(user.id);
    redirect("/dashboard");
  });
}

export async function logoutAction() { await destroySession(); redirect("/login"); }

/* ---------------------------------- Produits ---------------------------------- */

export async function createProductAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const name = str(f, "name"), category = str(f, "category"), keywords = str(f, "keywords") || name;
    if (!name) return { error: "Le nom est obligatoire." };
    const p = await db.product.create({ data: { userId: user.id, name, category: category || "Autre", keywords, imageUrl: optUrl(f, "imageUrl"), notes: str(f, "notes") || null } });
    await recomputeProduct(p.id);
    redirect(`/products/${p.id}`);
  });
}

export async function updateProductAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const p = await ownProduct(user.id, str(f, "productId"));
    await db.product.update({ where: { id: p.id }, data: { name: str(f, "name") || p.name, category: str(f, "category") || p.category, keywords: str(f, "keywords") || p.keywords, imageUrl: optUrl(f, "imageUrl"), notes: str(f, "notes") || null } });
    await recomputeProduct(p.id);
    revalidatePath(`/products/${p.id}`);
    return { ok: true, message: "Produit mis à jour." };
  });
}

export async function deleteProductAction(f: FormData) {
  const user = await requireUser();
  const p = await ownProduct(user.id, str(f, "productId"));
  await db.product.delete({ where: { id: p.id } });
  redirect("/research");
}

export async function setCompetitorCountAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const p = await ownProduct(user.id, str(f, "productId"));
    const count = optInt(f, "competitorCount");
    await db.product.update({ where: { id: p.id }, data: { competitorCount: count, competitorCountAt: count === null ? null : new Date() } });
    if (count !== null) await db.competitorSnapshot.create({ data: { productId: p.id, count } });
    await recomputeProduct(p.id);
    revalidatePath(`/products/${p.id}`);
    return { ok: true, message: "Concurrence enregistrée." };
  });
}

/* ------------------------------ Annonces Vinted ------------------------------ */

function vintedUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`Lien Vinted invalide : ${raw}`); }
  if (!/(^|\.)vinted\.[a-z.]+$/.test(u.hostname)) throw new Error("Le lien doit être une annonce Vinted (vinted.fr, vinted.be…).");
  u.search = ""; u.hash = "";
  return u.toString();
}

async function upsertListing(userId: string, productId: string, d: { url: string; title: string; price: number; favorites: number | null; views: number | null; status: string; photoUrl?: string | null }) {
  const url = vintedUrl(d.url);
  const status = ["ACTIVE", "SOLD", "UNKNOWN"].includes(d.status) ? d.status : "ACTIVE";
  const prev = await db.vintedListing.findUnique({ where: { userId_url: { userId, url } } });
  const soldAt = status === "SOLD" ? prev?.soldAt ?? new Date() : null;
  const listing = await db.vintedListing.upsert({
    where: { userId_url: { userId, url } },
    create: { userId, productId, url, title: d.title, price: d.price, favorites: d.favorites, views: d.views, status, soldAt, photoUrl: d.photoUrl ?? null },
    update: { productId, title: d.title, price: d.price, favorites: d.favorites, views: d.views, status, soldAt, ...(d.photoUrl ? { photoUrl: d.photoUrl } : {}) },
  });
  await db.listingSnapshot.create({ data: { listingId: listing.id, favorites: d.favorites, views: d.views, price: d.price, status } });
  return listing;
}

export async function addListingAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const p = await ownProduct(user.id, str(f, "productId"));
    const title = str(f, "title");
    if (!title) return { error: "Le titre de l'annonce est obligatoire." };
    await upsertListing(user.id, p.id, {
      url: str(f, "url"), title, price: reqNum(f, "price", "Le prix"),
      favorites: optInt(f, "favorites"), views: optInt(f, "views"), status: str(f, "status") || "ACTIVE", photoUrl: optUrl(f, "photoUrl"),
    });
    await recomputeProduct(p.id);
    revalidatePath(`/products/${p.id}`);
    return { ok: true, message: "Annonce enregistrée (un relevé a été ajouté à l'historique)." };
  });
}

/** Import en masse : une annonce par ligne — url;titre;prix;favoris;vues;statut (favoris/vues vides = non disponible). */
export async function importListingsAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const p = await ownProduct(user.id, str(f, "productId"));
    const lines = str(f, "csv").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let ok = 0; const errors: string[] = [];
    for (const [i, line] of lines.entries()) {
      const cols = line.split(/[;\t]/).map((c) => c.trim());
      if (i === 0 && /url/i.test(cols[0])) continue;
      try {
        const [url, title, price, favorites, views, status] = cols;
        const n = (v?: string) => (v === undefined || v === "" ? null : Number(v.replace(",", ".")));
        const pr = n(price);
        if (!url || !title || pr === null || !Number.isFinite(pr)) throw new Error("colonnes url, titre et prix obligatoires");
        const st = (status ?? "").toUpperCase();
        await upsertListing(user.id, p.id, { url, title, price: pr, favorites: n(favorites), views: n(views), status: /VEND|SOLD/.test(st) ? "SOLD" : "ACTIVE" });
        ok++;
      } catch (e) { errors.push(`Ligne ${i + 1} : ${(e as Error).message}`); }
    }
    await recomputeProduct(p.id);
    revalidatePath(`/products/${p.id}`);
    if (errors.length) return { error: `${ok} annonce(s) importée(s). ${errors.slice(0, 5).join(" · ")}` };
    return { ok: true, message: `${ok} annonce(s) importée(s).` };
  });
}

export async function deleteListingAction(f: FormData) {
  const user = await requireUser();
  const l = await db.vintedListing.findFirst({ where: { id: str(f, "listingId"), userId: user.id } });
  if (!l) return;
  await db.vintedListing.delete({ where: { id: l.id } });
  if (l.productId) { await recomputeProduct(l.productId); revalidatePath(`/products/${l.productId}`); }
}

/* ---------------------------- Offres fournisseurs ---------------------------- */

export async function addOfferAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const p = await ownProduct(user.id, str(f, "productId"));
    const supplier = str(f, "supplier");
    if (!SUPPLIERS.includes(supplier as never)) return { error: "Fournisseur invalide." };
    const url = optUrl(f, "url");
    if (!url) return { error: "Le lien du produit fournisseur est obligatoire." };
    const host = new URL(url).hostname;
    const expected = { ALIEXPRESS: /aliexpress\./, TEMU: /temu\./, SHEIN: /shein\./ }[supplier as "TEMU"];
    if (!expected.test(host)) return { error: `Ce lien ne correspond pas à ${supplier}.` };
    await db.supplierOffer.upsert({
      where: { productId_supplier_url: { productId: p.id, supplier, url } },
      create: { productId: p.id, supplier, url, title: str(f, "title") || p.name, price: reqNum(f, "price", "Le prix d'achat"), shipping: optNum(f, "shipping"), imageUrl: optUrl(f, "imageUrl"), source: "MANUAL", confirmed: true },
      update: { title: str(f, "title") || p.name, price: reqNum(f, "price", "Le prix d'achat"), shipping: optNum(f, "shipping"), imageUrl: optUrl(f, "imageUrl"), confirmed: true, fetchedAt: new Date() },
    });
    const img = optUrl(f, "imageUrl");
    if (!p.imageUrl && img) await db.product.update({ where: { id: p.id }, data: { imageUrl: img } });
    await recomputeProduct(p.id);
    revalidatePath(`/products/${p.id}`);
    return { ok: true, message: "Offre fournisseur enregistrée." };
  });
}

export async function toggleOfferConfirmAction(f: FormData) {
  const user = await requireUser();
  const o = await db.supplierOffer.findFirst({ where: { id: str(f, "offerId"), product: { userId: user.id } } });
  if (!o) return;
  await db.supplierOffer.update({ where: { id: o.id }, data: { confirmed: !o.confirmed } });
  await recomputeProduct(o.productId);
  revalidatePath(`/products/${o.productId}`);
}

export async function deleteOfferAction(f: FormData) {
  const user = await requireUser();
  const o = await db.supplierOffer.findFirst({ where: { id: str(f, "offerId"), product: { userId: user.id } } });
  if (!o) return;
  await db.supplierOffer.delete({ where: { id: o.id } });
  await recomputeProduct(o.productId);
  revalidatePath(`/products/${o.productId}`);
}

export async function fetchAliExpressAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const p = await ownProduct(user.id, str(f, "productId"));
    const n = await refreshAliExpress(p.id);
    await recomputeProduct(p.id);
    revalidatePath(`/products/${p.id}`);
    return { ok: true, message: `${n} offre(s) AliExpress trouvée(s). Vérifiez la correspondance et cochez « vérifiée ».` };
  });
}

/* ------------------------------- IA, favoris, daily ------------------------------- */

export async function generateAnalysisAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const p = await ownProduct(user.id, str(f, "productId"));
    await recomputeProduct(p.id);
    await generateAnalysis(p.id);
    revalidatePath(`/products/${p.id}`);
    return { ok: true, message: "Analyse IA générée." };
  });
}

export async function toggleSaveAction(f: FormData) {
  const user = await requireUser();
  const p = await ownProduct(user.id, str(f, "productId"));
  const key = { userId_productId: { userId: user.id, productId: p.id } };
  const existing = await db.savedProduct.findUnique({ where: key });
  if (existing) await db.savedProduct.delete({ where: key });
  else await db.savedProduct.create({ data: { userId: user.id, productId: p.id } });
  revalidatePath("/", "layout");
}

export async function runDailyAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const r = await runDaily(user.id, { force: str(f, "force") === "1" });
    revalidatePath("/", "layout");
    if (r.skipped) return { ok: true, message: "La sélection du jour existe déjà. Utilisez « Régénérer » pour la recalculer." };
    return { ok: true, message: `Sélection générée : ${r.count} produit(s).` };
  });
}

export async function markNotificationsReadAction() {
  const user = await requireUser();
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

/* -------------------------------- Comptabilité -------------------------------- */

export async function addSaleAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const title = str(f, "title");
    if (!title) return { error: "L'intitulé est obligatoire." };
    const quantity = Math.max(1, optInt(f, "quantity") ?? 1);
    const inventoryItemId = str(f, "inventoryItemId") || null;
    let purchaseCost = optNum(f, "purchaseCost");
    if (inventoryItemId) {
      const item = await db.inventoryItem.findFirst({ where: { id: inventoryItemId, userId: user.id } });
      if (!item) return { error: "Article de stock introuvable." };
      if (item.quantity < quantity) return { error: `Stock insuffisant (${item.quantity} restant).` };
      purchaseCost ??= item.unitCost;
      await db.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: quantity } } });
    }
    await db.sale.create({ data: {
      userId: user.id, date: dateOr(f, "date"), title, quantity, inventoryItemId,
      salePrice: reqNum(f, "salePrice", "Le prix de vente"), purchaseCost: purchaseCost ?? 0,
      shippingCost: optNum(f, "shippingCost") ?? 0, fees: optNum(f, "fees") ?? 0,
      packaging: optNum(f, "packaging") ?? user.packagingCost, notes: str(f, "notes") || null,
    } });
    revalidatePath("/accounting"); revalidatePath("/dashboard");
    return { ok: true, message: "Vente enregistrée." };
  });
}

export async function refundSaleAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const s = await db.sale.findFirst({ where: { id: str(f, "saleId"), userId: user.id } });
    if (!s) return { error: "Vente introuvable." };
    const amount = optNum(f, "refundAmount") ?? s.salePrice * s.quantity;
    const restock = str(f, "restock") === "on";
    await db.sale.update({ where: { id: s.id }, data: { refunded: true, refundAmount: amount } });
    if (restock && s.inventoryItemId) await db.inventoryItem.update({ where: { id: s.inventoryItemId }, data: { quantity: { increment: s.quantity } } });
    revalidatePath("/accounting");
    return { ok: true, message: "Remboursement enregistré." };
  });
}

export async function deleteSaleAction(f: FormData) {
  const user = await requireUser();
  await db.sale.deleteMany({ where: { id: str(f, "saleId"), userId: user.id } });
  revalidatePath("/accounting");
}

export async function addExpenseAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const label = str(f, "label");
    if (!label) return { error: "L'intitulé est obligatoire." };
    await db.expense.create({ data: { userId: user.id, date: dateOr(f, "date"), label, category: str(f, "category") || "AUTRE", amount: reqNum(f, "amount", "Le montant") } });
    revalidatePath("/accounting");
    return { ok: true, message: "Dépense enregistrée." };
  });
}

export async function deleteExpenseAction(f: FormData) {
  const user = await requireUser();
  await db.expense.deleteMany({ where: { id: str(f, "expenseId"), userId: user.id } });
  revalidatePath("/accounting");
}

export async function addInventoryAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const name = str(f, "name");
    if (!name) return { error: "Le nom est obligatoire." };
    const quantity = Math.round(reqNum(f, "quantity", "La quantité"));
    const unitCost = reqNum(f, "unitCost", "Le coût unitaire");
    await db.inventoryItem.create({ data: { userId: user.id, name, supplier: str(f, "supplier") || null, quantity, unitCost } });
    if (str(f, "asExpense") === "on") {
      await db.expense.create({ data: { userId: user.id, date: new Date(), label: `Achat stock : ${name} ×${quantity}`, category: "STOCK", amount: Math.round(quantity * unitCost * 100) / 100 } });
    }
    revalidatePath("/accounting");
    return { ok: true, message: "Article ajouté au stock." };
  });
}

export async function adjustInventoryAction(f: FormData) {
  const user = await requireUser();
  const item = await db.inventoryItem.findFirst({ where: { id: str(f, "itemId"), userId: user.id } });
  if (!item) return;
  const delta = Number(str(f, "delta"));
  if (!Number.isFinite(delta)) return;
  await db.inventoryItem.update({ where: { id: item.id }, data: { quantity: Math.max(0, item.quantity + delta) } });
  revalidatePath("/accounting");
}

export async function deleteInventoryAction(f: FormData) {
  const user = await requireUser();
  await db.inventoryItem.deleteMany({ where: { id: str(f, "itemId"), userId: user.id } });
  revalidatePath("/accounting");
}

/* --------------------------------- Paramètres --------------------------------- */

export async function updateSettingsAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const webhookUrl = optUrl(f, "webhookUrl");
    await db.user.update({ where: { id: user.id }, data: {
      name: str(f, "name") || null,
      contributionRate: optNum(f, "contributionRate") ?? user.contributionRate,
      packagingCost: optNum(f, "packagingCost") ?? user.packagingCost,
      repeatCooldownDays: optInt(f, "repeatCooldownDays") ?? user.repeatCooldownDays,
      minDailyScore: optNum(f, "minDailyScore") ?? user.minDailyScore,
      webhookUrl,
    } });
    const products = await db.product.findMany({ where: { userId: user.id }, select: { id: true } });
    for (const p of products) await recomputeProduct(p.id);
    revalidatePath("/", "layout");
    return { ok: true, message: "Paramètres enregistrés, scores recalculés." };
  });
}

export async function changePasswordAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    if (!(await verifyPassword(str(f, "current"), user.passwordHash))) return { error: "Mot de passe actuel incorrect." };
    const next = str(f, "next");
    if (next.length < 8) return { error: "Nouveau mot de passe : 8 caractères minimum." };
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
    return { ok: true, message: "Mot de passe modifié." };
  });
}

export async function testWebhookAction(_: ActionState): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    if (!user.webhookUrl) return { error: "Aucun webhook configuré." };
    const { notify } = await import("@/lib/notify");
    await notify(user.id, "Test de notification", "Votre webhook Glacier fonctionne.", "/settings");
    return { ok: true, message: "Notification de test envoyée." };
  });
}
