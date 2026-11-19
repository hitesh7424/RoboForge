import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  computeMapTextureCanvasSize,
  computeMapTileGridForExtent,
  DEFAULT_MAP_BACKGROUND,
  formatLatLonPair,
  formatTileUrl,
  getMapLandSize,
  nudgeLatLonMeters,
  shiftLatLonByMapDrag,
} from '@/core/mapTiles';
import type { SurfaceZone, WorldObject } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import {
  buildTerrainConformingWallSegments,
  computeBuildingTerrainPlacement,
  computePropTerrainPose,
  computeTreeTerrainPose,
  regroundWorldObjectToTerrain,
  sampleTerrainHeight,
} from '@/core/terrainGrounding';
import { materializePresetAsTextureAsset } from '@/core/texturePresets';
import {
  computeTreeDimensionsForCanopy,
  createDefaultTreeSource,
} from '@/core/treeGeometry';
import {
  exportCompositeGroundPngBase64,
  renderCompositeGroundCanvas,
} from '@/core/worldTextureCompositor';
import {
  createRectZonePoints,
  findTopHitSurfaceZone,
  pointInPolygon2D,
  translateZonePoints,
} from '@/core/worldZones';
import {
  COSMETIC_PROP_PRESETS,
  hexToRgba,
  rgbaToHex,
  type ActiveBrushMaterial,
  type StudioTool,
} from '@/worldStudio/types';

export interface WorldStudio2DCanvasProps {
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
  onSelectTool?: (tool: StudioTool) => void;
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

type DragAction =
  | { type: 'pan'; startPx: [number, number]; origCenter: [number, number] }
  | { type: 'moveMap'; startPx: [number, number] }
  | { type: 'moveObj'; objectId: string; offsetX: number; offsetY: number }
  | { type: 'resizeTree'; objectId: string }
  | {
      type: 'moveZone';
      zoneId: string;
      startRos: [number, number];
      origPoints: [number, number][];
    }
  | { type: 'moveZoneVertex'; zoneId: string; vertexIdx: number }
  | { type: 'resizeZoneCircle'; zoneId: string }
  | { type: 'drawRect'; startRos: [number, number]; endRos: [number, number] }
  | { type: 'drawCircle'; cx: number; cy: number; radius: number; didDrag: boolean; forTree: boolean };

export function WorldStudio2DCanvas({
  tool,
  brush,
  showGrid,
  snapEnabled,
  snapStep,
  treeStyle,
  treeRadius,
  treeHeight,
  buildingHeight,
  buildingColor,
  wallHeight,
  wallThickness,
  selectedPropId,
  onSelectTool,
}: WorldStudio2DCanvasProps) {
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const select = useRoboForgeStore((s) => s.select);
  const addTexture = useRoboForgeStore((s) => s.addTexture);
  const addSurfaceZone = useRoboForgeStore((s) => s.addSurfaceZone);
  const updateSurfaceZone = useRoboForgeStore((s) => s.updateSurfaceZone);
  const addWorldObject = useRoboForgeStore((s) => s.addWorldObject);
  const updateWorldObject = useRoboForgeStore((s) => s.updateWorldObject);
  const updateWorld = useRoboForgeStore((s) => s.updateWorld);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const satelliteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 720, h: 560 });
  const [viewCenter, setViewCenter] = useState<[number, number]>([0, 0]);
  const [pxPerMeter, setPxPerMeter] = useState(5.5);
  const [hoverRos, setHoverRos] = useState<[number, number] | null>(null);
  const [mosaicRev, setMosaicRev] = useState(0);
  const [assetTick, setAssetTick] = useState(0);
  const [mapDragDeltaRos, setMapDragDeltaRos] = useState<[number, number] | null>(null);
  const [mapNudgeStepM, setMapNudgeStepM] = useState<number>(10);

  // Active multi-point draft (polygon zone, road path, building, wall)
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([]);
  const [draftPreview, setDraftPreview] = useState<
    | { kind: 'rect'; p1: [number, number]; p2: [number, number] }
    | { kind: 'circle'; cx: number; cy: number; r: number; forTree: boolean }
    | null
  >(null);

  const dragRef = useRef<DragAction | null>(null);
  const didAutoFitRef = useRef(false);

  const mapBg = project.world.mapBackground ?? DEFAULT_MAP_BACKGROUND;
  const { width: landWidth, height: landHeight } = getMapLandSize(
    project.world.mapBackground,
    project.world.ground.size,
  );

  const selectedObjectId = selection?.type === 'worldObject' ? selection.id : null;
  const selectedZoneId = selection?.type === 'surfaceZone' ? selection.id : null;
  const selectedLightId = selection?.type === 'worldLight' ? selection.id : null;

  const tileGrid = useMemo(
    () =>
      computeMapTileGridForExtent(
        mapBg.latitude,
        mapBg.longitude,
        mapBg.zoom,
        tool === 'move_map' ? landWidth * 2.2 : landWidth,
        tool === 'move_map' ? landHeight * 2.2 : landHeight,
      ),
    [mapBg.latitude, mapBg.longitude, mapBg.zoom, landWidth, landHeight, tool],
  );

  const applyMapNudge = useCallback(
    (eastM: number, northM: number) => {
      const next = nudgeLatLonMeters(mapBg.latitude, mapBg.longitude, eastM, northM);
      updateWorld((w) => {
        if (!w.mapBackground) w.mapBackground = { ...DEFAULT_MAP_BACKGROUND };
        w.mapBackground.latitude = next.lat;
        w.mapBackground.longitude = next.lon;
        w.mapBackground.enabled = true;
      });
    },
    [mapBg.latitude, mapBg.longitude, updateWorld],
  );

  const snapCoord = useCallback(
    (v: number): number => {
      if (!snapEnabled || snapStep <= 0) return Number(v.toFixed(3));
      return Number((Math.round(v / snapStep) * snapStep).toFixed(3));
    },
    [snapEnabled, snapStep],
  );

  const clampToLandX = useCallback(
    (v: number): number => {
      const half = landWidth / 2;
      return Math.max(-half, Math.min(half, v));
    },
    [landWidth],
  );

  const clampToLandY = useCallback(
    (v: number): number => {
      const half = landHeight / 2;
      return Math.max(-half, Math.min(half, v));
    },
    [landHeight],
  );

  const fitLandView = useCallback(() => {
    const w = Math.max(220, hostRef.current?.clientWidth ?? canvasSize.w);
    const h = Math.max(220, hostRef.current?.clientHeight ?? canvasSize.h);
    setViewCenter([0, 0]);
    const scaleX = (w * 0.84) / landWidth;
    const scaleY = (h * 0.84) / landHeight;
    setPxPerMeter(Math.max(0.25, Math.min(scaleX, scaleY)));
  }, [landWidth, landHeight, canvasSize.w, canvasSize.h]);

  // Observe container size
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.max(180, Math.floor(el.clientWidth));
      const h = Math.max(180, Math.floor(el.clientHeight));
      setCanvasSize({ w, h });
      if (!didAutoFitRef.current && w > 180 && h > 180) {
        didAutoFitRef.current = true;
        const scaleX = (w * 0.84) / landWidth;
        const scaleY = (h * 0.84) / landHeight;
        setPxPerMeter(Math.max(0.25, Math.min(scaleX, scaleY)));
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [landWidth, landHeight]);

  // Clear multi-point draft when switching tools
  useEffect(() => {
    setDraftPoints([]);
    setDraftPreview(null);
  }, [tool]);

  // Stream satellite mosaic tiles for 2D background when enabled
  useEffect(() => {
    if (!mapBg.enabled) {
      satelliteCanvasRef.current = null;
      setMosaicRev((r) => r + 1);
      return;
    }

    const tilePx = 256;
    const sizePx = tileGrid.gridCount * tilePx;
    const offscreen = document.createElement('canvas');
    offscreen.width = sizePx;
    offscreen.height = sizePx;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#121926';
    ctx.fillRect(0, 0, sizePx, sizePx);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 1;
    for (const cell of tileGrid.cells) {
      ctx.strokeRect(cell.col * tilePx, cell.row * tilePx, tilePx, tilePx);
    }

    satelliteCanvasRef.current = offscreen;
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
      img.onerror = () => {};
      img.src = url;
    }

    return () => {
      cancelled = true;
    };
  }, [mapBg.enabled, mapBg.tileUrl, tileGrid]);

  // Re-composite the multi-texture ground map whenever zones, base preset, textures, or satellite tiles update
  useEffect(() => {
    const { widthPx, heightPx } = computeMapTextureCanvasSize(landWidth, landHeight, 768);
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
    renderCompositeGroundCanvas({
      world: project.world,
      textures: project.textures,
      canvas: compositeCanvasRef.current,
      landSize: landWidth,
      landHeight,
      satelliteMosaic: satelliteCanvasRef.current,
      tileGrid,
      onAssetImageLoaded: () => setAssetTick((t) => t + 1),
    });

    // Also keep mapTextureBase64 synced in pure 2D mode for Gazebo export
    const timer = globalThis.setTimeout(() => {
      const hasZones = (project.world.surfaceZones ?? []).some((z) => z.visible);
      const hasBasePreset = Boolean(project.world.cosmetics?.groundBasePresetId);
      if (hasZones || hasBasePreset) {
        const b64 = exportCompositeGroundPngBase64(
          project.world,
          project.textures,
          landWidth,
          satelliteCanvasRef.current,
          tileGrid,
          1024,
          landHeight,
        );
        if (b64) {
          useRoboForgeStore.getState().setMapTileTexture(b64);
        }
      }
    }, 450);

    return () => globalThis.clearTimeout(timer);
  }, [project.world, project.textures, landWidth, landHeight, mosaicRev, tileGrid, assetTick]);

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

  const commitDraftShape = useCallback(
    (pts: [number, number][]) => {
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
        setDraftPoints([]);
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
        setDraftPoints([]);
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
        setDraftPoints([]);
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
        setDraftPoints([]);
      }
    },
    [
      tool,
      brush,
      buildingHeight,
      buildingColor,
      wallHeight,
      wallThickness,
      mapBg,
      addSurfaceZone,
      addWorldObject,
      ensurePresetAssetId,
    ],
  );

  // Keyboard shortcuts for finishing drafts or nudging map in Move Map mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') {
        return;
      }
      if (e.key === 'Escape') {
        setDraftPoints([]);
        setDraftPreview(null);
        setMapDragDeltaRos(null);
        if (tool === 'move_map' && onSelectTool) {
          onSelectTool('select');
        }
      } else if (e.key === 'Enter' && draftPoints.length >= 2) {
        e.preventDefault();
        commitDraftShape(draftPoints);
      } else if (tool === 'move_map') {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          applyMapNudge(0, mapNudgeStepM);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          applyMapNudge(0, -mapNudgeStepM);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          applyMapNudge(-mapNudgeStepM, 0);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          applyMapNudge(mapNudgeStepM, 0);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draftPoints, commitDraftShape, tool, mapNudgeStepM, applyMapNudge, onSelectTool]);

  // Draw the live 2D Studio Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvasSize.w * dpr);
    canvas.height = Math.round(canvasSize.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Outer canvas background
    ctx.fillStyle = '#090d14';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    const [landLx, landTy] = rosToCanvas(-landWidth / 2, landHeight / 2);
    const landPxW = landWidth * pxPerMeter;
    const landPxH = landHeight * pxPerMeter;
    const [dragDxRos, dragDyRos] = mapDragDeltaRos ?? [0, 0];
    const dragOffsetPxX = dragDxRos * pxPerMeter;
    const dragOffsetPxY = -dragDyRos * pxPerMeter;

    // When in Move Map mode, draw surrounding satellite context outside the land boundary
    // so users can see nearby streets/landmarks and align the exact capture rectangle smoothly.
    const satMosaic = satelliteCanvasRef.current;
    if (tool === 'move_map' && mapBg.enabled && satMosaic) {
      const [originCanvasX, originCanvasY] = rosToCanvas(0, 0);
      const mosaicSpanM = Math.max(0.1, tileGrid.planeSizeMeters);
      const mosaicPx = satMosaic.width;
      const [eastOff, northOff] = tileGrid.centerOffsetEnu;
      const u0 = 0.5 - eastOff / mosaicSpanM;
      const v0 = 0.5 - northOff / mosaicSpanM;
      const cxM = u0 * mosaicPx;
      const cyM = (1 - v0) * mosaicPx;
      const mosaicDrawScale = (mosaicSpanM * pxPerMeter) / mosaicPx;

      ctx.save();
      ctx.translate(originCanvasX + dragOffsetPxX, originCanvasY + dragOffsetPxY);
      if (mapBg.headingDeg !== 0) {
        ctx.rotate((mapBg.headingDeg * Math.PI) / 180);
      }
      ctx.scale(mosaicDrawScale, mosaicDrawScale);
      ctx.drawImage(satMosaic, -cxM, -cyM);
      ctx.restore();

      // Dim the surrounding context outside the exact capture frame
      ctx.fillStyle = 'rgba(6, 10, 18, 0.54)';
      ctx.fillRect(0, 0, canvasSize.w, Math.max(0, landTy));
      ctx.fillRect(0, landTy + landPxH, canvasSize.w, Math.max(0, canvasSize.h - (landTy + landPxH)));
      ctx.fillRect(0, Math.max(0, landTy), Math.max(0, landLx), Math.min(canvasSize.h, landPxH));
      ctx.fillRect(
        landLx + landPxW,
        Math.max(0, landTy),
        Math.max(0, canvasSize.w - (landLx + landPxW)),
        Math.min(canvasSize.h, landPxH),
      );
    }

    // Draw composited multi-texture ground map inside the exact Land Extent
    // (skip static composite while actively dragging raw satellite mosaic in Move Map mode)
    const comp = compositeCanvasRef.current;
    if (comp && !(tool === 'move_map' && mapBg.enabled && satMosaic)) {
      ctx.drawImage(comp, landLx, landTy, landPxW, landPxH);
    }

    // Optional metric grid
    if (showGrid) {
      const targetPxStep = 64;
      const rawStepM = targetPxStep / Math.max(0.01, pxPerMeter);
      const pow10 = 10 ** Math.floor(Math.log10(rawStepM));
      const norm = rawStepM / pow10;
      const gridStepM = (norm < 2 ? 1 : norm < 5 ? 2 : 5) * pow10;

      const [minX, maxY] = canvasToRos(0, 0);
      const [maxX, minY] = canvasToRos(canvasSize.w, canvasSize.h);
      const startX = Math.floor(minX / gridStepM) * gridStepM;
      const startY = Math.floor(minY / gridStepM) * gridStepM;

      ctx.strokeStyle = 'rgba(226, 232, 240, 0.14)';
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
    }

    // Land Extent border (highlighted with corner brackets when in Move Map mode)
    ctx.strokeStyle = tool === 'move_map' ? '#22d3ee' : 'rgba(52, 211, 153, 0.72)';
    ctx.lineWidth = tool === 'move_map' ? 2.2 : 1.5;
    if (tool !== 'move_map') {
      ctx.setLineDash([6, 4]);
    }
    ctx.strokeRect(landLx, landTy, landPxW, landPxH);
    ctx.setLineDash([]);

    if (tool === 'move_map') {
      const bLen = Math.min(18, Math.max(8, Math.min(landPxW, landPxH) * 0.12));
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 3;
      ctx.beginPath();
      // Top-left
      ctx.moveTo(landLx, landTy + bLen);
      ctx.lineTo(landLx, landTy);
      ctx.lineTo(landLx + bLen, landTy);
      // Top-right
      ctx.moveTo(landLx + landPxW - bLen, landTy);
      ctx.lineTo(landLx + landPxW, landTy);
      ctx.lineTo(landLx + landPxW, landTy + bLen);
      // Bottom-left
      ctx.moveTo(landLx, landTy + landPxH - bLen);
      ctx.lineTo(landLx, landTy + landPxH);
      ctx.lineTo(landLx + bLen, landTy + landPxH);
      // Bottom-right
      ctx.moveTo(landLx + landPxW - bLen, landTy + landPxH);
      ctx.lineTo(landLx + landPxW, landTy + landPxH);
      ctx.lineTo(landLx + landPxW, landTy + landPxH - bLen);
      ctx.stroke();
    }

    // Draw subtle zone borders & handles for Surface Zones
    const zones = project.world.surfaceZones ?? [];
    for (const zone of zones) {
      if (!zone.visible) continue;
      const isSelected = zone.id === selectedZoneId;
      ctx.save();
      ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = isSelected ? 2.2 : 1;
      if (!isSelected) ctx.setLineDash([4, 4]);

      if (zone.kind === 'circle' && zone.points[0]) {
        const [cx, cy] = rosToCanvas(zone.points[0][0], zone.points[0][1]);
        const rPx = Math.max(4, (zone.radius ?? 4) * pxPerMeter);
        ctx.beginPath();
        ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
        ctx.stroke();

        if (isSelected) {
          ctx.setLineDash([]);
          ctx.fillStyle = '#38bdf8';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx + rPx, cy, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (zone.kind === 'path' && zone.points.length >= 2) {
        ctx.beginPath();
        zone.points.forEach(([x, y], idx) => {
          const [px, py] = rosToCanvas(x, y);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();

        if (isSelected) {
          ctx.setLineDash([]);
          zone.points.forEach(([x, y]) => {
            const [px, py] = rosToCanvas(x, y);
            ctx.fillStyle = '#38bdf8';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          });
        }
      } else if (zone.points.length >= 3) {
        ctx.beginPath();
        zone.points.forEach(([x, y], idx) => {
          const [px, py] = rosToCanvas(x, y);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.stroke();

        if (isSelected) {
          ctx.setLineDash([]);
          zone.points.forEach(([x, y]) => {
            const [px, py] = rosToCanvas(x, y);
            ctx.fillStyle = '#38bdf8';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          });
        }
      }
      ctx.restore();
    }

    // ROS Origin Axes
    const [ox, oy] = rosToCanvas(0, 0);
    const axisPx = Math.max(16, Math.min(36, 3.5 * pxPerMeter));
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

    // Robot Spawn Marker with heading arrow
    const [sx, sy] = rosToCanvas(
      project.world.robotSpawnPose.xyz[0],
      project.world.robotSpawnPose.xyz[1],
    );
    const spawnYaw = project.world.robotSpawnPose.rpy[2] ?? 0;
    const spawnR = Math.max(7, 0.55 * pxPerMeter);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, spawnR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(spawnYaw) * (spawnR + 8), sy - Math.sin(spawnYaw) * (spawnR + 8));
    ctx.stroke();

    // World Objects
    for (const obj of project.world.objects) {
      const isSelected = obj.id === selectedObjectId;
      if (obj.source.type === 'tree') {
        const [tx, ty] = rosToCanvas(obj.pose.xyz[0], obj.pose.xyz[1]);
        const rPx = Math.max(5, obj.source.canopyRadius * pxPerMeter);
        ctx.fillStyle = isSelected
          ? 'rgba(56, 189, 248, 0.45)'
          : obj.source.style === 'pine'
            ? 'rgba(21, 128, 61, 0.55)'
            : 'rgba(34, 197, 94, 0.5)';
        ctx.strokeStyle = isSelected ? '#38bdf8' : '#4ade80';
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(tx, ty, rPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#78350f';
        ctx.beginPath();
        ctx.arc(tx, ty, Math.max(2.5, obj.source.trunkRadius * pxPerMeter), 0, Math.PI * 2);
        ctx.fill();

        if (isSelected) {
          ctx.fillStyle = '#38bdf8';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(tx + rPx, ty, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (obj.source.type === 'primitive') {
        const fillHex = rgbaToHex(obj.source.material.rgba);
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
            ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.5)' : `${fillHex}b0`;
            ctx.strokeStyle = isSelected ? '#38bdf8' : '#f8fafc';
            ctx.lineWidth = isSelected ? 2.5 : 1.5;
            ctx.fill();
            ctx.stroke();
          }
        } else if (obj.source.shape.kind === 'box') {
          const [bx, by] = rosToCanvas(obj.pose.xyz[0], obj.pose.xyz[1]);
          const bw = Math.max(5, obj.source.shape.size[0] * pxPerMeter);
          const bh = Math.max(5, obj.source.shape.size[1] * pxPerMeter);
          const yaw = obj.pose.rpy[2] ?? 0;
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(-yaw);
          ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.55)' : `${fillHex}cc`;
          ctx.strokeStyle = isSelected ? '#38bdf8' : '#e2e8f0';
          ctx.lineWidth = isSelected ? 2.5 : 1.25;
          ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
          ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
          ctx.restore();
        } else if (
          obj.source.shape.kind === 'cylinder' ||
          obj.source.shape.kind === 'sphere' ||
          obj.source.shape.kind === 'capsule'
        ) {
          const [cx, cy] = rosToCanvas(obj.pose.xyz[0], obj.pose.xyz[1]);
          const rPx = Math.max(5, obj.source.shape.radius * pxPerMeter);
          ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.55)' : `${fillHex}cc`;
          ctx.strokeStyle = isSelected ? '#38bdf8' : '#f8fafc';
          ctx.lineWidth = isSelected ? 2.5 : 1.25;
          ctx.beginPath();
          ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // World Lights
    for (const light of project.world.lights) {
      const [lx, ly] = rosToCanvas(light.pose.xyz[0], light.pose.xyz[1]);
      const isSelected = light.id === selectedLightId;
      ctx.fillStyle = isSelected ? '#38bdf8' : '#fbbf24';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(lx, ly, isSelected ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Active drag preview (rect or circle)
    if (draftPreview?.kind === 'rect') {
      const [x1, y1] = rosToCanvas(draftPreview.p1[0], draftPreview.p1[1]);
      const [x2, y2] = rosToCanvas(draftPreview.p2[0], draftPreview.p2[1]);
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1);
      const rh = Math.abs(y2 - y1);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      const wM = Math.abs(draftPreview.p2[0] - draftPreview.p1[0]);
      const hM = Math.abs(draftPreview.p2[1] - draftPreview.p1[1]);
      ctx.font = '11px monospace';
      ctx.fillStyle = '#a7f3d0';
      ctx.fillText(`${wM.toFixed(1)}m × ${hM.toFixed(1)}m`, rx + 6, Math.max(16, ry - 6));
    } else if (draftPreview?.kind === 'circle') {
      const [cx, cy] = rosToCanvas(draftPreview.cx, draftPreview.cy);
      const rPx = Math.max(5, draftPreview.r * pxPerMeter);
      ctx.fillStyle = draftPreview.forTree
        ? 'rgba(74, 222, 128, 0.3)'
        : 'rgba(16, 185, 129, 0.25)';
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '11px monospace';
      ctx.fillStyle = '#a7f3d0';
      ctx.fillText(`r=${draftPreview.r.toFixed(1)}m`, cx + rPx + 6, cy + 4);
    }

    // Active multi-point draft (polygon / path / building / wall)
    if (draftPoints.length > 0) {
      const previewPts = hoverRos ? [...draftPoints, hoverRos] : draftPoints;
      const isLineTool = tool === 'zone_path' || tool === 'wall';
      ctx.save();
      ctx.beginPath();
      previewPts.forEach(([x, y], i) => {
        const [px, py] = rosToCanvas(x, y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      if (!isLineTool && draftPoints.length >= 3) {
        ctx.closePath();
        ctx.fillStyle =
          tool === 'building' ? 'rgba(56, 189, 248, 0.25)' : 'rgba(16, 185, 129, 0.25)';
        ctx.fill();
      }
      ctx.strokeStyle =
        tool === 'wall' ? '#f59e0b' : tool === 'building' ? '#38bdf8' : '#34d399';
      ctx.lineWidth =
        tool === 'zone_path'
          ? Math.max(3, brush.strokeWidth * pxPerMeter)
          : tool === 'wall'
            ? Math.max(3, wallThickness * pxPerMeter)
            : 2;
      if (tool === 'zone_path') {
        ctx.globalAlpha = 0.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
      ctx.stroke();
      ctx.restore();

      draftPoints.forEach(([x, y], i) => {
        const [px, py] = rosToCanvas(x, y);
        ctx.fillStyle = i === 0 ? '#facc15' : '#34d399';
        ctx.beginPath();
        ctx.arc(px, py, i === 0 && draftPoints.length >= 3 ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    ctx.restore();
  }, [
    canvasSize,
    viewCenter,
    pxPerMeter,
    landWidth,
    landHeight,
    showGrid,
    project.world,
    project.textures,
    mosaicRev,
    assetTick,
    selectedObjectId,
    selectedZoneId,
    selectedLightId,
    draftPreview,
    draftPoints,
    hoverRos,
    tool,
    brush.strokeWidth,
    wallThickness,
    rosToCanvas,
    canvasToRos,
    mapDragDeltaRos,
    mapBg.enabled,
    mapBg.headingDeg,
    tileGrid,
  ]);

  const findHitObject = (
    rx: number,
    ry: number,
  ): { obj: WorldObject; handle?: 'radius' } | null => {
    for (let i = project.world.objects.length - 1; i >= 0; i--) {
      const obj = project.world.objects[i]!;
      if (obj.source.type === 'tree') {
        if (obj.id === selectedObjectId) {
          const hx = obj.pose.xyz[0] + obj.source.canopyRadius;
          const hy = obj.pose.xyz[1];
          if (Math.hypot((rx - hx) * pxPerMeter, (ry - hy) * pxPerMeter) <= 12) {
            return { obj, handle: 'radius' };
          }
        }
        if (
          Math.hypot(rx - obj.pose.xyz[0], ry - obj.pose.xyz[1]) <=
          Math.max(obj.source.canopyRadius, 12 / pxPerMeter)
        ) {
          return { obj };
        }
      } else if (obj.source.type === 'primitive') {
        if (obj.source.shape.kind === 'extrude') {
          const poly = getWorldExtrudePolygon(obj);
          if (poly && pointInPolygon2D(rx, ry, poly)) return { obj };
        } else if (obj.source.shape.kind === 'box') {
          const pad = Math.max(0.15, 8 / pxPerMeter);
          const hx = obj.source.shape.size[0] / 2 + pad;
          const hy = obj.source.shape.size[1] / 2 + pad;
          const dx = rx - obj.pose.xyz[0];
          const dy = ry - obj.pose.xyz[1];
          const yaw = obj.pose.rpy[2] ?? 0;
          const cos = Math.cos(-yaw);
          const sin = Math.sin(-yaw);
          const lx = dx * cos - dy * sin;
          const ly = dx * sin + dy * cos;
          if (Math.abs(lx) <= hx && Math.abs(ly) <= hy) return { obj };
        } else if (
          obj.source.shape.kind === 'cylinder' ||
          obj.source.shape.kind === 'sphere' ||
          obj.source.shape.kind === 'capsule'
        ) {
          const r = Math.max(obj.source.shape.radius, 10 / pxPerMeter);
          if (Math.hypot(rx - obj.pose.xyz[0], ry - obj.pose.xyz[1]) <= r) return { obj };
        }
      }
    }
    return null;
  };

  const findSelectedZoneHandle = (
    cx: number,
    cy: number,
  ): { zone: SurfaceZone; kind: 'vertex'; idx: number } | { zone: SurfaceZone; kind: 'radius' } | null => {
    if (!selectedZoneId) return null;
    const zone = (project.world.surfaceZones ?? []).find((z) => z.id === selectedZoneId);
    if (!zone || !zone.visible) return null;
    if (zone.kind === 'circle' && zone.points[0]) {
      const [zx, zy] = rosToCanvas(zone.points[0][0], zone.points[0][1]);
      const rPx = Math.max(4, (zone.radius ?? 4) * pxPerMeter);
      if (Math.hypot(cx - (zx + rPx), cy - zy) <= 11) {
        return { zone, kind: 'radius' };
      }
      return null;
    }
    for (let i = 0; i < zone.points.length; i++) {
      const [px, py] = rosToCanvas(zone.points[i]![0], zone.points[i]![1]);
      if (Math.hypot(cx - px, cy - py) <= 10) {
        return { zone, kind: 'vertex', idx: i };
      }
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const [rawRx, rawRy] = canvasToRos(cx, cy);
    const rx = snapCoord(rawRx);
    const ry = snapCoord(rawRy);

    // Middle or right mouse always pans
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { type: 'pan', startPx: [cx, cy], origCenter: [...viewCenter] };
      return;
    }

    if (tool === 'move_map') {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { type: 'moveMap', startPx: [cx, cy] };
      setMapDragDeltaRos([0, 0]);
      return;
    }

    if (tool === 'zone_rect') {
      const cx0 = clampToLandX(rx);
      const cy0 = clampToLandY(ry);
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { type: 'drawRect', startRos: [cx0, cy0], endRos: [cx0, cy0] };
      setDraftPreview({ kind: 'rect', p1: [cx0, cy0], p2: [cx0, cy0] });
      return;
    }

    if (tool === 'zone_circle' || tool === 'tree') {
      const cx0 = tool === 'zone_circle' ? clampToLandX(rx) : rx;
      const cy0 = tool === 'zone_circle' ? clampToLandY(ry) : ry;
      e.currentTarget.setPointerCapture(e.pointerId);
      const defR = tool === 'tree' ? treeRadius : brush.circleRadius;
      dragRef.current = {
        type: 'drawCircle',
        cx: cx0,
        cy: cy0,
        radius: defR,
        didDrag: false,
        forTree: tool === 'tree',
      };
      setDraftPreview({ kind: 'circle', cx: cx0, cy: cy0, r: defR, forTree: tool === 'tree' });
      return;
    }

    if (tool === 'zone_poly' || tool === 'building') {
      if (draftPoints.length >= 3) {
        const [fx, fy] = rosToCanvas(draftPoints[0]![0], draftPoints[0]![1]);
        if (Math.hypot(cx - fx, cy - fy) <= 14) {
          commitDraftShape(draftPoints);
          return;
        }
      }
      const px0 = tool === 'zone_poly' ? clampToLandX(rx) : rx;
      const py0 = tool === 'zone_poly' ? clampToLandY(ry) : ry;
      setDraftPoints((prev) => [...prev, [px0, py0]]);
      return;
    }

    if (tool === 'zone_path' || tool === 'wall') {
      const px0 = tool === 'zone_path' ? clampToLandX(rx) : rx;
      const py0 = tool === 'zone_path' ? clampToLandY(ry) : ry;
      setDraftPoints((prev) => [...prev, [px0, py0]]);
      return;
    }

    if (tool === 'prop') {
      const preset = COSMETIC_PROP_PRESETS.find((p) => p.id === selectedPropId) ?? COSMETIC_PROP_PRESETS[0]!;
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
      const tz = sampleTerrainHeight(mapBg, rx, ry);
      updateWorld((w) => {
        w.robotSpawnPose.xyz = [rx, ry, Number((tz + 0.15).toFixed(3))];
      });
      return;
    }

    // Select tool
    // 1. Check handles on currently selected zone first
    const zoneHandle = findSelectedZoneHandle(cx, cy);
    if (zoneHandle) {
      e.currentTarget.setPointerCapture(e.pointerId);
      if (zoneHandle.kind === 'radius') {
        dragRef.current = { type: 'resizeZoneCircle', zoneId: zoneHandle.zone.id };
      } else {
        dragRef.current = {
          type: 'moveZoneVertex',
          zoneId: zoneHandle.zone.id,
          vertexIdx: zoneHandle.idx,
        };
      }
      return;
    }

    // 2. Check world objects
    const hitObj = findHitObject(rawRx, rawRy);
    if (hitObj) {
      select({ type: 'worldObject', id: hitObj.obj.id });
      e.currentTarget.setPointerCapture(e.pointerId);
      if (hitObj.handle === 'radius') {
        dragRef.current = { type: 'resizeTree', objectId: hitObj.obj.id };
      } else {
        dragRef.current = {
          type: 'moveObj',
          objectId: hitObj.obj.id,
          offsetX: rawRx - hitObj.obj.pose.xyz[0],
          offsetY: rawRy - hitObj.obj.pose.xyz[1],
        };
      }
      return;
    }

    // 3. Check lights
    for (const light of project.world.lights) {
      const [lx, ly] = rosToCanvas(light.pose.xyz[0], light.pose.xyz[1]);
      if (Math.hypot(cx - lx, cy - ly) <= 12) {
        select({ type: 'worldLight', id: light.id });
        return;
      }
    }

    // 4. Check surface zones (topmost visible)
    const hitZone = findTopHitSurfaceZone(rawRx, rawRy, project.world.surfaceZones, 6 / pxPerMeter);
    if (hitZone) {
      select({ type: 'surfaceZone', id: hitZone.id });
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        type: 'moveZone',
        zoneId: hitZone.id,
        startRos: [rawRx, rawRy],
        origPoints: hitZone.points.map(([x, y]) => [x, y]),
      };
      return;
    }

    // 5. Empty area: select World + pan
    select({ type: 'world' });
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { type: 'pan', startPx: [cx, cy], origCenter: [...viewCenter] };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const [rawRx, rawRy] = canvasToRos(cx, cy);
    const rx = snapCoord(rawRx);
    const ry = snapCoord(rawRy);
    setHoverRos([rx, ry]);

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.type === 'pan') {
      const dxM = (cx - drag.startPx[0]) / pxPerMeter;
      const dyM = (cy - drag.startPx[1]) / pxPerMeter;
      setViewCenter([drag.origCenter[0] - dxM, drag.origCenter[1] + dyM]);
    } else if (drag.type === 'moveMap') {
      const dxRosM = (cx - drag.startPx[0]) / pxPerMeter;
      const dyRosM = -(cy - drag.startPx[1]) / pxPerMeter;
      setMapDragDeltaRos([dxRosM, dyRosM]);
    } else if (drag.type === 'drawRect') {
      const cx1 = clampToLandX(rx);
      const cy1 = clampToLandY(ry);
      drag.endRos = [cx1, cy1];
      setDraftPreview({ kind: 'rect', p1: drag.startRos, p2: [cx1, cy1] });
    } else if (drag.type === 'drawCircle') {
      const dist = Math.hypot(rx - drag.cx, ry - drag.cy);
      if (dist * pxPerMeter > 6 || drag.didDrag) {
        drag.didDrag = true;
        drag.radius = Math.max(0.4, Number(dist.toFixed(2)));
        setDraftPreview({
          kind: 'circle',
          cx: drag.cx,
          cy: drag.cy,
          r: drag.radius,
          forTree: drag.forTree,
        });
      }
    } else if (drag.type === 'moveObj') {
      const nx = snapCoord(rawRx - drag.offsetX);
      const ny = snapCoord(rawRy - drag.offsetY);
      updateWorldObject(drag.objectId, (obj) => {
        obj.pose.xyz[0] = nx;
        obj.pose.xyz[1] = ny;
        regroundWorldObjectToTerrain(obj, mapBg);
      });
    } else if (drag.type === 'resizeTree') {
      const obj = project.world.objects.find((o) => o.id === drag.objectId);
      if (!obj || obj.source.type !== 'tree') return;
      const newR = Math.max(0.3, Math.hypot(rawRx - obj.pose.xyz[0], rawRy - obj.pose.xyz[1]));
      const dims = computeTreeDimensionsForCanopy(newR, treeHeight, obj.source.style);
      updateWorldObject(drag.objectId, (d) => {
        if (d.source.type === 'tree') {
          d.source.canopyRadius = dims.canopyRadius;
          d.source.trunkRadius = dims.trunkRadius;
          d.source.trunkHeight = dims.trunkHeight;
          d.source.canopyHeight = dims.canopyHeight;
        }
      });
    } else if (drag.type === 'moveZone') {
      const dx = snapCoord(rawRx - drag.startRos[0]);
      const dy = snapCoord(rawRy - drag.startRos[1]);
      updateSurfaceZone(drag.zoneId, (z) => {
        z.points = translateZonePoints(drag.origPoints, dx, dy);
      });
    } else if (drag.type === 'moveZoneVertex') {
      updateSurfaceZone(drag.zoneId, (z) => {
        if (z.points[drag.vertexIdx]) {
          z.points[drag.vertexIdx] = [rx, ry];
        }
      });
    } else if (drag.type === 'resizeZoneCircle') {
      const z = (project.world.surfaceZones ?? []).find((item) => item.id === drag.zoneId);
      if (!z || !z.points[0]) return;
      const newR = Math.max(0.5, Number(Math.hypot(rx - z.points[0][0], ry - z.points[0][1]).toFixed(2)));
      updateSurfaceZone(drag.zoneId, (draft) => {
        draft.radius = newR;
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (drag?.type === 'moveMap') {
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const dxRosM = (cx - drag.startPx[0]) / pxPerMeter;
      const dyRosM = -(cy - drag.startPx[1]) / pxPerMeter;
      setMapDragDeltaRos(null);
      if (Math.hypot(dxRosM, dyRosM) > 0.05) {
        const next = shiftLatLonByMapDrag(
          mapBg.latitude,
          mapBg.longitude,
          dxRosM,
          dyRosM,
          mapBg.headingDeg,
        );
        updateWorld((w) => {
          if (!w.mapBackground) w.mapBackground = { ...DEFAULT_MAP_BACKGROUND };
          w.mapBackground.latitude = next.lat;
          w.mapBackground.longitude = next.lon;
          w.mapBackground.enabled = true;
        });
      }
    } else if (drag?.type === 'drawRect') {
      const w = Math.abs(drag.endRos[0] - drag.startRos[0]);
      const h = Math.abs(drag.endRos[1] - drag.startRos[1]);
      // If user clicked without dragging far, drop a convenient 12m x 12m textured patch
      const pts =
        w < 0.5 && h < 0.5
          ? createRectZonePoints(
              drag.startRos[0] - 6,
              drag.startRos[1] - 6,
              drag.startRos[0] + 6,
              drag.startRos[1] + 6,
            )
          : createRectZonePoints(drag.startRos[0], drag.startRos[1], drag.endRos[0], drag.endRos[1]);
      addSurfaceZone({
        kind: 'rect',
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
      setDraftPreview(null);
    } else if (drag?.type === 'drawCircle') {
      const r = drag.didDrag ? drag.radius : drag.forTree ? treeRadius : brush.circleRadius;
      if (drag.forTree) {
        const base = createDefaultTreeSource(treeStyle);
        const dims = computeTreeDimensionsForCanopy(r, treeHeight, treeStyle);
        const placed = computeTreeTerrainPose(drag.cx, drag.cy, dims.trunkRadius, mapBg);
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
      } else {
        addSurfaceZone({
          kind: 'circle',
          points: [[drag.cx, drag.cy]],
          radius: Math.max(0.5, Number(r.toFixed(2))),
          textureSource: brush.textureSource,
          presetId: brush.presetId,
          textureId: brush.textureId,
          tint: hexToRgba(brush.tintHex, 1),
          repeat: [...brush.repeat],
          opacity: brush.opacity,
          visible: true,
          feather: brush.feather,
        });
      }
      setDraftPreview(null);
    }

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const [beforeX, beforeY] = canvasToRos(cx, cy);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextPx = Math.max(0.2, Math.min(250, pxPerMeter * factor));
    setPxPerMeter(nextPx);
    setViewCenter([
      beforeX - (cx - canvasSize.w / 2) / nextPx,
      beforeY + (cy - canvasSize.h / 2) / nextPx,
    ]);
  };

  const canFinishDraft =
    ((tool === 'zone_poly' || tool === 'building') && draftPoints.length >= 3) ||
    ((tool === 'zone_path' || tool === 'wall') && draftPoints.length >= 2);

  return (
    <div
      ref={hostRef}
      data-testid="world-studio-2d-panel"
      className="relative h-full w-full overflow-hidden bg-[#090d14] select-none"
    >
      <canvas
        ref={canvasRef}
        data-testid="world-studio-2d-canvas"
        style={{ width: canvasSize.w, height: canvasSize.h }}
        className={`block ${
          tool === 'move_map'
            ? mapDragDeltaRos
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : tool === 'select'
              ? 'cursor-default'
              : 'cursor-crosshair'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => {
          if (canFinishDraft) commitDraftShape(draftPoints);
        }}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Top-Left Inline Mode Badge (hidden when Move Map HUD occupies top bar) */}
      {tool !== 'move_map' && (
        <div className="pointer-events-none absolute left-2.5 top-2.5 flex items-center gap-2">
          <span className="rounded border border-[#283347] bg-[#0e131d]/90 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
            2D TOP-DOWN EDITOR
          </span>
        </div>
      )}

      {/* Inline Move Map Precision Bar */}
      {tool === 'move_map' && (
        <div
          data-testid="2d-move-map-hud"
          className="absolute inset-x-2 top-2 z-10 flex flex-wrap items-center justify-between gap-1.5 rounded-md border border-cyan-500/50 bg-[#0c1320]/95 px-2 py-1 text-[11px] shadow-lg"
        >
          <span className="font-mono text-[10px] text-cyan-200 tabular-nums">
            {mapDragDeltaRos
              ? (() => {
                  const preview = shiftLatLonByMapDrag(
                    mapBg.latitude,
                    mapBg.longitude,
                    mapDragDeltaRos[0],
                    mapDragDeltaRos[1],
                    mapBg.headingDeg,
                  );
                  return formatLatLonPair(preview.lat, preview.lon, 5);
                })()
              : formatLatLonPair(mapBg.latitude, mapBg.longitude, 5)}
          </span>

          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label="Nudge 2D map west"
                onClick={() => applyMapNudge(-mapNudgeStepM, 0)}
                className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#162033] text-slate-200 hover:bg-[#22304a] cursor-pointer"
              >
                <ArrowLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Nudge 2D map north"
                onClick={() => applyMapNudge(0, mapNudgeStepM)}
                className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#162033] text-slate-200 hover:bg-[#22304a] cursor-pointer"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Nudge 2D map south"
                onClick={() => applyMapNudge(0, -mapNudgeStepM)}
                className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#162033] text-slate-200 hover:bg-[#22304a] cursor-pointer"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Nudge 2D map east"
                onClick={() => applyMapNudge(mapNudgeStepM, 0)}
                className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#162033] text-slate-200 hover:bg-[#22304a] cursor-pointer"
              >
                <ArrowRight className="h-3 w-3" />
              </button>
              <select
                aria-label="2D map nudge step"
                value={mapNudgeStepM}
                onChange={(e) => setMapNudgeStepM(Number(e.target.value))}
                className="ml-0.5 h-5 rounded border border-[#2a3850] bg-[#101724] px-1 font-mono text-[10px] text-slate-200 cursor-pointer"
              >
                {[1, 5, 10, 25, 100].map((m) => (
                  <option key={m} value={m}>
                    {m}m
                  </option>
                ))}
              </select>
            </div>

            {onSelectTool && (
              <button
                type="button"
                onClick={() => onSelectTool('select')}
                className="inline-flex items-center gap-0.5 rounded bg-cyan-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-cyan-500 cursor-pointer"
              >
                <Check className="h-3 w-3" />
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {/* Inline Finish/Cancel Bar for Polygon & Road/Path drawing */}
      {draftPoints.length > 0 && (
        <div className="absolute left-1/2 top-2.5 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-emerald-500/50 bg-[#0e1522]/95 px-2.5 py-1 text-xs shadow-lg">
          <span className="font-mono text-[11px] text-emerald-200">
            {draftPoints.length} pts · Click to add · Double-click or Enter to finish
          </span>
          {canFinishDraft && (
            <button
              type="button"
              onClick={() => commitDraftShape(draftPoints)}
              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500 cursor-pointer"
            >
              <Check className="h-3 w-3" />
              Finish
            </button>
          )}
          <button
            type="button"
            onClick={() => setDraftPoints([])}
            className="inline-flex items-center gap-1 rounded border border-[#2a3346] bg-[#161e2e] px-1.5 py-0.5 text-[11px] text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        </div>
      )}

      {/* Bottom-Left Coordinates & Zoom Controls */}
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
        <div className="rounded border border-[#242e40] bg-[#0d121c]/90 px-2 py-1 font-mono text-[10px] text-slate-300 tabular-nums">
          {hoverRos
            ? `X: ${hoverRos[0].toFixed(1)}m  Y: ${hoverRos[1].toFixed(1)}m  Z: ${sampleTerrainHeight(mapBg, hoverRos[0], hoverRos[1]).toFixed(1)}m`
            : `Extent: ${Math.round(landWidth)}m × ${Math.round(landHeight)}m`}
        </div>

        <div className="pointer-events-auto flex items-center gap-1 rounded border border-[#242e40] bg-[#0d121c]/95 p-0.5">
          <button
            type="button"
            aria-label="Zoom out 2D map"
            onClick={() => setPxPerMeter((p) => Math.max(0.2, p / 1.25))}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-[#1b2333] hover:text-white cursor-pointer"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Fit 2D map to view"
            onClick={fitLandView}
            className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[10px] text-slate-300 hover:bg-[#1b2333] hover:text-white cursor-pointer"
          >
            <Maximize2 className="h-3 w-3" />
            Fit
          </button>
          <button
            type="button"
            aria-label="Zoom in 2D map"
            onClick={() => setPxPerMeter((p) => Math.min(250, p * 1.25))}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-[#1b2333] hover:text-white cursor-pointer"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
