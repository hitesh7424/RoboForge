import { useEffect, useMemo, useState } from 'react';
import { GitCommitHorizontal } from 'lucide-react';
import { createZeroPose } from '@/core/defaults';
import type { Joint } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { Button } from '@/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';

export function JointAttachDialog() {
  const project = useRoboForgeStore((s) => s.project);
  const pending = useRoboForgeStore((s) => s.pendingJointAttach);
  const setPendingJointAttach = useRoboForgeStore((s) => s.setPendingJointAttach);
  const addJoint = useRoboForgeStore((s) => s.addJoint);
  const addMountToLink = useRoboForgeStore((s) => s.addMountToLink);

  const [parentMountId, setParentMountId] = useState('');
  const [jointType, setJointType] = useState<Joint['type']>('fixed');
  const [createDedicatedMount, setCreateDedicatedMount] = useState(true);

  const parentLink = pending
    ? project.robot.links.find((l) => l.id === pending.parentLinkId)
    : undefined;
  const childLink = pending
    ? project.robot.links.find((l) => l.id === pending.childLinkId)
    : undefined;

  const isSelectedMountOccupied = useMemo(() => {
    if (!parentLink || !parentMountId) return false;
    const usedByJoint = project.robot.joints.some(
      (j) => j.parent.linkId === parentLink.id && j.parent.mountId === parentMountId,
    );
    const usedBySensor = project.robot.sensors.some(
      (s) => s.linkId === parentLink.id && s.mountId === parentMountId,
    );
    return usedByJoint || usedBySensor;
  }, [parentLink, parentMountId, project.robot.joints, project.robot.sensors]);

  useEffect(() => {
    if (pending) {
      setParentMountId(pending.parentMountId);
      setJointType(childLink?.name.includes('wheel') ? 'continuous' : 'fixed');
      const occupied =
        project.robot.joints.some(
          (j) => j.parent.linkId === pending.parentLinkId && j.parent.mountId === pending.parentMountId,
        ) ||
        project.robot.sensors.some(
          (s) => s.linkId === pending.parentLinkId && s.mountId === pending.parentMountId,
        );
      setCreateDedicatedMount(occupied);
    }
  }, [pending, childLink?.name, project.robot.joints, project.robot.sensors]);

  if (!pending || !parentLink || !childLink) return null;

  const suggestedMountName = `${childLink.name}_mount`;

  const handleAttach = () => {
    let targetMountId = parentMountId || parentLink.mounts[0]?.id || '';
    if (createDedicatedMount) {
      const baseMount = parentLink.mounts.find((m) => m.id === targetMountId);
      const basePose = baseMount ? structuredClone(baseMount.pose) : createZeroPose();
      // Slightly offset new mount along +Z or +Y when cloning an occupied mount so parts don't overlap identically
      if (isSelectedMountOccupied) {
        basePose.xyz = [
          basePose.xyz[0],
          basePose.xyz[1] + 0.15,
          basePose.xyz[2],
        ];
      }
      const createdMount = addMountToLink(parentLink.id, suggestedMountName, basePose);
      if (createdMount) {
        targetMountId = createdMount.id;
      }
    }

    addJoint(
      parentLink.id,
      targetMountId,
      childLink.id,
      childLink.mounts[0]?.id,
      jointType,
    );
    setPendingJointAttach(null);
  };

  return (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPendingJointAttach(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCommitHorizontal className="h-4 w-4 text-blue-400" />
            Attach "{childLink.name}" with Joint
          </DialogTitle>
          <DialogDescription>
            Connect the newly dropped link to a named mount on "{parentLink.name}" or keep it
            unattached.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <label className="flex items-start gap-2 rounded border border-[#222938] bg-[#0e121a] p-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={createDedicatedMount}
              onChange={(e) => setCreateDedicatedMount(e.target.checked)}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <span className="block font-medium text-slate-200">
                Create dedicated mount "{suggestedMountName}" on {parentLink.name}
              </span>
              <span className="block text-[11px] text-slate-400">
                {isSelectedMountOccupied
                  ? 'Recommended: selected mount is already used by another joint or sensor.'
                  : 'Keeps each attached part independently movable along its own mount.'}
              </span>
            </div>
          </label>

          {!createDedicatedMount && (
            <label className="block space-y-1">
              <span className="text-slate-400">Parent Mount on {parentLink.name}</span>
              <select
                value={parentMountId}
                onChange={(e) => setParentMountId(e.target.value)}
                className="h-8 w-full rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-xs text-slate-200"
              >
                {parentLink.mounts.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-slate-400">Joint Type</span>
            <select
              value={jointType}
              onChange={(e) => setJointType(e.target.value as Joint['type'])}
              className="h-8 w-full rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-xs text-slate-200"
            >
              <option value="fixed">fixed</option>
              <option value="continuous">continuous (wheel / rotor)</option>
              <option value="revolute">revolute (limited hinge)</option>
              <option value="prismatic">prismatic (linear slide)</option>
            </select>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setPendingJointAttach(null)}>
            Keep Unattached
          </Button>
          <Button type="button" onClick={handleAttach}>
            Attach Joint
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
