/*
 * Booru Favorites Highlighter - content script
 * Runs on Gelbooru, Danbooru and Rule34 list/search pages.
 * Reads the post id off every thumbnail, checks it against the set of
 * ids you've already favorited + downloaded (scanned from your G: archive),
 * and highlights / hides / removes the matches.
 */
(() => {
  "use strict";

  // ---- Which site are we on? -------------------------------------------
  const host = location.hostname;
  let SITE = null;
  if (/(^|\.)gelbooru\.com$/.test(host)) SITE = "gelbooru";
  else if (/donmai\.us$/.test(host)) SITE = "danbooru";
  else if (/rule34\.xxx$/.test(host)) SITE = "rule34";
  if (!SITE) return;

  const CLS = {
    fav: "bfh-fav",
    highlight: "bfh-mode-highlight",
    hide: "bfh-mode-hide",
    remove: "bfh-mode-remove",
    reveal: "bfh-reveal",
    badge: "bfh-badge-el",
  };

  let favSet = new Set(); // ids (as normalized strings) for THIS site
  let settings = {
    mode: "highlight",
    color: "#ffd400",
    tint: true,
    showBadge: true,
    revealOnHover: true,
    perSite: { gelbooru: true, danbooru: true, rule34: true },
  };
  let dataReady = false;

  const norm = (v) => {
    if (v == null) return null;
    const s = String(v).trim().replace(/^0+(?=\d)/, ""); // strip leading zeros
    return /^\d+$/.test(s) ? s : null;
  };

  // ---- Collect thumbnail items on the page -----------------------------
  // Returns [{ el (element to style), id (string) }]
  function collectItems() {
    const items = [];
    const seen = new Set();

    if (SITE === "danbooru") {
      // Danbooru: <article class="post-preview" data-id="123" id="post_123">
      document
        .querySelectorAll("article[data-id], article[id^='post_']")
        .forEach((el) => {
          let id = el.getAttribute("data-id");
          if (!id) {
            const m = (el.id || "").match(/post_(\d+)/);
            if (m) id = m[1];
          }
          id = norm(id);
          if (id && !seen.has(el)) {
            seen.add(el);
            items.push({ el, id });
          }
        });
      // Fallback: anchors to /posts/NNN that contain an image.
      if (items.length === 0) {
        document.querySelectorAll('a[href*="/posts/"]').forEach((a) => {
          if (!a.querySelector("img,video,canvas")) return;
          const m = a.getAttribute("href").match(/\/posts\/(\d+)/);
          const id = m && norm(m[1]);
          const el = a.closest("article,.post-preview,li,span") || a;
          if (id && !seen.has(el)) {
            seen.add(el);
            items.push({ el, id });
          }
        });
      }
      return items;
    }

    // Gelbooru & Rule34: anchors like index.php?page=post&s=view&id=NNN
    const anchors = document.querySelectorAll(
      'a[href*="s=view"], a[href*="s%3Dview"]'
    );
    anchors.forEach((a) => {
      // Must be an actual thumbnail (contains an image/video), so we skip
      // navigation / sidebar "view" links.
      if (!a.querySelector("img,video,canvas")) return;
      const href = a.getAttribute("href") || "";
      const m = href.match(/[?&](?:amp;)?id=(\d+)/);
      const id = m && norm(m[1]);
      if (!id) return;
      const el =
        a.closest(
          "article.thumbnail-preview, .thumbnail-preview, span.thumb, .thumb, li"
        ) || a.parentElement || a;
      if (!seen.has(el)) {
        seen.add(el);
        items.push({ el, id, anchor: a });
      }
    });
    return items;
  }

  // ---- Apply the current mode to every item ----------------------------
  let lastCounts = { total: 0, matched: 0 };

  function clearAll() {
    document
      .querySelectorAll("." + CLS.fav)
      .forEach((el) => {
        el.classList.remove(
          CLS.fav,
          CLS.highlight,
          CLS.hide,
          CLS.remove,
          CLS.reveal
        );
        el.removeAttribute("data-bfh-label");
      });
  }

  function apply() {
    if (!dataReady) return;
    const enabled = settings.perSite && settings.perSite[SITE] !== false;

    // Push the highlight color as a CSS variable on <html>.
    document.documentElement.style.setProperty("--bfh-color", settings.color);
    document.documentElement.style.setProperty(
      "--bfh-tint",
      settings.tint ? hexToRgba(settings.color, 0.16) : "transparent"
    );

    const items = collectItems();
    let matched = 0;

    for (const { el } of items) {
      // Reset this element's classes first (mode may have changed).
      el.classList.remove(
        CLS.fav,
        CLS.highlight,
        CLS.hide,
        CLS.remove,
        CLS.reveal
      );
    }

    for (const { el, id } of items) {
      const isFav = favSet.has(id);
      el.setAttribute("data-bfh-id", id);
      if (!isFav || !enabled) continue;
      matched++;
      el.classList.add(CLS.fav);
      if (settings.mode === "hide") {
        el.classList.add(CLS.hide);
        if (settings.revealOnHover) el.classList.add(CLS.reveal);
        el.setAttribute("data-bfh-label", "already favorited");
      } else if (settings.mode === "remove") {
        el.classList.add(CLS.remove);
      } else {
        el.classList.add(CLS.highlight);
      }
    }

    lastCounts = { total: items.length, matched };
    renderBadge(enabled);
  }

  // ---- On-page status badge -------------------------------------------
  let badgeEl = null;
  let badgeDismissed = false;

  function renderBadge(enabled) {
    if (!settings.showBadge || badgeDismissed) {
      if (badgeEl) badgeEl.style.display = "none";
      return;
    }
    if (!badgeEl) {
      badgeEl = document.createElement("div");
      badgeEl.className = CLS.badge;
      badgeEl.innerHTML =
        '<span class="bfh-badge-dot"></span>' +
        '<span class="bfh-badge-text"></span>' +
        '<button class="bfh-badge-btn" data-act="cycle" title="Switch mode">mode</button>' +
        '<button class="bfh-badge-btn" data-act="close" title="Hide this badge">✕</button>';
      badgeEl.addEventListener("click", (e) => {
        const act = e.target && e.target.getAttribute("data-act");
        if (act === "cycle") cycleMode();
        else if (act === "close") {
          badgeDismissed = true;
          badgeEl.style.display = "none";
        }
      });
      (document.body || document.documentElement).appendChild(badgeEl);
    }
    badgeEl.style.display = "";
    const modeLabel = enabled ? settings.mode : "off (this site)";
    badgeEl.querySelector(".bfh-badge-text").textContent =
      `${lastCounts.matched} favorited · ${modeLabel}`;
    badgeEl.setAttribute("data-bfh-mode", settings.mode);
  }

  function cycleMode() {
    const order = ["highlight", "hide", "remove"];
    const next = order[(order.indexOf(settings.mode) + 1) % order.length];
    settings.mode = next;
    chrome.storage.local.get("settings").then((r) => {
      const s = r.settings || {};
      s.mode = next;
      chrome.storage.local.set({ settings: s });
    });
    apply();
  }

  // ---- Helpers ---------------------------------------------------------
  function hexToRgba(hex, a) {
    const h = String(hex).replace("#", "");
    const n =
      h.length === 3
        ? h.split("").map((c) => c + c).join("")
        : h.padEnd(6, "0").slice(0, 6);
    const r = parseInt(n.slice(0, 2), 16) || 0;
    const g = parseInt(n.slice(2, 4), 16) || 0;
    const b = parseInt(n.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${a})`;
  }

  // ---- Load data + settings, then run ----------------------------------
  async function loadAndApply() {
    const store = await chrome.storage.local.get(["favorites", "settings"]);
    if (store.settings) settings = { ...settings, ...store.settings };
    const fav = store.favorites || {};
    const ids = fav[SITE] || [];
    favSet = new Set();
    for (const id of ids) {
      const n = norm(id);
      if (n) favSet.add(n);
    }
    dataReady = true;
    apply();
  }

  // React to changes from the popup / options page immediately.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) {
      settings = { ...settings, ...(changes.settings.newValue || {}) };
    }
    if (changes.favorites) {
      const fav = changes.favorites.newValue || {};
      const ids = fav[SITE] || [];
      favSet = new Set();
      for (const id of ids) {
        const n = norm(id);
        if (n) favSet.add(n);
      }
    }
    apply();
  });

  // Respond to popup queries for the current page counts.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "getPageCounts") {
      sendResponse({ site: SITE, ...lastCounts, favTotal: favSet.size });
    }
    return false;
  });

  // ---- Watch for AJAX / infinite scroll / pagination -------------------
  let rafPending = false;
  const observer = new MutationObserver(() => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      apply();
    });
  });

  function startObserving() {
    const target = document.body || document.documentElement;
    if (target) observer.observe(target, { childList: true, subtree: true });
  }

  loadAndApply();
  startObserving();
})();
