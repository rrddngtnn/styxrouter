import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {useFetch} from '../src/lib/useFetch';
function Probe(){const [path,setPath]=useState<string|null>('/api/read/a');const s=useFetch<{value:string}>(path);return <><button onClick={s.reload}>Reload</button><button onClick={()=>setPath('/api/read/b')}>Scope B</button><button onClick={()=>setPath(null)}>Disable</button><pre id="state">{JSON.stringify(s)}</pre></>}
createRoot(document.getElementById('root')!).render(<Probe/>);
