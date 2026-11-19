import { describe, expect, it } from 'vitest';
import type { World, WorldObject } from '@/core/schema';
import { createFourWheelRoverProject } from '@/core/templates';
import {
  DEFAULT_WORLD_PERFORMANCE,
  generateTreeAtlasRgba,
  getCachedTreeAtlasPngBytes,
  resolveWorldPerformance,
} from '@/core/treeBillboardAtlas';
import { createDefaultTreeSource } from '@/core/treeGeometry';
import {
  buildCrossCardTreeBufferGeometry,
  computeWorldOptimizationStats,
  generateMergedStaticSceneryObj,
  generateMergedTreesObj,
  generateUnitCrossCardTreeObj,
} from '@/core/worldBatcher';
import { exportRos2Package } from '@/exporters';

function makeForestWorld(treeCount = 60, propCount = 15): World {
  const base = createFourWheelRoverProject('jazzy-harmonic').world;
  const objects: WorldObject[] = [];

  for (let i = 0; i < treeCount; i++) {
    const style = i % 2 === 0 ? 'deciduous' : 'pine';
    objects.push({
      id: `tree_${i}`,
      name: `${style}_tree_${i}`,
      pose: {
        xyz: [(i % 10) * 4 - 18, Math.floor(i / 10) * 4 - 12, 0.25 * (i % 4)],
        rpy: [0, 0, 0],
      },
      static: true,
      source: createDefaultTreeSource(style),
    });
  }

  for (let i = 0; i < propCount; i++) {
    objects.push({
      id: `prop_${i}`,
      name: `prop_box_${i}`,
      pose: {
        xyz: [-15 + i * 2, 16, 0.5],
        rpy: [0, 0, i * 0.2],
      },
      static: true,
      source: {
        type: 'primitive',
        shape:
          i % 3 === 0
            ? { kind: 'box', size: [2, 0.35, 1.8] }
            : i % 3 === 1
              ? { kind: 'cylinder', radius: 0.4, length: 1.4 }
              : {
                  kind: 'extrude',
                  points: [
                    [-1.5, -1.5],
                    [1.5, -1.5],
                    [1.5, 1.5],
                    [-1.5, 1.5],
                  ],
                  depth: 4,
                },
        material: {
          name: `prop_mat_${i}`,
          rgba: [0.4 + (i % 5) * 0.1, 0.5, 0.6, 1],
        },
      },
    });
  }

  // Add one dynamic object to verify dynamic bodies stay separate models
  objects.push({
    id: 'dyn_crate',
    name: 'dynamic_crate',
    pose: { xyz: [2, 2, 0.5], rpy: [0, 0, 0] },
    static: false,
    mass: 6,
    source: {
      type: 'primitive',
      shape: { kind: 'box', size: [0.8, 0.8, 0.8] },
      material: { name: 'crate_mat', rgba: [0.8, 0.5, 0.2, 1] },
    },
  });

  return {
    ...base,
    name: 'pine_valley',
    objects,
    performance: { ...DEFAULT_WORLD_PERFORMANCE },
  };
}

describe('Procedural 2D Cross-Card Tree Atlas', () => {
  it('generates a deterministic 2x2 RGBA sprite atlas with alpha cutout and RGB edge dilation', () => {
    const atlas = generateTreeAtlasRgba(256);
    expect(atlas.width).toBe(256);
    expect(atlas.height).toBe(256);
    expect(atlas.rgba.length).toBe(256 * 256 * 4);

    let opaqueCount = 0;
    let transparentCount = 0;
    let dilatedTransparentRgbCount = 0;

    for (let i = 0; i < atlas.rgba.length; i += 4) {
      const r = atlas.rgba[i]!;
      const g = atlas.rgba[i + 1]!;
      const b = atlas.rgba[i + 2]!;
      const a = atlas.rgba[i + 3]!;
      if (a >= 200) {
        opaqueCount++;
      } else if (a === 0) {
        transparentCount++;
        if (r + g + b > 0) dilatedTransparentRgbCount++;
      }
    }

    // Must contain substantial foliage pixels, transparent cutout background, and dilated border RGB
    expect(opaqueCount).toBeGreaterThan(8000);
    expect(transparentCount).toBeGreaterThan(8000);
    expect(dilatedTransparentRgbCount).toBeGreaterThan(500);

    // Cached PNG encodes with valid PNG magic header
    const pngBytes = getCachedTreeAtlasPngBytes();
    expect(pngBytes[0]).toBe(0x89);
    expect(pngBytes[1]).toBe(0x50); // P
    expect(pngBytes[2]).toBe(0x4e); // N
    expect(pngBytes[3]).toBe(0x47); // G
    expect(pngBytes.byteLength).toBeGreaterThan(5000);
  });
});

describe('World Batching & Optimization Stats', () => {
  it('builds reusable Three.js cross-card BufferGeometry with exact vertex/triangle counts', () => {
    const withCrown = buildCrossCardTreeBufferGeometry('deciduous', true);
    const withoutCrown = buildCrossCardTreeBufferGeometry('pine', false);

    // 3 vertical cards + 1 horizontal crown = 4 quads = 16 vertices, 8 triangles
    expect(withCrown.getAttribute('position').count).toBe(16);
    expect(withCrown.getIndex()?.count).toBe(24);

    // 3 vertical cards = 12 vertices, 6 triangles
    expect(withoutCrown.getAttribute('position').count).toBe(12);
    expect(withoutCrown.getIndex()?.count).toBe(18);

    withCrown.dispose();
    withoutCrown.dispose();
  });

  it('batches 60 static trees into ONE cross-card OBJ mesh with dramatic triangle savings', () => {
    const world = makeForestWorld(60, 15);
    const perf = resolveWorldPerformance(world.performance);
    const stats = computeWorldOptimizationStats(world);

    // 1 ground + 60 trees + 15 static props + 1 dynamic crate = 77 raw models
    expect(stats.rawModelCount).toBe(77);
    // Combined into 1 ground_plane model + 1 dynamic crate = 2 Gazebo models!
    expect(stats.optimizedModelCount).toBe(2);
    expect(stats.rawVisualCount).toBeGreaterThan(250);
    expect(stats.optimizedVisualCount).toBeLessThanOrEqual(4);
    expect(stats.optimizedTreeTriangles).toBeLessThan(stats.rawTreeTriangles * 0.05);

    const merged = generateMergedTreesObj(world.objects, perf);
    expect(merged.treeCount).toBe(60);
    expect(merged.palettePngBytes).toBeUndefined();
    // 4 double-sided quads per tree * 4 tris per double-sided quad = 16 tris/tree
    expect(merged.triangleCount).toBe(60 * 16);
    expect(merged.objText).toContain('o merged_trees');
    expect(merged.objText).toContain('vt ');
    expect(merged.objText).toContain('vn ');

    // Without top crown: 3 double-sided quads = 12 tris/tree
    const noCrown = generateMergedTreesObj(world.objects, { ...perf, crossCardTopCrown: false });
    expect(noCrown.triangleCount).toBe(60 * 12);

    // 3D volumetric batched mode emits palette PNG and higher triangle count
    const merged3d = generateMergedTreesObj(world.objects, { ...perf, treeRenderMode: '3d_mesh' });
    expect(merged3d.treeCount).toBe(60);
    expect(merged3d.palettePngBytes).toBeInstanceOf(Uint8Array);
    expect(merged3d.palettePngBytes![1]).toBe(0x50);
    expect(merged3d.triangleCount).toBeGreaterThan(merged.triangleCount * 5);
  });

  it('generates unit-height [0, 1] cross-card tree OBJs for unmerged/dynamic trees', () => {
    const obj = generateUnitCrossCardTreeObj('pine', true);
    expect(obj).toContain('o tree_card_pine');

    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const line of obj.split('\n')) {
      if (line.startsWith('v ')) {
        const z = Number(line.trim().split(/\s+/)[3]);
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    expect(minZ).toBeCloseTo(0, 4);
    expect(maxZ).toBeCloseTo(1, 4);
  });

  it('batches untextured static primitives (box, cylinder, extrude) into ONE OBJ + palette PNG', () => {
    const world = makeForestWorld(4, 12);
    const merged = generateMergedStaticSceneryObj(world.objects);

    expect(merged.objectCount).toBe(12);
    expect(merged.triangleCount).toBeGreaterThan(100);
    expect(merged.objText).toContain('o merged_static_scenery');
    expect(merged.palettePngBytes[0]).toBe(0x89);
    expect(merged.palettePngBytes[1]).toBe(0x50);
  });
});

describe('Gazebo SDF World Exporter Performance Modes', () => {
  it('combines static trees and static props into ground_plane by default with single batched meshes', () => {
    const project = createFourWheelRoverProject('jazzy-harmonic');
    project.world = makeForestWorld(20, 6);

    const files = exportRos2Package(project, undefined, 'world');
    const sdf = files['worlds/pine_valley.sdf'] as string;

    // Merged mesh + sprite atlas + scenery palette are bundled in the ROS 2 package
    expect(typeof files['meshes/pine_valley_trees.obj']).toBe('string');
    expect(files['materials/textures/pine_valley_trees_atlas.png']).toBeInstanceOf(Uint8Array);
    expect(typeof files['meshes/pine_valley_static_scenery.obj']).toBe('string');
    expect(files['materials/textures/pine_valley_scenery_palette.png']).toBeInstanceOf(Uint8Array);

    // SDF hosts merged trees & static scenery inside ground_plane
    expect(sdf).toContain('<model name="ground_plane">');
    expect(sdf).toContain('<visual name="merged_trees_visual">');
    expect(sdf).toContain('meshes/pine_valley_trees.obj');
    expect(sdf).toContain('materials/textures/pine_valley_trees_atlas.png');
    expect(sdf).toContain('<double_sided>true</double_sided>');
    expect(sdf).toContain('<cast_shadows>false</cast_shadows>');
    expect(sdf).toContain('<visual name="merged_static_scenery_visual">');
    expect(sdf).toContain('meshes/pine_valley_static_scenery.obj');

    // Individual static trees and static props must NOT generate separate <model> tags
    expect(sdf).not.toContain('<model name="deciduous_tree_0">');
    expect(sdf).not.toContain('<model name="prop_box_0">');

    // Trunk-only collisions are present inside ground_plane; dynamic crate remains its own <model>
    expect(sdf).toContain('<collision name="col_deciduous_tree_0_trunk">');
    expect(sdf).toContain('<model name="dynamic_crate">');
    expect(sdf).toContain('<static>false</static>');
  });

  it('supports Visual-Only tree collision (none) and shadows enabled', () => {
    const project = createFourWheelRoverProject('jazzy-harmonic');
    project.world = makeForestWorld(10, 2);
    project.world.performance = {
      ...DEFAULT_WORLD_PERFORMANCE,
      treeCollision: 'none',
      disableSceneryShadows: false,
    };

    const files = exportRos2Package(project, undefined, 'world');
    const sdf = files['worlds/pine_valley.sdf'] as string;

    expect(sdf).toContain('<visual name="merged_trees_visual">');
    expect(sdf).not.toContain('col_deciduous_tree_0_trunk');
    expect(sdf).toContain('<cast_shadows>true</cast_shadows>');
  });

  it('emits unit cross-card OBJ models when combineTreesWithGround is disabled', () => {
    const project = createFourWheelRoverProject('jazzy-harmonic');
    project.world = makeForestWorld(4, 2);
    project.world.performance = {
      ...DEFAULT_WORLD_PERFORMANCE,
      combineTreesWithGround: false,
      combineStaticPropsWithGround: false,
    };

    const files = exportRos2Package(project, undefined, 'world');
    const sdf = files['worlds/pine_valley.sdf'] as string;

    expect(files['meshes/pine_valley_trees.obj']).toBeUndefined();
    expect(typeof files['meshes/pine_valley_tree_card_deciduous.obj']).toBe('string');
    expect(typeof files['meshes/pine_valley_tree_card_pine.obj']).toBe('string');
    expect(files['materials/textures/pine_valley_trees_atlas.png']).toBeInstanceOf(Uint8Array);
    expect(sdf).toContain('<model name="deciduous_tree_0">');
    expect(sdf).toContain('<model name="prop_box_0">');
  });
});
