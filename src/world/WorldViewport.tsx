import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, TransformControls } from '@react-three/drei';
import { Box, Compass, Crosshair, Globe, Move, RotateCw, Sun } from 'lucide-react';
import * as THREE from 'three';
import {
  computeLinkWorldMatrices,
  poseToRosMatrix,
  quaternionToRosRpy,
  ROS_TO_THREE_EULER,
  rosVec3ToThree,
} from '@/core/coords';
import { ROBOFORGE_DRAG_MIME, type LibraryDragPayload } from '@/core/dragTypes';
import type { WorldObject } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { GeometryRenderer, PrimitiveMesh } from '@/viewport/MeshAssetRenderer';
import { CameraPresetBar, ViewportCameraRig } from '@/viewport/ViewportCameraRig';
import { isSoftwareGlRenderer, StudioEnvironment } from '@/viewport/webglCaps';

function matrixToPosQuat(mat: THREE.Matrix4) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mat.decompose(pos, quat, scale);
  return { position: [pos.x, pos.y, pos.z] as [number, number, number], quaternion: quat };
}

function ObjectAxesTriad({ length = 0.3 }: { length?: number }) {
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

function WorldSceneContent() {
  const project = useRoboForgeStore((s) => s.project);
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
  const updateWorldObject = useRoboForgeStore((s) => s.updateWorldObject);
  const updateWorld = useRoboForgeStore((s) => s.updateWorld);

  const invalidate = useThree((s) => s.invalidate);
  const objectRefs = useRef<Record<string, THREE.Group | null>>({});
  const spawnRef = useRef<THREE.Group | null>(null);
  const [isTransforming, setIsTransforming] = useState(false);
  const [activeTarget, setActiveTarget] = useState<THREE.Object3D | null>(null);

  const soft = useMemo(() => isSoftwareGlRenderer(), []);

  const robotMatrices = useMemo(
    () =>
      computeLinkWorldMatrices(project.robot.links, project.robot.joints, project.robot.rootLinkId),
    [project.robot.links, project.robot.joints, project.robot.rootLinkId],
  );

  const activeTargetKey =
    selection?.type === 'worldObject'
      ? `wobj:${selection.id}`
      : selection?.type === 'world'
        ? 'world:spawn'
        : 'none';

  useLayoutEffect(() => {
    let next: THREE.Object3D | null = null;
    if (selection?.type === 'worldObject') {
      next = objectRefs.current[selection.id] ?? null;
    } else if (selection?.type === 'world') {
      next = spawnRef.current ?? null;
    }
    setActiveTarget(next);
    invalidate();
  }, [selection, project.world.objects, invalidate]);

  useEffect(() => {
    invalidate();
  }, [project.world, project.robot, selection, transformMode, transformSpace, invalidate]);

  const handleCommitTransform = useCallback(() => {
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
      invalidate();
    }
  }, [selection, updateWorldObject, updateWorld, invalidate]);

  const spawnTf = useMemo(
    () => matrixToPosQuat(poseToRosMatrix(project.world.robotSpawnPose)),
    [project.world.robotSpawnPose],
  );

  return (
    <>
      <color attach="background" args={['#0b0e14']} />
      <StudioEnvironment />
      <ambientLight intensity={0.42} />

      <ViewportCameraRig
        projection={cameraProjection}
        view={cameraView}
        presetTrigger={cameraPresetTrigger}
        focusTrigger={focusTrigger}
        defaultDistance={7.5}
        minDistance={0.5}
        maxDistance={80}
        controlsEnabled={!isTransforming}
      />

      {project.world.lights.map((light) => {
        const pos = rosVec3ToThree(light.pose.xyz);
        const color = new THREE.Color(light.diffuse[0], light.diffuse[1], light.diffuse[2]);
        if (light.type === 'directional') {
          return (
            <directionalLight
              key={light.id}
              position={pos}
              color={color}
              intensity={light.intensity * 1.2}
              castShadow={!soft && light.castShadows}
            />
          );
        }
        return (
          <pointLight key={light.id} position={pos} color={color} intensity={light.intensity * 4} />
        );
      })}

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

      {/* ROS Coordinate Space inside World */}
      <group rotation={ROS_TO_THREE_EULER}>
        {/* Ground Plane */}
        {project.world.ground.enabled && (
          <mesh
            position={[0, 0, -0.01]}
            receiveShadow={!soft}
            onClick={(e) => {
              e.stopPropagation();
              select({ type: 'world' });
            }}
          >
            <boxGeometry
              args={[project.world.ground.size[0], project.world.ground.size[1], 0.02]}
            />
            <meshStandardMaterial color="#161d29" roughness={0.9} metalness={0.05} />
          </mesh>
        )}

        {/* Robot Spawn Preview */}
        <group
          ref={spawnRef}
          position={spawnTf.position}
          quaternion={spawnTf.quaternion}
          onClick={(e) => {
            e.stopPropagation();
            select({ type: 'world' });
          }}
        >
          {selection?.type === 'world' && <ObjectAxesTriad length={0.45} />}
          {project.robot.links.map((link) => {
            const mat = robotMatrices.get(link.id) ?? new THREE.Matrix4().identity();
            const tf = matrixToPosQuat(mat);
            return (
              <group key={link.id} position={tf.position} quaternion={tf.quaternion}>
                <GeometryRenderer
                  geometry={link.visual.geometry}
                  pose={link.visual.pose}
                  material={link.visual.material}
                  assets={project.assets}
                />
              </group>
            );
          })}
          {/* Robot spawn beacon ring */}
          <mesh position={[0, 0, -0.05]}>
            <ringGeometry args={[0.38, 0.42, 32]} />
            <meshBasicMaterial
              color={selection?.type === 'world' ? '#38bdf8' : '#3b82f6'}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>

        {/* World Objects */}
        {project.world.objects.map((obj: WorldObject) => {
          const tf = matrixToPosQuat(poseToRosMatrix(obj.pose));
          const isSelected = selection?.type === 'worldObject' && selection.id === obj.id;
          return (
            <group
              key={obj.id}
              ref={(el) => {
                objectRefs.current[obj.id] = el;
              }}
              position={tf.position}
              quaternion={tf.quaternion}
              onClick={(e) => {
                e.stopPropagation();
                select({ type: 'worldObject', id: obj.id });
              }}
            >
              {isSelected && <ObjectAxesTriad length={0.45} />}
              {obj.source.type === 'primitive' ? (
                <PrimitiveMesh
                  shape={obj.source.shape}
                  colorHex={
                    isSelected
                      ? '#60a5fa'
                      : `#${new THREE.Color(
                          obj.source.material.rgba[0],
                          obj.source.material.rgba[1],
                          obj.source.material.rgba[2],
                        ).getHexString()}`
                  }
                  opacity={obj.source.material.rgba[3]}
                />
              ) : (
                <group>
                  <mesh castShadow receiveShadow>
                    <boxGeometry args={[0.8, 0.8, 0.8]} />
                    <meshStandardMaterial
                      color={isSelected ? '#38bdf8' : '#64748b'}
                      transparent
                      opacity={0.45}
                    />
                  </mesh>
                  <mesh>
                    <boxGeometry args={[0.82, 0.82, 0.82]} />
                    <meshBasicMaterial color={isSelected ? '#facc15' : '#38bdf8'} wireframe />
                  </mesh>
                </group>
              )}
            </group>
          );
        })}

        {/* World Lights */}
        {project.world.lights.map((light) => {
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

      {/* TransformControls at Scene root (outside ROS_TO_THREE_EULER) */}
      {activeTarget && activeTarget.parent && (
        <TransformControls
          key={`${cameraProjection}-${activeTargetKey}`}
          object={activeTarget}
          mode={transformMode === 'scale' ? 'translate' : transformMode}
          space={transformSpace}
          size={0.75}
          translationSnap={snapTranslate > 0 ? snapTranslate : null}
          rotationSnap={snapRotateDeg > 0 ? (snapRotateDeg * Math.PI) / 180 : null}
          onObjectChange={() => invalidate()}
          onMouseDown={() => setIsTransforming(true)}
          onMouseUp={() => {
            setIsTransforming(false);
            handleCommitTransform();
          }}
        />
      )}

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#e2e8f0" />
      </GizmoHelper>
    </>
  );
}

export function WorldViewport() {
  const project = useRoboForgeStore((s) => s.project);
  const transformMode = useRoboForgeStore((s) => s.transformMode);
  const transformSpace = useRoboForgeStore((s) => s.transformSpace);
  const cameraProjection = useRoboForgeStore((s) => s.cameraProjection);
  const cameraView = useRoboForgeStore((s) => s.cameraView);

  const setTransformMode = useRoboForgeStore((s) => s.setTransformMode);
  const setTransformSpace = useRoboForgeStore((s) => s.setTransformSpace);
  const setCameraProjection = useRoboForgeStore((s) => s.setCameraProjection);
  const setCameraView = useRoboForgeStore((s) => s.setCameraView);
  const triggerFocus = useRoboForgeStore((s) => s.triggerFocus);
  const addWorldObject = useRoboForgeStore((s) => s.addWorldObject);
  const addWorldLight = useRoboForgeStore((s) => s.addWorldLight);

  const [isDragOver, setIsDragOver] = useState(false);
  const soft = useMemo(() => isSoftwareGlRenderer(), []);

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

  return (
    <div
      data-testid="world-viewport"
      className={`relative flex h-full w-full flex-col bg-[#0b0e14] select-none ${
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#222938] bg-[#10141d] px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <Globe className="h-3.5 w-3.5 text-emerald-400" />
          <span className="font-mono font-medium">{project.world.name}</span>
          <span className="text-slate-500">·</span>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            {project.world.objects.length} objects · {project.world.lights.length} lights
          </span>

          <div className="flex items-center gap-0.5 rounded border border-[#232b3b] bg-[#0b0e14] p-0.5 ml-1">
            <button
              type="button"
              onClick={() => setTransformMode('translate')}
              aria-pressed={transformMode !== 'rotate'}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] cursor-pointer ${
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
              onClick={() => setTransformMode('rotate')}
              aria-pressed={transformMode === 'rotate'}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] cursor-pointer ${
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
            onClick={() => setTransformSpace(transformSpace === 'local' ? 'world' : 'local')}
            className="inline-flex h-6 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-[11px] text-slate-200 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Compass className="h-3 w-3 text-blue-400" />
            {transformSpace === 'local' ? 'Local' : 'World'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CameraPresetBar
            projection={cameraProjection}
            view={cameraView}
            onProjectionChange={setCameraProjection}
            onViewChange={setCameraView}
          />

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
                { xyz: [1.5, 0, 0.3], rpy: [0, 0, 0] },
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
            onClick={() => addWorldLight('point')}
            className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sun className="h-3 w-3 text-yellow-400" />+ Light
          </button>

          <button
            type="button"
            onClick={triggerFocus}
            className="inline-flex h-7 items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-[11px] text-slate-300 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Crosshair className="h-3 w-3" />
            Center
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <Canvas
          frameloop="demand"
          dpr={soft ? 1 : [1, 2]}
          shadows={!soft}
          gl={{ antialias: !soft }}
        >
          <WorldSceneContent />
        </Canvas>

        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded border border-[#232b3b] bg-[#10141d] px-2.5 py-1 font-mono text-[11px] text-slate-400">
          <span>
            {cameraProjection === 'orthographic' ? 'Ortho' : 'Persp'} ({cameraView}) · Click ground
            to adjust robot spawn pose · Drop obstacles from Library
          </span>
        </div>
      </div>
    </div>
  );
}
