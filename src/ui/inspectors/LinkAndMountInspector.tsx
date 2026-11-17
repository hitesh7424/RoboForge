import { useState } from 'react';
import { AlertTriangle, Plus, Trash2, Wrench } from 'lucide-react';
import { createZeroPose } from '@/core/defaults';
import { resolveLinkInertia } from '@/core/inertia';
import type { Link, Mount, Primitive } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { formatInertiaSummary } from '@/core/units';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import { NumericField, PoseFields, RosNameField } from '@/ui/inspectors/NumericField';
import { TexturePicker } from '@/ui/inspectors/TexturePicker';

function rgbaToHex(rgba: [number, number, number, number]): string {
  const r = Math.round(rgba[0] * 255)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(rgba[1] * 255)
    .toString(16)
    .padStart(2, '0');
  const b = Math.round(rgba[2] * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [Number.isFinite(r) ? r : 0.5, Number.isFinite(g) ? g : 0.5, Number.isFinite(b) ? b : 0.5];
}

function PrimitiveDims({
  idPrefix,
  shape,
  onChange,
}: {
  idPrefix: string;
  shape: Primitive;
  onChange: (mutator: (shape: Primitive) => void) => void;
}) {
  const units = useRoboForgeStore((s) => s.units);

  if (shape.kind === 'box') {
    return (
      <div className="grid grid-cols-3 gap-2">
        {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
          <NumericField
            key={axis}
            id={`${idPrefix}-box-${axis}`}
            label={`Size ${axis}`}
            value={shape.size[idx as 0 | 1 | 2]}
            unitMode="length"
            unitSystem={units}
            min={0.001}
            onCommit={(val) =>
              onChange((s) => {
                if (s.kind === 'box') s.size[idx as 0 | 1 | 2] = val;
              })
            }
          />
        ))}
      </div>
    );
  }

  if (shape.kind === 'cylinder' || shape.kind === 'capsule') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <NumericField
          id={`${idPrefix}-radius`}
          label="Radius"
          value={shape.radius}
          unitMode="length"
          unitSystem={units}
          min={0.001}
          onCommit={(val) =>
            onChange((s) => {
              if (s.kind === 'cylinder' || s.kind === 'capsule') s.radius = val;
            })
          }
        />
        <NumericField
          id={`${idPrefix}-length`}
          label="Length"
          value={shape.length}
          unitMode="length"
          unitSystem={units}
          min={0.001}
          onCommit={(val) =>
            onChange((s) => {
              if (s.kind === 'cylinder' || s.kind === 'capsule') s.length = val;
            })
          }
        />
      </div>
    );
  }

  if (shape.kind === 'sphere') {
    return (
      <NumericField
        id={`${idPrefix}-sphere-r`}
        label="Radius"
        value={shape.radius}
        unitMode="length"
        unitSystem={units}
        min={0.001}
        onCommit={(val) =>
          onChange((s) => {
            if (s.kind === 'sphere') s.radius = val;
          })
        }
      />
    );
  }

  return (
    <NumericField
      id={`${idPrefix}-extrude-depth`}
      label="Extrude Depth"
      value={shape.depth}
      unitMode="length"
      unitSystem={units}
      min={0.001}
      onCommit={(val) =>
        onChange((s) => {
          if (s.kind === 'extrude') s.depth = val;
        })
      }
    />
  );
}

export function LinkInspector({ link }: { link: Link }) {
  const units = useRoboForgeStore((s) => s.units);
  const select = useRoboForgeStore((s) => s.select);
  const updateLink = useRoboForgeStore((s) => s.updateLink);
  const addMountToLink = useRoboForgeStore((s) => s.addMountToLink);
  const deleteMountFromLink = useRoboForgeStore((s) => s.deleteMountFromLink);
  const openPartEditor = useRoboForgeStore((s) => s.openPartEditor);

  const [newMountName, setNewMountName] = useState('');

  const inertiaRes = resolveLinkInertia(link);
  const visualShape = link.visual.geometry.type === 'primitive' ? link.visual.geometry.shape : null;
  const isSameCollision = 'sameAsVisual' in link.collision;

  return (
    <div className="space-y-4">
      <RosNameField
        id="link-name-input"
        label="Link Name"
        value={link.name}
        onCommit={(name) =>
          updateLink(link.id, (draft) => {
            draft.name = name;
          })
        }
      />

      {/* Visual Geometry & Material */}
      <div className="space-y-2 border-t border-[#222938] pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">
            Visual ({link.visual.geometry.type})
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => openPartEditor(null)}
            className="h-6 px-2 text-[11px]"
          >
            <Wrench className="h-3 w-3" />
            Part / Mesh
          </Button>
        </div>

        {visualShape && (
          <PrimitiveDims
            idPrefix="vis"
            shape={visualShape}
            onChange={(mutator) =>
              updateLink(link.id, (draft) => {
                if (draft.visual.geometry.type === 'primitive') {
                  mutator(draft.visual.geometry.shape);
                }
              })
            }
          />
        )}

        {link.visual.geometry.type === 'mesh' && (
          <div className="grid grid-cols-3 gap-2">
            {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
              <NumericField
                key={axis}
                id={`mesh-scale-${axis}`}
                label={`Scale ${axis}`}
                value={
                  link.visual.geometry.type === 'mesh'
                    ? link.visual.geometry.scale[idx as 0 | 1 | 2]
                    : 1
                }
                unitMode="raw"
                unitSystem={units}
                min={0.01}
                step={0.1}
                onCommit={(val) =>
                  updateLink(link.id, (draft) => {
                    if (draft.visual.geometry.type === 'mesh') {
                      draft.visual.geometry.scale[idx as 0 | 1 | 2] = val;
                    }
                  })
                }
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1 text-xs">
          <span className="text-[11px] text-slate-400">Material Color</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-slate-300">
              {link.visual.material.name}
            </span>
            <input
              type="color"
              aria-label="Visual material color"
              value={rgbaToHex(link.visual.material.rgba)}
              onChange={(e) => {
                const [r, g, b] = hexToRgbTuple(e.target.value);
                updateLink(link.id, (draft) => {
                  draft.visual.material.rgba = [r, g, b, draft.visual.material.rgba[3]];
                });
              }}
              className="h-6 w-8 cursor-pointer rounded border border-[#2a3346] bg-transparent p-0"
            />
          </div>
        </div>

        <TexturePicker
          idPrefix={`link-${link.id}`}
          textureId={link.visual.material.textureId}
          textureRepeat={link.visual.material.textureRepeat}
          onChangeTexture={(nextTexId) =>
            updateLink(link.id, (draft) => {
              if (nextTexId) {
                draft.visual.material.textureId = nextTexId;
                draft.visual.material.rgba = [1, 1, 1, draft.visual.material.rgba[3]];
              } else {
                delete draft.visual.material.textureId;
              }
            })
          }
          onChangeRepeat={(rep) =>
            updateLink(link.id, (draft) => {
              draft.visual.material.textureRepeat = rep;
            })
          }
        />

        <div className="pt-1">
          <span className="block pb-1 text-[11px] text-slate-400">Visual Origin Pose</span>
          <PoseFields
            idPrefix="vis-pose"
            pose={link.visual.pose}
            units={units}
            onChangeAxis={(group, idx, val) =>
              updateLink(link.id, (draft) => {
                draft.visual.pose[group][idx] = val;
              })
            }
          />
        </div>
      </div>

      {/* Collision */}
      <div className="space-y-2 border-t border-[#222938] pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">Collision</span>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={isSameCollision}
              onChange={(e) =>
                updateLink(link.id, (draft) => {
                  if (e.target.checked) {
                    draft.collision = { sameAsVisual: true };
                  } else {
                    const fallbackShape: Primitive =
                      draft.visual.geometry.type === 'primitive'
                        ? structuredClone(draft.visual.geometry.shape)
                        : { kind: 'box', size: [0.3, 0.2, 0.1] };
                    draft.collision = {
                      geometry: { type: 'primitive', shape: fallbackShape },
                      pose: structuredClone(draft.visual.pose),
                    };
                  }
                })
              }
            />
            Same as Visual
          </label>
        </div>

        {!isSameCollision && 'geometry' in link.collision && (
          <div className="space-y-2">
            {link.collision.geometry.type === 'primitive' && (
              <PrimitiveDims
                idPrefix="col"
                shape={link.collision.geometry.shape}
                onChange={(mutator) =>
                  updateLink(link.id, (draft) => {
                    if (
                      !('sameAsVisual' in draft.collision) &&
                      draft.collision.geometry.type === 'primitive'
                    ) {
                      mutator(draft.collision.geometry.shape);
                    }
                  })
                }
              />
            )}
            <PoseFields
              idPrefix="col-pose"
              pose={link.collision.pose}
              units={units}
              onChangeAxis={(group, idx, val) =>
                updateLink(link.id, (draft) => {
                  if (!('sameAsVisual' in draft.collision)) {
                    draft.collision.pose[group][idx] = val;
                  }
                })
              }
            />
          </div>
        )}
      </div>

      {/* Inertial */}
      <div className="space-y-2 border-t border-[#222938] pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">Inertial</span>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={link.inertial.auto}
              onChange={(e) =>
                updateLink(link.id, (draft) => {
                  draft.inertial.auto = e.target.checked;
                  if (!e.target.checked && !draft.inertial.inertia) {
                    draft.inertial.inertia = structuredClone(inertiaRes.inertia);
                  }
                })
              }
            />
            Auto-compute
          </label>
        </div>

        <NumericField
          id="inertial-mass"
          label="Mass"
          value={link.inertial.mass}
          unitMode="mass"
          unitSystem={units}
          step={0.1}
          min={0.0001}
          onCommit={(val) =>
            updateLink(link.id, (draft) => {
              draft.inertial.mass = val;
            })
          }
        />

        {link.inertial.auto ? (
          <div className="grid grid-cols-3 gap-1 rounded border border-[#222938] bg-[#0d1118] p-2 font-mono text-[10px] text-slate-400 tabular-nums">
            <span>ixx: {formatInertiaSummary(inertiaRes.inertia.ixx, units)}</span>
            <span>iyy: {formatInertiaSummary(inertiaRes.inertia.iyy, units)}</span>
            <span>izz: {formatInertiaSummary(inertiaRes.inertia.izz, units)}</span>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {(['ixx', 'iyy', 'izz', 'ixy', 'ixz', 'iyz'] as const).map((field) => (
              <NumericField
                key={field}
                id={`inertia-${field}`}
                label={field}
                value={link.inertial.inertia?.[field] ?? inertiaRes.inertia[field]}
                unitMode="inertia"
                unitSystem={units}
                step={0.001}
                onCommit={(val) =>
                  updateLink(link.id, (draft) => {
                    if (!draft.inertial.inertia) {
                      draft.inertial.inertia = structuredClone(inertiaRes.inertia);
                    }
                    draft.inertial.inertia[field] = val;
                  })
                }
              />
            ))}
          </div>
        )}

        {inertiaRes.warnings.map((w, idx) => (
          <div
            key={idx}
            className="flex items-start gap-1.5 rounded bg-amber-950/40 p-1.5 text-[11px] text-amber-300"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{w}</span>
          </div>
        ))}
      </div>

      {/* Mounts */}
      <div className="space-y-2 border-t border-[#222938] pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">Named Mounts</span>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            {link.mounts.length}
          </span>
        </div>

        <div className="space-y-1">
          {link.mounts.map((mount) => (
            <div
              key={mount.id}
              className="flex items-center justify-between rounded border border-[#222938] bg-[#0e121a] px-2 py-1 text-xs"
            >
              <button
                type="button"
                onClick={() => select({ type: 'mount', linkId: link.id, mountId: mount.id })}
                className="flex-1 text-left font-mono text-slate-200 hover:text-blue-300 truncate cursor-pointer"
              >
                {mount.name}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-slate-400 hover:text-red-400"
                onClick={() => deleteMountFromLink(link.id, mount.id)}
                disabled={link.mounts.length <= 1}
                aria-label={`Delete mount ${mount.name}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const candidate = newMountName.trim() || 'aux_mount';
            addMountToLink(link.id, candidate, createZeroPose());
            setNewMountName('');
          }}
        >
          <Input
            aria-label="New mount name"
            placeholder="new_mount"
            value={newMountName}
            onChange={(e) => setNewMountName(e.target.value)}
            className="font-mono"
          />
          <Button type="submit" variant="secondary" size="sm" aria-label="Add mount">
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </form>
      </div>
    </div>
  );
}

export function MountInspector({ link, mount }: { link: Link; mount: Mount }) {
  const units = useRoboForgeStore((s) => s.units);
  const select = useRoboForgeStore((s) => s.select);
  const updateMountOnLink = useRoboForgeStore((s) => s.updateMountOnLink);
  const addLink = useRoboForgeStore((s) => s.addLink);
  const addSensor = useRoboForgeStore((s) => s.addSensor);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>
          Host Link: <strong className="font-mono text-slate-200">{link.name}</strong>
        </span>
        <button
          type="button"
          onClick={() => select({ type: 'link', id: link.id })}
          className="text-blue-400 hover:underline cursor-pointer"
        >
          Select Link
        </button>
      </div>

      <RosNameField
        id="mount-name-input"
        label="Mount Name"
        value={mount.name}
        onCommit={(name) =>
          updateMountOnLink(link.id, mount.id, (m) => {
            m.name = name;
          })
        }
      />

      <div className="border-t border-[#222938] pt-3">
        <span className="block pb-1.5 text-xs font-semibold text-slate-200">
          Mount Pose (Relative to {link.name})
        </span>
        <PoseFields
          idPrefix="mount-pose"
          pose={mount.pose}
          units={units}
          onChangeAxis={(group, idx, val) =>
            updateMountOnLink(link.id, mount.id, (m) => {
              m.pose[group][idx] = val;
            })
          }
        />
      </div>

      <div className="border-t border-[#222938] pt-3 space-y-1.5">
        <span className="text-xs font-semibold text-slate-200">Quick Attach Here</span>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              addLink({ kind: 'cylinder', radius: 0.08, length: 0.045 }, 'wheel_link', {
                attachTo: {
                  parentLinkId: link.id,
                  parentMountId: mount.id,
                  jointType: 'continuous',
                },
              })
            }
          >
            + Wheel Joint
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => addSensor('lidar2d', link.id, mount.id)}
          >
            + 2D LiDAR
          </Button>
        </div>
      </div>
    </div>
  );
}
