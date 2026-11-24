/**
 * Comparaison textuelle Vinted ↔ fournisseur (titre, couleurs, dimensions).
 * Sert uniquement à CLASSER les candidats : une correspondance n'est jamais déclarée « même produit »
 * sur ce seul critère. La comparaison visuelle (Glacier + IA) ou votre confirmation reste nécessaire.
 */
const STOP = new Set("le la les un une des de du d l et ou en pour avec sans sur au aux a à par the and for with of in to on by from new nouveau nouvelle femme femmes homme hommes fille filles women woman men girls 1pc 1 pcs pc pièce pièces lot ensemble set style mode tendance chic élégant elegant neuf neuve".split(" "));
export function tokens(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 2 && !STOP.has(t));
}
export function titleSimilarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  let hit = 0;
  for (const t of small) if (big.has(t) || [...big].some((x) => x.length > 4 && t.length > 4 && (x.startsWith(t.slice(0, 5)) || t.startsWith(x.slice(0, 5))))) hit++;
  return hit / small.size;
}
const COLORS = { noir: ["noir", "noire", "black"], blanc: ["blanc", "blanche", "white", "ivoire", "creme", "cream"], beige: ["beige", "camel", "nude", "taupe", "khaki", "kaki"], marron: ["marron", "brown", "chocolat", "ecaille", "tortoise", "leopard"], gris: ["gris", "grise", "grey", "gray"], rose: ["rose", "pink", "fuchsia"], rouge: ["rouge", "red", "bordeaux"], bleu: ["bleu", "bleue", "blue", "marine", "navy"], vert: ["vert", "verte", "green", "olive", "sauge"], jaune: ["jaune", "yellow"], violet: ["violet", "purple", "lilas"], orange: ["orange"], dore: ["dore", "doree", "gold", "golden"], argent: ["argent", "argente", "silver"] };
export function colorsOf(text) {
  const t = new Set(String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/));
  return Object.entries(COLORS).filter(([, w]) => w.some((x) => t.has(x))).map(([c]) => c);
}
export function dimensionsOf(text) {
  return [...String(text || "").toLowerCase().matchAll(/(\d+(?:[.,]\d+)?)\s*(cm|mm)\b/g)].map((m) => Number(m[1].replace(",", ".")) / (m[2] === "mm" ? 10 : 1)).filter((v) => v > 0 && v < 500);
}
/** Score textuel 0-100 d'un candidat fournisseur par rapport à des titres Vinted. */
export function textMatch(vintedTitles, supplierTitle) {
  const sims = vintedTitles.map((t) => titleSimilarity(t, supplierTitle));
  const title = sims.length ? Math.max(...sims) : 0;
  const vt = vintedTitles.join(" ");
  const cv = colorsOf(vt), cs = colorsOf(supplierTitle);
  const color = cv.length && cs.length ? (cv.some((c) => cs.includes(c)) ? 1 : 0) : null;
  const dv = dimensionsOf(vt), ds = dimensionsOf(supplierTitle);
  const dims = dv.length && ds.length ? (dv.some((a) => ds.some((b) => Math.abs(a - b) / Math.max(a, b) <= 0.2)) ? 1 : 0) : null;
  const parts = [[title, 60], [color, 25], [dims, 15]].filter(([v]) => v !== null);
  const w = parts.reduce((a, [, x]) => a + x, 0);
  return { score: Math.round((parts.reduce((a, [v, x]) => a + v * x, 0) / w) * 100), title: Math.round(title * 100), colorMatch: color, dimsMatch: dims };
}
export function median(a) { const s = a.filter((x) => typeof x === "number").sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
/** Statistiques de marché à partir d'une page de recherche Vinted (données observées uniquement). */
export function marketStats(vintedSearch) {
  const items = vintedSearch?.items || [];
  const favs = items.map((i) => i.favorites).filter((x) => typeof x === "number");
  const prices = items.map((i) => i.price).filter((x) => typeof x === "number");
  return {
    annonces_lues: items.length,
    annonces_totales_affichees: vintedSearch?.resultCount ?? null,
    prix_median: median(prices), prix_min: prices.length ? Math.min(...prices) : null, prix_max: prices.length ? Math.max(...prices) : null,
    favoris_visibles: favs.length ? favs.reduce((a, b) => a + b, 0) : null,
    favoris_median: median(favs),
    annonces_avec_favoris: favs.length,
    avertissement: "Les favoris indiquent un intérêt, pas des ventes confirmées.",
  };
}
