import test from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeInfoLoader } from '../src/youtube-info.js';
const url = 'https://www.youtube.com/watch?v=azblHVbIgF0';
test('YouTube lookup shares in-flight work, caches success, and refreshes explicitly or on expiry', async () => {
  let finish, calls = 0, time = 0;
  const loader = createYouTubeInfoLoader(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, () => time);
  const first = loader(url), second = loader(url);
  assert.equal(first, second); assert.equal(calls, 1);
  finish({ videoId: 'azblHVbIgF0' }); await first;
  await loader(url); assert.equal(calls, 1);
  const refreshed = loader(url, true); assert.equal(calls, 2); finish({}); await refreshed;
  time = 599999;
  await loader(url); assert.equal(calls, 2);
  time = 600000;
  const expired = loader(url); assert.equal(calls, 3); finish({}); await expired;
});
test('YouTube lookup does not cache failures', async () => {
  let calls = 0;
  const loader = createYouTubeInfoLoader(async () => { calls++; throw new Error('network'); });
  await assert.rejects(loader(url), /network/); await assert.rejects(loader(url), /network/);
  assert.equal(calls, 2);
  await assert.rejects(loader('https://example.com'), /ссылка/);
});
