/* Booru Favorites Highlighter - popup */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const DEFAULTS = {
    mode: "highlight", color: "#ffd400", tint: true, showBadge: true,
    revealOnHover: true, perSite: { gelbooru: true, danbooru: true, rule34: true },
  };
  let settings = { ...DEFAULTS };

  async function load() {
    const { settings: s, favorites } = await chrome.storage.local.get(["settings", "favorites"]);
    settings = { ...DEFAULTS, ...(s || {}), perSite: { ...DEFAULTS.perSite, ...((s || {}).perSite || {}) } };
    render();
    renderStats(favorites);
    renderPageInfo();
  }

  async function save() {
    await chrome.storage.local.set({ settings });
  }

  function render() {
    document.querySelectorAll("#mode button").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === settings.mode);
    });
    $("#color").value = settings.color;
    $("#tint").checked = !!settings.tint;
    $("#showBadge").checked = !!settings.showBadge;
    $("#revealOnHover").checked = !!settings.revealOnHover;
    $("#site_gelbooru").checked = settings.perSite.gelbooru !== false;
    $("#site_danbooru").checked = settings.perSite.danbooru !== false;
    $("#site_rule34").checked = settings.perSite.rule34 !== false;
  }

  function renderStats(favorites) {
    const c = (favorites && favorites.meta && favorites.meta.counts) || { gelbooru: 0, danbooru: 0, rule34: 0 };
    $("#stats").innerHTML =
      stat(c.gelbooru, "Gelbooru") + stat(c.danbooru, "Danbooru") + stat(c.rule34, "Rule34");
  }
  const stat = (n, l) => `<div class="stat"><div class="n">${(n || 0).toLocaleString()}</div><div class="l">${l}</div></div>`;

  async function renderPageInfo() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      chrome.tabs.sendMessage(tab.id, { type: "getPageCounts" }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          $("#pageInfo").innerHTML = "Open a Gelbooru, Danbooru or Rule34 search page to see matches.";
          return;
        }
        $("#pageInfo").innerHTML =
          `On this page: <b>${resp.matched}</b> of <b>${resp.total}</b> thumbnails are already favorited ` +
          `<span style="opacity:.7">(${resp.site})</span>.`;
      });
    } catch (e) {}
  }

  // events
  document.querySelectorAll("#mode button").forEach((b) => {
    b.addEventListener("click", () => { settings.mode = b.dataset.mode; render(); save(); });
  });
  $("#color").addEventListener("input", () => { settings.color = $("#color").value; save(); });
  $("#tint").addEventListener("change", () => { settings.tint = $("#tint").checked; save(); });
  $("#showBadge").addEventListener("change", () => { settings.showBadge = $("#showBadge").checked; save(); });
  $("#revealOnHover").addEventListener("change", () => { settings.revealOnHover = $("#revealOnHover").checked; save(); });
  ["gelbooru", "danbooru", "rule34"].forEach((site) => {
    $("#site_" + site).addEventListener("change", () => {
      settings.perSite[site] = $("#site_" + site).checked; save();
    });
  });
  $("#rescan").addEventListener("click", () => chrome.runtime.openOptionsPage());

  load();
})();
