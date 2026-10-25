// Account-scoped preferences; transient playback state is never persisted here.
import {GESTURE_HOLD_RATES} from './gesture-settings.js';
import {QUALITY_PREFERENCES, validSubtitleLanguage} from './media-preferences.js';
import {EXTERNAL_PLAYER_IDS} from './external-player.js';
export const PLAYER_PREFERENCE_DEFAULTS = Object.freeze({
  audioLanguage: '', autoPlayNext: true, assSubtitles: true,
  subtitleFontSize: 20, playbackRate: 1, use302: false,
  gesturesEnabled: true, gestureHoldRate: 2,
  subtitleLanguage: '', qualityPreference: 'highest', externalPlayer: '',
});

const validators = {
  audioLanguage: value => typeof value === 'string' && value.length <= 64 && !/[\u0000-\u001f\u007f]/.test(value),
  autoPlayNext: value => typeof value === 'boolean',
  assSubtitles: value => typeof value === 'boolean',
  subtitleFontSize: value => Number.isInteger(value) && value >= 12 && value <= 60,
  playbackRate: value => typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 3,
  use302: value => typeof value === 'boolean',
  gesturesEnabled: value => typeof value === 'boolean',
  gestureHoldRate: value => GESTURE_HOLD_RATES.includes(value),
  subtitleLanguage: validSubtitleLanguage,
  qualityPreference: value => QUALITY_PREFERENCES.some(item => item.value === value),
  externalPlayer: value => value === '' || EXTERNAL_PLAYER_IDS.includes(value),
};

function validateName(name) {
  if (!Object.hasOwn(PLAYER_PREFERENCE_DEFAULTS, name)) throw new TypeError('Unknown player preference');
}

// Every account transition invalidates old handles, including A -> B -> A.
// Storage is obtained lazily: even reading window.localStorage can throw.
export function createPlayerPreferenceStore(getStorage = () => window.localStorage) {
  let generation = 0;
  return {
    bindAccount(account) {
      const current = ++generation;
      const owner = typeof account === 'string' && account.trim() ? account : null;
      const overrides = new Map();
      const active = () => owner !== null && current === generation;
      const key = name => `fnosPlayer:${owner}:${name}`;
      const read = name => {
        validateName(name);
        if (!active()) return PLAYER_PREFERENCE_DEFAULTS[name];
        if (overrides.has(name)) return overrides.get(name);
        try {
          const value = JSON.parse(getStorage().getItem(key(name)));
          if (validators[name](value)) return value;
        } catch { /* Missing, invalid, or unavailable storage uses a typed default. */ }
        return PLAYER_PREFERENCE_DEFAULTS[name];
      };
      return Object.freeze({
        isCurrent: active,
        read,
        write(name, value) {
          validateName(name);
          if (!active() || !validators[name](value)) return {accepted: false, persisted: false};
          overrides.set(name, value);
          try {
            getStorage().setItem(key(name), JSON.stringify(value));
            return {accepted: true, persisted: true};
          } catch { return {accepted: true, persisted: false}; }
        },
        reset() {
          if (!active()) return {accepted: false, persisted: false};
          let persisted = true;
          // An interrupted reset reports failure; it never clears the whole origin.
          for (const name of Object.keys(PLAYER_PREFERENCE_DEFAULTS)) {
            overrides.set(name, PLAYER_PREFERENCE_DEFAULTS[name]);
            try { getStorage().removeItem(key(name)); } catch { persisted = false; }
          }
          return {accepted: true, persisted};
        },
      });
    },
    clearAccount() { generation++; },
  };
}
