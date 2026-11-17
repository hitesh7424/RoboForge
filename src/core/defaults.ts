import { DEFAULT_MAP_BACKGROUND } from '@/core/mapTiles';
import type { Link, Pose, Primitive, Project, World } from '@/core/schema';

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(36).slice(2, 11)}_${Date.now().toString(36)}`;
}

export function createZeroPose(): Pose {
  return { xyz: [0, 0, 0], rpy: [0, 0, 0] };
}

export function createDefaultWorld(): World {
  return {
    name: 'default_world',
    physics: {
      stepSize: 0.001,
      realTimeFactor: 1.0,
      gravity: [0, 0, -9.81],
    },
    ground: {
      enabled: true,
      size: [50, 50],
      friction: 0.8,
    },
    mapBackground: { ...DEFAULT_MAP_BACKGROUND },
    robotSpawnPose: { xyz: [0, 0, 0.15], rpy: [0, 0, 0] },
    lights: [
      {
        id: createId(),
        name: 'sun',
        type: 'directional',
        pose: { xyz: [0, 0, 10], rpy: [-0.5, 0.3, 0] },
        diffuse: [0.95, 0.95, 0.92],
        intensity: 1.0,
        castShadows: true,
      },
    ],
    objects: [],
  };
}

export function createPrimitiveLink(
  name: string,
  shape: Primitive,
  options?: {
    mass?: number;
    rgba?: [number, number, number, number];
    materialName?: string;
  },
): Link {
  return {
    id: createId(),
    name,
    visual: {
      geometry: { type: 'primitive', shape },
      pose: createZeroPose(),
      material: {
        name: options?.materialName ?? 'chassis_slate',
        rgba: options?.rgba ?? [0.22, 0.32, 0.45, 1.0],
      },
    },
    collision: { sameAsVisual: true },
    inertial: {
      mass: options?.mass ?? 2.5,
      pose: createZeroPose(),
      auto: true,
    },
    mounts: [
      {
        id: createId(),
        name: 'center_mount',
        pose: createZeroPose(),
      },
    ],
  };
}

export function createDefaultProject(): Project {
  const baseLink = createPrimitiveLink(
    'base_link',
    { kind: 'box', size: [0.45, 0.32, 0.12] },
    {
      mass: 4.0,
      materialName: 'anodized_slate',
      rgba: [0.24, 0.31, 0.41, 1.0],
    },
  );

  return {
    version: 1,
    name: 'my_robot_pkg',
    target: 'jazzy-harmonic',
    robot: {
      name: 'my_robot',
      links: [baseLink],
      joints: [],
      sensors: [],
      plugins: [],
      rootLinkId: baseLink.id,
    },
    world: createDefaultWorld(),
    customParts: [],
    assets: [],
    textures: [],
  };
}
