import { sampleElevationAt } from '@/core/mapTiles';
import type { Project } from '@/core/schema';
import type { TargetConfig } from '@/exporters/targets/types';
import { fmt } from '@/exporters/xmlUtils';

export function generateSimLaunchPy(project: Project, target: TargetConfig): string {
  const pkg = project.name;
  const robotName = project.robot.name;
  const worldName = project.world.name;
  const spawn = project.world.robotSpawnPose;
  const terrainZ = sampleElevationAt(project.world.mapBackground, spawn.xyz[0], spawn.xyz[1]);
  const safeSpawnZ = Math.max(spawn.xyz[2], terrainZ + 0.15);

  return `import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import AppendEnvironmentVariable, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import Command
from launch_ros.actions import Node


def generate_launch_description():
    pkg_share = get_package_share_directory('${pkg}')
    pkg_share_parent = os.path.dirname(pkg_share)
    resource_paths = f'{pkg_share_parent}:{pkg_share}'

    for env_key in ('GZ_SIM_RESOURCE_PATH', 'IGN_GAZEBO_RESOURCE_PATH', 'GAZEBO_MODEL_PATH'):
        existing = os.environ.get(env_key, '')
        os.environ[env_key] = f'{resource_paths}:{existing}' if existing else resource_paths

    xacro_file = os.path.join(pkg_share, 'urdf', '${robotName}.urdf.xacro')
    world_file = os.path.join(pkg_share, 'worlds', '${worldName}.sdf')
    bridge_config = os.path.join(pkg_share, 'config', 'bridge.yaml')

    robot_description = {'robot_description': Command(['xacro ', xacro_file])}

    gz_resource_path = AppendEnvironmentVariable(
        name='GZ_SIM_RESOURCE_PATH',
        value=resource_paths,
    )

    ign_resource_path = AppendEnvironmentVariable(
        name='IGN_GAZEBO_RESOURCE_PATH',
        value=resource_paths,
    )

    gz_sim = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(
                get_package_share_directory('${target.simLaunchPackage}'),
                'launch',
                '${target.simLaunchFile}',
            )
        ),
        launch_arguments={'${target.simLaunchArgsKey}': f'-r {world_file}'}.items(),
    )

    robot_state_publisher = Node(
        package='robot_state_publisher',
        executable='robot_state_publisher',
        output='screen',
        parameters=[robot_description, {'use_sim_time': True}],
    )

    spawn_robot = Node(
        package='${target.simLaunchPackage}',
        executable='${target.spawnExecutable}',
        output='screen',
        arguments=[
            '-topic', 'robot_description',
            '-name', '${robotName}',
            '-x', '${fmt(spawn.xyz[0])}',
            '-y', '${fmt(spawn.xyz[1])}',
            '-z', '${fmt(safeSpawnZ)}',
            '-R', '${fmt(spawn.rpy[0])}',
            '-P', '${fmt(spawn.rpy[1])}',
            '-Y', '${fmt(spawn.rpy[2])}',
        ],
    )

    bridge = Node(
        package='${target.bridgePackage}',
        executable='${target.bridgeNodeExecutable}',
        output='screen',
        parameters=[{'config_file': bridge_config, 'use_sim_time': True}],
    )

    return LaunchDescription([
        gz_resource_path,
        ign_resource_path,
        gz_sim,
        robot_state_publisher,
        spawn_robot,
        bridge,
    ])
`;
}

export function generateDisplayLaunchPy(
  project: Project,
  target: TargetConfig,
  pkgNameOverride?: string,
): string {
  const pkg = pkgNameOverride ?? project.name;
  const robotName = project.robot.name;

  return `# RViz display launch for ${target.label}
import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.substitutions import Command
from launch_ros.actions import Node


def generate_launch_description():
    pkg_share = get_package_share_directory('${pkg}')
    xacro_file = os.path.join(pkg_share, 'urdf', '${robotName}.urdf.xacro')
    rviz_config = os.path.join(pkg_share, 'config', 'robot.rviz')

    robot_description = {'robot_description': Command(['xacro ', xacro_file])}

    robot_state_publisher = Node(
        package='robot_state_publisher',
        executable='robot_state_publisher',
        output='screen',
        parameters=[robot_description],
    )

    joint_state_publisher_gui = Node(
        package='joint_state_publisher_gui',
        executable='joint_state_publisher_gui',
        output='screen',
    )

    rviz2 = Node(
        package='rviz2',
        executable='rviz2',
        output='screen',
        arguments=['-d', rviz_config],
    )

    return LaunchDescription([
        robot_state_publisher,
        joint_state_publisher_gui,
        rviz2,
    ])
`;
}

/**
 * Standalone Robot launch file: spawns this robot into ANY already-running Gazebo world
 * (with optional x, y, z, yaw launch arguments) plus robot_state_publisher and ros_gz_bridge.
 */
export function generateSpawnRobotLaunchPy(
  project: Project,
  target: TargetConfig,
  pkgNameOverride?: string,
): string {
  const pkg = pkgNameOverride ?? project.name;
  const robotName = project.robot.name;
  const spawn = project.world.robotSpawnPose;

  return `# Standalone robot spawn launch for ${target.label}
# Spawns "${robotName}" into an already-running Gazebo world.
import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import AppendEnvironmentVariable, DeclareLaunchArgument
from launch.substitutions import Command, LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    pkg_share = get_package_share_directory('${pkg}')
    pkg_share_parent = os.path.dirname(pkg_share)
    resource_paths = f'{pkg_share_parent}:{pkg_share}'

    xacro_file = os.path.join(pkg_share, 'urdf', '${robotName}.urdf.xacro')
    bridge_config = os.path.join(pkg_share, 'config', 'bridge.yaml')
    robot_description = {'robot_description': Command(['xacro ', xacro_file])}

    x_arg = DeclareLaunchArgument('x', default_value='${fmt(spawn.xyz[0])}')
    y_arg = DeclareLaunchArgument('y', default_value='${fmt(spawn.xyz[1])}')
    z_arg = DeclareLaunchArgument('z', default_value='${fmt(Math.max(0.15, spawn.xyz[2]))}')
    yaw_arg = DeclareLaunchArgument('yaw', default_value='${fmt(spawn.rpy[2])}')

    gz_resource_path = AppendEnvironmentVariable(
        name='GZ_SIM_RESOURCE_PATH',
        value=resource_paths,
    )

    ign_resource_path = AppendEnvironmentVariable(
        name='IGN_GAZEBO_RESOURCE_PATH',
        value=resource_paths,
    )

    robot_state_publisher = Node(
        package='robot_state_publisher',
        executable='robot_state_publisher',
        output='screen',
        parameters=[robot_description, {'use_sim_time': True}],
    )

    spawn_robot = Node(
        package='${target.simLaunchPackage}',
        executable='${target.spawnExecutable}',
        output='screen',
        arguments=[
            '-topic', 'robot_description',
            '-name', '${robotName}',
            '-x', LaunchConfiguration('x'),
            '-y', LaunchConfiguration('y'),
            '-z', LaunchConfiguration('z'),
            '-Y', LaunchConfiguration('yaw'),
        ],
    )

    bridge = Node(
        package='${target.bridgePackage}',
        executable='${target.bridgeNodeExecutable}',
        output='screen',
        parameters=[{'config_file': bridge_config, 'use_sim_time': True}],
    )

    return LaunchDescription([
        x_arg,
        y_arg,
        z_arg,
        yaw_arg,
        gz_resource_path,
        ign_resource_path,
        robot_state_publisher,
        spawn_robot,
        bridge,
    ])
`;
}

/**
 * Standalone World launch file: starts Gazebo with this custom world, terrain, textures,
 * and objects so any external robot package can spawn into it seamlessly.
 */
export function generateWorldOnlyLaunchPy(
  project: Project,
  target: TargetConfig,
  pkgNameOverride?: string,
): string {
  const pkg = pkgNameOverride ?? project.name;
  const worldName = project.world.name;

  return `# Standalone Gazebo world launch for ${target.label}
# Starts "${worldName}" without coupling to a specific robot package.
import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import AppendEnvironmentVariable, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource


def generate_launch_description():
    pkg_share = get_package_share_directory('${pkg}')
    pkg_share_parent = os.path.dirname(pkg_share)
    resource_paths = f'{pkg_share_parent}:{pkg_share}'

    for env_key in ('GZ_SIM_RESOURCE_PATH', 'IGN_GAZEBO_RESOURCE_PATH', 'GAZEBO_MODEL_PATH'):
        existing = os.environ.get(env_key, '')
        os.environ[env_key] = f'{resource_paths}:{existing}' if existing else resource_paths

    world_file = os.path.join(pkg_share, 'worlds', '${worldName}.sdf')

    gz_resource_path = AppendEnvironmentVariable(
        name='GZ_SIM_RESOURCE_PATH',
        value=resource_paths,
    )

    ign_resource_path = AppendEnvironmentVariable(
        name='IGN_GAZEBO_RESOURCE_PATH',
        value=resource_paths,
    )

    gz_sim = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(
                get_package_share_directory('${target.simLaunchPackage}'),
                'launch',
                '${target.simLaunchFile}',
            )
        ),
        launch_arguments={'${target.simLaunchArgsKey}': f'-r {world_file}'}.items(),
    )

    return LaunchDescription([
        gz_resource_path,
        ign_resource_path,
        gz_sim,
    ])
`;
}
