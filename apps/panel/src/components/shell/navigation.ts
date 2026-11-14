import { Activity, BarChart3, Cpu, Database, Gauge, GitBranch, KeyRound, LayoutDashboard, Settings, ShieldCheck, Terminal } from "lucide-react";

export const navigation = [
  { group: "Gateway", label: "Overview", to: "/", icon: LayoutDashboard },
  { group: "Gateway", label: "Providers", to: "/providers", icon: Database },
  { group: "Gateway", label: "Connection Policy", to: "/connection-policy", icon: Settings },
  { group: "Gateway", label: "Models", to: "/models", icon: Cpu },
  { group: "Gateway", label: "Routing", to: "/routing", icon: GitBranch },
  { group: "Gateway", label: "API Keys", to: "/keys", icon: KeyRound },
  { group: "Observability", label: "Quota", to: "/quota", icon: Gauge },
  { group: "Observability", label: "Usage", to: "/usage", icon: BarChart3 },
  { group: "Observability", label: "Activity", to: "/activity", icon: Activity },
  { group: "System", label: "Connect tools", to: "/tools", icon: Terminal },
  { group: "System", label: "Audit log", to: "/audit", icon: ShieldCheck },
  { group: "System", label: "Settings", to: "/settings", icon: Settings },
];
