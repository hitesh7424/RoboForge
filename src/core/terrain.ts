import * as THREE from 'three';
import {
  decodeTerrariumPixel,
  formatTileUrl,
  latLonFromEnuOffset,
  latLonToTileFloat,
  sampleElevationAt,
  TERRARIUM_URL_DEFAULT,
  type ElevationQuerySource,
  type MapTileGridSpec,
} from '@/core/mapTiles';

interface LoadedTilePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function loadImageWithCors(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function sampleTileRgbBilinear(
  tile: LoadedTilePixels,
  fracX: number,
  fracY: number,
): [number, number, number] {
  const px = Math.max(0, Math.min(tile.width - 1.001, fracX * tile.width - 0.5));
  const py = Math.max(0, Math.min(tile.height - 1.001, fracY * tile.height - 0.5));
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(tile.width - 1, x0 + 1);
  const y1 = Math.min(tile.height - 1, y0 + 1);
  const tx = px - x0;
  const ty = py - y0;

  const idx = (x: number, y: number) => (y * tile.width + x) * 4;
  const i00 = idx(x0, y0);
  const i10 = idx(x1, y0);
  const i01 = idx(x0, y1);
  const i11 = idx(x1, y1);

  const interp = (ch: number) => {
    const v00 = tile.data[i00 + ch] ?? 0;
    const v10 = tile.data[i10 + ch] ?? 0;
    const v01 = tile.data[i01 + ch] ?? 0;
    const v11 = tile.data[i11 + ch] ?? 0;
    const v0 = v00 + (v10 - v00) * tx;
    const v1 = v01 + (v11 - v01) * tx;
    return v0 + (v1 - v0) * ty;
  };

  return [interp(0), interp(1), interp(2)];
}

/**
 * Fetch Mapzen Terrarium RGB DEM tiles covering `landSizeMeters x landSizeMeters` around (latDeg, lonDeg)
 * and return a row-major (South->North, West->East) elevation grid relative to (0,0) = 0m.
 */
export async function fetchTerrariumElevationGrid(
  latDeg: number,
  lonDeg: number,
  landWidthMeters: number,
  segments = 40,
  urlTemplate = TERRARIUM_URL_DEFAULT,
  preferredDemZoom = 15,
  landHeightMeters?: number,
): Promise<{
  relativeGrid: number[];
  gridSize: number;
  centerElevation: number;
  loadedTiles: number;
} | null> {
  const n = Math.max(4, Math.min(96, Math.round(segments))) + 1;
  const extentX = Math.max(10, landWidthMeters);
  const extentY = Math.max(10, landHeightMeters ?? extentX);
  const halfX = extentX / 2;
  const halfY = extentY / 2;
  // AWS Terrarium public dataset caps at z = 15 globally
  const demZoom = Math.max(1, Math.min(15, Math.round(preferredDemZoom)));

  // Determine bounding tile indices across corners of [ -halfX..+halfX, -halfY..+halfY ]
  const corners = [
    latLonFromEnuOffset(latDeg, lonDeg, -halfX, -halfY),
    latLonFromEnuOffset(latDeg, lonDeg, halfX, halfY),
  ];
  const tMin = latLonToTileFloat(corners[1]!.lat, corners[0]!.lon, demZoom); // NW
  const tMax = latLonToTileFloat(corners[0]!.lat, corners[1]!.lon, demZoom); // SE
  const maxTiles = tMax.n;

  const minTx = Math.floor(Math.min(tMin.x, tMax.x));
  const maxTx = Math.floor(Math.max(tMin.x, tMax.x));
  const minTy = Math.max(0, Math.floor(Math.min(tMin.y, tMax.y)));
  const maxTy = Math.min(maxTiles - 1, Math.floor(Math.max(tMin.y, tMax.y)));

  const neededKeys = new Map<string, { tx: number; ty: number }>();
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let txRaw = minTx; txRaw <= maxTx; txRaw++) {
      const tx = ((txRaw % maxTiles) + maxTiles) % maxTiles;
      const key = `${demZoom}/${tx}/${ty}`;
      neededKeys.set(key, { tx, ty });
    }
  }

  // Cap excessive tile downloads in extreme edge cases
  if (neededKeys.size > 25) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const tileCache = new Map<string, LoadedTilePixels>();
  const entries = Array.from(neededKeys.entries());
  const upgradeMixed =
    typeof window !== 'undefined' && window.location.protocol === 'https:';

  await Promise.all(
    entries.map(async ([key, cell]) => {
      const url = formatTileUrl(urlTemplate || TERRARIUM_URL_DEFAULT, cell.tx, cell.ty, demZoom, upgradeMixed);
      const img = await loadImageWithCors(url);
      if (!img) return;
      try {
        ctx.clearRect(0, 0, 256, 256);
        ctx.drawImage(img, 0, 0, 256, 256);
        const imgData = ctx.getImageData(0, 0, 256, 256);
        tileCache.set(key, {
          data: imgData.data,
          width: 256,
          height: 256,
        });
      } catch {
        // CORS-tainted or unreadable DEM tile
      }
    }),
  );

  if (tileCache.size === 0) {
    return null;
  }

  const sampleAtLatLon = (lat: number, lon: number): number | null => {
    const tf = latLonToTileFloat(lat, lon, demZoom);
    const tx = ((Math.floor(tf.x) % tf.n) + tf.n) % tf.n;
    const ty = Math.max(0, Math.min(tf.n - 1, Math.floor(tf.y)));
    const tile = tileCache.get(`${demZoom}/${tx}/${ty}`);
    if (!tile) return null;
    const fracX = tf.x - Math.floor(tf.x);
    const fracY = tf.y - Math.floor(tf.y);
    const [r, g, b] = sampleTileRgbBilinear(tile, fracX, fracY);
    return decodeTerrariumPixel(r, g, b);
  };

  const centerRaw = sampleAtLatLon(latDeg, lonDeg) ?? 0;
  const relativeGrid = new Array<number>(n * n).fill(0);

  for (let row = 0; row < n; row++) {
    const yM = -halfY + (row / (n - 1)) * extentY;
    for (let col = 0; col < n; col++) {
      const xM = -halfX + (col / (n - 1)) * extentX;
      const pt = latLonFromEnuOffset(latDeg, lonDeg, xM, yM);
      const elev = sampleAtLatLon(pt.lat, pt.lon);
      relativeGrid[row * n + col] =
        elev !== null ? Number((elev - centerRaw).toFixed(3)) : 0;
    }
  }

  return {
    relativeGrid,
    gridSize: n,
    centerElevation: Number(centerRaw.toFixed(2)),
    loadedTiles: tileCache.size,
  };
}

/**
 * Decode a user-imported grayscale PNG/JPEG heightmap (base64) into a relative elevation grid.
 */
export async function decodeHeightmapImageBase64(
  base64: string,
  mimeType: string,
  segments = 40,
  maxHeightMeters = 25,
): Promise<{
  relativeGrid: number[];
  gridSize: number;
  centerElevation: number;
} | null> {
  const n = Math.max(4, Math.min(96, Math.round(segments))) + 1;
  const img = await loadImageWithCors(`data:${mimeType};base64,${base64}`);
  if (!img) return null;

  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, n, n);
  const data = ctx.getImageData(0, 0, n, n).data;

  // Compute center pixel elevation for normalization (row=0 in Three/MuJoCo grid is South / bottom of image)
  const mid = Math.floor(n / 2);
  const midImgIdx = ((n - 1 - mid) * n + mid) * 4;
  const centerNorm = (data[midImgIdx] ?? 0) / 255;
  const centerElev = centerNorm * maxHeightMeters;

  const relativeGrid = new Array<number>(n * n).fill(0);
  for (let row = 0; row < n; row++) {
    const imgY = n - 1 - row; // bottom of image -> -Y South, top of image -> +Y North
    for (let col = 0; col < n; col++) {
      const idx = (imgY * n + col) * 4;
      const luma =
        ((data[idx] ?? 0) * 0.299 +
          (data[idx + 1] ?? 0) * 0.587 +
          (data[idx + 2] ?? 0) * 0.114) /
        255;
      relativeGrid[row * n + col] = Number((luma * maxHeightMeters - centerElev).toFixed(3));
    }
  }

  return {
    relativeGrid,
    gridSize: n,
    centerElevation: Number(centerElev.toFixed(2)),
  };
}

/**
 * Build a Three.js BufferGeometry in local ROS coordinates (X East, Y North, Z Up)
 * covering `landSizeMeters x landSizeMeters`, with exact georeferenced map UVs
 * and displaced Z vertices from `elevationSource`.
 */
export function buildTerrainBufferGeometry(
  landWidthMeters: number,
  elevationSource: ElevationQuerySource | undefined,
  tileGrid: MapTileGridSpec,
  segments = 40,
  useNormalizedLandUv = false,
  landHeightMeters?: number,
): THREE.BufferGeometry {
  const segs = Math.max(4, Math.min(96, Math.round(segments)));
  const extentX = Math.max(10, landWidthMeters);
  const extentY = Math.max(10, landHeightMeters ?? extentX);
  const geo = new THREE.PlaneGeometry(extentX, extentY, segs, segs);

  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
  const [eastOff, northOff] = tileGrid.centerOffsetEnu;
  const mosaicSpan = Math.max(0.1, tileGrid.planeSizeMeters);

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    const vz = sampleElevationAt(elevationSource, vx, vy);
    posAttr.setZ(i, vz);

    if (useNormalizedLandUv) {
      uvAttr.setXY(i, 0.5 + vx / extentX, 0.5 + vy / extentY);
    } else {
      const u = 0.5 + (vx - eastOff) / mosaicSpan;
      const v = 0.5 + (vy - northOff) / mosaicSpan;
      uvAttr.setXY(i, u, v);
    }
  }

  posAttr.needsUpdate = true;
  uvAttr.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
