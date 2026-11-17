import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  computeJointOriginPose,
  computeLinkWorldMatrices,
  rosPoseToThree,
  rosVec3ToThree,
  threeTransformToRosPose,
  threeVec3ToRos,
} from '@/core/coords';
import { createPrimitiveLink } from '@/core/defaults';
import type { Joint, Pose, Vec3 } from '@/core/schema';

describe('ROS <-> Three.js coordinate conversions', () => {
  it('round-trips arbitrary ROS vectors accurately', () => {
    const v: Vec3 = [1.25, -0.75, 0.42];
    const threeV = rosVec3ToThree(v);
    // ROS +X -> Three +X, ROS +Y -> Three -Z, ROS +Z -> Three +Y
    expect(threeV).toEqual([1.25, 0.42, 0.75]);
    expect(threeVec3ToRos(threeV)).toEqual(v);
  });

  it('round-trips ROS poses with RPY rotations through Three.js world transforms', () => {
    const pose: Pose = { xyz: [0.3, -0.5, 0.15], rpy: [0.25, -0.4, 1.1] };
    const { position, quaternion } = rosPoseToThree(pose);
    const recovered = threeTransformToRosPose(position, quaternion);

    for (let i = 0; i < 3; i++) {
      expect(recovered.xyz[i]).toBeCloseTo(pose.xyz[i]!, 5);
      expect(recovered.rpy[i]).toBeCloseTo(pose.rpy[i]!, 5);
    }
  });

  it('computes relative joint origin T_parent_mount * inv(T_child_mount)', () => {
    const parent = createPrimitiveLink('base_link', { kind: 'box', size: [0.4, 0.3, 0.1] });
    parent.mounts[0]!.pose = { xyz: [0.2, 0.15, 0], rpy: [0, 0, 0] };

    const child = createPrimitiveLink('sensor_link', {
      kind: 'cylinder',
      radius: 0.04,
      length: 0.05,
    });
    child.mounts[0]!.pose = { xyz: [0, 0, -0.025], rpy: [0, 0, 0] };

    const origin = computeJointOriginPose(parent, parent.mounts[0]!.id, child, child.mounts[0]!.id);
    expect(origin.xyz[0]).toBeCloseTo(0.2, 5);
    expect(origin.xyz[1]).toBeCloseTo(0.15, 5);
    expect(origin.xyz[2]).toBeCloseTo(0.025, 5);
  });

  it('evaluates forward kinematics along joints including revolute motion', () => {
    const base = createPrimitiveLink('base_link', { kind: 'box', size: [0.4, 0.3, 0.1] });
    const arm = createPrimitiveLink('arm_link', { kind: 'box', size: [0.3, 0.05, 0.05] });
    base.mounts[0]!.pose = { xyz: [0.2, 0, 0.1], rpy: [0, 0, 0] };
    arm.mounts[0]!.pose = { xyz: [-0.15, 0, 0], rpy: [0, 0, 0] };

    const joint: Joint = {
      id: 'j1',
      name: 'arm_joint',
      type: 'revolute',
      parent: { linkId: base.id, mountId: base.mounts[0]!.id },
      child: { linkId: arm.id, mountId: arm.mounts[0]!.id },
      axis: [0, 0, 1],
    };

    const matsZero = computeLinkWorldMatrices([base, arm], [joint], base.id);
    const armPosZero = new THREE.Vector3().setFromMatrixPosition(matsZero.get(arm.id)!);
    expect(armPosZero.x).toBeCloseTo(0.35, 5);
    expect(armPosZero.y).toBeCloseTo(0, 5);
    expect(armPosZero.z).toBeCloseTo(0.1, 5);

    const matsRotated = computeLinkWorldMatrices([base, arm], [joint], base.id, {
      [joint.id]: Math.PI / 2,
    });
    const armMatRot = matsRotated.get(arm.id)!;
    const xDir = new THREE.Vector3(1, 0, 0).transformDirection(armMatRot);
    expect(xDir.x).toBeCloseTo(0, 4);
    expect(xDir.y).toBeCloseTo(1, 4);
  });

  it('places unattached links at the global origin (0, 0, 0)', () => {
    const base = createPrimitiveLink('base_link', { kind: 'box', size: [0.4, 0.3, 0.1] });
    const loose1 = createPrimitiveLink('loose_1', { kind: 'box', size: [0.2, 0.2, 0.2] });
    const loose2 = createPrimitiveLink('loose_2', { kind: 'sphere', radius: 0.1 });

    const mats = computeLinkWorldMatrices([base, loose1, loose2], [], base.id);
    for (const id of [base.id, loose1.id, loose2.id]) {
      const pos = new THREE.Vector3().setFromMatrixPosition(mats.get(id)!);
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
      expect(pos.z).toBe(0);
    }
  });
});
