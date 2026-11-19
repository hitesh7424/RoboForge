import { computeGeometryInertia, resolveLinkInertia } from '@/core/inertia';
import { computeElevationStats, getMapLandSize } from '@/core/mapTiles';
import type { Asset, Geometry, Link, Pose, Primitive, Project, Vec3 } from '@/core/schema';
import { computeTreeInertial, getTreeParts } from '@/core/treeGeometry';
import {
  composePoses,
  computePureJointOriginPose,
  escapeXml,
  fmt,
  fmtVec3,
  rpyToQuatWxyz,
} from '@/exporters/xmlUtils';

export interface MujocoExportOptions {
  includeWorldObjects?: boolean;
  embedMeshPathsPrefix?: string;
}

function fmtQuat(rpy: Vec3): string {
  const [w, x, y, z] = rpyToQuatWxyz(rpy);
  return `${fmt(w, 6)} ${fmt(x, 6)} ${fmt(y, 6)} ${fmt(z, 6)}`;
}

function renderMujocoPrimitiveAttrs(shape: Primitive): { type: string; size: string } {
  switch (shape.kind) {
    case 'box':
      return {
        type: 'box',
        size: `${fmt(Math.max(0.002, shape.size[0] / 2))} ${fmt(Math.max(0.002, shape.size[1] / 2))} ${fmt(Math.max(0.002, shape.size[2] / 2))}`,
      };
    case 'cylinder':
      return {
        type: 'cylinder',
        size: `${fmt(Math.max(0.002, shape.radius))} ${fmt(Math.max(0.002, shape.length / 2))}`,
      };
    case 'capsule':
      return {
        type: 'capsule',
        size: `${fmt(Math.max(0.002, shape.radius))} ${fmt(Math.max(0.002, shape.length / 2))}`,
      };
    case 'sphere':
      return {
        type: 'sphere',
        size: `${fmt(Math.max(0.002, shape.radius))}`,
      };
    case 'extrude': {
      const xs = shape.points.map((p) => p[0]);
      const ys = shape.points.map((p) => p[1]);
      const hx = Math.max(0.005, (Math.max(...xs) - Math.min(...xs)) / 2);
      const hy = Math.max(0.005, (Math.max(...ys) - Math.min(...ys)) / 2);
      const hz = Math.max(0.002, shape.depth / 2);
      return {
        type: 'box',
        size: `${fmt(hx)} ${fmt(hy)} ${fmt(hz)}`,
      };
    }
  }
}

function renderMujocoGeoms(
  geomNamePrefix: string,
  geometry: Geometry,
  basePose: Pose,
  rgbaStr: string,
  assets: Asset[],
  indent: string,
  isVisualOnly: boolean,
  isCollisionOnly: boolean,
): string[] {
  const lines: string[] = [];
  const collFlags = isVisualOnly
    ? ` contype="0" conaffinity="0" group="1"`
    : isCollisionOnly
      ? ` contype="1" conaffinity="1" group="3"`
      : ` contype="1" conaffinity="1"`;

  if (geometry.type === 'primitive') {
    const { type, size } = renderMujocoPrimitiveAttrs(geometry.shape);
    let geomPose = basePose;
    if (geometry.shape.kind === 'extrude' && geometry.shape.points.length > 0) {
      const xs = geometry.shape.points.map((p) => p[0]);
      const ys = geometry.shape.points.map((p) => p[1]);
      const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (Math.abs(midX) > 1e-6 || Math.abs(midY) > 1e-6) {
        geomPose = composePoses(basePose, { xyz: [midX, midY, 0], rpy: [0, 0, 0] });
      }
    }
    lines.push(
      `${indent}<geom name="${escapeXml(geomNamePrefix)}" type="${type}" pos="${fmtVec3(geomPose.xyz)}" quat="${fmtQuat(geomPose.rpy)}" size="${size}" rgba="${rgbaStr}"${collFlags}/>`,
    );
    return lines;
  }

  if (geometry.type === 'compound') {
    const addParts = geometry.parts.filter((p) => p.op !== 'subtract');
    if (addParts.length === 0) {
      lines.push(
        `${indent}<geom name="${escapeXml(geomNamePrefix)}" type="box" pos="${fmtVec3(basePose.xyz)}" quat="${fmtQuat(basePose.rpy)}" size="0.05 0.05 0.05" rgba="${rgbaStr}"${collFlags}/>`,
      );
      return lines;
    }
    addParts.forEach((part, idx) => {
      const combined = composePoses(basePose, part.pose);
      const { type, size } = renderMujocoPrimitiveAttrs(part.shape);
      lines.push(
        `${indent}<geom name="${escapeXml(geomNamePrefix)}_${idx}" type="${type}" pos="${fmtVec3(combined.xyz)}" quat="${fmtQuat(combined.rpy)}" size="${size}" rgba="${rgbaStr}"${collFlags}/>`,
      );
    });
    return lines;
  }

  // Mesh asset: MuJoCo supports STL meshes directly; GLB/DAE fall back to bounding box geom
  const asset = assets.find((a) => a.id === geometry.assetId);
  if (asset && asset.format === 'stl') {
    const meshId = `mesh_${asset.name}_${asset.id.slice(0, 6)}`;
    lines.push(
      `${indent}<geom name="${escapeXml(geomNamePrefix)}" type="mesh" mesh="${escapeXml(meshId)}" pos="${fmtVec3(basePose.xyz)}" quat="${fmtQuat(basePose.rpy)}" rgba="${rgbaStr}"${collFlags}/>`,
    );
  } else {
    const sx = Math.max(0.02, 0.14 * geometry.scale[0]);
    const sy = Math.max(0.02, 0.14 * geometry.scale[1]);
    const sz = Math.max(0.02, 0.14 * geometry.scale[2]);
    lines.push(
      `${indent}<geom name="${escapeXml(geomNamePrefix)}" type="box" pos="${fmtVec3(basePose.xyz)}" quat="${fmtQuat(basePose.rpy)}" size="${fmt(sx)} ${fmt(sy)} ${fmt(sz)}" rgba="${rgbaStr}"${collFlags}/>`,
    );
  }
  return lines;
}

export function getMujocoStlMeshId(asset: Asset): string {
  return `mesh_${asset.name}_${asset.id.slice(0, 6)}`;
}

export function generateMujocoXml(project: Project, options: MujocoExportOptions = {}): string {
  const { includeWorldObjects = true, embedMeshPathsPrefix = '' } = options;
  const { robot, world, assets } = project;
  const linkMap = new Map(robot.links.map((l) => [l.id, l]));

  const childrenByParent = new Map<string, { jointId: string; childId: string }[]>();
  for (const joint of robot.joints) {
    const list = childrenByParent.get(joint.parent.linkId) ?? [];
    list.push({ jointId: joint.id, childId: joint.child.linkId });
    childrenByParent.set(joint.parent.linkId, list);
  }

  const jointMap = new Map(robot.joints.map((j) => [j.id, j]));
  const rootLink = linkMap.get(robot.rootLinkId) ?? robot.links[0];

  const lines: string[] = [
    `<mujoco model="${escapeXml(robot.name)}">`,
    `  <compiler angle="radian" autolimits="true"/>`,
    `  <option timestep="${fmt(world.physics.stepSize, 6)}" gravity="${fmtVec3(world.physics.gravity)}"/>`,
    ``,
    `  <default>`,
    `    <geom friction="0.9 0.02 0.005" condim="3" margin="0.001"/>`,
    `    <joint armature="0.01" damping="0.1"/>`,
    `  </default>`,
    ``,
    `  <asset>`,
    `    <texture name="grid_tex" type="2d" builtin="checker" rgb1="0.11 0.14 0.20" rgb2="0.16 0.20 0.28" width="512" height="512"/>`,
    `    <material name="grid_mat" texture="grid_tex" texrepeat="12 12" reflectance="0.08"/>`,
  ];

  // Emit STL mesh assets used by any link
  const emittedMeshes = new Set<string>();
  for (const link of robot.links) {
    const geoms: Geometry[] = [link.visual.geometry];
    if (!('sameAsVisual' in link.collision)) {
      geoms.push(link.collision.geometry);
    }
    for (const g of geoms) {
      if (g.type === 'mesh') {
        const asset = assets.find((a) => a.id === g.assetId);
        if (asset && asset.format === 'stl') {
          const meshId = getMujocoStlMeshId(asset);
          if (!emittedMeshes.has(meshId)) {
            emittedMeshes.add(meshId);
            const fileRef = `${embedMeshPathsPrefix}${asset.name}.stl`;
            lines.push(
              `    <mesh name="${escapeXml(meshId)}" file="${escapeXml(fileRef)}" scale="${fmtVec3(g.scale)}"/>`,
            );
          }
        }
      }
    }
  }

  const mapBg = world.mapBackground;
  const elevStats = computeElevationStats(mapBg);
  const useTerrainHfield =
    world.ground.enabled &&
    Boolean(mapBg?.enabled) &&
    elevStats.hasRelief &&
    (mapBg?.elevationGridSize ?? 0) >= 2;
  const landDims = getMapLandSize(mapBg, world.ground.size);
  const halfLandX = landDims.width / 2;
  const halfLandY = landDims.height / 2;

  if (useTerrainHfield && mapBg?.elevationGridSize) {
    const n = mapBg.elevationGridSize;
    lines.push(
      `    <hfield name="world_terrain" nrow="${n}" ncol="${n}" size="${fmt(halfLandX)} ${fmt(halfLandY)} ${fmt(Math.max(0.02, elevStats.rangeZ))} 0.5"/>`,
    );
  }

  lines.push(`  </asset>`);
  lines.push(``);
  lines.push(`  <worldbody>`);
  lines.push(`    <light pos="2 -2 5" dir="-0.3 0.3 -1" diffuse="0.95 0.95 0.92" directional="true"/>`);

  if (world.ground.enabled) {
    if (useTerrainHfield) {
      lines.push(
        `    <geom name="ground_plane" type="hfield" hfield="world_terrain" pos="0 0 ${fmt(elevStats.minZ)}" material="grid_mat" friction="${fmt(world.ground.friction)} 0.005 0.0001"/>`,
      );
    } else {
      const gx = Math.max(5, halfLandX);
      const gy = Math.max(5, halfLandY);
      lines.push(
        `    <geom name="ground_plane" type="plane" size="${fmt(gx)} ${fmt(gy)} 0.1" material="grid_mat" friction="${fmt(world.ground.friction)} 0.005 0.0001"/>`,
      );
    }
  }

  if (includeWorldObjects) {
    for (const obj of world.objects) {
      if (obj.source.type === 'tree') {
        const parts = getTreeParts(obj.source);
        if (obj.static) {
          for (const part of parts) {
            const { type, size } = renderMujocoPrimitiveAttrs(part.physicsShape);
            const rgbaStr = part.rgba.map((c) => fmt(c, 3)).join(' ');
            const worldPartPose = composePoses(obj.pose, part.pose);
            lines.push(
              `    <geom name="world_${escapeXml(obj.name)}_${escapeXml(part.id)}" type="${type}" pos="${fmtVec3(worldPartPose.xyz)}" quat="${fmtQuat(worldPartPose.rpy)}" size="${size}" rgba="${rgbaStr}"/>`,
            );
          }
        } else {
          const inertial = computeTreeInertial(obj.source, obj.mass ?? 35);
          lines.push(
            `    <body name="world_${escapeXml(obj.name)}" pos="${fmtVec3(obj.pose.xyz)}" quat="${fmtQuat(obj.pose.rpy)}">`,
          );
          lines.push(`      <freejoint name="world_free_${escapeXml(obj.name)}"/>`);
          lines.push(
            `      <inertial pos="${fmtVec3(inertial.com)}" mass="${fmt(inertial.mass)}" diaginertia="${fmt(inertial.inertia.ixx, 6)} ${fmt(inertial.inertia.iyy, 6)} ${fmt(inertial.inertia.izz, 6)}"/>`,
          );
          for (const part of parts) {
            const { type, size } = renderMujocoPrimitiveAttrs(part.physicsShape);
            const rgbaStr = part.rgba.map((c) => fmt(c, 3)).join(' ');
            lines.push(
              `      <geom name="world_geom_${escapeXml(obj.name)}_${escapeXml(part.id)}" type="${type}" pos="${fmtVec3(part.pose.xyz)}" quat="${fmtQuat(part.pose.rpy)}" size="${size}" rgba="${rgbaStr}"/>`,
            );
          }
          lines.push(`    </body>`);
        }
        continue;
      }

      if (obj.source.type !== 'primitive') continue;
      const { type, size } = renderMujocoPrimitiveAttrs(obj.source.shape);
      const rgbaStr = obj.source.material.rgba.map((c) => fmt(c, 3)).join(' ');
      let geomOffset: [number, number, number] = [0, 0, 0];
      if (obj.source.shape.kind === 'extrude' && obj.source.shape.points.length > 0) {
        const xs = obj.source.shape.points.map((p) => p[0]);
        const ys = obj.source.shape.points.map((p) => p[1]);
        geomOffset = [
          (Math.min(...xs) + Math.max(...xs)) / 2,
          (Math.min(...ys) + Math.max(...ys)) / 2,
          0,
        ];
      }
      if (obj.static) {
        const staticPose =
          geomOffset[0] !== 0 || geomOffset[1] !== 0
            ? composePoses(obj.pose, { xyz: geomOffset, rpy: [0, 0, 0] })
            : obj.pose;
        lines.push(
          `    <geom name="world_${escapeXml(obj.name)}" type="${type}" pos="${fmtVec3(staticPose.xyz)}" quat="${fmtQuat(staticPose.rpy)}" size="${size}" rgba="${rgbaStr}"/>`,
        );
      } else {
        const mass = obj.mass ?? 5.0;
        const { inertia } = computeGeometryInertia({ type: 'primitive', shape: obj.source.shape }, mass);
        lines.push(
          `    <body name="world_${escapeXml(obj.name)}" pos="${fmtVec3(obj.pose.xyz)}" quat="${fmtQuat(obj.pose.rpy)}">`,
        );
        lines.push(`      <freejoint name="world_free_${escapeXml(obj.name)}"/>`);
        lines.push(
          `      <inertial pos="${fmtVec3(geomOffset)}" mass="${fmt(mass)}" diaginertia="${fmt(inertia.ixx, 6)} ${fmt(inertia.iyy, 6)} ${fmt(inertia.izz, 6)}"/>`,
        );
        lines.push(
          `      <geom name="world_geom_${escapeXml(obj.name)}" type="${type}" pos="${fmtVec3(geomOffset)}" size="${size}" rgba="${rgbaStr}"/>`,
        );
        lines.push(`    </body>`);
      }
    }
  }

  const visited = new Set<string>();

  const emitBody = (link: Link, relPose: Pose, indent: string, incomingJointId?: string) => {
    if (visited.has(link.id)) return;
    visited.add(link.id);

    lines.push(
      `${indent}<body name="${escapeXml(link.name)}" pos="${fmtVec3(relPose.xyz)}" quat="${fmtQuat(relPose.rpy)}">`,
    );

    if (!incomingJointId) {
      lines.push(`${indent}  <freejoint name="${escapeXml(link.name)}_free"/>`);
    } else {
      const joint = jointMap.get(incomingJointId);
      if (joint && joint.type !== 'fixed') {
        const damping = joint.dynamics?.damping ?? 0.1;
        const frictionloss = joint.dynamics?.friction ?? 0.05;
        if (joint.type === 'continuous') {
          lines.push(
            `${indent}  <joint name="${escapeXml(joint.name)}" type="hinge" axis="${fmtVec3(joint.axis)}" limited="false" damping="${fmt(damping)}" frictionloss="${fmt(frictionloss)}"/>`,
          );
        } else if (joint.type === 'revolute') {
          const lower = joint.limits?.lower ?? -1.5708;
          const upper = joint.limits?.upper ?? 1.5708;
          lines.push(
            `${indent}  <joint name="${escapeXml(joint.name)}" type="hinge" axis="${fmtVec3(joint.axis)}" limited="true" range="${fmt(lower)} ${fmt(upper)}" damping="${fmt(damping)}" frictionloss="${fmt(frictionloss)}"/>`,
          );
        } else if (joint.type === 'prismatic') {
          const lower = joint.limits?.lower ?? -0.25;
          const upper = joint.limits?.upper ?? 0.25;
          lines.push(
            `${indent}  <joint name="${escapeXml(joint.name)}" type="slide" axis="${fmtVec3(joint.axis)}" limited="true" range="${fmt(lower)} ${fmt(upper)}" damping="${fmt(damping)}" frictionloss="${fmt(frictionloss)}"/>`,
          );
        }
      }
    }

    // Inertial
    const res = resolveLinkInertia(link);
    const com = link.inertial.auto ? res.centerOfMass : link.inertial.pose.xyz;
    const i = res.inertia;
    const hasOffDiag =
      Math.abs(i.ixy) > 1e-9 || Math.abs(i.ixz) > 1e-9 || Math.abs(i.iyz) > 1e-9;
    const inertiaAttr = hasOffDiag
      ? `fullinertia="${fmt(i.ixx, 8)} ${fmt(i.iyy, 8)} ${fmt(i.izz, 8)} ${fmt(i.ixy, 8)} ${fmt(i.ixz, 8)} ${fmt(i.iyz, 8)}"`
      : `diaginertia="${fmt(i.ixx, 8)} ${fmt(i.iyy, 8)} ${fmt(i.izz, 8)}"`;
    lines.push(
      `${indent}  <inertial pos="${fmtVec3(com)}" quat="${fmtQuat(link.inertial.pose.rpy)}" mass="${fmt(link.inertial.mass)}" ${inertiaAttr}/>`,
    );

    const rgbaStr = link.visual.material.rgba.map((c) => fmt(c, 3)).join(' ');
    const sameCol = 'sameAsVisual' in link.collision;
    lines.push(
      ...renderMujocoGeoms(
        `${link.name}_vis`,
        link.visual.geometry,
        link.visual.pose,
        rgbaStr,
        assets,
        `${indent}  `,
        !sameCol,
        false,
      ),
    );
    if (!sameCol && 'geometry' in link.collision) {
      lines.push(
        ...renderMujocoGeoms(
          `${link.name}_col`,
          link.collision.geometry,
          link.collision.pose,
          '0.2 0.85 0.55 0.3',
          assets,
          `${indent}  `,
          false,
          true,
        ),
      );
    }

    const children = childrenByParent.get(link.id) ?? [];
    for (const childRef of children) {
      const childLink = linkMap.get(childRef.childId);
      const joint = jointMap.get(childRef.jointId);
      if (!childLink || !joint) continue;
      const originPose = computePureJointOriginPose(
        link,
        joint.parent.mountId,
        childLink,
        joint.child.mountId,
      );
      emitBody(childLink, originPose, `${indent}  `, joint.id);
    }

    lines.push(`${indent}</body>`);
  };

  if (rootLink) {
    emitBody(rootLink, world.robotSpawnPose, '    ');
  }

  lines.push(`  </worldbody>`);

  // Prevent adjacent parent-child self collisions in MuJoCo
  if (robot.joints.length > 0) {
    lines.push(``);
    lines.push(`  <contact>`);
    for (const joint of robot.joints) {
      const pLink = linkMap.get(joint.parent.linkId);
      const cLink = linkMap.get(joint.child.linkId);
      if (pLink && cLink) {
        lines.push(
          `    <exclude body1="${escapeXml(pLink.name)}" body2="${escapeXml(cLink.name)}"/>`,
        );
      }
    }
    lines.push(`  </contact>`);
  }

  // Actuators for movable joints
  const movableJoints = robot.joints.filter((j) => j.type !== 'fixed');
  if (movableJoints.length > 0) {
    lines.push(``);
    lines.push(`  <actuator>`);
    for (const joint of movableJoints) {
      if (joint.type === 'continuous') {
        lines.push(
          `    <velocity name="act_${escapeXml(joint.name)}" joint="${escapeXml(joint.name)}" kv="10" ctrllimited="true" ctrlrange="-25 25"/>`,
        );
      } else if (joint.type === 'revolute') {
        const lower = joint.limits?.lower ?? -1.5708;
        const upper = joint.limits?.upper ?? 1.5708;
        lines.push(
          `    <position name="act_${escapeXml(joint.name)}" joint="${escapeXml(joint.name)}" kp="45" kv="4" ctrllimited="true" ctrlrange="${fmt(lower)} ${fmt(upper)}"/>`,
        );
      } else if (joint.type === 'prismatic') {
        const lower = joint.limits?.lower ?? -0.25;
        const upper = joint.limits?.upper ?? 0.25;
        lines.push(
          `    <position name="act_${escapeXml(joint.name)}" joint="${escapeXml(joint.name)}" kp="90" kv="8" ctrllimited="true" ctrlrange="${fmt(lower)} ${fmt(upper)}"/>`,
        );
      }
    }
    lines.push(`  </actuator>`);
  }

  lines.push(`</mujoco>`);
  return lines.join('\n') + '\n';
}
