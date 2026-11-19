import { saveAs } from 'file-saver';
import {
  computeMapTextureCanvasSize,
  computeNativeExportResolution,
  DEFAULT_MAP_BACKGROUND,
  downloadMapTilesTextureBase64,
  getMapLandSize,
  type MapExportQuality,
  type MapTileGridSpec,
} from '@/core/mapTiles';
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
  canvasWidthPx: number,
  canvasHeightPx: number,
  fillAction: () => void,
) {
  const pattern = ctx.createPattern(source, 'repeat');
  if (!pattern) return;

  const srcW = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
  const srcH = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
  if (srcW <= 0 || srcH <= 0) return;

  const repX = Math.max(0.25, repeat[0]);
  const repY = Math.max(0.25, repeat[1]);
  const scaleX = canvasWidthPx / (repX * srcW);
  const scaleY = canvasHeightPx / (repY * srcH);

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
  landHeight?: number;
  satelliteMosaic?: HTMLCanvasElement | null;
  tileGrid?: MapTileGridSpec | null;
  presetTilePx?: number;
  onAssetImageLoaded?: () => void;
}

/**
 * Renders the complete ground map texture (base layer + satellite map + all visible
 * multi-textured SurfaceZones) onto the target canvas.
 *
 * Coordinate convention:
 *  - Pixel (0, 0) corresponds to ROS (-landWidth/2, +landHeight/2) [West, North].
 *  - Pixel (W, H) corresponds to ROS (+landWidth/2, -landHeight/2) [East, South].
 *  This matches Three.js terrain UVs (`u = (x + W/2)/W`, `v = (y + H/2)/H` with flipY=true)
 *  and Gazebo OBJ terrain UVs identically!
 */
export function renderCompositeGroundCanvas({
  world,
  textures,
  canvas,
  landSize,
  landHeight,
  satelliteMosaic,
  tileGrid,
  presetTilePx = 256,
  onAssetImageLoaded,
}: CompositeGroundOptions): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const widthPx = canvas.width;
  const heightPx = canvas.height;
  const safeW = Math.max(10, landSize);
  const safeH = Math.max(10, landHeight ?? landSize);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, widthPx, heightPx);

  // 1. Base ground layer
  const customGroundTex = world.ground.textureId
    ? textures.find((t) => t.id === world.ground.textureId)
    : undefined;
  const basePresetId = world.cosmetics?.groundBasePresetId;
  const mapBg = world.mapBackground;

  // Neutral dark slate base fallback
  ctx.fillStyle = '#1c2430';
  ctx.fillRect(0, 0, widthPx, heightPx);

  if (customGroundTex) {
    const img = getOrLoadTextureAssetImage(customGroundTex, onAssetImageLoaded);
    if (img) {
      const rep = world.ground.textureRepeat ?? [8, 8];
      if (Math.abs(rep[0] - 1) < 0.001 && Math.abs(rep[1] - 1) < 0.001) {
        ctx.drawImage(img, 0, 0, widthPx, heightPx);
      } else {
        fillWithTiledSource(ctx, img, rep, widthPx, heightPx, () => {
          ctx.fillRect(0, 0, widthPx, heightPx);
        });
      }
    }
  } else if (basePresetId) {
    const presetCanvas = getPresetCanvas(basePresetId, presetTilePx);
    if (presetCanvas) {
      const rep = world.cosmetics?.groundBaseRepeat ?? [12, 12];
      fillWithTiledSource(ctx, presetCanvas, rep, widthPx, heightPx, () => {
        ctx.fillRect(0, 0, widthPx, heightPx);
      });
    }
  } else if (mapBg?.enabled && satelliteMosaic && tileGrid) {
    // Draw satellite tile mosaic cropped to safeW x safeH centered on ROS (0, 0)
    const pxPerMX = widthPx / safeW;
    const pxPerMY = heightPx / safeH;
    const [eastOff, northOff] = tileGrid.centerOffsetEnu;
    const halfMosaic = tileGrid.planeSizeMeters / 2;
    const [tlx, tly] = rosToGroundTexturePixel(
      eastOff - halfMosaic,
      northOff + halfMosaic,
      safeW,
      widthPx,
      safeH,
      heightPx,
    );
    const spanPxX = tileGrid.planeSizeMeters * pxPerMX;
    const spanPxY = tileGrid.planeSizeMeters * pxPerMY;
    ctx.globalAlpha = Math.max(0.15, mapBg.opacity ?? DEFAULT_MAP_BACKGROUND.opacity);
    ctx.drawImage(satelliteMosaic, tlx, tly, spanPxX, spanPxY);
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
      ctx.drawImage(img, 0, 0, widthPx, heightPx);
    }
  } else {
    // Subtle clean terrain grid when neither satellite nor preset is active
    const presetCanvas = getPresetCanvas('grass_lush', presetTilePx);
    if (presetCanvas) {
      fillWithTiledSource(ctx, presetCanvas, [14, 14], widthPx, heightPx, () => {
        ctx.fillRect(0, 0, widthPx, heightPx);
      });
    }
  }

  // 2. Render all visible Surface Zones in layer order
  const zones = world.surfaceZones ?? [];
  const pxPerM = (widthPx / safeW + heightPx / safeH) * 0.5;

  for (const zone of zones) {
    if (!zone.visible || zone.opacity <= 0.005) continue;
    drawSurfaceZoneToCanvas(
      ctx,
      zone,
      textures,
      safeW,
      safeH,
      widthPx,
      heightPx,
      pxPerM,
      presetTilePx,
      onAssetImageLoaded,
    );
  }

  ctx.restore();
}

function drawSurfaceZoneToCanvas(
  ctx: CanvasRenderingContext2D,
  zone: SurfaceZone,
  textures: TextureAsset[],
  landWidth: number,
  landHeight: number,
  widthPx: number,
  heightPx: number,
  pxPerM: number,
  presetTilePx = 256,
  onAssetImageLoaded?: () => void,
): void {
  // Resolve texture source
  let texSource: HTMLCanvasElement | HTMLImageElement | null = null;
  if (zone.textureSource === 'preset' && zone.presetId) {
    texSource = getPresetCanvas(zone.presetId, presetTilePx);
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
        const [px, py] = rosToGroundTexturePixel(rx, ry, landWidth, widthPx, landHeight, heightPx);
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
          const scaleX = widthPx / (Math.max(0.25, zone.repeat[0]) * srcW);
          const scaleY = heightPx / (Math.max(0.25, zone.repeat[1]) * srcH);
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
    const [cx, cy] = rosToGroundTexturePixel(
      center[0],
      center[1],
      landWidth,
      widthPx,
      landHeight,
      heightPx,
    );
    const rxPx = Math.max(2, (zone.radius ?? 4) * (widthPx / landWidth));
    const ryPx = Math.max(2, (zone.radius ?? 4) * (heightPx / landHeight));
    ctx.ellipse(cx, cy, rxPx, ryPx, 0, 0, Math.PI * 2);
  } else {
    if (zone.points.length < 3) {
      ctx.restore();
      return;
    }
    zone.points.forEach(([rx, ry], idx) => {
      const [px, py] = rosToGroundTexturePixel(rx, ry, landWidth, widthPx, landHeight, heightPx);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }

  if (texSource) {
    fillWithTiledSource(ctx, texSource, zone.repeat, widthPx, heightPx, () => {
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
 * Generates a PNG base64 string of the composited ground map for live preview syncing.
 */
export function exportCompositeGroundPngBase64(
  world: World,
  textures: TextureAsset[],
  landWidth: number,
  satelliteMosaic?: HTMLCanvasElement | null,
  tileGrid?: MapTileGridSpec | null,
  maxSidePx = 1024,
  landHeight?: number,
): string | null {
  if (typeof document === 'undefined') return null;
  const extentW = Math.max(10, landWidth);
  const extentH = Math.max(10, landHeight ?? extentW);
  const { widthPx, heightPx } = computeMapTextureCanvasSize(extentW, extentH, maxSidePx);
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  renderCompositeGroundCanvas({
    world,
    textures,
    canvas,
    landSize: extentW,
    landHeight: extentH,
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

function waitForTextureAssetImage(asset: TextureAsset): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  const cached = getOrLoadTextureAssetImage(asset);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    const img = new Image();
    const timer = globalThis.setTimeout(() => resolve(null), 5000);
    img.onload = () => {
      globalThis.clearTimeout(timer);
      loadedAssetImageCache.set(`${asset.id}:${asset.byteLength}`, img);
      resolve(img);
    };
    img.onerror = () => {
      globalThis.clearTimeout(timer);
      resolve(null);
    };
    img.src = `data:${asset.mimeType};base64,${asset.dataBase64}`;
  });
}

function base64ToPngBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'image/png' });
}

export interface HighResMapExportResult {
  base64: string;
  widthPx: number;
  heightPx: number;
  landWidth: number;
  landHeight: number;
  isPassthroughOriginal: boolean;
}

/**
 * Renders the full-quality / original-resolution `<world>_map.png` for both
 * ROS 2 / Gazebo ZIP export and standalone "Download Map PNG".
 *
 * - Never downscales to 512px previews.
 * - Preserves 100% original bytes & dimensions for 1:1 uploaded base map images.
 * - Preserves native satellite tile mosaic resolution (with a crisp 2048px floor) up to 4096px,
 *   or renders at explicit 2K (2048px) / 4K (4096px) quality.
 */
export async function renderHighResExportMapPngBase64(
  world: World,
  textures: TextureAsset[],
  quality: MapExportQuality = 'original',
): Promise<HighResMapExportResult | null> {
  if (typeof document === 'undefined') return null;

  const { width: landWidth, height: landHeight } = getMapLandSize(
    world.mapBackground,
    world.ground.size,
  );

  const visibleZones = (world.surfaceZones ?? []).filter(
    (z) => z.visible && z.opacity > 0.005,
  );
  const hasVisibleZones = visibleZones.length > 0;

  const customGroundTex = world.ground.textureId
    ? textures.find((t) => t.id === world.ground.textureId)
    : undefined;
  const groundRepeat = world.ground.textureRepeat ?? [8, 8];
  const isOneToOneGround =
    Boolean(customGroundTex) &&
    Math.abs(groundRepeat[0] - 1) < 0.001 &&
    Math.abs(groundRepeat[1] - 1) < 0.001;

  // Decode all custom textures referenced by the base ground or visible surface zones
  const usedTexIds = new Set<string>();
  if (customGroundTex) usedTexIds.add(customGroundTex.id);
  for (const z of visibleZones) {
    if (z.textureSource === 'custom' && z.textureId) {
      usedTexIds.add(z.textureId);
    }
  }
  const decodedById = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    Array.from(usedTexIds).map(async (id) => {
      const asset = textures.find((t) => t.id === id);
      if (!asset) return;
      decodedById.set(id, await waitForTextureAssetImage(asset));
    }),
  );

  const baseImg = customGroundTex ? (decodedById.get(customGroundTex.id) ?? null) : null;

  // Fast-path lossless passthrough: 1:1 uploaded base map with no overlay zones in 'original' mode
  if (quality === 'original' && customGroundTex && isOneToOneGround && !hasVisibleZones) {
    const natW = baseImg?.naturalWidth ?? 2048;
    const natH = baseImg?.naturalHeight ?? 2048;
    if (customGroundTex.format === 'png') {
      return {
        base64: customGroundTex.dataBase64,
        widthPx: natW,
        heightPx: natH,
        landWidth,
        landHeight,
        isPassthroughOriginal: true,
      };
    }
    if (baseImg && natW > 0 && natH > 0) {
      const directCanvas = document.createElement('canvas');
      directCanvas.width = natW;
      directCanvas.height = natH;
      const dCtx = directCanvas.getContext('2d');
      if (dCtx) {
        dCtx.drawImage(baseImg, 0, 0, natW, natH);
        const dataUrl = directCanvas.toDataURL('image/png');
        const comma = dataUrl.indexOf(',');
        const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        return {
          base64: b64,
          widthPx: natW,
          heightPx: natH,
          landWidth,
          landHeight,
          isPassthroughOriginal: true,
        };
      }
    }
  }

  // Fetch fresh high-res satellite tile mosaic if satellite imagery is the active base layer
  let satelliteMosaic: HTMLCanvasElement | null = null;
  let tileGrid: MapTileGridSpec | null = null;
  const needsSatelliteBase =
    Boolean(world.mapBackground?.enabled) &&
    !customGroundTex &&
    !world.cosmetics?.groundBasePresetId;
  if (needsSatelliteBase && world.mapBackground) {
    const fetched = await downloadMapTilesTextureBase64(world.mapBackground, quality, true);
    if (fetched) {
      satelliteMosaic = fetched.mosaicCanvas;
      tileGrid = fetched.tileGrid;
    }
  }

  const { widthPx, heightPx } = computeNativeExportResolution(landWidth, landHeight, {
    tileGrid,
    tilePx: 256,
    sourceImageWidth: baseImg?.naturalWidth,
    sourceImageHeight: baseImg?.naturalHeight,
    sourceIsOneToOne: isOneToOneGround,
    hasOverlayZones: hasVisibleZones,
    quality,
    hardCapPx: 4096,
  });

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  renderCompositeGroundCanvas({
    world,
    textures,
    canvas,
    landSize: landWidth,
    landHeight,
    satelliteMosaic,
    tileGrid,
    presetTilePx: 512,
  });

  try {
    const dataUrl = canvas.toDataURL('image/png');
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    return {
      base64,
      widthPx,
      heightPx,
      landWidth,
      landHeight,
      isPassthroughOriginal: false,
    };
  } catch {
    return null;
  }
}

/**
 * Download the exact full-area ground map tile PNG (same projection & aspect ratio
 * as `<world>_map.png` bundled in the ROS 2 package ZIP) at original/high resolution so the user
 * can edit/upscale it externally and re-upload it 1:1 before exporting.
 */
export async function downloadFullMapAreaPng(
  world: World,
  textures: TextureAsset[],
  quality: MapExportQuality = 'original',
): Promise<{ filename: string; widthPx: number; heightPx: number; landWidth: number; landHeight: number }> {
  const rendered = await renderHighResExportMapPngBase64(world, textures, quality);
  if (!rendered) {
    throw new Error('Could not render high-resolution map PNG.');
  }
  const filename = `${world.name}_map.png`;
  const blob = base64ToPngBlob(rendered.base64);
  saveAs(blob, filename);
  return {
    filename,
    widthPx: rendered.widthPx,
    heightPx: rendered.heightPx,
    landWidth: rendered.landWidth,
    landHeight: rendered.landHeight,
  };
}

export function hasCustomCosmeticGround(world: World): boolean {
  const hasVisibleZones = (world.surfaceZones ?? []).some((z) => z.visible);
  const hasBasePreset = Boolean(world.cosmetics?.groundBasePresetId);
  return hasVisibleZones || hasBasePreset;
}
