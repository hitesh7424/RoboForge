import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { computeElevationStats, downloadMapTilesTextureBase64 } from '@/core/mapTiles';
import {
  createFallbackMapPng,
  encodeGrayscalePng,
  resampleDemToGazeboPixels,
} from '@/core/pngEncode';
import type { Project } from '@/core/schema';
import { generateBridgeYaml } from '@/exporters/bridge';
import { generateDisplayLaunchPy, generateSimLaunchPy } from '@/exporters/launch';
import { generateMujocoXml } from '@/exporters/mjcf';
import {
  generateCMakeLists,
  generatePackageReadme,
  generatePackageXml,
  generateRvizConfig,
  generateValidateMd,
} from '@/exporters/packageFiles';
import { generateRobotSdf } from '@/exporters/sdf';
import { getTargetConfig, type TargetConfig } from '@/exporters/targets';
import { generateGazeboXacro, generateResolvedUrdf, generateRobotXacro } from '@/exporters/urdf';
import { generateWorldSdf } from '@/exporters/world';

export type PackageFileMap = Record<string, string | Uint8Array>;

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function exportRos2Package(project: Project, overrideTarget?: TargetConfig): PackageFileMap {
  const target = overrideTarget ?? getTargetConfig(project.target);
  const robotName = project.robot.name;
  const worldName = project.world.name;

  const files: PackageFileMap = {
    'package.xml': generatePackageXml(project, target),
    'CMakeLists.txt': generateCMakeLists(project),
    [`urdf/${robotName}.urdf.xacro`]: generateRobotXacro(project, target),
    [`urdf/${robotName}_gazebo.xacro`]: generateGazeboXacro(project, target),
    [`sdf/${robotName}.sdf`]: generateRobotSdf(project, target),
    [`worlds/${worldName}.sdf`]: generateWorldSdf(project, target),
    [`mujoco/${robotName}.xml`]: generateMujocoXml(project, {
      includeWorldObjects: true,
      embedMeshPathsPrefix: '../meshes/',
    }),
    'launch/sim.launch.py': generateSimLaunchPy(project, target),
    'launch/display.launch.py': generateDisplayLaunchPy(project, target),
    'config/bridge.yaml': generateBridgeYaml(project, target),
    'config/robot.rviz': generateRvizConfig(project),
    'scripts/validate.md': generateValidateMd(project, target),
    'README.md': generatePackageReadme(project, target),
  };

  if (project.assets.length === 0) {
    files['meshes/.gitkeep'] = '';
  } else {
    for (const asset of project.assets) {
      files[`meshes/${asset.name}.${asset.format}`] = base64ToUint8Array(asset.dataBase64);
    }
  }

  const textures = project.textures ?? [];
  const mapBg = project.world.mapBackground;
  const elevStats = computeElevationStats(mapBg);
  let hasGeneratedTextures = false;

  if (project.world.ground.enabled && mapBg?.enabled) {
    // 1. Always export the georeferenced map tile ground texture (<world>_map.png)
    const mapPngBytes = mapBg.mapTextureBase64
      ? base64ToUint8Array(mapBg.mapTextureBase64)
      : createFallbackMapPng(128, 128);
    files[`materials/textures/${worldName}_map.png`] = mapPngBytes;
    hasGeneratedTextures = true;

    // 2. Always export a Gazebo-compliant (2^k + 1 = 65x65) grayscale DEM heightmap (<world>_dem.png)
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

  if (textures.length === 0 && !hasGeneratedTextures) {
    files['materials/textures/.gitkeep'] = '';
  } else {
    for (const tex of textures) {
      files[`materials/textures/${tex.name}.${tex.format}`] = base64ToUint8Array(tex.dataBase64);
    }
  }

  return files;
}

export async function downloadRos2PackageZip(
  project: Project,
  onMapTextureCaptured?: (base64: string) => void,
): Promise<string[]> {
  let projectToExport = project;
  const mapBg = project.world.mapBackground;

  if (project.world.ground.enabled && mapBg?.enabled && !mapBg.mapTextureBase64) {
    const captured = await downloadMapTilesTextureBase64(mapBg, 512);
    if (captured?.base64) {
      onMapTextureCaptured?.(captured.base64);
      projectToExport = {
        ...project,
        world: {
          ...project.world,
          mapBackground: {
            ...mapBg,
            mapTextureBase64: captured.base64,
          },
        },
      };
    }
  }

  const files = exportRos2Package(projectToExport);
  const zip = new JSZip();
  const rootFolder = zip.folder(projectToExport.name);
  if (!rootFolder) {
    throw new Error('Failed to create zip package folder.');
  }

  const paths = Object.keys(files);
  for (const [path, content] of Object.entries(files)) {
    rootFolder.file(path, content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${projectToExport.name}.zip`);
  return paths;
}

export { generateResolvedUrdf };
