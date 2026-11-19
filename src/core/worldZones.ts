import type { SurfaceZone, WorldCosmetics } from '@/core/schema';

export const DEFAULT_WORLD_COSMETICS: WorldCosmetics = {
  skyPreset: 'daylight',
  fogEnabled: true,
  fogDensity: 0.0045,
  groundBasePresetId: undefined,
  groundBaseRepeat: [12, 12],
  ambientIntensity: 0.55,
  sunAzimuthDeg: 38,
  sunElevationDeg: 48,
};

export interface SkyAtmospherePalette {
  id: WorldCosmetics['skyPreset'];
  label: string;
  backgroundHex: string;
  fogHex: string;
  hemiSkyHex: string;
  hemiGroundHex: string;
  hemiIntensity: number;
  sunColorHex: string;
  sunIntensity: number;
  rimColorHex: string;
  rimIntensity: number;
  sunPosition: [number, number, number];
  gridColor: string;
  swatchGradient: string;
}

const SKY_BASE_PRESETS: Record<
  WorldCosmetics['skyPreset'],
  Omit<SkyAtmospherePalette, 'sunPosition'>
> = {
  daylight: {
    id: 'daylight',
    label: 'Daylight',
    backgroundHex: '#b8d4ec',
    fogHex: '#c7ddf0',
    hemiSkyHex: '#d8ecff',
    hemiGroundHex: '#5a5247',
    hemiIntensity: 0.72,
    sunColorHex: '#fff5e0',
    sunIntensity: 1.55,
    rimColorHex: '#a5c8f5',
    rimIntensity: 0.4,
    gridColor: 'rgba(15, 23, 42, 0.16)',
    swatchGradient: 'linear-gradient(180deg, #60a5fa 0%, #dbeafe 100%)',
  },
  golden_hour: {
    id: 'golden_hour',
    label: 'Golden Hour',
    backgroundHex: '#d89b72',
    fogHex: '#deb089',
    hemiSkyHex: '#ffd8b0',
    hemiGroundHex: '#4b3830',
    hemiIntensity: 0.65,
    sunColorHex: '#ffba73',
    sunIntensity: 1.7,
    rimColorHex: '#8ba4d6',
    rimIntensity: 0.48,
    gridColor: 'rgba(255, 237, 213, 0.22)',
    swatchGradient: 'linear-gradient(180deg, #ea580c 0%, #fdba74 100%)',
  },
  overcast: {
    id: 'overcast',
    label: 'Overcast',
    backgroundHex: '#94a3b5',
    fogHex: '#9eacb9',
    hemiSkyHex: '#dbe3ec',
    hemiGroundHex: '#4e555e',
    hemiIntensity: 0.85,
    sunColorHex: '#eef2f6',
    sunIntensity: 0.95,
    rimColorHex: '#cbd5e1',
    rimIntensity: 0.35,
    gridColor: 'rgba(30, 41, 59, 0.18)',
    swatchGradient: 'linear-gradient(180deg, #64748b 0%, #cbd5e1 100%)',
  },
  dusk: {
    id: 'dusk',
    label: 'Twilight Dusk',
    backgroundHex: '#2c3654',
    fogHex: '#354061',
    hemiSkyHex: '#7c8cc4',
    hemiGroundHex: '#242333',
    hemiIntensity: 0.55,
    sunColorHex: '#f59e8b',
    sunIntensity: 0.95,
    rimColorHex: '#60a5fa',
    rimIntensity: 0.55,
    gridColor: 'rgba(148, 163, 184, 0.2)',
    swatchGradient: 'linear-gradient(180deg, #1e1b4b 0%, #7c3aed 65%, #fb923c 100%)',
  },
  night: {
    id: 'night',
    label: 'Moonlit Night',
    backgroundHex: '#0b1220',
    fogHex: '#0f1829',
    hemiSkyHex: '#334e78',
    hemiGroundHex: '#10151f',
    hemiIntensity: 0.42,
    sunColorHex: '#a5c4f5',
    sunIntensity: 0.65,
    rimColorHex: '#38bdf8',
    rimIntensity: 0.35,
    gridColor: 'rgba(148, 163, 184, 0.16)',
    swatchGradient: 'linear-gradient(180deg, #020617 0%, #1e3a5f 100%)',
  },
  studio: {
    id: 'studio',
    label: 'Dark Studio',
    backgroundHex: '#101520',
    fogHex: '#101520',
    hemiSkyHex: '#cbd5e1',
    hemiGroundHex: '#1e293b',
    hemiIntensity: 0.62,
    sunColorHex: '#ffffff',
    sunIntensity: 1.35,
    rimColorHex: '#93c5fd',
    rimIntensity: 0.45,
    gridColor: 'rgba(148, 163, 184, 0.16)',
    swatchGradient: 'linear-gradient(180deg, #0f172a 0%, #334155 100%)',
  },
};

export const SKY_PRESET_LIST: readonly Omit<SkyAtmospherePalette, 'sunPosition'>[] = [
  SKY_BASE_PRESETS.daylight,
  SKY_BASE_PRESETS.golden_hour,
  SKY_BASE_PRESETS.overcast,
  SKY_BASE_PRESETS.dusk,
  SKY_BASE_PRESETS.night,
  SKY_BASE_PRESETS.studio,
];

export function getSkyAtmospherePalette(cosmetics?: WorldCosmetics): SkyAtmospherePalette {
  const merged = { ...DEFAULT_WORLD_COSMETICS, ...cosmetics };
  const base = SKY_BASE_PRESETS[merged.skyPreset] ?? SKY_BASE_PRESETS.daylight;
  const azRad = ((merged.sunAzimuthDeg ?? 38) * Math.PI) / 180;
  const elRad = (Math.max(4, Math.min(88, merged.sunElevationDeg ?? 48)) * Math.PI) / 180;
  const dist = 80;
  const horiz = Math.cos(elRad) * dist;
  const sunPosition: [number, number, number] = [
    Number((Math.cos(azRad) * horiz).toFixed(3)),
    Number((Math.sin(azRad) * horiz).toFixed(3)),
    Number((Math.sin(elRad) * dist).toFixed(3)),
  ];
  return {
    ...base,
    sunPosition,
  };
}

/** Creates 4 corner points (CCW) in ROS XY meters for a rectangle between two diagonal corners. */
export function createRectZonePoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): [number, number][] {
  const minX = Number(Math.min(x1, x2).toFixed(3));
  const maxX = Number(Math.max(x1, x2).toFixed(3));
  const minY = Number(Math.min(y1, y2).toFixed(3));
  const maxY = Number(Math.max(y1, y2).toFixed(3));
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

export function pointInPolygon2D(px: number, py: number, poly: [number, number][]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0];
    const yi = poly[i]![1];
    const xj = poly[j]![0];
    const yj = poly[j]![1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distancePointToSegment2D(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/** Hit-tests a single SurfaceZone in ROS XY meters. */
export function hitTestSurfaceZone(
  rx: number,
  ry: number,
  zone: SurfaceZone,
  extraMarginMeters = 0,
): boolean {
  if (!zone.visible) return false;

  if (zone.kind === 'circle') {
    const center = zone.points[0];
    if (!center) return false;
    const r = (zone.radius ?? 4) + extraMarginMeters;
    return Math.hypot(rx - center[0], ry - center[1]) <= r;
  }

  if (zone.kind === 'path') {
    if (zone.points.length < 2) return false;
    const halfWidth = (zone.strokeWidth ?? 3) / 2 + extraMarginMeters;
    for (let i = 0; i < zone.points.length - 1; i++) {
      const p1 = zone.points[i]!;
      const p2 = zone.points[i + 1]!;
      if (distancePointToSegment2D(rx, ry, p1[0], p1[1], p2[0], p2[1]) <= halfWidth) {
        return true;
      }
    }
    return false;
  }

  // rect or polygon
  return pointInPolygon2D(rx, ry, zone.points);
}

/** Finds the topmost (last-drawn) visible SurfaceZone containing (rx, ry). */
export function findTopHitSurfaceZone(
  rx: number,
  ry: number,
  zones: SurfaceZone[] | undefined,
  extraMarginMeters = 0,
): SurfaceZone | null {
  if (!zones || zones.length === 0) return null;
  for (let i = zones.length - 1; i >= 0; i--) {
    const zone = zones[i]!;
    if (hitTestSurfaceZone(rx, ry, zone, extraMarginMeters)) {
      return zone;
    }
  }
  return null;
}

/** Returns a new points array translated by (dx, dy) rounded to millimeter precision. */
export function translateZonePoints(
  points: [number, number][],
  dx: number,
  dy: number,
): [number, number][] {
  return points.map(([x, y]) => [Number((x + dx).toFixed(3)), Number((y + dy).toFixed(3))]);
}

export interface ZoneBounds2D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export function computeZoneBounds(zone: SurfaceZone): ZoneBounds2D {
  if (zone.kind === 'circle' && zone.points[0]) {
    const [cx, cy] = zone.points[0];
    const r = zone.radius ?? 4;
    return {
      minX: cx - r,
      maxX: cx + r,
      minY: cy - r,
      maxY: cy + r,
      centerX: cx,
      centerY: cy,
      width: r * 2,
      height: r * 2,
    };
  }

  if (zone.points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, centerX: 0, centerY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const pad = zone.kind === 'path' ? (zone.strokeWidth ?? 3) / 2 : 0;

  for (const [x, y] of zone.points) {
    if (x - pad < minX) minX = x - pad;
    if (x + pad > maxX) maxX = x + pad;
    if (y - pad < minY) minY = y - pad;
    if (y + pad > maxY) maxY = y + pad;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

/** Approximate covered ground area in m² (shoelace for polygons, πr² for circles, length*width for paths). */
export function computeZoneAreaMeters2(zone: SurfaceZone): number {
  if (zone.kind === 'circle') {
    const r = zone.radius ?? 4;
    return Math.PI * r * r;
  }
  if (zone.kind === 'path') {
    let totalLen = 0;
    for (let i = 0; i < zone.points.length - 1; i++) {
      const a = zone.points[i]!;
      const b = zone.points[i + 1]!;
      totalLen += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return totalLen * (zone.strokeWidth ?? 3);
  }
  if (zone.points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < zone.points.length; i++) {
    const [x1, y1] = zone.points[i]!;
    const [x2, y2] = zone.points[(i + 1) % zone.points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) * 0.5;
}

/**
 * Maps a ROS world coordinate (x = East, y = North) within [-landSize/2, +landSize/2]
 * to a top-down texture canvas pixel coordinate [px, py] where py=0 is North (+Y).
 */
export function rosToGroundTexturePixel(
  rx: number,
  ry: number,
  landSize: number,
  canvasSizePx: number,
): [number, number] {
  const safeLand = Math.max(1, landSize);
  const u = (rx + safeLand / 2) / safeLand;
  const v = 1 - (ry + safeLand / 2) / safeLand;
  return [u * canvasSizePx, v * canvasSizePx];
}

/** Inverse of rosToGroundTexturePixel. */
export function groundTexturePixelToRos(
  px: number,
  py: number,
  landSize: number,
  canvasSizePx: number,
): [number, number] {
  const safePx = Math.max(1, canvasSizePx);
  const u = px / safePx;
  const v = py / safePx;
  const rx = u * landSize - landSize / 2;
  const ry = (1 - v) * landSize - landSize / 2;
  return [rx, ry];
}
