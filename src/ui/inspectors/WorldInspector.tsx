import { Trash2 } from 'lucide-react';
import type { Light, World, WorldObject } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { NumericField, PoseFields, RosNameField } from '@/ui/inspectors/NumericField';

export function WorldSettingsInspector({ world }: { world: World }) {
  const units = useRoboForgeStore((s) => s.units);
  const updateWorld = useRoboForgeStore((s) => s.updateWorld);

  return (
    <div className="space-y-4">
      <RosNameField
        id="world-name-input"
        label="World Name"
        value={world.name}
        onCommit={(name) =>
          updateWorld((w) => {
            w.name = name;
          })
        }
      />

      <div className="space-y-2 border-t border-[#222938] pt-3">
        <span className="text-xs font-semibold text-slate-200">Physics Solver</span>
        <div className="grid grid-cols-2 gap-2">
          <NumericField
            id="world-step"
            label="Step Size"
            value={world.physics.stepSize}
            unitMode="time"
            unitSystem={units}
            step={0.001}
            min={0.0001}
            onCommit={(val) =>
              updateWorld((w) => {
                w.physics.stepSize = val;
              })
            }
          />
          <NumericField
            id="world-rtf"
            label="Real-Time Factor"
            value={world.physics.realTimeFactor}
            unitMode="raw"
            unitSystem={units}
            step={0.1}
            min={0.1}
            onCommit={(val) =>
              updateWorld((w) => {
                w.physics.realTimeFactor = val;
              })
            }
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
            <NumericField
              key={axis}
              id={`world-grav-${axis}`}
              label={`Grav ${axis}`}
              value={world.physics.gravity[idx as 0 | 1 | 2]}
              unitMode="raw"
              unitSystem={units}
              step={0.1}
              onCommit={(val) =>
                updateWorld((w) => {
                  w.physics.gravity[idx as 0 | 1 | 2] = val;
                })
              }
            />
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-[#222938] pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">Ground Plane</span>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={world.ground.enabled}
              onChange={(e) =>
                updateWorld((w) => {
                  w.ground.enabled = e.target.checked;
                })
              }
            />
            Enabled
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NumericField
            id="ground-w"
            label="Width"
            value={world.ground.size[0]}
            unitMode="length"
            unitSystem={units}
            step={1}
            min={1}
            onCommit={(val) =>
              updateWorld((w) => {
                w.ground.size[0] = val;
              })
            }
          />
          <NumericField
            id="ground-l"
            label="Length"
            value={world.ground.size[1]}
            unitMode="length"
            unitSystem={units}
            step={1}
            min={1}
            onCommit={(val) =>
              updateWorld((w) => {
                w.ground.size[1] = val;
              })
            }
          />
          <NumericField
            id="ground-fric"
            label="Friction"
            value={world.ground.friction}
            unitMode="raw"
            unitSystem={units}
            step={0.1}
            min={0}
            onCommit={(val) =>
              updateWorld((w) => {
                w.ground.friction = val;
              })
            }
          />
        </div>
      </div>

      <div className="space-y-1.5 border-t border-[#222938] pt-3">
        <span className="text-xs font-semibold text-slate-200">Robot Spawn Pose</span>
        <PoseFields
          idPrefix="spawn-pose"
          pose={world.robotSpawnPose}
          units={units}
          onChangeAxis={(group, idx, val) =>
            updateWorld((w) => {
              w.robotSpawnPose[group][idx] = val;
            })
          }
        />
      </div>
    </div>
  );
}

export function WorldObjectInspector({ obj }: { obj: WorldObject }) {
  const units = useRoboForgeStore((s) => s.units);
  const updateWorldObject = useRoboForgeStore((s) => s.updateWorldObject);
  const deleteWorldObject = useRoboForgeStore((s) => s.deleteWorldObject);

  return (
    <div className="space-y-4">
      <RosNameField
        id="world-obj-name"
        label="Object Name"
        value={obj.name}
        onCommit={(name) =>
          updateWorldObject(obj.id, (draft) => {
            draft.name = name;
          })
        }
      />

      {obj.source.type === 'model' ? (
        <label className="block space-y-1 text-xs">
          <span className="text-[11px] text-slate-400">Gazebo Model URI</span>
          <Input
            value={obj.source.uri}
            onChange={(e) =>
              updateWorldObject(obj.id, (draft) => {
                if (draft.source.type === 'model') {
                  draft.source.uri = e.target.value;
                }
              })
            }
            className="font-mono text-xs"
          />
        </label>
      ) : (
        <div className="space-y-2 border-t border-[#222938] pt-3">
          <span className="text-xs font-semibold text-slate-200">
            Obstacle Geometry ({obj.source.shape.kind})
          </span>
          {obj.source.shape.kind === 'box' && (
            <div className="grid grid-cols-3 gap-2">
              {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                <NumericField
                  key={axis}
                  id={`wobj-box-${axis}`}
                  label={`Size ${axis}`}
                  value={
                    obj.source.type === 'primitive' && obj.source.shape.kind === 'box'
                      ? obj.source.shape.size[idx as 0 | 1 | 2]
                      : 1
                  }
                  unitMode="length"
                  unitSystem={units}
                  min={0.05}
                  onCommit={(val) =>
                    updateWorldObject(obj.id, (draft) => {
                      if (draft.source.type === 'primitive' && draft.source.shape.kind === 'box') {
                        draft.source.shape.size[idx as 0 | 1 | 2] = val;
                      }
                    })
                  }
                />
              ))}
            </div>
          )}
          {(obj.source.shape.kind === 'cylinder' || obj.source.shape.kind === 'capsule') && (
            <div className="grid grid-cols-2 gap-2">
              <NumericField
                id="wobj-r"
                label="Radius"
                value={obj.source.shape.radius}
                unitMode="length"
                unitSystem={units}
                min={0.02}
                onCommit={(val) =>
                  updateWorldObject(obj.id, (draft) => {
                    if (
                      draft.source.type === 'primitive' &&
                      (draft.source.shape.kind === 'cylinder' ||
                        draft.source.shape.kind === 'capsule')
                    ) {
                      draft.source.shape.radius = val;
                    }
                  })
                }
              />
              <NumericField
                id="wobj-l"
                label="Length"
                value={obj.source.shape.length}
                unitMode="length"
                unitSystem={units}
                min={0.02}
                onCommit={(val) =>
                  updateWorldObject(obj.id, (draft) => {
                    if (
                      draft.source.type === 'primitive' &&
                      (draft.source.shape.kind === 'cylinder' ||
                        draft.source.shape.kind === 'capsule')
                    ) {
                      draft.source.shape.length = val;
                    }
                  })
                }
              />
            </div>
          )}
        </div>
      )}

      <div className="border-t border-[#222938] pt-3">
        <span className="block pb-1.5 text-xs font-semibold text-slate-200">World Pose</span>
        <PoseFields
          idPrefix="wobj-pose"
          pose={obj.pose}
          units={units}
          onChangeAxis={(group, idx, val) =>
            updateWorldObject(obj.id, (draft) => {
              draft.pose[group][idx] = val;
            })
          }
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[#222938] pt-3 text-xs">
        <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={obj.static}
            onChange={(e) =>
              updateWorldObject(obj.id, (draft) => {
                draft.static = e.target.checked;
              })
            }
          />
          Static Body
        </label>
        {!obj.static && (
          <div className="w-28">
            <NumericField
              id="wobj-mass"
              label="Mass"
              value={obj.mass ?? 5}
              unitMode="mass"
              unitSystem={units}
              step={0.5}
              min={0.1}
              onCommit={(val) =>
                updateWorldObject(obj.id, (draft) => {
                  draft.mass = val;
                })
              }
            />
          </div>
        )}
      </div>

      <div className="border-t border-[#222938] pt-3">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => deleteWorldObject(obj.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove Object
        </Button>
      </div>
    </div>
  );
}

export function WorldLightInspector({ light }: { light: Light }) {
  const units = useRoboForgeStore((s) => s.units);
  const updateWorldLight = useRoboForgeStore((s) => s.updateWorldLight);
  const deleteWorldLight = useRoboForgeStore((s) => s.deleteWorldLight);

  return (
    <div className="space-y-4">
      <RosNameField
        id="light-name-input"
        label="Light Name"
        value={light.name}
        onCommit={(name) =>
          updateWorldLight(light.id, (draft) => {
            draft.name = name;
          })
        }
      />

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="space-y-1">
          <span className="text-[11px] text-slate-400">Type</span>
          <select
            value={light.type}
            onChange={(e) =>
              updateWorldLight(light.id, (draft) => {
                draft.type = e.target.value as Light['type'];
              })
            }
            className="h-7 w-full rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-xs text-slate-200"
          >
            <option value="directional">directional</option>
            <option value="point">point</option>
            <option value="spot">spot</option>
          </select>
        </label>
        <NumericField
          id="light-intensity"
          label="Intensity"
          value={light.intensity}
          unitMode="raw"
          unitSystem={units}
          step={0.1}
          min={0}
          onCommit={(val) =>
            updateWorldLight(light.id, (draft) => {
              draft.intensity = val;
            })
          }
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
        <input
          type="checkbox"
          checked={light.castShadows}
          onChange={(e) =>
            updateWorldLight(light.id, (draft) => {
              draft.castShadows = e.target.checked;
            })
          }
        />
        Cast Shadows
      </label>

      <div className="border-t border-[#222938] pt-3">
        <span className="block pb-1.5 text-xs font-semibold text-slate-200">Light Pose</span>
        <PoseFields
          idPrefix="light-pose"
          pose={light.pose}
          units={units}
          onChangeAxis={(group, idx, val) =>
            updateWorldLight(light.id, (draft) => {
              draft.pose[group][idx] = val;
            })
          }
        />
      </div>

      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="w-full"
        onClick={() => deleteWorldLight(light.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove Light
      </Button>
    </div>
  );
}
