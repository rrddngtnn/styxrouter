import { expect, test } from 'bun:test';
import { getResolvedModelCapabilities, resolveInputTokenCapForGate, getManualCatalogContextOverride } from '../src/lib/modelCapabilities.ts';
import { setModelContextOverride, removeModelContextOverride } from '../src/lib/db/modelContextOverrides.ts';
import { createModelCapabilityResolutionSnapshot } from '../src/lib/modelCapabilityResolutionSnapshot.ts';
import { setModelCapabilityOverride, removeModelCapabilityOverride } from '../src/lib/db/modelCapabilityOverrides.ts';

test('registered Codex literal tiers retain their own registry context and input cap', () => {
  setModelContextOverride('codex', 'gpt-5.5', 123456, 'manual');
  try {
    for (const snapshot of [undefined, createModelCapabilityResolutionSnapshot()]) {
      const caps = getResolvedModelCapabilities({provider:'codex',model:'gpt-5.5-high'}, undefined, snapshot);
      expect(getManualCatalogContextOverride({provider:'codex',model:'gpt-5.5-high'}, snapshot)).toBeNull();
      expect(caps.contextWindow).toBe(400000);
      expect(caps.maxInputTokens).toBe(272000);
    }
    expect(resolveInputTokenCapForGate('codex/gpt-5.5-high', {isCombo:true})).toBe(272000);
  } finally { removeModelContextOverride('codex', 'gpt-5.5'); }
});

test('Codex context aliases do not inherit input-only capability overrides', () => {
  setModelContextOverride('codex', 'gpt-6.1-terra', 200000, 'auto:discovery');
  setModelCapabilityOverride('codex/gpt-6.1-terra', 'max_input_tokens', 123456);
  try {
    expect(resolveInputTokenCapForGate('codex/gpt-6.1-terra')).toBe(123456);
    expect(resolveInputTokenCapForGate('codex/gpt-6.1-terra-high')).toBeNull();
    expect(resolveInputTokenCapForGate('codex/gpt-6.1-terra-high', {isCombo:true})).toBe(200000);
    setModelCapabilityOverride('codex/gpt-6.1-terra-high', 'max_input_tokens', 750000);
    for (const snapshot of [undefined, createModelCapabilityResolutionSnapshot()]) {
      expect(getResolvedModelCapabilities({provider:'codex',model:'gpt-6.1-terra-high'}, undefined, snapshot).maxInputTokens).toBe(750000);
    }
    expect(resolveInputTokenCapForGate('codex/gpt-6.1-terra-high', {isCombo:true})).toBe(750000);
  } finally {
    removeModelContextOverride('codex', 'gpt-6.1-terra');
    removeModelCapabilityOverride('codex/gpt-6.1-terra', 'max_input_tokens');
    removeModelCapabilityOverride('codex/gpt-6.1-terra-high', 'max_input_tokens');
  }
});

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
