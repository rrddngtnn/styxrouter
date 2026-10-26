import { expect, test } from 'bun:test';
import { int, usd, when } from '../src/lib/format.ts';
test('formatters honor selected locale without changing currency units', () => {
  expect(int(1234567,'id-ID')).toBe('1.234.567');
  expect(int(1234567,'en-US')).toBe('1,234,567');
  expect(usd(12.5,'id-ID')).toContain('12,50');
  expect(when('2026-10-26T12:30:00Z','id-ID')).toContain('26/10/2026');
});
