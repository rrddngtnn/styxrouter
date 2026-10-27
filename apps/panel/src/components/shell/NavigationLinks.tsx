import { NavLink } from "react-router-dom";
import { navigation } from "./navigation.ts";
import { useTranslator } from "../../lib/useTranslator.ts";

const GROUPS = ["Gateway", "Observability", "System"] as const;

/**
 * The single nav render source. Desktop sidebar, mobile drawer and the collapsed
 * icon rail all consume this so labels, groups and active states cannot drift.
 */
export function NavigationLinks({
  compact = false,
  onNavigate,
}: {
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslator();
  return (
    <>
      {GROUPS.map((group) => (
        <div className="nav-section" key={group}>
          {!compact && <div className="nav-section-label">{t(group)}</div>}
          {navigation
            .filter((item) => item.group === group)
            .map(({ label, to, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={compact ? t(label) : undefined}
                aria-label={compact ? t(label) : undefined}
                end={to === "/"}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
                onClick={onNavigate}
              >
                <Icon size={20} aria-hidden="true" />
                {!compact && <span>{t(label)}</span>}
              </NavLink>
            ))}
        </div>
      ))}
    </>
  );
}
