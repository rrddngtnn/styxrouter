import { expect, test } from 'bun:test';
import { normalizePreferences, resolveAppearance, translate, localeFor } from '../src/lib/preferences-core.ts';
test('preferences validate persisted values and follow system appearance', () => {
  expect(normalizePreferences({language:'id', theme:'system'})).toEqual({language:'id',theme:'system'});
  expect(normalizePreferences({language:'bogus',theme:'pink'})).toEqual({language:'en',theme:'system'});
  expect(resolveAppearance('system',true)).toBe('dark');
  expect(resolveAppearance('light',true)).toBe('light');
});
test('translation and locale preserve unknown phrases and API identifiers', () => {
  expect(translate('id','Settings')).toBe('Pengaturan');
  expect(translate('en','Settings')).toBe('Settings');
  expect(translate('id','codex/gpt-model')).toBe('codex/gpt-model');
  expect(localeFor('id')).toBe('id-ID');
});
