import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  TransformControls,
} from '@react-three/drei';
import {
  Compass,
  Crosshair,
  Eye,
  Layers,
  Move,
  RotateCw,
  Scale,
} from 'lucide-react';
import * as THREE from 'three';
import {
  computeLinkWorldMatrices,
  poseToRosMatrix,
  quaternionToRosRpy,
  ROS_TO_THREE_EULER,
  rosMatrixToPose,
  rosRpyToQuaternion,
} from '@/core/coords';
import { ROBOFORGE_DRAG_MIME, type LibraryDragPayload } from '@/core/dragTypes';
import { resolveLinkInertia } from '@/core/inertia';
import type { Link, Mount, Sensor } from '@/core/schema';
import {
  useRoboForgeStore,
  type LinkEditFrame,
  type TransformMode,
  type ViewOverlay,
} from '@/core/store';
import { formatLengthSummary } from '@/core/units';
import { GeometryRenderer } from '@/viewport/MeshAssetRenderer';
import { CameraPresetBar, ViewportCameraRig } from '@/viewport/ViewportCameraRig';
import { isSoftwareGlRenderer, StudioEnvironment } from '@/viewport/webglCaps';

function matrixToPosQuat(mat: THREE.Matrix4): {
  position: [number, number, number];
  quaternion: THREE.Quaternion;
} {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mat.decompose(pos, quat, scale);
  return { position: [pos.x, pos.y, pos.z], quaternion: quat };
}

function ObjectAxesTriad({ length = 0.18 }: { length?: number }) {
  const r = 0.003;
  return (
    <group>
      {/* +X Red */}
      <mesh position={[length / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[r, r, length, 8]} />
        <meshBasicMaterial color="#ef4444" depthTest={false} />
      </mesh>
      {/* +Y Green */}
      <mesh position={[0, length / 2, 0]}>
        <cylinderGeometry args={[r, r, length, 8]} />
        <meshBasicMaterial color="#22c55e" depthTest={false} />
      </mesh>
      {/* +Z Blue */}
      <mesh position={[0, 0, length / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, length, 8]} />
        <meshBasicMaterial color="#3b82f6" depthTest={false} />
      </mesh>
    </group>
  );
}

function MountTriad({
  mount,
  selected,
  onSelect,
}: {
  mount: Mount;
  selected: boolean;
  onSelect: () => void;
}) {
  const { position, quaternion } = useMemo(
    () => matrixToPosQuat(poseToRosMatrix(mount.pose)),
    [mount.pose],
  );
  const axisLen = selected ? 0.09 : 0.055;
  const radius = selected ? 0.015 : 0.01;

  return (
    <group
      position={position}
      quaternion={quaternion}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <mesh>
        <sphereGeometry args={[radius, 12, 12]} />
        <meshBasicMaterial color={selected ? '#38bdf8' : '#e2e8f0'} />
      </mesh>
      {/* +X red */}
      <mesh position={[axisLen / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.0022, 0.0022, axisLen, 6]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      {/* +Y green */}
      <mesh position={[0, axisLen / 2, 0]}>
        <cylinderGeometry args={[0.0022, 0.0022, axisLen, 6]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>
      {/* +Z blue */}
      <mesh position={[0, 0, axisLen / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.0022, 0.0022, axisLen, 6]} />
        <meshBasicMaterial color="#3b82f6" />
      </mesh>
    </group>
  );
}

function SensorMarker({
  sensor,
  mount,
  selected,
  onSelect,
}: {
  sensor: Sensor;
  mount: Mount | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const { position, quaternion } = useMemo(
    () => matrixToPosQuat(poseToRosMatrix(mount?.pose ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] })),
    [mount?.pose],
  );

  const color = selected ? '#facc15' : '#38bdf8';

  return (
    <group
      position={position}
      quaternion={quaternion}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {(sensor.kind === 'lidar2d' || sensor.kind === 'lidar3d') && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.008, 24, 1, true]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.65} />
        </mesh>
      )}
      {(sensor.kind === 'camera' || sensor.kind === 'depth_camera') && (
        <mesh position={[0.09, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.075, 0.16, 4]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.75} />
        </mesh>
      )}
      {(sensor.kind === 'imu' || sensor.kind === 'gps') && (
        <mesh>
          <octahedronGeometry args={[0.028, 0]} />
          <meshBasicMaterial color={color} wireframe />
        </mesh>
      )}
    </group>
  );
}

function InertialOverlay({ link }: { link: Link }) {
  const res = useMemo(() => resolveLinkInertia(link), [link]);
  const com = link.inertial.auto ? res.centerOfMass : link.inertial.pose.xyz;
  const quat = useMemo(() => rosRpyToQuaternion(link.inertial.pose.rpy), [link.inertial.pose.rpy]);

  const boxDims = useMemo((): [number, number, number] => {
    const m = Math.max(0.001, link.inertial.mass);
    const { ixx, iyy, izz } = res.inertia;
    const ax2 = Math.max(0.0004, (6 / m) * (iyy + izz - ixx));
    const ay2 = Math.max(0.0004, (6 / m) * (ixx + izz - iyy));
    const az2 = Math.max(0.0004, (6 / m) * (ixx + iyy - izz));
    return [
      Math.min(2.5, Math.sqrt(ax2)),
      Math.min(2.5, Math.sqrt(ay2)),
      Math.min(2.5, Math.sqrt(az2)),
    ];
  }, [link.inertial.mass, res.inertia]);

  return (
    <group position={com} quaternion={quat}>
      <mesh>
        <sphereGeometry args={[0.025, 16, 16]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
      <mesh>
        <boxGeometry args={boxDims} />
        <meshBasicMaterial color="#f59e0b" wireframe transparent opacity={0.75} />
      </mesh>
    </group>
  );
}

function JointAxisArrow({ axis, selected }: { axis: [number, number, number]; selected: boolean }) {
  const quat = useMemo(() => {
    const dir = new THREE.Vector3(axis[0], axis[1], axis[2]);
    if (dir.lengthSq() < 1e-9) return new THREE.Quaternion();
    dir.normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }, [axis]);

  return (
    <group quaternion={quat}>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.004, 0.004, 0.16, 8]} />
        <meshBasicMaterial color={selected ? '#facc15' : '#38bdf8'} />
      </mesh>
      <mesh position={[0, 0.17, 0]}>
        <coneGeometry args={[0.012, 0.032, 10]} />
        <meshBasicMaterial color={selected ? '#facc15' : '#38bdf8'} />
      </mesh>
    </group>
  );
}

function RobotSceneContent({
  isTransformingRef,
}: {
  isTransformingRef: React.MutableRefObject<boolean>;
}) {
  const project = useRoboForgeStore((s) => s.project);
  const selection = useRoboForgeStore((s) => s.selection);
  const select = useRoboForgeStore((s) => s.select);
  const transformMode = useRoboForgeStore((s) => s.transformMode);
  const transformSpace = useRoboForgeStore((s) => s.transformSpace);
  const linkEditFrame = useRoboForgeStore((s) => s.linkEditFrame);
  const viewOverlay = useRoboForgeStore((s) => s.viewOverlay);
  const snapTranslate = useRoboForgeStore((s) => s.snapTranslate);
  const snapRotateDeg = useRoboForgeStore((s) => s.snapRotateDeg);
  const cameraProjection = useRoboForgeStore((s) => s.cameraProjection);
  const cameraView = useRoboForgeStore((s) => s.cameraView);
  const cameraPresetTrigger = useRoboForgeStore((s) => s.cameraPresetTrigger);
  const focusTrigger = useRoboForgeStore((s) => s.focusTrigger);
  const updateLink = useRoboForgeStore((s) => s.updateLink);
  const updateMountOnLink = useRoboForgeStore((s) => s.updateMountOnLink);

  const invalidate = useThree((s) => s.invalidate);
  const linkFrameRefs = useRef<Record<string, THREE.Group | null>>({});
  const linkVisualRefs = useRef<Record<string, THREE.Group | null>>({});
  const mountRefs = useRef<Record<string, THREE.Group | null>>({});
  const [isTransforming, setIsTransforming] = useState(false);
  const [transformTarget, setTransformTarget] = useState<THREE.Object3D | null>(null);

  const soft = useMemo(() => isSoftwareGlRenderer(), []);

  const linkMatrices = useMemo(
    () =>
      computeLinkWorldMatrices(project.robot.links, project.robot.joints, project.robot.rootLinkId),
    [project.robot.links, project.robot.joints, project.robot.rootLinkId],
  );

  // Determine whether the selected link moves via its parent joint mount or its own visual pose
  const selectedIncomingJoint = useMemo(() => {
    if (selection?.type !== 'link') return undefined;
    return project.robot.joints.find((j) => j.child.linkId === selection.id);
  }, [selection, project.robot.joints]);

  const effectiveEditTarget: 'link_mount' | 'link_visual' | 'mount' | null = useMemo(() => {
    if (selection?.type === 'mount') return 'mount';
    if (selection?.type === 'link') {
      if (selectedIncomingJoint && linkEditFrame === 'mount' && transformMode !== 'scale') {
        return 'link_mount';
      }
      return 'link_visual';
    }
    return null;
  }, [selection, selectedIncomingJoint, linkEditFrame, transformMode]);

  const activeTargetKey = useMemo(() => {
    if (!selection) return 'none';
    if (selection.type === 'link') return `link:${selection.id}:${effectiveEditTarget}`;
    if (selection.type === 'mount') return `mount:${selection.linkId}:${selection.mountId}`;
    return 'none';
  }, [selection, effectiveEditTarget]);

  // Resolve the Three.js Object3D AFTER commit so newly added/selected links bind on the first click
  useLayoutEffect(() => {
    let next: THREE.Object3D | null = null;
    if (selection?.type === 'link') {
      next =
        effectiveEditTarget === 'link_mount'
          ? (linkFrameRefs.current[selection.id] ?? null)
          : (linkVisualRefs.current[selection.id] ?? null);
    } else if (selection?.type === 'mount') {
      next = mountRefs.current[`${selection.linkId}:${selection.mountId}`] ?? null;
    }
    setTransformTarget(next);
    invalidate();
  }, [selection, effectiveEditTarget, project.robot.links, project.robot.joints, invalidate]);

  useEffect(() => {
    invalidate();
  }, [project, selection, viewOverlay, transformMode, transformSpace, linkEditFrame, invalidate]);

  const handleTransformCommit = useCallback(() => {
    if (!selection) return;

    if (selection.type === 'link') {
      const link = project.robot.links.find((l) => l.id === selection.id);
      if (!link) return;

      if (effectiveEditTarget === 'link_mount' && selectedIncomingJoint) {
        const frameGroup = linkFrameRefs.current[link.id];
        if (!frameGroup) return;

        frameGroup.updateMatrix();
        const tChildWorld = frameGroup.matrix.clone();
        const tParentWorld =
          linkMatrices.get(selectedIncomingJoint.parent.linkId) ?? new THREE.Matrix4().identity();
        const childMount = link.mounts.find((m) => m.id === selectedIncomingJoint.child.mountId);
        const tChildMount = childMount
          ? poseToRosMatrix(childMount.pose)
          : new THREE.Matrix4().identity();

        // T_parentMount = inv(T_parentWorld) * T_childWorld * T_childMount
        const tParentMount = tParentWorld
          .clone()
          .invert()
          .multiply(tChildWorld)
          .multiply(tChildMount);
        const nextPose = rosMatrixToPose(tParentMount);

        updateMountOnLink(
          selectedIncomingJoint.parent.linkId,
          selectedIncomingJoint.parent.mountId,
          (mount) => {
            mount.pose = nextPose;
          },
        );
        invalidate();
        return;
      }

      const group = linkVisualRefs.current[selection.id];
      if (!group) return;

      const xyz: [number, number, number] = [
        Number(group.position.x.toFixed(5)),
        Number(group.position.y.toFixed(5)),
        Number(group.position.z.toFixed(5)),
      ];
      const rpyRaw = quaternionToRosRpy(group.quaternion);
      const rpy: [number, number, number] = [
        Number(rpyRaw[0].toFixed(5)),
        Number(rpyRaw[1].toFixed(5)),
        Number(rpyRaw[2].toFixed(5)),
      ];
      const sx = group.scale.x;
      const sy = group.scale.y;
      const sz = group.scale.z;
      const didScale =
        Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4 || Math.abs(sz - 1) > 1e-4;

      updateLink(link.id, (draft) => {
        draft.visual.pose = { xyz, rpy };
        if (didScale && draft.visual.geometry.type === 'primitive') {
          const shape = draft.visual.geometry.shape;
          if (shape.kind === 'box') {
            shape.size = [
              Math.max(0.005, Number((shape.size[0] * sx).toFixed(4))),
              Math.max(0.005, Number((shape.size[1] * sy).toFixed(4))),
              Math.max(0.005, Number((shape.size[2] * sz).toFixed(4))),
            ];
          } else if (shape.kind === 'sphere') {
            const avg = (sx + sy + sz) / 3;
            shape.radius = Math.max(0.005, Number((shape.radius * avg).toFixed(4)));
          } else if (shape.kind === 'cylinder' || shape.kind === 'capsule') {
            const rScale = (sx + sy) / 2;
            shape.radius = Math.max(0.005, Number((shape.radius * rScale).toFixed(4)));
            shape.length = Math.max(0.005, Number((shape.length * sz).toFixed(4)));
          }
        } else if (didScale && draft.visual.geometry.type === 'mesh') {
          draft.visual.geometry.scale = [
            Math.max(0.01, Number((draft.visual.geometry.scale[0] * sx).toFixed(4))),
            Math.max(0.01, Number((draft.visual.geometry.scale[1] * sy).toFixed(4))),
            Math.max(0.01, Number((draft.visual.geometry.scale[2] * sz).toFixed(4))),
          ];
        }
      });
      group.scale.set(1, 1, 1);
      invalidate();
    } else if (selection.type === 'mount') {
      const group = mountRefs.current[`${selection.linkId}:${selection.mountId}`];
      if (!group) return;
      const xyz: [number, number, number] = [
        Number(group.position.x.toFixed(5)),
        Number(group.position.y.toFixed(5)),
        Number(group.position.z.toFixed(5)),
      ];
      const rpyRaw = quaternionToRosRpy(group.quaternion);
      const rpy: [number, number, number] = [
        Number(rpyRaw[0].toFixed(5)),
        Number(rpyRaw[1].toFixed(5)),
        Number(rpyRaw[2].toFixed(5)),
      ];
      updateMountOnLink(selection.linkId, selection.mountId, (mount) => {
        mount.pose = { xyz, rpy };
      });
      invalidate();
    }
  }, [
    selection,
    effectiveEditTarget,
    selectedIncomingJoint,
    linkMatrices,
    project.robot.links,
    updateLink,
    updateMountOnLink,
    invalidate,
  ]);

  return (
    <>
      <color attach="background" args={['#0b0e14']} />
      <StudioEnvironment />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[3.5, 5.5, 4.0]}
        intensity={1.35}
        castShadow={!soft}
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-3.0, 2.5, -3.5]} intensity={0.45} color="#b6d0ff" />

      <ViewportCameraRig
        projection={cameraProjection}
        view={cameraView}
        presetTrigger={cameraPresetTrigger}
        focusTrigger={focusTrigger}
        defaultDistance={1.9}
        controlsEnabled={!isTransforming}
      />

      <Grid
        args={[12, 12]}
        cellSize={0.2}
        cellThickness={0.5}
        cellColor="#1b2333"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#2b374e"
        fadeDistance={16}
        fadeStrength={1.2}
        position={[0, -0.001, 0]}
      />

      {/* World Origin ROS-to-Three conversion boundary (ROS X forward, Y left, Z up) */}
      <group rotation={ROS_TO_THREE_EULER}>
        {/* Ground ROS axes indicator at origin */}
        <axesHelper args={[0.25]} />

        {project.robot.links.map((link) => {
          const mat = linkMatrices.get(link.id) ?? new THREE.Matrix4().identity();
          const { position, quaternion } = matrixToPosQuat(mat);
          const isLinkSelected = selection?.type === 'link' && selection.id === link.id;

          const visualPoseTf = matrixToPosQuat(poseToRosMatrix(link.visual.pose));
          const collisionGeom =
            'sameAsVisual' in link.collision ? link.visual.geometry : link.collision.geometry;
          const collisionPose =
            'sameAsVisual' in link.collision ? link.visual.pose : link.collision.pose;

          const incomingJoint = project.robot.joints.find((j) => j.child.linkId === link.id);
          const isJointSelected =
            incomingJoint && selection?.type === 'joint' && selection.id === incomingJoint.id;

          const linkSensors = project.robot.sensors.filter((s) => s.linkId === link.id);

          return (
            <group
              key={link.id}
              ref={(el) => {
                linkFrameRefs.current[link.id] = el;
              }}
              position={position}
              quaternion={quaternion}
            >
              {/* Show local ROS axes aligned with the active edit target */}
              {isLinkSelected && effectiveEditTarget === 'link_mount' && (
                <ObjectAxesTriad length={0.22} />
              )}

              {/* Visual Geometry Group (attachable to TransformControls when editing visual/scale) */}
              <group
                ref={(el) => {
                  linkVisualRefs.current[link.id] = el;
                }}
                position={visualPoseTf.position}
                quaternion={visualPoseTf.quaternion}
              >
                {isLinkSelected && effectiveEditTarget === 'link_visual' && (
                  <ObjectAxesTriad length={0.22} />
                )}
                <GeometryRenderer
                  geometry={link.visual.geometry}
                  material={link.visual.material}
                  assets={project.assets}
                  overrideColor={isLinkSelected ? '#60a5fa' : undefined}
                  overrideOpacity={
                    viewOverlay === 'visual' ? undefined : viewOverlay === 'collision' ? 0.16 : 0.25
                  }
                  onClick={() => select({ type: 'link', id: link.id })}
                />
              </group>

              {/* Collision Overlay */}
              {viewOverlay === 'collision' && (
                <GeometryRenderer
                  geometry={collisionGeom}
                  pose={collisionPose}
                  material={{ name: 'collision_wire', rgba: [0.2, 0.85, 0.55, 0.85] }}
                  assets={project.assets}
                  wireframe
                  overrideColor="#34d399"
                  overrideOpacity={0.9}
                  onClick={() => select({ type: 'link', id: link.id })}
                />
              )}

              {/* Inertial Overlay */}
              {viewOverlay === 'inertial' && <InertialOverlay link={link} />}

              {/* Joint Axis indicator */}
              {incomingJoint && incomingJoint.type !== 'fixed' && (
                <JointAxisArrow axis={incomingJoint.axis} selected={Boolean(isJointSelected)} />
              )}

              {/* Named Mount Frame Triads */}
              {link.mounts.map((mount) => {
                const mountSelected =
                  selection?.type === 'mount' &&
                  selection.linkId === link.id &&
                  selection.mountId === mount.id;
                const mountKey = `${link.id}:${mount.id}`;
                const mountTf = matrixToPosQuat(poseToRosMatrix(mount.pose));
                return (
                  <group
                    key={mount.id}
                    ref={(el) => {
                      mountRefs.current[mountKey] = el;
                    }}
                    position={mountTf.position}
                    quaternion={mountTf.quaternion}
                  >
                    <MountTriad
                      mount={{ ...mount, pose: { xyz: [0, 0, 0], rpy: [0, 0, 0] } }}
                      selected={mountSelected}
                      onSelect={() => select({ type: 'mount', linkId: link.id, mountId: mount.id })}
                    />
                  </group>
                );
              })}

              {/* Sensor Markers */}
              {linkSensors.map((sensor) => (
                <SensorMarker
                  key={sensor.id}
                  sensor={sensor}
                  mount={link.mounts.find((m) => m.id === sensor.mountId)}
                  selected={selection?.type === 'sensor' && selection.id === sensor.id}
                  onSelect={() => select({ type: 'sensor', id: sensor.id })}
                />
              ))}
            </group>
          );
        })}
      </group>

      {/* TransformControls MUST live at Scene root (identity parent), NEVER inside ROS_TO_THREE_EULER */}
      {transformTarget && transformTarget.parent && (
        <TransformControls
          key={`${cameraProjection}-${activeTargetKey}`}
          object={transformTarget}
          mode={transformMode}
          space={transformSpace}
          size={0.7}
          translationSnap={snapTranslate > 0 ? snapTranslate : null}
          rotationSnap={snapRotateDeg > 0 ? (snapRotateDeg * Math.PI) / 180 : null}
          scaleSnap={0.05}
          onObjectChange={() => invalidate()}
          onMouseDown={() => {
            isTransformingRef.current = true;
            setIsTransforming(true);
          }}
          onMouseUp={() => {
            setIsTransforming(false);
            handleTransformCommit();
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

const TRANSFORM_TOOLS: { id: TransformMode; label: string; keyHint: string; icon: typeof Move }[] =
  [
    { id: 'translate', label: 'Move', keyHint: 'W', icon: Move },
    { id: 'rotate', label: 'Rotate', keyHint: 'E', icon: RotateCw },
    { id: 'scale', label: 'Scale', keyHint: 'R', icon: Scale },
  ];

const OVERLAY_MODES: { id: ViewOverlay; label: string }[] = [
  { id: 'visual', label: 'Visual' },
  { id: 'collision', label: 'Collision' },
  { id: 'inertial', label: 'Inertial' },
];

export function RobotViewport() {
  const project = useRoboForgeStore((s) => s.project);
  const units = useRoboForgeStore((s) => s.units);
  const selection = useRoboForgeStore((s) => s.selection);
  const transformMode = useRoboForgeStore((s) => s.transformMode);
  const transformSpace = useRoboForgeStore((s) => s.transformSpace);
  const linkEditFrame = useRoboForgeStore((s) => s.linkEditFrame);
  const viewOverlay = useRoboForgeStore((s) => s.viewOverlay);
  const snapTranslate = useRoboForgeStore((s) => s.snapTranslate);
  const snapRotateDeg = useRoboForgeStore((s) => s.snapRotateDeg);
  const cameraProjection = useRoboForgeStore((s) => s.cameraProjection);
  const cameraView = useRoboForgeStore((s) => s.cameraView);

  const setTransformMode = useRoboForgeStore((s) => s.setTransformMode);
  const setTransformSpace = useRoboForgeStore((s) => s.setTransformSpace);
  const setLinkEditFrame = useRoboForgeStore((s) => s.setLinkEditFrame);
  const setViewOverlay = useRoboForgeStore((s) => s.setViewOverlay);
  const setSnapTranslate = useRoboForgeStore((s) => s.setSnapTranslate);
  const setSnapRotateDeg = useRoboForgeStore((s) => s.setSnapRotateDeg);
  const setCameraProjection = useRoboForgeStore((s) => s.setCameraProjection);
  const setCameraView = useRoboForgeStore((s) => s.setCameraView);
  const triggerFocus = useRoboForgeStore((s) => s.triggerFocus);

  const select = useRoboForgeStore((s) => s.select);
  const addLink = useRoboForgeStore((s) => s.addLink);
  const addSensor = useRoboForgeStore((s) => s.addSensor);
  const addPlugin = useRoboForgeStore((s) => s.addPlugin);
  const applyCustomPartToLink = useRoboForgeStore((s) => s.applyCustomPartToLink);
  const setPendingJointAttach = useRoboForgeStore((s) => s.setPendingJointAttach);
  const openPartEditor = useRoboForgeStore((s) => s.openPartEditor);
  const addLog = useRoboForgeStore((s) => s.addLog);

  const [isDragOver, setIsDragOver] = useState(false);
  const isTransformingRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const wasPointerDragRef = useRef(false);
  const soft = useMemo(() => isSoftwareGlRenderer(), []);

  const hasSelectedChildJoint =
    selection?.type === 'link' && project.robot.joints.some((j) => j.child.linkId === selection.id);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const raw = e.dataTransfer.getData(ROBOFORGE_DRAG_MIME);
    if (!raw) return;

    try {
      const payload = JSON.parse(raw) as LibraryDragPayload;
      const targetLink =
        (selection?.type === 'link'
          ? project.robot.links.find((l) => l.id === selection.id)
          : selection?.type === 'mount'
            ? project.robot.links.find((l) => l.id === selection.linkId)
            : undefined) ??
        project.robot.links.find((l) => l.id === project.robot.rootLinkId) ??
        project.robot.links[0];

      const targetMount =
        (selection?.type === 'mount' && targetLink
          ? targetLink.mounts.find((m) => m.id === selection.mountId)
          : undefined) ?? targetLink?.mounts[0];

      if (payload.kind === 'link_primitive') {
        const created = addLink(payload.shape, payload.defaultName);
        if (targetLink && targetMount && targetLink.id !== created.id) {
          setPendingJointAttach({
            parentLinkId: targetLink.id,
            parentMountId: targetMount.id,
            childLinkId: created.id,
          });
        }
      } else if (payload.kind === 'sensor') {
        if (targetLink && targetMount) {
          addSensor(payload.sensorKind, targetLink.id, targetMount.id);
        } else {
          addLog('warning', 'Select a link with at least one mount before dropping a sensor.');
        }
      } else if (payload.kind === 'plugin') {
        addPlugin(payload.pluginKind);
      } else if (payload.kind === 'custom_part') {
        const part = project.customParts.find((p) => p.id === payload.customPartId);
        if (part && targetLink) {
          applyCustomPartToLink(targetLink.id, part);
        } else {
          openPartEditor(payload.customPartId);
        }
      }
    } catch {
      // Ignore unrecognized drop payloads
    }
  };

  return (
    <div
      data-testid="robot-viewport"
      className={`relative flex h-full w-full flex-col bg-[#0b0e14] select-none ${
        isDragOver ? 'ring-2 ring-inset ring-blue-500' : ''
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
      {/* Solid dark CAD toolbar above WebGL canvas (no backdrop-blur over WebGL) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#222938] bg-[#10141d] px-3 py-1.5 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded border border-[#232b3b] bg-[#0b0e14] p-0.5">
            {TRANSFORM_TOOLS.map((tool) => {
              const Icon = tool.icon;
              const active = transformMode === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => setTransformMode(tool.id)}
                  title={`${tool.label} (${tool.keyHint})`}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:bg-[#171d29] hover:text-slate-100'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  <span>{tool.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setTransformSpace(transformSpace === 'local' ? 'world' : 'local')}
            title="Toggle gizmo coordinate axes between Local Part Axes and World Axes"
            className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-[11px] text-slate-200 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Compass className="h-3 w-3 text-blue-400" />
            {transformSpace === 'local' ? 'Local Axes' : 'World Axes'}
          </button>

          {hasSelectedChildJoint && transformMode !== 'scale' && (
            <div
              role="group"
              aria-label="Link transform target"
              className="flex items-center gap-0.5 rounded border border-[#232b3b] bg-[#0b0e14] p-0.5"
            >
              {(
                [
                  { id: 'mount', label: 'Joint Mount' },
                  { id: 'visual', label: 'Visual Offset' },
                ] as { id: LinkEditFrame; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLinkEditFrame(opt.id)}
                  aria-pressed={linkEditFrame === opt.id}
                  title={
                    opt.id === 'mount'
                      ? 'Move/rotate the link along with its parent joint mount'
                      : 'Offset only the visual mesh inside the link frame'
                  }
                  className={`rounded px-1.5 py-1 text-[11px] whitespace-nowrap shrink-0 cursor-pointer ${
                    linkEditFrame === opt.id
                      ? 'bg-[#1e2636] text-blue-300 font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <label htmlFor="snap-translate-select" className="whitespace-nowrap">
              Grid:
            </label>
            <select
              id="snap-translate-select"
              value={snapTranslate}
              onChange={(e) => setSnapTranslate(Number(e.target.value))}
              className="h-6 rounded border border-[#2a3346] bg-[#0e121a] px-1.5 font-mono text-[11px] text-slate-200"
            >
              <option value={0}>Free</option>
              <option value={0.01}>{formatLengthSummary(0.01, units, 3)}</option>
              <option value={0.02}>{formatLengthSummary(0.02, units, 3)}</option>
              <option value={0.05}>{formatLengthSummary(0.05, units, 3)}</option>
              <option value={0.1}>{formatLengthSummary(0.1, units, 3)}</option>
            </select>

            <label htmlFor="snap-rotate-select" className="whitespace-nowrap">
              Angle:
            </label>
            <select
              id="snap-rotate-select"
              value={snapRotateDeg}
              onChange={(e) => setSnapRotateDeg(Number(e.target.value))}
              className="h-6 rounded border border-[#2a3346] bg-[#0e121a] px-1.5 font-mono text-[11px] text-slate-200"
            >
              <option value={0}>Free</option>
              <option value={5}>5°</option>
              <option value={15}>15°</option>
              <option value={45}>45°</option>
              <option value={90}>90°</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CameraPresetBar
            projection={cameraProjection}
            view={cameraView}
            onProjectionChange={setCameraProjection}
            onViewChange={setCameraView}
          />

          <div className="flex items-center gap-0.5 rounded border border-[#232b3b] bg-[#0b0e14] p-0.5">
            <Layers className="mx-1.5 h-3 w-3 text-slate-500" />
            {OVERLAY_MODES.map((ov) => {
              const active = viewOverlay === ov.id;
              return (
                <button
                  key={ov.id}
                  type="button"
                  onClick={() => setViewOverlay(ov.id)}
                  aria-pressed={active}
                  className={`rounded px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[#1e2636] text-slate-100'
                      : 'text-slate-400 hover:bg-[#171d29] hover:text-slate-200'
                  }`}
                >
                  {ov.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={triggerFocus}
            title="Reset / Focus Camera (F)"
            className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Crosshair className="h-3 w-3" />
            Focus
          </button>
        </div>
      </div>

      {/* 3D WebGL Canvas */}
      <div
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
          shadows={!soft}
          gl={{ antialias: !soft }}
          onPointerMissed={() => {
            if (!isTransformingRef.current && !wasPointerDragRef.current) {
              select(null);
            }
          }}
        >
          <RobotSceneContent isTransformingRef={isTransformingRef} />
        </Canvas>

        {/* Bottom HUD status strip (solid dark bg, no backdrop-blur) */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded border border-[#232b3b] bg-[#10141d] px-2.5 py-1 text-[11px] text-slate-400">
          <span className="flex items-center gap-1 font-mono">
            <Eye className="h-3 w-3 text-blue-400" />
            ROS Frame (X fwd · Y left · Z up)
          </span>
          <span className="text-slate-600">|</span>
          <span className="font-mono text-slate-300">
            {cameraProjection === 'orthographic' ? 'Ortho' : 'Persp'} ({cameraView}) ·{' '}
            {transformSpace} · {viewOverlay}
            {project.robot.links.length === 0 ? ' · Empty robot (drop a part to start)' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
