import { withApiUser, preflight } from "../_auth";
export const OPTIONS = preflight;
import { db } from "@/lib/db";
import { pickOffer } from "@/lib/scoring";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => withApiUser(req, async (u) => {
  const limit = Math.min(30, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 10));
  const products = await db.product.findMany({ where: { userId: u.id, score: { not: null } }, orderBy: { score: "desc" }, take: limit, include: { offers: true } });
  return products.map((p) => { const o = pickOffer(p.offers); return {
    nom: p.name, score: p.score, confiance: p.scoreConfidence, hors_top10: p.selectionBlocker, prix_vinted_moyen: p.avgVintedPrice, prix_conseille: p.recommendedPrice,
    prix_achat: p.purchasePrice, marge_brute: p.grossMargin, favoris: p.totalFavorites, concurrence: p.competitorCount,
    fournisseur: o ? { site: o.supplier, url: o.url, lien: o.linkStatus, correspondance: o.matchStatus, score_correspondance: o.matchScore } : null,
  }; });
});
