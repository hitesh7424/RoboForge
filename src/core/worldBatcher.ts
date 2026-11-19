import * as THREE from 'three';
import { poseToRosMatrix } from '@/core/coords';
import { encodeRgbaPng } from '@/core/pngEncode';
import type { Primitive, World, WorldObject } from '@/core/schema';
import {
  resolveWorldPerformance,
  TREE_ATLAS_UVS,
  type AtlasUvRect,
  type ResolvedWorldPerformance,
} from '@/core/treeBillboardAtlas';
import {
  DEFAULT_DECIDUOUS_COLOR,
  DEFAULT_PINE_COLOR,
  DEFAULT_TRUNK_COLOR,
  getPineTierVisualRadius,
  getTreeParts,
  type TreeSource,
} from '@/core/treeGeometry';
import { fmt } from '@/exporters/xmlUtils';

export interface WorldOptimizationStats {
  treeCount: number;
  staticTreeCount: number;
  staticPropCount: number;
  dynamicObjectCount: number;
  rawModelCount: number;
  optimizedModelCount: number;
  rawVisualCount: number;
  optimizedVisualCount: number;
  rawCollisionCount: number;
  optimizedCollisionCount: number;
  rawTreeTriangles: number;
  optimizedTreeTriangles: number;
}

/**
 * Estimate Gazebo ECS model count, Ogre2 visual draw calls, DART collision count,
 * and tree triangle count before vs. after applying RoboForge performance optimizations.
 */
export function computeWorldOptimizationStats(world: World): WorldOptimizationStats {
  const perf = resolveWorldPerformance(world.performance);
  const groundEnabled = world.ground.enabled;

  let treeCount = 0;
  let staticTreeCount = 0;
  let staticUntexturedPrimCount = 0;
  let staticTexturedPrimCount = 0;
  let dynamicObjectCount = 0;
  let includeModelCount = 0;

  let rawVisualCount = groundEnabled ? 1 : 0;
  let rawCollisionCount = groundEnabled ? 1 : 0;
  let rawTreeTriangles = 0;

  for (const obj of world.objects) {
    if (obj.source.type === 'model') {
      includeModelCount++;
      rawVisualCount += 1;
      rawCollisionCount += 1;
      continue;
    }

    if (obj.source.type === 'tree') {
      treeCount++;
      const parts = getTreeParts(obj.source);
      rawVisualCount += parts.length;
      rawCollisionCount += parts.length;
      // Gazebo renders sphere (~512 tris) & cylinder/cone (~64 tris) per tree part
      rawTreeTriangles += obj.source.style === 'pine' ? 320 : 2100;
      if (obj.static) {
        staticTreeCount++;
      } else {
        dynamicObjectCount++;
      }
      continue;
    }

    // Primitive
    rawVisualCount += 1;
    rawCollisionCount += 1;
    if (obj.static) {
      if (obj.source.material.textureId) {
        staticTexturedPrimCount++;
      } else {
        staticUntexturedPrimCount++;
      }
    } else {
      dynamicObjectCount++;
    }
  }

  const staticPropCount = staticUntexturedPrimCount + staticTexturedPrimCount;
  const rawModelCount = (groundEnabled ? 1 : 0) + world.objects.length;

  // Optimized counts
  const hasCombinedStaticHost =
    groundEnabled ||
    (perf.combineTreesWithGround && staticTreeCount > 0) ||
    (perf.combineStaticPropsWithGround && staticPropCount > 0);

  let optimizedModelCount = (hasCombinedStaticHost ? 1 : 0) + dynamicObjectCount + includeModelCount;
  if (!perf.combineTreesWithGround) {
    optimizedModelCount += staticTreeCount;
  }
  if (!perf.combineStaticPropsWithGround) {
    optimizedModelCount += staticPropCount;
  }

  let optimizedVisualCount = groundEnabled ? 1 : 0;
  let optimizedCollisionCount = groundEnabled ? 1 : 0;

  // Static trees
  if (staticTreeCount > 0) {
    if (perf.combineTreesWithGround) {
      optimizedVisualCount += 1; // Single merged OBJ draw call
    } else {
      optimizedVisualCount +=
        perf.treeRenderMode === 'cross_card' ? staticTreeCount : staticTreeCount * 5;
    }

    if (perf.treeCollision === 'trunk_only') {
      optimizedCollisionCount += staticTreeCount;
    } else if (perf.treeCollision === 'full') {
      optimizedCollisionCount += staticTreeCount * 5;
    }
  }

  // Static primitive props/walls/buildings
  if (staticPropCount > 0) {
    if (perf.combineStaticPropsWithGround) {
      optimizedVisualCount += (staticUntexturedPrimCount > 0 ? 1 : 0) + staticTexturedPrimCount;
      optimizedCollisionCount += staticPropCount;
    } else {
      optimizedVisualCount += staticPropCount;
      optimizedCollisionCount += staticPropCount;
    }
  }

  // Dynamic objects & external model includes remain separate
  for (const obj of world.objects) {
    if (obj.source.type === 'model') {
      optimizedVisualCount += 1;
      optimizedCollisionCount += 1;
    } else if (!obj.static) {
      if (obj.source.type === 'tree') {
        const parts = getTreeParts(obj.source);
        optimizedVisualCount += perf.treeRenderMode === 'cross_card' ? 1 : parts.length;
        optimizedCollisionCount +=
          perf.treeCollision === 'none'
            ? 1 // dynamic body still needs trunk collision
            : perf.treeCollision === 'trunk_only'
              ? 1
              : parts.length;
      } else {
        optimizedVisualCount += 1;
        optimizedCollisionCount += 1;
      }
    }
  }

  // Cross-card tree: 3 vertical double-sided quads (12 tris) + optional top crown (4 tris) = 16 tris
  const trisPerCrossCard = perf.crossCardTopCrown ? 16 : 12;
  const trisPerLowPoly3d = 96;
  const optimizedTreeTriangles =
    perf.treeRenderMode === 'cross_card'
      ? treeCount * trisPerCrossCard
      : perf.combineTreesWithGround
        ? treeCount * trisPerLowPoly3d
        : rawTreeTriangles;

  return {
    treeCount,
    staticTreeCount,
    staticPropCount,
    dynamicObjectCount,
    rawModelCount,
    optimizedModelCount,
    rawVisualCount,
    optimizedVisualCount,
    rawCollisionCount,
    optimizedCollisionCount,
    rawTreeTriangles,
    optimizedTreeTriangles,
  };
}

export function getTreeTotalHeight(tree: TreeSource): number {
  const parts = getTreeParts(tree);
  let maxZ = tree.trunkHeight + tree.canopyHeight;
  for (const p of parts) {
    if (p.physicsShape.kind === 'sphere') {
      maxZ = Math.max(maxZ, p.pose.xyz[2] + p.physicsShape.radius);
    } else if (p.physicsShape.kind === 'cylinder' || p.physicsShape.kind === 'capsule') {
      maxZ = Math.max(maxZ, p.pose.xyz[2] + p.physicsShape.length * 0.5);
    }
  }
  return Math.max(0.8, maxZ);
}

export function deterministicYawFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % 3600) / 3600) * Math.PI * 2;
}

interface ObjMeshBuilder {
  positions: number[];
  uvs: number[];
  normals: number[];
  /** 1-based vertex/uv/normal triples (identical index for v/vt/vn) */
  triangles: [number, number, number][];
}

function createObjBuilder(): ObjMeshBuilder {
  return { positions: [], uvs: [], normals: [], triangles: [] };
}

function pushVertex(
  b: ObjMeshBuilder,
  x: number,
  y: number,
  z: number,
  u: number,
  v: number,
  nx: number,
  ny: number,
  nz: number,
): number {
  b.positions.push(x, y, z);
  b.uvs.push(u, v);
  b.normals.push(nx, ny, nz);
  return b.positions.length / 3; // 1-based OBJ index
}

function addDoubleSidedQuad(
  b: ObjMeshBuilder,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  uvRect: AtlasUvRect,
  n0: THREE.Vector3,
  n1: THREE.Vector3,
  n2: THREE.Vector3,
  n3: THREE.Vector3,
): void {
  // Front face (CCW: p0 -> p1 -> p2 -> p3)
  const f0 = pushVertex(b, p0.x, p0.y, p0.z, uvRect.uMin, uvRect.vMin, n0.x, n0.y, n0.z);
  const f1 = pushVertex(b, p1.x, p1.y, p1.z, uvRect.uMax, uvRect.vMin, n1.x, n1.y, n1.z);
  const f2 = pushVertex(b, p2.x, p2.y, p2.z, uvRect.uMax, uvRect.vMax, n2.x, n2.y, n2.z);
  const f3 = pushVertex(b, p3.x, p3.y, p3.z, uvRect.uMin, uvRect.vMax, n3.x, n3.y, n3.z);
  b.triangles.push([f0, f1, f2], [f0, f2, f3]);

  // Explicit back face (reversed winding, upward-biased foliage normals) for Ogre1/Ogre2 compatibility
  const b0 = pushVertex(b, p0.x, p0.y, p0.z, uvRect.uMin, uvRect.vMin, n0.x, n0.y, n0.z);
  const b1 = pushVertex(b, p1.x, p1.y, p1.z, uvRect.uMax, uvRect.vMin, n1.x, n1.y, n1.z);
  const b2 = pushVertex(b, p2.x, p2.y, p2.z, uvRect.uMax, uvRect.vMax, n2.x, n2.y, n2.z);
  const b3 = pushVertex(b, p3.x, p3.y, p3.z, uvRect.uMin, uvRect.vMax, n3.x, n3.y, n3.z);
  b.triangles.push([b0, b2, b1], [b0, b3, b2]);
}

function serializeObjBuilder(b: ObjMeshBuilder, objectName: string, headerComment: string): string {
  const lines: string[] = [headerComment, `o ${objectName}`];
  const vCount = b.positions.length / 3;
  for (let i = 0; i < vCount; i++) {
    lines.push(
      `v ${fmt(b.positions[i * 3]!, 4)} ${fmt(b.positions[i * 3 + 1]!, 4)} ${fmt(b.positions[i * 3 + 2]!, 4)}`,
    );
  }
  for (let i = 0; i < vCount; i++) {
    lines.push(`vt ${fmt(b.uvs[i * 2]!, 5)} ${fmt(b.uvs[i * 2 + 1]!, 5)}`);
  }
  for (let i = 0; i < vCount; i++) {
    lines.push(
      `vn ${fmt(b.normals[i * 3]!, 4)} ${fmt(b.normals[i * 3 + 1]!, 4)} ${fmt(b.normals[i * 3 + 2]!, 4)}`,
    );
  }
  for (const [a, c, d] of b.triangles) {
    lines.push(`f ${a}/${a}/${a} ${c}/${c}/${c} ${d}/${d}/${d}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Append one 2D cross-card tree (3 intersecting vertical planes at 0°/60°/120° + optional
 * horizontal top crown card) transformed by `worldMatrix` into an OBJ mesh builder.
 * Uses puffed upward-biased vertex normals so intersecting planes shade seamlessly like 3D crowns.
 */
function appendCrossCardTree(
  builder: ObjMeshBuilder,
  tree: TreeSource,
  worldMatrix: THREE.Matrix4,
  extraYawRad: number,
  includeTopCrown: boolean,
): void {
  const halfW = Math.max(0.35, tree.canopyRadius * 1.12);
  const totalH = getTreeTotalHeight(tree);
  const sideUv = tree.style === 'pine' ? TREE_ATLAS_UVS.pine_side : TREE_ATLAS_UVS.deciduous_side;
  const topUv = tree.style === 'pine' ? TREE_ATLAS_UVS.pine_top : TREE_ATLAS_UVS.deciduous_top;

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
  const transformPos = (x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z).applyMatrix4(worldMatrix);
  const transformNorm = (nx: number, ny: number, nz: number) =>
    new THREE.Vector3(nx, ny, nz).applyMatrix3(normalMatrix).normalize();

  // 3 intersecting vertical cards at 0°, 60°, 120° around Z axis
  for (let i = 0; i < 3; i++) {
    const ang = extraYawRad + (i * Math.PI) / 3;
    const dx = Math.cos(ang) * halfW;
    const dy = Math.sin(ang) * halfW;

    const p0 = transformPos(-dx, -dy, 0);
    const p1 = transformPos(dx, dy, 0);
    const p2 = transformPos(dx, dy, totalH);
    const p3 = transformPos(-dx, -dy, totalH);

    // Puffed spherical foliage normals eliminate dark vertical seam where cards intersect
    const n0 = transformNorm(-Math.cos(ang) * 0.4, -Math.sin(ang) * 0.4, 0.82);
    const n1 = transformNorm(Math.cos(ang) * 0.4, Math.sin(ang) * 0.4, 0.82);
    const n2 = transformNorm(Math.cos(ang) * 0.35, Math.sin(ang) * 0.35, 0.94);
    const n3 = transformNorm(-Math.cos(ang) * 0.35, -Math.sin(ang) * 0.35, 0.94);

    addDoubleSidedQuad(builder, p0, p1, p2, p3, sideUv, n0, n1, n2, n3);
  }

  // Optional horizontal top crown card so overhead / drone / top-down views look lush & solid
  if (includeTopCrown) {
    const crownZ = Math.min(totalH * 0.8, tree.trunkHeight + tree.canopyHeight * 0.5);
    const crownHalf = halfW * 0.98;
    const c = Math.cos(extraYawRad);
    const s = Math.sin(extraYawRad);
    const rotPt = (lx: number, ly: number) =>
      transformPos(lx * c - ly * s, lx * s + ly * c, crownZ);

    const t0 = rotPt(-crownHalf, -crownHalf);
    const t1 = rotPt(crownHalf, -crownHalf);
    const t2 = rotPt(crownHalf, crownHalf);
    const t3 = rotPt(-crownHalf, crownHalf);
    const nUp = transformNorm(0, 0, 1);

    addDoubleSidedQuad(builder, t0, t1, t2, t3, topUv, nUp, nUp, nUp, nUp);
  }
}

/**
 * Build a reusable Three.js BufferGeometry for a unit-sized 2D cross-card tree
 * (X/Y width = 2.24 * scaleX, height = 1.0 * scaleZ, pivoted at bottom-center z=0).
 */
export function buildCrossCardTreeBufferGeometry(
  style: 'deciduous' | 'pine',
  includeTopCrown = true,
  crownZRatio = 0.68,
): THREE.BufferGeometry {
  const sideUv = style === 'pine' ? TREE_ATLAS_UVS.pine_side : TREE_ATLAS_UVS.deciduous_side;
  const topUv = style === 'pine' ? TREE_ATLAS_UVS.pine_top : TREE_ATLAS_UVS.deciduous_top;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushCard = (
    pts: [number, number, number][],
    norms: [number, number, number][],
    uv: AtlasUvRect,
  ) => {
    const base = positions.length / 3;
    const uvCoords: [number, number][] = [
      [uv.uMin, uv.vMin],
      [uv.uMax, uv.vMin],
      [uv.uMax, uv.vMax],
      [uv.uMin, uv.vMax],
    ];
    for (let k = 0; k < 4; k++) {
      positions.push(pts[k]![0], pts[k]![1], pts[k]![2]);
      normals.push(norms[k]![0], norms[k]![1], norms[k]![2]);
      uvs.push(uvCoords[k]![0], uvCoords[k]![1]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const halfW = 1.12;
  for (let i = 0; i < 3; i++) {
    const ang = (i * Math.PI) / 3;
    const dx = Math.cos(ang) * halfW;
    const dy = Math.sin(ang) * halfW;
    const cx = Math.cos(ang);
    const cy = Math.sin(ang);
    pushCard(
      [
        [-dx, -dy, 0],
        [dx, dy, 0],
        [dx, dy, 1],
        [-dx, -dy, 1],
      ],
      [
        [-cx * 0.4, -cy * 0.4, 0.82],
        [cx * 0.4, cy * 0.4, 0.82],
        [cx * 0.35, cy * 0.35, 0.94],
        [-cx * 0.35, -cy * 0.35, 0.94],
      ],
      sideUv,
    );
  }

  if (includeTopCrown) {
    const ch = halfW * 0.98;
    const cz = Math.max(0.35, Math.min(0.85, crownZRatio));
    pushCard(
      [
        [-ch, -ch, cz],
        [ch, -ch, cz],
        [ch, ch, cz],
        [-ch, ch, cz],
      ],
      [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
      ],
      topUv,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Palette atlas helper: packs unique RGBA colors into 4x4px swatches in a tiny PNG
 * so heterogeneous colored primitives merge into ONE single OBJ draw call in Gazebo!
 */
class ColorPaletteBuilder {
  private colorKeys: string[] = [];
  private colors: [number, number, number, number][] = [];

  register(rgba: [number, number, number, number]): number {
    const r = Math.max(0, Math.min(255, Math.round(rgba[0] * 255)));
    const g = Math.max(0, Math.min(255, Math.round(rgba[1] * 255)));
    const b = Math.max(0, Math.min(255, Math.round(rgba[2] * 255)));
    const a = Math.max(0, Math.min(255, Math.round(rgba[3] * 255)));
    const key = `${r},${g},${b},${a}`;
    const existing = this.colorKeys.indexOf(key);
    if (existing >= 0) return existing;
    this.colorKeys.push(key);
    this.colors.push([r, g, b, a]);
    return this.colors.length - 1;
  }

  getUv(index: number): [number, number] {
    const count = Math.max(1, this.colors.length);
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.max(1, Math.ceil(count / cols));
    const col = index % cols;
    const row = Math.floor(index / cols);
    const u = (col + 0.5) / cols;
    // PNG row 0 = top (v=1)
    const v = 1 - (row + 0.5) / rows;
    return [u, v];
  }

  encodePng(): Uint8Array {
    const swatchPx = 4;
    const count = Math.max(1, this.colors.length);
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.max(1, Math.ceil(count / cols));
    const width = cols * swatchPx;
    const height = rows * swatchPx;
    const rgba = new Uint8Array(width * height * 4);

    for (let i = 0; i < count; i++) {
      const [r, g, b, a] = this.colors[i] ?? [180, 180, 180, 255];
      const col = i % cols;
      const row = Math.floor(i / cols);
      for (let dy = 0; dy < swatchPx; dy++) {
        for (let dx = 0; dx < swatchPx; dx++) {
          const px = col * swatchPx + dx;
          const py = row * swatchPx + dy;
          const idx = (py * width + px) * 4;
          rgba[idx] = r;
          rgba[idx + 1] = g;
          rgba[idx + 2] = b;
          rgba[idx + 3] = a;
        }
      }
    }

    return encodeRgbaPng(width, height, rgba);
  }
}

function appendThreeGeometryToBuilder(
  builder: ObjMeshBuilder,
  geo: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4,
  uv: [number, number],
): void {
  const posAttr = geo.getAttribute('position');
  if (!posAttr) return;
  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }
  const normAttr = geo.getAttribute('normal');
  const normalMat = new THREE.Matrix3().getNormalMatrix(worldMatrix);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  const baseIdx = builder.positions.length / 3 + 1; // 1-based
  for (let i = 0; i < posAttr.count; i++) {
    v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(worldMatrix);
    if (normAttr) {
      n.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i))
        .applyMatrix3(normalMat)
        .normalize();
    } else {
      n.set(0, 0, 1);
    }
    builder.positions.push(v.x, v.y, v.z);
    builder.uvs.push(uv[0], uv[1]);
    builder.normals.push(n.x, n.y, n.z);
  }

  const index = geo.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      builder.triangles.push([
        baseIdx + index.getX(i),
        baseIdx + index.getX(i + 1),
        baseIdx + index.getX(i + 2),
      ]);
    }
  } else {
    for (let i = 0; i < posAttr.count; i += 3) {
      builder.triangles.push([baseIdx + i, baseIdx + i + 1, baseIdx + i + 2]);
    }
  }
}

function buildPrimitiveBufferGeometryRos(shape: Primitive): THREE.BufferGeometry {
  switch (shape.kind) {
    case 'box':
      return new THREE.BoxGeometry(
        Math.max(0.01, shape.size[0]),
        Math.max(0.01, shape.size[1]),
        Math.max(0.01, shape.size[2]),
      );
    case 'cylinder': {
      // Three.js CylinderGeometry axis is +Y; ROS cylinder axis is +Z
      const geo = new THREE.CylinderGeometry(
        Math.max(0.01, shape.radius),
        Math.max(0.01, shape.radius),
        Math.max(0.01, shape.length),
        12,
      );
      geo.rotateX(Math.PI / 2);
      return geo;
    }
    case 'sphere':
      return new THREE.SphereGeometry(Math.max(0.01, shape.radius), 12, 8);
    case 'capsule': {
      const geo = new THREE.CapsuleGeometry(
        Math.max(0.01, shape.radius),
        Math.max(0.01, shape.length),
        4,
        10,
      );
      geo.rotateX(Math.PI / 2);
      return geo;
    }
    case 'extrude': {
      const pts =
        shape.points.length >= 3
          ? shape.points
          : [
              [-0.5, -0.5],
              [0.5, -0.5],
              [0.5, 0.5],
              [-0.5, 0.5],
            ];
      const s = new THREE.Shape();
      s.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length; i++) {
        s.lineTo(pts[i]![0], pts[i]![1]);
      }
      s.closePath();
      const depth = Math.max(0.05, shape.depth);
      const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
      geo.translate(0, 0, -depth / 2);
      return geo;
    }
  }
}

export interface MergedTreesExportResult {
  objText: string;
  /** Non-null only when mode === '3d_mesh' (cross_card uses the shared tree atlas PNG) */
  palettePngBytes?: Uint8Array;
  treeCount: number;
  triangleCount: number;
}

/**
 * Merge all static trees into a single Wavefront OBJ mesh in world ROS coordinates.
 * - `cross_card`: 2D video-game crossed billboards (3 vertical cards + optional top crown) mapped to `<world>_trees_atlas.png`.
 * - `3d_mesh`: Low-poly volumetric 3D trunks + crowns mapped to a compact color palette PNG.
 */
export function generateMergedTreesObj(
  trees: WorldObject[],
  perf: ResolvedWorldPerformance,
): MergedTreesExportResult {
  const builder = createObjBuilder();
  const palette = new ColorPaletteBuilder();
  let count = 0;

  // Register palette colors upfront when merging 3D low-poly trees so UV grid size is finalized
  if (perf.treeRenderMode === '3d_mesh') {
    for (const obj of trees) {
      if (obj.source.type !== 'tree') continue;
      palette.register(obj.source.trunkColor ?? DEFAULT_TRUNK_COLOR);
      palette.register(
        obj.source.foliageColor ??
          (obj.source.style === 'pine' ? DEFAULT_PINE_COLOR : DEFAULT_DECIDUOUS_COLOR),
      );
    }
  }

  for (const obj of trees) {
    if (obj.source.type !== 'tree') continue;
    const worldMat = poseToRosMatrix(obj.pose);
    const extraYaw = deterministicYawFromId(obj.id);

    if (perf.treeRenderMode === 'cross_card') {
      appendCrossCardTree(builder, obj.source, worldMat, extraYaw, perf.crossCardTopCrown);
    } else {
      const parts = getTreeParts(obj.source);
      const trunkUv = palette.getUv(palette.register(obj.source.trunkColor ?? DEFAULT_TRUNK_COLOR));
      const foliageUv = palette.getUv(
        palette.register(
          obj.source.foliageColor ??
            (obj.source.style === 'pine' ? DEFAULT_PINE_COLOR : DEFAULT_DECIDUOUS_COLOR),
        ),
      );

      parts.forEach((part, idx) => {
        const partMat = new THREE.Matrix4().multiplyMatrices(worldMat, poseToRosMatrix(part.pose));
        let geo: THREE.BufferGeometry;
        if (part.visualKind === 'cone' && part.physicsShape.kind === 'cylinder') {
          const tierIdx = Math.max(0, idx - 1);
          const coneR = getPineTierVisualRadius(obj.source as TreeSource, tierIdx);
          geo = new THREE.ConeGeometry(coneR, part.physicsShape.length, 8);
          geo.rotateX(Math.PI / 2);
        } else if (part.physicsShape.kind === 'cylinder') {
          geo = new THREE.CylinderGeometry(
            part.physicsShape.radius,
            part.physicsShape.radius,
            part.physicsShape.length,
            6,
          );
          geo.rotateX(Math.PI / 2);
        } else if (part.physicsShape.kind === 'sphere') {
          geo = new THREE.IcosahedronGeometry(part.physicsShape.radius, 1);
        } else {
          geo = buildPrimitiveBufferGeometryRos(part.physicsShape);
        }
        appendThreeGeometryToBuilder(
          builder,
          geo,
          partMat,
          part.role === 'trunk' ? trunkUv : foliageUv,
        );
        geo.dispose();
      });
    }
    count++;
  }

  const objText = serializeObjBuilder(
    builder,
    'merged_trees',
    `# RoboForge batched static trees (${count} trees, mode=${perf.treeRenderMode}, ${builder.triangles.length} tris)`,
  );

  return {
    objText,
    palettePngBytes: perf.treeRenderMode === '3d_mesh' ? palette.encodePng() : undefined,
    treeCount: count,
    triangleCount: builder.triangles.length,
  };
}

/**
 * Generate a single unit-scaled cross-card tree OBJ (halfW=1.12, height=1.0) for non-merged
 * individual tree models (including dynamic trees when cross-card mode is selected).
 */
export function generateUnitCrossCardTreeObj(
  style: 'deciduous' | 'pine',
  includeTopCrown: boolean,
): string {
  const builder = createObjBuilder();
  const sideUv = style === 'pine' ? TREE_ATLAS_UVS.pine_side : TREE_ATLAS_UVS.deciduous_side;
  const topUv = style === 'pine' ? TREE_ATLAS_UVS.pine_top : TREE_ATLAS_UVS.deciduous_top;
  const halfW = 1.12;

  for (let i = 0; i < 3; i++) {
    const ang = (i * Math.PI) / 3;
    const dx = Math.cos(ang) * halfW;
    const dy = Math.sin(ang) * halfW;
    const cx = Math.cos(ang);
    const cy = Math.sin(ang);

    addDoubleSidedQuad(
      builder,
      new THREE.Vector3(-dx, -dy, 0),
      new THREE.Vector3(dx, dy, 0),
      new THREE.Vector3(dx, dy, 1),
      new THREE.Vector3(-dx, -dy, 1),
      sideUv,
      new THREE.Vector3(-cx * 0.4, -cy * 0.4, 0.82).normalize(),
      new THREE.Vector3(cx * 0.4, cy * 0.4, 0.82).normalize(),
      new THREE.Vector3(cx * 0.35, cy * 0.35, 0.94).normalize(),
      new THREE.Vector3(-cx * 0.35, -cy * 0.35, 0.94).normalize(),
    );
  }

  if (includeTopCrown) {
    const crownHalf = halfW * 0.98;
    const crownZ = 0.68;
    const nUp = new THREE.Vector3(0, 0, 1);
    addDoubleSidedQuad(
      builder,
      new THREE.Vector3(-crownHalf, -crownHalf, crownZ),
      new THREE.Vector3(crownHalf, -crownHalf, crownZ),
      new THREE.Vector3(crownHalf, crownHalf, crownZ),
      new THREE.Vector3(-crownHalf, crownHalf, crownZ),
      topUv,
      nUp,
      nUp,
      nUp,
      nUp,
    );
  }

  return serializeObjBuilder(
    builder,
    `tree_card_${style}`,
    `# RoboForge 2D cross-card ${style} tree (unit scale, ${builder.triangles.length} tris)`,
  );
}

export interface MergedSceneryExportResult {
  objText: string;
  palettePngBytes: Uint8Array;
  objectCount: number;
  triangleCount: number;
}

/**
 * Merge all untextured static primitive objects (walls, buildings, static props) into ONE
 * Wavefront OBJ mesh + compact color palette PNG so Gazebo renders them in a single draw call.
 */
export function generateMergedStaticSceneryObj(
  objects: WorldObject[],
): MergedSceneryExportResult {
  const builder = createObjBuilder();
  const palette = new ColorPaletteBuilder();

  const eligible = objects.filter(
    (o): o is WorldObject & { source: Extract<WorldObject['source'], { type: 'primitive' }> } =>
      o.static && o.source.type === 'primitive' && !o.source.material.textureId,
  );

  // Pre-register every unique RGBA color so palette dimensions are known before emitting UVs
  for (const obj of eligible) {
    palette.register(obj.source.material.rgba);
  }

  for (const obj of eligible) {
    const colorIdx = palette.register(obj.source.material.rgba);
    const uv = palette.getUv(colorIdx);
    const worldMat = poseToRosMatrix(obj.pose);
    const geo = buildPrimitiveBufferGeometryRos(obj.source.shape);
    appendThreeGeometryToBuilder(builder, geo, worldMat, uv);
    geo.dispose();
  }

  const objText = serializeObjBuilder(
    builder,
    'merged_static_scenery',
    `# RoboForge batched static scenery (${eligible.length} objects, ${builder.triangles.length} tris)`,
  );

  return {
    objText,
    palettePngBytes: palette.encodePng(),
    objectCount: eligible.length,
    triangleCount: builder.triangles.length,
  };
}
