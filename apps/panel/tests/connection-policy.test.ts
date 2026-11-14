import { expect, test } from 'bun:test';
import { legacyPolicyLocation, policyTab } from '../src/lib/connection-policy.ts';
import { navigation } from '../src/components/shell/navigation.ts';
import { breadcrumbs } from '../src/components/shell/breadcrumbs.ts';

test('legacy network/proxy/error aliases canonicalize without losing unrelated context', () => {
  for (const [old, next] of [['network','proxies'],['proxy','proxies'],['proxies','proxies'],['error','error-rules'],['errors','error-rules'],['error-rules','error-rules']]) {
    expect(legacyPolicyLocation(`?tab=${old}&provider=fixture`, '#binding')).toEqual({pathname:'/connection-policy', search:`?tab=${next}&provider=fixture`, hash:'#binding'});
  }
  for (const tab of ['oauth','apikey','custom','unknown']) expect(legacyPolicyLocation(`?tab=${tab}`, '')).toBeNull();
  expect(policyTab('garbage')).toBe('proxies');
  expect(policyTab('error-rules')).toBe('error-rules');
});
test('Gateway inserts policy without relocating existing client API keys', () => {
  expect(navigation.find(n=>n.to==='/connection-policy')?.group).toBe('Gateway');
  expect(navigation.find(n=>n.to==='/keys')?.group).toBe('Gateway');
  expect(breadcrumbs('/connection-policy')[0]?.label).toBe('Connection Policy');
});
