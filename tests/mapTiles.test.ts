import { describe, expect, it } from 'vitest';
import {
  computeElevationStats,
  computeMapTextureCanvasSize,
  computeMapTileGrid,
  computeMapTileGridForExtent,
  computeNativeExportResolution,
  DEFAULT_MAP_BACKGROUND,
  decodeTerrariumPixel,
  formatTileUrl,
  getMapLandSize,
  latLonFromEnuOffset,
  latLonToTileFloat,
  parseCoordinateInput,
  sampleElevationAt,
  tileSizeMetersAtLat,
} from '@/core/mapTiles';
import { generateTerrainObj } from '@/core/terrainMesh';

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

  it('supports rectangular map land dimensions across sizing, canvas aspect ratio, DEM sampling, and OBJ export', () => {
    expect(
      getMapLandSize({ enabled: true, landSizeMeters: 140, landWidthMeters: 140, landHeightMeters: 70 }),
    ).toEqual({ width: 140, height: 70 });

    // Legacy square map falls back cleanly to landSizeMeters
    expect(getMapLandSize({ enabled: true, landSizeMeters: 120 })).toEqual({
      width: 120,
      height: 120,
    });

    // Texture canvas preserves rectangular aspect ratio
    expect(computeMapTextureCanvasSize(200, 100, 1024)).toEqual({ widthPx: 1024, heightPx: 512 });
    expect(computeMapTextureCanvasSize(50, 100, 1024)).toEqual({ widthPx: 512, heightPx: 1024 });

    // Rectangular DEM sampling spans [-width/2, +width/2] x [-height/2, +height/2]
    const rectDem = {
      ...DEFAULT_MAP_BACKGROUND,
      elevationEnabled: true,
      elevationScale: 1,
      landWidthMeters: 40,
      landHeightMeters: 20,
      elevationGridSize: 2,
      elevationGrid: [0, 4, 2, 6],
    };
    expect(sampleElevationAt(rectDem, -20, -10)).toBeCloseTo(0, 5);
    expect(sampleElevationAt(rectDem, 20, -10)).toBeCloseTo(4, 5);
    expect(sampleElevationAt(rectDem, -20, 10)).toBeCloseTo(2, 5);
    expect(sampleElevationAt(rectDem, 20, 10)).toBeCloseTo(6, 5);

    // Rectangular OBJ mesh vertices span exact X and Y bounds
    const obj = generateTerrainObj(40, rectDem, 4, 20);
    expect(obj).toContain('v -20 -10 0');
    expect(obj).toContain('v 20 10 6');
  });

  it('preserves original image dimensions and high-res export sizes instead of downscaling to 512px', () => {
    // 1:1 uploaded high-res image keeps exact original pixel dimensions
    expect(
      computeNativeExportResolution(160, 80, {
        sourceImageWidth: 3000,
        sourceImageHeight: 1500,
        sourceIsOneToOne: true,
        quality: 'original',
      }),
    ).toEqual({ widthPx: 3000, heightPx: 1500 });

    // 4K 1:1 uploaded base map is preserved verbatim
    expect(
      computeNativeExportResolution(100, 100, {
        sourceImageWidth: 4096,
        sourceImageHeight: 4096,
        sourceIsOneToOne: true,
        quality: 'original',
      }),
    ).toEqual({ widthPx: 4096, heightPx: 4096 });

    // Default 'original' quality for satellite/cosmetic rectangular maps exports >= 2048px
    expect(computeNativeExportResolution(160, 80, { quality: 'original' })).toEqual({
      widthPx: 2048,
      heightPx: 1024,
    });

    // Explicit 4K quality scales longest edge to 4096 while preserving rectangular aspect ratio
    expect(computeNativeExportResolution(160, 80, { quality: 4096 })).toEqual({
      widthPx: 4096,
      heightPx: 2048,
    });

    // High-density native satellite mosaic (> 2048px) is preserved without downscaling
    const denseGrid = computeMapTileGrid(37.422, -122.0841, 20, 4); // 9x9 tiles = 2304px mosaic
    const denseRes = computeNativeExportResolution(
      denseGrid.planeSizeMeters * 0.95,
      denseGrid.planeSizeMeters * 0.95,
      {
        tileGrid: denseGrid,
        tilePx: 256,
        quality: 'original',
      },
    );
    expect(denseRes.widthPx).toBeGreaterThanOrEqual(2180);
    expect(denseRes.heightPx).toBeGreaterThanOrEqual(2180);
  });
});

