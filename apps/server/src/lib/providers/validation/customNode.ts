import { joinBaseUrlAndPath } from '@styxrouter/open-sse/services/claudeCodeCompatible.ts';
import { validationRead, toValidationErrorResult } from './transport';

// A credential check is a read-only models probe, never an inference fallback.
export async function validateCustomNodeApiKey(node: Record<string, any>, apiKey: string) {
  if (!['openai-compatible', 'anthropic-compatible'].includes(node.type)) {
    return { valid: false, error: 'Provider validation not supported', unsupported: true };
  }
  try {
    const headers = new Headers(node.customHeaders || {});
    headers.set('accept', 'application/json');
    if (node.type === 'anthropic-compatible') {
      headers.set('x-api-key', apiKey);
      if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
    } else {
      headers.set('authorization', `Bearer ${apiKey}`);
    }
    const response = await validationRead(joinBaseUrlAndPath(node.baseUrl || '', node.modelsPath || '/models'), { method: 'GET', headers });
    if (response.ok) {
      const data = await response.json().catch(() => null);
      if (data && Array.isArray(data.data)) return { valid: true, error: null, method: 'models_endpoint' };
      return { valid: false, error: 'Models endpoint did not return a model list; credential validation is inconclusive', unsupported: true };
    }
    if (response.status === 401 || response.status === 403) return { valid: false, error: `Models endpoint refused credential validation (HTTP ${response.status})`, unsupported: false };
    return { valid: false, error: `Models endpoint unavailable (HTTP ${response.status}); credential validation is inconclusive`, unsupported: true };
  } catch (error) { return toValidationErrorResult(error); }
}
