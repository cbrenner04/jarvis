import { expect, test } from "bun:test";
import { selfHandoffSuccessorStartOptions } from "./daemon.ts";
import { DEFAULT_DAEMON_READINESS_TIMEOUT_MS } from "./daemon-changeover.ts";

// A loaded host's successor startup observed well past the manual-start budget.
const LOADED_SUCCESSOR_STARTUP_MS = 20_000;

test("default self-handoff successor readiness budget tolerates a loaded startup", () => {
  const options = selfHandoffSuccessorStartOptions("/home/.jarvis/daemon.sock", "digest-b");
  expect(options.readinessTimeoutMs).toBeGreaterThan(DEFAULT_DAEMON_READINESS_TIMEOUT_MS);
  expect(options.readinessTimeoutMs).toBeGreaterThan(LOADED_SUCCESSOR_STARTUP_MS);
});

test("default self-handoff successor paths derive from the incumbent socket dir", () => {
  const options = selfHandoffSuccessorStartOptions("/home/.jarvis/daemon.sock", "digest-b");
  expect(options.pidPath).toBe("/home/.jarvis/daemon.pid");
  expect(options.logPath).toBe("/home/.jarvis/daemon.log");
  expect(options.privateSocketPath.startsWith("/home/.jarvis/")).toBe(true);
});
