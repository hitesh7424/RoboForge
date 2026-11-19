import { useMemo } from 'react';
import { Gauge, Layers, Shield, SunDim, Trees } from 'lucide-react';
import type { World } from '@/core/schema';
import { useRoboForgeStore } from '@/core/store';
import { resolveWorldPerformance } from '@/core/treeBillboardAtlas';
import { computeWorldOptimizationStats } from '@/core/worldBatcher';

export interface WorldPerformanceControlsProps {
  world: World;
  /** 'panel' for left/right sidebars, 'compact' for the Export Modal strip */
  variant?: 'panel' | 'compact';
}

function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function WorldPerformanceControls({
  world,
  variant = 'panel',
}: WorldPerformanceControlsProps) {
  const updateWorldPerformance = useRoboForgeStore((s) => s.updateWorldPerformance);
  const perf = useMemo(() => resolveWorldPerformance(world.performance), [world.performance]);
  const stats = useMemo(() => computeWorldOptimizationStats(world), [world]);

  if (variant === 'compact') {
    return (
      <div
        data-testid="export-performance-bar"
        className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#232b3b] bg-[#0c1018] px-3 py-2 text-[11px] shrink-0"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
            <Gauge className="h-3.5 w-3.5 text-emerald-400" />
            Gazebo FPS Boost
          </span>

          <div
            role="group"
            aria-label="Export tree rendering style"
            className="inline-flex rounded border border-[#283246] bg-[#0b0f17] p-0.5"
          >
            <button
              type="button"
              data-testid="export-perf-cross-card"
              aria-pressed={perf.treeRenderMode === 'cross_card'}
              onClick={() =>
                updateWorldPerformance((p) => {
                  p.treeRenderMode = 'cross_card';
                })
              }
              className={`rounded px-2 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                perf.treeRenderMode === 'cross_card'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              2D Cross-Card Trees
            </button>
            <button
              type="button"
              data-testid="export-perf-3d-mesh"
              aria-pressed={perf.treeRenderMode === '3d_mesh'}
              onClick={() =>
                updateWorldPerformance((p) => {
                  p.treeRenderMode = '3d_mesh';
                })
              }
              className={`rounded px-2 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                perf.treeRenderMode === '3d_mesh'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              3D Volumetric
            </button>
          </div>

          <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              data-testid="export-perf-combine-trees"
              checked={perf.combineTreesWithGround}
              onChange={(e) =>
                updateWorldPerformance((p) => {
                  p.combineTreesWithGround = e.target.checked;
                })
              }
              className="accent-emerald-500"
            />
            Merge Trees w/ Ground
          </label>

          <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              data-testid="export-perf-combine-props"
              checked={perf.combineStaticPropsWithGround}
              onChange={(e) =>
                updateWorldPerformance((p) => {
                  p.combineStaticPropsWithGround = e.target.checked;
                })
              }
              className="accent-emerald-500"
            />
            Merge Static Props
          </label>
        </div>

        <div
          data-testid="export-perf-stats"
          className="flex items-center gap-3 font-mono text-[10px] text-slate-400"
        >
          <span>
            Models:{' '}
            <strong className="text-emerald-300">
              {stats.rawModelCount} → {stats.optimizedModelCount}
            </strong>
          </span>
          <span>
            Draw Calls:{' '}
            <strong className="text-sky-300">
              {stats.rawVisualCount} → {stats.optimizedVisualCount}
            </strong>
          </span>
          {stats.treeCount > 0 && (
            <span>
              Tree Tris:{' '}
              <strong className="text-amber-300">
                {stats.rawTreeTriangles.toLocaleString()} →{' '}
                {stats.optimizedTreeTriangles.toLocaleString()}
              </strong>
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="world-performance-controls"
      className="rounded-md border border-[#242e40] bg-[#0b0f17] p-2.5 space-y-2.5 text-[11px]"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 text-emerald-400" />
          Gazebo Performance &amp; FPS
        </span>
        {stats.treeCount > 0 && (
          <span className="font-mono text-[10px] text-emerald-300">
            {stats.treeCount} tree{stats.treeCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Live Optimization Impact Summary */}
      <div
        data-testid="perf-stats-grid"
        className="grid grid-cols-3 gap-1 rounded border border-[#1d2638] bg-[#0e131e] p-1.5 font-mono text-[10px]"
      >
        <div className="text-center">
          <div className="text-slate-500">Models</div>
          <div className="text-emerald-300 font-semibold">
            {stats.rawModelCount}→{stats.optimizedModelCount}
          </div>
        </div>
        <div className="text-center border-x border-[#1d2638]">
          <div className="text-slate-500">Visuals</div>
          <div className="text-sky-300 font-semibold">
            {stats.rawVisualCount}→{stats.optimizedVisualCount}
          </div>
        </div>
        <div className="text-center">
          <div className="text-slate-500">Tree Tris</div>
          <div className="text-amber-300 font-semibold">
            {stats.treeCount > 0
              ? `${formatCompactCount(stats.rawTreeTriangles)}→${formatCompactCount(stats.optimizedTreeTriangles)}`
              : '0'}
          </div>
        </div>
      </div>

      {/* Tree Representation Mode */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Trees className="h-3 w-3 text-emerald-400" />
            Tree Rendering Style
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            data-testid="perf-tree-cross-card"
            aria-pressed={perf.treeRenderMode === 'cross_card'}
            onClick={() =>
              updateWorldPerformance((p) => {
                p.treeRenderMode = 'cross_card';
              })
            }
            className={`rounded border py-1 text-[10px] font-medium cursor-pointer transition-colors ${
              perf.treeRenderMode === 'cross_card'
                ? 'border-emerald-500 bg-emerald-950/50 text-emerald-200'
                : 'border-[#252f42] bg-[#10141d] text-slate-400 hover:bg-[#171e2b] hover:text-slate-200'
            }`}
          >
            2D Cross-Card (Game)
          </button>
          <button
            type="button"
            data-testid="perf-tree-3d-mesh"
            aria-pressed={perf.treeRenderMode === '3d_mesh'}
            onClick={() =>
              updateWorldPerformance((p) => {
                p.treeRenderMode = '3d_mesh';
              })
            }
            className={`rounded border py-1 text-[10px] font-medium cursor-pointer transition-colors ${
              perf.treeRenderMode === '3d_mesh'
                ? 'border-blue-500 bg-blue-950/50 text-blue-200'
                : 'border-[#252f42] bg-[#10141d] text-slate-400 hover:bg-[#171e2b] hover:text-slate-200'
            }`}
          >
            3D Volumetric
          </button>
        </div>
      </div>

      {/* Batching & Merging Toggles */}
      <div className="space-y-1.5 pt-1 border-t border-[#1c2434]">
        <label className="flex items-center justify-between gap-2 cursor-pointer text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <Layers className="h-3 w-3 text-sky-400 shrink-0" />
            Combine Trees with Ground (1 Mesh)
          </span>
          <input
            type="checkbox"
            data-testid="perf-combine-trees"
            checked={perf.combineTreesWithGround}
            onChange={(e) =>
              updateWorldPerformance((p) => {
                p.combineTreesWithGround = e.target.checked;
              })
            }
            className="accent-emerald-500"
          />
        </label>

        <label className="flex items-center justify-between gap-2 cursor-pointer text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <Layers className="h-3 w-3 text-amber-400 shrink-0" />
            Merge Static Props into Ground
          </span>
          <input
            type="checkbox"
            data-testid="perf-combine-props"
            checked={perf.combineStaticPropsWithGround}
            onChange={(e) =>
              updateWorldPerformance((p) => {
                p.combineStaticPropsWithGround = e.target.checked;
              })
            }
            className="accent-emerald-500"
          />
        </label>

        {perf.treeRenderMode === 'cross_card' && (
          <label className="flex items-center justify-between gap-2 cursor-pointer text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <Trees className="h-3 w-3 text-emerald-400 shrink-0" />
              Top-Down Canopy Card (Drone View)
            </span>
            <input
              type="checkbox"
              data-testid="perf-top-crown"
              checked={perf.crossCardTopCrown}
              onChange={(e) =>
                updateWorldPerformance((p) => {
                  p.crossCardTopCrown = e.target.checked;
                })
              }
              className="accent-emerald-500"
            />
          </label>
        )}

        <label className="flex items-center justify-between gap-2 cursor-pointer text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <SunDim className="h-3 w-3 text-slate-400 shrink-0" />
            Disable Scenery Shadows (+FPS)
          </span>
          <input
            type="checkbox"
            data-testid="perf-disable-shadows"
            checked={perf.disableSceneryShadows}
            onChange={(e) =>
              updateWorldPerformance((p) => {
                p.disableSceneryShadows = e.target.checked;
              })
            }
            className="accent-emerald-500"
          />
        </label>
      </div>

      {/* Tree Physics Collision Mode */}
      <label className="block space-y-1 pt-1 border-t border-[#1c2434]">
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
          <Shield className="h-3 w-3 text-slate-400" />
          Tree Physics Collision
        </span>
        <select
          aria-label="Tree physics collision mode"
          data-testid="perf-tree-collision"
          value={perf.treeCollision}
          onChange={(e) => {
            const val = e.target.value as 'trunk_only' | 'none' | 'full';
            updateWorldPerformance((p) => {
              p.treeCollision = val;
            });
          }}
          className="h-7 w-full rounded border border-[#2a3346] bg-[#10141d] px-2 text-[11px] text-slate-200 cursor-pointer"
        >
          <option value="trunk_only">Trunk Only (Fastest Realistic)</option>
          <option value="none">Visual Only — No Collision (Max FPS)</option>
          <option value="full">Full Trunk + Canopy</option>
        </select>
      </label>
    </div>
  );
}
