import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Bot, Check, Copy, Download, Globe, Layers, RotateCcw, Upload } from 'lucide-react';
import {
  clearAutosavedProject,
  getScopedJsonFilename,
  parseScopedProjectJson,
  serializeScopedProject,
  type JsonExportScope,
} from '@/core/persistence';
import { useRoboForgeStore } from '@/core/store';
import { Button } from '@/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';

const JSON_SCOPE_OPTIONS: {
  id: JsonExportScope;
  label: string;
  subtitle: string;
  icon: typeof Layers;
}[] = [
  {
    id: 'full',
    label: 'Full',
    subtitle: 'Robot Model + World',
    icon: Layers,
  },
  {
    id: 'model',
    label: 'Model',
    subtitle: 'Robot, Meshes & Textures',
    icon: Bot,
  },
  {
    id: 'world',
    label: 'World',
    subtitle: 'Map, Zones & Obstacles',
    icon: Globe,
  },
];

export function ProjectModal() {
  const isOpen = useRoboForgeStore((s) => s.isJsonModalOpen);
  const project = useRoboForgeStore((s) => s.project);
  const setJsonModalOpen = useRoboForgeStore((s) => s.setJsonModalOpen);
  const loadProject = useRoboForgeStore((s) => s.loadProject);
  const resetProject = useRoboForgeStore((s) => s.resetProject);
  const addLog = useRoboForgeStore((s) => s.addLog);

  const [exportScope, setExportScope] = useState<JsonExportScope>('full');
  const [jsonInput, setJsonInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const serialized = useMemo(
    () => serializeScopedProject(project, exportScope),
    [project, exportScope],
  );
  const downloadFilename = getScopedJsonFilename(project, exportScope);

  const handleDownloadJson = () => {
    const blob = new Blob([serialized], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addLog('info', `Downloaded ${exportScope} JSON (${downloadFilename}).`);
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(serialized);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      addLog('warning', 'Clipboard copy failed; download the JSON file instead.');
    }
  };

  const handleImportText = (raw: string) => {
    const result = parseScopedProjectJson(raw, project);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    setImportError(null);
    const logMessage =
      result.scope === 'model'
        ? `Imported robot model "${result.project.robot.name}" from JSON (world preserved).`
        : result.scope === 'world'
          ? `Imported world "${result.project.world.name}" from JSON (robot model preserved).`
          : `Imported full project "${result.project.name}" from JSON.`;
    loadProject(result.project, { logMessage });
    setJsonInput('');
    setJsonModalOpen(false);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setJsonInput(text);
    handleImportText(text);
    e.target.value = '';
  };

  const handleReset = async () => {
    await clearAutosavedProject();
    resetProject();
    setConfirmReset(false);
    setJsonModalOpen(false);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setJsonModalOpen(open);
        if (!open) {
          setImportError(null);
          setConfirmReset(false);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Project Save / Load JSON</DialogTitle>
          <DialogDescription>
            Export the Full project, Robot Model only, or World only as JSON, or import any saved
            JSON file. Changes are also autosaved locally to IndexedDB.
          </DialogDescription>
        </DialogHeader>

        {/* Export JSON Scope Selector: Full vs Model vs World */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="font-medium text-slate-300">JSON Export Scope</span>
            <span className="font-mono text-[10px] text-slate-400 truncate max-w-[280px]">
              {downloadFilename}
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label="Project JSON export scope"
            className="grid grid-cols-3 gap-2"
          >
            {JSON_SCOPE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = exportScope === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`project-json-scope-${opt.id}`}
                  onClick={() => setExportScope(opt.id)}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-blue-500 bg-blue-600/15 text-slate-100'
                      : 'border-[#232b3b] bg-[#0d1118] text-slate-400 hover:border-[#34415a] hover:text-slate-200'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? 'text-blue-400' : 'text-slate-500'}`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold leading-tight">{opt.label}</div>
                    <div className="truncate text-[10px] text-slate-400">{opt.subtitle}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-[#232b3b] py-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleDownloadJson}
              data-testid="project-download-json"
            >
              <Download className="h-3.5 w-3.5" />
              {exportScope === 'model'
                ? 'Download Model JSON'
                : exportScope === 'world'
                  ? 'Download World JSON'
                  : 'Download Full JSON'}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleCopyJson}>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Copy JSON'}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Load .json File
            </Button>

            {!confirmReset ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmReset(true)}
                className="text-red-400 hover:text-red-300"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Project
              </Button>
            ) : (
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="destructive" size="sm" onClick={handleReset}>
                  Confirm Reset
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="import-json-textarea" className="text-xs font-medium text-slate-300">
            Paste Full, Model, or World JSON to Import
          </label>
          <textarea
            id="import-json-textarea"
            rows={8}
            value={jsonInput}
            onChange={(e) => {
              setJsonInput(e.target.value);
              if (importError) setImportError(null);
            }}
            placeholder={serialized.slice(0, 260) + '\n  ...'}
            className="w-full rounded border border-[#2a3346] bg-[#0b0e14] p-2.5 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {importError && (
            <p role="alert" className="text-xs text-red-400">
              {importError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!jsonInput.trim()}
              onClick={() => handleImportText(jsonInput)}
            >
              Import Pasted JSON
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
