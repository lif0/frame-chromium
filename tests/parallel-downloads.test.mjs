import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadJob } from '../dist/job-runner.js';
test('parallel downloads keep progress and cancellation independent', async () => {
  const listeners = new Set(), items = new Map(), updatesA = [], updatesB = [];
  let nextId = 0;
  globalThis.chrome = { downloads: {
    download: async () => { const id = ++nextId; items.set(id, { id, state: 'in_progress', bytesReceived: 0, totalBytes: 100 }); return id; },
    search: async ({ id }) => [items.get(id)],
    cancel: async id => { items.get(id).state = 'interrupted'; },
    onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
  } };
  const a = new AbortController(), b = new AbortController();
  try {
    const job = { type: 'file', url: 'https://example.com/video.mp4', filename: 'video.mp4' };
    const taskA = downloadJob(job, { signal: a.signal, onUpdate: u => updatesA.push(u) });
    const taskB = downloadJob(job, { signal: b.signal, onUpdate: u => updatesB.push(u) });
    const rejectedA = assert.rejects(taskA, { name: 'AbortError' });
    await new Promise(r => setTimeout(r, 0));
    items.get(1).bytesReceived = 20; items.get(2).bytesReceived = 70;
    listeners.forEach(fn => fn({ id: 1 })); listeners.forEach(fn => fn({ id: 2 }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(updatesA.at(-1).downloaded, 20); assert.equal(updatesB.at(-1).downloaded, 70);
    a.abort(); await rejectedA;
    assert.equal(items.get(2).state, 'in_progress');
    Object.assign(items.get(2), { state: 'complete', bytesReceived: 100, fileSize: 100 });
    listeners.forEach(fn => fn({ id: 2 }));
    assert.deepEqual(await taskB, { downloadId: 2, bytes: 100 });
    assert.equal(listeners.size, 0);
  } finally { a.abort(); b.abort(); delete globalThis.chrome; }
});
