// Decodes the Picklist ID barcode lifted out of the real picklist PDF.
// The fixture is raw 8-bit grayscale so the test needs no image library.
//   node test/barcode.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeCode128 } from '../barcode.js';

const W = 112;
const H = 150;
const gray = readFileSync(fileURLToPath(new URL('fixtures/barcode-112x150.gray', import.meta.url)));
assert.equal(gray.length, W * H, 'fixture size');

const toImage = (g, width = W, height = H) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g[i];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
};

/* 1. The real barcode */
assert.equal(decodeCode128(toImage(gray)), 'OP22355506');
console.log('PASS  real picklist barcode -> OP22355506');

/* 2. Mirrored, in case the image is ever flipped */
{
  const flipped = Buffer.alloc(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) flipped[y * W + x] = gray[y * W + (W - 1 - x)];
  assert.equal(decodeCode128(toImage(flipped)), 'OP22355506');
  console.log('PASS  mirrored barcode still reads OP22355506');
}

/* 3. Scaled up 4x, as it would be if rendered from the page instead of extracted */
{
  const S = 4;
  const big = Buffer.alloc(W * S * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W * S; x += 1) big[y * W * S + x] = gray[y * W + Math.floor(x / S)];
  assert.equal(decodeCode128(toImage(big, W * S, H)), 'OP22355506');
  console.log('PASS  4x upscaled barcode still reads OP22355506');
}

/* 4. Noise must produce nothing rather than a wrong ID */
{
  const noise = Buffer.alloc(W * H);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) % 256;
  assert.equal(decodeCode128(toImage(noise)), null, 'noise must not decode');
  const blank = Buffer.alloc(W * H, 255);
  assert.equal(decodeCode128(toImage(blank)), null, 'blank must not decode');
  console.log('PASS  noise and blank images decode to null, never a guess');
}

/* 5. The JPEG really can be lifted out of the PDF bytes */
{
  const { extractJpegs } = await import('../barcode.js');
  const pdf = new Uint8Array(readFileSync(fileURLToPath(new URL('fixtures/picklist-sample.pdf', import.meta.url))));
  const jpegs = extractJpegs(pdf);
  assert.equal(jpegs.length, 1, 'the picklist holds exactly one image');
  const [jpg] = jpegs;
  assert.deepEqual([jpg[0], jpg[1], jpg[2]], [0xff, 0xd8, 0xff], 'starts with the JPEG marker');
  assert.deepEqual([jpg.at(-2), jpg.at(-1)], [0xff, 0xd9], 'ends with the JPEG marker');
  assert.ok(jpg.length > 1000, `extracted image looks too small (${jpg.length} bytes)`);
  console.log(`PASS  barcode JPEG extracted from the PDF (${jpg.length} bytes)`);
}
