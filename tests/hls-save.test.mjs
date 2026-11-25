import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { writeResponse } from '../src/disk.js';

const source = (await readFile(new URL('../src/job-runner.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export async function downloadJob', 'async function downloadJob');
const job = { type: 'hls', url: 'https://cdn.example/index.m3u8', filename: 'video.mp4' };
function fixture({ cancelPending = false, saveError } = {}) {
  const events = [], files = new Map(), listeners = new Set();
  let started, releaseCancel;
  const saving = new Promise(resolve => { started = resolve; });
  const canceled = new Promise(resolve => { releaseCancel = resolve; });
  const item = { state: 'in_progress', bytesReceived: 0, totalBytes: 4, fileSize: 4 };
  const makeFile = name => {
    const handle = { bytes: [], closed: false,
      async createWritable() { return {
        async write(chunk) { handle.bytes.push(chunk.data || chunk); },
        async close() { handle.closed = true; events.push(`close:${name}`); },
        async abort() { events.push(`abort:${name}`); },
      }; },
      async getFile() { return new Blob(handle.bytes, { type: 'video/mp4' }); },
    };
    return handle;
  };
  const directory = { async getFileHandle(name) { if (!files.has(name)) files.set(name, makeFile(name)); return files.get(name); } };
  const root = { async getDirectoryHandle() { return directory; }, async removeEntry() { events.push('remove'); } };
  const chrome = { downloads: {
    async download(options) {
      assert.equal(options.saveAs, true);
      assert.equal(files.get('output.mp4').closed, true);
      events.push('save'); started();
      if (saveError) throw new Error(saveError);
      return 1;
    },
    async search() { return [item]; },
    async cancel() { events.push('cancel'); if (cancelPending) await canceled; },
    onChanged: { addListener: callback => listeners.add(callback), removeListener: callback => listeners.delete(callback) },
  } };
  const context = vm.createContext({ chrome, crypto: { randomUUID }, setInterval, clearInterval,
    navigator: { storage: { getDirectory: async () => root }, locks: { request: async (name, callback) => callback() } },
    URL: { createObjectURL: file => { assert.ok(file instanceof Blob); events.push('url'); return 'blob:output'; }, revokeObjectURL: () => events.push('revoke') },
    playlist: async () => ({ type: 'media', duration: 2, segments: [{ url: 'https://cdn.example/segment' }] }),
    request: async () => new Response(new Uint8Array([1, 2, 3, 4])),
    clearAbandonedJobs: async () => {}, writeResponse, estimateSize: () => ({ bytes: 4, exact: true }),
    remuxFiles: async (video, audio, writer) => {
      assert.ok(video instanceof Blob); assert.equal(audio, null);
      await writer.write({ type: 'write', position: 0, data: new Uint8Array([5, 6, 7, 8]) });
    },
  });
  const download = vm.runInContext(`${source}\n downloadJob;`, context);
  const finish = () => { item.state = 'complete'; item.bytesReceived = 4; listeners.forEach(fn => fn({ id: 1 })); };
  const interrupt = () => { item.state = 'interrupted'; item.error = 'USER_CANCELED'; listeners.forEach(fn => fn({ id: 1 })); };
  return { download, events, saving, releaseCancel, finish, interrupt, makeFile, listeners };
}

test('HLS without a save picker keeps its disk file alive until the browser completes saving', async () => {
  const f = fixture(), controller = new AbortController();
  const task = f.download(job, { signal: controller.signal });
  await f.saving;
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!f.events.includes('remove'));
  assert.ok(!f.events.includes('revoke'));
  f.finish();
  const result = await task;
  assert.equal(result.downloadId, 1); assert.equal(result.bytes, 4);
  assert.deepEqual(f.events.slice(-2), ['revoke', 'remove']);
  assert.equal(f.listeners.size, 0);
});

test('cancel waits for the browser before deleting the temporary output', async () => {
  const f = fixture({ cancelPending: true }), controller = new AbortController();
  const task = f.download(job, { signal: controller.signal });
  const rejected = assert.rejects(task, { name: 'AbortError' });
  await f.saving; await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  assert.ok(f.events.includes('cancel'));
  assert.ok(!f.events.includes('remove'));
  f.releaseCancel(); await rejected;
  assert.deepEqual(f.events.slice(-2), ['revoke', 'remove']);
  assert.equal(f.listeners.size, 0);
});

test('canceling the browser save dialog cleans up and reports cancellation', async () => {
  const f = fixture({ saveError: 'User canceled' });
  await assert.rejects(f.download(job, { signal: new AbortController().signal }), error => error.code === 'CANCELED');
  assert.deepEqual(f.events.slice(-2), ['revoke', 'remove']);
});

test('browser USER_CANCELED interruption is reported as cancellation, not a download error', async () => {
  const f = fixture();
  const task = f.download(job, { signal: new AbortController().signal });
  const rejected = assert.rejects(task, error => error.code === 'CANCELED');
  await f.saving; await new Promise(resolve => setImmediate(resolve));
  f.interrupt(); await rejected;
  assert.deepEqual(f.events.slice(-2), ['revoke', 'remove']);
});

test('a supplied save picker handle still receives the MP4 directly', async () => {
  const f = fixture(), fileHandle = f.makeFile('chosen');
  const result = await f.download(job, { signal: new AbortController().signal, fileHandle });
  assert.equal(result.fileHandle, fileHandle); assert.equal(result.bytes, 4);
  assert.ok(!f.events.includes('save'));
  assert.equal(f.events.at(-1), 'remove');
});
