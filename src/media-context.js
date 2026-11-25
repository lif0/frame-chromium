// Only retain headers used for media access, never cookies or unrelated headers.
const accessHeaders = new Set(['authorization', 'authorizations', 'accepts-controls']);
export function isMediaFragment(url) {
  const path = new URL(url).pathname;
  return /\.(m4s|ts|aac)$/i.test(path) || /\/(?:init|seg|fragment)[-_][^/]*\.mp4$/i.test(path);
}
export function mediaKind(url, mime = '') {
  const path = new URL(url).pathname;
  if (isMediaFragment(url)) return null;
  if (/\.m3u8$/i.test(path) || /mpegurl/i.test(mime)) return 'hls';
  if (/\.(mp4|webm|mov|m4v)$/i.test(path) || /^video\/(mp4|webm|quicktime)/i.test(mime)) return 'file';
  return null;
}
export function mediaScope(url) {
  const u = new URL(url);
  return u.origin + u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
}
export function candidateList(candidates) {
  const youtube = candidates.filter(v => v.type === 'youtube');
  if (youtube.length) return youtube;
  const valid = candidates.filter(v => mediaKind(v.url, v.type === 'hls' ? 'application/x-mpegurl' : 'video/mp4'));
  const streams = valid.filter(v => v.type === 'hls');
  if (!streams.length) return valid;
  const masters = new Set(streams.filter(v => /\/(?:master|playlist)[^/]*\.m3u8$/i.test(new URL(v.url).pathname)).map(v => v.url));
  const groups = new Set([...masters].map(mediaScope));
  // A master on an advertising CDN must not hide a film on another CDN.
  return [...new Map(streams.filter(v => masters.has(v.url) || !groups.has(mediaScope(v.url))).map(v => [v.url, v])).values()];
}
// Different master URLs can resolve to the exact same video/audio playlists.
// Keep the latest access context, and never merge on duration or quality alone.
export function uniquePlaylists(items) {
  const keys = new Map(), result = [];
  const sameSource = (a, b) => {
    if (a === b) return true;
    try {
      const left = new URL(a), right = new URL(b);
      // Cross-origin Referer is often reduced to the origin by the browser.
      const originOnly = url => url.pathname === '/' && !url.search && !url.hash;
      return left.origin === right.origin && (originOnly(left) || originOnly(right));
    } catch { return false; }
  };
  for (const item of items) {
    if (item.video.type !== 'hls') { result.push(item); continue; }
    const tracks = item.options.map(v => JSON.stringify([v.url, v.audio || ''])).sort();
    const key = JSON.stringify(tracks);
    keys.set(item, key);
    const index = result.findIndex(previous => keys.get(previous) === key && sameSource(previous.video.source || '', item.video.source || ''));
    if (index < 0) result.push(item);
    else result[index] = item;
  }
  return result;
}
export function captureContext(url, headers = []) {
  const selected = {};
  let source = '', origin = '';
  for (const { name, value } of headers) {
    if (typeof value !== 'string' || /[\r\n]/.test(value)) continue;
    const key = name.toLowerCase();
    if (accessHeaders.has(key)) selected[key] = value;
    if (key === 'referer' && /^https?:\/\//.test(value)) source = value;
    if (key === 'origin' && /^https?:\/\//.test(value)) origin = new URL(value).origin;
  }
  return { source, access: { scope: mediaScope(url), headers: selected, origin } };
}
export function scopedHeaders(url, access) {
  if (!access?.scope) return {};
  const scope = new URL(access.scope), target = new URL(url);
  if (target.origin !== scope.origin || !target.pathname.startsWith(scope.pathname)) return {};
  return Object.fromEntries(Object.entries(access.headers || {}).filter(([key, value]) => accessHeaders.has(key) && typeof value === 'string' && !/[\r\n]/.test(value)));
}
