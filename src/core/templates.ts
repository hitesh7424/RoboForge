import { createDefaultWorld, createId, createZeroPose } from '@/core/defaults';
import type {
  CustomPart,
  Joint,
  Link,
  Mount,
  Plugin,
  Project,
  Sensor,
  TargetDistro,
} from '@/core/schema';

export interface ChassisAxlesParams {
  name: string;
  chassisSize: [number, number, number];
  wheelbase: number;
  trackWidth: number;
  axleCount: number;
  axleRadius: number;
}

/**
 * Parametric "Chassis with axles" generator (Phase 4 Stage 1).
 * Builds a compound chassis + cylindrical axle housings and auto-creates left/right axle mounts.
 */
export function buildChassisWithAxlesPart(params: ChassisAxlesParams): CustomPart {
  const [cx, cy, cz] = params.chassisSize;
  const parts: NonNullable<Extract<CustomPart['geometry'], { type: 'compound' }>['parts']> = [
    {
      id: createId(),
      shape: { kind: 'box', size: [cx, cy, cz] },
      pose: createZeroPose(),
      op: 'add',
    },
  ];

  const defaultMounts: Mount[] = [
    { id: createId(), name: 'top_mount', pose: { xyz: [0, 0, cz / 2], rpy: [0, 0, 0] } },
  ];

  const count = Math.max(1, Math.min(4, Math.round(params.axleCount)));
  const startX = count === 1 ? 0 : params.wheelbase / 2;
  const stepX = count === 1 ? 0 : params.wheelbase / (count - 1);

  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0 : startX - i * stepX;
    const prefix =
      count === 1 ? 'axle' : count === 2 ? (i === 0 ? 'axle_front' : 'axle_rear') : `axle_${i + 1}`;

    parts.push({
      id: createId(),
      shape: { kind: 'cylinder', radius: params.axleRadius, length: params.trackWidth },
      pose: { xyz: [x, 0, -cz * 0.35], rpy: [Math.PI / 2, 0, 0] },
      op: 'add',
    });

    defaultMounts.push(
      {
        id: createId(),
        name: `${prefix}_left_mount`,
        pose: { xyz: [x, params.trackWidth / 2, -cz * 0.35], rpy: [0, 0, 0] },
      },
      {
        id: createId(),
        name: `${prefix}_right_mount`,
        pose: { xyz: [x, -params.trackWidth / 2, -cz * 0.35], rpy: [0, 0, 0] },
      },
    );
  }

  return {
    id: createId(),
    name: params.name,
    geometry: { type: 'compound', parts },
    defaultMounts,
  };
}

/**
 * 4-Wheel Differential Drive Rover starter template (Phase 1/2/5 acceptance robot).
 */
export function createFourWheelRoverProject(target: TargetDistro = 'jazzy-harmonic'): Project {
  const baseId = createId();
  const flMountId = createId();
  const frMountId = createId();
  const rlMountId = createId();
  const rrMountId = createId();
  const lidarMountId = createId();
  const camMountId = createId();
  const imuMountId = createId();

  const wheelRadius = 0.085;
  const wheelWidth = 0.045;
  const wheelZ = -0.04;
  const xOff = 0.16;
  const yOff = 0.2;

  const baseLink: Link = {
    id: baseId,
    name: 'base_link',
    visual: {
      geometry: { type: 'primitive', shape: { kind: 'box', size: [0.48, 0.34, 0.12] } },
      pose: createZeroPose(),
      material: { name: 'rover_slate', rgba: [0.22, 0.31, 0.43, 1.0] },
    },
    collision: { sameAsVisual: true },
    inertial: { mass: 6.0, pose: createZeroPose(), auto: true },
    mounts: [
      {
        id: flMountId,
        name: 'front_left_wheel_mount',
        pose: { xyz: [xOff, yOff, wheelZ], rpy: [0, 0, 0] },
      },
      {
        id: frMountId,
        name: 'front_right_wheel_mount',
        pose: { xyz: [xOff, -yOff, wheelZ], rpy: [0, 0, 0] },
      },
      {
        id: rlMountId,
        name: 'rear_left_wheel_mount',
        pose: { xyz: [-xOff, yOff, wheelZ], rpy: [0, 0, 0] },
      },
      {
        id: rrMountId,
        name: 'rear_right_wheel_mount',
        pose: { xyz: [-xOff, -yOff, wheelZ], rpy: [0, 0, 0] },
      },
      { id: lidarMountId, name: 'lidar_mount', pose: { xyz: [0.1, 0, 0.09], rpy: [0, 0, 0] } },
      { id: camMountId, name: 'camera_mount', pose: { xyz: [0.24, 0, 0.03], rpy: [0, 0, 0] } },
      { id: imuMountId, name: 'imu_mount', pose: { xyz: [0, 0, 0.06], rpy: [0, 0, 0] } },
    ],
  };

  const makeWheel = (name: string): { link: Link; mountId: string } => {
    const mountId = createId();
    return {
      mountId,
      link: {
        id: createId(),
        name,
        visual: {
          geometry: {
            type: 'primitive',
            shape: { kind: 'cylinder', radius: wheelRadius, length: wheelWidth },
          },
          pose: { xyz: [0, 0, 0], rpy: [Math.PI / 2, 0, 0] },
          material: { name: 'tire_rubber', rgba: [0.12, 0.13, 0.16, 1.0] },
        },
        collision: { sameAsVisual: true },
        inertial: { mass: 0.75, pose: createZeroPose(), auto: true },
        mounts: [{ id: mountId, name: 'hub_mount', pose: createZeroPose() }],
      },
    };
  };

  const fl = makeWheel('front_left_wheel_link');
  const fr = makeWheel('front_right_wheel_link');
  const rl = makeWheel('rear_left_wheel_link');
  const rr = makeWheel('rear_right_wheel_link');

  const lidarLinkMountId = createId();
  const lidarLink: Link = {
    id: createId(),
    name: 'lidar_link',
    visual: {
      geometry: { type: 'primitive', shape: { kind: 'cylinder', radius: 0.045, length: 0.05 } },
      pose: createZeroPose(),
      material: { name: 'sensor_cobalt', rgba: [0.15, 0.45, 0.85, 1.0] },
    },
    collision: { sameAsVisual: true },
    inertial: { mass: 0.25, pose: createZeroPose(), auto: true },
    mounts: [
      { id: lidarLinkMountId, name: 'base_mount', pose: { xyz: [0, 0, -0.025], rpy: [0, 0, 0] } },
    ],
  };

  const joints: Joint[] = [
    {
      id: createId(),
      name: 'front_left_wheel_joint',
      type: 'continuous',
      parent: { linkId: baseId, mountId: flMountId },
      child: { linkId: fl.link.id, mountId: fl.mountId },
      axis: [0, 1, 0],
      dynamics: { damping: 0.1, friction: 0.1 },
    },
    {
      id: createId(),
      name: 'front_right_wheel_joint',
      type: 'continuous',
      parent: { linkId: baseId, mountId: frMountId },
      child: { linkId: fr.link.id, mountId: fr.mountId },
      axis: [0, 1, 0],
      dynamics: { damping: 0.1, friction: 0.1 },
    },
    {
      id: createId(),
      name: 'rear_left_wheel_joint',
      type: 'continuous',
      parent: { linkId: baseId, mountId: rlMountId },
      child: { linkId: rl.link.id, mountId: rl.mountId },
      axis: [0, 1, 0],
      dynamics: { damping: 0.1, friction: 0.1 },
    },
    {
      id: createId(),
      name: 'rear_right_wheel_joint',
      type: 'continuous',
      parent: { linkId: baseId, mountId: rrMountId },
      child: { linkId: rr.link.id, mountId: rr.mountId },
      axis: [0, 1, 0],
      dynamics: { damping: 0.1, friction: 0.1 },
    },
    {
      id: createId(),
      name: 'lidar_joint',
      type: 'fixed',
      parent: { linkId: baseId, mountId: lidarMountId },
      child: { linkId: lidarLink.id, mountId: lidarLinkMountId },
      axis: [0, 0, 1],
    },
  ];

  const sensors: Sensor[] = [
    {
      id: createId(),
      name: 'front_lidar',
      kind: 'lidar2d',
      linkId: lidarLink.id,
      mountId: lidarLinkMountId,
      topic: '/scan',
      updateRate: 10,
      samples: 360,
      minAngle: -3.14159,
      maxAngle: 3.14159,
      minRange: 0.12,
      maxRange: 12.0,
      visualize: true,
    },
    {
      id: createId(),
      name: 'front_camera',
      kind: 'camera',
      linkId: baseId,
      mountId: camMountId,
      topic: '/camera/image_raw',
      updateRate: 30,
      width: 640,
      height: 480,
      horizontalFov: 1.396,
      nearClip: 0.05,
      farClip: 50,
    },
    {
      id: createId(),
      name: 'chassis_imu',
      kind: 'imu',
      linkId: baseId,
      mountId: imuMountId,
      topic: '/imu',
      updateRate: 100,
      noiseStddev: 0.002,
    },
  ];

  const plugins: Plugin[] = [
    {
      id: createId(),
      name: 'diff_drive_controller',
      kind: 'diff_drive',
      leftJointIds: [joints[0]!.id, joints[2]!.id],
      rightJointIds: [joints[1]!.id, joints[3]!.id],
      wheelSeparation: yOff * 2,
      wheelRadius,
      odomTopic: '/odom',
      cmdVelTopic: '/cmd_vel',
      maxLinearAcceleration: 1.5,
    },
    {
      id: createId(),
      name: 'joint_state_pub',
      kind: 'joint_state_publisher',
      topic: '/joint_states',
    },
  ];

  const world = createDefaultWorld();
  world.name = 'rover_arena';
  world.objects = [
    {
      id: createId(),
      name: 'north_wall',
      source: {
        type: 'primitive',
        shape: { kind: 'box', size: [6.0, 0.25, 1.0] },
        material: { name: 'concrete_gray', rgba: [0.48, 0.52, 0.58, 1.0] },
      },
      pose: { xyz: [0, 3.0, 0.5], rpy: [0, 0, 0] },
      static: true,
    },
    {
      id: createId(),
      name: 'crate_alpha',
      source: {
        type: 'primitive',
        shape: { kind: 'box', size: [0.6, 0.6, 0.6] },
        material: { name: 'crate_amber', rgba: [0.76, 0.52, 0.22, 1.0] },
      },
      pose: { xyz: [1.8, -0.8, 0.3], rpy: [0, 0, 0.4] },
      static: false,
      mass: 8.0,
    },
  ];

  return {
    version: 1,
    name: 'scout_rover_pkg',
    target,
    robot: {
      name: 'scout_rover',
      links: [baseLink, fl.link, fr.link, rl.link, rr.link, lidarLink],
      joints,
      sensors,
      plugins,
      rootLinkId: baseId,
    },
    world,
    customParts: [
      buildChassisWithAxlesPart({
        name: 'dual_axle_chassis',
        chassisSize: [0.5, 0.3, 0.1],
        wheelbase: 0.34,
        trackWidth: 0.42,
        axleCount: 2,
        axleRadius: 0.018,
      }),
    ],
    assets: [],
    textures: [],
  };
}

/**
 * 2-Wheel + Caster Bot template.
 */
export function createTwoWheelCasterProject(target: TargetDistro = 'jazzy-harmonic'): Project {
  const baseId = createId();
  const lwMountId = createId();
  const rwMountId = createId();
  const casterMountId = createId();
  const lidarMountId = createId();

  const baseLink: Link = {
    id: baseId,
    name: 'base_link',
    visual: {
      geometry: { type: 'primitive', shape: { kind: 'cylinder', radius: 0.18, length: 0.09 } },
      pose: createZeroPose(),
      material: { name: 'turtle_teal', rgba: [0.16, 0.48, 0.52, 1.0] },
    },
    collision: { sameAsVisual: true },
    inertial: { mass: 3.2, pose: createZeroPose(), auto: true },
    mounts: [
      { id: lwMountId, name: 'left_wheel_mount', pose: { xyz: [0, 0.19, -0.02], rpy: [0, 0, 0] } },
      {
        id: rwMountId,
        name: 'right_wheel_mount',
        pose: { xyz: [0, -0.19, -0.02], rpy: [0, 0, 0] },
      },
      {
        id: casterMountId,
        name: 'caster_mount',
        pose: { xyz: [-0.13, 0, -0.045], rpy: [0, 0, 0] },
      },
      { id: lidarMountId, name: 'lidar_mount', pose: { xyz: [0.02, 0, 0.065], rpy: [0, 0, 0] } },
    ],
  };

  const makeWheel = (name: string) => {
    const hubId = createId();
    return {
      hubId,
      link: {
        id: createId(),
        name,
        visual: {
          geometry: {
            type: 'primitive' as const,
            shape: { kind: 'cylinder' as const, radius: 0.055, length: 0.03 },
          },
          pose: {
            xyz: [0, 0, 0] as [number, number, number],
            rpy: [Math.PI / 2, 0, 0] as [number, number, number],
          },
          material: {
            name: 'wheel_dark',
            rgba: [0.14, 0.15, 0.18, 1.0] as [number, number, number, number],
          },
        },
        collision: { sameAsVisual: true as const },
        inertial: { mass: 0.35, pose: createZeroPose(), auto: true },
        mounts: [{ id: hubId, name: 'hub_mount', pose: createZeroPose() }],
      },
    };
  };

  const lw = makeWheel('left_wheel_link');
  const rw = makeWheel('right_wheel_link');
  const casterMount = createId();
  const casterLink: Link = {
    id: createId(),
    name: 'caster_link',
    visual: {
      geometry: { type: 'primitive', shape: { kind: 'sphere', radius: 0.03 } },
      pose: createZeroPose(),
      material: { name: 'steel_caster', rgba: [0.7, 0.74, 0.78, 1.0] },
    },
    collision: { sameAsVisual: true },
    inertial: { mass: 0.15, pose: createZeroPose(), auto: true },
    mounts: [{ id: casterMount, name: 'socket_mount', pose: createZeroPose() }],
  };

  const joints: Joint[] = [
    {
      id: createId(),
      name: 'left_wheel_joint',
      type: 'continuous',
      parent: { linkId: baseId, mountId: lwMountId },
      child: { linkId: lw.link.id, mountId: lw.hubId },
      axis: [0, 1, 0],
    },
    {
      id: createId(),
      name: 'right_wheel_joint',
      type: 'continuous',
      parent: { linkId: baseId, mountId: rwMountId },
      child: { linkId: rw.link.id, mountId: rw.hubId },
      axis: [0, 1, 0],
    },
    {
      id: createId(),
      name: 'caster_joint',
      type: 'fixed',
      parent: { linkId: baseId, mountId: casterMountId },
      child: { linkId: casterLink.id, mountId: casterMount },
      axis: [0, 0, 1],
    },
  ];

  const sensors: Sensor[] = [
    {
      id: createId(),
      name: 'top_lidar',
      kind: 'lidar2d',
      linkId: baseId,
      mountId: lidarMountId,
      topic: '/scan',
      updateRate: 10,
      samples: 360,
      minAngle: -3.14159,
      maxAngle: 3.14159,
      minRange: 0.1,
      maxRange: 10,
      visualize: true,
    },
  ];

  const plugins: Plugin[] = [
    {
      id: createId(),
      name: 'diff_drive_controller',
      kind: 'diff_drive',
      leftJointIds: [joints[0]!.id],
      rightJointIds: [joints[1]!.id],
      wheelSeparation: 0.38,
      wheelRadius: 0.055,
      odomTopic: '/odom',
      cmdVelTopic: '/cmd_vel',
    },
  ];

  return {
    version: 1,
    name: 'turtle_bot_pkg',
    target,
    robot: {
      name: 'turtle_bot',
      links: [baseLink, lw.link, rw.link, casterLink],
      joints,
      sensors,
      plugins,
      rootLinkId: baseId,
    },
    world: createDefaultWorld(),
    customParts: [],
    assets: [],
    textures: [],
  };
}
