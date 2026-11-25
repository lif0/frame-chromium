import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { youtubeVideoId, youtubeURL, youtubePageInfo, youtubeOptions } from '../src/youtube.js';
import { candidateList, uniquePlaylists } from '../src/media-context.js';
import { candidateSignature } from '../src/badge.js';
import { collectPreviews, matchingPreview } from '../src/previews.js';
import { mediaViewKey, mediaViewSignature, cachedMediaView } from '../src/media-view-cache.js';

const source = (await readFile(new URL('../src/popup.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Minimal DOM for running the actual popup flow, with independent page/helper responses.
class Element {
  constructor(tag = 'div', className = '') {
    Object.assign(this, { tag, className, children: [], attributes: {}, listeners: {}, hidden: false, disabled: false });
    this.classList = { add() {}, remove() {} };
  }
  get isConnected() { return this.connected || !!this.parent?.isConnected; }
  get childElementCount() { return this.children.length; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tag === 'fragment') this.append(...node.children);
      else { node.parent = this; this.children.push(node); }
    }
  }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parent = null; }); this.children = []; this.append(...nodes); }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector) return child;
      const nested = child.querySelector(selector); if (nested) return nested;
    }
    return null;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}

function template() {
  const fragment = new Element('fragment'), root = new Element('article', 'video-card');
  for (const cls of ['video-title', 'video-source', 'thumbnail', 'format-badge', 'duration']) root.append(new Element('span', cls));
  const controls = new Element('div', 'video-controls');
  controls.append(new Element('select'), new Element('span', 'download-size'), new Element('button', 'download'));
  root.append(controls); fragment.append(root); return fragment;
}

async function popup({ url = 'https://www.youtube.com/watch?v=6-fbbGG-prY', candidates = [], playlist, records = {}, now = Date.now, previewFrame = async () => null } = {}) {
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) { const element = new Element(); element.connected = true; elements.set(selector, element); }
    return elements.get(selector);
  };
  get('#video-template').content = { cloneNode: template };
  get('#empty').hidden = true;
  const metadata = deferred(), requests = [], messages = [];
  const chrome = {
    runtime: { getManifest: () => ({ version: '0.1.0' }), sendMessage(message) {
      messages.push(message);
      if (message.type !== 'youtube-info') return Promise.resolve({ ok: true });
      const request = deferred(); requests.push(request); return request.promise;
    } },
    storage: { local: { get: async () => ({}) }, session: {
      get: async () => structuredClone({ ...records, 'tab:1': candidates }),
      set: async data => Object.assign(records, structuredClone(data)),
      remove: async key => { delete records[key]; },
    }, onChanged: { addListener() {} } },
    tabs: { get: async () => ({ id: 1, title: 'Page title', url }) },
    scripting: { executeScript: () => metadata.promise },
  };
  const context = vm.createContext({
    chrome, document: { querySelector: get, createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment') },
    location: { search: '?tab=1' }, URL, URLSearchParams, queueMicrotask,
    youtubeVideoId, youtubeURL, youtubePageInfo, youtubeOptions,
    candidateList, uniquePlaylists, candidateSignature, collectPreviews, matchingPreview, playlist,
    mediaViewKey, mediaViewSignature, cachedMediaView, Date: class extends Date { static now() { return now(); } },
    estimateSize: video => ({ bytes: 1024, duration: video.duration }), previewFrame,
    t: value => value, translateMessage: value => value, onLanguageChange() {}, initUI: async () => {},
    BUILD_VERSION: '0.1.0', timeLabel: seconds => `${seconds}s`, sizeLabel: size => String(size.bytes),
  });
  await vm.runInContext(`(async () => { ${source}\n })()`, context);
  await tick();
  return { get, metadata, requests, messages, card: () => get('#videos').children[0] };
}

const info = { videoId: '6-fbbGG-prY', title: 'Helper title', duration: 7267,
  formats: [{ format_id: '18', height: 360, vcodec: 'avc1', acodec: 'aac', filesize: 1024 }] };

test('YouTube card appears before page metadata or helper formats; download waits for formats', async () => {
  const ui = await popup();
  assert.equal(ui.requests.length, 1, 'helper starts without waiting for page metadata');
  assert.equal(ui.get('#loading').hidden, true);
  assert.equal(ui.card().querySelector('.video-title').textContent, 'Page title');
  assert.equal(ui.card().querySelector('.download').disabled, true);
  assert.equal(ui.card().querySelector('select').disabled, true);
  ui.metadata.resolve([{ result: { videoId: info.videoId, title: 'Player title', duration: 7267 } }]);
  await tick();
  assert.equal(ui.card().querySelector('.video-title').textContent, 'Player title');
  assert.equal(ui.card().querySelector('.duration').textContent, '7267s');
  assert.equal(ui.card().querySelector('.download').disabled, true);
  ui.requests[0].resolve({ info }); await tick();
  assert.equal(ui.get('#videos').childElementCount, 1);
  assert.equal(ui.card().querySelector('.video-title').textContent, 'Helper title');
  assert.equal(ui.card().querySelector('.download').disabled, false);
  assert.equal(ui.card().querySelector('select').disabled, false);
});

test('failure keeps metadata and disables download; explicit refresh recovers', async () => {
  const ui = await popup();
  ui.requests[0].resolve({ error: 'Sign-in required' }); await tick();
  assert.equal(ui.card().querySelector('.video-title').textContent, 'Page title');
  assert.equal(ui.card().querySelector('.download').disabled, true);
  assert.equal(ui.card().querySelector('.video-controls').attributes['aria-busy'], 'false');
  assert.equal(ui.get('#notice').textContent, 'Sign-in required');
  assert.equal(ui.get('#refresh').disabled, false);
  ui.get('#refresh').listeners.click(); await tick();
  assert.equal(ui.messages[1].refresh, true);
  ui.requests[1].resolve({ info }); await tick();
  assert.equal(ui.card().querySelector('.download').disabled, false);
  // A late page response must not replace authoritative helper metadata.
  ui.metadata.resolve([{ result: { videoId: info.videoId, title: 'Late page title' } }]); await tick();
  assert.equal(ui.card().querySelector('.video-title').textContent, 'Helper title');
});

test('known HLS candidates render and update the badge while iframe discovery and previews are still pending', async () => {
  const media = 'https://cdn.example/movie/index.m3u8';
  const candidates = [
    { id: 'cdn', type: 'hls', url: 'https://cdn.example/movie/master.m3u8', source: 'https://player.example/' },
    { id: 'proxy', type: 'hls', url: 'https://player.example/master.m3u8', source: 'https://player.example/' },
    { id: 'child', type: 'hls', url: media, source: 'https://player.example/' },
  ];
  const ui = await popup({ url: 'https://site.example/film', candidates, playlist: async url => url === media
    ? { type: 'media', duration: 5120, segments: [] }
    : { type: 'master', variants: [{ url: media, height: 368 }] } });
  assert.equal(ui.get('#videos').childElementCount, 1);
  assert.equal(ui.card().querySelector('.download').disabled, false);
  assert.equal(ui.get('#loading').hidden, true);
  assert.equal(ui.get('#count').textContent, 1);
  const badge = ui.messages.find(m => m.type === 'visible-videos');
  assert.equal(badge.count, 1);
  assert.equal(badge.signature, candidateSignature(candidates));
  ui.metadata.resolve([{ result: [{ src: 'blob:test', image: 'data:image/jpeg;base64,test', duration: 5120, source: 'https://player.example/' }] }]);
  await tick();
  assert.equal(ui.card().querySelector('.thumbnail').src, 'data:image/jpeg;base64,test');
  assert.equal(ui.get('#videos').childElementCount, 1);
});

test('reopening a site uses cached qualities, sizes and previews for two minutes; refresh bypasses cache', async () => {
  let calls = 0, previews = 0, time = Date.now();
  const records = {}, candidates = [{ id: 'movie', type: 'hls', url: 'https://cdn.example/movie/index.m3u8', source: 'https://player.example/' }];
  const settings = { url: 'https://site.example/film', candidates, records, now: () => time,
    playlist: async () => { calls++; return { type: 'media', duration: 5120, segments: [] }; },
    previewFrame: async () => { previews++; return { image: 'data:image/jpeg;base64,preview', fingerprint: 'same-film' }; } };
  const first = await popup(settings);
  assert.equal(first.get('#videos').childElementCount, 1);
  const initialCalls = calls, initialTime = records['media-view:1'].time;
  assert.ok(initialCalls > 0);
  assert.equal(records['media-view:1'].items[0].options[0].size.bytes, 1024);
  time += 119999;
  const reopened = await popup(settings);
  assert.equal(reopened.get('#videos').childElementCount, 1);
  assert.equal(reopened.card().querySelector('.download-size').textContent, '1024');
  assert.equal(reopened.card().querySelector('.thumbnail').src, 'data:image/jpeg;base64,preview');
  assert.equal(calls, initialCalls, 'reopening must not refetch playlists or sizes');
  assert.equal(previews, 1, 'reopening must not download preview fragments');
  assert.equal(records['media-view:1'].time, initialTime, 'reopening must not extend expiry');
  await reopened.get('#refresh').listeners.click(); await tick();
  assert.ok(calls > initialCalls, 'explicit refresh fetches new playlists');
  const refreshedCalls = calls;
  time += 119999;
  await popup(settings);
  assert.equal(calls, refreshedCalls);
  time++;
  await popup(settings);
  assert.ok(calls > refreshedCalls, 'expiry fetches new playlists');
});
