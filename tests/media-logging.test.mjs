import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardMediaWarning } from '../dist/media.js';

test('only the known unused ID3 metadata warning is filtered', () => {
  const original = console.warn, warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    forwardMediaWarning(['Note: MPEG-TS streams with stream_type 0x15 are not currently supported.']);
    forwardMediaWarning(['Note: MPEG-TS streams with stream_type 0x24 are not currently supported.']);
    forwardMediaWarning(['Corrupt video packet', { offset: 120 }]);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0][0], /0x24/);
    assert.deepEqual(warnings[1], ['Corrupt video packet', { offset: 120 }]);
  } finally { console.warn = original; }
});
