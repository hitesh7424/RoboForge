import type { TargetDistro } from '@/core/schema';
import { HUMBLE_TARGET } from '@/exporters/targets/humble';
import { JAZZY_TARGET } from '@/exporters/targets/jazzy';
import { LYRICAL_TARGET } from '@/exporters/targets/lyrical';
import type { TargetConfig } from '@/exporters/targets/types';

export type { TargetConfig, GazeboPluginSpec } from '@/exporters/targets/types';

export const TARGET_CONFIGS: Record<TargetDistro, TargetConfig> = {
  'jazzy-harmonic': JAZZY_TARGET,
  'humble-fortress': HUMBLE_TARGET,
  'lyrical-jetty': LYRICAL_TARGET,
};

export function getTargetConfig(target: TargetDistro): TargetConfig {
  return TARGET_CONFIGS[target] ?? JAZZY_TARGET;
}
