import { useMemo } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, PanelBottomClose, Trash2 } from 'lucide-react';
import { resolveLinkInertia } from '@/core/inertia';
import { validateProject, type ValidationIssue } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { Button } from '@/ui/components/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/tabs';

export function ValidationPanel() {
  const project = useRoboForgeStore((s) => s.project);
  const logs = useRoboForgeStore((s) => s.logs);
  const select = useRoboForgeStore((s) => s.select);
  const setMode = useRoboForgeStore((s) => s.setMode);
  const clearLogs = useRoboForgeStore((s) => s.clearLogs);
  const togglePanel = useRoboForgeStore((s) => s.togglePanel);

  const issues = useMemo(() => {
    const base = validateProject(project);
    for (const link of project.robot.links) {
      const inertia = resolveLinkInertia(link);
      for (let i = 0; i < inertia.warnings.length; i++) {
        base.push({
          id: `inertia-${link.id}-${i}`,
          severity: 'warning',
          message: `Link "${link.name}": ${inertia.warnings[i]}`,
          targetType: 'link',
          targetId: link.id,
        });
      }
    }
    return base;
  }, [project]);

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  const handleIssueClick = (issue: ValidationIssue) => {
    if (issue.targetType === 'link' && issue.targetId) {
      select({ type: 'link', id: issue.targetId });
    } else if (issue.targetType === 'joint' && issue.targetId) {
      select({ type: 'joint', id: issue.targetId });
    } else if (issue.targetType === 'sensor' && issue.targetId) {
      select({ type: 'sensor', id: issue.targetId });
    } else if (issue.targetType === 'plugin' && issue.targetId) {
      select({ type: 'plugin', id: issue.targetId });
    } else if (issue.targetType === 'worldObject' && issue.targetId) {
      setMode('world');
      select({ type: 'worldObject', id: issue.targetId });
    } else if (issue.targetType === 'world') {
      setMode('world');
      select({ type: 'world' });
    } else if (issue.targetType === 'robot') {
      select({ type: 'robot' });
    } else {
      select({ type: 'project' });
    }
  };

  return (
    <section aria-label="Validation and Export Log" className="flex h-full flex-col bg-[#10141d]">
      <Tabs defaultValue="validation" className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-[#222938] px-3 py-1.5 shrink-0">
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="validation">Validation</TabsTrigger>
              <TabsTrigger value="log">Export Log</TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2 text-xs tabular-nums">
              {errorCount === 0 && warningCount === 0 ? (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Valid project
                </span>
              ) : (
                <>
                  {errorCount > 0 && (
                    <span className="flex items-center gap-1 text-red-400">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {errorCount} {errorCount === 1 ? 'error' : 'errors'}
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span className="flex items-center gap-1 text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {warningCount} {warningCount === 1 ? 'warning' : 'warnings'}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearLogs}
              className="h-6 px-2 text-[11px] text-slate-400"
              aria-label="Clear log entries"
            >
              <Trash2 className="h-3 w-3" />
              Clear log
            </Button>
            <button
              type="button"
              onClick={() => togglePanel('bottom')}
              aria-label="Collapse bottom bar"
              title="Collapse bottom bar"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-[#1c2333] hover:text-slate-100 cursor-pointer"
            >
              <PanelBottomClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <TabsContent value="validation" className="flex-1 overflow-y-auto p-2">
          {issues.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-slate-400">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>
                All structural checks passed: valid ROS identifiers, unique names, positive
                dimensions/mass, physical inertia tensors, and connected kinematic tree.
              </span>
            </div>
          ) : (
            <ul className="space-y-1">
              {issues.map((issue) => (
                <li key={issue.id}>
                  <button
                    type="button"
                    onClick={() => handleIssueClick(issue)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[#1a2130] transition-colors cursor-pointer"
                  >
                    {issue.severity === 'error' ? (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    )}
                    <span
                      className={`font-medium shrink-0 ${
                        issue.severity === 'error' ? 'text-red-400' : 'text-amber-400'
                      }`}
                    >
                      {issue.severity === 'error' ? 'Error' : 'Warning'}
                    </span>
                    <span className="text-slate-200">{issue.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="log" className="flex-1 overflow-y-auto p-2">
          {logs.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-500">No log entries yet.</p>
          ) : (
            <ul className="space-y-1 font-mono text-[11px]">
              {logs.map((entry) => (
                <li key={entry.id} className="flex items-baseline gap-2.5 px-2 py-0.5">
                  <span className="text-slate-500 tabular-nums shrink-0">{entry.timestamp}</span>
                  <span
                    className={`shrink-0 ${
                      entry.level === 'error'
                        ? 'text-red-400'
                        : entry.level === 'warning'
                          ? 'text-amber-400'
                          : 'text-blue-400'
                    }`}
                  >
                    {entry.level.toUpperCase()}
                  </span>
                  <span className="text-slate-300">{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
