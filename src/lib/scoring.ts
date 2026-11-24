/**
 * Moteur de score Glacier.
 * Règle d'or : un critère sans donnée réelle est EXCLU (null) — jamais estimé ni inventé.
 * Le score final est la moyenne pondérée des critères disponibles, pénalisée selon la part de données manquantes.
 */

export interface ListingInput {
  price: number;
  favorites: number | null;
  views: number | null;
  status: string; // ACTIVE | SOLD | UNKNOWN
  soldAt: Date | null;
  firstSeenAt: Date;
  snapshots: { favorites: number | null; capturedAt: Date }[];
}
export interface OfferInput {
  price: number; shipping: number | null; supplier: string; confirmed: boolean;
  linkStatus?: string; matchStatus?: string; matchScore?: number | null; available?: boolean | null;
}
export interface ScoreSettings { contributionRate: number; packagingCost: number; }

export interface Component {
  key: string;
  label: string;
  weight: number;
  score: number | null; // 0-100, null = non disponible
  detail: string;
}

export interface ScoreResult {
  score: number | null;
  rawScore: number | null;
  confidence: number; // 0-100
  components: Component[];
  /** null = éligible au Top 10 ; sinon la raison du refus */
  blocker: string | null;
  metrics: {
    observedListings: number;
    totalFavorites: number | null;
    medianFavorites: number | null;
    totalViews: number | null;
    confirmedSales: number;
    sellThrough: number | null; // %
    avgPrice: number | null;
    avgSoldPrice: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    competitorCount: number | null;
    recentListings: number | null;
    demandSupplyRatio: number | null;
    favoritesGrowthPerDay: number | null;
    observedDaysToSell: number | null;
    recommendedPrice: number | null;
    purchaseCost: number | null;
    grossMargin: number | null;
    marginPct: number | null;
    netMargin: number | null;
    offerVerified: boolean | null;
    bestSupplier: string | null;
    matchScore: number | null;
  };
  demandLevel: "Forte" | "Moyenne" | "Faible" | null;
  competitionLevel: "Faible" | "Moyenne" | "Forte" | null;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** Prix conseillé : légèrement sous la médiane (vendus en priorité) pour vendre vite, arrondi au 0,50 € inférieur. */
export function recommendPrice(soldPrices: number[], allPrices: number[]): number | null {
  const base = median(soldPrices.length ? soldPrices : allPrices);
  if (base === null) return null;
  return Math.max(1, Math.floor(base * 0.95 * 2) / 2);
}

/** Une offre n'est utilisable que si la correspondance est fiable et que son lien n'est pas invalide. */
export function offerUsable(o: OfferInput): boolean {
  const match = o.matchStatus ? o.matchStatus === "MATCH" : o.confirmed;
  return match && o.linkStatus !== "INVALID";
}

/** Choisit l'offre : correspondance fiable obligatoire ; liens vérifiés d'abord ; puis la moins chère (port inclus). */
export function pickOffer<T extends OfferInput>(offers: T[]): T | null {
  const usable = offers.filter(offerUsable);
  if (!usable.length) return null;
  const pool = usable.some((o) => o.linkStatus === "VERIFIED") ? usable.filter((o) => o.linkStatus === "VERIFIED") : usable;
  return [...pool].sort((a, b) => a.price + (a.shipping ?? 0) - (b.price + (b.shipping ?? 0)))[0];
}

/** Pondération demandée : demande 30, demande/concurrence 20, marge 20, correspondance 15, tendance 10, disponibilité 5. */
export const WEIGHTS = { demand: 30, ratio: 20, margin: 20, match: 15, trend: 10, availability: 5 } as const;
const MIN_LISTINGS_FOR_SALES = 3;

export function computeScore(
  listings: ListingInput[],
  competitorCount: number | null,
  offers: OfferInput[],
  settings: ScoreSettings,
  recentListings: number | null = null,
): ScoreResult {
  const favs = listings.map((l) => l.favorites).filter((f): f is number => f !== null);
  const views = listings.map((l) => l.views).filter((v): v is number => v !== null);
  const sold = listings.filter((l) => l.status === "SOLD");
  const prices = listings.map((l) => l.price);
  const soldPrices = sold.map((l) => l.price);

  const totalFavorites = favs.length ? favs.reduce((a, b) => a + b, 0) : null;
  const medianFavorites = median(favs);

  // Croissance des favoris : uniquement à partir d'au moins 2 relevés réels espacés d'au moins 12h.
  const growths: number[] = [];
  for (const l of listings) {
    const pts = l.snapshots.filter((s) => s.favorites !== null).sort((a, b) => +a.capturedAt - +b.capturedAt);
    if (pts.length < 2) continue;
    const first = pts[0], last = pts[pts.length - 1];
    const days = (+last.capturedAt - +first.capturedAt) / 86_400_000;
    if (days < 0.5) continue;
    growths.push(((last.favorites as number) - (first.favorites as number)) / days);
  }
  const favoritesGrowthPerDay = growths.length ? round2(mean(growths) as number) : null;

  const daysToSell = sold
    .filter((l) => l.soldAt)
    .map((l) => (+(l.soldAt as Date) - +l.firstSeenAt) / 86_400_000)
    .filter((d) => d >= 0);
  const observedDaysToSell = daysToSell.length ? round2(median(daysToSell) as number) : null;

  const offer = pickOffer(offers);
  const recommendedPrice = recommendPrice(soldPrices, prices);
  const purchaseCost = offer ? round2(offer.price + (offer.shipping ?? 0)) : null;
  const grossMargin = recommendedPrice !== null && purchaseCost !== null ? round2(recommendedPrice - purchaseCost) : null;
  const marginPct = grossMargin !== null && recommendedPrice ? round2((grossMargin / recommendedPrice) * 100) : null;
  const netMargin = grossMargin !== null && recommendedPrice !== null
    ? round2(grossMargin - settings.packagingCost - (recommendedPrice * settings.contributionRate) / 100)
    : null;
  const demandSupplyRatio = totalFavorites !== null && competitorCount !== null && competitorCount > 0
    ? round2(totalFavorites / competitorCount) : null;
  const sellThrough = listings.length >= MIN_LISTINGS_FOR_SALES ? round2((sold.length / listings.length) * 100) : null;
  const matchScore = offer?.matchScore ?? (offer?.confirmed ? 90 : null);
  const available = offer ? (offer.available ?? null) : null;

  const components: Component[] = [
    {
      key: "demand", label: "Demande observée (favoris)", weight: WEIGHTS.demand,
      score: medianFavorites === null ? null : round2(clamp((Math.log10(1 + medianFavorites) / Math.log10(41)) * 100)),
      detail: medianFavorites === null ? "Aucun nombre de favoris relevé" : `Médiane ${medianFavorites} favoris par annonce (${favs.length} annonce(s)) — ce ne sont pas des ventes`,
    },
    {
      key: "ratio", label: "Rapport demande / concurrence", weight: WEIGHTS.ratio,
      score: demandSupplyRatio === null ? null : round2(clamp(demandSupplyRatio * 50)),
      detail: demandSupplyRatio === null ? "Nécessite les favoris et le nombre d'annonces concurrentes" : `${demandSupplyRatio} favori(s) observé(s) par annonce concurrente (${competitorCount} annonces)`,
    },
    {
      key: "margin", label: "Marge potentielle", weight: WEIGHTS.margin,
      score: marginPct === null || grossMargin === null ? null
        : round2(Math.min(clamp(((marginPct - 20) / 50) * 100), clamp(grossMargin * 20))),
      detail: marginPct === null ? (offer ? "Prix Vinted non relevé" : "Aucune offre fournisseur fiable") : `${marginPct} % de marge brute (${grossMargin} €)`,
    },
    {
      key: "match", label: "Fiabilité de la correspondance fournisseur", weight: WEIGHTS.match,
      score: matchScore === null ? null : round2(clamp(matchScore)),
      detail: !offer ? "Aucune offre dont la correspondance est fiable" : matchScore === null ? "Correspondance non mesurée" : `${Math.round(matchScore)} / 100${offer.confirmed ? " (confirmée par vous)" : ""}`,
    },
    {
      key: "trend", label: "Stabilité de la tendance", weight: WEIGHTS.trend,
      score: favoritesGrowthPerDay === null ? null : round2(clamp(50 + favoritesGrowthPerDay * 25)),
      detail: favoritesGrowthPerDay === null ? "Il faut au moins 2 relevés d'une même annonce à 12 h d'intervalle" : `${favoritesGrowthPerDay > 0 ? "+" : ""}${favoritesGrowthPerDay} favori(s) par jour en moyenne`,
    },
    {
      key: "availability", label: "Disponibilité fournisseur", weight: WEIGHTS.availability,
      score: available === null ? null : available ? 100 : 0,
      detail: available === null ? "Disponibilité non vérifiable" : available ? "Produit disponible (vérifié)" : "Produit indisponible",
    },
  ];

  const availableComps = components.filter((c) => c.score !== null);
  const wSum = availableComps.reduce((a, c) => a + c.weight, 0);
  const confidence = round2(wSum); // les poids totalisent 100
  const rawScore = wSum ? round2(availableComps.reduce((a, c) => a + (c.score as number) * c.weight, 0) / wSum) : null;
  // Peu de données = score fortement réduit ; sans demande observée, le score est plafonné à 40.
  let score = rawScore === null ? null : Math.round(rawScore * (0.3 + 0.7 * (confidence / 100)));
  if (score !== null && components[0].score === null) score = Math.min(score, 40);

  const demandScore = components[0].score;
  const demandLevel = demandScore === null ? null : demandScore >= 66 ? "Forte" : demandScore >= 33 ? "Moyenne" : "Faible";
  const competitionLevel = competitorCount === null ? null : competitorCount < 50 ? "Faible" : competitorCount < 300 ? "Moyenne" : "Forte";

  const blocker = !listings.length ? "Aucune annonce Vinted observée"
    : medianFavorites === null ? "Aucun nombre de favoris relevé sur Vinted"
    : !offer ? (offers.length ? "Aucune offre fournisseur ne correspond de façon fiable au produit Vinted" : "Aucune offre fournisseur")
    : offer.linkStatus !== "VERIFIED" ? "Le lien fournisseur n'est pas vérifié"
    : recommendedPrice === null ? "Prix Vinted non relevé"
    : null;

  return {
    score, rawScore, confidence, components, demandLevel, competitionLevel, blocker,
    metrics: {
      observedListings: listings.length,
      totalFavorites, medianFavorites,
      totalViews: views.length ? views.reduce((a, b) => a + b, 0) : null,
      confirmedSales: sold.length, sellThrough,
      avgPrice: prices.length ? round2(mean(prices) as number) : null,
      avgSoldPrice: soldPrices.length ? round2(mean(soldPrices) as number) : null,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      competitorCount, recentListings, demandSupplyRatio, favoritesGrowthPerDay, observedDaysToSell,
      recommendedPrice, purchaseCost, grossMargin, marginPct, netMargin,
      offerVerified: offer ? offer.linkStatus === "VERIFIED" : null,
      bestSupplier: offer?.supplier ?? null,
      matchScore,
    },
  };
}

/** Calcul comptable d'une vente. */
export function saleNet(s: { salePrice: number; purchaseCost: number; shippingCost: number; fees: number; packaging: number; refunded: boolean; refundAmount: number; quantity: number }, contributionRate: number) {
  const revenue = s.salePrice * s.quantity - (s.refunded ? s.refundAmount : 0);
  const costs = s.purchaseCost * s.quantity + s.shippingCost + s.fees + s.packaging;
  const contributions = Math.max(0, revenue) * (contributionRate / 100);
  return { revenue: round2(revenue), costs: round2(costs), contributions: round2(contributions), net: round2(revenue - costs - contributions) };
}
