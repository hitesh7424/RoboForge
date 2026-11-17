import { useState, useRef, type ChangeEvent } from 'react';
import { Check, Copy, Download, RotateCcw, Upload } from 'lucide-react';
import { clearAutosavedProject, parseProjectJson, serializeProject } from '@/core/persistence';
import { useRoboForgeStore } from '@/core/store';
import { Button } from '@/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';

export function ProjectModal() {
  const isOpen = useRoboForgeStore((s) => s.isJsonModalOpen);
  const project = useRoboForgeStore((s) => s.project);
  const setJsonModalOpen = useRoboForgeStore((s) => s.setJsonModalOpen);
  const loadProject = useRoboForgeStore((s) => s.loadProject);
  const resetProject = useRoboForgeStore((s) => s.resetProject);
  const addLog = useRoboForgeStore((s) => s.addLog);

  const [jsonInput, setJsonInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const serialized = serializeProject(project);

  const handleDownloadJson = () => {
    const blob = new Blob([serialized], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name || 'roboforge_project'}.roboforge.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addLog('info', `Downloaded project JSON (${project.name}.roboforge.json).`);
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
    const result = parseProjectJson(raw);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    setImportError(null);
    loadProject(result.project, {
      logMessage: `Imported project "${result.project.name}" from JSON.`,
    });
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
            Export the single-source-of-truth Project JSON, import a saved file, or reset the
            workspace. Changes are also autosaved locally to IndexedDB.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-[#232b3b] py-3">
          <div className="flex items-center gap-2">
            <Button type="button" variant="default" size="sm" onClick={handleDownloadJson}>
              <Download className="h-3.5 w-3.5" />
              Download JSON
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
            Paste Project JSON to Import
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
