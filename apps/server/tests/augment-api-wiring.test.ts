import './helpers/test-secrets';
import {test,expect} from 'bun:test';
import {REGISTRY} from '../open-sse/config/providers/index.ts';
import {getExecutor} from '../open-sse/executors/index.ts';
import {prepareTokenImport} from '../server/tokenImport.ts';
test('independent registry and executor retain CLI and require tenant on import',()=>{
 expect(REGISTRY['augment-api']?.executor).toBe('augment-api');expect(REGISTRY.auggie.alias).toBe('aug');expect(getExecutor('augment-api').constructor.name).toBe('AugmentApiExecutor');
 expect(prepareTokenImport({provider:'augment-api',accounts:[{token:'synthetic-import-token'}]})?.[0].view.valid).toBe(false);
 expect(prepareTokenImport({provider:'augment-api',accounts:[{token:'synthetic-import-token',apiUrl:'https://fixture.api.augmentcode.com'}]})?.[0].view.valid).toBe(true);
});
