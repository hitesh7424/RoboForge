import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ROS_TO_THREE_EULER } from '@/core/coords';
import {
  computeTrackingDelta,
  generateLidarRayDirections,
  rosSensorWorldMatrixToCameraPose,
} from '@/sim/simHelpers';

describe('Simulation pure helpers', () => {
  it('aligns Three.js camera -Z forward and +Y up with ROS +X forward and +Z up', () => {
    // Sensor at origin inside ROS_TO_THREE_EULER scene group
    const sensorWorld = new THREE.Matrix4().makeRotationFromEuler(ROS_TO_THREE_EULER);
    const { position, quaternion } = rosSensorWorldMatrixToCameraPose(sensorWorld);

    expect(position.length()).toBeCloseTo(0, 6);

    // Three.js camera looks down local -Z -> in Three world space should be +X (ROS forward)
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    expect(lookDir.x).toBeCloseTo(1, 5);
    expect(lookDir.y).toBeCloseTo(0, 5);
    expect(lookDir.z).toBeCloseTo(0, 5);

    // Three.js camera +Y up -> in Three world space should be +Y (ROS +Z up)
    const upDir = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
    expect(upDir.x).toBeCloseTo(0, 5);
    expect(upDir.y).toBeCloseTo(1, 5);
    expect(upDir.z).toBeCloseTo(0, 5);
  });

  it('generates capped 2D and 3D LiDAR unit ray directions in ROS XY/3D frame', () => {
    const dirs2d = generateLidarRayDirections({
      id: 's1',
      name: 'lidar',
      kind: 'lidar2d',
      linkId: 'l1',
      mountId: 'm1',
      topic: '/scan',
      updateRate: 10,
      samples: 360,
      minAngle: -Math.PI / 2,
      maxAngle: Math.PI / 2,
      minRange: 0.1,
      maxRange: 10,
    });
    expect(dirs2d.length).toBe(96);
    expect(dirs2d[0]!.x).toBeCloseTo(0, 5);
    expect(dirs2d[0]!.y).toBeCloseTo(-1, 5);
    expect(dirs2d[0]!.z).toBeCloseTo(0, 5);

    const dirs3d = generateLidarRayDirections({
      id: 's2',
      name: 'lidar3',
      kind: 'lidar3d',
      linkId: 'l1',
      mountId: 'm1',
      topic: '/points',
      updateRate: 10,
      horizontalSamples: 180,
      verticalSamples: 16,
      minRange: 0.2,
      maxRange: 20,
    });
    expect(dirs3d.length).toBe(36 * 6);
    for (const d of dirs3d) {
      expect(d.length()).toBeCloseTo(1, 5);
    }
  });

  it('computes tracking delta accurately from previous to current position', () => {
    const p0 = new THREE.Vector3(1, 0.2, -0.5);
    const p1 = new THREE.Vector3(1.5, 0.2, -0.8);
    expect(computeTrackingDelta(null, p1).length()).toBe(0);
    const delta = computeTrackingDelta(p0, p1);
    expect(delta.x).toBeCloseTo(0.5, 5);
    expect(delta.y).toBeCloseTo(0, 5);
    expect(delta.z).toBeCloseTo(-0.3, 5);
  });
});
