import { computeElevationStats, DEFAULT_MAP_BACKGROUND } from '@/core/mapTiles';
import type { Primitive, Project, TextureAsset } from '@/core/schema';
import {
  computeTreeInertial,
  getPineTierVisualRadius,
  getTreeParts,
} from '@/core/treeGeometry';
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
      const pts =
        shape.points.length >= 3
          ? shape.points
          : [
              [-0.5, -0.5],
              [0.5, -0.5],
              [0.5, 0.5],
              [-0.5, 0.5],
            ];
      const pointTags = pts.map((p) => `<point>${fmt(p[0])} ${fmt(p[1])}</point>`).join('');
      return `<polyline>${pointTags}<height>${fmt(Math.max(0.05, shape.depth))}</height></polyline>`;
    }
  }
}

function renderPbrAlbedoXml(
  pkgName: string,
  textures: TextureAsset[],
  textureId?: string,
  indent = '            ',
): string[] {
  if (!textureId) return [];
  const tex = textures.find((t) => t.id === textureId);
  if (!tex) return [];
  return [
    `${indent}<pbr><metal><albedo_map>model://${escapeXml(pkgName)}/materials/textures/${escapeXml(tex.name)}.${tex.format}</albedo_map></metal></pbr>`,
  ];
}

export function generateWorldSdf(project: Project, target: TargetConfig): string {
  const { world, textures = [], name: pkgName } = project;
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

  // Spherical coordinates (origin for GPS/NavSat + map tile background)
  if (world.mapBackground?.enabled) {
    lines.push(``);
    lines.push(
      `    <!-- Map tile background: ${escapeXml(world.mapBackground.tileUrl)} (zoom=${world.mapBackground.zoom}) -->`,
    );
    lines.push(`    <spherical_coordinates>`);
    lines.push(`      <surface_model>EARTH_WGS84</surface_model>`);
    lines.push(`      <world_frame_orientation>ENU</world_frame_orientation>`);
    lines.push(`      <latitude_deg>${world.mapBackground.latitude.toFixed(7)}</latitude_deg>`);
    lines.push(`      <longitude_deg>${world.mapBackground.longitude.toFixed(7)}</longitude_deg>`);
    lines.push(`      <elevation>${fmt(world.mapBackground.elevation, 3)}</elevation>`);
    lines.push(`      <heading_deg>${fmt(world.mapBackground.headingDeg, 3)}</heading_deg>`);
    lines.push(`    </spherical_coordinates>`);
  }

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

  // Ground plane (or DEM heightmap if elevation relief is active)
  if (world.ground.enabled) {
    const mapBg = world.mapBackground;
    const landSize = Math.max(
      10,
      mapBg?.enabled ? (mapBg.landSizeMeters ?? DEFAULT_MAP_BACKGROUND.landSizeMeters) : 10,
    );
    const gx = mapBg?.enabled ? Math.max(world.ground.size[0], landSize) : world.ground.size[0];
    const gy = mapBg?.enabled ? Math.max(world.ground.size[1], landSize) : world.ground.size[1];
    const elevStats = computeElevationStats(mapBg);
    const useHeightmap =
      Boolean(mapBg?.enabled) &&
      elevStats.hasRelief &&
      (mapBg?.elevationGridSize ?? 0) >= 2;
    const groundPbr = renderPbrAlbedoXml(pkgName, textures, world.ground.textureId, '            ');
    const demUri = `model://${escapeXml(pkgName)}/materials/textures/${escapeXml(world.name)}_dem.png`;

    lines.push(``);
    lines.push(`    <model name="ground_plane">`);
    lines.push(`      <static>true</static>`);
    lines.push(`      <link name="link">`);
    lines.push(`        <collision name="collision">`);
    if (useHeightmap) {
      lines.push(
        `          <geometry><heightmap><uri>${demUri}</uri><size>${fmt(landSize)} ${fmt(landSize)} ${fmt(elevStats.rangeZ)}</size><pos>0 0 ${fmt(elevStats.minZ)}</pos></heightmap></geometry>`,
      );
    } else {
      lines.push(
        `          <geometry><plane><normal>0 0 1</normal><size>${fmt(gx)} ${fmt(gy)}</size></plane></geometry>`,
      );
    }
    lines.push(
      `          <surface><friction><ode><mu>${fmt(world.ground.friction)}</mu><mu2>${fmt(world.ground.friction)}</mu2></ode></friction></surface>`,
    );
    lines.push(`        </collision>`);
    lines.push(`        <visual name="visual">`);
    if (useHeightmap) {
      lines.push(
        `          <geometry><heightmap><uri>${demUri}</uri><size>${fmt(landSize)} ${fmt(landSize)} ${fmt(elevStats.rangeZ)}</size><pos>0 0 ${fmt(elevStats.minZ)}</pos></heightmap></geometry>`,
      );
    } else {
      lines.push(
        `          <geometry><plane><normal>0 0 1</normal><size>${fmt(gx)} ${fmt(gy)}</size></plane></geometry>`,
      );
    }
    if (groundPbr.length > 0) {
      lines.push(`          <material>`);
      lines.push(`            <ambient>1 1 1 1</ambient><diffuse>1 1 1 1</diffuse>`);
      lines.push(...groundPbr);
      lines.push(`          </material>`);
    } else {
      lines.push(
        `          <material><ambient>0.25 0.28 0.32 1</ambient><diffuse>0.32 0.36 0.41 1</diffuse></material>`,
      );
    }
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

    if (obj.source.type === 'tree') {
      const treeSrc = obj.source;
      const parts = getTreeParts(treeSrc);
      lines.push(`    <model name="${escapeXml(obj.name)}">`);
      lines.push(`      <static>${obj.static ? 'true' : 'false'}</static>`);
      lines.push(`      <pose>${fmtPoseSdf(obj.pose)}</pose>`);
      lines.push(`      <link name="link">`);
      if (!obj.static) {
        const inertial = computeTreeInertial(treeSrc, obj.mass ?? 35);
        lines.push(`        <inertial>`);
        lines.push(`          <pose>${fmtVec3(inertial.com)} 0 0 0</pose>`);
        lines.push(`          <mass>${fmt(inertial.mass)}</mass>`);
        lines.push(
          `          <inertia><ixx>${fmt(inertial.inertia.ixx, 6)}</ixx><ixy>0</ixy><ixz>0</ixz><iyy>${fmt(inertial.inertia.iyy, 6)}</iyy><iyz>0</iyz><izz>${fmt(inertial.inertia.izz, 6)}</izz></inertia>`,
        );
        lines.push(`        </inertial>`);
      }
      parts.forEach((part, idx) => {
        const rgba = part.rgba.map((c) => fmt(c, 3)).join(' ');
        const colGeom = renderWorldPrimitive(part.physicsShape);
        let visGeom = colGeom;
        if (part.visualKind === 'cone' && part.physicsShape.kind === 'cylinder') {
          const tierIdx = idx - 1;
          const coneR = getPineTierVisualRadius(treeSrc, Math.max(0, tierIdx));
          visGeom = `<cone><radius>${fmt(coneR)}</radius><length>${fmt(part.physicsShape.length)}</length></cone>`;
        }
        lines.push(`        <collision name="col_${escapeXml(part.id)}">`);
        lines.push(`          <pose>${fmtPoseSdf(part.pose)}</pose>`);
        lines.push(`          <geometry>${colGeom}</geometry>`);
        lines.push(`        </collision>`);
        lines.push(`        <visual name="vis_${escapeXml(part.id)}">`);
        lines.push(`          <pose>${fmtPoseSdf(part.pose)}</pose>`);
        lines.push(`          <geometry>${visGeom}</geometry>`);
        lines.push(
          `          <material><ambient>${rgba}</ambient><diffuse>${rgba}</diffuse></material>`,
        );
        lines.push(`        </visual>`);
      });
      lines.push(`      </link>`);
      lines.push(`    </model>`);
      continue;
    }

    const geomXml = renderWorldPrimitive(obj.source.shape);
    const rgba = obj.source.material.rgba.map((c) => fmt(c, 3)).join(' ');
    const objPbr = renderPbrAlbedoXml(
      pkgName,
      textures,
      obj.source.material.textureId,
      '            ',
    );
    const polyOffsetLine =
      obj.source.shape.kind === 'extrude'
        ? `          <pose>0 0 ${fmt(-obj.source.shape.depth / 2)} 0 0 0</pose>`
        : null;
    lines.push(`    <model name="${escapeXml(obj.name)}">`);
    lines.push(`      <static>${obj.static ? 'true' : 'false'}</static>`);
    lines.push(`      <pose>${fmtPoseSdf(obj.pose)}</pose>`);
    lines.push(`      <link name="link">`);
    if (!obj.static) {
      const m = obj.mass ?? 5.0;
      lines.push(`        <inertial><mass>${fmt(m)}</mass></inertial>`);
    }
    lines.push(`        <collision name="collision">`);
    if (polyOffsetLine) lines.push(polyOffsetLine);
    lines.push(`          <geometry>${geomXml}</geometry>`);
    lines.push(`        </collision>`);
    lines.push(`        <visual name="visual">`);
    if (polyOffsetLine) lines.push(polyOffsetLine);
    lines.push(`          <geometry>${geomXml}</geometry>`);
    if (objPbr.length > 0) {
      lines.push(`          <material>`);
      lines.push(`            <ambient>${rgba}</ambient><diffuse>${rgba}</diffuse>`);
      lines.push(...objPbr);
      lines.push(`          </material>`);
    } else {
      lines.push(
        `          <material><ambient>${rgba}</ambient><diffuse>${rgba}</diffuse></material>`,
      );
    }
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
