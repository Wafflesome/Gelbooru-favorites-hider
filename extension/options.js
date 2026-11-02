/* Booru Favorites Highlighter - options page / archive scanner */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const statusEl = $("#status");
  const setStatus = (m, err) => {
    statusEl.textContent = m || "";
    statusEl.style.color = err ? "var(--danger)" : "var(--accent2)";
  };

  const hasFSA = typeof window.showDirectoryPicker === "function";
  if (!hasFSA) $("#fsaWarn").hidden = false;

  // ---------- tiny IndexedDB wrapper (stores directory handles) ----------
  const DB = "bfh_fs";
  const STORE = "folders";
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore(STORE, { keyPath: "id" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbAll() {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      tx.onsuccess = () => res(tx.result || []);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbPut(rec) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE).put(rec);
      tx.onsuccess = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbDel(id) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
      tx.onsuccess = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  // ---------- helpers ----------
  const normId = (v) => {
    if (v == null) return null;
    const s = String(v).trim().replace(/^0+(?=\d)/, "");
    return /^\d+$/.test(s) ? s : null;
  };

  // rule34 folder: NNNN_postid  -> last underscore chunk
  function idFromRule34Name(name) {
    const parts = String(name).split("_");
    return normId(parts[parts.length - 1]);
  }
  // gelbooru/danbooru folder: "artist [postid]" -> last [digits]
  function idFromBrackets(name) {
    const ms = [...String(name).matchAll(/\[(\d+)\]/g)];
    return ms.length ? normId(ms[ms.length - 1][1]) : null;
  }

  async function ensurePerm(handle) {
    const opts = { mode: "read" };
    try {
      if ((await handle.queryPermission(opts)) === "granted") return true;
      if ((await handle.requestPermission(opts)) === "granted") return true;
    } catch (e) {}
    return false;
  }

  async function readHead(dirHandle, fileName, bytes = 400) {
    try {
      const fh = await dirHandle.getFileHandle(fileName);
      const f = await fh.getFile();
      return await f.slice(0, bytes).text();
    } catch (e) {
      return null;
    }
  }

  function siteFromText(txt) {
    if (!txt) return null;
    if (/gelbooru\.com/i.test(txt) || /Site:\s*Gelbooru/i.test(txt)) return "gelbooru";
    if (/donmai\.us/i.test(txt) || /Site:\s*Danbooru/i.test(txt)) return "danbooru";
    return null;
  }

  async function mapLimit(items, limit, fn, onTick) {
    const ret = new Array(items.length);
    let i = 0,
      done = 0;
    async function worker() {
      while (i < items.length) {
        const idx = i++;
        ret[idx] = await fn(items[idx], idx);
        done++;
        if (onTick && done % 25 === 0) onTick(done);
      }
    }
    const n = Math.min(limit, items.length) || 0;
    await Promise.all(Array.from({ length: n }, worker));
    if (onTick) onTick(done);
    return ret;
  }

  // Detect whether a folder is a rule34 archive or a gelbooru/danbooru one,
  // by peeking inside a few child folders.
  async function detectKind(dirHandle) {
    let checked = 0;
    for await (const [name, h] of dirHandle.entries()) {
      if (h.kind !== "directory") continue;
      if ((await readHead(h, "rule34.txt", 20)) !== null) return "rule34";
      if ((await readHead(h, "booru.txt", 20)) !== null) return "gelboorudan";
      if (++checked >= 8) break;
    }
    return "gelboorudan"; // default; user can toggle
  }

  // ---------- scanning one folder ----------
  async function scanFolder(rec, opts, onProgress) {
    const out = { gelbooru: new Set(), danbooru: new Set(), rule34: new Set(), unresolved: 0 };
    const cache = opts.fullRescan ? {} : rec.cache || {};
    const newCache = {};

    // Collect all child directory entries first (so we know the total).
    const dirs = [];
    for await (const [name, h] of rec.handle.entries()) {
      if (h.kind === "directory") dirs.push({ name, h });
    }
    const total = dirs.length;
    onProgress && onProgress(rec, 0, total);

    if (rec.kind === "rule34") {
      let done = 0;
      for (const { name } of dirs) {
        const id = idFromRule34Name(name);
        if (id) {
          out.rule34.add(id);
          newCache[name] = { id, site: "rule34" };
        } else {
          out.unresolved++;
        }
        if (++done % 500 === 0) onProgress && onProgress(rec, done, total);
      }
      onProgress && onProgress(rec, total, total);
      rec.cache = newCache;
      return out;
    }

    // gelbooru / danbooru: need to know the site per post -> read booru.txt
    // (cached across rescans so this only happens for new folders).
    const toRead = [];
    for (const d of dirs) {
      const c = cache[d.name];
      if (c && c.id && c.site) {
        newCache[d.name] = c;
        out[c.site].add(c.id);
      } else {
        toRead.push(d);
      }
    }

    let done = dirs.length - toRead.length;
    onProgress && onProgress(rec, done, total);

    await mapLimit(
      toRead,
      40,
      async ({ name, h }) => {
        const id = idFromBrackets(name);
        if (!id) {
          out.unresolved++;
          return;
        }
        let txt = await readHead(h, "booru.txt", 400);
        let site = siteFromText(txt);
        if (!site) {
          // Fallback: scan any .txt in the folder.
          try {
            for await (const [fn, fh] of h.entries()) {
              if (fh.kind === "file" && /\.txt$/i.test(fn)) {
                const f = await fh.getFile();
                site = siteFromText(await f.slice(0, 400).text());
                if (site) break;
              }
            }
          } catch (e) {}
        }
        if (!site) {
          out.unresolved++;
          return;
        }
        out[site].add(id);
        newCache[name] = { id, site };
      },
      (d) => onProgress && onProgress(rec, dirs.length - toRead.length + d, total)
    );

    onProgress && onProgress(rec, total, total);
    rec.cache = newCache;
    return out;
  }

  // ---------- UI: folder list ----------
  let folders = []; // in-memory copy of idb records

  async function refreshFolders() {
    folders = await idbAll();
    const ul = $("#folderList");
    ul.innerHTML = "";
    if (!folders.length) {
      ul.innerHTML = '<li class="muted" style="border:none;background:none">No folders added yet.</li>';
    }
    for (const rec of folders) {
      const li = document.createElement("li");
      const perm = await (async () => {
        try {
          return (await rec.handle.queryPermission({ mode: "read" })) === "granted";
        } catch (e) {
          return false;
        }
      })();
      li.innerHTML =
        `<span class="name"></span>` +
        `<button class="mini" data-act="kind" title="Toggle archive type">type</button>` +
        `<span class="tag ${rec.kind}">${rec.kind === "rule34" ? "rule34" : "gelbooru/danbooru"}</span>` +
        `<span class="perm ${perm ? "ok" : "no"}">${perm ? "access OK" : "needs access"}</span>` +
        `<button class="mini" data-act="remove" title="Remove from list">remove</button>`;
      li.querySelector(".name").textContent = rec.name;
      li.querySelector('[data-act="remove"]').addEventListener("click", async () => {
        await idbDel(rec.id);
        refreshFolders();
      });
      li.querySelector('[data-act="kind"]').addEventListener("click", async () => {
        rec.kind = rec.kind === "rule34" ? "gelboorudan" : "rule34";
        rec.cache = {}; // type changed -> cache invalid
        await idbPut(rec);
        refreshFolders();
      });
      ul.appendChild(li);
    }
    $("#scan").disabled = folders.length === 0;
  }

  // ---------- add folder ----------
  $("#addFolder").addEventListener("click", async () => {
    if (!hasFSA) {
      setStatus("Folder access isn't available here; use Import instead.", true);
      return;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: "read", id: "bfh-archive" });
    } catch (e) {
      return; // user cancelled
    }
    setStatus("Detecting archive type…");
    const kind = await detectKind(handle);
    const rec = {
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
      name: handle.name,
      kind,
      handle,
      cache: {},
    };
    await idbPut(rec);
    setStatus(`Added "${handle.name}" as ${kind === "rule34" ? "rule34" : "gelbooru/danbooru"}. Click Scan.`);
    refreshFolders();
  });

  // ---------- scan all ----------
  $("#scan").addEventListener("click", async () => {
    const fullRescan = $("#fullRescan").checked;
    const recs = await idbAll();
    if (!recs.length) return;

    $("#progress").hidden = false;
    const barFill = $("#barFill");
    const ptext = $("#progressText");

    const totals = { gelbooru: new Set(), danbooru: new Set(), rule34: new Set() };
    let unresolved = 0;
    const perFolder = [];

    // grand progress across folders
    let folderIndex = 0;
    for (const rec of recs) {
      folderIndex++;
      const ok = await ensurePerm(rec.handle);
      if (!ok) {
        setStatus(`Access denied for "${rec.name}". Click its "needs access" then Scan again.`, true);
        continue;
      }
      setStatus(`Scanning "${rec.name}" (${folderIndex}/${recs.length})…`);
      let res;
      try {
        res = await scanFolder(rec, { fullRescan }, (r, done, total) => {
          const pct = total ? Math.round((done / total) * 100) : 0;
          barFill.style.width = pct + "%";
          ptext.textContent = `${r.name}: ${done.toLocaleString()} / ${total.toLocaleString()} folders`;
        });
      } catch (e) {
        setStatus(`Error scanning "${rec.name}": ${e.message}`, true);
        continue;
      }
      for (const site of ["gelbooru", "danbooru", "rule34"]) {
        res[site].forEach((id) => totals[site].add(id));
      }
      unresolved += res.unresolved;
      perFolder.push({
        name: rec.name,
        kind: rec.kind,
        count: res.gelbooru.size + res.danbooru.size + res.rule34.size,
      });
      await idbPut(rec); // persist updated cache
    }

    const favorites = {
      gelbooru: [...totals.gelbooru],
      danbooru: [...totals.danbooru],
      rule34: [...totals.rule34],
      meta: {
        lastScan: new Date().toISOString(),
        counts: {
          gelbooru: totals.gelbooru.size,
          danbooru: totals.danbooru.size,
          rule34: totals.rule34.size,
        },
        unresolved,
        folders: perFolder,
      },
    };
    await chrome.storage.local.set({ favorites });
    barFill.style.width = "100%";
    ptext.textContent = "Done.";
    renderCounts(favorites.meta);
    setStatus(
      `Scan complete · ${favorites.meta.counts.gelbooru} Gelbooru, ` +
        `${favorites.meta.counts.danbooru} Danbooru, ${favorites.meta.counts.rule34} Rule34` +
        (unresolved ? ` · ${unresolved} could not be resolved` : "") +
        ". Reload any open booru tabs to apply."
    );
    refreshFolders();
  });

  // ---------- counts display ----------
  function renderCounts(meta) {
    if (!meta) return;
    const c = meta.counts || {};
    $("#counts").innerHTML =
      chip(c.gelbooru, "Gelbooru") +
      chip(c.danbooru, "Danbooru") +
      chip(c.rule34, "Rule34") +
      (meta.lastScan
        ? `<div class="count-chip"><div class="n" style="font-size:13px">${new Date(
            meta.lastScan
          ).toLocaleString()}</div><div class="l">last scan</div></div>`
        : "");
  }
  const chip = (n, l) =>
    `<div class="count-chip"><div class="n">${(n || 0).toLocaleString()}</div><div class="l">${l}</div></div>`;

  // ---------- export / import / clear ----------
  $("#export").addEventListener("click", async () => {
    const { favorites } = await chrome.storage.local.get("favorites");
    if (!favorites) return setStatus("Nothing to export yet.", true);
    const blob = new Blob([JSON.stringify(favorites, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "favorites.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const favorites = {
        gelbooru: (data.gelbooru || []).map(normId).filter(Boolean),
        danbooru: (data.danbooru || []).map(normId).filter(Boolean),
        rule34: (data.rule34 || []).map(normId).filter(Boolean),
        meta: data.meta || {
          lastScan: new Date().toISOString(),
          counts: {
            gelbooru: (data.gelbooru || []).length,
            danbooru: (data.danbooru || []).length,
            rule34: (data.rule34 || []).length,
          },
        },
      };
      favorites.meta.counts = {
        gelbooru: favorites.gelbooru.length,
        danbooru: favorites.danbooru.length,
        rule34: favorites.rule34.length,
      };
      await chrome.storage.local.set({ favorites });
      renderCounts(favorites.meta);
      setStatus("Imported. Reload any open booru tabs to apply.");
    } catch (err) {
      setStatus("Import failed: " + err.message, true);
    }
    e.target.value = "";
  });

  $("#clearData").addEventListener("click", async () => {
    if (!confirm("Clear all scanned favorite IDs? (Your folders stay linked; you can rescan.)")) return;
    await chrome.storage.local.remove("favorites");
    $("#counts").innerHTML = "";
    setStatus("Cleared scanned data.");
  });

  // ---------- init ----------
  (async () => {
    await refreshFolders();
    const { favorites } = await chrome.storage.local.get("favorites");
    if (favorites && favorites.meta) renderCounts(favorites.meta);
  })();
})();
