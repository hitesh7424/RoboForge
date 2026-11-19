import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Box,
  ChevronDown,
  Download,
  Eye,
  FolderOpen,
  Globe,
  Paintbrush,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Redo2,
  SlidersHorizontal,
  Undo2,
  Wrench,
} from 'lucide-react';
import { createDefaultProject } from '@/core/defaults';
import { isValidRosName, type TargetDistro } from '@/core/schema';
import { useRoboForgeStore, type WorkspaceMode } from '@/core/store';
import { createFourWheelRoverProject, createTwoWheelCasterProject } from '@/core/templates';
import {
  summarizeUnitPreferences,
  type AngleUnit,
  type InertiaUnit,
  type LengthUnit,
  type MassUnit,
  type TimeUnit,
} from '@/core/units';
import { Button } from '@/ui/components/button';
import { Input } from '@/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/select';

const MODES: { id: WorkspaceMode; label: string; icon: typeof Box }[] = [
  { id: 'robot', label: 'Robot', icon: Box },
  { id: 'world', label: 'World & Sim', icon: Globe },
  { id: 'world_studio', label: 'World Studio', icon: Paintbrush },
  { id: 'preview', label: 'Preview', icon: Eye },
];

const SHORT_TARGET_LABELS: Record<TargetDistro, string> = {
  'jazzy-harmonic': 'Jazzy · Harmonic',
  'humble-fortress': 'Humble · Fortress',
  'lyrical-jetty': 'Lyrical · Jetty',
};

export function TopBar() {
  const project = useRoboForgeStore((s) => s.project);
  const mode = useRoboForgeStore((s) => s.mode);
  const units = useRoboForgeStore((s) => s.units);
  const pastCount = useRoboForgeStore((s) => s.past.length);
  const futureCount = useRoboForgeStore((s) => s.future.length);
  const autosaveStatus = useRoboForgeStore((s) => s.autosaveStatus);
  const lastSavedAt = useRoboForgeStore((s) => s.lastSavedAt);

  const setProjectName = useRoboForgeStore((s) => s.setProjectName);
  const setTarget = useRoboForgeStore((s) => s.setTarget);
  const setMode = useRoboForgeStore((s) => s.setMode);
  const setUnits = useRoboForgeStore((s) => s.setUnits);
  const setUnitPref = useRoboForgeStore((s) => s.setUnitPref);
  const undo = useRoboForgeStore((s) => s.undo);
  const redo = useRoboForgeStore((s) => s.redo);
  const setJsonModalOpen = useRoboForgeStore((s) => s.setJsonModalOpen);
  const setExportModalOpen = useRoboForgeStore((s) => s.setExportModalOpen);
  const openPartEditor = useRoboForgeStore((s) => s.openPartEditor);
  const loadProject = useRoboForgeStore((s) => s.loadProject);
  const collapsedPanels = useRoboForgeStore((s) => s.collapsedPanels);
  const togglePanel = useRoboForgeStore((s) => s.togglePanel);

  const [nameDraft, setNameDraft] = useState(project.name);
  const nameFocusedRef = useRef(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const unitsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!nameFocusedRef.current) {
      setNameDraft(project.name);
    }
  }, [project.name]);

  useEffect(() => {
    if (!unitsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (unitsMenuRef.current && !unitsMenuRef.current.contains(e.target as Node)) {
        setUnitsOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUnitsOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [unitsOpen]);

  const commitName = () => {
    nameFocusedRef.current = false;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(project.name);
      return;
    }
    if (trimmed !== project.name) {
      setProjectName(trimmed);
    }
  };

  const nameValid = isValidRosName(nameDraft);

  const handleLoadTemplate = (templateId: string) => {
    if (!templateId) return;
    if (templateId === 'four_wheel_rover') {
      loadProject(createFourWheelRoverProject(project.target), {
        logMessage: 'Loaded 4-Wheel Diff-Drive Rover template.',
      });
    } else if (templateId === 'two_wheel_caster') {
      loadProject(createTwoWheelCasterProject(project.target), {
        logMessage: 'Loaded 2-Wheel + Caster Bot template.',
      });
    } else if (templateId === 'blank') {
      const blank = createDefaultProject();
      blank.target = project.target;
      loadProject(blank, { logMessage: 'Loaded blank single-chassis project.' });
    }
  };

  return (
    <header className="relative z-30 flex h-12 w-full items-center justify-between gap-1.5 border-b border-[#232b3b] bg-[#10141d] px-2 shrink-0">
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-sm font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
          RoboForge
        </span>

        <div className="h-4 w-px bg-[#252e3f] shrink-0" aria-hidden="true" />

        <div className="flex items-center gap-1 shrink-0">
          <label htmlFor="project-name-input" className="sr-only">
            ROS 2 package name
          </label>
          <Input
            id="project-name-input"
            aria-label="Project package name"
            value={nameDraft}
            onFocus={() => {
              nameFocusedRef.current = true;
            }}
            onChange={(e) => {
              const raw = e.target.value;
              setNameDraft(raw);
              const trimmed = raw.trim();
              if (isValidRosName(trimmed) && trimmed !== project.name) {
                setProjectName(trimmed);
              }
            }}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                nameFocusedRef.current = false;
                setNameDraft(project.name);
                e.currentTarget.blur();
              }
            }}
            className={`w-[92px] shrink-0 font-mono text-xs ${
              nameValid ? '' : 'border-red-500 focus-visible:ring-red-500'
            }`}
          />
          {!nameValid && (
            <span
              className="flex items-center gap-1 text-xs text-red-400 whitespace-nowrap shrink-0"
              title="Must match ^[a-z][a-z0-9_]*$"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              Invalid
            </span>
          )}
        </div>

        <Select value={project.target} onValueChange={(v) => setTarget(v as TargetDistro)}>
          <SelectTrigger
            aria-label="Target ROS 2 distribution"
            title={project.target}
            className="w-[116px] shrink-0 px-2 text-xs"
          >
            <span className="truncate">{SHORT_TARGET_LABELS[project.target]}</span>
            <span className="sr-only">
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="jazzy-harmonic">ROS 2 Jazzy + Gazebo Harmonic</SelectItem>
            <SelectItem value="humble-fortress">ROS 2 Humble + Gazebo Fortress</SelectItem>
            <SelectItem value="lyrical-jetty">ROS 2 Lyrical + Gazebo Jetty</SelectItem>
          </SelectContent>
        </Select>

        <select
          aria-label="Load robot template"
          defaultValue=""
          onChange={(e) => {
            handleLoadTemplate(e.target.value);
            e.target.value = '';
          }}
          className="hidden min-[1360px]:block h-7 w-[82px] shrink-0 rounded border border-[#2a3346] bg-[#0e121a] px-1.5 text-xs text-slate-300 hover:bg-[#1a202e] cursor-pointer"
        >
          <option value="" disabled>
            Templates...
          </option>
          <option value="four_wheel_rover">4-Wheel Diff-Drive Rover</option>
          <option value="two_wheel_caster">2-Wheel + Caster Bot</option>
          <option value="blank">Blank Chassis</option>
        </select>
      </div>

      <nav
        aria-label="Workspace mode"
        className="flex items-center gap-1 rounded-md border border-[#232b3b] bg-[#0b0e14] p-0.5 shrink-0"
      >
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1 whitespace-nowrap shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
                active
                  ? m.id === 'world'
                    ? 'bg-emerald-600 text-white'
                    : m.id === 'world_studio'
                      ? 'bg-teal-600 text-white'
                      : 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-[#161c28] hover:text-slate-100'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {m.label}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-1 shrink-0">
        {/* Panel collapse/expand toggles (for 3-panel workspace modes) */}
        {mode !== 'world_studio' && (
          <div
            role="group"
            aria-label="Toggle workspace panels"
            className="flex items-center gap-0.5 rounded border border-[#232b3b] bg-[#0b0e14] p-0.5"
          >
            <button
              type="button"
              onClick={() => togglePanel('left')}
              aria-label="Toggle left sidebar"
              aria-pressed={!collapsedPanels.left}
              title={collapsedPanels.left ? 'Show Left Sidebar' : 'Collapse Left Sidebar'}
              className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer ${
                !collapsedPanels.left
                  ? 'bg-[#1e2636] text-blue-300'
                  : 'text-slate-500 hover:bg-[#161c28] hover:text-slate-200'
              }`}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => togglePanel('bottom')}
              aria-label="Toggle bottom bar"
              aria-pressed={!collapsedPanels.bottom}
              title={collapsedPanels.bottom ? 'Show Bottom Bar' : 'Collapse Bottom Bar'}
              className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer ${
                !collapsedPanels.bottom
                  ? 'bg-[#1e2636] text-blue-300'
                  : 'text-slate-500 hover:bg-[#161c28] hover:text-slate-200'
              }`}
            >
              <PanelBottom className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => togglePanel('right')}
              aria-label="Toggle right inspector"
              aria-pressed={!collapsedPanels.right}
              title={collapsedPanels.right ? 'Show Right Inspector' : 'Collapse Right Inspector'}
              className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer ${
                !collapsedPanels.right
                  ? 'bg-[#1e2636] text-blue-300'
                  : 'text-slate-500 hover:bg-[#161c28] hover:text-slate-200'
              }`}
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <span className="hidden 2xl:inline text-xs text-slate-400 tabular-nums whitespace-nowrap mr-1">
          {autosaveStatus === 'saving'
            ? 'Saving...'
            : autosaveStatus === 'saved' && lastSavedAt
              ? `Saved ${lastSavedAt}`
              : autosaveStatus === 'error'
                ? 'Save error'
                : 'Ready'}
        </span>

        {/* Granular Independent Display Units Popover */}
        <div className="relative" ref={unitsMenuRef}>
          <button
            type="button"
            onClick={() => setUnitsOpen((o) => !o)}
            aria-label="Configure display units"
            aria-expanded={unitsOpen}
            className="inline-flex h-7 items-center gap-1.5 rounded border border-[#2a3346] bg-[#0e121a] px-2 text-xs font-mono text-slate-200 hover:bg-[#1a202e] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <SlidersHorizontal className="h-3 w-3 text-blue-400" />
            <span>{summarizeUnitPreferences(units)}</span>
            <ChevronDown className="h-3 w-3 text-slate-400" />
          </button>

          {unitsOpen && (
            <div
              role="dialog"
              aria-label="Display unit preferences"
              className="absolute right-0 top-9 z-50 w-72 rounded-md border border-[#2a3346] bg-[#121722] p-3 shadow-2xl space-y-3 text-xs"
            >
              <div className="flex items-center justify-between border-b border-[#222938] pb-2">
                <span className="font-semibold text-slate-100">Display Units</span>
                <span className="text-[10px] font-mono text-slate-400">Stored internally in SI</span>
              </div>

              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setUnits({
                      length: 'm',
                      angle: 'rad',
                      mass: 'kg',
                      inertia: 'kg_m2',
                      time: 's',
                    })
                  }
                  className="rounded border border-[#2a3346] bg-[#0c1018] px-1.5 py-1 text-[10px] font-mono text-slate-300 hover:bg-[#1c2333] cursor-pointer"
                >
                  SI Metric
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setUnits({
                      length: 'mm',
                      angle: 'deg',
                      mass: 'g',
                      inertia: 'g_cm2',
                      time: 'ms',
                    })
                  }
                  className="rounded border border-[#2a3346] bg-[#0c1018] px-1.5 py-1 text-[10px] font-mono text-slate-300 hover:bg-[#1c2333] cursor-pointer"
                >
                  CAD (mm/deg)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setUnits({
                      length: 'in',
                      angle: 'deg',
                      mass: 'lb',
                      inertia: 'kg_m2',
                      time: 's',
                    })
                  }
                  className="rounded border border-[#2a3346] bg-[#0c1018] px-1.5 py-1 text-[10px] font-mono text-slate-300 hover:bg-[#1c2333] cursor-pointer"
                >
                  Imperial
                </button>
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Length</span>
                  <select
                    aria-label="Length unit"
                    value={units.length}
                    onChange={(e) => setUnitPref('length', e.target.value as LengthUnit)}
                    className="h-7 w-36 rounded border border-[#2a3346] bg-[#0b0e14] px-2 font-mono text-xs text-slate-200"
                  >
                    <option value="m">Meters (m)</option>
                    <option value="cm">Centimeters (cm)</option>
                    <option value="mm">Millimeters (mm)</option>
                    <option value="in">Inches (in)</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Angle</span>
                  <select
                    aria-label="Angle unit"
                    value={units.angle}
                    onChange={(e) => setUnitPref('angle', e.target.value as AngleUnit)}
                    className="h-7 w-36 rounded border border-[#2a3346] bg-[#0b0e14] px-2 font-mono text-xs text-slate-200"
                  >
                    <option value="rad">Radians (rad)</option>
                    <option value="deg">Degrees (deg)</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Mass</span>
                  <select
                    aria-label="Mass unit"
                    value={units.mass}
                    onChange={(e) => setUnitPref('mass', e.target.value as MassUnit)}
                    className="h-7 w-36 rounded border border-[#2a3346] bg-[#0b0e14] px-2 font-mono text-xs text-slate-200"
                  >
                    <option value="kg">Kilograms (kg)</option>
                    <option value="g">Grams (g)</option>
                    <option value="lb">Pounds (lb)</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Inertia</span>
                  <select
                    aria-label="Inertia unit"
                    value={units.inertia}
                    onChange={(e) => setUnitPref('inertia', e.target.value as InertiaUnit)}
                    className="h-7 w-36 rounded border border-[#2a3346] bg-[#0b0e14] px-2 font-mono text-xs text-slate-200"
                  >
                    <option value="kg_m2">kg·m²</option>
                    <option value="g_cm2">g·cm²</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Time</span>
                  <select
                    aria-label="Time unit"
                    value={units.time}
                    onChange={(e) => setUnitPref('time', e.target.value as TimeUnit)}
                    className="h-7 w-36 rounded border border-[#2a3346] bg-[#0b0e14] px-2 font-mono text-xs text-slate-200"
                  >
                    <option value="s">Seconds (s)</option>
                    <option value="ms">Milliseconds (ms)</option>
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={undo}
          disabled={pastCount === 0}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={redo}
          disabled={futureCount === 0}
          aria-label="Redo"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => openPartEditor(null)}
          aria-label="Open Custom Part Editor"
          title="Open Custom Part Editor"
        >
          <Wrench className="h-3.5 w-3.5" />
          <span className="hidden 2xl:inline">Part Editor</span>
          <span className="2xl:hidden">Parts</span>
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setJsonModalOpen(true)}
          aria-label="Save or Load JSON"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Project
        </Button>

        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => setExportModalOpen(true)}
          aria-label="Export ROS 2 Package"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </div>
    </header>
  );
}
