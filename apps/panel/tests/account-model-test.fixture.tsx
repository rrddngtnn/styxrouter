import { createRoot } from 'react-dom/client';
import { PreferencesProvider } from '../src/lib/preferences.tsx';
import { AccountModelTest } from '../src/components/AccountModelTest.tsx';
import '@radix-ui/themes/styles.css';
import '../src/main.css';
const params=new URLSearchParams(location.search);
createRoot(document.getElementById('root')!).render(<PreferencesProvider><AccountModelTest disabled={false} account={{id:params.get('account') ?? 'fixture-account',provider:params.get('provider') ?? 'openai',name:'Fixture Account',isActive:true}} /></PreferencesProvider>);
