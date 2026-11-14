export const BUILD_VERSION = '0.1.0';

export function requireManagerResponse(result) {
  if (result?.error) throw new Error(result.error);
  if (!Number.isInteger(result?.tabId) || result.tabId < 0) {
    throw new Error('Фоновая часть расширения не ответила. Обновите Frame кнопкой ↻ в chrome://extensions и повторите скачивание.');
  }
  return result.tabId;
}
