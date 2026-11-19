import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import { AlertTriangle, CheckCircle2, Crosshair, RotateCcw, Sliders } from 'lucide-react';
import * as THREE from 'three';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { useRoboForgeStore } from '@/core/store';
import {
  formatLengthSummary,
  formatMassSummary,
  getUnitConversion,
  toDisplayValue,
} from '@/core/units';
import { generateResolvedUrdf } from '@/exporters/urdf';
import { loadAssetObject3D } from '@/viewport/geometryBuilder';
import { CameraPresetBar, ViewportCameraRig } from '@/viewport/ViewportCameraRig';
import { isSoftwareGlRenderer, StudioEnvironment } from '@/viewport/webglCaps';

interface RoundTripReport {
  expectedLinks: number;
  parsedLinks: number;
  expectedJoints: number;
  parsedJoints: number;
  expectedMass: number;
  parsedMass: number;
  parseError: string | null;
  warnings: string[];
}

function UrdfScene({
  robotObject,
  jointValues,
}: {
  robotObject: URDFRobot | null;
  jointValues: Record<string, number>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const cameraProjection = useRoboForgeStore((s) => s.cameraProjection);
  const cameraView = useRoboForgeStore((s) => s.cameraView);
  const cameraPresetTrigger = useRoboForgeStore((s) => s.cameraPresetTrigger);
  const focusTrigger = useRoboForgeStore((s) => s.focusTrigger);

  useEffect(() => {
    if (!robotObject) return;
    for (const [jName, value] of Object.entries(jointValues)) {
      robotObject.setJointValue(jName, value);
    }
    invalidate();
  }, [robotObject, jointValues, invalidate]);

  return (
    <>
      <color attach="background" args={['#0b0e14']} />
      <StudioEnvironment />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, -3, 5]} intensity={1.35} />
      <directionalLight position={[-3, 2, 2]} intensity={0.45} color="#a5c4ff" />

      <ViewportCameraRig
        projection={cameraProjection}
        view={cameraView}
        presetTrigger={cameraPresetTrigger}
        focusTrigger={focusTrigger}
        defaultDistance={1.9}
      />

      <Grid
        args={[10, 10]}
        cellSize={0.2}
        cellThickness={0.5}
        cellColor="#1c2434"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#2b374e"
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -0.001]}
      />

      {robotObject && (
        <group>
          <primitive object={robotObject} />
        </group>
      )}

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#e2e8f0" />
      </GizmoHelper>
    </>
  );
}

export function UrdfPreviewViewport() {
  const project = useRoboForgeStore((s) => s.project);
  const units = useRoboForgeStore((s) => s.units);
  const cameraProjection = useRoboForgeStore((s) => s.cameraProjection);
  const cameraView = useRoboForgeStore((s) => s.cameraView);
  const setCameraProjection = useRoboForgeStore((s) => s.setCameraProjection);
  const setCameraView = useRoboForgeStore((s) => s.setCameraView);
  const triggerFocus = useRoboForgeStore((s) => s.triggerFocus);

  const [jointValues, setJointValues] = useState<Record<string, number>>({});
  const [robotObject, setRobotObject] = useState<URDFRobot | null>(null);
  const [report, setReport] = useState<RoundTripReport>({
    expectedLinks: project.robot.links.length,
    parsedLinks: 0,
    expectedJoints: project.robot.joints.length,
    parsedJoints: 0,
    expectedMass: 0,
    parsedMass: 0,
    parseError: null,
    warnings: [],
  });

  const soft = useMemo(() => isSoftwareGlRenderer(), []);
  const urdfXml = useMemo(() => generateResolvedUrdf(project), [project]);

  useEffect(() => {
    const loader = new URDFLoader();
    loader.parseVisual = true;
    loader.parseCollision = false;
    loader.loadMeshCb = (path, _manager, onComplete) => {
      const match = project.assets.find((a) => path.endsWith(`/${a.name}.${a.format}`));
      if (!match) {
        const placeholder = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.18, 0.18),
          new THREE.MeshStandardMaterial({ color: '#64748b', wireframe: true }),
        );
        onComplete(placeholder);
        return;
      }
      loadAssetObject3D(match)
        .then((obj) => onComplete(obj))
        .catch((err) => onComplete(null, err instanceof Error ? err : new Error(String(err))));
    };

    const expectedMass = project.robot.links.reduce((sum, l) => sum + l.inertial.mass, 0);

    try {
      const parsed = loader.parse(urdfXml);
      const parsedLinks = Object.keys(parsed.links).length;
      const parsedJoints = Object.keys(parsed.joints).length;

      let parsedMass = 0;
      const massMatches = urdfXml.matchAll(/<mass\s+value="([^"]+)"/g);
      for (const m of massMatches) {
        const v = Number(m[1]);
        if (Number.isFinite(v)) parsedMass += v;
      }

      const warnings: string[] = [];
      if (parsedLinks !== project.robot.links.length) {
        warnings.push(
          `Link count mismatch: project has ${project.robot.links.length}, URDF parsed ${parsedLinks}.`,
        );
      }
      if (parsedJoints !== project.robot.joints.length) {
        warnings.push(
          `Joint count mismatch: project has ${project.robot.joints.length}, URDF parsed ${parsedJoints}.`,
        );
      }
      if (Math.abs(parsedMass - expectedMass) > 1e-3) {
        warnings.push(
          `Mass mismatch: project=${expectedMass.toFixed(3)} kg, URDF=${parsedMass.toFixed(3)} kg.`,
        );
      }

      setRobotObject(parsed);
      setReport({
        expectedLinks: project.robot.links.length,
        parsedLinks,
        expectedJoints: project.robot.joints.length,
        parsedJoints,
        expectedMass,
        parsedMass,
        parseError: null,
        warnings,
      });
    } catch (err) {
      setRobotObject(null);
      setReport({
        expectedLinks: project.robot.links.length,
        parsedLinks: 0,
        expectedJoints: project.robot.joints.length,
        parsedJoints: 0,
        expectedMass,
        parsedMass: 0,
        parseError: err instanceof Error ? err.message : 'Failed to parse generated URDF',
        warnings: [],
      });
    }
  }, [urdfXml, project]);

  const movableJoints = useMemo(
    () => project.robot.joints.filter((j) => j.type !== 'fixed'),
    [project.robot.joints],
  );

  const isClean = !report.parseError && report.warnings.length === 0;

  return (
    <div data-testid="urdf-preview-viewport" className="flex h-full w-full bg-[#0b0e14]">
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#222938] bg-[#10141d] px-3 py-1.5 shrink-0">
          <div className="flex items-center gap-2 text-xs">
            {isClean ? (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                URDF Round-Trip Verified ({report.parsedLinks}L · {report.parsedJoints}J ·{' '}
                {formatMassSummary(report.parsedMass, units)})
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {report.parseError ?? report.warnings[0]}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
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

        <div className="relative flex-1 min-h-0">
          <Canvas
            frameloop="demand"
            dpr={soft ? 1 : [1, 2]}
            gl={{ antialias: !soft }}
          >
            <UrdfScene robotObject={robotObject} jointValues={jointValues} />
          </Canvas>
        </div>
      </div>

      {/* Right Sub-Panel: Joint State Sliders & Round-Trip Summary */}
      <aside className="flex w-72 flex-col border-l border-[#222938] bg-[#11151e] shrink-0">
        <div className="flex items-center justify-between border-b border-[#222938] px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Sliders className="h-3.5 w-3.5 text-blue-400" />
            URDF Joint Tester
          </div>
          <button
            type="button"
            onClick={() => setJointValues({})}
            className="inline-flex items-center gap-1 rounded border border-[#2a3346] bg-[#0e121a] px-2 py-0.5 text-[11px] text-slate-300 hover:bg-[#1a202e] cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            Zero
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {movableJoints.length === 0 ? (
            <p className="text-xs text-slate-500">
              No movable joints (`revolute`, `continuous`, `prismatic`) in the current robot.
            </p>
          ) : (
            movableJoints.map((joint) => {
              const min =
                joint.type === 'continuous' ? -Math.PI : (joint.limits?.lower ?? -Math.PI / 2);
              const max =
                joint.type === 'continuous' ? Math.PI : (joint.limits?.upper ?? Math.PI / 2);
              const val = jointValues[joint.name] ?? 0;
              const isPris = joint.type === 'prismatic';
              const displayLabel = isPris
                ? formatLengthSummary(val, units, 2)
                : `${toDisplayValue(val, 'angle', units).toFixed(units.angle === 'deg' ? 1 : 2)} ${getUnitConversion('angle', units).label}`;
              return (
                <div key={joint.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-200 truncate">{joint.name}</span>
                    <span className="font-mono text-[11px] text-blue-300 tabular-nums">
                      {displayLabel}
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label={`Joint slider ${joint.name}`}
                    min={min}
                    max={max}
                    step={0.01}
                    value={val}
                    onChange={(e) =>
                      setJointValues((prev) => ({
                        ...prev,
                        [joint.name]: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>
              );
            })
          )}

          <div className="space-y-1.5 border-t border-[#222938] pt-3 text-[11px]">
            <div className="font-semibold text-slate-300">Round-Trip Diff Check</div>
            <div className="flex justify-between text-slate-400">
              <span>Links</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {report.parsedLinks} / {report.expectedLinks}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Joints</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {report.parsedJoints} / {report.expectedJoints}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Total Mass</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {formatMassSummary(report.parsedMass, units, 3)} /{' '}
                {formatMassSummary(report.expectedMass, units, 3)}
              </span>
            </div>
            {report.warnings.map((w, i) => (
              <p key={i} className="rounded bg-amber-950/40 p-1.5 text-amber-300">
                {w}
              </p>
            ))}
            {report.parseError && (
              <p className="rounded bg-red-950/40 p-1.5 text-red-300">{report.parseError}</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
