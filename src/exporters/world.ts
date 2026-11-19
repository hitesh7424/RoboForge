import * as THREE from 'three';
import { poseToRosMatrix, rosMatrixToPose } from '@/core/coords';
import { computeGeometryInertia } from '@/core/inertia';
import { getMapLandSize } from '@/core/mapTiles';
import type { Pose, Primitive, Project, TextureAsset, WorldObject } from '@/core/schema';
import { sampleTerrainHeight } from '@/core/terrainGrounding';
import { shouldUseTerrainMesh } from '@/core/terrainMesh';
import { resolveWorldPerformance } from '@/core/treeBillboardAtlas';
import {
  computeTreeInertial,
  getPineTierVisualRadius,
  getTreeParts,
} from '@/core/treeGeometry';
import { getTreeTotalHeight } from '@/core/worldBatcher';
import type { TargetConfig } from '@/exporters/targets/types';
import { escapeXml, fmt, fmtPoseSdf, fmtVec3 } from '@/exporters/xmlUtils';

function composeWorldPose(parent: Pose, local: Pose): Pose {
  const m = new THREE.Matrix4().multiplyMatrices(poseToRosMatrix(parent), poseToRosMatrix(local));
  return rosMatrixToPose(m);
}

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

function sanitizeSdfName(raw: string, fallback: string, used: Set<string>): string {
  const base = raw.replace(/[^a-zA-Z0-9_]/g, '_') || fallback;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let idx = 1;
  while (used.has(`${base}_${idx}`)) idx++;
  const unique = `${base}_${idx}`;
  used.add(unique);
  return unique;
}

export function generateWorldSdf(project: Project, target: TargetConfig): string {
  const { world, textures = [], name: pkgName } = project;
  const perf = resolveWorldPerformance(world.performance);
  const sys = target.worldSystems;
  const updateRate = Math.max(
    1,
    Math.round(world.physics.realTimeFactor / Math.max(0.0001, world.physics.stepSize)),
  );

  const staticTrees = world.objects.filter(
    (o): o is WorldObject & { source: Extract<WorldObject['source'], { type: 'tree' }> } =>
      o.static && o.source.type === 'tree',
  );
  const staticPrims = world.objects.filter(
    (o): o is WorldObject & { source: Extract<WorldObject['source'], { type: 'primitive' }> } =>
      o.static && o.source.type === 'primitive',
  );
  const staticUntexturedPrims = staticPrims.filter((o) => !o.source.material.textureId);
  const staticTexturedPrims = staticPrims.filter((o) => Boolean(o.source.material.textureId));

  const combineTrees = perf.combineTreesWithGround && staticTrees.length > 0;
  const combinePrims = perf.combineStaticPropsWithGround && staticPrims.length > 0;
  const emitGroundHost = world.ground.enabled || combineTrees || combinePrims;

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

  // Unified static ground + combined trees & static scenery model (drastically reduces Gazebo ECS & Ogre2 draw calls)
  if (emitGroundHost) {
    const usedColNames = new Set<string>(['collision']);
    const usedVisNames = new Set<string>(['visual']);

    lines.push(``);
    lines.push(
      `    <!-- Unified static environment model (ground${combineTrees ? ` + ${staticTrees.length} merged trees` : ''}${combinePrims ? ` + ${staticPrims.length} static elements` : ''}) -->`,
    );
    lines.push(`    <model name="ground_plane">`);
    lines.push(`      <static>true</static>`);
    lines.push(`      <link name="link">`);

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
      const visGx = (!customGroundTex || hasCosmeticMap) && mapBg?.enabled ? landDims.width : gx;
      const visGy = (!customGroundTex || hasCosmeticMap) && mapBg?.enabled ? landDims.height : gy;

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
    }

    // Combined static trees: 1 single batched OBJ visual + optional lightweight trunk collisions
    if (combineTrees) {
      const treesMeshUri = `model://${escapeXml(pkgName)}/meshes/${escapeXml(world.name)}_trees.obj`;
      const treesTexUri =
        perf.treeRenderMode === 'cross_card'
          ? `model://${escapeXml(pkgName)}/materials/textures/${escapeXml(world.name)}_trees_atlas.png`
          : `model://${escapeXml(pkgName)}/materials/textures/${escapeXml(world.name)}_trees_palette.png`;

      lines.push(``);
      lines.push(
        `        <!-- ${staticTrees.length} static trees merged into 1 draw call (mode=${perf.treeRenderMode}, collision=${perf.treeCollision}) -->`,
      );
      lines.push(`        <visual name="merged_trees_visual">`);
      lines.push(`          <cast_shadows>${perf.disableSceneryShadows ? 'false' : 'true'}</cast_shadows>`);
      lines.push(`          <geometry><mesh><uri>${treesMeshUri}</uri><scale>1 1 1</scale></mesh></geometry>`);
      lines.push(`          <material>`);
      lines.push(`            <ambient>1 1 1 1</ambient><diffuse>1 1 1 1</diffuse>`);
      if (perf.treeRenderMode === 'cross_card') {
        lines.push(`            <double_sided>true</double_sided>`);
      }
      lines.push(
        `            <pbr><metal><albedo_map>${treesTexUri}</albedo_map><roughness>0.92</roughness><metalness>0</metalness></metal></pbr>`,
      );
      lines.push(`          </material>`);
      lines.push(`        </visual>`);

      if (perf.treeCollision !== 'none') {
        for (const tree of staticTrees) {
          const parts = getTreeParts(tree.source);
          const activeParts = perf.treeCollision === 'trunk_only' ? parts.slice(0, 1) : parts;
          for (const part of activeParts) {
            const colName = sanitizeSdfName(`col_${tree.name}_${part.id}`, 'tree_col', usedColNames);
            const worldPartPose = composeWorldPose(tree.pose, part.pose);
            lines.push(`        <collision name="${escapeXml(colName)}">`);
            lines.push(`          <pose>${fmtPoseSdf(worldPartPose)}</pose>`);
            lines.push(`          <geometry>${renderWorldPrimitive(part.physicsShape)}</geometry>`);
            lines.push(`        </collision>`);
          }
        }
      }
    }

    // Combined static primitives (walls, buildings, static props): batched OBJ visual + analytical primitive collisions
    if (combinePrims) {
      if (staticUntexturedPrims.length > 0) {
        const sceneryMeshUri = `model://${escapeXml(pkgName)}/meshes/${escapeXml(world.name)}_static_scenery.obj`;
        const sceneryPaletteUri = `model://${escapeXml(pkgName)}/materials/textures/${escapeXml(world.name)}_scenery_palette.png`;

        lines.push(``);
        lines.push(
          `        <!-- ${staticUntexturedPrims.length} static untextured elements merged into 1 draw call -->`,
        );
        lines.push(`        <visual name="merged_static_scenery_visual">`);
        lines.push(`          <cast_shadows>${perf.disableSceneryShadows ? 'false' : 'true'}</cast_shadows>`);
        lines.push(`          <geometry><mesh><uri>${sceneryMeshUri}</uri><scale>1 1 1</scale></mesh></geometry>`);
        lines.push(`          <material>`);
        lines.push(`            <ambient>1 1 1 1</ambient><diffuse>1 1 1 1</diffuse>`);
        lines.push(
          `            <pbr><metal><albedo_map>${sceneryPaletteUri}</albedo_map><roughness>0.88</roughness><metalness>0.05</metalness></metal></pbr>`,
        );
        lines.push(`          </material>`);
        lines.push(`        </visual>`);
      }

      // Textured static primitives stay inside ground_plane's single link so UVs & tiling stay exact
      for (const obj of staticTexturedPrims) {
        const visName = sanitizeSdfName(`vis_${obj.name}`, 'static_vis', usedVisNames);
        const geomXml = renderWorldPrimitive(obj.source.shape);
        const rgba = obj.source.material.rgba.map((c) => fmt(c, 3)).join(' ');
        const objPbr = renderPbrAlbedoXml(
          pkgName,
          textures,
          obj.source.material.textureId,
          '            ',
        );
        const visPose =
          obj.source.shape.kind === 'extrude'
            ? composeWorldPose(obj.pose, { xyz: [0, 0, -obj.source.shape.depth / 2], rpy: [0, 0, 0] })
            : obj.pose;

        lines.push(`        <visual name="${escapeXml(visName)}">`);
        lines.push(`          <cast_shadows>${perf.disableSceneryShadows ? 'false' : 'true'}</cast_shadows>`);
        lines.push(`          <pose>${fmtPoseSdf(visPose)}</pose>`);
        lines.push(`          <geometry>${geomXml}</geometry>`);
        lines.push(`          <material>`);
        lines.push(`            <ambient>${rgba}</ambient><diffuse>${rgba}</diffuse>`);
        lines.push(...objPbr);
        lines.push(`          </material>`);
        lines.push(`        </visual>`);
      }

      // Fast analytical primitive collisions for all combined static elements
      for (const obj of staticPrims) {
        const colName = sanitizeSdfName(`col_${obj.name}`, 'static_col', usedColNames);
        const colPose =
          obj.source.shape.kind === 'extrude'
            ? composeWorldPose(obj.pose, { xyz: [0, 0, -obj.source.shape.depth / 2], rpy: [0, 0, 0] })
            : obj.pose;
        lines.push(`        <collision name="${escapeXml(colName)}">`);
        lines.push(`          <pose>${fmtPoseSdf(colPose)}</pose>`);
        lines.push(`          <geometry>${renderWorldPrimitive(obj.source.shape)}</geometry>`);
        lines.push(`        </collision>`);
      }
    }

    lines.push(`      </link>`);
    lines.push(`    </model>`);
  }

  // Remaining non-combined world objects (dynamic bodies, external includes, or unmerged static objects)
  for (const obj of world.objects) {
    if (obj.source.type === 'model') {
      lines.push(``);
      lines.push(`    <include>`);
      lines.push(`      <name>${escapeXml(obj.name)}</name>`);
      lines.push(`      <uri>${escapeXml(obj.source.uri)}</uri>`);
      lines.push(`      <pose>${fmtPoseSdf(obj.pose)}</pose>`);
      lines.push(`    </include>`);
      continue;
    }

    if (obj.source.type === 'tree') {
      if (obj.static && combineTrees) continue;
      const treeSrc = obj.source;
      const parts = getTreeParts(treeSrc);
      const activeCollisionParts =
        !obj.static && perf.treeCollision === 'none'
          ? parts.slice(0, 1) // dynamic tree always retains trunk physics collision
          : perf.treeCollision === 'none'
            ? []
            : perf.treeCollision === 'trunk_only'
              ? parts.slice(0, 1)
              : parts;

      lines.push(``);
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

      for (const part of activeCollisionParts) {
        lines.push(`        <collision name="col_${escapeXml(part.id)}">`);
        lines.push(`          <pose>${fmtPoseSdf(part.pose)}</pose>`);
        lines.push(`          <geometry>${renderWorldPrimitive(part.physicsShape)}</geometry>`);
        lines.push(`        </collision>`);
      }

      if (perf.treeRenderMode === 'cross_card') {
        const totalH = getTreeTotalHeight(treeSrc);
        const cardMeshUri = `model://${escapeXml(pkgName)}/meshes/${escapeXml(world.name)}_tree_card_${treeSrc.style}.obj`;
        const atlasTexUri = `model://${escapeXml(pkgName)}/materials/textures/${escapeXml(world.name)}_trees_atlas.png`;
        lines.push(`        <visual name="vis_cross_card">`);
        lines.push(`          <cast_shadows>${perf.disableSceneryShadows ? 'false' : 'true'}</cast_shadows>`);
        lines.push(
          `          <geometry><mesh><uri>${cardMeshUri}</uri><scale>${fmt(treeSrc.canopyRadius)} ${fmt(treeSrc.canopyRadius)} ${fmt(totalH)}</scale></mesh></geometry>`,
        );
        lines.push(`          <material>`);
        lines.push(`            <ambient>1 1 1 1</ambient><diffuse>1 1 1 1</diffuse>`);
        lines.push(`            <double_sided>true</double_sided>`);
        lines.push(
          `            <pbr><metal><albedo_map>${atlasTexUri}</albedo_map><roughness>0.92</roughness><metalness>0</metalness></metal></pbr>`,
        );
        lines.push(`          </material>`);
        lines.push(`        </visual>`);
      } else {
        parts.forEach((part, idx) => {
          const rgba = part.rgba.map((c) => fmt(c, 3)).join(' ');
          const colGeom = renderWorldPrimitive(part.physicsShape);
          let visGeom = colGeom;
          if (part.visualKind === 'cone' && part.physicsShape.kind === 'cylinder') {
            const tierIdx = idx - 1;
            const coneR = getPineTierVisualRadius(treeSrc, Math.max(0, tierIdx));
            visGeom = `<cone><radius>${fmt(coneR)}</radius><length>${fmt(part.physicsShape.length)}</length></cone>`;
          }
          lines.push(`        <visual name="vis_${escapeXml(part.id)}">`);
          lines.push(`          <cast_shadows>${perf.disableSceneryShadows ? 'false' : 'true'}</cast_shadows>`);
          lines.push(`          <pose>${fmtPoseSdf(part.pose)}</pose>`);
          lines.push(`          <geometry>${visGeom}</geometry>`);
          lines.push(
            `          <material><ambient>${rgba}</ambient><diffuse>${rgba}</diffuse></material>`,
          );
          lines.push(`        </visual>`);
        });
      }
      lines.push(`      </link>`);
      lines.push(`    </model>`);
      continue;
    }

    if (obj.static && combinePrims) continue;

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
    lines.push(``);
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
    if (obj.static && perf.disableSceneryShadows) {
      lines.push(`          <cast_shadows>false</cast_shadows>`);
    }
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

  const terrainZ = sampleTerrainHeight(
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
