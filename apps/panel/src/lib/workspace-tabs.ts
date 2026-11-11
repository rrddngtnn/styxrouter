import {useId, useState, type KeyboardEvent} from 'react';
import {nextTabIndex} from './tab-navigation';
/** Manual-activation tabs: arrows rove focus; Enter/Space keep native button activation. */
export function useWorkspaceTabs(active:string) {
 const id=useId();const [focused,setFocused]=useState(active);
 return {
  tabProps:(value:string)=>({id:`${id}-tab-${value}`, 'aria-controls':`${id}-panel`, tabIndex:focused===value?0:-1, onFocus:()=>setFocused(value)}),
  panelProps:{id:`${id}-panel`,role:'tabpanel', 'aria-labelledby':`${id}-tab-${active}`,tabIndex:0},
  onKeyDown:(event:KeyboardEvent<HTMLElement>)=>{
   const tabs=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
   const index=tabs.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;
   const next=nextTabIndex(event.key,index,tabs.length);if(next===null)return;
   event.preventDefault();tabs[next]?.focus();
  }
 };
}
