export const NATIVE_HOST = 'com.frame.downloader';

export function nativeRequest(message, { signal, onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let port, finished = false, cancelTimer;
    const finish = (error, result) => {
      if (finished) return;
      finished = true; clearTimeout(cancelTimer); signal?.removeEventListener('abort', cancel);
      port?.disconnect(); error ? reject(error) : resolve(result);
    };
    const cancel = () => {
      try { port?.postMessage({ action: 'cancel' }); } catch {}
      cancelTimer = setTimeout(() => finish(signal.reason || new DOMException('Canceled', 'AbortError')), 3000);
    };
    try {
      signal?.throwIfAborted();
      port = chrome.runtime.connectNative(NATIVE_HOST);
      port.onMessage.addListener(data => {
        if (data.type === 'progress') onProgress(data.update);
        else if (data.type === 'result') finish(null, data.result);
        else if (data.type === 'error') finish(Object.assign(new Error(data.message || 'Помощник не смог выполнить запрос.'), { code: data.code }));
      });
      port.onDisconnect.addListener(() => {
        const detail = chrome.runtime.lastError?.message || '';
        if (finished) return;
        if (signal?.aborted) return finish(signal.reason);
        const missing = /not found|not registered|not specified/i.test(detail);
        const forbidden = /forbidden/i.test(detail);
        const code = missing ? 'HELPER_MISSING' : forbidden ? 'HELPER_FORBIDDEN' : 'HELPER_DISCONNECTED';
        const message = missing ? 'Помощник не найден.' : forbidden ? 'Помощник не подключён к этому расширению. Повторите установку с указанным ID.' : 'Помощник не запустился или отключился. Повторите установку и проверку.';
        finish(Object.assign(new Error(message), { code }));
      });
      signal?.addEventListener('abort', cancel, { once: true });
      port.postMessage(message);
    } catch (error) { finish(error); }
  });
}
