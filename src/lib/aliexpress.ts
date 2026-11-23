import crypto from "node:crypto";

/**
 * Client officiel AliExpress Open Platform — API Affiliés (aliexpress.affiliate.product.query).
 * Nécessite un compte développeur + programme Affiliés AliExpress (App Key / App Secret / Tracking ID).
 * Doc : https://openservice.aliexpress.com  (rubrique "Affiliate API")
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
  externalId: string; title: string; url: string; imageUrl: string | null;
  price: number; salesVolume: number | null; rating: string | null;
}

export async function searchAliExpress(keywords: string, pageSize = 10): Promise<AliProduct[]> {
  const appKey = process.env.ALIEXPRESS_APP_KEY, secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!appKey || !secret) throw new Error("API AliExpress non configurée (ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET).");
  const params: Record<string, string> = {
    method: "aliexpress.affiliate.product.query",
    app_key: appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    keywords,
    target_currency: "EUR",
    target_language: "FR",
    ship_to_country: "FR",
    page_size: String(pageSize),
    page_no: "1",
  };
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
  const result = json?.aliexpress_affiliate_product_query_response?.resp_result;
  if (result && result.resp_code && Number(result.resp_code) !== 200) throw new Error(`AliExpress : ${result.resp_msg ?? result.resp_code}`);
  const list: any[] = result?.result?.products?.product ?? [];
  return list.map((p) => ({
    externalId: String(p.product_id),
    title: String(p.product_title ?? ""),
    url: String(p.promotion_link || p.product_detail_url),
    imageUrl: p.product_main_image_url ?? null,
    price: Number(p.target_sale_price ?? p.sale_price),
    salesVolume: p.lastest_volume !== undefined ? Number(p.lastest_volume) : null,
    rating: p.evaluate_rate ?? null,
  })).filter((p) => Number.isFinite(p.price) && p.price > 0 && p.url);
}
