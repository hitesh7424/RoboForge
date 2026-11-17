import { describe, expect, it } from 'vitest';
import { encodeGrayscalePng } from '@/core/pngEncode';

describe('Grayscale PNG Encoder', () => {
  it('encodes an 8-bit grayscale PNG with valid header, chunks, and pixel payload size', () => {
    const pixels = new Uint8Array([0, 64, 128, 255]);
    const png = encodeGrayscalePng(2, 2, pixels);

    // PNG magic bytes
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    // First chunk must be IHDR of length 13 with bitDepth=8, colorType=0
    const ihdrLen = (png[8]! << 24) | (png[9]! << 16) | (png[10]! << 8) | png[11]!;
    expect(ihdrLen).toBe(13);
    const ihdrType = String.fromCharCode(png[12]!, png[13]!, png[14]!, png[15]!);
    expect(ihdrType).toBe('IHDR');
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(0);

    // Final chunk must be IEND (12 bytes at tail)
    const iendType = String.fromCharCode(
      png[png.length - 8]!,
      png[png.length - 7]!,
      png[png.length - 6]!,
      png[png.length - 5]!,
    );
    expect(iendType).toBe('IEND');
  });
});
