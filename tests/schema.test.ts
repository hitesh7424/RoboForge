import { describe, expect, it } from 'vitest';
import { createDefaultProject, createId, createPrimitiveLink } from '@/core/defaults';
import { parseProjectJson, serializeProject } from '@/core/persistence';
import { isValidRosName, migrateProject, ProjectSchema, validateProject } from '@/core/schema';

describe('RoboForge schema & validation', () => {
  it('validates the default project cleanly with zero issues', () => {
    const project = createDefaultProject();
    const parsed = ProjectSchema.safeParse(project);
    expect(parsed.success).toBe(true);
    expect(validateProject(project)).toEqual([]);
  });

  it('enforces ROS identifier pattern ^[a-z][a-z0-9_]*$', () => {
    expect(isValidRosName('base_link')).toBe(true);
    expect(isValidRosName('wheel_front_left_1')).toBe(true);
    expect(isValidRosName('BaseLink')).toBe(false);
    expect(isValidRosName('1_link')).toBe(false);
    expect(isValidRosName('my-link')).toBe(false);
  });

  it('flags duplicate link names, non-positive mass, and invalid box dimensions', () => {
    const project = createDefaultProject();
    const extra = createPrimitiveLink(
      'base_link',
      { kind: 'box', size: [0, 0.2, 0.1] },
      { mass: 0 },
    );
    project.robot.links.push(extra);

    const issues = validateProject(project);
    const messages = issues.map((i) => i.message);
    expect(messages.some((m) => m.includes('Duplicate link name "base_link"'))).toBe(true);
    expect(messages.some((m) => m.includes('mass must be positive'))).toBe(true);
    expect(messages.some((m) => m.includes('box dimensions must all be greater than 0'))).toBe(
      true,
    );
  });

  it('detects kinematic cycles and missing mount references', () => {
    const project = createDefaultProject();
    const linkA = project.robot.links[0]!;
    const linkB = createPrimitiveLink('wheel_link', {
      kind: 'cylinder',
      radius: 0.08,
      length: 0.04,
    });
    project.robot.links.push(linkB);

    project.robot.joints.push(
      {
        id: createId(),
        name: 'joint_ab',
        type: 'continuous',
        parent: { linkId: linkA.id, mountId: linkA.mounts[0]!.id },
        child: { linkId: linkB.id, mountId: linkB.mounts[0]!.id },
        axis: [0, 1, 0],
      },
      {
        id: createId(),
        name: 'joint_ba',
        type: 'fixed',
        parent: { linkId: linkB.id, mountId: linkB.mounts[0]!.id },
        child: { linkId: linkA.id, mountId: 'nonexistent_mount' },
        axis: [0, 0, 1],
      },
    );

    const issues = validateProject(project);
    const messages = issues.map((i) => i.message);
    expect(messages.some((m) => m.includes('Kinematic cycle detected'))).toBe(true);
    expect(messages.some((m) => m.includes('missing child mount'))).toBe(true);
  });

  it('round-trips JSON serialization and migration cleanly', () => {
    const project = createDefaultProject();
    const json = serializeProject(project);
    const result = parseProjectJson(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project).toEqual(project);
    }

    const unversioned = JSON.parse(json) as Record<string, unknown>;
    delete unversioned.version;
    const migrated = migrateProject(unversioned) as Record<string, unknown>;
    expect(migrated.version).toBe(1);
    expect(ProjectSchema.safeParse(migrated).success).toBe(true);
  });

  it('rejects malformed JSON and invalid schema payloads', () => {
    const badSyntax = parseProjectJson('{not valid json');
    expect(badSyntax.ok).toBe(false);

    const badSchema = parseProjectJson(JSON.stringify({ version: 1, name: 'x' }));
    expect(badSchema.ok).toBe(false);
  });
});
