import { useEffect, useMemo, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode,
  Globe,
  Image as ImageIcon,
  Layers,
} from 'lucide-react';
import {
  downloadMapTilesTextureBase64,
  type MapExportQuality,
} from '@/core/mapTiles';
import { validateProject } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { downloadFullMapAreaPng } from '@/core/worldTextureCompositor';
import { downloadRos2PackageZip, exportRos2Package } from '@/exporters';
import { resolveExportPackageName, type ExportScope } from '@/exporters/packageFiles';
import { getTargetConfig } from '@/exporters/targets';
import { WorldPerformanceControls } from '@/ui/WorldPerformanceControls';
import { Button } from '@/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';

// Bundle Monaco locally so it never fetches from external CDNs in offline/sandbox environments
loader.config({ monaco });

function detectLanguage(path: string): string {
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.txt')) return 'plaintext';
  return 'xml';
}

const SCOPE_OPTIONS: {
  id: ExportScope;
  label: string;
  subtitle: string;
  icon: typeof Layers;
}[] = [
  {
    id: 'full',
    label: 'Full Package',
    subtitle: 'Robot + World + Sim Launch',
    icon: Layers,
  },
  {
    id: 'robot',
    label: 'Robot Only',
    subtitle: 'URDF + Spawn Launch',
    icon: Bot,
  },
  {
    id: 'world',
    label: 'World Only',
    subtitle: 'SDF + Map + Standalone Launch',
    icon: Globe,
  },
];

export function ExportModal() {
  const project = useRoboForgeStore((s) => s.project);
  const isOpen = useRoboForgeStore((s) => s.isExportModalOpen);
  const setExportModalOpen = useRoboForgeStore((s) => s.setExportModalOpen);
  const setMapTileTexture = useRoboForgeStore((s) => s.setMapTileTexture);
  const addLog = useRoboForgeStore((s) => s.addLog);

  const [scope, setScope] = useState<ExportScope>('full');
  const [mapQuality, setMapQuality] = useState<MapExportQuality>('original');
  const [selectedFile, setSelectedFile] = useState<string>('package.xml');
  const [copied, setCopied] = useState(false);
  const [downloadingMap, setDownloadingMap] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const mapBg = project.world.mapBackground;
    if (!project.world.ground.enabled || !mapBg?.enabled || mapBg.mapTextureBase64) return;

    let cancelled = false;
    void downloadMapTilesTextureBase64(mapBg, 1024).then((res) => {
      if (cancelled || !res?.base64) return;
      setMapTileTexture(res.base64);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, project.world.ground.enabled, project.world.mapBackground, setMapTileTexture]);

  const exportPkgName = resolveExportPackageName(project.name, scope);
  const files = useMemo(() => exportRos2Package(project, undefined, scope), [project, scope]);
  const textPaths = useMemo(
    () => Object.keys(files).filter((k) => typeof files[k] === 'string'),
    [files],
  );
  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter((i) => i.severity === 'error');
  const target = getTargetConfig(project.target);

  useEffect(() => {
    if (!files[selectedFile] && textPaths[0]) {
      setSelectedFile(textPaths[0]);
    }
  }, [files, selectedFile, textPaths]);

  const selectedEntry = files[selectedFile];
  const activeContent =
    typeof selectedEntry === 'string'
      ? selectedEntry
      : selectedEntry instanceof Uint8Array
        ? `Binary package asset (${selectedFile}, ${selectedEntry.byteLength.toLocaleString()} bytes) bundled in ${exportPkgName}.zip.`
        : 'Binary asset included in zip archive.';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      addLog('warning', 'Clipboard copy was blocked by browser permissions.');
    }
  };

  const handleDownloadZip = async () => {
    setExportingZip(true);
    try {
      const { paths, zipFilename, mapTextureDimensions } = await downloadRos2PackageZip(
        project,
        setMapTileTexture,
        scope,
        mapQuality,
      );
      const resLabel = mapTextureDimensions
        ? ` · map ${mapTextureDimensions.widthPx}×${mapTextureDimensions.heightPx}px`
        : '';
      addLog(
        'info',
        `Exported ROS 2 package "${zipFilename}" (${paths.length} files for ${target.label}${resLabel}).`,
      );
    } catch (err) {
      addLog('error', `ZIP export failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setExportingZip(false);
    }
  };

  const handleDownloadMapPng = async () => {
    setDownloadingMap(true);
    try {
      const res = await downloadFullMapAreaPng(project.world, project.textures, mapQuality);
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
      setDownloadingMap(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setExportModalOpen}>
      <DialogContent className="max-w-5xl h-[86vh] flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-blue-400" />
            Export ROS 2 Package ({exportPkgName})
          </DialogTitle>
          <DialogDescription>
            Target: {target.label} · SDF {target.sdfVersion} · {Object.keys(files).length} package
            files generated directly from the scene graph.
          </DialogDescription>
        </DialogHeader>

        {/* Export Scope Selector: Full vs Robot Only vs World Only */}
        <div
          role="radiogroup"
          aria-label="Export package scope"
          className="grid grid-cols-3 gap-2 shrink-0"
        >
          {SCOPE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = scope === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`export-scope-${opt.id}`}
                onClick={() => setScope(opt.id)}
                className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors cursor-pointer ${
                  active
                    ? 'border-blue-500 bg-blue-600/15 text-slate-100'
                    : 'border-[#232b3b] bg-[#0d1118] text-slate-400 hover:border-[#34415a] hover:text-slate-200'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? 'text-blue-400' : 'text-slate-500'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold leading-tight">{opt.label}</div>
                  <div className="truncate text-[10px] text-slate-400">{opt.subtitle}</div>
                </div>
              </button>
            );
          })}
        </div>

        {errors.length > 0 ? (
          <div className="flex items-center gap-2 rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300 shrink-0">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>
              {errors.length} validation error{errors.length > 1 ? 's' : ''} detected (
              {errors[0]!.message}). Resolve them before building with colcon.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded border border-emerald-900/70 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300 shrink-0">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              {scope === 'world'
                ? 'Standalone Gazebo world package ready — launch directly or spawn any external ROS 2 robot into it.'
                : scope === 'robot'
                  ? 'Standalone robot package ready — use launch/spawn_robot.launch.py to drop this robot into any Gazebo world.'
                  : 'All structural & ROS identifier checks passed. Ready to build with colcon.'}
            </span>
          </div>
        )}

        {scope !== 'robot' && (
          <WorldPerformanceControls world={project.world} variant="compact" />
        )}

        <div className="flex-1 min-h-0 grid grid-cols-12 gap-3">
          {/* File tree */}
          <div className="col-span-4 overflow-y-auto rounded border border-[#232b3b] bg-[#0d1118] p-2 space-y-0.5">
            {Object.keys(files).map((path) => {
              const active = selectedFile === path;
              const isBinary = typeof files[path] !== 'string';
              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => setSelectedFile(path)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-mono text-xs cursor-pointer ${
                    active ? 'bg-blue-600/25 text-blue-100' : 'text-slate-300 hover:bg-[#171d29]'
                  }`}
                >
                  <span className="truncate">{path}</span>
                  {isBinary && <span className="text-[10px] text-slate-500">BIN</span>}
                </button>
              );
            })}
          </div>

          {/* Code Preview */}
          <div className="col-span-8 flex flex-col min-h-0 rounded border border-[#232b3b] bg-[#0b0e14] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#222938] bg-[#10141d] px-3 py-1.5 text-xs shrink-0">
              <span className="font-mono text-slate-200">{selectedFile}</span>
              <Button type="button" size="sm" variant="ghost" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                theme="vs-dark"
                language={detectLanguage(selectedFile)}
                value={activeContent}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  wordWrap: 'off',
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#222938] pt-3 shrink-0">
          <span className="font-mono text-[11px] text-slate-400 truncate max-w-[36%]">
            unzip {exportPkgName}.zip -d ~/ros2_ws/src && colcon build --packages-select{' '}
            {exportPkgName}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {scope !== 'robot' && (
              <>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span>Map Res:</span>
                  <select
                    aria-label="Map Texture Export Resolution"
                    data-testid="export-map-quality"
                    value={String(mapQuality)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMapQuality(
                        val === 'original' ? 'original' : (Number(val) as 2048 | 4096),
                      );
                    }}
                    className="h-8 rounded border border-[#2a3346] bg-[#0b0e14] px-2 text-xs font-medium text-slate-200 focus:border-blue-500 focus:outline-none cursor-pointer"
                  >
                    <option value="original">Original (Native)</option>
                    <option value="2048">2048 px (2K)</option>
                    <option value="4096">4096 px (4K Ultra)</option>
                  </select>
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={downloadingMap || exportingZip}
                  onClick={handleDownloadMapPng}
                  data-testid="export-download-map-png"
                  title="Download the full-quality ground map PNG to enhance/upscale before exporting"
                >
                  <ImageIcon className="h-3.5 w-3.5 text-emerald-400" />
                  {downloadingMap ? 'Rendering Map...' : 'Download Map PNG'}
                </Button>
              </>
            )}
            <Button type="button" variant="outline" onClick={() => setExportModalOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={exportingZip}
              onClick={handleDownloadZip}
              data-testid="export-download-zip"
            >
              <Download className="h-3.5 w-3.5" />
              {exportingZip
                ? 'Rendering High-Res...'
                : scope === 'world'
                  ? 'Download World (.zip)'
                  : scope === 'robot'
                    ? 'Download Robot (.zip)'
                    : 'Download Package (.zip)'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

