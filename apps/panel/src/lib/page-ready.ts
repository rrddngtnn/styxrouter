import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
/** Pages whose heading depends on discovery announce readiness, not every refetch. */
export function usePageReady(ready: boolean) {
 const {pathname}=useLocation();
 useEffect(()=>{if(ready)document.dispatchEvent(new CustomEvent('styx:page-ready',{detail:pathname}));},[pathname,ready]);
}
