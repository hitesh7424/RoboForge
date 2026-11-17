import { useEffect, useRef } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { loadAutosavedProject, saveAutosaveProject } from '@/core/persistence';
import { useRoboForgeStore } from '@/core/store';
import { PartEditorModal } from '@/partEditor/PartEditorModal';
import { ExportModal } from '@/ui/ExportModal';
import { InspectorPanel } from '@/ui/InspectorPanel';
import { JointAttachDialog } from '@/ui/JointAttachDialog';
import { PartLibraryPanel } from '@/ui/PartLibraryPanel';
import { ProjectModal } from '@/ui/ProjectModal';
import { SceneTreePanel } from '@/ui/SceneTreePanel';
import { TopBar } from '@/ui/TopBar';
import { ValidationPanel } from '@/ui/ValidationPanel';
import { RobotViewport } from '@/viewport/RobotViewport';
import { UrdfPreviewViewport } from '@/viewport/UrdfPreviewViewport';
import { MujocoViewport } from '@/sim/MujocoViewport';
import { WorldViewport } from '@/world/WorldViewport';

export default function App() {
  const project = useRoboForgeStore((s) => s.project);
  const mode = useRoboForgeStore((s) => s.mode);
  const selection = useRoboForgeStore((s) => s.selection);
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
        if (selection?.type === 'link' && project.robot.links.length > 1) {
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
    project.robot.links.length,
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

      <div className="flex-1 min-h-0">
        <Group orientation="vertical" id="roboforge-root-vertical">
          <Panel id="workspace-main" defaultSize="78%" minSize="50%">
            <Group orientation="horizontal" id="roboforge-main-horizontal">
              <Panel id="left-sidebar" defaultSize="22%" minSize="15%" maxSize="36%">
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

              <Separator className="w-1 bg-[#1c2331] hover:bg-blue-500/60 transition-colors cursor-col-resize" />

              <Panel id="center-viewport" defaultSize="54%" minSize="30%">
                {mode === 'robot' && <RobotViewport />}
                {mode === 'world' && <WorldViewport />}
                {mode === 'preview' && <UrdfPreviewViewport />}
                {mode === 'simulate' && <MujocoViewport />}
              </Panel>

              <Separator className="w-1 bg-[#1c2331] hover:bg-blue-500/60 transition-colors cursor-col-resize" />

              <Panel id="right-inspector" defaultSize="24%" minSize="18%" maxSize="38%">
                <InspectorPanel />
              </Panel>
            </Group>
          </Panel>

          <Separator className="h-1 bg-[#1c2331] hover:bg-blue-500/60 transition-colors cursor-row-resize" />

          <Panel id="bottom-validation" defaultSize="22%" minSize="12%" maxSize="45%">
            <ValidationPanel />
          </Panel>
        </Group>
      </div>

      <ProjectModal />
      <ExportModal />
      <PartEditorModal />
      <JointAttachDialog />
    </div>
  );
}
