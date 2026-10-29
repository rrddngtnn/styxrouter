import { createRoot } from 'react-dom/client';
import { PreferencesProvider } from '../src/lib/preferences.tsx';
import { Models } from '../src/pages/Models.tsx';
import '@radix-ui/themes/styles.css';
import '../src/main.css';
createRoot(document.getElementById('root')!).render(<PreferencesProvider><Models /></PreferencesProvider>);
