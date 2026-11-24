import { describe, it, expect } from "vitest";
import { staticCheck, classifyPage, checkLink, supplierFromUrl, titleSimilarity } from "@/lib/links";

describe("staticCheck : forme des liens", () => {
  it("accepte une fiche Temu France et extrait l'identifiant", () => {
    const r = staticCheck("https://www.temu.com/fr/echarpe-epaisse-g-601099529337147.html?refer=x", "TEMU");
    expect(r.ok).toBe(true);
    expect(r.externalId).toBe("601099529337147");
    expect(r.canonicalUrl).toBe("https://www.temu.com/fr/echarpe-epaisse-g-601099529337147.html");
  });
  it("accepte AliExpress /item/ et /i/ et canonise vers fr.aliexpress.com", () => {
    expect(staticCheck("https://www.aliexpress.com/item/1005006123456789.html?spm=1", "ALIEXPRESS").canonicalUrl).toBe("https://fr.aliexpress.com/item/1005006123456789.html");
    expect(staticCheck("https://www.aliexpress.com/i/3256811704645418.html", "ALIEXPRESS").externalId).toBe("3256811704645418");
  });
  it("accepte une fiche SHEIN", () => {
    expect(staticCheck("https://fr.shein.com/Vintage-Design-Crossbody-Bag-p-2764285-cat-2152.html", "SHEIN").externalId).toBe("2764285");
  });
  it("refuse les pages de recherche et de catégorie", () => {
    for (const [u, s] of [
      ["https://www.aliexpress.com/w/wholesale-large-claw-clip.html", "ALIEXPRESS"],
      ["https://fr.shein.com/pdsearch/pochette/", "SHEIN"],
      ["https://fr.shein.com/Women-Tote-Bags-c-2844.html", "SHEIN"],
      ["https://www.temu.com/search_result.html?search_key=pince", "TEMU"],
      ["https://www.temu.com/fr/bijoux-pour-femmes-en-acier-inoxydable-5040255117572-s.html", "TEMU"],
    ] as const) expect(staticCheck(u, s).ok, u).toBe(false);
  });
  it("refuse la page d'accueil, un autre domaine et une boutique étrangère", () => {
    expect(staticCheck("https://www.temu.com/fr", "TEMU").reason).toMatch(/identifiant/);
    expect(staticCheck("https://www.temu-fake.com/fr/x-g-601099529337147.html", "TEMU").ok).toBe(false);
    expect(staticCheck("https://www.temu.com/x-g-601099529337147.html", "SHEIN").ok).toBe(false);
    expect(staticCheck("https://www.temu.com/us-fr/x-g-601099529337147.html", "TEMU").reason).toMatch(/étrangère/);
    expect(staticCheck("http://www.temu.com/fr/x-g-601099529337147.html", "TEMU").ok).toBe(false);
  });
  it("supplierFromUrl", () => {
    expect(supplierFromUrl("https://fr.aliexpress.com/item/1.html")).toBe("ALIEXPRESS");
    expect(supplierFromUrl("https://example.com")).toBeNull();
  });
});

const T = { supplier: "TEMU" as const, externalId: "601099529337147" };
const PAGE = (title: string, body = "") => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

describe("classifyPage : la page correspond-elle au produit attendu ?", () => {
  it("404 → invalide", () => {
    expect(classifyPage({ ...T, status: 404, finalUrl: "https://www.temu.com/fr/x-g-601099529337147.html", html: "" }).status).toBe("INVALID");
  });
  it("redirection vers l'accueil → invalide", () => {
    const r = classifyPage({ ...T, status: 200, finalUrl: "https://www.temu.com/fr", html: PAGE("Temu") });
    expect(r.status).toBe("INVALID");
    expect(r.reason).toMatch(/accueil/);
  });
  it("redirection vers un autre produit → invalide", () => {
    expect(classifyPage({ ...T, status: 200, finalUrl: "https://www.temu.com/fr/y-g-601099000000001.html", html: PAGE("Autre") }).reason).toMatch(/autre produit/);
  });
  it("produit retiré → invalide (pas seulement HTTP 200)", () => {
    const r = classifyPage({ ...T, status: 200, finalUrl: "https://www.temu.com/fr/x-g-601099529337147.html", html: PAGE("Cet article n’est plus au catalogue - Temu France") });
    expect(r.status).toBe("INVALID");
    expect(r.available).toBe(false);
  });
  it("mur anti-robot → à vérifier manuellement, jamais « vérifié »", () => {
    const r = classifyPage({ ...T, status: 200, finalUrl: "https://www.temu.com/fr/x-g-601099529337147.html", html: PAGE("Temu", "Please Verify you are human, captcha") });
    expect(r.status).toBe("MANUAL");
  });
  it("coquille JavaScript (titre = nom du site) → à vérifier manuellement", () => {
    const r = classifyPage({ ...T, status: 200, finalUrl: "https://www.temu.com/fr/x-g-601099529337147.html", html: PAGE("Temu"), expectedTitle: "Écharpe" });
    expect(r.status).toBe("MANUAL");
    expect(r.reason).toMatch(/navigateur/);
  });
  it("page lue mais titre sans rapport → à vérifier manuellement", () => {
    expect(classifyPage({ ...T, status: 200, finalUrl: "https://www.temu.com/fr/x-g-601099529337147.html", html: PAGE("Perceuse sans fil 18V"), expectedTitle: "Écharpe épaisse rayée zébrée" }).status).toBe("MANUAL");
  });
  it("page lue et titre concordant → vérifié", () => {
    const r = classifyPage({ ...T, status: 200, finalUrl: "https://www.temu.com/fr/x-g-601099529337147.html", html: PAGE("Écharpe Épaisse À Rayures Zébrées Dégradée Pour Femme - Temu France"), expectedTitle: "Écharpe épaisse rayée zébrée dégradé" });
    expect(r.status).toBe("VERIFIED");
  });
});

describe("checkLink : chaîne de redirections (fetch simulé)", () => {
  const fake = (map: Record<string, { status: number; location?: string; body?: string }>): typeof fetch =>
    (async (url: string) => {
      const r = map[url] ?? { status: 404 };
      return new Response(r.body ?? "", { status: r.status, headers: { ...(r.location ? { location: r.location } : {}), "content-type": "text/html" } });
    }) as unknown as typeof fetch;
  it("suit une redirection vers la même fiche et vérifie", async () => {
    const u = "https://www.temu.com/fr/echarpe-g-601099529337147.html";
    const r = await checkLink(u, "TEMU", "Écharpe zébrée épaisse", fake({ [u]: { status: 301, location: "/fr/echarpe-zebree-g-601099529337147.html" }, "https://www.temu.com/fr/echarpe-zebree-g-601099529337147.html": { status: 200, body: PAGE("Écharpe zébrée épaisse femme") } }));
    expect(r.status).toBe("VERIFIED");
    expect(r.steps.some((s) => s.step === "Redirections")).toBe(true);
  });
  it("détecte la redirection vers l'accueil", async () => {
    const u = "https://www.temu.com/fr/echarpe-g-601099529337147.html";
    const r = await checkLink(u, "TEMU", "Écharpe", fake({ [u]: { status: 302, location: "https://www.temu.com/fr" }, "https://www.temu.com/fr": { status: 200, body: PAGE("Temu") } }));
    expect(r.status).toBe("INVALID");
  });
  it("site injoignable → à vérifier manuellement", async () => {
    const r = await checkLink("https://www.temu.com/fr/echarpe-g-601099529337147.html", "TEMU", null, (async () => { throw new Error("ENOTFOUND"); }) as unknown as typeof fetch);
    expect(r.status).toBe("MANUAL");
  });
  it("une page de recherche est refusée sans requête réseau", async () => {
    const r = await checkLink("https://fr.shein.com/pdsearch/pochette/", "SHEIN", null, (async () => { throw new Error("ne doit pas être appelé"); }) as unknown as typeof fetch);
    expect(r.status).toBe("INVALID");
  });
});

describe("titleSimilarity", () => {
  it("compare des titres FR/EN", () => {
    expect(titleSimilarity("Pince à cheveux XXL écaille", "Grande pince cheveux XXL effet écaille acétate")).toBeGreaterThan(0.6);
    expect(titleSimilarity("Pince à cheveux XXL écaille", "Perceuse visseuse 18V")).toBe(0);
  });
});
