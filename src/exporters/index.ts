import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  computeElevationStats,
  DEFAULT_MAP_BACKGROUND,
  getMapLandSize,
  type MapExportQuality,
} from '@/core/mapTiles';
import {
  createFallbackMapPng,
  encodeGrayscalePng,
  resampleDemToGazeboPixels,
} from '@/core/pngEncode';
import type { Project } from '@/core/schema';
import { generateTerrainObj, shouldUseTerrainMesh } from '@/core/terrainMesh';
import {
  hasCustomCosmeticGround,
  renderHighResExportMapPngBase64,
} from '@/core/worldTextureCompositor';
import { generateBridgeYaml } from '@/exporters/bridge';
import {
  generateDisplayLaunchPy,
  generateSimLaunchPy,
  generateSpawnRobotLaunchPy,
  generateWorldOnlyLaunchPy,
} from '@/exporters/launch';
import { generateMujocoXml } from '@/exporters/mjcf';
import {
  generateCMakeLists,
  generatePackageReadme,
  generatePackageXml,
  generateRvizConfig,
  generateValidateMd,
  resolveExportPackageName,
  type ExportScope,
} from '@/exporters/packageFiles';
import { generateRobotSdf } from '@/exporters/sdf';
import { getTargetConfig, type TargetConfig } from '@/exporters/targets';
import { generateGazeboXacro, generateResolvedUrdf, generateRobotXacro } from '@/exporters/urdf';
import { generateWorldSdf } from '@/exporters/world';

export type { ExportScope };
export type PackageFileMap = Record<string, string | Uint8Array>;

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function collectUsedRobotTextureIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const link of project.robot.links) {
    if (link.visual.material.textureId) ids.add(link.visual.material.textureId);
  }
  return ids;
}

function collectUsedWorldTextureIds(project: Project): Set<string> {
  const ids = new Set<string>();
  if (project.world.ground.textureId) ids.add(project.world.ground.textureId);
  for (const obj of project.world.objects) {
    if (obj.source.type === 'primitive' && obj.source.material.textureId) {
      ids.add(obj.source.material.textureId);
    }
  }
  for (const z of project.world.surfaceZones ?? []) {
    if (z.textureSource === 'custom' && z.textureId) ids.add(z.textureId);
  }
  return ids;
}

export function exportRos2Package(
  project: Project,
  overrideTarget?: TargetConfig,
  scope: ExportScope = 'full',
): PackageFileMap {
  const target = overrideTarget ?? getTargetConfig(project.target);
  const pkgName = resolveExportPackageName(project.name, scope);
  const scopedProject: Project =
    pkgName === project.name ? project : { ...project, name: pkgName };

  const robotName = scopedProject.robot.name;
  const worldName = scopedProject.world.name;

  const includeRobot = scope === 'full' || scope === 'robot';
  const includeWorld = scope === 'full' || scope === 'world';

  const files: PackageFileMap = {
    'package.xml': generatePackageXml(project, target, scope),
    'CMakeLists.txt': generateCMakeLists(project, scope),
    'scripts/validate.md': generateValidateMd(project, target, scope),
    'README.md': generatePackageReadme(project, target, scope),
  };

  if (includeRobot) {
    files[`urdf/${robotName}.urdf.xacro`] = generateRobotXacro(scopedProject, target);
    files[`urdf/${robotName}_gazebo.xacro`] = generateGazeboXacro(scopedProject, target);
    files[`sdf/${robotName}.sdf`] = generateRobotSdf(scopedProject, target);
    files[`mujoco/${robotName}.xml`] = generateMujocoXml(scopedProject, {
      includeWorldObjects: includeWorld,
      embedMeshPathsPrefix: '../meshes/',
    });
    files['launch/display.launch.py'] = generateDisplayLaunchPy(scopedProject, target, pkgName);
    files['config/bridge.yaml'] = generateBridgeYaml(scopedProject, target);
    files['config/robot.rviz'] = generateRvizConfig(scopedProject);
  }

  if (includeWorld) {
    files[`worlds/${worldName}.sdf`] = generateWorldSdf(scopedProject, target);
  }

  if (scope === 'full') {
    files['launch/sim.launch.py'] = generateSimLaunchPy(scopedProject, target);
  } else if (scope === 'robot') {
    files['launch/spawn_robot.launch.py'] = generateSpawnRobotLaunchPy(
      scopedProject,
      target,
      pkgName,
    );
  } else if (scope === 'world') {
    files['launch/world.launch.py'] = generateWorldOnlyLaunchPy(scopedProject, target, pkgName);
  }

  const textures = scopedProject.textures ?? [];
  const mapBg = scopedProject.world.mapBackground;
  const elevStats = computeElevationStats(mapBg);
  const useTerrainMesh =
    includeWorld && scopedProject.world.ground.enabled && shouldUseTerrainMesh(mapBg);

  let hasMeshes = false;
  let hasTextures = false;

  if (useTerrainMesh) {
    const landDims = getMapLandSize(mapBg, scopedProject.world.ground.size);
    files[`meshes/${worldName}_terrain.obj`] = generateTerrainObj(
      landDims.width,
      mapBg,
      undefined,
      landDims.height,
    );
    hasMeshes = true;
  }

  if (includeRobot) {
    for (const asset of scopedProject.assets) {
      files[`meshes/${asset.name}.${asset.format}`] = base64ToUint8Array(asset.dataBase64);
      hasMeshes = true;
    }
  }

  if (!hasMeshes) {
    files['meshes/.gitkeep'] = '';
  }

  if (includeWorld) {
    const hasCosmeticMap = Boolean(
      (scopedProject.world.surfaceZones ?? []).some((z) => z.visible) ||
        scopedProject.world.cosmetics?.groundBasePresetId,
    );
    if (scopedProject.world.ground.enabled && (mapBg?.enabled || hasCosmeticMap)) {
      const mapPngBytes = mapBg?.mapTextureBase64
        ? base64ToUint8Array(mapBg.mapTextureBase64)
        : createFallbackMapPng(128, 128);
      files[`materials/textures/${worldName}_map.png`] = mapPngBytes;
      hasTextures = true;

      if (mapBg?.enabled) {
        const demPixels = resampleDemToGazeboPixels(
          mapBg.elevationGrid,
          mapBg.elevationGridSize ?? 2,
          mapBg.elevationScale ?? 1,
          elevStats.minZ,
          elevStats.rangeZ,
          65,
        );
        files[`materials/textures/${worldName}_dem.png`] = encodeGrayscalePng(65, 65, demPixels);
      }
    }
  }

  const allowedTexIds =
    scope === 'full'
      ? null
      : scope === 'robot'
        ? collectUsedRobotTextureIds(scopedProject)
        : collectUsedWorldTextureIds(scopedProject);

  for (const tex of textures) {
    if (allowedTexIds && !allowedTexIds.has(tex.id)) continue;
    files[`materials/textures/${tex.name}.${tex.format}`] = base64ToUint8Array(tex.dataBase64);
    hasTextures = true;
  }

  if (!hasTextures) {
    files['materials/textures/.gitkeep'] = '';
  }

  return files;
}

export async function downloadRos2PackageZip(
  project: Project,
  onMapTextureCaptured?: (base64: string) => void,
  scope: ExportScope = 'full',
  mapQuality: MapExportQuality = 'original',
): Promise<{
  paths: string[];
  zipFilename: string;
  packageName: string;
  mapTextureDimensions?: { widthPx: number; heightPx: number };
}> {
  let projectToExport = project;
  const mapBg = project.world.mapBackground;
  const includeWorld = scope === 'full' || scope === 'world';
  let mapTextureDimensions: { widthPx: number; heightPx: number } | undefined;

  const needsBakedMapPng =
    includeWorld &&
    project.world.ground.enabled &&
    (Boolean(mapBg?.enabled) || hasCustomCosmeticGround(project.world));

  if (needsBakedMapPng) {
    const rendered = await renderHighResExportMapPngBase64(
      project.world,
      project.textures,
      mapQuality,
    );
    if (rendered?.base64) {
      mapTextureDimensions = { widthPx: rendered.widthPx, heightPx: rendered.heightPx };
      // Avoid overflowing localStorage quota with giant 4K PNGs; only update preview cache if small or empty
      if (!mapBg?.mapTextureBase64 && rendered.base64.length < 450_000) {
        onMapTextureCaptured?.(rendered.base64);
      }
      projectToExport = {
        ...project,
        world: {
          ...project.world,
          mapBackground: {
            ...(mapBg ?? { ...DEFAULT_MAP_BACKGROUND, enabled: false }),
            mapTextureBase64: rendered.base64,
          },
        },
      };
    }
  }

  const packageName = resolveExportPackageName(projectToExport.name, scope);
  const files = exportRos2Package(projectToExport, undefined, scope);
  const zip = new JSZip();
  const rootFolder = zip.folder(packageName);
  if (!rootFolder) {
    throw new Error('Failed to create zip package folder.');
  }

  const paths = Object.keys(files);
  for (const [path, content] of Object.entries(files)) {
    rootFolder.file(path, content);
  }

  const zipFilename = `${packageName}.zip`;
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, zipFilename);
  return { paths, zipFilename, packageName, mapTextureDimensions };
}

export { generateResolvedUrdf, resolveExportPackageName };
