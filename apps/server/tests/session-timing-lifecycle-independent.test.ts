import { afterEach, expect, test } from "bun:test";
import { clearSessions, consumeToolFinishTime, markToolFinish, touchSession } from "../open-sse/services/sessionManager";

afterEach(() => clearSessions());

test("a later mark supersedes an earlier mark even when a dashboard session is created between them", () => {
  markToolFinish("stream");
  touchSession("stream");
  markToolFinish("stream");
  expect(consumeToolFinishTime("stream")).not.toBeNull();
  expect(consumeToolFinishTime("stream")).toBeNull();
});

test("timings are isolated by key and cleared without creating monitoring sessions", () => {
  markToolFinish("key-a:conversation");
  expect(consumeToolFinishTime("key-b:conversation")).toBeNull();
  clearSessions();
  expect(consumeToolFinishTime("key-a:conversation")).toBeNull();
});

test("timing retention is bounded across dashboard and stream-only sessions", () => {
  touchSession("old");
  markToolFinish("old");
  for (let i = 0; i < 200; i++) markToolFinish(`stream-${i}`);
  expect(consumeToolFinishTime("old")).toBeNull();
  expect(consumeToolFinishTime("stream-199")).not.toBeNull();
});

test("dashboard session timing expires even if the session remains active", () => {
  const now = Date.now;
  let clock = 1000;
  Date.now = () => clock;
  try {
    touchSession("session");
    markToolFinish("session");
    clock += 15 * 60 * 1000 + 1;
    touchSession("session");
    expect(consumeToolFinishTime("session")).toBeNull();
  } finally { Date.now = now; }
});
