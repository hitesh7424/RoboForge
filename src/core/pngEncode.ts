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

  // Zlib stream with stored (uncompressed) DEFLATE blocks (max 65535 bytes per block)
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

  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, w);
  writeU32BE(ihdr, 4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
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
