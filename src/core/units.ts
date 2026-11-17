export type LengthUnit = 'm' | 'cm' | 'mm' | 'in';
export type AngleUnit = 'rad' | 'deg';
export type MassUnit = 'kg' | 'g' | 'lb';
export type InertiaUnit = 'kg_m2' | 'g_cm2';
export type TimeUnit = 's' | 'ms';

export interface UnitPreferences {
  length: LengthUnit;
  angle: AngleUnit;
  mass: MassUnit;
  inertia: InertiaUnit;
  time: TimeUnit;
}

export type NumericUnitMode =
  | 'length'
  | 'angle'
  | 'mass'
  | 'inertia'
  | 'lin_vel'
  | 'ang_vel'
  | 'time'
  | 'raw';

export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  length: 'm',
  angle: 'rad',
  mass: 'kg',
  inertia: 'kg_m2',
  time: 's',
};

const LENGTH_FACTORS: Record<LengthUnit, number> = {
  m: 1,
  cm: 100,
  mm: 1000,
  in: 1 / 0.0254,
};

const ANGLE_FACTORS: Record<AngleUnit, number> = {
  rad: 1,
  deg: 180 / Math.PI,
};

const MASS_FACTORS: Record<MassUnit, number> = {
  kg: 1,
  g: 1000,
  lb: 1 / 0.45359237,
};

const INERTIA_FACTORS: Record<InertiaUnit, number> = {
  kg_m2: 1,
  g_cm2: 1e7, // 1 kg*m^2 = 1000 g * (100 cm)^2 = 10^7 g*cm^2
};

const TIME_FACTORS: Record<TimeUnit, number> = {
  s: 1,
  ms: 1000,
};

const INERTIA_LABELS: Record<InertiaUnit, string> = {
  kg_m2: 'kg·m²',
  g_cm2: 'g·cm²',
};

export interface UnitConversion {
  factor: number;
  label: string;
  suggestedStep: number;
}

export function getUnitConversion(
  mode: NumericUnitMode,
  prefs: UnitPreferences,
  baseStep = 0.01,
): UnitConversion {
  switch (mode) {
    case 'length': {
      const factor = LENGTH_FACTORS[prefs.length];
      const suggestedStep =
        prefs.length === 'mm'
          ? 1
          : prefs.length === 'cm'
            ? 0.5
            : prefs.length === 'in'
              ? 0.1
              : baseStep;
      return { factor, label: prefs.length, suggestedStep };
    }
    case 'angle': {
      const factor = ANGLE_FACTORS[prefs.angle];
      return {
        factor,
        label: prefs.angle,
        suggestedStep: prefs.angle === 'deg' ? 1 : baseStep,
      };
    }
    case 'mass': {
      const factor = MASS_FACTORS[prefs.mass];
      return {
        factor,
        label: prefs.mass,
        suggestedStep: prefs.mass === 'g' ? 10 : prefs.mass === 'lb' ? 0.1 : baseStep,
      };
    }
    case 'inertia': {
      const factor = INERTIA_FACTORS[prefs.inertia];
      return {
        factor,
        label: INERTIA_LABELS[prefs.inertia],
        suggestedStep: prefs.inertia === 'g_cm2' ? 100 : baseStep,
      };
    }
    case 'lin_vel': {
      const factor = LENGTH_FACTORS[prefs.length];
      return {
        factor,
        label: `${prefs.length}/s`,
        suggestedStep: prefs.length === 'mm' ? 10 : baseStep,
      };
    }
    case 'ang_vel': {
      const factor = ANGLE_FACTORS[prefs.angle];
      return {
        factor,
        label: `${prefs.angle}/s`,
        suggestedStep: prefs.angle === 'deg' ? 5 : baseStep,
      };
    }
    case 'time': {
      const factor = TIME_FACTORS[prefs.time];
      return {
        factor,
        label: prefs.time,
        suggestedStep: prefs.time === 'ms' ? 0.5 : baseStep,
      };
    }
    case 'raw':
    default:
      return { factor: 1, label: '', suggestedStep: baseStep };
  }
}

export function toDisplayValue(internalSi: number, mode: NumericUnitMode, prefs: UnitPreferences): number {
  return internalSi * getUnitConversion(mode, prefs).factor;
}

export function toInternalSi(displayValue: number, mode: NumericUnitMode, prefs: UnitPreferences): number {
  return displayValue / getUnitConversion(mode, prefs).factor;
}

export function formatLengthSummary(meters: number, prefs: UnitPreferences, decimals = 2): string {
  const { factor, label } = getUnitConversion('length', prefs);
  return `${Number((meters * factor).toFixed(decimals))} ${label}`;
}

export function formatAngleSummary(radians: number, prefs: UnitPreferences, decimals = 2): string {
  const { factor, label } = getUnitConversion('angle', prefs);
  return `${Number((radians * factor).toFixed(decimals))} ${label}`;
}

export function formatMassSummary(kg: number, prefs: UnitPreferences, decimals = 2): string {
  const { factor, label } = getUnitConversion('mass', prefs);
  return `${Number((kg * factor).toFixed(decimals))} ${label}`;
}

export function formatInertiaSummary(
  kgM2: number,
  prefs: UnitPreferences,
  decimals = prefs.inertia === 'g_cm2' ? 1 : 5,
): string {
  const { factor, label } = getUnitConversion('inertia', prefs);
  const val = kgM2 * factor;
  return `${val.toFixed(decimals)} ${label}`;
}

export function summarizeUnitPreferences(prefs: UnitPreferences): string {
  return `${prefs.length} · ${prefs.angle} · ${prefs.mass}`;
}

const UI_UNITS_STORAGE_KEY = 'roboforge:unit-preferences:v1';

export function loadSavedUnitPreferences(): UnitPreferences {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_UNIT_PREFERENCES;
  }
  try {
    const raw = window.localStorage.getItem(UI_UNITS_STORAGE_KEY);
    if (!raw) return DEFAULT_UNIT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UnitPreferences>;
    return {
      length: parsed.length && parsed.length in LENGTH_FACTORS ? parsed.length : 'm',
      angle: parsed.angle && parsed.angle in ANGLE_FACTORS ? parsed.angle : 'rad',
      mass: parsed.mass && parsed.mass in MASS_FACTORS ? parsed.mass : 'kg',
      inertia: parsed.inertia && parsed.inertia in INERTIA_FACTORS ? parsed.inertia : 'kg_m2',
      time: parsed.time && parsed.time in TIME_FACTORS ? parsed.time : 's',
    };
  } catch {
    return DEFAULT_UNIT_PREFERENCES;
  }
}

export function saveUnitPreferences(prefs: UnitPreferences): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(UI_UNITS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage quota errors
  }
}
