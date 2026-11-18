import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  computeMapTileGridForExtent,
  cropTileMosaicToGroundPngBase64,
  DEFAULT_MAP_BACKGROUND,
  formatTileUrl,
  type MapTileGridSpec,
} from '@/core/mapTiles';
import type { Project, TextureAsset } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { buildTerrainBufferGeometry } from '@/core/terrain';
import { getPineTierVisualRadius, getTreeParts, type TreeSource } from '@/core/treeGeometry';
import { PrimitiveMesh, useTextureAsset } from '@/viewport/MeshAssetRenderer';

export function useMapTileMosaicTexture(
  enabled: boolean,
  tileUrl: string,
  tileGrid: MapTileGridSpec,
  landSizeMeters = 100,
  headingDeg = 0,
): THREE.CanvasTexture | null {
  const invalidate = useThree((s) => s.invalidate);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTexture(null);
      return;
    }

    const tilePx = 256;
    const sizePx = tileGrid.gridCount * tilePx;
    const canvas = document.createElement('canvas');
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clean tactical coordinate grid placeholder visible offline or while tiles stream in
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, sizePx, sizePx);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1;
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';

    for (const cell of tileGrid.cells) {
      const px = cell.col * tilePx;
      const py = cell.row * tilePx;
      ctx.strokeRect(px, py, tilePx, tilePx);
      ctx.fillText(`z${tileGrid.zoom} ${cell.tx},${cell.ty}`, px + 8, py + 18);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    setTexture(tex);
    invalidate();

    let cancelled = false;
    let exportTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    const syncExportTexture = () => {
      if (cancelled) return;
      const b64 = cropTileMosaicToGroundPngBase64(
        canvas,
        tileGrid,
        landSizeMeters,
        headingDeg,
        512,
      );
      if (b64) {
        useRoboForgeStore.getState().setMapTileTexture(b64);
      }
    };

    const scheduleSyncExportTexture = () => {
      if (exportTimer !== null) {
        globalThis.clearTimeout(exportTimer);
      }
      exportTimer = globalThis.setTimeout(syncExportTexture, 180);
    };

    const upgradeMixed =
      typeof window !== 'undefined' && window.location.protocol === 'https:';
    const template = tileUrl.trim() || DEFAULT_MAP_BACKGROUND.tileUrl;

    for (const cell of tileGrid.cells) {
      const url = formatTileUrl(template, cell.tx, cell.ty, tileGrid.zoom, upgradeMixed);
      if (!url) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        ctx.drawImage(img, cell.col * tilePx, cell.row * tilePx, tilePx, tilePx);
        tex.needsUpdate = true;
        invalidate();
        scheduleSyncExportTexture();
      };
      img.onerror = () => {
        // Retain coordinate tile fallback when CORS/offline blocks remote tile loading
      };
      img.src = url;
    }

    return () => {
      cancelled = true;
      if (exportTimer !== null) {
        globalThis.clearTimeout(exportTimer);
      }
      tex.dispose();
    };
  }, [enabled, tileUrl, tileGrid, landSizeMeters, headingDeg, invalidate]);

  return texture;
}

export function WorldGroundTerrainMesh({
  ground,
  mapBackground,
  textures,
  soft,
  isEditingWorld,
  onSelectWorld,
}: {
  ground: Project['world']['ground'];
  mapBackground?: Project['world']['mapBackground'];
  textures: TextureAsset[];
  soft: boolean;
  isEditingWorld?: boolean;
  onSelectWorld?: () => void;
}) {
  const assignedTexture = useMemo(
    () => (ground.textureId ? textures.find((t) => t.id === ground.textureId) : undefined),
    [ground.textureId, textures],
  );
  const customGroundTex = useTextureAsset(assignedTexture, ground.textureRepeat ?? [8, 8]);

  const mapEnabled = Boolean(mapBackground?.enabled);
  const landSize = Math.max(
    10,
    mapBackground?.landSizeMeters ?? DEFAULT_MAP_BACKGROUND.landSizeMeters,
  );
  const segments = Math.max(
    4,
    Math.min(96, Math.round(mapBackground?.terrainSegments ?? DEFAULT_MAP_BACKGROUND.terrainSegments)),
  );

  const tileGrid = useMemo(
    () =>
      computeMapTileGridForExtent(
        mapBackground?.latitude ?? DEFAULT_MAP_BACKGROUND.latitude,
        mapBackground?.longitude ?? DEFAULT_MAP_BACKGROUND.longitude,
        mapBackground?.zoom ?? DEFAULT_MAP_BACKGROUND.zoom,
        landSize,
      ),
    [mapBackground?.latitude, mapBackground?.longitude, mapBackground?.zoom, landSize],
  );

  const mapTex = useMapTileMosaicTexture(
    mapEnabled,
    mapBackground?.tileUrl ?? DEFAULT_MAP_BACKGROUND.tileUrl,
    tileGrid,
    landSize,
    mapBackground?.headingDeg ?? 0,
  );

  const terrainGeo = useMemo(() => {
    if (!mapEnabled) return null;
    return buildTerrainBufferGeometry(landSize, mapBackground, tileGrid, segments);
  }, [
    mapEnabled,
    landSize,
    mapBackground?.elevationEnabled,
    mapBackground?.elevationScale,
    mapBackground?.elevationGrid,
    mapBackground?.elevationGridSize,
    mapBackground?.landSizeMeters,
    tileGrid,
    segments,
    mapBackground,
  ]);

  useEffect(() => {
    return () => {
      terrainGeo?.dispose();
    };
  }, [terrainGeo]);

  if (!ground.enabled && !mapEnabled) return null;

  if (mapEnabled && terrainGeo) {
    const headingRad = -((mapBackground?.headingDeg ?? 0) * Math.PI) / 180;
    const opacity = mapBackground?.opacity ?? DEFAULT_MAP_BACKGROUND.opacity;
    const activeMap = customGroundTex ?? mapTex;

    return (
      <group rotation={[0, 0, headingRad]}>
        <mesh
          data-testid="map-tile-ground"
          geometry={terrainGeo}
          receiveShadow={!soft}
          onClick={
            onSelectWorld
              ? (e) => {
                  if (!isEditingWorld) return;
                  e.stopPropagation();
                  onSelectWorld();
                }
              : undefined
          }
        >
          <meshStandardMaterial
            key={activeMap ? 'map-terrain-tex' : 'map-terrain-flat'}
            color={activeMap ? '#ffffff' : '#1b2432'}
            map={activeMap ?? undefined}
            roughness={0.94}
            metalness={0.02}
            transparent={opacity < 0.999}
            opacity={opacity}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    );
  }

  return (
    <mesh
      position={[0, 0, -0.01]}
      receiveShadow={!soft}
      onClick={
        onSelectWorld
          ? (e) => {
              if (!isEditingWorld) return;
              e.stopPropagation();
              onSelectWorld();
            }
          : undefined
      }
    >
      <boxGeometry args={[ground.size[0], ground.size[1], 0.02]} />
      <meshStandardMaterial
        key={customGroundTex ? `ground-tex-${assignedTexture?.id ?? 'none'}` : 'ground-flat'}
        color={customGroundTex ? '#ffffff' : '#151b26'}
        map={customGroundTex ?? undefined}
        roughness={0.92}
        metalness={0.05}
      />
    </mesh>
  );
}

export function TreeObjectVisual({
  source,
  selected = false,
}: {
  source: TreeSource;
  selected?: boolean;
}) {
  const parts = useMemo(() => getTreeParts(source), [source]);

  return (
    <group>
      {parts.map((part) => {
        const hex = selected
          ? '#60a5fa'
          : `#${new THREE.Color(part.rgba[0], part.rgba[1], part.rgba[2]).getHexString()}`;

        if (part.visualKind === 'cone') {
          const tierIdx = Number(part.id.replace('canopy_tier_', ''));
          const coneR = getPineTierVisualRadius(source, Number.isFinite(tierIdx) ? tierIdx : 0);
          const coneH =
            part.physicsShape.kind === 'cylinder' ? part.physicsShape.length : 0.6;
          return (
            <mesh
              key={part.id}
              position={part.pose.xyz}
              rotation={[Math.PI / 2, 0, 0]}
              castShadow
              receiveShadow
            >
              <coneGeometry args={[coneR, coneH, 16]} />
              <meshStandardMaterial color={hex} roughness={0.82} metalness={0.05} />
            </mesh>
          );
        }

        return (
          <PrimitiveMesh
            key={part.id}
            shape={part.physicsShape}
            pose={part.pose}
            colorHex={hex}
            opacity={part.rgba[3]}
          />
        );
      })}
    </group>
  );
}
