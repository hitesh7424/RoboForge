import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIT_PREFERENCES,
  formatInertiaSummary,
  getUnitConversion,
  summarizeUnitPreferences,
  toDisplayValue,
  toInternalSi,
  type UnitPreferences,
} from '@/core/units';

describe('Granular Unit Preferences & SI Conversions', () => {
  it('round-trips independent length, angle, mass, inertia, time, and velocity conversions', () => {
    const prefs: UnitPreferences = {
      length: 'mm',
      angle: 'deg',
      mass: 'g',
      inertia: 'g_cm2',
      time: 'ms',
    };

    expect(toDisplayValue(0.45, 'length', prefs)).toBeCloseTo(450, 6);
    expect(toInternalSi(450, 'length', prefs)).toBeCloseTo(0.45, 8);

    expect(toDisplayValue(Math.PI / 2, 'angle', prefs)).toBeCloseTo(90, 6);
    expect(toInternalSi(90, 'angle', prefs)).toBeCloseTo(Math.PI / 2, 8);

    expect(toDisplayValue(2.5, 'mass', prefs)).toBeCloseTo(2500, 6);
    expect(toInternalSi(2500, 'mass', prefs)).toBeCloseTo(2.5, 8);

    // 1 kg*m^2 = 1e7 g*cm^2
    expect(toDisplayValue(0.002, 'inertia', prefs)).toBeCloseTo(20000, 4);
    expect(toInternalSi(20000, 'inertia', prefs)).toBeCloseTo(0.002, 8);

    expect(toDisplayValue(0.005, 'time', prefs)).toBeCloseTo(5, 6);
    expect(toInternalSi(5, 'time', prefs)).toBeCloseTo(0.005, 8);

    expect(toDisplayValue(1.2, 'lin_vel', prefs)).toBeCloseTo(1200, 6);
    expect(toDisplayValue(Math.PI, 'ang_vel', prefs)).toBeCloseTo(180, 6);
  });

  it('supports imperial units independently from angle/time', () => {
    const imperial: UnitPreferences = {
      ...DEFAULT_UNIT_PREFERENCES,
      length: 'in',
      mass: 'lb',
    };

    expect(toDisplayValue(0.0254, 'length', imperial)).toBeCloseTo(1, 6);
    expect(toInternalSi(10, 'length', imperial)).toBeCloseTo(0.254, 6);

    expect(toDisplayValue(0.45359237, 'mass', imperial)).toBeCloseTo(1, 6);
    expect(toInternalSi(10, 'mass', imperial)).toBeCloseTo(4.5359237, 6);

    expect(getUnitConversion('lin_vel', imperial).label).toBe('in/s');
    expect(getUnitConversion('ang_vel', imperial).label).toBe('rad/s');
  });

  it('formats inertia and summarizes preferences cleanly', () => {
    const cad: UnitPreferences = {
      length: 'cm',
      angle: 'deg',
      mass: 'g',
      inertia: 'g_cm2',
      time: 'ms',
    };
    expect(formatInertiaSummary(0.001, cad, 0)).toBe('10000 g·cm²');
    expect(summarizeUnitPreferences(cad)).toBe('cm · deg · g');
  });
});
