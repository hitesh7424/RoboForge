import { z } from 'zod';

export const ROS_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]*$/;

export function isValidRosName(name: string): boolean {
  return ROS_IDENTIFIER_REGEX.test(name);
}

export const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

export const PoseSchema = z.object({
  xyz: Vec3Schema,
  rpy: Vec3Schema,
});
export type Pose = z.infer<typeof PoseSchema>;

export const PrimitiveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('box'),
    size: Vec3Schema,
  }),
  z.object({
    kind: z.literal('cylinder'),
    radius: z.number().finite(),
    length: z.number().finite(),
  }),
  z.object({
    kind: z.literal('sphere'),
    radius: z.number().finite(),
  }),
  z.object({
    kind: z.literal('capsule'),
    radius: z.number().finite(),
    length: z.number().finite(),
  }),
  z.object({
    kind: z.literal('extrude'),
    points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3),
    depth: z.number().finite(),
  }),
]);
export type Primitive = z.infer<typeof PrimitiveSchema>;

export const CompoundPartSchema = z.object({
  id: z.string().min(1),
  shape: PrimitiveSchema,
  pose: PoseSchema,
  op: z.enum(['add', 'subtract']).optional(),
});
export type CompoundPart = z.infer<typeof CompoundPartSchema>;

export const GeometrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('primitive'),
    shape: PrimitiveSchema,
  }),
  z.object({
    type: z.literal('compound'),
    parts: z.array(CompoundPartSchema),
  }),
  z.object({
    type: z.literal('mesh'),
    assetId: z.string().min(1),
    scale: Vec3Schema,
  }),
]);
export type Geometry = z.infer<typeof GeometrySchema>;

export const MaterialSchema = z.object({
  name: z.string().min(1),
  rgba: z.tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ]),
});
export type Material = z.infer<typeof MaterialSchema>;

export const MountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pose: PoseSchema,
});
export type Mount = z.infer<typeof MountSchema>;

export const InertiaSchema = z.object({
  ixx: z.number().finite(),
  ixy: z.number().finite(),
  ixz: z.number().finite(),
  iyy: z.number().finite(),
  iyz: z.number().finite(),
  izz: z.number().finite(),
});
export type Inertia = z.infer<typeof InertiaSchema>;

export const LinkCollisionSchema = z.union([
  z.object({ sameAsVisual: z.literal(true) }),
  z.object({
    geometry: GeometrySchema,
    pose: PoseSchema,
  }),
]);
export type LinkCollision = z.infer<typeof LinkCollisionSchema>;

export const LinkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  visual: z.object({
    geometry: GeometrySchema,
    pose: PoseSchema,
    material: MaterialSchema,
  }),
  collision: LinkCollisionSchema,
  inertial: z.object({
    mass: z.number().finite(),
    pose: PoseSchema,
    inertia: InertiaSchema.optional(),
    auto: z.boolean(),
  }),
  mounts: z.array(MountSchema),
});
export type Link = z.infer<typeof LinkSchema>;

export const JointLimitsSchema = z.object({
  lower: z.number().finite(),
  upper: z.number().finite(),
  effort: z.number().finite(),
  velocity: z.number().finite(),
});
export type JointLimits = z.infer<typeof JointLimitsSchema>;

export const JointDynamicsSchema = z.object({
  damping: z.number().finite(),
  friction: z.number().finite(),
});
export type JointDynamics = z.infer<typeof JointDynamicsSchema>;

export const JointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['fixed', 'revolute', 'continuous', 'prismatic']),
  parent: z.object({
    linkId: z.string().min(1),
    mountId: z.string().min(1),
  }),
  child: z.object({
    linkId: z.string().min(1),
    mountId: z.string().min(1),
  }),
  axis: Vec3Schema,
  limits: JointLimitsSchema.optional(),
  dynamics: JointDynamicsSchema.optional(),
});
export type Joint = z.infer<typeof JointSchema>;

const SensorBaseFields = {
  id: z.string().min(1),
  name: z.string().min(1),
  linkId: z.string().min(1),
  mountId: z.string().min(1),
  topic: z.string().min(1),
  updateRate: z.number().positive(),
};

export const SensorSchema = z.discriminatedUnion('kind', [
  z.object({
    ...SensorBaseFields,
    kind: z.literal('lidar2d'),
    samples: z.number().int().positive(),
    minAngle: z.number().finite(),
    maxAngle: z.number().finite(),
    minRange: z.number().positive(),
    maxRange: z.number().positive(),
    visualize: z.boolean().optional(),
  }),
  z.object({
    ...SensorBaseFields,
    kind: z.literal('lidar3d'),
    horizontalSamples: z.number().int().positive(),
    verticalSamples: z.number().int().positive(),
    minRange: z.number().positive(),
    maxRange: z.number().positive(),
    visualize: z.boolean().optional(),
  }),
  z.object({
    ...SensorBaseFields,
    kind: z.literal('camera'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    horizontalFov: z.number().positive(),
    nearClip: z.number().positive(),
    farClip: z.number().positive(),
  }),
  z.object({
    ...SensorBaseFields,
    kind: z.literal('depth_camera'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    horizontalFov: z.number().positive(),
    nearClip: z.number().positive(),
    farClip: z.number().positive(),
  }),
  z.object({
    ...SensorBaseFields,
    kind: z.literal('imu'),
    noiseStddev: z.number().nonnegative().optional(),
  }),
  z.object({
    ...SensorBaseFields,
    kind: z.literal('gps'),
    horizontalNoise: z.number().nonnegative().optional(),
    verticalNoise: z.number().nonnegative().optional(),
  }),
]);
export type Sensor = z.infer<typeof SensorSchema>;

export const PluginSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.literal('diff_drive'),
    leftJointIds: z.array(z.string().min(1)),
    rightJointIds: z.array(z.string().min(1)),
    wheelSeparation: z.number().positive(),
    wheelRadius: z.number().positive(),
    odomTopic: z.string().min(1),
    cmdVelTopic: z.string().min(1),
    maxLinearAcceleration: z.number().positive().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.literal('ackermann'),
    leftSteerJointId: z.string().min(1),
    rightSteerJointId: z.string().min(1),
    leftWheelJointId: z.string().min(1),
    rightWheelJointId: z.string().min(1),
    wheelbase: z.number().positive(),
    trackWidth: z.number().positive(),
    wheelRadius: z.number().positive(),
    odomTopic: z.string().min(1),
    cmdVelTopic: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.literal('joint_state_publisher'),
    topic: z.string().min(1),
    jointIds: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.literal('joint_controller'),
    jointId: z.string().min(1),
    topic: z.string().min(1),
    pGain: z.number().finite(),
    iGain: z.number().finite(),
    dGain: z.number().finite(),
  }),
]);
export type Plugin = z.infer<typeof PluginSchema>;

export const LightSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['directional', 'point', 'spot']),
  pose: PoseSchema,
  diffuse: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
  intensity: z.number().nonnegative(),
  castShadows: z.boolean(),
});
export type Light = z.infer<typeof LightSchema>;

export const WorldObjectSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('primitive'),
    shape: PrimitiveSchema,
    material: MaterialSchema,
  }),
  z.object({
    type: z.literal('model'),
    uri: z.string().min(1),
  }),
]);
export type WorldObjectSource = z.infer<typeof WorldObjectSourceSchema>;

export const WorldObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: WorldObjectSourceSchema,
  pose: PoseSchema,
  static: z.boolean(),
  mass: z.number().positive().optional(),
});
export type WorldObject = z.infer<typeof WorldObjectSchema>;

export const WorldSchema = z.object({
  name: z.string().min(1),
  physics: z.object({
    stepSize: z.number().positive(),
    realTimeFactor: z.number().positive(),
    gravity: Vec3Schema,
  }),
  ground: z.object({
    enabled: z.boolean(),
    size: z.tuple([z.number().positive(), z.number().positive()]),
    friction: z.number().nonnegative(),
  }),
  robotSpawnPose: PoseSchema,
  lights: z.array(LightSchema),
  objects: z.array(WorldObjectSchema),
});
export type World = z.infer<typeof WorldSchema>;

export const CustomPartSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  geometry: GeometrySchema,
  defaultMounts: z.array(MountSchema),
});
export type CustomPart = z.infer<typeof CustomPartSchema>;

export const AssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  format: z.enum(['stl', 'glb', 'dae']),
  dataBase64: z.string(),
  byteLength: z.number().int().nonnegative(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const TargetSchema = z.enum(['jazzy-harmonic', 'humble-fortress', 'lyrical-jetty']);
export type TargetDistro = z.infer<typeof TargetSchema>;

export const ProjectSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  target: TargetSchema,
  robot: z.object({
    name: z.string().min(1),
    links: z.array(LinkSchema),
    joints: z.array(JointSchema),
    sensors: z.array(SensorSchema),
    plugins: z.array(PluginSchema),
    rootLinkId: z.string(),
  }),
  world: WorldSchema,
  customParts: z.array(CustomPartSchema),
  assets: z.array(AssetSchema),
});
export type Project = z.infer<typeof ProjectSchema>;

export type ValidationTargetType =
  'project' | 'robot' | 'link' | 'joint' | 'sensor' | 'plugin' | 'world' | 'worldObject';

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  targetType: ValidationTargetType;
  targetId?: string;
}

export function migrateProject(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) {
    return raw;
  }
  const obj = { ...(raw as Record<string, unknown>) };
  if (obj.version === undefined) {
    obj.version = 1;
  }
  // Future migrations keyed on version go here (e.g. if (obj.version === 1) -> v2).
  if (typeof obj.world === 'object' && obj.world !== null) {
    const world = { ...(obj.world as Record<string, unknown>) };
    if (!world.robotSpawnPose) {
      world.robotSpawnPose = { xyz: [0, 0, 0], rpy: [0, 0, 0] };
    }
    obj.world = world;
  }
  return obj;
}

function validatePrimitiveDimensions(
  primitive: Primitive,
  label: string,
  targetId: string,
  issues: ValidationIssue[],
): void {
  if (primitive.kind === 'box') {
    if (primitive.size[0] <= 0 || primitive.size[1] <= 0 || primitive.size[2] <= 0) {
      issues.push({
        id: `dim-${targetId}`,
        severity: 'error',
        message: `${label}: box dimensions must all be greater than 0 m.`,
        targetType: 'link',
        targetId,
      });
    }
  } else if (primitive.kind === 'sphere') {
    if (primitive.radius <= 0) {
      issues.push({
        id: `dim-${targetId}`,
        severity: 'error',
        message: `${label}: sphere radius must be greater than 0 m.`,
        targetType: 'link',
        targetId,
      });
    }
  } else if (primitive.kind === 'extrude') {
    if (primitive.depth <= 0 || primitive.points.length < 3) {
      issues.push({
        id: `dim-${targetId}`,
        severity: 'error',
        message: `${label}: extruded sketch requires at least 3 points and positive depth.`,
        targetType: 'link',
        targetId,
      });
    }
  } else {
    if (primitive.radius <= 0 || primitive.length <= 0) {
      issues.push({
        id: `dim-${targetId}`,
        severity: 'error',
        message: `${label}: ${primitive.kind} radius and length must be greater than 0 m.`,
        targetType: 'link',
        targetId,
      });
    }
  }
}

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isValidRosName(project.name)) {
    issues.push({
      id: 'project-name',
      severity: 'error',
      message: `Project package name "${project.name}" must be a valid ROS identifier (^[a-z][a-z0-9_]*$).`,
      targetType: 'project',
    });
  }

  if (!isValidRosName(project.robot.name)) {
    issues.push({
      id: 'robot-name',
      severity: 'error',
      message: `Robot name "${project.robot.name}" must be a valid ROS identifier (^[a-z][a-z0-9_]*$).`,
      targetType: 'robot',
    });
  }

  const { links, joints, sensors, rootLinkId } = project.robot;

  if (links.length === 0) {
    issues.push({
      id: 'no-links',
      severity: 'error',
      message: 'Robot must contain at least one root link.',
      targetType: 'robot',
    });
    return issues;
  }

  const linkMap = new Map<string, Link>();
  const linkNames = new Map<string, string>();

  for (const link of links) {
    linkMap.set(link.id, link);

    if (!isValidRosName(link.name)) {
      issues.push({
        id: `link-name-${link.id}`,
        severity: 'error',
        message: `Link "${link.name}" must match ^[a-z][a-z0-9_]*$.`,
        targetType: 'link',
        targetId: link.id,
      });
    }

    const existingNameOwner = linkNames.get(link.name);
    if (existingNameOwner) {
      issues.push({
        id: `link-dup-${link.id}`,
        severity: 'error',
        message: `Duplicate link name "${link.name}". Link names must be unique.`,
        targetType: 'link',
        targetId: link.id,
      });
    } else {
      linkNames.set(link.name, link.id);
    }

    if (link.inertial.mass <= 0) {
      issues.push({
        id: `link-mass-${link.id}`,
        severity: 'error',
        message: `Link "${link.name}" mass must be positive (currently ${link.inertial.mass} kg).`,
        targetType: 'link',
        targetId: link.id,
      });
    } else if (link.inertial.mass < 0.001) {
      issues.push({
        id: `link-mass-warn-${link.id}`,
        severity: 'warning',
        message: `Link "${link.name}" mass (${link.inertial.mass} kg) is below 0.001 kg and may destabilize physics.`,
        targetType: 'link',
        targetId: link.id,
      });
    }

    if (link.visual.geometry.type === 'primitive') {
      validatePrimitiveDimensions(
        link.visual.geometry.shape,
        `Link "${link.name}" visual`,
        link.id,
        issues,
      );
    }

    const mountNames = new Set<string>();
    for (const mount of link.mounts) {
      if (!isValidRosName(mount.name)) {
        issues.push({
          id: `mount-name-${mount.id}`,
          severity: 'error',
          message: `Mount "${mount.name}" on link "${link.name}" must match ^[a-z][a-z0-9_]*$.`,
          targetType: 'link',
          targetId: link.id,
        });
      }
      if (mountNames.has(mount.name)) {
        issues.push({
          id: `mount-dup-${mount.id}`,
          severity: 'error',
          message: `Duplicate mount name "${mount.name}" on link "${link.name}".`,
          targetType: 'link',
          targetId: link.id,
        });
      }
      mountNames.add(mount.name);
    }
  }

  const rootLink = linkMap.get(rootLinkId);
  if (!rootLink) {
    issues.push({
      id: 'missing-root',
      severity: 'error',
      message: 'Robot rootLinkId does not reference an existing link.',
      targetType: 'robot',
    });
  }

  const jointNames = new Set<string>();
  const childLinkCounts = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const joint of joints) {
    if (!isValidRosName(joint.name)) {
      issues.push({
        id: `joint-name-${joint.id}`,
        severity: 'error',
        message: `Joint "${joint.name}" must match ^[a-z][a-z0-9_]*$.`,
        targetType: 'joint',
        targetId: joint.id,
      });
    }
    if (jointNames.has(joint.name)) {
      issues.push({
        id: `joint-dup-${joint.id}`,
        severity: 'error',
        message: `Duplicate joint name "${joint.name}".`,
        targetType: 'joint',
        targetId: joint.id,
      });
    }
    jointNames.add(joint.name);

    const parentLink = linkMap.get(joint.parent.linkId);
    const childLink = linkMap.get(joint.child.linkId);

    if (!parentLink) {
      issues.push({
        id: `joint-parent-${joint.id}`,
        severity: 'error',
        message: `Joint "${joint.name}" references missing parent link.`,
        targetType: 'joint',
        targetId: joint.id,
      });
    } else if (!parentLink.mounts.some((m) => m.id === joint.parent.mountId)) {
      issues.push({
        id: `joint-parent-mount-${joint.id}`,
        severity: 'error',
        message: `Joint "${joint.name}" references missing parent mount on "${parentLink.name}".`,
        targetType: 'joint',
        targetId: joint.id,
      });
    }

    if (!childLink) {
      issues.push({
        id: `joint-child-${joint.id}`,
        severity: 'error',
        message: `Joint "${joint.name}" references missing child link.`,
        targetType: 'joint',
        targetId: joint.id,
      });
    } else if (!childLink.mounts.some((m) => m.id === joint.child.mountId)) {
      issues.push({
        id: `joint-child-mount-${joint.id}`,
        severity: 'error',
        message: `Joint "${joint.name}" references missing child mount on "${childLink.name}".`,
        targetType: 'joint',
        targetId: joint.id,
      });
    }

    if (joint.parent.linkId === joint.child.linkId) {
      issues.push({
        id: `joint-self-${joint.id}`,
        severity: 'error',
        message: `Joint "${joint.name}" cannot connect a link to itself.`,
        targetType: 'joint',
        targetId: joint.id,
      });
    }

    childLinkCounts.set(joint.child.linkId, (childLinkCounts.get(joint.child.linkId) ?? 0) + 1);
    const children = adjacency.get(joint.parent.linkId) ?? [];
    children.push(joint.child.linkId);
    adjacency.set(joint.parent.linkId, children);
  }

  for (const [linkId, count] of childLinkCounts.entries()) {
    if (count > 1) {
      const link = linkMap.get(linkId);
      issues.push({
        id: `multi-parent-${linkId}`,
        severity: 'error',
        message: `Link "${link?.name ?? linkId}" has ${count} parent joints; URDF requires a strict tree (1 parent per non-root link).`,
        targetType: 'link',
        targetId: linkId,
      });
    }
    if (linkId === rootLinkId) {
      issues.push({
        id: 'root-is-child',
        severity: 'error',
        message: `Root link "${rootLink?.name ?? rootLinkId}" cannot be the child of a joint.`,
        targetType: 'link',
        targetId: rootLinkId,
      });
    }
  }

  const rootCandidates = links.filter((l) => !childLinkCounts.has(l.id));
  if (rootCandidates.length > 1) {
    issues.push({
      id: 'multiple-roots',
      severity: 'error',
      message: `Found ${rootCandidates.length} disconnected root links (${rootCandidates.map((l) => l.name).join(', ')}). Connect all links to "${rootLink?.name ?? 'root'}" via joints.`,
      targetType: 'robot',
    });
  }

  // Cycle detection via DFS from all links
  const visitState = new Map<string, 'visiting' | 'visited'>();
  let cycleFound = false;

  const dfs = (linkId: string) => {
    if (cycleFound) return;
    visitState.set(linkId, 'visiting');
    for (const nextId of adjacency.get(linkId) ?? []) {
      const state = visitState.get(nextId);
      if (state === 'visiting') {
        cycleFound = true;
        issues.push({
          id: `cycle-${nextId}`,
          severity: 'error',
          message: `Kinematic cycle detected involving link "${linkMap.get(nextId)?.name ?? nextId}".`,
          targetType: 'link',
          targetId: nextId,
        });
        return;
      }
      if (!state) {
        dfs(nextId);
      }
    }
    visitState.set(linkId, 'visited');
  };

  for (const link of links) {
    if (!visitState.has(link.id)) {
      dfs(link.id);
    }
  }

  // Sensor mount & unique name checks
  const sensorNames = new Set<string>();
  for (const sensor of sensors) {
    if (!isValidRosName(sensor.name)) {
      issues.push({
        id: `sensor-name-${sensor.id}`,
        severity: 'error',
        message: `Sensor "${sensor.name}" must match ^[a-z][a-z0-9_]*$.`,
        targetType: 'sensor',
        targetId: sensor.id,
      });
    }
    if (sensorNames.has(sensor.name)) {
      issues.push({
        id: `sensor-dup-${sensor.id}`,
        severity: 'error',
        message: `Duplicate sensor name "${sensor.name}".`,
        targetType: 'sensor',
        targetId: sensor.id,
      });
    }
    sensorNames.add(sensor.name);

    const hostLink = linkMap.get(sensor.linkId);
    if (!hostLink || !hostLink.mounts.some((m) => m.id === sensor.mountId)) {
      issues.push({
        id: `sensor-mount-${sensor.id}`,
        severity: 'error',
        message: `Sensor "${sensor.name}" references a missing link or mount.`,
        targetType: 'sensor',
        targetId: sensor.id,
      });
    }
  }

  return issues;
}
