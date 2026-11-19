import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Line, TransformControls } from '@react-three/drei';
import { Box, Check, Crosshair, Grid as GridIcon, Move, RotateCw, Scaling, X } from 'lucide-react';
import * as THREE from 'three';
import { poseToRosMatrix, quaternionToRosRpy } from '@/core/coords';
import { DEFAULT_MAP_BACKGROUND, getMapLandSize } from '@/core/mapTiles';
import type { MapBackground, SurfaceZone, WorldObject } from '@/core/schema';
import {
  useRoboForgeStore,
  type CameraProjection,
  type CameraViewPreset,
  type TransformMode,
} from '@/core/store';
import {
  buildTerrainConformingWallSegments,
  computeBuildingTerrainPlacement,
  computePropTerrainPose,
  computeTreeTerrainPose,
  regroundWorldObjectToTerrain,
  sampleTerrainHeight,
  sampleTerrainPolyline3D,
} from '@/core/terrainGrounding';
import { materializePresetAsTextureAsset } from '@/core/texturePresets';
import {
  computeTreeDimensionsForCanopy,
  createDefaultTreeSource,
} from '@/core/treeGeometry';
import {
  createRectZonePoints,
  DEFAULT_WORLD_COSMETICS,
  findTopHitSurfaceZone,
  getSkyAtmospherePalette,
} from '@/core/worldZones';
import { PrimitiveMesh } from '@/viewport/MeshAssetRenderer';
import { ViewportCameraRig } from '@/viewport/ViewportCameraRig';
import { TreeObjectVisual, WorldGroundTerrainMesh } from '@/viewport/WorldTerrainMesh';
import { isSoftwareGlRenderer, StudioEnvironment } from '@/viewport/webglCaps';
import {
  COSMETIC_PROP_PRESETS,
  hexToRgba,
  rgbaToHex,
  type ActiveBrushMaterial,
  type StudioTool,
} from '@/worldStudio/types';

export interface WorldStudio3DViewportProps {
  tool: StudioTool;
  brush: ActiveBrushMaterial;
  showGrid: boolean;
  snapEnabled: boolean;
  snapStep: number;
  treeStyle: 'deciduous' | 'pine';
  treeRadius: number;
  treeHeight: number;
  buildingHeight: number;
  buildingColor: string;
  wallHeight: number;
  wallThickness: number;
  selectedPropId: string;
}

function ZoneOutline3D({
  zone,
  mapBg,
}: {
  zone: SurfaceZone;
  mapBg: MapBackground;
}) {
  const points3D = useMemo((): [number, number, number][] => {
    const zLift = 0.09;
    if (zone.kind === 'circle' && zone.points[0]) {
      const [cx, cy] = zone.points[0];
      const r = zone.radius ?? 4;
      const segs = 36;
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        pts.push([x, y, sampleTerrainHeight(mapBg, x, y) + zLift]);
      }
      return pts;
    }

    if (zone.points.length < 2) return [];
    const closed = zone.kind !== 'path' && zone.points.length >= 3;
    return sampleTerrainPolyline3D(zone.points, mapBg, zLift, closed, 2.0);
  }, [zone, mapBg]);

  if (points3D.length < 2) return null;
  return <Line points={points3D} color="#38bdf8" lineWidth={2.5} />;
}

const SKY_DOME_STOPS: Record<
  'daylight' | 'golden_hour' | 'overcast' | 'dusk' | 'night' | 'studio',
  [string, string, string]
> = {
  daylight: ['#3b82f6', '#bae6fd', '#e2eff8'],
  golden_hour: ['#312e81', '#f97316', '#fde68a'],
  overcast: ['#475569', '#94a3b8', '#cbd5e1'],
  dusk: ['#0f172a', '#4c1d95', '#fb923c'],
  night: ['#020617', '#0f172a', '#1e3a5f'],
  studio: ['#090d14', '#111827', '#1e293b'],
};

function SkyDome({
  preset,
  radius,
}: {
  preset: 'daylight' | 'golden_hour' | 'overcast' | 'dusk' | 'night' | 'studio';
  radius: number;
}) {
  const texture = useMemo(() => {
    const [topHex, midHex, horizonHex] = SKY_DOME_STOPS[preset] ?? SKY_DOME_STOPS.daylight;
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0.0, topHex);
      grad.addColorStop(0.42, midHex);
      grad.addColorStop(0.55, horizonHex);
      grad.addColorStop(1.0, midHex);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 256);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, [preset]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={-10}>
      <sphereGeometry args={[radius, 24, 16]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  );
}

interface StudioSceneProps extends WorldStudio3DViewportProps {
  projection: CameraProjection;
  cameraView: CameraViewPreset;
  presetTrigger: number;
  focusTrigger: number;
  gizmoMode: TransformMode;
  draftPoints3D: [number, number][];
  onAddDraftPoint3D: (pt: [number, number]) => void;
  onCommitRect3D: (p1: [number, number], p2: [number, number]) => void;
}

function WorldStudioScene3D({
  tool,
  brush,
  showGrid,
  snapEnabled,
  snapStep,
  treeStyle,
  treeRadius,
  treeHeight,
  selectedPropId,
  projection,
  cameraView,
  presetTrigger,
  focusTrigger,
  gizmoMode,
  draftPoints3D,
  onAddDraftPoint3D,
  onCommitRect3D,
}: StudioSceneProps) {
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const select = useRoboForgeStore((s) => s.select);
  const addTexture = useRoboForgeStore((s) => s.addTexture);
  const addSurfaceZone = useRoboForgeStore((s) => s.addSurfaceZone);
  const addWorldObject = useRoboForgeStore((s) => s.addWorldObject);
  const updateWorldObject = useRoboForgeStore((s) => s.updateWorldObject);
  const updateWorld = useRoboForgeStore((s) => s.updateWorld);

  const invalidate = useThree((s) => s.invalidate);
  const soft = useMemo(() => isSoftwareGlRenderer(), []);
  const orbitRef = useRef<ComponentRef<typeof import('@react-three/drei').OrbitControls> | null>(null);
  const objectRefs = useRef<Record<string, THREE.Group | null>>({});

  const [draggingGizmo, setDraggingGizmo] = useState(false);
  const [rectDrag3D, setRectDrag3D] = useState<{
    p1: [number, number];
    p2: [number, number];
  } | null>(null);

  const mapBg = project.world.mapBackground ?? DEFAULT_MAP_BACKGROUND;
  const landDims = getMapLandSize(project.world.mapBackground, project.world.ground.size);
  const landWidth = landDims.width;
  const landHeight = landDims.height;
  const landSize = Math.max(landWidth, landHeight);

  const cosmetics = { ...DEFAULT_WORLD_COSMETICS, ...project.world.cosmetics };
  const sky = useMemo(() => getSkyAtmospherePalette(cosmetics), [cosmetics]);

  const selectedObjectId = selection?.type === 'worldObject' ? selection.id : null;
  const selectedZoneId = selection?.type === 'surfaceZone' ? selection.id : null;
  const selectedLightId = selection?.type === 'worldLight' ? selection.id : null;

  const selectedObj = useMemo(
    () => project.world.objects.find((o) => o.id === selectedObjectId) ?? null,
    [project.world.objects, selectedObjectId],
  );
  const selectedZone = useMemo(
    () => (project.world.surfaceZones ?? []).find((z) => z.id === selectedZoneId) ?? null,
    [project.world.surfaceZones, selectedZoneId],
  );

  // Trigger demand re-render whenever world/selection changes
  useEffect(() => {
    invalidate();
  }, [project.world, project.textures, selection, draftPoints3D, rectDrag3D, invalidate]);

  const snapVal = useCallback(
    (v: number) =>
      snapEnabled && snapStep > 0
        ? Number((Math.round(v / snapStep) * snapStep).toFixed(3))
        : Number(v.toFixed(3)),
    [snapEnabled, snapStep],
  );

  const ensurePresetAssetId = useCallback(
    (presetId: string | undefined): string | undefined => {
      if (!presetId) return undefined;
      const existing = useRoboForgeStore
        .getState()
        .project.textures.find((t) => t.id === `preset_${presetId}`);
      if (existing) return existing.id;
      const asset = materializePresetAsTextureAsset(presetId, 256);
      if (!asset) return undefined;
      addTexture(asset);
      return asset.id;
    },
    [addTexture],
  );

  const handleGroundPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const rx = snapVal(e.point.x);
    const ry = snapVal(e.point.y);
    const tz = sampleTerrainHeight(mapBg, rx, ry);

    if (tool === 'select') {
      const hitZone = findTopHitSurfaceZone(e.point.x, e.point.y, project.world.surfaceZones);
      if (hitZone) {
        select({ type: 'surfaceZone', id: hitZone.id });
      } else {
        select({ type: 'world' });
      }
      return;
    }

    if (tool === 'zone_rect') {
      setRectDrag3D({ p1: [rx, ry], p2: [rx, ry] });
      return;
    }

    if (tool === 'zone_circle') {
      addSurfaceZone({
        kind: 'circle',
        points: [[rx, ry]],
        radius: brush.circleRadius,
        textureSource: brush.textureSource,
        presetId: brush.presetId,
        textureId: brush.textureId,
        tint: hexToRgba(brush.tintHex, 1),
        repeat: [...brush.repeat],
        opacity: brush.opacity,
        visible: true,
        feather: brush.feather,
      });
      return;
    }

    if (tool === 'zone_poly' || tool === 'zone_path' || tool === 'building' || tool === 'wall') {
      onAddDraftPoint3D([rx, ry]);
      return;
    }

    if (tool === 'tree') {
      const base = createDefaultTreeSource(treeStyle);
      const dims = computeTreeDimensionsForCanopy(treeRadius, treeHeight, treeStyle);
      const placed = computeTreeTerrainPose(rx, ry, dims.trunkRadius, mapBg);
      addWorldObject(
        treeStyle === 'pine' ? 'pine_tree' : 'oak_tree',
        {
          ...base,
          canopyRadius: dims.canopyRadius,
          trunkRadius: dims.trunkRadius,
          trunkHeight: dims.trunkHeight,
          canopyHeight: dims.canopyHeight,
        },
        placed.pose,
        true,
        45,
        placed.terrainPlacement,
      );
      return;
    }

    if (tool === 'prop') {
      const preset =
        COSMETIC_PROP_PRESETS.find((p) => p.id === selectedPropId) ?? COSMETIC_PROP_PRESETS[0]!;
      const shape = structuredClone(preset.shape);
      const placed = computePropTerrainPose(rx, ry, shape, mapBg);
      const texId = preset.defaultPresetId ? ensurePresetAssetId(preset.defaultPresetId) : undefined;
      addWorldObject(
        preset.id,
        {
          type: 'primitive',
          shape,
          material: {
            name: `${preset.id}_mat`,
            rgba: texId ? [1, 1, 1, 1] : hexToRgba(preset.defaultColorHex, 1),
            ...(texId ? { textureId: texId, textureRepeat: [2, 2] } : {}),
          },
        },
        placed.pose,
        preset.static,
        preset.mass,
        placed.terrainPlacement,
      );
      return;
    }

    if (tool === 'spawn') {
      updateWorld((w) => {
        w.robotSpawnPose.xyz = [rx, ry, Number((tz + 0.15).toFixed(3))];
      });
    }
  };

  const handleGroundPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!rectDrag3D) return;
    e.stopPropagation();
    setRectDrag3D((prev) => (prev ? { ...prev, p2: [snapVal(e.point.x), snapVal(e.point.y)] } : null));
  };

  const handleGroundPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!rectDrag3D) return;
    e.stopPropagation();
    const { p1, p2 } = rectDrag3D;
    setRectDrag3D(null);
    onCommitRect3D(p1, p2);
  };

  const commitGizmoTransform = (obj: WorldObject) => {
    const grp = objectRefs.current[obj.id];
    if (!grp) return;
    const pos = grp.position;
    const rpy = quaternionToRosRpy(grp.quaternion);
    const sx = grp.scale.x;
    const sy = grp.scale.y;
    const sz = grp.scale.z;
    const prevX = obj.pose.xyz[0];
    const prevY = obj.pose.xyz[1];
    const prevZ = obj.pose.xyz[2];
    const movedHoriz = Math.hypot(pos.x - prevX, pos.y - prevY) > 0.02;
    const movedVertOnly = !movedHoriz && Math.abs(pos.z - prevZ) > 0.02;

    updateWorldObject(obj.id, (draft) => {
      draft.pose.xyz = [
        Number(pos.x.toFixed(3)),
        Number(pos.y.toFixed(3)),
        Number(pos.z.toFixed(3)),
      ];
      draft.pose.rpy = [
        Number(rpy[0].toFixed(4)),
        Number(rpy[1].toFixed(4)),
        Number(rpy[2].toFixed(4)),
      ];
      if (gizmoMode === 'scale' && draft.source.type === 'primitive') {
        if (draft.source.shape.kind === 'box') {
          draft.source.shape.size = [
            Math.max(0.1, Number((draft.source.shape.size[0] * sx).toFixed(3))),
            Math.max(0.1, Number((draft.source.shape.size[1] * sy).toFixed(3))),
            Math.max(0.1, Number((draft.source.shape.size[2] * sz).toFixed(3))),
          ];
          if (draft.terrainPlacement?.kind === 'wall') {
            draft.terrainPlacement.nominalHeight = draft.source.shape.size[2];
            draft.terrainPlacement.nominalLength = draft.source.shape.size[0];
            delete draft.terrainPlacement.endpoints;
          }
        } else if (draft.source.shape.kind === 'cylinder' || draft.source.shape.kind === 'capsule') {
          draft.source.shape.radius = Math.max(
            0.05,
            Number((draft.source.shape.radius * Math.max(sx, sy)).toFixed(3)),
          );
          draft.source.shape.length = Math.max(
            0.1,
            Number((draft.source.shape.length * sz).toFixed(3)),
          );
        } else if (draft.source.shape.kind === 'sphere') {
          draft.source.shape.radius = Math.max(
            0.05,
            Number((draft.source.shape.radius * Math.max(sx, sy, sz)).toFixed(3)),
          );
        } else if (draft.source.shape.kind === 'extrude') {
          const nextH = Math.max(0.2, Number((draft.source.shape.depth * sz).toFixed(3)));
          draft.source.shape.depth = nextH;
          if (draft.terrainPlacement) {
            draft.terrainPlacement.nominalHeight = nextH;
          }
        }
      }

      if (gizmoMode === 'rotate' && draft.terrainPlacement?.kind === 'wall') {
        delete draft.terrainPlacement.endpoints;
      }

      if (movedVertOnly) {
        // User explicitly dragged Z arrow: ensure object stays above ground (never buried)
        const clone = structuredClone(draft);
        regroundWorldObjectToTerrain(clone, mapBg);
        draft.pose.xyz[2] = Math.max(draft.pose.xyz[2], clone.pose.xyz[2]);
      } else {
        regroundWorldObjectToTerrain(draft, mapBg);
      }
    });
    grp.scale.set(1, 1, 1);
  };

  const draftLine3D = useMemo((): [number, number, number][] => {
    if (draftPoints3D.length < 2) return [];
    const closed = (tool === 'zone_poly' || tool === 'building') && draftPoints3D.length >= 3;
    return sampleTerrainPolyline3D(draftPoints3D, mapBg, 0.12, closed, 2.0);
  }, [draftPoints3D, mapBg, tool]);

  const rectPreview3D = useMemo((): [number, number, number][] => {
    if (!rectDrag3D) return [];
    const corners = createRectZonePoints(
      rectDrag3D.p1[0],
      rectDrag3D.p1[1],
      rectDrag3D.p2[0],
      rectDrag3D.p2[1],
    );
    return sampleTerrainPolyline3D(corners, mapBg, 0.12, true, 2.0);
  }, [rectDrag3D, mapBg]);

  const selectedObjGroup = selectedObj ? objectRefs.current[selectedObj.id] : null;

  return (
    <>
      <color attach="background" args={[sky.backgroundHex]} />
      {cosmetics.fogEnabled && (
        <fogExp2 attach="fog" args={[sky.fogHex, cosmetics.fogDensity]} />
      )}
      <SkyDome preset={cosmetics.skyPreset} radius={Math.max(420, landSize * 4.5)} />
      <StudioEnvironment />

      {/* Warm Key / Cool Hemisphere / Rim Three-Point Outdoor Lighting */}
      <hemisphereLight
        args={[sky.hemiSkyHex, sky.hemiGroundHex, sky.hemiIntensity]}
      />
      <directionalLight
        position={sky.sunPosition}
        color={sky.sunColorHex}
        intensity={sky.sunIntensity}
        castShadow={!soft}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0005}
        shadow-camera-left={-landSize * 0.6}
        shadow-camera-right={landSize * 0.6}
        shadow-camera-top={landSize * 0.6}
        shadow-camera-bottom={-landSize * 0.6}
      />
      <directionalLight
        position={[-sky.sunPosition[0] * 0.6, -sky.sunPosition[1] * 0.6, 28]}
        color={sky.rimColorHex}
        intensity={sky.rimIntensity}
      />

      {/* User-defined World Lights */}
      {project.world.lights.slice(0, 5).map((light) => {
        const col = `#${new THREE.Color(light.diffuse[0], light.diffuse[1], light.diffuse[2]).getHexString()}`;
        const isSel = light.id === selectedLightId;
        return (
          <group key={light.id} position={light.pose.xyz}>
            {light.type === 'point' && (
              <pointLight color={col} intensity={light.intensity * 12} distance={35} decay={1.5} />
            )}
            {light.type === 'spot' && (
              <spotLight color={col} intensity={light.intensity * 18} distance={45} angle={0.65} penumbra={0.5} />
            )}
            {/* Subtle Light Anchor Gizmo */}
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                select({ type: 'worldLight', id: light.id });
              }}
            >
              <sphereGeometry args={[isSel ? 0.42 : 0.28, 12, 12]} />
              <meshBasicMaterial color={isSel ? '#38bdf8' : col} />
            </mesh>
          </group>
        );
      })}

      <ViewportCameraRig
        projection={projection}
        view={cameraView}
        presetTrigger={presetTrigger}
        focusTrigger={focusTrigger}
        defaultDistance={Math.max(26, landSize * 0.78)}
        controlsEnabled={!draggingGizmo && !rectDrag3D}
        minDistance={1.5}
        maxDistance={Math.max(400, landSize * 4)}
        orbitRef={orbitRef}
      />

      {/* Multi-Textured Ground Terrain */}
      <WorldGroundTerrainMesh
        ground={project.world.ground}
        mapBackground={project.world.mapBackground}
        surfaceZones={project.world.surfaceZones}
        cosmetics={project.world.cosmetics}
        textures={project.textures}
        soft={soft}
        onGroundPointerDown={handleGroundPointerDown}
        onGroundPointerMove={handleGroundPointerMove}
        onGroundPointerUp={handleGroundPointerUp}
      />

      {/* Subtle Ground Grid Overlay */}
      {showGrid && (
        <Grid
          args={[landWidth, landHeight]}
          cellSize={2}
          sectionSize={10}
          cellColor="#64748b"
          sectionColor="#94a3b8"
          cellThickness={0.35}
          sectionThickness={0.7}
          fadeDistance={landSize * 1.4}
          fadeStrength={1}
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, 0, 0.03]}
        />
      )}

      {/* Selected Surface Zone 3D Highlight Perimeter */}
      {selectedZone && selectedZone.visible && (
        <ZoneOutline3D zone={selectedZone} mapBg={mapBg} />
      )}

      {/* Active 3D Draft Preview Lines */}
      {draftLine3D.length >= 2 && (
        <Line points={draftLine3D} color="#34d399" lineWidth={3} />
      )}
      {rectPreview3D.length >= 2 && (
        <Line points={rectPreview3D} color="#34d399" lineWidth={3} />
      )}
      {draftPoints3D.map(([x, y], idx) => (
        <mesh
          key={`draft-pt-${idx}`}
          position={[x, y, sampleTerrainHeight(mapBg, x, y) + 0.16]}
        >
          <sphereGeometry args={[0.28, 12, 12]} />
          <meshBasicMaterial color={idx === 0 ? '#facc15' : '#34d399'} />
        </mesh>
      ))}

      {/* World Objects */}
      {project.world.objects.map((obj) => {
        if (obj.source.type !== 'primitive' && obj.source.type !== 'tree') return null;
        const isSelected = obj.id === selectedObjectId;
        const mat = poseToRosMatrix(obj.pose);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        mat.decompose(pos, quat, scl);

        const assignedTexId =
          obj.source.type === 'primitive' ? obj.source.material.textureId : undefined;
        const assignedTex = assignedTexId
          ? project.textures.find((t) => t.id === assignedTexId)
          : undefined;

        return (
          <group
            key={obj.id}
            ref={(el) => {
              objectRefs.current[obj.id] = el;
            }}
            position={[pos.x, pos.y, pos.z]}
            quaternion={quat}
            onClick={(e) => {
              if (tool !== 'select') return;
              e.stopPropagation();
              select({ type: 'worldObject', id: obj.id });
            }}
          >
            {obj.source.type === 'tree' ? (
              <TreeObjectVisual source={obj.source} selected={isSelected} />
            ) : (
              <PrimitiveMesh
                shape={obj.source.shape}
                colorHex={
                  isSelected
                    ? '#60a5fa'
                    : assignedTex
                      ? '#ffffff'
                      : rgbaToHex(obj.source.material.rgba)
                }
                opacity={obj.source.material.rgba[3]}
                texture={assignedTex}
                textureRepeat={obj.source.material.textureRepeat}
              />
            )}
          </group>
        );
      })}

      {/* 3D TransformControls Gizmo for Selected World Object */}
      {tool === 'select' && selectedObj && selectedObjGroup && (
        <TransformControls
          object={selectedObjGroup}
          mode={gizmoMode}
          translationSnap={snapEnabled ? snapStep : null}
          rotationSnap={snapEnabled ? THREE.MathUtils.degToRad(15) : null}
          onMouseDown={() => setDraggingGizmo(true)}
          onMouseUp={() => {
            setDraggingGizmo(false);
            commitGizmoTransform(selectedObj);
          }}
          onObjectChange={() => invalidate()}
        />
      )}

      {/* Robot Spawn Marker in 3D */}
      <group
        position={[
          project.world.robotSpawnPose.xyz[0],
          project.world.robotSpawnPose.xyz[1],
          project.world.robotSpawnPose.xyz[2] + 0.06,
        ]}
        rotation={[0, 0, project.world.robotSpawnPose.rpy[2] ?? 0]}
      >
        <mesh>
          <ringGeometry args={[0.48, 0.65, 28]} />
          <meshBasicMaterial color="#38bdf8" side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0.75, 0, 0.02]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.24, 0.55, 12]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
      </group>
    </>
  );
}

export function WorldStudio3DViewport(props: WorldStudio3DViewportProps) {
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const addTexture = useRoboForgeStore((s) => s.addTexture);
  const addSurfaceZone = useRoboForgeStore((s) => s.addSurfaceZone);
  const addWorldObject = useRoboForgeStore((s) => s.addWorldObject);

  const soft = useMemo(() => isSoftwareGlRenderer(), []);
  const [projection, setProjection] = useState<CameraProjection>('perspective');
  const [cameraView, setCameraView] = useState<CameraViewPreset>('iso');
  const [presetTrigger, setPresetTrigger] = useState(0);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [gizmoMode, setGizmoMode] = useState<TransformMode>('translate');
  const [draftPoints3D, setDraftPoints3D] = useState<[number, number][]>([]);
  const [contextLost, setContextLost] = useState(false);

  const mapBg = project.world.mapBackground ?? DEFAULT_MAP_BACKGROUND;
  const isObjectSelected = selection?.type === 'worldObject';

  useEffect(() => {
    setDraftPoints3D([]);
  }, [props.tool]);

  const ensurePresetAssetId = useCallback(
    (presetId: string | undefined): string | undefined => {
      if (!presetId) return undefined;
      const existing = useRoboForgeStore
        .getState()
        .project.textures.find((t) => t.id === `preset_${presetId}`);
      if (existing) return existing.id;
      const asset = materializePresetAsTextureAsset(presetId, 256);
      if (!asset) return undefined;
      addTexture(asset);
      return asset.id;
    },
    [addTexture],
  );

  const commitDraft3D = useCallback(
    (pts: [number, number][]) => {
      const { tool, brush, buildingHeight, buildingColor, wallHeight, wallThickness } = props;
      if (tool === 'zone_poly' && pts.length >= 3) {
        addSurfaceZone({
          kind: 'polygon',
          points: pts,
          textureSource: brush.textureSource,
          presetId: brush.presetId,
          textureId: brush.textureId,
          tint: hexToRgba(brush.tintHex, 1),
          repeat: [...brush.repeat],
          opacity: brush.opacity,
          visible: true,
          feather: brush.feather,
        });
        setDraftPoints3D([]);
      } else if (tool === 'zone_path' && pts.length >= 2) {
        addSurfaceZone({
          kind: 'path',
          points: pts,
          strokeWidth: brush.strokeWidth,
          textureSource: brush.textureSource,
          presetId: brush.presetId,
          textureId: brush.textureId,
          tint: hexToRgba(brush.tintHex, 1),
          repeat: [...brush.repeat],
          opacity: brush.opacity,
          visible: true,
          feather: brush.feather,
        });
        setDraftPoints3D([]);
      } else if (tool === 'building' && pts.length >= 3) {
        let sx = 0;
        let sy = 0;
        for (const [x, y] of pts) {
          sx += x;
          sy += y;
        }
        const cx = sx / pts.length;
        const cy = sy / pts.length;
        const localPts: [number, number][] = pts.map(([x, y]) => [
          Number((x - cx).toFixed(3)),
          Number((y - cy).toFixed(3)),
        ]);
        const h = Math.max(0.5, buildingHeight);
        const placed = computeBuildingTerrainPlacement(localPts, cx, cy, h, mapBg, 0);
        addWorldObject(
          'building',
          {
            type: 'primitive',
            shape: { kind: 'extrude', points: localPts, depth: placed.depth },
            material: { name: 'building_mat', rgba: hexToRgba(buildingColor, 1) },
          },
          {
            xyz: [Number(cx.toFixed(3)), Number(cy.toFixed(3)), placed.centerZ],
            rpy: [0, 0, 0],
          },
          true,
          undefined,
          placed.terrainPlacement,
        );
        setDraftPoints3D([]);
      } else if (tool === 'wall' && pts.length >= 2) {
        const h = Math.max(0.3, wallHeight);
        const t = Math.max(0.1, wallThickness);
        const texId =
          brush.textureSource === 'custom'
            ? brush.textureId
            : ensurePresetAssetId(brush.presetId);
        const segments = buildTerrainConformingWallSegments(pts, h, t, mapBg);
        for (const seg of segments) {
          addWorldObject(
            'wall',
            {
              type: 'primitive',
              shape: { kind: 'box', size: seg.size },
              material: {
                name: 'wall_mat',
                rgba: texId ? [1, 1, 1, 1] : [0.75, 0.78, 0.82, 1],
                ...(texId
                  ? {
                      textureId: texId,
                      textureRepeat: [Math.max(1, Math.round(seg.size[0] / 2)), 1],
                    }
                  : {}),
              },
            },
            seg.pose,
            true,
            undefined,
            seg.terrainPlacement,
          );
        }
        setDraftPoints3D([]);
      }
    },
    [props, mapBg, addSurfaceZone, addWorldObject, ensurePresetAssetId],
  );

  const handleCommitRect3D = useCallback(
    (p1: [number, number], p2: [number, number]) => {
      const w = Math.abs(p2[0] - p1[0]);
      const h = Math.abs(p2[1] - p1[1]);
      const pts =
        w < 0.5 && h < 0.5
          ? createRectZonePoints(p1[0] - 6, p1[1] - 6, p1[0] + 6, p1[1] + 6)
          : createRectZonePoints(p1[0], p1[1], p2[0], p2[1]);
      addSurfaceZone({
        kind: 'rect',
        points: pts,
        textureSource: props.brush.textureSource,
        presetId: props.brush.presetId,
        textureId: props.brush.textureId,
        tint: hexToRgba(props.brush.tintHex, 1),
        repeat: [...props.brush.repeat],
        opacity: props.brush.opacity,
        visible: true,
        feather: props.brush.feather,
      });
    },
    [props.brush, addSurfaceZone],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') {
        return;
      }
      if (e.key === 'Escape') {
        setDraftPoints3D([]);
      } else if (e.key === 'Enter' && draftPoints3D.length >= 2) {
        e.preventDefault();
        commitDraft3D(draftPoints3D);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draftPoints3D, commitDraft3D]);

  const canFinishDraft3D =
    ((props.tool === 'zone_poly' || props.tool === 'building') && draftPoints3D.length >= 3) ||
    ((props.tool === 'zone_path' || props.tool === 'wall') && draftPoints3D.length >= 2);

  return (
    <div
      data-testid="world-studio-3d-panel"
      className="relative h-full w-full overflow-hidden bg-[#0b1019]"
    >
      {contextLost ? (
        <div className="flex h-full w-full items-center justify-center bg-[#0d121d] text-xs text-slate-300">
          3D WebGL context temporarily paused. Switch view or reload to restore.
        </div>
      ) : (
        <Canvas
          frameloop="demand"
          shadows={!soft}
          dpr={soft ? 1 : [1, 2]}
          gl={{
            antialias: !soft,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.08,
          }}
          onCreated={({ gl }) => {
            const dom = gl.domElement;
            dom.addEventListener('webglcontextlost', (ev) => {
              ev.preventDefault();
              setContextLost(true);
            });
            dom.addEventListener('webglcontextrestored', () => {
              setContextLost(false);
            });
          }}
        >
          <WorldStudioScene3D
            {...props}
            projection={projection}
            cameraView={cameraView}
            presetTrigger={presetTrigger}
            focusTrigger={focusTrigger}
            gizmoMode={gizmoMode}
            draftPoints3D={draftPoints3D}
            onAddDraftPoint3D={(pt) => setDraftPoints3D((prev) => [...prev, pt])}
            onCommitRect3D={handleCommitRect3D}
          />
        </Canvas>
      )}

      {/* Top-Left 3D Label & Top-Right Projection Switcher */}
      <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-center justify-between gap-2">
        <span
          data-testid="studio-projection-badge"
          className="rounded border border-[#283347] bg-[#0e131d]/90 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300"
        >
          3D VIEW · {projection === 'orthographic' ? 'ORTHO' : 'PERSP'}
        </span>

        <div
          role="group"
          aria-label="World Studio 3D camera projection"
          className="pointer-events-auto flex items-center gap-0.5 rounded border border-[#263145] bg-[#0d121c]/95 p-0.5 shadow"
        >
          <button
            type="button"
            data-testid="studio-proj-perspective"
            aria-pressed={projection === 'perspective'}
            title="Perspective 3D projection"
            onClick={() => setProjection('perspective')}
            className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
              projection === 'perspective'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:bg-[#171f2e] hover:text-slate-100'
            }`}
          >
            <Box className="h-3 w-3" />
            Persp
          </button>
          <button
            type="button"
            data-testid="studio-proj-orthographic"
            aria-pressed={projection === 'orthographic'}
            title="Orthographic parallel projection (CAD)"
            onClick={() => setProjection('orthographic')}
            className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
              projection === 'orthographic'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:bg-[#171f2e] hover:text-slate-100'
            }`}
          >
            <GridIcon className="h-3 w-3" />
            Ortho
          </button>
        </div>
      </div>

      {/* Inline Finish Bar when drawing in 3D */}
      {draftPoints3D.length > 0 && (
        <div className="absolute left-1/2 top-11 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-emerald-500/50 bg-[#0e1522]/95 px-2.5 py-1 text-xs shadow-lg">
          <span className="font-mono text-[11px] text-emerald-200">
            {draftPoints3D.length} pts on terrain
          </span>
          {canFinishDraft3D && (
            <button
              type="button"
              onClick={() => commitDraft3D(draftPoints3D)}
              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500 cursor-pointer"
            >
              <Check className="h-3 w-3" />
              Finish
            </button>
          )}
          <button
            type="button"
            onClick={() => setDraftPoints3D([])}
            className="inline-flex items-center gap-1 rounded border border-[#2a3346] bg-[#161e2e] px-1.5 py-0.5 text-[11px] text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        </div>
      )}

      {/* Bottom 3D Controls: Camera Presets & Object Gizmo Mode */}
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-1.5 pointer-events-none">
        {isObjectSelected && props.tool === 'select' ? (
          <div className="pointer-events-auto flex items-center gap-0.5 rounded border border-[#263145] bg-[#0d121c]/95 p-0.5">
            {(
              [
                { id: 'translate', label: 'Move', icon: Move },
                { id: 'rotate', label: 'Rotate', icon: RotateCw },
                { id: 'scale', label: 'Scale', icon: Scaling },
              ] as const
            ).map((g) => {
              const Icon = g.icon;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGizmoMode(g.id)}
                  aria-pressed={gizmoMode === g.id}
                  className={`inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] font-medium cursor-pointer ${
                    gizmoMode === g.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-[#1a2232]'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {g.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="max-w-[46%] truncate whitespace-nowrap rounded border border-[#242e40] bg-[#0d121c]/85 px-2 py-1 text-[10px] text-slate-300">
            {props.tool === 'select'
              ? 'Drag to orbit · Right-drag pan · Click to inspect'
              : props.tool === 'move_map'
                ? 'Move Map active · Drag the 2D canvas or mini-map to align area'
                : 'Click terrain to paint · Drag to draw'}
          </div>
        )}

        <div
          role="group"
          aria-label="World Studio 3D camera views"
          className="pointer-events-auto flex items-center gap-0.5 rounded border border-[#263145] bg-[#0d121c]/95 p-0.5"
        >
          {(['iso', 'top', 'front', 'back', 'left', 'right'] as const).map((v) => (
            <button
              key={v}
              type="button"
              data-testid={`studio-cam-${v}`}
              aria-pressed={cameraView === v}
              onClick={() => {
                setCameraView(v);
                setPresetTrigger((n) => n + 1);
              }}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase cursor-pointer ${
                cameraView === v
                  ? 'bg-[#1e293b] text-sky-300 font-semibold'
                  : 'text-slate-400 hover:bg-[#171f2e] hover:text-slate-200'
              }`}
            >
              {v}
            </button>
          ))}
          <button
            type="button"
            aria-label="Reset 3D camera framing"
            title="Reset 3D Camera"
            onClick={() => setFocusTrigger((n) => n + 1)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-[#1b2333] hover:text-white cursor-pointer"
          >
            <Crosshair className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
