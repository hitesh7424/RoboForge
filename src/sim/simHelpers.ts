import * as THREE from 'three';
import type { Sensor } from '@/core/schema';

/**
 * Rotation matrix mapping Three.js Camera local frame (Right=+X, Up=+Y, Back=+Z / Look=-Z)
 * to ROS sensor frame (Forward=+X, Left=+Y, Up=+Z):
 *   Cam +X (right)    = ROS -Y = (0, -1, 0)
 *   Cam +Y (up)       = ROS +Z = (0, 0, 1)
 *   Cam +Z (backward) = ROS -X = (-1, 0, 0)
 */
const ROS_OPTICAL_BASIS = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(-1, 0, 0),
);

export const ROS_TO_THREE_CAMERA_QUAT = new THREE.Quaternion().setFromRotationMatrix(
  ROS_OPTICAL_BASIS,
);

/**
 * Given a sensor's ROS frame world matrix (in Three.js scene space), returns the world
 * position and orientation for a Three.js PerspectiveCamera looking along ROS +X with ROS +Z up.
 */
export function rosSensorWorldMatrixToCameraPose(sensorWorldMatrix: THREE.Matrix4): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
} {
  const position = new THREE.Vector3();
  const baseQuat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  sensorWorldMatrix.decompose(position, baseQuat, scale);
  const quaternion = baseQuat.multiply(ROS_TO_THREE_CAMERA_QUAT);
  return { position, quaternion };
}

/**
 * Generates unit ray direction vectors in the sensor's local ROS frame (+X forward, +Y left, +Z up).
 */
export function generateLidarRayDirections(
  sensor: Extract<Sensor, { kind: 'lidar2d' | 'lidar3d' }>,
): THREE.Vector3[] {
  const dirs: THREE.Vector3[] = [];
  if (sensor.kind === 'lidar2d') {
    const count = Math.max(8, Math.min(96, sensor.samples));
    const minA = sensor.minAngle;
    const maxA = sensor.maxAngle;
    const span = maxA - minA;
    for (let i = 0; i < count; i++) {
      const denom = Math.abs(span) >= Math.PI * 1.99 ? count : Math.max(1, count - 1);
      const angle = minA + (span * i) / denom;
      dirs.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).normalize());
    }
    return dirs;
  }

  // lidar3d multi-ring sweep
  const hCount = Math.max(12, Math.min(36, sensor.horizontalSamples));
  const vCount = Math.max(3, Math.min(6, sensor.verticalSamples));
  const vMin = -0.2618; // -15 deg
  const vMax = 0.2618; // +15 deg
  for (let v = 0; v < vCount; v++) {
    const elev = vCount === 1 ? 0 : vMin + ((vMax - vMin) * v) / (vCount - 1);
    const cosE = Math.cos(elev);
    const sinE = Math.sin(elev);
    for (let h = 0; h < hCount; h++) {
      const azim = -Math.PI + (Math.PI * 2 * h) / hCount;
      dirs.push(
        new THREE.Vector3(cosE * Math.cos(azim), cosE * Math.sin(azim), sinE).normalize(),
      );
    }
  }
  return dirs;
}

/**
 * Computes the incremental camera & orbit-target delta to smoothly track a moving object
 * without locking user orbit/zoom.
 */
export function computeTrackingDelta(
  prevTrackedPos: THREE.Vector3 | null,
  currentTrackedPos: THREE.Vector3,
): THREE.Vector3 {
  if (!prevTrackedPos) {
    return new THREE.Vector3(0, 0, 0);
  }
  return currentTrackedPos.clone().sub(prevTrackedPos);
}
