import { initLanguage, getLanguage, setLanguage, onLanguageChange, t } from './i18n.js';

export function translateDOM(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const attribute of ['title', 'aria-label', 'alt']) {
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
  }
  for (const template of root.querySelectorAll('template')) translateDOM(template.content);
}
export async function initUI() {
  await initLanguage();
  const header = document.querySelector('.top');
  const settings = document.createElement('details'); settings.className = 'settings-menu';
  settings.innerHTML = `<summary class="icon-button" data-i18n-title="Настройки" data-i18n-aria-label="Настройки"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 3-1 3-3 1-2 3 2 2-2 2 2 3 3 1 1 3h6l1-3 3-1 2-3-2-2 2-2-2-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg></summary><div class="settings-panel"><h2 data-i18n="Настройки"></h2><label for="language-select" data-i18n="Язык интерфейса"></label><select id="language-select"><option value="en">English</option><option value="ru">Русский</option></select><p class="settings-error" role="status" hidden></p></div>`;
  const actions = document.createElement('div'); actions.className = 'header-actions';
  while (header.children.length > 1) actions.append(header.children[1]);
  actions.append(settings); header.append(actions);
  const select = settings.querySelector('select');
  const render = () => { document.documentElement.lang = getLanguage(); translateDOM(); select.value = getLanguage(); };
  render(); onLanguageChange(render);
  select.addEventListener('change', async () => {
    select.disabled = true;
    const error = settings.querySelector('.settings-error'); error.hidden = true;
    try { await setLanguage(select.value); }
    catch { select.value = getLanguage(); error.textContent = t('Не удалось сохранить язык. Попробуйте ещё раз.'); error.hidden = false; }
    finally { select.disabled = false; }
  });
  document.addEventListener('click', event => { if (!settings.contains(event.target)) settings.open = false; });
  settings.addEventListener('keydown', event => { if (event.key === 'Escape') { settings.open = false; settings.querySelector('summary').focus(); } });
}
