import * as THREE from 'three';
import type { Joint, Link, Pose, Vec3 } from '@/core/schema';

/**
 * ROS convention: X forward, Y left, Z up (meters, radians, extrinsic XYZ / intrinsic ZYX RPY).
 * Three.js convention: X right, Y up, Z out of screen.
 *
 * Rigid rotation Rx(-pi/2) maps:
 *   ROS +X -> Three +X
 *   ROS +Y -> Three -Z
 *   ROS +Z -> Three +Y
 * Determinant = +1 (strictly right-handed).
 */
export const ROS_TO_THREE_EULER = new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ');
export const ROS_TO_THREE_QUAT = new THREE.Quaternion().setFromEuler(ROS_TO_THREE_EULER);
export const THREE_TO_ROS_QUAT = ROS_TO_THREE_QUAT.clone().invert();

export function rosVec3ToThree(v: Vec3): [number, number, number] {
  return [v[0], v[2], -v[1]];
}

export function threeVec3ToRos(v: [number, number, number]): Vec3 {
  return [v[0], -v[2], v[1]];
}

/**
 * URDF/SDF RPY is extrinsic XYZ (roll about X, pitch about Y, yaw about Z),
 * which corresponds to Three.js intrinsic ZYX Euler order: Euler(roll, pitch, yaw, 'ZYX').
 */
export function rosRpyToQuaternion(rpy: Vec3): THREE.Quaternion {
  const euler = new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX');
  return new THREE.Quaternion().setFromEuler(euler);
}

export function quaternionToRosRpy(q: THREE.Quaternion): Vec3 {
  const euler = new THREE.Euler().setFromQuaternion(q, 'ZYX');
  return [euler.x, euler.y, euler.z];
}

export function poseToRosMatrix(pose: Pose): THREE.Matrix4 {
  const pos = new THREE.Vector3(pose.xyz[0], pose.xyz[1], pose.xyz[2]);
  const quat = rosRpyToQuaternion(pose.rpy);
  return new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
}

export function rosMatrixToPose(mat: THREE.Matrix4): Pose {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mat.decompose(pos, quat, scale);
  const rpy = quaternionToRosRpy(quat);
  return {
    xyz: [round6(pos.x), round6(pos.y), round6(pos.z)],
    rpy: [round6(rpy[0]), round6(rpy[1]), round6(rpy[2])],
  };
}

function round6(n: number): number {
  const rounded = Math.round(n * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Convert a ROS Pose (in ROS world coordinates) into Three.js position + quaternion.
 */
export function rosPoseToThree(pose: Pose): {
  position: [number, number, number];
  quaternion: THREE.Quaternion;
} {
  const position = rosVec3ToThree(pose.xyz);
  const rosQuat = rosRpyToQuaternion(pose.rpy);
  // Conjugate by ROS_TO_THREE_QUAT so rotation acts in Three.js world frame
  const threeQuat = ROS_TO_THREE_QUAT.clone().multiply(rosQuat);
  return { position, quaternion: threeQuat };
}

/**
 * Convert a Three.js world position + quaternion back into a ROS Pose.
 */
export function threeTransformToRosPose(
  threePos: [number, number, number],
  threeQuat: THREE.Quaternion,
): Pose {
  const xyz = threeVec3ToRos(threePos);
  const rosQuat = THREE_TO_ROS_QUAT.clone().multiply(threeQuat);
  const rpy = quaternionToRosRpy(rosQuat);
  return {
    xyz: [round6(xyz[0]), round6(xyz[1]), round6(xyz[2])],
    rpy: [round6(rpy[0]), round6(rpy[1]), round6(rpy[2])],
  };
}

/**
 * Compute the URDF <joint><origin> relative pose from parent link frame to child link frame
 * when parent mount and child mount coincide at joint value q = 0.
 *   T_parent_to_child = T_parent_mount * inv(T_child_mount)
 */
export function computeJointOriginPose(
  parentLink: Link,
  parentMountId: string,
  childLink: Link,
  childMountId: string,
): Pose {
  const pMount = parentLink.mounts.find((m) => m.id === parentMountId);
  const cMount = childLink.mounts.find((m) => m.id === childMountId);
  const tParentMount = pMount ? poseToRosMatrix(pMount.pose) : new THREE.Matrix4().identity();
  const tChildMount = cMount ? poseToRosMatrix(cMount.pose) : new THREE.Matrix4().identity();
  const rel = tParentMount.clone().multiply(tChildMount.clone().invert());
  return rosMatrixToPose(rel);
}

/**
 * Compute world-frame ROS matrices for every link in the robot using forward kinematics
 * from rootLinkId along joints (optionally applying jointValues map q in meters/radians).
 */
export function computeLinkWorldMatrices(
  links: Link[],
  joints: Joint[],
  rootLinkId: string,
  jointValues?: Record<string, number>,
): Map<string, THREE.Matrix4> {
  const result = new Map<string, THREE.Matrix4>();
  const linkMap = new Map(links.map((l) => [l.id, l]));

  const root = linkMap.get(rootLinkId) ?? links[0];
  if (!root) return result;

  result.set(root.id, new THREE.Matrix4().identity());

  const outgoing = new Map<string, Joint[]>();
  for (const joint of joints) {
    const list = outgoing.get(joint.parent.linkId) ?? [];
    list.push(joint);
    outgoing.set(joint.parent.linkId, list);
  }

  const queue: string[] = [root.id];
  const visited = new Set<string>([root.id]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const parentLink = linkMap.get(currentId);
    const parentMatrix = result.get(currentId);
    if (!parentLink || !parentMatrix) continue;

    for (const joint of outgoing.get(currentId) ?? []) {
      if (visited.has(joint.child.linkId)) continue;
      const childLink = linkMap.get(joint.child.linkId);
      if (!childLink) continue;

      const originPose = computeJointOriginPose(
        parentLink,
        joint.parent.mountId,
        childLink,
        joint.child.mountId,
      );
      const tOrigin = poseToRosMatrix(originPose);

      const q = jointValues?.[joint.id] ?? 0;
      const tMotion = new THREE.Matrix4().identity();
      const axis = new THREE.Vector3(joint.axis[0], joint.axis[1], joint.axis[2]);
      if (axis.lengthSq() > 1e-12) {
        axis.normalize();
        if (joint.type === 'revolute' || joint.type === 'continuous') {
          tMotion.makeRotationAxis(axis, q);
        } else if (joint.type === 'prismatic') {
          tMotion.makeTranslation(axis.x * q, axis.y * q, axis.z * q);
        }
      }

      const childMatrix = parentMatrix.clone().multiply(tOrigin).multiply(tMotion);
      result.set(childLink.id, childMatrix);
      visited.add(childLink.id);
      queue.push(childLink.id);
    }
  }

  // Unattached links share the global origin (0, 0, 0)
  for (const link of links) {
    if (!result.has(link.id)) {
      result.set(link.id, new THREE.Matrix4().identity());
    }
  }

  return result;
}
