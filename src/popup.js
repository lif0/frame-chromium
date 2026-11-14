import { initUI } from './ui.js';
import { t, translateMessage, onLanguageChange } from './i18n.js';
import { BUILD_VERSION, requireManagerResponse } from './messages.js';
import { safeFilename } from './hls.js';
import { playlist, request, timeLabel } from './network.js';
import { estimateSize, sizeLabel } from './size.js';
import { candidateList } from './media-context.js';
import { collectPreviews, matchingPreview } from './previews.js';
import { candidateSignature } from './badge.js';
import { previewFrame } from './preview-frame.js';
import { youtubeVideoId, youtubeURL, youtubePageInfo, youtubeOptions } from './youtube.js';
const $ = selector => document.querySelector(selector);
const preview = new URLSearchParams(location.search).has('preview');
const sizeCache = new Map();
let busy = false, refreshPending = false, preferred = 1080, sourceTabId, generation = 0;
function notice(message) { $('#notice').textContent = translateMessage(message); $('#notice').hidden = !message; }
function filename(title, variant, ext = 'mp4') { return `${safeFilename(title)}${variant.height ? ` — ${variant.height}p` : ''}.${ext}`; }
function setPreview(root, image) {
  if (!image) return;
  const thumbnail = root.querySelector('.thumbnail');
  thumbnail.onload = () => { thumbnail.hidden = false; };
  thumbnail.onerror = () => { thumbnail.hidden = true; };
  thumbnail.src = image;
}
async function measure(video, variant) {
  if (video.type === 'youtube') return variant.size;
  const key = [variant.url, variant.audio || '', video.source || '', JSON.stringify(video.access || {})].join('|');
  if (!sizeCache.has(key)) sizeCache.set(key, (async () => {
    if (video.type === 'file') {
      const response = await request(video.url, { source: video.source, access: video.access, method: 'HEAD', signal: AbortSignal.timeout(12000) });
      const length = response.headers.get('content-length');
      const bytes = length !== null && Number(length) > 0 ? Number(length) : null;
      return { bytes, exact: bytes !== null };
    }
    const tracks = await Promise.all([playlist(variant.url, undefined, video.source, video.access), variant.audio ? playlist(variant.audio, undefined, video.source, video.access) : null]);
    return estimateSize(tracks[0], tracks[1], variant.bandwidth);
  })().catch(() => { sizeCache.delete(key); return { bytes: null, exact: false }; }));
  return sizeCache.get(key);
}
function card(video, title, options, siteUrl, duration, image = '', target = $('#videos')) {
  const fragment = $('#video-template').content.cloneNode(true);
  const root = fragment.querySelector('article');
  root.querySelector('.video-title').textContent = title;
  root.querySelector('.video-title').title = title;
  root.querySelector('.video-source').textContent = video.source ? new URL(video.source).hostname : video.url ? new URL(video.url).hostname : '';
  setPreview(root, image);
  root.querySelector('.format-badge').textContent = video.type === 'youtube' ? 'YOUTUBE → MP4' : video.type === 'hls' ? 'HLS → MP4' : 'FILE';
  const durationElement = root.querySelector('.duration');
  if (duration) durationElement.textContent = timeLabel(duration);
  const select = root.querySelector('select');
  for (const [i, v] of options.entries()) {
    const option = document.createElement('option'); option.value = i;
    option.textContent = v.height ? `${v.height}p${v.height >= 2160 ? ' · 4K' : v.height >= 1440 ? ' · QHD' : v.height >= 1080 ? ' · Full HD' : v.height >= 720 ? ' · HD' : ''}` : t('Качество неизвестно'); select.append(option);
  }
  const best = options.findIndex(v => v.height <= preferred); select.value = String(best < 0 ? 0 : best);
  const extension = video.type === 'file' ? new URL(video.url).pathname.match(/\.(webm|mov|m4v)$/i)?.[1]?.toLowerCase() || 'mp4' : 'mp4';
  let revision = 0, currentSize;
  const update = async () => {
    const version = ++revision, variant = options[select.value];
    currentSize = null; root.querySelector('.download-size').textContent = t('Считаем…');
    const size = preview ? { bytes: variant.height * 37000, exact: true, duration: duration || 68 } : await measure(video, variant);
    if (version !== revision || !root.isConnected) return;
    currentSize = size;
    root.querySelector('.download-size').textContent = sizeLabel(size);
    root.querySelector('.download-size').title = size.exact ? t('Объём загружаемых дорожек; итоговый файл может немного отличаться') : t('Оценка по длительности и битрейту');
    if (size.duration) durationElement.textContent = timeLabel(size.duration);
  };
  select.addEventListener('change', () => { update(); if (!preview) chrome.storage.local.set({ preferred: options[select.value].height }).catch(() => {}); });
  root.querySelector('.download').addEventListener('click', async event => {
    if (preview) { notice('Предпросмотр. Скачивание доступно в установленном расширении.'); return; }
    const button = event.currentTarget; button.disabled = true;
    try {
      const selected = options[select.value];
      const result = await chrome.runtime.sendMessage({ type: 'queue-job', job: { ...video, ...selected, title, siteUrl, size: currentSize, filename: filename(title, selected, extension) } });
      requireManagerResponse(result);
      window.close();
    } catch (e) { notice(e.message); button.disabled = false; }
  });
  target.append(fragment); update();
  return root;
}
async function refresh(force = false) {
  if (busy) { refreshPending = true; return; }
  busy = true; const current = ++generation;
  $('#refresh').disabled = true; notice('');
  $('#helper-setup').hidden = true;
  $('#results').setAttribute('aria-busy', 'true'); $('#results').classList.remove('reveal');
  $('#loading').hidden = $('#videos').childElementCount > 0 || !$('#empty').hidden;
  try {
    if (preview) {
      document.body.classList.add('preview'); $('#site').textContent = t('algocode.io · Предпросмотр');
      $('#videos').replaceChildren();
      for (const title of ['Важность паттернов', 'Два указателя: разбор задачи', 'Практика и примеры']) card({ type: 'hls' }, t(title), [2160,1440,1080,720,480,360].map(height => ({ height })), '', 68);
      $('#count').textContent = '3'; return;
    }
    const loadedVersion = chrome.runtime.getManifest().version;
    $('.version').textContent = `v${loadedVersion}`;
    if (loadedVersion !== BUILD_VERSION) notice('Доступно обновление Frame. Нажмите ↻ у расширения в chrome://extensions, чтобы загрузить новую фоновую часть.');
    preferred = (await chrome.storage.local.get('preferred')).preferred || 1080;
    const requestedTab = Number(new URLSearchParams(location.search).get('tab'));
    const tab = requestedTab ? await chrome.tabs.get(requestedTab) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    sourceTabId = tab?.id;
    $('#youtube-note').hidden = !youtubeVideoId(tab?.url);
    $('#site').textContent = tab?.url?.startsWith('http') ? new URL(tab.url).hostname : t('Откройте страницу с видео');
    if (!tab?.id) { $('#videos').replaceChildren(); $('#count').textContent = '0'; $('#empty').hidden = false; return; }
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['detect.js'] }).catch(() => {});
    const youtubeId = youtubeVideoId(tab.url);
    if (youtubeId) {
      $('#videos').replaceChildren(); $('#empty').hidden = true; $('#count').textContent = '1';
      try {
        const pageInfo = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: youtubePageInfo }).then(r => r[0]?.result).catch(() => null);
        const response = await chrome.runtime.sendMessage({ type: 'youtube-info', url: youtubeURL(youtubeId), refresh: force === true });
        if (response.error) throw Object.assign(new Error(response.error), { code: response.code });
        const info = response.info;
        if (current !== generation) return;
        if (info.videoId !== youtubeId) throw new Error('Плеер переключился на другой ролик. Обновите список.');
        const options = youtubeOptions(info);
        if (!options.length) throw new Error('Для этого ролика не найдено доступных форматов скачивания.');
        card({ type: 'youtube', url: youtubeURL(youtubeId), source: youtubeURL(youtubeId), videoId: youtubeId }, info.title || pageInfo?.title || tab.title, options, youtubeURL(youtubeId), info.duration || pageInfo?.duration, info.thumbnail || pageInfo?.thumbnail);
      } catch (error) {
        notice(error.code === 'HELPER_MISSING' ? `${translateMessage(error.message)} ${t('Для скачивания с YouTube установите frame-helper и зависимости.')}` : error.message);
        $('#helper-setup').hidden = !['HELPER_MISSING', 'HELPER_FORBIDDEN', 'DEPENDENCY_MISSING', 'HELPER_DISCONNECTED'].includes(error.code);
      }
      await updateActiveCount(); return;
    }
    const previewsPromise = chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: collectPreviews })
      .then(frames => frames.flatMap(frame => frame.result || [])).catch(() => []);
    const candidates = (await chrome.storage.session.get(`tab:${tab.id}`))[`tab:${tab.id}`] || [];
    const unique = candidateList(candidates), prepared = [], children = new Set();
    let lastError;
    for (const v of unique) {
      try {
        let options = [{ url: v.url, height: 0 }], duration;
        if (v.type === 'hls') {
          const parsed = await playlist(v.url, undefined, v.source, v.access);
          if (parsed.type === 'master') {
            options = parsed.variants;
            for (const option of options) { children.add(option.url); if (option.audio) children.add(option.audio); }
            const selected = options.find(v => v.height <= preferred) || options[0];
            duration = (await measure(v, selected)).duration;
          } else duration = parsed.duration;
        }
        if (current !== generation) return;
        prepared.push({ video: v, options, duration });
      } catch (e) { lastError = e.message; }
    }
    const visible = prepared.filter(item => !children.has(item.video.url)).sort((a, b) => (b.duration || 0) - (a.duration || 0));
    const previews = await previewsPromise, fragment = document.createDocumentFragment();
    const rows = visible.map(({video, options, duration}, index) => {
      const image = matchingPreview(video, duration, previews);
      const root = card(video, tab.title || t('Видео'), options, tab.url, duration, image, fragment);
      return {video, options, duration, image, root, index};
    });
    $('#videos').replaceChildren(fragment);
    const count = visible.length;
    if (!count && lastError) notice(lastError);
    $('#count').textContent = count; $('#empty').hidden = count > 0;
    await chrome.runtime.sendMessage({ type: 'visible-videos', tabId: tab.id, signature: candidateSignature(candidates), count });
    const syncCount = () => {
      const count = $('#videos').childElementCount;
      $('#count').textContent = count;
      chrome.runtime.sendMessage({ type: 'visible-videos', tabId: tab.id, signature: candidateSignature(candidates), count }).catch(() => {});
    };
    for (const row of rows) {
      const {video, options, duration, image, root} = row;
      const similar = rows.filter(r => r.video.source === video.source && r.duration === duration && r.options.length === 1 && options.length === 1 && r.options[0].height === options[0].height);
      if (image && similar.length < 2) continue;
      previewFrame(video, options.at(-1)).then(result => {
        if (!root.isConnected || !result) return;
        setPreview(root, image || result.image);
        row.fingerprint = result.fingerprint;
        // Only collapse single-quality alternatives after matching actual media
        // bytes as well as player, duration and quality. Keep the newest URL.
        const duplicates = similar.filter(r => r.root.isConnected && r.fingerprint === result.fingerprint);
        const newest = duplicates.sort((a, b) => b.index - a.index)[0];
        for (const duplicate of duplicates) if (duplicate !== newest) duplicate.root.remove();
        syncCount();
      }).catch(() => {});
    }
    await updateActiveCount();
  } catch (e) { notice(e.message); $('#empty').hidden = $('#videos').childElementCount > 0; }
  finally {
    busy = false; $('#refresh').disabled = false; $('#loading').hidden = true;
    $('#results').setAttribute('aria-busy', 'false'); $('#results').classList.add('reveal');
    if (refreshPending) { refreshPending = false; queueMicrotask(refresh); }
  }
}
async function updateActiveCount() {
  const data = await chrome.storage.session.get(null);
  const count = Object.entries(data).filter(([k,v]) => k.startsWith('job:') && ['ready','running'].includes(v.state)).length;
  $('#active-count').textContent = count ? t('В менеджере загрузок: {count}', { count }) : '';
}
$('#manager').addEventListener('click', async () => {
  if (preview) { notice('Все загрузки открываются в одной общей вкладке.'); return; }
  try {
    const result = await chrome.runtime.sendMessage({ type: 'open-manager' });
    requireManagerResponse(result);
    window.close();
  } catch (error) { notice(error.message); }
});
$('#refresh').addEventListener('click', () => refresh(true)); $('#reload').addEventListener('click', () => refresh(true));
$('#helper-setup').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') }));
if (!preview) chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (changes[`tab:${sourceTabId}`]) refresh();
  if (Object.keys(changes).some(k => k.startsWith('job:'))) updateActiveCount();
});
await initUI();
onLanguageChange(refresh);
refresh();
