const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);
const SITES = [["VINTED", "Vinted", "https://www.vinted.fr/"], ["ALIEXPRESS", "AliExpress", "https://fr.aliexpress.com/"], ["TEMU", "Temu", "https://www.temu.com/fr"]];
const ago = (iso) => { if (!iso) return "jamais"; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`; };
const show = (obj) => { const o = $("out"); o.hidden = false; o.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2); };

async function refresh() {
  const s = await send({ type: "getState" });
  $("dotBridge").className = "dot " + (s.bridgeConnected ? "ok" : s.hasToken ? "bad" : "");
  $("bridgeTxt").textContent = s.bridgeConnected ? `connecté (port ${s.bridgePort})` : s.hasToken ? "non connecté : lancez le pont" : "jeton non renseigné";
  const gOk = s.glacierUrl && s.hasApiKey;
  $("dotGlacier").className = "dot " + (gOk ? (s.glacier.lastError ? "bad" : s.glacier.lastPoll ? "ok" : "warn") : "");
  $("glacierTxt").textContent = !gOk ? "non configuré" : s.glacier.lastError ? `erreur : ${s.glacier.lastError}` : `vérifié ${ago(s.glacier.lastPoll)}`;
  $("allowClaude").checked = s.allowClaude;
  $("busy").hidden = !s.busy;
  $("run").disabled = s.busy;
  const tabs = await chrome.tabs.query({});
  $("sites").innerHTML = "";
  for (const [k, label, url] of SITES) {
    const st = s.siteStatus[k];
    const open = tabs.some((t) => t.url && new URL(t.url).hostname.includes(label.toLowerCase()));
    const li = document.createElement("li");
    const left = document.createElement("span"); left.textContent = `${label}${open ? " · onglet ouvert" : ""}`;
    const right = document.createElement("span"); right.className = "muted";
    right.textContent = !st ? "pas encore testé" : st.ok ? `accessible (${ago(st.at)})` : `bloqué : ${st.reason}`;
    if (st && !st.ok) right.style.color = "var(--warn)";
    li.append(left, right);
    li.title = `Ouvrir ${url} pour vous connecter ou résoudre une vérification vous-même`;
    li.style.cursor = "pointer"; li.onclick = () => chrome.tabs.create({ url });
    $("sites").append(li);
  }
  $("history").innerHTML = "";
  for (const h of s.history.slice(0, 8)) {
    const li = document.createElement("li");
    const a = document.createElement("span"); a.textContent = `« ${h.keyword} » · ${h.origin}`;
    const b = document.createElement("span"); b.className = "muted"; b.textContent = `${h.vinted} Vinted · ${h.suppliers} fourn.${h.blocked?.length ? " · bloqué : " + h.blocked.join(", ") : ""} · ${ago(h.at)}`;
    li.append(a, b); $("history").append(li);
  }
  if (!s.history.length) $("history").innerHTML = '<li class="muted">Aucune recherche.</li>';
}

$("allowClaude").onchange = async (e) => { await send({ type: "setConfig", patch: { allowClaude: e.target.checked } }); refresh(); };
$("run").onclick = async () => {
  const kw = $("kw").value.trim(); if (!kw) return $("kw").focus();
  show("Recherche en cours : Vinted, puis AliExpress et Temu. Les pages s'ouvrent dans un onglet en arrière-plan, au rythme d'une page toutes les quelques secondes…");
  $("run").disabled = true;
  const r = await send({ type: "runSearch", keyword: kw });
  if (r.error) show(`Erreur : ${r.error}\n${(r.log || []).join("\n")}`);
  else show(`${r.log.join("\n")}\n\nVinted : ${r.result.vinted?.items.length ?? 0} annonce(s) · fournisseurs vérifiés : ${r.result.suppliers.filter((x) => x.link.status === "VERIFIED").length}/${r.result.suppliers.length}${r.result.blocked.length ? "\nBloqué : " + r.result.blocked.map((b) => `${b.site} (${b.reason})`).join(", ") : ""}\n${r.sent ? (r.sent.error ? "Glacier : " + r.sent.error : "Envoyé à Glacier.") : "Glacier non configuré : résultat non envoyé."}`);
  refresh();
};
$("analyze").onclick = async () => {
  const r = await send({ type: "analyzePage", send: $("sendPage").checked });
  if (r.error) return show(r.error);
  const p = r.result;
  show(p.blocked ? `Page bloquée : ${p.blockReason}. Résolvez la vérification vous-même puis réessayez.` : `${p.site} · ${p.pageType === "item" ? "fiche produit" : p.pageType === "search" ? `recherche (${p.items.length} résultats lus${p.resultCount ? ` sur ${p.resultCount}` : ""})` : "page non reconnue"}\n${p.item ? JSON.stringify(p.item, null, 2) : p.items.slice(0, 5).map((i) => `• ${i.title} — ${i.price ?? "?"} €${i.favorites != null ? ` — ${i.favorites} ♥` : ""}`).join("\n")}${r.sent ? "\n\n" + (r.sent.error ? "Glacier : " + r.sent.error : "Envoyé à Glacier.") : ""}`);
};
$("save").onclick = async () => {
  const patch = { bridgeToken: $("bridgeToken").value.trim() || undefined, bridgePort: Number($("bridgePort").value) || 8765, glacierUrl: $("glacierUrl").value.trim().replace(/\/$/, ""), glacierApiKey: $("glacierApiKey").value.trim() || undefined };
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  if (patch.glacierUrl) {
    try {
      const origin = new URL(patch.glacierUrl).origin + "/*";
      await chrome.permissions.request({ origins: [origin] }).catch(() => false); // facultatif : Glacier accepte aussi les appels CORS de l'extension
    } catch { return show("Adresse de Glacier invalide."); }
  }
  await send({ type: "setConfig", patch });
  show("Réglages enregistrés."); refresh();
};
$("test").onclick = async () => { const r = await send({ type: "testGlacier" }); show(r.ok ? "Glacier répond : clé d'API valide." : `Glacier : ${r.error}`); refresh(); };
(async () => { const c = await chrome.storage.local.get(["glacierUrl", "bridgePort"]); $("glacierUrl").value = c.glacierUrl || ""; $("bridgePort").value = c.bridgePort || 8765; refresh(); setInterval(refresh, 3000); })();
