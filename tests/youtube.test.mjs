import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeVideoId, youtubeOptions } from '../src/youtube.js';

test('YouTube links accept a single video and reject lookalike hosts and invalid IDs', () => {
  for (const url of ['https://www.youtube.com/watch?v=q6fgVVmdpgY&list=PL123', 'https://youtu.be/q6fgVVmdpgY?t=4', 'https://m.youtube.com/shorts/q6fgVVmdpgY']) assert.equal(youtubeVideoId(url), 'q6fgVVmdpgY');
  for (const url of ['https://youtube.com.evil.test/watch?v=q6fgVVmdpgY', 'https://www.youtube.com/', 'https://www.youtube.com/watch?v=--help', 'file:///watch?v=q6fgVVmdpgY']) assert.equal(youtubeVideoId(url), null);
});
test('YouTube combines video and default audio sizes and exposes one option per height', () => {
  const info = { videoId: 'q6fgVVmdpgY', duration: 100, formats: [
    { format_id: '137', height: 1080, fps: 30, ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', filesize: 1000 },
    { format_id: '248', height: 1080, fps: 30, ext: 'webm', vcodec: 'vp9', acodec: 'none', filesize: 900 },
    { format_id: '18', height: 360, ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', filesize: 500 },
    { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', filesize: 100, language_preference: 10 },
    { format_id: '141', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', filesize: 200, language_preference: -10 },
    { format_id: '400', height: 1440, vcodec: 'av01', acodec: 'none', has_drm: true },
  ] };
  const options = youtubeOptions(info);
  assert.deepEqual(options.map(v => [v.height, v.formatId, v.size.bytes]), [[1080, '137+140', 1100], [360, '18', 500]]);
  assert.ok(options.every(v => v.size.exact));
  assert.throws(() => youtubeOptions({ ...info, isLive: true }), /эфиров/);
});
test('silent video-only formats are not offered without an audio track', () => {
  assert.deepEqual(youtubeOptions({ formats: [{ format_id: '137', height: 1080, vcodec: 'avc1', acodec: 'none' }] }), []);
});
