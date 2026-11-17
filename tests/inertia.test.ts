import { describe, expect, it } from 'vitest';
import {
  checkInertiaWarnings,
  computeGeometryInertia,
  computePrimitiveInertia,
} from '@/core/inertia';

describe('Inertia calculations & physicality checks', () => {
  it('computes analytical box inertia tensor', () => {
    // 12 kg box of 1m x 2m x 3m => Ixx = 1*(4+9)=13, Iyy = 1*(1+9)=10, Izz = 1*(1+4)=5
    const i = computePrimitiveInertia({ kind: 'box', size: [1, 2, 3] }, 12);
    expect(i.ixx).toBeCloseTo(13, 6);
    expect(i.iyy).toBeCloseTo(10, 6);
    expect(i.izz).toBeCloseTo(5, 6);
    expect(i.ixy).toBe(0);
  });

  it('computes analytical cylinder and sphere inertia tensors', () => {
    const cyl = computePrimitiveInertia({ kind: 'cylinder', radius: 0.1, length: 0.4 }, 3);
    expect(cyl.izz).toBeCloseTo(0.5 * 3 * 0.01, 6);
    expect(cyl.ixx).toBeCloseTo((3 / 12) * (3 * 0.01 + 0.16), 6);

    const sph = computePrimitiveInertia({ kind: 'sphere', radius: 0.2 }, 5);
    const expectedSph = (2 / 5) * 5 * 0.04;
    expect(sph.ixx).toBeCloseTo(expectedSph, 6);
    expect(sph.iyy).toBeCloseTo(expectedSph, 6);
    expect(sph.izz).toBeCloseTo(expectedSph, 6);
  });

  it('computes compound inertia using volume weighting and parallel-axis theorem', () => {
    const res = computeGeometryInertia(
      {
        type: 'compound',
        parts: [
          {
            id: 'p1',
            shape: { kind: 'box', size: [0.2, 0.2, 0.2] },
            pose: { xyz: [-0.5, 0, 0], rpy: [0, 0, 0] },
            op: 'add',
          },
          {
            id: 'p2',
            shape: { kind: 'box', size: [0.2, 0.2, 0.2] },
            pose: { xyz: [0.5, 0, 0], rpy: [0, 0, 0] },
            op: 'add',
          },
        ],
      },
      2.0,
    );

    expect(res.centerOfMass[0]).toBeCloseTo(0, 6);
    expect(res.centerOfMass[1]).toBeCloseTo(0, 6);
    expect(res.centerOfMass[2]).toBeCloseTo(0, 6);
    // Each 1kg cube is 0.5m from CoM: m*d^2 = 1 * 0.25 per cube => +0.5 on iyy & izz
    const singleBox = computePrimitiveInertia({ kind: 'box', size: [0.2, 0.2, 0.2] }, 1.0);
    expect(res.inertia.ixx).toBeCloseTo(2 * singleBox.ixx, 5);
    expect(res.inertia.iyy).toBeCloseTo(2 * (singleBox.iyy + 0.25), 5);
    expect(res.inertia.izz).toBeCloseTo(2 * (singleBox.izz + 0.25), 5);
  });

  it('flags non-physical inertia tensors and dangerously tiny masses', () => {
    const warnings = checkInertiaWarnings(
      { ixx: 0.01, ixy: 0, ixz: 0, iyy: 0.01, iyz: 0, izz: 0.5 },
      0.0005,
    );
    expect(warnings.some((w) => w.includes('below 0.001 kg'))).toBe(true);
    expect(warnings.some((w) => w.includes('triangle inequality'))).toBe(true);
  });
});
