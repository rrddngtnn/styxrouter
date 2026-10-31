import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmergencyDispatchPauseCard,
  HealthAndVersionsView,
  WebhookAlertsCard,
  validateSemverPin,
} from "../src/components/settings/HealthAndVersionsSettings.tsx";
import {
  formatProviderErrorRulesText,
  parseProviderErrorRulesText,
} from "../src/pages/Settings.tsx";

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
      dispatchHealth={[
        {
          provider: "antigravity",
          lastSuccessAt: "2026-10-31T07:25:00.000Z",
          lastFailureAt: "2026-10-31T06:10:00.000Z",
          hour: { requests: 40, failures: 2 },
          day: { requests: 400, failures: 10 },
        },
      ]}
      routingTrace={{
        scope: {
          storage: "process-local",
          retention: "volatile",
          maxEvents: 1000,
          instanceId: "inst-1234",
        },
        events: [
          {
            time: 1761868800000,
            kind: "selection",
            provider: "a1b2c3d4e5f60718",
            account: "9988776655443322",
            reason: "rateLimited",
            requestId: "req-corr-001",
            cooldownMs: 30000,
            status: 429,
          },
        ],
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
  expect(html).toContain("antigravity");
  expect(html).toContain("2 / 40");
  expect(html).toContain("10 / 400");
  expect(html).toContain("rateLimited");
  expect(html).toContain("req-corr-001");
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

test("WebhookAlertsCard renders configured alert destinations and event subscriptions", () => {
  const html = renderToStaticMarkup(
    <WebhookAlertsCard
      webhooks={[
        {
          id: "wh-1",
          url: "https://hooks.example.com/telegram",
          kind: "telegram",
          events: ["quota.exceeded", "request.failed"],
          enabled: true,
          description: "Telegram Ops Bot",
          lastStatus: 200,
        },
      ]}
    />,
  );
  expect(html).toContain("Webhook &amp; Telegram Alert Subscriptions");
  expect(html).toContain("Telegram Ops Bot");
  expect(html).toContain("quota.exceeded, request.failed");
  expect(html).toContain("HTTP 200");
});

test("parseProviderErrorRulesText and formatProviderErrorRulesText round-trip valid rules and reject invalid scopes", () => {
  const input = "codebuddy-cn | 400 | 6000 | model | quota_exhausted | 300";
  const parsed = parseProviderErrorRulesText(input);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(parsed.rules["codebuddy-cn"]).toEqual([
      {
        status: 400,
        match: "6000",
        scope: "model",
        reason: "quota_exhausted",
        cooldownMs: 300000,
      },
    ]);
    expect(formatProviderErrorRulesText(parsed.rules)).toBe(input);
  }
  expect(parseProviderErrorRulesText("codebuddy-cn | 400 | 6000 | invalid_scope").ok).toBe(false);
});
