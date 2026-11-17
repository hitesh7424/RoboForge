import { useMemo } from 'react';
import {
  Box,
  Copy,
  Cpu,
  FlipHorizontal2,
  GitCommitHorizontal,
  Globe,
  Link2,
  Radar,
  Star,
  Sun,
  Trash2,
} from 'lucide-react';
import type { Joint, Link } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { Button } from '@/ui/components/button';

interface TreeNode {
  link: Link;
  incomingJoint?: Joint;
  children: TreeNode[];
}

export function SceneTreePanel() {
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const select = useRoboForgeStore((s) => s.select);
  const setMode = useRoboForgeStore((s) => s.setMode);
  const duplicateLink = useRoboForgeStore((s) => s.duplicateLink);
  const mirrorLinkAcrossY = useRoboForgeStore((s) => s.mirrorLinkAcrossY);
  const deleteLink = useRoboForgeStore((s) => s.deleteLink);
  const setRootLink = useRoboForgeStore((s) => s.setRootLink);
  const reparentLink = useRoboForgeStore((s) => s.reparentLink);
  const deleteSensor = useRoboForgeStore((s) => s.deleteSensor);
  const deletePlugin = useRoboForgeStore((s) => s.deletePlugin);
  const deleteWorldObject = useRoboForgeStore((s) => s.deleteWorldObject);

  const { links, joints, sensors, plugins, rootLinkId } = project.robot;

  const { rootTrees, unattached } = useMemo(() => {
    const linkMap = new Map(links.map((l) => [l.id, l]));
    const childIncomingJoint = new Map<string, Joint>();
    const childrenMap = new Map<string, { linkId: string; joint: Joint }[]>();

    for (const j of joints) {
      childIncomingJoint.set(j.child.linkId, j);
      const list = childrenMap.get(j.parent.linkId) ?? [];
      list.push({ linkId: j.child.linkId, joint: j });
      childrenMap.set(j.parent.linkId, list);
    }

    const visited = new Set<string>();
    const buildNode = (linkId: string, incomingJoint?: Joint): TreeNode | null => {
      if (visited.has(linkId)) return null;
      const link = linkMap.get(linkId);
      if (!link) return null;
      visited.add(linkId);
      const children: TreeNode[] = [];
      for (const ch of childrenMap.get(linkId) ?? []) {
        const sub = buildNode(ch.linkId, ch.joint);
        if (sub) children.push(sub);
      }
      return { link, incomingJoint, children };
    };

    const trees: TreeNode[] = [];
    if (rootLinkId && linkMap.has(rootLinkId)) {
      const rootNode = buildNode(rootLinkId);
      if (rootNode) trees.push(rootNode);
    }

    const loose: Link[] = [];
    for (const l of links) {
      if (!visited.has(l.id)) {
        if (!childIncomingJoint.has(l.id)) {
          loose.push(l);
        } else {
          const orphanTree = buildNode(l.id);
          if (orphanTree) trees.push(orphanTree);
        }
      }
    }

    return { rootTrees: trees, unattached: loose };
  }, [links, joints, rootLinkId]);

  const renderLinkBranch = (node: TreeNode, depth = 0) => {
    const { link, incomingJoint, children } = node;
    const isLinkSelected = selection?.type === 'link' && selection.id === link.id;
    const isJointSelected =
      incomingJoint && selection?.type === 'joint' && selection.id === incomingJoint.id;
    const isRoot = link.id === rootLinkId;

    return (
      <div key={link.id} className="space-y-0.5">
        {incomingJoint && (
          <button
            type="button"
            onClick={() => select({ type: 'joint', id: incomingJoint.id })}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            className={`flex w-full items-center gap-1 rounded py-0.5 pr-2 text-left text-[11px] cursor-pointer ${
              isJointSelected ? 'bg-blue-600/20 text-blue-200' : 'text-slate-400 hover:bg-[#181f2d]'
            }`}
          >
            <GitCommitHorizontal className="h-3 w-3 shrink-0 text-sky-400" />
            <span className="font-mono truncate">{incomingJoint.name}</span>
            <span className="ml-auto text-[10px] text-slate-500">{incomingJoint.type}</span>
          </button>
        )}

        <div
          draggable={!isRoot}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-roboforge-link', link.id);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-roboforge-link')) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            const draggedId = e.dataTransfer.getData('application/x-roboforge-link');
            if (draggedId && draggedId !== link.id) {
              e.preventDefault();
              reparentLink(draggedId, link.id);
            }
          }}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          className={`group flex items-center justify-between rounded pr-1 py-1 text-xs transition-colors ${
            isLinkSelected ? 'bg-blue-600/20 text-blue-100' : 'text-slate-300 hover:bg-[#1c2333]'
          }`}
        >
          <button
            type="button"
            onClick={() => select({ type: 'link', id: link.id })}
            className="flex flex-1 items-center gap-1.5 min-w-0 text-left cursor-pointer"
          >
            <Box className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="font-mono truncate">{link.name}</span>
            {isRoot && (
              <span className="text-[10px] text-blue-400 whitespace-nowrap shrink-0">root</span>
            )}
          </button>

          <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
            {!isRoot && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => setRootLink(link.id)}
                aria-label={`Set ${link.name} as root link`}
                title="Set as root link"
              >
                <Star className="h-3 w-3" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => mirrorLinkAcrossY(link.id)}
              aria-label={`Mirror ${link.name} across Y`}
              title="Mirror across Y"
            >
              <FlipHorizontal2 className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => duplicateLink(link.id)}
              aria-label={`Duplicate ${link.name}`}
              title="Duplicate link"
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-slate-400 hover:text-red-400"
              onClick={() => deleteLink(link.id)}
              disabled={links.length <= 1}
              aria-label={`Delete ${link.name}`}
              title="Delete link"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Mounts on selected link */}
        {isLinkSelected && link.mounts.length > 0 && (
          <div style={{ paddingLeft: `${depth * 12 + 22}px` }} className="space-y-0.5 pb-1">
            {link.mounts.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => select({ type: 'mount', linkId: link.id, mountId: m.id })}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-mono text-sky-300/80 hover:bg-[#1a2232] cursor-pointer"
              >
                <Link2 className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{m.name}</span>
              </button>
            ))}
          </div>
        )}

        {children.map((child) => renderLinkBranch(child, depth + 1))}
      </div>
    );
  };

  return (
    <section aria-label="Scene Tree" className="flex h-full flex-col bg-[#12161f]">
      <div className="flex items-center justify-between border-b border-[#222938] px-3 py-2 shrink-0">
        <h2 className="text-xs font-semibold text-slate-200">Scene Tree</h2>
        <span className="text-[11px] text-slate-400 tabular-nums">
          {links.length}L · {joints.length}J · {sensors.length}S · {plugins.length}P
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <button
          type="button"
          onClick={() => select({ type: 'robot' })}
          className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors cursor-pointer ${
            selection?.type === 'robot'
              ? 'bg-blue-600/20 text-blue-200'
              : 'text-slate-300 hover:bg-[#1c2333]'
          }`}
        >
          <span className="font-mono font-medium truncate">{project.robot.name}</span>
          <span className="text-[11px] text-slate-400 shrink-0">Robot</span>
        </button>

        <div className="space-y-0.5">{rootTrees.map((tree) => renderLinkBranch(tree, 0))}</div>

        {unattached.length > 0 && (
          <div className="pt-1 space-y-0.5 border-t border-[#222938]">
            <div className="px-2 text-[11px] font-medium text-amber-400">Unattached Links</div>
            {unattached.map((link) => renderLinkBranch({ link, children: [] }, 0))}
          </div>
        )}

        {sensors.length > 0 && (
          <div className="pt-1 space-y-0.5 border-t border-[#222938]">
            <div className="px-2 text-[11px] font-medium text-slate-400">Sensors</div>
            {sensors.map((sensor) => {
              const isSelected = selection?.type === 'sensor' && selection.id === sensor.id;
              return (
                <div
                  key={sensor.id}
                  className={`group flex items-center justify-between rounded px-2 py-1 text-xs ${
                    isSelected
                      ? 'bg-blue-600/20 text-blue-100'
                      : 'text-slate-300 hover:bg-[#1c2333]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => select({ type: 'sensor', id: sensor.id })}
                    className="flex flex-1 items-center gap-1.5 min-w-0 text-left cursor-pointer"
                  >
                    <Radar className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    <span className="font-mono truncate">{sensor.name}</span>
                    <span className="ml-auto text-[10px] text-slate-500">{sensor.kind}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSensor(sensor.id)}
                    aria-label={`Delete sensor ${sensor.name}`}
                    className="ml-1 opacity-40 group-hover:opacity-100 text-slate-400 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {plugins.length > 0 && (
          <div className="pt-1 space-y-0.5 border-t border-[#222938]">
            <div className="px-2 text-[11px] font-medium text-slate-400">Gazebo Plugins</div>
            {plugins.map((plugin) => {
              const isSelected = selection?.type === 'plugin' && selection.id === plugin.id;
              return (
                <div
                  key={plugin.id}
                  className={`group flex items-center justify-between rounded px-2 py-1 text-xs ${
                    isSelected
                      ? 'bg-blue-600/20 text-blue-100'
                      : 'text-slate-300 hover:bg-[#1c2333]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => select({ type: 'plugin', id: plugin.id })}
                    className="flex flex-1 items-center gap-1.5 min-w-0 text-left cursor-pointer"
                  >
                    <Cpu className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                    <span className="font-mono truncate">{plugin.name}</span>
                    <span className="ml-auto text-[10px] text-slate-500">{plugin.kind}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePlugin(plugin.id)}
                    aria-label={`Delete plugin ${plugin.name}`}
                    className="ml-1 opacity-40 group-hover:opacity-100 text-slate-400 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* World Scene Section */}
        <div className="pt-1 space-y-0.5 border-t border-[#222938]">
          <button
            type="button"
            onClick={() => {
              setMode('world');
              select({ type: 'world' });
            }}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs cursor-pointer ${
              selection?.type === 'world'
                ? 'bg-emerald-600/20 text-emerald-200'
                : 'text-slate-300 hover:bg-[#1c2333]'
            }`}
          >
            <span className="flex items-center gap-1.5 font-mono truncate">
              <Globe className="h-3.5 w-3.5 text-emerald-400" />
              {project.world.name}
            </span>
            <span className="text-[11px] text-slate-500">World</span>
          </button>

          {project.world.objects.map((obj) => {
            const isSelected = selection?.type === 'worldObject' && selection.id === obj.id;
            return (
              <div
                key={obj.id}
                className={`group flex items-center justify-between rounded pl-5 pr-2 py-1 text-xs ${
                  isSelected
                    ? 'bg-emerald-600/20 text-emerald-100'
                    : 'text-slate-300 hover:bg-[#1c2333]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMode('world');
                    select({ type: 'worldObject', id: obj.id });
                  }}
                  className="flex flex-1 items-center gap-1.5 min-w-0 text-left cursor-pointer"
                >
                  <Box className="h-3 w-3 shrink-0 text-amber-400" />
                  <span className="font-mono truncate">{obj.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteWorldObject(obj.id)}
                  aria-label={`Delete world object ${obj.name}`}
                  className="ml-1 opacity-40 group-hover:opacity-100 text-slate-400 hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          {project.world.lights.map((light) => {
            const isSelected = selection?.type === 'worldLight' && selection.id === light.id;
            return (
              <button
                key={light.id}
                type="button"
                onClick={() => {
                  setMode('world');
                  select({ type: 'worldLight', id: light.id });
                }}
                className={`flex w-full items-center gap-1.5 rounded pl-5 pr-2 py-1 text-left text-xs cursor-pointer ${
                  isSelected
                    ? 'bg-yellow-600/20 text-yellow-100'
                    : 'text-slate-300 hover:bg-[#1c2333]'
                }`}
              >
                <Sun className="h-3 w-3 shrink-0 text-yellow-400" />
                <span className="font-mono truncate">{light.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
