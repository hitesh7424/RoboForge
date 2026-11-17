import { current } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  createDefaultProject,
  createId,
  createPrimitiveLink,
  createZeroPose,
} from '@/core/defaults';
import { DEFAULT_MAP_BACKGROUND } from '@/core/mapTiles';
import type {
  Asset,
  CustomPart,
  Joint,
  Light,
  Link,
  Mount,
  Plugin,
  Pose,
  Primitive,
  Project,
  Sensor,
  TargetDistro,
  TextureAsset,
  Vec3,
  World,
  WorldObject,
  WorldObjectSource,
} from '@/core/schema';
import { createFourWheelRoverProject } from '@/core/templates';

import {
  loadSavedUnitPreferences,
  saveUnitPreferences,
  type UnitPreferences,
} from '@/core/units';

export type WorkspaceMode = 'robot' | 'world' | 'preview';
export type PanelKey = 'left' | 'right' | 'bottom';
export type UnitSystem = UnitPreferences;
export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'local' | 'world';
export type LinkEditFrame = 'mount' | 'visual';
export type ViewOverlay = 'visual' | 'collision' | 'inertial';
export type CameraProjection = 'perspective' | 'orthographic';
export type CameraViewPreset = 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
export type WorldCameraMode = 'perspective' | 'top';

export type SelectionTarget =
  | { type: 'project' }
  | { type: 'robot' }
  | { type: 'link'; id: string }
  | { type: 'mount'; linkId: string; mountId: string }
  | { type: 'joint'; id: string }
  | { type: 'sensor'; id: string }
  | { type: 'plugin'; id: string }
  | { type: 'world' }
  | { type: 'worldObject'; id: string }
  | { type: 'worldLight'; id: string }
  | null;

export interface PendingJointAttach {
  parentLinkId: string;
  parentMountId: string;
  childLinkId: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

const MAX_HISTORY = 50;

export interface RoboForgeState {
  project: Project;
  past: Project[];
  future: Project[];

  mode: WorkspaceMode;
  units: UnitPreferences;
  selection: SelectionTarget;
  transformMode: TransformMode;
  transformSpace: TransformSpace;
  linkEditFrame: LinkEditFrame;
  viewOverlay: ViewOverlay;
  snapTranslate: number;
  snapRotateDeg: number;
  cameraProjection: CameraProjection;
  cameraView: CameraViewPreset;
  cameraPresetTrigger: number;
  worldCameraMode: WorldCameraMode;
  focusTrigger: number;
  pendingJointAttach: PendingJointAttach | null;

  collapsedPanels: Record<PanelKey, boolean>;
  simTrackTarget: string; // 'none' | 'robot' | `object:${id}` | `link:${id}`
  showLidarVis: boolean;
  showCameraVis: boolean;

  isJsonModalOpen: boolean;
  isExportModalOpen: boolean;
  isPartEditorOpen: boolean;
  isMapAnnotatorOpen: boolean;
  editingCustomPartId: string | null;

  autosaveStatus: AutosaveStatus;
  lastSavedAt: string | null;
  logs: LogEntry[];

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // UI & workspace state
  setMode: (mode: WorkspaceMode) => void;
  setUnits: (units: UnitPreferences) => void;
  setUnitPref: <K extends keyof UnitPreferences>(key: K, value: UnitPreferences[K]) => void;
  select: (target: SelectionTarget) => void;
  setTransformMode: (mode: TransformMode) => void;
  setTransformSpace: (space: TransformSpace) => void;
  setLinkEditFrame: (frame: LinkEditFrame) => void;
  setViewOverlay: (overlay: ViewOverlay) => void;
  setSnapTranslate: (step: number) => void;
  setSnapRotateDeg: (deg: number) => void;
  setCameraProjection: (proj: CameraProjection) => void;
  setCameraView: (view: CameraViewPreset) => void;
  setWorldCameraMode: (mode: WorldCameraMode) => void;
  triggerFocus: () => void;
  setPendingJointAttach: (pending: PendingJointAttach | null) => void;
  setPanelCollapsed: (panel: PanelKey, collapsed: boolean) => void;
  togglePanel: (panel: PanelKey) => void;
  setSimTrackTarget: (target: string) => void;
  setShowLidarVis: (show: boolean) => void;
  setShowCameraVis: (show: boolean) => void;

  setJsonModalOpen: (open: boolean) => void;
  setExportModalOpen: (open: boolean) => void;
  setMapAnnotatorOpen: (open: boolean) => void;
  openPartEditor: (customPartId?: string | null) => void;
  closePartEditor: () => void;

  setAutosaveStatus: (status: AutosaveStatus, timestamp?: string) => void;
  addLog: (level: LogEntry['level'], message: string) => void;
  clearLogs: () => void;

  // Project mutations
  setProjectName: (name: string) => void;
  setRobotName: (name: string) => void;
  setTarget: (target: TargetDistro) => void;

  // Link & Mount mutations
  addLink: (
    shape: Primitive,
    baseName?: string,
    options?: {
      pose?: Pose;
      attachTo?: { parentLinkId: string; parentMountId: string; jointType?: Joint['type'] };
    },
  ) => Link;
  updateLink: (linkId: string, updater: (link: Link) => void) => void;
  duplicateLink: (linkId: string) => Link | null;
  mirrorLinkAcrossY: (linkId: string) => Link | null;
  deleteLink: (linkId: string) => void;
  setRootLink: (linkId: string) => void;
  addMountToLink: (linkId: string, name: string, pose?: Pose) => Mount | null;
  updateMountOnLink: (linkId: string, mountId: string, updater: (mount: Mount) => void) => void;
  deleteMountFromLink: (linkId: string, mountId: string) => void;
  applyCustomPartToLink: (linkId: string, part: CustomPart) => void;
  assignAssetVisualToLink: (linkId: string, assetId: string, scale?: Vec3) => void;

  // Joint mutations
  addJoint: (
    parentLinkId: string,
    parentMountId: string,
    childLinkId: string,
    childMountId?: string,
    type?: Joint['type'],
    name?: string,
  ) => Joint | null;
  updateJoint: (jointId: string, updater: (joint: Joint) => void) => void;
  deleteJoint: (jointId: string) => void;
  reparentLink: (childLinkId: string, newParentLinkId: string, newParentMountId?: string) => void;

  // Sensor & Plugin mutations
  addSensor: (kind: Sensor['kind'], linkId: string, mountId: string) => Sensor | null;
  updateSensor: (sensorId: string, updater: (sensor: Sensor) => void) => void;
  deleteSensor: (sensorId: string) => void;
  addPlugin: (kind: Plugin['kind']) => Plugin;
  updatePlugin: (pluginId: string, updater: (plugin: Plugin) => void) => void;
  deletePlugin: (pluginId: string) => void;

  // World mutations
  updateWorld: (updater: (world: World) => void) => void;
  setTerrainElevation: (
    grid: number[] | undefined,
    gridSize?: number,
    centerElevation?: number,
  ) => void;
  addWorldObject: (
    name: string,
    source: WorldObjectSource,
    pose?: Pose,
    isStatic?: boolean,
    mass?: number,
  ) => WorldObject;
  updateWorldObject: (objectId: string, updater: (obj: WorldObject) => void) => void;
  deleteWorldObject: (objectId: string) => void;
  addWorldLight: (type: Light['type']) => Light;
  updateWorldLight: (lightId: string, updater: (light: Light) => void) => void;
  deleteWorldLight: (lightId: string) => void;

  // Custom Parts, Mesh Assets & Textures
  saveCustomPart: (part: CustomPart) => void;
  deleteCustomPart: (partId: string) => void;
  addAsset: (asset: Asset) => void;
  addTexture: (texture: TextureAsset) => void;
  deleteTexture: (textureId: string) => void;

  loadProject: (
    project: Project,
    options?: { clearHistory?: boolean; logMessage?: string },
  ) => void;
  resetProject: () => void;
}

function makeLog(level: LogEntry['level'], message: string): LogEntry {
  return {
    id: createId(),
    timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
    level,
    message,
  };
}

export function sanitizeUniqueName(desired: string, existing: Set<string>): string {
  const cleaned = desired
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^[^a-z]+/, 'part_');
  const base = cleaned || 'item';
  if (!existing.has(base)) return base;
  let index = 1;
  while (existing.has(`${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
}

export const useRoboForgeStore = create<RoboForgeState>()(
  immer((set, get) => {
    const initialProject = createFourWheelRoverProject('jazzy-harmonic');

    const commitProject = (recipe: (draftProject: Project) => void) => {
      set((state) => {
        state.past.push(current(state.project));
        if (state.past.length > MAX_HISTORY) {
          state.past.shift();
        }
        state.future = [];
        recipe(state.project);
      });
    };

    const reconcileSelection = (state: RoboForgeState, project: Project) => {
      const sel = state.selection;
      if (!sel) return;
      if (sel.type === 'link' && !project.robot.links.some((l) => l.id === sel.id)) {
        state.selection = project.robot.links[0]
          ? { type: 'link', id: project.robot.links[0].id }
          : null;
      } else if (sel.type === 'joint' && !project.robot.joints.some((j) => j.id === sel.id)) {
        state.selection = project.robot.links[0]
          ? { type: 'link', id: project.robot.links[0].id }
          : null;
      } else if (sel.type === 'sensor' && !project.robot.sensors.some((s) => s.id === sel.id)) {
        state.selection = project.robot.links[0]
          ? { type: 'link', id: project.robot.links[0].id }
          : null;
      } else if (sel.type === 'plugin' && !project.robot.plugins.some((p) => p.id === sel.id)) {
        state.selection = null;
      } else if (
        sel.type === 'worldObject' &&
        !project.world.objects.some((o) => o.id === sel.id)
      ) {
        state.selection = { type: 'world' };
      }
    };

    return {
      project: initialProject,
      past: [],
      future: [],

      mode: 'robot',
      units: loadSavedUnitPreferences(),
      selection: initialProject.robot.links[0]
        ? { type: 'link', id: initialProject.robot.links[0].id }
        : null,
      transformMode: 'translate',
      transformSpace: 'local',
      linkEditFrame: 'mount',
      viewOverlay: 'visual',
      snapTranslate: 0.02,
      snapRotateDeg: 15,
      cameraProjection: 'perspective',
      cameraView: 'iso',
      cameraPresetTrigger: 0,
      worldCameraMode: 'perspective',
      focusTrigger: 0,
      pendingJointAttach: null,

      collapsedPanels: { left: false, right: false, bottom: false },
      simTrackTarget: 'none',
      showLidarVis: false,
      showCameraVis: false,

      isJsonModalOpen: false,
      isExportModalOpen: false,
      isPartEditorOpen: false,
      isMapAnnotatorOpen: false,
      editingCustomPartId: null,

      autosaveStatus: 'idle',
      lastSavedAt: null,
      logs: [
        makeLog(
          'info',
          'Loaded starter 4-wheel differential drive rover (ROS 2 Jazzy + Gazebo Harmonic).',
        ),
      ],

      undo: () => {
        set((state) => {
          const previous = state.past.pop();
          if (!previous) return;
          state.future.unshift(current(state.project));
          state.project = previous;
          reconcileSelection(state, previous);
        });
      },

      redo: () => {
        set((state) => {
          const next = state.future.shift();
          if (!next) return;
          state.past.push(current(state.project));
          state.project = next;
          reconcileSelection(state, next);
        });
      },

      canUndo: () => get().past.length > 0,
      canRedo: () => get().future.length > 0,

      setMode: (mode) =>
        set((state) => {
          state.mode = mode;
          if (mode === 'world' && state.selection?.type !== 'worldObject') {
            state.selection = { type: 'world' };
          }
        }),
      setUnits: (units) =>
        set((state) => {
          state.units = units;
          saveUnitPreferences(units);
        }),
      setUnitPref: (key, value) =>
        set((state) => {
          state.units[key] = value;
          saveUnitPreferences(state.units);
        }),
      select: (target) => set((state) => void (state.selection = target)),
      setTransformMode: (m) => set((state) => void (state.transformMode = m)),
      setTransformSpace: (s) => set((state) => void (state.transformSpace = s)),
      setLinkEditFrame: (f) => set((state) => void (state.linkEditFrame = f)),
      setViewOverlay: (v) => set((state) => void (state.viewOverlay = v)),
      setSnapTranslate: (step) => set((state) => void (state.snapTranslate = step)),
      setSnapRotateDeg: (deg) => set((state) => void (state.snapRotateDeg = deg)),
      setCameraProjection: (proj) => set((state) => void (state.cameraProjection = proj)),
      setCameraView: (view) =>
        set((state) => {
          state.cameraView = view;
          state.cameraPresetTrigger += 1;
        }),
      setWorldCameraMode: (m) =>
        set((state) => {
          state.worldCameraMode = m;
          state.cameraProjection = m === 'top' ? 'orthographic' : 'perspective';
          state.cameraView = m === 'top' ? 'top' : 'iso';
          state.cameraPresetTrigger += 1;
        }),
      triggerFocus: () => set((state) => void (state.focusTrigger += 1)),
      setPendingJointAttach: (pending) => set((state) => void (state.pendingJointAttach = pending)),
      setPanelCollapsed: (panel, collapsed) =>
        set((state) => {
          state.collapsedPanels[panel] = collapsed;
        }),
      togglePanel: (panel) =>
        set((state) => {
          state.collapsedPanels[panel] = !state.collapsedPanels[panel];
        }),
      setSimTrackTarget: (target) => set((state) => void (state.simTrackTarget = target)),
      setShowLidarVis: (show) => set((state) => void (state.showLidarVis = show)),
      setShowCameraVis: (show) => set((state) => void (state.showCameraVis = show)),

      setJsonModalOpen: (open) => set((state) => void (state.isJsonModalOpen = open)),
      setExportModalOpen: (open) => set((state) => void (state.isExportModalOpen = open)),
      setMapAnnotatorOpen: (open) => set((state) => void (state.isMapAnnotatorOpen = open)),
      openPartEditor: (customPartId = null) =>
        set((state) => {
          state.isPartEditorOpen = true;
          state.editingCustomPartId = customPartId;
        }),
      closePartEditor: () =>
        set((state) => {
          state.isPartEditorOpen = false;
          state.editingCustomPartId = null;
        }),

      setAutosaveStatus: (status, timestamp) =>
        set((state) => {
          state.autosaveStatus = status;
          if (timestamp) {
            state.lastSavedAt = timestamp;
          }
        }),

      addLog: (level, message) =>
        set((state) => {
          state.logs.unshift(makeLog(level, message));
          if (state.logs.length > 120) {
            state.logs.pop();
          }
        }),

      clearLogs: () => set((state) => void (state.logs = [])),

      setProjectName: (name) => {
        commitProject((project) => {
          project.name = name;
        });
      },

      setRobotName: (name) => {
        commitProject((project) => {
          project.robot.name = name;
        });
      },

      setTarget: (target) => {
        commitProject((project) => {
          project.target = target;
        });
        get().addLog('info', `Switched target environment to ${target}.`);
      },

      addLink: (shape, baseName, options) => {
        const existingNames = new Set(get().project.robot.links.map((l) => l.name));
        const linkName = sanitizeUniqueName(baseName ?? `${shape.kind}_link`, existingNames);
        const newLink = createPrimitiveLink(linkName, shape);
        if (options?.pose) {
          newLink.visual.pose = options.pose;
        }

        let createdJoint: Joint | null = null;

        commitProject((project) => {
          project.robot.links.push(newLink);
          if (!project.robot.rootLinkId) {
            project.robot.rootLinkId = newLink.id;
          }
          if (options?.attachTo) {
            const parentLink = project.robot.links.find(
              (l) => l.id === options.attachTo?.parentLinkId,
            );
            const parentMount = parentLink?.mounts.find(
              (m) => m.id === options.attachTo?.parentMountId,
            );
            const childMount = newLink.mounts[0];
            if (parentLink && parentMount && childMount) {
              const jNames = new Set(project.robot.joints.map((j) => j.name));
              createdJoint = {
                id: createId(),
                name: sanitizeUniqueName(`${linkName}_joint`, jNames),
                type: options.attachTo.jointType ?? 'fixed',
                parent: { linkId: parentLink.id, mountId: parentMount.id },
                child: { linkId: newLink.id, mountId: childMount.id },
                axis: [0, 1, 0],
              };
              project.robot.joints.push(createdJoint);
            }
          }
        });

        set((state) => {
          state.selection = { type: 'link', id: newLink.id };
          state.logs.unshift(
            makeLog(
              'info',
              createdJoint
                ? `Added link "${newLink.name}" attached via joint "${createdJoint.name}".`
                : `Added link "${newLink.name}" (${shape.kind}).`,
            ),
          );
        });

        return newLink;
      },

      updateLink: (linkId, updater) => {
        commitProject((project) => {
          const link = project.robot.links.find((l) => l.id === linkId);
          if (link) {
            updater(link);
          }
        });
      },

      duplicateLink: (linkId) => {
        const source = get().project.robot.links.find((l) => l.id === linkId);
        if (!source) return null;

        const existingNames = new Set(get().project.robot.links.map((l) => l.name));
        const copyName = sanitizeUniqueName(`${source.name}_copy`, existingNames);
        const cloned: Link = {
          ...structuredClone(source),
          id: createId(),
          name: copyName,
          mounts: source.mounts.map((m) => ({
            ...structuredClone(m),
            id: createId(),
          })),
        };

        commitProject((project) => {
          project.robot.links.push(cloned);
        });

        set((state) => {
          state.selection = { type: 'link', id: cloned.id };
          state.logs.unshift(
            makeLog('info', `Duplicated link "${source.name}" as "${cloned.name}".`),
          );
        });

        return cloned;
      },

      mirrorLinkAcrossY: (linkId) => {
        const state = get();
        const source = state.project.robot.links.find((l) => l.id === linkId);
        if (!source) return null;

        const existingNames = new Set(state.project.robot.links.map((l) => l.name));
        const guessedName = source.name.includes('left')
          ? source.name.replace('left', 'right')
          : source.name.includes('right')
            ? source.name.replace('right', 'left')
            : `${source.name}_mirror`;
        const mirrorName = sanitizeUniqueName(guessedName, existingNames);

        const cloned: Link = {
          ...structuredClone(source),
          id: createId(),
          name: mirrorName,
          visual: {
            ...structuredClone(source.visual),
            pose: {
              xyz: [
                source.visual.pose.xyz[0],
                -source.visual.pose.xyz[1],
                source.visual.pose.xyz[2],
              ],
              rpy: [
                source.visual.pose.rpy[0],
                source.visual.pose.rpy[1],
                -source.visual.pose.rpy[2],
              ],
            },
          },
          mounts: source.mounts.map((m) => ({
            ...structuredClone(m),
            id: createId(),
            pose: {
              xyz: [m.pose.xyz[0], -m.pose.xyz[1], m.pose.xyz[2]],
              rpy: [m.pose.rpy[0], m.pose.rpy[1], -m.pose.rpy[2]],
            },
          })),
        };

        // Check if source had a parent joint and mirror that attachment across Y if possible
        const parentJoint = state.project.robot.joints.find((j) => j.child.linkId === linkId);

        commitProject((project) => {
          project.robot.links.push(cloned);
          if (parentJoint) {
            const parentLink = project.robot.links.find((l) => l.id === parentJoint.parent.linkId);
            const srcParentMount = parentLink?.mounts.find(
              (m) => m.id === parentJoint.parent.mountId,
            );
            if (parentLink && srcParentMount && cloned.mounts[0]) {
              const pMountNames = new Set(parentLink.mounts.map((m) => m.name));
              const mNameGuess = srcParentMount.name.includes('left')
                ? srcParentMount.name.replace('left', 'right')
                : srcParentMount.name.includes('right')
                  ? srcParentMount.name.replace('right', 'left')
                  : `${srcParentMount.name}_mirror`;
              const mirroredMount: Mount = {
                id: createId(),
                name: sanitizeUniqueName(mNameGuess, pMountNames),
                pose: {
                  xyz: [
                    srcParentMount.pose.xyz[0],
                    -srcParentMount.pose.xyz[1],
                    srcParentMount.pose.xyz[2],
                  ],
                  rpy: [
                    srcParentMount.pose.rpy[0],
                    srcParentMount.pose.rpy[1],
                    -srcParentMount.pose.rpy[2],
                  ],
                },
              };
              parentLink.mounts.push(mirroredMount);

              const jNames = new Set(project.robot.joints.map((j) => j.name));
              const jGuess = parentJoint.name.includes('left')
                ? parentJoint.name.replace('left', 'right')
                : parentJoint.name.includes('right')
                  ? parentJoint.name.replace('right', 'left')
                  : `${parentJoint.name}_mirror`;
              project.robot.joints.push({
                ...structuredClone(parentJoint),
                id: createId(),
                name: sanitizeUniqueName(jGuess, jNames),
                parent: { linkId: parentLink.id, mountId: mirroredMount.id },
                child: { linkId: cloned.id, mountId: cloned.mounts[0].id },
              });
            }
          }
        });

        set((s) => {
          s.selection = { type: 'link', id: cloned.id };
          s.logs.unshift(
            makeLog('info', `Mirrored "${source.name}" across Y as "${cloned.name}".`),
          );
        });

        return cloned;
      },

      deleteLink: (linkId) => {
        const currentState = get().project;
        const target = currentState.robot.links.find((l) => l.id === linkId);
        if (!target) return;

        commitProject((project) => {
          const removedJointIds = new Set(
            project.robot.joints
              .filter((j) => j.parent.linkId === linkId || j.child.linkId === linkId)
              .map((j) => j.id),
          );
          project.robot.links = project.robot.links.filter((l) => l.id !== linkId);
          project.robot.joints = project.robot.joints.filter((j) => !removedJointIds.has(j.id));
          project.robot.sensors = project.robot.sensors.filter((s) => s.linkId !== linkId);
          for (const plugin of project.robot.plugins) {
            if (plugin.kind === 'diff_drive') {
              plugin.leftJointIds = plugin.leftJointIds.filter((id) => !removedJointIds.has(id));
              plugin.rightJointIds = plugin.rightJointIds.filter((id) => !removedJointIds.has(id));
            }
          }
          if (project.robot.rootLinkId === linkId) {
            project.robot.rootLinkId = project.robot.links[0]?.id ?? '';
          }
        });

        set((state) => {
          reconcileSelection(state, state.project);
          if (state.project.robot.links.length === 0) {
            state.selection = null;
          }
          state.logs.unshift(makeLog('info', `Deleted link "${target.name}".`));
        });
      },

      setRootLink: (linkId) => {
        const target = get().project.robot.links.find((l) => l.id === linkId);
        if (!target) return;
        commitProject((project) => {
          project.robot.rootLinkId = linkId;
        });
        get().addLog('info', `Set "${target.name}" as robot root link.`);
      },

      addMountToLink: (linkId, name, pose) => {
        const target = get().project.robot.links.find((l) => l.id === linkId);
        if (!target) return null;
        const existing = new Set(target.mounts.map((m) => m.name));
        const uniqueName = sanitizeUniqueName(name, existing);
        const mount: Mount = {
          id: createId(),
          name: uniqueName,
          pose: pose ?? createZeroPose(),
        };

        commitProject((project) => {
          const link = project.robot.links.find((l) => l.id === linkId);
          if (link) {
            link.mounts.push(mount);
          }
        });

        return mount;
      },

      updateMountOnLink: (linkId, mountId, updater) => {
        commitProject((project) => {
          const link = project.robot.links.find((l) => l.id === linkId);
          const mount = link?.mounts.find((m) => m.id === mountId);
          if (mount) {
            updater(mount);
          }
        });
      },

      deleteMountFromLink: (linkId, mountId) => {
        commitProject((project) => {
          const link = project.robot.links.find((l) => l.id === linkId);
          if (!link) return;
          link.mounts = link.mounts.filter((m) => m.id !== mountId);
        });
      },

      applyCustomPartToLink: (linkId, part) => {
        commitProject((project) => {
          const link = project.robot.links.find((l) => l.id === linkId);
          if (!link) return;
          link.visual.geometry = structuredClone(part.geometry);
          // Preserve existing mount IDs with matching names so downstream joints/sensors stay intact
          const existingByName = new Map(link.mounts.map((m) => [m.name, m]));
          const nextMounts: Mount[] = [...link.mounts];
          for (const defMount of part.defaultMounts) {
            const match = existingByName.get(defMount.name);
            if (match) {
              match.pose = structuredClone(defMount.pose);
            } else {
              nextMounts.push({
                id: createId(),
                name: defMount.name,
                pose: structuredClone(defMount.pose),
              });
            }
          }
          link.mounts = nextMounts;
        });
        get().addLog('info', `Applied custom part "${part.name}" while preserving mounts.`);
      },

      assignAssetVisualToLink: (linkId, assetId, scale = [1, 1, 1]) => {
        commitProject((project) => {
          const link = project.robot.links.find((l) => l.id === linkId);
          if (!link) return;
          // Rule 4: replacing visual mesh never touches collision or inertial
          link.visual.geometry = { type: 'mesh', assetId, scale };
        });
        get().addLog(
          'info',
          'Assigned imported 3D mesh as visual geometry (collision & inertial preserved).',
        );
      },

      addJoint: (parentLinkId, parentMountId, childLinkId, childMountId, type = 'fixed', name) => {
        const state = get();
        const pLink = state.project.robot.links.find((l) => l.id === parentLinkId);
        const cLink = state.project.robot.links.find((l) => l.id === childLinkId);
        if (!pLink || !cLink || parentLinkId === childLinkId) return null;

        const resolvedChildMountId = childMountId ?? cLink.mounts[0]?.id;
        if (!resolvedChildMountId) return null;

        const existingNames = new Set(state.project.robot.joints.map((j) => j.name));
        const jointName = sanitizeUniqueName(name ?? `${cLink.name}_joint`, existingNames);

        const joint: Joint = {
          id: createId(),
          name: jointName,
          type,
          parent: { linkId: parentLinkId, mountId: parentMountId },
          child: { linkId: childLinkId, mountId: resolvedChildMountId },
          axis: type === 'prismatic' ? [0, 0, 1] : [0, 1, 0],
          ...(type === 'revolute'
            ? { limits: { lower: -1.57, upper: 1.57, effort: 10, velocity: 2 } }
            : type === 'prismatic'
              ? { limits: { lower: -0.2, upper: 0.2, effort: 50, velocity: 0.5 } }
              : {}),
        };

        commitProject((project) => {
          // Remove any prior joint where childLinkId was already a child (strict tree)
          project.robot.joints = project.robot.joints.filter((j) => j.child.linkId !== childLinkId);
          project.robot.joints.push(joint);
        });

        set((s) => {
          s.selection = { type: 'joint', id: joint.id };
          s.logs.unshift(
            makeLog(
              'info',
              `Created ${type} joint "${joint.name}" (${pLink.name} -> ${cLink.name}).`,
            ),
          );
        });
        return joint;
      },

      updateJoint: (jointId, updater) => {
        commitProject((project) => {
          const joint = project.robot.joints.find((j) => j.id === jointId);
          if (joint) updater(joint);
        });
      },

      deleteJoint: (jointId) => {
        const target = get().project.robot.joints.find((j) => j.id === jointId);
        if (!target) return;
        commitProject((project) => {
          project.robot.joints = project.robot.joints.filter((j) => j.id !== jointId);
        });
        set((state) => {
          if (state.selection?.type === 'joint' && state.selection.id === jointId) {
            state.selection = state.project.robot.links[0]
              ? { type: 'link', id: state.project.robot.links[0].id }
              : null;
          }
          state.logs.unshift(makeLog('info', `Deleted joint "${target.name}".`));
        });
      },

      reparentLink: (childLinkId, newParentLinkId, newParentMountId) => {
        if (childLinkId === newParentLinkId) return;
        const state = get();
        const parentLink = state.project.robot.links.find((l) => l.id === newParentLinkId);
        const childLink = state.project.robot.links.find((l) => l.id === childLinkId);
        if (!parentLink || !childLink) return;
        if (childLinkId === state.project.robot.rootLinkId) return;

        const pMountId = newParentMountId ?? parentLink.mounts[0]?.id;
        const cMountId = childLink.mounts[0]?.id;
        if (!pMountId || !cMountId) return;

        commitProject((project) => {
          const existing = project.robot.joints.find((j) => j.child.linkId === childLinkId);
          if (existing) {
            existing.parent = { linkId: newParentLinkId, mountId: pMountId };
          } else {
            const jNames = new Set(project.robot.joints.map((j) => j.name));
            project.robot.joints.push({
              id: createId(),
              name: sanitizeUniqueName(`${childLink.name}_joint`, jNames),
              type: 'fixed',
              parent: { linkId: newParentLinkId, mountId: pMountId },
              child: { linkId: childLinkId, mountId: cMountId },
              axis: [0, 0, 1],
            });
          }
        });
        get().addLog('info', `Reparented "${childLink.name}" under "${parentLink.name}".`);
      },

      addSensor: (kind, linkId, mountId) => {
        const state = get();
        const hostLink = state.project.robot.links.find((l) => l.id === linkId);
        if (!hostLink || !hostLink.mounts.some((m) => m.id === mountId)) return null;

        const existingNames = new Set(state.project.robot.sensors.map((s) => s.name));
        const baseName =
          kind === 'lidar2d'
            ? 'lidar_2d'
            : kind === 'lidar3d'
              ? 'lidar_3d'
              : kind === 'depth_camera'
                ? 'depth_cam'
                : kind;
        const name = sanitizeUniqueName(baseName, existingNames);

        let sensor: Sensor;
        if (kind === 'lidar2d') {
          sensor = {
            id: createId(),
            name,
            kind,
            linkId,
            mountId,
            topic: '/scan',
            updateRate: 10,
            samples: 360,
            minAngle: -3.14159,
            maxAngle: 3.14159,
            minRange: 0.12,
            maxRange: 12,
            visualize: true,
          };
        } else if (kind === 'lidar3d') {
          sensor = {
            id: createId(),
            name,
            kind,
            linkId,
            mountId,
            topic: '/points',
            updateRate: 10,
            horizontalSamples: 180,
            verticalSamples: 16,
            minRange: 0.2,
            maxRange: 30,
            visualize: true,
          };
        } else if (kind === 'camera') {
          sensor = {
            id: createId(),
            name,
            kind,
            linkId,
            mountId,
            topic: '/camera/image_raw',
            updateRate: 30,
            width: 640,
            height: 480,
            horizontalFov: 1.396,
            nearClip: 0.05,
            farClip: 50,
          };
        } else if (kind === 'depth_camera') {
          sensor = {
            id: createId(),
            name,
            kind,
            linkId,
            mountId,
            topic: '/depth/image_raw',
            updateRate: 15,
            width: 640,
            height: 480,
            horizontalFov: 1.047,
            nearClip: 0.1,
            farClip: 10,
          };
        } else if (kind === 'imu') {
          sensor = {
            id: createId(),
            name,
            kind,
            linkId,
            mountId,
            topic: '/imu',
            updateRate: 100,
            noiseStddev: 0.002,
          };
        } else {
          sensor = {
            id: createId(),
            name,
            kind,
            linkId,
            mountId,
            topic: '/gps/fix',
            updateRate: 5,
            horizontalNoise: 0.01,
            verticalNoise: 0.02,
          };
        }

        commitProject((project) => {
          project.robot.sensors.push(sensor);
        });

        set((s) => {
          s.selection = { type: 'sensor', id: sensor.id };
          s.logs.unshift(
            makeLog('info', `Attached ${kind} sensor "${sensor.name}" to ${hostLink.name}.`),
          );
        });

        return sensor;
      },

      updateSensor: (sensorId, updater) => {
        commitProject((project) => {
          const sensor = project.robot.sensors.find((s) => s.id === sensorId);
          if (sensor) updater(sensor);
        });
      },

      deleteSensor: (sensorId) => {
        const target = get().project.robot.sensors.find((s) => s.id === sensorId);
        if (!target) return;
        commitProject((project) => {
          project.robot.sensors = project.robot.sensors.filter((s) => s.id !== sensorId);
        });
        set((state) => {
          if (state.selection?.type === 'sensor' && state.selection.id === sensorId) {
            state.selection = state.project.robot.links[0]
              ? { type: 'link', id: state.project.robot.links[0].id }
              : null;
          }
          state.logs.unshift(makeLog('info', `Removed sensor "${target.name}".`));
        });
      },

      addPlugin: (kind) => {
        const state = get();
        const existingNames = new Set(state.project.robot.plugins.map((p) => p.name));
        const name = sanitizeUniqueName(`${kind}_plugin`, existingNames);
        const continuousJoints = state.project.robot.joints.filter((j) => j.type === 'continuous');

        let plugin: Plugin;
        if (kind === 'diff_drive') {
          plugin = {
            id: createId(),
            name,
            kind,
            leftJointIds: continuousJoints[0] ? [continuousJoints[0].id] : [],
            rightJointIds: continuousJoints[1] ? [continuousJoints[1].id] : [],
            wheelSeparation: 0.4,
            wheelRadius: 0.08,
            odomTopic: '/odom',
            cmdVelTopic: '/cmd_vel',
          };
        } else if (kind === 'ackermann') {
          plugin = {
            id: createId(),
            name,
            kind,
            leftSteerJointId: state.project.robot.joints[0]?.id ?? '',
            rightSteerJointId: state.project.robot.joints[1]?.id ?? '',
            leftWheelJointId: continuousJoints[0]?.id ?? '',
            rightWheelJointId: continuousJoints[1]?.id ?? '',
            wheelbase: 0.4,
            trackWidth: 0.35,
            wheelRadius: 0.08,
            odomTopic: '/odom',
            cmdVelTopic: '/cmd_vel',
          };
        } else if (kind === 'joint_state_publisher') {
          plugin = {
            id: createId(),
            name,
            kind,
            topic: '/joint_states',
          };
        } else {
          plugin = {
            id: createId(),
            name,
            kind,
            jointId: state.project.robot.joints[0]?.id ?? '',
            topic: '/joint_cmd',
            pGain: 10,
            iGain: 0.1,
            dGain: 1.0,
          };
        }

        commitProject((project) => {
          project.robot.plugins.push(plugin);
        });
        set((s) => {
          s.selection = { type: 'plugin', id: plugin.id };
          s.logs.unshift(makeLog('info', `Added ${kind} Gazebo plugin "${plugin.name}".`));
        });
        return plugin;
      },

      updatePlugin: (pluginId, updater) => {
        commitProject((project) => {
          const plugin = project.robot.plugins.find((p) => p.id === pluginId);
          if (plugin) updater(plugin);
        });
      },

      deletePlugin: (pluginId) => {
        commitProject((project) => {
          project.robot.plugins = project.robot.plugins.filter((p) => p.id !== pluginId);
        });
        set((state) => {
          if (state.selection?.type === 'plugin' && state.selection.id === pluginId) {
            state.selection = { type: 'robot' };
          }
        });
      },

      updateWorld: (updater) => {
        commitProject((project) => {
          updater(project.world);
        });
      },

      setTerrainElevation: (grid, gridSize, centerElevation) => {
        set((state) => {
          if (!state.project.world.mapBackground) {
            state.project.world.mapBackground = { ...DEFAULT_MAP_BACKGROUND };
          }
          const m = state.project.world.mapBackground;
          m.elevationGrid = grid;
          m.elevationGridSize = gridSize;
          if (centerElevation !== undefined && Number.isFinite(centerElevation)) {
            m.elevation = centerElevation;
          }
        });
      },

      addWorldObject: (name, source, pose, isStatic = true, mass) => {
        const existingNames = new Set(get().project.world.objects.map((o) => o.name));
        const obj: WorldObject = {
          id: createId(),
          name: sanitizeUniqueName(name, existingNames),
          source,
          pose: pose ?? createZeroPose(),
          static: isStatic,
          ...(mass !== undefined ? { mass } : {}),
        };
        commitProject((project) => {
          project.world.objects.push(obj);
        });
        set((s) => {
          s.mode = 'world';
          s.selection = { type: 'worldObject', id: obj.id };
          s.logs.unshift(makeLog('info', `Placed world object "${obj.name}".`));
        });
        return obj;
      },

      updateWorldObject: (objectId, updater) => {
        commitProject((project) => {
          const obj = project.world.objects.find((o) => o.id === objectId);
          if (obj) updater(obj);
        });
      },

      deleteWorldObject: (objectId) => {
        commitProject((project) => {
          project.world.objects = project.world.objects.filter((o) => o.id !== objectId);
        });
        set((state) => {
          if (state.selection?.type === 'worldObject' && state.selection.id === objectId) {
            state.selection = { type: 'world' };
          }
        });
      },

      addWorldLight: (type) => {
        const existing = new Set(get().project.world.lights.map((l) => l.name));
        const light: Light = {
          id: createId(),
          name: sanitizeUniqueName(`${type}_light`, existing),
          type,
          pose: { xyz: [0, 0, 5], rpy: [0, 0, 0] },
          diffuse: [1, 0.98, 0.95],
          intensity: 1.0,
          castShadows: type !== 'point',
        };
        commitProject((project) => {
          project.world.lights.push(light);
        });
        set((s) => {
          s.selection = { type: 'worldLight', id: light.id };
        });
        return light;
      },

      updateWorldLight: (lightId, updater) => {
        commitProject((project) => {
          const light = project.world.lights.find((l) => l.id === lightId);
          if (light) updater(light);
        });
      },

      deleteWorldLight: (lightId) => {
        commitProject((project) => {
          project.world.lights = project.world.lights.filter((l) => l.id !== lightId);
        });
        set((state) => {
          if (state.selection?.type === 'worldLight' && state.selection.id === lightId) {
            state.selection = { type: 'world' };
          }
        });
      },

      saveCustomPart: (part) => {
        commitProject((project) => {
          const idx = project.customParts.findIndex((p) => p.id === part.id);
          if (idx >= 0) {
            project.customParts[idx] = part;
          } else {
            project.customParts.push(part);
          }
        });
        get().addLog('info', `Saved custom part "${part.name}" to library.`);
      },

      deleteCustomPart: (partId) => {
        commitProject((project) => {
          project.customParts = project.customParts.filter((p) => p.id !== partId);
        });
      },

      addAsset: (asset) => {
        commitProject((project) => {
          project.assets.push(asset);
        });
        get().addLog('info', `Imported 3D mesh asset "${asset.name}.${asset.format}".`);
      },

      addTexture: (texture) => {
        commitProject((project) => {
          project.textures.push(texture);
        });
        get().addLog('info', `Imported texture "${texture.name}.${texture.format}".`);
      },

      deleteTexture: (textureId) => {
        commitProject((project) => {
          project.textures = project.textures.filter((t) => t.id !== textureId);
          for (const link of project.robot.links) {
            if (link.visual.material.textureId === textureId) {
              delete link.visual.material.textureId;
            }
          }
          if (project.world.ground.textureId === textureId) {
            delete project.world.ground.textureId;
          }
          for (const obj of project.world.objects) {
            if (obj.source.type === 'primitive' && obj.source.material.textureId === textureId) {
              delete obj.source.material.textureId;
            }
          }
        });
      },

      loadProject: (project, options) => {
        set((state) => {
          if (options?.clearHistory) {
            state.past = [];
            state.future = [];
          } else {
            state.past.push(current(state.project));
            if (state.past.length > MAX_HISTORY) {
              state.past.shift();
            }
            state.future = [];
          }
          state.project = project;
          state.selection = project.robot.links[0]
            ? { type: 'link', id: project.robot.links[0].id }
            : { type: 'project' };
          state.logs.unshift(
            makeLog('info', options?.logMessage ?? `Loaded project "${project.name}".`),
          );
        });
      },

      resetProject: () => {
        const fresh = createDefaultProject();
        get().loadProject(fresh, {
          clearHistory: false,
          logMessage: 'Reset workspace to a clean single-link project.',
        });
      },
    };
  }),
);
