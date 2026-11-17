import * as THREE from 'three';
import { rosRpyToQuaternion } from '@/core/coords';
import type { Geometry, Inertia, Link, Pose, Primitive, Vec3 } from '@/core/schema';

export interface InertiaResult {
  inertia: Inertia;
  centerOfMass: Vec3;
  volume: number;
  warnings: string[];
}

export function computePrimitiveVolume(shape: Primitive): number {
  switch (shape.kind) {
    case 'box':
      return Math.max(0, shape.size[0] * shape.size[1] * shape.size[2]);
    case 'cylinder':
      return Math.max(0, Math.PI * shape.radius * shape.radius * shape.length);
    case 'sphere':
      return Math.max(0, (4 / 3) * Math.PI * Math.pow(shape.radius, 3));
    case 'capsule': {
      const cylVol = Math.PI * shape.radius * shape.radius * shape.length;
      const sphVol = (4 / 3) * Math.PI * Math.pow(shape.radius, 3);
      return Math.max(0, cylVol + sphVol);
    }
    case 'extrude': {
      const area = computePolygonArea(shape.points);
      return Math.max(0, area * shape.depth);
    }
  }
}

export function computePolygonArea(points: [number, number][]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function computePrimitiveInertia(shape: Primitive, mass: number): Inertia {
  const m = Math.max(0, mass);
  switch (shape.kind) {
    case 'box': {
      const [x, y, z] = shape.size;
      return {
        ixx: (m / 12) * (y * y + z * z),
        ixy: 0,
        ixz: 0,
        iyy: (m / 12) * (x * x + z * z),
        iyz: 0,
        izz: (m / 12) * (x * x + y * y),
      };
    }
    case 'cylinder': {
      const r = shape.radius;
      const h = shape.length;
      const ixx = (m / 12) * (3 * r * r + h * h);
      return {
        ixx,
        ixy: 0,
        ixz: 0,
        iyy: ixx,
        iyz: 0,
        izz: (m * r * r) / 2,
      };
    }
    case 'sphere': {
      const r = shape.radius;
      const i = (2 / 5) * m * r * r;
      return {
        ixx: i,
        ixy: 0,
        ixz: 0,
        iyy: i,
        iyz: 0,
        izz: i,
      };
    }
    case 'capsule': {
      const r = shape.radius;
      const h = shape.length;
      const cylVol = Math.PI * r * r * h;
      const sphVol = (4 / 3) * Math.PI * r * r * r;
      const totalVol = cylVol + sphVol;
      if (totalVol <= 0) {
        return { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 };
      }
      const mCyl = m * (cylVol / totalVol);
      const mSph = m * (sphVol / totalVol);
      const ixx =
        mCyl * ((r * r) / 4 + (h * h) / 12) +
        mSph * ((2 * r * r) / 5 + (h * h) / 4 + (3 * h * r) / 8);
      const izz = mCyl * ((r * r) / 2) + mSph * ((2 * r * r) / 5);
      return {
        ixx,
        ixy: 0,
        ixz: 0,
        iyy: ixx,
        iyz: 0,
        izz,
      };
    }
    case 'extrude': {
      const xs = shape.points.map((p) => p[0]);
      const ys = shape.points.map((p) => p[1]);
      const dx = Math.max(0.01, Math.max(...xs) - Math.min(...xs));
      const dy = Math.max(0.01, Math.max(...ys) - Math.min(...ys));
      const dz = Math.max(0.01, shape.depth);
      return {
        ixx: (m / 12) * (dy * dy + dz * dz),
        ixy: 0,
        ixz: 0,
        iyy: (m / 12) * (dx * dx + dz * dz),
        iyz: 0,
        izz: (m / 12) * (dx * dx + dy * dy),
      };
    }
  }
}

function rotateInertiaTensor(inertia: Inertia, pose: Pose): Inertia {
  const q = rosRpyToQuaternion(pose.rpy);
  const rotMat = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationFromQuaternion(q),
  );
  const r = rotMat.elements; // column-major: r[0..2]=col0, r[3..5]=col1, r[6..8]=col2
  const r00 = r[0]!,
    r10 = r[1]!,
    r20 = r[2]!;
  const r01 = r[3]!,
    r11 = r[4]!,
    r21 = r[5]!;
  const r02 = r[6]!,
    r12 = r[7]!,
    r22 = r[8]!;

  // I matrix
  const I = [
    [inertia.ixx, inertia.ixy, inertia.ixz],
    [inertia.ixy, inertia.iyy, inertia.iyz],
    [inertia.ixz, inertia.iyz, inertia.izz],
  ] as const;

  const R = [
    [r00, r01, r02],
    [r10, r11, r12],
    [r20, r21, r22],
  ] as const;

  // Compute R * I * R^T
  const RI: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      RI[i]![j] = R[i]![0]! * I[0]![j]! + R[i]![1]! * I[1]![j]! + R[i]![2]! * I[2]![j]!;
    }
  }

  const out: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i]![j] = RI[i]![0]! * R[j]![0]! + RI[i]![1]! * R[j]![1]! + RI[i]![2]! * R[j]![2]!;
    }
  }

  return {
    ixx: out[0]![0]!,
    ixy: out[0]![1]!,
    ixz: out[0]![2]!,
    iyy: out[1]![1]!,
    iyz: out[1]![2]!,
    izz: out[2]![2]!,
  };
}

function shiftInertiaParallelAxis(inertia: Inertia, mass: number, offset: Vec3): Inertia {
  const [dx, dy, dz] = offset;
  return {
    ixx: inertia.ixx + mass * (dy * dy + dz * dz),
    ixy: inertia.ixy - mass * (dx * dy),
    ixz: inertia.ixz - mass * (dx * dz),
    iyy: inertia.iyy + mass * (dx * dx + dz * dz),
    iyz: inertia.iyz - mass * (dy * dz),
    izz: inertia.izz + mass * (dx * dx + dy * dy),
  };
}

export function checkInertiaWarnings(inertia: Inertia, mass: number): string[] {
  const warnings: string[] = [];
  if (mass < 0.001) {
    warnings.push(`Mass (${mass} kg) is below 0.001 kg and may cause Gazebo solver instability.`);
  }
  if (inertia.ixx <= 0 || inertia.iyy <= 0 || inertia.izz <= 0) {
    warnings.push('Principal moments of inertia (ixx, iyy, izz) must all be strictly positive.');
  }
  if (
    inertia.ixx + inertia.iyy < inertia.izz - 1e-9 ||
    inertia.ixx + inertia.izz < inertia.iyy - 1e-9 ||
    inertia.iyy + inertia.izz < inertia.ixx - 1e-9
  ) {
    warnings.push('Inertia tensor violates the rigid-body triangle inequality.');
  }
  return warnings;
}

export function computeGeometryInertia(geometry: Geometry, mass: number): InertiaResult {
  if (geometry.type === 'primitive') {
    const volume = computePrimitiveVolume(geometry.shape);
    const inertia = computePrimitiveInertia(geometry.shape, mass);
    return {
      inertia,
      centerOfMass: [0, 0, 0],
      volume,
      warnings: checkInertiaWarnings(inertia, mass),
    };
  }

  if (geometry.type === 'compound') {
    const addParts = geometry.parts.filter((p) => p.op !== 'subtract');
    const partsWithVol = addParts.map((p) => ({
      part: p,
      vol: computePrimitiveVolume(p.shape),
    }));
    const totalVolume = partsWithVol.reduce((acc, item) => acc + item.vol, 0);

    if (totalVolume <= 0 || partsWithVol.length === 0) {
      const fallback = computePrimitiveInertia({ kind: 'box', size: [0.1, 0.1, 0.1] }, mass);
      return {
        inertia: fallback,
        centerOfMass: [0, 0, 0],
        volume: 0,
        warnings: ['Compound geometry has zero positive volume; using fallback box inertia.'],
      };
    }

    // Combined center of mass
    let comX = 0;
    let comY = 0;
    let comZ = 0;
    for (const { part, vol } of partsWithVol) {
      const w = vol / totalVolume;
      comX += part.pose.xyz[0] * w;
      comY += part.pose.xyz[1] * w;
      comZ += part.pose.xyz[2] * w;
    }

    const total: Inertia = { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 };
    for (const { part, vol } of partsWithVol) {
      const partMass = mass * (vol / totalVolume);
      const localI = computePrimitiveInertia(part.shape, partMass);
      const rotatedI = rotateInertiaTensor(localI, part.pose);
      const offset: Vec3 = [
        part.pose.xyz[0] - comX,
        part.pose.xyz[1] - comY,
        part.pose.xyz[2] - comZ,
      ];
      const shiftedI = shiftInertiaParallelAxis(rotatedI, partMass, offset);
      total.ixx += shiftedI.ixx;
      total.ixy += shiftedI.ixy;
      total.ixz += shiftedI.ixz;
      total.iyy += shiftedI.iyy;
      total.iyz += shiftedI.iyz;
      total.izz += shiftedI.izz;
    }

    return {
      inertia: total,
      centerOfMass: [comX, comY, comZ],
      volume: totalVolume,
      warnings: checkInertiaWarnings(total, mass),
    };
  }

  // Mesh fallback: approximate using scaled 0.3m bounding box until mesh bounds are computed
  const [sx, sy, sz] = geometry.scale;
  const approxBox: Primitive = {
    kind: 'box',
    size: [Math.max(0.05, 0.3 * sx), Math.max(0.05, 0.3 * sy), Math.max(0.05, 0.2 * sz)],
  };
  const inertia = computePrimitiveInertia(approxBox, mass);
  return {
    inertia,
    centerOfMass: [0, 0, 0],
    volume: computePrimitiveVolume(approxBox),
    warnings: checkInertiaWarnings(inertia, mass),
  };
}

export function resolveLinkInertia(link: Link): InertiaResult {
  if (!link.inertial.auto && link.inertial.inertia) {
    return {
      inertia: link.inertial.inertia,
      centerOfMass: link.inertial.pose.xyz,
      volume:
        link.visual.geometry.type === 'primitive'
          ? computePrimitiveVolume(link.visual.geometry.shape)
          : 0,
      warnings: checkInertiaWarnings(link.inertial.inertia, link.inertial.mass),
    };
  }
  return computeGeometryInertia(link.visual.geometry, link.inertial.mass);
}
