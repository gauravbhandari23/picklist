// Just enough Code 128 to read the Picklist ID barcode off a Myntra picklist.
// Pure: takes pixels, returns text. No DOM, no chrome.* — see test/barcode.test.mjs.

const TABLE = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 '
  + '122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 '
  + '312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 '
  + '231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 '
  + '311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 '
  + '112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 '
  + '114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 '
  + '411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112')
  .split(/\s+/).map((p) => [...p].map(Number));

const STOP = 106;
const START = { 103: 'A', 104: 'B', 105: 'C' };
const TOLERANCE = 0.5; // average module error allowed per element

function runsOf(bits) {
  const runs = [];
  let n = 1;
  for (let i = 1; i < bits.length; i += 1) {
    if (bits[i] === bits[i - 1]) n += 1;
    else { runs.push(n); n = 1; }
  }
  runs.push(n);
  return runs;
}

// Scale the measured widths so they sum to the symbol's module count, then take
// the closest table entry. Works whether a module is 1px or 10px wide.
function matchSymbol(runs, modules) {
  const scale = modules / runs.reduce((a, b) => a + b, 0);
  let best = null;
  let bestDist = Infinity;
  TABLE.forEach((pattern, value) => {
    if (pattern.length !== runs.length) return;
    let dist = 0;
    for (let i = 0; i < pattern.length; i += 1) dist += Math.abs(pattern[i] - runs[i] * scale);
    if (dist < bestDist) { bestDist = dist; best = value; }
  });
  return bestDist <= runs.length * TOLERANCE ? best : null;
}

function toText(values) {
  let mode = START[values[0]];
  if (!mode) return null;
  let out = '';
  for (const v of values.slice(1)) {
    if (v === 99) { mode = 'C'; continue; }
    if (v === 100) { mode = 'B'; continue; }
    if (v === 101) { mode = 'A'; continue; }
    if (v > 95) continue; // FNC / shift codes carry no characters we need
    if (mode === 'C') out += String(v).padStart(2, '0');
    else if (mode === 'A') out += String.fromCharCode(v < 64 ? v + 32 : v - 64);
    else out += String.fromCharCode(v + 32);
  }
  return out;
}

function decodeBits(bits) {
  let start = bits.indexOf(1);
  let end = bits.lastIndexOf(1);
  if (start === -1 || end - start < 20) return null;

  const runs = runsOf(bits.slice(start, end + 1));
  // A Code 128 is n symbols of 6 elements plus a 7-element stop.
  if (runs.length < 13 || (runs.length - 7) % 6 !== 0) return null;
  if (matchSymbol(runs.slice(-7), 13) !== STOP) return null;

  const values = [];
  for (let i = 0; i + 6 <= runs.length - 7; i += 6) {
    const v = matchSymbol(runs.slice(i, i + 6), 11);
    if (v === null) return null;
    values.push(v);
  }
  if (values.length < 3) return null;

  const check = values.pop();
  const sum = values[0] + values.slice(1).reduce((acc, v, i) => acc + v * (i + 1), 0);
  if (check !== sum % 103) return null; // a wrong ID is worse than no ID

  return toText(values);
}

function rowBits(image, y) {
  const { width, data } = image;
  const lum = new Array(width);
  let min = 255;
  let max = 0;
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const v = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    lum[x] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 40) return null; // blank strip, nothing to read
  const mid = (min + max) / 2;
  return lum.map((v) => (v < mid ? 1 : 0));
}

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image RGBA pixels
 * @returns {string|null} the barcode text, or null if nothing decodes cleanly
 */
export function decodeCode128(image) {
  const tally = new Map();
  for (let step = 1; step <= 9; step += 1) {
    const y = Math.floor((image.height * step) / 10);
    const bits = rowBits(image, y);
    if (!bits) continue;
    for (const candidate of [bits, [...bits].reverse()]) {
      const text = decodeBits(candidate);
      if (!text) continue;
      tally.set(text, (tally.get(text) ?? 0) + 1);
    }
  }
  if (!tally.size) return null;
  // Several scan lines must agree before we trust it.
  const [best] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  return best[1] >= 2 ? best[0] : null;
}

// Myntra prints the Picklist ID only as a barcode image, never as text. Rather
// than dig through pdf.js internals, lift the JPEGs straight out of the PDF
// bytes: inside a JPEG a literal FF is stuffed as FF 00, so a bare FF D9 is
// always the end marker.
export function extractJpegs(bytes) {
  const found = [];
  for (let i = 0; i + 3 < bytes.length; i += 1) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8 || bytes[i + 2] !== 0xff) continue;
    for (let j = i + 3; j + 1 < bytes.length; j += 1) {
      if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
        found.push(bytes.subarray(i, j + 2));
        i = j + 1;
        break;
      }
    }
  }
  return found;
}
