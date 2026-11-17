import { Trash2 } from 'lucide-react';
import type { Joint, Plugin, Sensor } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { NumericField, RosNameField } from '@/ui/inspectors/NumericField';

export function JointInspector({ joint }: { joint: Joint }) {
  const project = useRoboForgeStore((s) => s.project);
  const units = useRoboForgeStore((s) => s.units);
  const updateJoint = useRoboForgeStore((s) => s.updateJoint);
  const deleteJoint = useRoboForgeStore((s) => s.deleteJoint);

  const parentLink = project.robot.links.find((l) => l.id === joint.parent.linkId);
  const childLink = project.robot.links.find((l) => l.id === joint.child.linkId);

  return (
    <div className="space-y-4">
      <RosNameField
        id="joint-name-input"
        label="Joint Name"
        value={joint.name}
        onCommit={(name) =>
          updateJoint(joint.id, (draft) => {
            draft.name = name;
          })
        }
      />

      <div className="space-y-1 text-xs">
        <label htmlFor="joint-type-select" className="text-[11px] text-slate-400">
          Joint Type
        </label>
        <select
          id="joint-type-select"
          value={joint.type}
          onChange={(e) => {
            const nextType = e.target.value as Joint['type'];
            updateJoint(joint.id, (draft) => {
              draft.type = nextType;
              if ((nextType === 'revolute' || nextType === 'prismatic') && !draft.limits) {
                draft.limits =
                  nextType === 'prismatic'
                    ? { lower: -0.25, upper: 0.25, effort: 50, velocity: 0.5 }
                    : { lower: -1.57, upper: 1.57, effort: 20, velocity: 2 };
              }
            });
          }}
          className="h-7 w-full rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-xs text-slate-200"
        >
          <option value="fixed">fixed</option>
          <option value="revolute">revolute</option>
          <option value="continuous">continuous</option>
          <option value="prismatic">prismatic</option>
        </select>
      </div>

      {/* Parent & Child Mount Bindings */}
      <div className="space-y-2 border-t border-[#222938] pt-3 text-xs">
        <div className="space-y-1">
          <span className="text-[11px] text-slate-400">Parent Link & Mount</span>
          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={joint.parent.linkId}
              onChange={(e) => {
                const newParent = project.robot.links.find((l) => l.id === e.target.value);
                if (!newParent || !newParent.mounts[0]) return;
                updateJoint(joint.id, (draft) => {
                  draft.parent.linkId = newParent.id;
                  draft.parent.mountId = newParent.mounts[0]!.id;
                });
              }}
              className="h-7 rounded border border-[#2a3346] bg-[#0e121a] px-1.5 font-mono text-[11px] text-slate-200"
            >
              {project.robot.links
                .filter((l) => l.id !== joint.child.linkId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
            <select
              value={joint.parent.mountId}
              onChange={(e) =>
                updateJoint(joint.id, (draft) => {
                  draft.parent.mountId = e.target.value;
                })
              }
              className="h-7 rounded border border-[#2a3346] bg-[#0e121a] px-1.5 font-mono text-[11px] text-slate-200"
            >
              {parentLink?.mounts.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <span className="text-[11px] text-slate-400">Child Link & Mount</span>
          <div className="grid grid-cols-2 gap-1.5">
            <span className="flex h-7 items-center rounded border border-[#222938] bg-[#0b0e14] px-2 font-mono text-[11px] text-slate-300 truncate">
              {childLink?.name ?? 'missing'}
            </span>
            <select
              value={joint.child.mountId}
              onChange={(e) =>
                updateJoint(joint.id, (draft) => {
                  draft.child.mountId = e.target.value;
                })
              }
              className="h-7 rounded border border-[#2a3346] bg-[#0e121a] px-1.5 font-mono text-[11px] text-slate-200"
            >
              {childLink?.mounts.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {joint.type !== 'fixed' && (
        <div className="space-y-2 border-t border-[#222938] pt-3">
          <span className="text-xs font-semibold text-slate-200">Axis & Dynamics</span>
          <div className="grid grid-cols-3 gap-2">
            {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
              <NumericField
                key={axis}
                id={`joint-axis-${axis}`}
                label={`Axis ${axis}`}
                value={joint.axis[idx as 0 | 1 | 2]}
                unitMode="raw"
                unitSystem={units}
                step={0.1}
                onCommit={(val) =>
                  updateJoint(joint.id, (draft) => {
                    draft.axis[idx as 0 | 1 | 2] = val;
                  })
                }
              />
            ))}
          </div>

          {(joint.type === 'revolute' || joint.type === 'prismatic') && (
            <div className="grid grid-cols-2 gap-2">
              <NumericField
                id="joint-lim-lower"
                label="Lower"
                value={joint.limits?.lower ?? -1.57}
                unitMode={joint.type === 'prismatic' ? 'length' : 'angle'}
                unitSystem={units}
                onCommit={(val) =>
                  updateJoint(joint.id, (draft) => {
                    draft.limits = {
                      lower: val,
                      upper: draft.limits?.upper ?? 1.57,
                      effort: draft.limits?.effort ?? 10,
                      velocity: draft.limits?.velocity ?? 2,
                    };
                  })
                }
              />
              <NumericField
                id="joint-lim-upper"
                label="Upper"
                value={joint.limits?.upper ?? 1.57}
                unitMode={joint.type === 'prismatic' ? 'length' : 'angle'}
                unitSystem={units}
                onCommit={(val) =>
                  updateJoint(joint.id, (draft) => {
                    draft.limits = {
                      lower: draft.limits?.lower ?? -1.57,
                      upper: val,
                      effort: draft.limits?.effort ?? 10,
                      velocity: draft.limits?.velocity ?? 2,
                    };
                  })
                }
              />
              <NumericField
                id="joint-lim-effort"
                label="Effort"
                value={joint.limits?.effort ?? 10}
                unitMode="raw"
                unitSystem={units}
                step={1}
                onCommit={(val) =>
                  updateJoint(joint.id, (draft) => {
                    draft.limits = {
                      lower: draft.limits?.lower ?? -1.57,
                      upper: draft.limits?.upper ?? 1.57,
                      effort: val,
                      velocity: draft.limits?.velocity ?? 2,
                    };
                  })
                }
              />
              <NumericField
                id="joint-lim-vel"
                label="Velocity"
                value={joint.limits?.velocity ?? 2}
                unitMode={joint.type === 'prismatic' ? 'lin_vel' : 'ang_vel'}
                unitSystem={units}
                step={0.5}
                onCommit={(val) =>
                  updateJoint(joint.id, (draft) => {
                    draft.limits = {
                      lower: draft.limits?.lower ?? -1.57,
                      upper: draft.limits?.upper ?? 1.57,
                      effort: draft.limits?.effort ?? 10,
                      velocity: val,
                    };
                  })
                }
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <NumericField
              id="joint-damping"
              label="Damping"
              value={joint.dynamics?.damping ?? 0.1}
              unitMode="raw"
              unitSystem={units}
              step={0.05}
              min={0}
              onCommit={(val) =>
                updateJoint(joint.id, (draft) => {
                  draft.dynamics = { damping: val, friction: draft.dynamics?.friction ?? 0.1 };
                })
              }
            />
            <NumericField
              id="joint-friction"
              label="Friction"
              value={joint.dynamics?.friction ?? 0.1}
              unitMode="raw"
              unitSystem={units}
              step={0.05}
              min={0}
              onCommit={(val) =>
                updateJoint(joint.id, (draft) => {
                  draft.dynamics = { damping: draft.dynamics?.damping ?? 0.1, friction: val };
                })
              }
            />
          </div>
        </div>
      )}

      <div className="border-t border-[#222938] pt-3">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => deleteJoint(joint.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete Joint
        </Button>
      </div>
    </div>
  );
}

export function SensorInspector({ sensor }: { sensor: Sensor }) {
  const project = useRoboForgeStore((s) => s.project);
  const units = useRoboForgeStore((s) => s.units);
  const updateSensor = useRoboForgeStore((s) => s.updateSensor);
  const deleteSensor = useRoboForgeStore((s) => s.deleteSensor);

  const hostLink = project.robot.links.find((l) => l.id === sensor.linkId);

  return (
    <div className="space-y-4">
      <RosNameField
        id="sensor-name-input"
        label="Sensor Name"
        value={sensor.name}
        onCommit={(name) =>
          updateSensor(sensor.id, (draft) => {
            draft.name = name;
          })
        }
      />

      <div className="space-y-1 text-xs">
        <label className="text-[11px] text-slate-400">ROS Topic</label>
        <Input
          value={sensor.topic}
          onChange={(e) =>
            updateSensor(sensor.id, (draft) => {
              draft.topic = e.target.value;
            })
          }
          className="font-mono"
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-xs">
        <label className="space-y-1">
          <span className="text-[11px] text-slate-400">Host Link</span>
          <select
            value={sensor.linkId}
            onChange={(e) => {
              const nextLink = project.robot.links.find((l) => l.id === e.target.value);
              if (!nextLink || !nextLink.mounts[0]) return;
              updateSensor(sensor.id, (draft) => {
                draft.linkId = nextLink.id;
                draft.mountId = nextLink.mounts[0]!.id;
              });
            }}
            className="h-7 w-full rounded border border-[#2a3346] bg-[#0e121a] px-1.5 font-mono text-[11px] text-slate-200"
          >
            {project.robot.links.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-slate-400">Mount</span>
          <select
            value={sensor.mountId}
            onChange={(e) =>
              updateSensor(sensor.id, (draft) => {
                draft.mountId = e.target.value;
              })
            }
            className="h-7 w-full rounded border border-[#2a3346] bg-[#0e121a] px-1.5 font-mono text-[11px] text-slate-200"
          >
            {hostLink?.mounts.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <NumericField
        id="sensor-rate"
        label="Update Rate (Hz)"
        value={sensor.updateRate}
        unitMode="raw"
        unitSystem={units}
        step={1}
        min={1}
        onCommit={(val) =>
          updateSensor(sensor.id, (draft) => {
            draft.updateRate = val;
          })
        }
      />

      {sensor.kind === 'lidar2d' && (
        <div className="grid grid-cols-2 gap-2 border-t border-[#222938] pt-3">
          <NumericField
            id="lidar2d-samples"
            label="Samples"
            value={sensor.samples}
            unitMode="raw"
            unitSystem={units}
            step={16}
            min={16}
            onCommit={(val) =>
              updateSensor(sensor.id, (draft) => {
                if (draft.kind === 'lidar2d') draft.samples = Math.round(val);
              })
            }
          />
          <NumericField
            id="lidar2d-maxrange"
            label="Max Range"
            value={sensor.maxRange}
            unitMode="length"
            unitSystem={units}
            step={0.5}
            min={0.5}
            onCommit={(val) =>
              updateSensor(sensor.id, (draft) => {
                if (draft.kind === 'lidar2d') draft.maxRange = val;
              })
            }
          />
        </div>
      )}

      {(sensor.kind === 'camera' || sensor.kind === 'depth_camera') && (
        <div className="grid grid-cols-3 gap-2 border-t border-[#222938] pt-3">
          <NumericField
            id="cam-width"
            label="Width (px)"
            value={sensor.width}
            unitMode="raw"
            unitSystem={units}
            step={16}
            min={64}
            onCommit={(val) =>
              updateSensor(sensor.id, (draft) => {
                if (draft.kind === 'camera' || draft.kind === 'depth_camera') {
                  draft.width = Math.round(val);
                }
              })
            }
          />
          <NumericField
            id="cam-height"
            label="Height (px)"
            value={sensor.height}
            unitMode="raw"
            unitSystem={units}
            step={16}
            min={64}
            onCommit={(val) =>
              updateSensor(sensor.id, (draft) => {
                if (draft.kind === 'camera' || draft.kind === 'depth_camera') {
                  draft.height = Math.round(val);
                }
              })
            }
          />
          <NumericField
            id="cam-fov"
            label="HFOV"
            value={sensor.horizontalFov}
            unitMode="angle"
            unitSystem={units}
            step={0.05}
            min={0.2}
            onCommit={(val) =>
              updateSensor(sensor.id, (draft) => {
                if (draft.kind === 'camera' || draft.kind === 'depth_camera') {
                  draft.horizontalFov = val;
                }
              })
            }
          />
        </div>
      )}

      <div className="border-t border-[#222938] pt-3">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => deleteSensor(sensor.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove Sensor
        </Button>
      </div>
    </div>
  );
}

export function PluginInspector({ plugin }: { plugin: Plugin }) {
  const project = useRoboForgeStore((s) => s.project);
  const units = useRoboForgeStore((s) => s.units);
  const updatePlugin = useRoboForgeStore((s) => s.updatePlugin);
  const deletePlugin = useRoboForgeStore((s) => s.deletePlugin);

  const movableJoints = project.robot.joints.filter((j) => j.type !== 'fixed');

  return (
    <div className="space-y-4">
      <RosNameField
        id="plugin-name-input"
        label="Plugin Name"
        value={plugin.name}
        onCommit={(name) =>
          updatePlugin(plugin.id, (draft) => {
            draft.name = name;
          })
        }
      />

      {plugin.kind === 'diff_drive' && (
        <div className="space-y-3 border-t border-[#222938] pt-3 text-xs">
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-slate-400">Left Wheel Joints</span>
            <div className="space-y-1 rounded border border-[#222938] bg-[#0d1118] p-2">
              {movableJoints.map((j) => (
                <label
                  key={j.id}
                  className="flex items-center gap-2 font-mono text-[11px] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={plugin.leftJointIds.includes(j.id)}
                    onChange={(e) =>
                      updatePlugin(plugin.id, (draft) => {
                        if (draft.kind !== 'diff_drive') return;
                        if (e.target.checked) {
                          if (!draft.leftJointIds.includes(j.id)) draft.leftJointIds.push(j.id);
                        } else {
                          draft.leftJointIds = draft.leftJointIds.filter((id) => id !== j.id);
                        }
                      })
                    }
                  />
                  {j.name}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-medium text-slate-400">Right Wheel Joints</span>
            <div className="space-y-1 rounded border border-[#222938] bg-[#0d1118] p-2">
              {movableJoints.map((j) => (
                <label
                  key={j.id}
                  className="flex items-center gap-2 font-mono text-[11px] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={plugin.rightJointIds.includes(j.id)}
                    onChange={(e) =>
                      updatePlugin(plugin.id, (draft) => {
                        if (draft.kind !== 'diff_drive') return;
                        if (e.target.checked) {
                          if (!draft.rightJointIds.includes(j.id)) draft.rightJointIds.push(j.id);
                        } else {
                          draft.rightJointIds = draft.rightJointIds.filter((id) => id !== j.id);
                        }
                      })
                    }
                  />
                  {j.name}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <NumericField
              id="dd-sep"
              label="Wheel Sep"
              value={plugin.wheelSeparation}
              unitMode="length"
              unitSystem={units}
              min={0.05}
              onCommit={(val) =>
                updatePlugin(plugin.id, (draft) => {
                  if (draft.kind === 'diff_drive') draft.wheelSeparation = val;
                })
              }
            />
            <NumericField
              id="dd-rad"
              label="Wheel Rad"
              value={plugin.wheelRadius}
              unitMode="length"
              unitSystem={units}
              min={0.01}
              onCommit={(val) =>
                updatePlugin(plugin.id, (draft) => {
                  if (draft.kind === 'diff_drive') draft.wheelRadius = val;
                })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">cmd_vel Topic</span>
              <Input
                value={plugin.cmdVelTopic}
                onChange={(e) =>
                  updatePlugin(plugin.id, (draft) => {
                    if (draft.kind === 'diff_drive') draft.cmdVelTopic = e.target.value;
                  })
                }
                className="font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">odom Topic</span>
              <Input
                value={plugin.odomTopic}
                onChange={(e) =>
                  updatePlugin(plugin.id, (draft) => {
                    if (draft.kind === 'diff_drive') draft.odomTopic = e.target.value;
                  })
                }
                className="font-mono"
              />
            </label>
          </div>
        </div>
      )}

      {plugin.kind === 'joint_state_publisher' && (
        <label className="block space-y-1 text-xs">
          <span className="text-[11px] text-slate-400">Joint States Topic</span>
          <Input
            value={plugin.topic}
            onChange={(e) =>
              updatePlugin(plugin.id, (draft) => {
                if (draft.kind === 'joint_state_publisher') draft.topic = e.target.value;
              })
            }
            className="font-mono"
          />
        </label>
      )}

      {plugin.kind === 'joint_controller' && (
        <div className="space-y-2 border-t border-[#222938] pt-3 text-xs">
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">Target Joint</span>
            <select
              value={plugin.jointId}
              onChange={(e) =>
                updatePlugin(plugin.id, (draft) => {
                  if (draft.kind === 'joint_controller') draft.jointId = e.target.value;
                })
              }
              className="h-7 w-full rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-xs text-slate-200"
            >
              {movableJoints.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <NumericField
              id="pid-p"
              label="P Gain"
              value={plugin.pGain}
              unitMode="raw"
              unitSystem={units}
              step={1}
              onCommit={(val) =>
                updatePlugin(plugin.id, (draft) => {
                  if (draft.kind === 'joint_controller') draft.pGain = val;
                })
              }
            />
            <NumericField
              id="pid-i"
              label="I Gain"
              value={plugin.iGain}
              unitMode="raw"
              unitSystem={units}
              step={0.1}
              onCommit={(val) =>
                updatePlugin(plugin.id, (draft) => {
                  if (draft.kind === 'joint_controller') draft.iGain = val;
                })
              }
            />
            <NumericField
              id="pid-d"
              label="D Gain"
              value={plugin.dGain}
              unitMode="raw"
              unitSystem={units}
              step={0.1}
              onCommit={(val) =>
                updatePlugin(plugin.id, (draft) => {
                  if (draft.kind === 'joint_controller') draft.dGain = val;
                })
              }
            />
          </div>
        </div>
      )}

      <div className="border-t border-[#222938] pt-3">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => deletePlugin(plugin.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove Plugin
        </Button>
      </div>
    </div>
  );
}
