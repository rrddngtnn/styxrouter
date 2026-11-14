import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ConnectionPolicy } from '../src/pages/ConnectionPolicy.tsx';

test('policy workspace exposes both URL links but exclusively reveals the requested editor', () => {
  for (const tab of ['proxies','error-rules']) {
    const router = createMemoryRouter([{path:'/connection-policy',element:<ConnectionPolicy />}], {initialEntries:[`/connection-policy?tab=${tab}`]});
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain('Connection Policy');
    expect(html).toContain('Proxies');
    expect(html).toContain('Error Rules');
    expect(html).toContain(`aria-current="page"`);
    expect(html).toContain('Loading');
    expect(html).not.toContain('using direct host egress');
    expect(html).not.toContain('No custom outbound proxies');
  }
});
