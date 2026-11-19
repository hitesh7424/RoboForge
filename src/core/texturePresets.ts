import type { TextureAsset } from '@/core/schema';

export type TexturePresetCategory = 'ground' | 'roads' | 'masonry' | 'nature';

export interface BuiltinTexturePreset {
  id: string;
  name: string;
  category: TexturePresetCategory;
  swatchHex: string;
  accentHex: string;
  defaultRepeat: [number, number];
  roughness: number;
  metalness: number;
  description: string;
}

export const BUILTIN_TEXTURE_PRESETS: readonly BuiltinTexturePreset[] = [
  {
    id: 'grass_lush',
    name: 'Lush Grass',
    category: 'nature',
    swatchHex: '#3f7d3a',
    accentHex: '#5ca34d',
    defaultRepeat: [8, 8],
    roughness: 0.92,
    metalness: 0,
    description: 'Layered meadow turf with organic blade variation',
  },
  {
    id: 'asphalt_road',
    name: 'Asphalt Road',
    category: 'roads',
    swatchHex: '#343942',
    accentHex: '#525a66',
    defaultRepeat: [6, 6],
    roughness: 0.88,
    metalness: 0.04,
    description: 'Fine dark aggregate tarmac for roads and test tracks',
  },
  {
    id: 'concrete_clean',
    name: 'Concrete Slabs',
    category: 'ground',
    swatchHex: '#9aa2ad',
    accentHex: '#7d8694',
    defaultRepeat: [6, 6],
    roughness: 0.85,
    metalness: 0.02,
    description: 'Architectural concrete panels with expansion seams',
  },
  {
    id: 'cobblestone',
    name: 'Cobblestone',
    category: 'masonry',
    swatchHex: '#767a82',
    accentHex: '#555961',
    defaultRepeat: [8, 8],
    roughness: 0.86,
    metalness: 0.04,
    description: 'Interlocking courtyard stone pavers with mortar joints',
  },
  {
    id: 'dirt_gravel',
    name: 'Dirt & Gravel',
    category: 'nature',
    swatchHex: '#7c6248',
    accentHex: '#9c8263',
    defaultRepeat: [8, 8],
    roughness: 0.96,
    metalness: 0,
    description: 'Compacted trail soil scattered with mineral pebbles',
  },
  {
    id: 'desert_sand',
    name: 'Desert Sand',
    category: 'nature',
    swatchHex: '#c8ab7b',
    accentHex: '#dfc598',
    defaultRepeat: [8, 8],
    roughness: 0.94,
    metalness: 0,
    description: 'Wind-rippled warm dune sand with fine grain',
  },
  {
    id: 'brick_pavers',
    name: 'Red Brick',
    category: 'masonry',
    swatchHex: '#9b4a3c',
    accentHex: '#b86350',
    defaultRepeat: [8, 8],
    roughness: 0.84,
    metalness: 0.02,
    description: 'Running-bond terracotta bricks for facades & walkways',
  },
  {
    id: 'wood_deck',
    name: 'Timber Planks',
    category: 'masonry',
    swatchHex: '#8d6342',
    accentHex: '#ad8059',
    defaultRepeat: [6, 6],
    roughness: 0.78,
    metalness: 0.02,
    description: 'Warm cedar decking boards with subtle grain lines',
  },
  {
    id: 'runway_tarmac',
    name: 'Road Markings',
    category: 'roads',
    swatchHex: '#2f343d',
    accentHex: '#e5b842',
    defaultRepeat: [4, 4],
    roughness: 0.86,
    metalness: 0.04,
    description: 'Dark road surface with dashed amber centerline stripe',
  },
  {
    id: 'quarry_stone',
    name: 'Slate Tile',
    category: 'masonry',
    swatchHex: '#4f5a66',
    accentHex: '#697785',
    defaultRepeat: [6, 6],
    roughness: 0.75,
    metalness: 0.08,
    description: 'Ashlar cut charcoal slate tiles for plazas and walls',
  },
  {
    id: 'water_pond',
    name: 'Calm Water',
    category: 'nature',
    swatchHex: '#2c6e8f',
    accentHex: '#4fa3c7',
    defaultRepeat: [5, 5],
    roughness: 0.18,
    metalness: 0.12,
    description: 'Stylized water surface with soft sunlit caustics',
  },
  {
    id: 'checker_studio',
    name: 'Calibration Grid',
    category: 'ground',
    swatchHex: '#334155',
    accentHex: '#475569',
    defaultRepeat: [10, 10],
    roughness: 0.72,
    metalness: 0.05,
    description: 'High-contrast metric reference tiles for robotics testing',
  },
] as const;

export function getTexturePresetById(id: string | undefined): BuiltinTexturePreset | undefined {
  if (!id) return undefined;
  return BUILTIN_TEXTURE_PRESETS.find((p) => p.id === id);
}

/** Deterministic PRNG (Mulberry32) so procedural textures are 100% reproducible. */
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const canvasCache = new Map<string, HTMLCanvasElement>();
const dataUrlCache = new Map<string, string>();

/** Draw a seamless tileable procedural texture onto a 2D canvas context. */
export function drawPresetToContext(
  ctx: CanvasRenderingContext2D,
  presetId: string,
  size: number,
): void {
  const rng = createSeededRng(hashString(presetId));

  const drawWrappedCircle = (x: number, y: number, r: number, fill: string) => {
    ctx.fillStyle = fill;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cx = x + ox * size;
        const cy = y + oy * size;
        if (cx + r >= 0 && cx - r <= size && cy + r >= 0 && cy - r <= size) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };

  const drawWrappedRect = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.fillStyle = fill;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const rx = x + ox * size;
        const ry = y + oy * size;
        if (rx + w >= 0 && rx <= size && ry + h >= 0 && ry <= size) {
          ctx.fillRect(rx, ry, w, h);
        }
      }
    }
  };

  switch (presetId) {
    case 'grass_lush': {
      ctx.fillStyle = '#3c7a37';
      ctx.fillRect(0, 0, size, size);
      // Soft organic turf patches
      for (let i = 0; i < 42; i++) {
        const shade = rng() > 0.5 ? 'rgba(98, 166, 74, 0.28)' : 'rgba(34, 82, 34, 0.28)';
        drawWrappedCircle(rng() * size, rng() * size, (0.06 + rng() * 0.1) * size, shade);
      }
      // Fine grass blades
      ctx.lineWidth = Math.max(1, size / 180);
      for (let i = 0; i < 420; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const len = (0.018 + rng() * 0.032) * size;
        const lean = (rng() - 0.5) * 0.02 * size;
        const green = Math.floor(110 + rng() * 68);
        const red = Math.floor(42 + rng() * 44);
        ctx.strokeStyle = `rgba(${red}, ${green}, 42, 0.55)`;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = y + oy * size;
          if (yy + len >= 0 && yy - len <= size) {
            ctx.beginPath();
            ctx.moveTo(x, yy);
            ctx.lineTo(x + lean, yy - len);
            ctx.stroke();
          }
        }
      }
      break;
    }

    case 'asphalt_road': {
      ctx.fillStyle = '#323740';
      ctx.fillRect(0, 0, size, size);
      // Subtle oil/tire wear bands
      for (let i = 0; i < 18; i++) {
        const shade = rng() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.08)';
        drawWrappedCircle(rng() * size, rng() * size, (0.08 + rng() * 0.12) * size, shade);
      }
      // Mineral aggregate speckles
      for (let i = 0; i < 1400; i++) {
        const v = Math.floor(38 + rng() * 72);
        const a = 0.25 + rng() * 0.45;
        const r = Math.max(1, (0.004 + rng() * 0.007) * size);
        ctx.fillStyle = `rgba(${v}, ${v + 2}, ${v + 5}, ${a})`;
        ctx.fillRect(rng() * size, rng() * size, r, r);
      }
      break;
    }

    case 'runway_tarmac': {
      drawPresetToContext(ctx, 'asphalt_road', size);
      // Edge shoulders
      ctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
      const edgeW = Math.max(2, size * 0.03);
      ctx.fillRect(size * 0.04, 0, edgeW, size);
      ctx.fillRect(size * 0.96 - edgeW, 0, edgeW, size);
      // Dashed amber center stripe
      ctx.fillStyle = 'rgba(234, 179, 8, 0.88)';
      const stripeW = Math.max(3, size * 0.045);
      ctx.fillRect((size - stripeW) / 2, size * 0.1, stripeW, size * 0.34);
      ctx.fillRect((size - stripeW) / 2, size * 0.6, stripeW, size * 0.34);
      break;
    }

    case 'concrete_clean': {
      ctx.fillStyle = '#9aa3ae';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 36; i++) {
        const shade = rng() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(55,65,81,0.08)';
        drawWrappedCircle(rng() * size, rng() * size, (0.07 + rng() * 0.12) * size, shade);
      }
      for (let i = 0; i < 700; i++) {
        const v = Math.floor(125 + rng() * 55);
        ctx.fillStyle = `rgba(${v}, ${v + 2}, ${v + 4}, 0.28)`;
        ctx.fillRect(rng() * size, rng() * size, 1.5, 1.5);
      }
      // 2x2 expansion joints
      ctx.strokeStyle = 'rgba(42, 50, 62, 0.55)';
      ctx.lineWidth = Math.max(1.5, size * 0.01);
      ctx.beginPath();
      ctx.moveTo(0, size * 0.5);
      ctx.lineTo(size, size * 0.5);
      ctx.moveTo(size * 0.5, 0);
      ctx.lineTo(size * 0.5, size);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      break;
    }

    case 'cobblestone': {
      ctx.fillStyle = '#474c54';
      ctx.fillRect(0, 0, size, size);
      const rows = 8;
      const cols = 6;
      const rowH = size / rows;
      const colW = size / cols;
      const gap = Math.max(1.5, size * 0.012);
      for (let r = 0; r < rows; r++) {
        const offset = (r % 2) * (colW * 0.5);
        for (let c = -1; c <= cols; c++) {
          const x = c * colW + offset + gap * 0.5;
          const y = r * rowH + gap * 0.5;
          const w = colW - gap;
          const h = rowH - gap;
          const base = Math.floor(105 + rng() * 44);
          const warm = Math.floor((rng() - 0.5) * 18);
          ctx.fillStyle = `rgb(${base + warm}, ${base + Math.floor(warm * 0.5)}, ${base - warm * 0.3})`;
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.22);
          ctx.fill();
          // Subtle top highlight
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(x + 2, y + 1.5, Math.max(1, w - 4), Math.max(1, h * 0.18));
        }
      }
      break;
    }

    case 'dirt_gravel': {
      ctx.fillStyle = '#796047';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 48; i++) {
        const shade = rng() > 0.5 ? 'rgba(156, 128, 96, 0.3)' : 'rgba(84, 62, 42, 0.32)';
        drawWrappedCircle(rng() * size, rng() * size, (0.05 + rng() * 0.1) * size, shade);
      }
      for (let i = 0; i < 650; i++) {
        const v = Math.floor(95 + rng() * 90);
        const r = (0.005 + rng() * 0.012) * size;
        const warm = Math.floor(rng() * 24);
        drawWrappedCircle(
          rng() * size,
          rng() * size,
          r,
          `rgba(${Math.min(255, v + warm)}, ${v}, ${Math.max(0, v - warm)}, 0.55)`,
        );
      }
      break;
    }

    case 'desert_sand': {
      ctx.fillStyle = '#c8aa7a';
      ctx.fillRect(0, 0, size, size);
      // Seamless horizontal wind ripples (period divides size cleanly)
      const bands = 6;
      for (let y = 0; y < size; y += 2) {
        const wave = Math.sin((y / size) * Math.PI * 2 * bands);
        ctx.fillStyle =
          wave > 0
            ? `rgba(245, 224, 182, ${wave * 0.14})`
            : `rgba(145, 112, 68, ${-wave * 0.14})`;
        ctx.fillRect(0, y, size, 2);
      }
      for (let i = 0; i < 900; i++) {
        const bright = rng() > 0.45 ? 'rgba(250, 236, 204, 0.35)' : 'rgba(130, 98, 58, 0.25)';
        ctx.fillStyle = bright;
        ctx.fillRect(rng() * size, rng() * size, 1.5, 1.5);
      }
      break;
    }

    case 'brick_pavers': {
      ctx.fillStyle = '#b7b1a6'; // mortar
      ctx.fillRect(0, 0, size, size);
      const rows = 8;
      const cols = 4;
      const rowH = size / rows;
      const colW = size / cols;
      const mortar = Math.max(1.5, size * 0.014);
      for (let r = 0; r < rows; r++) {
        const shift = (r % 2) * (colW * 0.5);
        for (let c = -1; c <= cols; c++) {
          const x = c * colW + shift + mortar * 0.5;
          const y = r * rowH + mortar * 0.5;
          const w = colW - mortar;
          const h = rowH - mortar;
          const rr = Math.floor(146 + rng() * 38);
          const gg = Math.floor(62 + rng() * 24);
          const bb = Math.floor(48 + rng() * 20);
          ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;
          ctx.fillRect(x, y, w, h);
          // Subtle baked variation
          ctx.fillStyle = 'rgba(0,0,0,0.08)';
          ctx.fillRect(x, y + h * 0.72, w, h * 0.28);
        }
      }
      break;
    }

    case 'wood_deck': {
      ctx.fillStyle = '#865d3d';
      ctx.fillRect(0, 0, size, size);
      const planks = 6;
      const plankH = size / planks;
      for (let p = 0; p < planks; p++) {
        const y = p * plankH;
        const delta = Math.floor((rng() - 0.5) * 26);
        ctx.fillStyle = `rgb(${140 + delta}, ${98 + Math.floor(delta * 0.7)}, ${64 + Math.floor(delta * 0.5)})`;
        ctx.fillRect(0, y + 1, size, plankH - 2);
        // Wood grain streaks
        for (let g = 0; g < 14; g++) {
          const gy = y + 2 + rng() * (plankH - 4);
          ctx.fillStyle = rng() > 0.5 ? 'rgba(58, 34, 18, 0.16)' : 'rgba(218, 178, 132, 0.12)';
          ctx.fillRect(0, gy, size, Math.max(1, plankH * 0.05));
        }
        // Plank seam
        ctx.fillStyle = 'rgba(34, 20, 10, 0.65)';
        ctx.fillRect(0, y, size, Math.max(1.5, size * 0.008));
        // End butt joint
        const jointX = ((p * 0.37 + 0.18) % 1) * size;
        ctx.fillRect(jointX, y, Math.max(1.5, size * 0.008), plankH);
      }
      break;
    }

    case 'quarry_stone': {
      ctx.fillStyle = '#323a44';
      ctx.fillRect(0, 0, size, size);
      const cells = 4;
      const cellS = size / cells;
      const seam = Math.max(1.5, size * 0.012);
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          const v = Math.floor(72 + rng() * 34);
          ctx.fillStyle = `rgb(${v}, ${v + 8}, ${v + 16})`;
          ctx.fillRect(c * cellS + seam * 0.5, r * cellS + seam * 0.5, cellS - seam, cellS - seam);
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          ctx.fillRect(
            c * cellS + seam,
            r * cellS + seam,
            cellS - seam * 2,
            Math.max(2, cellS * 0.12),
          );
        }
      }
      for (let i = 0; i < 350; i++) {
        drawWrappedRect(rng() * size, rng() * size, 2, 2, 'rgba(255,255,255,0.05)');
      }
      break;
    }

    case 'water_pond': {
      ctx.fillStyle = '#256484';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 30; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const r = (0.08 + rng() * 0.12) * size;
        drawWrappedCircle(x, y, r, 'rgba(84, 174, 209, 0.18)');
      }
      // Subtle caustic wave arcs
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.28)';
      ctx.lineWidth = Math.max(1.2, size * 0.009);
      for (let i = 0; i < 22; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const w = (0.1 + rng() * 0.16) * size;
        ctx.beginPath();
        ctx.moveTo(x - w / 2, y);
        ctx.quadraticCurveTo(x, y - size * 0.025, x + w / 2, y);
        ctx.stroke();
      }
      break;
    }

    case 'checker_studio':
    default: {
      const cells = 4;
      const s = size / cells;
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#2b3648' : '#3b4a62';
          ctx.fillRect(c * s, r * s, s, s);
        }
      }
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= cells; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s, 0);
        ctx.lineTo(i * s, size);
        ctx.moveTo(0, i * s);
        ctx.lineTo(size, i * s);
        ctx.stroke();
      }
      break;
    }
  }
}

/**
 * Returns a cached procedural tile HTMLCanvasElement for a built-in preset.
 * Browser-only (returns null in SSR/Node).
 */
export function getPresetCanvas(presetId: string, size = 256): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = `${presetId}:${size}`;
  const cached = canvasCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  drawPresetToContext(ctx, presetId, size);
  canvasCache.set(key, canvas);
  return canvas;
}

/** Returns a cached data URL thumbnail (PNG) for UI swatches. */
export function getPresetPreviewDataUrl(presetId: string, size = 96): string {
  const key = `${presetId}:${size}`;
  const cached = dataUrlCache.get(key);
  if (cached) return cached;

  const canvas = getPresetCanvas(presetId, size);
  if (!canvas) return '';
  try {
    const url = canvas.toDataURL('image/png');
    dataUrlCache.set(key, url);
    return url;
  } catch {
    return '';
  }
}

/**
 * Materializes a built-in preset into a TextureAsset so it can be attached to any
 * 3D WorldObject or exported cleanly in Gazebo SDF packages.
 */
export function materializePresetAsTextureAsset(
  presetId: string,
  size = 256,
): TextureAsset | null {
  const preset = getTexturePresetById(presetId);
  const canvas = getPresetCanvas(presetId, size);
  if (!preset || !canvas) return null;
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const comma = dataUrl.indexOf(',');
    const dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const approxBytes = Math.floor((dataBase64.length * 3) / 4);
    return {
      id: `preset_${preset.id}`,
      name: `preset_${preset.id}`,
      format: 'png',
      mimeType: 'image/png',
      dataBase64,
      byteLength: approxBytes,
    };
  } catch {
    return null;
  }
}
