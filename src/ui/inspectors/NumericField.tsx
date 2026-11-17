import { useEffect, useRef, useState } from 'react';
import { isValidRosName, type Pose } from '@/core/schema';
import {
  getUnitConversion,
  toDisplayValue,
  toInternalSi,
  type NumericUnitMode,
  type UnitPreferences,
} from '@/core/units';
import { Input } from '@/ui/components/input';

export interface NumericFieldProps {
  id: string;
  label: string;
  value: number;
  unitMode: NumericUnitMode;
  unitSystem: UnitPreferences;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (internalValue: number) => void;
}

export function NumericField({
  id,
  label,
  value,
  unitMode,
  unitSystem,
  step = 0.01,
  min,
  max,
  onCommit,
}: NumericFieldProps) {
  const conv = getUnitConversion(unitMode, unitSystem, step);

  const formatDisplay = (v: number) => {
    const converted = toDisplayValue(v, unitMode, unitSystem);
    if (Math.abs(converted) < 1e-10) return '0';
    return Number(converted.toFixed(5)).toString();
  };

  const [draft, setDraft] = useState(() => formatDisplay(value));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(formatDisplay(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, unitMode, unitSystem]);

  const handleLiveChange = (raw: string) => {
    setDraft(raw);
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;

    const internal = toInternalSi(parsed, unitMode, unitSystem);
    if (min !== undefined && internal < min) return;
    if (max !== undefined && internal > max) return;

    if (Math.abs(internal - value) > 1e-9) {
      onCommit(internal);
    }
  };

  const commitFinal = () => {
    isFocusedRef.current = false;
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (!trimmed || !Number.isFinite(parsed)) {
      setDraft(formatDisplay(value));
      return;
    }
    let internal = toInternalSi(parsed, unitMode, unitSystem);
    if (min !== undefined && internal < min) internal = min;
    if (max !== undefined && internal > max) internal = max;
    if (Math.abs(internal - value) > 1e-9) {
      onCommit(internal);
    }
    setDraft(formatDisplay(internal));
  };

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-center justify-between text-[11px] text-slate-400">
        <span>{label}</span>
        {conv.label && <span className="font-mono text-[10px] text-slate-500">{conv.label}</span>}
      </label>
      <Input
        id={id}
        type="number"
        step={conv.suggestedStep}
        value={draft}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onChange={(e) => handleLiveChange(e.target.value)}
        onBlur={commitFinal}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            isFocusedRef.current = false;
            setDraft(formatDisplay(value));
            e.currentTarget.blur();
          }
        }}
        className="font-mono tabular-nums"
      />
    </div>
  );
}

export function RosNameField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  onCommit: (nextName: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(value);
    }
  }, [value]);

  const valid = isValidRosName(draft);

  const handleLiveChange = (raw: string) => {
    setDraft(raw);
    const trimmed = raw.trim();
    if (isValidRosName(trimmed) && trimmed !== value) {
      onCommit(trimmed);
    }
  };

  const commitFinal = () => {
    isFocusedRef.current = false;
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(value);
      return;
    }
    if (trimmed !== value) {
      onCommit(trimmed);
    }
  };

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[11px] font-medium text-slate-400">
        {label}
      </label>
      <Input
        id={id}
        value={draft}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onChange={(e) => handleLiveChange(e.target.value)}
        onBlur={commitFinal}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            isFocusedRef.current = false;
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
        className={`font-mono ${valid ? '' : 'border-red-500 focus-visible:ring-red-500'}`}
      />
      {!valid && (
        <p className="text-[11px] text-red-400">Must match ROS identifier ^[a-z][a-z0-9_]*$</p>
      )}
    </div>
  );
}

export function PoseFields({
  idPrefix,
  pose,
  units,
  onChangeAxis,
}: {
  idPrefix: string;
  pose: Pose;
  units: UnitPreferences;
  onChangeAxis: (group: 'xyz' | 'rpy', index: 0 | 1 | 2, val: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
          <NumericField
            key={axis}
            id={`${idPrefix}-xyz-${axis}`}
            label={axis}
            value={pose.xyz[idx as 0 | 1 | 2]}
            unitMode="length"
            unitSystem={units}
            onCommit={(val) => onChangeAxis('xyz', idx as 0 | 1 | 2, val)}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['Roll', 'Pitch', 'Yaw'] as const).map((axis, idx) => (
          <NumericField
            key={axis}
            id={`${idPrefix}-rpy-${axis}`}
            label={axis}
            value={pose.rpy[idx as 0 | 1 | 2]}
            unitMode="angle"
            unitSystem={units}
            onCommit={(val) => onChangeAxis('rpy', idx as 0 | 1 | 2, val)}
          />
        ))}
      </div>
    </div>
  );
}
