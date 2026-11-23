import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const AI_MODEL = "claude-opus-5-5";
export function aiConfigured() { return Boolean(process.env.ANTHROPIC_API_KEY); }

export const AnalysisSchema = z.object({
  pourquoi: z.string().describe("Pourquoi ce produit peut se vendre sur Vinted"),
  tendance: z.enum(["Passagère", "Durable", "Saisonnière", "Incertaine"]),
  tendance_explication: z.string(),
  concurrence: z.string().describe("Analyse du niveau de concurrence"),
  prix_conseille: z.number().nullable().describe("Prix de revente conseillé en euros, null si données insuffisantes"),
  prix_explication: z.string(),
  marge_esperee: z.string(),
  verdict: z.enum(["Bonne opportunité", "Opportunité moyenne", "À éviter", "Données insuffisantes"]),
  risques: z.array(z.string()),
  conseils_annonce: z.array(z.string()).describe("Conseils concrets pour l'annonce Vinted"),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

const SYSTEM = `Tu es analyste e-commerce spécialisé dans la revente d'articles neufs sans marque sur Vinted (France), achetés chez AliExpress, Temu ou SHEIN.
Tu reçois UNIQUEMENT les données réellement observées. Règles strictes :
- N'invente aucune statistique. Si une donnée vaut "Non disponible", dis-le et tiens-en compte dans ton verdict.
- Distingue toujours les ventes confirmées (annonces marquées vendues) des signaux de demande (favoris, vues).
- Signale tout risque de contrefaçon (logo, nom de marque, design protégé) : le vendeur ne revend que des produits sans marque.
- Rappelle si pertinent que la revente régulière de neuf relève d'une activité professionnelle (Vinted Pro, micro-entreprise).
- Réponds en français, de façon concise et concrète.`;

export async function analyzeProduct(payload: unknown): Promise<Analysis> {
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(AnalysisSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Analyse cette opportunité produit et réponds aux questions du schéma.\n\nDonnées :\n${JSON.stringify(payload, null, 2)}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("L'IA a refusé d'analyser ce produit.");
  if (!response.parsed_output) throw new Error("Réponse IA illisible.");
  return response.parsed_output;
}
