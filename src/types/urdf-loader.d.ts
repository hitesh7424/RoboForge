declare module 'urdf-loader' {
  import type * as THREE from 'three';

  export class URDFJoint extends THREE.Object3D {
    jointType: string;
    axis: THREE.Vector3;
    limit: { lower: number; upper: number };
    jointValue: number;
    setJointValue(value: number): boolean;
  }

  export class URDFLink extends THREE.Object3D {
    urdfName: string;
  }

  export class URDFRobot extends THREE.Object3D {
    robotName: string;
    links: Record<string, URDFLink>;
    joints: Record<string, URDFJoint>;
    setJointValue(jointName: string, value: number): boolean;
  }

  export default class URDFLoader {
    packages: string | Record<string, string> | ((pkg: string) => string);
    workingPath: string;
    parseVisual: boolean;
    parseCollision: boolean;
    loadMeshCb:
      | ((
          path: string,
          manager: THREE.LoadingManager,
          onComplete: (obj: THREE.Object3D | null, err?: Error) => void,
        ) => void)
      | null;
    constructor(manager?: THREE.LoadingManager);
    parse(content: string | Document): URDFRobot;
  }
}
