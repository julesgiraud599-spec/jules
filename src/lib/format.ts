export const NA = "Non disponible";
export function eur(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NA;
  return v.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NA;
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}
export function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return NA;
  return v.toLocaleString("fr-FR");
}
export function dateFr(d: Date | string | null | undefined): string {
  if (!d) return NA;
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
/** Date locale YYYY-MM-DD (Europe/Paris) */
export function dayKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export const SUPPLIERS = ["ALIEXPRESS", "TEMU", "SHEIN"] as const;
export type Supplier = (typeof SUPPLIERS)[number];
export const SUPPLIER_LABEL: Record<string, string> = { ALIEXPRESS: "AliExpress", TEMU: "Temu", SHEIN: "SHEIN" };
export const CATEGORIES = [
  "Accessoires cheveux", "Bijoux", "Sacs", "Accessoires mode", "Vêtements femme", "Vêtements homme",
  "Enfants", "Maison & déco", "Accessoires tech", "Beauté (accessoires)", "Sport & loisirs", "Autre",
];
/** Liens de recherche (ouverts par l'utilisateur dans son navigateur). */
export function searchLinks(q: string) {
  const e = encodeURIComponent(q);
  return {
    vinted: `https://www.vinted.fr/catalog?search_text=${e}&order=relevance`,
    ALIEXPRESS: `https://fr.aliexpress.com/w/wholesale-${encodeURIComponent(q.trim().replace(/\s+/g, "-"))}.html`,
    TEMU: `https://www.temu.com/search_result.html?search_key=${e}`,
    SHEIN: `https://fr.shein.com/pdsearch/${e}/`,
  };
}
