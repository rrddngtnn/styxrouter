import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmergencyDispatchPauseCard,
  HealthAndVersionsView,
  validateSemverPin,
} from "../src/components/settings/HealthAndVersionsSettings.tsx";

test("validateSemverPin accepts x.y.z up to 6 digits per segment and rejects malformed strings", () => {
  expect(validateSemverPin("3.16.3")).toBe("3.16.3");
  expect(validateSemverPin(" 2.24.0 ")).toBe("2.24.0");
  expect(validateSemverPin("")).toBeNull();
  expect(validateSemverPin("v3.16.3")).toBeNull();
  expect(validateSemverPin("3.16")).toBeNull();
  expect(validateSemverPin("3.16.3-beta")).toBeNull();
});

test("HealthAndVersionsView renders ZCode and Antigravity version drift, pin controls, and process/storage health", () => {
  const html = renderToStaticMarkup(
    <HealthAndVersionsView
      zcode={{
        cachedVersion: "3.15.1",
        pinnedVersion: "3.14.0",
        effectiveVersion: "3.14.0",
        observedVersion: "3.16.3",
        observedAt: 1761868800000,
      }}
      antigravityIde={{
        cachedVersion: "2.24.0",
        pinnedVersion: null,
        effectiveVersion: "2.24.0",
        observedVersion: "2.24.0",
        observedAt: 1761868800000,
      }}
      antigravityCli={{
        cachedVersion: "1.9.2",
        pinnedVersion: null,
        effectiveVersion: "1.9.2",
        observedVersion: null,
        observedAt: null,
      }}
      processHealth={{
        startedAt: "2026-10-31T07:00:42.000Z",
        peakRssBytes: 268435456,
        userMicroseconds: 14500000,
        systemMicroseconds: 3200000,
        threadCount: 12,
        tokenScheduler: {
          enabled: true,
          running: false,
          lastStartedAt: 1761868000000,
          lastFinishedAt: 1761868005000,
          lastOutcome: "completed",
          lastDueCount: 4,
          lastRefreshedCount: 4,
          nextScheduledAt: 1761871600000,
        },
        storage: {
          databaseBytes: 52428800,
          walBytes: 4194304,
          lastSuccessfulSchedulerVacuumAt: 1761800000000,
        },
      }}
    />,
  );

  expect(html).toContain("ZCode CLI");
  expect(html).toContain("3.14.0");
  expect(html).toContain("3.16.3");
  expect(html).toContain("Antigravity IDE");
  expect(html).toContain("2.24.0");
  expect(html).toContain("Antigravity CLI");
  expect(html).toContain("1.9.2");
  expect(html).toContain("256.00 MB");
  expect(html).toContain("50.00 MB");
  expect(html).toContain("4.00 MB");
  expect(html).toContain("completed");
});

test("EmergencyDispatchPauseCard displays active account counts and emergency pause controls", () => {
  const html = renderToStaticMarkup(
    <EmergencyDispatchPauseCard
      totalCount={15}
      activeCount={12}
      confirming={false}
      busy={false}
      onRequestPause={() => {}}
      onConfirmPause={() => {}}
      onCancelPause={() => {}}
      onResumeAll={() => {}}
    />,
  );

  expect(html).toContain("Emergency dispatch pause");
  expect(html).toContain("12");
  expect(html).toContain("15");
  expect(html).toContain("Disable all active accounts");
});
