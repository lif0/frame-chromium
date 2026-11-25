import { remuxFiles } from './remux.js';
import { writeResponse, clearAbandonedJobs } from './disk.js';
import { playlist, request } from './network.js';
import { estimateSize } from './size.js';
import { nativeRequest } from './native.js';

async function direct(job, { signal, onUpdate }) {
  signal.throwIfAborted();
  let id;
  try { id = await chrome.downloads.download({ url: job.url, filename: job.filename, saveAs: true }); }
  catch (error) {
    if (/user cancel(?:ed|led)/i.test(error.message)) error.code = 'CANCELED';
    throw error;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { settled = true; clearInterval(timer); chrome.downloads.onChanged.removeListener(changed); signal.removeEventListener('abort', cancel); };
    const cancel = () => {
      if (settled) return;
      cleanup();
      chrome.downloads.cancel(id).catch(() => {}).finally(() => reject(signal.reason));
    };
    const inspect = async () => {
      if (settled) return;
      try {
        const item = (await chrome.downloads.search({ id }))[0];
        if (!item || settled) return;
        const known = item.totalBytes > 0;
        onUpdate({ status: 'Скачиваем…', downloaded: item.bytesReceived, size: known ? { bytes: item.totalBytes, exact: true } : job.size, progress: known ? item.bytesReceived / item.totalBytes * 100 : 0 });
        if (item.state === 'complete') { cleanup(); resolve({ downloadId: id, bytes: item.fileSize }); }
        else if (item.state === 'interrupted') {
          cleanup();
          reject(Object.assign(new Error('Сохранение прервано. Повторите загрузку.'), { code: item.error === 'USER_CANCELED' ? 'CANCELED' : item.error }));
        }
      } catch (e) { cleanup(); reject(e); }
    };
    const changed = delta => { if (delta.id === id) inspect(); };
    const timer = setInterval(inspect, 500);
    chrome.downloads.onChanged.addListener(changed);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel(); else inspect();
  });
}

export async function downloadJob(job, { signal, fileHandle, onUpdate = () => {} }) {
  if (job.type === 'youtube') return nativeRequest({ action: 'download', url: job.url, formatId: job.formatId, filename: job.filename, saveAs: true, expectedBytes: job.size?.bytes }, { signal, onProgress: onUpdate });
  if (job.type === 'file') return direct(job, { signal, onUpdate });
  const root = await navigator.storage.getDirectory();
  await clearAbandonedJobs(root);
  const name = `frame-job-${crypto.randomUUID()}`;
  return navigator.locks.request(name, async () => {
    const dir = await root.getDirectoryHandle(name, { create: true });
    let writer, downloaded = 0, completed = 0, total = 0;
    const loadTrack = async url => {
      const track = await playlist(url, signal, job.source, job.access);
      if (track.type !== 'media') throw new Error('Вложенные мастер-плейлисты пока не поддерживаются.');
      return { ...track, parts: [...(track.init ? [track.init] : []), ...track.segments] };
    };
    const trackToDisk = async (track, file, label) => {
      const handle = await dir.getFileHandle(file, { create: true });
      const stream = await handle.createWritable();
      try {
        for (const part of track.parts) {
          signal.throwIfAborted();
          const response = await request(part.url, { signal, range: part.range, source: job.source, access: job.access });
          await writeResponse(response, stream, { signal, expectedLength: part.range ? part.range.end - part.range.start + 1 : undefined, onBytes: bytes => {
            downloaded += bytes; onUpdate({ status: label, downloaded, progress: 76 * completed / total });
          } });
          completed++; onUpdate({ status: label, downloaded, progress: 76 * completed / total });
        }
        await stream.close();
      } catch (e) { await stream.abort().catch(() => {}); throw e; }
      return handle.getFile();
    };
    try {
      signal.throwIfAborted();
      onUpdate({ status: 'Читаем плейлист…', progress: 1 });
      const video = await loadTrack(job.url), audio = job.audio ? await loadTrack(job.audio) : null;
      total = video.parts.length + (audio?.parts.length || 0);
      onUpdate({ size: estimateSize(video, audio, job.bandwidth) });
      const videoFile = await trackToDisk(video, 'video', 'Скачиваем видео…');
      const audioFile = audio ? await trackToDisk(audio, 'audio', 'Скачиваем звук…') : null;
      signal.throwIfAborted();
      const destination = fileHandle || await dir.getFileHandle('output.mp4', { create: true });
      writer = await destination.createWritable();
      let highest = 0;
      await remuxFiles(videoFile, audioFile, writer, { signal, duration: video.duration, onProgress: progress => {
        highest = Math.max(highest, progress); onUpdate({ status: 'Собираем MP4…', progress: 78 + highest * 20 });
      } });
      signal.throwIfAborted();
      await writer.close(); writer = null;
      const file = await destination.getFile();
      if (fileHandle) return { fileHandle, bytes: file.size };
      // Some Chromium browsers omit the picker but support OPFS and downloads.
      // Keep the disk-backed File and its directory alive until the browser finishes copying it.
      const url = URL.createObjectURL(file);
      try {
        onUpdate({ status: 'Сохраняем MP4…', progress: 98 });
        return await direct({ ...job, url }, { signal, onUpdate: update => onUpdate({ status: 'Сохраняем MP4…', progress: 98 + update.progress / 100 }) });
      } finally { URL.revokeObjectURL(url); }
    } catch (e) { await writer?.abort().catch(() => {}); throw e; }
    finally { await root.removeEntry(name, { recursive: true }); }
  });
}
