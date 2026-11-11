import { expect, test } from 'bun:test';
import { normalizePreferences, resolveAppearance, translate, localeFor } from '../src/lib/preferences-core.ts';
test('preferences validate persisted values and follow system appearance', () => {
  expect(normalizePreferences({language:'id', theme:'system'})).toEqual({density:'comfortable',language:'id',theme:'system',providerView:'cards'});
  expect(normalizePreferences({language:'bogus',theme:'pink'})).toEqual({density:'comfortable',language:'en',theme:'system',providerView:'cards'});
  expect(resolveAppearance('system',true)).toBe('dark');
  expect(resolveAppearance('light',true)).toBe('light');
});
test('provider layout preference defaults to cards and rejects unknown values', () => {
  expect(normalizePreferences({providerView:'rows'}).providerView).toBe('rows');
  expect(normalizePreferences({providerView:'cards'}).providerView).toBe('cards');
  expect(normalizePreferences({providerView:'tiles'}).providerView).toBe('cards');
  expect(normalizePreferences({providerView:42}).providerView).toBe('cards');
  expect(normalizePreferences(null).providerView).toBe('cards');
  expect(normalizePreferences({language:'id',theme:'dark',providerView:'rows'})).toEqual({density:'comfortable',language:'id',theme:'dark',providerView:'rows'});
});
test('translation and locale preserve unknown phrases and API identifiers', () => {
  expect(translate('id','Settings')).toBe('Pengaturan');
  expect(translate('en','Settings')).toBe('Settings');
  expect(translate('id','codex/gpt-model')).toBe('codex/gpt-model');
  expect(localeFor('id')).toBe('id-ID');
});
