import {useLayoutEffect} from 'react';
/** Entry-scoped session anchors store only identifier, offset and position, never resource payloads. */
export function saveResourceAnchor(key:string,selector:string) {
 try {const nodes=[...document.querySelectorAll<HTMLElement>(selector)];const first=nodes.find(el=>el.getBoundingClientRect().bottom>56);sessionStorage.setItem(`styx-anchor:${key}`,JSON.stringify({id:first?.dataset.resourceAnchor,offset:first?.getBoundingClientRect().top,y:window.scrollY}));}catch{/* storage may be unavailable */}
}
export function useResourceAnchor(key:string,ready:boolean,active:boolean,selector:string) {
 useLayoutEffect(()=>{if(!ready||!active)return;try{const saved=JSON.parse(sessionStorage.getItem(`styx-anchor:${key}`)??'null');if(!saved)return;const nodes=[...document.querySelectorAll<HTMLElement>(selector)];const anchor=nodes.find(el=>el.dataset.resourceAnchor===saved.id);if(anchor)window.scrollTo(0,window.scrollY+anchor.getBoundingClientRect().top-saved.offset);else window.scrollTo(0,Math.min(saved.y,document.documentElement.scrollHeight-window.innerHeight));}catch{/* safe fallback */}},[key,ready,active,selector]);
}
