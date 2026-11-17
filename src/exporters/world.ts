import type { Primitive, Project } from '@/core/schema';
import type { TargetConfig } from '@/exporters/targets/types';
import { escapeXml, fmt, fmtPoseSdf, fmtVec3 } from '@/exporters/xmlUtils';

function renderWorldPrimitive(shape: Primitive): string {
  switch (shape.kind) {
    case 'box':
      return `<box><size>${fmtVec3(shape.size)}</size></box>`;
    case 'cylinder':
      return `<cylinder><radius>${fmt(shape.radius)}</radius><length>${fmt(shape.length)}</length></cylinder>`;
    case 'sphere':
      return `<sphere><radius>${fmt(shape.radius)}</radius></sphere>`;
    case 'capsule':
      return `<capsule><radius>${fmt(shape.radius)}</radius><length>${fmt(shape.length)}</length></capsule>`;
    case 'extrude': {
      const xs = shape.points.map((p) => p[0]);
      const ys = shape.points.map((p) => p[1]);
      const dx = Math.max(0.01, Math.max(...xs) - Math.min(...xs));
      const dy = Math.max(0.01, Math.max(...ys) - Math.min(...ys));
      return `<box><size>${fmt(dx)} ${fmt(dy)} ${fmt(shape.depth)}</size></box>`;
    }
  }
}

export function generateWorldSdf(project: Project, target: TargetConfig): string {
  const { world } = project;
  const sys = target.worldSystems;

  const lines: string[] = [
    `<?xml version="1.0"?>`,
    `<sdf version="${target.sdfVersion}">`,
    `  <world name="${escapeXml(world.name)}">`,
    `    <physics name="default_physics" type="ode">`,
    `      <max_step_size>${fmt(world.physics.stepSize)}</max_step_size>`,
    `      <real_time_factor>${fmt(world.physics.realTimeFactor)}</real_time_factor>`,
    `    </physics>`,
    `    <gravity>${fmtVec3(world.physics.gravity)}</gravity>`,
    ``,
    `    <plugin filename="${sys.physics.filename}" name="${sys.physics.name}"/>`,
    `    <plugin filename="${sys.userCommands.filename}" name="${sys.userCommands.name}"/>`,
    `    <plugin filename="${sys.sceneBroadcaster.filename}" name="${sys.sceneBroadcaster.name}"/>`,
    `    <plugin filename="${sys.sensors.filename}" name="${sys.sensors.name}">`,
    `      <render_engine>${target.sensorRenderEngine}</render_engine>`,
    `    </plugin>`,
    `    <plugin filename="${sys.imu.filename}" name="${sys.imu.name}"/>`,
    `    <plugin filename="${sys.navsat.filename}" name="${sys.navsat.name}"/>`,
  ];

  // Lights
  for (const light of world.lights) {
    lines.push(``);
    lines.push(`    <light type="${light.type}" name="${escapeXml(light.name)}">`);
    lines.push(`      <cast_shadows>${light.castShadows ? 'true' : 'false'}</cast_shadows>`);
    lines.push(`      <pose>${fmtPoseSdf(light.pose)}</pose>`);
    lines.push(`      <diffuse>${light.diffuse.map((c) => fmt(c, 3)).join(' ')} 1</diffuse>`);
    lines.push(`      <specular>0.3 0.3 0.3 1</specular>`);
    if (light.type === 'directional') {
      lines.push(`      <direction>-0.5 0.1 -0.9</direction>`);
    }
    lines.push(`      <intensity>${fmt(light.intensity)}</intensity>`);
    lines.push(`    </light>`);
  }

  // Ground plane
  if (world.ground.enabled) {
    const [gx, gy] = world.ground.size;
    lines.push(``);
    lines.push(`    <model name="ground_plane">`);
    lines.push(`      <static>true</static>`);
    lines.push(`      <link name="link">`);
    lines.push(`        <collision name="collision">`);
    lines.push(
      `          <geometry><plane><normal>0 0 1</normal><size>${fmt(gx)} ${fmt(gy)}</size></plane></geometry>`,
    );
    lines.push(
      `          <surface><friction><ode><mu>${fmt(world.ground.friction)}</mu><mu2>${fmt(world.ground.friction)}</mu2></ode></friction></surface>`,
    );
    lines.push(`        </collision>`);
    lines.push(`        <visual name="visual">`);
    lines.push(
      `          <geometry><plane><normal>0 0 1</normal><size>${fmt(gx)} ${fmt(gy)}</size></plane></geometry>`,
    );
    lines.push(
      `          <material><ambient>0.25 0.28 0.32 1</ambient><diffuse>0.32 0.36 0.41 1</diffuse></material>`,
    );
    lines.push(`        </visual>`);
    lines.push(`      </link>`);
    lines.push(`    </model>`);
  }

  // World objects
  for (const obj of world.objects) {
    lines.push(``);
    if (obj.source.type === 'model') {
      lines.push(`    <include>`);
      lines.push(`      <name>${escapeXml(obj.name)}</name>`);
      lines.push(`      <uri>${escapeXml(obj.source.uri)}</uri>`);
      lines.push(`      <pose>${fmtPoseSdf(obj.pose)}</pose>`);
      lines.push(`    </include>`);
      continue;
    }

    const geomXml = renderWorldPrimitive(obj.source.shape);
    const rgba = obj.source.material.rgba.map((c) => fmt(c, 3)).join(' ');
    lines.push(`    <model name="${escapeXml(obj.name)}">`);
    lines.push(`      <static>${obj.static ? 'true' : 'false'}</static>`);
    lines.push(`      <pose>${fmtPoseSdf(obj.pose)}</pose>`);
    lines.push(`      <link name="link">`);
    if (!obj.static) {
      const m = obj.mass ?? 5.0;
      lines.push(`        <inertial><mass>${fmt(m)}</mass></inertial>`);
    }
    lines.push(`        <collision name="collision"><geometry>${geomXml}</geometry></collision>`);
    lines.push(`        <visual name="visual">`);
    lines.push(`          <geometry>${geomXml}</geometry>`);
    lines.push(
      `          <material><ambient>${rgba}</ambient><diffuse>${rgba}</diffuse></material>`,
    );
    lines.push(`        </visual>`);
    lines.push(`      </link>`);
    lines.push(`    </model>`);
  }

  lines.push(``);
  lines.push(
    `    <!-- Robot "${escapeXml(project.robot.name)}" spawned at ${fmtPoseSdf(world.robotSpawnPose)} via sim.launch.py -->`,
  );
  lines.push(`  </world>`);
  lines.push(`</sdf>`);
  return lines.join('\n') + '\n';
}
