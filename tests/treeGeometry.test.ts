import { describe, expect, it } from 'vitest';
import {
  computeTreeDimensionsForCanopy,
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

  it('scales trunk proportionally for wide canopies and keeps foliage clear of lower trunk', () => {
    const dims = computeTreeDimensionsForCanopy(6, 3.2, 'deciduous');
    expect(dims.trunkHeight).toBeGreaterThanOrEqual(4.5);
    expect(dims.trunkRadius).toBeGreaterThanOrEqual(0.8);

    const wideOak = {
      ...createDefaultTreeSource('deciduous'),
      ...dims,
    };
    const parts = getTreeParts(wideOak);
    const foliage = parts.filter((p) => p.role === 'foliage');
    expect(foliage.length).toBeGreaterThan(0);
    for (const f of foliage) {
      const r = f.physicsShape.kind === 'sphere' ? f.physicsShape.radius : 0;
      expect(f.pose.xyz[2] - r).toBeGreaterThanOrEqual(wideOak.trunkHeight * 0.65);
    }

    const pineDims = computeTreeDimensionsForCanopy(5, 3.2, 'pine');
    const widePine = { ...createDefaultTreeSource('pine'), ...pineDims };
    const pineFoliage = getTreeParts(widePine).filter((p) => p.role === 'foliage');
    for (const f of pineFoliage) {
      const halfL = f.physicsShape.kind === 'cylinder' ? f.physicsShape.length / 2 : 0;
      expect(f.pose.xyz[2] - halfL).toBeGreaterThanOrEqual(widePine.trunkHeight * 0.7);
    }
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
