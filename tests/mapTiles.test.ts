import { describe, expect, it } from 'vitest';
import {
  computeElevationStats,
  computeMapTileGrid,
  computeMapTileGridForExtent,
  decodeTerrariumPixel,
  formatTileUrl,
  latLonFromEnuOffset,
  latLonToTileFloat,
  parseCoordinateInput,
  sampleElevationAt,
  tileSizeMetersAtLat,
} from '@/core/mapTiles';

describe('Web Mercator map tile math, coordinate parser, & DEM sampling', () => {
  it('converts lat/lon coordinates into Web Mercator tile indices', () => {
    // Equator / prime meridian should land exactly at half the grid
    const eq = latLonToTileFloat(0, 0, 10);
    expect(eq.n).toBe(1024);
    expect(eq.x).toBeCloseTo(512, 6);
    expect(eq.y).toBeCloseTo(512, 6);

    // Higher zoom doubles tile coordinates
    const z11 = latLonToTileFloat(37.422, -122.0841, 11);
    const z10 = latLonToTileFloat(37.422, -122.0841, 10);
    expect(z11.x).toBeCloseTo(z10.x * 2, 6);
    expect(z11.y).toBeCloseTo(z10.y * 2, 6);
  });

  it('computes accurate meter size per tile and aligns mosaic center to (0, 0)', () => {
    const sizeEq = tileSizeMetersAtLat(0, 19);
    const sizeMid = tileSizeMetersAtLat(45, 19);
    expect(sizeEq).toBeCloseTo(40075016.68557849 / 2 ** 19, 3);
    expect(sizeMid).toBeCloseTo(sizeEq * Math.SQRT1_2, 2);

    const grid = computeMapTileGrid(37.422, -122.0841, 19, 2);
    expect(grid.gridCount).toBe(5);
    expect(grid.cells).toHaveLength(25);
    expect(Math.abs(grid.centerOffsetEnu[0])).toBeLessThanOrEqual(grid.tileSizeMeters / 2 + 1e-6);
    expect(Math.abs(grid.centerOffsetEnu[1])).toBeLessThanOrEqual(grid.tileSizeMeters / 2 + 1e-6);
  });

  it('auto-scales tile mosaic coverage for large land extents and converts ENU back to WGS84', () => {
    const large = computeMapTileGridForExtent(37.422, -122.0841, 20, 800);
    expect(large.planeSizeMeters).toBeGreaterThanOrEqual(800);
    expect(large.gridCount).toBeLessThanOrEqual(9);

    const pt = latLonFromEnuOffset(37.422, -122.0841, 100, 100);
    expect(pt.lat).toBeGreaterThan(37.422);
    expect(pt.lon).toBeGreaterThan(-122.0841);
  });

  it('decodes Terrarium RGB pixels and bilinearly samples elevation grids', () => {
    // Sea level 0m: 32768 = 128 * 256 + 0 + 0
    expect(decodeTerrariumPixel(128, 0, 0)).toBeCloseTo(0, 5);
    // +100.5m: 32868.5 -> R=128, G=100, B=128
    expect(decodeTerrariumPixel(128, 100, 128)).toBeCloseTo(100.5, 5);

    const source = {
      elevationEnabled: true,
      elevationScale: 2,
      landSizeMeters: 20,
      elevationGridSize: 2,
      // Row 0 (-Y South): [0, 2]; Row 1 (+Y North): [4, 6]
      elevationGrid: [0, 2, 4, 6],
    };
    expect(sampleElevationAt(source, -10, -10)).toBeCloseTo(0, 5);
    expect(sampleElevationAt(source, 10, 10)).toBeCloseTo(12, 5);
    expect(sampleElevationAt(source, 0, 0)).toBeCloseTo(6, 5);

    const stats = computeElevationStats(source);
    expect(stats.minZ).toBeCloseTo(0, 5);
    expect(stats.maxZ).toBeCloseTo(12, 5);
    expect(stats.rangeZ).toBeCloseTo(12, 5);
    expect(stats.hasRelief).toBe(true);
  });

  it('formats Google Maps & custom {x}/{y}/{z} URLs cleanly', () => {
    const template = 'http://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
    expect(formatTileUrl(template, 123, 456, 19, false)).toBe(
      'http://mt0.google.com/vt/lyrs=y&x=123&y=456&z=19',
    );
    expect(formatTileUrl(template, 123, 456, 19, true)).toBe(
      'https://mt0.google.com/vt/lyrs=y&x=123&y=456&z=19',
    );
  });

  it('parses coordinate pairs and rejects out-of-range inputs', () => {
    expect(parseCoordinateInput('37.4220, -122.0841')).toEqual({ lat: 37.422, lon: -122.0841 });
    expect(parseCoordinateInput('51.5074 -0.1278')).toEqual({ lat: 51.5074, lon: -0.1278 });
    expect(parseCoordinateInput('95.0, 10.0')).toBeNull();
    expect(parseCoordinateInput('not a coordinate')).toBeNull();
  });
});
