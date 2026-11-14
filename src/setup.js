import { nativeRequest } from './native.js';
const id = chrome.runtime.id;
const commands = {
  macos: `bash native/install-macos.sh ${id}`,
  linux: `bash native/install-linux.sh ${id}`,
  windows: `powershell -NoProfile -ExecutionPolicy Bypass -File .\\native\\install-windows.ps1 ${id}`,
};
const tabs = [...document.querySelectorAll('[data-os]')];
let manuallySelected = false;
function selectOS(os, focus = false) {
  for (const tab of tabs) {
    const selected = tab.dataset.os === os;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.querySelector(`#os-${tab.dataset.os}`).hidden = !selected;
    if (selected && focus) tab.focus();
  }
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => { manuallySelected = true; selectOS(tab.dataset.os); });
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); manuallySelected = true;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectOS(tabs[next].dataset.os, true);
  });
}
chrome.runtime.getPlatformInfo().then(({ os }) => {
  if (!manuallySelected) selectOS(({ mac: 'macos', win: 'windows', linux: 'linux' })[os] || 'macos');
}).catch(() => {});
for (const element of document.querySelectorAll('[data-command]')) element.textContent = commands[element.dataset.command];
for (const button of document.querySelectorAll('[data-copy]')) button.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(commands[button.dataset.copy]); button.textContent = 'Скопировано'; }
  catch { document.querySelector('#status').textContent = 'Выделите и скопируйте команду вручную.'; }
});
document.querySelector('#check').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  const status = document.querySelector('#status'); status.textContent = 'Проверяем подключение…'; status.dataset.state = 'checking';
  try {
    const result = await nativeRequest({ action: 'ping' }, { signal: AbortSignal.timeout(12000) });
    status.textContent = `Помощник найден и готов к работе. yt-dlp ${result.ytdlpVersion}.`;
    status.dataset.state = 'success';
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' ? 'Помощник не ответил. Повторите проверку.' : error.message;
    status.dataset.state = 'error';
  } finally { button.disabled = false; }
});
