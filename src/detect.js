(() => {
  // A popup may reinject discovery after the extension was updated. Do not leave
  // multiple observers attached to the same document.
  const version = '0.1.0';
  try {
    if (globalThis.__frameDetector?.version === version && globalThis.__frameDetector.alive()) return;
    globalThis.__frameDetector?.stop();
  } catch { /* A previous extension context can already be invalid. */ }
  const sent = new Set();
  let stopped = false, scheduled, resources, mutations;
  const stop = () => { stopped = true; clearTimeout(scheduled); resources?.disconnect(); mutations?.disconnect(); };
  const alive = () => {
    try { return !stopped && !!chrome.runtime?.id; } catch { return false; }
  };
  globalThis.__frameDetector = { stop, alive, version };
  let youtubePage;
  const reportYouTube = () => {
    if (!/(^|\.)youtube\.com$/.test(location.hostname) || youtubePage === location.href || !/^\/(watch|shorts\/|live\/)/.test(location.pathname)) return;
    if (!alive()) { stop(); return; }
    youtubePage = location.href;
    try { chrome.runtime.sendMessage({ type: 'youtube-page' }).catch(() => { if (!alive()) stop(); }); } catch { stop(); }
  };
  const report = url => {
    if (!alive()) { stop(); return; }
    if (!/^https?:/.test(url) || !/\.(m3u8|mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url) || sent.has(url)) return;
    sent.add(url);
    try {
      chrome.runtime.sendMessage({ type: 'found', url }).catch(() => { if (!alive()) stop(); });
    } catch { stop(); }
  };
  performance.getEntriesByType('resource').forEach(e => report(e.name));
  resources = new PerformanceObserver(list => list.getEntries().forEach(e => report(e.name)));
  resources.observe({ type: 'resource', buffered: true });
  const scan = () => { reportYouTube(); document.querySelectorAll('video,video source,audio,audio source').forEach(v => report(v.currentSrc || v.src || '')); };
  scan();
  mutations = new MutationObserver(() => { if (!alive()) { stop(); return; } clearTimeout(scheduled); scheduled = setTimeout(scan, 500); });
  mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  if (!alive()) stop();
})();
