import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const file = (path: string) => readFileSync(new URL(path, import.meta.url));
const text = (path: string) => file(path).toString('utf8');
// SHA-256 of the operator-approved kit, including both inherited Elaa notices.
const approved = {
  'brand/LICENSE-NOTICE.txt': '75f1117f20578e52845fa16876f49363e0a85911b364409f712f424c2ee57502',
  'brand/PROVENANCE.txt': 'bbe9745b55939eec4fa00be8fc33115f8a6d3a9eed3cd6cec084d8528fea890d',
  'brand/STYXROUTER-BRAND-KIT-NOTICE.txt': '50427203efd95b3818d873697e85abc56f69feff075c9946918c2428ed46a7bd',
  'brand/apple-touch-icon.png': '7ed31846dfa13209e52335e0cee53a70d34e33a8e315ea83dca2da98f8f028f4',
  'brand/styx-icon.svg': 'df8a8061b24b48eb6d7e28e6ef71dcaa08ed666453aa8b14e5d3869cc81ddd7d',
  'brand/styx-lockup-dark.svg': '9b1049e38f47c1eb784c542de60f2a875e4b2de12dfcf9591c733989f72e9715',
  'brand/styx-lockup-original.svg': '69bcdf5ff5a439601d248d32f416ab85fa626cd8e6b4e15daf04a483b95708f5',
  'brand/styx-lockup.svg': '047fe858d18c9e67748edc9768446af14aa544c747a8d1b15639b114823c81b7',
  'brand/styx-wordmark.svg': '4eae3c60ab7e8a63fa49ff8a79d59090e13ef381423bbbbd2827fbe294ff88b0',
  'favicon.ico': '349747b04f196a8aba9c3969af1821f8826aacb7c580c92acdffe96e2ee7fb64',
};

for (const [path, sha256] of Object.entries(approved)) {
  test(`approved asset bytes: ${path}`, () => {
    expect(createHash('sha256').update(file(`../public/${path}`)).digest('hex')).toBe(sha256);
  });
  if (process.env.VERIFY_BUILT_BRAND === '1') {
    test(`built asset bytes: ${path}`, () => {
      expect(createHash('sha256').update(file(`../dist/${path}`)).digest('hex')).toBe(sha256);
    });
  }
}

test('login and unified drawer share approved light/dark lockups; favicon retains approved icon', () => {
  for (const path of ['../src/pages/Login.tsx', '../src/components/shell/ShellFrame.tsx']) {
    expect(text(path)).toContain('<BrandMark />');
  }
  const brand = text('../src/components/BrandMark.tsx');
  expect(brand).toContain('brand/styx-lockup.svg');
  expect(brand).toContain('brand/styx-lockup-dark.svg');
  expect(text('../index.html')).toContain('brand/styx-icon.svg');
  expect(text('../index.html')).toContain('%BASE_URL%favicon.ico');
});

test('OCI product title and release version are distinct from the Bun base version', () => {
  const dockerfile = text('../../../Dockerfile');
  expect(dockerfile).toContain('ARG STYX_VERSION=dev');
  expect(dockerfile).toContain('org.opencontainers.image.title="StyxRouter"');
  expect(dockerfile).toContain('org.opencontainers.image.version="${STYX_VERSION}"');
  expect(dockerfile).toContain('COPY --from=panel /build/apps/panel/dist ./panel');
  const workflow = text('../../../.github/workflows/release.yml');
  expect(workflow).toContain('STYX_VERSION=${{ steps.image-version.outputs.version }}');
  expect(workflow).toContain('org.opencontainers.image.title=StyxRouter');
  expect(workflow).toContain('org.opencontainers.image.version=${{ steps.image-version.outputs.version }}');
});
