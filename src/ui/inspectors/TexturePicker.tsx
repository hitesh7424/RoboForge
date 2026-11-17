import { useRef } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';
import { createId } from '@/core/defaults';
import type { TextureAsset } from '@/core/schema';
import { sanitizeUniqueName, useRoboForgeStore } from '@/core/store';
import { Button } from '@/ui/components/button';
import { NumericField } from '@/ui/inspectors/NumericField';

export interface TexturePickerProps {
  idPrefix: string;
  textureId?: string;
  textureRepeat?: [number, number];
  onChangeTexture: (textureId: string | undefined) => void;
  onChangeRepeat: (repeat: [number, number]) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result ?? '');
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

export function TexturePicker({
  idPrefix,
  textureId,
  textureRepeat = [1, 1],
  onChangeTexture,
  onChangeRepeat,
}: TexturePickerProps) {
  const textures = useRoboForgeStore((s) => s.project.textures);
  const units = useRoboForgeStore((s) => s.units);
  const addTexture = useRoboForgeStore((s) => s.addTexture);
  const deleteTexture = useRoboForgeStore((s) => s.deleteTexture);
  const addLog = useRoboForgeStore((s) => s.addLog);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTex = textureId ? textures.find((t) => t.id === textureId) : undefined;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const extMatch = file.name.toLowerCase().match(/\.(png|jpe?g|webp)$/);
    const mime = file.type.toLowerCase();
    let format: TextureAsset['format'] = 'png';
    if (extMatch?.[1] === 'jpg' || extMatch?.[1] === 'jpeg' || mime === 'image/jpeg') {
      format = 'jpg';
    } else if (extMatch?.[1] === 'webp' || mime === 'image/webp') {
      format = 'webp';
    }

    try {
      const dataBase64 = await fileToBase64(file);
      const rawBase = file.name.replace(/\.[^.]+$/, '');
      const existing = new Set(textures.map((t) => t.name));
      const name = sanitizeUniqueName(rawBase || 'texture', existing);

      const asset: TextureAsset = {
        id: createId(),
        name,
        format,
        mimeType: format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png',
        dataBase64,
        byteLength: file.size,
      };
      addTexture(asset);
      onChangeTexture(asset.id);
    } catch (err) {
      addLog('error', err instanceof Error ? err.message : 'Failed to import image texture.');
    }
  };

  return (
    <div className="space-y-2 rounded border border-[#222938] bg-[#0d1118] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-300">Custom Texture (PNG/JPEG)</span>
        <div className="flex items-center gap-1">
          {selectedTex && (
            <button
              type="button"
              onClick={() => onChangeTexture(undefined)}
              title="Clear assigned texture"
              className="inline-flex h-6 items-center gap-1 rounded border border-[#2a3346] bg-[#141a26] px-1.5 text-[10px] text-slate-300 hover:bg-[#1e2636] cursor-pointer"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            className="h-6 px-2 text-[11px]"
          >
            <ImagePlus className="h-3 w-3" />
            Import Image
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          aria-label={`Import texture for ${idPrefix}`}
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {textures.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select
            aria-label={`Select texture for ${idPrefix}`}
            value={textureId ?? ''}
            onChange={(e) => onChangeTexture(e.target.value || undefined)}
            className="h-7 flex-1 rounded border border-[#2a3346] bg-[#0b0e14] px-2 font-mono text-[11px] text-slate-200"
          >
            <option value="">None (solid color)</option>
            {textures.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}.{t.format}
              </option>
            ))}
          </select>
          {selectedTex && (
            <button
              type="button"
              onClick={() => deleteTexture(selectedTex.id)}
              title={`Delete texture ${selectedTex.name}.${selectedTex.format}`}
              aria-label={`Delete texture ${selectedTex.name}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#2a3346] bg-[#141a26] text-slate-400 hover:text-red-400 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {selectedTex && (
        <div className="flex items-center gap-2 pt-0.5">
          <img
            src={`data:${selectedTex.mimeType};base64,${selectedTex.dataBase64}`}
            alt={selectedTex.name}
            className="h-9 w-9 rounded border border-[#2a3346] object-cover shrink-0 bg-[#070a0f]"
          />
          <div className="grid flex-1 grid-cols-2 gap-1.5">
            <NumericField
              id={`${idPrefix}-tex-u`}
              label="Repeat U"
              value={textureRepeat[0]}
              unitMode="raw"
              unitSystem={units}
              step={0.5}
              min={0.1}
              onCommit={(u) => onChangeRepeat([u, textureRepeat[1]])}
            />
            <NumericField
              id={`${idPrefix}-tex-v`}
              label="Repeat V"
              value={textureRepeat[1]}
              unitMode="raw"
              unitSystem={units}
              step={0.5}
              min={0.1}
              onCommit={(v) => onChangeRepeat([textureRepeat[0], v])}
            />
          </div>
        </div>
      )}
    </div>
  );
}
