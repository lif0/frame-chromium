import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remuxFiles } from '../dist/remux.js';

let hasFFmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFFmpeg = false; }
function ffmpeg(args) { return execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 10 * 1024 * 1024 }); }

test('disk-backed fragmented video and audio produce a playable MP4 without changing frames', { skip: !hasFFmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frame-remux-'));
  let file;
  try {
    const video = join(dir, 'video.mp4'), audio = join(dir, 'audio.mp4'), output = join(dir, 'output.mp4');
    ffmpeg(['-f','lavfi','-i','testsrc2=size=320x180:rate=25','-t','2','-c:v','libx264','-bf','2','-g','25','-movflags','+frag_keyframe+empty_moov+default_base_moof',video]);
    ffmpeg(['-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:a','aac','-movflags','+frag_keyframe+empty_moov+default_base_moof',audio]);
    file = await open(output, 'w');
    let writes = 0;
    await remuxFiles(await openAsBlob(video), await openAsBlob(audio), { async write(chunk) {
      assert.equal(chunk.type, 'write');
      await file.write(chunk.data, 0, chunk.data.length, chunk.position); writes++;
    } }, { duration: 2 });
    await file.close(); file = null;
    assert.ok(writes > 0);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-show_streams','-of','json',output]));
    assert.deepEqual(probe.streams.map(s => s.codec_name), ['h264','aac']);
    const hashes = path => ffmpeg(['-i',path,'-map','0:v:0','-f','framemd5','-']).toString().split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').at(-1).trim());
    assert.deepEqual(hashes(output), hashes(video));
    assert.ok(Number(probe.streams[0].duration) >= 1.9 && Number(probe.streams[0].duration) < 2.2);
    assert.ok(Number(probe.streams[1].duration) >= 1.9 && Number(probe.streams[1].duration) < 2.2);
    // Audio must also decode successfully after remuxing.
    ffmpeg(['-i',output,'-map','0:a:0','-f','null','-']);
  } finally { await file?.close(); await rm(dir, { recursive: true, force: true }); }
});
