import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { poseToRosMatrix } from '@/core/coords';
import { createDefaultProject } from '@/core/defaults';
import type { WorldObject } from '@/core/schema';
import {
  buildTerrainConformingWallSegments,
  computeBuildingTerrainPlacement,
  computePropTerrainPose,
  computeTreeTerrainPose,
  computeWallSegmentPlacement,
  regroundAllWorldObjects,
  regroundWorldObjectToTerrain,
  sampleTerrainHeight,
  sampleTerrainNormal,
  sampleTerrainPolyline3D,
  type TerrainQuerySource,
} from '@/core/terrainGrounding';

/**
 * Helper: build a synthetic elevation grid (n x n) over [-width/2, +width/2] x [-height/2, +height/2].
 */
function makeGridSource(
  fn: (localX: number, localY: number) => number,
  opts?: {
    gridSize?: number;
    width?: number;
    height?: number;
    scale?: number;
    headingDeg?: number;
    enabled?: boolean;
  },
): TerrainQuerySource {
  const n = opts?.gridSize ?? 41;
  const width = opts?.width ?? 100;
  const height = opts?.height ?? 100;
  const grid = new Array<number>(n * n);
  for (let row = 0; row < n; row++) {
    const v = row / (n - 1);
    const localY = (v - 0.5) * height;
    for (let col = 0; col < n; col++) {
      const u = col / (n - 1);
      const localX = (u - 0.5) * width;
      grid[row * n + col] = fn(localX, localY);
    }
  }
  return {
    elevationEnabled: opts?.enabled ?? true,
    elevationScale: opts?.scale ?? 1.0,
    landSizeMeters: Math.max(width, height),
    landWidthMeters: width,
    landHeightMeters: height,
    headingDeg: opts?.headingDeg ?? 0,
    elevationGrid: grid,
    elevationGridSize: n,
  };
}

describe('terrainGrounding — heading-aware sampling, walls, buildings, trees & re-grounding', () => {
  it('samples terrain elevation accurately with non-zero headingDeg rotation', () => {
    // Linear ramp in terrain-local frame: z = 0.2 * localX (rises toward +X)
    // When headingDeg = 90°, WorldTerrainMesh rotates local terrain by -90° around Z,
    // so local +X=(20,0) maps to world (0, -20).
    const src = makeGridSource((lx) => 0.2 * lx, { headingDeg: 90 });

    const zAtWorldSouth = sampleTerrainHeight(src, 0, -20);
    const zAtWorldNorth = sampleTerrainHeight(src, 0, 20);
    const zAtWorldEast = sampleTerrainHeight(src, 20, 0);

    expect(zAtWorldSouth).toBeCloseTo(4.0, 2);
    expect(zAtWorldNorth).toBeCloseTo(-4.0, 2);
    expect(zAtWorldEast).toBeCloseTo(0.0, 2);
  });

  it('computes accurate upward surface normal on a tilted ramp', () => {
    // z = 0.5 * x  => normal proportional to (-0.5, 0, 1)
    const src = makeGridSource((x) => 0.5 * x);
    const n = sampleTerrainNormal(src, 0, 0);
    const expectedLen = Math.hypot(-0.5, 0, 1);
    expect(n[0]).toBeCloseTo(-0.5 / expectedLen, 2);
    expect(n[1]).toBeCloseTo(0, 2);
    expect(n[2]).toBeCloseTo(1 / expectedLen, 2);
  });

  it('pitches walls uphill/downhill with exact ROS ZYX pitch sign and zero floating bottom', () => {
    // Ramp rising +X at 25% grade (z = 0.25 * x)
    const ramp = makeGridSource((x) => 0.25 * x);
    const seg = computeWallSegmentPlacement([0, 0], [10, 0], 2.5, 0.35, ramp, 0);

    // Uphill (+X, dz = +2.5m over 10m) requires negative pitch in ROS ZYX Euler
    expect(seg.pose.rpy[1]).toBeCloseTo(-Math.atan2(2.5, 10), 3);
    expect(seg.pose.rpy[2]).toBeCloseTo(0, 3);

    // Transform the wall's 8 box corners into ROS world coordinates and verify:
    // 1) bottom corners sit at or below ground (embedded footing, never floating)
    // 2) top corners rise at least nominalHeight (2.5m) above the ground beneath them
    const mat = poseToRosMatrix(seg.pose);
    const [lx, ly, lz] = seg.size;
    for (const sx of [-0.5, 0, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        const bottom = new THREE.Vector3(sx * lx, sy * ly, -0.5 * lz).applyMatrix4(mat);
        const top = new THREE.Vector3(sx * lx, sy * ly, 0.5 * lz).applyMatrix4(mat);
        const groundAtBottom = sampleTerrainHeight(ramp, bottom.x, bottom.y);
        const groundAtTop = sampleTerrainHeight(ramp, top.x, top.y);
        expect(bottom.z).toBeLessThanOrEqual(groundAtBottom + 0.01);
        expect(top.z).toBeGreaterThanOrEqual(groundAtTop + 2.35);
      }
    }
  });

  it('subdivides long walls over a curved hill so every segment hugs the hill curvature above ground', () => {
    // Curved Gaussian hill centered at (0, 0): peak height 8m, sigma = 12m
    const hill = makeGridSource((x, y) => 8 * Math.exp(-(x * x + y * y) / (2 * 12 * 12)));
    const segments = buildTerrainConformingWallSegments(
      [
        [-24, 0],
        [24, 0],
      ],
      2.4,
      0.35,
      hill,
    );

    // 48m span across a curved hill should subdivide into multiple terrain-hugging segments
    expect(segments.length).toBeGreaterThanOrEqual(10);

    // Early segments climb uphill (negative pitch), late segments descend downhill (positive pitch)
    expect(segments[1]!.pose.rpy[1]).toBeLessThan(-0.05);
    expect(segments[segments.length - 2]!.pose.rpy[1]).toBeGreaterThan(0.05);

    // Verify every segment's bottom embeds below terrain and top stays >= 2.3m above terrain
    for (const seg of segments) {
      const mat = poseToRosMatrix(seg.pose);
      const [lx, , lz] = seg.size;
      for (const sx of [-0.45, 0, 0.45]) {
        const bottom = new THREE.Vector3(sx * lx, 0, -0.5 * lz).applyMatrix4(mat);
        const top = new THREE.Vector3(sx * lx, 0, 0.5 * lz).applyMatrix4(mat);
        const gB = sampleTerrainHeight(hill, bottom.x, bottom.y);
        const gT = sampleTerrainHeight(hill, top.x, top.y);
        expect(bottom.z).toBeLessThanOrEqual(gB + 0.02);
        expect(top.z).toBeGreaterThanOrEqual(gT + 2.25);
      }
    }
  });

  it('extends building foundation below lowest downhill corner while keeping full height above uphill corner', () => {
    // Slope z = 0.4 * x => across a 10m-wide building from x=-5 to x=+5, terrain spans -2m to +2m (4m relief)
    const slope = makeGridSource((x) => 0.4 * x);
    const localPts: [number, number][] = [
      [-5, -4],
      [5, -4],
      [5, 4],
      [-5, 4],
    ];
    const placed = computeBuildingTerrainPlacement(localPts, 0, 0, 6.0, slope, 0);
    const bottomZ = placed.centerZ - placed.depth / 2;
    const roofZ = placed.centerZ + placed.depth / 2;

    // Downhill ground is -2.0m => foundation must sit below -2.0m (no floating corner!)
    expect(bottomZ).toBeLessThan(-2.0);
    // Uphill ground is +2.0m => roof must be at least +2.0 + 6.0 = 8.0m (never buried!)
    expect(roofZ).toBeGreaterThanOrEqual(7.98);
    expect(placed.terrainPlacement.nominalHeight).toBeCloseTo(6.0, 2);
  });

  it('grounds trees below lowest trunk-perimeter point so trunks never float on steep slopes', () => {
    const steepSlope = makeGridSource((x) => 0.6 * x);
    const placed = computeTreeTerrainPose(5, 0, 0.4, steepSlope);
    const centerGround = sampleTerrainHeight(steepSlope, 5, 0);
    const downhillGround = sampleTerrainHeight(steepSlope, 5 - 0.4, 0);

    expect(placed.pose.xyz[2]).toBeLessThan(downhillGround);
    expect(placed.pose.xyz[2]).toBeLessThan(centerGround);
    // Trunk height (e.g. 2.5m) still rises cleanly above terrain
    expect(placed.pose.xyz[2] + 2.5).toBeGreaterThan(centerGround + 1.8);
  });

  it('aligns props to local terrain slope normal while staying above ground', () => {
    const ramp = makeGridSource((x) => 0.3 * x);
    const placed = computePropTerrainPose(
      0,
      0,
      { kind: 'box', size: [1.2, 0.8, 1.0] },
      ramp,
      0,
    );
    expect(placed.pose.rpy[1]).toBeCloseTo(-Math.atan2(0.3, 1), 2);
    expect(placed.pose.xyz[2]).toBeGreaterThan(0.45);
  });

  it('losslessly re-grounds buildings, walls, trees, and spawn when elevation scales up and flattens back to 0', () => {
    const project = createDefaultProject();
    const hill = makeGridSource((x, y) => 6 * Math.exp(-(x * x + y * y) / (2 * 14 * 14)), {
      scale: 1.0,
    });
    project.world.mapBackground = {
      ...project.world.mapBackground!,
      enabled: true,
      elevationEnabled: true,
      elevationScale: 1.0,
      elevationGrid: hill.elevationGrid,
      elevationGridSize: hill.elevationGridSize,
    };

    const buildingPts: [number, number][] = [
      [-4, -4],
      [4, -4],
      [4, 4],
      [-4, 4],
    ];
    const bPlaced = computeBuildingTerrainPlacement(buildingPts, 6, 0, 5.0, hill, 0);
    const wallSeg = computeWallSegmentPlacement([-10, 4], [-2, 4], 2.2, 0.3, hill, 0);
    const treePlaced = computeTreeTerrainPose(-6, -6, 0.25, hill);

    const buildingObj: WorldObject = {
      id: 'b1',
      name: 'building_1',
      source: {
        type: 'primitive',
        shape: { kind: 'extrude', points: buildingPts, depth: bPlaced.depth },
        material: { name: 'm', rgba: [0.5, 0.5, 0.5, 1] },
      },
      pose: { xyz: [6, 0, bPlaced.centerZ], rpy: [0, 0, 0] },
      static: true,
      terrainPlacement: bPlaced.terrainPlacement,
    };
    const wallObj: WorldObject = {
      id: 'w1',
      name: 'wall_1',
      source: {
        type: 'primitive',
        shape: { kind: 'box', size: wallSeg.size },
        material: { name: 'm', rgba: [0.7, 0.7, 0.7, 1] },
      },
      pose: wallSeg.pose,
      static: true,
      terrainPlacement: wallSeg.terrainPlacement,
    };
    const treeObj: WorldObject = {
      id: 't1',
      name: 'tree_1',
      source: {
        type: 'tree',
        style: 'deciduous',
        trunkRadius: 0.25,
        trunkHeight: 2.0,
        canopyRadius: 1.5,
        canopyHeight: 2.2,
      },
      pose: treePlaced.pose,
      static: true,
      terrainPlacement: treePlaced.terrainPlacement,
    };

    project.world.objects = [buildingObj, wallObj, treeObj];
    project.world.robotSpawnPose = { xyz: [0, 0, 0.15], rpy: [0, 0, 0] };

    // 1. Scale elevation to 2.5x -> objects must rise & re-pitch accordingly
    project.world.mapBackground.elevationScale = 2.5;
    regroundAllWorldObjects(project.world);
    const bDepthScaled =
      buildingObj.source.type === 'primitive' && buildingObj.source.shape.kind === 'extrude'
        ? buildingObj.source.shape.depth
        : 0;
    expect(bDepthScaled).toBeGreaterThan(bPlaced.depth);
    expect(treeObj.pose.xyz[2]).toBeGreaterThan(treePlaced.pose.xyz[2] * 2.0);
    expect(project.world.robotSpawnPose.xyz[2]).toBeCloseTo(6 * 2.5 + 0.15, 1);

    // 2. Flatten terrain completely -> building & wall MUST return cleanly to nominal height without ratcheting
    project.world.mapBackground.elevationGrid = undefined;
    project.world.mapBackground.elevationGridSize = undefined;
    regroundAllWorldObjects(project.world);

    const bDepthFlat =
      buildingObj.source.type === 'primitive' && buildingObj.source.shape.kind === 'extrude'
        ? buildingObj.source.shape.depth
        : 0;
    const wHeightFlat =
      wallObj.source.type === 'primitive' && wallObj.source.shape.kind === 'box'
        ? wallObj.source.shape.size[2]
        : 0;

    expect(bDepthFlat).toBeCloseTo(5.0, 2);
    expect(buildingObj.pose.xyz[2]).toBeCloseTo(2.5, 2);
    expect(wHeightFlat).toBeCloseTo(2.2, 2);
    expect(wallObj.pose.xyz[2]).toBeCloseTo(1.1, 2);
    expect(wallObj.pose.rpy[1]).toBeCloseTo(0, 3);
    expect(treeObj.pose.xyz[2]).toBeCloseTo(0, 2);
    expect(project.world.robotSpawnPose.xyz[2]).toBeCloseTo(0.15, 2);
  });

  it('re-grounds legacy wall objects without terrainPlacement metadata', () => {
    const ramp = makeGridSource((x) => 0.2 * x);
    const legacyWall: WorldObject = {
      id: 'legacy_w',
      name: 'wall_legacy',
      source: {
        type: 'primitive',
        shape: { kind: 'box', size: [8, 0.35, 2.0] },
        material: { name: 'm', rgba: [0.8, 0.8, 0.8, 1] },
      },
      pose: { xyz: [10, 0, 1.0], rpy: [0, 0, 0] },
      static: true,
    };
    regroundWorldObjectToTerrain(legacyWall, ramp);
    // At x=10, terrain z=2.0m; wall should pitch uphill and sit cleanly above z=2.0m
    expect(legacyWall.pose.rpy[1]).toBeCloseTo(-Math.atan2(0.2, 1), 2);
    expect(legacyWall.pose.xyz[2]).toBeGreaterThan(2.8);
  });

  it('subdivides 3D terrain preview polylines to hug hill crests instead of clipping underground', () => {
    const hill = makeGridSource((x, y) => 6 * Math.exp(-(x * x + y * y) / (2 * 10 * 10)));
    const pts3d = sampleTerrainPolyline3D(
      [
        [-20, 0],
        [20, 0],
      ],
      hill,
      0.1,
      false,
      2.0,
    );
    expect(pts3d.length).toBeGreaterThanOrEqual(20);
    // Midpoint near x=0 must sit above the 6m hill crest
    const mid = pts3d[Math.floor(pts3d.length / 2)]!;
    expect(mid[2]).toBeGreaterThan(5.9);
  });
});
