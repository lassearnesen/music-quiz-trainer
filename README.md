# 🎧 Music Quiz Trainer

A single-file web app to practice music quizzes. It plays full songs through **Spotify** and quizzes you on
**who the artist/band is** — the track stays hidden until you answer, then you get feedback plus trivia
pulled from Spotify's metadata.

Everything lives in one portable file: **`index.html`**. It uses *only* the Spotify Web API and the
Spotify Web Playback SDK.

> **▶ Live site:** <https://lassearnesen.github.io/music-quiz-trainer/>
> **🔑 Spotify Redirect URI to register (exact, keep the trailing slash):**
> `https://lassearnesen.github.io/music-quiz-trainer/`

---

## What you need

- A **Spotify Premium** account (the Web Playback SDK only streams full tracks for Premium users).
- A free **Spotify Developer app** (gives you a *Client ID* — takes ~2 minutes to create).
- A modern browser (Chrome, Edge, Firefox, Safari).
- The page served over **https** (hosted) — it cannot run by double-clicking the file. See *Why not file://* below.

---

## 1) Create your Spotify app (one time)

1. Go to <https://developer.spotify.com/dashboard> and log in.
2. Click **Create app**. Give it any name/description.
3. Under **Redirect URIs**, add the **exact** URL where you'll host the page (the app also shows you this
   value on its Connect screen — copy it from there). Examples:
   - GitHub Pages: `https://<your-user>.github.io/<repo>/`
   - Netlify: `https://<your-site>.netlify.app/`
4. Under **APIs used**, tick **Web API** and **Web Playback SDK**. Click **Save**.
5. Open **Settings** and copy the **Client ID**.

> If login later says your account isn't registered, open the app's **User Management** in the dashboard and
> add your own Spotify account's email. (New apps start in development mode.)

## 2) Host the single file

Pick either option — both give you an `https` URL.

**GitHub Pages**
1. Create a repo and add `index.html` to it.
2. Repo **Settings → Pages →** Source = your branch, folder = `/root`. Save.
3. Your site appears at `https://<your-user>.github.io/<repo>/`.

**Netlify (drag & drop)**
1. Go to <https://app.netlify.com/drop>.
2. Drag the folder containing `index.html` onto the page.
3. Netlify gives you a `https://<site>.netlify.app/` URL.

Make sure the hosted URL matches the **Redirect URI** you registered in step 1 exactly (including the
trailing `/`). The Connect screen displays the precise value to register.

## 3) Play

1. Open your hosted URL.
2. Paste your **Client ID**, confirm the redirect URI is registered, and click **Connect Spotify**.
3. Paste a **playlist link** (e.g. `https://open.spotify.com/playlist/...`), choose **Shuffle** or
   **In playlist order**, and start.
4. Answer song after song — you get instant feedback + trivia the moment you pick. Keep going as long as you
   like, then press **Stop** for a session summary. 🎵

> Tip: keep the Spotify desktop/mobile app **closed** while playing so it doesn't spoil the answer on another
> device. Playback happens on an in-browser device named "Music Quiz Trainer".

---

## How the quiz works

- **Continuous trainer:** questions keep coming — pick **Shuffle** or **In playlist order** at the start,
  answer as many as you want, and press **Stop** any time for a summary (answered, accuracy, best streak).
- **Songs** come from the playlist link you paste — **it must be a playlist you own or collaborate on**.
  Since Spotify's February 2026 dev-mode changes, the API only returns track lists for your own/collaborative
  playlists; others return just metadata. Unplayable/local/podcast items are skipped.
- **Wrong answers are "smart":** decoys are drawn from artists in the **same genre** as the real artist (via
  Spotify's artist **genre search**), falling back to other artists from your playlist. (Spotify deprecated
  *related-artists* and removed artist *popularity*/*followers* for dev-mode apps in the 2024–2026 changes,
  so similarity is genre-based.)
- **Trivia** is synthesized from the core metadata still available: release year, album, track number, artist
  genres, duration, explicit flag, and featured artists.

## Privacy

- Your **Client ID** and Spotify **tokens** are stored only in your browser's `localStorage`. Nothing is sent
  anywhere except directly to Spotify's own API endpoints. Log out to clear them.
- Auth uses the **Authorization Code + PKCE** flow (no client secret needed).

## Why not `file://`?

Opening the raw file won't work because of Spotify's security rules:
- **Redirect URI:** Spotify only accepts `https://` or loopback redirect URIs — a `file://` path can't be
  registered, so login can't complete.
- **Secure context:** the Web Playback SDK uses DRM-protected playback, which browsers allow only on `https`
  (or `http://127.0.0.1`). `file://` isn't a secure context.

If you'd rather not host it, you can instead serve the folder locally and register
`http://127.0.0.1:8000/` as the redirect URI:
```
# from the folder containing index.html
python -m http.server 8000      # then open http://127.0.0.1:8000/
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `INVALID_CLIENT` / redirect error | The hosted URL must exactly match a Redirect URI in your Spotify app (mind the trailing `/`). |
| Login loops or "user not registered" | Add your account under the app's **User Management** in the dashboard. |
| No sound / "Premium required" | Playback needs Spotify **Premium**; also allow the browser a moment to start the player. |
| `API 403 … /playlists/…/items` or "No tracks returned" | Spotify only returns tracks for playlists **you own or collaborate on** (Feb 2026 dev-mode rule). Use one of your own playlists. |
| Only 2–3 answer options | The artist had no genre data and the playlist has few artists; use a richer playlist. |
