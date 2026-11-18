import { useEffect, useMemo, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { AlertCircle, Check, CheckCircle2, Copy, Download, FileCode } from 'lucide-react';
import { downloadMapTilesTextureBase64 } from '@/core/mapTiles';
import { validateProject } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { downloadRos2PackageZip, exportRos2Package } from '@/exporters';
import { getTargetConfig } from '@/exporters/targets';
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

export function ExportModal() {
  const project = useRoboForgeStore((s) => s.project);
  const isOpen = useRoboForgeStore((s) => s.isExportModalOpen);
  const setExportModalOpen = useRoboForgeStore((s) => s.setExportModalOpen);
  const setMapTileTexture = useRoboForgeStore((s) => s.setMapTileTexture);
  const addLog = useRoboForgeStore((s) => s.addLog);

  const [selectedFile, setSelectedFile] = useState<string>('package.xml');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const mapBg = project.world.mapBackground;
    if (!project.world.ground.enabled || !mapBg?.enabled || mapBg.mapTextureBase64) return;

    let cancelled = false;
    void downloadMapTilesTextureBase64(mapBg, 512).then((res) => {
      if (cancelled || !res?.base64) return;
      setMapTileTexture(res.base64);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, project.world.ground.enabled, project.world.mapBackground, setMapTileTexture]);

  const files = useMemo(() => exportRos2Package(project), [project]);
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
        ? `Binary package asset (${selectedFile}, ${selectedEntry.byteLength.toLocaleString()} bytes) bundled in ${project.name}.zip.`
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
    try {
      const exportedPaths = await downloadRos2PackageZip(project, setMapTileTexture);
      addLog(
        'info',
        `Exported ROS 2 package "${project.name}.zip" (${exportedPaths.length} files for ${target.label}).`,
      );
    } catch (err) {
      addLog('error', `ZIP export failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setExportModalOpen}>
      <DialogContent className="max-w-5xl h-[84vh] flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-blue-400" />
            Export ROS 2 Package ({project.name})
          </DialogTitle>
          <DialogDescription>
            Target: {target.label} · SDF {target.sdfVersion} · {Object.keys(files).length} package
            files generated directly from the scene graph.
          </DialogDescription>
        </DialogHeader>

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
            <span>All structural & ROS identifier checks passed. Ready to build with colcon.</span>
          </div>
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

        <div className="flex items-center justify-between border-t border-[#222938] pt-3 shrink-0">
          <span className="font-mono text-[11px] text-slate-400">
            unzip {project.name}.zip -d ~/ros2_ws/src && colcon build --packages-select{' '}
            {project.name}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setExportModalOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={handleDownloadZip}>
              <Download className="h-3.5 w-3.5" />
              Download ROS 2 Package (.zip)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
