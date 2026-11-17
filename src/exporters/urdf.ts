import { computeGeometryInertia, resolveLinkInertia } from '@/core/inertia';
import type { Asset, Geometry, Link, Pose, Primitive, Project } from '@/core/schema';
import type { TargetConfig } from '@/exporters/targets/types';
import {
  composePoses,
  computePureJointOriginPose,
  escapeXml,
  fmt,
  fmtPoseSdf,
  fmtVec3,
} from '@/exporters/xmlUtils';

function renderUrdfPrimitiveXml(
  shape: Primitive,
  indent: string,
  dimProps?: { x?: string; y?: string; z?: string; r?: string; l?: string },
): string {
  switch (shape.kind) {
    case 'box': {
      const sx = dimProps?.x ?? fmt(shape.size[0]);
      const sy = dimProps?.y ?? fmt(shape.size[1]);
      const sz = dimProps?.z ?? fmt(shape.size[2]);
      return `${indent}<box size="${sx} ${sy} ${sz}"/>`;
    }
    case 'cylinder': {
      const r = dimProps?.r ?? fmt(shape.radius);
      const l = dimProps?.l ?? fmt(shape.length);
      return `${indent}<cylinder radius="${r}" length="${l}"/>`;
    }
    case 'sphere': {
      const r = dimProps?.r ?? fmt(shape.radius);
      return `${indent}<sphere radius="${r}"/>`;
    }
    case 'capsule': {
      const r = dimProps?.r ?? fmt(shape.radius);
      const l = dimProps?.l ?? fmt(shape.length + shape.radius * 2);
      return `${indent}<!-- Capsule approximated as cylinder for URDF compatibility -->\n${indent}<cylinder radius="${r}" length="${l}"/>`;
    }
    case 'extrude': {
      const xs = shape.points.map((p) => p[0]);
      const ys = shape.points.map((p) => p[1]);
      const dx = Math.max(0.01, Math.max(...xs) - Math.min(...xs));
      const dy = Math.max(0.01, Math.max(...ys) - Math.min(...ys));
      return `${indent}<box size="${fmt(dx)} ${fmt(dy)} ${fmt(shape.depth)}"/>`;
    }
  }
}

function renderUrdfGeometryBlocks(
  tag: 'visual' | 'collision',
  geometry: Geometry,
  basePose: Pose,
  pkgName: string,
  assets: Asset[],
  materialBlock: string,
  linkPropPrefix?: string,
): string {
  if (geometry.type === 'primitive') {
    const p = geometry.shape;
    const dimProps = linkPropPrefix
      ? p.kind === 'box'
        ? {
            x: `\${${linkPropPrefix}_x}`,
            y: `\${${linkPropPrefix}_y}`,
            z: `\${${linkPropPrefix}_z}`,
          }
        : p.kind === 'sphere'
          ? { r: `\${${linkPropPrefix}_r}` }
          : p.kind === 'cylinder' || p.kind === 'capsule'
            ? { r: `\${${linkPropPrefix}_r}`, l: `\${${linkPropPrefix}_l}` }
            : undefined
      : undefined;

    return [
      `    <${tag}>`,
      `      <origin xyz="${fmtVec3(basePose.xyz)}" rpy="${fmtVec3(basePose.rpy)}"/>`,
      `      <geometry>`,
      renderUrdfPrimitiveXml(p, '        ', dimProps),
      `      </geometry>`,
      ...(tag === 'visual' && materialBlock ? [materialBlock] : []),
      `    </${tag}>`,
    ].join('\n');
  }

  if (geometry.type === 'compound') {
    const addParts = geometry.parts.filter((part) => part.op !== 'subtract');
    if (addParts.length === 0) {
      return [
        `    <${tag}>`,
        `      <origin xyz="${fmtVec3(basePose.xyz)}" rpy="${fmtVec3(basePose.rpy)}"/>`,
        `      <geometry><box size="0.1 0.1 0.1"/></geometry>`,
        ...(tag === 'visual' && materialBlock ? [materialBlock] : []),
        `    </${tag}>`,
      ].join('\n');
    }
    return addParts
      .map((part) => {
        const combined = composePoses(basePose, part.pose);
        return [
          `    <${tag}>`,
          `      <origin xyz="${fmtVec3(combined.xyz)}" rpy="${fmtVec3(combined.rpy)}"/>`,
          `      <geometry>`,
          renderUrdfPrimitiveXml(part.shape, '        '),
          `      </geometry>`,
          ...(tag === 'visual' && materialBlock ? [materialBlock] : []),
          `    </${tag}>`,
        ].join('\n');
      })
      .join('\n');
  }

  const asset = assets.find((a) => a.id === geometry.assetId);
  const meshUri = asset
    ? `package://${escapeXml(pkgName)}/meshes/${escapeXml(asset.name)}.${asset.format}`
    : `package://${escapeXml(pkgName)}/meshes/missing.stl`;

  return [
    `    <${tag}>`,
    `      <origin xyz="${fmtVec3(basePose.xyz)}" rpy="${fmtVec3(basePose.rpy)}"/>`,
    `      <geometry>`,
    `        <mesh filename="${meshUri}" scale="${fmtVec3(geometry.scale)}"/>`,
    `      </geometry>`,
    ...(tag === 'visual' && materialBlock ? [materialBlock] : []),
    `    </${tag}>`,
  ].join('\n');
}

function renderLinkInertial(link: Link, massPropExpr?: string): string {
  const res = resolveLinkInertia(link);
  const i = res.inertia;
  const com: [number, number, number] = link.inertial.auto
    ? res.centerOfMass
    : link.inertial.pose.xyz;

  return [
    `    <inertial>`,
    `      <origin xyz="${fmtVec3(com)}" rpy="${fmtVec3(link.inertial.pose.rpy)}"/>`,
    `      <mass value="${massPropExpr ?? fmt(link.inertial.mass)}"/>`,
    `      <inertia ixx="${fmt(i.ixx, 8)}" ixy="${fmt(i.ixy, 8)}" ixz="${fmt(i.ixz, 8)}" iyy="${fmt(i.iyy, 8)}" iyz="${fmt(i.iyz, 8)}" izz="${fmt(i.izz, 8)}"/>`,
    `    </inertial>`,
  ].join('\n');
}

function isRepeatedWheelLink(link: Link): boolean {
  return (
    link.name.includes('wheel') &&
    link.visual.geometry.type === 'primitive' &&
    link.visual.geometry.shape.kind === 'cylinder'
  );
}

export function generateRobotXacro(project: Project, target: TargetConfig): string {
  const { robot, name: pkgName, assets } = project;
  const linkMap = new Map(robot.links.map((l) => [l.id, l]));
  const wheelLinks = robot.links.filter(isRepeatedWheelLink);
  const useWheelMacro = wheelLinks.length >= 2;
  const wheelMacroIds = new Set(useWheelMacro ? wheelLinks.map((w) => w.id) : []);

  const lines: string[] = [
    `<?xml version="1.0"?>`,
    `<!-- Generated by RoboForge for ${target.label} -->`,
    `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="${escapeXml(robot.name)}">`,
    ``,
    `  <!-- Top-level editable robot parameters -->`,
  ];

  // Emit xacro:property for every link's dimensions & mass
  for (const link of robot.links) {
    lines.push(`  <xacro:property name="${link.name}_mass" value="${fmt(link.inertial.mass)}"/>`);
    if (link.visual.geometry.type === 'primitive') {
      const s = link.visual.geometry.shape;
      if (s.kind === 'box') {
        lines.push(`  <xacro:property name="${link.name}_x" value="${fmt(s.size[0])}"/>`);
        lines.push(`  <xacro:property name="${link.name}_y" value="${fmt(s.size[1])}"/>`);
        lines.push(`  <xacro:property name="${link.name}_z" value="${fmt(s.size[2])}"/>`);
      } else if (s.kind === 'sphere') {
        lines.push(`  <xacro:property name="${link.name}_r" value="${fmt(s.radius)}"/>`);
      } else if (s.kind === 'cylinder' || s.kind === 'capsule') {
        const lVal = s.kind === 'capsule' ? s.length + s.radius * 2 : s.length;
        lines.push(`  <xacro:property name="${link.name}_r" value="${fmt(s.radius)}"/>`);
        lines.push(`  <xacro:property name="${link.name}_l" value="${fmt(lVal)}"/>`);
      }
    }
  }

  for (const joint of robot.joints) {
    const pLink = linkMap.get(joint.parent.linkId);
    const cLink = linkMap.get(joint.child.linkId);
    if (!pLink || !cLink) continue;
    const origin = computePureJointOriginPose(
      pLink,
      joint.parent.mountId,
      cLink,
      joint.child.mountId,
    );
    lines.push(`  <xacro:property name="${joint.name}_xyz" value="${fmtVec3(origin.xyz)}"/>`);
    lines.push(`  <xacro:property name="${joint.name}_rpy" value="${fmtVec3(origin.rpy)}"/>`);
  }

  lines.push(``);
  lines.push(`  <!-- Include Gazebo sensors and control plugins -->`);
  lines.push(
    `  <xacro:include filename="$(find ${escapeXml(pkgName)})/urdf/${escapeXml(robot.name)}_gazebo.xacro"/>`,
  );

  // Materials
  const seenMaterials = new Map<string, string>();
  for (const link of robot.links) {
    const mat = link.visual.material;
    if (!seenMaterials.has(mat.name)) {
      seenMaterials.set(
        mat.name,
        `  <material name="${escapeXml(mat.name)}">\n    <color rgba="${mat.rgba.map((c) => fmt(c, 3)).join(' ')}"/>\n  </material>`,
      );
    }
  }
  if (seenMaterials.size > 0) {
    lines.push(``);
    lines.push(...seenMaterials.values());
  }

  // Reusable wheel macro if multiple wheels exist
  if (useWheelMacro) {
    lines.push(``);
    lines.push(`  <!-- Reusable wheel macro -->`);
    lines.push(
      `  <xacro:macro name="roboforge_wheel" params="name radius length mass material_name rpy_xyz:='0 0 0' rpy_rot:='1.570796 0 0'">`,
    );
    lines.push(`    <link name="\${name}">`);
    lines.push(`      <visual>`);
    lines.push(`        <origin xyz="\${rpy_xyz}" rpy="\${rpy_rot}"/>`);
    lines.push(`        <geometry><cylinder radius="\${radius}" length="\${length}"/></geometry>`);
    lines.push(`        <material name="\${material_name}"/>`);
    lines.push(`      </visual>`);
    lines.push(`      <collision>`);
    lines.push(`        <origin xyz="\${rpy_xyz}" rpy="\${rpy_rot}"/>`);
    lines.push(`        <geometry><cylinder radius="\${radius}" length="\${length}"/></geometry>`);
    lines.push(`      </collision>`);
    lines.push(`      <inertial>`);
    lines.push(`        <origin xyz="0 0 0" rpy="0 0 0"/>`);
    lines.push(`        <mass value="\${mass}"/>`);
    lines.push(
      `        <inertia ixx="\${(mass/12.0)*(3*radius*radius+length*length)}" ixy="0" ixz="0" iyy="\${(mass/12.0)*(3*radius*radius+length*length)}" iyz="0" izz="\${0.5*mass*radius*radius}"/>`,
    );
    lines.push(`      </inertial>`);
    lines.push(`    </link>`);
    lines.push(`  </xacro:macro>`);
  }

  // Links
  for (const link of robot.links) {
    lines.push(``);
    if (wheelMacroIds.has(link.id)) {
      lines.push(
        `  <xacro:roboforge_wheel name="${escapeXml(link.name)}" radius="\${${link.name}_r}" length="\${${link.name}_l}" mass="\${${link.name}_mass}" material_name="${escapeXml(link.visual.material.name)}" rpy_xyz="${fmtVec3(link.visual.pose.xyz)}" rpy_rot="${fmtVec3(link.visual.pose.rpy)}"/>`,
      );
      continue;
    }

    const materialRef = `      <material name="${escapeXml(link.visual.material.name)}"/>`;
    const isPrim = link.visual.geometry.type === 'primitive';
    const collisionGeom =
      'sameAsVisual' in link.collision ? link.visual.geometry : link.collision.geometry;
    const collisionPose = 'sameAsVisual' in link.collision ? link.visual.pose : link.collision.pose;

    lines.push(`  <link name="${escapeXml(link.name)}">`);
    lines.push(
      renderUrdfGeometryBlocks(
        'visual',
        link.visual.geometry,
        link.visual.pose,
        pkgName,
        assets,
        materialRef,
        isPrim ? link.name : undefined,
      ),
    );
    lines.push(
      renderUrdfGeometryBlocks(
        'collision',
        collisionGeom,
        collisionPose,
        pkgName,
        assets,
        '',
        'sameAsVisual' in link.collision && isPrim ? link.name : undefined,
      ),
    );
    lines.push(renderLinkInertial(link, `\${${link.name}_mass}`));
    lines.push(`  </link>`);
  }

  // Joints
  for (const joint of robot.joints) {
    const pLink = linkMap.get(joint.parent.linkId);
    const cLink = linkMap.get(joint.child.linkId);
    if (!pLink || !cLink) continue;

    lines.push(``);
    lines.push(`  <joint name="${escapeXml(joint.name)}" type="${joint.type}">`);
    lines.push(`    <parent link="${escapeXml(pLink.name)}"/>`);
    lines.push(`    <child link="${escapeXml(cLink.name)}"/>`);
    lines.push(`    <origin xyz="\${${joint.name}_xyz}" rpy="\${${joint.name}_rpy}"/>`);
    if (joint.type !== 'fixed') {
      lines.push(`    <axis xyz="${fmtVec3(joint.axis)}"/>`);
    }
    if ((joint.type === 'revolute' || joint.type === 'prismatic') && joint.limits) {
      lines.push(
        `    <limit lower="${fmt(joint.limits.lower)}" upper="${fmt(joint.limits.upper)}" effort="${fmt(joint.limits.effort)}" velocity="${fmt(joint.limits.velocity)}"/>`,
      );
    }
    if (joint.dynamics) {
      lines.push(
        `    <dynamics damping="${fmt(joint.dynamics.damping)}" friction="${fmt(joint.dynamics.friction)}"/>`,
      );
    }
    lines.push(`  </joint>`);
  }

  lines.push(``);
  lines.push(`</robot>`);
  return lines.join('\n') + '\n';
}

export function generateGazeboXacro(project: Project, target: TargetConfig): string {
  const { robot } = project;
  const linkMap = new Map(robot.links.map((l) => [l.id, l]));
  const jointMap = new Map(robot.joints.map((j) => [j.id, j]));

  const lines: string[] = [
    `<?xml version="1.0"?>`,
    `<!-- Gazebo plugins and sensors for ${target.label} -->`,
    `<robot xmlns:xacro="http://www.ros.org/wiki/xacro">`,
  ];

  // Sensors attached to host link mounts
  for (const sensor of robot.sensors) {
    const hostLink = linkMap.get(sensor.linkId);
    if (!hostLink) continue;
    const mount = hostLink.mounts.find((m) => m.id === sensor.mountId);
    const pose: Pose = mount?.pose ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] };

    lines.push(``);
    lines.push(`  <gazebo reference="${escapeXml(hostLink.name)}">`);
    if (sensor.kind === 'lidar2d') {
      lines.push(`    <sensor name="${escapeXml(sensor.name)}" type="gpu_lidar">`);
      lines.push(`      <pose>${fmtPoseSdf(pose)}</pose>`);
      lines.push(`      <topic>${escapeXml(sensor.topic)}</topic>`);
      lines.push(`      <update_rate>${fmt(sensor.updateRate)}</update_rate>`);
      lines.push(`      <visualize>${sensor.visualize ? 'true' : 'false'}</visualize>`);
      lines.push(`      <lidar>`);
      lines.push(`        <scan>`);
      lines.push(`          <horizontal>`);
      lines.push(`            <samples>${sensor.samples}</samples>`);
      lines.push(`            <resolution>1</resolution>`);
      lines.push(`            <min_angle>${fmt(sensor.minAngle)}</min_angle>`);
      lines.push(`            <max_angle>${fmt(sensor.maxAngle)}</max_angle>`);
      lines.push(`          </horizontal>`);
      lines.push(`        </scan>`);
      lines.push(`        <range>`);
      lines.push(`          <min>${fmt(sensor.minRange)}</min>`);
      lines.push(`          <max>${fmt(sensor.maxRange)}</max>`);
      lines.push(`          <resolution>0.01</resolution>`);
      lines.push(`        </range>`);
      lines.push(`      </lidar>`);
      lines.push(`    </sensor>`);
    } else if (sensor.kind === 'lidar3d') {
      lines.push(`    <sensor name="${escapeXml(sensor.name)}" type="gpu_lidar">`);
      lines.push(`      <pose>${fmtPoseSdf(pose)}</pose>`);
      lines.push(`      <topic>${escapeXml(sensor.topic)}</topic>`);
      lines.push(`      <update_rate>${fmt(sensor.updateRate)}</update_rate>`);
      lines.push(`      <visualize>${sensor.visualize ? 'true' : 'false'}</visualize>`);
      lines.push(`      <lidar>`);
      lines.push(`        <scan>`);
      lines.push(`          <horizontal>`);
      lines.push(`            <samples>${sensor.horizontalSamples}</samples>`);
      lines.push(`            <min_angle>-3.14159</min_angle>`);
      lines.push(`            <max_angle>3.14159</max_angle>`);
      lines.push(`          </horizontal>`);
      lines.push(`          <vertical>`);
      lines.push(`            <samples>${sensor.verticalSamples}</samples>`);
      lines.push(`            <min_angle>-0.2618</min_angle>`);
      lines.push(`            <max_angle>0.2618</max_angle>`);
      lines.push(`          </vertical>`);
      lines.push(`        </scan>`);
      lines.push(`        <range>`);
      lines.push(`          <min>${fmt(sensor.minRange)}</min>`);
      lines.push(`          <max>${fmt(sensor.maxRange)}</max>`);
      lines.push(`        </range>`);
      lines.push(`      </lidar>`);
      lines.push(`    </sensor>`);
    } else if (sensor.kind === 'camera' || sensor.kind === 'depth_camera') {
      const gzType = sensor.kind === 'depth_camera' ? 'depth_camera' : 'camera';
      lines.push(`    <sensor name="${escapeXml(sensor.name)}" type="${gzType}">`);
      lines.push(`      <pose>${fmtPoseSdf(pose)}</pose>`);
      lines.push(`      <topic>${escapeXml(sensor.topic)}</topic>`);
      lines.push(`      <update_rate>${fmt(sensor.updateRate)}</update_rate>`);
      lines.push(`      <camera>`);
      lines.push(`        <horizontal_fov>${fmt(sensor.horizontalFov)}</horizontal_fov>`);
      lines.push(`        <image>`);
      lines.push(`          <width>${sensor.width}</width>`);
      lines.push(`          <height>${sensor.height}</height>`);
      lines.push(
        `          <format>${sensor.kind === 'depth_camera' ? 'R_FLOAT32' : 'R8G8B8'}</format>`,
      );
      lines.push(`        </image>`);
      lines.push(`        <clip>`);
      lines.push(`          <near>${fmt(sensor.nearClip)}</near>`);
      lines.push(`          <far>${fmt(sensor.farClip)}</far>`);
      lines.push(`        </clip>`);
      lines.push(`      </camera>`);
      lines.push(`    </sensor>`);
    } else if (sensor.kind === 'imu') {
      lines.push(`    <sensor name="${escapeXml(sensor.name)}" type="imu">`);
      lines.push(`      <pose>${fmtPoseSdf(pose)}</pose>`);
      lines.push(`      <topic>${escapeXml(sensor.topic)}</topic>`);
      lines.push(`      <update_rate>${fmt(sensor.updateRate)}</update_rate>`);
      lines.push(`      <always_on>1</always_on>`);
      lines.push(`    </sensor>`);
    } else if (sensor.kind === 'gps') {
      lines.push(`    <sensor name="${escapeXml(sensor.name)}" type="navsat">`);
      lines.push(`      <pose>${fmtPoseSdf(pose)}</pose>`);
      lines.push(`      <topic>${escapeXml(sensor.topic)}</topic>`);
      lines.push(`      <update_rate>${fmt(sensor.updateRate)}</update_rate>`);
      lines.push(`      <always_on>1</always_on>`);
      lines.push(`    </sensor>`);
    }
    lines.push(`  </gazebo>`);
  }

  // Model-level plugins
  if (robot.plugins.length > 0) {
    lines.push(``);
    lines.push(`  <gazebo>`);
    for (const plugin of robot.plugins) {
      if (plugin.kind === 'diff_drive') {
        const spec = target.robotPlugins.diffDrive;
        const rootName = linkMap.get(robot.rootLinkId)?.name ?? 'base_link';
        lines.push(`    <plugin filename="${spec.filename}" name="${spec.name}">`);
        for (const jId of plugin.leftJointIds) {
          const j = jointMap.get(jId);
          if (j) lines.push(`      <left_joint>${escapeXml(j.name)}</left_joint>`);
        }
        for (const jId of plugin.rightJointIds) {
          const j = jointMap.get(jId);
          if (j) lines.push(`      <right_joint>${escapeXml(j.name)}</right_joint>`);
        }
        lines.push(`      <wheel_separation>${fmt(plugin.wheelSeparation)}</wheel_separation>`);
        lines.push(`      <wheel_radius>${fmt(plugin.wheelRadius)}</wheel_radius>`);
        lines.push(`      <odom_publish_frequency>50</odom_publish_frequency>`);
        lines.push(`      <topic>${escapeXml(plugin.cmdVelTopic)}</topic>`);
        lines.push(`      <odom_topic>${escapeXml(plugin.odomTopic)}</odom_topic>`);
        lines.push(`      <tf_topic>/tf</tf_topic>`);
        lines.push(`      <frame_id>odom</frame_id>`);
        lines.push(`      <child_frame_id>${escapeXml(rootName)}</child_frame_id>`);
        lines.push(`    </plugin>`);
      } else if (plugin.kind === 'ackermann') {
        const spec = target.robotPlugins.ackermann;
        lines.push(`    <plugin filename="${spec.filename}" name="${spec.name}">`);
        const ls = jointMap.get(plugin.leftSteerJointId);
        const rs = jointMap.get(plugin.rightSteerJointId);
        const lw = jointMap.get(plugin.leftWheelJointId);
        const rw = jointMap.get(plugin.rightWheelJointId);
        if (ls)
          lines.push(`      <left_steering_joint>${escapeXml(ls.name)}</left_steering_joint>`);
        if (rs)
          lines.push(`      <right_steering_joint>${escapeXml(rs.name)}</right_steering_joint>`);
        if (lw) lines.push(`      <left_joint>${escapeXml(lw.name)}</left_joint>`);
        if (rw) lines.push(`      <right_joint>${escapeXml(rw.name)}</right_joint>`);
        lines.push(`      <kingpin_width>${fmt(plugin.trackWidth)}</kingpin_width>`);
        lines.push(`      <wheel_base>${fmt(plugin.wheelbase)}</wheel_base>`);
        lines.push(`      <wheel_radius>${fmt(plugin.wheelRadius)}</wheel_radius>`);
        lines.push(`      <topic>${escapeXml(plugin.cmdVelTopic)}</topic>`);
        lines.push(`      <odom_topic>${escapeXml(plugin.odomTopic)}</odom_topic>`);
        lines.push(`    </plugin>`);
      } else if (plugin.kind === 'joint_state_publisher') {
        const spec = target.robotPlugins.jointStatePublisher;
        lines.push(`    <plugin filename="${spec.filename}" name="${spec.name}">`);
        lines.push(`      <topic>${escapeXml(plugin.topic)}</topic>`);
        lines.push(`    </plugin>`);
      } else if (plugin.kind === 'joint_controller') {
        const spec = target.robotPlugins.jointController;
        const j = jointMap.get(plugin.jointId);
        if (j) {
          lines.push(`    <plugin filename="${spec.filename}" name="${spec.name}">`);
          lines.push(`      <joint_name>${escapeXml(j.name)}</joint_name>`);
          lines.push(`      <topic>${escapeXml(plugin.topic)}</topic>`);
          lines.push(`      <p_gain>${fmt(plugin.pGain)}</p_gain>`);
          lines.push(`      <i_gain>${fmt(plugin.iGain)}</i_gain>`);
          lines.push(`      <d_gain>${fmt(plugin.dGain)}</d_gain>`);
          lines.push(`    </plugin>`);
        }
      }
    }
    lines.push(`  </gazebo>`);
  }

  lines.push(``);
  lines.push(`</robot>`);
  return lines.join('\n') + '\n';
}

/**
 * Generate flat resolved URDF XML (no xacro: properties or macros) for urdf-loader preview
 * and direct check_urdf validation.
 */
export function generateResolvedUrdf(project: Project): string {
  const { robot, name: pkgName, assets } = project;
  const linkMap = new Map(robot.links.map((l) => [l.id, l]));

  const lines: string[] = [`<?xml version="1.0"?>`, `<robot name="${escapeXml(robot.name)}">`];

  const seenMaterials = new Map<string, string>();
  for (const link of robot.links) {
    const mat = link.visual.material;
    if (!seenMaterials.has(mat.name)) {
      seenMaterials.set(
        mat.name,
        `  <material name="${escapeXml(mat.name)}">\n    <color rgba="${mat.rgba.map((c) => fmt(c, 3)).join(' ')}"/>\n  </material>`,
      );
    }
  }
  lines.push(...seenMaterials.values());

  for (const link of robot.links) {
    const materialRef = `      <material name="${escapeXml(link.visual.material.name)}"/>`;
    const collisionGeom =
      'sameAsVisual' in link.collision ? link.visual.geometry : link.collision.geometry;
    const collisionPose = 'sameAsVisual' in link.collision ? link.visual.pose : link.collision.pose;

    lines.push(`  <link name="${escapeXml(link.name)}">`);
    lines.push(
      renderUrdfGeometryBlocks(
        'visual',
        link.visual.geometry,
        link.visual.pose,
        pkgName,
        assets,
        materialRef,
      ),
    );
    lines.push(
      renderUrdfGeometryBlocks('collision', collisionGeom, collisionPose, pkgName, assets, ''),
    );
    lines.push(renderLinkInertial(link));
    lines.push(`  </link>`);
  }

  for (const joint of robot.joints) {
    const pLink = linkMap.get(joint.parent.linkId);
    const cLink = linkMap.get(joint.child.linkId);
    if (!pLink || !cLink) continue;
    const origin = computePureJointOriginPose(
      pLink,
      joint.parent.mountId,
      cLink,
      joint.child.mountId,
    );

    lines.push(`  <joint name="${escapeXml(joint.name)}" type="${joint.type}">`);
    lines.push(`    <parent link="${escapeXml(pLink.name)}"/>`);
    lines.push(`    <child link="${escapeXml(cLink.name)}"/>`);
    lines.push(`    <origin xyz="${fmtVec3(origin.xyz)}" rpy="${fmtVec3(origin.rpy)}"/>`);
    if (joint.type !== 'fixed') {
      lines.push(`    <axis xyz="${fmtVec3(joint.axis)}"/>`);
    }
    if ((joint.type === 'revolute' || joint.type === 'prismatic') && joint.limits) {
      lines.push(
        `    <limit lower="${fmt(joint.limits.lower)}" upper="${fmt(joint.limits.upper)}" effort="${fmt(joint.limits.effort)}" velocity="${fmt(joint.limits.velocity)}"/>`,
      );
    }
    if (joint.dynamics) {
      lines.push(
        `    <dynamics damping="${fmt(joint.dynamics.damping)}" friction="${fmt(joint.dynamics.friction)}"/>`,
      );
    }
    lines.push(`  </joint>`);
  }

  lines.push(`</robot>`);
  return lines.join('\n') + '\n';
}

export { computeGeometryInertia };
