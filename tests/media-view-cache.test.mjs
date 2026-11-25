import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedMediaView, mediaViewSignature } from '../src/media-view-cache.js';

test('media cache expires at two minutes and rejects different pages, sources and access tokens', () => {
  const candidates = [{ id: '1', type: 'hls', url: 'https://cdn.example/movie.m3u8', source: 'https://player.example/', access: { headers: { authorization: 'old' } } }];
  const signature = mediaViewSignature(candidates);
  const entry = { time: 1000, url: 'https://site.example/one', signature, items: [{ options: [] }] };
  assert.equal(cachedMediaView(entry, entry.url, signature, 120999), entry.items);
  assert.equal(cachedMediaView(entry, entry.url, signature, 121000), null);
  assert.equal(cachedMediaView(entry, entry.url, signature, 999), null);
  assert.equal(cachedMediaView(entry, 'https://site.example/two', signature, 1001), null);
  for (const change of [{ source: 'https://other.example/' }, { access: { headers: { authorization: 'new' } } }, { url: 'https://cdn.example/movie.m3u8?new=1' }]) {
    const updated = mediaViewSignature([{ ...candidates[0], ...change }]);
    assert.equal(cachedMediaView(entry, entry.url, updated, 1001), null);
  }
  assert.equal(cachedMediaView({ ...entry, items: [] }, entry.url, signature, 1001), null);
});
