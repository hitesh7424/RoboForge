import type { TargetDistro } from '@/core/schema';

export interface GazeboPluginSpec {
  filename: string;
  name: string;
}

export interface TargetConfig {
  id: TargetDistro;
  rosDistro: 'jazzy' | 'humble' | 'lyrical';
  label: string;
  gazeboName: string;
  gzCommand: 'gz' | 'ign';
  sdfVersion: string;
  simLaunchPackage: string;
  simLaunchFile: string;
  simLaunchArgsKey: string;
  bridgePackage: string;
  bridgeNodeExecutable: string;
  spawnExecutable: string;
  aptInstallPackages: string[];
  worldSystems: {
    physics: GazeboPluginSpec;
    userCommands: GazeboPluginSpec;
    sceneBroadcaster: GazeboPluginSpec;
    contact: GazeboPluginSpec;
    sensors: GazeboPluginSpec;
    imu: GazeboPluginSpec;
    airPressure: GazeboPluginSpec;
    magnetometer: GazeboPluginSpec;
    navsat: GazeboPluginSpec;
  };
  robotPlugins: {
    diffDrive: GazeboPluginSpec;
    ackermann: GazeboPluginSpec;
    jointStatePublisher: GazeboPluginSpec;
    jointController: GazeboPluginSpec;
  };
  sensorRenderEngine: 'ogre2' | 'ogre';
}
