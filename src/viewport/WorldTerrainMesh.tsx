import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import {
  computeMapTextureCanvasSize,
  computeMapTileGridForExtent,
  cropTileMosaicToGroundPngBase64,
  DEFAULT_MAP_BACKGROUND,
  formatTileUrl,
  getMapLandSize,
  type MapTileGridSpec,
} from '@/core/mapTiles';
import type { Project, SurfaceZone, TextureAsset, World, WorldCosmetics } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { buildTerrainBufferGeometry } from '@/core/terrain';
import { getPineTierVisualRadius, getTreeParts, type TreeSource } from '@/core/treeGeometry';
import {
  exportCompositeGroundPngBase64,
  hasCustomCosmeticGround,
  renderCompositeGroundCanvas,
} from '@/core/worldTextureCompositor';
import { PrimitiveMesh, useTextureAsset } from '@/viewport/MeshAssetRenderer';

export function useMapTileMosaicTexture(
  enabled: boolean,
  tileUrl: string,
  tileGrid: MapTileGridSpec,
  landWidthMeters = 100,
  headingDeg = 0,
  skipAutoSync = false,
  landHeightMeters?: number,
): { texture: THREE.CanvasTexture | null; canvas: HTMLCanvasElement | null; revision: number } {
  const invalidate = useThree((s) => s.invalidate);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setTexture(null);
      setCanvasEl(null);
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
    setCanvasEl(canvas);
    setRevision((r) => r + 1);
    invalidate();

    let cancelled = false;
    let exportTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    const syncExportTexture = () => {
      if (cancelled || skipAutoSync) return;
      const b64 = cropTileMosaicToGroundPngBase64(
        canvas,
        tileGrid,
        landWidthMeters,
        headingDeg,
        1024,
        landHeightMeters,
      );
      if (b64) {
        useRoboForgeStore.getState().setMapTileTexture(b64);
      }
    };

    const scheduleSyncExportTexture = () => {
      if (skipAutoSync) return;
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
        setRevision((r) => r + 1);
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
  }, [enabled, tileUrl, tileGrid, landWidthMeters, landHeightMeters, headingDeg, skipAutoSync, invalidate]);

  return { texture, canvas: canvasEl, revision };
}

export function WorldGroundTerrainMesh({
  ground,
  mapBackground,
  surfaceZones,
  cosmetics,
  textures,
  soft,
  isEditingWorld,
  onSelectWorld,
  onGroundPointerDown,
  onGroundPointerMove,
  onGroundPointerUp,
}: {
  ground: Project['world']['ground'];
  mapBackground?: Project['world']['mapBackground'];
  surfaceZones?: SurfaceZone[];
  cosmetics?: WorldCosmetics;
  textures: TextureAsset[];
  soft: boolean;
  isEditingWorld?: boolean;
  onSelectWorld?: () => void;
  onGroundPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onGroundPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onGroundPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const assignedTexture = useMemo(
    () => (ground.textureId ? textures.find((t) => t.id === ground.textureId) : undefined),
    [ground.textureId, textures],
  );
  const customGroundTex = useTextureAsset(assignedTexture, ground.textureRepeat ?? [8, 8]);

  const mapEnabled = Boolean(mapBackground?.enabled);
  const { width: landWidth, height: landHeight } = getMapLandSize(mapBackground, ground.size);
  const segments = Math.max(
    4,
    Math.min(96, Math.round(mapBackground?.terrainSegments ?? DEFAULT_MAP_BACKGROUND.terrainSegments)),
  );

  const syntheticWorld = useMemo(
    (): World => ({
      name: 'world',
      physics: { stepSize: 0.002, realTimeFactor: 1, gravity: [0, 0, -9.81] },
      ground,
      mapBackground,
      surfaceZones,
      cosmetics,
      robotSpawnPose: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      lights: [],
      objects: [],
    }),
    [ground, mapBackground, surfaceZones, cosmetics],
  );

  const useCompositedGround = useMemo(
    () => hasCustomCosmeticGround(syntheticWorld),
    [syntheticWorld],
  );

  const tileGrid = useMemo(
    () =>
      computeMapTileGridForExtent(
        mapBackground?.latitude ?? DEFAULT_MAP_BACKGROUND.latitude,
        mapBackground?.longitude ?? DEFAULT_MAP_BACKGROUND.longitude,
        mapBackground?.zoom ?? DEFAULT_MAP_BACKGROUND.zoom,
        landWidth,
        landHeight,
      ),
    [mapBackground?.latitude, mapBackground?.longitude, mapBackground?.zoom, landWidth, landHeight],
  );

  const {
    texture: mapTex,
    canvas: mosaicCanvas,
    revision: mosaicRev,
  } = useMapTileMosaicTexture(
    mapEnabled,
    mapBackground?.tileUrl ?? DEFAULT_MAP_BACKGROUND.tileUrl,
    tileGrid,
    landWidth,
    mapBackground?.headingDeg ?? 0,
    useCompositedGround,
    landHeight,
  );

  // Composited multi-texture ground CanvasTexture (base + all surfaceZones)
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [compositeTex, setCompositeTex] = useState<THREE.CanvasTexture | null>(null);
  const [assetLoadTick, setAssetLoadTick] = useState(0);

  useEffect(() => {
    if (!useCompositedGround) {
      setCompositeTex((prev) => {
        prev?.dispose();
        return null;
      });
      return;
    }

    const res = soft ? 512 : 1024;
    const { widthPx, heightPx } = computeMapTextureCanvasSize(landWidth, landHeight, res);
    if (
      !compositeCanvasRef.current ||
      compositeCanvasRef.current.width !== widthPx ||
      compositeCanvasRef.current.height !== heightPx
    ) {
      const c = document.createElement('canvas');
      c.width = widthPx;
      c.height = heightPx;
      compositeCanvasRef.current = c;
    }

    const canvas = compositeCanvasRef.current;
    renderCompositeGroundCanvas({
      world: syntheticWorld,
      textures,
      canvas,
      landSize: landWidth,
      landHeight,
      satelliteMosaic: mosaicCanvas,
      tileGrid,
      onAssetImageLoaded: () => setAssetLoadTick((t) => t + 1),
    });

    setCompositeTex((prev) => {
      if (prev && prev.image === canvas) {
        prev.needsUpdate = true;
        return prev;
      }
      prev?.dispose();
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = soft ? 1 : 4;
      t.needsUpdate = true;
      return t;
    });
    invalidate();

    // Sync composited texture into mapTextureBase64 for Gazebo SDF export (debounced)
    const timer = globalThis.setTimeout(() => {
      const b64 = exportCompositeGroundPngBase64(
        syntheticWorld,
        textures,
        landWidth,
        mosaicCanvas,
        tileGrid,
        1024,
        landHeight,
      );
      if (b64) {
        useRoboForgeStore.getState().setMapTileTexture(b64);
      }
    }, 350);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [
    useCompositedGround,
    syntheticWorld,
    textures,
    landWidth,
    landHeight,
    mosaicCanvas,
    mosaicRev,
    tileGrid,
    soft,
    assetLoadTick,
    invalidate,
  ]);

  useEffect(() => {
    return () => {
      setCompositeTex((prev) => {
        prev?.dispose();
        return null;
      });
    };
  }, []);

  const terrainGeo = useMemo(() => {
    if (!mapEnabled && !useCompositedGround) return null;
    return buildTerrainBufferGeometry(
      landWidth,
      mapEnabled ? mapBackground : undefined,
      tileGrid,
      mapEnabled ? segments : 4,
      useCompositedGround,
      landHeight,
    );
  }, [
    mapEnabled,
    useCompositedGround,
    landWidth,
    landHeight,
    mapBackground?.elevationEnabled,
    mapBackground?.elevationScale,
    mapBackground?.elevationGrid,
    mapBackground?.elevationGridSize,
    mapBackground?.landSizeMeters,
    mapBackground?.landWidthMeters,
    mapBackground?.landHeightMeters,
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

  if ((mapEnabled || useCompositedGround) && terrainGeo) {
    const headingRad = mapEnabled ? -((mapBackground?.headingDeg ?? 0) * Math.PI) / 180 : 0;
    const opacity = mapEnabled ? (mapBackground?.opacity ?? DEFAULT_MAP_BACKGROUND.opacity) : 1;
    const activeMap = useCompositedGround ? compositeTex : (customGroundTex ?? mapTex);

    return (
      <group rotation={[0, 0, headingRad]}>
        <mesh
          data-testid="map-tile-ground"
          geometry={terrainGeo}
          receiveShadow={!soft}
          onPointerDown={onGroundPointerDown}
          onPointerMove={onGroundPointerMove}
          onPointerUp={onGroundPointerUp}
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
            key={
              useCompositedGround
                ? 'composite-terrain-tex'
                : activeMap
                  ? 'map-terrain-tex'
                  : 'map-terrain-flat'
            }
            color={activeMap ? '#ffffff' : '#1b2432'}
            map={activeMap ?? undefined}
            roughness={0.95}
            metalness={0.02}
            envMapIntensity={useCompositedGround ? 0.35 : 0}
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
      onPointerDown={onGroundPointerDown}
      onPointerMove={onGroundPointerMove}
      onPointerUp={onGroundPointerUp}
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
