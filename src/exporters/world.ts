import { computeGeometryInertia } from '@/core/inertia';
import { getMapLandSize, sampleElevationAt } from '@/core/mapTiles';
import type { Primitive, Project, TextureAsset } from '@/core/schema';
import { shouldUseTerrainMesh } from '@/core/terrainMesh';
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
    `${indent}<pbr><metal><albedo_map>model://${escapeXml(pkgName)}/materials/textures/${escapeXml(tex.name)}.${tex.format}</albedo_map><roughness>0.9</roughness><metalness>0</metalness></metal></pbr>`,
  ];
}

export function generateWorldSdf(project: Project, target: TargetConfig): string {
  const { world, textures = [], name: pkgName } = project;
  const sys = target.worldSystems;
  const updateRate = Math.max(
    1,
    Math.round(world.physics.realTimeFactor / Math.max(0.0001, world.physics.stepSize)),
  );

  const lines: string[] = [
    `<?xml version="1.0"?>`,
    `<sdf version="${target.sdfVersion}">`,
    `  <world name="${escapeXml(world.name)}">`,
    `    <physics name="default_physics" type="ignored">`,
    `      <max_step_size>${fmt(world.physics.stepSize)}</max_step_size>`,
    `      <real_time_factor>${fmt(world.physics.realTimeFactor)}</real_time_factor>`,
    `      <real_time_update_rate>${fmt(updateRate)}</real_time_update_rate>`,
    `    </physics>`,
    `    <gravity>${fmtVec3(world.physics.gravity)}</gravity>`,
    `    <magnetic_field>6e-06 2.3e-05 -4.2e-05</magnetic_field>`,
    `    <atmosphere type="adiabatic"/>`,
    ``,
    `    <plugin filename="${sys.physics.filename}" name="${sys.physics.name}"/>`,
    `    <plugin filename="${sys.userCommands.filename}" name="${sys.userCommands.name}"/>`,
    `    <plugin filename="${sys.sceneBroadcaster.filename}" name="${sys.sceneBroadcaster.name}"/>`,
    `    <plugin filename="${sys.contact.filename}" name="${sys.contact.name}"/>`,
    `    <plugin filename="${sys.sensors.filename}" name="${sys.sensors.name}">`,
    `      <render_engine>${target.sensorRenderEngine}</render_engine>`,
    `    </plugin>`,
    `    <plugin filename="${sys.imu.filename}" name="${sys.imu.name}"/>`,
    `    <plugin filename="${sys.airPressure.filename}" name="${sys.airPressure.name}"/>`,
    `    <plugin filename="${sys.magnetometer.filename}" name="${sys.magnetometer.name}"/>`,
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

  // Ground plane (or exact triangulated DEM terrain mesh when elevation relief is active)
  if (world.ground.enabled) {
    const mapBg = world.mapBackground;
    const landDims = getMapLandSize(mapBg, world.ground.size);
    const gx = mapBg?.enabled ? Math.max(world.ground.size[0], landDims.width) : world.ground.size[0];
    const gy = mapBg?.enabled ? Math.max(world.ground.size[1], landDims.height) : world.ground.size[1];
    const useTerrainMesh = shouldUseTerrainMesh(mapBg);
    const customGroundTex = world.ground.textureId
      ? textures.find((t) => t.id === world.ground.textureId)
      : undefined;
    const hasCosmeticMap = Boolean(
      (world.surfaceZones ?? []).some((z) => z.visible) || world.cosmetics?.groundBasePresetId,
    );
    const mapTileTexUri =
      mapBg?.enabled || hasCosmeticMap
        ? `model://${escapeXml(pkgName)}/materials/textures/${escapeXml(world.name)}_map.png`
        : undefined;
    const activeGroundTexUri = hasCosmeticMap
      ? mapTileTexUri
      : customGroundTex
        ? `model://${escapeXml(pkgName)}/materials/textures/${escapeXml(customGroundTex.name)}.${customGroundTex.format}`
        : mapTileTexUri;
    const terrainMeshUri = `model://${escapeXml(pkgName)}/meshes/${escapeXml(world.name)}_terrain.obj`;
    // Keep map-tile plane 1:1 true-to-scale with cropped rectangular land dimensions when flat
    const visGx = (!customGroundTex || hasCosmeticMap) && mapBg?.enabled ? landDims.width : gx;
    const visGy = (!customGroundTex || hasCosmeticMap) && mapBg?.enabled ? landDims.height : gy;

    lines.push(``);
    lines.push(`    <model name="ground_plane">`);
    lines.push(`      <static>true</static>`);
    lines.push(`      <link name="link">`);
    lines.push(`        <collision name="collision">`);
    if (useTerrainMesh) {
      lines.push(
        `          <geometry><mesh><uri>${terrainMeshUri}</uri><scale>1 1 1</scale></mesh></geometry>`,
      );
    } else {
      lines.push(
        `          <geometry><plane><normal>0 0 1</normal><size>${fmt(gx)} ${fmt(gy)}</size></plane></geometry>`,
      );
    }
    lines.push(`          <surface>`);
    lines.push(
      `            <friction><ode><mu>${fmt(world.ground.friction)}</mu><mu2>${fmt(world.ground.friction)}</mu2></ode></friction>`,
    );
    lines.push(`            <bounce><restitution_coefficient>0</restitution_coefficient></bounce>`);
    lines.push(`          </surface>`);
    lines.push(`        </collision>`);
    lines.push(`        <visual name="visual">`);
    if (useTerrainMesh) {
      lines.push(
        `          <geometry><mesh><uri>${terrainMeshUri}</uri><scale>1 1 1</scale></mesh></geometry>`,
      );
    } else {
      lines.push(
        `          <geometry><plane><normal>0 0 1</normal><size>${fmt(visGx)} ${fmt(visGy)}</size></plane></geometry>`,
      );
    }
    if (activeGroundTexUri) {
      lines.push(`          <material>`);
      lines.push(`            <ambient>1 1 1 1</ambient><diffuse>1 1 1 1</diffuse>`);
      lines.push(
        `            <pbr><metal><albedo_map>${activeGroundTexUri}</albedo_map><roughness>0.95</roughness><metalness>0</metalness></metal></pbr>`,
      );
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
      const { inertia } = computeGeometryInertia(
        { type: 'primitive', shape: obj.source.shape },
        m,
      );
      lines.push(`        <inertial>`);
      lines.push(`          <mass>${fmt(m)}</mass>`);
      lines.push(
        `          <inertia><ixx>${fmt(inertia.ixx, 6)}</ixx><ixy>0</ixy><ixz>0</ixz><iyy>${fmt(inertia.iyy, 6)}</iyy><iyz>0</iyz><izz>${fmt(inertia.izz, 6)}</izz></inertia>`,
      );
      lines.push(`        </inertial>`);
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

  const terrainZ = sampleElevationAt(
    world.mapBackground,
    world.robotSpawnPose.xyz[0],
    world.robotSpawnPose.xyz[1],
  );
  const safeSpawn = {
    xyz: [
      world.robotSpawnPose.xyz[0],
      world.robotSpawnPose.xyz[1],
      Math.max(world.robotSpawnPose.xyz[2], terrainZ + 0.15),
    ] as [number, number, number],
    rpy: world.robotSpawnPose.rpy,
  };

  lines.push(``);
  lines.push(
    `    <!-- Robot "${escapeXml(project.robot.name)}" spawned at ${fmtPoseSdf(safeSpawn)} via sim.launch.py -->`,
  );
  lines.push(`  </world>`);
  lines.push(`</sdf>`);
  return lines.join('\n') + '\n';
}
