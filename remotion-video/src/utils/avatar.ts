/**
 * Utilities para avatar y expresiones
 */

import { AvatarConfig, SceneBeat } from '../types/video-plan';

/**
 * Mapear beat/scene a expresión de avatar
 */
export function getExpressionFromBeat(beat?: SceneBeat): string {
  if (!beat) return 'speaking';

  const expression = beat.avatarExpression || 'speaking';
  return expression;
}

/**
 * Mapear tipo de escena a expresión sugerida
 */
export function getSuggestedExpressionForSceneType(
  sceneType: string
): string {
  const map: Record<string, string> = {
    hook: 'surprised',
    claim: 'speaking',
    revelation: 'thinking',
    cta: 'excited',
    transition: 'neutral',
    explanation: 'speaking',
    micro_value: 'excited',
    escalation: 'serious',
  };

  return map[sceneType] || 'speaking';
}

/**
 * Generar timeline de expresiones desde beats
 */
export function generateExpressionTimeline(
  scenes: SceneBeat[]
): Array<{ start: number; end: number; expression: string }> {
  return scenes.map((scene) => ({
    start: scene.start,
    end: scene.end,
    expression: getExpressionFromBeat(scene),
  }));
}

/**
 * Obtener expresión actual en un frame dado
 */
export function getCurrentExpression(
  frame: number,
  fps: number,
  timeline: Array<{ start: number; end: number; expression: string }>
): string {
  const currentTime = frame / fps;

  const currentScene = timeline.find(
    (t) => currentTime >= t.start && currentTime < t.end
  );

  return currentScene?.expression || 'speaking';
}

/**
 * Validar asset paths del avatar
 */
export function validateAvatarAssetPaths(config: AvatarConfig): {
  valid: boolean;
  missingExpressions: string[];
} {
  if (!config.enabled) {
    return { valid: true, missingExpressions: [] };
  }

  const requiredExpressions = [
    'neutral',
    'speaking',
    'emphasis',
    'surprised',
    'serious',
  ];

  const missing = requiredExpressions.filter(
    (expr) =>
      !config.assetPaths ||
      !config.assetPaths[expr as keyof typeof config.assetPaths]
  );

  return {
    valid: missing.length === 0,
    missingExpressions: missing,
  };
}
