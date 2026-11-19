import { createId } from '@/core/defaults';
import type { Primitive, TextureAsset } from '@/core/schema';
import { sanitizeUniqueName } from '@/core/store';

export type StudioViewMode = 'split' | '2d' | '3d';

export type StudioTool =
  | 'select'
  | 'zone_rect'
  | 'zone_poly'
  | 'zone_circle'
  | 'zone_path'
  | 'tree'
  | 'building'
  | 'wall'
  | 'prop'
  | 'spawn';

export interface ActiveBrushMaterial {
  textureSource: 'preset' | 'custom' | 'solid';
  presetId: string;
  textureId?: string;
  tintHex: string;
  repeat: [number, number];
  opacity: number;
  strokeWidth: number;
  circleRadius: number;
  feather: number;
}

export interface PropPresetItem {
  id: string;
  label: string;
  description: string;
  shape: Primitive;
  defaultColorHex: string;
  defaultPresetId?: string;
  static: boolean;
  mass: number;
}

export const COSMETIC_PROP_PRESETS: readonly PropPresetItem[] = [
  {
    id: 'wooden_crate',
    label: 'Timber Crate',
    description: '1.2m storage box',
    shape: { kind: 'box', size: [1.2, 1.2, 1.2] },
    defaultColorHex: '#c9a074',
    defaultPresetId: 'wood_deck',
    static: false,
    mass: 18,
  },
  {
    id: 'concrete_barrier',
    label: 'Road Barrier',
    description: '3m concrete divider',
    shape: { kind: 'box', size: [3.0, 0.55, 0.9] },
    defaultColorHex: '#cbd5e1',
    defaultPresetId: 'concrete_clean',
    static: true,
    mass: 120,
  },
  {
    id: 'stone_pillar',
    label: 'Stone Pillar',
    description: '3.6m cylindrical column',
    shape: { kind: 'cylinder', radius: 0.42, length: 3.6 },
    defaultColorHex: '#d1d5db',
    defaultPresetId: 'cobblestone',
    static: true,
    mass: 200,
  },
  {
    id: 'boulder_rock',
    label: 'Landscape Boulder',
    description: 'Decorative rock outcrop',
    shape: { kind: 'sphere', radius: 1.1 },
    defaultColorHex: '#9ca3af',
    defaultPresetId: 'quarry_stone',
    static: true,
    mass: 250,
  },
  {
    id: 'street_bollard',
    label: 'Safety Bollard',
    description: '1.1m perimeter post',
    shape: { kind: 'cylinder', radius: 0.14, length: 1.1 },
    defaultColorHex: '#f59e0b',
    static: true,
    mass: 25,
  },
  {
    id: 'brick_kiosk',
    label: 'Brick Pavilion',
    description: '4m × 3m shelter block',
    shape: { kind: 'box', size: [4.0, 3.0, 2.8] },
    defaultColorHex: '#d6a496',
    defaultPresetId: 'brick_pavers',
    static: true,
    mass: 400,
  },
  {
    id: 'deck_platform',
    label: 'Deck Platform',
    description: '5m × 4m raised stage',
    shape: { kind: 'box', size: [5.0, 4.0, 0.45] },
    defaultColorHex: '#d4b08a',
    defaultPresetId: 'wood_deck',
    static: true,
    mass: 200,
  },
];

export function hexToRgba(
  hex: string,
  alpha = 1,
): [number, number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return [1, 1, 1, alpha];
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [
    Number.isFinite(r) ? r : 1,
    Number.isFinite(g) ? g : 1,
    Number.isFinite(b) ? b : 1,
    alpha,
  ];
}

export function rgbaToHex(rgba: [number, number, number, number]): string {
  const r = Math.round(Math.max(0, Math.min(1, rgba[0])) * 255)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(Math.max(0, Math.min(1, rgba[1])) * 255)
    .toString(16)
    .padStart(2, '0');
  const b = Math.round(Math.max(0, Math.min(1, rgba[2])) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function readFileAsTextureAsset(
  file: File,
  existingTextures: TextureAsset[],
): Promise<TextureAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result ?? '');
      const comma = res.indexOf(',');
      const dataBase64 = comma >= 0 ? res.slice(comma + 1) : res;
      const extMatch = file.name.toLowerCase().match(/\.(png|jpe?g|webp)$/);
      const mime = file.type.toLowerCase();
      let format: TextureAsset['format'] = 'png';
      if (extMatch?.[1] === 'jpg' || extMatch?.[1] === 'jpeg' || mime === 'image/jpeg') {
        format = 'jpg';
      } else if (extMatch?.[1] === 'webp' || mime === 'image/webp') {
        format = 'webp';
      }
      const rawBase = file.name.replace(/\.[^.]+$/, '');
      const existing = new Set(existingTextures.map((t) => t.name));
      const name = sanitizeUniqueName(rawBase || 'custom_tex', existing);
      resolve({
        id: createId(),
        name,
        format,
        mimeType:
          format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png',
        dataBase64,
        byteLength: file.size,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}
