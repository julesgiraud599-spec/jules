/** Sites autorisés et URL de recherche publiques (pages que vous pourriez ouvrir vous-même). */
export const ALLOWED = [/(^|\.)vinted\.(fr|be|com|lu|es|it|de|nl|pt|pl|co\.uk)$/i, /(^|\.)aliexpress\.(com|us)$/i, /(^|\.)temu\.com$/i];
export function isAllowedUrl(u) { try { const x = new URL(u); return x.protocol === "https:" && ALLOWED.some((r) => r.test(x.hostname)); } catch { return false; } }
export function searchUrl(site, keyword) {
  const e = encodeURIComponent(keyword.trim());
  if (site === "VINTED") return `https://www.vinted.fr/catalog?search_text=${e}&order=relevance`;
  if (site === "ALIEXPRESS") return `https://fr.aliexpress.com/w/wholesale-${encodeURIComponent(keyword.trim().replace(/\s+/g, "-"))}.html?SortType=total_tranpro_desc`;
  if (site === "TEMU") return `https://www.temu.com/fr/search_result.html?search_key=${e}`;
  throw new Error("Site inconnu : " + site);
}
