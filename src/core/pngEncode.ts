const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeU32BE(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeU32BE(out, 0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  writeU32BE(out, 8 + data.length, crc);
  return out;
}

function compressRawScanlinesToZlib(raw: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let offset = 0;
  while (offset < raw.length || offset === 0) {
    const chunkLen = Math.min(65535, raw.length - offset);
    const isFinal = offset + chunkLen >= raw.length ? 1 : 0;
    const block = new Uint8Array(5 + chunkLen);
    block[0] = isFinal;
    block[1] = chunkLen & 0xff;
    block[2] = (chunkLen >>> 8) & 0xff;
    const nlen = (~chunkLen) & 0xffff;
    block[3] = nlen & 0xff;
    block[4] = (nlen >>> 8) & 0xff;
    block.set(raw.subarray(offset, offset + chunkLen), 5);
    blocks.push(block);
    offset += chunkLen;
    if (offset >= raw.length) break;
  }

  const adler = new Uint8Array(4);
  writeU32BE(adler, 0, adler32(raw));
  blocks.push(adler);

  const zlibLen = blocks.reduce((acc, b) => acc + b.length, 0);
  const zlib = new Uint8Array(zlibLen);
  let pos = 0;
  for (const b of blocks) {
    zlib.set(b, pos);
    pos += b.length;
  }
  return zlib;
}

function assemblePngFile(
  width: number,
  height: number,
  colorType: 0 | 6,
  rawScanlines: Uint8Array,
): Uint8Array {
  const zlib = compressRawScanlinesToZlib(rawScanlines);

  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType; // 0 = grayscale, 6 = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const cIhdr = makeChunk('IHDR', ihdr);
  const cIdat = makeChunk('IDAT', zlib);
  const cIend = makeChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(sig.length + cIhdr.length + cIdat.length + cIend.length);
  let outPos = 0;
  for (const part of [sig, cIhdr, cIdat, cIend]) {
    png.set(part, outPos);
    outPos += part.length;
  }
  return png;
}

/**
 * Pure TypeScript 8-bit grayscale PNG encoder (no DOM/Canvas dependency)
 * for exporting Gazebo <heightmap> DEM files inside ROS 2 packages.
 */
export function encodeGrayscalePng(
  width: number,
  height: number,
  pixels: Uint8Array,
): Uint8Array {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  // Raw scanlines: filter byte (0) + w grayscale bytes per row
  const stride = w + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    const rowSrc = pixels.subarray(y * w, y * w + w);
    raw.set(rowSrc, y * stride + 1);
  }

  return assemblePngFile(w, h, 0, raw);
}

/**
 * Pure TypeScript 8-bit RGBA PNG encoder (no DOM/Canvas dependency)
 * for exporting map ground textures inside ROS 2 packages.
 */
export function encodeRgbaPng(
  width: number,
  height: number,
  rgbaPixels: Uint8Array,
): Uint8Array {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const rowBytes = w * 4;
  const stride = rowBytes + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    const rowSrc = rgbaPixels.subarray(y * rowBytes, y * rowBytes + rowBytes);
    raw.set(rowSrc, y * stride + 1);
  }

  return assemblePngFile(w, h, 6, raw);
}

/**
 * Generate a deterministic, pure-TypeScript satellite/topographic grid RGBA PNG
 * used as fallback before async browser map-tile stitching completes or when offline.
 */
export function createFallbackMapPng(width = 128, height = 128): Uint8Array {
  const w = Math.max(16, Math.round(width));
  const h = Math.max(16, Math.round(height));
  const rgba = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const isMajorGrid = x % 32 === 0 || y % 32 === 0;
      const isMinorGrid = x % 16 === 0 || y % 16 === 0;
      const isCenterAxis = Math.abs(x - w / 2) <= 1 || Math.abs(y - h / 2) <= 1;

      if (isCenterAxis) {
        rgba[idx] = 16;
        rgba[idx + 1] = 185;
        rgba[idx + 2] = 129;
        rgba[idx + 3] = 255;
      } else if (isMajorGrid) {
        rgba[idx] = 56;
        rgba[idx + 1] = 112;
        rgba[idx + 2] = 96;
        rgba[idx + 3] = 255;
      } else if (isMinorGrid) {
        rgba[idx] = 36;
        rgba[idx + 1] = 58;
        rgba[idx + 2] = 52;
        rgba[idx + 3] = 255;
      } else {
        // Subtle natural terrain variation
        const checker = ((x >> 3) + (y >> 3)) & 1;
        rgba[idx] = checker ? 28 : 32;
        rgba[idx + 1] = checker ? 46 : 50;
        rgba[idx + 2] = checker ? 38 : 42;
        rgba[idx + 3] = 255;
      }
    }
  }

  return encodeRgbaPng(w, h, rgba);
}

/**
 * Resample a row-major elevation grid (South->North, West->East) into a Gazebo-compliant
 * (2^k + 1) x (2^k + 1) 8-bit grayscale DEM image buffer (default 65x65, where row 0 is North).
 */
export function resampleDemToGazeboPixels(
  grid: number[] | undefined,
  srcN: number,
  scale: number,
  minZ: number,
  rangeZ: number,
  outN = 65,
): Uint8Array {
  const pixels = new Uint8Array(outN * outN);
  if (!grid || srcN < 2 || grid.length < srcN * srcN || rangeZ <= 0.001) {
    return pixels;
  }

  const denom = Math.max(0.01, rangeZ);
  for (let row = 0; row < outN; row++) {
    // Top row of PNG (row = 0) corresponds to North (+Y -> v = 1)
    const v = 1 - row / Math.max(1, outN - 1);
    const gy = Math.max(0, Math.min(srcN - 1.0001, v * (srcN - 1)));
    const y0 = Math.floor(gy);
    const y1 = Math.min(srcN - 1, y0 + 1);
    const ty = gy - y0;

    for (let col = 0; col < outN; col++) {
      const u = col / Math.max(1, outN - 1);
      const gx = Math.max(0, Math.min(srcN - 1.0001, u * (srcN - 1)));
      const x0 = Math.floor(gx);
      const x1 = Math.min(srcN - 1, x0 + 1);
      const tx = gx - x0;

      const z00 = (grid[y0 * srcN + x0] ?? 0) * scale;
      const z10 = (grid[y0 * srcN + x1] ?? 0) * scale;
      const z01 = (grid[y1 * srcN + x0] ?? 0) * scale;
      const z11 = (grid[y1 * srcN + x1] ?? 0) * scale;

      const z0 = z00 + (z10 - z00) * tx;
      const z1 = z01 + (z11 - z01) * tx;
      const z = z0 + (z1 - z0) * ty;

      const norm = (z - minZ) / denom;
      pixels[row * outN + col] = Math.max(0, Math.min(255, Math.round(norm * 255)));
    }
  }

  return pixels;
}

