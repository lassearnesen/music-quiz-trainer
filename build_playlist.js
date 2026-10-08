/* One-off: build the curated Spotify playlist directly, locally, using a pasted
   user access token (token.txt). Resumable: caches resolved URIs + playlist id. */
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const API = process.env.MQT_API || 'https://api.spotify.com/v1';

function readTrim(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch (e) { return ''; } }
const TOKEN = process.env.MQT_TOKEN || readTrim(path.join(DIR, 'token.txt'));
if (!TOKEN) { console.error('No token.txt found (or empty). Save your Spotify access token there first.'); process.exit(2); }

// song list from curated.js
global.window = {};
eval(fs.readFileSync(path.join(DIR, 'curated.js'), 'utf8'));
const C = window.MQT_CURATED;
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const seenKey = {}; const songs = [];
Object.keys(C).forEach((d) => C[d].forEach((e) => {
  const i = e.indexOf('|'); const a = e.slice(0, i), t = e.slice(i + 1); const k = norm(a) + '|' + norm(t);
  if (!seenKey[k]) { seenKey[k] = 1; songs.push({ a, t, k }); }
}));
if (process.env.MQT_MAX) songs.length = Math.min(songs.length, Number(process.env.MQT_MAX));

const cachePath = path.join(DIR, 'resolve-cache.json');
let cache = {}; try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (e) {}
function saveCache() { try { fs.writeFileSync(cachePath, JSON.stringify(cache)); } catch (e) {} }
const plIdPath = path.join(DIR, 'playlist-id.txt');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, opts, tries) {
  opts = opts || {}; tries = tries || 0;
  const url = pathname.indexOf('http') === 0 ? pathname : API + pathname;
  const headers = Object.assign({ Authorization: 'Bearer ' + TOKEN }, opts.headers || {});
  let res;
  try { res = await fetch(url, Object.assign({}, opts, { headers })); }
  catch (e) { if (tries < 5) { await sleep(1000); return api(pathname, opts, tries + 1); } throw e; }
  if (res.status === 429) {
    const ra = Number(res.headers.get('retry-after') || '1');
    if (tries > 10) throw new Error('429 (gave up) ' + pathname);
    rlPauseUntil = Date.now() + (ra + 1) * 1000;
    await sleep((ra + 1) * 1000);
    return api(pathname, opts, tries + 1);
  }
  if (res.status === 401) throw new Error('401 Unauthorized — token expired. Paste a fresh token into token.txt and re-run.');
  if (res.status === 204) return null;
  if (!res.ok) { let j = {}; try { j = await res.json(); } catch (e) {} const m = (j.error && (j.error.message || j.error.reason)) || res.statusText; const err = new Error('API ' + res.status + ' ' + pathname.split('?')[0] + ': ' + m); err.status = res.status; throw err; }
  try { return await res.json(); } catch (e) { return null; }
}

let rlPauseUntil = 0;

async function me() { return api('/me'); }

async function ensurePlaylist(userId, name) {
  const existing = readTrim(plIdPath);
  if (existing) { try { const p = await api('/playlists/' + existing); if (p && p.id) return p; } catch (e) {} }
  const p = await api('/users/' + encodeURIComponent(userId) + '/playlists', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, public: false, description: 'Curated by Music Quiz Trainer — well-known hits across genres & decades.' }),
  });
  fs.writeFileSync(plIdPath, p.id);
  return p;
}

async function existingUris(pid) {
  const have = {};
  async function page(base, field) {
    let url = '/playlists/' + pid + '/' + base + '?limit=100&fields=' + encodeURIComponent('next,items(' + field + '(uri))');
    let guard = 0;
    while (url && guard < 40) {
      const d = await api(url);
      (d.items || []).forEach((it) => { const tr = it[field]; if (tr && tr.uri) have[tr.uri] = 1; });
      url = d.next; guard++;
    }
  }
  try { await page('tracks', 'track'); }
  catch (e) { try { await page('items', 'item'); } catch (e2) {} }
  return have;
}

let _addEp = null;
async function addBatch(pid, uris) {
  async function post(ep) { return api('/playlists/' + pid + '/' + ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uris }) }); }
  if (_addEp) return post(_addEp);
  try { const r = await post('tracks'); _addEp = 'tracks'; return r; }
  catch (e) { const r = await post('items'); _addEp = 'items'; return r; }
}

function pickMatch(items, a, t) {
  const na = norm(a), nt = norm(t); let byA = null, byB = null;
  for (const it of items) {
    if (!it || !it.artists || !it.artists.length) continue;
    const am = it.artists.some((x) => { const an = norm(x.name); return an.indexOf(na) >= 0 || na.indexOf(an) >= 0; });
    if (am) { if (!byA) byA = it; const nm = norm(it.name); if (!byB && (nm.indexOf(nt) >= 0 || nt.indexOf(nm) >= 0)) byB = it; }
  }
  return byB || byA || items[0] || null;
}

(async () => {
  const user = await me();
  console.log('Logged in as:', user.display_name || user.id, '(' + user.id + ')');
  const pl = await ensurePlaylist(user.id, 'Music Quiz — Well-Known Hits (80s–now)');
  const url = (pl.external_urls && pl.external_urls.spotify) || ('https://open.spotify.com/playlist/' + pl.id);
  console.log('Playlist:', pl.name, '->', url);

  const already = await existingUris(pl.id);
  console.log('Already in playlist:', Object.keys(already).length, 'tracks');

  // Resolve (cache-first), then add missing in batches, streaming.
  let pace = Number(process.env.MQT_PACE || 250); let okStreak = 0; const conc = 2;
  let i = 0, done = 0, added = 0, notFound = 0; const total = songs.length;
  const buffer = []; const retried = {}; let addErr = null;
  const seenUri = Object.assign({}, already);

  async function flush(force) {
    while (buffer.length >= 100 || (force && buffer.length)) {
      const batch = buffer.splice(0, 100);
      try { await addBatch(pl.id, batch); added += batch.length; console.log('  + added', added, 'tracks so far'); }
      catch (e) { addErr = e; console.error('  ! add failed:', e.message); return; }
    }
  }

  async function worker() {
    while (i < songs.length) {
      const s = songs[i++];
      if (cache[s.k]) { const u = cache[s.k]; if (u && !seenUri[u]) { seenUri[u] = 1; buffer.push(u); } done++; if (buffer.length >= 100) await flush(false); continue; }
      const q = s.t + ' ' + s.a;
      let d, errd = false;
      try { d = await api('/search?type=track&limit=8&q=' + encodeURIComponent(q)); okStreak++; if (okStreak >= 12) { okStreak = 0; if (pace > 90) pace -= 15; } }
      catch (e) { errd = true; okStreak = 0; pace = Math.min(2000, pace * 2); }
      if (!errd) {
        const items = (d && d.tracks && d.tracks.items) || [];
        const m = pickMatch(items, s.a, s.t);
        if (m && m.uri) { cache[s.k] = m.uri; if (!seenUri[m.uri]) { seenUri[m.uri] = 1; buffer.push(m.uri); } }
        else { cache[s.k] = null; notFound++; }
        done++;
        if (done % 25 === 0) { saveCache(); console.log('resolved', done, '/', total, '| added', added, '| not-found', notFound, '| pace', pace + 'ms'); }
        if (buffer.length >= 100) await flush(false);
      } else {
        if (!retried[s.k]) { retried[s.k] = 1; songs.push(s); } else { notFound++; done++; }
      }
      await sleep(pace);
      if (addErr) return;
    }
  }

  const workers = []; for (let w = 0; w < conc; w++) workers.push(worker());
  await Promise.all(workers);
  await flush(true);
  saveCache();

  if (addErr) { console.error('\nStopped: could not add tracks —', addErr.message); process.exit(1); }
  console.log('\nDONE. Added', added, 'new tracks. Not found:', notFound, 'of', total + '.');
  console.log('Open your playlist:', url);
})().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
