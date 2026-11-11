import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
const root=new URL('../src/',import.meta.url);
for(const [file,resource] of [['pages/ProviderModels.tsx','Provider models'],['pages/ProviderImport.tsx','Import support'],['components/ModelPicker.tsx','Model catalog'],['components/settings/HealthAndVersionsSettings.tsx','Outbound proxies'],['components/settings/RoutingPoliciesPanel.tsx','AI defaults'],['pages/Settings.tsx','Database backups']])test(`${file} labels nested reader ${resource}`,()=>expect(readFileSync(new URL(file,root),'utf8')).toContain(`resource="${resource}"`));
