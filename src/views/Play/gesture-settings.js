export const GESTURE_HOLD_RATES = Object.freeze([2, 2.5, 3]);
export const DEFAULT_GESTURE_SETTINGS = Object.freeze({enabled: true, holdRate: 2});

export function normalizeGestureSettings(value) {
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : DEFAULT_GESTURE_SETTINGS.enabled,
    holdRate: GESTURE_HOLD_RATES.includes(value?.holdRate) ? value.holdRate : DEFAULT_GESTURE_SETTINGS.holdRate,
  };
}
