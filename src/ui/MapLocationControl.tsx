import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crosshair,
  Loader2,
  MapPin,
  Move,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { searchPlaces, type PlaceSearchResult } from '@/core/geocoding';
import {
  computeMapTileGrid,
  DEFAULT_MAP_BACKGROUND,
  formatLatLonPair,
  formatTileUrl,
  nudgeLatLonMeters,
  parseCoordinateInput,
  shiftLatLonByMapDrag,
  tileSizeMetersAtLat,
} from '@/core/mapTiles';

const NUDGE_STEPS_M = [1, 5, 25, 100, 500] as const;

export interface MapLocationControlProps {
  latitude: number;
  longitude: number;
  headingDeg?: number;
  tileUrl?: string;
  landWidth: number;
  landHeight: number;
  onChangeCenter: (lat: number, lon: number, label?: string) => void;
  /** Optional callback for World Studio to activate the full 2D Canvas Move Map tool */
  onActivate2DMapMove?: () => void;
  is2DMapMoveActive?: boolean;
}

function computeIdealMiniMapZoom(
  lat: number,
  landWidth: number,
  landHeight: number,
  canvasWidthPx: number,
  canvasHeightPx: number,
): number {
  const maxLand = Math.max(10, landWidth, landHeight);
  // Aim for the capture rectangle to span ~38% of the smallest mini-map dimension
  const targetPx = Math.max(40, Math.min(canvasWidthPx, canvasHeightPx) * 0.38);
  const targetMetersPerTile = (maxLand / targetPx) * 256;
  for (let z = 20; z >= 10; z--) {
    if (tileSizeMetersAtLat(lat, z) >= targetMetersPerTile) {
      return z;
    }
  }
  return 10;
}

export function MapLocationControl({
  latitude,
  longitude,
  headingDeg = 0,
  tileUrl,
  landWidth,
  landHeight,
  onChangeCenter,
  onActivate2DMapMove,
  is2DMapMoveActive = false,
}: MapLocationControlProps) {
  const [inputValue, setInputValue] = useState(() => formatLatLonPair(latitude, longitude));
  const [isEditingInput, setIsEditingInput] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(
    null,
  );
  const [nudgeStepM, setNudgeStepM] = useState<number>(25);

  // Mini-map interactive state
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniHostRef = useRef<HTMLDivElement | null>(null);
  const mosaicRef = useRef<HTMLCanvasElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [miniSize, setMiniSize] = useState<{ w: number; h: number }>({ w: 244, h: 156 });
  const [previewZoom, setPreviewZoom] = useState<number>(() =>
    computeIdealMiniMapZoom(latitude, landWidth, landHeight, 244, 156),
  );
  const [mosaicRev, setMosaicRev] = useState(0);
  const [dragPx, setDragPx] = useState<[number, number] | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // Sync single input display whenever coordinates update externally (drag, nudge, preset)
  useEffect(() => {
    if (!isEditingInput) {
      setInputValue(formatLatLonPair(latitude, longitude));
    }
  }, [latitude, longitude, isEditingInput]);

  // Measure mini-map container width cleanly
  useEffect(() => {
    const el = miniHostRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.max(160, Math.floor(el.clientWidth));
      setMiniSize({ w, h: 156 });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const miniTileGrid = useMemo(
    () => computeMapTileGrid(latitude, longitude, previewZoom, 2),
    [latitude, longitude, previewZoom],
  );

  // Stream satellite / road tiles for the mini-map
  useEffect(() => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return;
    const tilePx = 256;
    const sizePx = miniTileGrid.gridCount * tilePx;
    const offscreen = document.createElement('canvas');
    offscreen.width = sizePx;
    offscreen.height = sizePx;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, sizePx, sizePx);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.lineWidth = 1;
    for (const cell of miniTileGrid.cells) {
      ctx.strokeRect(cell.col * tilePx, cell.row * tilePx, tilePx, tilePx);
    }

    mosaicRef.current = offscreen;
    setMosaicRev((r) => r + 1);

    let cancelled = false;
    const upgradeMixed = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const template = (tileUrl ?? '').trim() || DEFAULT_MAP_BACKGROUND.tileUrl;

    for (const cell of miniTileGrid.cells) {
      const url = formatTileUrl(template, cell.tx, cell.ty, miniTileGrid.zoom, upgradeMixed);
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
  }, [miniTileGrid, tileUrl]);

  // Meters per CSS pixel on the mini-map (1 tile = 256 CSS px at native zoom)
  const metersPerCssPx = useMemo(
    () => Math.max(0.01, miniTileGrid.tileSizeMeters / 256),
    [miniTileGrid.tileSizeMeters],
  );

  // Render mini-map canvas with live drag offset and exact emerald capture box
  useEffect(() => {
    const canvas = miniCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(miniSize.w * dpr);
    canvas.height = Math.round(miniSize.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#090d14';
    ctx.fillRect(0, 0, miniSize.w, miniSize.h);

    const mosaic = mosaicRef.current;
    const [dxDrag, dyDrag] = dragPx ?? [0, 0];

    if (mosaic) {
      const mosaicPx = mosaic.width;
      const mosaicSpanM = Math.max(0.1, miniTileGrid.planeSizeMeters);
      const [eastOff, northOff] = miniTileGrid.centerOffsetEnu;
      const u0 = 0.5 - eastOff / mosaicSpanM;
      const v0 = 0.5 - northOff / mosaicSpanM;
      const cx = u0 * mosaicPx;
      const cy = (1 - v0) * mosaicPx;

      ctx.save();
      ctx.translate(miniSize.w / 2 + dxDrag, miniSize.h / 2 + dyDrag);
      if (headingDeg !== 0) {
        ctx.rotate((headingDeg * Math.PI) / 180);
      }
      ctx.drawImage(mosaic, -cx, -cy);
      ctx.restore();
    }

    // Exact capture rectangle (landWidth x landHeight) centered in the mini-map
    const boxW = Math.max(8, landWidth / metersPerCssPx);
    const boxH = Math.max(8, landHeight / metersPerCssPx);
    const rx = miniSize.w / 2 - boxW / 2;
    const ry = miniSize.h / 2 - boxH / 2;

    // Subtle dark surround mask outside the capture area
    ctx.fillStyle = 'rgba(6, 10, 18, 0.44)';
    ctx.fillRect(0, 0, miniSize.w, Math.max(0, ry));
    ctx.fillRect(0, ry + boxH, miniSize.w, Math.max(0, miniSize.h - (ry + boxH)));
    ctx.fillRect(0, Math.max(0, ry), Math.max(0, rx), Math.min(miniSize.h, boxH));
    ctx.fillRect(rx + boxW, Math.max(0, ry), Math.max(0, miniSize.w - (rx + boxW)), Math.min(miniSize.h, boxH));

    // Capture rectangle border
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.75;
    ctx.strokeRect(rx, ry, boxW, boxH);

    // Center crosshair (ROS 0,0)
    const midX = miniSize.w / 2;
    const midY = miniSize.h / 2;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(midX - 6, midY);
    ctx.lineTo(midX + 6, midY);
    ctx.moveTo(midX, midY - 6);
    ctx.lineTo(midX, midY + 6);
    ctx.stroke();

    // Live drag delta badge
    if (dragPx && (Math.abs(dragPx[0]) > 1 || Math.abs(dragPx[1]) > 1)) {
      const dxRosM = dragPx[0] * metersPerCssPx;
      const dyRosM = -dragPx[1] * metersPerCssPx;
      const shifted = shiftLatLonByMapDrag(latitude, longitude, dxRosM, dyRosM, headingDeg);
      const label = formatLatLonPair(shifted.lat, shifted.lon, 5);
      ctx.font = '10px monospace';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(11, 15, 23, 0.9)';
      ctx.fillRect(6, miniSize.h - 22, tw, 16);
      ctx.fillStyle = '#a7f3d0';
      ctx.fillText(label, 11, miniSize.h - 11);
    }

    ctx.restore();
  }, [
    miniSize,
    miniTileGrid,
    mosaicRev,
    dragPx,
    headingDeg,
    landWidth,
    landHeight,
    metersPerCssPx,
    latitude,
    longitude,
  ]);

  const handleSubmitInput = useCallback(async () => {
    const raw = inputValue.trim();
    if (!raw) return;

    const parsed = parseCoordinateInput(raw);
    if (parsed) {
      setResults([]);
      setIsEditingInput(false);
      setStatusMessage({
        kind: 'info',
        text: `Centered at ${formatLatLonPair(parsed.lat, parsed.lon, 5)}`,
      });
      onChangeCenter(parsed.lat, parsed.lon);
      setPreviewZoom(computeIdealMiniMapZoom(parsed.lat, landWidth, landHeight, miniSize.w, miniSize.h));
      return;
    }

    // Treat as city / place search
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSearching(true);
    setStatusMessage(null);
    try {
      const hits = await searchPlaces(raw, { limit: 6, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setResults(hits);
      if (hits.length === 0) {
        setStatusMessage({
          kind: 'error',
          text: 'No matching city or valid "lat, lon" found.',
        });
      }
    } catch {
      if (!ctrl.signal.aborted) {
        setStatusMessage({ kind: 'error', text: 'Location search failed.' });
      }
    } finally {
      if (!ctrl.signal.aborted) {
        setSearching(false);
      }
    }
  }, [inputValue, landWidth, landHeight, miniSize.w, miniSize.h, onChangeCenter]);

  const handlePickPlace = (place: PlaceSearchResult) => {
    setResults([]);
    setIsEditingInput(false);
    setInputValue(formatLatLonPair(place.lat, place.lon));
    setStatusMessage({
      kind: 'info',
      text: `${place.name} · Drag map to fine-tune`,
    });
    onChangeCenter(place.lat, place.lon, place.displayName);
    // Zoom out slightly to neighborhood level after a city search so user can see streets & drag easily
    const fitZoom = computeIdealMiniMapZoom(place.lat, landWidth, landHeight, miniSize.w, miniSize.h);
    setPreviewZoom(Math.max(12, Math.min(16, fitZoom - 1)));
  };

  const handleNudge = (eastM: number, northM: number) => {
    const next = nudgeLatLonMeters(latitude, longitude, eastM, northM);
    setIsEditingInput(false);
    onChangeCenter(next.lat, next.lon);
  };

  const handleMiniPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setDragPx([0, 0]);
  };

  const handleMiniPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setDragPx([dx, dy]);
  };

  const handleMiniPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    setDragPx(null);
    if (Math.hypot(dx, dy) < 2) return;
    const dxRosM = dx * metersPerCssPx;
    const dyRosM = -dy * metersPerCssPx;
    const next = shiftLatLonByMapDrag(latitude, longitude, dxRosM, dyRosM, headingDeg);
    setIsEditingInput(false);
    onChangeCenter(next.lat, next.lon);
  };

  const handleMiniDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    // Pulling clicked pixel to center is equivalent to dragging the map by (center - click)
    const dxRosM = (miniSize.w / 2 - clickX) * metersPerCssPx;
    const dyRosM = -(miniSize.h / 2 - clickY) * metersPerCssPx;
    const next = shiftLatLonByMapDrag(latitude, longitude, dxRosM, dyRosM, headingDeg);
    setIsEditingInput(false);
    onChangeCenter(next.lat, next.lon);
  };

  const handleMiniWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setPreviewZoom((z) => Math.max(10, Math.min(20, z + (e.deltaY < 0 ? 1 : -1))));
  };

  return (
    <div className="space-y-2 text-[11px]" data-testid="map-location-control">
      {/* Single Smart Coordinate / City Search Input */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span className="flex items-center gap-1 font-medium text-slate-300">
            <MapPin className="h-3 w-3 text-emerald-400" />
            Coordinate or City Search
          </span>
          <span className="font-mono text-[9px] text-slate-500">lat, lon or place</span>
        </div>

        <div className="flex items-center gap-1">
          <div className="relative flex-1 min-w-0">
            <input
              type="text"
              data-testid="map-location-input"
              aria-label="Coordinate or city search"
              placeholder="City, place, or lat, lon"
              value={inputValue}
              onFocus={() => setIsEditingInput(true)}
              onBlur={() => {
                // Keep text if results are open so clicking a result works
                if (results.length === 0 && inputValue.trim() === '') {
                  setIsEditingInput(false);
                }
              }}
              onChange={(e) => {
                setInputValue(e.target.value);
                setIsEditingInput(true);
                setStatusMessage(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSubmitInput();
                } else if (e.key === 'Escape') {
                  setResults([]);
                  setIsEditingInput(false);
                  setInputValue(formatLatLonPair(latitude, longitude));
                }
              }}
              className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] pl-2 pr-6 font-mono text-[11px] text-slate-100 placeholder:font-sans placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            {inputValue && (
              <button
                type="button"
                aria-label="Clear location input"
                onClick={() => {
                  setInputValue('');
                  setResults([]);
                  setIsEditingInput(true);
                  setStatusMessage(null);
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            data-testid="map-location-search-btn"
            aria-label="Go to coordinate or search city"
            disabled={searching}
            onClick={() => void handleSubmitInput()}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-emerald-700/70 bg-emerald-700/85 px-2 text-[10px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
          >
            {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            Go
          </button>
        </div>

        {/* Inline City Search Results Dropdown (Zero Popups) */}
        {results.length > 0 && (
          <div
            data-testid="map-search-results"
            role="listbox"
            aria-label="City search results"
            className="max-h-40 overflow-y-auto rounded border border-[#2c384e] bg-[#0b0f18] divide-y divide-[#1b2333]"
          >
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => handlePickPlace(item)}
                className="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left hover:bg-[#172133] transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-slate-100">
                    {item.name}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-emerald-400">
                    {item.lat.toFixed(3)}, {item.lon.toFixed(3)}
                  </span>
                </div>
                {item.subtitle && (
                  <span className="truncate text-[9px] text-slate-400">{item.subtitle}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {statusMessage && (
          <p
            className={`text-[10px] leading-snug ${
              statusMessage.kind === 'error' ? 'text-red-400' : 'text-emerald-300/90'
            }`}
          >
            {statusMessage.text}
          </p>
        )}
      </div>

      {/* Interactive Drag-to-Position Mini-Map */}
      <div
        ref={miniHostRef}
        className="relative overflow-hidden rounded border border-[#2a3449] bg-[#090d14]"
      >
        <canvas
          ref={miniCanvasRef}
          data-testid="map-position-minimap"
          title="Drag to move map · Double-click to center · Scroll to zoom"
          style={{ width: miniSize.w, height: miniSize.h }}
          className={`block w-full ${dragPx ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={handleMiniPointerDown}
          onPointerMove={handleMiniPointerMove}
          onPointerUp={handleMiniPointerUp}
          onDoubleClick={handleMiniDoubleClick}
          onWheel={handleMiniWheel}
        />

        {/* Top-left hint badge */}
        <div className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-[#090d14]/85 px-1.5 py-0.5 font-mono text-[9px] text-slate-300 border border-white/10">
          Drag to move
        </div>

        {/* Top-right zoom controls */}
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded border border-[#2a3449] bg-[#0c111b]/90 p-0.5">
          <button
            type="button"
            aria-label="Zoom out mini-map preview"
            title="Zoom out to find area"
            onClick={() => setPreviewZoom((z) => Math.max(10, z - 1))}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:bg-[#1b2436] hover:text-white cursor-pointer"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="Fit mini-map to capture frame"
            title="Fit capture frame"
            onClick={() =>
              setPreviewZoom(
                computeIdealMiniMapZoom(latitude, landWidth, landHeight, miniSize.w, miniSize.h),
              )
            }
            className="inline-flex h-5 items-center px-1 font-mono text-[9px] text-emerald-300 hover:bg-[#1b2436] rounded cursor-pointer"
          >
            z{previewZoom}
          </button>
          <button
            type="button"
            aria-label="Zoom in mini-map preview"
            title="Zoom in for fine alignment"
            onClick={() => setPreviewZoom((z) => Math.min(20, z + 1))}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:bg-[#1b2436] hover:text-white cursor-pointer"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
        </div>

        {/* Bottom-right extent readout */}
        <div className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-[#090d14]/85 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300 border border-emerald-500/30">
          {Math.round(landWidth)}m×{Math.round(landHeight)}m
        </div>
      </div>

      {/* Precision Metric Nudge Controls */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-0.5" role="group" aria-label="Nudge map center">
          <button
            type="button"
            data-testid="map-nudge-w"
            aria-label={`Nudge map west ${nudgeStepM}m`}
            title={`Shift center West ${nudgeStepM}m`}
            onClick={() => handleNudge(-nudgeStepM, 0)}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#2a3346] bg-[#121824] text-slate-200 hover:bg-[#1d273a] hover:text-white cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3" />
          </button>
          <button
            type="button"
            data-testid="map-nudge-n"
            aria-label={`Nudge map north ${nudgeStepM}m`}
            title={`Shift center North ${nudgeStepM}m`}
            onClick={() => handleNudge(0, nudgeStepM)}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#2a3346] bg-[#121824] text-slate-200 hover:bg-[#1d273a] hover:text-white cursor-pointer"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            data-testid="map-nudge-s"
            aria-label={`Nudge map south ${nudgeStepM}m`}
            title={`Shift center South ${nudgeStepM}m`}
            onClick={() => handleNudge(0, -nudgeStepM)}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#2a3346] bg-[#121824] text-slate-200 hover:bg-[#1d273a] hover:text-white cursor-pointer"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
          <button
            type="button"
            data-testid="map-nudge-e"
            aria-label={`Nudge map east ${nudgeStepM}m`}
            title={`Shift center East ${nudgeStepM}m`}
            onClick={() => handleNudge(nudgeStepM, 0)}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#2a3346] bg-[#121824] text-slate-200 hover:bg-[#1d273a] hover:text-white cursor-pointer"
          >
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        <label className="flex items-center gap-1 text-[10px] text-slate-400">
          <span>Step</span>
          <select
            data-testid="map-nudge-step"
            aria-label="Map nudge step in meters"
            value={nudgeStepM}
            onChange={(e) => setNudgeStepM(Number(e.target.value))}
            className="h-6 rounded border border-[#2a3346] bg-[#10141d] px-1.5 font-mono text-[10px] text-slate-200 cursor-pointer"
          >
            {NUDGE_STEPS_M.map((step) => (
              <option key={step} value={step}>
                {step} m
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Optional shortcut to full 2D Canvas Move Map tool in World Studio */}
      {onActivate2DMapMove && (
        <button
          type="button"
          data-testid="activate-2d-move-map"
          onClick={onActivate2DMapMove}
          className={`flex w-full items-center justify-center gap-1.5 rounded border py-1.5 text-[10px] font-medium transition-colors cursor-pointer ${
            is2DMapMoveActive
              ? 'border-cyan-400 bg-cyan-950/60 text-cyan-200'
              : 'border-[#2a3449] bg-[#121824] text-slate-200 hover:bg-[#1c2538]'
          }`}
        >
          {is2DMapMoveActive ? (
            <>
              <Crosshair className="h-3 w-3 text-cyan-300" />
              2D Map Drag Active — Drag Canvas
            </>
          ) : (
            <>
              <Move className="h-3 w-3 text-emerald-400" />
              Move Map Area on 2D Canvas
            </>
          )}
        </button>
      )}
    </div>
  );
}
