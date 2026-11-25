import { initUI } from './ui.js';
import { t, translateMessage, onLanguageChange } from './i18n.js';
import { downloadJob } from './job-runner.js';
import { restoreJob, terminalStates } from './jobs.js';
import { bytesLabel, sizeLabel } from './size.js';
import { nativeRequest } from './native.js';
const $ = selector => document.querySelector(selector);
const jobs = new Map();
const stateNames = { ready: 'Ожидает', running: 'Загрузка', done: 'Готово', canceled: 'Отменено', error: 'Ошибка', interrupted: 'Прервано' };
let owner = false;
function summary() {
  const values = [...jobs.values()];
  $('#count').textContent = values.length;
  const running = values.filter(j => j.active).length, waiting = values.filter(j => j.job.state === 'ready').length;
  $('#summary').textContent = values.length ? t('Скачиваются: {running} · Ожидают: {waiting} · Завершено: {done}', { running, waiting, done: values.filter(j => j.job.state === 'done').length }) : t('Видео со всех сайтов в одном месте.');
  $('#empty').hidden = values.length > 0;
  $('#clear').disabled = !values.some(j => terminalStates.has(j.job.state) && !j.active);
}
class DownloadRow {
  constructor(job) {
    this.job = restoreJob(job); this.active = false; this.writes = Promise.resolve(); this.lastRender = 0;
    this.root = $('#job-template').content.firstElementChild.cloneNode(true);
    this.el = name => this.root.querySelector(name);
    this.el('.start').addEventListener('click', () => this.start());
    this.el('.cancel').addEventListener('click', () => { this.controller?.abort(); this.el('.cancel').disabled = true; this.job.status = 'Отменяем…'; this.render(); });
    this.el('.remove').addEventListener('click', () => this.remove());
    this.el('.show').addEventListener('click', () => this.show());
    $('#jobs').append(this.root); this.render();
    if (job.state === 'running') this.persist(true);
  }
  persist(immediate = false) {
    if (!immediate) { if (!this.timer) this.timer = setTimeout(() => this.persist(true), 800); return; }
    clearTimeout(this.timer); this.timer = null;
    const value = { ...this.job };
    this.writes = this.writes.catch(() => {}).then(() => chrome.storage.session.set({ [`job:${value.id}`]: value }));
    this.writes.catch(() => {});
  }
  render() {
    const j = this.job;
    this.el('.job-title').textContent = j.title; this.el('.job-title').title = j.title;
    let site = ''; try { site = new URL(j.siteUrl || j.source || j.url).hostname; } catch {}
    this.el('.job-meta').textContent = [site, j.height ? `${j.height}p` : t('Исходное'), j.filename].filter(Boolean).join(' · ');
    this.el('.state-tag').textContent = t(stateNames[j.state] || 'Ожидает'); this.root.dataset.state = j.state;
    this.el('.status').textContent = translateMessage(j.status || 'Готово к скачиванию');
    if (j.state === 'running' && Number.isFinite(j.speed) && j.speed > 0) {
      this.el('.status').textContent += ` · ${bytesLabel(j.speed)}${t('/с')}`;
      if (Number.isFinite(j.eta) && j.eta > 0) this.el('.status').textContent += ` · ${t('осталось ≈ {seconds} с', { seconds: Math.ceil(j.eta) })}`;
    }
    this.el('.size').textContent = j.state === 'done' && j.outputBytes ? `${bytesLabel(j.outputBytes)} · ${t('файл')}` : j.downloaded ? `${bytesLabel(j.downloaded)} / ${sizeLabel(j.size)}` : sizeLabel(j.size);
    this.el('.bar').style.width = `${Math.min(100, Math.max(0, j.progress || 0))}%`;
    this.el('.progress').setAttribute('aria-valuenow', String(Math.round(j.progress || 0)));
    this.el('.start').hidden = this.active || j.state === 'done';
    this.el('.start').textContent = t(j.state === 'ready' ? 'Начать скачивание' : 'Повторить');
    this.el('.start').disabled = this.active;
    this.el('.cancel').hidden = !this.active || !this.controller;
    this.el('.remove').hidden = this.active;
    this.el('.show').hidden = j.state !== 'done' || (!this.result?.fileHandle && j.downloadId === undefined && !j.nativeFileId);
    this.el('.job-error').textContent = translateMessage(j.error || ''); this.el('.job-error').hidden = !j.error;
    summary();
  }
  async start() {
    if (this.active) return;
    this.active = true; this.render();
    let handle;
    try {
      // The save picker is invoked in the original click's activation context.
      if (this.job.type === 'hls' && typeof window.showSaveFilePicker === 'function') handle = await window.showSaveFilePicker({ suggestedName: this.job.filename, types: [{ description: t('MP4 видео'), accept: { 'video/mp4': ['.mp4'] } }] });
    } catch (e) {
      this.active = false;
      if (e.name !== 'AbortError') { this.job.state = 'error'; this.job.status = 'Не удалось скачать'; this.job.error = e.message; this.persist(true); }
      this.render(); return;
    }
    this.controller = new AbortController(); this.el('.cancel').disabled = false;
    Object.assign(this.job, { state: 'running', error: '', downloaded: 0, progress: 0, speed: 0, eta: null, status: 'Подготовка…' });
    this.persist(true); this.render();
    try {
      this.result = await downloadJob(this.job, { signal: this.controller.signal, fileHandle: handle, onUpdate: update => {
        Object.assign(this.job, update); this.persist();
        if (performance.now() - this.lastRender > 120) { this.lastRender = performance.now(); this.render(); }
      } });
      Object.assign(this.job, { state: 'done', status: 'Видео сохранено', progress: 100, outputBytes: this.result.bytes });
      if (this.result.downloadId !== undefined) this.job.downloadId = this.result.downloadId;
      if (this.result.nativeFileId) { this.job.nativeFileId = this.result.nativeFileId; this.job.filename = this.result.filename; }
    } catch (e) {
      const canceled = this.controller.signal.aborted || e.code === 'CANCELED';
      Object.assign(this.job, { state: canceled ? 'canceled' : 'error', status: canceled ? 'Загрузка отменена' : 'Не удалось скачать', error: canceled ? '' : e.name === 'QuotaExceededError' ? 'Не хватает места на диске для временных файлов.' : e.message || String(e) });
    } finally { this.active = false; this.controller = null; this.persist(true); this.render(); }
  }
  async show() {
    try {
      if (this.job.nativeFileId) return await nativeRequest({ action: 'open', fileId: this.job.nativeFileId });
      if (this.job.downloadId !== undefined) return await chrome.downloads.show(this.job.downloadId);
      const url = URL.createObjectURL(await this.result.fileHandle.getFile());
      await chrome.tabs.create({ url });
      window.addEventListener('unload', () => URL.revokeObjectURL(url), { once: true });
    } catch (e) { this.job.error = e.message; this.render(); }
  }
  async remove() {
    if (this.active) return;
    clearTimeout(this.timer); await this.writes.catch(() => {});
    await chrome.storage.session.remove(`job:${this.job.id}`);
    this.root.remove(); jobs.delete(this.job.id); summary();
  }
}
function focusJob(id) {
  const row = jobs.get(id);
  if (!row) return;
  requestAnimationFrame(() => {
    document.querySelectorAll('.job-row.is-selected').forEach(el => el.classList.remove('is-selected'));
    row.root.classList.add('is-selected');
    row.root.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!row.active && row.job.state !== 'done') row.el('.start').focus({ preventScroll: true });
  });
}
function add(job) { if (!jobs.has(job.id)) { const row = new DownloadRow(job); jobs.set(job.id, row); summary(); } }
window.addEventListener('beforeunload', e => { if ([...jobs.values()].some(j => j.active)) { e.preventDefault(); e.returnValue = ''; } });
$('#clear').addEventListener('click', async () => { for (const row of [...jobs.values()]) if (terminalStates.has(row.job.state)) await row.remove(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (!owner || area !== 'session') return;
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith('job:')) continue;
    if (change.newValue) add(change.newValue);
    else { const id = key.slice(4), row = jobs.get(id); if (row && !row.active) { row.root.remove(); jobs.delete(id); } }
  }
  summary();
  if (changes['manager-focus']?.newValue) focusJob(changes['manager-focus'].newValue);
});
await initUI();
onLanguageChange(() => { for (const row of jobs.values()) row.render(); summary(); });
// Only one manager may execute jobs, even if a user duplicates its tab manually.
navigator.locks.request('frame-download-manager', { ifAvailable: true }, async lock => {
  if (!lock) {
    const message = 'Менеджер уже открыт в другой вкладке. Закройте эту вкладку и откройте его через «Все загрузки» в расширении.';
    $('#manager-notice').textContent = t(message);
    onLanguageChange(() => { $('#manager-notice').textContent = t(message); $('#clear').disabled = true; });
    $('#manager-notice').hidden = false; $('#clear').disabled = true; return;
  }
  owner = true;
  const saved = await chrome.storage.session.get(null);
  Object.entries(saved).filter(([k]) => k.startsWith('job:')).map(([,v]) => v).sort((a,b) => a.createdAt - b.createdAt).forEach(add);
  summary();
  if (saved['manager-focus']) focusJob(saved['manager-focus']);
  await new Promise(resolve => window.addEventListener('pagehide', resolve, { once: true }));
}).catch(e => { $('#manager-notice').textContent = translateMessage(e.message); $('#manager-notice').hidden = false; });
