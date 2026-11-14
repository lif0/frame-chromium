import test from 'node:test';
import assert from 'node:assert/strict';
import { requireManagerResponse } from '../src/messages.js';
test('old background worker response cannot silently close the popup', () => {
  for (const response of [undefined, null, {}, { ok: true }, { tabId: -1 }]) {
    assert.throws(() => requireManagerResponse(response), /не ответила/);
  }
  assert.throws(() => requireManagerResponse({ error: 'Cannot create tab' }), /Cannot create tab/);
  assert.equal(requireManagerResponse({ tabId: 123 }), 123);
});
