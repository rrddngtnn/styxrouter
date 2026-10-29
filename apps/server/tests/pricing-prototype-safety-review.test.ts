import { expect, test } from 'bun:test';
import { getPricingWithSources, updatePricing, resetPricing } from '../src/lib/db/settings/pricing';

test('pricing CRUD and source attribution preserve special provider and model identifiers', async () => {
  const initial = JSON.parse('{"__proto__":{"__proto__":{"input":2,"output":0},"constructor":{"input":3,"output":0}},"constructor":{"toString":{"input":4,"output":0}}}');
  const updated = await updatePricing(initial);
  expect(updated['__proto__']['__proto__'].input).toBe(2);
  expect(updated.constructor.toString.input).toBe(4);
  await updatePricing(JSON.parse('{"__proto__":{"ordinary":{"input":5,"output":0}},"constructor":{"__proto__":{"input":6,"output":0}}}'));
  const result = await getPricingWithSources();
  expect(result.pricing['__proto__'].ordinary.input).toBe(5);
  expect(result.pricing.constructor['__proto__'].input).toBe(6);
  expect(result.pricing['__proto__']['__proto__'].input).toBe(2);
  expect(result.sourceMap['__proto__']['__proto__']).toBe('user');
  expect(result.sourceMap.constructor.toString).toBe('user');
  const after = await resetPricing('__proto__', '__proto__');
  expect(Object.hasOwn(after, '__proto__')).toBe(true);
  expect(Object.hasOwn(after['__proto__'] as object, '__proto__')).toBe(false);
  expect((after['__proto__'] as any).constructor.input).toBe(3);
});
