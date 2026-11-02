/*
 * OPTIONAL standalone scanner (Node.js, no dependencies).
 *
 * You do NOT need this if you use the in-extension "Add archive folder" + "Scan"
 * flow. This is only a fallback: it scans your archive folders and writes a
 * favorites.json you can Import in the extension's options page. Handy for very
 * large archives, or if your browser blocks folder access.
 *
 * READ-ONLY: this script only reads folder names and info files. It never
 * writes, renames, moves or deletes anything inside your archives.
 *
 * Usage (from a terminal):
 *   node scan.mjs "D:\boorus\rule34 favorites" "D:\boorus\gelbooru danbooru favorites"
 *
 * You can pass any number of folders. Output: favorites.json in this folder.
 */
import fs from "node:fs/promises";
import path from "node:path";

const normId = (v) => {
  if (v == null) return null;
  const s = String(v).trim().replace(/^0+(?=\d)/, "");
  return /^\d+$/.test(s) ? s : null;
};
const idFromRule34Name = (n) => normId(n.split("_").pop());
const idFromBrackets = (n) => {
  const ms = [...n.matchAll(/\[(\d+)\]/g)];
  return ms.length ? normId(ms[ms.length - 1][1]) : null;
};
const siteFromText = (t) => {
  if (!t) return null;
  if (/gelbooru\.com/i.test(t) || /Site:\s*Gelbooru/i.test(t)) return "gelbooru";
  if (/donmai\.us/i.test(t) || /Site:\s*Danbooru/i.test(t)) return "danbooru";
  return null;
};

async function readHead(file, bytes = 400) {
  try {
    const fd = await fs.open(file, "r");
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fd.read(buf, 0, bytes, 0);
    await fd.close();
    return buf.slice(0, bytesRead).toString("utf8");
  } catch {
    return null;
  }
}

async function detectKind(root, dirs) {
  for (const d of dirs.slice(0, 8)) {
    if ((await readHead(path.join(root, d, "rule34.txt"), 20)) !== null) return "rule34";
    if ((await readHead(path.join(root, d, "booru.txt"), 20)) !== null) return "gelboorudan";
  }
  return "gelboorudan";
}

async function scanRoot(root, out) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const kind = await detectKind(root, dirs);
  process.stdout.write(`\n${root}\n  type: ${kind}, folders: ${dirs.length}\n`);

  if (kind === "rule34") {
    for (const name of dirs) {
      const id = idFromRule34Name(name);
      if (id) out.rule34.add(id);
      else out.unresolved++;
    }
    return;
  }
  let done = 0;
  const CONC = 48;
  let i = 0;
  async function worker() {
    while (i < dirs.length) {
      const name = dirs[i++];
      const id = idFromBrackets(name);
      if (!id) { out.unresolved++; continue; }
      let site = siteFromText(await readHead(path.join(root, name, "booru.txt")));
      if (!site) {
        try {
          for (const f of await fs.readdir(path.join(root, name))) {
            if (/\.txt$/i.test(f)) { site = siteFromText(await readHead(path.join(root, name, f))); if (site) break; }
          }
        } catch {}
      }
      if (site) out[site].add(id); else out.unresolved++;
      if (++done % 500 === 0) process.stdout.write(`  ${done}/${dirs.length}\r`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, dirs.length) }, worker));
  process.stdout.write(`  ${dirs.length}/${dirs.length}\n`);
}

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error('Usage: node scan.mjs "D:\\boorus\\rule34 favorites" "D:\\boorus\\gelbooru danbooru favorites"');
  process.exit(1);
}
const out = { gelbooru: new Set(), danbooru: new Set(), rule34: new Set(), unresolved: 0 };
for (const r of roots) {
  try { await scanRoot(r, out); }
  catch (e) { console.error(`  skip ${r}: ${e.message}`); }
}
const favorites = {
  gelbooru: [...out.gelbooru],
  danbooru: [...out.danbooru],
  rule34: [...out.rule34],
  meta: {
    lastScan: new Date().toISOString(),
    counts: { gelbooru: out.gelbooru.size, danbooru: out.danbooru.size, rule34: out.rule34.size },
    unresolved: out.unresolved,
  },
};
await fs.writeFile(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "favorites.json"), JSON.stringify(favorites, null, 2));
console.log(`\nWrote favorites.json  ->  Gelbooru ${favorites.meta.counts.gelbooru}, Danbooru ${favorites.meta.counts.danbooru}, Rule34 ${favorites.meta.counts.rule34}, unresolved ${out.unresolved}`);
