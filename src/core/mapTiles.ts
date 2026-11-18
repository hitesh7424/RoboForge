export interface MapTilePreset {
  id: string;
  label: string;
  urlTemplate: string;
}

export const MAP_TILE_PRESETS: MapTilePreset[] = [
  {
    id: 'google_hybrid',
    label: 'Google Hybrid (Satellite + Labels)',
    urlTemplate: 'http://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  },
  {
    id: 'google_satellite',
    label: 'Google Satellite',
    urlTemplate: 'http://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  },
  {
    id: 'google_roadmap',
    label: 'Google Roadmap',
    urlTemplate: 'http://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
  },
  {
    id: 'osm_standard',
    label: 'OpenStreetMap',
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
];

export const TERRARIUM_URL_DEFAULT =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const DEFAULT_MAP_BACKGROUND = {
  enabled: true,
  tileUrl: 'http://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  latitude: 37.422,
  longitude: -122.0841,
  elevation: 0,
  headingDeg: 0,
  zoom: 19,
  opacity: 0.96,
  landSizeMeters: 100,
  elevationEnabled: true,
  elevationSource: 'terrarium' as const,
  elevationUrl: TERRARIUM_URL_DEFAULT,
  elevationScale: 1.0,
  terrainSegments: 40,
  heightmapMaxHeight: 25,
};

const EARTH_CIRCUMFERENCE_M = 40075016.68557849;
const EARTH_RADIUS_M = 6378137.0;
const MAX_MERCATOR_LAT = 85.05112877980659;

export function clampLatitude(latDeg: number): number {
  if (!Number.isFinite(latDeg)) return 0;
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, latDeg));
}

export function normalizeLongitude(lonDeg: number): number {
  if (!Number.isFinite(lonDeg)) return 0;
  let lon = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  if (lon === -180 && lonDeg > 0) lon = 180;
  return lon;
}

/**
 * Convert WGS84 latitude/longitude in degrees to continuous Web Mercator tile coordinates.
 */
export function latLonToTileFloat(
  latDeg: number,
  lonDeg: number,
  zoom: number,
): { x: number; y: number; n: number } {
  const z = Math.max(0, Math.min(22, Math.round(zoom)));
  const n = 2 ** z;
  const lat = clampLatitude(latDeg);
  const lon = normalizeLongitude(lonDeg);
  const latRad = (lat * Math.PI) / 180;

  const x = ((lon + 180) / 360) * n;
  const mercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = ((1 - mercY / Math.PI) / 2) * n;

  return { x, y, n };
}

/**
 * Convert local ROS ENU offset (eastM, northM) from (latDeg, lonDeg) back to WGS84 coordinates.
 */
export function latLonFromEnuOffset(
  latDeg: number,
  lonDeg: number,
  eastM: number,
  northM: number,
): { lat: number; lon: number } {
  const latRad = (clampLatitude(latDeg) * Math.PI) / 180;
  const dLat = (northM / EARTH_RADIUS_M) * (180 / Math.PI);
  const cosLat = Math.max(0.01, Math.cos(latRad));
  const dLon = (eastM / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI);
  return {
    lat: clampLatitude(latDeg + dLat),
    lon: normalizeLongitude(lonDeg + dLon),
  };
}

/**
 * Ground size (in meters) covered by one Web Mercator tile at a given latitude & zoom.
 */
export function tileSizeMetersAtLat(latDeg: number, zoom: number): number {
  const z = Math.max(0, Math.min(22, Math.round(zoom)));
  const n = 2 ** z;
  const latRad = (clampLatitude(latDeg) * Math.PI) / 180;
  return Math.max(0.1, (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / n);
}

export interface TileGridCell {
  tx: number;
  ty: number;
  col: number;
  row: number;
}

export interface MapTileGridSpec {
  zoom: number;
  gridCount: number;
  tileSizeMeters: number;
  planeSizeMeters: number;
  /** Offset in ROS ENU meters (East=+X, North=+Y) from (0,0) center coord to center of mosaic plane */
  centerOffsetEnu: [number, number];
  cells: TileGridCell[];
}

/**
 * Compute a square tile mosaic centered so the exact (latDeg, lonDeg) point maps to ROS (0, 0).
 */
export function computeMapTileGrid(
  latDeg: number,
  lonDeg: number,
  zoom: number,
  gridRadius = 2,
): MapTileGridSpec {
  const z = Math.max(1, Math.min(21, Math.round(zoom)));
  const { x: txFloat, y: tyFloat, n } = latLonToTileFloat(latDeg, lonDeg, z);
  const centerTx = Math.floor(txFloat);
  const centerTy = Math.floor(tyFloat);
  const fracX = txFloat - centerTx;
  const fracY = tyFloat - centerTy;

  const tileSizeMeters = tileSizeMetersAtLat(latDeg, z);
  const radius = Math.max(0, Math.min(5, Math.round(gridRadius)));
  const gridCount = radius * 2 + 1;
  const planeSizeMeters = tileSizeMeters * gridCount;

  // Center of tile (centerTx, centerTy) relative to (latDeg, lonDeg) in ENU (+X east, +Y north)
  const eastOffsetM = (0.5 - fracX) * tileSizeMeters;
  const northOffsetM = (fracY - 0.5) * tileSizeMeters;

  const cells: TileGridCell[] = [];
  for (let row = 0; row < gridCount; row++) {
    const dy = row - radius;
    const ty = Math.max(0, Math.min(n - 1, centerTy + dy));
    for (let col = 0; col < gridCount; col++) {
      const dx = col - radius;
      const tx = ((centerTx + dx) % n + n) % n;
      cells.push({ tx, ty, col, row });
    }
  }

  return {
    zoom: z,
    gridCount,
    tileSizeMeters,
    planeSizeMeters,
    centerOffsetEnu: [eastOffsetM, northOffsetM],
    cells,
  };
}

/**
 * Compute a tile mosaic guaranteed to cover a square land area of `landSizeMeters x landSizeMeters`
 * centered at (latDeg, lonDeg), stepping down zoom slightly if needed for very large extents.
 */
export function computeMapTileGridForExtent(
  latDeg: number,
  lonDeg: number,
  preferredZoom: number,
  landSizeMeters: number,
): MapTileGridSpec {
  const extent = Math.max(10, Math.min(5000, landSizeMeters));
  let z = Math.max(1, Math.min(21, Math.round(preferredZoom)));
  const maxRadius = 4; // max 9x9 = 81 tiles per refresh

  while (z > 1) {
    const tSize = tileSizeMetersAtLat(latDeg, z);
    const maxCoveredHalf = (maxRadius + 0.15) * tSize;
    if (maxCoveredHalf >= extent / 2) {
      break;
    }
    z -= 1;
  }

  const tSize = tileSizeMetersAtLat(latDeg, z);
  const neededRadius = Math.max(1, Math.min(maxRadius, Math.ceil(extent / (2 * tSize) + 0.5)));
  return computeMapTileGrid(latDeg, lonDeg, z, neededRadius);
}

/**
 * Decode Mapzen Terrarium RGB pixel values into meters above WGS84 datum.
 */
export function decodeTerrariumPixel(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export interface ElevationQuerySource {
  elevationEnabled?: boolean;
  elevationScale?: number;
  landSizeMeters?: number;
  elevationGrid?: number[];
  elevationGridSize?: number;
}

/**
 * Bilinearly sample terrain elevation (in ROS Z meters relative to center 0,0)
 * at local ROS coordinates (xM, yM).
 */
export function sampleElevationAt(
  source: ElevationQuerySource | undefined,
  xM: number,
  yM: number,
): number {
  if (!source?.elevationEnabled) return 0;
  const grid = source.elevationGrid;
  const n = source.elevationGridSize ?? 0;
  if (!grid || n < 2 || grid.length < n * n) return 0;

  const scale = source.elevationScale ?? 1;
  const landSize = Math.max(10, source.landSizeMeters ?? 100);
  const half = landSize / 2;

  const u = Math.max(0, Math.min(1, (xM + half) / landSize));
  const v = Math.max(0, Math.min(1, (yM + half) / landSize));

  const gx = u * (n - 1);
  const gy = v * (n - 1);
  const x0 = Math.min(n - 2, Math.floor(gx));
  const y0 = Math.min(n - 2, Math.floor(gy));
  const tx = gx - x0;
  const ty = gy - y0;

  const z00 = grid[y0 * n + x0] ?? 0;
  const z10 = grid[y0 * n + (x0 + 1)] ?? 0;
  const z01 = grid[(y0 + 1) * n + x0] ?? 0;
  const z11 = grid[(y0 + 1) * n + (x0 + 1)] ?? 0;

  const z0 = z00 + (z10 - z00) * tx;
  const z1 = z01 + (z11 - z01) * tx;
  return (z0 + (z1 - z0) * ty) * scale;
}

export function computeElevationStats(source: ElevationQuerySource | undefined): {
  minZ: number;
  maxZ: number;
  rangeZ: number;
  hasRelief: boolean;
} {
  if (!source?.elevationEnabled || !source.elevationGrid || (source.elevationGridSize ?? 0) < 2) {
    return { minZ: 0, maxZ: 0, rangeZ: 0, hasRelief: false };
  }
  const scale = source.elevationScale ?? 1;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const val of source.elevationGrid) {
    const z = val * scale;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return { minZ: 0, maxZ: 0, rangeZ: 0, hasRelief: false };
  }
  const rangeZ = maxZ - minZ;
  return { minZ, maxZ, rangeZ, hasRelief: rangeZ > 0.01 };
}

/**
 * Format a tile URL template containing {x}, {y}, {z}.
 * Optionally upgrades `http://mt*.google.com` to `https://` when running inside an HTTPS page
 * so browsers do not block tiles as mixed content.
 */
export function formatTileUrl(
  template: string,
  tx: number,
  ty: number,
  zoom: number,
  upgradeMixedContent = false,
): string {
  let url = template
    .trim()
    .replace(/\{x\}/gi, String(tx))
    .replace(/\{y\}/gi, String(ty))
    .replace(/\{z\}/gi, String(zoom));

  if (upgradeMixedContent && /^http:\/\/mt\d*\.google\.com\//i.test(url)) {
    url = url.replace(/^http:\/\//i, 'https://');
  }
  return url;
}

/**
 * Parse pasted coordinate strings such as "37.4220, -122.0841" or "37.4220 -122.0841".
 */
export function parseCoordinateInput(raw: string): { lat: number; lon: number } | null {
  const parts = raw
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Crop a rendered Web Mercator tile mosaic canvas to the exact `landSizeMeters x landSizeMeters`
 * region centered at ROS ENU (0, 0) and return a PNG base64 string (without data: prefix).
 */
export function cropTileMosaicToGroundPngBase64(
  mosaicCanvas: HTMLCanvasElement,
  tileGrid: MapTileGridSpec,
  landSizeMeters: number,
  headingDeg = 0,
  outSizePx = 512,
): string | undefined {
  if (typeof document === 'undefined') return undefined;
  try {
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outSizePx;
    outCanvas.height = outSizePx;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) return undefined;

    const mosaicPx = mosaicCanvas.width;
    const mosaicSpan = Math.max(0.1, tileGrid.planeSizeMeters);
    const extent = Math.max(10, landSizeMeters);
    const [eastOff, northOff] = tileGrid.centerOffsetEnu;

    const u0 = 0.5 - eastOff / mosaicSpan;
    const v0 = 0.5 - northOff / mosaicSpan;
    const cx = u0 * mosaicPx;
    const cy = (1 - v0) * mosaicPx;
    const spanPx = Math.max(1, (extent / mosaicSpan) * mosaicPx);
    const scale = outSizePx / spanPx;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, outSizePx, outSizePx);

    ctx.save();
    ctx.translate(outSizePx / 2, outSizePx / 2);
    if (headingDeg !== 0) {
      ctx.rotate((headingDeg * Math.PI) / 180);
    }
    ctx.scale(scale, scale);
    ctx.drawImage(mosaicCanvas, -cx, -cy);
    ctx.restore();

    const dataUrl = outCanvas.toDataURL('image/png');
    const commaIdx = dataUrl.indexOf(',');
    return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Download and stitch map tiles covering `landSizeMeters x landSizeMeters` around (latitude, longitude)
 * into a georeferenced PNG base64 texture for Gazebo ground_plane / heightmap export.
 */
export async function downloadMapTilesTextureBase64(
  mapBg: {
    tileUrl?: string;
    latitude?: number;
    longitude?: number;
    zoom?: number;
    landSizeMeters?: number;
    headingDeg?: number;
  },
  outSizePx = 512,
): Promise<{ base64: string; loadedCount: number; totalCount: number } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return null;
  }

  const lat = mapBg.latitude ?? DEFAULT_MAP_BACKGROUND.latitude;
  const lon = mapBg.longitude ?? DEFAULT_MAP_BACKGROUND.longitude;
  const zoom = mapBg.zoom ?? DEFAULT_MAP_BACKGROUND.zoom;
  const landSize = Math.max(10, mapBg.landSizeMeters ?? DEFAULT_MAP_BACKGROUND.landSizeMeters);
  const headingDeg = mapBg.headingDeg ?? 0;
  const template = (mapBg.tileUrl ?? '').trim() || DEFAULT_MAP_BACKGROUND.tileUrl;

  const tileGrid = computeMapTileGridForExtent(lat, lon, zoom, landSize);
  const tilePx = 256;
  const sizePx = tileGrid.gridCount * tilePx;
  const mosaicCanvas = document.createElement('canvas');
  mosaicCanvas.width = sizePx;
  mosaicCanvas.height = sizePx;
  const ctx = mosaicCanvas.getContext('2d');
  if (!ctx) return null;

  // Draw coordinate grid base layer so even partial/offline tile loads produce a clean texture
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

  const upgradeMixed =
    typeof window !== 'undefined' && window.location.protocol === 'https:';
  let loadedCount = 0;

  await Promise.all(
    tileGrid.cells.map(
      (cell) =>
        new Promise<void>((resolve) => {
          const url = formatTileUrl(template, cell.tx, cell.ty, tileGrid.zoom, upgradeMixed);
          if (!url) {
            resolve();
            return;
          }
          const img = new Image();
          img.crossOrigin = 'anonymous';
          const timer = globalThis.setTimeout(() => {
            resolve();
          }, 5000);
          img.onload = () => {
            globalThis.clearTimeout(timer);
            try {
              ctx.drawImage(img, cell.col * tilePx, cell.row * tilePx, tilePx, tilePx);
              loadedCount += 1;
            } catch {
              // ignore draw error
            }
            resolve();
          };
          img.onerror = () => {
            globalThis.clearTimeout(timer);
            resolve();
          };
          img.src = url;
        }),
    ),
  );

  const base64 = cropTileMosaicToGroundPngBase64(
    mosaicCanvas,
    tileGrid,
    landSize,
    headingDeg,
    outSizePx,
  );
  if (!base64) return null;
  return {
    base64,
    loadedCount,
    totalCount: tileGrid.cells.length,
  };
}

