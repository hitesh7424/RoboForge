import { describe, expect, it } from 'vitest';
import {
  getScopedJsonFilename,
  parseScopedProjectJson,
  serializeScopedProject,
} from '@/core/persistence';
import { createFourWheelRoverProject, createTwoWheelCasterProject } from '@/core/templates';

describe('Scoped Project JSON export and merge-aware import (Full, Model, World)', () => {
  it('exports Full, Model-only, and World-only JSON payloads with clean filenames', () => {
    const project = createFourWheelRoverProject();
    project.textures.push(
      {
        id: 'tex_robot',
        name: 'chassis_carbon',
        format: 'png',
        mimeType: 'image/png',
        dataBase64: 'AAAA',
        byteLength: 3,
      },
      {
        id: 'tex_world',
        name: 'ground_grass',
        format: 'png',
        mimeType: 'image/png',
        dataBase64: 'BBBB',
        byteLength: 3,
      },
    );
    project.robot.links[0]!.visual.material.textureId = 'tex_robot';
    project.world.ground.textureId = 'tex_world';

    expect(getScopedJsonFilename(project, 'full')).toBe(`${project.name}.roboforge.json`);
    expect(getScopedJsonFilename(project, 'model')).toBe(`${project.robot.name}_model.roboforge.json`);
    expect(getScopedJsonFilename(project, 'world')).toBe(`${project.world.name}_world.roboforge.json`);

    const modelObj = JSON.parse(serializeScopedProject(project, 'model'));
    expect(modelObj.kind).toBe('roboforge_model');
    expect(modelObj.robot.name).toBe(project.robot.name);
    expect(modelObj.world).toBeUndefined();
    expect(modelObj.textures.map((t: { id: string }) => t.id)).toEqual(['tex_robot']);

    const worldObj = JSON.parse(serializeScopedProject(project, 'world'));
    expect(worldObj.kind).toBe('roboforge_world');
    expect(worldObj.world.name).toBe(project.world.name);
    expect(worldObj.robot).toBeUndefined();
    expect(worldObj.textures.map((t: { id: string }) => t.id)).toEqual(['tex_world']);
  });

  it('merges Model-only and World-only JSON imports without overwriting the other half', () => {
    const rover = createFourWheelRoverProject();
    rover.world.name = 'custom_world_alpha';
    rover.world.ground.size = [180, 90];

    const caster = createTwoWheelCasterProject();
    caster.robot.name = 'mini_caster';
    caster.world.name = 'warehouse_beta';

    // Import caster's model into rover -> keeps rover's custom_world_alpha
    const modelJson = serializeScopedProject(caster, 'model');
    const mergedModel = parseScopedProjectJson(modelJson, rover);
    expect(mergedModel.ok).toBe(true);
    if (mergedModel.ok) {
      expect(mergedModel.scope).toBe('model');
      expect(mergedModel.project.robot.name).toBe('mini_caster');
      expect(mergedModel.project.world.name).toBe('custom_world_alpha');
      expect(mergedModel.project.world.ground.size).toEqual([180, 90]);
    }

    // Import rover's world into caster -> keeps caster's mini_caster robot
    const worldJson = serializeScopedProject(rover, 'world');
    const mergedWorld = parseScopedProjectJson(worldJson, caster);
    expect(mergedWorld.ok).toBe(true);
    if (mergedWorld.ok) {
      expect(mergedWorld.scope).toBe('world');
      expect(mergedWorld.project.robot.name).toBe('mini_caster');
      expect(mergedWorld.project.world.name).toBe('custom_world_alpha');
      expect(mergedWorld.project.world.ground.size).toEqual([180, 90]);
    }

    // Full project JSON still imports completely
    const fullJson = serializeScopedProject(rover, 'full');
    const parsedFull = parseScopedProjectJson(fullJson, caster);
    expect(parsedFull.ok).toBe(true);
    if (parsedFull.ok) {
      expect(parsedFull.scope).toBe('full');
      expect(parsedFull.project.robot.name).toBe(rover.robot.name);
      expect(parsedFull.project.world.name).toBe('custom_world_alpha');
    }
  });
});
