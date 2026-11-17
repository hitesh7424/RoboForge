import type { Plugin, Primitive, Sensor, WorldObjectSource } from '@/core/schema';

export type LibraryDragPayload =
  | { kind: 'link_primitive'; shape: Primitive; defaultName: string }
  | { kind: 'sensor'; sensorKind: Sensor['kind'] }
  | { kind: 'plugin'; pluginKind: Plugin['kind'] }
  | {
      kind: 'world_object';
      name: string;
      source: WorldObjectSource;
      isStatic: boolean;
      mass?: number;
      defaultZ?: number;
    }
  | { kind: 'custom_part'; customPartId: string };

export const ROBOFORGE_DRAG_MIME = 'application/x-roboforge-item';
