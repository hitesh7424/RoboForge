import { useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Box, Grid as GridIcon } from 'lucide-react';
import * as THREE from 'three';
import type { CameraProjection, CameraViewPreset } from '@/core/store';
import { isSoftwareGlRenderer } from '@/viewport/webglCaps';

const VIEW_DIRECTIONS: Record<CameraViewPreset, THREE.Vector3> = {
  iso: new THREE.Vector3(1, 0.72, 1).normalize(),
  top: new THREE.Vector3(0, 1, 0.001).normalize(),
  bottom: new THREE.Vector3(0, -1, 0.001).normalize(),
  front: new THREE.Vector3(1, 0.02, 0).normalize(),
  back: new THREE.Vector3(-1, 0.02, 0).normalize(),
  left: new THREE.Vector3(0, 0.02, -1).normalize(),
  right: new THREE.Vector3(0, 0.02, 1).normalize(),
};

const FOV_DEG = 45;
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(FOV_DEG / 2));

export function getViewOffset(view: CameraViewPreset, distance: number): THREE.Vector3 {
  return VIEW_DIRECTIONS[view].clone().multiplyScalar(distance);
}

export interface ViewportCameraRigProps {
  projection: CameraProjection;
  view: CameraViewPreset;
  presetTrigger: number;
  focusTrigger?: number;
  defaultDistance?: number;
  target?: [number, number, number];
  controlsEnabled?: boolean;
  minDistance?: number;
  maxDistance?: number;
  orbitRef?: React.RefObject<ComponentRef<typeof OrbitControls> | null>;
}

export function ViewportCameraRig({
  projection,
  view,
  presetTrigger,
  focusTrigger = 0,
  defaultDistance = 1.85,
  target = [0, 0, 0],
  controlsEnabled = true,
  minDistance = 0.2,
  maxDistance = Infinity,
  orbitRef: externalOrbitRef,
}: ViewportCameraRigProps) {
  const internalOrbitRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const orbitRef = externalOrbitRef ?? internalOrbitRef;

  const perspRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoRef = useRef<THREE.OrthographicCamera | null>(null);

  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const soft = useMemo(() => isSoftwareGlRenderer(), []);

  // Track last camera position/target/distance across Persp <-> Ortho switches
  const savedTargetRef = useRef(new THREE.Vector3(...target));
  const savedPosRef = useRef(getViewOffset(view, defaultDistance).add(savedTargetRef.current));
  const savedDistanceRef = useRef(defaultDistance);
  const prevProjectionRef = useRef<CameraProjection>(projection);

  const animGoalRef = useRef<{
    pos: THREE.Vector3;
    target: THREE.Vector3;
    zoom?: number;
  } | null>(null);

  // Sync saved pose continuously while user orbits
  const syncSavedFromActiveCamera = () => {
    const tgt = orbitRef.current?.target ?? savedTargetRef.current;
    savedTargetRef.current.copy(tgt);
    savedPosRef.current.copy(camera.position);
    const dist = camera.position.distanceTo(tgt);
    if (dist > 0.05) {
      savedDistanceRef.current = dist;
    }
  };

  // Preserve viewing angle & distance when switching between Perspective and Orthographic
  useEffect(() => {
    const prevProj = prevProjectionRef.current;
    if (prevProj === projection) return;
    prevProjectionRef.current = projection;

    const tgt = savedTargetRef.current.clone();
    const dir = savedPosRef.current.clone().sub(tgt);
    if (dir.lengthSq() < 1e-6) {
      dir.copy(VIEW_DIRECTIONS[view]);
    } else {
      dir.normalize();
    }

    if (projection === 'orthographic' && orthoRef.current) {
      const dist = Math.max(0.25, savedDistanceRef.current);
      const orthoZoom = Math.max(
        0.005,
        Math.min(2000, size.height / (2 * dist * TAN_HALF_FOV)),
      );
      orthoRef.current.position.copy(tgt).addScaledVector(dir, Math.max(dist, 25));
      orthoRef.current.zoom = orthoZoom;
      orthoRef.current.updateProjectionMatrix();
      if (orbitRef.current) {
        orbitRef.current.target.copy(tgt);
        orbitRef.current.update();
      }
      invalidate();
    } else if (projection === 'perspective' && perspRef.current) {
      const currentZoom = orthoRef.current?.zoom ?? 180;
      const rawEquiv = size.height / (2 * Math.max(0.005, currentZoom) * TAN_HALF_FOV);
      const equivDist = Math.max(
        minDistance,
        Number.isFinite(maxDistance) ? Math.min(maxDistance, rawEquiv) : rawEquiv,
      );
      savedDistanceRef.current = equivDist;
      perspRef.current.position.copy(tgt).addScaledVector(dir, equivDist);
      perspRef.current.updateProjectionMatrix();
      if (orbitRef.current) {
        orbitRef.current.target.copy(tgt);
        orbitRef.current.update();
      }
      invalidate();
    }
  }, [projection, view, size.height, minDistance, maxDistance, orbitRef, invalidate]);

  // Animate camera cleanly to preset when presetTrigger or focusTrigger increments
  const lastPresetTriggerRef = useRef(presetTrigger);
  const lastFocusTriggerRef = useRef(focusTrigger);

  useEffect(() => {
    const presetChanged = presetTrigger !== lastPresetTriggerRef.current;
    const focusChanged = focusTrigger !== lastFocusTriggerRef.current;
    if (!presetChanged && !focusChanged) return;

    lastPresetTriggerRef.current = presetTrigger;
    lastFocusTriggerRef.current = focusTrigger;

    const goalTarget = new THREE.Vector3(...target);
    const dist = focusChanged ? defaultDistance : Math.max(0.4, savedDistanceRef.current);
    const orthoDistance = Math.max(dist, 12);
    const offset = getViewOffset(
      view,
      projection === 'orthographic' ? orthoDistance : dist,
    );
    const goalPos = goalTarget.clone().add(offset);
    const goalZoom =
      projection === 'orthographic'
        ? Math.max(0.005, Math.min(2000, size.height / (2 * defaultDistance * TAN_HALF_FOV)))
        : undefined;

    if (soft) {
      camera.position.copy(goalPos);
      if (projection === 'orthographic' && 'zoom' in camera && goalZoom) {
        (camera as THREE.OrthographicCamera).zoom = goalZoom;
        camera.updateProjectionMatrix();
      }
      if (orbitRef.current) {
        orbitRef.current.target.copy(goalTarget);
        orbitRef.current.update();
      }
      syncSavedFromActiveCamera();
      invalidate();
      return;
    }

    animGoalRef.current = { pos: goalPos, target: goalTarget, zoom: goalZoom };
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetTrigger, focusTrigger]);

  useFrame((_, delta) => {
    const goal = animGoalRef.current;
    if (!goal) return;

    const lambda = 12;
    const dt = Math.min(delta, 0.05);
    camera.position.x = THREE.MathUtils.damp(camera.position.x, goal.pos.x, lambda, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, goal.pos.y, lambda, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, goal.pos.z, lambda, dt);

    if (orbitRef.current) {
      orbitRef.current.target.x = THREE.MathUtils.damp(
        orbitRef.current.target.x,
        goal.target.x,
        lambda,
        dt,
      );
      orbitRef.current.target.y = THREE.MathUtils.damp(
        orbitRef.current.target.y,
        goal.target.y,
        lambda,
        dt,
      );
      orbitRef.current.target.z = THREE.MathUtils.damp(
        orbitRef.current.target.z,
        goal.target.z,
        lambda,
        dt,
      );
    }

    if (goal.zoom !== undefined && camera instanceof THREE.OrthographicCamera) {
      camera.zoom = THREE.MathUtils.damp(camera.zoom, goal.zoom, lambda, dt);
      camera.updateProjectionMatrix();
    }

    orbitRef.current?.update();
    syncSavedFromActiveCamera();

    const posDone = camera.position.distanceTo(goal.pos) < 0.002;
    const tgtDone = !orbitRef.current || orbitRef.current.target.distanceTo(goal.target) < 0.002;
    if (posDone && tgtDone) {
      camera.position.copy(goal.pos);
      orbitRef.current?.target.copy(goal.target);
      if (goal.zoom !== undefined && camera instanceof THREE.OrthographicCamera) {
        camera.zoom = goal.zoom;
        camera.updateProjectionMatrix();
      }
      orbitRef.current?.update();
      animGoalRef.current = null;
    }
    invalidate();
  });

  const initialPos = useMemo((): [number, number, number] => {
    const v = getViewOffset(
      view,
      projection === 'orthographic' ? Math.max(defaultDistance, 12) : defaultDistance,
    );
    return [v.x + target[0], v.y + target[1], v.z + target[2]];
    // Only used on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialOrthoZoom = useMemo(() => {
    const h = size.height > 0 ? size.height : 640;
    return Math.max(20, Math.min(800, h / (2 * defaultDistance * TAN_HALF_FOV)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {projection === 'orthographic' ? (
        <OrthographicCamera
          ref={orthoRef}
          makeDefault
          position={initialPos}
          zoom={initialOrthoZoom}
          near={-10000}
          far={50000}
        />
      ) : (
        <PerspectiveCamera
          ref={perspRef}
          makeDefault
          position={initialPos}
          fov={FOV_DEG}
          near={0.05}
          far={50000}
        />
      )}

      <OrbitControls
        ref={orbitRef}
        makeDefault
        enabled={controlsEnabled}
        enableDamping={!soft}
        dampingFactor={0.08}
        minDistance={minDistance}
        maxDistance={maxDistance}
        minZoom={0.005}
        maxZoom={Infinity}
        onStart={() => {
          animGoalRef.current = null;
        }}
        onChange={() => {
          syncSavedFromActiveCamera();
          invalidate();
        }}
      />
    </>
  );
}

const VIEW_BUTTONS: { id: CameraViewPreset; label: string; title: string }[] = [
  { id: 'iso', label: 'Iso', title: 'Isometric 3D View' },
  { id: 'top', label: 'Top', title: 'Top (+Z) View' },
  { id: 'front', label: 'Front', title: 'Front (+X) View' },
  { id: 'back', label: 'Back', title: 'Back (-X) View' },
  { id: 'left', label: 'Left', title: 'Left (+Y) View' },
  { id: 'right', label: 'Right', title: 'Right (-Y) View' },
  { id: 'bottom', label: 'Bot', title: 'Bottom (-Z) View' },
];

export function CameraPresetBar({
  projection,
  view,
  onProjectionChange,
  onViewChange,
}: {
  projection: CameraProjection;
  view: CameraViewPreset;
  onProjectionChange: (proj: CameraProjection) => void;
  onViewChange: (view: CameraViewPreset) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div
        role="group"
        aria-label="Camera projection"
        className="flex items-center gap-0.5 rounded border border-[#232b3b] bg-[#0b0e14] p-0.5"
      >
        <button
          type="button"
          onClick={() => onProjectionChange('perspective')}
          aria-pressed={projection === 'perspective'}
          title="Perspective projection"
          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
            projection === 'perspective'
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:bg-[#171d29] hover:text-slate-200'
          }`}
        >
          <Box className="h-3 w-3" />
          Persp
        </button>
        <button
          type="button"
          onClick={() => onProjectionChange('orthographic')}
          aria-pressed={projection === 'orthographic'}
          title="Orthographic projection (CAD parallel)"
          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
            projection === 'orthographic'
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:bg-[#171d29] hover:text-slate-200'
          }`}
        >
          <GridIcon className="h-3 w-3" />
          Ortho
        </button>
      </div>

      <div
        role="group"
        aria-label="Camera view presets"
        className="flex items-center gap-0.5 rounded border border-[#232b3b] bg-[#0b0e14] p-0.5"
      >
        {VIEW_BUTTONS.map((btn) => {
          const active = view === btn.id;
          return (
            <button
              key={btn.id}
              type="button"
              onClick={() => onViewChange(btn.id)}
              aria-pressed={active}
              title={btn.title}
              className={`rounded px-1.5 py-1 text-[11px] font-mono whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'bg-[#1e2636] text-blue-300 font-semibold'
                  : 'text-slate-400 hover:bg-[#171d29] hover:text-slate-200'
              }`}
            >
              {btn.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
