import { t } from './i18n.js';
export function trackSize(track) {
  if (!track || track.type !== 'media') return null;
  const parts = [...(track.init ? [track.init] : []), ...track.segments];
  if (!parts.every(p => p.range)) return null;
  return parts.reduce((bytes, p) => bytes + p.range.end - p.range.start + 1, 0);
}
export function estimateSize(video, audio, bandwidth = 0) {
  const duration = Math.max(video.duration || 0, audio?.duration || 0);
  const videoBytes = trackSize(video), audioBytes = audio ? trackSize(audio) : 0;
  if (videoBytes !== null && audioBytes !== null) return { bytes: videoBytes + audioBytes, exact: true, duration };
  // Variant BANDWIDTH includes the associated audio rendition.
  if (bandwidth > 0 && duration > 0) return { bytes: Math.ceil(bandwidth * duration / 8), exact: false, duration };
  return { bytes: null, exact: false, duration };
}
export function bytesLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return t('Размер неизвестен');
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} ${t('ГБ')}`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} ${t('МБ')}`;
  return `${Math.ceil(bytes / 1024)} ${t('КБ')}`;
}
export function sizeLabel(size) {
  if (!size || size.bytes === null) return t('Размер неизвестен');
  return `${size.exact ? '' : '≈ '}${bytesLabel(size.bytes)}`;
}
