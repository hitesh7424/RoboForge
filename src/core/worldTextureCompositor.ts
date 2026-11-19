import { DEFAULT_MAP_BACKGROUND, type MapTileGridSpec } from '@/core/mapTiles';
import type { SurfaceZone, TextureAsset, World } from '@/core/schema';
import { getPresetCanvas } from '@/core/texturePresets';
import { rosToGroundTexturePixel } from '@/core/worldZones';

const loadedAssetImageCache = new Map<string, HTMLImageElement>();

/**
 * Loads (and caches) an HTMLImageElement for a custom uploaded TextureAsset.
 * Calls `onReady` once the image finishes decoding if it wasn't cached yet.
 */
export function getOrLoadTextureAssetImage(
  asset: TextureAsset | undefined,
  onReady?: () => void,
): HTMLImageElement | null {
  if (!asset || typeof Image === 'undefined') return null;
  const key = `${asset.id}:${asset.byteLength}`;
  const existing = loadedAssetImageCache.get(key);
  if (existing) {
    if (existing.complete && existing.naturalWidth > 0) {
      return existing;
    }
    if (onReady) {
      existing.addEventListener('load', onReady, { once: true });
    }
    return null;
  }

  const img = new Image();
  img.onload = () => {
    onReady?.();
  };
  img.src = `data:${asset.mimeType};base64,${asset.dataBase64}`;
  loadedAssetImageCache.set(key, img);
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function rgbaToCss(rgba: [number, number, number, number]): string {
  const r = Math.round(rgba[0] * 255);
  const g = Math.round(rgba[1] * 255);
  const b = Math.round(rgba[2] * 255);
  return `rgba(${r}, ${g}, ${b}, ${rgba[3]})`;
}

function isNonWhiteTint(rgba: [number, number, number, number]): boolean {
  return rgba[0] < 0.98 || rgba[1] < 0.98 || rgba[2] < 0.98;
}

function fillWithTiledSource(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement | HTMLImageElement,
  repeat: [number, number],
  canvasSizePx: number,
  fillAction: () => void,
) {
  const pattern = ctx.createPattern(source, 'repeat');
  if (!pattern) return;

  const srcW = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
  const srcH = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
  if (srcW <= 0 || srcH <= 0) return;

  const repX = Math.max(0.25, repeat[0]);
  const repY = Math.max(0.25, repeat[1]);
  const scaleX = canvasSizePx / (repX * srcW);
  const scaleY = canvasSizePx / (repY * srcH);

  if (typeof DOMMatrix !== 'undefined' && typeof pattern.setTransform === 'function') {
    pattern.setTransform(new DOMMatrix().scale(scaleX, scaleY));
  }

  ctx.fillStyle = pattern;
  fillAction();
}

export interface CompositeGroundOptions {
  world: World;
  textures: TextureAsset[];
  canvas: HTMLCanvasElement;
  landSize: number;
  satelliteMosaic?: HTMLCanvasElement | null;
  tileGrid?: MapTileGridSpec | null;
  onAssetImageLoaded?: () => void;
}

/**
 * Renders the complete ground map texture (base layer + satellite map + all visible
 * multi-textured SurfaceZones) onto the target square canvas.
 *
 * Coordinate convention:
 *  - Pixel (0, 0) corresponds to ROS (-landSize/2, +landSize/2) [West, North].
 *  - Pixel (W, H) corresponds to ROS (+landSize/2, -landSize/2) [East, South].
 *  This matches Three.js terrain UVs (`u = (x + L/2)/L`, `v = (y + L/2)/L` with flipY=true)
 *  and Gazebo OBJ terrain UVs identically!
 */
export function renderCompositeGroundCanvas({
  world,
  textures,
  canvas,
  landSize,
  satelliteMosaic,
  tileGrid,
  onAssetImageLoaded,
}: CompositeGroundOptions): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const sizePx = canvas.width;
  const safeLand = Math.max(10, landSize);

  ctx.save();
  ctx.clearRect(0, 0, sizePx, sizePx);

  // 1. Base ground layer
  const customGroundTex = world.ground.textureId
    ? textures.find((t) => t.id === world.ground.textureId)
    : undefined;
  const basePresetId = world.cosmetics?.groundBasePresetId;
  const mapBg = world.mapBackground;

  // Neutral dark slate base fallback
  ctx.fillStyle = '#1c2430';
  ctx.fillRect(0, 0, sizePx, sizePx);

  if (customGroundTex) {
    const img = getOrLoadTextureAssetImage(customGroundTex, onAssetImageLoaded);
    if (img) {
      fillWithTiledSource(ctx, img, world.ground.textureRepeat ?? [8, 8], sizePx, () => {
        ctx.fillRect(0, 0, sizePx, sizePx);
      });
    }
  } else if (basePresetId) {
    const presetCanvas = getPresetCanvas(basePresetId, 256);
    if (presetCanvas) {
      const rep = world.cosmetics?.groundBaseRepeat ?? [12, 12];
      fillWithTiledSource(ctx, presetCanvas, rep, sizePx, () => {
        ctx.fillRect(0, 0, sizePx, sizePx);
      });
    }
  } else if (mapBg?.enabled && satelliteMosaic && tileGrid) {
    // Draw satellite tile mosaic cropped to landSizeMeters centered on ROS (0, 0)
    const pxPerM = sizePx / safeLand;
    const [eastOff, northOff] = tileGrid.centerOffsetEnu;
    const halfMosaic = tileGrid.planeSizeMeters / 2;
    const [tlx, tly] = rosToGroundTexturePixel(
      eastOff - halfMosaic,
      northOff + halfMosaic,
      safeLand,
      sizePx,
    );
    const spanPx = tileGrid.planeSizeMeters * pxPerM;
    ctx.globalAlpha = Math.max(0.15, mapBg.opacity ?? DEFAULT_MAP_BACKGROUND.opacity);
    ctx.drawImage(satelliteMosaic, tlx, tly, spanPx, spanPx);
    ctx.globalAlpha = 1;
  } else if (mapBg?.enabled && mapBg.mapTextureBase64) {
    // Fallback to persisted map texture if mosaic hasn't streamed
    const syntheticAsset: TextureAsset = {
      id: '__map_bg_cached',
      name: 'map_bg',
      format: 'png',
      mimeType: 'image/png',
      dataBase64: mapBg.mapTextureBase64,
      byteLength: mapBg.mapTextureBase64.length,
    };
    const img = getOrLoadTextureAssetImage(syntheticAsset, onAssetImageLoaded);
    if (img) {
      ctx.drawImage(img, 0, 0, sizePx, sizePx);
    }
  } else {
    // Subtle clean terrain grid when neither satellite nor preset is active
    const presetCanvas = getPresetCanvas('grass_lush', 256);
    if (presetCanvas) {
      fillWithTiledSource(ctx, presetCanvas, [14, 14], sizePx, () => {
        ctx.fillRect(0, 0, sizePx, sizePx);
      });
    }
  }

  // 2. Render all visible Surface Zones in layer order
  const zones = world.surfaceZones ?? [];
  const pxPerM = sizePx / safeLand;

  for (const zone of zones) {
    if (!zone.visible || zone.opacity <= 0.005) continue;
    drawSurfaceZoneToCanvas(ctx, zone, textures, safeLand, sizePx, pxPerM, onAssetImageLoaded);
  }

  ctx.restore();
}

function drawSurfaceZoneToCanvas(
  ctx: CanvasRenderingContext2D,
  zone: SurfaceZone,
  textures: TextureAsset[],
  landSize: number,
  sizePx: number,
  pxPerM: number,
  onAssetImageLoaded?: () => void,
): void {
  // Resolve texture source
  let texSource: HTMLCanvasElement | HTMLImageElement | null = null;
  if (zone.textureSource === 'preset' && zone.presetId) {
    texSource = getPresetCanvas(zone.presetId, 256);
  } else if (zone.textureSource === 'custom' && zone.textureId) {
    const asset = textures.find((t) => t.id === zone.textureId);
    texSource = getOrLoadTextureAssetImage(asset, onAssetImageLoaded);
  }

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, zone.opacity));

  if (zone.feather && zone.feather > 0.05) {
    ctx.filter = `blur(${Math.min(18, zone.feather * pxPerM * 0.5).toFixed(1)}px)`;
  }

  if (zone.kind === 'path') {
    if (zone.points.length < 2) {
      ctx.restore();
      return;
    }

    const strokePx = Math.max(2, (zone.strokeWidth ?? 3) * pxPerM);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokePx;

    const tracePath = () => {
      ctx.beginPath();
      zone.points.forEach(([rx, ry], idx) => {
        const [px, py] = rosToGroundTexturePixel(rx, ry, landSize, sizePx);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
    };

    if (texSource) {
      const pattern = ctx.createPattern(texSource, 'repeat');
      if (pattern) {
        const srcW = texSource instanceof HTMLCanvasElement ? texSource.width : texSource.naturalWidth;
        const srcH = texSource instanceof HTMLCanvasElement ? texSource.height : texSource.naturalHeight;
        if (srcW > 0 && srcH > 0 && typeof DOMMatrix !== 'undefined' && typeof pattern.setTransform === 'function') {
          const scaleX = sizePx / (Math.max(0.25, zone.repeat[0]) * srcW);
          const scaleY = sizePx / (Math.max(0.25, zone.repeat[1]) * srcH);
          pattern.setTransform(new DOMMatrix().scale(scaleX, scaleY));
        }
        ctx.strokeStyle = pattern;
        tracePath();
        ctx.stroke();

        if (isNonWhiteTint(zone.tint)) {
          ctx.globalCompositeOperation = 'source-atop';
          ctx.strokeStyle = rgbaToCss([zone.tint[0], zone.tint[1], zone.tint[2], 0.35]);
          tracePath();
          ctx.stroke();
        }
      }
    } else {
      ctx.strokeStyle = rgbaToCss(zone.tint);
      tracePath();
      ctx.stroke();
    }

    ctx.restore();
    return;
  }

  // Closed shapes: circle, rect, polygon
  ctx.beginPath();
  if (zone.kind === 'circle') {
    const center = zone.points[0];
    if (!center) {
      ctx.restore();
      return;
    }
    const [cx, cy] = rosToGroundTexturePixel(center[0], center[1], landSize, sizePx);
    const rPx = Math.max(2, (zone.radius ?? 4) * pxPerM);
    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
  } else {
    if (zone.points.length < 3) {
      ctx.restore();
      return;
    }
    zone.points.forEach(([rx, ry], idx) => {
      const [px, py] = rosToGroundTexturePixel(rx, ry, landSize, sizePx);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }

  if (texSource) {
    fillWithTiledSource(ctx, texSource, zone.repeat, sizePx, () => {
      ctx.fill();
    });
    if (isNonWhiteTint(zone.tint)) {
      ctx.fillStyle = rgbaToCss([zone.tint[0], zone.tint[1], zone.tint[2], 0.32]);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = rgbaToCss(zone.tint);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Generates a PNG base64 string of the composited ground map for ROS 2 / Gazebo SDF export.
 */
export function exportCompositeGroundPngBase64(
  world: World,
  textures: TextureAsset[],
  landSize: number,
  satelliteMosaic?: HTMLCanvasElement | null,
  tileGrid?: MapTileGridSpec | null,
  sizePx = 512,
): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  renderCompositeGroundCanvas({
    world,
    textures,
    canvas,
    landSize,
    satelliteMosaic,
    tileGrid,
  });
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  } catch {
    return null;
  }
}

export function hasCustomCosmeticGround(world: World): boolean {
  const hasVisibleZones = (world.surfaceZones ?? []).some((z) => z.visible);
  const hasBasePreset = Boolean(world.cosmetics?.groundBasePresetId);
  return hasVisibleZones || hasBasePreset;
}
