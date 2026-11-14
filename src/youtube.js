export function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(shorts|embed|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : null;
    }
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}
export const youtubeURL = id => `https://www.youtube.com/watch?v=${id}`;

export function youtubeOptions(info) {
  if (info.isLive) throw new Error('Скачивание прямых эфиров YouTube пока не поддерживается.');
  const formats = (info.formats || []).filter(f => !f.has_drm && /^[\w.-]+$/.test(f.format_id || ''));
  const isVideo = f => f.vcodec && f.vcodec !== 'none' && f.height > 0;
  const isAudio = f => f.acodec && f.acodec !== 'none';
  const audio = formats.filter(f => !isVideo(f) && isAudio(f)).sort((a,b) => (b.language_preference || 0) - (a.language_preference || 0) || Number(b.ext === 'm4a') - Number(a.ext === 'm4a') || (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];
  const score = f => (/^avc1/.test(f.vcodec) ? 3 : /^av01/.test(f.vcodec) ? 2 : 1) * 100000 + (f.fps || 0) * 100 + (f.tbr || 0);
  const byHeight = new Map();
  for (const f of formats.filter(isVideo)) {
    if (!isAudio(f) && !audio) continue;
    if (!byHeight.has(f.height) || score(f) > score(byHeight.get(f.height))) byHeight.set(f.height, f);
  }
  return [...byHeight.values()].sort((a,b) => b.height - a.height).map(video => {
    const tracks = isAudio(video) ? [video] : [video, audio];
    const exact = tracks.every(f => f.filesize > 0);
    const sizes = tracks.map(f => f.filesize || f.filesize_approx || (f.tbr && info.duration ? f.tbr * 1000 * info.duration / 8 : null));
    return { url: youtubeURL(info.videoId), height: video.height, fps: video.fps, formatId: tracks.map(f => f.format_id).join('+'), size: { bytes: sizes.every(n => n > 0) ? sizes.reduce((a,b) => a + b, 0) : null, exact, duration: info.duration } };
  });
}

// Runs in the page's MAIN world. Return metadata only, not cookies or account data.
export function youtubePageInfo() {
  const id = new URL(location.href).searchParams.get('v') || location.pathname.split('/')[2];
  const player = document.getElementById('movie_player');
  const response = player?.getPlayerResponse?.() || globalThis.ytInitialPlayerResponse;
  const details = response?.videoDetails;
  if (!details || details.videoId !== id) return null;
  const thumbnails = details.thumbnail?.thumbnails || [];
  return { videoId: id, title: details.title, duration: Number(details.lengthSeconds) || 0, thumbnail: thumbnails.at(-1)?.url || '', isLive: !!details.isLiveContent, status: response.playabilityStatus?.status };
}
