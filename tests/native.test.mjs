import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { nativeRequest } from '../src/native.js';

test('connection checks distinguish a missing, forbidden, and failed helper', async () => {
  for (const [detail, code, message] of [
    ['Specified native messaging host not found.', 'HELPER_MISSING', 'Помощник не найден.'],
    ['Access to the specified native messaging host is forbidden.', 'HELPER_FORBIDDEN', 'Помощник не подключён'],
    ['Native host has exited.', 'HELPER_DISCONNECTED', 'Помощник не запустился'],
  ]) {
  const disconnect = [];
  globalThis.chrome = { runtime: {
    lastError: undefined,
    connectNative: () => ({
      onMessage: { addListener() {} }, onDisconnect: { addListener: fn => disconnect.push(fn) }, disconnect() {},
      postMessage() { queueMicrotask(() => { chrome.runtime.lastError = { message: detail }; disconnect.forEach(fn => fn()); }); },
    }),
  } };
  try { await assert.rejects(nativeRequest({ action: 'ping' }), error => error.code === code && error.message.startsWith(message)); }
  finally { delete globalThis.chrome; }
  }
});
test('native host protocol covers formats, download, cancellation, and input validation', async () => {
  await new Promise((resolve, reject) => {
    const process = spawn('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'native*_test.py'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    process.stdout.on('data', chunk => { output += chunk; }); process.stderr.on('data', chunk => { output += chunk; });
    process.on('error', reject); process.on('close', code => code === 0 ? resolve() : reject(new Error(output)));
  });
});
