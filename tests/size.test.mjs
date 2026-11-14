import test from 'node:test';
import assert from 'node:assert/strict';
import { trackSize, estimateSize, bytesLabel, sizeLabel } from '../src/size.js';
const track = (length, duration = 10) => ({ type: 'media', init: { range: { start: 0, end: 9 } }, segments: [{ range: { start: 10, end: length + 9 } }], duration });
test('exact size includes init segments and separate audio', () => {
  assert.equal(trackSize(track(1000)), 1010);
  assert.deepEqual(estimateSize(track(1000), track(200)), { bytes: 1220, exact: true, duration: 10 });
  assert.deepEqual(estimateSize(track(2000), track(200)), { bytes: 2220, exact: true, duration: 10 });
});
test('bitrate estimate is explicitly approximate and does not double count audio', () => {
  const video = { type: 'media', segments: [{ url: 'x.ts' }], duration: 20 };
  assert.deepEqual(estimateSize(video, track(200), 800000), { bytes: 2000000, exact: false, duration: 20 });
  assert.equal(sizeLabel(estimateSize(video, null, 0)), 'Размер неизвестен');
  assert.match(sizeLabel(estimateSize(video, null, 800000)), /^≈ /);
  assert.equal(bytesLabel(2 * 1024 ** 3), '2.00 ГБ');
});
