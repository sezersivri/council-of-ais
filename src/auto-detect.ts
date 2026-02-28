import { MultiAiConfig } from './types.js';
import { detectBestModel, MODEL_PRIORITY } from './model-detector.js';

export interface AutoDetectResult {
  participantId: string;
  previousModel: string | undefined;
  detectedModel: string | null;
}

type DetectFn = (id: string, cliPath: string) => Promise<string | null>;

/**
 * Probe each built-in participant's CLI in parallel and select the best
 * available model. Mutates `config.participants[].model` in place when
 * detection succeeds.
 */
export async function autoDetectModels(
  config: MultiAiConfig,
  detectFn: DetectFn = detectBestModel,
): Promise<AutoDetectResult[]> {
  const builtinIds = Object.keys(MODEL_PRIORITY);
  const targets = config.participants.filter(
    (p) => p.enabled && !p.type && builtinIds.includes(p.id),
  );
  if (targets.length === 0) return [];

  return Promise.all(
    targets.map(async (p) => {
      const detected = await detectFn(p.id, p.cliPath || p.id);
      const result: AutoDetectResult = {
        participantId: p.id,
        previousModel: p.model,
        detectedModel: detected,
      };
      if (detected) p.model = detected;
      return result;
    }),
  );
}
