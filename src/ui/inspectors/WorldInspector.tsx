import { useRef, useState } from 'react';
import { Download, Globe, Map as MapIcon, Mountain, Trash2, Trees, Upload } from 'lucide-react';
import {
  computeElevationStats,
  DEFAULT_MAP_BACKGROUND,
  downloadMapTilesTextureBase64,
  getMapLandSize,
  MAP_TILE_PRESETS,
  TERRARIUM_URL_DEFAULT,
} from '@/core/mapTiles';
import type { Light, World, WorldObject } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import {
  DEFAULT_DECIDUOUS_COLOR,
  DEFAULT_PINE_COLOR,
  DEFAULT_TRUNK_COLOR,
} from '@/core/treeGeometry';
import { downloadFullMapAreaPng } from '@/core/worldTextureCompositor';
import { MapLocationControl } from '@/ui/MapLocationControl';
import { WorldPerformanceControls } from '@/ui/WorldPerformanceControls';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { NumericField, PoseFields, RosNameField } from '@/ui/inspectors/NumericField';
import { TexturePicker } from '@/ui/inspectors/TexturePicker';

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

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [Number.isFinite(r) ? r : 0.5, Number.isFinite(g) ? g : 0.5, Number.isFinite(b) ? b : 0.5];
}

export function WorldSettingsInspector({ world }: { world: World }) {
  const textures = useRoboForgeStore((s) => s.project.textures);
  const units = useRoboForgeStore((s) => s.units);
  const updateWorld = useRoboForgeStore((s) => s.updateWorld);
  const conformWorldObjectsToTerrain = useRoboForgeStore((s) => s.conformWorldObjectsToTerrain);
  const setMapTileTexture = useRoboForgeStore((s) => s.setMapTileTexture);
  const addLog = useRoboForgeStore((s) => s.addLog);
  const setMapAnnotatorOpen = useRoboForgeStore((s) => s.setMapAnnotatorOpen);
  const heightmapInputRef = useRef<HTMLInputElement | null>(null);
  const mapBg: NonNullable<World['mapBackground']> =
    world.mapBackground ?? DEFAULT_MAP_BACKGROUND;
  const landDims = getMapLandSize(world.mapBackground, world.ground.size);
  const elevStats = computeElevationStats(mapBg);
  const [downloadingMapTex, setDownloadingMapTex] = useState(false);
  const [savingMapPng, setSavingMapPng] = useState(false);

  const ensureMapBackground = (w: World) => {
    if (!w.mapBackground) {
      w.mapBackground = { ...DEFAULT_MAP_BACKGROUND };
    }
    return w.mapBackground;
  };

  const handleHeightmapFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) return;
      const base64 = result.slice(comma + 1);
      updateWorld((w) => {
        const m = ensureMapBackground(w);
        m.enabled = true;
        m.elevationEnabled = true;
        m.elevationSource = 'heightmap';
        m.heightmapBase64 = base64;
        m.heightmapMimeType = file.type || 'image/png';
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      <RosNameField
        id="world-name-input"
        label="World Name"
        value={world.name}
        onCommit={(name) =>
          updateWorld((w) => {
            w.name = name;
          })
        }
      />

      <div className="space-y-2 border-t border-[#222938] pt-3">
        <span className="text-xs font-semibold text-slate-200">Physics Solver</span>
        <div className="grid grid-cols-2 gap-2">
          <NumericField
            id="world-step"
            label="Step Size"
            value={world.physics.stepSize}
            unitMode="time"
            unitSystem={units}
            step={0.001}
            min={0.0001}
            onCommit={(val) =>
              updateWorld((w) => {
                w.physics.stepSize = val;
              })
            }
          />
          <NumericField
            id="world-rtf"
            label="Real-Time Factor"
            value={world.physics.realTimeFactor}
            unitMode="raw"
            unitSystem={units}
            step={0.1}
            min={0.1}
            onCommit={(val) =>
              updateWorld((w) => {
                w.physics.realTimeFactor = val;
              })
            }
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
            <NumericField
              key={axis}
              id={`world-grav-${axis}`}
              label={`Grav ${axis}`}
              value={world.physics.gravity[idx as 0 | 1 | 2]}
              unitMode="raw"
              unitSystem={units}
              step={0.1}
              onCommit={(val) =>
                updateWorld((w) => {
                  w.physics.gravity[idx as 0 | 1 | 2] = val;
                })
              }
            />
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-[#222938] pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">Ground Plane</span>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={world.ground.enabled}
              onChange={(e) =>
                updateWorld((w) => {
                  w.ground.enabled = e.target.checked;
                })
              }
            />
            Enabled
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NumericField
            id="ground-w"
            label="Width"
            value={world.ground.size[0]}
            unitMode="length"
            unitSystem={units}
            step={1}
            min={1}
            onCommit={(val) =>
              updateWorld((w) => {
                w.ground.size[0] = val;
              })
            }
          />
          <NumericField
            id="ground-l"
            label="Length"
            value={world.ground.size[1]}
            unitMode="length"
            unitSystem={units}
            step={1}
            min={1}
            onCommit={(val) =>
              updateWorld((w) => {
                w.ground.size[1] = val;
              })
            }
          />
          <NumericField
            id="ground-fric"
            label="Friction"
            value={world.ground.friction}
            unitMode="raw"
            unitSystem={units}
            step={0.1}
            min={0}
            onCommit={(val) =>
              updateWorld((w) => {
                w.ground.friction = val;
              })
            }
          />
        </div>

        <TexturePicker
          idPrefix="ground-plane"
          textureId={world.ground.textureId}
          textureRepeat={world.ground.textureRepeat ?? [10, 10]}
          onChangeTexture={(nextTexId) =>
            updateWorld((w) => {
              if (nextTexId) {
                w.ground.textureId = nextTexId;
                if (!w.ground.textureRepeat) {
                  w.ground.textureRepeat = [10, 10];
                }
              } else {
                delete w.ground.textureId;
              }
            })
          }
          onChangeRepeat={(rep) =>
            updateWorld((w) => {
              w.ground.textureRepeat = rep;
            })
          }
        />
      </div>

      {/* Real-World Map Tile Background + SDF Spherical Coordinates */}
      <div className="space-y-2.5 border-t border-[#222938] pt-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Globe className="h-3.5 w-3.5 text-emerald-400" />
            Map Tile Background (SDF)
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              aria-label="Enable map tile background"
              checked={mapBg.enabled}
              onChange={(e) =>
                updateWorld((w) => {
                  ensureMapBackground(w).enabled = e.target.checked;
                })
              }
            />
            Enabled
          </label>
        </div>

        <div className="space-y-1">
          <label htmlFor="map-preset-select" className="text-[11px] text-slate-400">
            Tile Provider Preset
          </label>
          <select
            id="map-preset-select"
            value={
              MAP_TILE_PRESETS.find((p) => p.urlTemplate === mapBg.tileUrl)?.id ?? 'custom'
            }
            onChange={(e) => {
              const preset = MAP_TILE_PRESETS.find((p) => p.id === e.target.value);
              if (!preset) return;
              updateWorld((w) => {
                const m = ensureMapBackground(w);
                m.tileUrl = preset.urlTemplate;
                m.enabled = true;
              });
            }}
            className="h-7 w-full rounded border border-[#2a3346] bg-[#0e121a] px-2 text-xs text-slate-200"
          >
            {MAP_TILE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom Tile URL Template</option>
          </select>
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">Tile URL Template ({'{x} {y} {z}'})</span>
          <Input
            id="map-tile-url"
            aria-label="Map tile URL template"
            value={mapBg.tileUrl}
            onChange={(e) =>
              updateWorld((w) => {
                ensureMapBackground(w).tileUrl = e.target.value;
              })
            }
            className="font-mono text-[11px]"
          />
        </label>

        <MapLocationControl
          latitude={mapBg.latitude}
          longitude={mapBg.longitude}
          headingDeg={mapBg.headingDeg}
          tileUrl={mapBg.tileUrl}
          landWidth={landDims.width}
          landHeight={landDims.height}
          onChangeCenter={(lat, lon, placeLabel) => {
            updateWorld((w) => {
              const m = ensureMapBackground(w);
              m.latitude = lat;
              m.longitude = lon;
              m.enabled = true;
            });
            if (placeLabel) {
              addLog('info', `Centered map on ${placeLabel} (${lat.toFixed(5)}, ${lon.toFixed(5)}).`);
            }
          }}
        />

        <div className="grid grid-cols-2 gap-2">
          <NumericField
            id="map-lat"
            label="Latitude (deg)"
            value={mapBg.latitude}
            unitMode="raw"
            unitSystem={units}
            step={0.0001}
            min={-85.05}
            max={85.05}
            onCommit={(val) => {
              updateWorld((w) => {
                ensureMapBackground(w).latitude = val;
              });
            }}
          />
          <NumericField
            id="map-lon"
            label="Longitude (deg)"
            value={mapBg.longitude}
            unitMode="raw"
            unitSystem={units}
            step={0.0001}
            min={-180}
            max={180}
            onCommit={(val) => {
              updateWorld((w) => {
                ensureMapBackground(w).longitude = val;
              });
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumericField
            id="map-land-width"
            label="Width X (m)"
            value={landDims.width}
            unitMode="raw"
            unitSystem={units}
            step={10}
            min={10}
            max={5000}
            onCommit={(val) =>
              updateWorld((w) => {
                const m = ensureMapBackground(w);
                const nextW = Math.max(10, Math.min(5000, val));
                const nextH = m.landHeightMeters ?? m.landSizeMeters ?? DEFAULT_MAP_BACKGROUND.landSizeMeters;
                m.landWidthMeters = nextW;
                m.landHeightMeters = nextH;
                m.landSizeMeters = Math.max(nextW, nextH);
                w.ground.size = [nextW, nextH];
              })
            }
          />
          <NumericField
            id="map-land-height"
            label="Height Y (m)"
            value={landDims.height}
            unitMode="raw"
            unitSystem={units}
            step={10}
            min={10}
            max={5000}
            onCommit={(val) =>
              updateWorld((w) => {
                const m = ensureMapBackground(w);
                const nextW = m.landWidthMeters ?? m.landSizeMeters ?? DEFAULT_MAP_BACKGROUND.landSizeMeters;
                const nextH = Math.max(10, Math.min(5000, val));
                m.landWidthMeters = nextW;
                m.landHeightMeters = nextH;
                m.landSizeMeters = Math.max(nextW, nextH);
                w.ground.size = [nextW, nextH];
              })
            }
          />
          <NumericField
            id="map-zoom"
            label="Tile Zoom (1-21)"
            value={mapBg.zoom}
            unitMode="raw"
            unitSystem={units}
            step={1}
            min={1}
            max={21}
            onCommit={(val) =>
              updateWorld((w) => {
                ensureMapBackground(w).zoom = Math.max(1, Math.min(21, Math.round(val)));
              })
            }
          />
          <NumericField
            id="map-heading"
            label="Heading (deg)"
            value={mapBg.headingDeg}
            unitMode="raw"
            unitSystem={units}
            step={1}
            onCommit={(val) =>
              updateWorld((w) => {
                ensureMapBackground(w).headingDeg = val;
              })
            }
          />
          <NumericField
            id="map-opacity"
            label="Map Opacity"
            value={mapBg.opacity}
            unitMode="raw"
            unitSystem={units}
            step={0.05}
            min={0.05}
            max={1}
            onCommit={(val) =>
              updateWorld((w) => {
                ensureMapBackground(w).opacity = val;
              })
            }
          />
        </div>

        {/* Elevation / DEM Terrain Controls */}
        <div className="space-y-2 rounded border border-[#222938] bg-[#0b0e14] p-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
              <Mountain className="h-3.5 w-3.5 text-amber-400" />
              Elevation Terrain (DEM)
            </span>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                aria-label="Enable elevation terrain DEM"
                checked={Boolean(mapBg.elevationEnabled)}
                onChange={(e) =>
                  updateWorld((w) => {
                    const m = ensureMapBackground(w);
                    m.elevationEnabled = e.target.checked;
                    if (e.target.checked) m.enabled = true;
                  })
                }
              />
              Active
            </label>
          </div>

          <div className="space-y-1">
            <label htmlFor="dem-source-select" className="text-[10px] text-slate-400">
              Elevation Data Source
            </label>
            <select
              id="dem-source-select"
              value={mapBg.elevationSource ?? 'terrarium'}
              onChange={(e) =>
                updateWorld((w) => {
                  const m = ensureMapBackground(w);
                  m.elevationSource = e.target.value as 'terrarium' | 'custom_url' | 'heightmap';
                  m.elevationEnabled = true;
                })
              }
              className="h-7 w-full rounded border border-[#2a3346] bg-[#0e121a] px-2 text-xs text-slate-200"
            >
              <option value="terrarium">Real-World DEM Tiles (AWS Terrarium)</option>
              <option value="custom_url">Custom DEM Tile URL</option>
              <option value="heightmap">Imported Grayscale Heightmap Image</option>
            </select>
          </div>

          {(mapBg.elevationSource ?? 'terrarium') === 'custom_url' && (
            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">DEM Tile URL ({'{x} {y} {z}'})</span>
              <Input
                aria-label="DEM tile URL template"
                value={mapBg.elevationUrl ?? TERRARIUM_URL_DEFAULT}
                onChange={(e) =>
                  updateWorld((w) => {
                    ensureMapBackground(w).elevationUrl = e.target.value;
                  })
                }
                className="font-mono text-[11px]"
              />
            </label>
          )}

          {mapBg.elevationSource === 'heightmap' && (
            <div className="space-y-1.5">
              <input
                ref={heightmapInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleHeightmapFile}
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => heightmapInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {mapBg.heightmapBase64 ? 'Replace Heightmap Image' : 'Import Heightmap PNG/JPG'}
                </Button>
              </div>
              <NumericField
                id="dem-max-h"
                label="Max Heightmap Relief (m)"
                value={mapBg.heightmapMaxHeight ?? 25}
                unitMode="raw"
                unitSystem={units}
                step={1}
                min={1}
                max={500}
                onCommit={(val) =>
                  updateWorld((w) => {
                    ensureMapBackground(w).heightmapMaxHeight = Math.max(1, val);
                  })
                }
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <NumericField
              id="dem-scale"
              label="Vertical Scale (x)"
              value={mapBg.elevationScale ?? 1}
              unitMode="raw"
              unitSystem={units}
              step={0.1}
              min={0}
              max={20}
              onCommit={(val) =>
                updateWorld((w) => {
                  ensureMapBackground(w).elevationScale = Math.max(0, val);
                })
              }
            />
            <NumericField
              id="dem-segs"
              label="Terrain Grid"
              value={mapBg.terrainSegments ?? 40}
              unitMode="raw"
              unitSystem={units}
              step={4}
              min={8}
              max={96}
              onCommit={(val) =>
                updateWorld((w) => {
                  ensureMapBackground(w).terrainSegments = Math.max(8, Math.min(96, Math.round(val)));
                })
              }
            />
          </div>

          <div className="flex items-center justify-between font-mono text-[10px] text-slate-400">
            <span>Base Elev: {mapBg.elevation.toFixed(1)}m</span>
            <span>
              Relief:{' '}
              {mapBg.elevationGridSize
                ? `${elevStats.minZ.toFixed(1)}..${elevStats.maxZ.toFixed(1)}m (${mapBg.elevationGridSize}×${mapBg.elevationGridSize})`
                : 'Flat / Pending'}
            </span>
          </div>

          {world.objects.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => conformWorldObjectsToTerrain()}
            >
              Conform All Objects to Terrain ({world.objects.length})
            </Button>
          )}
        </div>

        <div className="space-y-1.5 rounded border border-[#222938] bg-[#0b0e14] px-2.5 py-2">
          <div className="min-w-0">
            <div className="font-mono text-[10px] text-slate-200 truncate">
              materials/textures/{world.name}_map.png ({Math.round(landDims.width)}m×
              {Math.round(landDims.height)}m)
            </div>
            <div className="text-[10px] text-slate-400">
              {mapBg.mapTextureBase64
                ? 'Cached for ROS 2 ZIP export · Save PNG to upscale externally'
                : 'Auto-downloads on viewport load or ZIP export'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={downloadingMapTex}
              onClick={async () => {
                setDownloadingMapTex(true);
                try {
                  const res = await downloadMapTilesTextureBase64(mapBg, 1024);
                  if (res?.base64) {
                    setMapTileTexture(res.base64);
                    addLog(
                      'info',
                      `Cached map ground texture (${res.widthPx}×${res.heightPx}px · ${res.loadedCount}/${res.totalCount} tiles) to materials/textures/${world.name}_map.png.`,
                    );
                  } else {
                    addLog('warning', 'Map tile download returned fallback texture.');
                  }
                } finally {
                  setDownloadingMapTex(false);
                }
              }}
            >
              <Download className="h-3.5 w-3.5" />
              {downloadingMapTex ? 'Fetching...' : 'Refresh Tiles'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={savingMapPng}
              data-testid="world-inspector-save-map-png"
              onClick={async () => {
                setSavingMapPng(true);
                try {
                  const res = await downloadFullMapAreaPng(world, textures, 'original');
                  addLog(
                    'info',
                    `Saved full-quality map tile "${res.filename}" (${res.widthPx}×${res.heightPx}px).`,
                  );
                } catch (err) {
                  addLog(
                    'error',
                    `Save map PNG failed: ${err instanceof Error ? err.message : 'unknown error'}`,
                  );
                } finally {
                  setSavingMapPng(false);
                }
              }}
            >
              <Download className="h-3.5 w-3.5 text-emerald-400" />
              {savingMapPng ? 'Saving...' : 'Save Map PNG'}
            </Button>
          </div>
        </div>

        <Button
          type="button"
          data-testid="inspector-open-map-builder"
          size="sm"
          className="w-full bg-emerald-700 text-white hover:bg-emerald-600"
          onClick={() => setMapAnnotatorOpen(true)}
        >
          <MapIcon className="h-3.5 w-3.5" />
          Open 2D Map Builder (Trees &amp; Buildings)
        </Button>
      </div>

      <div className="border-t border-[#222938] pt-3">
        <WorldPerformanceControls world={world} variant="panel" />
      </div>

      <div className="space-y-1.5 border-t border-[#222938] pt-3">
        <span className="text-xs font-semibold text-slate-200">Robot Spawn Pose</span>
        <PoseFields
          idPrefix="spawn-pose"
          pose={world.robotSpawnPose}
          units={units}
          onChangeAxis={(group, idx, val) =>
            updateWorld((w) => {
              w.robotSpawnPose[group][idx] = val;
            })
          }
        />
      </div>
    </div>
  );
}

export function WorldObjectInspector({ obj }: { obj: WorldObject }) {
  const units = useRoboForgeStore((s) => s.units);
  const updateWorldObject = useRoboForgeStore((s) => s.updateWorldObject);
  const deleteWorldObject = useRoboForgeStore((s) => s.deleteWorldObject);
  const setMapAnnotatorOpen = useRoboForgeStore((s) => s.setMapAnnotatorOpen);

  return (
    <div className="space-y-4">
      <RosNameField
        id="world-obj-name"
        label="Object Name"
        value={obj.name}
        onCommit={(name) =>
          updateWorldObject(obj.id, (draft) => {
            draft.name = name;
          })
        }
      />

      {obj.source.type === 'model' && (
        <label className="block space-y-1 text-xs">
          <span className="text-[11px] text-slate-400">Gazebo Model URI</span>
          <Input
            value={obj.source.uri}
            onChange={(e) =>
              updateWorldObject(obj.id, (draft) => {
                if (draft.source.type === 'model') {
                  draft.source.uri = e.target.value;
                }
              })
            }
            className="font-mono text-xs"
          />
        </label>
      )}

      {obj.source.type === 'tree' && (
        <div className="space-y-2.5 border-t border-[#222938] pt-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Trees className="h-3.5 w-3.5 text-emerald-400" />
              Tree Model Parameters
            </span>
            <select
              aria-label="Tree style"
              value={obj.source.style}
              onChange={(e) => {
                const nextStyle = e.target.value as 'deciduous' | 'pine';
                updateWorldObject(obj.id, (draft) => {
                  if (draft.source.type === 'tree') {
                    draft.source.style = nextStyle;
                  }
                });
              }}
              className="h-6 rounded border border-[#2a3346] bg-[#0e121a] px-1.5 font-mono text-[11px] text-slate-200"
            >
              <option value="deciduous">Deciduous (Oak)</option>
              <option value="pine">Pine (Conifer)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <NumericField
              id="tree-trunk-r"
              label="Trunk Radius"
              value={obj.source.trunkRadius}
              unitMode="length"
              unitSystem={units}
              min={0.03}
              onCommit={(val) =>
                updateWorldObject(obj.id, (draft) => {
                  if (draft.source.type === 'tree') draft.source.trunkRadius = val;
                })
              }
            />
            <NumericField
              id="tree-trunk-h"
              label="Trunk Height"
              value={obj.source.trunkHeight}
              unitMode="length"
              unitSystem={units}
              min={0.2}
              onCommit={(val) =>
                updateWorldObject(obj.id, (draft) => {
                  if (draft.source.type === 'tree') draft.source.trunkHeight = val;
                })
              }
            />
            <NumericField
              id="tree-canopy-r"
              label="Canopy Radius"
              value={obj.source.canopyRadius}
              unitMode="length"
              unitSystem={units}
              min={0.15}
              onCommit={(val) =>
                updateWorldObject(obj.id, (draft) => {
                  if (draft.source.type === 'tree') draft.source.canopyRadius = val;
                })
              }
            />
            <NumericField
              id="tree-canopy-h"
              label="Canopy Height"
              value={obj.source.canopyHeight}
              unitMode="length"
              unitSystem={units}
              min={0.3}
              onCommit={(val) =>
                updateWorldObject(obj.id, (draft) => {
                  if (draft.source.type === 'tree') draft.source.canopyHeight = val;
                })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <label className="flex items-center justify-between gap-2 rounded border border-[#222938] bg-[#0e121a] px-2 py-1">
              <span className="text-[11px] text-slate-400">Trunk</span>
              <input
                type="color"
                aria-label="Tree trunk color"
                value={rgbaToHex(obj.source.trunkColor ?? DEFAULT_TRUNK_COLOR)}
                onChange={(e) => {
                  const [r, g, b] = hexToRgbTuple(e.target.value);
                  updateWorldObject(obj.id, (draft) => {
                    if (draft.source.type === 'tree') {
                      draft.source.trunkColor = [r, g, b, 1];
                    }
                  });
                }}
                className="h-5 w-7 cursor-pointer rounded border border-[#2a3346] bg-transparent p-0"
              />
            </label>
            <label className="flex items-center justify-between gap-2 rounded border border-[#222938] bg-[#0e121a] px-2 py-1">
              <span className="text-[11px] text-slate-400">Foliage</span>
              <input
                type="color"
                aria-label="Tree foliage color"
                value={rgbaToHex(
                  obj.source.foliageColor ??
                    (obj.source.style === 'pine' ? DEFAULT_PINE_COLOR : DEFAULT_DECIDUOUS_COLOR),
                )}
                onChange={(e) => {
                  const [r, g, b] = hexToRgbTuple(e.target.value);
                  updateWorldObject(obj.id, (draft) => {
                    if (draft.source.type === 'tree') {
                      draft.source.foliageColor = [r, g, b, 1];
                    }
                  });
                }}
                className="h-5 w-7 cursor-pointer rounded border border-[#2a3346] bg-transparent p-0"
              />
            </label>
          </div>
        </div>
      )}

      {obj.source.type === 'primitive' && (
        <div className="space-y-2 border-t border-[#222938] pt-3">
          <span className="text-xs font-semibold text-slate-200">
            Obstacle Geometry ({obj.source.shape.kind})
          </span>
          {obj.source.shape.kind === 'box' && (
            <div className="grid grid-cols-3 gap-2">
              {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                <NumericField
                  key={axis}
                  id={`wobj-box-${axis}`}
                  label={`Size ${axis}`}
                  value={
                    obj.source.type === 'primitive' && obj.source.shape.kind === 'box'
                      ? obj.source.shape.size[idx as 0 | 1 | 2]
                      : 1
                  }
                  unitMode="length"
                  unitSystem={units}
                  min={0.05}
                  onCommit={(val) =>
                    updateWorldObject(obj.id, (draft) => {
                      if (draft.source.type === 'primitive' && draft.source.shape.kind === 'box') {
                        draft.source.shape.size[idx as 0 | 1 | 2] = val;
                      }
                    })
                  }
                />
              ))}
            </div>
          )}
          {(obj.source.shape.kind === 'cylinder' || obj.source.shape.kind === 'capsule') && (
            <div className="grid grid-cols-2 gap-2">
              <NumericField
                id="wobj-r"
                label="Radius"
                value={obj.source.shape.radius}
                unitMode="length"
                unitSystem={units}
                min={0.02}
                onCommit={(val) =>
                  updateWorldObject(obj.id, (draft) => {
                    if (
                      draft.source.type === 'primitive' &&
                      (draft.source.shape.kind === 'cylinder' ||
                        draft.source.shape.kind === 'capsule')
                    ) {
                      draft.source.shape.radius = val;
                    }
                  })
                }
              />
              <NumericField
                id="wobj-l"
                label="Length"
                value={obj.source.shape.length}
                unitMode="length"
                unitSystem={units}
                min={0.02}
                onCommit={(val) =>
                  updateWorldObject(obj.id, (draft) => {
                    if (
                      draft.source.type === 'primitive' &&
                      (draft.source.shape.kind === 'cylinder' ||
                        draft.source.shape.kind === 'capsule')
                    ) {
                      draft.source.shape.length = val;
                    }
                  })
                }
              />
            </div>
          )}
          {obj.source.shape.kind === 'extrude' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Polygon Footprint</span>
                <span className="font-mono text-slate-300">
                  {obj.source.shape.points.length} vertices
                </span>
              </div>
              <NumericField
                id="wobj-extrude-h"
                label="Building Height"
                value={obj.source.shape.depth}
                unitMode="length"
                unitSystem={units}
                min={0.2}
                step={0.5}
                onCommit={(val) =>
                  updateWorldObject(obj.id, (draft) => {
                    if (draft.source.type === 'primitive' && draft.source.shape.kind === 'extrude') {
                      const prevH = draft.source.shape.depth;
                      draft.source.shape.depth = val;
                      draft.pose.xyz[2] = Number((draft.pose.xyz[2] + (val - prevH) / 2).toFixed(4));
                    }
                  })
                }
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="w-full"
                onClick={() => setMapAnnotatorOpen(true)}
              >
                <MapIcon className="h-3.5 w-3.5" />
                Edit in 2D Map Builder
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1 text-xs">
            <span className="text-[11px] text-slate-400">Material Color</span>
            <input
              type="color"
              aria-label="World object color"
              value={rgbaToHex(obj.source.material.rgba)}
              onChange={(e) => {
                const [r, g, b] = hexToRgbTuple(e.target.value);
                updateWorldObject(obj.id, (draft) => {
                  if (draft.source.type === 'primitive') {
                    draft.source.material.rgba = [r, g, b, draft.source.material.rgba[3]];
                  }
                });
              }}
              className="h-6 w-8 cursor-pointer rounded border border-[#2a3346] bg-transparent p-0"
            />
          </div>

          <TexturePicker
            idPrefix={`wobj-${obj.id}`}
            textureId={obj.source.material.textureId}
            textureRepeat={obj.source.material.textureRepeat}
            onChangeTexture={(nextTexId) =>
              updateWorldObject(obj.id, (draft) => {
                if (draft.source.type === 'primitive') {
                  if (nextTexId) {
                    draft.source.material.textureId = nextTexId;
                    draft.source.material.rgba = [1, 1, 1, draft.source.material.rgba[3]];
                  } else {
                    delete draft.source.material.textureId;
                  }
                }
              })
            }
            onChangeRepeat={(rep) =>
              updateWorldObject(obj.id, (draft) => {
                if (draft.source.type === 'primitive') {
                  draft.source.material.textureRepeat = rep;
                }
              })
            }
          />
        </div>
      )}

      <div className="border-t border-[#222938] pt-3">
        <span className="block pb-1.5 text-xs font-semibold text-slate-200">World Pose</span>
        <PoseFields
          idPrefix="wobj-pose"
          pose={obj.pose}
          units={units}
          onChangeAxis={(group, idx, val) =>
            updateWorldObject(obj.id, (draft) => {
              draft.pose[group][idx] = val;
            })
          }
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[#222938] pt-3 text-xs">
        <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={obj.static}
            onChange={(e) =>
              updateWorldObject(obj.id, (draft) => {
                draft.static = e.target.checked;
              })
            }
          />
          Static Body
        </label>
        {!obj.static && (
          <div className="w-28">
            <NumericField
              id="wobj-mass"
              label="Mass"
              value={obj.mass ?? 5}
              unitMode="mass"
              unitSystem={units}
              step={0.5}
              min={0.1}
              onCommit={(val) =>
                updateWorldObject(obj.id, (draft) => {
                  draft.mass = val;
                })
              }
            />
          </div>
        )}
      </div>

      <div className="border-t border-[#222938] pt-3">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => deleteWorldObject(obj.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove Object
        </Button>
      </div>
    </div>
  );
}

export function WorldLightInspector({ light }: { light: Light }) {
  const units = useRoboForgeStore((s) => s.units);
  const updateWorldLight = useRoboForgeStore((s) => s.updateWorldLight);
  const deleteWorldLight = useRoboForgeStore((s) => s.deleteWorldLight);

  return (
    <div className="space-y-4">
      <RosNameField
        id="light-name-input"
        label="Light Name"
        value={light.name}
        onCommit={(name) =>
          updateWorldLight(light.id, (draft) => {
            draft.name = name;
          })
        }
      />

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="space-y-1">
          <span className="text-[11px] text-slate-400">Type</span>
          <select
            value={light.type}
            onChange={(e) =>
              updateWorldLight(light.id, (draft) => {
                draft.type = e.target.value as Light['type'];
              })
            }
            className="h-7 w-full rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-xs text-slate-200"
          >
            <option value="directional">directional</option>
            <option value="point">point</option>
            <option value="spot">spot</option>
          </select>
        </label>
        <NumericField
          id="light-intensity"
          label="Intensity"
          value={light.intensity}
          unitMode="raw"
          unitSystem={units}
          step={0.1}
          min={0}
          onCommit={(val) =>
            updateWorldLight(light.id, (draft) => {
              draft.intensity = val;
            })
          }
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
        <input
          type="checkbox"
          checked={light.castShadows}
          onChange={(e) =>
            updateWorldLight(light.id, (draft) => {
              draft.castShadows = e.target.checked;
            })
          }
        />
        Cast Shadows
      </label>

      <div className="border-t border-[#222938] pt-3">
        <span className="block pb-1.5 text-xs font-semibold text-slate-200">Light Pose</span>
        <PoseFields
          idPrefix="light-pose"
          pose={light.pose}
          units={units}
          onChangeAxis={(group, idx, val) =>
            updateWorldLight(light.id, (draft) => {
              draft.pose[group][idx] = val;
            })
          }
        />
      </div>

      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="w-full"
        onClick={() => deleteWorldLight(light.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove Light
      </Button>
    </div>
  );
}
