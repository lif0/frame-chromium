// Serialized by chrome.scripting: keep this function self-contained.
export function collectPreviews() {
  return [...document.querySelectorAll('video')].slice(0, 8).map(video => {
    const src = video.currentSrc || video.src;
    let image = /^https?:/.test(video.poster) ? video.poster : '';
    if (!image && video.readyState >= 2 && video.videoWidth >= 160 && video.videoHeight >= 90) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 240; canvas.height = Math.min(426, Math.round(240 * video.videoHeight / video.videoWidth));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        image = canvas.toDataURL('image/jpeg', .7);
      } catch { /* Cross-origin video can prohibit reading a frame. */ }
    }
    return { src, image, duration: Number.isFinite(video.duration) ? video.duration : 0, source: location.href };
  }).filter(v => v.image);
}
export function matchingPreview(video, duration, previews) {
  const direct = previews.find(p => p.src === video.url);
  if (direct) return direct.image;
  if (video.type !== 'hls' || !duration) return '';
  const matches = previews.filter(p => p.src.startsWith('blob:') && p.source === video.source && Math.abs(p.duration - duration) < 2);
  return matches.length === 1 ? matches[0].image : '';
}
