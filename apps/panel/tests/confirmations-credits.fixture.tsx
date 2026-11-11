import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Theme} from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '../src/main.css';
import {PreferencesProvider} from '../src/lib/preferences';
import {Quota} from '../src/pages/Quota';
function Fixture(){const [mounted,setMounted]=React.useState(true);return <><button onClick={()=>setMounted(v=>!v)}>Toggle quota mount</button>{mounted&&<Quota/>}</>;}
createRoot(document.getElementById('root')!).render(<Theme><PreferencesProvider><MemoryRouter><main className="content"><p role="note">SYNTHETIC · local intercepted fixture only · no live providers</p><Fixture/></main></MemoryRouter></PreferencesProvider></Theme>);
