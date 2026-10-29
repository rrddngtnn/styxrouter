import { expect, test } from "bun:test";
import { validateSubscriptionInput } from "../server/webhookManagementValidation";

test("validates event allowlist and calls the injected public URL guard", () => {
  const seen: string[] = [];
  const validateUrl = (url: string) => { seen.push(url); return new URL(url); };
  expect(validateSubscriptionInput({ url: "https://example.com/hook", events: ["request.failed"], description: "demo" }, validateUrl)).toEqual({ url: "https://example.com/hook", events: ["request.failed"], description: "demo" });
  expect(seen).toEqual(["https://example.com/hook"]);
  expect(() => validateSubscriptionInput({ url: "https://example.com", events: ["*"] }, validateUrl)).toThrow();
  expect(() => validateSubscriptionInput({ url: "https://example.com", events: ["test.ping", "test.ping"] }, validateUrl)).toThrow();
  expect(() => validateSubscriptionInput({ url: "https://example.com", events: [] }, validateUrl)).toThrow();
});

test("rejects extra fields and guard failures without echoing input", () => {
  const guard = () => { throw new Error("secret-url"); };
  expect(() => validateSubscriptionInput({ url: "secret-url", events: ["test.ping"] }, guard)).toThrow("Invalid subscription");
  expect(() => validateSubscriptionInput({ url: "https://example.com", events: ["test.ping"], secret: "secret" }, () => new URL("https://example.com"))).toThrow("Invalid subscription");
});
