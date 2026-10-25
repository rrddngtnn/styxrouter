const labels: Record<string,string> = {providers:'Providers',models:'Models',routing:'Routing',keys:'API Keys',activity:'Activity',quota:'Quota',usage:'Usage',tools:'Connect tools',audit:'Audit log',settings:'Settings'};
export function breadcrumbs(path: string): {label:string;to:string|null}[] {
 const parts = path.split('/').filter(Boolean);
 if (!parts.length) return [{label:'Overview',to:null}];
 return parts.map((part,index) => {
  const text = decodeURIComponent(part).replace(/-/g,' ');
  return {label:labels[part] ?? text.charAt(0).toUpperCase()+text.slice(1),to:index === parts.length-1 ? null : '/'+parts.slice(0,index+1).join('/')};
 });
}
