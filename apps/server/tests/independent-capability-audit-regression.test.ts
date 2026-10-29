import { expect, test } from 'bun:test';
import { getResolvedModelCapabilities, resolveInputTokenCapForGate, getManualCatalogContextOverride } from '../src/lib/modelCapabilities.ts';
import { setModelContextOverride, removeModelContextOverride } from '../src/lib/db/modelContextOverrides.ts';
import { createModelCapabilityResolutionSnapshot } from '../src/lib/modelCapabilityResolutionSnapshot.ts';

test('manual base wins over auto alias for real Codex alias', () => {
  setModelContextOverride('codex', 'gpt-6.1-terra', 350000, 'manual');
  setModelContextOverride('codex', 'gpt-6.1-terra-high', 200000, 'auto:discovery');
  try {
    for (const snapshot of [undefined, createModelCapabilityResolutionSnapshot()]) {
      expect(getManualCatalogContextOverride({provider:'codex',model:'gpt-6.1-terra-high'}, snapshot)).toBe(350000);
      expect(getResolvedModelCapabilities({provider:'codex',model:'gpt-6.1-terra-high'}, undefined, snapshot).contextWindow).toBe(350000);
    }
  } finally { removeModelContextOverride('codex','gpt-6.1-terra'); removeModelContextOverride('codex','gpt-6.1-terra-high'); }
});

test('unrelated literal effort-suffixed IDs do not inherit base context', () => {
  setModelContextOverride('openai', 'audit-independent-model', 123456, 'manual');
  try {
    for (const snapshot of [undefined, createModelCapabilityResolutionSnapshot()]) {
      expect(getResolvedModelCapabilities({provider:'openai',model:'audit-independent-model-high'}, undefined, snapshot).contextWindow).toBe(1000000);
    }
  } finally { removeModelContextOverride('openai','audit-independent-model'); }
});

test('combo gate is consistent between Codex base and effort alias', () => {
  setModelContextOverride('codex','gpt-6.1-terra',200000,'auto:discovery');
  try {
    expect(resolveInputTokenCapForGate('codex/gpt-6.1-terra', {isCombo:true})).toBe(200000);
    expect(resolveInputTokenCapForGate('codex/gpt-6.1-terra-high', {isCombo:true})).toBe(200000);
  } finally { removeModelContextOverride('codex','gpt-6.1-terra'); }
});
