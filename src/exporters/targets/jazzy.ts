import type { TargetConfig } from '@/exporters/targets/types';

export const JAZZY_TARGET: TargetConfig = {
  id: 'jazzy-harmonic',
  rosDistro: 'jazzy',
  label: 'ROS 2 Jazzy + Gazebo Harmonic',
  gazeboName: 'Gazebo Harmonic',
  gzCommand: 'gz',
  sdfVersion: '1.10',
  simLaunchPackage: 'ros_gz_sim',
  simLaunchFile: 'gz_sim.launch.py',
  simLaunchArgsKey: 'gz_args',
  bridgePackage: 'ros_gz_bridge',
  bridgeNodeExecutable: 'parameter_bridge',
  spawnExecutable: 'create',
  aptInstallPackages: [
    'ros-jazzy-ros-gz',
    'ros-jazzy-xacro',
    'ros-jazzy-robot-state-publisher',
    'ros-jazzy-joint-state-publisher-gui',
    'ros-jazzy-rviz2',
  ],
  worldSystems: {
    physics: { filename: 'gz-sim-physics-system', name: 'gz::sim::systems::Physics' },
    userCommands: {
      filename: 'gz-sim-user-commands-system',
      name: 'gz::sim::systems::UserCommands',
    },
    sceneBroadcaster: {
      filename: 'gz-sim-scene-broadcaster-system',
      name: 'gz::sim::systems::SceneBroadcaster',
    },
    contact: { filename: 'gz-sim-contact-system', name: 'gz::sim::systems::Contact' },
    sensors: { filename: 'gz-sim-sensors-system', name: 'gz::sim::systems::Sensors' },
    imu: { filename: 'gz-sim-imu-system', name: 'gz::sim::systems::Imu' },
    airPressure: {
      filename: 'gz-sim-air-pressure-system',
      name: 'gz::sim::systems::AirPressure',
    },
    magnetometer: {
      filename: 'gz-sim-magnetometer-system',
      name: 'gz::sim::systems::Magnetometer',
    },
    navsat: { filename: 'gz-sim-navsat-system', name: 'gz::sim::systems::NavSat' },
  },
  robotPlugins: {
    diffDrive: { filename: 'gz-sim-diff-drive-system', name: 'gz::sim::systems::DiffDrive' },
    ackermann: {
      filename: 'gz-sim-ackermann-steering-system',
      name: 'gz::sim::systems::AckermannSteering',
    },
    jointStatePublisher: {
      filename: 'gz-sim-joint-state-publisher-system',
      name: 'gz::sim::systems::JointStatePublisher',
    },
    jointController: {
      filename: 'gz-sim-joint-position-controller-system',
      name: 'gz::sim::systems::JointPositionController',
    },
  },
  sensorRenderEngine: 'ogre2',
};
