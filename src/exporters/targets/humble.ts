import type { TargetConfig } from '@/exporters/targets/types';

export const HUMBLE_TARGET: TargetConfig = {
  id: 'humble-fortress',
  rosDistro: 'humble',
  label: 'ROS 2 Humble + Gazebo Fortress',
  gazeboName: 'Gazebo Fortress',
  gzCommand: 'ign',
  sdfVersion: '1.9',
  simLaunchPackage: 'ros_ign_gazebo',
  simLaunchFile: 'ign_gazebo.launch.py',
  simLaunchArgsKey: 'ign_args',
  bridgePackage: 'ros_ign_bridge',
  bridgeNodeExecutable: 'parameter_bridge',
  spawnExecutable: 'create',
  aptInstallPackages: [
    'ros-humble-ros-ign',
    'ros-humble-xacro',
    'ros-humble-robot-state-publisher',
    'ros-humble-joint-state-publisher-gui',
    'ros-humble-rviz2',
  ],
  worldSystems: {
    physics: {
      filename: 'ignition-gazebo-physics-system',
      name: 'ignition::gazebo::systems::Physics',
    },
    userCommands: {
      filename: 'ignition-gazebo-user-commands-system',
      name: 'ignition::gazebo::systems::UserCommands',
    },
    sceneBroadcaster: {
      filename: 'ignition-gazebo-scene-broadcaster-system',
      name: 'ignition::gazebo::systems::SceneBroadcaster',
    },
    sensors: {
      filename: 'ignition-gazebo-sensors-system',
      name: 'ignition::gazebo::systems::Sensors',
    },
    imu: {
      filename: 'ignition-gazebo-imu-system',
      name: 'ignition::gazebo::systems::Imu',
    },
    navsat: {
      filename: 'ignition-gazebo-navsat-system',
      name: 'ignition::gazebo::systems::NavSat',
    },
  },
  robotPlugins: {
    diffDrive: {
      filename: 'ignition-gazebo-diff-drive-system',
      name: 'ignition::gazebo::systems::DiffDrive',
    },
    ackermann: {
      filename: 'ignition-gazebo-ackermann-steering-system',
      name: 'ignition::gazebo::systems::AckermannSteering',
    },
    jointStatePublisher: {
      filename: 'ignition-gazebo-joint-state-publisher-system',
      name: 'ignition::gazebo::systems::JointStatePublisher',
    },
    jointController: {
      filename: 'ignition-gazebo-joint-position-controller-system',
      name: 'ignition::gazebo::systems::JointPositionController',
    },
  },
  sensorRenderEngine: 'ogre2',
};
