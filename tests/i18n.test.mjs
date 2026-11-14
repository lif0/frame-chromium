import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { english } from '../src/translations.js';

test('saved language overrides browser language, persists, and updates other open views', async () => {
  const handlers = [], writes = [];
  globalThis.chrome = { i18n: { getUILanguage: () => 'en-US' }, storage: {
    local: { get: async () => ({ language: 'ru' }), set: async data => writes.push(data) },
    onChanged: { addListener: fn => handlers.push(fn) },
  } };
  try {
    const i18n = await import('../src/i18n.js?settings-test');
    await i18n.initLanguage();
    assert.equal(i18n.t('Начать скачивание'), 'Начать скачивание');
    const updates = []; i18n.onLanguageChange(lang => updates.push(lang));
    await i18n.setLanguage('en');
    assert.deepEqual(writes, [{ language: 'en' }]);
    assert.equal(i18n.t('Начать скачивание'), 'Start download');
    assert.equal(i18n.translateMessage('Помощник не найден.'), 'frame-helper was not found.');
    assert.equal(i18n.translateMessage('Собираем MP4…'), 'Merging MP4…');
    assert.equal(i18n.translateMessage('Не установлены: ffmpeg, deno. Откройте настройку помощника.'), 'Missing dependencies: ffmpeg, deno. Open frame-helper setup.');
    assert.equal(i18n.translateMessage('Сервер вернул HTTP 503.'), 'The server returned HTTP 503.');
    handlers[0]({ language: { newValue: 'ru' } }, 'local');
    assert.equal(i18n.translateMessage('Собираем MP4…'), 'Собираем MP4…');
    assert.deepEqual(updates, ['en', 'ru']);
    assert.equal(i18n.browserLanguage('ru-RU'), 'ru');
    assert.equal(i18n.browserLanguage('de-DE'), 'en');
    await assert.rejects(i18n.setLanguage('de'), /Unsupported/);
    assert.equal(writes.length, 1);
  } finally { delete globalThis.chrome; }
});

test('all marked UI text and accessibility labels have English translations', async () => {
  for (const name of ['popup', 'download', 'setup']) {
    const html = await readFile(`src/${name}.html`, 'utf8');
    for (const [, encoded] of html.matchAll(/data-i18n(?:-title|-aria-label|-alt)?="([^"]+)"/g)) {
      const key = encoded.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&');
      assert.ok(english[key], `${name}: ${key}`);
    }
    assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /[А-Яа-яЁё]/, `${name}: untranslated initial content`);
  }
});
