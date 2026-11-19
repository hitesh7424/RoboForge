import { encodeRgbaPng } from '@/core/pngEncode';
import type { WorldPerformance } from '@/core/schema';

export interface ResolvedWorldPerformance {
  treeRenderMode: 'cross_card' | '3d_mesh';
  combineTreesWithGround: boolean;
  combineStaticPropsWithGround: boolean;
  treeCollision: 'trunk_only' | 'none' | 'full';
  disableSceneryShadows: boolean;
  crossCardTopCrown: boolean;
}

export const DEFAULT_WORLD_PERFORMANCE: ResolvedWorldPerformance = {
  treeRenderMode: 'cross_card',
  combineTreesWithGround: true,
  combineStaticPropsWithGround: true,
  treeCollision: 'trunk_only',
  disableSceneryShadows: true,
  crossCardTopCrown: true,
};

export function resolveWorldPerformance(
  perf?: WorldPerformance | null,
): ResolvedWorldPerformance {
  return {
    treeRenderMode: perf?.treeRenderMode ?? DEFAULT_WORLD_PERFORMANCE.treeRenderMode,
    combineTreesWithGround:
      perf?.combineTreesWithGround ?? DEFAULT_WORLD_PERFORMANCE.combineTreesWithGround,
    combineStaticPropsWithGround:
      perf?.combineStaticPropsWithGround ??
      DEFAULT_WORLD_PERFORMANCE.combineStaticPropsWithGround,
    treeCollision: perf?.treeCollision ?? DEFAULT_WORLD_PERFORMANCE.treeCollision,
    disableSceneryShadows:
      perf?.disableSceneryShadows ?? DEFAULT_WORLD_PERFORMANCE.disableSceneryShadows,
    crossCardTopCrown: perf?.crossCardTopCrown ?? DEFAULT_WORLD_PERFORMANCE.crossCardTopCrown,
  };
}

export interface AtlasUvRect {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

/**
 * 2x2 sprite atlas UV coordinates in OpenGL/OBJ convention (v=0 bottom, v=1 top).
 * Small 1.5% gutter prevents bilinear bleeding between adjacent sprites.
 */
export const TREE_ATLAS_UVS: Record<
  'deciduous_side' | 'pine_side' | 'deciduous_top' | 'pine_top',
  AtlasUvRect
> = {
  deciduous_side: { uMin: 0.008, uMax: 0.492, vMin: 0.508, vMax: 0.992 },
  pine_side: { uMin: 0.508, uMax: 0.992, vMin: 0.508, vMax: 0.992 },
  deciduous_top: { uMin: 0.008, uMax: 0.492, vMin: 0.008, vMax: 0.492 },
  pine_top: { uMin: 0.508, uMax: 0.992, vMin: 0.008, vMax: 0.492 },
};

function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hash2d(x: number, y: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function setPixel(
  buf: Uint8Array,
  atlasSize: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  if (x < 0 || y < 0 || x >= atlasSize || y >= atlasSize) return;
  const idx = (y * atlasSize + x) * 4;
  buf[idx] = clampByte(r);
  buf[idx + 1] = clampByte(g);
  buf[idx + 2] = clampByte(b);
  buf[idx + 3] = clampByte(a);
}

function drawShadedDisc(
  buf: Uint8Array,
  atlasSize: number,
  ox: number,
  oy: number,
  cellSize: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  baseRgb: [number, number, number],
  lightBias: number,
  roughEdge = 0.16,
  seedOffset = 0,
): void {
  const minX = Math.max(2, Math.floor(cx - rx * 1.25));
  const maxX = Math.min(cellSize - 3, Math.ceil(cx + rx * 1.25));
  const minY = Math.max(2, Math.floor(cy - ry * 1.25));
  const maxY = Math.min(cellSize - 3, Math.ceil(cy + ry * 1.25));

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const dx = (px - cx) / Math.max(1, rx);
      const dy = (py - cy) / Math.max(1, ry);
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      // Organic scalloped leaf-cluster silhouette
      const wobble =
        Math.sin(angle * 5 + seedOffset) * roughEdge * 0.55 +
        Math.cos(angle * 9 - seedOffset * 1.7) * roughEdge * 0.45 +
        (hash2d(px + seedOffset, py - seedOffset) - 0.5) * roughEdge * 0.6;
      if (dist > 1.0 + wobble) continue;

      // Fake 3D spherical lighting on leaf tuft (sun from upper-left + ambient sky top)
      const nz = Math.sqrt(Math.max(0.05, 1 - Math.min(0.95, dist * dist)));
      const sunDot = Math.max(0, -dx * 0.38 - dy * 0.52 + nz * 0.72);
      const leafTex = (hash2d(px >> 1, py >> 1) - 0.5) * 0.14;
      const shade = Math.max(0.42, Math.min(1.38, 0.52 + sunDot * 0.78 + lightBias + leafTex));

      // Warm sunlit shift on bright highlights, cool deep green in shadow pockets
      const r = baseRgb[0] * shade + (sunDot > 0.65 ? 16 * (sunDot - 0.65) : 0);
      const g = baseRgb[1] * shade + (sunDot > 0.55 ? 12 * (sunDot - 0.55) : 0);
      const b = baseRgb[2] * (shade * 0.92);
      setPixel(buf, atlasSize, ox + px, oy + py, r, g, b, 255);
    }
  }
}

function drawTaperedBranch(
  buf: Uint8Array,
  atlasSize: number,
  ox: number,
  oy: number,
  cellSize: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r0: number,
  r1: number,
  barkRgb: [number, number, number],
): void {
  const steps = Math.max(12, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    const rad = r0 + (r1 - r0) * t;
    const minX = Math.max(2, Math.floor(cx - rad - 1));
    const maxX = Math.min(cellSize - 3, Math.ceil(cx + rad + 1));
    const minY = Math.max(2, Math.floor(cy - rad - 1));
    const maxY = Math.min(cellSize - 3, Math.ceil(cy + rad + 1));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy > rad * rad) continue;
        // Cylindrical bark shading + vertical bark furrows
        const nx = dx / Math.max(1, rad);
        const furrow = Math.sin(px * 0.85 + py * 0.12) * 0.12 + (hash2d(px, py >> 1) - 0.5) * 0.1;
        const shade = Math.max(0.45, Math.min(1.25, 0.82 - nx * 0.34 + furrow));
        setPixel(
          buf,
          atlasSize,
          ox + px,
          oy + py,
          barkRgb[0] * shade,
          barkRgb[1] * shade,
          barkRgb[2] * shade,
          255,
        );
      }
    }
  }
}

function paintDeciduousSideCell(
  buf: Uint8Array,
  atlasSize: number,
  ox: number,
  oy: number,
  cellSize: number,
): void {
  const rng = makeSeededRng(104729);
  const bark: [number, number, number] = [108, 74, 46];
  const deepLeaf: [number, number, number] = [34, 86, 40];
  const midLeaf: [number, number, number] = [56, 128, 52];
  const brightLeaf: [number, number, number] = [88, 162, 66];

  const cx = cellSize * 0.5;
  const bottomY = cellSize - 3;

  // 1. Back shadow foliage layer (gives lush volumetric depth behind branches)
  const backClusters: [number, number, number, number][] = [
    [0.5, 0.44, 0.34, 0.25],
    [0.32, 0.48, 0.22, 0.19],
    [0.68, 0.47, 0.23, 0.19],
    [0.5, 0.28, 0.28, 0.21],
    [0.37, 0.34, 0.21, 0.17],
    [0.64, 0.33, 0.21, 0.17],
  ];
  backClusters.forEach(([fx, fy, frx, fry], idx) => {
    drawShadedDisc(
      buf,
      atlasSize,
      ox,
      oy,
      cellSize,
      fx * cellSize,
      fy * cellSize,
      frx * cellSize,
      fry * cellSize,
      deepLeaf,
      -0.16,
      0.17,
      idx * 17 + 3,
    );
  });

  // 2. Textured trunk with flared roots and forked primary boughs
  drawTaperedBranch(
    buf,
    atlasSize,
    ox,
    oy,
    cellSize,
    cx,
    bottomY,
    cx - cellSize * 0.015,
    cellSize * 0.54,
    cellSize * 0.068,
    cellSize * 0.042,
    bark,
  );
  // Subtle left/right root flares anchored solidly to bottom edge
  drawTaperedBranch(
    buf,
    atlasSize,
    ox,
    oy,
    cellSize,
    cx - cellSize * 0.085,
    bottomY,
    cx - cellSize * 0.015,
    cellSize * 0.88,
    cellSize * 0.028,
    cellSize * 0.04,
    bark,
  );
  drawTaperedBranch(
    buf,
    atlasSize,
    ox,
    oy,
    cellSize,
    cx + cellSize * 0.085,
    bottomY,
    cx + cellSize * 0.012,
    cellSize * 0.87,
    cellSize * 0.028,
    cellSize * 0.04,
    bark,
  );
  // Upper forked limbs peeking into canopy
  drawTaperedBranch(
    buf,
    atlasSize,
    ox,
    oy,
    cellSize,
    cx - cellSize * 0.01,
    cellSize * 0.62,
    cx - cellSize * 0.18,
    cellSize * 0.44,
    cellSize * 0.032,
    cellSize * 0.014,
    bark,
  );
  drawTaperedBranch(
    buf,
    atlasSize,
    ox,
    oy,
    cellSize,
    cx + cellSize * 0.01,
    cellSize * 0.6,
    cx + cellSize * 0.19,
    cellSize * 0.43,
    cellSize * 0.032,
    cellSize * 0.014,
    bark,
  );

  // 3. Mid-layer rich leaf clusters forming organic silhouette
  for (let i = 0; i < 26; i++) {
    const angle = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * 0.34;
    const fx = 0.5 + Math.cos(angle) * rad * 1.08;
    const fy = 0.37 + Math.sin(angle) * rad * 0.78;
    const r = (0.09 + rng() * 0.075) * cellSize;
    const isUpper = fy < 0.36;
    drawShadedDisc(
      buf,
      atlasSize,
      ox,
      oy,
      cellSize,
      fx * cellSize,
      fy * cellSize,
      r * (0.95 + rng() * 0.2),
      r * (0.85 + rng() * 0.2),
      isUpper ? midLeaf : deepLeaf,
      isUpper ? 0.04 : -0.04,
      0.19,
      i * 31 + 11,
    );
  }

  // 4. Sunlit crown foliage highlights on upper & front clusters
  const crownClusters: [number, number, number][] = [
    [0.5, 0.19, 0.14],
    [0.37, 0.25, 0.13],
    [0.62, 0.26, 0.125],
    [0.25, 0.39, 0.12],
    [0.45, 0.34, 0.14],
    [0.59, 0.36, 0.13],
    [0.73, 0.41, 0.115],
    [0.34, 0.46, 0.11],
    [0.52, 0.45, 0.115],
  ];
  crownClusters.forEach(([fx, fy, fr], idx) => {
    drawShadedDisc(
      buf,
      atlasSize,
      ox,
      oy,
      cellSize,
      fx * cellSize,
      fy * cellSize,
      fr * cellSize,
      fr * 0.88 * cellSize,
      fy < 0.32 ? brightLeaf : midLeaf,
      fy < 0.32 ? 0.12 : 0.03,
      0.2,
      idx * 53 + 7,
    );
  });
}

function paintPineSideCell(
  buf: Uint8Array,
  atlasSize: number,
  ox: number,
  oy: number,
  cellSize: number,
): void {
  const bark: [number, number, number] = [96, 62, 38];
  const deepPine: [number, number, number] = [24, 68, 36];
  const midPine: [number, number, number] = [38, 98, 48];
  const tipPine: [number, number, number] = [58, 128, 60];

  const cx = cellSize * 0.5;
  const bottomY = cellSize - 3;

  // Trunk base visible below bottom pine boughs
  drawTaperedBranch(
    buf,
    atlasSize,
    ox,
    oy,
    cellSize,
    cx,
    bottomY,
    cx,
    cellSize * 0.18,
    cellSize * 0.056,
    cellSize * 0.016,
    bark,
  );

  // 6 tiered overlapping jagged pine bough layers from bottom to spire tip
  const tierCount = 6;
  for (let t = 0; t < tierCount; t++) {
    const progress = t / (tierCount - 1); // 0 = bottom wide tier, 1 = top spire
    const tierBottomY = cellSize * (0.78 - progress * 0.56);
    const tierTopY = tierBottomY - cellSize * (0.21 - progress * 0.055);
    const halfWidth = cellSize * (0.42 * (1 - progress * 0.72));

    const minY = Math.max(2, Math.floor(tierTopY));
    const maxY = Math.min(cellSize - 3, Math.ceil(tierBottomY + cellSize * 0.04));

    for (let py = minY; py <= maxY; py++) {
      const vFrac = (py - tierTopY) / Math.max(1, tierBottomY - tierTopY); // 0 top, 1 bottom
      const baseHalfW = Math.max(2, halfWidth * Math.pow(Math.max(0, vFrac), 0.85));
      const minX = Math.max(2, Math.floor(cx - baseHalfW * 1.15));
      const maxX = Math.min(cellSize - 3, Math.ceil(cx + baseHalfW * 1.15));

      for (let px = minX; px <= maxX; px++) {
        const dx = px - cx;
        const absNormX = Math.abs(dx) / Math.max(1, baseHalfW);
        // Jagged needle fringe along outer edge & drooping bottom scallops
        const needleWave =
          Math.sin(py * 0.65 + t * 2.1) * 0.12 +
          Math.cos(px * 0.55 - t * 1.4) * 0.1 +
          (hash2d(px + t * 19, py) - 0.5) * 0.14;
        const bottomScallop =
          1.0 + Math.sin((dx / Math.max(1, halfWidth)) * Math.PI * 5 + t) * 0.09;

        if (absNormX > 1.0 + needleWave) continue;
        if (vFrac > bottomScallop) continue;

        // Cylindrical + top-down sunlit shading across needles
        const nx = dx / Math.max(1, baseHalfW);
        const needleGrain = (hash2d(px, py >> 1) - 0.5) * 0.18;
        const heightLift = (1 - vFrac) * 0.25 + progress * 0.14;
        const sun = Math.max(0.42, Math.min(1.32, 0.72 - nx * 0.28 + heightLift + needleGrain));

        const base = vFrac < 0.42 ? tipPine : vFrac < 0.78 ? midPine : deepPine;
        setPixel(
          buf,
          atlasSize,
          ox + px,
          oy + py,
          base[0] * sun,
          base[1] * sun,
          base[2] * sun,
          255,
        );
      }
    }
  }
}

function paintDeciduousTopCell(
  buf: Uint8Array,
  atlasSize: number,
  ox: number,
  oy: number,
  cellSize: number,
): void {
  const rng = makeSeededRng(7331);
  const deepLeaf: [number, number, number] = [28, 76, 36];
  const midLeaf: [number, number, number] = [44, 108, 46];
  const brightLeaf: [number, number, number] = [66, 134, 56];

  // Outer scalloped ring
  drawShadedDisc(
    buf,
    atlasSize,
    ox,
    oy,
    cellSize,
    cellSize * 0.5,
    cellSize * 0.5,
    cellSize * 0.44,
    cellSize * 0.44,
    deepLeaf,
    -0.08,
    0.14,
    19,
  );

  // Layered top-down leaf rosette clusters
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2 + (rng() - 0.5) * 0.3;
    const dist = (0.1 + rng() * 0.25) * cellSize;
    const r = (0.12 + rng() * 0.06) * cellSize;
    const isInner = dist < cellSize * 0.2;
    drawShadedDisc(
      buf,
      atlasSize,
      ox,
      oy,
      cellSize,
      cellSize * 0.5 + Math.cos(ang) * dist,
      cellSize * 0.5 + Math.sin(ang) * dist,
      r,
      r,
      isInner ? brightLeaf : midLeaf,
      isInner ? 0.08 : -0.02,
      0.16,
      i * 29 + 5,
    );
  }
}

function paintPineTopCell(
  buf: Uint8Array,
  atlasSize: number,
  ox: number,
  oy: number,
  cellSize: number,
): void {
  const deepPine: [number, number, number] = [26, 72, 38];
  const midPine: [number, number, number] = [44, 108, 52];
  const brightPine: [number, number, number] = [68, 138, 64];

  const cx = cellSize * 0.5;
  const cy = cellSize * 0.5;
  const maxR = cellSize * 0.44;

  // Radiating star-burst conifer boughs seen from above
  for (let py = 2; py < cellSize - 2; py++) {
    for (let px = 2; px < cellSize - 2; px++) {
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy);
      const normR = dist / maxR;
      const angle = Math.atan2(dy, dx);
      const boughStar =
        0.74 +
        Math.abs(Math.cos(angle * 4.5)) * 0.2 +
        Math.sin(angle * 11 + normR * 8) * 0.07 +
        (hash2d(px, py) - 0.5) * 0.08;
      if (normR > boughStar) continue;

      const peakLift = Math.pow(Math.max(0, 1 - normR), 1.3);
      const grain = (hash2d(px >> 1, py >> 1) - 0.5) * 0.16;
      const shade = Math.max(0.45, Math.min(1.3, 0.68 + peakLift * 0.52 - dx / maxR * 0.15 + grain));
      const base = normR < 0.32 ? brightPine : normR < 0.68 ? midPine : deepPine;
      setPixel(
        buf,
        atlasSize,
        ox + px,
        oy + py,
        base[0] * shade,
        base[1] * shade,
        base[2] * shade,
        255,
      );
    }
  }
}

/**
 * Dilate RGB colors from opaque pixels outward into transparent border pixels (alpha stays 0).
 * Eliminates dark halos during GPU bilinear/mipmap filtering in Three.js and Gazebo Ogre2.
 */
function dilateTransparentRgbEdges(buf: Uint8Array, size: number, passes = 4): void {
  const filled = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    filled[i] = buf[i * 4 + 3]! > 0 ? 1 : 0;
  }

  for (let pass = 0; pass < passes; pass++) {
    const nextFilled = filled.slice();
    const copy = buf.slice();
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = y * size + x;
        if (filled[idx]) continue;

        let sr = 0;
        let sg = 0;
        let sb = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nIdx = (y + dy) * size + (x + dx);
            if (!filled[nIdx]) continue;
            const p = nIdx * 4;
            sr += copy[p]!;
            sg += copy[p + 1]!;
            sb += copy[p + 2]!;
            count++;
          }
        }
        if (count > 0) {
          const p = idx * 4;
          buf[p] = Math.round(sr / count);
          buf[p + 1] = Math.round(sg / count);
          buf[p + 2] = Math.round(sb / count);
          // Keep alpha = 0 so cutout remains clean
          buf[p + 3] = 0;
          nextFilled[idx] = 1;
        }
      }
    }
    filled.set(nextFilled);
  }
}

export interface TreeAtlasBuffer {
  width: number;
  height: number;
  rgba: Uint8Array;
}

let cachedAtlasBuffer: TreeAtlasBuffer | null = null;
let cachedAtlasPngBytes: Uint8Array | null = null;

/**
 * Pure TypeScript 2x2 RGBA procedural tree sprite atlas generator (zero DOM dependency).
 * Top-left: Oak side | Top-right: Pine side | Bottom-left: Oak top | Bottom-right: Pine top.
 */
export function generateTreeAtlasRgba(size = 512): TreeAtlasBuffer {
  const s = Math.max(128, Math.round(size / 2) * 2);
  const half = s / 2;
  const rgba = new Uint8Array(s * s * 4);

  // PNG row 0 = TOP (v=1). Top cells occupy y=[0..half-1], bottom cells occupy y=[half..s-1].
  paintDeciduousSideCell(rgba, s, 0, 0, half);
  paintPineSideCell(rgba, s, half, 0, half);
  paintDeciduousTopCell(rgba, s, 0, half, half);
  paintPineTopCell(rgba, s, half, half, half);

  dilateTransparentRgbEdges(rgba, s, 4);

  return { width: s, height: s, rgba };
}

export function getSharedTreeAtlasRgba(): TreeAtlasBuffer {
  if (!cachedAtlasBuffer) {
    cachedAtlasBuffer = generateTreeAtlasRgba(512);
  }
  return cachedAtlasBuffer;
}

export function getCachedTreeAtlasPngBytes(): Uint8Array {
  if (!cachedAtlasPngBytes) {
    const atlas = getSharedTreeAtlasRgba();
    cachedAtlasPngBytes = encodeRgbaPng(atlas.width, atlas.height, atlas.rgba);
  }
  return cachedAtlasPngBytes;
}
