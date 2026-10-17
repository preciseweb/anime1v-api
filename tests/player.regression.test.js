const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

// Run the actual SPA with controllable network/media events, including responses
// arriving after abort. No provider, browser install or external service is used.
function createApp() {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.attributes = {};
      this.style = {};
      this.listeners = {};
      this.disabled = false;
      this.paused = true;
      this.readyState = 0;
      this.playCount = 0;
      const tokens = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => tokens.add(name)),
        remove: (...names) => names.forEach(name => tokens.delete(name)),
        contains: name => tokens.has(name),
        toggle: (name, force = !tokens.has(name)) => {
          if (force) tokens.add(name); else tokens.delete(name);
          return force;
        }
      };
      Object.defineProperty(this, 'className', {
        get: () => [...tokens].join(' '),
        set: value => { tokens.clear(); String(value).split(/\s+/).filter(Boolean).forEach(name => tokens.add(name)); }
      });
    }
    set innerHTML(value) { this.clear(); this._html = value; }
    get innerHTML() { return this._html || ''; }
    set textContent(value) { this.clear(); this._text = String(value); }
    get textContent() { return (this._text || '') + this.children.map(child => child.textContent).join(''); }
    clear() { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = ''; this._html = ''; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    removeAttribute(name) { delete this.attributes[name]; if (name === 'src') this.src = ''; }
    addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
    click() { if (this.disabled) return; const event = { target: this, preventDefault() {} }; this.listeners.click?.forEach(handler => handler(event)); this.onclick?.(event); }
    querySelectorAll(selector) { return descendants(this.children).filter(element => matches(element, selector)); }
    closest(selector) { return matches(this, selector) ? this : this.parentNode?.closest(selector); }
    pause() { this.paused = true; }
    load() {}
    play() { this.playCount++; this.paused = false; return Promise.resolve(); }
    canPlayType() { return ''; }
  }
  function descendants(elements) { return elements.flatMap(element => [element, ...descendants(element.children)]); }
  function matches(element, selector) {
    const classMatch = selector.match(/^\.([\w-]+)/);
    const attrMatch = selector.match(/\[([^=]+)="([^"]*)"\]/);
    return Boolean(classMatch && element.classList.contains(classMatch[1]) && (!attrMatch || element.getAttribute(attrMatch[1]) === attrMatch[2]));
  }
  const roots = [];
  for (const tag of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(tag[1]);
    element.id = tag[3];
    element.className = tag[2].match(/\bclass="([^"]*)"/)?.[1] || '';
    roots.push(element);
  }
  const all = () => descendants(roots);
  const byId = id => all().find(element => element.id === id) || null;
  const genre = new Element('button');
  genre.className = 'genre-chip active';
  genre.setAttribute('data-genre', '');
  byId('genre-filters').appendChild(genre);
  let boot;
  const document = {
    getElementById: byId,
    createElement: tag => new Element(tag),
    querySelectorAll: selector => all().filter(element => matches(element, selector)),
    querySelector: selector => all().find(element => matches(element, selector)),
    addEventListener: (event, callback) => { if (event === 'DOMContentLoaded') boot = callback; }
  };
  const pending = [];
  const timers = new Map();
  let timerId = 0;
  class FakeHls {
    static instances = [];
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
    static isSupported() { return true; }
    constructor() { this.events = {}; this.loads = 0; this.recoveries = 0; FakeHls.instances.push(this); }
    on(name, handler) { this.events[name] = handler; }
    emit(name, data) { this.events[name]?.(name, data); }
    loadSource(url) { this.url = url; }
    attachMedia(media) { this.media = media; }
    startLoad() { this.loads++; }
    recoverMediaError() { this.recoveries++; }
    destroy() { this.destroyed = true; }
  }
  vm.runInNewContext(source, {
    document,
    AbortController,
    Hls: FakeHls,
    IntersectionObserver: class { observe() {} disconnect() {} },
    console: { log() {}, warn() {}, error() {} },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject }))
  }, { filename: 'public/app.js' });
  boot();
  const request = (endpoint, contains = '') => {
    const item = pending.find(item => !item.done && item.url.startsWith(`/api/v1/anime/${endpoint}`) && decodeURIComponent(item.url).includes(contains));
    assert.ok(item, `Expected pending ${endpoint} request containing ${contains}`);
    return item;
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const respond = async (item, data) => { item.done = true; item.resolve({ json: async () => data }); await flush(); };
  const fail = async item => { item.done = true; item.reject(new Error('network failure')); await flush(); };
  return { byId, pending, request, respond, fail, flush, Hls: FakeHls, timers };
}

const anime = (name, count = 3) => ({
  title: `Anime ${name}`, url: `https://animeav1.com/media/${name}`,
  episodes: Array.from({ length: count }, (_, i) => ({ number: i + 1, url: `https://animeav1.com/media/${name}/${i + 1}` }))
});
const server = (name, url = `https://${name}.example/embed`) => ({ server: name, url });
const episode = (sub = [], dub = [], streamLinks) => ({ success: true, data: { servers: { sub, dub }, streamLinks } });
const resolved = (from, url, mediaType = 'mp4') => ({ success: true, resolvedFrom: from, streamUrl: url, mediaType });

async function catalog(app) {
  await app.respond(app.request('catalog'), { success: true, data: { results: [anime('a'), anime('b')], hasMore: false } });
}
async function openAnime(app, name = 'a') {
  await catalog(app);
  app.byId('results-grid').children[name === 'a' ? 0 : 1].click();
  await app.respond(app.request('info'), { success: true, data: anime(name) });
}
async function openEpisode(app, data, number = 1) {
  app.byId('episodes-grid').children[number - 1].click();
  await app.respond(app.request('episode'), data);
}
const buttons = app => app.byId('servers-list').querySelectorAll('.server-btn');

// Rendering/selection regressions: no inferred DUB and no omitted providers.
test('merges servers and streamLinks per language, deduplicates URLs and keeps every server selectable', async () => {
  const app = createApp();
  await openAnime(app);
  const first = server('voe', 'https://voe.sx/e/sub');
  const second = server('streamwish', 'https://streamwish.com/e/sub');
  const other = server('Other');
  const dubbed = server('Dubbed');
  await openEpisode(app, episode([first, second], [dubbed], { SUB: [first, other], DUB: [dubbed, server('Dubbed2')] }));
  assert.match(app.byId('variant-sub-btn').textContent, /\(3\)/);
  assert.match(app.byId('variant-dub-btn').textContent, /\(2\)/);
  assert.deepEqual(buttons(app).map(button => button.textContent), ['voe', 'streamwish', 'Other']);
  await app.respond(app.request('resolve'), resolved(second.url, 'https://cdn.example/sub.mp4'));
  assert.equal(buttons(app)[1].classList.contains('active'), true);
  assert.ok(buttons(app).every(button => !button.disabled && !button.classList.contains('server-failed')));
  // Earlier entries did not lose the Promise.any race because of an error.
  buttons(app)[0].click();
  assert.match(decodeURIComponent(app.request('resolve').url), /https:\/\/voe.sx\/e\/sub/);
});

test('plays a DUB-only episode and does not invent unavailable SUB servers', async () => {
  const app = createApp();
  await openAnime(app);
  const dubbed = server('Doblado');
  await openEpisode(app, { success: true, data: { streamLinks: { DUB: [dubbed] } } });
  assert.equal(app.byId('variant-sub-btn').disabled, true);
  assert.match(app.byId('variant-sub-btn').textContent, /\(0\)/);
  assert.equal(app.byId('variant-dub-btn').getAttribute('aria-pressed'), 'true');
  assert.equal(app.byId('iframe-player').src, dubbed.url);
  assert.match(app.byId('playing-subtitle').textContent, /DUB/);
});

test('keeps the chosen language across episodes, falling back only while it is unavailable', async () => {
  const app = createApp();
  await openAnime(app);
  await openEpisode(app, episode([server('sub1')], [server('dub1')]));
  app.byId('variant-dub-btn').click();
  assert.equal(app.byId('iframe-player').src, server('dub1').url);
  app.byId('player-next-btn').click();
  assert.equal(app.byId('iframe-player'), null, 'previous episode stops immediately');
  await app.respond(app.request('episode', '/a/2'), episode([server('sub2')]));
  assert.equal(app.byId('variant-dub-btn').disabled, true);
  assert.match(app.byId('variant-status').textContent, /DUB no disponible/);
  app.byId('player-next-btn').click();
  await app.respond(app.request('episode', '/a/3'), episode([server('sub3')], [server('dub3')]));
  assert.equal(app.byId('iframe-player').src, server('dub3').url);
  assert.equal(app.byId('variant-dub-btn').getAttribute('aria-pressed'), 'true');
});

test('a late anime detail response cannot replace the newly selected anime or its chapters', async () => {
  const app = createApp();
  await catalog(app);
  app.byId('results-grid').children[0].click();
  const old = app.request('info', '/a');
  app.byId('btn-back-to-search').click();
  app.byId('results-grid').children[1].click();
  const current = app.request('info', '/b');
  assert.equal(old.options.signal.aborted, true);
  await app.respond(current, { success: true, data: anime('b') });
  await app.respond(old, { success: true, data: anime('a') });
  assert.equal(app.byId('anime-title').textContent, 'Anime b');
  app.byId('episodes-grid').children[0].click();
  assert.ok(app.request('episode', '/b/1'));
});

test('a late episode response cannot replace servers for the current episode', async () => {
  const app = createApp();
  await openAnime(app);
  app.byId('episodes-grid').children[0].click();
  const old = app.request('episode', '/a/1');
  app.byId('player-next-btn').click();
  const current = app.request('episode', '/a/2');
  assert.equal(old.options.signal.aborted, true);
  await app.respond(current, episode([server('episode2')]));
  await app.respond(old, episode([server('episode1')]));
  assert.equal(app.byId('iframe-player').src, server('episode2').url);
  assert.match(app.byId('playing-subtitle').textContent, /Episodio 2/);
  assert.deepEqual(buttons(app).map(button => button.textContent), ['episode2']);
});

test('late SUB resolution cannot override a DUB selection', async () => {
  const app = createApp();
  await openAnime(app);
  const sub = server('voe', 'https://voe.sx/e/sub');
  const dub = server('voe', 'https://voe.sx/e/dub');
  await openEpisode(app, episode([sub], [dub]));
  const old = app.request('resolve', '/sub');
  app.byId('variant-dub-btn').click();
  const current = app.request('resolve', '/dub');
  assert.equal(old.options.signal.aborted, true);
  await app.respond(current, resolved(dub.url, 'https://cdn.example/dub.mp4'));
  await app.respond(old, resolved(sub.url, 'https://cdn.example/sub.mp4'));
  assert.equal(app.byId('main-player').src, 'https://cdn.example/dub.mp4');
  assert.equal(app.byId('player-external-btn').href, dub.url);
  assert.match(app.byId('playing-subtitle').textContent, /DUB/);
});

test('fallback uses the actual winning embed and failed resolution leaves buttons retryable', async () => {
  const app = createApp();
  await openAnime(app);
  const first = server('voe', 'https://voe.sx/e/first');
  const winner = server('streamwish', 'https://streamwish.com/e/winner');
  await openEpisode(app, episode([first, winner]));
  await app.respond(app.request('resolve'), resolved(winner.url, 'https://cdn.example/winner.mp4'));
  app.byId('main-player').onerror();
  assert.equal(app.byId('iframe-player').src, winner.url);
  buttons(app)[0].click();
  await app.fail(app.request('resolve'));
  assert.equal(app.byId('iframe-player').src, first.url);
  assert.ok(buttons(app).every(button => !button.disabled && !button.classList.contains('server-failed')));
  buttons(app)[0].click();
  assert.ok(app.request('resolve'));
});

test('manual server selection invalidates older parallel and single-server requests', async () => {
  const app = createApp();
  await openAnime(app);
  const first = server('voe', 'https://voe.sx/e/first');
  const second = server('streamwish', 'https://streamwish.com/e/second');
  await openEpisode(app, episode([first, second]));
  const automatic = app.request('resolve');
  buttons(app)[0].click();
  const manualFirst = app.pending.find(item => !item.done && item.url.includes('/resolve?url='));
  buttons(app)[1].click();
  const manualSecond = app.pending.find(item => !item.done && item.url.includes('/resolve?url=') && item !== manualFirst);
  await app.respond(manualSecond, resolved(second.url, 'https://cdn.example/second.mp4'));
  await app.respond(automatic, resolved(first.url, 'https://cdn.example/auto.mp4'));
  await app.fail(manualFirst);
  assert.equal(app.byId('main-player').src, 'https://cdn.example/second.mp4');
  assert.equal(app.byId('iframe-player'), null);
  assert.equal(app.byId('player-external-btn').href, second.url);
});

test('leaving the player ignores late resolution and old native video callbacks', async () => {
  const app = createApp();
  await openAnime(app);
  const first = server('voe', 'https://voe.sx/e/first');
  await openEpisode(app, episode([first]));
  await app.respond(app.request('resolve'), resolved(first.url, 'https://cdn.example/first.mp4'));
  const video = app.byId('main-player');
  const oldError = video.onerror;
  const oldCanPlay = video.oncanplay;
  buttons(app)[0].click();
  const pending = app.request('resolve');
  app.byId('btn-back-to-detail').click();
  await app.respond(pending, resolved(first.url, 'https://cdn.example/late.mp4'));
  oldError();
  oldCanPlay();
  assert.equal(video.src, '');
  assert.equal(video.playCount, 0);
  assert.equal(app.byId('iframe-player'), null);
  assert.equal(app.byId('detail-view').classList.contains('active'), true);
});

test('old HLS events and recovery timers cannot start or replace a new episode', async () => {
  const app = createApp();
  await openAnime(app);
  const first = server('voe', 'https://voe.sx/e/first');
  await openEpisode(app, episode([first]));
  await app.respond(app.request('resolve'), resolved(first.url, 'https://cdn.example/first.m3u8', 'hls'));
  const oldHls = app.Hls.instances[0];
  oldHls.emit('error', { fatal: true, type: 'network' });
  const oldTimer = [...app.timers.values()][0];
  assert.equal(oldHls.loads, 1);
  app.byId('player-next-btn').click();
  assert.equal(oldHls.destroyed, true);
  assert.equal(app.timers.size, 0);
  await app.respond(app.request('episode'), episode([server('newEpisode')]));
  oldHls.emit('manifest');
  oldHls.emit('error', { fatal: true, type: 'network' });
  oldHls.emit('error', { fatal: true, type: 'media' });
  oldTimer();
  assert.equal(app.byId('iframe-player').src, server('newEpisode').url);
  assert.equal(oldHls.loads, 1);
  assert.equal(oldHls.recoveries, 0);
  assert.equal(app.byId('main-player').playCount, 0);
});
