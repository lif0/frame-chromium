import { nativeRequest } from './native.js';
import { youtubeVideoId, youtubeURL } from './youtube.js';

// Owned by the service worker: closing a popup must not cancel extraction.
export function createYouTubeInfoLoader(request = nativeRequest, now = Date.now) {
  const pending = new Map(), cache = new Map();
  return function load(url, force = false) {
    const id = youtubeVideoId(url);
    if (!id) return Promise.reject(new Error('Некорректная ссылка YouTube.'));
    if (pending.has(id)) return pending.get(id);
    const saved = cache.get(id);
    if (!force && saved && now() - saved.time < 600000) return Promise.resolve(saved.info);
    const task = request({ action: 'info', url: youtubeURL(id), refresh: force }, { signal: AbortSignal.timeout(60000) })
      .then(info => {
        cache.delete(id); cache.set(id, { time: now(), info });
        if (cache.size > 20) cache.delete(cache.keys().next().value);
        return info;
      }).finally(() => pending.delete(id));
    pending.set(id, task);
    return task;
  };
}
