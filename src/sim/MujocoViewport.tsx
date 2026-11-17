import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Code2,
  Crosshair,
  Gamepad2,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Square,
} from 'lucide-react';
import loadMujoco, { type MainModule, type MjData, type MjModel } from 'mujoco-js';
import * as THREE from 'three';
import { poseToRosMatrix, ROS_TO_THREE_EULER } from '@/core/coords';
import type { Project, WorldObject } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { formatLengthSummary, toDisplayValue, getUnitConversion } from '@/core/units';
import { generateMujocoXml } from '@/exporters/mjcf';
import { GeometryRenderer, PrimitiveMesh } from '@/viewport/MeshAssetRenderer';
import { CameraPresetBar, ViewportCameraRig } from '@/viewport/ViewportCameraRig';
import { isSoftwareGlRenderer, StudioEnvironment } from '@/viewport/webglCaps';

let mujocoModulePromise: Promise<MainModule> | null = null;
function getMujocoModule(): Promise<MainModule> {
  if (!mujocoModulePromise) {
    mujocoModulePromise = loadMujoco();
  }
  return mujocoModulePromise;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function matrixToPosQuat(mat: THREE.Matrix4) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mat.decompose(pos, quat, scale);
  return { position: [pos.x, pos.y, pos.z] as [number, number, number], quaternion: quat };
}

export interface ActuatorInfo {
  index: number;
  name: string;
  jointName: string;
  jointType: 'continuous' | 'revolute' | 'prismatic';
  min: number;
  max: number;
}

export interface SimTelemetry {
  simTime: number;
  contacts: number;
  rootZ: number;
  linearSpeed: number;
}

interface SimRuntime {
  mujoco: MainModule;
  model: MjModel;
  data: MjData;
  bodyIds: Record<string, number>;
  actuators: ActuatorInfo[];
  rootBodyId: number;
}

function syncBodyGroupsFromMujoco(
  runtime: SimRuntime,
  bodyGroupRefs: Record<string, THREE.Group | null>,
) {
  const { data, bodyIds } = runtime;
  const xpos = data.xpos;
  const xquat = data.xquat;
  for (const [name, bId] of Object.entries(bodyIds)) {
    const grp = bodyGroupRefs[name];
    if (!grp) continue;
    const pOff = bId * 3;
    const qOff = bId * 4;
    grp.position.set(xpos[pOff] ?? 0, xpos[pOff + 1] ?? 0, xpos[pOff + 2] ?? 0);
    // MuJoCo quaternion order is [w, x, y, z]; Three.js Quaternion.set is (x, y, z, w)
    grp.quaternion.set(
      xquat[qOff + 1] ?? 0,
      xquat[qOff + 2] ?? 0,
      xquat[qOff + 3] ?? 0,
      xquat[qOff] ?? 1,
    );
  }
}

function readTelemetry(runtime: SimRuntime): SimTelemetry {
  const { data, rootBodyId } = runtime;
  const rootZ = rootBodyId >= 0 ? (data.xpos[rootBodyId * 3 + 2] ?? 0) : 0;
  const vx = data.qvel[0] ?? 0;
  const vy = data.qvel[1] ?? 0;
  const vz = data.qvel[2] ?? 0;
  return {
    simTime: data.time,
    contacts: data.ncon,
    rootZ,
    linearSpeed: Math.hypot(vx, vy, vz),
  };
}

function MujocoSceneContent({
  project,
  runtime,
  isPlaying,
  simSpeed,
  ctrlValuesRef,
  stepNonce,
  onTelemetry,
  bodyGroupRefs,
}: {
  project: Project;
  runtime: SimRuntime | null;
  isPlaying: boolean;
  simSpeed: number;
  ctrlValuesRef: React.MutableRefObject<number[]>;
  stepNonce: number;
  onTelemetry: (t: SimTelemetry) => void;
  bodyGroupRefs: React.MutableRefObject<Record<string, THREE.Group | null>>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const cameraProjection = useRoboForgeStore((s) => s.cameraProjection);
  const cameraView = useRoboForgeStore((s) => s.cameraView);
  const cameraPresetTrigger = useRoboForgeStore((s) => s.cameraPresetTrigger);
  const focusTrigger = useRoboForgeStore((s) => s.focusTrigger);

  const soft = useMemo(() => isSoftwareGlRenderer(), []);
  const lastTelemetryAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  // Sync initial pose when runtime loads or stepNonce triggers
  useEffect(() => {
    if (!runtime) return;
    syncBodyGroupsFromMujoco(runtime, bodyGroupRefs.current);
    onTelemetry(readTelemetry(runtime));
    invalidate();
  }, [runtime, stepNonce, bodyGroupRefs, onTelemetry, invalidate]);

  // Trigger continuous demand frames while playing (paced for software GL if needed)
  useEffect(() => {
    if (!isPlaying || !runtime) return;
    invalidate();
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPlaying, runtime, invalidate]);

  useFrame((_, delta) => {
    if (!runtime || !isPlaying) return;

    const { mujoco, model, data } = runtime;
    const ctrl = ctrlValuesRef.current;
    for (let i = 0; i < model.nu; i++) {
      data.ctrl[i] = ctrl[i] ?? 0;
    }

    const timestep = Math.max(0.0005, project.world.physics.stepSize);
    const clampedDt = Math.min(0.04, Math.max(0.008, delta)) * simSpeed;
    const substeps = Math.max(1, Math.min(30, Math.round(clampedDt / timestep)));
    for (let s = 0; s < substeps; s++) {
      mujoco.mj_step(model, data);
    }

    syncBodyGroupsFromMujoco(runtime, bodyGroupRefs.current);

    const now = performance.now();
    if (now - lastTelemetryAtRef.current > 100) {
      lastTelemetryAtRef.current = now;
      onTelemetry(readTelemetry(runtime));
    }

    if (soft) {
      if (timerRef.current === null) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          invalidate();
        }, 30);
      }
    } else {
      invalidate();
    }
  });

  return (
    <>
      <color attach="background" args={['#0b0e14']} />
      <StudioEnvironment />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[4, 6, 4]}
        intensity={1.35}
        castShadow={!soft}
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-3, 2.5, -3]} intensity={0.45} color="#b6d0ff" />

      <ViewportCameraRig
        projection={cameraProjection}
        view={cameraView}
        presetTrigger={cameraPresetTrigger}
        focusTrigger={focusTrigger}
        defaultDistance={2.8}
      />

      <Grid
        args={[
          Math.max(20, project.world.ground.size[0]),
          Math.max(20, project.world.ground.size[1]),
        ]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#1c2434"
        sectionSize={2}
        sectionThickness={1}
        sectionColor="#2d3b54"
        fadeDistance={40}
        fadeStrength={1}
        position={[0, 0.001, 0]}
      />

      <group rotation={ROS_TO_THREE_EULER}>
        {/* Ground Plane */}
        {project.world.ground.enabled && (
          <mesh position={[0, 0, -0.01]} receiveShadow={!soft}>
            <boxGeometry
              args={[project.world.ground.size[0], project.world.ground.size[1], 0.02]}
            />
            <meshStandardMaterial color="#141a25" roughness={0.92} metalness={0.05} />
          </mesh>
        )}

        {/* Robot Links driven directly by MuJoCo body xpos/xquat */}
        {project.robot.links.map((link) => (
          <group
            key={link.id}
            ref={(el) => {
              bodyGroupRefs.current[link.name] = el;
            }}
          >
            <GeometryRenderer
              geometry={link.visual.geometry}
              pose={link.visual.pose}
              material={link.visual.material}
              assets={project.assets}
            />
          </group>
        ))}

        {/* World Objects (static stay at configured pose, dynamic track MuJoCo body) */}
        {project.world.objects.map((obj: WorldObject) => {
          if (obj.source.type !== 'primitive') return null;
          const colorHex = `#${new THREE.Color(
            obj.source.material.rgba[0],
            obj.source.material.rgba[1],
            obj.source.material.rgba[2],
          ).getHexString()}`;
          if (obj.static) {
            const tf = matrixToPosQuat(poseToRosMatrix(obj.pose));
            return (
              <group key={obj.id} position={tf.position} quaternion={tf.quaternion}>
                <PrimitiveMesh
                  shape={obj.source.shape}
                  colorHex={colorHex}
                  opacity={obj.source.material.rgba[3]}
                />
              </group>
            );
          }
          return (
            <group
              key={obj.id}
              ref={(el) => {
                bodyGroupRefs.current[`world_${obj.name}`] = el;
              }}
            >
              <PrimitiveMesh
                shape={obj.source.shape}
                colorHex={colorHex}
                opacity={obj.source.material.rgba[3]}
              />
            </group>
          );
        })}
      </group>

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#e2e8f0" />
      </GizmoHelper>
    </>
  );
}

export function MujocoViewport() {
  const project = useRoboForgeStore((s) => s.project);
  const units = useRoboForgeStore((s) => s.units);
  const cameraProjection = useRoboForgeStore((s) => s.cameraProjection);
  const cameraView = useRoboForgeStore((s) => s.cameraView);
  const setCameraProjection = useRoboForgeStore((s) => s.setCameraProjection);
  const setCameraView = useRoboForgeStore((s) => s.setCameraView);
  const triggerFocus = useRoboForgeStore((s) => s.triggerFocus);

  const [runtime, setRuntime] = useState<SimRuntime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [showXml, setShowXml] = useState(false);
  const [stepNonce, setStepNonce] = useState(0);
  const [ctrlValuesUi, setCtrlValuesUi] = useState<number[]>([]);
  const [telemetry, setTelemetry] = useState<SimTelemetry>({
    simTime: 0,
    contacts: 0,
    rootZ: 0,
    linearSpeed: 0,
  });

  const ctrlValuesRef = useRef<number[]>([]);
  const bodyGroupRefs = useRef<Record<string, THREE.Group | null>>({});
  const runtimeRef = useRef<SimRuntime | null>(null);
  const soft = useMemo(() => isSoftwareGlRenderer(), []);

  const mjcfXml = useMemo(
    () => generateMujocoXml(project, { includeWorldObjects: true, embedMeshPathsPrefix: '/assets/' }),
    [project],
  );

  // Identify left/right wheel actuators for Diff-Drive Teleop
  const driveMapping = useMemo(() => {
    const diffPlugin = project.robot.plugins.find((p) => p.kind === 'diff_drive');
    const jointById = new Map(project.robot.joints.map((j) => [j.id, j]));
    if (diffPlugin && diffPlugin.kind === 'diff_drive') {
      const leftNames = new Set(
        diffPlugin.leftJointIds.map((id) => jointById.get(id)?.name).filter(Boolean) as string[],
      );
      const rightNames = new Set(
        diffPlugin.rightJointIds.map((id) => jointById.get(id)?.name).filter(Boolean) as string[],
      );
      return { leftNames, rightNames };
    }
    const leftNames = new Set<string>();
    const rightNames = new Set<string>();
    for (const j of project.robot.joints) {
      if (j.type !== 'continuous') continue;
      if (j.name.includes('left') || j.name.startsWith('fl_') || j.name.startsWith('rl_')) {
        leftNames.add(j.name);
      } else if (
        j.name.includes('right') ||
        j.name.startsWith('fr_') ||
        j.name.startsWith('rr_')
      ) {
        rightNames.add(j.name);
      }
    }
    return { leftNames, rightNames };
  }, [project.robot.plugins, project.robot.joints]);

  // Compile MJCF into WASM MjModel + MjData whenever project changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setIsPlaying(false);

    const disposeRuntime = (rt: SimRuntime | null) => {
      if (!rt) return;
      try {
        rt.data.delete();
        rt.model.delete();
      } catch {
        // ignore double-dispose
      }
    };

    getMujocoModule()
      .then((mujoco) => {
        if (!active) return;

        // Clean previous runtime before allocating new WASM objects
        disposeRuntime(runtimeRef.current);
        runtimeRef.current = null;

        try {
          const assetsStat = mujoco.FS.analyzePath('/assets', false);
          if (!assetsStat.exists) {
            mujoco.FS.mkdir('/assets');
          }
          for (const asset of project.assets) {
            if (asset.format === 'stl') {
              mujoco.FS.writeFile(
                `/assets/${asset.name}.stl`,
                base64ToUint8Array(asset.dataBase64),
              );
            }
          }
        } catch {
          // ignore FS dir creation race
        }

        mujoco.FS.writeFile('/scene.xml', mjcfXml);

        const model = mujoco.MjModel.loadFromXML('/scene.xml');
        const data = new mujoco.MjData(model);
        mujoco.mj_forward(model, data);

        const bodyIds: Record<string, number> = {};
        const bodyObjType = mujoco.mjtObj.mjOBJ_BODY.value;
        for (let b = 1; b < model.nbody; b++) {
          const bName = mujoco.mj_id2name(model, bodyObjType, b);
          if (bName) bodyIds[bName] = b;
        }

        const rootLink =
          project.robot.links.find((l) => l.id === project.robot.rootLinkId) ??
          project.robot.links[0];
        const rootBodyId = rootLink ? (bodyIds[rootLink.name] ?? 1) : 1;

        const jointByName = new Map(project.robot.joints.map((j) => [j.name, j]));
        const actuators: ActuatorInfo[] = [];
        const actObjType = mujoco.mjtObj.mjOBJ_ACTUATOR.value;
        for (let a = 0; a < model.nu; a++) {
          const actName = mujoco.mj_id2name(model, actObjType, a) || `act_${a}`;
          const jName = actName.startsWith('act_') ? actName.slice(4) : actName;
          const joint = jointByName.get(jName);
          const min = model.actuator_ctrlrange[a * 2] ?? -10;
          const max = model.actuator_ctrlrange[a * 2 + 1] ?? 10;
          actuators.push({
            index: a,
            name: actName,
            jointName: jName,
            jointType:
              joint?.type === 'revolute' || joint?.type === 'prismatic'
                ? joint.type
                : 'continuous',
            min,
            max,
          });
        }

        const initialCtrls = new Array(model.nu).fill(0);
        ctrlValuesRef.current = initialCtrls;
        setCtrlValuesUi(initialCtrls);

        const nextRuntime: SimRuntime = {
          mujoco,
          model,
          data,
          bodyIds,
          actuators,
          rootBodyId,
        };
        runtimeRef.current = nextRuntime;
        setRuntime(nextRuntime);
        setLoading(false);
        setStepNonce((n) => n + 1);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      active = false;
      disposeRuntime(runtimeRef.current);
      runtimeRef.current = null;
    };
  }, [mjcfXml, project.assets, project.robot.links, project.robot.joints, project.robot.rootLinkId]);

  const handleReset = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    setIsPlaying(false);
    rt.mujoco.mj_resetData(rt.model, rt.data);
    rt.mujoco.mj_forward(rt.model, rt.data);
    const zeros = new Array(rt.model.nu).fill(0);
    ctrlValuesRef.current = zeros;
    setCtrlValuesUi(zeros);
    setStepNonce((n) => n + 1);
  }, []);

  const handleStep = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    setIsPlaying(false);
    for (let i = 0; i < rt.model.nu; i++) {
      rt.data.ctrl[i] = ctrlValuesRef.current[i] ?? 0;
    }
    const steps = Math.max(1, Math.round(0.02 / Math.max(0.0005, project.world.physics.stepSize)));
    for (let s = 0; s < steps; s++) {
      rt.mujoco.mj_step(rt.model, rt.data);
    }
    setStepNonce((n) => n + 1);
  }, [project.world.physics.stepSize]);

  const setActuatorCtrl = useCallback((idx: number, val: number) => {
    const next = [...ctrlValuesRef.current];
    next[idx] = val;
    ctrlValuesRef.current = next;
    setCtrlValuesUi(next);
  }, []);

  const applyDriveCommand = useCallback(
    (leftVel: number, rightVel: number) => {
      const rt = runtimeRef.current;
      if (!rt) return;
      const next = [...ctrlValuesRef.current];
      for (const act of rt.actuators) {
        if (driveMapping.leftNames.has(act.jointName)) {
          next[act.index] = leftVel;
        } else if (driveMapping.rightNames.has(act.jointName)) {
          next[act.index] = rightVel;
        }
      }
      ctrlValuesRef.current = next;
      setCtrlValuesUi(next);
    },
    [driveMapping],
  );

  // Keyboard WASD / Arrow teleop while Simulate mode is active
  useEffect(() => {
    const hasWheels = driveMapping.leftNames.size > 0 || driveMapping.rightNames.size > 0;
    if (!hasWheels) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT'
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'arrowup') {
        e.preventDefault();
        setIsPlaying(true);
        applyDriveCommand(10, 10);
      } else if (key === 'arrowdown') {
        e.preventDefault();
        setIsPlaying(true);
        applyDriveCommand(-10, -10);
      } else if (key === 'arrowleft') {
        e.preventDefault();
        setIsPlaying(true);
        applyDriveCommand(-6, 6);
      } else if (key === 'arrowright') {
        e.preventDefault();
        setIsPlaying(true);
        applyDriveCommand(6, -6);
      } else if (key === ' ') {
        e.preventDefault();
        applyDriveCommand(0, 0);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        applyDriveCommand(0, 0);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [driveMapping, applyDriveCommand]);

  const hasDiffDrive = driveMapping.leftNames.size > 0 || driveMapping.rightNames.size > 0;
  const timeUnitConv = getUnitConversion('time', units);
  const speedUnitConv = getUnitConversion('lin_vel', units);

  return (
    <div data-testid="mujoco-viewport" className="flex h-full w-full bg-[#0b0e14]">
      <div className="flex flex-1 flex-col min-w-0">
        {/* Simulation Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#222938] bg-[#10141d] px-3 py-1.5 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={loading || Boolean(error)}
              onClick={() => setIsPlaying((p) => !p)}
              aria-label={isPlaying ? 'Pause MuJoCo simulation' : 'Play MuJoCo simulation'}
              className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                isPlaying
                  ? 'bg-amber-600 text-white hover:bg-amber-500'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>

            <button
              type="button"
              disabled={loading || Boolean(error)}
              onClick={handleStep}
              title="Advance 20 ms"
              className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-200 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <SkipForward className="h-3 w-3" />
              Step
            </button>

            <button
              type="button"
              disabled={loading || Boolean(error)}
              onClick={handleReset}
              title="Reset Physics State"
              className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-200 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>

            <select
              aria-label="Simulation speed multiplier"
              value={simSpeed}
              onChange={(e) => setSimSpeed(Number(e.target.value))}
              className="h-7 rounded border border-[#2a3346] bg-[#0e121a] px-1.5 font-mono text-[11px] text-slate-200"
            >
              <option value={0.25}>0.25x</option>
              <option value={0.5}>0.5x</option>
              <option value={1}>1.0x</option>
              <option value={2}>2.0x</option>
            </select>

            <button
              type="button"
              onClick={() => setShowXml((s) => !s)}
              aria-pressed={showXml}
              className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] whitespace-nowrap shrink-0 cursor-pointer ${
                showXml
                  ? 'border-blue-500 bg-blue-950/40 text-blue-200'
                  : 'border-[#2a3346] bg-[#0e121a] text-slate-300 hover:bg-[#1a202e]'
              }`}
            >
              <Code2 className="h-3 w-3" />
              MJCF
            </button>

            <button
              type="button"
              onClick={triggerFocus}
              className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Crosshair className="h-3 w-3" />
              Focus
            </button>
          </div>

          <div className="flex items-center">
            <CameraPresetBar
              projection={cameraProjection}
              view={cameraView}
              onProjectionChange={setCameraProjection}
              onViewChange={setCameraView}
            />
          </div>
        </div>

        {/* 3D MuJoCo Canvas or Error/XML Overlay */}
        <div className="relative flex-1 min-h-0">
          <Canvas
            frameloop="demand"
            dpr={soft ? 1 : [1, 2]}
            shadows={!soft}
            gl={{ antialias: !soft }}
          >
            <MujocoSceneContent
              project={project}
              runtime={runtime}
              isPlaying={isPlaying}
              simSpeed={simSpeed}
              ctrlValuesRef={ctrlValuesRef}
              stepNonce={stepNonce}
              onTelemetry={setTelemetry}
              bodyGroupRefs={bodyGroupRefs}
            />
          </Canvas>

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0b0e14]/85 text-xs font-mono text-slate-300">
              Loading MuJoCo WASM Physics Engine...
            </div>
          )}

          {error && (
            <div className="absolute top-3 left-3 right-3 rounded border border-red-700/60 bg-red-950/90 p-3 text-xs text-red-200 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">MuJoCo Model Load Error</div>
                <div className="font-mono text-[11px] mt-1">{error}</div>
              </div>
            </div>
          )}

          {showXml && (
            <div className="absolute inset-y-3 right-3 w-[440px] max-w-[90%] flex flex-col rounded border border-[#2a3346] bg-[#0e121a] shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#222938] px-3 py-2 text-xs">
                <span className="font-mono font-semibold text-slate-200">
                  mujoco/{project.robot.name}.xml
                </span>
                <button
                  type="button"
                  onClick={() => setShowXml(false)}
                  className="text-slate-400 hover:text-slate-100 cursor-pointer"
                >
                  Close
                </button>
              </div>
              <pre className="flex-1 overflow-auto p-3 font-mono text-[11px] text-slate-300 leading-relaxed">
                {mjcfXml}
              </pre>
            </div>
          )}

          {/* Bottom Telemetry HUD */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-110px)] flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-[#232b3b] bg-[#10141d] px-2 py-1 font-mono text-[10px] text-slate-300 tabular-nums">
            <span className={isPlaying ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
              MuJoCo {isPlaying ? 'RUN' : 'PAUSED'}
            </span>
            <span className="text-slate-600">|</span>
            <span data-testid="mujoco-sim-time">
              t={toDisplayValue(telemetry.simTime, 'time', units).toFixed(units.time === 'ms' ? 0 : 2)}
              {timeUnitConv.label}
            </span>
            <span className="text-slate-600">|</span>
            <span data-testid="mujoco-contacts">Contacts:{telemetry.contacts}</span>
            <span className="text-slate-600">|</span>
            <span>Z:{formatLengthSummary(telemetry.rootZ, units, 2)}</span>
            <span className="text-slate-600">|</span>
            <span>
              v:{toDisplayValue(telemetry.linearSpeed, 'lin_vel', units).toFixed(2)}{' '}
              {speedUnitConv.label}
            </span>
          </div>
        </div>
      </div>

      {/* Right Sub-Panel: Drive Teleop & Actuator Controls */}
      <aside className="flex w-64 flex-col border-l border-[#222938] bg-[#11151e] shrink-0">
        <div className="flex items-center justify-between border-b border-[#222938] px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Gamepad2 className="h-3.5 w-3.5 text-emerald-400" />
            MuJoCo Control
          </div>
          <span className="font-mono text-[10px] text-slate-400">
            {runtime ? `${runtime.actuators.length} actuators` : '...'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {hasDiffDrive && (
            <div className="rounded border border-[#222938] bg-[#0d1118] p-2.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">Rover Teleop</span>
                <span className="text-[10px] font-mono text-slate-400">Arrow Keys / Space</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <div />
                <button
                  type="button"
                  onPointerDown={() => {
                    setIsPlaying(true);
                    applyDriveCommand(10, 10);
                  }}
                  onPointerUp={() => applyDriveCommand(0, 0)}
                  onPointerLeave={() => applyDriveCommand(0, 0)}
                  className="flex h-8 items-center justify-center rounded border border-[#2a3346] bg-[#141a26] text-slate-200 hover:bg-blue-600 cursor-pointer"
                  aria-label="Drive forward"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <div />

                <button
                  type="button"
                  onPointerDown={() => {
                    setIsPlaying(true);
                    applyDriveCommand(-6, 6);
                  }}
                  onPointerUp={() => applyDriveCommand(0, 0)}
                  onPointerLeave={() => applyDriveCommand(0, 0)}
                  className="flex h-8 items-center justify-center rounded border border-[#2a3346] bg-[#141a26] text-slate-200 hover:bg-blue-600 cursor-pointer"
                  aria-label="Turn left"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => applyDriveCommand(0, 0)}
                  className="flex h-8 items-center justify-center rounded border border-[#2a3346] bg-[#141a26] text-red-300 hover:bg-red-900/40 cursor-pointer"
                  aria-label="Stop wheels"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onPointerDown={() => {
                    setIsPlaying(true);
                    applyDriveCommand(6, -6);
                  }}
                  onPointerUp={() => applyDriveCommand(0, 0)}
                  onPointerLeave={() => applyDriveCommand(0, 0)}
                  className="flex h-8 items-center justify-center rounded border border-[#2a3346] bg-[#141a26] text-slate-200 hover:bg-blue-600 cursor-pointer"
                  aria-label="Turn right"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>

                <div />
                <button
                  type="button"
                  onPointerDown={() => {
                    setIsPlaying(true);
                    applyDriveCommand(-10, -10);
                  }}
                  onPointerUp={() => applyDriveCommand(0, 0)}
                  onPointerLeave={() => applyDriveCommand(0, 0)}
                  className="flex h-8 items-center justify-center rounded border border-[#2a3346] bg-[#141a26] text-slate-200 hover:bg-blue-600 cursor-pointer"
                  aria-label="Drive backward"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <div />
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-300">Actuator Targets</div>
            {!runtime || runtime.actuators.length === 0 ? (
              <p className="text-xs text-slate-500">
                No movable joints in this robot. Add revolute, continuous, or prismatic joints to
                actuate them in MuJoCo.
              </p>
            ) : (
              runtime.actuators.map((act) => {
                const val = ctrlValuesUi[act.index] ?? 0;
                const unitMode =
                  act.jointType === 'prismatic'
                    ? 'length'
                    : act.jointType === 'revolute'
                      ? 'angle'
                      : 'ang_vel';
                const conv = getUnitConversion(unitMode, units);
                const disp = toDisplayValue(val, unitMode, units);
                return (
                  <div key={act.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-200 truncate">{act.jointName}</span>
                      <span className="font-mono text-[11px] text-emerald-300 tabular-nums">
                        {disp.toFixed(2)} {conv.label}
                      </span>
                    </div>
                    <input
                      type="range"
                      aria-label={`Actuator ${act.jointName}`}
                      min={act.min}
                      max={act.max}
                      step={act.jointType === 'continuous' ? 0.5 : 0.02}
                      value={val}
                      onChange={(e) => setActuatorCtrl(act.index, Number(e.target.value))}
                      className="w-full accent-emerald-500 cursor-pointer"
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
