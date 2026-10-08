# Building the "Music Quiz" Spotify playlist (~1,456 songs)

The in‑app builder works, but Spotify put small apps in **developer‑mode** in 2025, which
caps API calls to a few per second. For ~1,456 songs that first build is slow and fiddly.
Here are the reliable options, best first.

## Option 1 — Let the assistant build it directly (most reliable)
Runs locally on your machine against Spotify; no third‑party tool, no track cap.

1. Open the app: https://lassearnesen.github.io/music-quiz-trainer/
2. **Log out → Connect once** (re‑authorizes with playlist‑create permission — required).
3. Click **"Copy token"** (top‑right).
4. Paste the token into a new file **`token.txt`** in this folder (it's git‑ignored).
5. Tell the assistant "go", or run it yourself with Node 20+:
   ```powershell
   node build_playlist.js
   ```
   It creates a private playlist, prints the link, resolves each song with a fuzzy
   search, and adds them in batches. It's **resumable** — it caches resolved tracks
   (`resolve-cache.json`) and the playlist id (`playlist-id.txt`), so if the token
   expires (~1 hour) just grab a fresh one and run again to continue.

## Option 2 — In‑app builder, one decade at a time
The app (v20+) now uses a forgiving fuzzy search and is resumable. A single decade
(~270–404 songs) stays under the rate‑limit pain and usually finishes in 1–2 minutes.
1. Open the app, pick a **decade** under the "Well‑known hits (curated)" source.
2. Click **"Create / update a Spotify playlist"**. Watch it fill in Spotify live.
3. Repeat per decade (it reuses/augments the same per‑decade playlist, no duplicates).

## Option 3 — Bulk import tools (use the files below)
Reliability varies because some of these tools are *also* affected by Spotify's
developer‑mode limits.
- **Spotlistr** — https://www.spotlistr.com/convert/textbox-to-spotify — paste
  `playlist-all.txt`. Free credits usually cover a one‑off build.
- **Soundiiz** — https://soundiiz.com/ — import **`playlist-all.csv`** (CSV handles
  commas/dashes cleanly). Free tier caps ~200 tracks/playlist, so use the per‑decade
  text files or split the CSV.
- **TuneMyMusic** — free tier caps 500 tracks, so import the **per‑decade** files one at
  a time into the same destination playlist.
- **Track Down** — https://trackdown.yyyokel.com/text-to-spotify-playlist/ — paste
  `playlist-all.txt`. (Reported "finds nothing" — its Spotify app may be dev‑mode limited.)

## Files (also downloadable from GitHub Pages)
All lists are de‑duplicated, 1980s→2020s, including ~130 Norwegian artists.
- `playlist-all.txt` — 1,456 songs, `Artist — Title` (em dash; parses cleanly even for
  a‑ha, Run‑D.M.C., "Cold Heart - PNAU Remix").
  https://lassearnesen.github.io/music-quiz-trainer/playlist-all.txt
- `playlist-all.csv` — `Artist,Title,Decade` columns (for CSV importers).
  https://lassearnesen.github.io/music-quiz-trainer/playlist-all.csv
- Per decade: `playlist-1980s.txt` … `playlist-2020s.txt`
  (270 / 294 / 349 / 404 / 141).

## Notes
- `token.txt`, `resolve-cache.json`, `playlist-id.txt` are git‑ignored (never committed).
- The token is a short‑lived Spotify **access token**, not your password; log out to revoke it.
- Creating a *public* playlist would need the `playlist-modify-public` scope; the app
  currently requests `playlist-modify-private`, so the built playlist is **private**
  (you can flip it to public in Spotify afterward).
