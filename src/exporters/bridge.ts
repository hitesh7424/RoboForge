import type { Project } from '@/core/schema';
import type { TargetConfig } from '@/exporters/targets/types';

export interface BridgeEntry {
  rosTopic: string;
  gzTopic: string;
  rosType: string;
  gzType: string;
  direction: 'GZ_TO_ROS' | 'ROS_TO_GZ' | 'BIDIRECTIONAL';
}

export function buildBridgeEntries(project: Project, target: TargetConfig): BridgeEntry[] {
  const { robot, world } = project;
  const isFortress = target.gzCommand === 'ign';
  const msgPrefix = isFortress ? 'ignition.msgs' : 'gz.msgs';

  const entries: BridgeEntry[] = [
    {
      rosTopic: '/clock',
      gzTopic: '/clock',
      rosType: 'rosgraph_msgs/msg/Clock',
      gzType: `${msgPrefix}.Clock`,
      direction: 'GZ_TO_ROS',
    },
    {
      rosTopic: '/tf',
      gzTopic: '/tf',
      rosType: 'tf2_msgs/msg/TFMessage',
      gzType: `${msgPrefix}.Pose_V`,
      direction: 'GZ_TO_ROS',
    },
  ];

  const hasJointStatePub =
    robot.plugins.some((p) => p.kind === 'joint_state_publisher') || robot.joints.length > 0;
  if (hasJointStatePub) {
    const jspPlugin = robot.plugins.find((p) => p.kind === 'joint_state_publisher');
    const topic =
      jspPlugin && jspPlugin.kind === 'joint_state_publisher' ? jspPlugin.topic : '/joint_states';
    entries.push({
      rosTopic: topic,
      gzTopic: `/world/${world.name}/model/${robot.name}/joint_state`,
      rosType: 'sensor_msgs/msg/JointState',
      gzType: `${msgPrefix}.Model`,
      direction: 'GZ_TO_ROS',
    });
  }

  for (const plugin of robot.plugins) {
    if (plugin.kind === 'diff_drive' || plugin.kind === 'ackermann') {
      entries.push(
        {
          rosTopic: plugin.cmdVelTopic,
          gzTopic: plugin.cmdVelTopic,
          rosType: 'geometry_msgs/msg/Twist',
          gzType: `${msgPrefix}.Twist`,
          direction: 'ROS_TO_GZ',
        },
        {
          rosTopic: plugin.odomTopic,
          gzTopic: plugin.odomTopic,
          rosType: 'nav_msgs/msg/Odometry',
          gzType: `${msgPrefix}.Odometry`,
          direction: 'GZ_TO_ROS',
        },
      );
    } else if (plugin.kind === 'joint_controller') {
      entries.push({
        rosTopic: plugin.topic,
        gzTopic: plugin.topic,
        rosType: 'std_msgs/msg/Float64',
        gzType: `${msgPrefix}.Double`,
        direction: 'ROS_TO_GZ',
      });
    }
  }

  for (const sensor of robot.sensors) {
    if (sensor.kind === 'lidar2d') {
      entries.push({
        rosTopic: sensor.topic,
        gzTopic: sensor.topic,
        rosType: 'sensor_msgs/msg/LaserScan',
        gzType: `${msgPrefix}.LaserScan`,
        direction: 'GZ_TO_ROS',
      });
    } else if (sensor.kind === 'lidar3d') {
      entries.push({
        rosTopic: `${sensor.topic}`,
        gzTopic: `${sensor.topic}/points`,
        rosType: 'sensor_msgs/msg/PointCloud2',
        gzType: `${msgPrefix}.PointCloudPacked`,
        direction: 'GZ_TO_ROS',
      });
    } else if (sensor.kind === 'camera' || sensor.kind === 'depth_camera') {
      entries.push({
        rosTopic: sensor.topic,
        gzTopic: sensor.topic,
        rosType: 'sensor_msgs/msg/Image',
        gzType: `${msgPrefix}.Image`,
        direction: 'GZ_TO_ROS',
      });
      const base = sensor.topic.replace(/\/image_raw$/, '');
      entries.push({
        rosTopic: `${base}/camera_info`,
        gzTopic: `${base}/camera_info`,
        rosType: 'sensor_msgs/msg/CameraInfo',
        gzType: `${msgPrefix}.CameraInfo`,
        direction: 'GZ_TO_ROS',
      });
    } else if (sensor.kind === 'imu') {
      entries.push({
        rosTopic: sensor.topic,
        gzTopic: sensor.topic,
        rosType: 'sensor_msgs/msg/Imu',
        gzType: `${msgPrefix}.IMU`,
        direction: 'GZ_TO_ROS',
      });
    } else if (sensor.kind === 'gps') {
      entries.push({
        rosTopic: sensor.topic,
        gzTopic: sensor.topic,
        rosType: 'sensor_msgs/msg/NavSatFix',
        gzType: `${msgPrefix}.NavSat`,
        direction: 'GZ_TO_ROS',
      });
    }
  }

  // Deduplicate by rosTopic
  const unique = new Map<string, BridgeEntry>();
  for (const e of entries) {
    if (!unique.has(e.rosTopic)) unique.set(e.rosTopic, e);
  }
  return Array.from(unique.values());
}

export function generateBridgeYaml(project: Project, target: TargetConfig): string {
  const entries = buildBridgeEntries(project, target);
  const lines: string[] = [
    `# Auto-generated ${target.bridgePackage} configuration for ${target.label}`,
  ];

  for (const e of entries) {
    lines.push(`- ros_topic_name: "${e.rosTopic}"`);
    lines.push(`  gz_topic_name: "${e.gzTopic}"`);
    lines.push(`  ros_type_name: "${e.rosType}"`);
    lines.push(`  gz_type_name: "${e.gzType}"`);
    lines.push(`  direction: ${e.direction}`);
  }

  return lines.join('\n') + '\n';
}
