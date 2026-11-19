import { describe, expect, it } from 'vitest';
import { generateTerrainObj, shouldUseTerrainMesh } from '@/core/terrainMesh';

describe('Wavefront OBJ Terrain Mesh Exporter', () => {
  it('places an exact vertex at (0, 0) with exact DEM elevation and strictly upward CCW normals', () => {
    // 3x3 elevation grid centered at Z = 0 with a -10m valley and +12m ridge
    const mapBg = {
      enabled: true,
      tileUrl: 'http://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      latitude: 37.422,
      longitude: -122.0841,
      elevation: 150,
      headingDeg: 0,
      zoom: 19,
      opacity: 0.96,
      landSizeMeters: 100,
      elevationEnabled: true,
      elevationSource: 'terrarium' as const,
      elevationScale: 1,
      terrainSegments: 10,
      elevationGridSize: 3,
      elevationGrid: [-10, -5, -2, -4, 0, 5, 2, 7, 12],
    };

    expect(shouldUseTerrainMesh(mapBg)).toBe(true);

    const obj = generateTerrainObj(100, mapBg, 10);
    const lines = obj.trim().split('\n');
    const verts = lines
      .filter((l) => l.startsWith('v '))
      .map((l) => l.split(' ').slice(1).map(Number));
    const uvs = lines
      .filter((l) => l.startsWith('vt '))
      .map((l) => l.split(' ').slice(1).map(Number));
    const norms = lines
      .filter((l) => l.startsWith('vn '))
      .map((l) => l.split(' ').slice(1).map(Number));
    const faces = lines.filter((l) => l.startsWith('f '));

    // 10x10 segments -> 11x11 = 121 vertices, 200 triangles
    expect(verts).toHaveLength(121);
    expect(uvs).toHaveLength(121);
    expect(norms).toHaveLength(121);
    expect(faces).toHaveLength(200);

    // Exact origin vertex at (0, 0) must sit at Z = 0 (never shifted up by |minZ|)
    const centerVert = verts.find((v) => v[0] === 0 && v[1] === 0);
    expect(centerVert).toEqual([0, 0, 0]);

    // Every vertex normal must point upward (+Z)
    for (const n of norms) {
      expect(n[2]!).toBeGreaterThan(0);
    }

    // Verify first triangle's geometric cross product points in +Z (CCW from above)
    const firstFaceIdx = faces[0]!
      .split(' ')
      .slice(1)
      .map((tok) => Number(tok.split('/')[0]) - 1);
    const a = verts[firstFaceIdx[0]!]!;
    const b = verts[firstFaceIdx[1]!]!;
    const c = verts[firstFaceIdx[2]!]!;
    const crossZ = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
    expect(crossZ).toBeGreaterThan(0);
  });

  it('returns false for flat terrain without elevation relief', () => {
    expect(
      shouldUseTerrainMesh({
        enabled: true,
        tileUrl: 'http://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        latitude: 37.422,
        longitude: -122.0841,
        elevation: 0,
        headingDeg: 0,
        zoom: 19,
        opacity: 0.96,
        elevationEnabled: true,
        elevationGridSize: 2,
        elevationGrid: [0, 0, 0, 0],
      }),
    ).toBe(false);
  });
});
