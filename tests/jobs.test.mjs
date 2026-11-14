import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreJob } from '../src/jobs.js';
test('reopening manager marks incomplete work as interrupted', () => {
  assert.equal(restoreJob({ state: 'running' }).state, 'interrupted');
  for (const state of ['ready', 'done', 'error', 'canceled']) assert.equal(restoreJob({ state }).state, state);
});
test('simultaneous add requests create one manager and retain both jobs', async () => {
  const messages = [], records = {}, tabs = [];
  let created = 0; const createdOptions = [], focusedWindows = [];
  const event = { addListener() {} };
  globalThis.chrome = {
    runtime: { getContexts: async () => tabs.map(t => ({ tabId: t.id, windowId: t.windowId })), getURL: p => `chrome-extension://test/${p}`, onMessage: { addListener: fn => messages.push(fn) } },
    webRequest: { onHeadersReceived: event, onSendHeaders: event, onCompleted: event, onErrorOccurred: event },
    tabs: { onUpdated: event, onRemoved: event, query: async () => tabs, create: async options => {
      createdOptions.push(options); const { url } = options;
      await new Promise(r => setTimeout(r, 10)); const tab = { id: ++created, windowId: 1, url }; tabs.push(tab); return tab;
    }, update: async () => {} },
    windows: { update: async (id, options) => focusedWindows.push({ id, ...options }) },
    storage: { session: { set: async data => Object.assign(records, data) } },
  };
  try {
    await import('../src/background.js?jobs-test');
    const send = title => new Promise(resolve => messages[0]({ type: 'queue-job', job: { title } }, { url: 'chrome-extension://test/popup.html' }, resolve));
    const responses = await Promise.all([send('Site A'), send('Site B')]);
    assert.equal(created, 1); assert.equal(Object.keys(records).filter(k => k.startsWith('job:')).length, 2);
    assert.deepEqual(responses.map(r => r.tabId), [1, 1]);
    assert.equal(createdOptions[0].active, true);
    assert.equal(focusedWindows.length, 2);
    assert.ok(focusedWindows.every(w => w.focused));
    assert.equal(records[`job:${records['manager-focus']}`].title, 'Site B');
    assert.deepEqual(Object.entries(records).filter(([k]) => k.startsWith('job:')).map(([,j]) => j.title), ['Site A', 'Site B']);
  } finally { delete globalThis.chrome; }
});
