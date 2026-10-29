import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PreferencesProvider } from '../src/lib/preferences.tsx';
import { ProviderDetail } from '../src/pages/Providers.tsx';
import '@radix-ui/themes/styles.css';
import '../src/main.css';
createRoot(document.getElementById('root')!).render(<PreferencesProvider><BrowserRouter><div className="shell-responsive"><main className="content"><div className="page-motion"><Routes><Route path="/providers/:providerId" element={<ProviderDetail />} /></Routes></div></main></div></BrowserRouter></PreferencesProvider>);
