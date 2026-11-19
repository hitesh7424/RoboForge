import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Box,
  Copy,
  Download,
  Eye,
  EyeOff,
  Globe,
  ImagePlus,
  Layers,
  Lightbulb,
  Sparkles,
  Star,
  Trash2,
  Trees,
  Upload,
} from 'lucide-react';
import type { SurfaceZone } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import {
  BUILTIN_TEXTURE_PRESETS,
  getPresetPreviewDataUrl,
  getTexturePresetById,
  materializePresetAsTextureAsset,
} from '@/core/texturePresets';
import { downloadFullMapAreaPng } from '@/core/worldTextureCompositor';
import {
  computeZoneAreaMeters2,
  createRectZonePoints,
  DEFAULT_WORLD_COSMETICS,
} from '@/core/worldZones';
import { hexToRgba, readFileAsTextureAsset, rgbaToHex } from '@/worldStudio/types';

const GITHUB_REPO_URL =
  import.meta.env.VITE_GITHUB_URL || 'https://github.com/roboforge/roboforge';

export function WorldStudioInspector() {
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const select = useRoboForgeStore((s) => s.select);
  const addTexture = useRoboForgeStore((s) => s.addTexture);
  const addSurfaceZone = useRoboForgeStore((s) => s.addSurfaceZone);
  const updateSurfaceZone = useRoboForgeStore((s) => s.updateSurfaceZone);
  const deleteSurfaceZone = useRoboForgeStore((s) => s.deleteSurfaceZone);
  const duplicateSurfaceZone = useRoboForgeStore((s) => s.duplicateSurfaceZone);
  const reorderSurfaceZone = useRoboForgeStore((s) => s.reorderSurfaceZone);
  const updateWorldObject = useRoboForgeStore((s) => s.updateWorldObject);
  const deleteWorldObject = useRoboForgeStore((s) => s.deleteWorldObject);
  const updateWorldLight = useRoboForgeStore((s) => s.updateWorldLight);
  const deleteWorldLight = useRoboForgeStore((s) => s.deleteWorldLight);
  const updateWorld = useRoboForgeStore((s) => s.updateWorld);
  const updateWorldCosmetics = useRoboForgeStore((s) => s.updateWorldCosmetics);
  const addLog = useRoboForgeStore((s) => s.addLog);

  const inlineUploadRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<'zone' | 'object' | 'ground' | 'ground_1to1'>('zone');
  const [downloadingMapPng, setDownloadingMapPng] = useState(false);

  const zones = project.world.surfaceZones ?? [];
  const objects = project.world.objects;
  const lights = project.world.lights;
  const cosmetics = { ...DEFAULT_WORLD_COSMETICS, ...project.world.cosmetics };

  const userTextures = useMemo(
    () => project.textures.filter((t) => !t.id.startsWith('preset_')),
    [project.textures],
  );

  const selectedZone =
    selection?.type === 'surfaceZone'
      ? zones.find((z) => z.id === selection.id) ?? null
      : null;
  const selectedObj =
    selection?.type === 'worldObject'
      ? objects.find((o) => o.id === selection.id) ?? null
      : null;
  const selectedLight =
    selection?.type === 'worldLight'
      ? lights.find((l) => l.id === selection.id) ?? null
      : null;

  const ensurePresetAssetId = (presetId: string): string | undefined => {
    const existing = useRoboForgeStore
      .getState()
      .project.textures.find((t) => t.id === `preset_${presetId}`);
    if (existing) return existing.id;
    const asset = materializePresetAsTextureAsset(presetId, 256);
    if (!asset) return undefined;
    addTexture(asset);
    return asset.id;
  };

  const handleInlineUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const asset = await readFileAsTextureAsset(
        file,
        useRoboForgeStore.getState().project.textures,
      );
      addTexture(asset);
      if (uploadTargetRef.current === 'zone' && selectedZone) {
        updateSurfaceZone(selectedZone.id, (z) => {
          z.textureSource = 'custom';
          z.textureId = asset.id;
        });
      } else if (uploadTargetRef.current === 'object' && selectedObj) {
        updateWorldObject(selectedObj.id, (o) => {
          if (o.source.type === 'primitive') {
            o.source.material.textureId = asset.id;
            o.source.material.textureRepeat = o.source.material.textureRepeat ?? [2, 2];
            o.source.material.rgba = [1, 1, 1, o.source.material.rgba[3]];
          }
        });
      } else if (uploadTargetRef.current === 'ground' || uploadTargetRef.current === 'ground_1to1') {
        const isOneToOne = uploadTargetRef.current === 'ground_1to1';
        updateWorld((w) => {
          w.ground.textureId = asset.id;
          w.ground.textureRepeat = isOneToOne ? [1, 1] : (w.ground.textureRepeat ?? [10, 10]);
        });
        updateWorldCosmetics((c) => {
          c.groundBasePresetId = undefined;
        });
      }
    } catch (err) {
      addLog('error', err instanceof Error ? err.message : 'Failed to upload custom texture.');
    }
  };

  const handleDownloadMapPng = async () => {
    setDownloadingMapPng(true);
    try {
      const res = await downloadFullMapAreaPng(project.world, project.textures, 'original');
      addLog(
        'info',
        `Downloaded full-quality map tile "${res.filename}" (${res.widthPx}×${res.heightPx}px covering ${res.landWidth}m×${res.landHeight}m).`,
      );
    } catch (err) {
      addLog(
        'error',
        `Map PNG download failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    } finally {
      setDownloadingMapPng(false);
    }
  };

  const seedMultiTextureDemo = () => {
    updateWorldCosmetics((c) => {
      c.groundBasePresetId = 'grass_lush';
      c.groundBaseRepeat = [14, 14];
      c.skyPreset = 'daylight';
    });
    // Asphalt road crossing the map
    addSurfaceZone({
      name: 'main_asphalt_road',
      kind: 'path',
      points: [
        [-42, -8],
        [-12, -8],
        [8, 6],
        [42, 6],
      ],
      strokeWidth: 7,
      textureSource: 'preset',
      presetId: 'asphalt_road',
      tint: [1, 1, 1, 1],
      repeat: [12, 12],
      opacity: 1,
      visible: true,
      feather: 0,
    });
    // Cobblestone central courtyard plaza
    addSurfaceZone({
      name: 'central_cobble_plaza',
      kind: 'rect',
      points: createRectZonePoints(-14, 4, 4, 20),
      textureSource: 'preset',
      presetId: 'cobblestone',
      tint: [1, 1, 1, 1],
      repeat: [10, 10],
      opacity: 1,
      visible: true,
      feather: 0,
    });
    // Desert sand / gravel test pit
    addSurfaceZone({
      name: 'sand_test_patch',
      kind: 'circle',
      points: [[18, -14]],
      radius: 9,
      textureSource: 'preset',
      presetId: 'desert_sand',
      tint: [1, 1, 1, 1],
      repeat: [10, 10],
      opacity: 0.95,
      visible: true,
      feather: 0.4,
    });
    // Water feature pond
    addSurfaceZone({
      name: 'park_pond',
      kind: 'circle',
      points: [[-22, 16]],
      radius: 7,
      textureSource: 'preset',
      presetId: 'water_pond',
      tint: [1, 1, 1, 1],
      repeat: [6, 6],
      opacity: 0.92,
      visible: true,
      feather: 0.3,
    });
  };

  const renderZoneSwatch = (zone: SurfaceZone) => {
    if (zone.textureSource === 'custom' && zone.textureId) {
      const tex = project.textures.find((t) => t.id === zone.textureId);
      if (tex) {
        return (
          <img
            src={`data:${tex.mimeType};base64,${tex.dataBase64}`}
            alt={tex.name}
            className="h-5 w-5 rounded border border-white/20 object-cover shrink-0"
          />
        );
      }
    }
    if (zone.textureSource === 'preset' && zone.presetId) {
      const thumb = getPresetPreviewDataUrl(zone.presetId, 48);
      const preset = getTexturePresetById(zone.presetId);
      return (
        <span
          className="h-5 w-5 rounded border border-white/20 bg-cover bg-center shrink-0"
          style={
            thumb
              ? { backgroundImage: `url(${thumb})` }
              : { backgroundColor: preset?.swatchHex ?? '#64748b' }
          }
        />
      );
    }
    return (
      <span
        className="h-5 w-5 rounded border border-white/20 shrink-0"
        style={{ backgroundColor: rgbaToHex(zone.tint) }}
      />
    );
  };

  return (
    <aside
      aria-label="World Studio Layers and Inspector"
      className="flex h-full w-72 shrink-0 flex-col border-l border-[#232b3b] bg-[#10141d] text-slate-200 select-none"
    >
      <input
        ref={inlineUploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        aria-label="Upload custom texture from inspector"
        className="hidden"
        onChange={handleInlineUpload}
      />

      {/* Top Half: Layers Hierarchy */}
      <div className="flex max-h-[44%] min-h-[160px] flex-col border-b border-[#232b3b]">
        <div className="flex items-center justify-between border-b border-[#1d2433] bg-[#0c1018] px-3 py-2 shrink-0">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
            <Layers className="h-3.5 w-3.5 text-emerald-400" />
            Map Layers
          </span>
          <span className="font-mono text-[10px] text-slate-400">
            {zones.length} zones · {objects.length} objs
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* Base Ground Layer */}
          <button
            type="button"
            onClick={() => select({ type: 'world' })}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors cursor-pointer ${
              selection?.type === 'world' || !selection
                ? 'bg-[#1b273a] text-white'
                : 'text-slate-300 hover:bg-[#161d2b]'
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <Globe className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span className="truncate font-medium">Base Ground & Sky</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">base</span>
          </button>

          {/* Surface Texture Zones (displayed topmost first) */}
          {zones.length > 0 && (
            <div className="pt-1">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Textured Map Zones
              </div>
              {[...zones].reverse().map((zone, revIdx) => {
                const realIdx = zones.length - 1 - revIdx;
                const active = selection?.type === 'surfaceZone' && selection.id === zone.id;
                return (
                  <div
                    key={zone.id}
                    data-testid={`zone-layer-${zone.name}`}
                    className={`group flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
                      active ? 'bg-[#1a2940] text-white' : 'text-slate-300 hover:bg-[#161d2b]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => select({ type: 'surfaceZone', id: zone.id })}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                    >
                      {renderZoneSwatch(zone)}
                      <span className="truncate text-[11px] font-medium">{zone.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Toggle visibility for ${zone.name}`}
                      onClick={() =>
                        updateSurfaceZone(zone.id, (z) => {
                          z.visible = !z.visible;
                        })
                      }
                      className="p-0.5 text-slate-400 hover:text-slate-100 cursor-pointer"
                    >
                      {zone.visible ? (
                        <Eye className="h-3 w-3" />
                      ) : (
                        <EyeOff className="h-3 w-3 text-slate-600" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${zone.name} up`}
                      disabled={realIdx === zones.length - 1}
                      onClick={() => reorderSurfaceZone(zone.id, 'up')}
                      className="p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${zone.name} down`}
                      disabled={realIdx === 0}
                      onClick={() => reorderSurfaceZone(zone.id, 'down')}
                      className="p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete zone ${zone.name}`}
                      onClick={() => deleteSurfaceZone(zone.id)}
                      className="p-0.5 text-slate-400 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* World Objects */}
          {objects.length > 0 && (
            <div className="pt-1">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Scenery & Props ({objects.length})
              </div>
              {objects.map((obj) => {
                const active = selection?.type === 'worldObject' && selection.id === obj.id;
                return (
                  <div
                    key={obj.id}
                    className={`flex items-center justify-between gap-1 rounded px-2 py-1 text-xs transition-colors ${
                      active ? 'bg-[#1a2940] text-white' : 'text-slate-300 hover:bg-[#161d2b]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => select({ type: 'worldObject', id: obj.id })}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                    >
                      {obj.source.type === 'tree' ? (
                        <Trees className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Box className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                      )}
                      <span className="truncate text-[11px]">{obj.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete object ${obj.name}`}
                      onClick={() => deleteWorldObject(obj.id)}
                      className="p-0.5 text-slate-400 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* World Lights */}
          {lights.length > 0 && (
            <div className="pt-1">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Lights ({lights.length})
              </div>
              {lights.map((l) => {
                const active = selection?.type === 'worldLight' && selection.id === l.id;
                return (
                  <div
                    key={l.id}
                    className={`flex items-center justify-between gap-1 rounded px-2 py-1 text-xs transition-colors ${
                      active ? 'bg-[#1a2940] text-white' : 'text-slate-300 hover:bg-[#161d2b]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => select({ type: 'worldLight', id: l.id })}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                    >
                      <Lightbulb className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <span className="truncate text-[11px]">{l.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete light ${l.name}`}
                      onClick={() => deleteWorldLight(l.id)}
                      className="p-0.5 text-slate-400 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Half: Context-Aware Cosmetic Properties Inspector */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {selectedZone && (
          <>
            <div className="flex items-center justify-between border-b border-[#222938] pb-2">
              <div>
                <div className="text-xs font-semibold text-slate-100">Surface Zone</div>
                <div className="text-[10px] font-mono text-slate-400">
                  {selectedZone.kind} · ~{computeZoneAreaMeters2(selectedZone).toFixed(1)} m²
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Duplicate selected zone"
                  title="Duplicate Zone"
                  onClick={() => duplicateSurfaceZone(selectedZone.id)}
                  className="rounded border border-[#2a3346] bg-[#141a26] p-1 text-slate-300 hover:text-white cursor-pointer"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Delete selected zone"
                  title="Delete Zone"
                  onClick={() => deleteSurfaceZone(selectedZone.id)}
                  className="rounded border border-[#2a3346] bg-[#141a26] p-1 text-slate-300 hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">Zone Name</span>
              <input
                type="text"
                aria-label="Zone name"
                value={selectedZone.name}
                onChange={(e) =>
                  updateSurfaceZone(selectedZone.id, (z) => {
                    z.name = e.target.value;
                  })
                }
                className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-2 font-mono text-xs text-slate-100"
              />
            </label>

            {/* Texture Source Selector */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-slate-400">Surface Material Source</span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'preset', label: 'Preset' },
                    { id: 'custom', label: 'Custom' },
                    { id: 'solid', label: 'Color' },
                  ] as const
                ).map((src) => (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() =>
                      updateSurfaceZone(selectedZone.id, (z) => {
                        z.textureSource = src.id;
                        if (src.id === 'preset' && !z.presetId) {
                          z.presetId = 'asphalt_road';
                        }
                      })
                    }
                    className={`rounded border py-1 text-[11px] font-medium cursor-pointer ${
                      selectedZone.textureSource === src.id
                        ? 'border-emerald-500 bg-emerald-600/25 text-emerald-200'
                        : 'border-[#263044] bg-[#0b0f17] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {src.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedZone.textureSource === 'preset' && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-slate-400">Built-In Texture Preset</span>
                <select
                  aria-label="Zone texture preset"
                  value={selectedZone.presetId ?? 'asphalt_road'}
                  onChange={(e) =>
                    updateSurfaceZone(selectedZone.id, (z) => {
                      z.presetId = e.target.value;
                    })
                  }
                  className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-2 text-xs text-slate-100"
                >
                  {BUILTIN_TEXTURE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.category})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedZone.textureSource === 'custom' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">Uploaded Image</span>
                  <button
                    type="button"
                    onClick={() => {
                      uploadTargetRef.current = 'zone';
                      inlineUploadRef.current?.click();
                    }}
                    className="inline-flex items-center gap-1 text-[10px] text-emerald-400 hover:underline cursor-pointer"
                  >
                    <ImagePlus className="h-3 w-3" />
                    Upload New
                  </button>
                </div>
                <select
                  aria-label="Zone custom texture"
                  value={selectedZone.textureId ?? ''}
                  onChange={(e) =>
                    updateSurfaceZone(selectedZone.id, (z) => {
                      z.textureId = e.target.value || undefined;
                    })
                  }
                  className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-2 font-mono text-[11px] text-slate-100"
                >
                  <option value="">Select custom image...</option>
                  {userTextures.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}.{t.format}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* UV Repeat, Tint, Opacity, Feather, Kind-specific params */}
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] text-slate-400">Repeat U</span>
                <input
                  type="number"
                  min={0.5}
                  max={500}
                  step={1}
                  value={selectedZone.repeat[0]}
                  onChange={(e) =>
                    updateSurfaceZone(selectedZone.id, (z) => {
                      z.repeat[0] = Math.max(0.5, Number(e.target.value) || 1);
                    })
                  }
                  className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-2 font-mono text-xs text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-slate-400">Repeat V</span>
                <input
                  type="number"
                  min={0.5}
                  max={500}
                  step={1}
                  value={selectedZone.repeat[1]}
                  onChange={(e) =>
                    updateSurfaceZone(selectedZone.id, (z) => {
                      z.repeat[1] = Math.max(0.5, Number(e.target.value) || 1);
                    })
                  }
                  className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-2 font-mono text-xs text-slate-100"
                />
              </label>
            </div>

            {selectedZone.kind === 'path' && (
              <label className="block space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Road Width</span>
                  <span className="font-mono">{(selectedZone.strokeWidth ?? 4).toFixed(1)} m</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={25}
                  step={0.5}
                  value={selectedZone.strokeWidth ?? 4}
                  onChange={(e) =>
                    updateSurfaceZone(selectedZone.id, (z) => {
                      z.strokeWidth = Number(e.target.value);
                    })
                  }
                  className="w-full accent-emerald-500"
                />
              </label>
            )}

            {selectedZone.kind === 'circle' && (
              <label className="block space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Circle Radius</span>
                  <span className="font-mono">{(selectedZone.radius ?? 5).toFixed(1)} m</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={45}
                  step={0.5}
                  value={selectedZone.radius ?? 5}
                  onChange={(e) =>
                    updateSurfaceZone(selectedZone.id, (z) => {
                      z.radius = Number(e.target.value);
                    })
                  }
                  className="w-full accent-emerald-500"
                />
              </label>
            )}

            <label className="block space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Blend Opacity</span>
                <span className="font-mono">{Math.round(selectedZone.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={selectedZone.opacity}
                onChange={(e) =>
                  updateSurfaceZone(selectedZone.id, (z) => {
                    z.opacity = Number(e.target.value);
                  })
                }
                className="w-full accent-emerald-500"
              />
            </label>

            <label className="block space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Edge Feather (Softness)</span>
                <span className="font-mono">{(selectedZone.feather ?? 0).toFixed(1)} m</span>
              </div>
              <input
                type="range"
                min={0}
                max={2.5}
                step={0.1}
                value={selectedZone.feather ?? 0}
                onChange={(e) =>
                  updateSurfaceZone(selectedZone.id, (z) => {
                    z.feather = Number(e.target.value);
                  })
                }
                className="w-full accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[10px] text-slate-400">Color Tint</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  aria-label="Zone tint color"
                  value={rgbaToHex(selectedZone.tint)}
                  onChange={(e) =>
                    updateSurfaceZone(selectedZone.id, (z) => {
                      z.tint = hexToRgba(e.target.value, 1);
                    })
                  }
                  className="h-6 w-10 rounded border border-[#2a3346] bg-[#0b0f17] p-0.5 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() =>
                    updateSurfaceZone(selectedZone.id, (z) => {
                      z.tint = [1, 1, 1, 1];
                    })
                  }
                  className="rounded border border-[#2a3346] bg-[#141a26] px-1.5 py-0.5 text-[10px] text-slate-300 hover:text-white cursor-pointer"
                >
                  Reset
                </button>
              </div>
            </label>
          </>
        )}

        {selectedObj && (
          <>
            <div className="flex items-center justify-between border-b border-[#222938] pb-2">
              <div>
                <div className="text-xs font-semibold text-slate-100">World Object</div>
                <div className="text-[10px] font-mono text-slate-400">{selectedObj.source.type}</div>
              </div>
              <button
                type="button"
                aria-label="Delete selected world object"
                onClick={() => deleteWorldObject(selectedObj.id)}
                className="rounded border border-[#2a3346] bg-[#141a26] p-1 text-slate-300 hover:text-red-400 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">Name</span>
              <input
                type="text"
                value={selectedObj.name}
                onChange={(e) =>
                  updateWorldObject(selectedObj.id, (o) => {
                    o.name = e.target.value;
                  })
                }
                className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-2 font-mono text-xs text-slate-100"
              />
            </label>

            <div className="grid grid-cols-3 gap-1.5 text-[10px]">
              {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                <label key={axis} className="space-y-0.5">
                  <span className="text-slate-400">{axis} (m)</span>
                  <input
                    type="number"
                    step={0.25}
                    value={selectedObj.pose.xyz[idx]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      updateWorldObject(selectedObj.id, (o) => {
                        o.pose.xyz[idx] = v;
                      });
                    }}
                    className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-1.5 font-mono text-[11px] text-slate-100"
                  />
                </label>
              ))}
            </div>

            {selectedObj.source.type === 'primitive' && (
              <div className="space-y-2.5 pt-1 border-t border-[#1e2636]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">Object Color</span>
                  <input
                    type="color"
                    aria-label="Object surface color"
                    value={rgbaToHex(selectedObj.source.material.rgba)}
                    onChange={(e) =>
                      updateWorldObject(selectedObj.id, (o) => {
                        if (o.source.type === 'primitive') {
                          o.source.material.rgba = hexToRgba(e.target.value, o.source.material.rgba[3]);
                        }
                      })
                    }
                    className="h-6 w-12 rounded border border-[#2a3346] bg-[#0b0f17] p-0.5 cursor-pointer"
                  />
                </div>

                {/* Inline Object Texture Assignment (Built-In Presets + Custom Uploads) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">Surface Texture</span>
                    <button
                      type="button"
                      onClick={() => {
                        uploadTargetRef.current = 'object';
                        inlineUploadRef.current?.click();
                      }}
                      className="inline-flex items-center gap-1 text-[10px] text-emerald-400 hover:underline cursor-pointer"
                    >
                      <ImagePlus className="h-3 w-3" />
                      Upload
                    </button>
                  </div>
                  <select
                    aria-label="Assign texture to object"
                    value={selectedObj.source.material.textureId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      let resolvedId: string | undefined = val || undefined;
                      if (val.startsWith('__preset__:')) {
                        resolvedId = ensurePresetAssetId(val.replace('__preset__:', ''));
                      }
                      updateWorldObject(selectedObj.id, (o) => {
                        if (o.source.type === 'primitive') {
                          o.source.material.textureId = resolvedId;
                          if (resolvedId) {
                            o.source.material.textureRepeat = o.source.material.textureRepeat ?? [2, 2];
                            o.source.material.rgba = [1, 1, 1, o.source.material.rgba[3]];
                          }
                        }
                      });
                    }}
                    className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-2 text-xs text-slate-100"
                  >
                    <option value="">None (solid color)</option>
                    {userTextures.length > 0 && (
                      <optgroup label="Custom Uploads">
                        {userTextures.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}.{t.format}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Built-In Presets">
                      {BUILTIN_TEXTURE_PRESETS.map((p) => {
                        const existing = project.textures.find((t) => t.id === `preset_${p.id}`);
                        return (
                          <option key={p.id} value={existing ? existing.id : `__preset__:${p.id}`}>
                            {p.name}
                          </option>
                        );
                      })}
                    </optgroup>
                  </select>
                </div>
              </div>
            )}

            {selectedObj.source.type === 'tree' && (
              <div className="space-y-2 pt-1 border-t border-[#1e2636]">
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-slate-400">Canopy R (m)</span>
                    <input
                      type="number"
                      min={0.3}
                      max={15}
                      step={0.2}
                      value={selectedObj.source.canopyRadius}
                      onChange={(e) =>
                        updateWorldObject(selectedObj.id, (o) => {
                          if (o.source.type === 'tree') {
                            o.source.canopyRadius = Math.max(0.3, Number(e.target.value) || 1.4);
                          }
                        })
                      }
                      className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-2 font-mono text-xs text-slate-100"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-slate-400">Trunk H (m)</span>
                    <input
                      type="number"
                      min={0.5}
                      max={20}
                      step={0.25}
                      value={selectedObj.source.trunkHeight}
                      onChange={(e) =>
                        updateWorldObject(selectedObj.id, (o) => {
                          if (o.source.type === 'tree') {
                            o.source.trunkHeight = Math.max(0.5, Number(e.target.value) || 2.2);
                          }
                        })
                      }
                      className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-2 font-mono text-xs text-slate-100"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">Foliage Color</span>
                  <input
                    type="color"
                    aria-label="Tree foliage color"
                    value={rgbaToHex(selectedObj.source.foliageColor ?? [0.22, 0.52, 0.24, 1])}
                    onChange={(e) =>
                      updateWorldObject(selectedObj.id, (o) => {
                        if (o.source.type === 'tree') {
                          o.source.foliageColor = hexToRgba(e.target.value, 1);
                        }
                      })
                    }
                    className="h-6 w-12 rounded border border-[#2a3346] bg-[#0b0f17] p-0.5 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {selectedLight && (
          <>
            <div className="flex items-center justify-between border-b border-[#222938] pb-2">
              <div className="text-xs font-semibold text-slate-100">Light Source</div>
              <button
                type="button"
                aria-label="Delete selected light"
                onClick={() => deleteWorldLight(selectedLight.id)}
                className="rounded border border-[#2a3346] bg-[#141a26] p-1 text-slate-300 hover:text-red-400 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">Intensity</span>
              <input
                type="range"
                min={0.1}
                max={4}
                step={0.1}
                value={selectedLight.intensity}
                onChange={(e) =>
                  updateWorldLight(selectedLight.id, (l) => {
                    l.intensity = Number(e.target.value);
                  })
                }
                className="w-full accent-amber-400"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400">Light Color</span>
              <input
                type="color"
                value={rgbaToHex([...selectedLight.diffuse, 1])}
                onChange={(e) => {
                  const [r, g, b] = hexToRgba(e.target.value, 1);
                  updateWorldLight(selectedLight.id, (l) => {
                    l.diffuse = [r, g, b];
                  });
                }}
                className="h-6 w-12 rounded border border-[#2a3346] bg-[#0b0f17] p-0.5 cursor-pointer"
              />
            </label>
          </>
        )}

        {!selectedZone && !selectedObj && !selectedLight && (
          <div className="space-y-3">
            <div className="border-b border-[#222938] pb-2">
              <div className="text-xs font-semibold text-slate-100">Base Ground & World</div>
              <div className="text-[10px] text-slate-400">
                Paint different textures onto regions of your map or set the base surface below.
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] text-slate-400">Base Ground Texture Preset</span>
              <select
                aria-label="Base ground texture preset"
                value={cosmetics.groundBasePresetId ?? ''}
                onChange={(e) => {
                  const val = e.target.value || undefined;
                  updateWorld((w) => {
                    delete w.ground.textureId;
                  });
                  updateWorldCosmetics((c) => {
                    c.groundBasePresetId = val;
                  });
                }}
                className="h-7 w-full rounded border border-[#2a3346] bg-[#0b0f17] px-2 text-xs text-slate-100"
              >
                <option value="">Default (Satellite / Grass)</option>
                {BUILTIN_TEXTURE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                uploadTargetRef.current = 'ground';
                inlineUploadRef.current?.click();
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-[#2a3346] bg-[#141b28] py-1.5 text-[11px] font-medium text-slate-200 hover:bg-[#1e283b] cursor-pointer"
            >
              <ImagePlus className="h-3.5 w-3.5 text-emerald-400" />
              Upload Custom Base Ground Image
            </button>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={downloadingMapPng}
                data-testid="inspector-download-map-png"
                onClick={() => void handleDownloadMapPng()}
                className="flex items-center justify-center gap-1 rounded border border-emerald-700/60 bg-emerald-950/35 py-1.5 text-[10px] font-medium text-emerald-200 hover:bg-emerald-900/50 disabled:opacity-50 cursor-pointer"
              >
                <Download className="h-3 w-3 shrink-0" />
                {downloadingMapPng ? 'Saving...' : 'Download Map PNG'}
              </button>
              <button
                type="button"
                data-testid="inspector-upload-edited-map"
                onClick={() => {
                  uploadTargetRef.current = 'ground_1to1';
                  inlineUploadRef.current?.click();
                }}
                className="flex items-center justify-center gap-1 rounded border border-[#2a3346] bg-[#141b28] py-1.5 text-[10px] font-medium text-slate-200 hover:bg-[#1e283b] cursor-pointer"
              >
                <Upload className="h-3 w-3 shrink-0 text-sky-400" />
                Load Edited (1:1)
              </button>
            </div>

            <div className="rounded-md border border-[#243044] bg-[#0b0f17] p-2.5 space-y-2">
              <div className="text-[11px] font-medium text-slate-200 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                Quick Multi-Texture Starter
              </div>
              <p className="text-[10px] leading-relaxed text-slate-400">
                Populate a grass base with an asphalt road, cobblestone plaza, sand pit, and pond—then customize every zone.
              </p>
              <button
                type="button"
                onClick={seedMultiTextureDemo}
                className="w-full rounded bg-emerald-600 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-500 cursor-pointer"
              >
                Create Multi-Texture Park Layout
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Subtle Non-Intrusive Docked Footer */}
      <div className="flex items-center justify-center border-t border-[#1d2433] bg-[#0c1018] px-3 py-1.5 shrink-0">
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="studio-github-star-link"
          title="Visit GitHub to star RoboForge"
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-slate-400 hover:bg-[#161e2e] hover:text-slate-100 transition-colors"
        >
          <span>Made with ❤️</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <Star className="h-3 w-3 text-amber-400" />
          <span>Star on GitHub</span>
        </a>
      </div>
    </aside>
  );
}
