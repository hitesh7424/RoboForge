import { describe, expect, it } from 'vitest';
import { createFourWheelRoverProject } from '@/core/templates';
import { exportRos2Package, generateResolvedUrdf } from '@/exporters';
import { getTargetConfig } from '@/exporters/targets';

describe('ROS 2 package exporters across Jazzy, Humble, and Lyrical targets', () => {
  it('exports all required ROS 2 package files for ROS 2 Jazzy + Gazebo Harmonic', () => {
    const project = createFourWheelRoverProject('jazzy-harmonic');
    const files = exportRos2Package(project);

    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'package.xml',
        'CMakeLists.txt',
        'urdf/scout_rover.urdf.xacro',
        'urdf/scout_rover_gazebo.xacro',
        'sdf/scout_rover.sdf',
        'worlds/rover_arena.sdf',
        'launch/sim.launch.py',
        'launch/display.launch.py',
        'config/bridge.yaml',
        'config/robot.rviz',
        'scripts/validate.md',
        'README.md',
      ]),
    );

    const xacro = files['urdf/scout_rover.urdf.xacro'] as string;
    expect(xacro).toContain('<xacro:property name="base_link_mass"');
    expect(xacro).toContain('<xacro:macro name="roboforge_wheel"');
    expect(xacro).toContain('<xacro:roboforge_wheel name="front_left_wheel_link"');

    const gazeboXacro = files['urdf/scout_rover_gazebo.xacro'] as string;
    expect(gazeboXacro).toContain('gz-sim-diff-drive-system');
    expect(gazeboXacro).toContain('gz-sim-joint-state-publisher-system');
    expect(gazeboXacro).toContain('type="gpu_lidar"');
    expect(gazeboXacro).toContain('<topic>/scan</topic>');

    const worldSdf = files['worlds/rover_arena.sdf'] as string;
    expect(worldSdf).toContain('<sdf version="1.10">');
    expect(worldSdf).toContain('gz-sim-physics-system');
    expect(worldSdf).toContain('north_wall');
    expect(worldSdf).toContain('crate_alpha');

    const bridgeYaml = files['config/bridge.yaml'] as string;
    expect(bridgeYaml).toContain('/cmd_vel');
    expect(bridgeYaml).toContain('/scan');
    expect(bridgeYaml).toContain('/imu');
    expect(bridgeYaml).toContain('/camera/image_raw');

    const simLaunch = files['launch/sim.launch.py'] as string;
    expect(simLaunch).toContain("get_package_share_directory('ros_gz_sim')");
    expect(simLaunch).toContain('gz_sim.launch.py');
    expect(simLaunch).toContain("package='ros_gz_bridge'");
  });

  it('isolates Ignition/Fortress differences for ROS 2 Humble target', () => {
    const project = createFourWheelRoverProject('humble-fortress');
    const files = exportRos2Package(project);

    const gazeboXacro = files['urdf/scout_rover_gazebo.xacro'] as string;
    expect(gazeboXacro).toContain('ignition-gazebo-diff-drive-system');
    expect(gazeboXacro).toContain('ignition::gazebo::systems::DiffDrive');

    const worldSdf = files['worlds/rover_arena.sdf'] as string;
    expect(worldSdf).toContain('<sdf version="1.9">');
    expect(worldSdf).toContain('ignition-gazebo-physics-system');

    const simLaunch = files['launch/sim.launch.py'] as string;
    expect(simLaunch).toContain("get_package_share_directory('ros_ign_gazebo')");
    expect(simLaunch).toContain('ign_gazebo.launch.py');
    expect(simLaunch).toContain("package='ros_ign_bridge'");
  });

  it('exports ROS 2 Lyrical + Gazebo Jetty target configuration accurately', () => {
    const project = createFourWheelRoverProject('lyrical-jetty');
    const target = getTargetConfig('lyrical-jetty');
    expect(target.rosDistro).toBe('lyrical');
    expect(target.gazeboName).toBe('Gazebo Jetty');
    expect(target.sdfVersion).toBe('1.11');

    const files = exportRos2Package(project);
    const worldSdf = files['worlds/rover_arena.sdf'] as string;
    expect(worldSdf).toContain('<sdf version="1.11">');
    expect(worldSdf).toContain('gz-sim-physics-system');

    const pkgXml = files['package.xml'] as string;
    expect(pkgXml).toContain('<exec_depend>ros_gz_sim</exec_depend>');
    expect(pkgXml).toContain('<exec_depend>ros_gz_bridge</exec_depend>');

    const pkgReadme = files['README.md'] as string;
    expect(pkgReadme).toContain('ros-lyrical-ros-gz');
  });

  it('generates resolved flat URDF matching link and joint counts', () => {
    const project = createFourWheelRoverProject('jazzy-harmonic');
    const urdf = generateResolvedUrdf(project);
    expect(urdf).not.toContain('<xacro:');
    const linkMatches = [...urdf.matchAll(/<link\s+name="/g)];
    const jointMatches = [...urdf.matchAll(/<joint\s+name="/g)];
    expect(linkMatches).toHaveLength(project.robot.links.length);
    expect(jointMatches).toHaveLength(project.robot.joints.length);
  });

  it('exports spherical_coordinates for map backgrounds, custom textures, and dynamic trees', () => {
    const project = createFourWheelRoverProject('jazzy-harmonic');
    project.world.mapBackground = {
      enabled: true,
      tileUrl: 'http://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      latitude: 48.8584,
      longitude: 2.2945,
      elevation: 35,
      headingDeg: 0,
      zoom: 19,
      opacity: 0.9,
    };

    const tex = {
      id: 'tex_asphalt',
      name: 'asphalt_tile',
      format: 'png' as const,
      mimeType: 'image/png',
      dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      byteLength: 68,
    };
    project.textures.push(tex);
    project.world.ground.textureId = tex.id;
    project.robot.links[0]!.visual.material.textureId = tex.id;

    project.world.objects.push({
      id: 'tree_1',
      name: 'oak_tree',
      source: {
        type: 'tree',
        style: 'deciduous',
        trunkRadius: 0.14,
        trunkHeight: 1.1,
        canopyRadius: 0.9,
        canopyHeight: 1.4,
      },
      pose: { xyz: [2.5, 1.5, 0], rpy: [0, 0, 0] },
      static: false,
      mass: 38,
    });

    const files = exportRos2Package(project);
    const worldSdf = files['worlds/rover_arena.sdf'] as string;
    expect(worldSdf).toContain('<spherical_coordinates>');
    expect(worldSdf).toContain('<latitude_deg>48.8584000</latitude_deg>');
    expect(worldSdf).toContain('<longitude_deg>2.2945000</longitude_deg>');
    expect(worldSdf).toContain('model://scout_rover_pkg/materials/textures/asphalt_tile.png');
    expect(worldSdf).toContain('<model name="oak_tree">');
    expect(worldSdf).toContain('<static>false</static>');

    const robotSdf = files['sdf/scout_rover.sdf'] as string;
    expect(robotSdf).toContain('model://scout_rover_pkg/materials/textures/asphalt_tile.png');
    expect(files['materials/textures/asphalt_tile.png']).toBeInstanceOf(Uint8Array);
  });

  it('exports DEM heightmap PNG and building polygon polylines in Gazebo world SDF', () => {
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
      landSizeMeters: 150,
      elevationEnabled: true,
      elevationSource: 'terrarium',
      elevationScale: 1,
      terrainSegments: 4,
      elevationGridSize: 2,
      elevationGrid: [-2, 0, 1, 4],
    };
    project.world.objects.push({
      id: 'bldg_poly',
      name: 'hq_tower',
      source: {
        type: 'primitive',
        shape: {
          kind: 'extrude',
          points: [
            [-3, -2],
            [3, -2],
            [3, 2],
            [-3, 2],
          ],
          depth: 12,
        },
        material: { name: 'tower_gray', rgba: [0.4, 0.45, 0.5, 1] },
      },
      pose: { xyz: [12, -8, 6], rpy: [0, 0, 0] },
      static: true,
    });

    const files = exportRos2Package(project);
    const worldSdf = files['worlds/rover_arena.sdf'] as string;
    expect(worldSdf).toContain('<heightmap><uri>model://scout_rover_pkg/materials/textures/rover_arena_dem.png</uri><size>150 150 6</size><pos>0 0 -2</pos></heightmap>');
    expect(worldSdf).toContain('<polyline><point>-3 -2</point><point>3 -2</point><point>3 2</point><point>-3 2</point><height>12</height></polyline>');

    const demBytes = files['materials/textures/rover_arena_dem.png'];
    expect(demBytes).toBeInstanceOf(Uint8Array);
    expect(Array.from((demBytes as Uint8Array).slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});

