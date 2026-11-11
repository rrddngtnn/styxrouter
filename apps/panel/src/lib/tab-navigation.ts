export function nextTabIndex(key:string,current:number,count:number):number|null {
 if(count<1)return null;
 switch(key){case 'ArrowRight':case 'ArrowDown':return (current+1)%count;case 'ArrowLeft':case 'ArrowUp':return (current+count-1)%count;case 'Home':return 0;case 'End':return count-1;default:return null;}
}
