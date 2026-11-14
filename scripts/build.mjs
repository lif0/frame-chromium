import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
await mkdir('dist', { recursive: true });
await cp('src', 'dist', { recursive: true });
await mkdir('dist/vendor', { recursive: true });
// Remove obsolete generated FFmpeg assets from earlier builds.
await rm('dist/vendor/ffmpeg', { recursive: true, force: true });
await rm('dist/vendor/core', { recursive: true, force: true });
await cp('node_modules/mediabunny/dist/bundles/mediabunny.mjs', 'dist/vendor/mediabunny.mjs');
await cp('node_modules/mediabunny/LICENSE', 'dist/vendor/MEDIABUNNY-LICENSE');
function crc(data) { let c = 0xffffffff; for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const t = Buffer.from(type), n = Buffer.alloc(4), sum = Buffer.alloc(4); n.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([n, t, data, sum]); }
await mkdir('dist/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x + .5) / size, ny = (y + .5) / size;
    const arrow = (Math.abs(nx - .5) < .065 && ny > .22 && ny < .59) || (ny > .43 && ny < .68 && Math.abs(nx - .5) < .68 - ny) || (ny > .74 && ny < .8 && nx > .27 && nx < .73);
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const alpha = Math.round(255 * Math.max(0, Math.min(1, (.49 - Math.hypot(nx - .5, ny - .5)) * size + .5)));
    pixels.set(arrow ? [255, 255, 255, alpha] : [21, 132, 93, alpha], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(`dist/icons/${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
}
await writeFile('dist/THIRD-PARTY.txt', 'Mediabunny 1.66.0 — MPL-2.0. Unmodified library. Source: https://github.com/Vanilagy/mediabunny/tree/v1.66.0\nLicense: vendor/MEDIABUNNY-LICENSE\n');
console.log('Built dist/ — load this directory in chrome://extensions');
