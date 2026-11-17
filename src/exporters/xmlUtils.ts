import type { Link, Pose, Vec3 } from '@/core/schema';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function fmt(n: number, decimals = 6): string {
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(n * factor) / factor;
  const clean = Object.is(rounded, -0) ? 0 : rounded;
  return Number.isInteger(clean) ? String(clean) : String(clean);
}

export function fmtVec3(v: Vec3, decimals = 6): string {
  return `${fmt(v[0], decimals)} ${fmt(v[1], decimals)} ${fmt(v[2], decimals)}`;
}

type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

function rpyToMat3([roll, pitch, yaw]: Vec3): Mat3 {
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);

  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

function mat3ToRpy(m: Mat3): Vec3 {
  const sy = -m[2][0];
  const clampSy = Math.max(-1, Math.min(1, sy));
  const pitch = Math.asin(clampSy);
  if (Math.abs(clampSy) < 0.999999) {
    const roll = Math.atan2(m[2][1], m[2][2]);
    const yaw = Math.atan2(m[1][0], m[0][0]);
    return [roll, pitch, yaw];
  }
  const roll = Math.atan2(-m[1][2], m[1][1]);
  return [roll, pitch, 0];
}

function mulMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
    ],
    [
      a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
      a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
      a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
    ],
  ];
}

function mulMat3Vec3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function transposeMat3(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

export function composePoses(a: Pose, b: Pose): Pose {
  const ra = rpyToMat3(a.rpy);
  const rb = rpyToMat3(b.rpy);
  const rOut = mulMat3(ra, rb);
  const rotatedB = mulMat3Vec3(ra, b.xyz);
  return {
    xyz: [a.xyz[0] + rotatedB[0], a.xyz[1] + rotatedB[1], a.xyz[2] + rotatedB[2]],
    rpy: mat3ToRpy(rOut),
  };
}

export function invertPose(p: Pose): Pose {
  const rT = transposeMat3(rpyToMat3(p.rpy));
  const negT = mulMat3Vec3(rT, [-p.xyz[0], -p.xyz[1], -p.xyz[2]]);
  return {
    xyz: negT,
    rpy: mat3ToRpy(rT),
  };
}

export function computePureJointOriginPose(
  parentLink: Link,
  parentMountId: string,
  childLink: Link,
  childMountId: string,
): Pose {
  const pMount = parentLink.mounts.find((m) => m.id === parentMountId);
  const cMount = childLink.mounts.find((m) => m.id === childMountId);
  const tParent = pMount?.pose ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] };
  const tChild = cMount?.pose ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] };
  return composePoses(tParent, invertPose(tChild));
}

export function fmtPoseSdf(p: Pose): string {
  return `${fmtVec3(p.xyz)} ${fmtVec3(p.rpy)}`;
}

/**
 * Convert extrinsic XYZ RPY (intrinsic ZYX) radians to MuJoCo quaternion [w, x, y, z].
 */
export function rpyToQuatWxyz([roll, pitch, yaw]: Vec3): [number, number, number, number] {
  const hr = roll * 0.5;
  const hp = pitch * 0.5;
  const hy = yaw * 0.5;

  const cr = Math.cos(hr);
  const sr = Math.sin(hr);
  const cp = Math.cos(hp);
  const sp = Math.sin(hp);
  const cy = Math.cos(hy);
  const sy = Math.sin(hy);

  const w = cr * cp * cy + sr * sp * sy;
  const x = sr * cp * cy - cr * sp * sy;
  const y = cr * sp * cy + sr * cp * sy;
  const z = cr * cp * sy - sr * sp * cy;
  return [w, x, y, z];
}
