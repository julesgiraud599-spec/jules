/**
 * Correspondance entre un produit repéré sur Vinted et une offre fournisseur.
 *
 * Signaux :
 *  - visuel (poids 50) : comparaison des photos par l'IA (Claude, vision) — le seul signal capable
 *    de dire « c'est le même article » ; un verdict « différent » rejette l'offre quoi qu'il arrive ;
 *  - titre (25) : mots significatifs communs entre les annonces Vinted et le titre fournisseur ;
 *  - couleurs (15) : couleurs citées des deux côtés ;
 *  - dimensions (10) : tailles en cm/mm citées des deux côtés.
 * Un signal sans donnée est exclu (jamais estimé). Sans comparaison visuelle ni confirmation de
 * l'utilisateur, la correspondance reste « incertaine » et le produit n'entre pas dans le Top 10.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { titleSimilarity, tokens } from "./links";
import { AI_MODEL, aiConfigured } from "./ai";

export type MatchStatus = "MATCH" | "UNCERTAIN" | "REJECTED" | "PENDING";
export const MATCH_LABEL: Record<MatchStatus, string> = { MATCH: "Même produit", UNCERTAIN: "Correspondance incertaine", REJECTED: "Produit différent", PENDING: "Non comparé" };
export const MATCH_THRESHOLD = 70;

const COLORS: Record<string, string[]> = {
  noir: ["noir", "noire", "black"], blanc: ["blanc", "blanche", "white", "ivoire", "ivory", "creme", "cream"], beige: ["beige", "camel", "nude", "taupe", "khaki", "kaki"],
  marron: ["marron", "brown", "chocolat", "cafe", "coffee", "ecaille", "tortoise", "leopard"], gris: ["gris", "grise", "grey", "gray"], rose: ["rose", "pink", "fuchsia"],
  rouge: ["rouge", "red", "bordeaux", "burgundy"], bleu: ["bleu", "bleue", "blue", "marine", "navy"], vert: ["vert", "verte", "green", "olive", "sauge", "sage"],
  jaune: ["jaune", "yellow", "moutarde"], violet: ["violet", "purple", "lilas", "lavande", "lavender"], orange: ["orange"], dore: ["dore", "doree", "gold", "golden"], argent: ["argent", "argente", "silver"],
};
export function colorsOf(text: string): Set<string> {
  const t = new Set(tokens(text).concat(text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/)));
  const out = new Set<string>();
  for (const [c, words] of Object.entries(COLORS)) if (words.some((w) => t.has(w))) out.add(c);
  return out;
}
/** Dimensions en cm (les mm sont convertis). */
export function dimensionsOf(text: string): number[] {
  const out: number[] = [];
  for (const m of text.toLowerCase().matchAll(/(\d+(?:[.,]\d+)?)\s*(cm|mm)\b/g)) {
    const v = Number(m[1].replace(",", ".")) / (m[2] === "mm" ? 10 : 1);
    if (v > 0 && v < 500) out.push(v);
  }
  return out;
}

export const VisualSchema = z.object({
  verdict: z.enum(["identique", "tres_proche", "different", "indeterminable"]),
  confiance: z.number().min(0).max(100),
  raisons: z.string(),
});
export type Visual = z.infer<typeof VisualSchema>;

export interface MatchInput {
  vintedTitles: string[];
  supplierTitle: string;
  visual?: Visual | null;      // résultat de compareImages, si disponible
  userConfirmed?: boolean;
}
export interface MatchResult { status: MatchStatus; score: number | null; signals: { key: string; label: string; weight: number; score: number | null; detail: string }[] }

export function computeMatch(i: MatchInput): MatchResult {
  const vintedText = i.vintedTitles.join(" ");
  const sims = i.vintedTitles.map((t) => titleSimilarity(t, i.supplierTitle));
  const title = sims.length ? Math.max(...sims) : null;
  const cv = colorsOf(vintedText), cs = colorsOf(i.supplierTitle);
  const colorScore = cv.size && cs.size ? ([...cv].some((c) => cs.has(c)) ? 100 : 0) : null;
  const dv = dimensionsOf(vintedText), ds = dimensionsOf(i.supplierTitle);
  const dimScore = dv.length && ds.length ? (dv.some((a) => ds.some((b) => Math.abs(a - b) / Math.max(a, b) <= 0.2)) ? 100 : 0) : null;
  const vis = i.visual && i.visual.verdict !== "indeterminable"
    ? (i.visual.verdict === "identique" ? i.visual.confiance : i.visual.verdict === "tres_proche" ? Math.min(85, i.visual.confiance) : 0)
    : null;

  const signals = [
    { key: "visual", label: "Comparaison des photos (IA)", weight: 50, score: vis, detail: i.visual ? `${i.visual.verdict.replace("_", " ")} (${i.visual.confiance} %) : ${i.visual.raisons}` : "Pas de comparaison visuelle (photos ou IA non disponibles)" },
    { key: "title", label: "Titre / caractéristiques", weight: 25, score: title === null ? null : Math.round(title * 100), detail: title === null ? "Aucune annonce Vinted" : `${Math.round(title * 100)} % de mots significatifs communs` },
    { key: "color", label: "Couleurs", weight: 15, score: colorScore, detail: colorScore === null ? "Couleur non citée des deux côtés" : `Vinted : ${[...cv].join(", ")} · fournisseur : ${[...cs].join(", ")}` },
    { key: "dims", label: "Dimensions", weight: 10, score: dimScore, detail: dimScore === null ? "Dimensions non citées des deux côtés" : `Vinted : ${dv.join(", ")} cm · fournisseur : ${ds.join(", ")} cm` },
  ];
  const av = signals.filter((s) => s.score !== null);
  const w = av.reduce((a, s) => a + s.weight, 0);
  const score = w ? Math.round(av.reduce((a, s) => a + (s.score as number) * s.weight, 0) / w) : null;

  let status: MatchStatus;
  if (i.visual?.verdict === "different" || colorScore === 0 && vis === null && (title ?? 0) < 0.5) status = "REJECTED";
  else if (i.userConfirmed) status = "MATCH";
  else if (vis !== null && score !== null && score >= MATCH_THRESHOLD) status = "MATCH";
  else if (score === null) status = "PENDING";
  else status = "UNCERTAIN";
  return { status, score: i.userConfirmed && status === "MATCH" ? Math.max(score ?? 0, 90) : score, signals };
}

/** Comparaison visuelle de la photo Vinted de référence et des photos fournisseur (Claude, vision). */
export async function compareImages(vintedPhoto: string, supplierPhotos: string[], context: { vintedTitle: string; supplierTitle: string }): Promise<Visual> {
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY non configurée");
  const photos = supplierPhotos.filter((u) => u.startsWith("https://")).slice(0, 3);
  if (!vintedPhoto.startsWith("https://") || !photos.length) throw new Error("Photos manquantes");
  const client = new Anthropic();
  const res = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(VisualSchema) },
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `Photo 1 : annonce Vinted « ${context.vintedTitle} ».` },
        { type: "image", source: { type: "url", url: vintedPhoto } },
        { type: "text", text: `Photo(s) suivante(s) : fiche fournisseur « ${context.supplierTitle} ».` },
        ...photos.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
        { type: "text", text: "S'agit-il du MÊME article (même forme, même matière, mêmes détails, même coloris disponible) ? Ignore l'arrière-plan, la mise en scène et la qualité photo. « identique » seulement si tu en es sûr ; « tres_proche » si seuls des détails mineurs diffèrent ; « different » si c'est un autre modèle ; « indeterminable » si les photos ne permettent pas de juger. Réponds en français, raisons en une phrase." },
      ],
    }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("Comparaison visuelle impossible");
  return res.parsed_output;
}
