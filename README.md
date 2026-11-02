# Booru Favorites Highlighter

A Chrome extension that **highlights, hides, or removes posts you've already
favorited** while you browse **Gelbooru**, **Danbooru**, and **Rule34** — so
your search results stop being clogged with things you've already saved, and you
stop opening posts only to find you favorited them months ago.

It figures out what you've already got by reading your **offline favorites
archive** on disk (folders you've downloaded your favorites into). The matching
is **100% local** — nothing about your archive or your browsing ever leaves your
computer.

---

## What it does

On every Gelbooru / Danbooru / Rule34 search page, the extension reads the post
ID of each thumbnail and checks it against the IDs in your archive. Matches are
then, depending on the mode you pick:

- **Highlight** — a colored outline + a small `♥ FAV` corner tag; the post stays
  visible. (Uses an *outline*, not a border, so a site's own video indicator
  stays visible underneath.)
- **Hide** — matches are dimmed to near-invisible in place (the grid layout
  doesn't shift). Hover to reveal.
- **Remove** — matches are removed from the grid entirely, leaving only new
  content.

A small badge in the corner of each search page shows how many favorited posts
it found and lets you switch modes on the fly. Everything is configurable from
the toolbar popup (mode, highlight color, per-site on/off, and more).

## Screenshots

<!-- Add screenshots to a docs/ folder and reference them here, e.g.:
![Highlight mode](docs/highlight.png)
-->

_Coming soon._

## Install (Load Unpacked)

1. Download/clone this repository.
2. Open **Chrome** → `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the **`extension`** folder from this repo.
5. The options page opens on first install (reopen any time from the toolbar
   popup → **Manage archives / Rescan**).

## Setup

1. On the options page, click **+ Add archive folder** and pick a folder that
   contains your downloaded favorites. Chrome asks for **read** permission —
   allow it. Add as many folders as you like.
2. Click **Scan / Rescan favorites**.
3. Open any booru search page — already-favorited posts are now marked.

After you download new favorites, open the options page and click **Rescan**.
Scans are cached, so rescans only read new folders and are fast.

Your scanned IDs are saved automatically in the extension's storage and persist
across browser restarts — no manual backup needed.

## Expected archive format

The scanner recognizes two folder layouts. Each favorite is its **own folder**
that contains a small info text file:

**Rule34 layout** — folder named with a trailing post ID, e.g.:

```
0001_16199896/
    rule34.txt          (contains "Post ID: 16199896" and the post URL)
    <the downloaded media file>
```

The post ID is the number after the last `_` in the folder name.

**Gelbooru / Danbooru layout** — folder named with the post ID in brackets,
e.g.:

```
artistname [2674464]/
    booru.txt           (line 1 = post ID, line 2 = source URL, plus a
                         "Site: Gelbooru" or "Site: Danbooru" line)
    <the downloaded media file>
```

The post ID is the number in the last `[ ]`. Because Gelbooru and Danbooru use
separate ID ranges, the `Site:` line (or the source URL) in `booru.txt` is used
to tell them apart.

The extension auto-detects which layout a folder uses by peeking at a couple of
its info files. If your archive uses a different naming scheme, adjust the
parsing in `extension/options.js` (`idFromRule34Name` / `idFromBrackets` /
`siteFromText`) and, for the matching side, `extension/content.js`
(`collectItems`).

## Optional: standalone scanner

You don't need this — the in-extension scan covers everything — but
`scanner/scan.mjs` (Node.js, no dependencies, read-only) can generate a
`favorites.json` you can **Import** on the options page:

```
node scan.mjs "D:\boorus\rule34 favorites" "D:\boorus\gelbooru danbooru favorites"
```

Pass any number of folders. You can also **Export** your scanned list from the
options page as a backup.

## Privacy & safety

- **Read-only.** Folder access is requested as read-only (`mode: "read"`), so
  Chrome itself blocks any write. The extension only reads folder names and the
  first few hundred bytes of each info file. It never renames, edits, moves, or
  deletes anything in your archive.
- **Local only.** Scanned IDs live in the extension's local storage
  (`chrome.storage.local`) and are never sent anywhere. There are no network
  requests, no analytics, no telemetry.

## How matching works

Each thumbnail on a booru links to its post by numeric ID; the extension reads
that ID from the thumbnail link (and from Danbooru's `data-id`) and checks it
against the set of IDs scanned from your archive, keyed per site.

## Permissions

- `storage` / `unlimitedStorage` — to save your scanned ID list locally.
- Host access to `gelbooru.com`, `danbooru.donmai.us`, `rule34.xxx` — to run the
  content script that marks thumbnails on those sites.

## Notes / limits

- Works on search/list (thumbnail-grid) pages.
- If a site changes its page markup and matches stop appearing, it's usually a
  one-line selector tweak in `extension/content.js` (`collectItems`). The
  current selectors are defensive (they key off post links and `data-id`).

## License

MIT — see [LICENSE](LICENSE).
