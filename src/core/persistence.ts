import { del, get, set } from 'idb-keyval';
import { migrateProject, ProjectSchema, type Project } from '@/core/schema';

export const AUTOSAVE_STORAGE_KEY = 'roboforge_autosave_v1';

export type ParseProjectResult = { ok: true; project: Project } | { ok: false; error: string };

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
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
