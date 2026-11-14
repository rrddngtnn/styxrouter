export type PolicyTab = 'proxies' | 'error-rules';
export function policyTab(value: string | null): PolicyTab {
  return value === 'error-rules' ? 'error-rules' : 'proxies';
}
export function legacyPolicyLocation(search: string, hash: string) {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  if (!tab || !['network', 'proxy', 'proxies', 'error', 'errors', 'error-rules'].includes(tab)) return null;
  params.set('tab', ['error', 'errors', 'error-rules'].includes(tab) ? 'error-rules' : 'proxies');
  return { pathname: '/connection-policy', search: `?${params}`, hash };
}
