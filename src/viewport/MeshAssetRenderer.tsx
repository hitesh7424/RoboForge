import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { poseToRosMatrix } from '@/core/coords';
import type { Asset, Geometry, Material, Pose, Primitive } from '@/core/schema';
import {
  buildCompoundCsgGeometry,
  createPrimitiveBufferGeometry,
  loadAssetObject3D,
} from '@/viewport/geometryBuilder';

interface PrimitiveMeshProps {
  shape: Primitive;
  colorHex: string;
  opacity?: number;
  wireframe?: boolean;
  pose?: Pose;
  onClick?: () => void;
}

function toHexColor(rgba: Material['rgba']): { color: string; opacity: number } {
  const c = new THREE.Color(rgba[0], rgba[1], rgba[2]);
  return { color: `#${c.getHexString()}`, opacity: rgba[3] };
}

function poseToArray(pose?: Pose): {
  position: [number, number, number];
  quaternion: THREE.Quaternion;
} {
  if (!pose) {
    return { position: [0, 0, 0], quaternion: new THREE.Quaternion() };
  }
  const mat = poseToRosMatrix(pose);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mat.decompose(pos, quat, scale);
  return { position: [pos.x, pos.y, pos.z], quaternion: quat };
}

export function PrimitiveMesh({
  shape,
  colorHex,
  opacity = 1,
  wireframe = false,
  pose,
  onClick,
}: PrimitiveMeshProps) {
  const geometry = useMemo(() => createPrimitiveBufferGeometry(shape), [shape]);
  const { position, quaternion } = useMemo(() => poseToArray(pose), [pose]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <mesh
      geometry={geometry}
      position={position}
      quaternion={quaternion}
      castShadow={!wireframe}
      receiveShadow={!wireframe}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      <meshStandardMaterial
        color={colorHex}
        roughness={0.5}
        metalness={0.18}
        wireframe={wireframe}
        transparent={opacity < 0.999}
        opacity={opacity}
      />
    </mesh>
  );
}

interface MeshAssetObjectProps {
  asset: Asset;
  scale: [number, number, number];
  wireframe?: boolean;
  colorHex?: string;
  opacity?: number;
}

export function MeshAssetObject({
  asset,
  scale,
  wireframe = false,
  colorHex,
  opacity = 1,
}: MeshAssetObjectProps) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    loadAssetObject3D(asset)
      .then((loaded) => {
        if (!active) return;
        loaded.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = !wireframe;
            child.receiveShadow = !wireframe;
            if (wireframe && child.material) {
              child.material = new THREE.MeshStandardMaterial({
                color: colorHex ?? '#34d399',
                wireframe: true,
                transparent: opacity < 0.999,
                opacity,
              });
            }
          }
        });
        setObject(loaded);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to parse mesh asset');
      });
    return () => {
      active = false;
    };
  }, [asset, wireframe, colorHex, opacity]);

  if (error || !object) {
    return (
      <mesh scale={scale}>
        <boxGeometry args={[0.2, 0.2, 0.2]} />
        <meshStandardMaterial color={error ? '#ef4444' : '#64748b'} wireframe />
      </mesh>
    );
  }

  return <primitive object={object} scale={scale} />;
}

interface GeometryRendererProps {
  geometry: Geometry;
  material: Material;
  assets: Asset[];
  pose?: Pose;
  wireframe?: boolean;
  overrideColor?: string;
  overrideOpacity?: number;
  onClick?: () => void;
}

export function GeometryRenderer({
  geometry,
  material,
  assets,
  pose,
  wireframe = false,
  overrideColor,
  overrideOpacity,
  onClick,
}: GeometryRendererProps) {
  const { color: matColor, opacity: matOpacity } = toHexColor(material.rgba);
  const colorHex = overrideColor ?? matColor;
  const opacity = overrideOpacity ?? matOpacity;
  const { position, quaternion } = useMemo(() => poseToArray(pose), [pose]);

  const hasBooleanSubtract =
    geometry.type === 'compound' && geometry.parts.some((p) => p.op === 'subtract');

  const csgGeometry = useMemo(() => {
    if (geometry.type === 'compound' && hasBooleanSubtract) {
      return buildCompoundCsgGeometry(geometry.parts);
    }
    return null;
  }, [geometry, hasBooleanSubtract]);

  useEffect(() => {
    return () => {
      csgGeometry?.dispose();
    };
  }, [csgGeometry]);

  return (
    <group position={position} quaternion={quaternion}>
      {geometry.type === 'primitive' && (
        <PrimitiveMesh
          shape={geometry.shape}
          colorHex={colorHex}
          opacity={opacity}
          wireframe={wireframe}
          onClick={onClick}
        />
      )}

      {geometry.type === 'compound' && hasBooleanSubtract && csgGeometry && (
        <mesh
          geometry={csgGeometry}
          castShadow={!wireframe}
          receiveShadow={!wireframe}
          onClick={
            onClick
              ? (e) => {
                  e.stopPropagation();
                  onClick();
                }
              : undefined
          }
        >
          <meshStandardMaterial
            color={colorHex}
            roughness={0.45}
            metalness={0.22}
            wireframe={wireframe}
            transparent={opacity < 0.999}
            opacity={opacity}
          />
        </mesh>
      )}

      {geometry.type === 'compound' &&
        !hasBooleanSubtract &&
        geometry.parts.map((part) => (
          <PrimitiveMesh
            key={part.id}
            shape={part.shape}
            pose={part.pose}
            colorHex={colorHex}
            opacity={opacity}
            wireframe={wireframe}
            onClick={onClick}
          />
        ))}

      {geometry.type === 'mesh' &&
        (() => {
          const asset = assets.find((a) => a.id === geometry.assetId);
          if (!asset) {
            return (
              <mesh
                scale={geometry.scale}
                onClick={
                  onClick
                    ? (e) => {
                        e.stopPropagation();
                        onClick();
                      }
                    : undefined
                }
              >
                <boxGeometry args={[0.25, 0.25, 0.25]} />
                <meshStandardMaterial color="#ef4444" wireframe />
              </mesh>
            );
          }
          return (
            <group
              onClick={
                onClick
                  ? (e) => {
                      e.stopPropagation();
                      onClick();
                    }
                  : undefined
              }
            >
              <MeshAssetObject
                asset={asset}
                scale={geometry.scale}
                wireframe={wireframe}
                colorHex={overrideColor}
                opacity={overrideOpacity}
              />
            </group>
          );
        })()}
    </group>
  );
}
