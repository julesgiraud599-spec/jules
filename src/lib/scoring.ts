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
export interface OfferInput { price: number; shipping: number | null; confirmed: boolean; supplier: string; }
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

/** Choisit l'offre : offres vérifiées d'abord, puis la moins chère (port inclus). */
export function pickOffer<T extends OfferInput>(offers: T[]): T | null {
  if (!offers.length) return null;
  const pool = offers.some((o) => o.confirmed) ? offers.filter((o) => o.confirmed) : offers;
  return [...pool].sort((a, b) => a.price + (a.shipping ?? 0) - (b.price + (b.shipping ?? 0)))[0];
}

export const WEIGHTS = { demand: 25, sales: 20, trend: 10, competition: 15, ratio: 10, margin: 20 } as const;
const MIN_LISTINGS_FOR_SALES = 3;

export function computeScore(
  listings: ListingInput[],
  competitorCount: number | null,
  offers: OfferInput[],
  settings: ScoreSettings,
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

  // Délai de vente observé (entre la 1re observation et la vente constatée) — borne basse du délai réel.
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

  const components: Component[] = [
    {
      key: "demand", label: "Demande (favoris)", weight: WEIGHTS.demand,
      score: medianFavorites === null ? null : round2(clamp((Math.log10(1 + medianFavorites) / Math.log10(41)) * 100)),
      detail: medianFavorites === null ? "Aucun nombre de favoris relevé" : `Médiane ${medianFavorites} favoris par annonce (${favs.length} annonce(s))`,
    },
    {
      key: "sales", label: "Ventes confirmées", weight: WEIGHTS.sales,
      score: sellThrough === null ? null : round2(clamp(sellThrough * 1.5)),
      detail: sellThrough === null
        ? `Échantillon insuffisant (${listings.length}/${MIN_LISTINGS_FOR_SALES} annonces minimum)`
        : `${sold.length} vendue(s) sur ${listings.length} annonces suivies (${sellThrough} %)`,
    },
    {
      key: "trend", label: "Évolution de la demande", weight: WEIGHTS.trend,
      score: favoritesGrowthPerDay === null ? null : round2(clamp((favoritesGrowthPerDay / 2) * 100)),
      detail: favoritesGrowthPerDay === null ? "Il faut au moins 2 relevés d'une même annonce à 12h d'intervalle" : `${favoritesGrowthPerDay} favori(s) gagnés par jour en moyenne`,
    },
    {
      key: "competition", label: "Concurrence", weight: WEIGHTS.competition,
      score: competitorCount === null ? null : round2(clamp(100 - (Math.log10(competitorCount + 1) / Math.log10(1001)) * 100)),
      detail: competitorCount === null ? "Nombre d'annonces similaires non relevé" : `${competitorCount} annonces similaires sur Vinted`,
    },
    {
      key: "ratio", label: "Rapport demande / offre", weight: WEIGHTS.ratio,
      score: demandSupplyRatio === null ? null : round2(clamp(demandSupplyRatio * 50)),
      detail: demandSupplyRatio === null ? "Nécessite favoris + nombre d'annonces concurrentes" : `${demandSupplyRatio} favori(s) observé(s) par annonce concurrente`,
    },
    {
      key: "margin", label: "Marge", weight: WEIGHTS.margin,
      score: marginPct === null || grossMargin === null ? null
        : round2(Math.min(clamp(((marginPct - 20) / 50) * 100), clamp(grossMargin * 20))),
      detail: marginPct === null ? (offer ? "Prix Vinted non relevé" : "Aucune offre fournisseur liée") : `${marginPct} % de marge brute (${grossMargin} €)`,
    },
  ];

  const available = components.filter((c) => c.score !== null);
  const wSum = available.reduce((a, c) => a + c.weight, 0);
  const confidence = round2(wSum); // les poids totalisent 100
  const rawScore = wSum ? round2(available.reduce((a, c) => a + (c.score as number) * c.weight, 0) / wSum) : null;
  const score = rawScore === null ? null : Math.round(rawScore * (0.6 + 0.4 * (confidence / 100)));

  const demandScore = components[0].score;
  const demandLevel = demandScore === null ? null : demandScore >= 66 ? "Forte" : demandScore >= 33 ? "Moyenne" : "Faible";
  const competitionLevel = competitorCount === null ? null : competitorCount < 50 ? "Faible" : competitorCount < 300 ? "Moyenne" : "Forte";

  return {
    score, rawScore, confidence, components, demandLevel, competitionLevel,
    metrics: {
      observedListings: listings.length,
      totalFavorites, medianFavorites,
      totalViews: views.length ? views.reduce((a, b) => a + b, 0) : null,
      confirmedSales: sold.length, sellThrough,
      avgPrice: prices.length ? round2(mean(prices) as number) : null,
      avgSoldPrice: soldPrices.length ? round2(mean(soldPrices) as number) : null,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      competitorCount, demandSupplyRatio, favoritesGrowthPerDay, observedDaysToSell,
      recommendedPrice, purchaseCost, grossMargin, marginPct, netMargin,
      offerVerified: offer ? offer.confirmed : null,
      bestSupplier: offer?.supplier ?? null,
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
