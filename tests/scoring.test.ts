import { describe, it, expect } from "vitest";
import { computeScore, recommendPrice, pickOffer, saleNet, median } from "@/lib/scoring";
import { summarize } from "@/lib/accounting";
import { signParams } from "@/lib/aliexpress";

const S = { contributionRate: 12.3, packagingCost: 0.3 };
const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n));
const L = (o: Partial<Parameters<typeof computeScore>[0][number]> = {}) => ({ price: 8, favorites: null, views: null, status: "ACTIVE", soldAt: null, firstSeenAt: day(0), snapshots: [], ...o });

describe("computeScore — aucune donnée inventée", () => {
  it("sans aucune donnée : score null, tous les critères non disponibles", () => {
    const r = computeScore([], null, [], S);
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.components.every((c) => c.score === null)).toBe(true);
    expect(r.metrics.totalFavorites).toBeNull();
    expect(r.metrics.recommendedPrice).toBeNull();
    expect(r.demandLevel).toBeNull();
  });

  it("favoris inconnus restent null (pas 0)", () => {
    const r = computeScore([L(), L()], null, [], S);
    expect(r.metrics.totalFavorites).toBeNull();
    expect(r.components.find((c) => c.key === "demand")!.score).toBeNull();
  });

  it("les favoris ne sont jamais comptés comme des ventes", () => {
    const r = computeScore([L({ favorites: 50 }), L({ favorites: 40 }), L({ favorites: 30 })], null, [], S);
    expect(r.metrics.confirmedSales).toBe(0);
    expect(r.metrics.sellThrough).toBe(0);
  });

  it("ventes : non disponible sous 3 annonces, distingue ventes confirmées", () => {
    expect(computeScore([L({ status: "SOLD" }), L()], null, [], S).metrics.sellThrough).toBeNull();
    const r = computeScore([L({ status: "SOLD" }), L(), L(), L()], null, [], S);
    expect(r.metrics.confirmedSales).toBe(1);
    expect(r.metrics.sellThrough).toBe(25);
  });

  it("tendance calculée seulement avec 2 relevés espacés", () => {
    const flat = computeScore([L({ favorites: 10, snapshots: [{ favorites: 5, capturedAt: day(0) }] })], null, [], S);
    expect(flat.metrics.favoritesGrowthPerDay).toBeNull();
    const r = computeScore([L({ favorites: 10, snapshots: [{ favorites: 4, capturedAt: day(0) }, { favorites: 10, capturedAt: day(3) }] })], null, [], S);
    expect(r.metrics.favoritesGrowthPerDay).toBe(2);
  });

  it("calcule marge, prix conseillé et score complet", () => {
    const listings = [L({ price: 10, favorites: 40, status: "SOLD", soldAt: day(2) }), L({ price: 10, favorites: 30 }), L({ price: 12, favorites: 50 })];
    const offer = { price: 1.5, shipping: 0.5, confirmed: false, supplier: "TEMU", linkStatus: "VERIFIED", matchStatus: "MATCH", matchScore: 88, available: true };
    const r = computeScore(listings, 20, [offer], S);
    expect(r.metrics.recommendedPrice).toBe(9.5); // vendus en priorité : 10 * 0.95
    expect(r.metrics.purchaseCost).toBe(2);
    expect(r.metrics.grossMargin).toBe(7.5);
    expect(r.metrics.observedDaysToSell).toBe(2);
    expect(r.competitionLevel).toBe("Faible");
    expect(r.confidence).toBe(90); // tendance manquante
    expect(r.blocker).toBeNull();
    expect(r.score).toBeGreaterThan(50);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("pénalise un score fondé sur peu de données", () => {
    const thin = computeScore([L({ favorites: 40 })], null, [], S);
    expect(thin.rawScore).toBe(100);
    expect(thin.confidence).toBe(30);
    expect(thin.score).toBe(Math.round(100 * (0.3 + 0.7 * 0.3)));
    expect(thin.blocker).toBe("Aucune offre fournisseur");
  });

  it("sans favoris, le score est plafonné à 40", () => {
    const offer = { price: 1, shipping: 0, confirmed: true, supplier: "TEMU", linkStatus: "VERIFIED", matchStatus: "MATCH", matchScore: 95, available: true };
    const r = computeScore([L({ price: 20 })], null, [offer], S);
    expect(r.score).toBeLessThanOrEqual(40);
    expect(r.blocker).toBe("Aucun nombre de favoris relevé sur Vinted");
  });

  it("une offre au lien invalide ou à la correspondance incertaine n'est jamais utilisée", () => {
    const bad = { price: 1, shipping: 0, confirmed: false, supplier: "TEMU", linkStatus: "INVALID", matchStatus: "MATCH", matchScore: 90 };
    const unsure = { price: 1, shipping: 0, confirmed: false, supplier: "SHEIN", linkStatus: "VERIFIED", matchStatus: "UNCERTAIN", matchScore: 55 };
    const r = computeScore([L({ favorites: 30 })], 10, [bad, unsure], S);
    expect(r.metrics.purchaseCost).toBeNull();
    expect(r.blocker).toBe("Aucune offre fournisseur ne correspond de façon fiable au produit Vinted");
  });

  it("une correspondance fiable mais un lien non vérifié bloque le Top 10", () => {
    const manual = { price: 1, shipping: 0, confirmed: false, supplier: "TEMU", linkStatus: "MANUAL", matchStatus: "MATCH", matchScore: 80 };
    expect(computeScore([L({ favorites: 30 })], 10, [manual], S).blocker).toBe("Le lien fournisseur n'est pas vérifié");
  });
});

describe("helpers", () => {
  it("median / recommendPrice", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
    expect(recommendPrice([], [7, 9])).toBe(7.5);
    expect(recommendPrice([], [])).toBeNull();
  });
  it("pickOffer privilégie les liens vérifiés parmi les correspondances fiables", () => {
    const o = pickOffer([
      { price: 1, shipping: null, confirmed: false, supplier: "ALIEXPRESS", linkStatus: "MANUAL", matchStatus: "MATCH" },
      { price: 3, shipping: 0, confirmed: false, supplier: "SHEIN", linkStatus: "VERIFIED", matchStatus: "MATCH" },
      { price: 0.5, shipping: 0, confirmed: false, supplier: "TEMU", linkStatus: "VERIFIED", matchStatus: "UNCERTAIN" },
    ]);
    expect(o!.supplier).toBe("SHEIN");
  });
  it("saleNet et summarize sans double comptage du stock", () => {
    const sale = { date: new Date(), salePrice: 10, purchaseCost: 2, shippingCost: 0, fees: 0, packaging: 0.3, refunded: false, refundAmount: 0, quantity: 1 };
    expect(saleNet(sale, 12.3)).toEqual({ revenue: 10, costs: 2.3, contributions: 1.23, net: 6.47 });
    const s = summarize([sale], [{ date: new Date(), amount: 20, category: "STOCK" }, { date: new Date(), amount: 5, category: "EMBALLAGE" }], 12.3);
    expect(s.netProfit).toBe(1.47);
    expect(s.expensesTotal).toBe(25);
  });
  it("remboursement", () => {
    const n = saleNet({ salePrice: 10, purchaseCost: 2, shippingCost: 0, fees: 0, packaging: 0, refunded: true, refundAmount: 10, quantity: 1 }, 12.3);
    expect(n.revenue).toBe(0);
    expect(n.net).toBe(-2);
  });
  it("signature AliExpress déterministe et ordonnée", () => {
    const a = signParams({ b: "2", a: "1" }, "s"), b = signParams({ a: "1", b: "2" }, "s");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9A-F]{64}$/);
  });
});
