import { useState } from 'react';
import {
  Box,
  Circle,
  Cpu,
  Cylinder,
  Disc,
  Globe,
  Plus,
  Radar,
  Search,
  Shapes,
  Wrench,
} from 'lucide-react';
import { ROBOFORGE_DRAG_MIME, type LibraryDragPayload } from '@/core/dragTypes';
import { useRoboForgeStore } from '@/core/store';
import { Input } from '@/ui/components/input';

interface LibraryEntry {
  id: string;
  label: string;
  category: string;
  icon: typeof Box;
  payload?: LibraryDragPayload;
  action?: 'open_part_editor';
}

const LIBRARY_ENTRIES: LibraryEntry[] = [
  {
    id: 'prim-box',
    label: 'Box Link',
    category: 'Shapes',
    icon: Box,
    payload: {
      kind: 'link_primitive',
      defaultName: 'box_link',
      shape: { kind: 'box', size: [0.3, 0.2, 0.1] },
    },
  },
  {
    id: 'prim-cylinder',
    label: 'Cylinder Link',
    category: 'Shapes',
    icon: Cylinder,
    payload: {
      kind: 'link_primitive',
      defaultName: 'cylinder_link',
      shape: { kind: 'cylinder', radius: 0.08, length: 0.2 },
    },
  },
  {
    id: 'prim-sphere',
    label: 'Sphere Link',
    category: 'Shapes',
    icon: Circle,
    payload: {
      kind: 'link_primitive',
      defaultName: 'sphere_link',
      shape: { kind: 'sphere', radius: 0.08 },
    },
  },
  {
    id: 'prim-capsule',
    label: 'Capsule Link',
    category: 'Shapes',
    icon: Cylinder,
    payload: {
      kind: 'link_primitive',
      defaultName: 'capsule_link',
      shape: { kind: 'capsule', radius: 0.06, length: 0.22 },
    },
  },
  {
    id: 'wheel-drive',
    label: 'Drive Wheel',
    category: 'Wheels',
    icon: Disc,
    payload: {
      kind: 'link_primitive',
      defaultName: 'wheel_link',
      shape: { kind: 'cylinder', radius: 0.08, length: 0.045 },
    },
  },
  {
    id: 'wheel-caster',
    label: 'Caster Ball',
    category: 'Wheels',
    icon: Circle,
    payload: {
      kind: 'link_primitive',
      defaultName: 'caster_link',
      shape: { kind: 'sphere', radius: 0.035 },
    },
  },
  {
    id: 'chassis-plate',
    label: 'Rover Chassis',
    category: 'Chassis',
    icon: Shapes,
    payload: {
      kind: 'link_primitive',
      defaultName: 'chassis_link',
      shape: { kind: 'box', size: [0.48, 0.32, 0.1] },
    },
  },
  {
    id: 'chassis-axles',
    label: 'Chassis with Axles...',
    category: 'Chassis',
    icon: Wrench,
    action: 'open_part_editor',
  },
  {
    id: 'sensor-lidar2d',
    label: '2D LiDAR',
    category: 'Sensors',
    icon: Radar,
    payload: { kind: 'sensor', sensorKind: 'lidar2d' },
  },
  {
    id: 'sensor-lidar3d',
    label: '3D LiDAR',
    category: 'Sensors',
    icon: Radar,
    payload: { kind: 'sensor', sensorKind: 'lidar3d' },
  },
  {
    id: 'sensor-camera',
    label: 'RGB Camera',
    category: 'Sensors',
    icon: Radar,
    payload: { kind: 'sensor', sensorKind: 'camera' },
  },
  {
    id: 'sensor-depth',
    label: 'Depth Camera',
    category: 'Sensors',
    icon: Radar,
    payload: { kind: 'sensor', sensorKind: 'depth_camera' },
  },
  {
    id: 'sensor-imu',
    label: 'IMU Sensor',
    category: 'Sensors',
    icon: Radar,
    payload: { kind: 'sensor', sensorKind: 'imu' },
  },
  {
    id: 'sensor-gps',
    label: 'GPS / NavSat',
    category: 'Sensors',
    icon: Radar,
    payload: { kind: 'sensor', sensorKind: 'gps' },
  },
  {
    id: 'plugin-diff',
    label: 'Diff Drive Controller',
    category: 'Actuators',
    icon: Cpu,
    payload: { kind: 'plugin', pluginKind: 'diff_drive' },
  },
  {
    id: 'plugin-ackermann',
    label: 'Ackermann Steering',
    category: 'Actuators',
    icon: Cpu,
    payload: { kind: 'plugin', pluginKind: 'ackermann' },
  },
  {
    id: 'plugin-jsp',
    label: 'Joint State Publisher',
    category: 'Actuators',
    icon: Cpu,
    payload: { kind: 'plugin', pluginKind: 'joint_state_publisher' },
  },
  {
    id: 'plugin-jpc',
    label: 'Joint Position Controller',
    category: 'Actuators',
    icon: Cpu,
    payload: { kind: 'plugin', pluginKind: 'joint_controller' },
  },
  {
    id: 'world-wall',
    label: 'Wall Obstacle',
    category: 'World',
    icon: Globe,
    payload: {
      kind: 'world_object',
      name: 'wall_obstacle',
      source: {
        type: 'primitive',
        shape: { kind: 'box', size: [4.0, 0.25, 1.0] },
        material: { name: 'concrete_gray', rgba: [0.48, 0.52, 0.58, 1] },
      },
      isStatic: true,
      defaultZ: 0.5,
    },
  },
  {
    id: 'world-crate',
    label: 'Dynamic Crate',
    category: 'World',
    icon: Box,
    payload: {
      kind: 'world_object',
      name: 'crate',
      source: {
        type: 'primitive',
        shape: { kind: 'box', size: [0.6, 0.6, 0.6] },
        material: { name: 'crate_amber', rgba: [0.76, 0.52, 0.22, 1] },
      },
      isStatic: false,
      mass: 6.0,
      defaultZ: 0.3,
    },
  },
  {
    id: 'world-pillar',
    label: 'Cylinder Pillar',
    category: 'World',
    icon: Cylinder,
    payload: {
      kind: 'world_object',
      name: 'pillar',
      source: {
        type: 'primitive',
        shape: { kind: 'cylinder', radius: 0.3, length: 1.4 },
        material: { name: 'pillar_steel', rgba: [0.38, 0.44, 0.54, 1] },
      },
      isStatic: true,
      defaultZ: 0.7,
    },
  },
  {
    id: 'world-fuel',
    label: 'Fuel Model (URI)',
    category: 'World',
    icon: Globe,
    payload: {
      kind: 'world_object',
      name: 'fuel_model',
      source: {
        type: 'model',
        uri: 'https://fuel.gazebosim.org/1.0/OpenRobotics/models/Construction Cone',
      },
      isStatic: true,
      defaultZ: 0.0,
    },
  },
];

export function PartLibraryPanel() {
  const [query, setQuery] = useState('');
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const addLink = useRoboForgeStore((s) => s.addLink);
  const addSensor = useRoboForgeStore((s) => s.addSensor);
  const addPlugin = useRoboForgeStore((s) => s.addPlugin);
  const addWorldObject = useRoboForgeStore((s) => s.addWorldObject);
  const applyCustomPartToLink = useRoboForgeStore((s) => s.applyCustomPartToLink);
  const setPendingJointAttach = useRoboForgeStore((s) => s.setPendingJointAttach);
  const openPartEditor = useRoboForgeStore((s) => s.openPartEditor);
  const addLog = useRoboForgeStore((s) => s.addLog);

  const normalized = query.trim().toLowerCase();
  const filtered = LIBRARY_ENTRIES.filter(
    (item) =>
      !normalized ||
      item.label.toLowerCase().includes(normalized) ||
      item.category.toLowerCase().includes(normalized),
  );

  const categories = Array.from(new Set(filtered.map((item) => item.category)));

  const resolveHostLinkAndMount = () => {
    const link =
      (selection?.type === 'link'
        ? project.robot.links.find((l) => l.id === selection.id)
        : selection?.type === 'mount'
          ? project.robot.links.find((l) => l.id === selection.linkId)
          : undefined) ??
      project.robot.links.find((l) => l.id === project.robot.rootLinkId) ??
      project.robot.links[0];
    const mount =
      (selection?.type === 'mount' && link
        ? link.mounts.find((m) => m.id === selection.mountId)
        : undefined) ?? link?.mounts[0];
    return { link, mount };
  };

  const executePayload = (payload: LibraryDragPayload) => {
    if (payload.kind === 'link_primitive') {
      const { link: hostLink, mount: hostMount } = resolveHostLinkAndMount();
      const created = addLink(payload.shape, payload.defaultName);
      if (hostLink && hostMount && hostLink.id !== created.id) {
        setPendingJointAttach({
          parentLinkId: hostLink.id,
          parentMountId: hostMount.id,
          childLinkId: created.id,
        });
      }
    } else if (payload.kind === 'sensor') {
      const { link, mount } = resolveHostLinkAndMount();
      if (link && mount) {
        addSensor(payload.sensorKind, link.id, mount.id);
      } else {
        addLog('warning', 'Select a link with at least one mount to attach a sensor.');
      }
    } else if (payload.kind === 'plugin') {
      addPlugin(payload.pluginKind);
    } else if (payload.kind === 'world_object') {
      const offset = project.world.objects.length * 0.9;
      addWorldObject(
        payload.name,
        payload.source,
        {
          xyz: [1.4 + (offset % 2.4), (offset % 1.8) - 0.6, payload.defaultZ ?? 0.4],
          rpy: [0, 0, 0],
        },
        payload.isStatic,
        payload.mass,
      );
    } else if (payload.kind === 'custom_part') {
      const part = project.customParts.find((p) => p.id === payload.customPartId);
      const { link } = resolveHostLinkAndMount();
      if (part && link) {
        applyCustomPartToLink(link.id, part);
      } else {
        openPartEditor(payload.customPartId);
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, payload: LibraryDragPayload) => {
    e.dataTransfer.setData(ROBOFORGE_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <section aria-label="Part Library" className="flex h-full flex-col bg-[#12161f]">
      <div className="flex items-center justify-between border-b border-[#222938] px-3 py-2 shrink-0">
        <h2 className="text-xs font-semibold text-slate-200">Part Library</h2>
        <span className="text-[11px] text-slate-400 tabular-nums">Drag or click</span>
      </div>

      <div className="border-b border-[#222938] px-2.5 py-2 shrink-0">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            aria-label="Filter part library"
            placeholder="Filter parts, sensors, world..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-7"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {categories.map((category) => (
          <div key={category} className="space-y-1">
            <div className="px-1.5 text-[11px] font-medium text-slate-400">{category}</div>
            <div className="space-y-0.5">
              {filtered
                .filter((i) => i.category === category)
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      draggable={Boolean(item.payload)}
                      onDragStart={(e) => {
                        if (item.payload) handleDragStart(e, item.payload);
                      }}
                      onClick={() => {
                        if (item.action === 'open_part_editor') {
                          openPartEditor(null);
                        } else if (item.payload) {
                          executePayload(item.payload);
                        }
                      }}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-[#1c2333] transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2 min-w-0 truncate">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <Plus className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                    </button>
                  );
                })}
            </div>
          </div>
        ))}

        {/* Custom Parts Library */}
        <div className="space-y-1 border-t border-[#222938] pt-2">
          <div className="flex items-center justify-between px-1.5">
            <span className="text-[11px] font-medium text-slate-400">Custom Parts</span>
            <button
              type="button"
              onClick={() => openPartEditor(null)}
              className="text-[11px] text-blue-400 hover:underline cursor-pointer"
            >
              + New
            </button>
          </div>
          {project.customParts.map((part) => {
            const payload: LibraryDragPayload = { kind: 'custom_part', customPartId: part.id };
            return (
              <div
                key={part.id}
                draggable
                onDragStart={(e) => handleDragStart(e, payload)}
                className="flex items-center justify-between rounded px-2 py-1 text-xs text-slate-200 hover:bg-[#1c2333]"
              >
                <button
                  type="button"
                  onClick={() => executePayload(payload)}
                  title="Apply custom part to selected link"
                  className="flex flex-1 items-center gap-2 min-w-0 text-left cursor-pointer"
                >
                  <Wrench className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span className="font-mono truncate">{part.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => openPartEditor(part.id)}
                  className="text-[11px] text-slate-400 hover:text-slate-100 px-1 cursor-pointer"
                >
                  Edit
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
