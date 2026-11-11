import {Theme} from '@radix-ui/themes';
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {PreferencesProvider} from '../src/lib/preferences';
import {OAuthConnect,type FlowType} from '../src/pages/OAuthConnect';
function Fixture(){const [open,setOpen]=useState(true);const [done,setDone]=useState(0);return <><output data-testid="done">{done}</output><button onClick={()=>setOpen(false)}>Unmount</button>{open&&<OAuthConnect provider="fixture-provider" flow={(new URLSearchParams(location.search).get('flow')??'import_token') as FlowType} onDone={()=>setDone(x=>x+1)} onClose={()=>setOpen(false)}/>}</>}
createRoot(document.getElementById('root')!).render(<PreferencesProvider><Theme><Fixture/></Theme></PreferencesProvider>);
