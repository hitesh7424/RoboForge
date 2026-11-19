import { describe, expect, it } from 'vitest';
import type { SurfaceZone } from '@/core/schema';
import { ProjectSchema } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { createFourWheelRoverProject } from '@/core/templates';
import {
  BUILTIN_TEXTURE_PRESETS,
  createSeededRng,
  getTexturePresetById,
} from '@/core/texturePresets';
import {
  computeZoneAreaMeters2,
  computeZoneBounds,
  createRectZonePoints,
  findTopHitSurfaceZone,
  getSkyAtmospherePalette,
  groundTexturePixelToRos,
  hitTestSurfaceZone,
  rosToGroundTexturePixel,
  translateZonePoints,
} from '@/core/worldZones';
import { exportRos2Package } from '@/exporters';

describe('World Studio surface zones & pure geometry', () => {
  const rectZone: SurfaceZone = {
    id: 'z_rect',
    name: 'plaza_rect',
    kind: 'rect',
    points: createRectZonePoints(-10, -5, 10, 5),
    textureSource: 'preset',
    presetId: 'cobblestone',
    tint: [1, 1, 1, 1],
    repeat: [8, 8],
    opacity: 1,
    visible: true,
  };

  const circleZone: SurfaceZone = {
    id: 'z_circle',
    name: 'pond_circle',
    kind: 'circle',
    points: [[0, 0]],
    radius: 4,
    textureSource: 'preset',
    presetId: 'water_pond',
    tint: [1, 1, 1, 1],
    repeat: [6, 6],
    opacity: 0.9,
    visible: true,
  };

  const pathZone: SurfaceZone = {
    id: 'z_road',
    name: 'asphalt_road',
    kind: 'path',
    points: [
      [-20, 12],
      [20, 12],
    ],
    strokeWidth: 6,
    textureSource: 'preset',
    presetId: 'asphalt_road',
    tint: [1, 1, 1, 1],
    repeat: [10, 10],
    opacity: 1,
    visible: true,
  };

  it('hit-tests rect, circle, and road path zones accurately', () => {
    expect(hitTestSurfaceZone(0, 0, rectZone)).toBe(true);
    expect(hitTestSurfaceZone(12, 0, rectZone)).toBe(false);

    expect(hitTestSurfaceZone(2, 2, circleZone)).toBe(true);
    expect(hitTestSurfaceZone(5, 0, circleZone)).toBe(false);

    // Road runs along y=12 with width 6 (y in [9, 15])
    expect(hitTestSurfaceZone(0, 14.5, pathZone)).toBe(true);
    expect(hitTestSurfaceZone(0, 16, pathZone)).toBe(false);
  });

  it('picks the topmost visible zone when zones overlap', () => {
    const hit = findTopHitSurfaceZone(0, 0, [rectZone, circleZone]);
    expect(hit?.id).toBe('z_circle');

    const hiddenCircle = { ...circleZone, visible: false };
    const hitBelow = findTopHitSurfaceZone(0, 0, [rectZone, hiddenCircle]);
    expect(hitBelow?.id).toBe('z_rect');
  });

  it('computes accurate area, bounds, and point translation', () => {
    expect(computeZoneAreaMeters2(rectZone)).toBeCloseTo(200, 4);
    expect(computeZoneAreaMeters2(circleZone)).toBeCloseTo(Math.PI * 16, 4);
    expect(computeZoneAreaMeters2(pathZone)).toBeCloseTo(40 * 6, 4);

    const bounds = computeZoneBounds(rectZone);
    expect(bounds.width).toBe(20);
    expect(bounds.height).toBe(10);

    const shifted = translateZonePoints(rectZone.points, 3, -2);
    expect(shifted[0]).toEqual([-7, -7]);
    expect(shifted[2]).toEqual([13, 3]);
  });

  it('maps ROS coordinates to ground texture pixels and back without distortion', () => {
    const landSize = 100;
    const px = 1024;
    // NW corner (-50, +50) -> pixel (0, 0)
    expect(rosToGroundTexturePixel(-50, 50, landSize, px)).toEqual([0, 0]);
    // SE corner (+50, -50) -> pixel (1024, 1024)
    expect(rosToGroundTexturePixel(50, -50, landSize, px)).toEqual([1024, 1024]);
    // Origin (0, 0) -> center (512, 512)
    expect(rosToGroundTexturePixel(0, 0, landSize, px)).toEqual([512, 512]);

    const [rx, ry] = groundTexturePixelToRos(256, 768, landSize, px);
    expect(rx).toBeCloseTo(-25, 4);
    expect(ry).toBeCloseTo(-25, 4);
  });

  it('provides deterministic built-in texture presets and valid sky atmosphere palettes', () => {
    const ids = new Set(BUILTIN_TEXTURE_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(BUILTIN_TEXTURE_PRESETS.length);
    expect(BUILTIN_TEXTURE_PRESETS.length).toBeGreaterThanOrEqual(10);
    expect(getTexturePresetById('asphalt_road')?.category).toBe('roads');

    const r1 = createSeededRng(12345);
    const r2 = createSeededRng(12345);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);

    const golden = getSkyAtmospherePalette({
      skyPreset: 'golden_hour',
      fogEnabled: true,
      fogDensity: 0.004,
      sunAzimuthDeg: 45,
      sunElevationDeg: 25,
    });
    expect(golden.sunPosition[2]).toBeGreaterThan(0);
    expect(golden.backgroundHex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('validates schema, store actions, and Gazebo SDF multi-texture ground export', () => {
    const baseProject = createFourWheelRoverProject('jazzy-harmonic');
    baseProject.world.mapBackground = {
      ...baseProject.world.mapBackground!,
      enabled: false,
    };
    baseProject.world.surfaceZones = [rectZone, pathZone];
    baseProject.world.cosmetics = {
      skyPreset: 'golden_hour',
      fogEnabled: true,
      fogDensity: 0.005,
      groundBasePresetId: 'grass_lush',
      groundBaseRepeat: [12, 12],
    };

    expect(() => ProjectSchema.parse(baseProject)).not.toThrow();

    // Exporter must include <world>_map.png even when satellite mapBackground is disabled
    const files = exportRos2Package(baseProject);
    expect(files[`materials/textures/${baseProject.world.name}_map.png`]).toBeInstanceOf(Uint8Array);
    const worldSdf = String(files[`worlds/${baseProject.world.name}.sdf`]);
    expect(worldSdf).toContain(`materials/textures/${baseProject.world.name}_map.png`);

    // Test store surface zone actions & keeping world_studio mode intact on object placement
    const store = useRoboForgeStore.getState();
    store.loadProject(baseProject, { clearHistory: true });
    store.setMode('world_studio');
    const createdZone = store.addSurfaceZone({
      kind: 'circle',
      points: [[5, 5]],
      radius: 3,
      textureSource: 'preset',
      presetId: 'desert_sand',
      tint: [1, 1, 1, 1],
      repeat: [6, 6],
      opacity: 1,
      visible: true,
    });
    expect(useRoboForgeStore.getState().project.world.surfaceZones?.length).toBe(3);
    expect(useRoboForgeStore.getState().selection).toEqual({
      type: 'surfaceZone',
      id: createdZone.id,
    });

    store.reorderSurfaceZone(createdZone.id, 'down');
    expect(useRoboForgeStore.getState().project.world.surfaceZones?.[1]?.id).toBe(createdZone.id);

    store.deleteSurfaceZone(createdZone.id);
    expect(useRoboForgeStore.getState().project.world.surfaceZones?.length).toBe(2);
  });
});
