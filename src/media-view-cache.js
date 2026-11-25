import { candidateList } from './media-context.js';

export const mediaViewKey = tabId => `media-view:${tabId}`;
// Access changes invalidate cached signed URLs even when the candidate IDs stay the same.
export const mediaViewSignature = candidates => JSON.stringify(candidateList(candidates));
export function cachedMediaView(entry, url, signature, now = Date.now()) {
  if (!entry || entry.url !== url || entry.signature !== signature || !entry.items?.length) return null;
  const age = now - entry.time;
  return age >= 0 && age < 120000 ? entry.items : null;
}
