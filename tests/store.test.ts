import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/defaults';
import { useRoboForgeStore } from '@/core/store';

describe('RoboForge Zustand store & undo/redo history', () => {
  beforeEach(() => {
    useRoboForgeStore.getState().loadProject(createDefaultProject(), { clearHistory: true });
  });

  it('records project mutations and supports undo/redo cleanly', () => {
    const store = useRoboForgeStore.getState();
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);

    store.setProjectName('rover_pkg');
    expect(useRoboForgeStore.getState().project.name).toBe('rover_pkg');
    expect(useRoboForgeStore.getState().canUndo()).toBe(true);

    store.setTarget('humble-fortress');
    expect(useRoboForgeStore.getState().project.target).toBe('humble-fortress');

    useRoboForgeStore.getState().undo();
    expect(useRoboForgeStore.getState().project.target).toBe('jazzy-harmonic');
    expect(useRoboForgeStore.getState().canRedo()).toBe(true);

    useRoboForgeStore.getState().undo();
    expect(useRoboForgeStore.getState().project.name).toBe('my_robot_pkg');

    useRoboForgeStore.getState().redo();
    expect(useRoboForgeStore.getState().project.name).toBe('rover_pkg');
  });

  it('adds, duplicates, and deletes links with unique ROS names and undo support', () => {
    const added = useRoboForgeStore
      .getState()
      .addLink({ kind: 'cylinder', radius: 0.08, length: 0.04 }, 'wheel_left');
    expect(added.name).toBe('wheel_left');
    expect(useRoboForgeStore.getState().project.robot.links).toHaveLength(2);

    const dup = useRoboForgeStore.getState().duplicateLink(added.id);
    expect(dup?.name).toBe('wheel_left_copy');
    expect(useRoboForgeStore.getState().project.robot.links).toHaveLength(3);

    useRoboForgeStore.getState().deleteLink(dup!.id);
    expect(useRoboForgeStore.getState().project.robot.links).toHaveLength(2);

    useRoboForgeStore.getState().undo();
    expect(useRoboForgeStore.getState().project.robot.links).toHaveLength(3);
  });

  it('adds and deletes mounts on a link', () => {
    const rootId = useRoboForgeStore.getState().project.robot.rootLinkId;
    const mount = useRoboForgeStore.getState().addMountToLink(rootId, 'lidar_mount');
    expect(mount?.name).toBe('lidar_mount');

    const linkAfterAdd = useRoboForgeStore.getState().project.robot.links[0]!;
    expect(linkAfterAdd.mounts).toHaveLength(2);

    useRoboForgeStore.getState().deleteMountFromLink(rootId, mount!.id);
    const linkAfterDelete = useRoboForgeStore.getState().project.robot.links[0]!;
    expect(linkAfterDelete.mounts).toHaveLength(1);
  });

  it('allows deleting the root link and all links down to an empty robot', () => {
    const state = useRoboForgeStore.getState();
    const rootId = state.project.robot.rootLinkId;
    expect(state.project.robot.links).toHaveLength(1);

    state.deleteLink(rootId);
    expect(useRoboForgeStore.getState().project.robot.links).toHaveLength(0);
    expect(useRoboForgeStore.getState().project.robot.rootLinkId).toBe('');
    expect(useRoboForgeStore.getState().selection).toBeNull();

    // Adding a new part creates a fresh root link
    const next = useRoboForgeStore
      .getState()
      .addLink({ kind: 'box', size: [0.3, 0.2, 0.1] }, 'new_root');
    expect(useRoboForgeStore.getState().project.robot.links).toHaveLength(1);
    expect(useRoboForgeStore.getState().project.robot.rootLinkId).toBe(next.id);
  });

  it('toggles left, right, and bottom collapsible panel states', () => {
    const s = useRoboForgeStore.getState();
    expect(s.collapsedPanels).toEqual({ left: false, right: false, bottom: false });
    s.togglePanel('left');
    s.togglePanel('bottom');
    expect(useRoboForgeStore.getState().collapsedPanels).toEqual({
      left: true,
      right: false,
      bottom: true,
    });
    s.setPanelCollapsed('right', true);
    expect(useRoboForgeStore.getState().collapsedPanels.right).toBe(true);
  });
});
