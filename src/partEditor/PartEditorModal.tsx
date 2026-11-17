import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Layers,
  Plus,
  Save,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { ROS_TO_THREE_EULER } from '@/core/coords';
import { createId, createZeroPose } from '@/core/defaults';
import type { Asset, CompoundPart, CustomPart, Geometry, Mount, Primitive } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { buildChassisWithAxlesPart } from '@/core/templates';
import { Button } from '@/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog';
import { Input } from '@/ui/components/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/tabs';
import {
  checkGeometryMountCompatibility,
  type MountCompatibilityReport,
} from '@/viewport/geometryBuilder';
import { GeometryRenderer } from '@/viewport/MeshAssetRenderer';
import { isSoftwareGlRenderer, StudioEnvironment } from '@/viewport/webglCaps';

function PartPreviewCanvas({
  geometry,
  mounts,
  assets,
}: {
  geometry: Geometry;
  mounts: Mount[];
  assets: Asset[];
}) {
  const soft = useMemo(() => isSoftwareGlRenderer(), []);

  function SceneSync() {
    const invalidate = useThree((s) => s.invalidate);
    useEffect(() => {
      invalidate();
    }, [geometry, mounts, assets, invalidate]);
    return null;
  }

  return (
    <Canvas
      frameloop="demand"
      dpr={soft ? 1 : [1, 2]}
      gl={{ antialias: !soft }}
      camera={{ position: [0.85, 0.65, 0.85], fov: 45, near: 0.01, far: 50 }}
    >
      <color attach="background" args={['#0b0e14']} />
      <StudioEnvironment />
      <ambientLight intensity={0.5} />
      <directionalLight position={[2, 4, 3]} intensity={1.3} />
      <Grid
        args={[4, 4]}
        cellSize={0.1}
        sectionSize={0.5}
        cellColor="#1c2434"
        sectionColor="#2d3b54"
      />
      <SceneSync />

      <group rotation={ROS_TO_THREE_EULER}>
        <GeometryRenderer
          geometry={geometry}
          material={{ name: 'part_preview', rgba: [0.32, 0.56, 0.86, 1] }}
          assets={assets}
        />

        {mounts.map((m) => (
          <group key={m.id} position={m.pose.xyz}>
            <mesh>
              <sphereGeometry args={[0.014, 10, 10]} />
              <meshBasicMaterial color="#38bdf8" />
            </mesh>
          </group>
        ))}
      </group>

      <OrbitControls makeDefault enableDamping={!soft} />
    </Canvas>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function PartEditorModal() {
  const project = useRoboForgeStore((s) => s.project);
  const isOpen = useRoboForgeStore((s) => s.isPartEditorOpen);
  const editingCustomPartId = useRoboForgeStore((s) => s.editingCustomPartId);
  const closePartEditor = useRoboForgeStore((s) => s.closePartEditor);
  const saveCustomPart = useRoboForgeStore((s) => s.saveCustomPart);
  const applyCustomPartToLink = useRoboForgeStore((s) => s.applyCustomPartToLink);
  const addAsset = useRoboForgeStore((s) => s.addAsset);
  const assignAssetVisualToLink = useRoboForgeStore((s) => s.assignAssetVisualToLink);
  const selection = useRoboForgeStore((s) => s.selection);

  const [partId, setPartId] = useState<string>(createId());
  const [partName, setPartName] = useState('custom_chassis');
  const [parts, setParts] = useState<CompoundPart[]>([]);
  const [mounts, setMounts] = useState<Mount[]>([]);
  const [selectedPartIdx, setSelectedPartIdx] = useState(0);
  const [targetLinkId, setTargetLinkId] = useState<string>('');

  // Parametric Chassis with Axles controls
  const [chassisX, setChassisX] = useState(0.5);
  const [chassisY, setChassisY] = useState(0.3);
  const [chassisZ, setChassisZ] = useState(0.1);
  const [wheelbase, setWheelbase] = useState(0.34);
  const [trackWidth, setTrackWidth] = useState(0.42);
  const [axleCount, setAxleCount] = useState(2);
  const [axleRadius, setAxleRadius] = useState(0.018);

  // 2D Sketch Extrude state (points in meters)
  const [sketchPoints, setSketchPoints] = useState<[number, number][]>([
    [-0.22, -0.14],
    [0.18, -0.14],
    [0.25, -0.06],
    [0.25, 0.06],
    [0.18, 0.14],
    [-0.22, 0.14],
  ]);
  const [extrudeDepth, setExtrudeDepth] = useState(0.08);
  const [extrudeOp, setExtrudeOp] = useState<'add' | 'subtract'>('add');

  // Stage 3 Mesh import & compatibility state
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [meshScale, setMeshScale] = useState<[number, number, number]>([1, 1, 1]);
  const [compatReports, setCompatReports] = useState<MountCompatibilityReport[] | null>(null);
  const [compatBbox, setCompatBbox] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const defaultTargetLink =
      selection?.type === 'link'
        ? selection.id
        : project.robot.rootLinkId || project.robot.links[0]?.id || '';
    setTargetLinkId(defaultTargetLink);

    if (editingCustomPartId) {
      const existing = project.customParts.find((p) => p.id === editingCustomPartId);
      if (existing) {
        setPartId(existing.id);
        setPartName(existing.name);
        setParts(
          existing.geometry.type === 'compound' ? structuredClone(existing.geometry.parts) : [],
        );
        setMounts(structuredClone(existing.defaultMounts));
        setSelectedPartIdx(0);
        return;
      }
    }

    const generated = buildChassisWithAxlesPart({
      name: 'custom_chassis_axles',
      chassisSize: [0.5, 0.3, 0.1],
      wheelbase: 0.34,
      trackWidth: 0.42,
      axleCount: 2,
      axleRadius: 0.018,
    });
    setPartId(createId());
    setPartName(generated.name);
    setParts(generated.geometry.type === 'compound' ? generated.geometry.parts : []);
    setMounts(generated.defaultMounts);
    setSelectedPartIdx(0);
  }, [
    isOpen,
    editingCustomPartId,
    project.customParts,
    project.robot.links,
    project.robot.rootLinkId,
    selection,
  ]);

  const previewGeometry: Geometry = useMemo(
    () =>
      selectedAssetId
        ? { type: 'mesh', assetId: selectedAssetId, scale: meshScale }
        : { type: 'compound', parts },
    [selectedAssetId, meshScale, parts],
  );

  const selectedSubPart = parts[selectedPartIdx] ?? null;

  const handleGenerateAxles = () => {
    const built = buildChassisWithAxlesPart({
      name: partName || 'chassis_with_axles',
      chassisSize: [chassisX, chassisY, chassisZ],
      wheelbase,
      trackWidth,
      axleCount,
      axleRadius,
    });
    if (built.geometry.type === 'compound') {
      setParts(built.geometry.parts);
    }
    setMounts(built.defaultMounts);
    setSelectedAssetId('');
    setSelectedPartIdx(0);
  };

  const addCompoundPrimitive = (
    kind: 'box' | 'cylinder' | 'sphere' | 'capsule',
    op: 'add' | 'subtract' = 'add',
  ) => {
    const shape: Primitive =
      kind === 'box'
        ? { kind: 'box', size: [0.16, 0.12, 0.08] }
        : kind === 'cylinder'
          ? { kind: 'cylinder', radius: 0.04, length: 0.16 }
          : kind === 'sphere'
            ? { kind: 'sphere', radius: 0.05 }
            : { kind: 'capsule', radius: 0.035, length: 0.14 };

    setParts((prev) => {
      const next: CompoundPart[] = [...prev, { id: createId(), shape, pose: createZeroPose(), op }];
      setSelectedPartIdx(next.length - 1);
      return next;
    });
    setSelectedAssetId('');
  };

  const handleAddExtrudePart = () => {
    setParts((prev) => {
      const next: CompoundPart[] = [
        ...prev,
        {
          id: createId(),
          shape: { kind: 'extrude', points: sketchPoints, depth: extrudeDepth },
          pose: createZeroPose(),
          op: extrudeOp,
        },
      ];
      setSelectedPartIdx(next.length - 1);
      return next;
    });
    setSelectedAssetId('');
  };

  const handleMirrorPartY = (idx: number) => {
    const src = parts[idx];
    if (!src) return;
    const copy: CompoundPart = {
      ...structuredClone(src),
      id: createId(),
      pose: {
        xyz: [src.pose.xyz[0], -src.pose.xyz[1], src.pose.xyz[2]],
        rpy: [src.pose.rpy[0], src.pose.rpy[1], -src.pose.rpy[2]],
      },
    };
    setParts((prev) => [...prev, copy]);
  };

  const handleFileUpload = async (file: File) => {
    setUploadError(null);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'stl' && ext !== 'glb' && ext !== 'dae') {
      setUploadError('Supported mesh formats: .stl, .glb, .dae');
      return;
    }
    const buffer = await file.arrayBuffer();
    const baseName = file.name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^[^a-z]+/, 'mesh_');

    const asset: Asset = {
      id: createId(),
      name: baseName || 'imported_mesh',
      format: ext,
      dataBase64: arrayBufferToBase64(buffer),
      byteLength: buffer.byteLength,
    };
    addAsset(asset);
    setSelectedAssetId(asset.id);
  };

  const runMountCompatibilityCheck = async () => {
    const link = project.robot.links.find((l) => l.id === targetLinkId);
    if (!link) return;
    const geom: Geometry = selectedAssetId
      ? { type: 'mesh', assetId: selectedAssetId, scale: meshScale }
      : { type: 'compound', parts };
    const result = await checkGeometryMountCompatibility(geom, link.mounts, project.assets);
    setCompatReports(result.reports);
    setCompatBbox(
      `[${result.bboxMin.map((n) => n.toFixed(2)).join(', ')}] to [${result.bboxMax
        .map((n) => n.toFixed(2))
        .join(', ')}] m`,
    );
  };

  const handleSavePart = (alsoApplyToLink: boolean) => {
    const cleanedName =
      partName
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^[^a-z]+/, 'part_') || 'custom_part';
    const customPart: CustomPart = {
      id: partId,
      name: cleanedName,
      geometry: { type: 'compound', parts },
      defaultMounts: mounts,
    };
    saveCustomPart(customPart);
    if (alsoApplyToLink && targetLinkId) {
      applyCustomPartToLink(targetLinkId, customPart);
    }
    closePartEditor();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closePartEditor()}>
      <DialogContent className="max-w-5xl h-[86vh] flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-blue-400" />
            Custom Part Editor & Detailed Mesh Replacement
          </DialogTitle>
          <DialogDescription>
            Build parametric compound shapes (e.g. chassis with axles), sketch extrusions & CSG
            cutouts, or import STL/GLB/DAE meshes while preserving mounts.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 grid grid-cols-12 gap-3">
          {/* Left 3D Preview */}
          <div className="col-span-6 flex flex-col rounded border border-[#232b3b] bg-[#0b0e14] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#222938] bg-[#10141d] px-3 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Name:</span>
                <Input
                  value={partName}
                  onChange={(e) => setPartName(e.target.value)}
                  className="h-6 w-44 font-mono text-xs"
                  aria-label="Custom part name"
                />
              </div>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {selectedAssetId
                  ? 'Mesh Preview'
                  : `${parts.length} parts · ${mounts.length} mounts`}
              </span>
            </div>

            <div className="flex-1 min-h-0 relative">
              <PartPreviewCanvas
                geometry={previewGeometry}
                mounts={mounts}
                assets={project.assets}
              />
              {selectedAssetId && (
                <button
                  type="button"
                  onClick={() => setSelectedAssetId('')}
                  className="absolute top-2 right-2 rounded border border-[#2a3346] bg-[#10141d] px-2 py-1 text-[11px] text-slate-200 hover:bg-[#1a202e] cursor-pointer"
                >
                  Back to Compound Preview
                </button>
              )}
            </div>
          </div>

          {/* Right Authoring Controls */}
          <div className="col-span-6 flex flex-col min-h-0 rounded border border-[#232b3b] bg-[#11151e]">
            <Tabs defaultValue="compound" className="flex h-full flex-col">
              <div className="border-b border-[#222938] px-3 py-2 shrink-0">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="compound">1. Compound & Axles</TabsTrigger>
                  <TabsTrigger value="sketch">2. Sketch & CSG</TabsTrigger>
                  <TabsTrigger value="mesh">3. Mesh Import</TabsTrigger>
                </TabsList>
              </div>

              {/* STAGE 1: Compound Primitives + Parametric Chassis with Axles */}
              <TabsContent value="compound" className="flex-1 overflow-y-auto p-3 space-y-4">
                <div className="rounded border border-[#232b3b] bg-[#0d1118] p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">
                      Parametric Chassis with Axles
                    </span>
                    <Button type="button" size="sm" onClick={handleGenerateAxles}>
                      <Layers className="h-3.5 w-3.5" />
                      Generate
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <label className="space-y-0.5 text-slate-400">
                      <span>Chassis X (m)</span>
                      <Input
                        type="number"
                        step={0.02}
                        value={chassisX}
                        onChange={(e) => setChassisX(Math.max(0.05, Number(e.target.value) || 0.5))}
                        className="font-mono"
                      />
                    </label>
                    <label className="space-y-0.5 text-slate-400">
                      <span>Chassis Y (m)</span>
                      <Input
                        type="number"
                        step={0.02}
                        value={chassisY}
                        onChange={(e) => setChassisY(Math.max(0.05, Number(e.target.value) || 0.3))}
                        className="font-mono"
                      />
                    </label>
                    <label className="space-y-0.5 text-slate-400">
                      <span>Chassis Z (m)</span>
                      <Input
                        type="number"
                        step={0.01}
                        value={chassisZ}
                        onChange={(e) => setChassisZ(Math.max(0.02, Number(e.target.value) || 0.1))}
                        className="font-mono"
                      />
                    </label>
                    <label className="space-y-0.5 text-slate-400">
                      <span>Wheelbase (m)</span>
                      <Input
                        type="number"
                        step={0.02}
                        value={wheelbase}
                        onChange={(e) =>
                          setWheelbase(Math.max(0.05, Number(e.target.value) || 0.34))
                        }
                        className="font-mono"
                      />
                    </label>
                    <label className="space-y-0.5 text-slate-400">
                      <span>Track Width (m)</span>
                      <Input
                        type="number"
                        step={0.02}
                        value={trackWidth}
                        onChange={(e) =>
                          setTrackWidth(Math.max(0.05, Number(e.target.value) || 0.42))
                        }
                        className="font-mono"
                      />
                    </label>
                    <label className="space-y-0.5 text-slate-400">
                      <span>Axles</span>
                      <Input
                        type="number"
                        min={1}
                        max={4}
                        value={axleCount}
                        onChange={(e) =>
                          setAxleCount(Math.max(1, Math.min(4, Number(e.target.value) || 2)))
                        }
                        className="font-mono"
                      />
                    </label>
                    <label className="space-y-0.5 text-slate-400">
                      <span>Axle Radius (m)</span>
                      <Input
                        type="number"
                        step={0.002}
                        min={0.005}
                        value={axleRadius}
                        onChange={(e) =>
                          setAxleRadius(Math.max(0.005, Number(e.target.value) || 0.018))
                        }
                        className="font-mono"
                      />
                    </label>
                  </div>
                </div>

                {/* Sub-parts list */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">Compound Sub-Parts</span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => addCompoundPrimitive('box', 'add')}
                      >
                        + Box
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => addCompoundPrimitive('cylinder', 'add')}
                      >
                        + Cyl
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => addCompoundPrimitive('box', 'subtract')}
                      >
                        - Cutout
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {parts.map((p, idx) => (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between rounded border px-2 py-1 text-xs ${
                          idx === selectedPartIdx
                            ? 'border-blue-500 bg-blue-950/30 text-blue-100'
                            : 'border-[#222938] bg-[#0d1118] text-slate-300'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedPartIdx(idx)}
                          className="flex-1 text-left font-mono truncate cursor-pointer"
                        >
                          #{idx + 1} [{p.op ?? 'add'}] {p.shape.kind} @ (
                          {p.pose.xyz.map((v) => v.toFixed(2)).join(', ')})
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleMirrorPartY(idx)}
                            title="Mirror across Y"
                            className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setParts((prev) => prev.filter((_, i) => i !== idx))}
                            disabled={parts.length <= 1}
                            title="Remove sub-part"
                            className="p-1 text-slate-400 hover:text-red-400 disabled:opacity-40 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedSubPart && (
                    <div className="rounded border border-[#222938] bg-[#0d1118] p-2.5 space-y-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200">
                          Selected Sub-Part #{selectedPartIdx + 1} ({selectedSubPart.shape.kind})
                        </span>
                        <select
                          value={selectedSubPart.op ?? 'add'}
                          onChange={(e) => {
                            const op = e.target.value as 'add' | 'subtract';
                            setParts((prev) =>
                              prev.map((item, i) =>
                                i === selectedPartIdx ? { ...item, op } : item,
                              ),
                            );
                          }}
                          className="h-6 rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-[11px] text-slate-200"
                        >
                          <option value="add">CSG Add (Union)</option>
                          <option value="subtract">CSG Subtract (Cut)</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        {(['X', 'Y', 'Z'] as const).map((axis, axisIdx) => (
                          <label key={axis} className="space-y-0.5 text-slate-400">
                            <span>Offset {axis} (m)</span>
                            <Input
                              type="number"
                              step={0.01}
                              value={selectedSubPart.pose.xyz[axisIdx as 0 | 1 | 2]}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                setParts((prev) =>
                                  prev.map((item, i) => {
                                    if (i !== selectedPartIdx) return item;
                                    const nextXyz = [...item.pose.xyz] as [number, number, number];
                                    nextXyz[axisIdx as 0 | 1 | 2] = val;
                                    return { ...item, pose: { ...item.pose, xyz: nextXyz } };
                                  }),
                                );
                              }}
                              className="font-mono"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* STAGE 2: 2D Sketch Extrusion & CSG Booleans */}
              <TabsContent value="sketch" className="flex-1 overflow-y-auto p-3 space-y-3">
                <div className="text-xs text-slate-300">
                  Edit the 2D XY cross-section profile below (units in meters) and extrude along Z
                  into the compound assembly. Use <strong>CSG Subtract</strong> to carve pockets or
                  sensor recesses.
                </div>

                <div className="flex items-center justify-center rounded border border-[#232b3b] bg-[#0b0e14] p-2">
                  <svg
                    viewBox="-0.35 -0.25 0.7 0.5"
                    className="h-44 w-full cursor-crosshair"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const nx = (e.clientX - rect.left) / rect.width;
                      const ny = (e.clientY - rect.top) / rect.height;
                      const x = Number((-0.35 + nx * 0.7).toFixed(3));
                      const y = Number((0.25 - ny * 0.5).toFixed(3));
                      setSketchPoints((prev) => [...prev, [x, y]]);
                    }}
                  >
                    <line x1="-0.35" y1="0" x2="0.35" y2="0" stroke="#232b3b" strokeWidth="0.004" />
                    <line x1="0" y1="-0.25" x2="0" y2="0.25" stroke="#232b3b" strokeWidth="0.004" />
                    <polygon
                      points={sketchPoints.map(([x, y]) => `${x},${-y}`).join(' ')}
                      fill="rgba(59, 130, 246, 0.25)"
                      stroke="#60a5fa"
                      strokeWidth="0.006"
                    />
                    {sketchPoints.map(([x, y], i) => (
                      <circle key={i} cx={x} cy={-y} r="0.011" fill="#93c5fd" />
                    ))}
                  </svg>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <label className="space-y-1 text-slate-400">
                    <span>Extrude Depth (m)</span>
                    <Input
                      type="number"
                      step={0.01}
                      min={0.01}
                      value={extrudeDepth}
                      onChange={(e) =>
                        setExtrudeDepth(Math.max(0.01, Number(e.target.value) || 0.08))
                      }
                      className="font-mono"
                    />
                  </label>
                  <label className="space-y-1 text-slate-400">
                    <span>Boolean Op</span>
                    <select
                      value={extrudeOp}
                      onChange={(e) => setExtrudeOp(e.target.value as 'add' | 'subtract')}
                      className="h-7 w-full rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-xs text-slate-200"
                    >
                      <option value="add">Add (Extrude Body)</option>
                      <option value="subtract">Subtract (Cutout)</option>
                    </select>
                  </label>
                  <div className="flex items-end gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddExtrudePart}
                      className="w-full"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Extrude
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{sketchPoints.length} vertices (click canvas to append vertex)</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSketchPoints([
                        [-0.18, -0.1],
                        [0.18, -0.1],
                        [0.18, 0.1],
                        [-0.18, 0.1],
                      ])
                    }
                    className="text-blue-400 hover:underline cursor-pointer"
                  >
                    Reset Rect
                  </button>
                </div>
              </TabsContent>

              {/* STAGE 3: Mesh Import & Mount Compatibility Check */}
              <TabsContent value="mesh" className="flex-1 overflow-y-auto p-3 space-y-3">
                <div className="rounded border border-dashed border-[#2f3b52] bg-[#0d1118] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">
                      Import 3D Mesh (.stl, .glb, .dae)
                    </span>
                    <label className="inline-flex h-7 items-center gap-1.5 rounded bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-500 cursor-pointer">
                      <Upload className="h-3.5 w-3.5" />
                      Choose File
                      <input
                        type="file"
                        accept=".stl,.glb,.dae"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleFileUpload(file);
                        }}
                      />
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Imported meshes are stored in your project and exported into{' '}
                    <code className="font-mono text-slate-300">meshes/</code> inside the ROS 2
                    package. Replacing a link's visual mesh keeps collision and inertial intact.
                  </p>
                  {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
                </div>

                {project.assets.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-200">Imported Assets</label>
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                      {project.assets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => {
                            setSelectedAssetId(asset.id);
                            setCompatReports(null);
                          }}
                          className={`flex w-full items-center justify-between rounded border px-2 py-1 text-xs font-mono cursor-pointer ${
                            selectedAssetId === asset.id
                              ? 'border-blue-500 bg-blue-950/30 text-blue-100'
                              : 'border-[#222938] bg-[#0d1118] text-slate-300'
                          }`}
                        >
                          <span>
                            {asset.name}.{asset.format}
                          </span>
                          <span className="text-slate-500">
                            {(asset.byteLength / 1024).toFixed(1)} KB
                          </span>
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                        <label key={axis} className="space-y-0.5 text-slate-400">
                          <span>Mesh Scale {axis}</span>
                          <Input
                            type="number"
                            step={0.1}
                            min={0.01}
                            value={meshScale[i as 0 | 1 | 2]}
                            onChange={(e) => {
                              const next = [...meshScale] as [number, number, number];
                              next[i as 0 | 1 | 2] = Math.max(0.001, Number(e.target.value) || 1);
                              setMeshScale(next);
                            }}
                            className="font-mono"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t border-[#222938] pt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-200">
                      Mount Compatibility Check
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={runMountCompatibilityCheck}
                    >
                      Check Mounts on Target Link
                    </Button>
                  </div>

                  {compatReports && (
                    <div className="rounded border border-[#222938] bg-[#0d1118] p-2 space-y-1 text-[11px]">
                      <div className="font-mono text-slate-400">Mesh Bounds: {compatBbox}</div>
                      {compatReports.map((r) => (
                        <div key={r.mountId} className="flex items-center justify-between">
                          <span className="font-mono text-slate-200">{r.mountName}</span>
                          {r.withinBounds ? (
                            <span className="flex items-center gap-1 text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" />
                              Aligned
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-400">
                              <AlertTriangle className="h-3 w-3" />
                              Offset {r.distanceOutsideMeters} m outside
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedAssetId && targetLinkId && (
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => {
                        assignAssetVisualToLink(targetLinkId, selectedAssetId, meshScale);
                        closePartEditor();
                      }}
                    >
                      Replace Target Link Visual with Mesh (Keep Collision & Inertial)
                    </Button>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#222938] pt-3 shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="part-target-link" className="text-slate-400">
              Target Link:
            </label>
            <select
              id="part-target-link"
              value={targetLinkId}
              onChange={(e) => setTargetLinkId(e.target.value)}
              className="h-7 rounded border border-[#2a3346] bg-[#0e121a] px-2 font-mono text-xs text-slate-200"
            >
              {project.robot.links.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={closePartEditor}>
              Cancel
            </Button>
            <Button type="button" variant="secondary" onClick={() => handleSavePart(false)}>
              <Save className="h-3.5 w-3.5" />
              Save to Library
            </Button>
            <Button type="button" disabled={!targetLinkId} onClick={() => handleSavePart(true)}>
              Save & Apply to Link
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
