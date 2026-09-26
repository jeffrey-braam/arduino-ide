// Autosave and settings in localStorage. Every access is guarded: storage can be disabled by policy.
const KEY_SKETCH = "arduino-ide.sketch";
const KEY_SETTINGS = "arduino-ide.settings";

function read(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadSketch = () => read(KEY_SKETCH);
export const saveSketch = (sketch) => write(KEY_SKETCH, sketch);

export function loadSettings(defaults) {
  return { ...defaults, ...(read(KEY_SETTINGS) || {}) };
}
export const saveSettings = (settings) => write(KEY_SETTINGS, settings);
