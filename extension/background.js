// Booru Favorites Highlighter - background service worker (MV3)
// Minimal: sets sensible defaults on install and opens the options page
// the first time so the user can point at their archive folders.

const DEFAULT_SETTINGS = {
  mode: "highlight", // "highlight" | "hide" | "remove"
  color: "#ffd400", // highlight border color
  tint: true, // add a subtle background tint in highlight mode
  showBadge: true, // show the on-page corner status badge
  revealOnHover: true, // in hide mode, reveal on hover
  perSite: { gelbooru: true, danbooru: true, rule34: true },
};

chrome.runtime.onInstalled.addListener(async (details) => {
  const cur = await chrome.storage.local.get("settings");
  if (!cur.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  } else {
    // Merge in any newly added default keys.
    const merged = { ...DEFAULT_SETTINGS, ...cur.settings,
      perSite: { ...DEFAULT_SETTINGS.perSite, ...(cur.settings.perSite || {}) } };
    await chrome.storage.local.set({ settings: merged });
  }
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

// Allow the popup / options page to open the options page.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
  return false;
});
