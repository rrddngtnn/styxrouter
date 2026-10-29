import { createRoot } from 'react-dom/client';
import { PreferencesProvider } from '../src/lib/preferences.tsx';
import { ProviderModels } from '../src/pages/ProviderModels.tsx';
import '@radix-ui/themes/styles.css';
import '../src/main.css';
createRoot(document.getElementById('root')!).render(<PreferencesProvider><ProviderModels providerId="node-uuid" /></PreferencesProvider>);
