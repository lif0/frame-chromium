import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHLS, safeFilename } from '../src/hls.js';
const base = 'https://video.example/id/master.m3u8?token=secret';
test('selectable resolutions keep signed video URLs and the matching default audio', () => {
  const parsed = parseHLS(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English, original",DEFAULT=YES,URI="audio.m3u8?sign=xyz"
#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1280x720,AUDIO="a",CODECS="avc1,mp4a"
video.m3u8?quality=720&sign=xyz
#EXT-X-STREAM-INF:BANDWIDTH=2000,RESOLUTION=1920x1080,AUDIO="a"
video.m3u8?quality=1080&sign=xyz`, base);
  assert.equal(parsed.type, 'master');
  assert.deepEqual(parsed.variants.map(v => v.height), [1080, 720]);
  assert.equal(parsed.variants[0].url, 'https://video.example/id/video.m3u8?quality=1080&sign=xyz');
  assert.equal(parsed.variants[0].audio, 'https://video.example/id/audio.m3u8?sign=xyz');
});
test('Kinescope byte ranges retain per-segment query strings and init map', () => {
  const parsed = parseHLS(`#EXTM3U
#EXT-X-MAP:URI="https://cdn.example/1080p.mp4",BYTERANGE="801@0"
#EXTINF:4,
#EXT-X-BYTERANGE:1000@801
https://cdn.example/1080p.mp4?kcd=one
#EXTINF:3.28,
#EXT-X-BYTERANGE:900@1801
https://cdn.example/1080p.mp4?kcd=two
#EXT-X-ENDLIST`, base);
  assert.deepEqual(parsed.init.range, { start: 0, end: 800 });
  assert.deepEqual(parsed.segments[1].range, { start: 1801, end: 2700 });
  assert.equal(parsed.segments[1].url, 'https://cdn.example/1080p.mp4?kcd=two');
  assert.equal(parsed.duration, 7.279999999999999);
});
test('implicit ranges must continue on the same resource', () => {
  const valid = '#EXTM3U\n#EXTINF:4,\n#EXT-X-BYTERANGE:20@10\na.mp4\n#EXTINF:4,\n#EXT-X-BYTERANGE:30\na.mp4\n#EXT-X-ENDLIST';
  assert.deepEqual(parseHLS(valid, base).segments[1].range, { start: 30, end: 59 });
  assert.throws(() => parseHLS(valid.replace('30\na.mp4', '30\nb.mp4'), base), /диапазон/);
});
test('ordinary TS segments resolve relative paths', () => {
  const parsed = parseHLS('#EXTM3U\n#EXTINF:5,\n../one.ts\n#EXT-X-ENDLIST', base);
  assert.equal(parsed.init, null);
  assert.equal(parsed.segments[0].url, 'https://video.example/one.ts');
});
test('unsupported or unsafe manifests fail explicitly', () => {
  assert.throws(() => parseHLS('<html>Login</html>', base), /не HLS/);
  assert.throws(() => parseHLS('#EXTM3U\n#EXTINF:4,\na.ts', base), /эфир/);
  assert.throws(() => parseHLS('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-ENDLIST', base), /зашифрован/);
  assert.throws(() => parseHLS('#EXTM3U\n#EXT-X-DISCONTINUITY\n#EXT-X-ENDLIST', base), /шкалы/);
  assert.throws(() => parseHLS('#EXTM3U\n#EXTINF:4,\nfile:///etc/passwd\n#EXT-X-ENDLIST', base), /адрес/);
});
test('filenames cannot become filesystem paths', () => {
  assert.equal(safeFilename('../test/name:video'), '_test_name_video');
  assert.equal(safeFilename('...'), 'Видео');
});
