/**
 * Test d'intégration complet : Chromium + extension Glacier + pont MCP (client MCP officiel) + Glacier.
 *   node tests/extension/run.mjs            (Glacier doit tourner sur GLACIER_URL, défaut http://localhost:3100)
 *
 * Partie A : extracteurs sur pages de test synthétiques (servies via interception réseau).
 * Partie B : outils MCP appelés comme le ferait Claude Code.
 * Partie C : recherche lancée depuis le tableau de bord Glacier, exécutée par l'extension.
 * Partie D : CAPTCHA → arrêt propre.
 * Partie E : vrais sites AliExpress / Temu / Vinted (résultat réel, quel qu'il soit).
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // installé globalement ou dans le projet
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const FIX = path.join(here, "fixtures");
const GLACIER = process.env.GLACIER_URL || "http://localhost:3100";
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "glacier-ext-test");
fs.mkdirSync(OUT, { recursive: true });
const { Client } = await import(path.join(root, "bridge/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js"));
const { StdioClientTransport } = await import(path.join(root, "bridge/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js"));
const { extractPage } = await import(path.join(root, "extension/extractors.js"));

let pass = 0, failN = 0;
const step = async (name, fn) => { try { const r = await fn(); pass++; console.log("OK  ", name, r ? `— ${r}` : ""); } catch (e) { failN++; console.log("FAIL", name, "—", String(e.message || e).split("\n")[0]); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const html = (f) => fs.readFileSync(path.join(FIX, f), "utf8");
const simple = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><div class="price--current">24,90€</div></body></html>`;

async function routeFixtures(ctx) {
  await ctx.route(/^https:\/\/(www\.vinted\.fr|fr\.aliexpress\.com|www\.temu\.com)\//, (route) => {
    const u = route.request().url();
    const body =
      /vinted\.fr\/catalog.*captcha/.test(u) ? html("captcha.html") :
      /vinted\.fr\/catalog/.test(u) ? html("vinted-search.html") :
      /vinted\.fr\/items\/4561234/.test(u) ? html("vinted-item.html") :
      /aliexpress\.com\/w\//.test(u) ? html("ali-search.html") :
      /item\/1005006111111111/.test(u) ? html("ali-item.html") :
      /item\/1005006333333333/.test(u) ? html("ali-gone.html") :
      /item\/1005006222222222/.test(u) ? simple("Perceuse visseuse sans fil 18V - AliExpress") :
      /temu\.com\/fr\/search_result/.test(u) ? html("temu-search.html") :
      /-g-601099513851070/.test(u) ? html("temu-item.html") :
      /-g-601099500000001/.test(u) ? simple("Lampe LED de bureau - Temu France") : null;
    if (!body) return route.fulfill({ status: 404, contentType: "text/html", body: "<title>404</title>Introuvable" });
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
  });
}

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "glacier-chrome-"));
const ctx = await chromium.launchPersistentContext(userDir, {
  channel: "chromium", headless: true, viewport: { width: 1360, height: 900 },
  args: [`--disable-extensions-except=${path.join(root, "extension")}`, `--load-extension=${path.join(root, "extension")}`, "--disable-dev-shm-usage"],
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined,
  ignoreHTTPSErrors: true,
});
await routeFixtures(ctx);
let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
const extId = sw.url().split("/")[2];
console.log("Extension chargée :", extId);

/* ---------------- A. extracteurs ---------------- */
const page = await ctx.newPage();
const run = (opts = {}) => page.evaluate(`(${extractPage.toString()})(${JSON.stringify(opts)})`);
await step("A1 Vinted recherche : annonces, prix, favoris, total", async () => {
  await page.goto("https://www.vinted.fr/catalog?search_text=pince"); const r = await run();
  assert(r.site === "VINTED" && r.pageType === "search", r.pageType); assert(r.items.length === 4, `${r.items.length} annonces`);
  assert(r.items[0].title === "Pince à cheveux XXL écaille marron" && r.items[0].price === 7 && r.items[0].favorites === 48 && r.resultCount === 1284, JSON.stringify(r.items[0]) + r.resultCount);
  assert(r.items[3].favorites === null, "favoris absents doivent valoir null");
  return `${r.items.length} annonces, total ${r.resultCount}, favoris ${r.items.map((i) => i.favorites).join("/")}`;
});
await step("A2 Vinted annonce : titre, prix, photos, favoris, vendeur, vues", async () => {
  await page.goto("https://www.vinted.fr/items/4561234-pince-xxl-ecaille"); const r = await run();
  const i = r.item; assert(r.pageType === "item" && i.price === 7 && i.favorites === 48 && i.views === 213 && i.photos.length === 2 && i.seller?.name === "camille_shop", JSON.stringify(i));
  return `${i.title} · ${i.price} € · ${i.favorites} ♥ · ${i.views} vues`;
});
await step("A3 AliExpress recherche + fiche", async () => {
  await page.goto("https://fr.aliexpress.com/w/wholesale-pince.html"); const s = await run();
  assert(s.items.length === 3 && s.items[0].url === "https://fr.aliexpress.com/item/1005006111111111.html" && s.items[0].price === 1.89 && s.items[0].orders === 2000, JSON.stringify(s.items[0]));
  await page.goto("https://fr.aliexpress.com/item/1005006111111111.html"); const f = await run();
  assert(f.item.price === 1.89 && f.item.available === true && f.item.currency === "EUR", JSON.stringify(f.item));
  return `${s.items.length} résultats ; fiche ${f.item.price} €`;
});
await step("A4 Temu recherche + fiche (URL nettoyée)", async () => {
  await page.goto("https://www.temu.com/fr/search_result.html?search_key=pince"); const s = await run();
  assert(s.items[0].url === "https://www.temu.com/fr/pince-a-cheveux-ecaille-grande-g-601099513851070.html" && s.items[0].price === 1.59, JSON.stringify(s.items[0]));
  await page.goto("https://www.temu.com/fr/pince-a-cheveux-ecaille-grande-g-601099513851070.html"); const f = await run();
  assert(f.item.price === 1.59 && f.item.photos.length === 2, JSON.stringify(f.item));
  return `fiche ${f.item.title.slice(0, 40)}… ${f.item.price} €`;
});
await step("A5 CAPTCHA détecté → blocked", async () => {
  await page.goto("https://www.vinted.fr/catalog?search_text=captcha"); const r = await run();
  assert(r.blocked && /DataDome/.test(r.blockReason), JSON.stringify(r)); return r.blockReason;
});

/* ---------------- préparation Glacier ---------------- */
let apiKey = null;
await step("Glacier : compte + clé d'API (interface)", async () => {
  await page.goto(GLACIER + "/register"); await page.fill("#email", `chrome${Date.now()}@test.local`); await page.fill("#password", "motdepasse123"); await page.click("button[type=submit]"); await page.waitForURL("**/dashboard");
  await page.goto(GLACIER + "/settings"); await page.click("text=Créer une clé d'API");
  const msg = await page.getByRole("status").filter({ hasText: "glc_" }).textContent({ timeout: 15000 });
  apiKey = msg.match(/glc_[A-Za-z0-9_-]+/)[0]; return apiKey.slice(0, 10) + "…";
});

/* ---------------- B. pont MCP ---------------- */
const bridgeConf = path.join(userDir, "bridge.json");
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "bridge/index.js")], env: { ...process.env, GLACIER_BRIDGE_CONFIG: bridgeConf, GLACIER_URL: GLACIER, GLACIER_API_KEY: apiKey ?? "", GLACIER_BRIDGE_PORT: "8765" }, stderr: "pipe" });
const client = new Client({ name: "test-claude-code", version: "1.0.0" });
await client.connect(transport);
const callJson = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); const t = r.content?.[0]?.text ?? ""; if (r.isError) throw new Error(t); try { return JSON.parse(t); } catch { return t; } };
await step("B0 outils MCP exposés", async () => { const { tools } = await client.listTools(); const names = tools.map((t) => t.name); for (const n of ["get_open_tabs", "open_website", "search_vinted", "search_aliexpress", "search_temu", "extract_product_data", "compare_products", "analyze_market", "verify_product_link", "run_product_research"]) assert(names.includes(n), n); return names.length + " outils"; });
await step("B1 sans extension connectée : l'outil le dit (pas de fausse réponse)", async () => { try { await callJson("get_open_tabs"); throw new Error("aurait dû échouer"); } catch (e) { assert(/pas connectée/.test(e.message), e.message); } });

// Configuration de l'extension (comme dans la fenêtre « Réglages ») et autorisation via la popup.
const token = JSON.parse(fs.readFileSync(bridgeConf, "utf8")).token;
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.evaluate(({ token, glacier, key }) => chrome.storage.local.set({ glacierUrl: glacier, glacierApiKey: key }).then(() => chrome.runtime.sendMessage({ type: "setConfig", patch: { bridgeToken: token } })), { token, glacier: GLACIER, key: apiKey });
await step("B2 refus tant que « Autoriser Claude Code » n'est pas coché", async () => {
  for (let i = 0; i < 20; i++) { try { await callJson("get_open_tabs"); } catch (e) { if (/n'est pas autorisé/.test(e.message)) return "refusé comme prévu"; } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("pas de refus");
});
await popup.reload(); await popup.check("#allowClaude");
await popup.waitForTimeout(500);
await step("B3 popup : état de connexion affiché", async () => { await popup.waitForFunction(() => document.getElementById("bridgeTxt").textContent.includes("connecté")); return await popup.textContent("#bridgeTxt"); });
await popup.screenshot({ path: path.join(OUT, "popup.png") });
await step("B4 get_open_tabs", async () => { const t = await callJson("get_open_tabs"); assert(Array.isArray(t), "liste"); return `${t.length} onglet(s)`; });
await step("B5 search_vinted", async () => { const r = await callJson("search_vinted", { keyword: "pince à cheveux xxl" }); assert(r.items.length === 4 && r.resultCount === 1284, JSON.stringify(r).slice(0, 200)); return `${r.items.length} annonces`; });
await step("B6 analyze_market", async () => { const r = await callJson("analyze_market", { keyword: "pince à cheveux xxl" }); assert(r.statistiques.prix_median === 7.5 && r.statistiques.favoris_visibles === 91, JSON.stringify(r.statistiques)); return `médiane ${r.statistiques.prix_median} €, ${r.statistiques.favoris_visibles} favoris`; });
await step("B7 compare_products classe le bon produit en tête", async () => {
  const r = await callJson("compare_products", { vinted_titles: ["Pince à cheveux XXL écaille marron 13 cm"], candidates: [{ title: "Perceuse visseuse 18V" }, { title: "Grande pince à cheveux écaille 13cm acétate" }] });
  assert(/pince/i.test(r[0].title) && r[0].correspondance_textuelle.score > r[1].correspondance_textuelle.score, JSON.stringify(r)); return `${r[0].correspondance_textuelle.score} vs ${r[1].correspondance_textuelle.score}`;
});
await step("B8 verify_product_link : fiche valide → VERIFIED", async () => { const r = await callJson("verify_product_link", { url: "https://fr.aliexpress.com/item/1005006111111111.html", expected_title: "Grande pince à cheveux écaille" }); assert(r.status === "VERIFIED", JSON.stringify(r)); return r.reason; });
await step("B9 verify_product_link : produit retiré → INVALID", async () => { const r = await callJson("verify_product_link", { url: "https://fr.aliexpress.com/item/1005006333333333.html", expected_title: "Pince noire" }); assert(r.status === "INVALID", JSON.stringify(r)); return r.reason; });
await step("B10 open_website refuse un autre site", async () => { try { await callJson("open_website", { url: "https://example.com" }); throw new Error("accepté"); } catch (e) { assert(/Seules les pages/.test(e.message), e.message); } });
await step("B11 extract_product_data sur l'onglet de travail", async () => { await callJson("open_website", { url: "https://www.temu.com/fr/pince-a-cheveux-ecaille-grande-g-601099513851070.html" }); const tabs = await callJson("get_open_tabs"); const t = tabs.find((x) => /temu/.test(x.url)); const r = await callJson("extract_product_data", { tab_id: t.tabId }); assert(r.item?.price === 1.59, JSON.stringify(r)); return r.item.title.slice(0, 40); });
let researchJob = null;
await step("B12 run_product_research → enregistré dans Glacier", async () => {
  const r = await callJson("run_product_research", { keywords: ["pince à cheveux xxl"], candidates_per_supplier: 2 });
  const k = r[0]; assert(!k.error, k.error); assert(k.glacier?.jobId, JSON.stringify(k.glacier));
  researchJob = k.glacier.jobId;
  const ver = k.fournisseurs.filter((f) => f.lien === "VERIFIED").length;
  return `${k.fournisseurs.length} fournisseur(s), ${ver} lien(s) vérifié(s) dans Chrome, job ${researchJob}`;
});

/* ---------------- C. depuis le tableau de bord ---------------- */
await step("C1 page Recherche Chrome : résultat MCP visible, liens et correspondances", async () => {
  await page.goto(`${GLACIER}/chrome?job=${researchJob}`);
  await page.getByText("Correspondances fournisseurs").waitFor();
  const t = await page.textContent("main");
  assert(/Vérifié/.test(t) && /1[\s ]284/.test(t), "statuts ou total manquants");
  await page.screenshot({ path: path.join(OUT, "glacier-chrome.png"), fullPage: true });
  return "ok";
});
await step("C2 ajout à Product Research → fiche avec lien vérifié par le navigateur", async () => {
  await page.locator("tr", { hasText: "Grande pince à cheveux écaille" }).locator("button", { hasText: "Ajouter à Product Research" }).click();
  await page.waitForURL("**/products/**"); await page.getByText("Vérifié").first().waitFor();
  const t = await page.textContent("main"); assert(/Ouverture dans Chrome/.test(t) || /Vérifié/.test(t), "statut");
  return (t.match(/Hors Top 10 : [^.]+/) || ["éligible"])[0];
});
await step("C3 confirmation + ajout au Top 10 du jour", async () => {
  await page.click('button:has-text("C\'est le bon produit")'); await page.waitForTimeout(1500); await page.reload();
  await page.click('button:has-text("Ajouter au Top 10 du jour")'); await page.getByText("Ajouté au Top 10 du jour").waitFor();
  await page.goto(GLACIER + "/daily"); await page.getByText("#1").waitFor(); return "présent dans le Top 10";
});
await step("C4 recherche mise en file depuis Glacier, exécutée par l'extension (≤ 2 min)", async () => {
  await page.goto(GLACIER + "/chrome"); await page.fill('textarea[name="keywords"]', "pince crabe xxl"); await page.click('button:has-text("Lancer dans Chrome")');
  await page.getByText(/recherche\(s\) en file/).waitFor();
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(5000); await page.reload(); const t = await page.textContent("main"); if (/pince crabe xxl[\s\S]{0,80}Terminée/.test(t)) return `exécutée en ~${(i + 1) * 5} s`; }
  throw new Error("toujours en attente après 200 s");
});

/* ---------------- D. CAPTCHA ---------------- */
await step("D1 run_product_research s'arrête sur CAPTCHA Vinted", async () => { const r = await callJson("run_product_research", { keywords: ["captcha test"], save: false }); assert(r[0].bloque?.[0]?.site === "VINTED" && r.some((x) => x.arret), JSON.stringify(r)); return r[0].bloque[0].reason; });

/* ---------------- E. vrais sites ---------------- */
await ctx.unrouteAll({ behavior: "ignoreErrors" });
for (const [tool, kw] of [["search_aliexpress", "pince cheveux"], ["search_temu", "pince cheveux"], ["search_vinted", "pince cheveux"]]) {
  await step(`E ${tool} (site réel)`, async () => {
    try { const r = await callJson(tool, { keyword: kw, max_items: 10 }); return r.blocked ? `bloqué : ${r.blockReason}` : `${r.pageType}, ${r.items.length} résultat(s) lu(s)${r.items[0] ? ` — ex. ${String(r.items[0].title).slice(0, 40)} ${r.items[0].price ?? "?"} €` : ""}`; }
    catch (e) { return `erreur : ${e.message}`; }
  });
}
const tabs = ctx.pages(); for (const p of tabs) if (/temu|aliexpress|vinted/.test(p.url())) await p.screenshot({ path: path.join(OUT, `real-${new URL(p.url()).hostname}.png`) }).catch(() => {});

console.log(`\n${pass} réussi(s), ${failN} échec(s). Captures : ${OUT}`);
await client.close(); await ctx.close();
process.exit(failN ? 1 : 0);
