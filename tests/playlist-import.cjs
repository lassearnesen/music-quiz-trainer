const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>\s*(\(function\(\)\{[\s\S]*?)<\/script>/)[1]
  .replace(/\}\)\(\);\s*$/, 'globalThis.importTest={createCuratedPlaylist,resolveCurated,api,copyImportDiagnostics};})();');

function track(n) {
  return {
    id: String(n), uri: 'spotify:track:' + n, type: 'track',
    name: 'Song ' + n, artists: [{ id: 'artist' + n, name: 'Artist ' + n }],
    album: { name: 'Album', release_date: '2020', images: [] }
  };
}

function response(body, status = 200, retryAfter = null) {
  return {
    status, ok: status < 400, statusText: 'Fixture error',
    headers: { get: () => retryAfter },
    json: async () => body
  };
}

function setup(count, options = {}) {
  const data = options.data || new Map();
  data.set('mqt_access', 'test');
  data.set('mqt_exp', options.tokenTimeout ? '0' : String(Date.now() + 3600000));
  if(options.tokenTimeout)data.set('mqt_refresh', 'test-refresh');
  data.set('mqt_curatedpl', JSON.stringify({ all: 'saved' }));
  const playlist = options.playlist || [];
  const songs = Array.from({ length: count }, (_, i) => 'Artist ' + i + '|Song ' + i);
  const els = {};
  const calls = [];
  const waits = [];
  const intervals = new Set();
  let searchCount = 0;
  let batchCount = 0;
  let writing = false;
  const context = {
    console, URL, URLSearchParams, AbortController,
    navigator: {},
    document: {
      readyState: 'loading', addEventListener() {},
      getElementById(id) {
        return els[id] ||= { textContent: '', disabled: false, style: {}, value: 'all', focus() {}, select() {}, classList: { add() {}, remove() {} } };
      }
    },
    localStorage: {
      getItem: key => data.get(key) || null,
      setItem: (key, value) => data.set(key, String(value))
    },
    setTimeout(fn, ms) {
      waits.push(ms);
      return setTimeout(fn, ms === 30000 ? (options.timeout ? 15 : 1000) : 0);
    },
    clearTimeout,
    setInterval(fn) { intervals.add(fn); return fn; },
    clearInterval(fn) { intervals.delete(fn); },
    window: { MQT_CURATED: { '2020s': songs } },
    async fetch(url, opts) {
      const u = new URL(url);
      const method = opts.method || 'GET';
      calls.push({ path: u.pathname, method });
      if (u.hostname === 'accounts.spotify.com' && options.tokenTimeout) {
        return new Promise((resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const e = new Error('Aborted'); e.name = 'AbortError'; reject(e);
          });
        });
      }
      if (u.pathname === '/v1/playlists/saved') {
        return response({ id: 'saved', name: 'Quiz', external_urls: { spotify: 'https://open.spotify.com/playlist/saved' } });
      }
      if (u.pathname === '/v1/playlists/saved/items' && method === 'GET') {
        if (options.readFailure) return response({ error: { message: 'Cannot compare' } }, 403);
        const offset = Number(u.searchParams.get('offset') || 0);
        const page = playlist.slice(offset, offset + 100);
        return response({
          items: page.map(t => ({ item: t })),
          next: offset + 100 < playlist.length
            ? 'https://api.spotify.com/v1/playlists/saved/items?offset=' + (offset + 100) : null
        });
      }
      if (u.pathname === '/v1/search') {
        assert.equal(writing, false, 'searches must wait until the previous batch is saved');
        searchCount++;
        if (options.searchFailure && searchCount === options.searchFailure) {
          return response({ error: { message: 'Cooldown' } }, 429, '3600');
        }
        if (options.timeout) {
          return new Promise((resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              const e = new Error('Aborted'); e.name = 'AbortError'; reject(e);
            });
          });
        }
        const n = Number(u.searchParams.get('q').match(/Song (\d+)/)[1]);
        if (options.unmatched) return response({ tracks: { items: [track(9999)] } });
        return response({ tracks: { items: [track(n)] } });
      }
      if (u.pathname === '/v1/playlists/saved/items' && method === 'POST') {
        batchCount++;
        if (options.writeFailure && batchCount === options.writeFailure) {
          return response({ error: { message: 'Write refused' } }, 403);
        }
        writing = true;
        const uris = JSON.parse(opts.body).uris;
        assert.ok(uris.length <= 10);
        await new Promise(r => setTimeout(r, 15));
        uris.forEach(uri => playlist.push(track(Number(uri.split(':').pop()))));
        writing = false;
        return response({ snapshot_id: 'snapshot' + batchCount }, 201);
      }
      throw new Error('Unexpected API call: ' + method + ' ' + u.pathname);
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    context, data, playlist, calls, waits, els, intervals,
    searchCount: () => searchCount,
    build: () => context.importTest.createCuratedPlaylist('all')
  };
}

test('resumes after 735 tracks: reads every page before searching, then saves 10 at a time', async () => {
  const h = setup(765, { playlist: Array.from({ length: 735 }, (_, i) => track(i)) });
  await h.build();
  assert.equal(h.playlist.length, 765);
  assert.equal(h.searchCount(), 30);
  const firstSearch = h.calls.findIndex(c => c.path === '/v1/search');
  assert.equal(firstSearch, 9); // metadata + eight pages
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 3);
  assert.match(h.els.curatedStatus.textContent, /30 added this run; 735 already saved/);
  assert.equal(h.intervals.size, 0);
});

test('a long cooldown at song 29 stops promptly with the exact error, preserving saved batches', async () => {
  const h = setup(40, { searchFailure: 29 });
  await h.build();
  assert.equal(h.searchCount(), 29);
  assert.equal(h.playlist.length, 20);
  assert.match(h.els.curatedStatus.textContent, /API 429.*Retry-After: 3600s/);
  assert.equal(h.els.curatedBuildBtn.disabled, false);
  assert.ok(h.waits.every(ms => ms <= 30000), 'must not sleep for an hour');
  assert.equal(JSON.parse(h.data.get('mqt_curated')).hasOwnProperty('artist 27|song 27'), true);
  const resume = setup(40, { data: h.data, playlist: h.playlist });
  await resume.build();
  assert.equal(resume.playlist.length, 40);
  assert.equal(resume.searchCount(), 12, 'cached but unsaved songs should not need another search');
});

test('write failure stops further searches; restarting appends only missing tracks', async () => {
  const h = setup(35, { writeFailure: 2 });
  await h.build();
  assert.equal(h.searchCount(), 20);
  assert.equal(h.playlist.length, 10);
  assert.match(h.els.curatedStatus.textContent, /API 403.*Write refused/);
  assert.ok(!h.calls.some(c => c.path.endsWith('/tracks')), 'permission errors must not probe another write endpoint');
  const resume = setup(35, { data: h.data, playlist: h.playlist });
  await resume.build();
  assert.equal(resume.playlist.length, 35);
  assert.equal(new Set(resume.playlist.map(t => t.uri)).size, 35);
});

test('failed comparison stops without searching, writing or creating a duplicate playlist', async () => {
  const h = setup(40, { readFailure: true });
  await h.build();
  assert.equal(h.searchCount(), 0);
  assert.ok(!h.calls.some(c => c.method === 'POST'));
  assert.match(h.els.curatedStatus.textContent, /Cannot compare/);
});

test('unrelated search hits are not imported or reported as up to date', async () => {
  const h = setup(2, { unmatched: true });
  await h.build();
  assert.equal(h.playlist.length, 0);
  assert.equal(h.searchCount(), 4);
  assert.match(h.els.curatedStatus.textContent, /2 songs had no matching artist\/title.*pending/);
});

test('a hanging fetch is aborted and shown instead of freezing forever', async () => {
  const h = setup(2, { timeout: true });
  await h.build();
  assert.match(h.els.curatedStatus.textContent, /timed out after 30 seconds/);
  assert.equal(h.intervals.size, 0);
});

test('a hanging token refresh is also bounded', async () => {
  const h = setup(2, { tokenTimeout: true });
  await h.build();
  assert.match(h.els.curatedStatus.textContent, /timed out after 30 seconds: token refresh/);
  assert.equal(h.searchCount(), 0);
  assert.equal(h.intervals.size, 0);
});

test('a short search cooldown retries the same song without losing progress', async () => {
  const h = setup(12);
  const fetch = h.context.fetch;
  let limited = false;
  h.context.fetch = async (url, opts) => {
    if(!limited && url.includes('/search')) {
      limited = true;
      return response({ error: { message: 'Cooldown' } }, 429, '1');
    }
    return fetch(url, opts);
  };
  await h.build();
  assert.equal(h.playlist.length, 12);
  assert.ok(h.waits.includes(2000));
  assert.match(h.els.curatedStatus.textContent, /12 added this run/);
});

test('diagnostics include comparison, request, retry and failure details without credentials', async () => {
  const h = setup(12, { searchFailure: 1 });
  h.data.set('mqt_access', 'SECRET-ACCESS-TOKEN');
  h.data.set('mqt_refresh', 'SECRET-REFRESH-TOKEN');
  await h.build();
  await h.context.importTest.copyImportDiagnostics();
  const text=h.els.curatedDiagnostics.value;
  const report=JSON.parse(text);
  assert.equal(report.version,'25');
  assert.equal(report.outcome,'stopped');
  assert.equal(report.progress.checked,0);
  assert.equal(report.events.find(e=>e.event==='comparison').missing,12);
  const limited=report.events.find(e=>e.event==='response'&&e.status===429);
  assert.equal(limited.retryAfter,'3600');
  assert.ok(report.events.some(e=>e.event==='request'&&e.query.q==='Song 0 Artist 0'));
  assert.ok(!text.includes('SECRET-'));
  assert.ok(!text.includes('Bearer'));
  assert.ok(!text.includes('/playlists/saved'));
});

test('persistent one-second 429s report retries and accumulated wait accurately', async () => {
  const h=setup(2);
  const fetch=h.context.fetch;
  h.context.fetch=async(url,opts)=>url.includes('/search')
    ?response({error:{message:'Still limited'}},429,'1'):fetch(url,opts);
  await h.build();
  assert.match(h.els.curatedStatus.textContent,/6 seconds of waiting and 3 retries.*Retry-After: 1s/);
  await h.context.importTest.copyImportDiagnostics();
  const report=JSON.parse(h.els.curatedDiagnostics.value);
  assert.equal(report.events.filter(e=>e.event==='response'&&e.status===429).length,4);
  assert.equal(report.events.filter(e=>e.event==='cooldown').length,3);
});

test('missing Retry-After uses increasing waits and reports the Spotify error without inventing a header', async () => {
  const h=setup(2);
  const fetch=h.context.fetch;
  h.context.fetch=async(url,opts)=>url.includes('/search')
    ?response({error:{message:'Search quota exceeded'}},429,null):fetch(url,opts);
  await h.build();
  assert.match(h.els.curatedStatus.textContent,/35 seconds of waiting and 3 retries/);
  assert.match(h.els.curatedStatus.textContent,/Retry-After unavailable.*Search quota exceeded/);
  assert.ok(!h.els.curatedStatus.textContent.includes('Retry-After: 1s'));
  await h.context.importTest.copyImportDiagnostics();
  const report=JSON.parse(h.els.curatedDiagnostics.value);
  assert.deepEqual(report.events.filter(e=>e.event==='cooldown').map(e=>e.seconds),[5,10,20]);
  assert.ok(report.events.some(e=>e.event==='rate-limit'&&e.message==='Search quota exceeded'&&e.retryAfterSource==='fallback-backoff'));
});

test('missing-header rate limit can recover on a later retry and save tracks', async () => {
  const h=setup(12);
  const fetch=h.context.fetch;
  let attempts=0;
  h.context.fetch=async(url,opts)=>{
    if(url.includes('/search')&&attempts++<2)return response({},429,null);
    return fetch(url,opts);
  };
  await h.build();
  assert.equal(h.playlist.length,12);
  assert.ok(h.waits.includes(5000)&&h.waits.includes(10000));
});
