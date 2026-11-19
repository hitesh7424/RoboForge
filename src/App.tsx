import { useEffect, useRef } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { PanelBottomOpen, PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { loadAutosavedProject, saveAutosaveProject } from '@/core/persistence';
import { useRoboForgeStore } from '@/core/store';
import { PartEditorModal } from '@/partEditor/PartEditorModal';
import { MujocoViewport } from '@/sim/MujocoViewport';
import { ExportModal } from '@/ui/ExportModal';
import { InspectorPanel } from '@/ui/InspectorPanel';
import { JointAttachDialog } from '@/ui/JointAttachDialog';
import { MapAnnotatorModal } from '@/ui/MapAnnotatorModal';
import { PartLibraryPanel } from '@/ui/PartLibraryPanel';
import { ProjectModal } from '@/ui/ProjectModal';
import { SceneTreePanel } from '@/ui/SceneTreePanel';
import { TopBar } from '@/ui/TopBar';
import { ValidationPanel } from '@/ui/ValidationPanel';
import { RobotViewport } from '@/viewport/RobotViewport';
import { UrdfPreviewViewport } from '@/viewport/UrdfPreviewViewport';
import { WorldStudioPage } from '@/worldStudio/WorldStudioPage';

export default function App() {
  const project = useRoboForgeStore((s) => s.project);
  const mode = useRoboForgeStore((s) => s.mode);
  const selection = useRoboForgeStore((s) => s.selection);
  const collapsedPanels = useRoboForgeStore((s) => s.collapsedPanels);
  const setPanelCollapsed = useRoboForgeStore((s) => s.setPanelCollapsed);
  const loadProject = useRoboForgeStore((s) => s.loadProject);
  const setAutosaveStatus = useRoboForgeStore((s) => s.setAutosaveStatus);
  const undo = useRoboForgeStore((s) => s.undo);
  const redo = useRoboForgeStore((s) => s.redo);
  const setTransformMode = useRoboForgeStore((s) => s.setTransformMode);
  const triggerFocus = useRoboForgeStore((s) => s.triggerFocus);
  const duplicateLink = useRoboForgeStore((s) => s.duplicateLink);
  const deleteLink = useRoboForgeStore((s) => s.deleteLink);
  const deleteJoint = useRoboForgeStore((s) => s.deleteJoint);
  const deleteSensor = useRoboForgeStore((s) => s.deleteSensor);
  const deletePlugin = useRoboForgeStore((s) => s.deletePlugin);
  const deleteWorldObject = useRoboForgeStore((s) => s.deleteWorldObject);

  const hydratedRef = useRef(false);
  const skipNextSaveRef = useRef(false);

  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const bottomPanelRef = usePanelRef();

  // Sync collapsible panel store flags with react-resizable-panels imperative handles
  useEffect(() => {
    const panel = leftPanelRef.current;
    if (!panel) return;
    if (collapsedPanels.left && !panel.isCollapsed()) {
      panel.collapse();
    } else if (!collapsedPanels.left && panel.isCollapsed()) {
      panel.expand();
    }
  }, [collapsedPanels.left, leftPanelRef]);

  useEffect(() => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    if (collapsedPanels.right && !panel.isCollapsed()) {
      panel.collapse();
    } else if (!collapsedPanels.right && panel.isCollapsed()) {
      panel.expand();
    }
  }, [collapsedPanels.right, rightPanelRef]);

  useEffect(() => {
    const panel = bottomPanelRef.current;
    if (!panel) return;
    if (collapsedPanels.bottom && !panel.isCollapsed()) {
      panel.collapse();
    } else if (!collapsedPanels.bottom && panel.isCollapsed()) {
      panel.expand();
    }
  }, [collapsedPanels.bottom, bottomPanelRef]);

  // Hydrate autosaved project from IndexedDB on startup
  useEffect(() => {
    let active = true;
    loadAutosavedProject().then((saved) => {
      if (!active) return;
      hydratedRef.current = true;
      if (saved) {
        skipNextSaveRef.current = true;
        loadProject(saved, {
          clearHistory: true,
          logMessage: `Restored autosaved project "${saved.name}" from IndexedDB.`,
        });
        setAutosaveStatus('saved', new Date().toLocaleTimeString('en-US', { hour12: false }));
      }
    });
    return () => {
      active = false;
    };
  }, [loadProject, setAutosaveStatus]);

  // Debounced IndexedDB autosave on project mutations
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    setAutosaveStatus('saving');
    const timer = window.setTimeout(() => {
      saveAutosaveProject(project)
        .then(() => {
          setAutosaveStatus('saved', new Date().toLocaleTimeString('en-US', { hour12: false }));
        })
        .catch(() => {
          setAutosaveStatus('error');
        });
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [project, setAutosaveStatus]);

  // Global keyboard shortcuts when not typing in inputs/selects
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (isEditingText) return;

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          redo();
        } else if (key === 'd' && selection?.type === 'link') {
          e.preventDefault();
          duplicateLink(selection.id);
        }
        return;
      }

      if (key === 'w') {
        setTransformMode('translate');
      } else if (key === 'e') {
        setTransformMode('rotate');
      } else if (key === 'r') {
        setTransformMode('scale');
      } else if (key === 'f') {
        triggerFocus();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection?.type === 'link') {
          deleteLink(selection.id);
        } else if (selection?.type === 'joint') {
          deleteJoint(selection.id);
        } else if (selection?.type === 'sensor') {
          deleteSensor(selection.id);
        } else if (selection?.type === 'plugin') {
          deletePlugin(selection.id);
        } else if (selection?.type === 'worldObject') {
          deleteWorldObject(selection.id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    undo,
    redo,
    selection,
    setTransformMode,
    triggerFocus,
    duplicateLink,
    deleteLink,
    deleteJoint,
    deleteSensor,
    deletePlugin,
    deleteWorldObject,
  ]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0c0f14] text-slate-100">
      <TopBar />

      {mode === 'world_studio' ? (
        <WorldStudioPage />
      ) : (
        <div className="relative flex-1 min-h-0">
        <Group orientation="vertical" id="roboforge-root-vertical">
          <Panel id="workspace-main" defaultSize="78%" minSize="50%">
            <Group orientation="horizontal" id="roboforge-main-horizontal">
              <Panel
                panelRef={leftPanelRef}
                id="left-sidebar"
                defaultSize="22%"
                minSize="15%"
                maxSize="36%"
                collapsible
                collapsedSize="0%"
                onResize={(size) => {
                  const isCol = size.asPercentage <= 0.5 || size.inPixels <= 2;
                  if (isCol !== collapsedPanels.left) {
                    setPanelCollapsed('left', isCol);
                  }
                }}
              >
                <Group orientation="vertical" id="roboforge-left-vertical">
                  <Panel id="part-library-panel" defaultSize="54%" minSize="25%">
                    <PartLibraryPanel />
                  </Panel>
                  <Separator className="h-1 bg-[#1c2331] hover:bg-blue-500/60 transition-colors cursor-row-resize" />
                  <Panel id="scene-tree-panel" defaultSize="46%" minSize="25%">
                    <SceneTreePanel />
                  </Panel>
                </Group>
              </Panel>

              <Separator
                className={`${
                  collapsedPanels.left ? 'w-0.5' : 'w-1'
                } bg-[#1c2331] hover:bg-blue-500/60 transition-colors cursor-col-resize`}
              />

              <Panel id="center-viewport" defaultSize="54%" minSize="30%">
                <div className="relative h-full w-full">
                  {mode === 'robot' && <RobotViewport />}
                  {mode === 'world' && <MujocoViewport />}
                  {mode === 'preview' && <UrdfPreviewViewport />}

                  {collapsedPanels.left && (
                    <button
                      type="button"
                      onClick={() => setPanelCollapsed('left', false)}
                      aria-label="Expand left sidebar"
                      title="Expand Left Sidebar"
                      className="absolute left-0 top-1/2 -translate-y-1/2 z-20 flex h-10 w-5 items-center justify-center rounded-r border border-l-0 border-[#2a3346] bg-[#10141d] text-slate-300 hover:bg-[#1a202e] hover:text-blue-300 cursor-pointer"
                    >
                      <PanelLeftOpen className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {collapsedPanels.right && (
                    <button
                      type="button"
                      onClick={() => setPanelCollapsed('right', false)}
                      aria-label="Expand right inspector"
                      title="Expand Right Inspector"
                      className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex h-10 w-5 items-center justify-center rounded-l border border-r-0 border-[#2a3346] bg-[#10141d] text-slate-300 hover:bg-[#1a202e] hover:text-blue-300 cursor-pointer"
                    >
                      <PanelRightOpen className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {collapsedPanels.bottom && (
                    <button
                      type="button"
                      onClick={() => setPanelCollapsed('bottom', false)}
                      aria-label="Expand bottom bar"
                      title="Expand Validation & Export Log"
                      className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 flex h-5 items-center gap-1 rounded-t border border-b-0 border-[#2a3346] bg-[#10141d] px-2.5 text-[10px] font-mono text-slate-300 hover:bg-[#1a202e] hover:text-blue-300 cursor-pointer"
                    >
                      <PanelBottomOpen className="h-3 w-3" />
                      Log
                    </button>
                  )}
                </div>
              </Panel>

              <Separator
                className={`${
                  collapsedPanels.right ? 'w-0.5' : 'w-1'
                } bg-[#1c2331] hover:bg-blue-500/60 transition-colors cursor-col-resize`}
              />

              <Panel
                panelRef={rightPanelRef}
                id="right-inspector"
                defaultSize="24%"
                minSize="18%"
                maxSize="38%"
                collapsible
                collapsedSize="0%"
                onResize={(size) => {
                  const isCol = size.asPercentage <= 0.5 || size.inPixels <= 2;
                  if (isCol !== collapsedPanels.right) {
                    setPanelCollapsed('right', isCol);
                  }
                }}
              >
                <InspectorPanel />
              </Panel>
            </Group>
          </Panel>

          <Separator
            className={`${
              collapsedPanels.bottom ? 'h-0.5' : 'h-1'
            } bg-[#1c2331] hover:bg-blue-500/60 transition-colors cursor-row-resize`}
          />

          <Panel
            panelRef={bottomPanelRef}
            id="bottom-validation"
            defaultSize="22%"
            minSize="12%"
            maxSize="45%"
            collapsible
            collapsedSize="0%"
            onResize={(size) => {
              const isCol = size.asPercentage <= 0.5 || size.inPixels <= 2;
              if (isCol !== collapsedPanels.bottom) {
                setPanelCollapsed('bottom', isCol);
              }
            }}
          >
            <ValidationPanel />
          </Panel>
        </Group>
      </div>
      )}

      <ProjectModal />
      <ExportModal />
      <PartEditorModal />
      <JointAttachDialog />
      <MapAnnotatorModal />
      <Analytics />
    </div>
  );
}
