import test from 'node:test';
import assert from 'node:assert/strict';
import { writeResponse } from '../src/disk.js';

test('512 MiB passes through with backpressure and no whole-file buffer', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let produced = 0, written = 0, outstanding = 0, peak = 0;
  const body = new ReadableStream({ pull(c) { if (produced++ < 512) c.enqueue(chunk); else c.close(); } });
  const writer = { async write(data) { peak = Math.max(peak, ++outstanding); await Promise.resolve(); written += data.byteLength; outstanding--; } };
  const length = await writeResponse({ body }, writer, { expectedLength: 512 * chunk.length });
  assert.equal(length, 512 * 1024 * 1024);
  assert.equal(written, length);
  assert.equal(peak, 1);
});
test('cancel interrupts reads and truncated ranges fail', async () => {
  const controller = new AbortController();
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(10)); } });
  await assert.rejects(writeResponse({ body }, { async write() { controller.abort(); } }, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(writeResponse(new Response(new Uint8Array(9)), { async write() {} }, { expectedLength: 10 }), /не полностью/);
});
