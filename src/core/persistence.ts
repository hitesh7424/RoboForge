import { del, get, set } from 'idb-keyval';
import { z } from 'zod';
import {
  migrateProject,
  ProjectSchema,
  type Project,
  type TextureAsset,
} from '@/core/schema';

export const AUTOSAVE_STORAGE_KEY = 'roboforge_autosave_v1';

export type JsonExportScope = 'full' | 'model' | 'world';

export type ParseProjectResult = { ok: true; project: Project } | { ok: false; error: string };
export type ParseScopedProjectResult =
  | { ok: true; scope: JsonExportScope; project: Project }
  | { ok: false; error: string };

const ModelJsonEnvelopeSchema = z.object({
  version: z.number().int().positive().default(1),
  kind: z.literal('roboforge_model'),
  name: z.string().min(1).optional(),
  robot: ProjectSchema.shape.robot,
  assets: ProjectSchema.shape.assets.default([]),
  textures: ProjectSchema.shape.textures.default([]),
});

const WorldJsonEnvelopeSchema = z.object({
  version: z.number().int().positive().default(1),
  kind: z.literal('roboforge_world'),
  name: z.string().min(1).optional(),
  world: ProjectSchema.shape.world,
  textures: ProjectSchema.shape.textures.default([]),
});

function collectRobotTextureIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const link of project.robot.links) {
    if (link.visual.material.textureId) ids.add(link.visual.material.textureId);
  }
  return ids;
}

function collectWorldTextureIds(project: Project): Set<string> {
  const ids = new Set<string>();
  if (project.world.ground.textureId) ids.add(project.world.ground.textureId);
  for (const obj of project.world.objects) {
    if (obj.source.type === 'primitive' && obj.source.material.textureId) {
      ids.add(obj.source.material.textureId);
    }
  }
  for (const zone of project.world.surfaceZones ?? []) {
    if (zone.textureSource === 'custom' && zone.textureId) {
      ids.add(zone.textureId);
    }
  }
  return ids;
}

function mergeTexturesById(base: TextureAsset[], incoming: TextureAsset[]): TextureAsset[] {
  const byId = new Map<string, TextureAsset>();
  for (const tex of base) byId.set(tex.id, tex);
  for (const tex of incoming) byId.set(tex.id, tex);
  return Array.from(byId.values());
}

export function getScopedJsonFilename(project: Project, scope: JsonExportScope): string {
  const base = project.name || 'roboforge_project';
  if (scope === 'model') return `${project.robot.name || base}_model.roboforge.json`;
  if (scope === 'world') return `${project.world.name || base}_world.roboforge.json`;
  return `${base}.roboforge.json`;
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function serializeScopedProject(project: Project, scope: JsonExportScope): string {
  if (scope === 'full') {
    return serializeProject(project);
  }
  if (scope === 'model') {
    const robotTexIds = collectRobotTextureIds(project);
    const textures = (project.textures ?? []).filter((t) => robotTexIds.has(t.id));
    return JSON.stringify(
      {
        version: project.version,
        kind: 'roboforge_model',
        name: project.robot.name || project.name,
        target: project.target,
        robot: project.robot,
        assets: project.assets,
        textures,
      },
      null,
      2,
    );
  }
  const worldTexIds = collectWorldTextureIds(project);
  const textures = (project.textures ?? []).filter((t) => worldTexIds.has(t.id));
  return JSON.stringify(
    {
      version: project.version,
      kind: 'roboforge_world',
      name: project.world.name || project.name,
      target: project.target,
      world: project.world,
      textures,
    },
    null,
    2,
  );
}

export function parseProjectJson(rawJson: string): ParseProjectResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON syntax: ${err instanceof Error ? err.message : 'Unable to parse'}`,
    };
  }

  const migrated = migrateProject(parsed);
  const result = ProjectSchema.safeParse(migrated);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue?.path.join('.') || 'root';
    return {
      ok: false,
      error: `Schema validation failed at "${path}": ${firstIssue?.message ?? 'Invalid project structure'}`,
    };
  }

  return { ok: true, project: result.data };
}

/**
 * Parse a Full Project JSON, Model-only JSON (`kind: "roboforge_model"`),
 * or World-only JSON (`kind: "roboforge_world"`), merging partial imports cleanly
 * into `currentProject` so the unaffected half stays intact.
 */
export function parseScopedProjectJson(
  rawJson: string,
  currentProject: Project,
): ParseScopedProjectResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON syntax: ${err instanceof Error ? err.message : 'Unable to parse'}`,
    };
  }

  if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
    const kind = (parsed as { kind?: unknown }).kind;
    if (kind === 'roboforge_model') {
      const res = ModelJsonEnvelopeSchema.safeParse(parsed);
      if (!res.success) {
        const firstIssue = res.error.issues[0];
        const path = firstIssue?.path.join('.') || 'root';
        return {
          ok: false,
          error: `Model JSON validation failed at "${path}": ${firstIssue?.message ?? 'Invalid model structure'}`,
        };
      }
      const worldTexIds = collectWorldTextureIds(currentProject);
      const preservedWorldTextures = (currentProject.textures ?? []).filter((t) =>
        worldTexIds.has(t.id),
      );
      return {
        ok: true,
        scope: 'model',
        project: {
          ...currentProject,
          robot: res.data.robot,
          assets: res.data.assets,
          textures: mergeTexturesById(preservedWorldTextures, res.data.textures),
        },
      };
    }

    if (kind === 'roboforge_world') {
      const res = WorldJsonEnvelopeSchema.safeParse(parsed);
      if (!res.success) {
        const firstIssue = res.error.issues[0];
        const path = firstIssue?.path.join('.') || 'root';
        return {
          ok: false,
          error: `World JSON validation failed at "${path}": ${firstIssue?.message ?? 'Invalid world structure'}`,
        };
      }
      const robotTexIds = collectRobotTextureIds(currentProject);
      const preservedRobotTextures = (currentProject.textures ?? []).filter((t) =>
        robotTexIds.has(t.id),
      );
      return {
        ok: true,
        scope: 'world',
        project: {
          ...currentProject,
          world: res.data.world,
          textures: mergeTexturesById(preservedRobotTextures, res.data.textures),
        },
      };
    }
  }

  const fullResult = parseProjectJson(rawJson);
  if (!fullResult.ok) return fullResult;
  return { ok: true, scope: 'full', project: fullResult.project };
}

export async function saveAutosaveProject(project: Project): Promise<void> {
  const payload = serializeProject(project);
  await set(AUTOSAVE_STORAGE_KEY, payload);
}

export async function loadAutosavedProject(): Promise<Project | null> {
  try {
    const raw = await get<string>(AUTOSAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseProjectJson(raw);
    return parsed.ok ? parsed.project : null;
  } catch {
    return null;
  }
}

export async function clearAutosavedProject(): Promise<void> {
  await del(AUTOSAVE_STORAGE_KEY);
}
