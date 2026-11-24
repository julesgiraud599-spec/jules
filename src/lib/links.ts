/**
 * Vérification des liens fournisseurs.
 *
 * Règles :
 *  - on n'invente jamais d'URL ni d'identifiant produit ;
 *  - une page de recherche / catégorie n'est jamais acceptée comme fiche produit ;
 *  - « Vérifié » exige une preuve : réponse de l'API officielle (AliExpress), page produit
 *    réellement lue et correspondant au titre attendu, ou confirmation explicite de l'utilisateur ;
 *  - quand le site bloque la vérification (anti-robot), le lien est « À vérifier manuellement »,
 *    jamais « Vérifié ».
 */

export type Supplier = "ALIEXPRESS" | "TEMU" | "SHEIN";
export type LinkStatus = "VERIFIED" | "MANUAL" | "INVALID" | "PENDING";

export const LINK_STATUS_LABEL: Record<LinkStatus, string> = {
  VERIFIED: "Vérifié",
  MANUAL: "À vérifier manuellement",
  INVALID: "Invalide",
  PENDING: "Non vérifié",
};

export interface CheckStep { step: string; ok: boolean | null; detail: string }
export interface LinkCheck {
  status: LinkStatus;
  verifiedBy: "API" | "HTTP" | "USER" | null;
  externalId: string | null;
  canonicalUrl: string | null;
  finalUrl: string | null;
  available: boolean | null;
  pageTitle: string | null;
  steps: CheckStep[];
  reason: string;
}

const RULES: Record<Supplier, { host: RegExp; productId: (u: URL) => string | null; canonical: (id: string, u: URL) => string }> = {
  ALIEXPRESS: {
    host: /(^|\.)aliexpress\.(com|us)$/i,
    productId: (u) => u.pathname.match(/\/(?:item|i)\/(\d{8,})\.html$/i)?.[1] ?? null,
    canonical: (id) => `https://fr.aliexpress.com/item/${id}.html`,
  },
  TEMU: {
    host: /(^|\.)temu\.com$/i,
    productId: (u) => u.pathname.match(/-g-(\d{9,})\.html$/i)?.[1] ?? (u.pathname === "/goods.html" ? u.searchParams.get("goods_id") : null),
    canonical: (_id, u) => `https://www.temu.com${u.pathname}`,
  },
  SHEIN: {
    host: /(^|\.)shein\.(com|fr)$/i,
    productId: (u) => u.pathname.match(/-p-(\d{5,})(?:-cat-\d+)?\.html$/i)?.[1] ?? null,
    canonical: (_id, u) => `https://${u.hostname}${u.pathname}`,
  },
};

/** Pages qui ne sont PAS des fiches produit. */
const NON_PRODUCT = [/\/w\/wholesale-/i, /\/wholesale\//i, /\/pdsearch\//i, /search_result/i, /\/search\b/i, /-c-\d+\.html$/i, /-s\.html$/i, /\/gc\//i, /\/category\//i, /\/style\//i, /\/new\//i, /\/trends\//i];
/** Boutiques d'autres pays (le revendeur achète depuis la France). */
const FOREIGN_TEMU = /^\/(us-fr|ca-fr|mu-fr|ma|be-fr|lu-fr|ch-fr|ch-en|uk|us|ca|au|de|es|it|nl)\//i;

export function supplierFromUrl(raw: string): Supplier | null {
  try {
    const u = new URL(raw);
    for (const s of Object.keys(RULES) as Supplier[]) if (RULES[s].host.test(u.hostname)) return s;
  } catch { /* URL invalide */ }
  return null;
}

/** Étapes 1, 2 et forme de l'URL : contrôles sans réseau. */
export function staticCheck(raw: string, supplier: Supplier): { ok: boolean; steps: CheckStep[]; externalId: string | null; canonicalUrl: string | null; reason: string } {
  const steps: CheckStep[] = [];
  let u: URL;
  try { u = new URL(raw.trim()); }
  catch { steps.push({ step: "URL valide", ok: false, detail: "Adresse mal formée" }); return { ok: false, steps, externalId: null, canonicalUrl: null, reason: "URL mal formée" }; }
  if (u.protocol !== "https:") { steps.push({ step: "URL valide", ok: false, detail: "Doit commencer par https://" }); return { ok: false, steps, externalId: null, canonicalUrl: null, reason: "URL non sécurisée" }; }
  steps.push({ step: "URL valide", ok: true, detail: u.hostname });

  const rule = RULES[supplier];
  if (!rule.host.test(u.hostname)) {
    steps.push({ step: "Domaine du fournisseur", ok: false, detail: `${u.hostname} n'appartient pas à ${supplier}` });
    return { ok: false, steps, externalId: null, canonicalUrl: null, reason: `Le domaine ne correspond pas à ${supplier}` };
  }
  steps.push({ step: "Domaine du fournisseur", ok: true, detail: u.hostname });

  if (NON_PRODUCT.some((r) => r.test(u.pathname))) {
    steps.push({ step: "Fiche produit (pas une recherche)", ok: false, detail: "Page de recherche ou de catégorie" });
    return { ok: false, steps, externalId: null, canonicalUrl: null, reason: "Ce lien est une page de recherche ou de catégorie, pas une fiche produit" };
  }
  if (supplier === "TEMU" && FOREIGN_TEMU.test(u.pathname)) {
    steps.push({ step: "Boutique France", ok: false, detail: `Boutique étrangère (${u.pathname.split("/")[1]})` });
    return { ok: false, steps, externalId: null, canonicalUrl: null, reason: "Lien d'une boutique Temu étrangère : utilisez temu.com/fr" };
  }
  const id = rule.productId(u);
  if (!id) {
    steps.push({ step: "Identifiant produit", ok: false, detail: "Aucun identifiant produit dans l'URL" });
    return { ok: false, steps, externalId: null, canonicalUrl: null, reason: "Aucun identifiant de produit dans l'URL (page d'accueil ou lien incomplet)" };
  }
  steps.push({ step: "Identifiant produit", ok: true, detail: id });
  return { ok: true, steps, externalId: id, canonicalUrl: rule.canonical(id, u), reason: "" };
}

const BOT_WALL = [/_____tmd_____\/punish/i, /\/risk\/challenge/i, /captcha/i, /verify you are (a )?human/i, /slide to verify/i, /x5secdata/i, /are you a robot/i];
const REMOVED = [/n[’']est plus au catalogue/i, /n[’']est plus disponible/i, /no longer available/i, /item (is )?(not found|unavailable|removed)/i, /page (introuvable|not found)/i, /produit (introuvable|indisponible)/i, /sold out/i, /ce produit a été retiré/i];

export function pageTitleOf(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1];
  const t = og ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return t ? t.replace(/\s+/g, " ").trim() : null;
}

/** Classe une page déjà téléchargée. Pur, testable. */
export function classifyPage(opts: { status: number; finalUrl: string; html: string; supplier: Supplier; externalId: string; expectedTitle?: string | null }): { status: LinkStatus; available: boolean | null; reason: string; steps: CheckStep[]; pageTitle: string | null } {
  const steps: CheckStep[] = [];
  const { status, finalUrl, html, supplier, externalId } = opts;
  if (status === 404 || status === 410) {
    steps.push({ step: "La page existe", ok: false, detail: `HTTP ${status}` });
    return { status: "INVALID", available: false, reason: "La page produit n'existe pas (erreur 404)", steps, pageTitle: null };
  }
  let fu: URL | null = null;
  try { fu = new URL(finalUrl); } catch { /* */ }
  if (!fu || !RULES[supplier].host.test(fu.hostname)) {
    steps.push({ step: "Redirection correcte", ok: false, detail: `Redirige vers ${fu?.hostname ?? "une adresse invalide"}` });
    return { status: "INVALID", available: null, reason: "Le lien redirige hors du site du fournisseur", steps, pageTitle: null };
  }
  if (BOT_WALL.some((r) => r.test(fu!.href) || r.test(html.slice(0, 200_000)))) {
    steps.push({ step: "La page existe", ok: null, detail: "Le site affiche une vérification anti-robot" });
    return { status: "MANUAL", available: null, reason: "Le site bloque la vérification automatique (anti-robot) : ouvrez le lien pour confirmer", steps, pageTitle: null };
  }
  const finalId = RULES[supplier].productId(fu);
  if (!finalId) {
    steps.push({ step: "Redirection correcte", ok: false, detail: `Redirige vers ${fu.pathname}` });
    return { status: "INVALID", available: null, reason: "Le lien redirige vers la page d'accueil ou une recherche, pas vers le produit", steps, pageTitle: null };
  }
  if (finalId !== externalId) {
    steps.push({ step: "Redirection correcte", ok: false, detail: `Redirige vers le produit ${finalId}` });
    return { status: "INVALID", available: null, reason: "Le lien redirige vers un autre produit", steps, pageTitle: null };
  }
  steps.push({ step: "Redirection correcte", ok: true, detail: fu.pathname });
  if (status >= 400) {
    steps.push({ step: "La page existe", ok: false, detail: `HTTP ${status}` });
    return { status: "MANUAL", available: null, reason: `Le site a répondu HTTP ${status}`, steps, pageTitle: null };
  }
  const title = pageTitleOf(html);
  if (REMOVED.some((r) => r.test(title ?? "") || r.test(html.slice(0, 200_000)))) {
    steps.push({ step: "Produit disponible", ok: false, detail: "Le site indique que le produit n'est plus disponible" });
    return { status: "INVALID", available: false, reason: "Le produit n'est plus disponible chez le fournisseur", steps, pageTitle: title };
  }
  if (!title || /^\s*(temu|shein|aliexpress)(\s*[-|·:].{0,40})?\s*$/i.test(title) && !/-g-|item|-p-/.test(title)) {
    steps.push({ step: "La page existe", ok: null, detail: "Le site n'affiche le produit qu'avec JavaScript (page vide côté serveur)" });
    return { status: "MANUAL", available: null, reason: "Le site n'affiche le produit qu'à un vrai navigateur : ouvrez le lien pour confirmer", steps, pageTitle: title };
  }
  steps.push({ step: "La page existe", ok: true, detail: title });
  if (!opts.expectedTitle) {
    steps.push({ step: "Bon produit", ok: null, detail: "Impossible de comparer le titre" });
    return { status: "MANUAL", available: null, reason: "Page trouvée, mais le titre n'a pas pu être comparé au produit attendu", steps, pageTitle: title };
  }
  const sim = titleSimilarity(title, opts.expectedTitle);
  if (sim < 0.3) {
    steps.push({ step: "Bon produit", ok: false, detail: `Titre différent (similarité ${Math.round(sim * 100)} %)` });
    return { status: "MANUAL", available: null, reason: "La page ne semble pas correspondre au produit attendu", steps, pageTitle: title };
  }
  steps.push({ step: "Bon produit", ok: true, detail: `Titre concordant (${Math.round(sim * 100)} %)` });
  return { status: "VERIFIED", available: true, reason: "Page produit lue et concordante", steps, pageTitle: title };
}

/* ----------------------------- similarité de texte ----------------------------- */

const STOP = new Set("le la les un une des de du d l et ou en pour avec sans sur au aux a à par the and for with of in to on by from new nouveau nouvelle femme femmes homme hommes fille filles women woman men girls 1pc 1 pcs pc pièce pièces lot ensemble set style mode tendance chic élégant elegant".split(" "));
export function tokens(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 2 && !STOP.has(t));
}
/** Part des mots significatifs du texte le plus court retrouvés dans l'autre (0-1). */
export function titleSimilarity(a: string, b: string): number {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  let hit = 0;
  for (const t of small) if (big.has(t) || [...big].some((x) => x.length > 4 && t.length > 4 && (x.startsWith(t.slice(0, 5)) || t.startsWith(x.slice(0, 5))))) hit++;
  return hit / small.size;
}

/* ----------------------------- vérification HTTP ----------------------------- */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Suit les redirections une à une (max 6) pour pouvoir les contrôler. */
export async function fetchChain(url: string, fetcher: typeof fetch = fetch): Promise<{ status: number; finalUrl: string; html: string; hops: string[] }> {
  let current = url; const hops: string[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await fetcher(current, { redirect: "manual", headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9", Accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { hops.push(`${res.status} → ${loc}`); current = new URL(loc, current).toString(); continue; }
    const html = (res.headers.get("content-type") ?? "").includes("html") ? (await res.text()).slice(0, 400_000) : "";
    return { status: res.status, finalUrl: current, html, hops };
  }
  return { status: 310, finalUrl: current, html: "", hops };
}

/** Vérification complète d'un lien saisi ou trouvé (hors API). */
export async function checkLink(raw: string, supplier: Supplier, expectedTitle: string | null, fetcher: typeof fetch = fetch): Promise<LinkCheck> {
  const st = staticCheck(raw, supplier);
  const base = { verifiedBy: null, finalUrl: null, available: null, pageTitle: null } as const;
  if (!st.ok) return { ...base, status: "INVALID", externalId: null, canonicalUrl: null, steps: st.steps, reason: st.reason };
  try {
    const r = await fetchChain(st.canonicalUrl!, fetcher);
    const c = classifyPage({ status: r.status, finalUrl: r.finalUrl, html: r.html, supplier, externalId: st.externalId!, expectedTitle });
    const steps = [...st.steps, ...(r.hops.length ? [{ step: "Redirections", ok: true, detail: r.hops.join(" | ") }] : []), ...c.steps];
    return { status: c.status, verifiedBy: c.status === "VERIFIED" ? "HTTP" : null, externalId: st.externalId, canonicalUrl: st.canonicalUrl, finalUrl: r.finalUrl, available: c.available, pageTitle: c.pageTitle, steps, reason: c.reason };
  } catch (e) {
    return { ...base, status: "MANUAL", externalId: st.externalId, canonicalUrl: st.canonicalUrl, steps: [...st.steps, { step: "La page existe", ok: null, detail: `Site injoignable : ${(e as Error).message}` }], reason: "Le site n'a pas pu être joint depuis le serveur : ouvrez le lien pour confirmer" };
  }
}
