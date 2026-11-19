import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  BrickWall,
  Building2,
  Check,
  Crosshair,
  Eye,
  Maximize2,
  MousePointer2,
  RotateCcw,
  Trash2,
  Trees,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as THREE from 'three';
import { poseToRosMatrix } from '@/core/coords';
import {
  computeMapTileGridForExtent,
  DEFAULT_MAP_BACKGROUND,
  formatTileUrl,
  getMapLandSize,
  sampleElevationAt,
} from '@/core/mapTiles';
import type { WorldObject } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import {
  computeTreeDimensionsForCanopy,
  createDefaultTreeSource,
} from '@/core/treeGeometry';
import { PrimitiveMesh } from '@/viewport/MeshAssetRenderer';
import { ViewportCameraRig } from '@/viewport/ViewportCameraRig';
import { TreeObjectVisual, WorldGroundTerrainMesh } from '@/viewport/WorldTerrainMesh';
import { isSoftwareGlRenderer, StudioEnvironment } from '@/viewport/webglCaps';

type AnnotatorTool = 'select' | 'tree' | 'building' | 'wall';

interface LiveChangeEntry {
  id: string;
  objectId: string;
  name: string;
  kind: 'tree' | 'building' | 'wall';
  summary: string;
  timeLabel: string;
}

function pointInPolygon(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0];
    const yi = poly[i]![1];
    const xj = poly[j]![0];
    const yj = poly[j]![1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function getWorldExtrudePolygon(obj: WorldObject): [number, number][] | null {
  if (obj.source.type !== 'primitive' || obj.source.shape.kind !== 'extrude') return null;
  const yaw = obj.pose.rpy[2] ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const [ox, oy] = obj.pose.xyz;
  return obj.source.shape.points.map(([lx, ly]) => [
    ox + lx * cos - ly * sin,
    oy + lx * sin + ly * cos,
  ]);
}

function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [
    Number.isFinite(r) ? r : 0.45,
    Number.isFinite(g) ? g : 0.52,
    Number.isFinite(b) ? b : 0.62,
    1,
  ];
}

function rgbaToHex(rgba: [number, number, number, number]): string {
  const r = Math.round(rgba[0] * 255)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(rgba[1] * 255)
    .toString(16)
    .padStart(2, '0');
  const b = Math.round(rgba[2] * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}

function LiveMapPreviewScene({
  selectedObjectId,
  focusNonce,
}: {
  selectedObjectId: string | null;
  focusNonce: number;
}) {
  const project = useRoboForgeStore((s) => s.project);
  const select = useRoboForgeStore((s) => s.select);
  const invalidate = useThree((s) => s.invalidate);
  const soft = useMemo(() => isSoftwareGlRenderer(), []);

  const landDims = getMapLandSize(project.world.mapBackground, project.world.ground.size);
  const landSize = Math.max(landDims.width, landDims.height);

  // Trigger render whenever objects or terrain update
  useEffect(() => {
    invalidate();
  }, [project.world, selectedObjectId, invalidate]);

  return (
    <>
      <color attach="background" args={['#090d14']} />
      <StudioEnvironment />
      <ambientLight intensity={0.5} />
      <directionalLight position={[25, -25, 45]} intensity={1.35} castShadow={false} />
      <directionalLight position={[-20, 20, 15]} intensity={0.45} color="#a5c4ff" />

      <ViewportCameraRig
        projection="perspective"
        view="iso"
        presetTrigger={0}
        focusTrigger={focusNonce}
        defaultDistance={Math.max(16, landSize * 0.72)}
        minDistance={1}
        maxDistance={Infinity}
      />

      <group>
        <WorldGroundTerrainMesh
          ground={project.world.ground}
          mapBackground={project.world.mapBackground}
          textures={project.textures}
          soft={soft}
        />

        {project.world.objects.map((obj) => {
          if (obj.source.type !== 'primitive' && obj.source.type !== 'tree') return null;
          const isSelected = obj.id === selectedObjectId;
          const mat = poseToRosMatrix(obj.pose);
          const pos = new THREE.Vector3();
          const quat = new THREE.Quaternion();
          const scl = new THREE.Vector3();
          mat.decompose(pos, quat, scl);

          return (
            <group
              key={obj.id}
              position={[pos.x, pos.y, pos.z]}
              quaternion={quat}
              onClick={(e) => {
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
                      ? '#38bdf8'
                      : rgbaToHex(obj.source.material.rgba)
                  }
                  opacity={obj.source.material.rgba[3]}
                />
              )}
            </group>
          );
        })}

        {/* Robot Spawn Marker */}
        <mesh
          position={[
            project.world.robotSpawnPose.xyz[0],
            project.world.robotSpawnPose.xyz[1],
            project.world.robotSpawnPose.xyz[2] + 0.05,
          ]}
        >
          <ringGeometry args={[0.45, 0.6, 24]} />
          <meshBasicMaterial color="#38bdf8" side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}

export function MapAnnotatorModal() {
  const isOpen = useRoboForgeStore((s) => s.isMapAnnotatorOpen);
  const setOpen = useRoboForgeStore((s) => s.setMapAnnotatorOpen);
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const select = useRoboForgeStore((s) => s.select);
  const addWorldObject = useRoboForgeStore((s) => s.addWorldObject);
  const updateWorldObject = useRoboForgeStore((s) => s.updateWorldObject);
  const deleteWorldObject = useRoboForgeStore((s) => s.deleteWorldObject);

  const [tool, setTool] = useState<AnnotatorTool>('tree');
  const [treeStyle, setTreeStyle] = useState<'deciduous' | 'pine'>('deciduous');
  const [presetTreeRadius, setPresetTreeRadius] = useState(1.4);
  const [presetTreeHeight, setPresetTreeHeight] = useState(3.2);
  const [buildingHeight, setBuildingHeight] = useState(6.0);
  const [buildingColor, setBuildingColor] = useState('#64748b');
  const [wallHeight, setWallHeight] = useState(2.5);
  const [wallThickness, setWallThickness] = useState(0.35);
  const [wallColor, setWallColor] = useState('#94a3b8');

  // 2D Map viewport pan/zoom state
  const [viewCenter, setViewCenter] = useState<[number, number]>([0, 0]);
  const [pxPerMeter, setPxPerMeter] = useState(6);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 680, h: 520 });

  // Active drawing drafts
  const [draftPoly, setDraftPoly] = useState<[number, number][]>([]);
  const [draftWall, setDraftWall] = useState<[number, number][]>([]);
  const [hoverRos, setHoverRos] = useState<[number, number] | null>(null);
  const [draftCircle, setDraftCircle] = useState<{
    cx: number;
    cy: number;
    radius: number;
    didDrag: boolean;
  } | null>(null);
  const [liveChanges, setLiveChanges] = useState<LiveChangeEntry[]>([]);
  const [previewFocusNonce, setPreviewFocusNonce] = useState(0);

  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const mosaicCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mosaicRev, setMosaicRev] = useState(0);

  const dragActionRef = useRef<
    | { type: 'pan'; startPx: [number, number]; origCenter: [number, number] }
    | { type: 'moveObj'; objectId: string; offsetX: number; offsetY: number }
    | { type: 'resizeTree'; objectId: string }
    | null
  >(null);

  const mapBg = project.world.mapBackground ?? DEFAULT_MAP_BACKGROUND;
  const landDims = getMapLandSize(project.world.mapBackground, project.world.ground.size);
  const landWidth = landDims.width;
  const landHeight = landDims.height;
  const selectedObjectId = selection?.type === 'worldObject' ? selection.id : null;

  const tileGrid = useMemo(
    () =>
      computeMapTileGridForExtent(
        mapBg.latitude,
        mapBg.longitude,
        mapBg.zoom,
        landWidth,
        landHeight,
      ),
    [mapBg.latitude, mapBg.longitude, mapBg.zoom, landWidth, landHeight],
  );

  // Measure 2D canvas host and auto-fit land on open
  const fitLandView = useCallback(() => {
    const w = Math.max(240, canvasHostRef.current?.clientWidth ?? canvasSize.w);
    const h = Math.max(240, canvasHostRef.current?.clientHeight ?? canvasSize.h);
    setViewCenter([0, 0]);
    const scaleX = (w * 0.82) / landWidth;
    const scaleY = (h * 0.82) / landHeight;
    setPxPerMeter(Math.max(0.2, Math.min(scaleX, scaleY)));
  }, [landWidth, landHeight, canvasSize.w, canvasSize.h]);

  useEffect(() => {
    if (!isOpen) return;
    const el = canvasHostRef.current;
    if (!el) return;
    const updateSize = () => {
      const w = Math.max(200, Math.floor(el.clientWidth));
      const h = Math.max(200, Math.floor(el.clientHeight));
      setCanvasSize({ w, h });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      fitLandView();
    } else {
      setDraftPoly([]);
      setDraftWall([]);
      setDraftCircle(null);
    }
    // Only auto-fit when modal opens or land dimensions change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, landWidth, landHeight]);

  // Build / load 2D tile mosaic offscreen canvas
  useEffect(() => {
    if (!isOpen) return;
    const tilePx = 256;
    const sizePx = tileGrid.gridCount * tilePx;
    const offscreen = document.createElement('canvas');
    offscreen.width = sizePx;
    offscreen.height = sizePx;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, sizePx, sizePx);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.lineWidth = 1;
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    for (const cell of tileGrid.cells) {
      const px = cell.col * tilePx;
      const py = cell.row * tilePx;
      ctx.strokeRect(px, py, tilePx, tilePx);
      ctx.fillText(`z${tileGrid.zoom} ${cell.tx},${cell.ty}`, px + 8, py + 18);
    }

    mosaicCanvasRef.current = offscreen;
    setMosaicRev((r) => r + 1);

    let cancelled = false;
    const upgradeMixed =
      typeof window !== 'undefined' && window.location.protocol === 'https:';
    const template = mapBg.tileUrl.trim() || DEFAULT_MAP_BACKGROUND.tileUrl;

    for (const cell of tileGrid.cells) {
      const url = formatTileUrl(template, cell.tx, cell.ty, tileGrid.zoom, upgradeMixed);
      if (!url) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        ctx.drawImage(img, cell.col * tilePx, cell.row * tilePx, tilePx, tilePx);
        setMosaicRev((r) => r + 1);
      };
      img.onerror = () => {
        // Keep clean coordinate grid placeholder when offline/CORS blocked
      };
      img.src = url;
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen, tileGrid, mapBg.tileUrl]);

  const rosToCanvas = useCallback(
    (xM: number, yM: number): [number, number] => [
      canvasSize.w / 2 + (xM - viewCenter[0]) * pxPerMeter,
      canvasSize.h / 2 - (yM - viewCenter[1]) * pxPerMeter,
    ],
    [canvasSize.w, canvasSize.h, viewCenter, pxPerMeter],
  );

  const canvasToRos = useCallback(
    (cx: number, cy: number): [number, number] => [
      viewCenter[0] + (cx - canvasSize.w / 2) / pxPerMeter,
      viewCenter[1] - (cy - canvasSize.h / 2) / pxPerMeter,
    ],
    [canvasSize.w, canvasSize.h, viewCenter, pxPerMeter],
  );

  const pushLiveChange = useCallback(
    (objectId: string, name: string, kind: 'tree' | 'building' | 'wall', summary: string) => {
      const timeLabel = new Date().toLocaleTimeString('en-US', { hour12: false });
      setLiveChanges((prev) => [
        {
          id: `${objectId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          objectId,
          name,
          kind,
          summary,
          timeLabel,
        },
        ...prev.slice(0, 39),
      ]);
    },
    [],
  );

  const commitTreeAt = useCallback(
    (cx: number, cy: number, radiusM: number) => {
      const terrainZ = sampleElevationAt(mapBg, cx, cy);
      const baseSource = createDefaultTreeSource(treeStyle);
      const dims = computeTreeDimensionsForCanopy(radiusM, presetTreeHeight, treeStyle);

      const created = addWorldObject(
        treeStyle === 'pine' ? 'map_pine' : 'map_tree',
        {
          ...baseSource,
          canopyRadius: dims.canopyRadius,
          trunkRadius: dims.trunkRadius,
          trunkHeight: dims.trunkHeight,
          canopyHeight: dims.canopyHeight,
        },
        {
          xyz: [Number(cx.toFixed(3)), Number(cy.toFixed(3)), Number(terrainZ.toFixed(3))],
          rpy: [0, 0, 0],
        },
        true,
        45,
      );

      select({ type: 'worldObject', id: created.id });
      pushLiveChange(
        created.id,
        created.name,
        'tree',
        `${treeStyle} r=${dims.canopyRadius}m trunk=${dims.trunkHeight}m @ (${cx.toFixed(1)}, ${cy.toFixed(1)}, z=${terrainZ.toFixed(1)})`,
      );
    },
    [mapBg, treeStyle, presetTreeHeight, addWorldObject, select, pushLiveChange],
  );

  const commitBuildingPolygon = useCallback(
    (pts: [number, number][]) => {
      if (pts.length < 3) return;
      let sumX = 0;
      let sumY = 0;
      for (const [vx, vy] of pts) {
        sumX += vx;
        sumY += vy;
      }
      const cx = sumX / pts.length;
      const cy = sumY / pts.length;
      const localPts: [number, number][] = pts.map(([vx, vy]) => [
        Number((vx - cx).toFixed(3)),
        Number((vy - cy).toFixed(3)),
      ]);
      const terrainZ = sampleElevationAt(mapBg, cx, cy);
      const h = Math.max(0.5, Number(buildingHeight.toFixed(2)));
      const rgba = hexToRgba(buildingColor);

      const created = addWorldObject(
        'map_building',
        {
          type: 'primitive',
          shape: {
            kind: 'extrude',
            points: localPts,
            depth: h,
          },
          material: {
            name: 'building_mat',
            rgba,
          },
        },
        {
          xyz: [
            Number(cx.toFixed(3)),
            Number(cy.toFixed(3)),
            Number((terrainZ + h / 2).toFixed(3)),
          ],
          rpy: [0, 0, 0],
        },
        true,
      );

      setDraftPoly([]);
      select({ type: 'worldObject', id: created.id });
      pushLiveChange(
        created.id,
        created.name,
        'building',
        `${pts.length}-pt poly h=${h}m @ (${cx.toFixed(1)}, ${cy.toFixed(1)})`,
      );
    },
    [mapBg, buildingHeight, buildingColor, addWorldObject, select, pushLiveChange],
  );

  const commitWallPolyline = useCallback(
    (pts: [number, number][]) => {
      if (pts.length < 2) return;
      const h = Math.max(0.2, Number(wallHeight.toFixed(2)));
      const t = Math.max(0.05, Number(wallThickness.toFixed(2)));
      const rgba = hexToRgba(wallColor);
      let lastCreatedId: string | null = null;

      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i]!;
        const [x2, y2] = pts[i + 1]!;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const segLen = Math.hypot(dx, dy);
        if (segLen < 0.1) continue;

        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const yaw = Math.atan2(dy, dx);
        const len = Number((pts.length > 2 ? segLen + t * 0.45 : segLen).toFixed(3));
        const terrainZ = sampleElevationAt(mapBg, mx, my);

        const created = addWorldObject(
          'map_wall',
          {
            type: 'primitive',
            shape: {
              kind: 'box',
              size: [len, t, h],
            },
            material: {
              name: 'wall_mat',
              rgba,
            },
          },
          {
            xyz: [
              Number(mx.toFixed(3)),
              Number(my.toFixed(3)),
              Number((terrainZ + h / 2).toFixed(3)),
            ],
            rpy: [0, 0, Number(yaw.toFixed(4))],
          },
          true,
        );

        lastCreatedId = created.id;
        pushLiveChange(
          created.id,
          created.name,
          'wall',
          `L=${segLen.toFixed(1)}m h=${h}m t=${t}m @ (${mx.toFixed(1)}, ${my.toFixed(1)})`,
        );
      }

      setDraftWall([]);
      if (lastCreatedId) {
        select({ type: 'worldObject', id: lastCreatedId });
      }
    },
    [mapBg, wallHeight, wallThickness, wallColor, addWorldObject, select, pushLiveChange],
  );

  // Keyboard shortcuts inside Map Annotator Modal
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT') return;
      if (e.key === 'Escape') {
        if (draftPoly.length > 0) {
          setDraftPoly([]);
        } else if (draftWall.length > 0) {
          setDraftWall([]);
        } else {
          setOpen(false);
        }
      } else if (e.key === 'Enter' && tool === 'building' && draftPoly.length >= 3) {
        e.preventDefault();
        commitBuildingPolygon(draftPoly);
      } else if (e.key === 'Enter' && tool === 'wall' && draftWall.length >= 2) {
        e.preventDefault();
        commitWallPolyline(draftWall);
      } else if (e.key.toLowerCase() === 'v') {
        setTool('select');
      } else if (e.key.toLowerCase() === 't') {
        setTool('tree');
      } else if (e.key.toLowerCase() === 'b') {
        setTool('building');
      } else if (e.key.toLowerCase() === 'w') {
        setTool('wall');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, draftPoly, draftWall, tool, commitBuildingPolygon, commitWallPolyline, setOpen]);

  // Draw the 2D Map Canvas
  useEffect(() => {
    if (!isOpen) return;
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvasSize.w * dpr);
    canvas.height = Math.round(canvasSize.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#080c12';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    // Draw georeferenced tile mosaic
    const mosaic = mosaicCanvasRef.current;
    if (mosaic && mapBg.enabled) {
      const [eastOff, northOff] = tileGrid.centerOffsetEnu;
      const halfMosaic = tileGrid.planeSizeMeters / 2;
      const [tlx, tly] = rosToCanvas(eastOff - halfMosaic, northOff + halfMosaic);
      const spanPx = tileGrid.planeSizeMeters * pxPerMeter;
      ctx.globalAlpha = Math.max(0.25, mapBg.opacity);
      ctx.drawImage(mosaic, tlx, tly, spanPx, spanPx);
      ctx.globalAlpha = 1;
    }

    // Dynamic metric grid lines
    const targetPxStep = 64;
    const rawStepM = targetPxStep / Math.max(0.01, pxPerMeter);
    const pow10 = 10 ** Math.floor(Math.log10(rawStepM));
    const norm = rawStepM / pow10;
    const gridStepM = (norm < 2 ? 1 : norm < 5 ? 2 : 5) * pow10;

    const [minX, maxY] = canvasToRos(0, 0);
    const [maxX, minY] = canvasToRos(canvasSize.w, canvasSize.h);
    const startX = Math.floor(minX / gridStepM) * gridStepM;
    const startY = Math.floor(minY / gridStepM) * gridStepM;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= maxX; x += gridStepM) {
      const [cx] = rosToCanvas(x, 0);
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, canvasSize.h);
    }
    for (let y = startY; y <= maxY; y += gridStepM) {
      const [, cy] = rosToCanvas(0, y);
      ctx.moveTo(0, cy);
      ctx.lineTo(canvasSize.w, cy);
    }
    ctx.stroke();

    // Selected Land Extent Boundary (landWidth x landHeight)
    const [landLx, landTy] = rosToCanvas(-landWidth / 2, landHeight / 2);
    const landPxW = landWidth * pxPerMeter;
    const landPxH = landHeight * pxPerMeter;
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(landLx, landTy, landPxW, landPxH);
    ctx.setLineDash([]);
    const landLabel = `Land Area: ${landWidth}m × ${landHeight}m`;
    ctx.font = '11px monospace';
    const landTextW = ctx.measureText(landLabel).width;
    ctx.fillStyle = 'rgba(11, 15, 22, 0.8)';
    ctx.fillRect(landLx + 4, Math.max(4, landTy - 18), landTextW + 8, 15);
    ctx.fillStyle = '#34d399';
    ctx.fillText(landLabel, landLx + 8, Math.max(15, landTy - 7));

    // ROS Origin Axes (0,0)
    const [ox, oy] = rosToCanvas(0, 0);
    const axisPx = Math.max(18, Math.min(44, 4 * pxPerMeter));
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + axisPx, oy);
    ctx.stroke();
    ctx.strokeStyle = '#22c55e';
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox, oy - axisPx);
    ctx.stroke();

    // Robot Spawn Circle
    const [sx, sy] = rosToCanvas(
      project.world.robotSpawnPose.xyz[0],
      project.world.robotSpawnPose.xyz[1],
    );
    ctx.strokeStyle = '#38bdf8';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(6, 0.5 * pxPerMeter), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Existing World Objects (Buildings, Walls, Trees, Obstacles)
    for (const obj of project.world.objects) {
      const isSelected = obj.id === selectedObjectId;

      if (obj.source.type === 'tree') {
        const [tx, ty] = rosToCanvas(obj.pose.xyz[0], obj.pose.xyz[1]);
        const rPx = Math.max(5, obj.source.canopyRadius * pxPerMeter);
        ctx.fillStyle = isSelected
          ? 'rgba(56, 189, 248, 0.42)'
          : obj.source.style === 'pine'
            ? 'rgba(22, 163, 74, 0.42)'
            : 'rgba(34, 197, 94, 0.42)';
        ctx.strokeStyle = isSelected ? '#38bdf8' : '#4ade80';
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(tx, ty, rPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Trunk center dot
        ctx.fillStyle = '#92400e';
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(tx, ty, Math.max(3, obj.source.trunkRadius * pxPerMeter), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (isSelected) {
          // Radius resize handle on +X edge
          ctx.fillStyle = '#38bdf8';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(tx + rPx, ty, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        ctx.font = '10px monospace';
        const lbl = `${obj.name} (${obj.source.trunkHeight.toFixed(1)}m)`;
        const tw = ctx.measureText(lbl).width;
        ctx.fillStyle = 'rgba(11, 15, 22, 0.72)';
        ctx.fillRect(tx + rPx + 2, ty - 8, tw + 6, 13);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(lbl, tx + rPx + 5, ty + 2);
      } else if (obj.source.type === 'primitive') {
        if (obj.source.shape.kind === 'extrude') {
          const poly = getWorldExtrudePolygon(obj);
          if (poly && poly.length >= 3) {
            ctx.beginPath();
            poly.forEach(([px, py], i) => {
              const [cx, cy] = rosToCanvas(px, py);
              if (i === 0) ctx.moveTo(cx, cy);
              else ctx.lineTo(cx, cy);
            });
            ctx.closePath();
            const fillHex = rgbaToHex(obj.source.material.rgba);
            ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.48)' : `${fillHex}88`;
            ctx.strokeStyle = isSelected ? '#38bdf8' : '#f8fafc';
            ctx.lineWidth = isSelected ? 2.5 : 1.5;
            ctx.fill();
            ctx.stroke();

            const [cx, cy] = rosToCanvas(obj.pose.xyz[0], obj.pose.xyz[1]);
            const lbl = `${obj.name} (${obj.source.shape.depth}m)`;
            ctx.font = '10px monospace';
            const tw = ctx.measureText(lbl).width;
            ctx.fillStyle = 'rgba(11, 15, 22, 0.72)';
            ctx.fillRect(cx + 2, cy - 9, tw + 6, 13);
            ctx.fillStyle = '#f8fafc';
            ctx.fillText(lbl, cx + 5, cy + 1);
          }
        } else if (obj.source.shape.kind === 'box') {
          const [bx, by] = rosToCanvas(obj.pose.xyz[0], obj.pose.xyz[1]);
          const bw = Math.max(4, obj.source.shape.size[0] * pxPerMeter);
          const bh = Math.max(4, obj.source.shape.size[1] * pxPerMeter);
          const yaw = obj.pose.rpy[2] ?? 0;
          const fillHex = rgbaToHex(obj.source.material.rgba);

          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(-yaw);
          ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.55)' : `${fillHex}bb`;
          ctx.strokeStyle = isSelected ? '#38bdf8' : '#fbbf24';
          ctx.lineWidth = isSelected ? 2.5 : 1.25;
          ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
          ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
          ctx.restore();

          if (obj.name.includes('wall') || isSelected) {
            const lbl = `${obj.name} (${obj.source.shape.size[2]}m)`;
            ctx.font = '10px monospace';
            const tw = ctx.measureText(lbl).width;
            ctx.fillStyle = 'rgba(11, 15, 22, 0.72)';
            ctx.fillRect(bx + 4, by - 14, tw + 6, 13);
            ctx.fillStyle = '#fde68a';
            ctx.fillText(lbl, bx + 7, by - 4);
          }
        }
      }
    }

    // Active Draft Tree Canopy Circle
    if (draftCircle) {
      const [cx, cy] = rosToCanvas(draftCircle.cx, draftCircle.cy);
      const rPx = Math.max(6, draftCircle.radius * pxPerMeter);
      ctx.fillStyle = 'rgba(74, 222, 128, 0.35)';
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#bbf7d0';
      ctx.font = '11px monospace';
      ctx.fillText(`r=${draftCircle.radius.toFixed(1)}m`, cx + rPx + 6, cy);
    }

    // Active Draft Building Polygon
    if (tool === 'building' && draftPoly.length > 0) {
      ctx.beginPath();
      draftPoly.forEach(([vx, vy], i) => {
        const [cx, cy] = rosToCanvas(vx, vy);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      if (hoverRos) {
        const [hx, hy] = rosToCanvas(hoverRos[0], hoverRos[1]);
        ctx.lineTo(hx, hy);
      }
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (draftPoly.length >= 3) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
        ctx.closePath();
        ctx.fill();
      }

      // Draw polygon vertices
      draftPoly.forEach(([vx, vy], i) => {
        const [cx, cy] = rosToCanvas(vx, vy);
        ctx.fillStyle = i === 0 ? '#facc15' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(cx, cy, i === 0 && draftPoly.length >= 3 ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Active Draft Wall Polyline
    if (tool === 'wall' && draftWall.length > 0) {
      const previewPts = hoverRos ? [...draftWall, hoverRos] : draftWall;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = Math.max(3, wallThickness * pxPerMeter);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      previewPts.forEach(([vx, vy], i) => {
        const [cx, cy] = rosToCanvas(vx, vy);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();

      // Segment length labels
      ctx.font = '10px monospace';
      for (let i = 0; i < previewPts.length - 1; i++) {
        const [x1, y1] = previewPts[i]!;
        const [x2, y2] = previewPts[i + 1]!;
        const segLen = Math.hypot(x2 - x1, y2 - y1);
        if (segLen < 0.2) continue;
        const [mx, my] = rosToCanvas((x1 + x2) / 2, (y1 + y2) / 2);
        const label = `${segLen.toFixed(1)}m`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(11, 15, 22, 0.8)';
        ctx.fillRect(mx - tw / 2 - 3, my - 16, tw + 6, 13);
        ctx.fillStyle = '#fde68a';
        ctx.fillText(label, mx - tw / 2, my - 6);
      }

      // Wall corners
      draftWall.forEach(([vx, vy], i) => {
        const [cx, cy] = rosToCanvas(vx, vy);
        ctx.fillStyle = i === 0 ? '#facc15' : '#fbbf24';
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    ctx.restore();
  }, [
    isOpen,
    canvasSize,
    viewCenter,
    pxPerMeter,
    landWidth,
    landHeight,
    mapBg,
    tileGrid,
    mosaicRev,
    project.world.objects,
    project.world.robotSpawnPose,
    selectedObjectId,
    draftCircle,
    draftPoly,
    draftWall,
    wallThickness,
    hoverRos,
    tool,
    rosToCanvas,
    canvasToRos,
  ]);

  if (!isOpen) return null;

  const findHitObject = (rosX: number, rosY: number): { obj: WorldObject; handle?: 'radius' } | null => {
    for (let i = project.world.objects.length - 1; i >= 0; i--) {
      const obj = project.world.objects[i]!;
      if (obj.source.type === 'tree') {
        if (obj.id === selectedObjectId) {
          const handleX = obj.pose.xyz[0] + obj.source.canopyRadius;
          const handleY = obj.pose.xyz[1];
          const dPx = Math.hypot((rosX - handleX) * pxPerMeter, (rosY - handleY) * pxPerMeter);
          if (dPx <= 12) return { obj, handle: 'radius' };
        }
        const dist = Math.hypot(rosX - obj.pose.xyz[0], rosY - obj.pose.xyz[1]);
        if (dist <= Math.max(obj.source.canopyRadius, 12 / pxPerMeter)) {
          return { obj };
        }
      } else if (obj.source.type === 'primitive') {
        if (obj.source.shape.kind === 'extrude') {
          const poly = getWorldExtrudePolygon(obj);
          if (poly && pointInPolygon(rosX, rosY, poly)) {
            return { obj };
          }
        } else if (obj.source.shape.kind === 'box') {
          const pad = Math.max(0.1, 6 / pxPerMeter);
          const hx = obj.source.shape.size[0] / 2 + pad;
          const hy = obj.source.shape.size[1] / 2 + pad;
          const dx = rosX - obj.pose.xyz[0];
          const dy = rosY - obj.pose.xyz[1];
          const yaw = obj.pose.rpy[2] ?? 0;
          const cos = Math.cos(-yaw);
          const sin = Math.sin(-yaw);
          const lx = dx * cos - dy * sin;
          const ly = dx * sin + dy * cos;
          if (Math.abs(lx) <= hx && Math.abs(ly) <= hy) {
            return { obj };
          }
        }
      }
    }
    return null;
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const [rx, ry] = canvasToRos(cx, cy);

    // Middle or right mouse always pans
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragActionRef.current = {
        type: 'pan',
        startPx: [cx, cy],
        origCenter: [...viewCenter],
      };
      return;
    }

    if (tool === 'tree') {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraftCircle({ cx: rx, cy: ry, radius: presetTreeRadius, didDrag: false });
      return;
    }

    if (tool === 'building') {
      // Snap to close if clicking near first vertex with >= 3 points
      if (draftPoly.length >= 3) {
        const [fx, fy] = rosToCanvas(draftPoly[0]![0], draftPoly[0]![1]);
        if (Math.hypot(cx - fx, cy - fy) <= 14) {
          commitBuildingPolygon(draftPoly);
          return;
        }
      }
      setDraftPoly((prev) => [...prev, [Number(rx.toFixed(3)), Number(ry.toFixed(3))]]);
      return;
    }

    if (tool === 'wall') {
      setDraftWall((prev) => [...prev, [Number(rx.toFixed(3)), Number(ry.toFixed(3))]]);
      return;
    }

    // Select / Move / Resize tool
    const hit = findHitObject(rx, ry);
    if (hit) {
      select({ type: 'worldObject', id: hit.obj.id });
      e.currentTarget.setPointerCapture(e.pointerId);
      if (hit.handle === 'radius') {
        dragActionRef.current = { type: 'resizeTree', objectId: hit.obj.id };
      } else {
        dragActionRef.current = {
          type: 'moveObj',
          objectId: hit.obj.id,
          offsetX: rx - hit.obj.pose.xyz[0],
          offsetY: ry - hit.obj.pose.xyz[1],
        };
      }
    } else {
      select(null);
      e.currentTarget.setPointerCapture(e.pointerId);
      dragActionRef.current = {
        type: 'pan',
        startPx: [cx, cy],
        origCenter: [...viewCenter],
      };
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const [rx, ry] = canvasToRos(cx, cy);
    setHoverRos([rx, ry]);

    if (draftCircle) {
      const dist = Math.hypot(rx - draftCircle.cx, ry - draftCircle.cy);
      if (dist * pxPerMeter > 6 || draftCircle.didDrag) {
        setDraftCircle({
          ...draftCircle,
          radius: Math.max(0.25, dist),
          didDrag: true,
        });
      }
      return;
    }

    const drag = dragActionRef.current;
    if (!drag) return;

    if (drag.type === 'pan') {
      const dxM = (cx - drag.startPx[0]) / pxPerMeter;
      const dyM = (cy - drag.startPx[1]) / pxPerMeter;
      setViewCenter([drag.origCenter[0] - dxM, drag.origCenter[1] + dyM]);
    } else if (drag.type === 'moveObj') {
      const nextX = Number((rx - drag.offsetX).toFixed(3));
      const nextY = Number((ry - drag.offsetY).toFixed(3));
      const tz = sampleElevationAt(mapBg, nextX, nextY);
      updateWorldObject(drag.objectId, (obj) => {
        obj.pose.xyz[0] = nextX;
        obj.pose.xyz[1] = nextY;
        if (obj.source.type === 'tree') {
          obj.pose.xyz[2] = Number(tz.toFixed(3));
        } else if (obj.source.type === 'primitive' && obj.source.shape.kind === 'extrude') {
          obj.pose.xyz[2] = Number((tz + obj.source.shape.depth / 2).toFixed(3));
        } else if (obj.source.type === 'primitive' && obj.source.shape.kind === 'box') {
          obj.pose.xyz[2] = Number((tz + obj.source.shape.size[2] / 2).toFixed(3));
        }
      });
    } else if (drag.type === 'resizeTree') {
      const obj = project.world.objects.find((o) => o.id === drag.objectId);
      if (!obj || obj.source.type !== 'tree') return;
      const newRadius = Math.max(0.25, Math.hypot(rx - obj.pose.xyz[0], ry - obj.pose.xyz[1]));
      const dims = computeTreeDimensionsForCanopy(newRadius, presetTreeHeight, obj.source.style);
      updateWorldObject(drag.objectId, (draft) => {
        if (draft.source.type === 'tree') {
          draft.source.canopyRadius = dims.canopyRadius;
          draft.source.trunkRadius = dims.trunkRadius;
          draft.source.trunkHeight = dims.trunkHeight;
          draft.source.canopyHeight = dims.canopyHeight;
        }
      });
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draftCircle) {
      const r = draftCircle.didDrag ? draftCircle.radius : presetTreeRadius;
      commitTreeAt(draftCircle.cx, draftCircle.cy, r);
      setDraftCircle(null);
    }
    if (dragActionRef.current) {
      dragActionRef.current = null;
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const [beforeX, beforeY] = canvasToRos(cx, cy);
    const factor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
    const nextPx = Math.max(0.01, Math.min(500, pxPerMeter * factor));
    // Keep cursor world coordinate anchored under mouse during zoom
    const nextCenterX = beforeX - (cx - canvasSize.w / 2) / nextPx;
    const nextCenterY = beforeY + (cy - canvasSize.h / 2) / nextPx;
    setPxPerMeter(nextPx);
    setViewCenter([nextCenterX, nextCenterY]);
  };

  const treeCount = project.world.objects.filter((o) => o.source.type === 'tree').length;
  const buildingCount = project.world.objects.filter(
    (o) => o.source.type === 'primitive' && o.source.shape.kind === 'extrude',
  ).length;
  const wallCount = project.world.objects.filter(
    (o) =>
      o.source.type === 'primitive' &&
      o.source.shape.kind === 'box' &&
      (o.name.toLowerCase().includes('wall') || o.static),
  ).length;
  const selectedObj = project.world.objects.find((o) => o.id === selectedObjectId) ?? null;

  return (
    <div
      data-testid="map-annotator-modal"
      role="dialog"
      aria-label="2D Map Feature Builder"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3"
    >
      <div className="flex h-[90vh] w-[95vw] max-w-[1440px] flex-col overflow-hidden rounded-lg border border-[#2a3346] bg-[#0e121a] shadow-2xl">
        {/* Top Modal Header + Drawing Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#222938] bg-[#10141d] px-3 py-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">2D Map Feature Builder</span>
            <span className="rounded border border-[#253044] bg-[#0b0e14] px-2 py-0.5 font-mono text-[10px] text-emerald-300">
              {mapBg.latitude.toFixed(5)}, {mapBg.longitude.toFixed(5)} · {landWidth}m×{landHeight}m
            </span>

            <div className="h-4 w-px bg-[#252e3f]" aria-hidden="true" />

            {/* Drawing Tools */}
            <div className="flex items-center gap-1 rounded border border-[#232b3b] bg-[#0b0e14] p-0.5">
              <button
                type="button"
                data-testid="map-tool-select"
                aria-pressed={tool === 'select'}
                onClick={() => {
                  setTool('select');
                  setDraftPoly([]);
                  setDraftWall([]);
                }}
                className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium cursor-pointer ${
                  tool === 'select'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-[#171d29]'
                }`}
              >
                <MousePointer2 className="h-3.5 w-3.5" />
                Select / Move
              </button>
              <button
                type="button"
                data-testid="map-tool-tree"
                aria-pressed={tool === 'tree'}
                onClick={() => {
                  setTool('tree');
                  setDraftPoly([]);
                  setDraftWall([]);
                }}
                className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium cursor-pointer ${
                  tool === 'tree'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-[#171d29]'
                }`}
              >
                <Trees className="h-3.5 w-3.5" />
                Tree Canopy Circle
              </button>
              <button
                type="button"
                data-testid="map-tool-building"
                aria-pressed={tool === 'building'}
                onClick={() => {
                  setTool('building');
                  setDraftWall([]);
                }}
                className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium cursor-pointer ${
                  tool === 'building'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-300 hover:bg-[#171d29]'
                }`}
              >
                <Building2 className="h-3.5 w-3.5" />
                Building Polygon
              </button>
              <button
                type="button"
                data-testid="map-tool-wall"
                aria-pressed={tool === 'wall'}
                onClick={() => {
                  setTool('wall');
                  setDraftPoly([]);
                }}
                className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium cursor-pointer ${
                  tool === 'wall'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-300 hover:bg-[#171d29]'
                }`}
              >
                <BrickWall className="h-3.5 w-3.5" />
                Wall
              </button>
            </div>

            {/* Active Tool Options */}
            {tool === 'tree' && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                <select
                  aria-label="2D Tree Style"
                  value={treeStyle}
                  onChange={(e) => setTreeStyle(e.target.value as 'deciduous' | 'pine')}
                  className="h-7 rounded border border-[#2a3346] bg-[#0b0e14] px-1.5 font-mono text-[11px]"
                >
                  <option value="deciduous">Oak</option>
                  <option value="pine">Pine</option>
                </select>
                <label className="flex items-center gap-1">
                  <span className="text-slate-400">Canopy R (m)</span>
                  <input
                    type="number"
                    aria-label="Default canopy radius meters"
                    min={0.3}
                    max={25}
                    step={0.2}
                    value={presetTreeRadius}
                    onChange={(e) => setPresetTreeRadius(Math.max(0.3, Number(e.target.value) || 1.4))}
                    className="h-7 w-14 rounded border border-[#2a3346] bg-[#0b0e14] px-1.5 font-mono text-[11px]"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-slate-400">Height (m)</span>
                  <input
                    type="number"
                    aria-label="Default tree height meters"
                    min={1}
                    max={30}
                    step={0.5}
                    value={presetTreeHeight}
                    onChange={(e) => setPresetTreeHeight(Math.max(1, Number(e.target.value) || 3.2))}
                    className="h-7 w-14 rounded border border-[#2a3346] bg-[#0b0e14] px-1.5 font-mono text-[11px]"
                  />
                </label>
              </div>
            )}

            {tool === 'building' && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                <label className="flex items-center gap-1">
                  <span className="text-slate-400">Height (m)</span>
                  <input
                    type="number"
                    aria-label="Building extrusion height meters"
                    min={0.5}
                    max={150}
                    step={0.5}
                    value={buildingHeight}
                    onChange={(e) => setBuildingHeight(Math.max(0.5, Number(e.target.value) || 6))}
                    className="h-7 w-14 rounded border border-[#2a3346] bg-[#0b0e14] px-1.5 font-mono text-[11px]"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-slate-400">Color</span>
                  <input
                    type="color"
                    aria-label="Building facade color"
                    value={buildingColor}
                    onChange={(e) => setBuildingColor(e.target.value)}
                    className="h-6 w-7 cursor-pointer rounded border border-[#2a3346] bg-transparent p-0"
                  />
                </label>
                {draftPoly.length > 0 && (
                  <>
                    <button
                      type="button"
                      data-testid="finish-building-poly-btn"
                      disabled={draftPoly.length < 3}
                      onClick={() => commitBuildingPolygon(draftPoly)}
                      className="inline-flex h-7 items-center gap-1 rounded bg-sky-600 px-2.5 text-[11px] font-medium text-white hover:bg-sky-500 disabled:opacity-40 cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Finish Building ({draftPoly.length} pts)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftPoly([])}
                      className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0b0e14] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )}

            {tool === 'wall' && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                <label className="flex items-center gap-1">
                  <span className="text-slate-400">Height (m)</span>
                  <input
                    type="number"
                    aria-label="Wall height meters"
                    min={0.2}
                    max={50}
                    step={0.25}
                    value={wallHeight}
                    onChange={(e) => setWallHeight(Math.max(0.2, Number(e.target.value) || 2.5))}
                    className="h-7 w-14 rounded border border-[#2a3346] bg-[#0b0e14] px-1.5 font-mono text-[11px]"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-slate-400">Thickness (m)</span>
                  <input
                    type="number"
                    aria-label="Wall thickness meters"
                    min={0.05}
                    max={10}
                    step={0.05}
                    value={wallThickness}
                    onChange={(e) => setWallThickness(Math.max(0.05, Number(e.target.value) || 0.35))}
                    className="h-7 w-14 rounded border border-[#2a3346] bg-[#0b0e14] px-1.5 font-mono text-[11px]"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-slate-400">Color</span>
                  <input
                    type="color"
                    aria-label="Wall color"
                    value={wallColor}
                    onChange={(e) => setWallColor(e.target.value)}
                    className="h-6 w-7 cursor-pointer rounded border border-[#2a3346] bg-transparent p-0"
                  />
                </label>
                {draftWall.length > 0 && (
                  <>
                    <button
                      type="button"
                      data-testid="finish-wall-btn"
                      disabled={draftWall.length < 2}
                      onClick={() => commitWallPolyline(draftWall)}
                      className="inline-flex h-7 items-center gap-1 rounded bg-amber-600 px-2.5 text-[11px] font-medium text-white hover:bg-amber-500 disabled:opacity-40 cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Finish Wall ({draftWall.length} pts)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftWall([])}
                      className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0b0e14] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={fitLandView}
              className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] cursor-pointer"
            >
              <Maximize2 className="h-3 w-3" />
              Fit Land
            </button>
            <button
              type="button"
              data-testid="close-map-builder-btn"
              onClick={() => setOpen(false)}
              className="inline-flex h-7 items-center gap-1 rounded bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 cursor-pointer"
            >
              Done
            </button>
            <button
              type="button"
              aria-label="Close 2D Map Builder"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-slate-400 hover:bg-[#1a202e] hover:text-slate-100 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Split Body: Left 2D Interactive Map + Right Live 3D Window & Live Changes Feed */}
        <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-12">
          {/* 2D Map Window */}
          <div className="relative flex flex-col border-b lg:border-b-0 lg:border-r border-[#222938] lg:col-span-7 min-h-[320px]">
            <div ref={canvasHostRef} className="relative flex-1 min-h-0 bg-[#080c12]">
              <canvas
                ref={mapCanvasRef}
                data-testid="map-2d-canvas"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onDoubleClick={() => {
                  if (tool === 'building' && draftPoly.length >= 3) {
                    commitBuildingPolygon(draftPoly);
                  } else if (tool === 'wall' && draftWall.length >= 2) {
                    commitWallPolyline(draftWall);
                  }
                }}
                onWheel={handleCanvasWheel}
                className={`block h-full w-full ${
                  tool === 'select' ? 'cursor-default' : 'cursor-crosshair'
                }`}
              />

              {/* Top-left 2D Map Instructions */}
              <div className="pointer-events-none absolute top-2.5 left-2.5 rounded border border-[#232b3b] bg-[#0e121a]/90 px-2.5 py-1 text-[11px] text-slate-300">
                {tool === 'tree' &&
                  'Click or drag on the map to place a Tree Canopy + Trunk · Scroll to zoom'}
                {tool === 'building' &&
                  'Click corners to trace Building Polygon · Click yellow start dot, double-click, or press Enter to extrude'}
                {tool === 'wall' &&
                  'Click points along a path to trace Wall segments · Double-click, press Enter, or click Finish Wall'}
                {tool === 'select' &&
                  'Click tree/building/wall to select · Drag to reposition · Drag blue handle to resize tree'}
              </div>

              {/* Bottom-left Coordinates + 2D Zoom Controls */}
              <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5">
                <div className="rounded border border-[#232b3b] bg-[#0e121a]/90 px-2 py-1 font-mono text-[10px] text-slate-300 tabular-nums">
                  {hoverRos
                    ? `E:${hoverRos[0].toFixed(1)}m N:${hoverRos[1].toFixed(1)}m Z:${sampleElevationAt(mapBg, hoverRos[0], hoverRos[1]).toFixed(1)}m`
                    : `Scale: ${pxPerMeter.toFixed(2)} px/m`}
                </div>
                <button
                  type="button"
                  aria-label="Zoom in 2D map"
                  onClick={() => setPxPerMeter((p) => Math.min(500, p * 1.25))}
                  className="flex h-6 w-6 items-center justify-center rounded border border-[#2a3346] bg-[#0e121a] text-slate-300 hover:bg-[#1a202e] cursor-pointer"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Zoom out 2D map"
                  onClick={() => setPxPerMeter((p) => Math.max(0.01, p / 1.25))}
                  className="flex h-6 w-6 items-center justify-center rounded border border-[#2a3346] bg-[#0e121a] text-slate-300 hover:bg-[#1a202e] cursor-pointer"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Reset 2D map view"
                  onClick={fitLandView}
                  className="flex h-6 w-6 items-center justify-center rounded border border-[#2a3346] bg-[#0e121a] text-slate-300 hover:bg-[#1a202e] cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Live 3D Changes Preview Window + Live Generated Elements List */}
          <div className="flex flex-col lg:col-span-5 min-h-0 bg-[#0b0e14]">
            {/* Live 3D Viewport */}
            <div className="flex items-center justify-between border-b border-[#222938] bg-[#10141d] px-3 py-1.5 shrink-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Eye className="h-3.5 w-3.5 text-cyan-400" />
                <span>Live 3D Scene Preview</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  data-testid="map-live-counts"
                  className="font-mono text-[11px] text-slate-300"
                >
                  {treeCount} trees · {buildingCount} buildings · {wallCount} walls
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewFocusNonce((n) => n + 1)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-[#2a3346] bg-[#0b0e14] px-1.5 text-[10px] text-slate-300 hover:bg-[#1a202e] cursor-pointer"
                >
                  <Crosshair className="h-3 w-3" />
                  Fit 3D
                </button>
              </div>
            </div>

            <div
              data-testid="map-live-3d-preview"
              className="relative h-[56%] min-h-[220px] border-b border-[#222938]"
            >
              {(() => {
                const soft = isSoftwareGlRenderer();
                return (
                  <Canvas
                    frameloop="demand"
                    dpr={soft ? 1 : [1, 1.5]}
                    gl={{ antialias: !soft }}
                  >
                    <LiveMapPreviewScene
                      selectedObjectId={selectedObjectId}
                      focusNonce={previewFocusNonce}
                    />
                  </Canvas>
                );
              })()}
            </div>

            {/* Selected Object Quick Editor + Live Generated Elements Log */}
            <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
              {selectedObj && (
                <div className="flex items-center justify-between gap-2 border-b border-[#222938] bg-[#131926] px-3 py-1.5 text-xs shrink-0">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-mono font-semibold text-sky-300 truncate">
                      {selectedObj.name}
                    </span>
                    {selectedObj.source.type === 'primitive' &&
                      selectedObj.source.shape.kind === 'extrude' && (
                        <label className="flex items-center gap-1 text-[11px] text-slate-300">
                          <span>H:</span>
                          <input
                            type="number"
                            aria-label="Selected building height"
                            min={0.5}
                            max={150}
                            step={0.5}
                            value={selectedObj.source.shape.depth}
                            onChange={(e) => {
                              const nextH = Math.max(0.5, Number(e.target.value) || 1);
                              updateWorldObject(selectedObj.id, (draft) => {
                                if (
                                  draft.source.type === 'primitive' &&
                                  draft.source.shape.kind === 'extrude'
                                ) {
                                  const tz = sampleElevationAt(
                                    mapBg,
                                    draft.pose.xyz[0],
                                    draft.pose.xyz[1],
                                  );
                                  draft.source.shape.depth = nextH;
                                  draft.pose.xyz[2] = Number((tz + nextH / 2).toFixed(3));
                                }
                              });
                            }}
                            className="h-6 w-14 rounded border border-[#2a3346] bg-[#0b0e14] px-1 font-mono text-[11px]"
                          />
                        </label>
                      )}
                    {selectedObj.source.type === 'primitive' &&
                      selectedObj.source.shape.kind === 'box' && (
                        <>
                          <label className="flex items-center gap-1 text-[11px] text-slate-300">
                            <span>H:</span>
                            <input
                              type="number"
                              aria-label="Selected wall height"
                              min={0.2}
                              max={50}
                              step={0.25}
                              value={selectedObj.source.shape.size[2]}
                              onChange={(e) => {
                                const nextH = Math.max(0.2, Number(e.target.value) || 1);
                                updateWorldObject(selectedObj.id, (draft) => {
                                  if (
                                    draft.source.type === 'primitive' &&
                                    draft.source.shape.kind === 'box'
                                  ) {
                                    const tz = sampleElevationAt(
                                      mapBg,
                                      draft.pose.xyz[0],
                                      draft.pose.xyz[1],
                                    );
                                    draft.source.shape.size[2] = nextH;
                                    draft.pose.xyz[2] = Number((tz + nextH / 2).toFixed(3));
                                  }
                                });
                              }}
                              className="h-6 w-14 rounded border border-[#2a3346] bg-[#0b0e14] px-1 font-mono text-[11px]"
                            />
                          </label>
                          <label className="flex items-center gap-1 text-[11px] text-slate-300">
                            <span>T:</span>
                            <input
                              type="number"
                              aria-label="Selected wall thickness"
                              min={0.05}
                              max={10}
                              step={0.05}
                              value={selectedObj.source.shape.size[1]}
                              onChange={(e) => {
                                const nextT = Math.max(0.05, Number(e.target.value) || 0.35);
                                updateWorldObject(selectedObj.id, (draft) => {
                                  if (
                                    draft.source.type === 'primitive' &&
                                    draft.source.shape.kind === 'box'
                                  ) {
                                    draft.source.shape.size[1] = nextT;
                                  }
                                });
                              }}
                              className="h-6 w-14 rounded border border-[#2a3346] bg-[#0b0e14] px-1 font-mono text-[11px]"
                            />
                          </label>
                        </>
                      )}
                    {selectedObj.source.type === 'tree' && (
                      <>
                        <label className="flex items-center gap-1 text-[11px] text-slate-300">
                          <span>R:</span>
                          <input
                            type="number"
                            aria-label="Selected tree canopy radius"
                            min={0.25}
                            max={25}
                            step={0.2}
                            value={selectedObj.source.canopyRadius}
                            onChange={(e) => {
                              const nextR = Math.max(0.25, Number(e.target.value) || 1);
                              const dims = computeTreeDimensionsForCanopy(
                                nextR,
                                presetTreeHeight,
                                selectedObj.source.type === 'tree'
                                  ? selectedObj.source.style
                                  : 'deciduous',
                              );
                              updateWorldObject(selectedObj.id, (draft) => {
                                if (draft.source.type === 'tree') {
                                  draft.source.canopyRadius = dims.canopyRadius;
                                  draft.source.trunkRadius = dims.trunkRadius;
                                  draft.source.trunkHeight = dims.trunkHeight;
                                  draft.source.canopyHeight = dims.canopyHeight;
                                }
                              });
                            }}
                            className="h-6 w-14 rounded border border-[#2a3346] bg-[#0b0e14] px-1 font-mono text-[11px]"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-[11px] text-slate-300">
                          <span>Trunk:</span>
                          <input
                            type="number"
                            aria-label="Selected tree trunk height"
                            min={0.3}
                            max={20}
                            step={0.2}
                            value={selectedObj.source.trunkHeight}
                            onChange={(e) => {
                              const nextTH = Math.max(0.3, Number(e.target.value) || 1);
                              updateWorldObject(selectedObj.id, (draft) => {
                                if (draft.source.type === 'tree') {
                                  draft.source.trunkHeight = nextTH;
                                }
                              });
                            }}
                            className="h-6 w-14 rounded border border-[#2a3346] bg-[#0b0e14] px-1 font-mono text-[11px]"
                          />
                        </label>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete ${selectedObj.name}`}
                    onClick={() => deleteWorldObject(selectedObj.id)}
                    className="inline-flex h-6 items-center gap-1 rounded border border-red-800/60 bg-red-950/40 px-2 text-[11px] text-red-300 hover:bg-red-900/50 cursor-pointer shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between border-b border-[#222938] bg-[#10141d] px-3 py-1 text-[11px] font-semibold text-slate-300 shrink-0">
                <span>Live Generated Elements ({project.world.objects.length})</span>
                <span className="font-mono text-[10px] text-slate-500">
                  Real-time World Sync
                </span>
              </div>

              <div
                data-testid="map-live-changes-feed"
                className="flex-1 overflow-y-auto p-2 space-y-1.5"
              >
                {liveChanges.length === 0 && project.world.objects.length === 0 ? (
                  <p className="p-2 text-xs text-slate-500">
                    Draw a Tree Canopy, Building Polygon, or Wall on the 2D map to see 3D elements
                    generate live.
                  </p>
                ) : (
                  <>
                    {liveChanges.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between gap-2 rounded border border-emerald-900/40 bg-emerald-950/20 px-2 py-1 text-[11px]"
                      >
                        <button
                          type="button"
                          onClick={() => select({ type: 'worldObject', id: entry.objectId })}
                          className="flex items-center gap-1.5 min-w-0 text-left cursor-pointer"
                        >
                          <span
                            className={`rounded px-1 py-0.5 font-mono text-[9px] uppercase ${
                              entry.kind === 'tree'
                                ? 'bg-emerald-900/60 text-emerald-300'
                                : entry.kind === 'wall'
                                  ? 'bg-amber-900/60 text-amber-300'
                                  : 'bg-sky-900/60 text-sky-300'
                            }`}
                          >
                            {entry.kind}
                          </span>
                          <span className="font-mono font-semibold text-slate-200 truncate">
                            {entry.name}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400 truncate">
                            {entry.summary}
                          </span>
                        </button>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">
                          {entry.timeLabel}
                        </span>
                      </div>
                    ))}
                    {project.world.objects.map((obj) => {
                      const alreadyLogged = liveChanges.some((c) => c.objectId === obj.id);
                      if (alreadyLogged) return null;
                      const isBldg =
                        obj.source.type === 'primitive' && obj.source.shape.kind === 'extrude';
                      const isWall =
                        obj.source.type === 'primitive' &&
                        obj.source.shape.kind === 'box' &&
                        (obj.name.toLowerCase().includes('wall') || obj.static);
                      const tag =
                        obj.source.type === 'tree'
                          ? 'tree'
                          : isBldg
                            ? 'building'
                            : isWall
                              ? 'wall'
                              : 'object';
                      return (
                        <div
                          key={obj.id}
                          className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px] ${
                            obj.id === selectedObjectId
                              ? 'border-sky-500/70 bg-sky-950/25'
                              : 'border-[#222938] bg-[#0e121a]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => select({ type: 'worldObject', id: obj.id })}
                            className="flex items-center gap-1.5 min-w-0 text-left cursor-pointer"
                          >
                            <span className="rounded bg-[#1a2232] px-1 py-0.5 font-mono text-[9px] uppercase text-slate-300">
                              {tag}
                            </span>
                            <span className="font-mono text-slate-200 truncate">{obj.name}</span>
                            <span className="font-mono text-[10px] text-slate-500">
                              ({obj.pose.xyz[0].toFixed(1)}, {obj.pose.xyz[1].toFixed(1)})
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${obj.name}`}
                            onClick={() => deleteWorldObject(obj.id)}
                            className="text-slate-500 hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
