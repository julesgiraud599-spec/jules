import crypto from "node:crypto";

/**
 * Client officiel AliExpress Open Platform — API Affiliés.
 *  - aliexpress.affiliate.product.query     : recherche par mots-clés
 *  - aliexpress.affiliate.productdetail.get : détail d'un produit par identifiant (sert à VÉRIFIER qu'il existe,
 *                                             son prix actuel et son lien canonique)
 * Nécessite un compte développeur + programme Affiliés (App Key / App Secret / Tracking ID).
 * Doc : https://openservice.aliexpress.com (rubrique « Affiliate API »)
 */
const ENDPOINT = "https://api-sg.aliexpress.com/sync";

export function aliexpressConfigured() {
  return Boolean(process.env.ALIEXPRESS_APP_KEY && process.env.ALIEXPRESS_APP_SECRET);
}

/** Signature HMAC-SHA256 : paramètres triés, concaténés clé+valeur, hex majuscule. */
export function signParams(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex").toUpperCase();
}

export interface AliProduct {
  externalId: string; title: string;
  url: string;              // fiche produit canonique https://fr.aliexpress.com/item/<id>.html
  affiliateUrl: string | null;
  imageUrl: string | null; images: string[];
  price: number; salesVolume: number | null; rating: string | null;
}

async function call(method: string, extra: Record<string, string>): Promise<any> {
  const appKey = process.env.ALIEXPRESS_APP_KEY, secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!appKey || !secret) throw new Error("API AliExpress non configurée (ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET).");
  const params: Record<string, string> = { method, app_key: appKey, sign_method: "sha256", timestamp: String(Date.now()), target_currency: "EUR", target_language: "FR", ...extra };
  if (process.env.ALIEXPRESS_TRACKING_ID) params.tracking_id = process.env.ALIEXPRESS_TRACKING_ID;
  params.sign = signParams(params, secret);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`AliExpress HTTP ${res.status}`);
  const json = await res.json();
  if (json.error_response) throw new Error(`AliExpress : ${json.error_response.msg ?? JSON.stringify(json.error_response)}`);
  const key = method.replace(/\./g, "_") + "_response";
  const result = json?.[key]?.resp_result;
  if (result?.resp_code && Number(result.resp_code) !== 200) throw new Error(`AliExpress : ${result.resp_msg ?? result.resp_code}`);
  return result?.result;
}

export function mapProduct(p: any): AliProduct | null {
  const id = String(p?.product_id ?? "");
  const price = Number(p?.target_sale_price ?? p?.sale_price);
  if (!/^\d{8,}$/.test(id) || !Number.isFinite(price) || price <= 0) return null;
  const imgs: string[] = (p.product_small_image_urls?.string ?? []).filter((x: unknown) => typeof x === "string");
  return {
    externalId: id,
    title: String(p.product_title ?? ""),
    url: `https://fr.aliexpress.com/item/${id}.html`, // construit depuis l'identifiant RENVOYÉ par l'API, jamais inventé
    affiliateUrl: typeof p.promotion_link === "string" && p.promotion_link.startsWith("https://") ? p.promotion_link : null,
    imageUrl: p.product_main_image_url ?? null,
    images: [p.product_main_image_url, ...imgs].filter(Boolean).slice(0, 4),
    price,
    salesVolume: p.lastest_volume !== undefined ? Number(p.lastest_volume) : null,
    rating: p.evaluate_rate ?? null,
  };
}

export async function searchAliExpress(keywords: string, pageSize = 20): Promise<AliProduct[]> {
  const r = await call("aliexpress.affiliate.product.query", { keywords, ship_to_country: "FR", page_size: String(pageSize), page_no: "1", sort: "LAST_VOLUME_DESC" });
  return (r?.products?.product ?? []).map(mapProduct).filter((x: AliProduct | null): x is AliProduct => x !== null);
}

/** Vérifie des produits par identifiant : un produit absent de la réponse n'existe plus (ou n'est plus livrable en France). */
export async function productDetails(ids: string[]): Promise<Map<string, AliProduct>> {
  const out = new Map<string, AliProduct>();
  for (let i = 0; i < ids.length; i += 20) {
    const r = await call("aliexpress.affiliate.productdetail.get", { product_ids: ids.slice(i, i + 20).join(","), country: "FR" });
    for (const p of r?.products?.product ?? []) { const m = mapProduct(p); if (m) out.set(m.externalId, m); }
  }
  return out;
}
