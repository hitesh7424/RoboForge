import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  TransformControls,
} from '@react-three/drei';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Camera,
  Code2,
  Compass,
  Crosshair,
  Gamepad2,
  GripHorizontal,
  LocateFixed,
  Map as MapIcon,
  Minimize2,
  Move,
  Pause,
  Play,
  Radar,
  RotateCcw,
  RotateCw,
  SkipForward,
  Square,
  Sun,
  Trees,
  X,
} from 'lucide-react';
import loadMujoco, { type MainModule, type MjData, type MjModel } from 'mujoco-js';
import * as THREE from 'three';
import {
  computeLinkWorldMatrices,
  poseToRosMatrix,
  quaternionToRosRpy,
} from '@/core/coords';
import { ROBOFORGE_DRAG_MIME, type LibraryDragPayload } from '@/core/dragTypes';
import {
  computeElevationStats,
  DEFAULT_MAP_BACKGROUND,
  sampleElevationAt,
} from '@/core/mapTiles';
import type { Project, Sensor, WorldObject } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { decodeHeightmapImageBase64, fetchTerrariumElevationGrid } from '@/core/terrain';
import { createDefaultTreeSource } from '@/core/treeGeometry';
import { formatLengthSummary, getUnitConversion, toDisplayValue } from '@/core/units';
import { generateMujocoXml } from '@/exporters/mjcf';
import {
  computeTrackingDelta,
  generateLidarRayDirections,
  rosSensorWorldMatrixToCameraPose,
} from '@/sim/simHelpers';
import { GeometryRenderer, PrimitiveMesh } from '@/viewport/MeshAssetRenderer';
import { CameraPresetBar, ViewportCameraRig } from '@/viewport/ViewportCameraRig';
import { TreeObjectVisual, WorldGroundTerrainMesh } from '@/viewport/WorldTerrainMesh';
import { isSoftwareGlRenderer, StudioEnvironment } from '@/viewport/webglCaps';

const PIP_WIDTH = 240;
const PIP_HEIGHT = 180;

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

function ObjectAxesTriad({ length = 0.4 }: { length?: number }) {
  const r = 0.005;
  return (
    <group>
      <mesh position={[length / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[r, r, length, 8]} />
        <meshBasicMaterial color="#ef4444" depthTest={false} />
      </mesh>
      <mesh position={[0, length / 2, 0]}>
        <cylinderGeometry args={[r, r, length, 8]} />
        <meshBasicMaterial color="#22c55e" depthTest={false} />
      </mesh>
      <mesh position={[0, 0, length / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, length, 8]} />
        <meshBasicMaterial color="#3b82f6" depthTest={false} />
      </mesh>
    </group>
  );
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
  disposed: boolean;
}

function syncBodyGroupsFromMujoco(
  runtime: SimRuntime,
  bodyGroupRefs: Record<string, THREE.Group | null>,
) {
  if (runtime.disposed) return;
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
  if (runtime.disposed) {
    return { simTime: 0, contacts: 0, rootZ: 0, linearSpeed: 0 };
  }
  const { model, data, rootBodyId } = runtime;
  const hasRoot = rootBodyId > 0 && rootBodyId < model.nbody;
  const rootZ = hasRoot ? (data.xpos[rootBodyId * 3 + 2] ?? 0) : 0;
  const vx = hasRoot && model.nv >= 3 ? (data.qvel[0] ?? 0) : 0;
  const vy = hasRoot && model.nv >= 3 ? (data.qvel[1] ?? 0) : 0;
  const vz = hasRoot && model.nv >= 3 ? (data.qvel[2] ?? 0) : 0;
  return {
    simTime: data.time,
    contacts: data.ncon,
    rootZ,
    linearSpeed: Math.hypot(vx, vy, vz),
  };
}

function computeSensorWorldMatrix(
  sensor: Sensor,
  project: Project,
  isEditingWorld: boolean,
  bodyGroupRefs: Record<string, THREE.Group | null>,
  editLinkRefs: Record<string, THREE.Group | null>,
  outMat: THREE.Matrix4,
): boolean {
  const link = project.robot.links.find((l) => l.id === sensor.linkId);
  if (!link) return false;
  const linkGroup = isEditingWorld
    ? editLinkRefs[link.id]
    : bodyGroupRefs[link.name];
  if (!linkGroup) return false;
  linkGroup.updateWorldMatrix(true, false);
  const mount = link.mounts.find((m) => m.id === sensor.mountId);
  const mountMat = poseToRosMatrix(mount?.pose ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] });
  outMat.multiplyMatrices(linkGroup.matrixWorld, mountMat);
  return true;
}

function LidarSensorVisual({
  sensor,
  project,
  isEditingWorld,
  bodyGroupRefs,
  editLinkRefs,
  raycastGroupRef,
  tick,
}: {
  sensor: Extract<Sensor, { kind: 'lidar2d' | 'lidar3d' }>;
  project: Project;
  isEditingWorld: boolean;
  bodyGroupRefs: React.MutableRefObject<Record<string, THREE.Group | null>>;
  editLinkRefs: React.MutableRefObject<Record<string, THREE.Group | null>>;
  raycastGroupRef: React.MutableRefObject<THREE.Group | null>;
  tick: number;
}) {
  const localDirs = useMemo(() => generateLidarRayDirections(sensor), [sensor]);
  const maxRays = localDirs.length;

  const { lineGeo, pointsGeo, raycaster, origin, worldDir, sensorMat, endPt } = useMemo(() => {
    const lPositions = new Float32Array(maxRays * 2 * 3);
    const lColors = new Float32Array(maxRays * 2 * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lPositions, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(lColors, 3));

    const pPositions = new Float32Array(maxRays * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));

    return {
      lineGeo: lg,
      pointsGeo: pg,
      raycaster: new THREE.Raycaster(),
      origin: new THREE.Vector3(),
      worldDir: new THREE.Vector3(),
      sensorMat: new THREE.Matrix4(),
      endPt: new THREE.Vector3(),
    };
  }, [maxRays]);

  useEffect(() => {
    return () => {
      lineGeo.dispose();
      pointsGeo.dispose();
    };
  }, [lineGeo, pointsGeo]);

  useEffect(() => {
    const targetGroup = raycastGroupRef.current;
    if (!targetGroup) return;
    if (
      !computeSensorWorldMatrix(
        sensor,
        project,
        isEditingWorld,
        bodyGroupRefs.current,
        editLinkRefs.current,
        sensorMat,
      )
    ) {
      lineGeo.setDrawRange(0, 0);
      pointsGeo.setDrawRange(0, 0);
      return;
    }

    targetGroup.updateWorldMatrix(true, true);
    origin.setFromMatrixPosition(sensorMat);
    const maxVisDist = Math.min(sensor.maxRange, 8);
    raycaster.near = Math.max(0.02, sensor.minRange);
    raycaster.far = maxVisDist;

    const linePosAttr = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    const lineColAttr = lineGeo.getAttribute('color') as THREE.BufferAttribute;
    const ptPosAttr = pointsGeo.getAttribute('position') as THREE.BufferAttribute;
    let hitCount = 0;

    for (let i = 0; i < maxRays; i++) {
      worldDir.copy(localDirs[i]).transformDirection(sensorMat).normalize();
      raycaster.set(origin, worldDir);
      const hits = raycaster.intersectObject(targetGroup, true);
      const hit = hits[0];

      const vIdx = i * 2;
      linePosAttr.setXYZ(vIdx, origin.x, origin.y, origin.z);

      if (hit) {
        endPt.copy(hit.point);
        linePosAttr.setXYZ(vIdx + 1, endPt.x, endPt.y, endPt.z);
        lineColAttr.setXYZ(vIdx, 0.96, 0.25, 0.37);
        lineColAttr.setXYZ(vIdx + 1, 0.98, 0.45, 0.52);
        ptPosAttr.setXYZ(hitCount, endPt.x, endPt.y, endPt.z);
        hitCount += 1;
      } else {
        endPt.copy(origin).addScaledVector(worldDir, maxVisDist);
        linePosAttr.setXYZ(vIdx + 1, endPt.x, endPt.y, endPt.z);
        lineColAttr.setXYZ(vIdx, 0.13, 0.83, 0.93);
        lineColAttr.setXYZ(vIdx + 1, 0.08, 0.45, 0.58);
      }
    }

    linePosAttr.needsUpdate = true;
    lineColAttr.needsUpdate = true;
    ptPosAttr.needsUpdate = true;
    lineGeo.setDrawRange(0, maxRays * 2);
    pointsGeo.setDrawRange(0, hitCount);
    lineGeo.computeBoundingSphere();
    pointsGeo.computeBoundingSphere();
  }, [
    sensor,
    project,
    isEditingWorld,
    bodyGroupRefs,
    editLinkRefs,
    raycastGroupRef,
    tick,
    localDirs,
    maxRays,
    lineGeo,
    pointsGeo,
    raycaster,
    origin,
    worldDir,
    sensorMat,
    endPt,
  ]);

  return (
    <group>
      <lineSegments geometry={lineGeo} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.75} />
      </lineSegments>
      <points geometry={pointsGeo} frustumCulled={false}>
        <pointsMaterial color="#fb7185" size={0.055} sizeAttenuation />
      </points>
    </group>
  );
}

function CameraFrustumVisual({
  sensor,
  project,
  isEditingWorld,
  bodyGroupRefs,
  editLinkRefs,
  tick,
}: {
  sensor: Extract<Sensor, { kind: 'camera' | 'depth_camera' }>;
  project: Project;
  isEditingWorld: boolean;
  bodyGroupRefs: React.MutableRefObject<Record<string, THREE.Group | null>>;
  editLinkRefs: React.MutableRefObject<Record<string, THREE.Group | null>>;
  tick: number;
}) {
  const grpRef = useRef<THREE.Group | null>(null);
  const sensorMat = useMemo(() => new THREE.Matrix4(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const grp = grpRef.current;
    if (!grp) return;
    if (
      !computeSensorWorldMatrix(
        sensor,
        project,
        isEditingWorld,
        bodyGroupRefs.current,
        editLinkRefs.current,
        sensorMat,
      )
    ) {
      grp.visible = false;
      return;
    }
    grp.visible = true;
    sensorMat.decompose(pos, quat, scale);
    grp.position.copy(pos);
    grp.quaternion.copy(quat);
  }, [sensor, project, isEditingWorld, bodyGroupRefs, editLinkRefs, tick, sensorMat, pos, quat, scale]);

  const depth = 0.45;
  const halfW = Math.tan(sensor.horizontalFov / 2) * depth;
  const aspect = sensor.height > 0 ? sensor.width / sensor.height : 4 / 3;
  const halfH = halfW / aspect;

  const frustumGeo = useMemo(() => {
    const pts = [
      // Rays from origin to corners (ROS +X fwd, +Y left, +Z up)
      0, 0, 0, depth, halfW, halfH,
      0, 0, 0, depth, -halfW, halfH,
      0, 0, 0, depth, -halfW, -halfH,
      0, 0, 0, depth, halfW, -halfH,
      // Far plane rectangle
      depth, halfW, halfH, depth, -halfW, halfH,
      depth, -halfW, halfH, depth, -halfW, -halfH,
      depth, -halfW, -halfH, depth, halfW, -halfH,
      depth, halfW, -halfH, depth, halfW, halfH,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }, [depth, halfW, halfH]);

  useEffect(() => () => frustumGeo.dispose(), [frustumGeo]);

  return (
    <group ref={grpRef}>
      <mesh>
        <sphereGeometry args={[0.024, 10, 10]} />
        <meshBasicMaterial color={sensor.kind === 'depth_camera' ? '#a855f7' : '#facc15'} />
      </mesh>
      <lineSegments geometry={frustumGeo}>
        <lineBasicMaterial color={sensor.kind === 'depth_camera' ? '#c084fc' : '#fde047'} />
      </lineSegments>
    </group>
  );
}

function MujocoSceneContent({
  project,
  runtimeRef,
  runtimeVersion,
  isPlaying,
  isEditingWorld,
  simSpeed,
  ctrlValuesRef,
  stepNonce,
  onTelemetry,
  bodyGroupRefs,
  isTransformingRef,
  activeCameraId,
  pipCanvasRef,
}: {
  project: Project;
  runtimeRef: React.MutableRefObject<SimRuntime | null>;
  runtimeVersion: number;
  isPlaying: boolean;
  isEditingWorld: boolean;
  simSpeed: number;
  ctrlValuesRef: React.MutableRefObject<number[]>;
  stepNonce: number;
  onTelemetry: (t: SimTelemetry) => void;
  bodyGroupRefs: React.MutableRefObject<Record<string, THREE.Group | null>>;
  isTransformingRef: React.MutableRefObject<boolean>;
  activeCameraId: string | null;
  pipCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  const selection = useRoboForgeStore((s) => s.selection);
  const select = useRoboForgeStore((s) => s.select);
  const transformMode = useRoboForgeStore((s) => s.transformMode);
  const transformSpace = useRoboForgeStore((s) => s.transformSpace);
  const snapTranslate = useRoboForgeStore((s) => s.snapTranslate);
  const snapRotateDeg = useRoboForgeStore((s) => s.snapRotateDeg);
  const cameraProjection = useRoboForgeStore((s) => s.cameraProjection);
  const cameraView = useRoboForgeStore((s) => s.cameraView);
  const cameraPresetTrigger = useRoboForgeStore((s) => s.cameraPresetTrigger);
  const focusTrigger = useRoboForgeStore((s) => s.focusTrigger);
  const simTrackTarget = useRoboForgeStore((s) => s.simTrackTarget);
  const showLidarVis = useRoboForgeStore((s) => s.showLidarVis);
  const showCameraVis = useRoboForgeStore((s) => s.showCameraVis);
  const updateWorldObject = useRoboForgeStore((s) => s.updateWorldObject);
  const updateWorld = useRoboForgeStore((s) => s.updateWorld);

  const soft = useMemo(() => isSoftwareGlRenderer(), []);
  const orbitRef = useRef<ComponentRef<typeof OrbitControls> | null>(null);
  const objectRefs = useRef<Record<string, THREE.Group | null>>({});
  const spawnRef = useRef<THREE.Group | null>(null);
  const editLinkRefs = useRef<Record<string, THREE.Group | null>>({});
  const raycastGroupRef = useRef<THREE.Group | null>(null);
  const sensorHelpersGroupRef = useRef<THREE.Group | null>(null);

  const [isTransforming, setIsTransforming] = useState(false);
  const [activeTransformTarget, setActiveTransformTarget] = useState<THREE.Object3D | null>(null);
  const [sensorTick, setSensorTick] = useState(0);

  const lastTelemetryAtRef = useRef(0);
  const lastSensorUpdateAtRef = useRef(0);
  const lastPipRenderAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const prevTrackedPosRef = useRef<THREE.Vector3 | null>(null);
  const trackedPosScratch = useMemo(() => new THREE.Vector3(), []);

  const robotMatrices = useMemo(
    () =>
      computeLinkWorldMatrices(project.robot.links, project.robot.joints, project.robot.rootLinkId),
    [project.robot.links, project.robot.joints, project.robot.rootLinkId],
  );

  const spawnTf = useMemo(
    () => matrixToPosQuat(poseToRosMatrix(project.world.robotSpawnPose)),
    [project.world.robotSpawnPose],
  );

  const lidarSensors = useMemo(
    () =>
      project.robot.sensors.filter(
        (s): s is Extract<Sensor, { kind: 'lidar2d' | 'lidar3d' }> =>
          s.kind === 'lidar2d' || s.kind === 'lidar3d',
      ),
    [project.robot.sensors],
  );

  const cameraSensors = useMemo(
    () =>
      project.robot.sensors.filter(
        (s): s is Extract<Sensor, { kind: 'camera' | 'depth_camera' }> =>
          s.kind === 'camera' || s.kind === 'depth_camera',
      ),
    [project.robot.sensors],
  );

  const selectedCameraSensor = useMemo(() => {
    if (cameraSensors.length === 0) return null;
    return cameraSensors.find((c) => c.id === activeCameraId) ?? cameraSensors[0];
  }, [cameraSensors, activeCameraId]);

  // Offscreen WebGLRenderTarget + PerspectiveCamera for live onboard camera PiP feed
  const pipResources = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(PIP_WIDTH, PIP_HEIGHT, {
      colorSpace: THREE.SRGBColorSpace,
    });
    const cam = new THREE.PerspectiveCamera(60, PIP_WIDTH / PIP_HEIGHT, 0.05, 2000);
    const pixels = new Uint8Array(PIP_WIDTH * PIP_HEIGHT * 4);
    const flipped = new Uint8ClampedArray(PIP_WIDTH * PIP_HEIGHT * 4);
    const sensorMat = new THREE.Matrix4();
    return { rt, cam, pixels, flipped, sensorMat };
  }, []);

  useEffect(() => {
    return () => {
      pipResources.rt.dispose();
    };
  }, [pipResources]);

  const renderCameraPip = useCallback(() => {
    if (!showCameraVis || !selectedCameraSensor) return;
    const canvasEl = pipCanvasRef.current;
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const ok = computeSensorWorldMatrix(
      selectedCameraSensor,
      project,
      isEditingWorld,
      bodyGroupRefs.current,
      editLinkRefs.current,
      pipResources.sensorMat,
    );
    if (!ok) return;

    const { position, quaternion } = rosSensorWorldMatrixToCameraPose(pipResources.sensorMat);
    const cam = pipResources.cam;
    cam.position.copy(position);
    cam.quaternion.copy(quaternion);
    const aspect = PIP_WIDTH / PIP_HEIGHT;
    const vFovRad =
      2 * Math.atan(Math.tan(Math.max(0.1, selectedCameraSensor.horizontalFov) / 2) / aspect);
    cam.fov = THREE.MathUtils.radToDeg(vFovRad);
    cam.near = Math.max(0.02, selectedCameraSensor.nearClip);
    cam.far = Math.max(5, selectedCameraSensor.farClip);
    cam.updateProjectionMatrix();

    const helpersGroup = sensorHelpersGroupRef.current;
    const prevHelpersVisible = helpersGroup ? helpersGroup.visible : true;
    if (helpersGroup) helpersGroup.visible = false;

    const prevTarget = gl.getRenderTarget();
    gl.setRenderTarget(pipResources.rt);
    gl.clear();
    gl.render(scene, cam);
    gl.readRenderTargetPixels(
      pipResources.rt,
      0,
      0,
      PIP_WIDTH,
      PIP_HEIGHT,
      pipResources.pixels,
    );
    gl.setRenderTarget(prevTarget);
    if (helpersGroup) helpersGroup.visible = prevHelpersVisible;

    // Flip WebGL bottom-left rows to Canvas2D top-left rows
    const rowBytes = PIP_WIDTH * 4;
    for (let y = 0; y < PIP_HEIGHT; y++) {
      const srcOffset = (PIP_HEIGHT - 1 - y) * rowBytes;
      const dstOffset = y * rowBytes;
      pipResources.flipped.set(
        pipResources.pixels.subarray(srcOffset, srcOffset + rowBytes),
        dstOffset,
      );
    }
    const imgData = new ImageData(pipResources.flipped, PIP_WIDTH, PIP_HEIGHT);
    ctx.putImageData(imgData, 0, 0);
  }, [
    showCameraVis,
    selectedCameraSensor,
    project,
    isEditingWorld,
    bodyGroupRefs,
    pipCanvasRef,
    pipResources,
    gl,
    scene,
  ]);

  const resolveTrackedObject3D = useCallback(
    (targetKey: string): THREE.Object3D | null => {
      if (targetKey === 'none') return null;
      if (targetKey === 'robot') {
        if (isEditingWorld) return spawnRef.current;
        const rootLink =
          project.robot.links.find((l) => l.id === project.robot.rootLinkId) ??
          project.robot.links[0];
        return rootLink ? (bodyGroupRefs.current[rootLink.name] ?? null) : null;
      }
      if (targetKey.startsWith('object:')) {
        const objId = targetKey.slice(7);
        return objectRefs.current[objId] ?? null;
      }
      if (targetKey.startsWith('link:')) {
        const linkId = targetKey.slice(5);
        const link = project.robot.links.find((l) => l.id === linkId);
        if (!link) return null;
        return isEditingWorld
          ? (editLinkRefs.current[link.id] ?? null)
          : (bodyGroupRefs.current[link.name] ?? null);
      }
      return null;
    },
    [isEditingWorld, project.robot.links, project.robot.rootLinkId, bodyGroupRefs],
  );

  // Resolve TransformControls target only when editing world at t === 0
  const activeTargetKey = !isEditingWorld
    ? 'none'
    : selection?.type === 'worldObject'
      ? `wobj:${selection.id}`
      : selection?.type === 'world'
        ? 'world:spawn'
        : 'none';

  useLayoutEffect(() => {
    if (!isEditingWorld) {
      setActiveTransformTarget(null);
      return;
    }
    let next: THREE.Object3D | null = null;
    if (selection?.type === 'worldObject') {
      next = objectRefs.current[selection.id] ?? null;
    } else if (selection?.type === 'world') {
      next = spawnRef.current ?? null;
    }
    setActiveTransformTarget(next);
    invalidate();
  }, [isEditingWorld, selection, project.world.objects, invalidate]);

  // Sync poses when runtime loads, stepNonce triggers, or mode transitions back from edit
  useLayoutEffect(() => {
    const rt = runtimeRef.current;
    if (!rt || rt.disposed) return;
    if (!isEditingWorld) {
      syncBodyGroupsFromMujoco(rt, bodyGroupRefs.current);
    }
    onTelemetry(readTelemetry(rt));
    setSensorTick((t) => t + 1);
    invalidate();
  }, [runtimeRef, runtimeVersion, stepNonce, isEditingWorld, bodyGroupRefs, onTelemetry, invalidate]);

  // Re-center camera onto newly selected Track target immediately
  useEffect(() => {
    prevTrackedPosRef.current = null;
    if (simTrackTarget === 'none') return;
    const obj = resolveTrackedObject3D(simTrackTarget);
    if (!obj) return;
    obj.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    obj.getWorldPosition(pos);
    prevTrackedPosRef.current = pos.clone();

    if (orbitRef.current) {
      const delta = pos.clone().sub(orbitRef.current.target);
      camera.position.add(delta);
      orbitRef.current.target.copy(pos);
      orbitRef.current.update();
      invalidate();
    }
  }, [simTrackTarget, resolveTrackedObject3D, camera, invalidate]);

  // Update sensor visualizations & PiP when paused/editing and scene state changes
  useEffect(() => {
    if (showLidarVis || showCameraVis) {
      setSensorTick((t) => t + 1);
    }
  }, [
    showLidarVis,
    showCameraVis,
    project.world,
    project.robot,
    isEditingWorld,
    stepNonce,
  ]);

  useEffect(() => {
    if (!showCameraVis) return;
    const raf = requestAnimationFrame(() => {
      renderCameraPip();
    });
    return () => cancelAnimationFrame(raf);
  }, [showCameraVis, sensorTick, activeCameraId, renderCameraPip]);

  // Trigger continuous demand frames while playing
  useEffect(() => {
    const rt = runtimeRef.current;
    if (!isPlaying || !rt || rt.disposed) return;
    invalidate();
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPlaying, runtimeRef, runtimeVersion, invalidate]);

  const handleCommitWorldTransform = useCallback(() => {
    if (selection?.type === 'worldObject') {
      const grp = objectRefs.current[selection.id];
      if (!grp) return;
      const xyz: [number, number, number] = [
        Number(grp.position.x.toFixed(4)),
        Number(grp.position.y.toFixed(4)),
        Number(grp.position.z.toFixed(4)),
      ];
      const rpyRaw = quaternionToRosRpy(grp.quaternion);
      const rpy: [number, number, number] = [
        Number(rpyRaw[0].toFixed(4)),
        Number(rpyRaw[1].toFixed(4)),
        Number(rpyRaw[2].toFixed(4)),
      ];
      updateWorldObject(selection.id, (obj) => {
        obj.pose = { xyz, rpy };
      });
      setSensorTick((t) => t + 1);
      invalidate();
    } else if (selection?.type === 'world' && spawnRef.current) {
      const grp = spawnRef.current;
      const xyz: [number, number, number] = [
        Number(grp.position.x.toFixed(4)),
        Number(grp.position.y.toFixed(4)),
        Number(grp.position.z.toFixed(4)),
      ];
      const rpyRaw = quaternionToRosRpy(grp.quaternion);
      const rpy: [number, number, number] = [
        Number(rpyRaw[0].toFixed(4)),
        Number(rpyRaw[1].toFixed(4)),
        Number(rpyRaw[2].toFixed(4)),
      ];
      updateWorld((world) => {
        world.robotSpawnPose = { xyz, rpy };
      });
      setSensorTick((t) => t + 1);
      invalidate();
    }
  }, [selection, updateWorldObject, updateWorld, invalidate]);

  useFrame((_, delta) => {
    const rt = runtimeRef.current;
    if (!rt || rt.disposed || !isPlaying) return;

    const { mujoco, model, data } = rt;
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

    syncBodyGroupsFromMujoco(rt, bodyGroupRefs.current);

    // Smoothly track selected robot or world object using incremental world-position delta
    if (simTrackTarget !== 'none' && orbitRef.current) {
      const tracked = resolveTrackedObject3D(simTrackTarget);
      if (tracked) {
        tracked.updateWorldMatrix(true, false);
        tracked.getWorldPosition(trackedPosScratch);
        const moveDelta = computeTrackingDelta(prevTrackedPosRef.current, trackedPosScratch);
        if (moveDelta.lengthSq() > 1e-10) {
          camera.position.add(moveDelta);
          orbitRef.current.target.add(moveDelta);
          orbitRef.current.update();
        }
        if (!prevTrackedPosRef.current) {
          prevTrackedPosRef.current = trackedPosScratch.clone();
        } else {
          prevTrackedPosRef.current.copy(trackedPosScratch);
        }
      }
    }

    const now = performance.now();
    if (now - lastTelemetryAtRef.current > 100) {
      lastTelemetryAtRef.current = now;
      onTelemetry(readTelemetry(rt));
    }

    if ((showLidarVis || showCameraVis) && now - lastSensorUpdateAtRef.current > (soft ? 200 : 90)) {
      lastSensorUpdateAtRef.current = now;
      setSensorTick((t) => t + 1);
    }

    if (showCameraVis && now - lastPipRenderAtRef.current > (soft ? 220 : 100)) {
      lastPipRenderAtRef.current = now;
      renderCameraPip();
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
      <ambientLight intensity={0.44} />

      {project.world.lights.length > 0 ? (
        project.world.lights.map((light) => {
          const pos = light.pose.xyz;
          const color = new THREE.Color(light.diffuse[0], light.diffuse[1], light.diffuse[2]);
          if (light.type === 'directional') {
            return (
              <directionalLight
                key={light.id}
                position={pos}
                color={color}
                intensity={light.intensity * 1.25}
                castShadow={!soft && light.castShadows}
                shadow-mapSize={[1024, 1024]}
              />
            );
          }
          return (
            <pointLight
              key={light.id}
              position={pos}
              color={color}
              intensity={light.intensity * 4}
            />
          );
        })
      ) : (
        <directionalLight
          position={[4, -4, 6]}
          intensity={1.35}
          castShadow={!soft}
          shadow-mapSize={[1024, 1024]}
        />
      )}
      <directionalLight position={[-3, 3, 2.5]} intensity={0.4} color="#b6d0ff" />

      <ViewportCameraRig
        projection={cameraProjection}
        view={cameraView}
        presetTrigger={cameraPresetTrigger}
        focusTrigger={focusTrigger}
        defaultDistance={4.8}
        minDistance={0.35}
        maxDistance={Infinity}
        controlsEnabled={!isTransforming}
        orbitRef={orbitRef}
      />

      {(() => {
        const mapLandSize = project.world.mapBackground?.enabled
          ? (project.world.mapBackground.landSizeMeters ?? DEFAULT_MAP_BACKGROUND.landSizeMeters)
          : 20;
        const gridExtent = Math.max(
          50,
          mapLandSize,
          project.world.ground.size[0],
          project.world.ground.size[1],
        );
        return (
          <Grid
            args={[gridExtent, gridExtent]}
            cellSize={1}
            cellThickness={0.5}
            cellColor="#1c2434"
            sectionSize={5}
            sectionThickness={1}
            sectionColor="#2d3b54"
            fadeDistance={Math.max(80, gridExtent * 1.1)}
            fadeStrength={1}
            rotation={[Math.PI / 2, 0, 0]}
            position={[0, 0, 0.002]}
          />
        );
      })()}

      <group>
        {/* Raycastable Environment (Unified Map-Textured DEM Terrain / Ground + World Objects) */}
        <group ref={raycastGroupRef}>
          <WorldGroundTerrainMesh
            ground={project.world.ground}
            mapBackground={project.world.mapBackground}
            textures={project.textures}
            soft={soft}
            isEditingWorld={isEditingWorld}
            onSelectWorld={() => select({ type: 'world' })}
          />

          {project.world.objects.map((obj: WorldObject) => {
            if (obj.source.type !== 'primitive' && obj.source.type !== 'tree') return null;
            const tf = matrixToPosQuat(poseToRosMatrix(obj.pose));
            const isSelected =
              isEditingWorld && selection?.type === 'worldObject' && selection.id === obj.id;

            return (
              <group
                key={obj.id}
                ref={(el) => {
                  objectRefs.current[obj.id] = el;
                  if (!obj.static) {
                    bodyGroupRefs.current[`world_${obj.name}`] = el;
                  }
                }}
                position={tf.position}
                quaternion={tf.quaternion}
                onClick={(e) => {
                  if (!isEditingWorld) return;
                  e.stopPropagation();
                  select({ type: 'worldObject', id: obj.id });
                }}
              >
                {isSelected && <ObjectAxesTriad length={0.42} />}
                {obj.source.type === 'tree' ? (
                  <TreeObjectVisual source={obj.source} selected={isSelected} />
                ) : (
                  (() => {
                    const mat = obj.source.material;
                    const colorHex = isSelected
                      ? '#60a5fa'
                      : `#${new THREE.Color(
                          mat.rgba[0],
                          mat.rgba[1],
                          mat.rgba[2],
                        ).getHexString()}`;
                    const objTex = mat.textureId
                      ? project.textures.find((t) => t.id === mat.textureId)
                      : undefined;
                    return (
                      <PrimitiveMesh
                        shape={obj.source.shape}
                        colorHex={colorHex}
                        opacity={mat.rgba[3]}
                        texture={isSelected ? undefined : objTex}
                        textureRepeat={mat.textureRepeat}
                      />
                    );
                  })()
                )}
              </group>
            );
          })}
        </group>

        {/* Robot in World Edit Pose (t=0) OR Live MuJoCo Simulation Links (t>0 / playing) */}
        {isEditingWorld ? (
          <group
            ref={spawnRef}
            position={spawnTf.position}
            quaternion={spawnTf.quaternion}
            onClick={(e) => {
              e.stopPropagation();
              select({ type: 'world' });
            }}
          >
            {selection?.type === 'world' && <ObjectAxesTriad length={0.42} />}
            {project.robot.links.map((link) => {
              const mat = robotMatrices.get(link.id) ?? new THREE.Matrix4().identity();
              const tf = matrixToPosQuat(mat);
              return (
                <group
                  key={link.id}
                  ref={(el) => {
                    editLinkRefs.current[link.id] = el;
                  }}
                  position={tf.position}
                  quaternion={tf.quaternion}
                >
                  <GeometryRenderer
                    geometry={link.visual.geometry}
                    pose={link.visual.pose}
                    material={link.visual.material}
                    assets={project.assets}
                    textures={project.textures}
                  />
                </group>
              );
            })}
            <mesh position={[0, 0, -0.05]}>
              <ringGeometry args={[0.38, 0.42, 32]} />
              <meshBasicMaterial
                color={selection?.type === 'world' ? '#38bdf8' : '#3b82f6'}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        ) : (
          project.robot.links.map((link) => (
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
                textures={project.textures}
              />
            </group>
          ))
        )}

        {/* World Light Markers (visible when editing at t=0) */}
        {isEditingWorld &&
          project.world.lights.map((light) => {
            const isSelected = selection?.type === 'worldLight' && selection.id === light.id;
            return (
              <mesh
                key={`marker-${light.id}`}
                position={light.pose.xyz}
                onClick={(e) => {
                  e.stopPropagation();
                  select({ type: 'worldLight', id: light.id });
                }}
              >
                <sphereGeometry args={[0.16, 12, 12]} />
                <meshBasicMaterial color={isSelected ? '#facc15' : '#fbbf24'} wireframe />
              </mesh>
            );
          })}
      </group>

      {/* Sensor Visualizations (hidden automatically during offscreen PiP render) */}
      <group ref={sensorHelpersGroupRef}>
        {showLidarVis &&
          lidarSensors.map((sensor) => (
            <LidarSensorVisual
              key={sensor.id}
              sensor={sensor}
              project={project}
              isEditingWorld={isEditingWorld}
              bodyGroupRefs={bodyGroupRefs}
              editLinkRefs={editLinkRefs}
              raycastGroupRef={raycastGroupRef}
              tick={sensorTick}
            />
          ))}

        {showCameraVis &&
          cameraSensors.map((sensor) => (
            <CameraFrustumVisual
              key={sensor.id}
              sensor={sensor}
              project={project}
              isEditingWorld={isEditingWorld}
              bodyGroupRefs={bodyGroupRefs}
              editLinkRefs={editLinkRefs}
              tick={sensorTick}
            />
          ))}
      </group>

      {/* TransformControls at Scene root when paused at t=0 */}
      {isEditingWorld && activeTransformTarget && activeTransformTarget.parent && (
        <TransformControls
          key={`${cameraProjection}-${activeTargetKey}`}
          object={activeTransformTarget}
          mode={transformMode === 'scale' ? 'translate' : transformMode}
          space={transformSpace}
          size={0.75}
          translationSnap={snapTranslate > 0 ? snapTranslate : null}
          rotationSnap={snapRotateDeg > 0 ? (snapRotateDeg * Math.PI) / 180 : null}
          onObjectChange={() => {
            setSensorTick((t) => t + 1);
            invalidate();
          }}
          onMouseDown={() => {
            isTransformingRef.current = true;
            setIsTransforming(true);
          }}
          onMouseUp={() => {
            setIsTransforming(false);
            handleCommitWorldTransform();
            window.setTimeout(() => {
              isTransformingRef.current = false;
            }, 60);
          }}
        />
      )}

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#e2e8f0" />
      </GizmoHelper>
    </>
  );
}

export function MujocoViewport() {
  const project = useRoboForgeStore((s) => s.project);
  const units = useRoboForgeStore((s) => s.units);
  const select = useRoboForgeStore((s) => s.select);
  const transformMode = useRoboForgeStore((s) => s.transformMode);
  const transformSpace = useRoboForgeStore((s) => s.transformSpace);
  const cameraProjection = useRoboForgeStore((s) => s.cameraProjection);
  const cameraView = useRoboForgeStore((s) => s.cameraView);
  const simTrackTarget = useRoboForgeStore((s) => s.simTrackTarget);
  const showLidarVis = useRoboForgeStore((s) => s.showLidarVis);
  const showCameraVis = useRoboForgeStore((s) => s.showCameraVis);

  const setTransformMode = useRoboForgeStore((s) => s.setTransformMode);
  const setTransformSpace = useRoboForgeStore((s) => s.setTransformSpace);
  const setCameraProjection = useRoboForgeStore((s) => s.setCameraProjection);
  const setCameraView = useRoboForgeStore((s) => s.setCameraView);
  const setSimTrackTarget = useRoboForgeStore((s) => s.setSimTrackTarget);
  const setShowLidarVis = useRoboForgeStore((s) => s.setShowLidarVis);
  const setShowCameraVis = useRoboForgeStore((s) => s.setShowCameraVis);
  const triggerFocus = useRoboForgeStore((s) => s.triggerFocus);
  const addWorldObject = useRoboForgeStore((s) => s.addWorldObject);
  const addWorldLight = useRoboForgeStore((s) => s.addWorldLight);
  const setTerrainElevation = useRoboForgeStore((s) => s.setTerrainElevation);
  const setMapAnnotatorOpen = useRoboForgeStore((s) => s.setMapAnnotatorOpen);

  const [runtimeVersion, setRuntimeVersion] = useState(0);
  const [actuatorsUi, setActuatorsUi] = useState<ActuatorInfo[]>([]);
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

  // Drag & drop obstacle state
  const [isDragOver, setIsDragOver] = useState(false);

  // Floating controller state (position + collapse + active tab + drive speed)
  const [ctrlCollapsed, setCtrlCollapsed] = useState(false);
  const [ctrlTab, setCtrlTab] = useState<'teleop' | 'joints' | 'sim'>('teleop');
  const [driveSpeed, setDriveSpeed] = useState(10);
  const [ctrlPos, setCtrlPos] = useState<{ x: number; y: number } | null>(null);

  // Camera PiP selector state
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);

  const ctrlValuesRef = useRef<number[]>([]);
  const bodyGroupRefs = useRef<Record<string, THREE.Group | null>>({});
  const runtimeRef = useRef<SimRuntime | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const ctrlCardRef = useRef<HTMLDivElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isTransformingRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const wasPointerDragRef = useRef(false);

  const soft = useMemo(() => isSoftwareGlRenderer(), []);
  const isEditingWorld = !isPlaying && telemetry.simTime < 1e-6;

  const mjcfXml = useMemo(
    () => generateMujocoXml(project, { includeWorldObjects: true, embedMeshPathsPrefix: '/assets/' }),
    [project],
  );

  const lidarSensors = useMemo(
    () => project.robot.sensors.filter((s) => s.kind === 'lidar2d' || s.kind === 'lidar3d'),
    [project.robot.sensors],
  );

  const cameraSensors = useMemo(
    () => project.robot.sensors.filter((s) => s.kind === 'camera' || s.kind === 'depth_camera'),
    [project.robot.sensors],
  );

  const rootLink = useMemo(
    () =>
      project.robot.links.find((l) => l.id === project.robot.rootLinkId) ?? project.robot.links[0],
    [project.robot.links, project.robot.rootLinkId],
  );

  // Clear invalid tracking target if object/link was deleted
  useEffect(() => {
    if (simTrackTarget === 'none') return;
    if (simTrackTarget === 'robot' && !rootLink) {
      setSimTrackTarget('none');
    } else if (
      simTrackTarget.startsWith('object:') &&
      !project.world.objects.some((o) => o.id === simTrackTarget.slice(7))
    ) {
      setSimTrackTarget('none');
    } else if (
      simTrackTarget.startsWith('link:') &&
      !project.robot.links.some((l) => l.id === simTrackTarget.slice(5))
    ) {
      setSimTrackTarget('none');
    }
  }, [simTrackTarget, rootLink, project.world.objects, project.robot.links, setSimTrackTarget]);

  // Keep activeCameraId valid
  useEffect(() => {
    if (cameraSensors.length === 0) {
      setActiveCameraId(null);
      return;
    }
    if (!activeCameraId || !cameraSensors.some((c) => c.id === activeCameraId)) {
      setActiveCameraId(cameraSensors[0].id);
    }
  }, [cameraSensors, activeCameraId]);

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

  const mapBg = project.world.mapBackground;
  const hasElevationGridRef = useRef(Boolean(mapBg?.elevationGrid));
  hasElevationGridRef.current = Boolean(mapBg?.elevationGrid);

  // Fetch Terrarium RGB DEM elevation tiles or decode imported heightmap PNG whenever terrain params change
  useEffect(() => {
    let active = true;
    const enabled = Boolean(mapBg?.enabled && mapBg?.elevationEnabled);
    if (!enabled) {
      if (hasElevationGridRef.current) {
        setTerrainElevation(undefined);
      }
      return;
    }

    const segments = Math.max(
      4,
      Math.min(96, Math.round(mapBg?.terrainSegments ?? DEFAULT_MAP_BACKGROUND.terrainSegments)),
    );
    const landSize = Math.max(
      10,
      mapBg?.landSizeMeters ?? DEFAULT_MAP_BACKGROUND.landSizeMeters,
    );
    const source = mapBg?.elevationSource ?? 'terrarium';

    if (source === 'heightmap') {
      if (mapBg?.heightmapBase64 && mapBg?.heightmapMimeType) {
        decodeHeightmapImageBase64(
          mapBg.heightmapBase64,
          mapBg.heightmapMimeType,
          segments,
          mapBg.heightmapMaxHeight ?? 25,
        ).then((res) => {
          if (!active || !res) return;
          setTerrainElevation(res.relativeGrid, res.gridSize, res.centerElevation);
        });
      }
      return () => {
        active = false;
      };
    }

    fetchTerrariumElevationGrid(
      mapBg?.latitude ?? DEFAULT_MAP_BACKGROUND.latitude,
      mapBg?.longitude ?? DEFAULT_MAP_BACKGROUND.longitude,
      landSize,
      segments,
      mapBg?.elevationUrl ?? DEFAULT_MAP_BACKGROUND.elevationUrl,
      15,
    ).then((res) => {
      if (!active || !res) return;
      setTerrainElevation(res.relativeGrid, res.gridSize, res.centerElevation);
    });

    return () => {
      active = false;
    };
  }, [
    mapBg?.enabled,
    mapBg?.elevationEnabled,
    mapBg?.elevationSource,
    mapBg?.elevationUrl,
    mapBg?.latitude,
    mapBg?.longitude,
    mapBg?.landSizeMeters,
    mapBg?.terrainSegments,
    mapBg?.heightmapBase64,
    mapBg?.heightmapMimeType,
    mapBg?.heightmapMaxHeight,
    setTerrainElevation,
  ]);

  // Compile MJCF into WASM MjModel + MjData whenever project changes
  useEffect(() => {
    let active = true;
    const mapBgSnapshot = project.world.mapBackground;
    if (!runtimeRef.current) {
      setLoading(true);
    }
    setError(null);
    setIsPlaying(false);

    const disposeRuntime = (rt: SimRuntime | null) => {
      if (!rt || rt.disposed) return;
      rt.disposed = true;
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

        const prevRt = runtimeRef.current;
        runtimeRef.current = null;
        disposeRuntime(prevRt);

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
        if (
          model.nhfield > 0 &&
          mapBgSnapshot?.elevationGrid &&
          (mapBgSnapshot.elevationGridSize ?? 0) >= 2
        ) {
          const stats = computeElevationStats(mapBgSnapshot);
          const scale = mapBgSnapshot.elevationScale ?? 1;
          const denom = Math.max(0.01, stats.rangeZ);
          const grid = mapBgSnapshot.elevationGrid;
          const count = Math.min(model.hfield_data.length, grid.length);
          for (let i = 0; i < count; i++) {
            const norm = ((grid[i] ?? 0) * scale - stats.minZ) / denom;
            model.hfield_data[i] = Math.max(0, Math.min(1, norm));
          }
        }
        const data = new mujoco.MjData(model);
        mujoco.mj_forward(model, data);

        const bodyIds: Record<string, number> = {};
        const bodyObjType = mujoco.mjtObj.mjOBJ_BODY.value;
        for (let b = 1; b < model.nbody; b++) {
          const bName = mujoco.mj_id2name(model, bodyObjType, b);
          if (bName) bodyIds[bName] = b;
        }

        const rLink =
          project.robot.links.find((l) => l.id === project.robot.rootLinkId) ??
          project.robot.links[0];
        const rootBodyId = rLink ? (bodyIds[rLink.name] ?? -1) : -1;

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
          disposed: false,
        };
        runtimeRef.current = nextRuntime;
        setActuatorsUi(actuators);
        setRuntimeVersion((v) => v + 1);
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
      const rt = runtimeRef.current;
      runtimeRef.current = null;
      disposeRuntime(rt);
    };
  }, [
    mjcfXml,
    project.assets,
    project.robot.links,
    project.robot.joints,
    project.robot.rootLinkId,
    project.world.mapBackground,
  ]);

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

  // Keyboard Arrow/Space teleop while World & Sim is active
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
      const turnSpeed = Math.max(1, Math.round(driveSpeed * 0.6));
      if (key === 'arrowup') {
        e.preventDefault();
        setIsPlaying(true);
        applyDriveCommand(driveSpeed, driveSpeed);
      } else if (key === 'arrowdown') {
        e.preventDefault();
        setIsPlaying(true);
        applyDriveCommand(-driveSpeed, -driveSpeed);
      } else if (key === 'arrowleft') {
        e.preventDefault();
        setIsPlaying(true);
        applyDriveCommand(-turnSpeed, turnSpeed);
      } else if (key === 'arrowright') {
        e.preventDefault();
        setIsPlaying(true);
        applyDriveCommand(turnSpeed, -turnSpeed);
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
  }, [driveMapping, applyDriveCommand, driveSpeed]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const raw = e.dataTransfer.getData(ROBOFORGE_DRAG_MIME);
    if (!raw) return;

    try {
      const payload = JSON.parse(raw) as LibraryDragPayload;
      if (payload.kind === 'world_object') {
        const count = project.world.objects.length;
        const offsetX = 1.5 + (count % 3) * 0.9;
        const offsetY = ((count % 4) - 1.5) * 0.8;
        addWorldObject(
          payload.name,
          payload.source,
          { xyz: [offsetX, offsetY, payload.defaultZ ?? 0.4], rpy: [0, 0, 0] },
          payload.isStatic,
          payload.mass,
        );
      } else if (payload.kind === 'link_primitive') {
        addWorldObject(
          payload.defaultName.replace('_link', '_prop'),
          {
            type: 'primitive',
            shape: payload.shape,
            material: { name: 'prop_slate', rgba: [0.5, 0.56, 0.65, 1] },
          },
          { xyz: [1.4, 0, 0.25], rpy: [0, 0, 0] },
          true,
        );
      }
    } catch {
      // ignore invalid drop data
    }
  };

  // Dragging handler for floating controller header
  const handleStartCtrlDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const container = canvasContainerRef.current;
    const card = ctrlCardRef.current;
    if (!container || !card) return;

    const cRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = cardRect.left - cRect.left;
    const origY = cardRect.top - cRect.top;

    const onMove = (ev: PointerEvent) => {
      const maxX = Math.max(8, cRect.width - cardRect.width - 8);
      const maxY = Math.max(8, cRect.height - cardRect.height - 8);
      const nextX = Math.min(maxX, Math.max(8, origX + (ev.clientX - startX)));
      const nextY = Math.min(maxY, Math.max(8, origY + (ev.clientY - startY)));
      setCtrlPos({ x: nextX, y: nextY });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const hasDiffDrive = driveMapping.leftNames.size > 0 || driveMapping.rightNames.size > 0;
  const timeUnitConv = getUnitConversion('time', units);
  const speedUnitConv = getUnitConversion('lin_vel', units);
  const activeCameraSensor = cameraSensors.find((c) => c.id === activeCameraId) ?? cameraSensors[0];

  return (
    <div
      data-testid="mujoco-viewport"
      className={`flex h-full w-full flex-col bg-[#0b0e14] select-none ${
        isDragOver ? 'ring-2 ring-inset ring-emerald-500' : ''
      }`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ROBOFORGE_DRAG_MIME)) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Unified World & Simulation Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#222938] bg-[#10141d] px-3 py-1.5 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Play / Step / Reset */}
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
            title="Reset Physics State & Re-enable World Editing"
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

          <div className="h-4 w-px bg-[#252e3f]" aria-hidden="true" />

          {/* World Transform Tools (active at t=0 when paused) */}
          <div
            className={`flex items-center gap-0.5 rounded border border-[#232b3b] bg-[#0b0e14] p-0.5 ${
              !isEditingWorld ? 'opacity-50' : ''
            }`}
            title={
              isEditingWorld
                ? 'Move or rotate world objects and robot spawn'
                : 'Reset simulation to edit world poses'
            }
          >
            <button
              type="button"
              disabled={!isEditingWorld}
              onClick={() => setTransformMode('translate')}
              aria-pressed={transformMode !== 'rotate'}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] cursor-pointer disabled:cursor-not-allowed ${
                transformMode !== 'rotate'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Move className="h-3 w-3" />
              Move
            </button>
            <button
              type="button"
              disabled={!isEditingWorld}
              onClick={() => setTransformMode('rotate')}
              aria-pressed={transformMode === 'rotate'}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] cursor-pointer disabled:cursor-not-allowed ${
                transformMode === 'rotate'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <RotateCw className="h-3 w-3" />
              Rotate
            </button>
          </div>

          <button
            type="button"
            disabled={!isEditingWorld}
            onClick={() => setTransformSpace(transformSpace === 'local' ? 'world' : 'local')}
            className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-[11px] text-slate-200 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Compass className="h-3 w-3 text-blue-400" />
            {transformSpace === 'local' ? 'Local' : 'World'}
          </button>

          <button
            type="button"
            onClick={() =>
              addWorldObject(
                'obstacle_crate',
                {
                  type: 'primitive',
                  shape: { kind: 'box', size: [0.6, 0.6, 0.6] },
                  material: { name: 'crate_amber', rgba: [0.76, 0.52, 0.22, 1] },
                },
                {
                  xyz: [1.5, 0, sampleElevationAt(project.world.mapBackground, 1.5, 0) + 0.3],
                  rpy: [0, 0, 0],
                },
                false,
                5,
              )
            }
            className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Box className="h-3 w-3 text-amber-400" />+ Crate
          </button>

          <button
            type="button"
            onClick={() =>
              addWorldObject(
                'tree_oak',
                createDefaultTreeSource('deciduous'),
                {
                  xyz: [2.0, 2.0, sampleElevationAt(project.world.mapBackground, 2.0, 2.0)],
                  rpy: [0, 0, 0],
                },
                false,
                35,
              )
            }
            className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trees className="h-3 w-3 text-emerald-400" />+ Tree
          </button>

          <button
            type="button"
            onClick={() => addWorldLight('point')}
            className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sun className="h-3 w-3 text-yellow-400" />+ Light
          </button>

          <button
            type="button"
            data-testid="open-map-builder-btn"
            onClick={() => setMapAnnotatorOpen(true)}
            title="Open 2D Map Feature Builder (draw tree canopies & building polygons with live 3D preview)"
            className="inline-flex h-7 items-center gap-1 rounded border border-emerald-600/60 bg-emerald-950/50 px-2.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-900/60 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MapIcon className="h-3 w-3 text-emerald-400" />
            2D Map Builder
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Camera Tracking Selector */}
          <label className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <LocateFixed className="h-3 w-3 text-cyan-400" />
            <span>Track:</span>
            <select
              aria-label="Track object in simulation"
              value={simTrackTarget}
              onChange={(e) => setSimTrackTarget(e.target.value)}
              className="h-7 max-w-[140px] rounded border border-[#2a3346] bg-[#0e121a] px-1.5 font-mono text-[11px] text-slate-200"
            >
              <option value="none">Free Camera</option>
              {rootLink && <option value="robot">Robot ({rootLink.name})</option>}
              {project.world.objects.map((obj) => (
                <option key={obj.id} value={`object:${obj.id}`}>
                  Obj: {obj.name}
                </option>
              ))}
              {project.robot.links.map((link) => (
                <option key={link.id} value={`link:${link.id}`}>
                  Link: {link.name}
                </option>
              ))}
            </select>
          </label>

          {/* Sensor Visualization Toggles */}
          <button
            type="button"
            onClick={() => setShowLidarVis(!showLidarVis)}
            aria-pressed={showLidarVis}
            title={`Visualize LiDAR rays (${lidarSensors.length} sensor${lidarSensors.length === 1 ? '' : 's'})`}
            className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] whitespace-nowrap shrink-0 cursor-pointer ${
              showLidarVis
                ? 'border-cyan-500 bg-cyan-950/50 text-cyan-200'
                : 'border-[#2a3346] bg-[#0e121a] text-slate-300 hover:bg-[#1a202e]'
            }`}
          >
            <Radar className="h-3 w-3" />
            LiDAR ({lidarSensors.length})
          </button>

          <button
            type="button"
            onClick={() => setShowCameraVis(!showCameraVis)}
            aria-pressed={showCameraVis}
            title={`Visualize Camera frustum & live feed (${cameraSensors.length} sensor${cameraSensors.length === 1 ? '' : 's'})`}
            className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] whitespace-nowrap shrink-0 cursor-pointer ${
              showCameraVis
                ? 'border-amber-500 bg-amber-950/50 text-amber-200'
                : 'border-[#2a3346] bg-[#0e121a] text-slate-300 hover:bg-[#1a202e]'
            }`}
          >
            <Camera className="h-3 w-3" />
            Camera ({cameraSensors.length})
          </button>

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

          <CameraPresetBar
            projection={cameraProjection}
            view={cameraView}
            onProjectionChange={setCameraProjection}
            onViewChange={setCameraView}
          />

          <button
            type="button"
            onClick={triggerFocus}
            className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Crosshair className="h-3 w-3" />
            Focus
          </button>
        </div>
      </div>

      {/* 3D Canvas + Floating Overlays */}
      <div
        ref={canvasContainerRef}
        className="relative flex-1 min-h-0"
        onPointerDown={(e) => {
          pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
          wasPointerDragRef.current = false;
        }}
        onPointerMove={(e) => {
          const start = pointerDownPosRef.current;
          if (!start) return;
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) {
            wasPointerDragRef.current = true;
          }
        }}
      >
        <Canvas
          frameloop="demand"
          dpr={soft ? 1 : [1, 2]}
          shadows={soft ? false : 'percentage'}
          gl={{ antialias: !soft }}
          onPointerMissed={() => {
            if (isEditingWorld && !isTransformingRef.current && !wasPointerDragRef.current) {
              select(null);
            }
          }}
        >
          <MujocoSceneContent
            project={project}
            runtimeRef={runtimeRef}
            runtimeVersion={runtimeVersion}
            isPlaying={isPlaying}
            isEditingWorld={isEditingWorld}
            simSpeed={simSpeed}
            ctrlValuesRef={ctrlValuesRef}
            stepNonce={stepNonce}
            onTelemetry={setTelemetry}
            bodyGroupRefs={bodyGroupRefs}
            isTransformingRef={isTransformingRef}
            activeCameraId={activeCameraId}
            pipCanvasRef={pipCanvasRef}
          />
        </Canvas>

        {loading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0b0e14]/85 text-xs font-mono text-slate-300">
            Loading MuJoCo WASM Physics Engine...
          </div>
        )}

        {error && (
          <div className="absolute top-3 left-3 right-3 z-30 rounded border border-red-700/60 bg-red-950/90 p-3 text-xs text-red-200 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">MuJoCo Model Load Error</div>
              <div className="font-mono text-[11px] mt-1">{error}</div>
            </div>
          </div>
        )}

        {/* Floating Live Camera PiP Feed Overlay (top-left) */}
        {showCameraVis && (
          <div
            data-testid="camera-pip-card"
            className="absolute top-3 left-3 z-20 w-[256px] rounded-md border border-[#2a3346] bg-[#10141d] p-2 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-1.5 pb-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <Camera className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                {cameraSensors.length > 1 ? (
                  <select
                    aria-label="Select onboard camera feed"
                    value={activeCameraSensor?.id ?? ''}
                    onChange={(e) => setActiveCameraId(e.target.value)}
                    className="h-5 max-w-[140px] rounded border border-[#2a3346] bg-[#0b0e14] px-1 font-mono text-[10px] text-slate-200"
                  >
                    {cameraSensors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-mono text-[11px] font-semibold text-slate-200 truncate">
                    {activeCameraSensor ? activeCameraSensor.name : 'No Camera'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowCameraVis(false)}
                aria-label="Close camera feed"
                className="rounded p-0.5 text-slate-400 hover:bg-[#1a202e] hover:text-slate-100 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {activeCameraSensor ? (
              <canvas
                ref={pipCanvasRef}
                width={PIP_WIDTH}
                height={PIP_HEIGHT}
                data-testid="camera-pip-canvas"
                className="block h-[180px] w-[240px] rounded border border-[#222938] bg-[#070a0f]"
              />
            ) : (
              <div className="flex h-[120px] items-center justify-center rounded border border-[#222938] bg-[#070a0f] px-3 text-center text-[11px] text-slate-400">
                Add a Camera or Depth Camera sensor to the robot to preview its live feed.
              </div>
            )}
          </div>
        )}

        {/* Floating Draggable & Collapsible MuJoCo Controller Overlay */}
        {ctrlCollapsed ? (
          <button
            ref={ctrlCardRef as unknown as React.RefObject<HTMLButtonElement>}
            type="button"
            onClick={() => setCtrlCollapsed(false)}
            aria-label="Expand MuJoCo controller"
            style={
              ctrlPos ? { left: `${ctrlPos.x}px`, top: `${ctrlPos.y}px` } : { right: '12px', top: '12px' }
            }
            className="absolute z-20 inline-flex items-center gap-1.5 rounded-md border border-[#2a3346] bg-[#10141d] px-2.5 py-1.5 text-xs font-semibold text-slate-200 shadow-xl hover:bg-[#171d2a] cursor-pointer"
          >
            <Gamepad2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>Controls</span>
            {runtimeVersion > 0 && (
              <span className="rounded bg-[#1a2232] px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                {actuatorsUi.length}
              </span>
            )}
          </button>
        ) : (
          <div
            ref={ctrlCardRef}
            data-testid="floating-mujoco-controller"
            style={
              ctrlPos ? { left: `${ctrlPos.x}px`, top: `${ctrlPos.y}px` } : { right: '12px', top: '12px' }
            }
            className="absolute z-20 flex w-72 max-h-[calc(100%-64px)] flex-col rounded-md border border-[#2a3346] bg-[#10141d] shadow-2xl"
          >
            <div
              onPointerDown={handleStartCtrlDrag}
              title="Drag controller overlay"
              className="flex items-center justify-between border-b border-[#222938] px-3 py-2 cursor-grab active:cursor-grabbing shrink-0"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <GripHorizontal className="h-3.5 w-3.5 text-slate-500" />
                <Gamepad2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>MuJoCo Control</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-slate-400">
                  {runtimeVersion > 0 ? `${actuatorsUi.length} act` : '...'}
                </span>
                <button
                  type="button"
                  onClick={() => setCtrlCollapsed(true)}
                  aria-label="Collapse MuJoCo controller"
                  title="Minimize Controller"
                  className="rounded p-0.5 text-slate-400 hover:bg-[#1a202e] hover:text-slate-100 cursor-pointer"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Control Tabs: Teleop | Joints | Sim */}
            <div className="grid grid-cols-3 border-b border-[#222938] bg-[#0b0e14] p-1 gap-1 shrink-0">
              {(['teleop', 'joints', 'sim'] as const).map((tab) => {
                const label = tab === 'teleop' ? 'Teleop' : tab === 'joints' ? 'Joints' : 'Sim';
                const active = ctrlTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    data-testid={`sim-tab-${tab}`}
                    aria-pressed={active}
                    onClick={() => setCtrlTab(tab)}
                    className={`rounded py-1 text-[11px] font-medium cursor-pointer transition-colors ${
                      active
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:bg-[#151b27] hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {ctrlTab === 'teleop' && (
                <div data-testid="sim-panel-teleop" className="space-y-3">
                  {hasDiffDrive ? (
                    <div className="rounded border border-[#222938] bg-[#0b0e14] p-2.5 space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-200">Rover Teleop</span>
                        <span className="text-[10px] font-mono text-slate-400">Arrows / Space</span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">Drive Speed</span>
                          <span className="font-mono text-emerald-300 tabular-nums">
                            {driveSpeed} rad/s
                          </span>
                        </div>
                        <input
                          type="range"
                          aria-label="Teleop drive speed"
                          min={2}
                          max={20}
                          step={1}
                          value={driveSpeed}
                          onChange={(e) => setDriveSpeed(Number(e.target.value))}
                          className="w-full accent-emerald-500 cursor-pointer"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-1.5">
                        <div />
                        <button
                          type="button"
                          onPointerDown={() => {
                            setIsPlaying(true);
                            applyDriveCommand(driveSpeed, driveSpeed);
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
                            const turn = Math.max(1, Math.round(driveSpeed * 0.6));
                            setIsPlaying(true);
                            applyDriveCommand(-turn, turn);
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
                            const turn = Math.max(1, Math.round(driveSpeed * 0.6));
                            setIsPlaying(true);
                            applyDriveCommand(turn, -turn);
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
                            applyDriveCommand(-driveSpeed, -driveSpeed);
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
                  ) : (
                    <div className="rounded border border-[#222938] bg-[#0b0e14] p-3 text-xs text-slate-400 space-y-1.5">
                      <div className="font-semibold text-slate-200">No Differential Drive Wheels</div>
                      <p className="text-[11px] leading-relaxed">
                        Add a diff-drive plugin or continuous left/right wheel joints to enable
                        D-pad &amp; keyboard teleop, or switch to the <strong className="text-slate-200">Joints</strong> tab for manual joint control.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {ctrlTab === 'joints' && (
                <div data-testid="sim-panel-joints" className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">
                      Manual Joint Control
                    </span>
                    {actuatorsUi.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const zeros = new Array(actuatorsUi.length).fill(0);
                          ctrlValuesRef.current = zeros;
                          setCtrlValuesUi(zeros);
                        }}
                        className="rounded border border-[#2a3346] bg-[#0e121a] px-2 py-0.5 text-[10px] text-slate-300 hover:bg-[#1a202e] cursor-pointer"
                      >
                        Zero All
                      </button>
                    )}
                  </div>

                  {actuatorsUi.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No movable joints in this robot. Add revolute, continuous, or prismatic joints
                      to actuate them in MuJoCo.
                    </p>
                  ) : (
                    actuatorsUi.map((act) => {
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
                        <div key={act.name} className="space-y-1 rounded border border-[#1f2636] bg-[#0b0e14] p-2">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-mono text-slate-200 truncate">{act.jointName}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-mono text-[11px] text-emerald-300 tabular-nums whitespace-nowrap">
                                {disp.toFixed(2)} {conv.label}
                              </span>
                              <button
                                type="button"
                                onClick={() => setActuatorCtrl(act.index, 0)}
                                title={`Zero ${act.jointName}`}
                                className="rounded border border-[#2a3346] px-1 text-[10px] text-slate-400 hover:text-slate-100 cursor-pointer"
                              >
                                0
                              </button>
                            </div>
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
              )}

              {ctrlTab === 'sim' && (
                <div data-testid="sim-panel-sim" className="space-y-3">
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      disabled={loading || Boolean(error)}
                      onClick={() => setIsPlaying((p) => !p)}
                      className={`inline-flex h-7 items-center justify-center gap-1 rounded text-[11px] font-medium cursor-pointer disabled:opacity-50 ${
                        isPlaying
                          ? 'bg-amber-600 text-white hover:bg-amber-500'
                          : 'bg-emerald-600 text-white hover:bg-emerald-500'
                      }`}
                    >
                      {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    <button
                      type="button"
                      disabled={loading || Boolean(error)}
                      onClick={handleStep}
                      className="inline-flex h-7 items-center justify-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] text-[11px] text-slate-200 hover:bg-[#1a202e] cursor-pointer disabled:opacity-50"
                    >
                      <SkipForward className="h-3 w-3" />
                      Step
                    </button>
                    <button
                      type="button"
                      disabled={loading || Boolean(error)}
                      onClick={handleReset}
                      className="inline-flex h-7 items-center justify-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] text-[11px] text-slate-200 hover:bg-[#1a202e] cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between gap-2 text-xs text-slate-300">
                      <span>Sim Speed</span>
                      <select
                        value={simSpeed}
                        onChange={(e) => setSimSpeed(Number(e.target.value))}
                        className="h-7 rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-[11px] text-slate-200"
                      >
                        <option value={0.25}>0.25x</option>
                        <option value={0.5}>0.5x</option>
                        <option value={1}>1.0x</option>
                        <option value={2}>2.0x</option>
                      </select>
                    </label>

                    <label className="flex items-center justify-between gap-2 text-xs text-slate-300">
                      <span>Camera Track</span>
                      <select
                        value={simTrackTarget}
                        onChange={(e) => setSimTrackTarget(e.target.value)}
                        className="h-7 max-w-[140px] rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-[11px] text-slate-200"
                      >
                        <option value="none">Free</option>
                        {rootLink && <option value="robot">Robot</option>}
                        {project.world.objects.map((obj) => (
                          <option key={obj.id} value={`object:${obj.id}`}>
                            {obj.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowLidarVis(!showLidarVis)}
                      className={`inline-flex h-7 items-center justify-center gap-1 rounded border text-[11px] cursor-pointer ${
                        showLidarVis
                          ? 'border-cyan-500 bg-cyan-950/50 text-cyan-200'
                          : 'border-[#2a3346] bg-[#0e121a] text-slate-300 hover:bg-[#1a202e]'
                      }`}
                    >
                      <Radar className="h-3 w-3" />
                      LiDAR Vis
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCameraVis(!showCameraVis)}
                      className={`inline-flex h-7 items-center justify-center gap-1 rounded border text-[11px] cursor-pointer ${
                        showCameraVis
                          ? 'border-amber-500 bg-amber-950/50 text-amber-200'
                          : 'border-[#2a3346] bg-[#0e121a] text-slate-300 hover:bg-[#1a202e]'
                      }`}
                    >
                      <Camera className="h-3 w-3" />
                      Camera PiP
                    </button>
                  </div>

                  <div className="rounded border border-[#222938] bg-[#0b0e14] p-2 font-mono text-[11px] text-slate-300 space-y-1 tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Sim Time</span>
                      <span>
                        {toDisplayValue(telemetry.simTime, 'time', units).toFixed(
                          units.time === 'ms' ? 0 : 2,
                        )}{' '}
                        {timeUnitConv.label}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Contacts</span>
                      <span>{telemetry.contacts}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Root Z</span>
                      <span>{formatLengthSummary(telemetry.rootZ, units, 3)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Linear Speed</span>
                      <span>
                        {toDisplayValue(telemetry.linearSpeed, 'lin_vel', units).toFixed(2)}{' '}
                        {speedUnitConv.label}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showXml && (
          <div className="absolute inset-y-3 right-3 z-30 w-[440px] max-w-[90%] flex flex-col rounded border border-[#2a3346] bg-[#0e121a] shadow-2xl">
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

        {/* Bottom Telemetry & World Edit Status Strip */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-110px)] flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-[#232b3b] bg-[#10141d] px-2 py-1 font-mono text-[10px] text-slate-300 tabular-nums">
          <span className={isPlaying ? 'text-emerald-400 font-semibold' : 'text-blue-300'}>
            {isPlaying ? 'SIM RUN' : isEditingWorld ? 'WORLD EDIT' : 'SIM PAUSED'}
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
          {simTrackTarget !== 'none' && (
            <>
              <span className="text-slate-600">|</span>
              <span className="text-cyan-300">Tracking</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
