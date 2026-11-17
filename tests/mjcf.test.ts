import { describe, expect, it } from 'vitest';
import { createId } from '@/core/defaults';
import { createFourWheelRoverProject, createTwoWheelCasterProject } from '@/core/templates';
import { exportRos2Package } from '@/exporters';
import { generateMujocoXml, getMujocoStlMeshId } from '@/exporters/mjcf';

describe('MuJoCo MJCF Exporter', () => {
  it('generates valid MJCF XML with half-extents, exclusions, actuators, and world objects', () => {
    const project = createFourWheelRoverProject('jazzy-harmonic');
    const xml = generateMujocoXml(project);

    expect(xml).toContain(`<mujoco model="${project.robot.name}">`);
    expect(xml).toContain('<compiler angle="radian" autolimits="true"/>');
    expect(xml).toContain('<freejoint name="base_link_free"/>');
    // Rover chassis size [0.48, 0.34, 0.12] -> half-extents 0.24 0.17 0.06
    expect(xml).toContain('type="box" pos="0 0 0" quat="1 0 0 0" size="0.24 0.17 0.06"');
    // Dynamic world object inertial should have valid numeric diaginertia (not NaN)
    expect(xml).not.toContain('NaN');
    // Parent-child self-collision exclusions
    expect(xml).toContain('<exclude body1="base_link" body2="front_left_wheel_link"/>');
    // Velocity actuators for continuous wheel joints
    expect(xml).toContain('<velocity name="act_front_left_wheel_joint" joint="front_left_wheel_joint"');
    // Ground & world objects
    expect(xml).toContain('<geom name="ground_plane" type="plane"');
    expect(xml).toContain('world_north_wall');
  });

  it('supports revolute and prismatic joints with position actuators', () => {
    const project = createTwoWheelCasterProject('humble-fortress');
    project.robot.joints[0]!.type = 'revolute';
    project.robot.joints[0]!.limits = { lower: -1.2, upper: 1.2, effort: 10, velocity: 2 };
    const xml = generateMujocoXml(project);

    expect(xml).toContain('limited="true" range="-1.2 1.2"');
    expect(xml).toContain('<position name="act_');
  });

  it('references imported STL meshes and includes mujoco XML in ROS 2 export bundle', () => {
    const project = createFourWheelRoverProject('jazzy-harmonic');
    const asset = {
      id: createId(),
      name: 'custom_body',
      format: 'stl' as const,
      dataBase64: 'AAAA',
      byteLength: 3,
    };
    project.assets.push(asset);
    project.robot.links[0]!.visual.geometry = {
      type: 'mesh',
      assetId: asset.id,
      scale: [1, 1, 1],
    };

    const xml = generateMujocoXml(project, { embedMeshPathsPrefix: '../meshes/' });
    const meshId = getMujocoStlMeshId(asset);
    expect(xml).toContain(`<mesh name="${meshId}" file="../meshes/custom_body.stl"`);
    expect(xml).toContain(`type="mesh" mesh="${meshId}"`);

    const bundle = exportRos2Package(project);
    expect(bundle[`mujoco/${project.robot.name}.xml`]).toBeDefined();
  });

  it('emits dynamic tree multi-geom bodies and static tree geoms in MJCF', () => {
    const project = createFourWheelRoverProject('jazzy-harmonic');
    project.world.objects.push(
      {
        id: 'dyn_pine',
        name: 'pine_dyn',
        source: {
          type: 'tree',
          style: 'pine',
          trunkRadius: 0.12,
          trunkHeight: 0.9,
          canopyRadius: 0.8,
          canopyHeight: 2.0,
        },
        pose: { xyz: [2, 1, 0], rpy: [0, 0, 0] },
        static: false,
        mass: 30,
      },
      {
        id: 'stat_oak',
        name: 'oak_stat',
        source: {
          type: 'tree',
          style: 'deciduous',
          trunkRadius: 0.14,
          trunkHeight: 1.1,
          canopyRadius: 0.95,
          canopyHeight: 1.5,
        },
        pose: { xyz: [-2, -1, 0], rpy: [0, 0, 0] },
        static: true,
      },
    );

    const xml = generateMujocoXml(project);
    expect(xml).toContain('<body name="world_pine_dyn"');
    expect(xml).toContain('<freejoint name="world_free_pine_dyn"/>');
    expect(xml).toContain('world_geom_pine_dyn_trunk');
    expect(xml).toContain('world_geom_pine_dyn_canopy_tier_0');
    expect(xml).toContain('<geom name="world_oak_stat_trunk"');
    expect(xml).not.toContain('NaN');
  });

  it('emits an hfield terrain collider when DEM elevation relief is enabled', () => {
    const project = createFourWheelRoverProject('jazzy-harmonic');
    project.world.mapBackground = {
      enabled: true,
      tileUrl: 'http://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      latitude: 37.422,
      longitude: -122.0841,
      elevation: 0,
      headingDeg: 0,
      zoom: 19,
      opacity: 0.96,
      landSizeMeters: 120,
      elevationEnabled: true,
      elevationSource: 'terrarium',
      elevationScale: 1,
      terrainSegments: 4,
      elevationGridSize: 2,
      elevationGrid: [-1.5, 0.5, 0.0, 3.5],
    };
    project.world.objects.push({
      id: 'bldg_1',
      name: 'map_building',
      source: {
        type: 'primitive',
        shape: {
          kind: 'extrude',
          points: [
            [-2, -1],
            [4, -1],
            [4, 3],
            [-2, 3],
          ],
          depth: 8,
        },
        material: { name: 'concrete', rgba: [0.5, 0.55, 0.6, 1] },
      },
      pose: { xyz: [10, 5, 4], rpy: [0, 0, 0] },
      static: true,
    });

    const xml = generateMujocoXml(project);
    expect(xml).toContain('<hfield name="world_terrain" nrow="2" ncol="2" size="60 60 5 0.5"/>');
    expect(xml).toContain('<geom name="ground_plane" type="hfield" hfield="world_terrain" pos="0 0 -1.5"');
    // Extrude bounding center is (+1, +1) added to base [10, 5, 4] -> [11, 6, 4]
    expect(xml).toContain('<geom name="world_map_building" type="box" pos="11 6 4"');
  });
});

