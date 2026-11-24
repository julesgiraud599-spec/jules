#!/usr/bin/env node
/**
 * Pont MCP local Glacier.
 *
 *   Claude Code ──stdio (MCP)──► ce serveur ──WebSocket 127.0.0.1──► extension Chrome Glacier
 *                                     └──HTTPS (clé d'API)──► Glacier (enregistrement des résultats)
 *
 * - Écoute UNIQUEMENT sur 127.0.0.1 ; l'extension doit présenter le jeton secret.
 * - Ne voit jamais vos cookies ni mots de passe : l'extension ne lui envoie que les données lues dans les pages.
 * - Si l'extension n'est pas connectée, les outils le disent ; aucune donnée n'est inventée.
 *
 * Commandes :
 *   node index.js          → démarre le serveur MCP (lancé par Claude Code)
 *   node index.js token    → affiche (et crée au besoin) le jeton à coller dans l'extension
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer } from "ws";
import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { textMatch, marketStats } from "../extension/match.js";
import { isAllowedUrl } from "../extension/sites.js";

const CONF = process.env.GLACIER_BRIDGE_CONFIG || path.join(os.homedir(), ".glacier-bridge.json");
function loadConf() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONF, "utf8")); } catch { /* premier lancement */ }
  if (!c.token) { c.token = crypto.randomBytes(24).toString("base64url"); fs.writeFileSync(CONF, JSON.stringify(c, null, 2), { mode: 0o600 }); }
  return c;
}
const conf = loadConf();
if (process.argv[2] === "token") { console.log(conf.token); process.exit(0); }

const PORT = Number(process.env.GLACIER_BRIDGE_PORT || conf.port || 8765);
const GLACIER_URL = (process.env.GLACIER_URL || conf.glacierUrl || "").replace(/\/$/, "");
const GLACIER_API_KEY = process.env.GLACIER_API_KEY || conf.glacierApiKey || "";
const log = (...a) => console.error("[glacier-bridge]", ...a); // stdout est réservé au protocole MCP

/* ------------------------- liaison avec l'extension ------------------------- */
let ext = null;
const pending = new Map();
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT, verifyClient: ({ req }) => {
  const u = new URL(req.url, "http://x");
  const ok = u.searchParams.get("token") && crypto.timingSafeEqual(Buffer.from(u.searchParams.get("token").padEnd(64)), Buffer.from(conf.token.padEnd(64)));
  if (!ok) log("Connexion refusée : jeton invalide");
  return Boolean(ok);
} });
wss.on("listening", () => log(`En attente de l'extension sur ws://127.0.0.1:${PORT}`));
wss.on("error", (e) => log(e.code === "EADDRINUSE" ? `Le port ${PORT} est déjà utilisé (un autre pont Glacier tourne-t-il encore ?). Fermez-le ou changez GLACIER_BRIDGE_PORT.` : `WebSocket : ${e.message}`));
wss.on("connection", (ws) => {
  ext = ws; log("Extension Chrome connectée");
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id); clearTimeout(p.t);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
  });
  ws.on("close", () => { if (ext === ws) ext = null; log("Extension déconnectée"); });
});
setInterval(() => { try { ext?.send(JSON.stringify({ type: "ping" })); } catch { /* */ } }, 20_000);

function call(cmd, args = {}, timeoutMs = 120_000) {
  if (!ext || ext.readyState !== 1) return Promise.reject(new Error("L'extension Chrome Glacier n'est pas connectée. Ouvrez Chrome, vérifiez que l'extension est installée, que le jeton est renseigné et que « Autoriser Claude Code » est coché."));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`Délai dépassé pour « ${cmd} »`)); }, timeoutMs);
    pending.set(id, { resolve, reject, t });
    ext.send(JSON.stringify({ id, cmd, args }));
  });
}

async function glacier(pathname, body) {
  if (!GLACIER_URL || !GLACIER_API_KEY) throw new Error("Glacier n'est pas configuré pour le pont (GLACIER_URL et GLACIER_API_KEY).");
  const res = await fetch(GLACIER_URL + pathname, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${GLACIER_API_KEY}` }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Glacier ${res.status} : ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/* ------------------------------- outils MCP ------------------------------- */
const server = new McpServer({ name: "glacier-chrome", version: "1.0.0" });
const ok = (data) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message || e) }] });
const tool = (name, description, inputSchema, fn) => server.registerTool(name, { description, inputSchema }, async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } });

tool("connection_status", "État de la liaison : extension Chrome connectée ? Glacier configuré ?", {}, async () => {
  let extStatus = null;
  try { extStatus = await call("status", {}, 5000); } catch (e) { extStatus = { connected: false, error: e.message }; }
  return { extension: extStatus, glacier: GLACIER_URL ? { url: GLACIER_URL, cle_api: Boolean(GLACIER_API_KEY) } : "non configuré" };
});

tool("get_open_tabs", "Liste les onglets https ouverts dans Chrome (titre, URL, site reconnu).", {}, () => call("tabs"));

tool("open_website", "Ouvre une page Vinted, AliExpress ou Temu (https uniquement) dans l'onglet de travail de Glacier. Les autres sites sont refusés.",
  { url: z.string().url(), new_tab: z.boolean().optional() },
  async ({ url, new_tab }) => { if (!isAllowedUrl(url)) throw new Error("Seules les pages https de Vinted, AliExpress et Temu peuvent être ouvertes."); return call("open", { url, newTab: Boolean(new_tab) }); });

for (const [name, site] of [["search_vinted", "VINTED"], ["search_aliexpress", "ALIEXPRESS"], ["search_temu", "TEMU"]]) {
  tool(name, `Recherche « keyword » sur ${site === "VINTED" ? "Vinted" : site === "ALIEXPRESS" ? "AliExpress" : "Temu"} dans Chrome et renvoie les résultats visibles (titre, prix, URL, photo${site === "VINTED" ? ", favoris si affichés, nombre total d'annonces" : ""}). Renvoie blocked=true si le site affiche un CAPTCHA ou demande une connexion : dans ce cas, demandez à l'utilisateur d'intervenir lui-même.`,
    { keyword: z.string().min(2), max_items: z.number().int().min(1).max(60).optional() },
    ({ keyword, max_items }) => call("search", { site, keyword, maxItems: max_items ?? 30 }));
}

tool("extract_product_data", "Lit la page d'un onglet (par défaut l'onglet actif) : fiche produit ou page de recherche Vinted / AliExpress / Temu. Données visibles uniquement.",
  { tab_id: z.number().int().optional() }, ({ tab_id }) => call("extract", { tabId: tab_id }));

tool("verify_product_link", "Ouvre une fiche produit dans Chrome et vérifie qu'elle existe, qu'elle ne redirige pas ailleurs, que le produit est disponible et que le titre correspond. Statut : VERIFIED, MANUAL (vérification impossible, ex. CAPTCHA) ou INVALID.",
  { url: z.string().url(), expected_title: z.string().optional() }, ({ url, expected_title }) => call("verify", { url, expectedTitle: expected_title }));

tool("compare_products", "Compare une annonce Vinted à des produits fournisseurs (titre, couleurs, dimensions) et les classe. C'est un classement textuel : il ne prouve pas que c'est le même produit — regardez les photos (URL fournies) ou utilisez verify_product_link.",
  { vinted_titles: z.array(z.string()).min(1), candidates: z.array(z.object({ title: z.string(), url: z.string().optional(), price: z.number().nullable().optional(), photo: z.string().nullable().optional() })).min(1) },
  ({ vinted_titles, candidates }) => candidates.map((c) => ({ ...c, correspondance_textuelle: textMatch(vinted_titles, c.title) })).sort((a, b) => b.correspondance_textuelle.score - a.correspondance_textuelle.score));

tool("analyze_market", "Recherche un mot-clé sur Vinted et calcule les statistiques observées : nombre d'annonces, prix médian/min/max, favoris visibles. Les favoris ne sont pas des ventes.",
  { keyword: z.string().min(2) },
  async ({ keyword }) => {
    const r = await call("search", { site: "VINTED", keyword, maxItems: 40 });
    if (r.blocked) return { blocked: true, reason: r.blockReason };
    const top = [...r.items].sort((a, b) => (b.favorites ?? -1) - (a.favorites ?? -1)).slice(0, 8);
    return { keyword, statistiques: marketStats(r), annonces_les_plus_suivies: top };
  });

tool("run_product_research", "Recherche complète pour une liste de mots-clés : Vinted (demande) → AliExpress et Temu (même produit) → vérification des liens dans Chrome → envoi à Glacier (si save=true). Une page toutes les quelques secondes ; s'arrête sur CAPTCHA. Pour « trouve-moi les 10 meilleurs produits », passez 5 à 10 mots-clés de produits sans marque puis lisez le classement renvoyé par Glacier.",
  { keywords: z.array(z.string().min(2)).min(1).max(15), candidates_per_supplier: z.number().int().min(1).max(5).optional(), save: z.boolean().optional() },
  async ({ keywords, candidates_per_supplier, save }) => {
    const out = [];
    for (const kw of keywords) {
      let r;
      try { r = await call("pipeline", { keyword: kw, candidates: candidates_per_supplier ?? 3 }, 15 * 60_000); }
      catch (e) { out.push({ keyword: kw, error: e.message }); continue; }
      let saved = null;
      if (save !== false && GLACIER_URL) { try { saved = await glacier("/api/chrome/ingest", { source: "MCP", log: r.log, result: r }); } catch (e) { saved = { error: e.message }; } }
      out.push({
        keyword: kw,
        statistiques_vinted: r.stats,
        fournisseurs: r.suppliers.map((s) => ({ site: s.site, titre: s.detailTitle || s.title, prix: s.price, url: s.url, lien: s.link.status, raison: s.link.reason, correspondance_textuelle: s.text.score, photo: s.photos?.[0] ?? null })),
        bloque: r.blocked,
        glacier: saved,
      });
      if (r.blocked.some((b) => b.site === "VINTED")) { out.push({ arret: "Vinted demande une vérification : résolvez-la dans Chrome puis relancez." }); break; }
    }
    return out;
  });

tool("save_to_glacier", "Envoie un résultat (sortie de run_product_research/extension) à Glacier.", { payload: z.record(z.any()) }, ({ payload }) => glacier("/api/chrome/ingest", payload));

tool("glacier_top_products", "Lit dans Glacier les meilleurs produits détectés par la recherche Chrome (classés par score).", { limit: z.number().int().min(1).max(30).optional() },
  ({ limit }) => glacier(`/api/chrome/top?limit=${limit ?? 10}`));

await server.connect(new StdioServerTransport());
// Claude Code ferme l'entrée standard quand il arrête le serveur : on libère le port aussitôt.
process.stdin.on("end", () => { wss.close(); process.exit(0); });
process.stdin.on("close", () => { wss.close(); process.exit(0); });
log("Serveur MCP prêt (stdio)");
