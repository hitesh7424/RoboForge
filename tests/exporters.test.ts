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
});
