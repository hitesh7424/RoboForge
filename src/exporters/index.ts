import JSZip from 'jszip';
import { saveAs } from 'file-saver';
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

  return files;
}

export async function downloadRos2PackageZip(project: Project): Promise<string[]> {
  const files = exportRos2Package(project);
  const zip = new JSZip();
  const rootFolder = zip.folder(project.name);
  if (!rootFolder) {
    throw new Error('Failed to create zip package folder.');
  }

  const paths = Object.keys(files);
  for (const [path, content] of Object.entries(files)) {
    rootFolder.file(path, content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${project.name}.zip`);
  return paths;
}

export { generateResolvedUrdf };
