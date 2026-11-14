import { playlist, request } from './network.js';

const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
// Read only a small fragment for the thumbnail, never the whole video.
async function boundedPart(part, video, signal) {
  const limit = 6 * 1024 * 1024;
  const response = await request(part.url, { source: video.source, access: video.access, range: part.range, signal });
  if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('Preview fragment too large'); }
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Preview fragment too large');
      chunks.push(value);
    }
    return new Blob(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function previewFrame(video, variant) {
  if (video.type !== 'hls') return null;
  const key = `thumbnail:${await hash(new TextEncoder().encode(variant.url))}`;
  const cached = (await chrome.storage.session.get(key))[key];
  if (cached) return cached;
  const signal = AbortSignal.timeout(10000);
  const media = await playlist(variant.url, signal, video.source, video.access);
  if (media.type !== 'media') return null;
  const part = media.segments[Math.floor(media.segments.length / 10)];
  const pieces = [];
  if (media.init) pieces.push(await boundedPart(media.init, video, signal));
  pieces.push(await boundedPart(part, video, signal));
  const blob = new Blob(pieces);
  const fingerprint = await hash(await blob.arrayBuffer());
  const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('./media.js');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const sink = new CanvasSink(track, { width: 240, height: 135, fit: 'contain' });
    const frame = await sink.getCanvas(await track.getFirstTimestamp() + Math.min(1, part.duration / 2));
    if (!frame) return null;
    const result = { image: frame.canvas.toDataURL('image/jpeg', .75), fingerprint };
    // Bound the cache even when many sites are visited in one browser session.
    await navigator.locks.request('frame-thumbnails', async () => {
      const data = await chrome.storage.session.get(null);
      const keys = Object.keys(data).filter(k => k.startsWith('thumbnail:'));
      if (keys.length >= 24) await chrome.storage.session.remove(keys.slice(0, keys.length - 23));
      await chrome.storage.session.set({ [key]: result });
    });
    return result;
  } finally { input.dispose(); }
}
