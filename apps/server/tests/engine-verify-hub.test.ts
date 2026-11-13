import {mock,expect} from 'bun:test';
mock.module('../src/lib/db/antigravityVersionPin.ts',()=>({getAntigravityVersionPin:()=>null}));
const {getAntigravityContentHeaders,ANTIGRAVITY_HUB_VERSION}=await import('../open-sse/services/antigravityHeaders.ts');
expect(ANTIGRAVITY_HUB_VERSION).toBe('2.31.2');
expect(getAntigravityContentHeaders('hub')).toEqual({'Content-Type':'application/json','User-Agent':'antigravity/hub/2.31.2 (aidev_client; os_type=darwin; arch=arm64)'});
console.log('Hub official artifact version/identity contract passed');
