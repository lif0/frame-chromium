import test from 'node:test';
import assert from 'node:assert/strict';
import { captureContext, scopedHeaders, mediaKind, candidateList, uniquePlaylists } from '../src/media-context.js';
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

test('proxy and CDN masters resolving to identical tracks produce one card with the latest access', () => {
  const options = [{ url: 'https://cdn.example/368.m3u8', audio: null }, { url: 'https://cdn.example/720.m3u8', audio: 'https://cdn.example/audio.m3u8' }];
  const first = { video: { type: 'hls', url: 'https://cdn.example/master.m3u8', source: 'https://player.example/' }, options };
  const latest = { ...first, video: { ...first.video, url: 'https://player.example/proxy/master.m3u8', access: { headers: { authorization: 'updated' } } }, options: [...options].reverse() };
  assert.deepEqual(uniquePlaylists([first, latest]), [latest]);
});

test('equal quality and duration cannot merge different videos, audio tracks or access sources', () => {
  const first = { video: { type: 'hls', source: 'https://player.example/1' }, options: [{ url: 'https://cdn.example/movie.m3u8?token=one', audio: 'https://cdn.example/en.m3u8' }], duration: 5120 };
  const others = [
    { ...first, options: [{ ...first.options[0], url: 'https://cdn.example/other.m3u8' }] },
    { ...first, options: [{ ...first.options[0], url: 'https://cdn.example/movie.m3u8?token=two' }] },
    { ...first, options: [{ ...first.options[0], audio: 'https://cdn.example/ru.m3u8' }] },
    { ...first, video: { ...first.video, source: 'https://player.example/2' } },
  ];
  assert.deepEqual(uniquePlaylists([first, ...others]), [first, ...others]);
});

test('origin-only Referer and the full iframe URL identify the same resolved stream', () => {
  const first = { video: { type: 'hls', source: 'https://player.example/' }, options: [{ url: 'https://cdn.example/movie/index.m3u8' }] };
  const iframe = { ...first, video: { ...first.video, source: 'https://player.example/balancer-api/iframe?id=1' } };
  assert.deepEqual(uniquePlaylists([first, iframe]), [iframe]);
  const unrelated = { ...iframe, video: { ...iframe.video, source: 'https://other.example/' } };
  assert.deepEqual(uniquePlaylists([iframe, unrelated]), [iframe, unrelated]);
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
