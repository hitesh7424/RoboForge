import { useMemo, useRef, useState } from 'react';
import {
  BrickWall,
  Building2,
  CloudSun,
  ImagePlus,
  Layers,
  Lightbulb,
  MapPin,
  Mountain,
  Paintbrush,
  Palette,
  Sparkles,
  Trash2,
  Trees,
  Upload,
} from 'lucide-react';
import { DEFAULT_MAP_BACKGROUND } from '@/core/mapTiles';
import type { MapBackground } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { fetchTerrariumElevationGrid } from '@/core/terrain';
import {
  BUILTIN_TEXTURE_PRESETS,
  getPresetPreviewDataUrl,
  materializePresetAsTextureAsset,
  type TexturePresetCategory,
} from '@/core/texturePresets';
import { DEFAULT_WORLD_COSMETICS, SKY_PRESET_LIST } from '@/core/worldZones';
import {
  COSMETIC_PROP_PRESETS,
  readFileAsTextureAsset,
  type ActiveBrushMaterial,
  type StudioTool,
} from '@/worldStudio/types';

type PaletteTab = 'textures' | 'scenery' | 'atmosphere';

export interface WorldStudioPaletteProps {
  tool: StudioTool;
  onSelectTool: (tool: StudioTool) => void;
  brush: ActiveBrushMaterial;
  onChangeBrush: (next: ActiveBrushMaterial) => void;
  treeStyle: 'deciduous' | 'pine';
  onChangeTreeStyle: (style: 'deciduous' | 'pine') => void;
  treeRadius: number;
  onChangeTreeRadius: (r: number) => void;
  treeHeight: number;
  onChangeTreeHeight: (h: number) => void;
  buildingHeight: number;
  onChangeBuildingHeight: (h: number) => void;
  buildingColor: string;
  onChangeBuildingColor: (c: string) => void;
  wallHeight: number;
  onChangeWallHeight: (h: number) => void;
  wallThickness: number;
  onChangeWallThickness: (t: number) => void;
  selectedPropId: string;
  onSelectPropId: (id: string) => void;
}

const CATEGORY_OPTIONS: { id: 'all' | TexturePresetCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'nature', label: 'Nature' },
  { id: 'roads', label: 'Roads' },
  { id: 'masonry', label: 'Masonry' },
  { id: 'ground', label: 'Ground' },
];

export function WorldStudioPalette({
  tool,
  onSelectTool,
  brush,
  onChangeBrush,
  treeStyle,
  onChangeTreeStyle,
  treeRadius,
  onChangeTreeRadius,
  treeHeight,
  onChangeTreeHeight,
  buildingHeight,
  onChangeBuildingHeight,
  buildingColor,
  onChangeBuildingColor,
  wallHeight,
  onChangeWallHeight,
  wallThickness,
  onChangeWallThickness,
  selectedPropId,
  onSelectPropId,
}: WorldStudioPaletteProps) {
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const addTexture = useRoboForgeStore((s) => s.addTexture);
  const deleteTexture = useRoboForgeStore((s) => s.deleteTexture);
  const updateWorld = useRoboForgeStore((s) => s.updateWorld);
  const updateWorldCosmetics = useRoboForgeStore((s) => s.updateWorldCosmetics);
  const updateSurfaceZone = useRoboForgeStore((s) => s.updateSurfaceZone);
  const updateWorldObject = useRoboForgeStore((s) => s.updateWorldObject);
  const setTerrainElevation = useRoboForgeStore((s) => s.setTerrainElevation);
  const addWorldLight = useRoboForgeStore((s) => s.addWorldLight);
  const addLog = useRoboForgeStore((s) => s.addLog);

  const [activeTab, setActiveTab] = useState<PaletteTab>('textures');
  const [category, setCategory] = useState<'all' | TexturePresetCategory>('all');
  const [isDragOver, setIsDragOver] = useState(false);
  const [demLoading, setDemLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cosmetics = { ...DEFAULT_WORLD_COSMETICS, ...project.world.cosmetics };
  const mapBg: MapBackground = project.world.mapBackground ?? DEFAULT_MAP_BACKGROUND;

  // Separate user-uploaded custom textures from materialized preset assets
  const userTextures = useMemo(
    () => project.textures.filter((t) => !t.id.startsWith('preset_')),
    [project.textures],
  );

  const filteredPresets = useMemo(
    () =>
      category === 'all'
        ? BUILTIN_TEXTURE_PRESETS
        : BUILTIN_TEXTURE_PRESETS.filter((p) => p.category === category),
    [category],
  );

  const presetThumbs = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of BUILTIN_TEXTURE_PRESETS) {
      map[p.id] = getPresetPreviewDataUrl(p.id, 84);
    }
    return map;
  }, []);

  const ensurePresetAssetId = (presetId: string): string | undefined => {
    const existing = project.textures.find((t) => t.id === `preset_${presetId}`);
    if (existing) return existing.id;
    const asset = materializePresetAsTextureAsset(presetId, 256);
    if (!asset) return undefined;
    addTexture(asset);
    return asset.id;
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let lastUploadedId: string | undefined;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
        continue;
      }
      try {
        const asset = await readFileAsTextureAsset(file, useRoboForgeStore.getState().project.textures);
        addTexture(asset);
        lastUploadedId = asset.id;
      } catch (err) {
        addLog('error', err instanceof Error ? err.message : 'Texture upload failed');
      }
    }
    if (lastUploadedId) {
      onChangeBrush({
        ...brush,
        textureSource: 'custom',
        textureId: lastUploadedId,
      });
    }
  };

  const applyBrushToBaseGround = () => {
    if (brush.textureSource === 'custom' && brush.textureId) {
      updateWorld((w) => {
        w.ground.textureId = brush.textureId;
        w.ground.textureRepeat = [...brush.repeat];
      });
      updateWorldCosmetics((c) => {
        c.groundBasePresetId = undefined;
      });
    } else if (brush.textureSource === 'preset') {
      updateWorld((w) => {
        delete w.ground.textureId;
      });
      updateWorldCosmetics((c) => {
        c.groundBasePresetId = brush.presetId;
        c.groundBaseRepeat = [...brush.repeat];
      });
    }
  };

  const applyBrushToSelected = () => {
    if (selection?.type === 'surfaceZone') {
      updateSurfaceZone(selection.id, (z) => {
        z.textureSource = brush.textureSource;
        z.presetId = brush.presetId;
        z.textureId = brush.textureId;
        z.repeat = [...brush.repeat];
      });
    } else if (selection?.type === 'worldObject') {
      const texId =
        brush.textureSource === 'custom'
          ? brush.textureId
          : brush.textureSource === 'preset'
            ? ensurePresetAssetId(brush.presetId)
            : undefined;
      updateWorldObject(selection.id, (o) => {
        if (o.source.type === 'primitive') {
          o.source.material.textureId = texId;
          o.source.material.textureRepeat = [2, 2];
          if (texId) {
            o.source.material.rgba = [1, 1, 1, o.source.material.rgba[3]];
          }
        }
      });
    }
  };

  const handleFetchDem = async () => {
    setDemLoading(true);
    try {
      const res = await fetchTerrariumElevationGrid(
        mapBg.latitude,
        mapBg.longitude,
        mapBg.landSizeMeters ?? DEFAULT_MAP_BACKGROUND.landSizeMeters,
        mapBg.terrainSegments ?? 40,
        mapBg.elevationUrl,
      );
      if (res) {
        setTerrainElevation(res.relativeGrid, res.gridSize, res.centerElevation);
        addLog('info', `Loaded ${res.gridSize}×${res.gridSize} terrain elevation (${res.loadedTiles} tiles).`);
      } else {
        addLog('warning', 'Could not fetch remote DEM elevation tiles.');
      }
    } finally {
      setDemLoading(false);
    }
  };

  const hasApplicableSelection =
    selection?.type === 'surfaceZone' || selection?.type === 'worldObject';

  return (
    <aside
      aria-label="World Studio Palette"
      className="flex h-full w-72 shrink-0 flex-col border-r border-[#232b3b] bg-[#10141d] text-slate-200 select-none"
    >
      {/* Inline Category Switcher */}
      <div
        role="tablist"
        aria-label="Cosmetics palette sections"
        className="grid grid-cols-3 border-b border-[#232b3b] bg-[#0c1018] p-1 gap-1 shrink-0"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'textures'}
          onClick={() => setActiveTab('textures')}
          className={`flex items-center justify-center gap-1 rounded py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
            activeTab === 'textures'
              ? 'bg-[#1c2536] text-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#141a26]'
          }`}
        >
          <Palette className="h-3.5 w-3.5 text-emerald-400" />
          Textures
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'scenery'}
          onClick={() => setActiveTab('scenery')}
          className={`flex items-center justify-center gap-1 rounded py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
            activeTab === 'scenery'
              ? 'bg-[#1c2536] text-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#141a26]'
          }`}
        >
          <Trees className="h-3.5 w-3.5 text-sky-400" />
          Scenery
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'atmosphere'}
          onClick={() => setActiveTab('atmosphere')}
          className={`flex items-center justify-center gap-1 rounded py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
            activeTab === 'atmosphere'
              ? 'bg-[#1c2536] text-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#141a26]'
          }`}
        >
          <CloudSun className="h-3.5 w-3.5 text-amber-400" />
          Sky & Map
        </button>
      </div>

      {/* Scrollable Tab Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeTab === 'textures' && (
          <>
            {/* Quick Apply Actions for Current Brush */}
            <div className="rounded-md border border-[#253044] bg-[#0b0f17] p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                  <Paintbrush className="h-3.5 w-3.5 text-emerald-400" />
                  Active Paint Material
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {brush.textureSource === 'custom'
                    ? 'Custom'
                    : brush.textureSource === 'preset'
                      ? 'Preset'
                      : 'Solid'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={applyBrushToBaseGround}
                  className="rounded border border-[#2b374d] bg-[#151d2b] px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-[#1f2a3d] hover:text-white cursor-pointer"
                >
                  Set Base Ground
                </button>
                <button
                  type="button"
                  disabled={!hasApplicableSelection}
                  onClick={applyBrushToSelected}
                  className="rounded border border-[#2b374d] bg-[#151d2b] px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-[#1f2a3d] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Apply to Selected
                </button>
              </div>

              {/* Paint Brush Parameters */}
              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                <label className="space-y-1">
                  <span className="text-[10px] text-slate-400">Tile Repeat</span>
                  <input
                    type="number"
                    min={0.5}
                    max={64}
                    step={1}
                    aria-label="Brush tile repeat"
                    value={brush.repeat[0]}
                    onChange={(e) => {
                      const v = Math.max(0.5, Number(e.target.value) || 1);
                      onChangeBrush({ ...brush, repeat: [v, v] });
                    }}
                    className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] px-2 font-mono text-xs text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-slate-400">
                    Opacity ({Math.round(brush.opacity * 100)}%)
                  </span>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    aria-label="Brush opacity"
                    value={brush.opacity}
                    onChange={(e) =>
                      onChangeBrush({ ...brush, opacity: Number(e.target.value) })
                    }
                    className="w-full accent-emerald-500 mt-1.5"
                  />
                </label>
              </div>

              {(tool === 'zone_path' || tool === 'zone_circle') && (
                <div className="grid grid-cols-2 gap-2 pt-0.5 text-[11px]">
                  {tool === 'zone_path' && (
                    <label className="space-y-1 col-span-2">
                      <span className="text-[10px] text-slate-400">
                        Road / Path Width ({brush.strokeWidth.toFixed(1)} m)
                      </span>
                      <input
                        type="range"
                        min={0.5}
                        max={20}
                        step={0.5}
                        aria-label="Road path width meters"
                        value={brush.strokeWidth}
                        onChange={(e) =>
                          onChangeBrush({ ...brush, strokeWidth: Number(e.target.value) })
                        }
                        className="w-full accent-emerald-500"
                      />
                    </label>
                  )}
                  {tool === 'zone_circle' && (
                    <label className="space-y-1 col-span-2">
                      <span className="text-[10px] text-slate-400">
                        Default Circle Radius ({brush.circleRadius.toFixed(1)} m)
                      </span>
                      <input
                        type="range"
                        min={1}
                        max={30}
                        step={0.5}
                        aria-label="Circle zone default radius meters"
                        value={brush.circleRadius}
                        onChange={(e) =>
                          onChangeBrush({ ...brush, circleRadius: Number(e.target.value) })
                        }
                        className="w-full accent-emerald-500"
                      />
                    </label>
                  )}
                </div>
              )}
            </div>

            {/* Inline Custom Texture Upload Section (Zero Popups) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Custom Textures
                </h3>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Upload custom texture image"
                  className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 cursor-pointer"
                >
                  <ImagePlus className="h-3 w-3" />
                  Upload Image
                </button>
                <input
                  ref={fileInputRef}
                  data-testid="world-studio-texture-upload"
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                  aria-label="Upload custom texture files"
                  className="hidden"
                  onChange={(e) => {
                    void handleUploadFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  void handleUploadFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                aria-label="Drop PNG, JPG, or WebP texture images here"
                className={`flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-3 text-center transition-colors cursor-pointer ${
                  isDragOver
                    ? 'border-emerald-400 bg-emerald-950/30 text-emerald-200'
                    : 'border-[#2c364a] bg-[#0b0f17] text-slate-400 hover:border-slate-500 hover:text-slate-200'
                }`}
              >
                <Upload className="h-4 w-4 text-emerald-400" />
                <span className="text-[11px]">Drop PNG / JPG / WebP or click to browse</span>
              </div>

              {userTextures.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5">
                  {userTextures.map((tex) => {
                    const active =
                      brush.textureSource === 'custom' && brush.textureId === tex.id;
                    return (
                      <div
                        key={tex.id}
                        className={`group relative overflow-hidden rounded-md border transition-colors ${
                          active
                            ? 'border-emerald-400 ring-1 ring-emerald-400/50 bg-[#15222c]'
                            : 'border-[#252f42] bg-[#0d121b] hover:border-slate-500'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onChangeBrush({
                              ...brush,
                              textureSource: 'custom',
                              textureId: tex.id,
                            });
                            if (tool === 'select') {
                              onSelectTool('zone_rect');
                            }
                          }}
                          className="w-full text-left cursor-pointer"
                        >
                          <img
                            src={`data:${tex.mimeType};base64,${tex.dataBase64}`}
                            alt={tex.name}
                            className="h-14 w-full object-cover"
                          />
                          <div className="truncate px-1.5 py-1 text-[10px] font-medium text-slate-200">
                            {tex.name}
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete custom texture ${tex.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteTexture(tex.id);
                          }}
                          className="absolute right-1 top-1 rounded bg-black/70 p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Built-In Texture Presets Gallery */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Built-In Presets
                </h3>
                <span className="text-[10px] font-mono text-slate-500">
                  {filteredPresets.length}
                </span>
              </div>

              <div className="flex flex-wrap gap-1">
                {CATEGORY_OPTIONS.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    aria-pressed={category === cat.id}
                    className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                      category === cat.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-[#0c1018] text-slate-400 hover:bg-[#192030] hover:text-slate-200'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {filteredPresets.map((preset) => {
                  const active =
                    brush.textureSource === 'preset' && brush.presetId === preset.id;
                  const thumbUrl = presetThumbs[preset.id];
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`preset-swatch-${preset.id}`}
                      onClick={() => {
                        onChangeBrush({
                          ...brush,
                          textureSource: 'preset',
                          presetId: preset.id,
                          repeat: [...preset.defaultRepeat],
                        });
                        if (tool === 'select') {
                          onSelectTool('zone_rect');
                        }
                      }}
                      title={preset.description}
                      className={`group overflow-hidden rounded-md border text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-emerald-400 ring-1 ring-emerald-400/60 bg-[#13222a]'
                          : 'border-[#242e40] bg-[#0c1018] hover:border-slate-500'
                      }`}
                    >
                      <div
                        className="h-14 w-full bg-cover bg-center"
                        style={
                          thumbUrl
                            ? { backgroundImage: `url(${thumbUrl})` }
                            : { backgroundColor: preset.swatchHex }
                        }
                      />
                      <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                        <span className="truncate text-[10px] font-medium text-slate-200">
                          {preset.name}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {activeTab === 'scenery' && (
          <>
            {/* Trees */}
            <div className="rounded-md border border-[#242e40] bg-[#0b0f17] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                  <Trees className="h-3.5 w-3.5 text-emerald-400" />
                  Trees & Foliage
                </span>
                <button
                  type="button"
                  onClick={() => onSelectTool('tree')}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium cursor-pointer ${
                    tool === 'tree'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#182030] text-slate-300 hover:bg-[#232e44]'
                  }`}
                >
                  {tool === 'tree' ? 'Active Tool' : 'Place Tree'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onChangeTreeStyle('deciduous');
                    onSelectTool('tree');
                  }}
                  className={`rounded border py-1 text-[11px] font-medium cursor-pointer ${
                    treeStyle === 'deciduous'
                      ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                      : 'border-[#252f42] bg-[#10141d] text-slate-300 hover:bg-[#171e2b]'
                  }`}
                >
                  Oak / Canopy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangeTreeStyle('pine');
                    onSelectTool('tree');
                  }}
                  className={`rounded border py-1 text-[11px] font-medium cursor-pointer ${
                    treeStyle === 'pine'
                      ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                      : 'border-[#252f42] bg-[#10141d] text-slate-300 hover:bg-[#171e2b]'
                  }`}
                >
                  Conifer / Pine
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <label className="space-y-0.5">
                  <span className="text-slate-400">Canopy R (m)</span>
                  <input
                    type="number"
                    min={0.4}
                    max={12}
                    step={0.2}
                    value={treeRadius}
                    onChange={(e) => onChangeTreeRadius(Math.max(0.4, Number(e.target.value) || 1.4))}
                    className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] px-2 font-mono text-xs text-slate-100"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-slate-400">Height (m)</span>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    step={0.5}
                    value={treeHeight}
                    onChange={(e) => onChangeTreeHeight(Math.max(1, Number(e.target.value) || 3.5))}
                    className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] px-2 font-mono text-xs text-slate-100"
                  />
                </label>
              </div>
            </div>

            {/* Buildings & Walls */}
            <div className="rounded-md border border-[#242e40] bg-[#0b0f17] p-2.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-sky-400" />
                  Architecture
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onSelectTool('building')}
                  className={`flex items-center justify-center gap-1 rounded border py-1.5 text-[11px] font-medium cursor-pointer ${
                    tool === 'building'
                      ? 'border-sky-500 bg-sky-600 text-white'
                      : 'border-[#252f42] bg-[#10141d] text-slate-300 hover:bg-[#171e2b]'
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5" />
                  Building
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTool('wall')}
                  className={`flex items-center justify-center gap-1 rounded border py-1.5 text-[11px] font-medium cursor-pointer ${
                    tool === 'wall'
                      ? 'border-amber-500 bg-amber-600 text-white'
                      : 'border-[#252f42] bg-[#10141d] text-slate-300 hover:bg-[#171e2b]'
                  }`}
                >
                  <BrickWall className="h-3.5 w-3.5" />
                  Wall
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <label className="space-y-0.5">
                  <span className="text-slate-400">Bldg Height (m)</span>
                  <input
                    type="number"
                    min={0.5}
                    max={80}
                    step={0.5}
                    value={buildingHeight}
                    onChange={(e) =>
                      onChangeBuildingHeight(Math.max(0.5, Number(e.target.value) || 6))
                    }
                    className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] px-2 font-mono text-xs text-slate-100"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-slate-400">Facade Tint</span>
                  <input
                    type="color"
                    aria-label="Building facade color"
                    value={buildingColor}
                    onChange={(e) => onChangeBuildingColor(e.target.value)}
                    className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] p-0.5 cursor-pointer"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-slate-400">Wall Height (m)</span>
                  <input
                    type="number"
                    min={0.3}
                    max={20}
                    step={0.25}
                    value={wallHeight}
                    onChange={(e) => onChangeWallHeight(Math.max(0.3, Number(e.target.value) || 2.5))}
                    className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] px-2 font-mono text-xs text-slate-100"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-slate-400">Wall Thick (m)</span>
                  <input
                    type="number"
                    min={0.1}
                    max={4}
                    step={0.05}
                    value={wallThickness}
                    onChange={(e) =>
                      onChangeWallThickness(Math.max(0.1, Number(e.target.value) || 0.35))
                    }
                    className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] px-2 font-mono text-xs text-slate-100"
                  />
                </label>
              </div>
            </div>

            {/* Cosmetic Props */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-amber-400" />
                  Cosmetic Props
                </h3>
                <span className="text-[10px] text-slate-500">Click map to place</span>
              </div>
              <div className="space-y-1">
                {COSMETIC_PROP_PRESETS.map((prop) => {
                  const active = tool === 'prop' && selectedPropId === prop.id;
                  return (
                    <button
                      key={prop.id}
                      type="button"
                      onClick={() => {
                        onSelectPropId(prop.id);
                        onSelectTool('prop');
                      }}
                      className={`flex w-full items-center justify-between rounded border px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-blue-400 bg-blue-950/40 text-white'
                          : 'border-[#232c3d] bg-[#0b0f17] text-slate-300 hover:bg-[#141b28]'
                      }`}
                    >
                      <div>
                        <div className="text-[11px] font-medium">{prop.label}</div>
                        <div className="text-[10px] text-slate-400">{prop.description}</div>
                      </div>
                      <span
                        className="h-4 w-4 rounded border border-white/20 shrink-0"
                        style={{ backgroundColor: prop.defaultColorHex }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Lights & Spawn */}
            <div className="rounded-md border border-[#242e40] bg-[#0b0f17] p-2.5 space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Lightbulb className="h-3 w-3 text-amber-400" />
                Lights & Robot Spawn
              </h3>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => addWorldLight('point')}
                  className="rounded border border-[#2a3346] bg-[#121824] py-1 text-[10px] font-medium text-slate-200 hover:bg-[#1c2436] cursor-pointer"
                >
                  + Point
                </button>
                <button
                  type="button"
                  onClick={() => addWorldLight('spot')}
                  className="rounded border border-[#2a3346] bg-[#121824] py-1 text-[10px] font-medium text-slate-200 hover:bg-[#1c2436] cursor-pointer"
                >
                  + Spot
                </button>
                <button
                  type="button"
                  onClick={() => addWorldLight('directional')}
                  className="rounded border border-[#2a3346] bg-[#121824] py-1 text-[10px] font-medium text-slate-200 hover:bg-[#1c2436] cursor-pointer"
                >
                  + Sun
                </button>
              </div>
              <button
                type="button"
                onClick={() => onSelectTool('spawn')}
                className={`flex w-full items-center justify-center gap-1.5 rounded border py-1.5 text-[11px] font-medium cursor-pointer ${
                  tool === 'spawn'
                    ? 'border-sky-400 bg-sky-600 text-white'
                    : 'border-[#2a3346] bg-[#121824] text-slate-200 hover:bg-[#1c2436]'
                }`}
              >
                <MapPin className="h-3.5 w-3.5" />
                Move Robot Spawn Pose
              </button>
            </div>
          </>
        )}

        {activeTab === 'atmosphere' && (
          <>
            {/* Sky & Atmosphere Cosmetic Presets */}
            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Sky & Lighting Mood
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                {SKY_PRESET_LIST.map((sky) => {
                  const active = cosmetics.skyPreset === sky.id;
                  return (
                    <button
                      key={sky.id}
                      type="button"
                      data-testid={`sky-preset-${sky.id}`}
                      onClick={() =>
                        updateWorldCosmetics((c) => {
                          c.skyPreset = sky.id;
                        })
                      }
                      className={`overflow-hidden rounded-md border text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-amber-400 ring-1 ring-amber-400/60 bg-[#1a2232]'
                          : 'border-[#242e40] bg-[#0b0f17] hover:border-slate-500'
                      }`}
                    >
                      <div className="h-9 w-full" style={{ background: sky.swatchGradient }} />
                      <div className="px-2 py-1 text-[11px] font-medium text-slate-200">
                        {sky.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sun & Fog Controls */}
            <div className="rounded-md border border-[#242e40] bg-[#0b0f17] p-2.5 space-y-2.5 text-[11px]">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-medium text-slate-200">Atmospheric Horizon Fog</span>
                <input
                  type="checkbox"
                  checked={cosmetics.fogEnabled}
                  onChange={(e) =>
                    updateWorldCosmetics((c) => {
                      c.fogEnabled = e.target.checked;
                    })
                  }
                  className="accent-blue-500"
                />
              </label>

              {cosmetics.fogEnabled && (
                <label className="block space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Fog Density</span>
                    <span className="font-mono">{(cosmetics.fogDensity * 1000).toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.0005}
                    max={0.025}
                    step={0.0005}
                    aria-label="Fog density"
                    value={cosmetics.fogDensity}
                    onChange={(e) =>
                      updateWorldCosmetics((c) => {
                        c.fogDensity = Number(e.target.value);
                      })
                    }
                    className="w-full accent-blue-500"
                  />
                </label>
              )}

              <label className="block space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Sun Elevation</span>
                  <span className="font-mono">{Math.round(cosmetics.sunElevationDeg ?? 48)}°</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={85}
                  step={1}
                  aria-label="Sun elevation degrees"
                  value={cosmetics.sunElevationDeg ?? 48}
                  onChange={(e) =>
                    updateWorldCosmetics((c) => {
                      c.sunElevationDeg = Number(e.target.value);
                    })
                  }
                  className="w-full accent-amber-400"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Sun Azimuth</span>
                  <span className="font-mono">{Math.round(cosmetics.sunAzimuthDeg ?? 38)}°</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={5}
                  aria-label="Sun azimuth degrees"
                  value={cosmetics.sunAzimuthDeg ?? 38}
                  onChange={(e) =>
                    updateWorldCosmetics((c) => {
                      c.sunAzimuthDeg = Number(e.target.value);
                    })
                  }
                  className="w-full accent-amber-400"
                />
              </label>
            </div>

            {/* Land Size, Satellite & DEM Elevation */}
            <div className="rounded-md border border-[#242e40] bg-[#0b0f17] p-2.5 space-y-2.5 text-[11px]">
              <h3 className="text-[11px] font-semibold text-slate-100 flex items-center gap-1.5">
                <Mountain className="h-3.5 w-3.5 text-emerald-400" />
                Terrain & Map Extent
              </h3>

              <label className="block space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Map Land Size</span>
                  <span className="font-mono">
                    {Math.round(mapBg.landSizeMeters ?? 100)} m × {Math.round(mapBg.landSizeMeters ?? 100)} m
                  </span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={400}
                  step={10}
                  aria-label="Map land size meters"
                  value={mapBg.landSizeMeters ?? 100}
                  onChange={(e) => {
                    const size = Number(e.target.value);
                    updateWorld((w) => {
                      if (!w.mapBackground) w.mapBackground = { ...DEFAULT_MAP_BACKGROUND };
                      w.mapBackground.landSizeMeters = size;
                      w.ground.size = [size, size];
                    });
                  }}
                  className="w-full accent-emerald-500"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-slate-300">Satellite Base Layer</span>
                <input
                  type="checkbox"
                  checked={Boolean(mapBg.enabled)}
                  onChange={(e) =>
                    updateWorld((w) => {
                      if (!w.mapBackground) w.mapBackground = { ...DEFAULT_MAP_BACKGROUND };
                      w.mapBackground.enabled = e.target.checked;
                    })
                  }
                  className="accent-emerald-500"
                />
              </label>

              {mapBg.enabled && (
                <div className="space-y-2 pt-1 border-t border-[#1c2434]">
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    <label className="space-y-0.5">
                      <span className="text-slate-400">Latitude</span>
                      <input
                        type="number"
                        step={0.0005}
                        value={mapBg.latitude}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          updateWorld((w) => {
                            if (!w.mapBackground) w.mapBackground = { ...DEFAULT_MAP_BACKGROUND };
                            w.mapBackground.latitude = Math.max(-85, Math.min(85, v));
                          });
                        }}
                        className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] px-1.5 font-mono text-[11px] text-slate-100"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-slate-400">Longitude</span>
                      <input
                        type="number"
                        step={0.0005}
                        value={mapBg.longitude}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          updateWorld((w) => {
                            if (!w.mapBackground) w.mapBackground = { ...DEFAULT_MAP_BACKGROUND };
                            w.mapBackground.longitude = Math.max(-180, Math.min(180, v));
                          });
                        }}
                        className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] px-1.5 font-mono text-[11px] text-slate-100"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={demLoading}
                      onClick={() => void handleFetchDem()}
                      className="rounded border border-emerald-700/60 bg-emerald-950/40 px-2 py-1 text-[10px] font-medium text-emerald-200 hover:bg-emerald-900/50 disabled:opacity-50 cursor-pointer"
                    >
                      {demLoading ? 'Loading DEM...' : 'Fetch 3D Elevation'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTerrainElevation(undefined, undefined, 0)}
                      className="rounded border border-[#2a3346] bg-[#121824] px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-[#1c2436] cursor-pointer"
                    >
                      Flatten Terrain
                    </button>
                  </div>

                  {mapBg.elevationGrid && mapBg.elevationGrid.length > 0 && (
                    <label className="block space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>Elevation Relief Scale</span>
                        <span className="font-mono">{(mapBg.elevationScale ?? 1).toFixed(1)}×</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={5}
                        step={0.1}
                        aria-label="Elevation relief scale"
                        value={mapBg.elevationScale ?? 1}
                        onChange={(e) =>
                          updateWorld((w) => {
                            if (w.mapBackground) {
                              w.mapBackground.elevationScale = Number(e.target.value);
                            }
                          })
                        }
                        className="w-full accent-emerald-500"
                      />
                    </label>
                  )}
                </div>
              )}

              {/* Base Ground Reset to Satellite / Grass */}
              <div className="pt-1 border-t border-[#1c2434] flex items-center justify-between text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  Base:{' '}
                  <strong className="text-slate-200">
                    {project.world.ground.textureId
                      ? 'Custom Image'
                      : cosmetics.groundBasePresetId
                        ? cosmetics.groundBasePresetId.replace('_', ' ')
                        : mapBg.enabled
                          ? 'Satellite'
                          : 'Lush Grass'}
                  </strong>
                </span>
                {(project.world.ground.textureId || cosmetics.groundBasePresetId) && (
                  <button
                    type="button"
                    onClick={() => {
                      updateWorld((w) => {
                        delete w.ground.textureId;
                      });
                      updateWorldCosmetics((c) => {
                        c.groundBasePresetId = undefined;
                      });
                    }}
                    className="text-sky-400 hover:underline cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
