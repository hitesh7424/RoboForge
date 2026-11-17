import * as THREE from 'three';
import { ADDITION, Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { poseToRosMatrix } from '@/core/coords';
import type { Asset, CompoundPart, Geometry, Mount, Primitive, Vec3 } from '@/core/schema';

/**
 * Build a BufferGeometry in ROS local coordinates (Z up / cylinder & capsule symmetry axis = Z).
 */
export function createPrimitiveBufferGeometry(shape: Primitive): THREE.BufferGeometry {
  switch (shape.kind) {
    case 'box': {
      return new THREE.BoxGeometry(
        Math.max(0.001, shape.size[0]),
        Math.max(0.001, shape.size[1]),
        Math.max(0.001, shape.size[2]),
      );
    }
    case 'cylinder': {
      const geo = new THREE.CylinderGeometry(
        Math.max(0.001, shape.radius),
        Math.max(0.001, shape.radius),
        Math.max(0.001, shape.length),
        28,
      );
      // Align cylinder symmetry axis from Three +Y to ROS +Z
      geo.rotateX(Math.PI / 2);
      return geo;
    }
    case 'sphere': {
      return new THREE.SphereGeometry(Math.max(0.001, shape.radius), 24, 18);
    }
    case 'capsule': {
      const geo = new THREE.CapsuleGeometry(
        Math.max(0.001, shape.radius),
        Math.max(0.001, shape.length),
        10,
        24,
      );
      // Align capsule symmetry axis from Three +Y to ROS +Z
      geo.rotateX(Math.PI / 2);
      return geo;
    }
    case 'extrude': {
      const pts =
        shape.points.length >= 3
          ? shape.points
          : [
              [-0.1, -0.1],
              [0.1, -0.1],
              [0.1, 0.1],
              [-0.1, 0.1],
            ];
      const twoD = new THREE.Shape();
      twoD.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length; i++) {
        twoD.lineTo(pts[i]![0], pts[i]![1]);
      }
      twoD.closePath();

      const depth = Math.max(0.002, shape.depth);
      const geo = new THREE.ExtrudeGeometry(twoD, {
        depth,
        bevelEnabled: false,
        curveSegments: 16,
      });
      // Center extruded profile around Z=0
      geo.translate(0, 0, -depth / 2);
      return geo;
    }
  }
}

/**
 * Evaluate compound parts using three-bvh-csg (supports 'add' and 'subtract' boolean ops).
 */
export function buildCompoundCsgGeometry(parts: CompoundPart[]): THREE.BufferGeometry {
  if (parts.length === 0) {
    return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }

  const evaluator = new Evaluator();
  evaluator.useGroups = false;

  let currentBrush: Brush | null = null;
  const createdGeos: THREE.BufferGeometry[] = [];

  try {
    for (const part of parts) {
      const baseGeo = createPrimitiveBufferGeometry(part.shape);
      // Ensure UV and non-indexed consistency for CSG
      const prepared = baseGeo.index ? baseGeo.toNonIndexed() : baseGeo;
      if (prepared !== baseGeo) baseGeo.dispose();
      prepared.computeVertexNormals();
      if (!prepared.getAttribute('uv')) {
        const count = prepared.getAttribute('position').count;
        prepared.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      }
      createdGeos.push(prepared);

      const mat4 = poseToRosMatrix(part.pose);
      prepared.applyMatrix4(mat4);

      const brush = new Brush(prepared);
      brush.updateMatrixWorld();

      if (!currentBrush) {
        if (part.op === 'subtract') continue;
        currentBrush = brush;
      } else {
        const op = part.op === 'subtract' ? SUBTRACTION : ADDITION;
        const nextBrush: Brush = evaluator.evaluate(currentBrush, brush, op);
        if (currentBrush.geometry !== nextBrush.geometry) {
          currentBrush.geometry.dispose();
        }
        currentBrush = nextBrush;
      }
    }

    if (!currentBrush) {
      return new THREE.BoxGeometry(0.1, 0.1, 0.1);
    }
    const out = currentBrush.geometry.clone();
    out.computeVertexNormals();
    out.computeBoundingBox();
    currentBrush.geometry.dispose();
    return out;
  } catch {
    return createPrimitiveBufferGeometry(parts[0]!.shape);
  } finally {
    for (const g of createdGeos) {
      g.dispose();
    }
  }
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const parsedAssetCache = new Map<string, Promise<THREE.Object3D>>();

export function loadAssetObject3D(asset: Asset): Promise<THREE.Object3D> {
  const cacheKey = `${asset.id}:${asset.byteLength}:${asset.format}`;
  const cached = parsedAssetCache.get(cacheKey);
  if (cached) {
    return cached.then((obj) => obj.clone(true));
  }

  const promise = (async (): Promise<THREE.Object3D> => {
    const buffer = base64ToArrayBuffer(asset.dataBase64);
    if (asset.format === 'stl') {
      const loader = new STLLoader();
      const geo = loader.parse(buffer);
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.45,
        metalness: 0.2,
      });
      return new THREE.Mesh(geo, mat);
    }
    if (asset.format === 'glb') {
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(buffer, '');
      return gltf.scene;
    }
    // Collada (.dae)
    const text = new TextDecoder().decode(buffer);
    const loader = new ColladaLoader();
    const dae = loader.parse(text, '');
    if (!dae) {
      throw new Error('Failed to parse Collada (.dae) asset.');
    }
    return dae.scene;
  })();

  parsedAssetCache.set(cacheKey, promise);
  return promise.then((obj) => obj.clone(true));
}

export interface MountCompatibilityReport {
  mountId: string;
  mountName: string;
  withinBounds: boolean;
  distanceOutsideMeters: number;
}

export async function checkGeometryMountCompatibility(
  geometry: Geometry,
  mounts: Mount[],
  assets: Asset[],
): Promise<{
  bboxMin: Vec3;
  bboxMax: Vec3;
  reports: MountCompatibilityReport[];
}> {
  const box = new THREE.Box3();

  if (geometry.type === 'primitive') {
    const g = createPrimitiveBufferGeometry(geometry.shape);
    g.computeBoundingBox();
    if (g.boundingBox) box.copy(g.boundingBox);
    g.dispose();
  } else if (geometry.type === 'compound') {
    const g = buildCompoundCsgGeometry(geometry.parts);
    g.computeBoundingBox();
    if (g.boundingBox) box.copy(g.boundingBox);
    g.dispose();
  } else {
    const asset = assets.find((a) => a.id === geometry.assetId);
    if (asset) {
      const obj = await loadAssetObject3D(asset);
      obj.scale.set(geometry.scale[0], geometry.scale[1], geometry.scale[2]);
      obj.updateMatrixWorld(true);
      box.setFromObject(obj);
    } else {
      box.set(new THREE.Vector3(-0.15, -0.15, -0.15), new THREE.Vector3(0.15, 0.15, 0.15));
    }
  }

  // Tolerance margin of 5 cm so surface-mounted frames pass cleanly
  const margin = 0.05;
  const expanded = box.clone().expandByScalar(margin);

  const reports: MountCompatibilityReport[] = mounts.map((m) => {
    const pt = new THREE.Vector3(m.pose.xyz[0], m.pose.xyz[1], m.pose.xyz[2]);
    const clamped = pt.clone().clamp(expanded.min, expanded.max);
    const dist = pt.distanceTo(clamped);
    return {
      mountId: m.id,
      mountName: m.name,
      withinBounds: dist <= 1e-4,
      distanceOutsideMeters: Number(dist.toFixed(4)),
    };
  });

  return {
    bboxMin: [box.min.x, box.min.y, box.min.z],
    bboxMax: [box.max.x, box.max.y, box.max.z],
    reports,
  };
}
