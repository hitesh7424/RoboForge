import { useEffect, useState } from 'react';
import {
  Box,
  BrickWall,
  Building2,
  Circle,
  Columns2,
  Grid,
  Magnet,
  MapPin,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Pentagon,
  Route,
  Square,
  Trees,
} from 'lucide-react';
import { useRoboForgeStore } from '@/core/store';
import { getPresetPreviewDataUrl, getTexturePresetById } from '@/core/texturePresets';
import { WorldStudio2DCanvas } from '@/worldStudio/WorldStudio2DCanvas';
import { WorldStudio3DViewport } from '@/worldStudio/WorldStudio3DViewport';
import { WorldStudioInspector } from '@/worldStudio/WorldStudioInspector';
import { WorldStudioPalette } from '@/worldStudio/WorldStudioPalette';
import {
  COSMETIC_PROP_PRESETS,
  type ActiveBrushMaterial,
  type StudioTool,
  type StudioViewMode,
} from '@/worldStudio/types';

const STUDIO_TOOLS: {
  id: StudioTool;
  label: string;
  shortLabel: string;
  icon: typeof MousePointer2;
  accent: string;
}[] = [
  { id: 'select', label: 'Select & Edit', shortLabel: 'Select', icon: MousePointer2, accent: 'bg-blue-600' },
  { id: 'zone_rect', label: 'Paint Rectangular Texture Zone', shortLabel: 'Rect Zone', icon: Square, accent: 'bg-emerald-600' },
  { id: 'zone_poly', label: 'Paint Polygon Texture Zone', shortLabel: 'Poly Zone', icon: Pentagon, accent: 'bg-emerald-600' },
  { id: 'zone_circle', label: 'Paint Circular Texture Zone', shortLabel: 'Circle Zone', icon: Circle, accent: 'bg-emerald-600' },
  { id: 'zone_path', label: 'Paint Road / Path Texture', shortLabel: 'Road Path', icon: Route, accent: 'bg-emerald-600' },
  { id: 'tree', label: 'Place Tree', shortLabel: 'Tree', icon: Trees, accent: 'bg-teal-600' },
  { id: 'building', label: 'Draw Building Polygon', shortLabel: 'Building', icon: Building2, accent: 'bg-sky-600' },
  { id: 'wall', label: 'Draw Wall Polyline', shortLabel: 'Wall', icon: BrickWall, accent: 'bg-amber-600' },
  { id: 'prop', label: 'Place Cosmetic Prop', shortLabel: 'Prop', icon: Box, accent: 'bg-indigo-600' },
  { id: 'spawn', label: 'Set Robot Spawn Point', shortLabel: 'Spawn', icon: MapPin, accent: 'bg-cyan-600' },
];

export function WorldStudioPage() {
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const deleteSurfaceZone = useRoboForgeStore((s) => s.deleteSurfaceZone);
  const deleteWorldObject = useRoboForgeStore((s) => s.deleteWorldObject);
  const deleteWorldLight = useRoboForgeStore((s) => s.deleteWorldLight);

  const [viewMode, setViewMode] = useState<StudioViewMode>('split');
  const [tool, setTool] = useState<StudioTool>('zone_rect');
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const [brush, setBrush] = useState<ActiveBrushMaterial>({
    textureSource: 'preset',
    presetId: 'asphalt_road',
    tintHex: '#ffffff',
    repeat: [8, 8],
    opacity: 1,
    strokeWidth: 5,
    circleRadius: 6,
    feather: 0,
  });

  const [treeStyle, setTreeStyle] = useState<'deciduous' | 'pine'>('deciduous');
  const [treeRadius, setTreeRadius] = useState(1.6);
  const [treeHeight, setTreeHeight] = useState(3.6);
  const [buildingHeight, setBuildingHeight] = useState(6.5);
  const [buildingColor, setBuildingColor] = useState('#708094');
  const [wallHeight, setWallHeight] = useState(2.4);
  const [wallThickness, setWallThickness] = useState(0.35);
  const [selectedPropId, setSelectedPropId] = useState<string>(COSMETIC_PROP_PRESETS[0]!.id);

  // Delete key removes selected zone/object/light inside World Studio
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection?.type === 'surfaceZone') {
          deleteSurfaceZone(selection.id);
        } else if (selection?.type === 'worldObject') {
          deleteWorldObject(selection.id);
        } else if (selection?.type === 'worldLight') {
          deleteWorldLight(selection.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, deleteSurfaceZone, deleteWorldObject, deleteWorldLight]);

  // Active brush display info
  const activeBrushLabel =
    brush.textureSource === 'custom' && brush.textureId
      ? project.textures.find((t) => t.id === brush.textureId)?.name ?? 'Custom Image'
      : getTexturePresetById(brush.presetId)?.name ?? 'Asphalt Road';

  const activeBrushThumb =
    brush.textureSource === 'custom' && brush.textureId
      ? (() => {
          const t = project.textures.find((item) => item.id === brush.textureId);
          return t ? `data:${t.mimeType};base64,${t.dataBase64}` : '';
        })()
      : getPresetPreviewDataUrl(brush.presetId, 48);

  const sharedCanvasProps = {
    tool,
    brush,
    showGrid,
    snapEnabled,
    snapStep: 0.5,
    treeStyle,
    treeRadius,
    treeHeight,
    buildingHeight,
    buildingColor,
    wallHeight,
    wallThickness,
    selectedPropId,
  };

  return (
    <main
      data-testid="world-studio-page"
      aria-label="Custom World Studio"
      className="flex flex-1 min-h-0 flex-col overflow-hidden bg-[#0b0f17] text-slate-100"
    >
      {/* Inline Studio Toolbar — Zero Popups */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[#232b3b] bg-[#111622] px-2.5 overflow-x-auto">
        {/* Left: Drawer toggle + Inline 2D / Split / 3D Mode Switcher */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            aria-label="Toggle cosmetics palette"
            aria-pressed={leftOpen}
            onClick={() => setLeftOpen((o) => !o)}
            className={`inline-flex h-7 w-7 items-center justify-center rounded border border-[#283246] transition-colors cursor-pointer ${
              leftOpen
                ? 'bg-[#1c2536] text-emerald-300'
                : 'bg-[#0c1018] text-slate-400 hover:text-slate-100'
            }`}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>

          <div
            role="group"
            aria-label="World Studio edit view mode"
            className="flex items-center gap-0.5 rounded-md border border-[#263044] bg-[#0a0e16] p-0.5"
          >
            <button
              type="button"
              data-testid="studio-view-2d"
              aria-pressed={viewMode === '2d'}
              onClick={() => setViewMode('2d')}
              className={`inline-flex h-6 items-center gap-1 rounded px-2.5 text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                viewMode === '2d'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:bg-[#161e2e] hover:text-slate-100'
              }`}
            >
              2D Edit
            </button>
            <button
              type="button"
              data-testid="studio-view-split"
              aria-pressed={viewMode === 'split'}
              onClick={() => setViewMode('split')}
              className={`inline-flex h-6 items-center gap-1 rounded px-2.5 text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                viewMode === 'split'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-[#161e2e] hover:text-slate-100'
              }`}
            >
              <Columns2 className="h-3 w-3" />
              Split 2D+3D
            </button>
            <button
              type="button"
              data-testid="studio-view-3d"
              aria-pressed={viewMode === '3d'}
              onClick={() => setViewMode('3d')}
              className={`inline-flex h-6 items-center gap-1 rounded px-2.5 text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                viewMode === '3d'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:bg-[#161e2e] hover:text-slate-100'
              }`}
            >
              3D Edit
            </button>
          </div>
        </div>

        {/* Center: Compact Tool Strip */}
        <div
          role="toolbar"
          aria-label="World editing tools"
          className="flex items-center gap-1 rounded-md border border-[#232b3b] bg-[#0a0e16] p-0.5 shrink-0"
        >
          {STUDIO_TOOLS.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`studio-tool-${t.id}`}
                aria-label={t.label}
                aria-pressed={active}
                title={t.label}
                onClick={() => setTool(t.id)}
                className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? `${t.accent} text-white`
                    : 'text-slate-400 hover:bg-[#171f2e] hover:text-slate-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden xl:inline">{t.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Active Brush Preview + Grid/Snap + Inspector Toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="hidden 2xl:flex items-center gap-1.5 rounded border border-[#253044] bg-[#0c1018] px-2 py-0.5 text-[11px]">
            {activeBrushThumb ? (
              <img
                src={activeBrushThumb}
                alt={activeBrushLabel}
                className="h-4 w-4 rounded-sm border border-white/20 object-cover"
              />
            ) : (
              <span className="h-4 w-4 rounded-sm bg-emerald-600" />
            )}
            <span className="max-w-24 truncate text-slate-200">{activeBrushLabel}</span>
          </div>

          <button
            type="button"
            aria-label="Toggle metric grid"
            aria-pressed={showGrid}
            title="Toggle Grid"
            onClick={() => setShowGrid((g) => !g)}
            className={`inline-flex h-7 items-center gap-1 rounded border border-[#283246] px-2 text-[11px] cursor-pointer ${
              showGrid
                ? 'bg-[#1c2536] text-blue-300'
                : 'bg-[#0c1018] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Grid</span>
          </button>

          <button
            type="button"
            aria-label="Toggle 0.5m coordinate snap"
            aria-pressed={snapEnabled}
            title="Snap to 0.5m"
            onClick={() => setSnapEnabled((s) => !s)}
            className={`inline-flex h-7 items-center gap-1 rounded border border-[#283246] px-2 text-[11px] cursor-pointer ${
              snapEnabled
                ? 'bg-[#1c2536] text-emerald-300'
                : 'bg-[#0c1018] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Magnet className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Snap</span>
          </button>

          <button
            type="button"
            aria-label="Toggle layers and properties inspector"
            aria-pressed={rightOpen}
            onClick={() => setRightOpen((o) => !o)}
            className={`inline-flex h-7 w-7 items-center justify-center rounded border border-[#283246] transition-colors cursor-pointer ${
              rightOpen
                ? 'bg-[#1c2536] text-emerald-300'
                : 'bg-[#0c1018] text-slate-400 hover:text-slate-100'
            }`}
          >
            <PanelRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main Dedicated Studio Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {leftOpen && (
          <WorldStudioPalette
            tool={tool}
            onSelectTool={setTool}
            brush={brush}
            onChangeBrush={setBrush}
            treeStyle={treeStyle}
            onChangeTreeStyle={setTreeStyle}
            treeRadius={treeRadius}
            onChangeTreeRadius={setTreeRadius}
            treeHeight={treeHeight}
            onChangeTreeHeight={setTreeHeight}
            buildingHeight={buildingHeight}
            onChangeBuildingHeight={setBuildingHeight}
            buildingColor={buildingColor}
            onChangeBuildingColor={setBuildingColor}
            wallHeight={wallHeight}
            onChangeWallHeight={setWallHeight}
            wallThickness={wallThickness}
            onChangeWallThickness={setWallThickness}
            selectedPropId={selectedPropId}
            onSelectPropId={setSelectedPropId}
          />
        )}

        {/* Center Stage: Pure 2D, Pure 3D, or Synchronized Split 2D + 3D */}
        <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
          {viewMode === '2d' && (
            <div className="h-full w-full">
              <WorldStudio2DCanvas {...sharedCanvasProps} />
            </div>
          )}

          {viewMode === '3d' && (
            <div className="h-full w-full">
              <WorldStudio3DViewport {...sharedCanvasProps} />
            </div>
          )}

          {viewMode === 'split' && (
            <div className="grid h-full w-full grid-cols-2 divide-x divide-[#232b3b]">
              <div className="min-w-0 min-h-0 h-full">
                <WorldStudio2DCanvas {...sharedCanvasProps} />
              </div>
              <div className="min-w-0 min-h-0 h-full">
                <WorldStudio3DViewport {...sharedCanvasProps} />
              </div>
            </div>
          )}
        </div>

        {rightOpen && <WorldStudioInspector />}
      </div>
    </main>
  );
}
