export const terminalStates = new Set(['done', 'canceled', 'error', 'interrupted']);
export function restoreJob(job) {
  return job.state === 'running' ? { ...job, state: 'interrupted', status: 'Прервано при закрытии вкладки', progress: 0 } : job;
}
export async function openManager(api) {
  const url = api.runtime.getURL('download.html');
  // tabs.query may omit extension URLs without the broad tabs permission.
  const contexts = await api.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  const existing = contexts.find(context => context.tabId >= 0);
  if (existing) {
    await api.tabs.update(existing.tabId, { active: true });
    await api.windows.update(existing.windowId, { focused: true });
    return existing.tabId;
  }
  const created = await api.tabs.create({ url, active: true });
  await api.windows.update(created.windowId, { focused: true });
  return created.id;
}
