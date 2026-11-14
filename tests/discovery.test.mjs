import test from 'node:test';
import assert from 'node:assert/strict';

test('observed access survives content discovery and hundreds of film segments without losing the master', async () => {
  const handlers = {}, records = {}, badges = [], titles = [], icons = [];
  globalThis.OffscreenCanvas = class {
    getContext() { return new Proxy({}, { get: (_, name) => name === 'getImageData' ? () => ({}) : () => {} }); }
  };
  const event = name => ({ addListener: fn => { handlers[name] = fn; } });
  globalThis.chrome = {
    runtime: { getURL: p => `chrome-extension://test/${p}`, onMessage: event('message') },
    webRequest: Object.fromEntries(['onSendHeaders', 'onHeadersReceived', 'onCompleted', 'onErrorOccurred'].map(name => [name, event(name)])),
    tabs: { onUpdated: event('updated'), onRemoved: event('removed') },
    action: { setBadgeText: async data => badges.push(data), setIcon: async data => icons.push(data), setTitle: async data => titles.push(data) },
    storage: { session: {
      get: async key => ({ [key]: structuredClone(records[key]) }),
      set: async data => Object.assign(records, structuredClone(data)),
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete records[key]; },
    } },
  };
  const source = 'https://player.example/watch?id=1', master = 'https://cdn.example/movie/master.m3u8';
  const requestHeaders = [{ name: 'Authorizations', value: 'Bearer media-token' }, { name: 'Accepts-Controls', value: 'media-control' }, { name: 'Referer', value: source }, { name: 'Origin', value: 'https://player.example' }, { name: 'Cookie', value: 'private-cookie' }];
  const observe = (id, url, mime, headers = requestHeaders) => {
    handlers.onSendHeaders({ requestId: id, tabId: 1, method: 'GET', url, requestHeaders: headers });
    handlers.onHeadersReceived({ requestId: id, tabId: 1, url, initiator: 'https://player.example', statusCode: 200, responseHeaders: [{ name: 'Content-Type', value: mime }] });
    handlers.onCompleted({ requestId: id });
  };
  const flush = () => new Promise(resolve => handlers.message({ type: 'found', url: master }, { tab: { id: 1 }, url: source }, resolve));
  try {
    await import('../src/background.js?discovery-test');
    observe('master', master, 'application/vnd.apple.mpegurl');
    for (let i = 0; i < 120; i++) observe(String(i), `https://cdn.example/movie/seg-${i}.m4s`, 'video/mp4');
    observe('api', 'https://cdn.example/movie/account', 'application/json', [{ name: 'Authorizations', value: 'unrelated-token' }]);
    await flush();
    assert.equal(records['tab:1'].length, 1);
    assert.equal(titles.at(-1).title, 'Найдено видео: 1 — Frame');
    assert.ok(icons.at(-1).imageData);
    assert.equal(badges.at(-1).text, '');
    const video = records['tab:1'][0];
    assert.equal(video.url, master);
    assert.equal(video.source, source);
    assert.equal(video.access.origin, 'https://player.example');
    assert.equal(video.access.headers.authorizations, 'Bearer media-token');
    assert.equal(JSON.stringify(records).includes('private-cookie'), false);
    assert.equal(JSON.stringify(records).includes('unrelated-token'), false);
    observe('refresh', 'https://cdn.example/movie/seg-121.m4s', 'video/mp4', [{ name: 'Authorizations', value: 'Bearer refreshed-token' }, { name: 'Referer', value: source }]);
    await flush();
    assert.equal(records['tab:1'][0].access.headers.authorizations, 'Bearer refreshed-token');
    await new Promise(resolve => handlers.message({ type: 'visible-videos', tabId: 1, signature: records['tab:1'][0].id, count: 0 }, { url: 'chrome-extension://test/popup.html' }, resolve));
    assert.equal(badges.at(-1).text, '');
    assert.ok(icons.at(-1).path, 'zero count restores the plain icon');
    await flush();
    assert.equal(badges.at(-1).text, '', 'repeat observations preserve the resolved count');
  } finally { delete globalThis.chrome; delete globalThis.OffscreenCanvas; }
});
