import type { Inertia, Pose, Primitive, WorldObjectSource } from '@/core/schema';

export type TreeSource = Extract<WorldObjectSource, { type: 'tree' }>;

export interface TreePartSpec {
  id: string;
  role: 'trunk' | 'foliage';
  /** Collision / MuJoCo primitive shape */
  physicsShape: Primitive;
  /** Visual hint for pine cone tiers vs regular primitives */
  visualKind: 'cylinder' | 'sphere' | 'cone';
  pose: Pose;
  rgba: [number, number, number, number];
}

export const DEFAULT_TRUNK_COLOR: [number, number, number, number] = [0.42, 0.27, 0.16, 1.0];
export const DEFAULT_DECIDUOUS_COLOR: [number, number, number, number] = [0.18, 0.48, 0.22, 1.0];
export const DEFAULT_PINE_COLOR: [number, number, number, number] = [0.13, 0.36, 0.19, 1.0];

export function createDefaultTreeSource(style: 'deciduous' | 'pine' = 'deciduous'): TreeSource {
  if (style === 'pine') {
    return {
      type: 'tree',
      style: 'pine',
      trunkRadius: 0.12,
      trunkHeight: 0.9,
      canopyRadius: 0.85,
      canopyHeight: 2.1,
      trunkColor: [...DEFAULT_TRUNK_COLOR],
      foliageColor: [...DEFAULT_PINE_COLOR],
    };
  }
  return {
    type: 'tree',
    style: 'deciduous',
    trunkRadius: 0.14,
    trunkHeight: 1.1,
    canopyRadius: 0.95,
    canopyHeight: 1.5,
    trunkColor: [...DEFAULT_TRUNK_COLOR],
    foliageColor: [...DEFAULT_DECIDUOUS_COLOR],
  };
}

export function computeTreeDimensionsForCanopy(
  canopyRadiusM: number,
  targetHeightM = 3.2,
  style: 'deciduous' | 'pine' = 'deciduous',
): {
  canopyRadius: number;
  trunkRadius: number;
  trunkHeight: number;
  canopyHeight: number;
} {
  const r = Math.max(0.25, Number(canopyRadiusM.toFixed(2)));
  // Real trees with wide canopies also grow taller so trunk & crown stay proportional
  const effectiveH = Math.max(1.2, targetHeightM, r * 2.1);
  const trunkRatio = style === 'pine' ? 0.34 : 0.4;
  const trunkH = Number(Math.max(0.45, effectiveH * trunkRatio).toFixed(2));
  const canopyH = Number(Math.max(0.5, effectiveH * (1 - trunkRatio * 0.72)).toFixed(2));
  const trunkR = Number(Math.max(0.08, Math.min(r * 0.25, r * 0.18)).toFixed(2));
  return {
    canopyRadius: r,
    trunkRadius: trunkR,
    trunkHeight: trunkH,
    canopyHeight: canopyH,
  };
}

/**
 * Decompose a parametric tree model into trunk + canopy parts in local ROS coordinates
 * with base of trunk at z = 0.
 */
export function getTreeParts(tree: TreeSource): TreePartSpec[] {
  const trunkR = Math.max(0.03, tree.trunkRadius);
  const trunkH = Math.max(0.2, tree.trunkHeight);
  const canopyR = Math.max(0.15, tree.canopyRadius);
  const canopyH = Math.max(0.3, tree.canopyHeight);

  const trunkColor = tree.trunkColor ?? DEFAULT_TRUNK_COLOR;
  const foliageColor =
    tree.foliageColor ??
    (tree.style === 'pine' ? DEFAULT_PINE_COLOR : DEFAULT_DECIDUOUS_COLOR);

  const parts: TreePartSpec[] = [
    {
      id: 'trunk',
      role: 'trunk',
      physicsShape: { kind: 'cylinder', radius: trunkR, length: trunkH },
      visualKind: 'cylinder',
      pose: { xyz: [0, 0, trunkH / 2], rpy: [0, 0, 0] },
      rgba: trunkColor,
    },
  ];

  if (tree.style === 'pine') {
    const tierCount = 3;
    const tierHeight = canopyH * 0.48;
    // Keep bottom cone base well above ground so the brown trunk stays clearly visible
    const baseZ = Math.max(trunkH * 0.78 + tierHeight * 0.5, trunkH + tierHeight * 0.36);
    const stepZ = (canopyH - tierHeight * 0.5) / tierCount;

    for (let i = 0; i < tierCount; i++) {
      const scale = 1 - i * 0.25;
      const tierR = Math.max(0.1, canopyR * scale);
      const tierL = Math.max(0.2, tierHeight * (1 - i * 0.1));
      const z = baseZ + i * stepZ;
      parts.push({
        id: `canopy_tier_${i}`,
        role: 'foliage',
        // MuJoCo uses cylinder collision matching average cone radius (~0.62 * base radius)
        physicsShape: { kind: 'cylinder', radius: Math.max(0.06, tierR * 0.62), length: tierL },
        visualKind: 'cone',
        pose: { xyz: [0, 0, z], rpy: [0, 0, 0] },
        rgba: foliageColor,
      });
    }
  } else {
    const mainR = Math.max(0.15, canopyR * 0.72);
    // Keep lowest canopy sphere bottom at or above ~75% of trunk height so trunk is never buried
    const mainZ = Math.max(trunkH * 0.75 + mainR, trunkH + canopyH * 0.46);
    parts.push({
      id: 'canopy_core',
      role: 'foliage',
      physicsShape: { kind: 'sphere', radius: mainR },
      visualKind: 'sphere',
      pose: { xyz: [0, 0, mainZ], rpy: [0, 0, 0] },
      rgba: foliageColor,
    });

    const clusterR = Math.max(0.12, canopyR * 0.52);
    const radialOffset = canopyR * 0.42;
    const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
    const minLobeZ = trunkH * 0.7 + clusterR;
    angles.forEach((ang, idx) => {
      parts.push({
        id: `canopy_lobe_${idx}`,
        role: 'foliage',
        physicsShape: { kind: 'sphere', radius: clusterR },
        visualKind: 'sphere',
        pose: {
          xyz: [
            Math.cos(ang) * radialOffset,
            Math.sin(ang) * radialOffset,
            Math.max(minLobeZ, mainZ - canopyH * 0.08 + idx * 0.04),
          ],
          rpy: [0, 0, 0],
        },
        rgba: foliageColor,
      });
    });

    parts.push({
      id: 'canopy_crown',
      role: 'foliage',
      physicsShape: { kind: 'sphere', radius: Math.max(0.12, canopyR * 0.56) },
      visualKind: 'sphere',
      pose: {
        xyz: [0, 0, mainZ + Math.max(canopyH * 0.25, mainR * 0.4)],
        rpy: [0, 0, 0],
      },
      rgba: foliageColor,
    });
  }

  return parts;
}

export function getPineTierVisualRadius(tree: TreeSource, tierIndex: number): number {
  const canopyR = Math.max(0.15, tree.canopyRadius);
  return Math.max(0.1, canopyR * (1 - tierIndex * 0.25));
}

/**
 * Compute composite mass, center of mass Z, and diagonal inertia for a dynamic tree body.
 */
export function computeTreeInertial(
  tree: TreeSource,
  totalMass = 35,
): { mass: number; com: [number, number, number]; inertia: Inertia } {
  const m = Math.max(0.5, totalMass);
  const trunkH = Math.max(0.2, tree.trunkHeight);
  const trunkR = Math.max(0.03, tree.trunkRadius);
  const canopyR = Math.max(0.15, tree.canopyRadius);
  const canopyH = Math.max(0.3, tree.canopyHeight);

  // Trunk carries ~60% of weight near lower half; canopy carries ~40% higher up
  const trunkMass = m * 0.6;
  const canopyMass = m * 0.4;
  const trunkZ = trunkH * 0.5;
  const canopyZ = trunkH + canopyH * 0.45;

  const comZ = (trunkMass * trunkZ + canopyMass * canopyZ) / m;

  // Approximate diagonal inertia around composite CoM using parallel-axis theorem
  const dzTrunk = trunkZ - comZ;
  const dzCanopy = canopyZ - comZ;

  const trunkIxx = (trunkMass / 12) * (3 * trunkR * trunkR + trunkH * trunkH) + trunkMass * dzTrunk * dzTrunk;
  const trunkIzz = 0.5 * trunkMass * trunkR * trunkR;

  const canopyIxx = (2 / 5) * canopyMass * canopyR * canopyR + canopyMass * dzCanopy * dzCanopy;
  const canopyIzz = (2 / 5) * canopyMass * canopyR * canopyR;

  const ixx = Math.max(0.05, trunkIxx + canopyIxx);
  const iyy = ixx;
  const izz = Math.max(0.02, trunkIzz + canopyIzz);

  return {
    mass: m,
    com: [0, 0, comZ],
    inertia: { ixx, ixy: 0, ixz: 0, iyy, iyz: 0, izz },
  };
}
