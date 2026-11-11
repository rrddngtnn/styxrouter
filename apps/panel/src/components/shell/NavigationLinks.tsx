import { NavLink } from "react-router-dom";
import { navigation } from "./navigation.ts";
import { useTranslator } from "../../lib/useTranslator.ts";

const GROUPS = ["", "Gateway", "Access", "Monitoring", "System"] as const;

/** The drawer's single labelled navigation render source. */
export function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslator();
  return (
    <>
      {GROUPS.map((group) => (
        <div className="nav-section" key={group}>
          {group && <div className="nav-section-label">{t(group)}</div>}
          {navigation
            .filter((item) => item.group === group)
            .map(({ label, to, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
                onClick={onNavigate}
                aria-label={t(label)}
                title={t(label)}
              >
                <Icon size={20} aria-hidden="true" />
                <span>{t(label)}</span>
              </NavLink>
            ))}
        </div>
      ))}
    </>
  );
}
