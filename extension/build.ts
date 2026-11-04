// Builds the extension into dist/. Run with `node build.ts` (or `--watch`).
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'icons'), { recursive: true });
for (const file of ['manifest.json', 'notice.html']) copyFileSync(join(root, 'static', file), join(dist, file));
for (const size of [16, 48, 128]) writeFileSync(join(dist, 'icons', `${size}.png`), icon(size));

const options: esbuild.BuildOptions = {
  entryPoints: {
    background: join(root, 'src', 'background.ts'),
    content: join(root, 'src', 'content', 'index.tsx'),
    'main-world': join(root, 'src', 'main-world.ts'),
    notice: join(root, 'src', 'notice.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'text' },
  sourcemap: 'linked',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Watching. Reload the extension in brave://extensions after a change.');
} else {
  await esbuild.build(options);
}

// ---------- icon: a speech bubble with a check, drawn pixel by pixel ----------

function icon(size: number): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 16;
  const inRoundRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number) => {
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  const distToSegment = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / s;
      const v = (y + 0.5) / s;
      const bubble = inRoundRect(u, v, 1, 1, 15, 12, 3);
      const tail = v >= 11 && v <= 15 && u >= 3 && u <= 7 && u - 3 <= 15 - v;
      const check =
        Math.min(distToSegment(u, v, 4.5, 6.5, 7, 9), distToSegment(u, v, 7, 9, 11.5, 4)) <= 1.1;
      const i = (y * size + x) * 4;
      if (bubble && check) px.set([255, 255, 255, 255], i);
      else if (bubble || tail) px.set([91, 76, 219, 255], i);
    }
  }
  return encodePng(size, size, px);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
