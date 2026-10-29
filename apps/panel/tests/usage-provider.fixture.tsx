import { createRoot } from 'react-dom/client';
import { PreferencesProvider } from '../src/lib/preferences.tsx';
import { Usage } from '../src/pages/Usage.tsx';
import { MemoryRouter } from 'react-router-dom';
import '@radix-ui/themes/styles.css';
import '../src/main.css';
createRoot(document.getElementById('root')!).render(<MemoryRouter basename="/panel" initialEntries={['/panel/usage']}><PreferencesProvider><Usage /></PreferencesProvider></MemoryRouter>);
