import test from 'node:test';
import assert from 'node:assert/strict';
import { captureContext, scopedHeaders, mediaKind, candidateList } from '../src/media-context.js';
import { playlist, request } from '../src/network.js';

test('media access is scoped to the observed directory and excludes unrelated headers', () => {
  const context = captureContext('https://cdn.example/movie/seg-1.m4s', [
    { name: 'Authorizations', value: 'Bearer test-token' },
    { name: 'Accepts-Controls', value: 'test-control' },
    { name: 'Cookie', value: 'private-cookie' },
    { name: 'Referer', value: 'https://player.example/watch?id=1' },
  ]);
  assert.equal(context.source, 'https://player.example/watch?id=1');
  assert.deepEqual(scopedHeaders('https://cdn.example/movie/master.m3u8', context.access), { authorizations: 'Bearer test-token', 'accepts-controls': 'test-control' });
  for (const url of ['https://other.example/movie/a.m4s', 'http://cdn.example/movie/a.m4s', 'https://cdn.example/movie-other/a.m4s', 'https://cdn.example/movie/../other/a.m4s']) {
    assert.deepEqual(scopedHeaders(url, context.access), {});
  }
  assert.equal(JSON.stringify(context).includes('private-cookie'), false);
});

test('stream fragments cannot fill the candidate list even with video/mp4 MIME', () => {
  for (const file of ['seg-1.m4s', 'init-c1-f1-v1-a1.mp4', 'seg-15.ts', 'fragment-1.mp4']) {
    assert.equal(mediaKind(`https://cdn.example/movie/${file}`, 'video/mp4'), null);
  }
  assert.equal(mediaKind('https://cdn.example/movie/master.m3u8'), 'hls');
  assert.equal(mediaKind('https://cdn.example/opaque', 'application/vnd.apple.mpegurl'), 'hls');
  assert.equal(mediaKind('https://cdn.example/movie.mp4'), 'file');
});

test('an advertising master never hides a film media playlist on a different path', () => {
  const urls = ['https://ads.example/master.m3u8', 'https://ads.example/index.m3u8', 'https://film.example/index.m3u8', 'https://ads.example/other/index.m3u8'];
  assert.deepEqual(candidateList(urls.map(url => ({ url, type: 'hls' }))).map(v => v.url), [urls[0], urls[2], urls[3]]);
});

test('playlist and segment requests replay access headers, reject redirects, and retain byte ranges', async () => {
  const original = globalThis.fetch, calls = [];
  const access = captureContext('https://cdn.example/movie/master.m3u8', [{ name: 'Authorizations', value: 'Bearer test-token' }]).access;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('.m3u8')) return new Response('#EXTM3U\n#EXTINF:4,\nseg-1.m4s\n#EXT-X-ENDLIST');
    return new Response(new Uint8Array(4), { status: 206, headers: { 'content-range': 'bytes 0-3/4' } });
  };
  try {
    const media = await playlist('https://cdn.example/movie/index.m3u8', undefined, undefined, access);
    await request(media.segments[0].url, { access, range: { start: 0, end: 3 } });
    assert.ok(calls.every(c => c.headers.authorizations === 'Bearer test-token' && c.redirect === 'error'));
    assert.equal(calls[1].headers.Range, 'bytes=0-3');
    await request('https://different.example/segment', { access });
    assert.deepEqual(calls[2].headers, {});
  } finally { globalThis.fetch = original; }
});
