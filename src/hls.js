export function attributes(text) {
  return Object.fromEntries([...text.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)].map(m => [m[1], m[2] ?? m[3]]));
}
export function httpURL(value, base) {
  const url = new URL(value, base);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Неподдерживаемый адрес видео.');
  return url.href;
}
export function parseHLS(text, base) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('Сервер вернул не HLS-плейлист. Обновите страницу и запустите видео.');
  if (lines.some(l => /^#EXT-X-(SESSION-)?KEY:/.test(l) && attributes(l).METHOD !== 'NONE')) throw new Error('Этот поток зашифрован. Пока поддерживается HLS без шифрования.');
  const audio = lines.filter(l => l.startsWith('#EXT-X-MEDIA:')).map(attributes).filter(a => a.TYPE === 'AUDIO' && a.URI);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attr = attributes(lines[i]);
    const uri = lines[i + 1];
    if (!uri || uri.startsWith('#')) throw new Error('В плейлисте отсутствует адрес качества.');
    const tracks = audio.filter(a => a['GROUP-ID'] === attr.AUDIO);
    const track = tracks.find(a => a.DEFAULT === 'YES') || tracks[0];
    variants.push({ url: httpURL(uri, base), height: Number(attr.RESOLUTION?.split('x')[1]) || 0, bandwidth: Number(attr['AVERAGE-BANDWIDTH'] || attr.BANDWIDTH) || 0, audio: track ? httpURL(track.URI, base) : null });
  }
  if (variants.length) return { type: 'master', variants: variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth) };
  if (!lines.includes('#EXT-X-ENDLIST')) throw new Error('Это прямой эфир. Пока поддерживается скачивание готовых записей.');
  if (lines.some(l => l === '#EXT-X-DISCONTINUITY')) throw new Error('Потоки со сменой временной шкалы пока не поддерживаются.');
  const segments = [];
  let init = null, range = null, seconds = 0, duration = 0;
  let previous = null;
  const makeRange = (value, url) => {
    if (!value) return null;
    const [len, offset] = value.split('@').map(Number);
    const start = offset ?? (previous?.url === url ? previous.end + 1 : NaN);
    if (!Number.isSafeInteger(len) || len <= 0 || !Number.isSafeInteger(start) || start < 0) throw new Error('Некорректный диапазон сегмента.');
    previous = { url, start, end: start + len - 1 };
    return { start, end: previous.end };
  };
  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXT-X-MAP:')) {
      if (init) throw new Error('Смена инициализации потока пока не поддерживается.');
      const a = attributes(line);
      const url = httpURL(a.URI, base);
      init = { url, range: makeRange(a.BYTERANGE, url) };
    } else if (line.startsWith('#EXTINF:')) {
      seconds = Number.parseFloat(line.slice(8));
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Некорректная длительность сегмента.');
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) range = line.slice(17);
    else if (!line.startsWith('#')) {
      const url = httpURL(line, base);
      segments.push({ url, range: makeRange(range, url), duration: seconds });
      duration += seconds; range = null; seconds = 0;
    }
  }
  if (!segments.length) throw new Error('В плейлисте нет сегментов.');
  return { type: 'media', segments, init, duration };
}
export function safeFilename(value) {
  return (value || 'Видео').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 130) || 'Видео';
}
