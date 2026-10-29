import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PreferencesProvider } from '../src/lib/preferences.tsx';
import { Providers, ProviderDetail } from '../src/pages/Providers.tsx';
import '@radix-ui/themes/styles.css';
import '../src/main.css';

createRoot(document.getElementById('root')!).render(<PreferencesProvider><MemoryRouter initialEntries={['/providers']}><div className="shell-responsive"><main className="content"><div className="page-motion"><Routes><Route path="/providers" element={<Providers />} /><Route path="/providers/:providerId" element={<ProviderDetail />} /></Routes></div></main></div></MemoryRouter></PreferencesProvider>);
