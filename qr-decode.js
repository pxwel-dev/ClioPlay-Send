/* Self-contained offline ISO/IEC 18004 QR Code decoder (Versions 1-10, ECC L/M/Q/H).
 * Used as zero-dependency fallback on iOS Safari / Home Screen PWAs where
 * window.BarcodeDetector is unavailable. Pure ES module, MIT license. */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
function gfInv(a) {
  return GF_EXP[255 - GF_LOG[a]];
}

/* Reed-Solomon decode in place for one block of `data.length` bytes with `ecCount` ECC bytes. */
function rsDecode(data, ecCount) {
  const n = data.length;
  const syn = new Uint8Array(ecCount);
  let hasErr = false;
  for (let i = 0; i < ecCount; i++) {
    let evalVal = 0;
    const root = GF_EXP[i];
    for (let j = 0; j < n; j++) evalVal = gfMul(evalVal, root) ^ data[j];
    syn[i] = evalVal;
    if (evalVal) hasErr = true;
  }
  if (!hasErr) return true;

  // Berlekamp-Massey
  let C = [1], B = [1];
  let L = 0, m = 1, b = 1;
  for (let r = 0; r < ecCount; r++) {
    let d = syn[r];
    for (let i = 1; i <= L; i++) d ^= gfMul(C[i] || 0, syn[r - i]);
    if (d === 0) {
      m++;
    } else {
      const T = C.slice();
      const coef = gfMul(d, gfInv(b));
      while (C.length < B.length + m) C.push(0);
      for (let i = 0; i < B.length; i++) C[i + m] ^= gfMul(coef, B[i]);
      if (2 * L <= r) {
        L = r + 1 - L;
        B = T;
        b = d;
        m = 1;
      } else {
        m++;
      }
    }
  }
  if (L > (ecCount >> 1)) return false;

  // Chien search for error positions
  const errPos = [];
  for (let i = 0; i < n; i++) {
    const xInv = GF_EXP[(255 - i) % 255]; // alpha^(-i)
    let sum = 0, pow = 1;
    for (let j = 0; j <= L; j++) {
      sum ^= gfMul(C[j] || 0, pow);
      pow = gfMul(pow, xInv);
    }
    if (sum === 0) errPos.push(i); // degree index from right (byte index = n - 1 - i)
  }
  if (errPos.length !== L) return false;

  // Error evaluator Omega(x) = (S(x) * C(x)) mod x^ecCount
  const omega = new Uint8Array(ecCount);
  for (let i = 0; i < ecCount; i++) {
    let v = 0;
    for (let j = 0; j <= L && j <= i; j++) v ^= gfMul(C[j] || 0, syn[i - j]);
    omega[i] = v;
  }

  // Forney algorithm
  for (const deg of errPos) {
    const xInv = GF_EXP[(255 - deg) % 255];
    let num = 0, pow = 1;
    for (let j = 0; j < ecCount; j++) {
      num ^= gfMul(omega[j], pow);
      pow = gfMul(pow, xInv);
    }
    let den = 0;
    pow = 1;
    for (let j = 1; j <= L; j += 2) {
      den ^= gfMul(C[j] || 0, pow);
      pow = gfMul(pow, gfMul(xInv, xInv));
    }
    if (den === 0) return false;
    const errMag = gfMul(GF_EXP[deg % 255], gfMul(num, gfInv(den)));
    data[n - 1 - deg] ^= errMag;
  }

  // Re-verify syndromes == 0
  for (let i = 0; i < ecCount; i++) {
    let evalVal = 0;
    const root = GF_EXP[i];
    for (let j = 0; j < n; j++) evalVal = gfMul(evalVal, root) ^ data[j];
    if (evalVal !== 0) return false;
  }
  return true;
}

/* Format info table: 32 valid 15-bit format words indexed by (ecLevelBits << 3) | mask.
 * ecLevelBits: 01=L(1), 00=M(0), 11=Q(3), 10=H(2). */
const FMT_TABLE = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
  0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b,
  0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed
];

const ALIGN_POS = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
];

/* Block specs for Versions 1..10, keyed by ecLevelBits (0=M, 1=L, 2=H, 3=Q).
 * Each entry: [ecPerBlock, [[count, dataCw], ...]] */
const EC_SPECS = {
  1: { // L
    1: [7, [[1, 19]]], 2: [10, [[1, 34]]], 3: [15, [[1, 55]]], 4: [20, [[1, 80]]],
    5: [26, [[1, 108]]], 6: [18, [[2, 68]]], 7: [20, [[2, 78]]], 8: [24, [[2, 97]]],
    9: [30, [[2, 116]]], 10: [18, [[2, 68], [2, 69]]]
  },
  0: { // M
    1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]],
    5: [24, [[2, 43]]], 6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]],
    9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]]
  },
  3: { // Q
    1: [13, [[1, 13]]], 2: [22, [[1, 22]]], 3: [18, [[2, 17]]], 4: [26, [[2, 24]]],
    5: [18, [[2, 15], [2, 16]]], 6: [24, [[4, 19]]], 7: [18, [[2, 14], [4, 15]]],
    8: [22, [[4, 18], [2, 19]]], 9: [20, [[4, 16], [4, 17]]], 10: [24, [[6, 19], [2, 20]]]
  },
  2: { // H
    1: [17, [[1, 9]]], 2: [28, [[1, 16]]], 3: [22, [[2, 13]]], 4: [16, [[4, 9]]],
    5: [22, [[2, 11], [2, 12]]], 6: [28, [[4, 15]]], 7: [26, [[4, 13], [1, 14]]],
    8: [26, [[4, 14], [2, 15]]], 9: [24, [[4, 12], [4, 13]]], 10: [28, [[6, 15], [2, 16]]]
  }
};

function popcount16(v) {
  let c = 0;
  while (v) { v &= v - 1; c++; }
  return c;
}

function decodeFormatInfo(bits1, bits2) {
  let bestDist = 4, bestIdx = -1;
  for (let i = 0; i < 32; i++) {
    const d1 = popcount16(bits1 ^ FMT_TABLE[i]);
    const d2 = popcount16(bits2 ^ FMT_TABLE[i]);
    const d = Math.min(d1, d2);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  if (bestIdx < 0) return null;
  return { ecBits: bestIdx >> 3, mask: bestIdx & 7 };
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return ((x + y) & 1) === 0;
    case 1: return (y & 1) === 0;
    case 2: return (x % 3) === 0;
    case 3: return ((x + y) % 3) === 0;
    case 4: return (((y >> 1) + Math.floor(x / 3)) & 1) === 0;
    case 5: return ((x * y) & 1) + ((x * y) % 3) === 0;
    case 6: return ((((x * y) & 1) + ((x * y) % 3)) & 1) === 0;
    default: return ((((x + y) & 1) + ((x * y) % 3)) & 1) === 0;
  }
}

function buildFunctionMask(ver) {
  const s = 17 + 4 * ver;
  const f = new Uint8Array(s * s);
  const mark = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y <= Math.min(s - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(s - 1, x1); x++) f[y * s + x] = 1;
  };
  mark(0, 0, 8, 8);
  mark(s - 8, 0, s - 1, 8);
  mark(0, s - 8, 8, s - 1);
  for (let i = 0; i < s; i++) { f[6 * s + i] = 1; f[i * s + 6] = 1; }
  const ap = ALIGN_POS[ver];
  for (let i = 0; i < ap.length; i++) {
    for (let j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
      mark(ap[i] - 2, ap[j] - 2, ap[i] + 2, ap[j] + 2);
    }
  }
  if (ver >= 7) {
    mark(s - 11, 0, s - 9, 5);
    mark(0, s - 11, 5, s - 9);
  }
  return f;
}

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const UTF8 = new TextDecoder("utf-8", { fatal: false });

function decodeBitStream(bytes, ver) {
  let bitPos = 0;
  const totalBits = bytes.length * 8;
  const readBits = n => {
    if (bitPos + n > totalBits) return -1;
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((bytes[bitPos >> 3] >> (7 - (bitPos & 7))) & 1);
      bitPos++;
    }
    return v;
  };

  const outBytes = [];
  const pushStr = s => { for (let i = 0; i < s.length; i++) outBytes.push(s.charCodeAt(i)); };

  while (bitPos + 4 <= totalBits) {
    const mode = readBits(4);
    if (mode === 0) break;
    if (mode === 4) { // Byte mode
      const cntBits = ver <= 9 ? 8 : 16;
      const cnt = readBits(cntBits);
      if (cnt < 0 || bitPos + cnt * 8 > totalBits) return null;
      for (let i = 0; i < cnt; i++) outBytes.push(readBits(8));
    } else if (mode === 2) { // Alphanumeric
      const cntBits = ver <= 9 ? 9 : 11;
      let cnt = readBits(cntBits);
      if (cnt < 0) return null;
      while (cnt >= 2) {
        const pair = readBits(11);
        if (pair < 0) return null;
        pushStr(ALNUM[Math.floor(pair / 45)] + ALNUM[pair % 45]);
        cnt -= 2;
      }
      if (cnt === 1) {
        const v = readBits(6);
        if (v < 0) return null;
        pushStr(ALNUM[v]);
      }
    } else if (mode === 1) { // Numeric
      const cntBits = ver <= 9 ? 10 : 12;
      let cnt = readBits(cntBits);
      if (cnt < 0) return null;
      while (cnt >= 3) {
        const v = readBits(10);
        if (v < 0 || v > 999) return null;
        pushStr(String(v).padStart(3, "0"));
        cnt -= 3;
      }
      if (cnt === 2) {
        const v = readBits(7);
        if (v < 0 || v > 99) return null;
        pushStr(String(v).padStart(2, "0"));
      } else if (cnt === 1) {
        const v = readBits(4);
        if (v < 0 || v > 9) return null;
        pushStr(String(v));
      }
    } else if (mode === 7) { // ECI
      const b1 = readBits(8);
      if (b1 < 0) return null;
      if ((b1 & 0xc0) === 0x80) readBits(8);
      else if ((b1 & 0xe0) === 0xc0) readBits(16);
    } else {
      return null;
    }
  }
  if (!outBytes.length) return null;
  return UTF8.decode(new Uint8Array(outBytes));
}

export function decodeQrMatrix(matrix, size) {
  const ver = (size - 17) / 4;
  if (!Number.isInteger(ver) || ver < 1 || ver > 10) return null;

  // Read both copies of 15-bit format info (MSB = bit 14)
  const bit = (x, y) => (matrix[y * size + x] ? 1 : 0);
  let f1 = 0;
  for (let i = 0; i <= 5; i++) f1 |= bit(8, i) << i;
  f1 |= bit(8, 7) << 6;
  f1 |= bit(8, 8) << 7;
  f1 |= bit(7, 8) << 8;
  for (let i = 9; i < 15; i++) f1 |= bit(14 - i, 8) << i;

  let f2 = 0;
  for (let i = 0; i < 8; i++) f2 |= bit(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) f2 |= bit(8, size - 15 + i) << i;

  const fmt = decodeFormatInfo(f1, f2);
  if (!fmt) return null;

  const spec = EC_SPECS[fmt.ecBits]?.[ver];
  if (!spec) return null;
  const [ecPerBlock, groups] = spec;
  const func = buildFunctionMask(ver);

  // Extract raw interleaved codewords
  const blocks = [];
  for (const [cnt, dcw] of groups) {
    for (let i = 0; i < cnt; i++) blocks.push({ dcw, cw: new Uint8Array(dcw + ecPerBlock) });
  }
  const totalCw = blocks.reduce((a, b) => a + b.cw.length, 0);
  const rawCw = new Uint8Array(totalCw);
  let curByte = 0, curBits = 0, cwIdx = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const up = ((right + 1) & 2) === 0;
      const y = up ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (func[y * size + x]) continue;
        let b = bit(x, y);
        if (maskBit(fmt.mask, x, y)) b ^= 1;
        curByte = (curByte << 1) | b;
        curBits++;
        if (curBits === 8) {
          if (cwIdx < totalCw) rawCw[cwIdx++] = curByte;
          curByte = 0; curBits = 0;
        }
      }
    }
  }

  // De-interleave data & ECC codewords
  const maxDcw = Math.max(...blocks.map(b => b.dcw));
  let ptr = 0;
  for (let i = 0; i < maxDcw; i++) {
    for (const blk of blocks) {
      if (i < blk.dcw) blk.cw[i] = rawCw[ptr++];
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const blk of blocks) {
      blk.cw[blk.dcw + i] = rawCw[ptr++];
    }
  }

  // RS error correction per block
  const dataOut = [];
  for (const blk of blocks) {
    if (!rsDecode(blk.cw, ecPerBlock)) return null;
    for (let i = 0; i < blk.dcw; i++) dataOut.push(blk.cw[i]);
  }
  return decodeBitStream(new Uint8Array(dataOut), ver);
}

/* Adaptive binarisation using integral image (handles car screen glare & dim interiors). */
function binarise(rgba, w, h) {
  const gray = new Uint8Array(w * h);
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const rowOff = y * w;
    const iRow = (y + 1) * (w + 1);
    const pRow = y * (w + 1);
    for (let x = 0; x < w; x++) {
      const o = (rowOff + x) * 4;
      const l = (rgba[o] * 77 + rgba[o + 1] * 150 + rgba[o + 2] * 29) >> 8;
      gray[rowOff + x] = l;
      rowSum += l;
      integ[iRow + x + 1] = integ[pRow + x + 1] + rowSum;
    }
  }
  const bits = new Uint8Array(w * h);
  const rad = Math.max(8, Math.min(32, Math.floor(Math.min(w, h) / 14)));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rad), y1 = Math.min(h - 1, y + rad);
    const r0 = y0 * (w + 1), r1 = (y1 + 1) * (w + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rad), x1 = Math.min(w - 1, x + rad);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mean = (integ[r1 + x1 + 1] - integ[r0 + x1 + 1] - integ[r1 + x0] + integ[r0 + x0]) / area;
      bits[y * w + x] = gray[y * w + x] < mean - 10 ? 1 : 0;
    }
  }
  return bits;
}

function ratioOk(s) {
  const tot = s[0] + s[1] + s[2] + s[3] + s[4];
  if (tot < 7) return false;
  const mod = tot / 7;
  const tol = mod * 0.65;
  return Math.abs(mod - s[0]) < tol &&
    Math.abs(mod - s[1]) < tol &&
    Math.abs(3 * mod - s[2]) < 3 * tol &&
    Math.abs(mod - s[3]) < tol &&
    Math.abs(mod - s[4]) < tol;
}

function crossCheckVert(bits, w, h, cx, startY, maxRun, origTot) {
  const s = [0, 0, 0, 0, 0];
  let y = startY;
  while (y >= 0 && bits[y * w + cx]) { s[2]++; y--; }
  if (y < 0) return NaN;
  while (y >= 0 && !bits[y * w + cx] && s[1] <= maxRun) { s[1]++; y--; }
  if (y < 0 || s[1] > maxRun) return NaN;
  while (y >= 0 && bits[y * w + cx] && s[0] <= maxRun) { s[0]++; y--; }
  if (s[0] > maxRun) return NaN;
  y = startY + 1;
  while (y < h && bits[y * w + cx]) { s[2]++; y++; }
  if (y === h) return NaN;
  while (y < h && !bits[y * w + cx] && s[3] <= maxRun) { s[3]++; y++; }
  if (y === h || s[3] > maxRun) return NaN;
  while (y < h && bits[y * w + cx] && s[4] <= maxRun) { s[4]++; y++; }
  if (s[4] > maxRun) return NaN;
  const tot = s[0] + s[1] + s[2] + s[3] + s[4];
  if (Math.abs(tot - origTot) * 5 >= 2 * origTot) return NaN;
  return ratioOk(s) ? (y - s[4] - s[3] - s[2] / 2) : NaN;
}

function crossCheckHoriz(bits, w, h, startX, cy, maxRun, origTot) {
  const s = [0, 0, 0, 0, 0];
  let x = startX;
  while (x >= 0 && bits[cy * w + x]) { s[2]++; x--; }
  if (x < 0) return NaN;
  while (x >= 0 && !bits[cy * w + x] && s[1] <= maxRun) { s[1]++; x--; }
  if (x < 0 || s[1] > maxRun) return NaN;
  while (x >= 0 && bits[cy * w + x] && s[0] <= maxRun) { s[0]++; x--; }
  if (s[0] > maxRun) return NaN;
  x = startX + 1;
  while (x < w && bits[cy * w + x]) { s[2]++; x++; }
  if (x === w) return NaN;
  while (x < w && !bits[cy * w + x] && s[3] <= maxRun) { s[3]++; x++; }
  if (x === w || s[3] > maxRun) return NaN;
  while (x < w && bits[cy * w + x] && s[4] <= maxRun) { s[4]++; x++; }
  if (s[4] > maxRun) return NaN;
  const tot = s[0] + s[1] + s[2] + s[3] + s[4];
  if (Math.abs(tot - origTot) * 5 >= 2 * origTot) return NaN;
  return ratioOk(s) ? (x - s[4] - s[3] - s[2] / 2) : NaN;
}

function findFinders(bits, w, h) {
  const candidates = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 140));
  for (let y = step; y < h; y += step) {
    const s = [0, 0, 0, 0, 0];
    let cur = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (bits[row + x]) {
        if ((cur & 1) === 1) cur++;
        s[cur]++;
      } else {
        if ((cur & 1) === 0) {
          if (cur === 4) {
            if (ratioOk(s)) {
              const tot = s[0] + s[1] + s[2] + s[3] + s[4];
              const cx = x - s[4] - s[3] - s[2] / 2;
              const cy = crossCheckVert(bits, w, h, Math.round(cx), y, s[2], tot);
              if (!Number.isNaN(cy)) {
                const cx2 = crossCheckHoriz(bits, w, h, Math.round(cx), Math.round(cy), s[2], tot);
                if (!Number.isNaN(cx2)) {
                  const mod = tot / 7;
                  let merged = false;
                  for (const c of candidates) {
                    if (Math.abs(c.x - cx2) <= mod * 2 && Math.abs(c.y - cy) <= mod * 2 && Math.abs(c.mod - mod) <= Math.max(1.5, c.mod)) {
                      const n = c.count + 1;
                      c.x = (c.x * c.count + cx2) / n;
                      c.y = (c.y * c.count + cy) / n;
                      c.mod = (c.mod * c.count + mod) / n;
                      c.count = n;
                      merged = true;
                      break;
                    }
                  }
                  if (!merged) candidates.push({ x: cx2, y: cy, mod, count: 1 });
                }
              }
            }
            s[0] = s[2]; s[1] = s[3]; s[2] = s[4]; s[3] = 1; s[4] = 0; cur = 3;
          } else {
            s[++cur]++;
          }
        } else {
          s[cur]++;
        }
      }
    }
  }
  candidates.sort((a, b) => b.count - a.count);
  return candidates.slice(0, 8);
}

/* Solve 8x8 linear system for projective homography mapping module (u,v) -> image (x,y). */
function computeHomography(src, dst) {
  const A = [];
  const B = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const [x, y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); B.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); B.push(y);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]];
    [B[i], B[piv]] = [B[piv], B[i]];
    const d = A[i][i];
    if (Math.abs(d) < 1e-12) return null;
    for (let c = i; c < n; c++) A[i][c] /= d;
    B[i] /= d;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      B[r] -= f * B[i];
    }
  }
  return [B[0], B[1], B[2], B[3], B[4], B[5], B[6], B[7], 1];
}

function findAlignmentCenter(bits, w, h, estX, estY, mod) {
  const rad = Math.max(6, Math.round(mod * 4));
  let best = null, bestScore = -1;
  for (let dy = -rad; dy <= rad; dy++) {
    const y = Math.round(estY + dy);
    if (y < 2 || y >= h - 2) continue;
    for (let dx = -rad; dx <= rad; dx++) {
      const x = Math.round(estX + dx);
      if (x < 2 || x >= w - 2) continue;
      if (!bits[y * w + x]) continue;
      // Check alignment ring: dark center (0), light at ±mod, dark at ±2*mod
      const r1 = Math.max(1, Math.round(mod));
      const r2 = Math.max(2, Math.round(mod * 2));
      if (x - r2 < 0 || x + r2 >= w || y - r2 < 0 || y + r2 >= h) continue;
      const score =
        (!bits[y * w + x - r1] ? 1 : 0) + (!bits[y * w + x + r1] ? 1 : 0) +
        (!bits[(y - r1) * w + x] ? 1 : 0) + (!bits[(y + r1) * w + x] ? 1 : 0) +
        (bits[y * w + x - r2] ? 1 : 0) + (bits[y * w + x + r2] ? 1 : 0) +
        (bits[(y - r2) * w + x] ? 1 : 0) + (bits[(y + r2) * w + x] ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  if (!best || bestScore < 6) return null;
  // Refine center of the 1-module dark dot
  let sx = 0, sy = 0, cnt = 0;
  const mr = Math.max(1, Math.round(mod * 0.7));
  for (let dy = -mr; dy <= mr; dy++) {
    for (let dx = -mr; dx <= mr; dx++) {
      const x = best.x + dx, y = best.y + dy;
      if (x >= 0 && x < w && y >= 0 && y < h && bits[y * w + x]) { sx += x; sy += y; cnt++; }
    }
  }
  return cnt ? { x: sx / cnt, y: sy / cnt } : best;
}

function sampleMatrix(bits, w, h, H, size) {
  const mat = new Uint8Array(size * size);
  for (let my = 0; my < size; my++) {
    const v = my + 0.5;
    for (let mx = 0; mx < size; mx++) {
      const u = mx + 0.5;
      const denom = H[6] * u + H[7] * v + H[8];
      const ix = Math.floor((H[0] * u + H[1] * v + H[2]) / denom);
      const iy = Math.floor((H[3] * u + H[4] * v + H[5]) / denom);
      if (ix < 0 || ix >= w || iy < 0 || iy >= h) return null;
      mat[my * size + mx] = bits[iy * w + ix];
    }
  }
  return mat;
}

export function decodeQrImageData(imageData) {
  if (!imageData || !imageData.data || !imageData.width || !imageData.height) return null;
  const { data: rgba, width: w, height: h } = imageData;
  const bits = binarise(rgba, w, h);
  const finders = findFinders(bits, w, h);
  if (finders.length < 3) return null;

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const maxTriples = Math.min(finders.length, 6);

  for (let i = 0; i < maxTriples; i++) {
    for (let j = i + 1; j < maxTriples; j++) {
      for (let k = j + 1; k < maxTriples; k++) {
        const pts = [finders[i], finders[j], finders[k]];
        const d01 = dist(pts[0], pts[1]), d12 = dist(pts[1], pts[2]), d02 = dist(pts[0], pts[2]);
        let tl, a, b;
        if (d12 >= d01 && d12 >= d02) { tl = pts[0]; a = pts[1]; b = pts[2]; }
        else if (d02 >= d01 && d02 >= d12) { tl = pts[1]; a = pts[0]; b = pts[2]; }
        else { tl = pts[2]; a = pts[0]; b = pts[1]; }

        // Cross product (a - tl) x (b - tl) > 0 => a is TR, b is BL (in image y-down coords)
        const cross = (a.x - tl.x) * (b.y - tl.y) - (a.y - tl.y) * (b.x - tl.x);
        const tr = cross > 0 ? a : b;
        const bl = cross > 0 ? b : a;

        const mod = (tl.mod + tr.mod + bl.mod) / 3;
        if (mod < 1.2) continue;
        const span = (dist(tl, tr) + dist(tl, bl)) / 2;
        const estDim = Math.round(span / mod) + 7;
        const estVer = Math.round((estDim - 17) / 4);

        // Try estimated version and ±1 neighbours to absorb mild tilt/scale error
        for (const dv of [0, -1, 1]) {
          const ver = estVer + dv;
          if (ver < 1 || ver > 10) continue;
          const size = 17 + 4 * ver;
          const brEst = { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y };
          const src = [[3.5, 3.5], [size - 3.5, 3.5], [3.5, size - 3.5]];
          const dst = [[tl.x, tl.y], [tr.x, tr.y], [bl.x, bl.y]];

          if (ver >= 2) {
            const alCoord = size - 6.5;
            const frac = (alCoord - 3.5) / (size - 7);
            const ax = tl.x + (tr.x - tl.x) * frac + (bl.x - tl.x) * frac;
            const ay = tl.y + (tr.y - tl.y) * frac + (bl.y - tl.y) * frac;
            const al = findAlignmentCenter(bits, w, h, ax, ay, mod);
            if (al) {
              const H = computeHomography([...src, [alCoord, alCoord]], [...dst, [al.x, al.y]]);
              if (H) {
                const mat = sampleMatrix(bits, w, h, H, size);
                if (mat) {
                  const text = decodeQrMatrix(mat, size);
                  if (text) return text;
                }
              }
            }
          }
          // Affine / parallelogram fallback (also exact for V1 and straight-on shots)
          const H = computeHomography([...src, [size - 3.5, size - 3.5]], [...dst, [brEst.x, brEst.y]]);
          if (H) {
            const mat = sampleMatrix(bits, w, h, H, size);
            if (mat) {
              const text = decodeQrMatrix(mat, size);
              if (text) return text;
            }
          }
        }
      }
    }
  }
  return null;
}
