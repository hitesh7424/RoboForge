import { describe, expect, it } from 'vitest';
import {
  computeTreeInertial,
  createDefaultTreeSource,
  getPineTierVisualRadius,
  getTreeParts,
} from '@/core/treeGeometry';

describe('Dynamic tree geometry & inertial calculations', () => {
  it('builds deciduous and pine tree decompositions grounded at z=0', () => {
    const deciduous = createDefaultTreeSource('deciduous');
    const decParts = getTreeParts(deciduous);
    expect(decParts[0]?.id).toBe('trunk');
    expect(decParts[0]?.pose.xyz[2]).toBeCloseTo(deciduous.trunkHeight / 2, 5);
    expect(decParts.length).toBeGreaterThanOrEqual(5);

    const pine = createDefaultTreeSource('pine');
    const pineParts = getTreeParts(pine);
    expect(pineParts[0]?.id).toBe('trunk');
    expect(pineParts.filter((p) => p.visualKind === 'cone')).toHaveLength(3);
    expect(getPineTierVisualRadius(pine, 0)).toBeGreaterThan(getPineTierVisualRadius(pine, 2));
  });

  it('computes positive finite inertial properties above ground', () => {
    const tree = createDefaultTreeSource('deciduous');
    const inertial = computeTreeInertial(tree, 40);
    expect(inertial.mass).toBe(40);
    expect(inertial.com[2]).toBeGreaterThan(0);
    expect(inertial.inertia.ixx).toBeGreaterThan(0);
    expect(inertial.inertia.iyy).toBeGreaterThan(0);
    expect(inertial.inertia.izz).toBeGreaterThan(0);
    expect(Number.isFinite(inertial.inertia.ixx)).toBe(true);
  });
});
