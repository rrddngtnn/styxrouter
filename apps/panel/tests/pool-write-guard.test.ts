import { expect, test } from 'bun:test';
import { beginPoolWrite, poolWriteBlocked, settlePoolWrite } from '../src/lib/pool-write-guard.ts';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('unconfirmed pool write survives a recreated reader and rejects another attempt', () => {
  const store = storage();
  expect(poolWriteBlocked(store)).toBe(false);
  expect(beginPoolWrite(store, 'attempt-a')).toBe(true);
  expect(poolWriteBlocked(store)).toBe(true);
  expect(beginPoolWrite(store, 'attempt-b')).toBe(false);
  expect(settlePoolWrite(store, 'attempt-b')).toBe(false);
  expect(poolWriteBlocked(store)).toBe(true);
  expect(settlePoolWrite(store, 'attempt-a')).toBe(true);
  expect(poolWriteBlocked(store)).toBe(false);
});
test('storage denial and dropped persistence fail closed before dispatch', () => {
  const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
  expect(poolWriteBlocked(denied)).toBe(true);
  expect(beginPoolWrite(denied, 'attempt')).toBe(false);
  expect(beginPoolWrite({ getItem: () => null, setItem: () => {}, removeItem: () => {} }, 'attempt')).toBe(false);
  expect(poolWriteBlocked(null)).toBe(true);
});
test('malformed existing fence is never overwritten or unlocked by a new attempt', () => {
  const store = storage();
  expect(beginPoolWrite(store, 'old')).toBe(true);
  expect(settlePoolWrite(store, 'new')).toBe(false);
  expect(beginPoolWrite(store, 'new')).toBe(false);
});
