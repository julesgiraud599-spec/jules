/**
 * Extracteurs Glacier — s'exécutent DANS la page (chrome.scripting.executeScript, func: extractPage).
 * Règles : on lit uniquement ce qui est affiché / publié dans la page (DOM, JSON-LD, balises meta).
 * Aucune valeur n'est devinée : une donnée absente vaut null.
 * Si la page est un CAPTCHA, une vérification anti-robot ou une page de connexion, on renvoie
 * { blocked: true } et on n'insiste pas.
 *
 * La fonction doit rester autonome (aucune référence extérieure) car Chrome la sérialise.
 */
export function extractPage(opts = {}) {
  const maxItems = opts.maxItems || 40;
  const host = location.hostname;
  const path = location.pathname;
  const site = /(^|\.)vinted\./.test(host) ? "VINTED" : /(^|\.)aliexpress\./.test(host) ? "ALIEXPRESS" : /(^|\.)temu\.com$/.test(host) ? "TEMU" : null;
  const out = { site, url: location.href, pageType: "other", blocked: false, blockReason: null, title: document.title || null, item: null, items: [], resultCount: null, extractedAt: new Date().toISOString() };

  /* ---------------- utilitaires ---------------- */
  const txt = (el) => (el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "");
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
  const parsePrice = (s) => {
    if (!s) return null;
    const m = String(s).replace(/ | /g, " ").match(/(\d{1,5}(?:[ .]\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|EUR)|(?:€|EUR)\s*(\d{1,5}(?:[ .]\d{3})*(?:[.,]\d{1,2})?)/i);
    if (!m) return null;
    let v = (m[1] || m[2]).replace(/ /g, "");
    if (/\.\d{3}$/.test(v) && !v.includes(",")) v = v.replace(/\./g, "");
    v = v.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
  };
  /** Prix + devise (€ ou $). Les prix en $ apparaissent quand le site géolocalise hors de France. */
  const parseMoney = (s) => {
    const t = String(s || "").replace(/\u00a0|\u202f/g, " ");
    const eur = parsePrice(t);
    if (eur !== null) return { price: eur, currency: "EUR" };
    const m = t.match(/(?:US\s*)?\$\s*(\d{1,5}(?:[.,]\d{1,2})?)|(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:US\s*)?\$/);
    if (!m) return { price: null, currency: null };
    const n = Number((m[1] || m[2]).replace(",", "."));
    return Number.isFinite(n) && n > 0 ? { price: n, currency: "USD" } : { price: null, currency: null };
  };
  const intIn = (s) => { const m = String(s || "").replace(/\s/g, "").match(/\d+/); return m ? Number(m[0]) : null; };
  const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") || null;
  const ldProducts = () => {
    const res = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent);
        const walk = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) return o.forEach(walk); const t = o["@type"]; if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) res.push(o); if (o["@graph"]) walk(o["@graph"]); };
        walk(j);
      } catch { /* JSON-LD invalide : ignoré */ }
    }
    return res;
  };
  const ldPrice = (p) => { const o = Array.isArray(p?.offers) ? p.offers[0] : p?.offers; const v = Number(o?.price ?? o?.lowPrice); return Number.isFinite(v) && v > 0 ? { price: v, currency: o?.priceCurrency || null, availability: o?.availability || null } : null; };
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  /** Vinted ajoute « , Marque: …, État: …, 10.90 €, 12.15 € » à l'attribut title : on garde le nom seul. */
  const cleanVintedTitle = (t) => t ? String(t).split("\n")[0].split(/,\s*(?:Marque|Brand|État|Condition|Taille|Size)\s*:/i)[0].replace(/(,\s*\d+[.,]\d{2}\s*€)+\s*$/, "").trim() || null : null;

  /* ---------------- murs anti-robot / connexion ---------------- */
  const body = (document.body?.innerText || "").slice(0, 20000);
  const html = document.documentElement.outerHTML.slice(0, 300000);
  const walls = [
    [/captcha-delivery\.com|geo\.captcha|datadome/i, "Protection anti-robot (DataDome)"],
    [/challenges\.cloudflare\.com|cf-chl-|Just a moment\.\.\./i, "Vérification Cloudflare"],
    [/_____tmd_____\/punish|x5secdata|baxia/i, "Vérification anti-robot AliExpress"],
    [/\/risk\/challenge/i, "Vérification anti-robot"],
    [/verify you are (a )?human|slide to (complete|verify)|faites glisser pour vérifier|vérifiez que vous (êtes|n'êtes pas)/i, "CAPTCHA"],
  ];
  for (const [re, why] of walls) if (re.test(location.href) || re.test(html) || re.test(body)) {
    // On ne bloque que si la page n'affiche pas déjà un produit lisible.
    if (!ldProducts().length || /punish|risk\/challenge/.test(location.href)) { out.blocked = true; out.blockReason = why; return out; }
  }
  if (/\/(signin|login|member\/signup|auth)\b/i.test(path) || (/connecte-toi|connectez-vous pour|sign in to continue/i.test(body) && body.length < 2500)) {
    out.blocked = true; out.blockReason = "Connexion requise : connectez-vous vous-même dans Chrome"; return out;
  }

  /* ---------------- VINTED ---------------- */
  if (site === "VINTED") {
    if (/\/items\/\d+/.test(path)) {
      out.pageType = "item";
      const ld = ldProducts()[0];
      const lp = ldPrice(ld);
      const h1 = txt(document.querySelector("h1"));
      const favEl = [...document.querySelectorAll('[data-testid*="favourite"], [aria-label*="avori"], [aria-label*="avourite"], button')].find((e) => /\d/.test(txt(e) + (e.getAttribute("aria-label") || "")) && /favo|heart|j'aime/i.test((e.getAttribute("data-testid") || "") + (e.getAttribute("aria-label") || "") + e.className));
      const detailRows = {};
      for (const row of document.querySelectorAll('[data-testid*="item-attributes"] > *, [itemprop] , .details-list__item')) {
        const t = txt(row); const m = t.match(/^(Marque|Taille|État|Couleur|Matière|Ajouté|Brand|Size|Condition|Colour|Uploaded)\s*:?\s*(.+)$/i);
        if (m) detailRows[m[1].toLowerCase()] = m[2].slice(0, 80);
      }
      const seller = document.querySelector('a[href*="/member/"]');
      const photos = uniq([...document.querySelectorAll('img[src*="vinted.net"], img[data-testid*="item-photo"]')].map((i) => i.currentSrc || i.src)).filter((u) => !/avatar|50x50/.test(u)).slice(0, 8);
      out.item = {
        id: path.match(/\/items\/(\d+)/)[1],
        url: abs(location.pathname),
        title: ld?.name || h1 || meta("og:title"),
        price: lp?.price ?? parsePrice(txt(document.querySelector('[data-testid*="item-price"], [data-testid*="price"]'))) ?? parsePrice(meta("product:price:amount") ? meta("product:price:amount") + " €" : null),
        currency: lp?.currency || "EUR",
        description: ld?.description || meta("og:description"),
        photos: photos.length ? photos : uniq([meta("og:image"), ...(Array.isArray(ld?.image) ? ld.image : [ld?.image])]).slice(0, 8),
        favorites: favEl ? intIn(txt(favEl) || favEl.getAttribute("aria-label")) : null,
        views: (() => { const m = body.match(/(\d[\d\s]*)\s*(vues|views)\b/i); return m ? intIn(m[1]) : null; })(),
        sold: /\b(Vendu|Sold)\b/.test(txt(document.querySelector('[data-testid*="status"], [data-testid*="item-status"]')) || "") || null,
        brand: ld?.brand?.name || detailRows.marque || detailRows.brand || null,
        size: detailRows.taille || detailRows.size || null,
        condition: detailRows["état"] || detailRows.condition || null,
        seller: seller ? { name: txt(seller).slice(0, 60) || null, url: abs(seller.getAttribute("href")) } : null,
      };
      return out;
    }
    if (/\/(catalog|vetements|search)/.test(path) || /search_text=/.test(location.search)) {
      out.pageType = "search";
      const m = body.match(/(\d[\d\s.]*)\s*(résultats|results|articles)\b/i);
      out.resultCount = m ? intIn(m[1]) : null;
      const seen = new Set();
      for (const a of document.querySelectorAll('a[href*="/items/"]')) {
        const id = (a.getAttribute("href").match(/\/items\/(\d+)/) || [])[1];
        if (!id || seen.has(id)) continue;
        let card = a; for (let i = 0; i < 6 && card.parentElement; i++) { card = card.parentElement; if (parsePrice(txt(card))) break; }
        const ct = txt(card);
        const favNode = card.querySelector('[data-testid*="favourite"], [aria-label*="avori"], [aria-label*="avourite"]');
        const img = card.querySelector("img");
        seen.add(id);
        out.items.push({
          id, url: abs(`/items/${id}`),
          title: cleanVintedTitle(a.getAttribute("title") || img?.getAttribute("alt") || txt(card.querySelector('[data-testid*="description-title"], p, h2, h3'))),
          price: parsePrice(txt(card.querySelector('[data-testid*="price"]')) || ct),
          favorites: favNode ? intIn(txt(favNode) || favNode.getAttribute("aria-label")) : null,
          photo: img ? (img.currentSrc || img.src || null) : null,
          subtitle: txt(card.querySelector('[data-testid*="description-subtitle"]')) || null, // marque / état tels qu'affichés
        });
        if (out.items.length >= maxItems) break;
      }
      return out;
    }
    return out;
  }

  /* ---------------- ALIEXPRESS ---------------- */
  if (site === "ALIEXPRESS") {
    const idm = path.match(/\/(?:item|i)\/(\d{8,})\.html/);
    if (idm) {
      out.pageType = "item";
      const ld = ldProducts()[0]; const lp = ldPrice(ld);
      const priceEl = document.querySelector('[class*="price--current"], [class*="product-price-current"], [class*="price-default--current"], [class*="Price_"]');
      out.item = {
        id: idm[1], url: `https://fr.aliexpress.com/item/${idm[1]}.html`,
        title: ld?.name || txt(document.querySelector("h1")) || meta("og:title"),
        ...(lp ? { price: lp.price, currency: lp.currency || null } : parseMoney(txt(priceEl))),
        photos: uniq([...document.querySelectorAll('img[src*="alicdn.com"], img[src*="aliexpress-media.com"]')].map((i) => i.currentSrc || i.src).filter((u) => /\/kf\/|\/imgextra\//.test(u))).slice(0, 6),
        description: ld?.description || meta("og:description"),
        orders: (() => { const m = body.match(/(\d[\d\s+]*)\s*(vendus|sold|commandes|orders)\b/i); return m ? intIn(m[1]) : null; })(),
        rating: (() => { const m = body.match(/(\d[.,]\d)\s*(?:\/\s*5|★)/); return m ? m[1].replace(",", ".") : null; })(),
        available: lp?.availability ? /InStock/i.test(lp.availability) : (/(plus disponible|no longer available|out of stock|épuisé)/i.test(body) ? false : null),
      };
      return out;
    }
    if (/\/w\/|\/wholesale|SearchText=|\/af\//i.test(location.href)) {
      out.pageType = "search";
      const seen = new Set();
      for (const a of document.querySelectorAll('a[href*="/item/"]')) {
        const id = (a.getAttribute("href").match(/\/item\/(\d{8,})\.html/) || [])[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const card = a.closest('[class*="card"], [class*="list--gallery"] > div, [class*="search-item"]') || a;
        const ct = txt(card);
        const img = card.querySelector("img");
        out.items.push({
          id, url: `https://fr.aliexpress.com/item/${id}.html`,
          title: txt(card.querySelector("h3, h1, [class*='title']")) || a.getAttribute("title") || img?.getAttribute("alt") || null,
          ...(() => { const pm = parseMoney(txt(card.querySelector('[class*="price"]')) || ct); return { price: pm.price, currency: pm.currency }; })(),
          orders: (() => { const m = ct.match(/(\d[\d\s+]*)\s*(vendus|sold)\b/i); return m ? intIn(m[1]) : null; })(),
          photo: img ? (img.currentSrc || img.src || null) : null,
        });
        if (out.items.length >= maxItems) break;
      }
      return out;
    }
    return out;
  }

  /* ---------------- TEMU ---------------- */
  if (site === "TEMU") {
    const idm = path.match(/-g-(\d{9,})\.html$/) || (path === "/goods.html" ? [null, new URLSearchParams(location.search).get("goods_id")] : null);
    if (idm && idm[1]) {
      out.pageType = "item";
      const ld = ldProducts()[0]; const lp = ldPrice(ld);
      const priceEl = document.querySelector('[data-type="price"], [class*="goodsPrice"], [class*="salePrice"], [aria-label*="prix"], [aria-label*="price"]');
      out.item = {
        id: idm[1], url: abs(path),
        title: ld?.name || txt(document.querySelector("h1")) || meta("og:title"),
        ...(lp ? { price: lp.price, currency: lp.currency || null } : parseMoney(txt(priceEl))),
        photos: uniq([...document.querySelectorAll('img[src*="kwcdn.com"]')].map((i) => i.currentSrc || i.src)).slice(0, 6),
        description: ld?.description || meta("og:description"),
        orders: (() => { const m = body.match(/(\d[\d\s,.kK+]*)\s*(vendus|sold)\b/i); return m ? intIn(m[1]) : null; })(),
        available: lp?.availability ? /InStock/i.test(lp.availability) : (/(n.est plus au catalogue|no longer available|épuisé|sold out)/i.test(body) ? false : null),
      };
      return out;
    }
    if (/search_result|\/search/.test(path)) {
      out.pageType = "search";
      const seen = new Set();
      for (const a of document.querySelectorAll('a[href*="-g-"]')) {
        const id = (a.getAttribute("href").match(/-g-(\d{9,})\.html/) || [])[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        let card = a; for (let i = 0; i < 5 && card.parentElement; i++) { card = card.parentElement; if (parsePrice(txt(card))) break; }
        const img = card.querySelector("img");
        const href = abs(a.getAttribute("href").split("?")[0]);
        out.items.push({ id, url: href, title: a.getAttribute("title") || img?.getAttribute("alt") || txt(card.querySelector("h2, h3, [class*='title']")) || null, ...parseMoney(txt(card)), photo: img ? (img.currentSrc || img.src || null) : null });
        if (out.items.length >= maxItems) break;
      }
      return out;
    }
  }
  return out;
}
