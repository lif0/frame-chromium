import { parseHLS } from './hls.js';
import { scopedHeaders } from './media-context.js';
export { bytesLabel } from './size.js';
export async function setReferer(urls, source, origin) {
  if (!source) return;
  const result = await chrome.runtime.sendMessage({ type: 'referer', urls, source, origin });
  if (result?.error) throw new Error(result.error);
}
export async function request(url, { signal, range, source, access, method = 'GET' } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      signal?.throwIfAborted();
      const fetchHeaders = async () => {
        signal?.throwIfAborted();
        if (source) await setReferer([url], source, access?.origin);
        const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
        const headers = scopedHeaders(url, access);
        // Custom access headers must never follow a redirect to another resource.
        const redirect = Object.keys(headers).length ? 'error' : 'follow';
        if (range) headers.Range = `bytes=${range.start}-${range.end}`;
        return fetch(url, { method, credentials: 'include', signal: combined, headers, redirect });
      };
      // DNR rules are shared. Serialize only until response headers arrive so
      // simultaneous jobs on the same CDN cannot overwrite each other's Referer.
      const response = source ? await navigator.locks.request(`frame-fetch:${new URL(url).hostname}`, fetchHeaders) : await fetchHeaders();
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw Object.assign(new Error('Ссылка истекла или сервер отказал в доступе. Обновите страницу, запустите видео и попробуйте снова.'), { permanent: true }); }
      if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`Сервер вернул HTTP ${response.status}.`), { permanent: response.status >= 400 && response.status < 500 && response.status !== 429 }); }
      if (range) {
        const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\//);
        if (response.status !== 206 || !match || Number(match[1]) !== range.start || Number(match[2]) !== range.end) {
          await response.body?.cancel();
          throw Object.assign(new Error('Сервер вернул неверный диапазон видео. Загрузка остановлена.'), { permanent: true });
        }
      }
      return response;
    } catch (error) {
      if (signal?.aborted || error.permanent || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
}
export async function playlist(url, signal, source, access) {
  const response = await request(url, { signal, source, access });
  return parseHLS(await response.text(), response.url || url);
}
export const timeLabel = seconds => seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
