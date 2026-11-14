import { openManager } from './jobs.js';
import { updateBadge, candidateSignature, setCount } from './badge.js';
import { mediaKind, mediaScope, captureContext, isMediaFragment } from './media-context.js';
import { youtubeVideoId, youtubeURL } from './youtube.js';
import { initLanguage, onLanguageChange } from './i18n.js';
import { createYouTubeInfoLoader } from './youtube-info.js';
const youtubeInfo = createYouTubeInfoLoader();
let queue = Promise.resolve();
function enqueue(fn) { queue = queue.catch(() => {}).then(fn); return queue; }
initLanguage();
onLanguageChange(() => enqueue(async () => {
  const data = await chrome.storage.session.get(null);
  for (const [key, candidates] of Object.entries(data)) if (key.startsWith('tab:')) await updateBadge(Number(key.slice(4)), candidates).catch(() => {});
}).catch(() => {}));
async function foundYouTube(tabId, url) {
  const id = youtubeVideoId(url);
  if (!id || tabId < 0) return;
  const key = `tab:${tabId}`, stored = (await chrome.storage.session.get(key))[key] || [];
  if (stored.length === 1 && stored[0].id === `youtube:${id}`) return;
  const candidates = [{ id: `youtube:${id}`, type: 'youtube', url: youtubeURL(id), source: youtubeURL(id) }];
  await chrome.storage.session.set({ [key]: candidates });
  await updateBadge(tabId, candidates);
}
async function found(tabId, url, source, mime, context) {
  if (tabId < 0 || !/^https?:/.test(url)) return;
  const type = mediaKind(url, mime);
  if (!type && !isMediaFragment(url)) return;
  const key = `tab:${tabId}`;
  const previous = (await chrome.storage.session.get(key))[key] || [];
  if (previous.some(v => v.type === 'youtube')) return;
  const stored = previous.filter(v => mediaKind(v.url, v.type === 'hls' ? 'application/x-mpegurl' : 'video/mp4'));
  let changed = false;
  // A segment can refresh access data for an already discovered playlist, including
  // after an extension reload. It must belong to the same media directory.
  if (context) for (const item of stored) {
    if (mediaScope(item.url) !== context.access.scope) continue;
    if (JSON.stringify(item.access) !== JSON.stringify(context.access) || (context.source && item.source !== context.source)) {
      item.access = context.access;
      if (context.source) item.source = context.source;
      changed = true;
    }
  }
  if (!type && !changed) return;
  const existing = stored.find(v => v.url === url);
  if (existing) {
    if (!existing.access && source) existing.source = source;
  } else if (type) stored.push({ id: crypto.randomUUID(), url, source: context?.source || source, type, ...(context ? { access: context.access } : {}) });
  await chrome.storage.session.set({ [key]: stored.slice(-80) });
  await updateBadge(tabId, stored.slice(-80));
}
const pending = new Map();
const requestFilter = { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest', 'media', 'other'] };
chrome.webRequest.onSendHeaders.addListener(d => {
  if (d.tabId < 0 || d.method === 'OPTIONS' || d.initiator === chrome.runtime.getURL('').slice(0, -1)) return;
  pending.set(d.requestId, captureContext(d.url, d.requestHeaders));
  if (pending.size > 512) pending.delete(pending.keys().next().value);
}, requestFilter, ['requestHeaders', 'extraHeaders']);
for (const event of [chrome.webRequest.onCompleted, chrome.webRequest.onErrorOccurred]) {
  event.addListener(d => pending.delete(d.requestId), requestFilter);
}
chrome.webRequest.onHeadersReceived.addListener(d => {
  if (d.initiator === chrome.runtime.getURL('').slice(0, -1)) return;
  const mime = d.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
  const context = pending.get(d.requestId);
  if (d.statusCode >= 200 && d.statusCode < 300) enqueue(() => found(d.tabId, d.url, /^https?:/.test(d.initiator || '') ? d.initiator : '', mime, context)).catch(() => {});
}, { urls: ['http://*/*', 'https://*/*'] }, ['responseHeaders']);
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.status === 'loading') enqueue(async () => {
    await chrome.storage.session.remove([`tab:${id}`, `view:${id}`]);
    await setCount(id, 0);
    if (youtubeVideoId(tab?.url)) await foundYouTube(id, tab.url);
  }).catch(() => {});
  else if (change.url) enqueue(async () => {
    if (youtubeVideoId(change.url)) return foundYouTube(id, change.url);
    const key = `tab:${id}`, stored = (await chrome.storage.session.get(key))[key] || [];
    if (stored.some(v => v.type === 'youtube')) {
      await chrome.storage.session.remove([key, `view:${id}`]);
      await setCount(id, 0);
    }
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(id => enqueue(() => chrome.storage.session.remove([`tab:${id}`, `view:${id}`])).catch(() => {}));
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === 'youtube-page' && sender.tab && youtubeVideoId(sender.url)) {
    enqueue(() => foundYouTube(sender.tab.id, sender.url)).then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (message.type === 'found' && sender.tab) {
    enqueue(() => found(sender.tab.id, message.url, sender.url, '')).then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (message.type === 'youtube-info') {
    youtubeInfo(message.url, message.refresh === true).then(
      info => reply({ info }),
      error => reply({ error: error.name === 'TimeoutError' ? 'YouTube не ответил за минуту. Попробуйте ещё раз.' : error.message, code: error.code }),
    );
    return true;
  }
  if (message.type === 'visible-videos') {
    enqueue(async () => {
      if (!Number.isInteger(message.tabId) || !Number.isInteger(message.count) || message.count < 0) return;
      const stored = (await chrome.storage.session.get(`tab:${message.tabId}`))[`tab:${message.tabId}`] || [];
      if (candidateSignature(stored) !== message.signature || message.count > stored.length) return;
      await chrome.storage.session.set({ [`view:${message.tabId}`]: { signature: message.signature, count: message.count } });
      await updateBadge(message.tabId, stored);
    }).then(() => reply({ ok: true }), e => reply({ error: e.message }));
    return true;
  }
  if (message.type === 'open-manager' || message.type === 'queue-job') {
    enqueue(async () => {
      if (message.type === 'queue-job') {
        const job = { ...message.job, id: crypto.randomUUID(), state: 'ready', createdAt: Date.now(), downloaded: 0, progress: 0, status: 'Готово к скачиванию' };
        await chrome.storage.session.set({ [`job:${job.id}`]: job, 'manager-focus': job.id });
      }
      return { tabId: await openManager(chrome) };
    }).then(reply, e => reply({ error: e.message }));
    return true;
  }
  if (message.type === 'referer') {
    enqueue(async () => {
      const source = new URL(message.source);
      if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Invalid source');
      const headers = [{ header: 'Referer', operation: 'set', value: source.href }];
      if (message.origin) {
        const origin = new URL(message.origin);
        if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid origin');
        headers.push({ header: 'Origin', operation: 'set', value: origin.origin });
      }
      const domains = [...new Set(message.urls.map(u => new URL(u).hostname))];
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const existing = new Map(rules.map(r => [r.condition.requestDomains?.[0], r.id]));
      let nextId = Math.max(0, ...rules.map(r => r.id)) + 1;
      const addRules = domains.map(domain => ({ id: existing.get(domain) || nextId++, priority: 1, action: { type: 'modifyHeaders', requestHeaders: headers }, condition: { initiatorDomains: [chrome.runtime.id], requestDomains: [domain], resourceTypes: ['xmlhttprequest'] } }));
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: addRules.map(r => r.id).filter(id => rules.some(r => r.id === id)), addRules });
      return { ok: true };
    }).then(reply, e => reply({ error: e.message }));
    return true;
  }
});
