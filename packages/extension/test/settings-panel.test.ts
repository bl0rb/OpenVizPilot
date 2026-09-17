import { describe, expect, it } from 'vitest';
import { isSettingsDirty } from '../src/ui/SettingsPanel';
import type { ExtensionSettings } from '../src/settings';

const saved: ExtensionSettings = {
  backendUrl: 'https://backend.example',
  model: 'gpt',
  apiToken: 'tok',
  dashboardContext: 'Kontext',
};

// UI-Review P1-3: nur bei tatsächlich ungespeicherten Eingaben soll "Zurück
// zum Chat" eine Verwerfen-/Weiterbearbeiten-Entscheidung zeigen.
describe('isSettingsDirty', () => {
  it('is not dirty when the form matches the saved settings exactly', () => {
    expect(isSettingsDirty({ ...saved }, saved)).toBe(false);
  });

  it('ignores surrounding whitespace (matches how save() trims values)', () => {
    expect(isSettingsDirty({ ...saved, backendUrl: `${saved.backendUrl}  ` }, saved)).toBe(false);
  });

  it('is dirty when any tracked field changed', () => {
    expect(isSettingsDirty({ ...saved, model: 'claude' }, saved)).toBe(true);
    expect(isSettingsDirty({ ...saved, apiToken: 'other' }, saved)).toBe(true);
    expect(isSettingsDirty({ ...saved, dashboardContext: 'Neu' }, saved)).toBe(true);
    expect(isSettingsDirty({ ...saved, backendUrl: 'https://other.example' }, saved)).toBe(true);
  });
});
