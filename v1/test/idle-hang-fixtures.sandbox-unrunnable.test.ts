// Real subprocess tests for idle hang fixture self-clean and per-test teardown.
// Requires sandbox-off process visibility (ps/pgrep per operator runbook).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../src/agents/spawn.ts";
import {
  beginHangFixtureTracking,
  HANG_FIXTURE_EXIT_DEADLINE_MS,
  reapActiveHangFixtures,
  trackHangFixtureRoot,
  waitForProcessExit,
  waitForScriptExit,
  waitForScriptRunning,
  writeIdleHangScript,
} from "./idle-hang-fixtures.ts";

const HANG_FIXTURE_TRACKING_ID = import.meta.path;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-idle-hang-fixture-"));
  beginHangFixtureTracking(HANG_FIXTURE_TRACKING_ID);
});

afterEach(() => {
  reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
  rmSync(dir, { recursive: true, force: true });
});

describe("idle hang fixture self-clean (sandbox-unrunnable)", () => {
  test("exits when immediate bash parent is killed", async () => {
    const script = writeIdleHangScript(join(dir, "idle-hang.sh"));
    const spawner = spawn("bash", ["-c", `bash ${JSON.stringify(script)} & while kill -0 $! 2>/dev/null; do sleep 0.05; done`], {
      stdio: "ignore",
    });
    const spawnerPid = spawner.pid;
    expect(spawnerPid).toBeGreaterThan(0);

    await waitForScriptRunning(script, HANG_FIXTURE_EXIT_DEADLINE_MS);

    process.kill(spawnerPid!, "SIGKILL");
    await waitForScriptExit(script, HANG_FIXTURE_EXIT_DEADLINE_MS);
  });

  test("registered teardown kills helper after simulated test-body abort", async () => {
    const script = writeIdleHangScript(join(dir, "idle-hang.sh"));
    let agentRootPid: number | undefined;
    void runAgent(
      {
        name: "claude",
        binary: script,
        cwd: dir,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
      },
      "hang",
      {
        cwd: dir,
        onSpawned: ({ pid }) => {
          agentRootPid = pid;
          trackHangFixtureRoot(pid);
        },
      },
    );

    await waitForScriptRunning(script, HANG_FIXTURE_EXIT_DEADLINE_MS);

    expect(() => {
      try {
        throw new Error("simulated test failure");
      } finally {
        reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
      }
    }).toThrow("simulated test failure");

    await waitForScriptExit(script, HANG_FIXTURE_EXIT_DEADLINE_MS);
    expect(agentRootPid).toBeDefined();
    await waitForProcessExit(agentRootPid as number, HANG_FIXTURE_EXIT_DEADLINE_MS);
  });
});
