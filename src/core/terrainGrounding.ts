import * as THREE from 'three';
import { quaternionToRosRpy } from '@/core/coords';
import {
  computeElevationStats,
  sampleElevationAt,
  type ElevationQuerySource,
} from '@/core/mapTiles';
import type {
  Pose,
  Primitive,
  TerrainPlacement,
  Vec3,
  World,
  WorldObject,
} from '@/core/schema';

export interface TerrainQuerySource extends ElevationQuerySource {
  headingDeg?: number;
}

const WALL_FOOTING_EMBED_M = 0.14;
const BUILDING_FOUNDATION_EMBED_M = 0.16;
const TREE_ROOT_EMBED_M = 0.10;
const PROP_SLOPE_EMBED_M = 0.02;
const ROBOT_SPAWN_CLEARANCE_M = 0.15;

function round3(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

function round4(n: number): number {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Sample terrain elevation (ROS Z in meters) at world coordinates (worldX, worldY),
 * accounting for the terrain mesh's `headingDeg` Z-rotation (`rotation={[0, 0, -headingRad]}`).
 */
export function sampleTerrainHeight(
  source: TerrainQuerySource | undefined,
  worldX: number,
  worldY: number,
): number {
  if (!source?.elevationEnabled) return 0;
  const headingDeg = source.headingDeg ?? 0;
  if (headingDeg !== 0) {
    // WorldTerrainMesh rotates local terrain by headingRad = -(headingDeg * pi/180),
    // so inverse transform from world -> terrain-local rotates by +headingDeg.
    const rad = (headingDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const localX = worldX * cos - worldY * sin;
    const localY = worldX * sin + worldY * cos;
    return sampleElevationAt(source, localX, localY);
  }
  return sampleElevationAt(source, worldX, worldY);
}

/**
 * Compute upward-pointing unit terrain surface normal [nx, ny, nz] (nz > 0) at world (worldX, worldY).
 */
export function sampleTerrainNormal(
  source: TerrainQuerySource | undefined,
  worldX: number,
  worldY: number,
  stepM = 0.6,
): Vec3 {
  if (!source?.elevationEnabled || !computeElevationStats(source).hasRelief) {
    return [0, 0, 1];
  }
  const s = Math.max(0.15, stepM);
  const hx1 = sampleTerrainHeight(source, worldX + s, worldY);
  const hx0 = sampleTerrainHeight(source, worldX - s, worldY);
  const hy1 = sampleTerrainHeight(source, worldX, worldY + s);
  const hy0 = sampleTerrainHeight(source, worldX, worldY - s);
  const dzdx = (hx1 - hx0) / (2 * s);
  const dzdy = (hy1 - hy0) / (2 * s);
  const len = Math.hypot(dzdx, dzdy, 1);
  if (len < 1e-8) return [0, 0, 1];
  return [-dzdx / len, -dzdy / len, 1 / len];
}

/**
 * Compute ROS ZYX Euler [roll, pitch, yaw] that aligns local +Z to `normal`
 * while pointing local +X as closely as possible along horizontal heading `yaw`.
 */
export function computeSlopeAlignedRpy(yaw: number, normal: Vec3): Vec3 {
  const nz = normal[2];
  if (Math.abs(normal[0]) < 1e-6 && Math.abs(normal[1]) < 1e-6 && nz > 0.999999) {
    return [0, 0, round4(yaw)];
  }
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  if (n.z < 0) n.negate();

  const desiredForward = new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), 0);
  const xAxis = desiredForward.clone().addScaledVector(n, -desiredForward.dot(n));
  if (xAxis.lengthSq() < 1e-8) {
    xAxis.set(1, 0, 0).addScaledVector(n, -n.x);
  }
  xAxis.normalize();

  const yAxis = new THREE.Vector3().crossVectors(n, xAxis).normalize();
  const zAxis = n;

  const rotMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const quat = new THREE.Quaternion().setFromRotationMatrix(rotMat);
  const rpy = quaternionToRosRpy(quat);
  return [round4(rpy[0]), round4(rpy[1]), round4(rpy[2])];
}

export interface WallSegmentPlacement {
  endpoints: [[number, number], [number, number]];
  size: Vec3;
  pose: Pose;
  terrainPlacement: TerrainPlacement;
}

/**
 * Compute terrain-conforming 3D pose & box dimensions for a single wall segment between p1 and p2.
 * - Pitches cleanly along terrain slope (`pitch = -atan2(dz, horizLen)` in ROS ZYX Euler).
 * - Extends footing below any dip/cross-slope so the wall never floats above ground.
 * - Guarantees the wall top rises at least `nominalHeight` above the highest ground point under it.
 */
export function computeWallSegmentPlacement(
  p1: [number, number],
  p2: [number, number],
  nominalHeight: number,
  thickness: number,
  source: TerrainQuerySource | undefined,
  jointOverlap = 0,
): WallSegmentPlacement {
  const h = Math.max(0.2, nominalHeight);
  const t = Math.max(0.05, thickness);
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const horizLen = Math.max(0.05, Math.hypot(dx, dy));
  const yaw = Math.atan2(dy, dx);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  const hasRelief = computeElevationStats(source).hasRelief;
  if (!hasRelief) {
    const baseZ = sampleTerrainHeight(source, mx, my);
    const len = round3(horizLen + jointOverlap);
    return {
      endpoints: [
        [round3(x1), round3(y1)],
        [round3(x2), round3(y2)],
      ],
      size: [len, round3(t), round3(h)],
      pose: {
        xyz: [round3(mx), round3(my), round3(baseZ + h / 2)],
        rpy: [0, 0, round4(yaw)],
      },
      terrainPlacement: {
        kind: 'wall',
        followTerrain: true,
        nominalHeight: round3(h),
        nominalLength: round3(horizLen),
        endpoints: [
          [round3(x1), round3(y1)],
          [round3(x2), round3(y2)],
        ],
        jointOverlap: round3(jointOverlap),
      },
    };
  }

  const z1 = sampleTerrainHeight(source, x1, y1);
  const z2 = sampleTerrainHeight(source, x2, y2);
  const dz = z2 - z1;
  const zMid = (z1 + z2) / 2;
  // In ROS ZYX Euler, local +X Z-component is -sin(pitch), so uphill (dz > 0) requires negative pitch.
  const rawPitch = -Math.atan2(dz, horizLen);
  const maxPitch = THREE.MathUtils.degToRad(58);
  const pitch = Math.max(-maxPitch, Math.min(maxPitch, rawPitch));
  const cosPitch = Math.max(0.45, Math.cos(pitch));

  // Sample terrain along centerline & ±thickness/2 edges to detect dips, bulges, and cross-slope
  const perpX = (-dy / horizLen) * (t * 0.5);
  const perpY = (dx / horizLen) * (t * 0.5);
  const sampleCount = Math.max(4, Math.min(12, Math.ceil(horizLen / 1.0)));

  let maxDip = 0;
  let maxBulge = 0;
  for (let i = 0; i <= sampleCount; i++) {
    const s = i / sampleCount;
    const sx = x1 + dx * s;
    const sy = y1 + dy * s;
    const zLine = z1 + dz * s;

    const zCenter = sampleTerrainHeight(source, sx, sy);
    const zLeft = sampleTerrainHeight(source, sx + perpX, sy + perpY);
    const zRight = sampleTerrainHeight(source, sx - perpX, sy - perpY);

    const localMin = Math.min(zCenter, zLeft, zRight);
    const localMax = Math.max(zCenter, zLeft, zRight);

    if (zLine - localMin > maxDip) maxDip = zLine - localMin;
    if (localMax - zLine > maxBulge) maxBulge = localMax - zLine;
  }

  // Footing embeds below lowest ground under segment; top stays at least nominalHeight above highest ground
  const footingEmbed = Math.min(4.0, maxDip + WALL_FOOTING_EMBED_M);
  const topRise = h + maxBulge;
  const verticalSpan = topRise + footingEmbed;
  const boxHeight = round3(verticalSpan / cosPitch);
  const centerZ = round3(zMid + (topRise - footingEmbed) / 2);

  const len3D = Math.hypot(horizLen, dz);
  const slopeJoinBonus = Math.max(jointOverlap, t * 0.35 + Math.abs(Math.sin(pitch)) * h * 0.15);
  const boxLen = round3(len3D + slopeJoinBonus);

  return {
    endpoints: [
      [round3(x1), round3(y1)],
      [round3(x2), round3(y2)],
    ],
    size: [boxLen, round3(t), boxHeight],
    pose: {
      xyz: [round3(mx), round3(my), centerZ],
      rpy: [0, round4(pitch), round4(yaw)],
    },
    terrainPlacement: {
      kind: 'wall',
      followTerrain: true,
      nominalHeight: round3(h),
      nominalLength: round3(horizLen),
      endpoints: [
        [round3(x1), round3(y1)],
        [round3(x2), round3(y2)],
      ],
      jointOverlap: round3(jointOverlap),
    },
  };
}

/**
 * Convert a 2D wall polyline into terrain-conforming wall segments.
 * When terrain relief is active, long spans over curved terrain are automatically subdivided
 * so the wall follows hills and valleys smoothly without cutting underground or floating.
 */
export function buildTerrainConformingWallSegments(
  pts: [number, number][],
  wallHeight: number,
  wallThickness: number,
  source: TerrainQuerySource | undefined,
  options?: { maxCurvedSegmentMeters?: number; curvatureToleranceMeters?: number },
): WallSegmentPlacement[] {
  if (pts.length < 2) return [];
  const h = Math.max(0.2, wallHeight);
  const t = Math.max(0.05, wallThickness);
  const hasRelief = computeElevationStats(source).hasRelief;
  const maxStep = Math.max(1.5, options?.maxCurvedSegmentMeters ?? 4.0);
  const curvTol = Math.max(0.03, options?.curvatureToleranceMeters ?? 0.08);

  const expandedSpans: Array<{ a: [number, number]; b: [number, number]; overlap: number }> = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const segLen = Math.hypot(dx, dy);
    if (segLen < 0.12) continue;

    let subdivisions = 1;
    if (hasRelief && segLen > maxStep) {
      // Check terrain curvature deviation along the span
      const z1 = sampleTerrainHeight(source, p1[0], p1[1]);
      const z2 = sampleTerrainHeight(source, p2[0], p2[1]);
      const probeCount = Math.min(24, Math.max(3, Math.ceil(segLen / 1.5)));
      let maxDev = 0;
      for (let k = 1; k < probeCount; k++) {
        const s = k / probeCount;
        const px = p1[0] + dx * s;
        const py = p1[1] + dy * s;
        const zTerrain = sampleTerrainHeight(source, px, py);
        const zLinear = z1 + (z2 - z1) * s;
        const dev = Math.abs(zTerrain - zLinear);
        if (dev > maxDev) maxDev = dev;
      }

      if (maxDev > curvTol) {
        subdivisions = Math.max(2, Math.min(28, Math.ceil(segLen / maxStep)));
      }
    }

    const hasCorners = pts.length > 2 || subdivisions > 1;
    const baseOverlap = hasCorners ? Math.max(t * 0.45, 0.08) : 0;

    for (let sIdx = 0; sIdx < subdivisions; sIdx++) {
      const s0 = sIdx / subdivisions;
      const s1 = (sIdx + 1) / subdivisions;
      expandedSpans.push({
        a: [p1[0] + dx * s0, p1[1] + dy * s0],
        b: [p1[0] + dx * s1, p1[1] + dy * s1],
        overlap: baseOverlap,
      });
    }
  }

  return expandedSpans.map((span) =>
    computeWallSegmentPlacement(span.a, span.b, h, t, source, span.overlap),
  );
}

export interface BuildingTerrainPlacementResult {
  depth: number;
  centerZ: number;
  minGroundZ: number;
  maxGroundZ: number;
  terrainPlacement: TerrainPlacement;
}

/**
 * Compute foundation-extended building depth and center Z so that:
 * - The building stands plumb upright (`roll = 0, pitch = 0`).
 * - The foundation reaches below the lowest downhill vertex (`minGroundZ - embed`), so corners never float.
 * - The roof rises full `nominalHeight` above the highest uphill ground point (`maxGroundZ + nominalHeight`),
 *   so the building is never buried on slopes.
 */
export function computeBuildingTerrainPlacement(
  localPts: [number, number][],
  cx: number,
  cy: number,
  nominalHeight: number,
  source: TerrainQuerySource | undefined,
  yaw = 0,
): BuildingTerrainPlacementResult {
  const h = Math.max(0.3, nominalHeight);
  const hasRelief = computeElevationStats(source).hasRelief;

  if (!hasRelief || localPts.length < 3) {
    const baseZ = sampleTerrainHeight(source, cx, cy);
    return {
      depth: round3(h),
      centerZ: round3(baseZ + h / 2),
      minGroundZ: baseZ,
      maxGroundZ: baseZ,
      terrainPlacement: {
        kind: 'building',
        followTerrain: true,
        nominalHeight: round3(h),
      },
    };
  }

  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const toWorld = (lx: number, ly: number): [number, number] => [
    cx + lx * cos - ly * sin,
    cy + lx * sin + ly * cos,
  ];

  let minZ = sampleTerrainHeight(source, cx, cy);
  let maxZ = minZ;

  const samplePoint = (wx: number, wy: number) => {
    const z = sampleTerrainHeight(source, wx, wy);
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };

  for (let i = 0; i < localPts.length; i++) {
    const [lx1, ly1] = localPts[i]!;
    const [lx2, ly2] = localPts[(i + 1) % localPts.length]!;
    const [wx1, wy1] = toWorld(lx1, ly1);
    const [wx2, wy2] = toWorld(lx2, ly2);

    samplePoint(wx1, wy1);
    // Midpoint toward centroid (captures interior hill crests under building footprint)
    samplePoint((cx + wx1) * 0.5, (cy + wy1) * 0.5);

    // Sample along polygon edge
    const edgeLen = Math.hypot(wx2 - wx1, wy2 - wy1);
    const edgeSteps = Math.max(2, Math.min(8, Math.ceil(edgeLen / 3.0)));
    for (let k = 1; k < edgeSteps; k++) {
      const s = k / edgeSteps;
      samplePoint(wx1 + (wx2 - wx1) * s, wy1 + (wy2 - wy1) * s);
    }
  }

  const reliefSpan = maxZ - minZ;
  if (reliefSpan < 0.005) {
    return {
      depth: round3(h),
      centerZ: round3(minZ + h / 2),
      minGroundZ: minZ,
      maxGroundZ: maxZ,
      terrainPlacement: {
        kind: 'building',
        followTerrain: true,
        nominalHeight: round3(h),
      },
    };
  }

  const baseZ = minZ - BUILDING_FOUNDATION_EMBED_M;
  const roofZ = maxZ + h;
  const depth = round3(roofZ - baseZ);
  const centerZ = round3(baseZ + depth / 2);

  return {
    depth,
    centerZ,
    minGroundZ: minZ,
    maxGroundZ: maxZ,
    terrainPlacement: {
      kind: 'building',
      followTerrain: true,
      nominalHeight: round3(h),
    },
  };
}

/**
 * Compute terrain-grounded pose for a tree (local origin at trunk base z = 0).
 * Samples center + 8 points around the trunk perimeter so the downhill side of the trunk
 * never floats on curved or sloped terrain.
 */
export function computeTreeTerrainPose(
  x: number,
  y: number,
  trunkRadius: number,
  source: TerrainQuerySource | undefined,
  yaw = 0,
): { pose: Pose; terrainPlacement: TerrainPlacement } {
  const centerZ = sampleTerrainHeight(source, x, y);
  const hasRelief = computeElevationStats(source).hasRelief;

  if (!hasRelief) {
    return {
      pose: {
        xyz: [round3(x), round3(y), round3(centerZ)],
        rpy: [0, 0, round4(yaw)],
      },
      terrainPlacement: {
        kind: 'tree',
        followTerrain: true,
      },
    };
  }

  const sampleRadius = Math.max(0.2, trunkRadius * 1.15);
  let minZ = centerZ;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const z = sampleTerrainHeight(
      source,
      x + Math.cos(angle) * sampleRadius,
      y + Math.sin(angle) * sampleRadius,
    );
    if (z < minZ) minZ = z;
  }

  const baseZ = round3(minZ - TREE_ROOT_EMBED_M);
  return {
    pose: {
      xyz: [round3(x), round3(y), baseZ],
      rpy: [0, 0, round4(yaw)],
    },
    terrainPlacement: {
      kind: 'tree',
      followTerrain: true,
    },
  };
}

function getPrimitiveHalfHeight(shape: Primitive): number {
  switch (shape.kind) {
    case 'box':
      return shape.size[2] / 2;
    case 'cylinder':
      return shape.length / 2;
    case 'capsule':
      return shape.length / 2 + shape.radius;
    case 'sphere':
      return shape.radius;
    case 'extrude':
      return shape.depth / 2;
  }
}

/**
 * Compute terrain-conforming pose for a cosmetic/world prop (box, cylinder, sphere, capsule).
 * Aligns tilt to the local terrain surface normal while preserving heading `yaw` and keeping
 * the prop resting cleanly on top of the terrain.
 */
export function computePropTerrainPose(
  x: number,
  y: number,
  shape: Primitive,
  source: TerrainQuerySource | undefined,
  yaw = 0,
): { pose: Pose; terrainPlacement: TerrainPlacement } {
  const halfH = getPrimitiveHalfHeight(shape);
  const hasRelief = computeElevationStats(source).hasRelief;
  const centerZ = sampleTerrainHeight(source, x, y);

  if (!hasRelief) {
    return {
      pose: {
        xyz: [round3(x), round3(y), round3(centerZ + halfH)],
        rpy: [0, 0, round4(yaw)],
      },
      terrainPlacement: {
        kind: 'prop',
        followTerrain: true,
        nominalHeight: round3(halfH * 2),
      },
    };
  }

  const probeStep =
    shape.kind === 'box'
      ? Math.max(0.35, Math.min(2.0, Math.max(shape.size[0], shape.size[1]) * 0.45))
      : shape.kind === 'cylinder' || shape.kind === 'capsule' || shape.kind === 'sphere'
        ? Math.max(0.3, Math.min(2.0, shape.radius))
        : 0.6;
  const normal = sampleTerrainNormal(source, x, y, probeStep);
  const rpy = computeSlopeAlignedRpy(yaw, normal);
  const nz = Math.max(0.5, normal[2]);
  const z = round3(centerZ + halfH / nz - PROP_SLOPE_EMBED_M);

  return {
    pose: {
      xyz: [round3(x), round3(y), z],
      rpy,
    },
    terrainPlacement: {
      kind: 'prop',
      followTerrain: true,
      nominalHeight: round3(halfH * 2),
    },
  };
}

/**
 * Infer whether a legacy box object (without `terrainPlacement`) is a wall segment.
 */
function isLikelyWallBox(obj: WorldObject): boolean {
  if (obj.terrainPlacement?.kind === 'wall') return true;
  if (obj.source.type !== 'primitive' || obj.source.shape.kind !== 'box') return false;
  const name = obj.name.toLowerCase();
  const [lx, ly, lz] = obj.source.shape.size;
  if (name.includes('wall') || name.includes('fence') || name.includes('barrier')) {
    return lx > ly * 1.5 && lz >= 0.4;
  }
  return false;
}

/**
 * Losslessly re-ground an existing WorldObject (wall, building, tree, or prop) in-place
 * to match the current terrain elevation and curvature.
 */
export function regroundWorldObjectToTerrain(
  obj: WorldObject,
  source: TerrainQuerySource | undefined,
): void {
  if (obj.terrainPlacement?.followTerrain === false) return;

  const [ox, oy] = obj.pose.xyz;
  const yaw = obj.pose.rpy[2] ?? 0;

  if (obj.source.type === 'tree') {
    const res = computeTreeTerrainPose(ox, oy, obj.source.trunkRadius, source, yaw);
    obj.pose = res.pose;
    obj.terrainPlacement = res.terrainPlacement;
    return;
  }

  if (obj.source.type === 'model') {
    const tz = sampleTerrainHeight(source, ox, oy);
    obj.pose.xyz[2] = round3(tz);
    return;
  }

  const shape = obj.source.shape;
  if (shape.kind === 'extrude') {
    const nominalHeight = obj.terrainPlacement?.nominalHeight ?? shape.depth;
    const res = computeBuildingTerrainPlacement(
      shape.points,
      ox,
      oy,
      nominalHeight,
      source,
      yaw,
    );
    shape.depth = res.depth;
    obj.pose.xyz[2] = res.centerZ;
    obj.pose.rpy = [0, 0, round4(yaw)];
    obj.terrainPlacement = res.terrainPlacement;
    return;
  }

  if (shape.kind === 'box' && isLikelyWallBox(obj)) {
    const nominalHeight = obj.terrainPlacement?.nominalHeight ?? shape.size[2];
    const thickness = shape.size[1];
    const jointOverlap = obj.terrainPlacement?.jointOverlap ?? 0;

    let p1: [number, number];
    let p2: [number, number];
    if (obj.terrainPlacement?.endpoints) {
      // Shift stored endpoints if the wall was moved/translated to a new center (ox, oy)
      const [ep1, ep2] = obj.terrainPlacement.endpoints;
      const oldMx = (ep1[0] + ep2[0]) / 2;
      const oldMy = (ep1[1] + ep2[1]) / 2;
      const shiftX = ox - oldMx;
      const shiftY = oy - oldMy;
      if (Math.hypot(shiftX, shiftY) > 0.01) {
        p1 = [ep1[0] + shiftX, ep1[1] + shiftY];
        p2 = [ep2[0] + shiftX, ep2[1] + shiftY];
      } else {
        p1 = ep1;
        p2 = ep2;
      }
    } else {
      const halfL = (obj.terrainPlacement?.nominalLength ?? Math.max(0.2, shape.size[0] - jointOverlap)) / 2;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      p1 = [ox - halfL * cos, oy - halfL * sin];
      p2 = [ox + halfL * cos, oy + halfL * sin];
    }

    const placed = computeWallSegmentPlacement(
      p1,
      p2,
      nominalHeight,
      thickness,
      source,
      jointOverlap,
    );
    shape.size = placed.size;
    obj.pose = placed.pose;
    obj.terrainPlacement = placed.terrainPlacement;
    return;
  }

  // Standard prop (box, cylinder, sphere, capsule)
  const res = computePropTerrainPose(ox, oy, shape, source, yaw);
  obj.pose = res.pose;
  obj.terrainPlacement = res.terrainPlacement;
}

/**
 * Re-ground all terrain-following world objects and the robot spawn pose in-place
 * whenever DEM elevation loads, vertical scale changes, heading rotates, or terrain flattens.
 */
export function regroundAllWorldObjects(world: World): void {
  const source = world.mapBackground;
  for (const obj of world.objects) {
    regroundWorldObjectToTerrain(obj, source);
  }
  const [sx, sy] = world.robotSpawnPose.xyz;
  const spawnGroundZ = sampleTerrainHeight(source, sx, sy);
  world.robotSpawnPose.xyz[2] = round3(spawnGroundZ + ROBOT_SPAWN_CLEARANCE_M);
}

/**
 * Sample a 2D polyline (open or closed) into dense 3D points hugging the terrain curvature
 * at `z = sampleTerrainHeight(source, x, y) + zLift` so 3D outlines never clip underground.
 */
export function sampleTerrainPolyline3D(
  pts: [number, number][],
  source: TerrainQuerySource | undefined,
  zLift = 0.1,
  closed = false,
  maxStepM = 2.0,
): [number, number, number][] {
  if (pts.length < 2) return [];
  const step = Math.max(0.5, maxStepM);
  const out: [number, number, number][] = [];
  const edgeCount = closed ? pts.length : pts.length - 1;

  for (let i = 0; i < edgeCount; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const sub = Math.max(1, Math.min(40, Math.ceil(dist / step)));
    const startK = i === 0 ? 0 : 1;
    for (let k = startK; k <= sub; k++) {
      const s = k / sub;
      const x = x1 + (x2 - x1) * s;
      const y = y1 + (y2 - y1) * s;
      out.push([x, y, sampleTerrainHeight(source, x, y) + zLift]);
    }
  }
  return out;
}
