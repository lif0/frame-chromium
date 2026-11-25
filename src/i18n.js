import { english } from './translations.js';
let language = 'en', initialized;
const listeners = new Set();
const reverse = new Map(Object.entries(english).map(([ru, en]) => [en, ru]));
export const getLanguage = () => language;
export const browserLanguage = value => /^ru(?:[-_]|$)/i.test(value || '') ? 'ru' : 'en';
export function t(source, values = {}) {
  const text = language === 'en' ? english[source] || source : source;
  return text.replace(/\{(\w+)\}/g, (match, key) => values[key] === undefined ? match : String(values[key]));
}
function applyLanguage(value) {
  if (value !== 'ru' && value !== 'en') return;
  if (language === value) return;
  language = value;
  for (const listener of listeners) listener(value);
}
export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export async function initLanguage() {
  if (!initialized) initialized = (async () => {
    const fallback = browserLanguage(globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language);
    let changed = false;
    globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes.language) {
        changed = true;
        applyLanguage(changes.language.newValue || fallback);
      }
    });
    try {
      const saved = await globalThis.chrome?.storage?.local?.get('language');
      if (!changed) applyLanguage(['en', 'ru'].includes(saved?.language) ? saved.language : fallback);
    } catch { if (!changed) applyLanguage(fallback); }
  })();
  await initialized;
  return language;
}
export async function setLanguage(value) {
  if (!['en', 'ru'].includes(value)) throw new Error('Unsupported language');
  await globalThis.chrome?.storage?.local?.set({ language: value });
  applyLanguage(value);
}
// Jobs retain their original status/error text so switching languages never
// rewrites job state or interrupts a download. Also accepts older helper names.
export function translateMessage(value = '') {
  let source = String(value).replace(/[Пп]омощник(?:а|у|ом|е)?(?: Frame)?/g, 'frame-helper');
  source = reverse.get(source) || source;
  const http = source.match(/^Сервер вернул HTTP (\d+)\.$/);
  if (http) return t('Сервер вернул HTTP {status}.', { status: http[1] });
  const exitCode = source.match(/^yt-dlp завершился с ошибкой \(код (-?\d+)\)\.$/);
  if (exitCode) return t('yt-dlp завершился с ошибкой (код {code}).', { code: exitCode[1] });
  const missing = source.match(/^Не установлены: (.+)\. Откройте настройку frame-helper\.$/);
  if (missing) return t('Не установлены: {names}. Откройте настройку frame-helper.', { names: missing[1] });
  return t(source);
}
