import {
  computeElevationStats,
  DEFAULT_MAP_BACKGROUND,
  sampleElevationAt,
} from '@/core/mapTiles';
import type { World } from '@/core/schema';
import { fmt } from '@/exporters/xmlUtils';

type MapBg = World['mapBackground'];

/**
 * Returns true when the world map background has real DEM elevation relief
 * that should be exported as a 3D triangulated terrain mesh in Gazebo.
 */
export function shouldUseTerrainMesh(mapBg: MapBg | undefined): boolean {
  if (!mapBg?.enabled) return false;
  if ((mapBg.elevationGridSize ?? 0) < 2) return false;
  const stats = computeElevationStats(mapBg);
  return stats.hasRelief;
}

/**
 * Generate a Gazebo-ready Wavefront OBJ triangulated terrain mesh in local ROS ENU coordinates
 * (+X East, +Y North, +Z Up) with exact floating-point elevations, upward-facing CCW triangles,
 * smooth vertex normals, and 0..1 UVs matching `<world>_map.png`.
 *
 * Using an explicit triangulated mesh for both `<visual>` and `<collision>` eliminates the
 * Gazebo DART `<heightmap><pos>` visual/collision Z-offset mismatch that launches robots into
 * the air when terrain extends below Z = 0.
 */
export function generateTerrainObj(
  landSizeMeters: number,
  mapBg: MapBg | undefined,
  requestedSegments?: number,
): string {
  const extent = Math.max(10, landSizeMeters || DEFAULT_MAP_BACKGROUND.landSizeMeters);
  const half = extent / 2;

  // Use an EVEN segment count (8..40) so there is an exact vertex at (0, 0) with Z = 0.0000
  // and triangle count stays fast for DART FCL collision (<= 3,200 tris).
  const rawSegs = requestedSegments ?? mapBg?.terrainSegments ?? 32;
  const clamped = Math.max(8, Math.min(40, Math.round(rawSegs)));
  const segs = Math.max(8, Math.round(clamped / 2) * 2);
  const cols = segs + 1;
  const rows = segs + 1;
  const step = extent / segs;

  // Match Three.js WorldTerrainMesh `<group rotation={[0, 0, headingRad]}>`
  // where headingRad = -(headingDeg * Math.PI) / 180.
  const headingDeg = mapBg?.headingDeg ?? 0;
  const headingRad = -(headingDeg * Math.PI) / 180;
  const cosH = Math.cos(headingRad);
  const sinH = Math.sin(headingRad);

  const heights = new Float64Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    const wy = -half + r * step; // row 0 = South (-half), row segs = North (+half)
    for (let c = 0; c < cols; c++) {
      const wx = -half + c * step; // col 0 = West (-half), col segs = East (+half)
      // Inverse-rotate world (wx, wy) back into local ENU grid frame
      const lx = headingDeg === 0 ? wx : wx * cosH + wy * sinH;
      const ly = headingDeg === 0 ? wy : -wx * sinH + wy * cosH;
      heights[r * cols + c] = sampleElevationAt(mapBg, lx, ly);
    }
  }

  const lines: string[] = [
    `# RoboForge georeferenced terrain mesh (${extent}m x ${extent}m, ${segs}x${segs} grid)`,
    `# Local ROS frame: +X East, +Y North, +Z Up; origin (0,0) grounded at exact DEM elevation`,
    `o terrain`,
  ];

  // Vertices (v)
  for (let r = 0; r < rows; r++) {
    const wy = -half + r * step;
    for (let c = 0; c < cols; c++) {
      const wx = -half + c * step;
      const wz = heights[r * cols + c] ?? 0;
      lines.push(`v ${fmt(wx, 4)} ${fmt(wy, 4)} ${fmt(wz, 4)}`);
    }
  }

  // Texture coordinates (vt): u=0 West -> 1 East, v=0 South (bottom of PNG) -> 1 North (top of PNG)
  for (let r = 0; r < rows; r++) {
    const v = r / segs;
    for (let c = 0; c < cols; c++) {
      const u = c / segs;
      lines.push(`vt ${fmt(u, 6)} ${fmt(v, 6)}`);
    }
  }

  // Smooth upward-facing vertex normals (vn) via central finite differences
  for (let r = 0; r < rows; r++) {
    const rPrev = Math.max(0, r - 1);
    const rNext = Math.min(rows - 1, r + 1);
    const dy = (rNext - rPrev) * step;
    for (let c = 0; c < cols; c++) {
      const cPrev = Math.max(0, c - 1);
      const cNext = Math.min(cols - 1, c + 1);
      const dx = (cNext - cPrev) * step;

      const dzdx = ((heights[r * cols + cNext] ?? 0) - (heights[r * cols + cPrev] ?? 0)) / dx;
      const dzdy = ((heights[rNext * cols + c] ?? 0) - (heights[rPrev * cols + c] ?? 0)) / dy;

      let nx = -dzdx;
      let ny = -dzdy;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      lines.push(`vn ${fmt(nx, 5)} ${fmt(ny, 5)} ${fmt(nz, 5)}`);
    }
  }

  // Faces (f): strictly CCW when viewed from +Z so normals point UP (+Z)
  for (let r = 0; r < segs; r++) {
    for (let c = 0; c < segs; c++) {
      const i00 = r * cols + c + 1; // 1-based OBJ index
      const i10 = r * cols + (c + 1) + 1;
      const i01 = (r + 1) * cols + c + 1;
      const i11 = (r + 1) * cols + (c + 1) + 1;

      lines.push(`f ${i00}/${i00}/${i00} ${i10}/${i10}/${i10} ${i11}/${i11}/${i11}`);
      lines.push(`f ${i00}/${i00}/${i00} ${i11}/${i11}/${i11} ${i01}/${i01}/${i01}`);
    }
  }

  return lines.join('\n') + '\n';
}
