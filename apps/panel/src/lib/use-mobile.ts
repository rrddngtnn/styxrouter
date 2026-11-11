import {useSyncExternalStore} from 'react';
const query = '(max-width: 860px)';
function subscribe(notify: () => void) { const media = window.matchMedia(query); media.addEventListener('change', notify); return () => media.removeEventListener('change', notify); }
export function useMobile() { return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false); }
