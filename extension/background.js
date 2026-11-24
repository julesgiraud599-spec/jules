/**
 * Glacier — service worker de l'extension (Manifest V3).
 *
 *  - Pilote UN onglet de travail (en arrière-plan) sur Vinted, AliExpress et Temu, à rythme humain.
 *  - Lit uniquement le contenu visible des pages (extractors.js). S'arrête net sur CAPTCHA / connexion.
 *  - Se connecte au pont MCP local (Claude Code) par WebSocket sur 127.0.0.1, avec un jeton.
 *  - Exécute les recherches mises en file par Glacier (tableau de bord / tâche quotidienne)
 *    quand Chrome est ouvert, et renvoie les résultats à Glacier avec une clé d'API.
 *  - N'envoie JAMAIS de cookies, mots de passe ou jetons de session : seules les données produit
 *    extraites sont transmises.
 */
import { extractPage } from "./extractors.js";
import { isAllowedUrl, searchUrl } from "./sites.js";
import { textMatch, titleSimilarity, marketStats } from "./match.js";

const DEFAULTS = { bridgePort: 8765, bridgeToken: "", allowClaude: false, glacierUrl: "", glacierApiKey: "", history: [], siteStatus: {} };
const MIN_GAP_MS = 3500;         // délai minimum entre deux chargements de page
const MAX_NAV_PER_HOUR = 80;     // plafond de pages chargées par heure
const SETTLE_MS = 2500;          // laisse le temps aux pages JavaScript de s'afficher

const state = { ws: null, bridgeConnected: false, workerTabId: null, lastNav: 0, navLog: [], busy: false, glacier: { lastPoll: null, lastError: null, lastJob: null } };

async function cfg() { return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) }; }
async function setCfg(patch) { await chrome.storage.local.set(patch); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ navigateur ============================ */

async function rateLimit() {
  const now = Date.now();
  state.navLog = state.navLog.filter((t) => now - t < 3_600_000);
  if (state.navLog.length >= MAX_NAV_PER_HOUR) throw new Error(`Limite de ${MAX_NAV_PER_HOUR} pages par heure atteinte : réessayez plus tard.`);
  const wait = state.lastNav + MIN_GAP_MS + Math.random() * 1500 - now;
  if (wait > 0) await sleep(wait);
  state.lastNav = Date.now(); state.navLog.push(state.lastNav);
}

function waitComplete(tabId, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); reject(new Error("La page a mis trop de temps à charger")); }, timeout);
    const fn = (id, info) => { if (id === tabId && info.status === "complete") { clearTimeout(t); chrome.tabs.onUpdated.removeListener(fn); resolve(); } };
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function workerTab() {
  if (state.workerTabId !== null) { try { await chrome.tabs.get(state.workerTabId); return state.workerTabId; } catch { state.workerTabId = null; } }
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  state.workerTabId = tab.id;
  return tab.id;
}

async function navigate(url, { tabId = null } = {}) {
  if (!isAllowedUrl(url)) throw new Error("Adresse non autorisée (Vinted, AliExpress et Temu uniquement, en https).");
  await rateLimit();
  const id = tabId ?? (await workerTab());
  const done = waitComplete(id);
  await chrome.tabs.update(id, { url });
  await done;
  await sleep(SETTLE_MS);
  return id;
}

async function extract(tabId, opts = {}) {
  let out;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: extractPage, args: [opts] });
    out = res?.result;
  } catch (e) {
    // Page d'erreur de Chrome (site injoignable, réseau bloqué…) : on le dit, sans inventer de résultat.
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const host = (() => { try { return new URL(tab?.pendingUrl || tab?.url || "").hostname; } catch { return ""; } })();
    const site = /vinted/.test(host) ? "VINTED" : /aliexpress/.test(host) ? "ALIEXPRESS" : /temu/.test(host) ? "TEMU" : null;
    out = { site, url: tab?.url ?? null, pageType: "other", blocked: true, blockReason: /error page/i.test(String(e.message)) ? "Page inaccessible (erreur réseau ou site injoignable)" : `Lecture impossible : ${e.message}`, item: null, items: [], resultCount: null };
  }
  if (out?.site) {
    const st = (await cfg()).siteStatus;
    st[out.site] = { at: new Date().toISOString(), ok: !out.blocked, reason: out.blockReason };
    await setCfg({ siteStatus: st });
  }
  return out;
}

/** Fait défiler pour charger les vignettes paresseuses, puis relit. */
async function extractWithScroll(tabId, opts) {
  let r = await extract(tabId, opts);
  if (r && !r.blocked && r.pageType === "search" && r.items.length < 10) {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => window.scrollBy(0, 2500) });
    await sleep(2000);
    r = await extract(tabId, opts);
  }
  return r;
}

async function search(site, keyword, maxItems = 30) {
  const id = await navigate(searchUrl(site, keyword));
  return extractWithScroll(id, { maxItems });
}

async function openAndExtract(url) {
  const id = await navigate(url);
  return extract(id, {});
}

/** Ouvre la fiche, vérifie qu'elle existe, qu'elle n'a pas redirigé ailleurs et que le titre correspond. */
async function verifyLink(url, expectedTitle) {
  const r = await openAndExtract(url);
  const tab = await chrome.tabs.get(state.workerTabId);
  const finalUrl = tab.url;
  if (r.blocked) return { url, finalUrl, status: "MANUAL", reason: `${r.blockReason} : ouvrez le lien vous-même pour confirmer`, item: null };
  if (r.pageType !== "item" || !r.item) return { url, finalUrl, status: "INVALID", reason: "La page ouverte n'est pas une fiche produit (accueil, recherche ou erreur)", item: null };
  const sameId = String(url).includes(r.item.id);
  if (!sameId) return { url, finalUrl, status: "INVALID", reason: "Le lien redirige vers un autre produit", item: r.item };
  if (r.item.available === false) return { url, finalUrl, status: "INVALID", reason: "Produit indisponible", item: r.item };
  if (!r.item.title) return { url, finalUrl, status: "MANUAL", reason: "Titre illisible sur la page", item: r.item };
  const sim = expectedTitle ? titleSimilarity(expectedTitle, r.item.title) : 1;
  if (sim < 0.3) return { url, finalUrl, status: "MANUAL", reason: `Titre de la page différent du titre attendu (${Math.round(sim * 100)} %)`, item: r.item };
  return { url, finalUrl, status: "VERIFIED", reason: "Fiche ouverte dans Chrome, produit et titre concordants", item: r.item };
}

/* ============================ recherche complète ============================ */

/**
 * Recherche d'un mot-clé : Vinted d'abord (demande), puis AliExpress et Temu (même produit).
 * Renvoie uniquement des données lues dans les pages, avec la raison de chaque blocage.
 */
async function pipeline(keyword, { candidates = 3, log = () => {} } = {}) {
  const result = { keyword, startedAt: new Date().toISOString(), vinted: null, vintedDetails: [], stats: null, suppliers: [], blocked: [] };
  log(`Vinted : recherche « ${keyword} »`);
  const v = await search("VINTED", keyword, 40);
  if (v.blocked) { result.blocked.push({ site: "VINTED", reason: v.blockReason }); log(`Vinted bloqué : ${v.blockReason}`); return result; }
  result.vinted = v;
  // Si les favoris ne sont pas visibles sur la recherche, on ouvre les 3 premières annonces.
  if (!v.items.some((i) => typeof i.favorites === "number")) {
    for (const it of v.items.slice(0, 3)) {
      const d = await openAndExtract(it.url);
      if (d.blocked) { result.blocked.push({ site: "VINTED", reason: d.blockReason }); break; }
      if (d.item) { result.vintedDetails.push(d.item); it.favorites = d.item.favorites; it.photo = it.photo || d.item.photos?.[0] || null; }
    }
  }
  result.stats = marketStats(v);
  const ref = [...v.items].sort((a, b) => (b.favorites ?? -1) - (a.favorites ?? -1)).slice(0, 5);
  const refTitles = ref.map((i) => i.title).filter(Boolean);
  log(`Vinted : ${v.items.length} annonce(s) lue(s), ${result.stats.annonces_avec_favoris} avec favoris visibles`);

  for (const site of ["ALIEXPRESS", "TEMU"]) {
    log(`${site} : recherche`);
    const s = await search(site, keyword, 30);
    if (s.blocked) { result.blocked.push({ site, reason: s.blockReason }); log(`${site} bloqué : ${s.blockReason}`); continue; }
    const ranked = s.items.filter((i) => i.title).map((i) => ({ ...i, site, text: textMatch(refTitles, i.title) })).sort((a, b) => b.text.score - a.text.score).slice(0, candidates);
    for (const c of ranked) {
      log(`${site} : vérification de ${c.url}`);
      const ver = await verifyLink(c.url, c.title);
      result.suppliers.push({ ...c, price: ver.item?.price ?? c.price, photos: ver.item?.photos?.length ? ver.item.photos : [c.photo].filter(Boolean), detailTitle: ver.item?.title ?? null, orders: ver.item?.orders ?? c.orders ?? null, available: ver.item?.available ?? null, link: { status: ver.status, reason: ver.reason, finalUrl: ver.finalUrl } });
      if (ver.status === "MANUAL" && /anti-robot|CAPTCHA|Cloudflare|DataDome/.test(ver.reason)) { result.blocked.push({ site, reason: ver.reason }); break; }
    }
  }
  result.finishedAt = new Date().toISOString();
  return result;
}

async function addHistory(entry) {
  const { history } = await cfg();
  await setCfg({ history: [entry, ...history].slice(0, 30) });
}

/* ============================ Glacier ============================ */

async function glacierFetch(path, init = {}) {
  const { glacierUrl, glacierApiKey } = await cfg();
  if (!glacierUrl || !glacierApiKey) throw new Error("Glacier n'est pas configuré dans l'extension");
  const res = await fetch(glacierUrl.replace(/\/$/, "") + path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${glacierApiKey}`, ...(init.headers || {}) }, credentials: "omit" });
  if (!res.ok) throw new Error(`Glacier a répondu ${res.status} : ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function sendToGlacier(payload) { return glacierFetch("/api/chrome/ingest", { method: "POST", body: JSON.stringify(payload) }); }

async function pollGlacier() {
  const { glacierUrl, glacierApiKey } = await cfg();
  if (!glacierUrl || !glacierApiKey || state.busy) return;
  try {
    const { job } = await glacierFetch("/api/chrome/jobs/next");
    state.glacier.lastPoll = new Date().toISOString(); state.glacier.lastError = null;
    if (!job) return;
    state.busy = true; state.glacier.lastJob = job.keyword;
    const lines = [];
    try {
      const result = await pipeline(job.keyword, { log: (s) => lines.push(s) });
      await sendToGlacier({ jobId: job.id, source: "JOB", log: lines, result });
      await addHistory({ at: new Date().toISOString(), keyword: job.keyword, origin: "Glacier", vinted: result.vinted?.items.length ?? 0, suppliers: result.suppliers.length, blocked: result.blocked.map((b) => b.site) });
    } catch (e) {
      await glacierFetch(`/api/chrome/jobs/${job.id}`, { method: "POST", body: JSON.stringify({ status: "ERROR", error: String(e.message || e), log: lines }) }).catch(() => {});
    } finally { state.busy = false; }
  } catch (e) { state.glacier.lastError = String(e.message || e); }
}

/* ============================ pont Claude Code (MCP) ============================ */

async function connectBridge() {
  const { bridgePort, bridgeToken } = await cfg();
  if (!bridgeToken || (state.ws && state.ws.readyState <= 1)) return;
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${bridgePort}/?token=${encodeURIComponent(bridgeToken)}&client=extension`);
    state.ws = ws;
    ws.onopen = () => { state.bridgeConnected = true; };
    ws.onclose = () => { state.bridgeConnected = false; state.ws = null; };
    ws.onerror = () => { state.bridgeConnected = false; };
    ws.onmessage = async (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
      const reply = (ok, payload) => ws.send(JSON.stringify({ id: msg.id, ok, ...(ok ? { result: payload } : { error: payload }) }));
      try { reply(true, await handleCommand(msg.cmd, msg.args || {})); }
      catch (e) { reply(false, String(e.message || e)); }
    };
  } catch { state.bridgeConnected = false; }
}

async function handleCommand(cmd, a) {
  const { allowClaude } = await cfg();
  if (!allowClaude && cmd !== "status") throw new Error("Claude Code n'est pas autorisé à piloter Chrome : activez « Autoriser Claude Code » dans l'extension Glacier.");
  switch (cmd) {
    case "status": return { connected: true, allowClaude, busy: state.busy };
    case "tabs": return (await chrome.tabs.query({})).filter((t) => t.url && /^https:/.test(t.url)).map((t) => ({ tabId: t.id, title: t.title, url: t.url, site: isAllowedUrl(t.url) ? new URL(t.url).hostname : null, active: t.active }));
    case "open": { const id = await navigate(a.url, { tabId: a.newTab ? (await chrome.tabs.create({ url: "about:blank", active: false })).id : null }); const t = await chrome.tabs.get(id); return { tabId: id, url: t.url, title: t.title }; }
    case "search": return search(a.site, a.keyword, a.maxItems || 30);
    case "extract": {
      const tabId = a.tabId ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (tabId === undefined) throw new Error("Aucun onglet actif");
      const t = await chrome.tabs.get(tabId);
      if (!isAllowedUrl(t.url)) throw new Error("Cet onglet n'est ni Vinted, ni AliExpress, ni Temu.");
      return extract(tabId, { maxItems: a.maxItems || 40 });
    }
    case "verify": return verifyLink(a.url, a.expectedTitle || null);
    case "pipeline": {
      for (let i = 0; state.busy && i < 600; i++) await sleep(1000); // attend la fin d'une recherche Glacier en cours
      if (state.busy) throw new Error("Une recherche est déjà en cours depuis plus de 10 minutes");
      state.busy = true;
      try {
        const lines = []; const r = await pipeline(a.keyword, { candidates: a.candidates || 3, log: (s) => lines.push(s) });
        await addHistory({ at: new Date().toISOString(), keyword: a.keyword, origin: "Claude Code", vinted: r.vinted?.items.length ?? 0, suppliers: r.suppliers.length, blocked: r.blocked.map((b) => b.site) });
        return { ...r, log: lines };
      } finally { state.busy = false; }
    }
    default: throw new Error("Commande inconnue : " + cmd);
  }
}

/* ============================ popup ============================ */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const c = await cfg();
    switch (msg.type) {
      case "getState": return { bridgeConnected: state.bridgeConnected, bridgePort: c.bridgePort, hasToken: Boolean(c.bridgeToken), allowClaude: c.allowClaude, glacierUrl: c.glacierUrl, hasApiKey: Boolean(c.glacierApiKey), glacier: state.glacier, busy: state.busy, history: c.history, siteStatus: c.siteStatus };
      case "setConfig": { await setCfg(msg.patch); if ("bridgeToken" in msg.patch || "bridgePort" in msg.patch) { try { state.ws?.close(); } catch {} state.ws = null; await connectBridge(); } return { ok: true }; }
      case "analyzePage": {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab || !isAllowedUrl(tab.url)) return { error: "Ouvrez une page Vinted, AliExpress ou Temu, puis réessayez." };
        const r = await extract(tab.id, { maxItems: 40 });
        let sent = null;
        if (msg.send && !r.blocked) { try { sent = await sendToGlacier({ source: "PAGE", page: r }); } catch (e) { sent = { error: String(e.message || e) }; } }
        return { result: r, sent };
      }
      case "runSearch": {
        if (state.busy) return { error: "Une recherche est déjà en cours" };
        state.busy = true;
        const lines = [];
        try {
          const r = await pipeline(msg.keyword, { log: (s) => lines.push(s) });
          let sent = null;
          if (c.glacierUrl && c.glacierApiKey) { try { sent = await sendToGlacier({ source: "POPUP", log: lines, result: r }); } catch (e) { sent = { error: String(e.message || e) }; } }
          await addHistory({ at: new Date().toISOString(), keyword: msg.keyword, origin: "Extension", vinted: r.vinted?.items.length ?? 0, suppliers: r.suppliers.length, blocked: r.blocked.map((b) => b.site) });
          return { result: r, log: lines, sent };
        } catch (e) { return { error: String(e.message || e), log: lines }; }
        finally { state.busy = false; }
      }
      case "testGlacier": { try { await glacierFetch("/api/chrome/ping"); return { ok: true }; } catch (e) { return { error: String(e.message || e) }; } }
      default: return { error: "Message inconnu" };
    }
  })().then(sendResponse);
  return true;
});

/* ============================ démarrage ============================ */

chrome.alarms.create("tick", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "tick") { connectBridge(); pollGlacier(); } });
chrome.runtime.onStartup.addListener(() => { connectBridge(); pollGlacier(); });
chrome.runtime.onInstalled.addListener(() => { connectBridge(); });
connectBridge();
