import { PanelRightClose } from 'lucide-react';
import { useRoboForgeStore } from '@/core/store';
import {
  JointInspector,
  PluginInspector,
  SensorInspector,
} from '@/ui/inspectors/JointSensorPluginInspector';
import { LinkInspector, MountInspector } from '@/ui/inspectors/LinkAndMountInspector';
import { RosNameField } from '@/ui/inspectors/NumericField';
import {
  WorldLightInspector,
  WorldObjectInspector,
  WorldSettingsInspector,
} from '@/ui/inspectors/WorldInspector';

export function InspectorPanel() {
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const setRobotName = useRoboForgeStore((s) => s.setRobotName);
  const togglePanel = useRoboForgeStore((s) => s.togglePanel);

  const selectedLink =
    selection?.type === 'link'
      ? (project.robot.links.find((l) => l.id === selection.id) ?? null)
      : null;

  const selectedMountLink =
    selection?.type === 'mount'
      ? (project.robot.links.find((l) => l.id === selection.linkId) ?? null)
      : null;
  const selectedMount =
    selection?.type === 'mount' && selectedMountLink
      ? (selectedMountLink.mounts.find((m) => m.id === selection.mountId) ?? null)
      : null;

  const selectedJoint =
    selection?.type === 'joint'
      ? (project.robot.joints.find((j) => j.id === selection.id) ?? null)
      : null;

  const selectedSensor =
    selection?.type === 'sensor'
      ? (project.robot.sensors.find((s) => s.id === selection.id) ?? null)
      : null;

  const selectedPlugin =
    selection?.type === 'plugin'
      ? (project.robot.plugins.find((p) => p.id === selection.id) ?? null)
      : null;

  const selectedWorldObject =
    selection?.type === 'worldObject'
      ? (project.world.objects.find((o) => o.id === selection.id) ?? null)
      : null;

  const selectedWorldLight =
    selection?.type === 'worldLight'
      ? (project.world.lights.find((l) => l.id === selection.id) ?? null)
      : null;

  const totalMass = project.robot.links.reduce((acc, l) => acc + l.inertial.mass, 0);

  return (
    <section aria-label="Inspector" className="flex h-full flex-col bg-[#12161f]">
      <div className="flex items-center justify-between border-b border-[#222938] px-3 py-2 shrink-0">
        <h2 className="text-xs font-semibold text-slate-200">Inspector</h2>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-slate-400">
            {selectedLink
              ? 'Link'
              : selectedMount
                ? 'Mount'
                : selectedJoint
                  ? 'Joint'
                  : selectedSensor
                    ? 'Sensor'
                    : selectedPlugin
                      ? 'Plugin'
                      : selectedWorldObject
                        ? 'World Object'
                        : selectedWorldLight
                          ? 'World Light'
                          : selection?.type === 'world'
                            ? 'World'
                            : 'Robot'}
          </span>
          <button
            type="button"
            onClick={() => togglePanel('right')}
            aria-label="Collapse right inspector"
            title="Collapse right inspector"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-[#1c2333] hover:text-slate-100 cursor-pointer"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {selectedLink ? (
          <LinkInspector link={selectedLink} />
        ) : selectedMount && selectedMountLink ? (
          <MountInspector link={selectedMountLink} mount={selectedMount} />
        ) : selectedJoint ? (
          <JointInspector joint={selectedJoint} />
        ) : selectedSensor ? (
          <SensorInspector sensor={selectedSensor} />
        ) : selectedPlugin ? (
          <PluginInspector plugin={selectedPlugin} />
        ) : selectedWorldObject ? (
          <WorldObjectInspector obj={selectedWorldObject} />
        ) : selectedWorldLight ? (
          <WorldLightInspector light={selectedWorldLight} />
        ) : selection?.type === 'world' ? (
          <WorldSettingsInspector world={project.world} />
        ) : (
          <div className="space-y-4">
            <RosNameField
              id="robot-name-input"
              label="Robot Name"
              value={project.robot.name}
              onCommit={(name) => setRobotName(name)}
            />

            <div className="space-y-1.5 border-t border-[#222938] pt-3 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>Package</span>
                <span className="font-mono text-slate-200">{project.name}</span>
              </div>
              <div className="flex justify-between">
                <span>Target</span>
                <span className="font-mono text-slate-200">{project.target}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Mass</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {totalMass.toFixed(2)} kg
                </span>
              </div>
              <div className="flex justify-between">
                <span>Links / Joints</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {project.robot.links.length} / {project.robot.joints.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Sensors / Plugins</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {project.robot.sensors.length} / {project.robot.plugins.length}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
