// Stream one response directly to a writable file. Await every write so slow
// storage cannot cause an unbounded queue of downloaded chunks.
export async function writeResponse(response, writer, { signal, onBytes = () => {}, expectedLength } = {}) {
  const reader = response.body.getReader();
  let length = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
      length += value.byteLength;
      onBytes(value.byteLength);
    }
    if (expectedLength !== undefined && length !== expectedLength) throw new Error('Сегмент загрузился не полностью. Повторите скачивание.');
    return length;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function clearAbandonedJobs(root) {
  for await (const [name] of root.entries()) {
    if (!/^frame-job-[a-f0-9-]{36}$/.test(name)) continue;
    await navigator.locks.request(name, { ifAvailable: true }, async lock => {
      if (lock) await root.removeEntry(name, { recursive: true }).catch(error => { if (error.name !== 'NotFoundError') throw error; });
    });
  }
}
