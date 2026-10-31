import { expect, test } from 'bun:test';
import { int, usd, when } from '../src/lib/format.ts';
test('formatters honor selected locale without changing currency units', () => {
  expect(int(1234567,'id-ID')).toBe('1.234.567');
  expect(int(1234567,'en-US')).toBe('1,234,567');
  expect(usd(12.5,'id-ID')).toContain('12,50');
  expect(when('2026-10-26T12:30:00Z','id-ID')).toContain('26/10/2026');
});

test('when formats timestamps in the user local timezone with short timezone name instead of hardcoded UTC', () => {
  const jakarta = when('2026-10-31T05:26:00Z', 'id-ID', 'Asia/Jakarta');
  expect(jakarta).toContain('31/10/2026');
  expect(jakarta).toMatch(/12[.:]26[.:]00/);
  expect(jakarta).toMatch(/WIB|GMT\+7/);

  const tokyo = when('2026-10-31T05:26:00Z', 'en-US', 'Asia/Tokyo');
  expect(tokyo).toContain('10/31/2026');
  expect(tokyo).toContain('14:26:00');
  expect(tokyo).toMatch(/JST|GMT\+9/);
});
