import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../src/detect.js', import.meta.url), 'utf8');
test('discovery stops cleanly when Chrome throws synchronously after extension reload', () => {
  const observers = [];
  class Observer {
    constructor(fn) { this.callback = fn; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const context = vm.createContext({
    location: { hostname: 'example.com', href: 'https://example.com/', pathname: '/' },
    chrome: { runtime: { id: 'test', sendMessage() { throw new Error('Extension context invalidated.'); } } },
    performance: { getEntriesByType: () => [{ name: 'https://cdn.example/video.m3u8' }] },
    document: { documentElement: {}, querySelectorAll: () => [] },
    PerformanceObserver: Observer, MutationObserver: Observer, setTimeout, clearTimeout,
  });
  assert.doesNotThrow(() => vm.runInContext(source, context));
  assert.equal(context.__frameDetector.alive(), false);
  assert.ok(observers.every(o => o.disconnected));
});
test('reinjection does not install duplicate discovery observers', () => {
  let count = 0;
  class Observer { constructor() { count++; } observe() {} disconnect() {} }
  const context = vm.createContext({
    location: { hostname: 'example.com', href: 'https://example.com/', pathname: '/' },
    chrome: { runtime: { id: 'test', sendMessage: async () => ({ ok: true }) } },
    performance: { getEntriesByType: () => [] },
    document: { documentElement: {}, querySelectorAll: () => [] },
    PerformanceObserver: Observer, MutationObserver: Observer, setTimeout, clearTimeout,
  });
  vm.runInContext(source, context); vm.runInContext(source, context);
  assert.equal(count, 2);
});
