import { candidateList } from './media-context.js';
export const candidateSignature = candidates => candidateList(candidates).map(v => v.id).sort().join('|');
const icons = new Map();
export function countIcon(count, size) {
  const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d');
  ctx.scale(size / 32, size / 32);
  ctx.fillStyle = '#14845c'; ctx.beginPath(); ctx.arc(16, 16, 15.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(14, 7); ctx.lineTo(14, 19); ctx.moveTo(9, 14); ctx.lineTo(14, 19); ctx.lineTo(19, 14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, 23); ctx.lineTo(17, 23); ctx.stroke();
  // Chrome's native badge has a fixed shape. Paint a true circle into the icon.
  ctx.fillStyle = '#23382e'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(23.5, 23.5, 7.7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `700 ${count < 10 ? 12 : 10}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(count), 23.5, 24, 13);
  return ctx.getImageData(0, 0, size, size);
}
export async function setCount(tabId, count) {
  await chrome.action.setBadgeText({ tabId, text: '' });
  if (count) {
    if (!icons.has(count)) icons.set(count, { 16: countIcon(count, 16), 32: countIcon(count, 32) });
    await chrome.action.setIcon({ tabId, imageData: icons.get(count) });
  } else await chrome.action.setIcon({ tabId, path: { 16: 'icons/16.png', 32: 'icons/32.png' } });
  await chrome.action.setTitle({ tabId, title: count ? `Найдено видео: ${count} — Frame` : 'Скачать видео — Frame' });
}
export async function updateBadge(tabId, candidates) {
  const key = `view:${tabId}`, signature = candidateSignature(candidates);
  const view = (await chrome.storage.session.get(key))[key];
  const count = view?.signature === signature ? view.count : candidateList(candidates).length;
  await setCount(tabId, count);
}
