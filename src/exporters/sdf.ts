import { resolveLinkInertia } from '@/core/inertia';
import type { Asset, Geometry, Joint, Link, Pose, Primitive, Project } from '@/core/schema';
import type { TargetConfig } from '@/exporters/targets/types';
import {
  composePoses,
  computePureJointOriginPose,
  escapeXml,
  fmt,
  fmtPoseSdf,
  fmtVec3,
} from '@/exporters/xmlUtils';

function renderSdfPrimitiveXml(shape: Primitive, indent: string): string {
  switch (shape.kind) {
    case 'box':
      return `${indent}<box><size>${fmtVec3(shape.size)}</size></box>`;
    case 'cylinder':
      return `${indent}<cylinder><radius>${fmt(shape.radius)}</radius><length>${fmt(shape.length)}</length></cylinder>`;
    case 'sphere':
      return `${indent}<sphere><radius>${fmt(shape.radius)}</radius></sphere>`;
    case 'capsule':
      return `${indent}<capsule><radius>${fmt(shape.radius)}</radius><length>${fmt(shape.length)}</length></capsule>`;
    case 'extrude': {
      const xs = shape.points.map((p) => p[0]);
      const ys = shape.points.map((p) => p[1]);
      const dx = Math.max(0.01, Math.max(...xs) - Math.min(...xs));
      const dy = Math.max(0.01, Math.max(...ys) - Math.min(...ys));
      return `${indent}<box><size>${fmt(dx)} ${fmt(dy)} ${fmt(shape.depth)}</size></box>`;
    }
  }
}

function renderSdfGeometryElements(
  tag: 'visual' | 'collision',
  baseName: string,
  geometry: Geometry,
  basePose: Pose,
  pkgName: string,
  assets: Asset[],
  rgba?: [number, number, number, number],
): string {
  const matBlock =
    tag === 'visual' && rgba
      ? [
          `        <material>`,
          `          <ambient>${rgba.map((c) => fmt(c, 3)).join(' ')}</ambient>`,
          `          <diffuse>${rgba.map((c) => fmt(c, 3)).join(' ')}</diffuse>`,
          `        </material>`,
        ].join('\n')
      : '';

  if (geometry.type === 'primitive') {
    return [
      `      <${tag} name="${escapeXml(baseName)}_${tag}">`,
      `        <pose>${fmtPoseSdf(basePose)}</pose>`,
      `        <geometry>`,
      renderSdfPrimitiveXml(geometry.shape, '          '),
      `        </geometry>`,
      ...(matBlock ? [matBlock] : []),
      `      </${tag}>`,
    ].join('\n');
  }

  if (geometry.type === 'compound') {
    const addParts = geometry.parts.filter((p) => p.op !== 'subtract');
    if (addParts.length === 0) {
      return [
        `      <${tag} name="${escapeXml(baseName)}_${tag}">`,
        `        <pose>${fmtPoseSdf(basePose)}</pose>`,
        `        <geometry><box><size>0.1 0.1 0.1</size></box></geometry>`,
        ...(matBlock ? [matBlock] : []),
        `      </${tag}>`,
      ].join('\n');
    }
    return addParts
      .map((part, idx) => {
        const combined = composePoses(basePose, part.pose);
        return [
          `      <${tag} name="${escapeXml(baseName)}_${tag}_${idx}">`,
          `        <pose>${fmtPoseSdf(combined)}</pose>`,
          `        <geometry>`,
          renderSdfPrimitiveXml(part.shape, '          '),
          `        </geometry>`,
          ...(matBlock ? [matBlock] : []),
          `      </${tag}>`,
        ].join('\n');
      })
      .join('\n');
  }

  const asset = assets.find((a) => a.id === geometry.assetId);
  const meshUri = asset
    ? `model://${escapeXml(pkgName)}/meshes/${escapeXml(asset.name)}.${asset.format}`
    : `model://${escapeXml(pkgName)}/meshes/missing.stl`;

  return [
    `      <${tag} name="${escapeXml(baseName)}_${tag}">`,
    `        <pose>${fmtPoseSdf(basePose)}</pose>`,
    `        <geometry>`,
    `          <mesh><uri>${meshUri}</uri><scale>${fmtVec3(geometry.scale)}</scale></mesh>`,
    `        </geometry>`,
    ...(matBlock ? [matBlock] : []),
    `      </${tag}>`,
  ].join('\n');
}

function computeSdfLinkPoses(
  links: Link[],
  joints: Joint[],
  rootLinkId: string,
): Map<string, Pose> {
  const poses = new Map<string, Pose>();
  const linkMap = new Map(links.map((l) => [l.id, l]));
  const root = linkMap.get(rootLinkId) ?? links[0];
  if (!root) return poses;

  const zero: Pose = { xyz: [0, 0, 0], rpy: [0, 0, 0] };
  poses.set(root.id, zero);

  const outgoing = new Map<string, Joint[]>();
  for (const joint of joints) {
    const arr = outgoing.get(joint.parent.linkId) ?? [];
    arr.push(joint);
    outgoing.set(joint.parent.linkId, arr);
  }

  const queue = [root.id];
  const visited = new Set([root.id]);
  while (queue.length > 0) {
    const currId = queue.shift()!;
    const pLink = linkMap.get(currId);
    const pPose = poses.get(currId);
    if (!pLink || !pPose) continue;
    for (const joint of outgoing.get(currId) ?? []) {
      if (visited.has(joint.child.linkId)) continue;
      const cLink = linkMap.get(joint.child.linkId);
      if (!cLink) continue;
      const rel = computePureJointOriginPose(
        pLink,
        joint.parent.mountId,
        cLink,
        joint.child.mountId,
      );
      poses.set(cLink.id, composePoses(pPose, rel));
      visited.add(cLink.id);
      queue.push(cLink.id);
    }
  }

  for (const link of links) {
    if (!poses.has(link.id)) {
      poses.set(link.id, zero);
    }
  }
  return poses;
}

export function generateRobotSdf(project: Project, target: TargetConfig): string {
  const { robot, name: pkgName, assets } = project;
  const linkMap = new Map(robot.links.map((l) => [l.id, l]));
  const jointMap = new Map(robot.joints.map((j) => [j.id, j]));
  const linkPoses = computeSdfLinkPoses(robot.links, robot.joints, robot.rootLinkId);

  const lines: string[] = [
    `<?xml version="1.0"?>`,
    `<sdf version="${target.sdfVersion}">`,
    `  <model name="${escapeXml(robot.name)}">`,
    `    <static>false</static>`,
  ];

  for (const link of robot.links) {
    const linkPose = linkPoses.get(link.id) ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] };
    const inertiaRes = resolveLinkInertia(link);
    const i = inertiaRes.inertia;
    const com: [number, number, number] = link.inertial.auto
      ? inertiaRes.centerOfMass
      : link.inertial.pose.xyz;
    const collisionGeom =
      'sameAsVisual' in link.collision ? link.visual.geometry : link.collision.geometry;
    const collisionPose = 'sameAsVisual' in link.collision ? link.visual.pose : link.collision.pose;

    lines.push(``);
    lines.push(`    <link name="${escapeXml(link.name)}">`);
    lines.push(`      <pose>${fmtPoseSdf(linkPose)}</pose>`);
    lines.push(`      <inertial>`);
    lines.push(`        <pose>${fmtVec3(com)} ${fmtVec3(link.inertial.pose.rpy)}</pose>`);
    lines.push(`        <mass>${fmt(link.inertial.mass)}</mass>`);
    lines.push(`        <inertia>`);
    lines.push(
      `          <ixx>${fmt(i.ixx, 8)}</ixx><ixy>${fmt(i.ixy, 8)}</ixy><ixz>${fmt(i.ixz, 8)}</ixz>`,
    );
    lines.push(
      `          <iyy>${fmt(i.iyy, 8)}</iyy><iyz>${fmt(i.iyz, 8)}</iyz><izz>${fmt(i.izz, 8)}</izz>`,
    );
    lines.push(`        </inertia>`);
    lines.push(`      </inertial>`);

    lines.push(
      renderSdfGeometryElements(
        'collision',
        link.name,
        collisionGeom,
        collisionPose,
        pkgName,
        assets,
      ),
    );
    lines.push(
      renderSdfGeometryElements(
        'visual',
        link.name,
        link.visual.geometry,
        link.visual.pose,
        pkgName,
        assets,
        link.visual.material.rgba,
      ),
    );

    // Sensors on this link
    for (const sensor of robot.sensors.filter((s) => s.linkId === link.id)) {
      const mount = link.mounts.find((m) => m.id === sensor.mountId);
      const sPose = mount?.pose ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] };
      const gzType =
        sensor.kind === 'lidar2d' || sensor.kind === 'lidar3d'
          ? 'gpu_lidar'
          : sensor.kind === 'gps'
            ? 'navsat'
            : sensor.kind;
      lines.push(`      <sensor name="${escapeXml(sensor.name)}" type="${gzType}">`);
      lines.push(`        <pose>${fmtPoseSdf(sPose)}</pose>`);
      lines.push(`        <topic>${escapeXml(sensor.topic)}</topic>`);
      lines.push(`        <update_rate>${fmt(sensor.updateRate)}</update_rate>`);
      lines.push(`      </sensor>`);
    }

    lines.push(`    </link>`);
  }

  for (const joint of robot.joints) {
    const pLink = linkMap.get(joint.parent.linkId);
    const cLink = linkMap.get(joint.child.linkId);
    if (!pLink || !cLink) continue;

    const sdfJointType =
      joint.type === 'continuous' ? 'revolute' : joint.type === 'fixed' ? 'fixed' : joint.type;

    lines.push(``);
    lines.push(`    <joint name="${escapeXml(joint.name)}" type="${sdfJointType}">`);
    lines.push(`      <parent>${escapeXml(pLink.name)}</parent>`);
    lines.push(`      <child>${escapeXml(cLink.name)}</child>`);
    if (joint.type !== 'fixed') {
      lines.push(`      <axis>`);
      lines.push(`        <xyz>${fmtVec3(joint.axis)}</xyz>`);
      if (joint.type === 'revolute' || joint.type === 'prismatic') {
        lines.push(`        <limit>`);
        lines.push(`          <lower>${fmt(joint.limits?.lower ?? -1.57)}</lower>`);
        lines.push(`          <upper>${fmt(joint.limits?.upper ?? 1.57)}</upper>`);
        lines.push(`          <effort>${fmt(joint.limits?.effort ?? 10)}</effort>`);
        lines.push(`          <velocity>${fmt(joint.limits?.velocity ?? 2)}</velocity>`);
        lines.push(`        </limit>`);
      }
      if (joint.dynamics) {
        lines.push(`        <dynamics>`);
        lines.push(`          <damping>${fmt(joint.dynamics.damping)}</damping>`);
        lines.push(`          <friction>${fmt(joint.dynamics.friction)}</friction>`);
        lines.push(`        </dynamics>`);
      }
      lines.push(`      </axis>`);
    }
    lines.push(`    </joint>`);
  }

  for (const plugin of robot.plugins) {
    if (plugin.kind === 'diff_drive') {
      const spec = target.robotPlugins.diffDrive;
      const rootName = linkMap.get(robot.rootLinkId)?.name ?? 'base_link';
      lines.push(``);
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
      lines.push(`      <topic>${escapeXml(plugin.cmdVelTopic)}</topic>`);
      lines.push(`      <odom_topic>${escapeXml(plugin.odomTopic)}</odom_topic>`);
      lines.push(`      <frame_id>odom</frame_id>`);
      lines.push(`      <child_frame_id>${escapeXml(rootName)}</child_frame_id>`);
      lines.push(`    </plugin>`);
    } else if (plugin.kind === 'joint_state_publisher') {
      const spec = target.robotPlugins.jointStatePublisher;
      lines.push(``);
      lines.push(`    <plugin filename="${spec.filename}" name="${spec.name}">`);
      lines.push(`      <topic>${escapeXml(plugin.topic)}</topic>`);
      lines.push(`    </plugin>`);
    }
  }

  lines.push(`  </model>`);
  lines.push(`</sdf>`);
  return lines.join('\n') + '\n';
}
