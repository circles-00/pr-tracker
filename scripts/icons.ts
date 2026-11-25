import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

type Rgba = readonly [number, number, number, number];
type PixelShader = (u: number, v: number) => Rgba;

function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function renderPng(size: number, pixel: PixelShader): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const samples = 4;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size);
          r += pr * pa;
          g += pg * pa;
          b += pb * pa;
          a += pa;
        }
      }
      const idx = y * (size * 4 + 1) + 1 + x * 4;
      raw[idx] = a ? r / a : 0;
      raw[idx + 1] = a ? g / a : 0;
      raw[idx + 2] = a ? b / a : 0;
      raw[idx + 3] = (a / (samples * samples)) * 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function bellIconPixel(u: number, v: number): Rgba {
  const radius = 0.2;
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - radius), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - radius), 0);
  if (dx * dx + dy * dy > radius * radius) return [0, 0, 0, 0];

  const white: Rgba = [255, 255, 255, 1];
  const orange: Rgba = [252, 109, 38, 1];
  const x = u - 0.5;
  const top = 0.2;
  const rim = 0.68;

  if (v >= top && v <= rim) {
    const t = (v - top) / (rim - top);
    const half = 0.12 + 0.18 * Math.pow(t, 1.6);
    const domeCut = t < 0.25 ? Math.sqrt(1 - Math.pow(1 - t / 0.25, 2)) : 1;
    if (Math.abs(x) <= half * domeCut) return white;
  }
  if (v > rim && v <= rim + 0.06 && Math.abs(x) <= 0.33) return white;
  if (Math.hypot(x, v - 0.8) <= 0.07) return white;
  if (Math.hypot(x, v - 0.17) <= 0.045) return white;
  return orange;
}

export async function generateIcons(iconsDir: string): Promise<void> {
  const sizes = [16, 32, 48, 128];
  await Promise.all(sizes.map((size) => writeFile(`${iconsDir}/icon-${size}.png`, renderPng(size, bellIconPixel))));
}
