import { Activity, BarChart3, Cpu, Database, Gauge, GitBranch, KeyRound, LayoutDashboard, Settings, ShieldCheck, Terminal } from "lucide-react";
export const navigation = [
 {group:'',label:'Overview',to:'/',icon:LayoutDashboard},
 {group:'Gateway',label:'Providers',to:'/providers',icon:Database},
 {group:'Gateway',label:'Models',to:'/models',icon:Cpu},
 {group:'Gateway',label:'Routing',to:'/routing',icon:GitBranch},
 {group:'Access',label:'Client API Keys',to:'/keys',icon:KeyRound},
 {group:'Access',label:'Connect Tools',to:'/tools',icon:Terminal},
 {group:'Monitoring',label:'Quota',to:'/quota',icon:Gauge},
 {group:'Monitoring',label:'Usage',to:'/usage',icon:BarChart3},
 {group:'Monitoring',label:'Request Activity',to:'/activity',icon:Activity},
 {group:'System',label:'Audit Log',to:'/audit',icon:ShieldCheck},
 {group:'System',label:'Settings',to:'/settings',icon:Settings},
];
