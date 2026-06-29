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
  waitForSubtreeExit,
  waitForSubtreeGrowth,
  writeIdleHangScript,
} from "./idle-hang-fixtures.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-idle-hang-fixture-"));
  beginHangFixtureTracking();
});

afterEach(() => {
  reapActiveHangFixtures();
  rmSync(dir, { recursive: true, force: true });
});

describe("idle hang fixture self-clean (sandbox-unrunnable)", () => {
  test("exits when immediate bash parent is killed", async () => {
    const script = writeIdleHangScript(join(dir, "idle-hang.sh"));
    const wrapper = spawn("bash", ["-c", `exec bash ${JSON.stringify(script)}`], { stdio: "ignore" });
    const wrapperPid = wrapper.pid;
    expect(wrapperPid).toBeGreaterThan(0);

    await waitForSubtreeGrowth(wrapperPid!, 2, HANG_FIXTURE_EXIT_DEADLINE_MS);

    process.kill(wrapperPid!, "SIGKILL");
    await waitForSubtreeExit(wrapperPid!, HANG_FIXTURE_EXIT_DEADLINE_MS);
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

    let simulatedAbort = false;
    const runBody = (): void => {
      try {
        simulatedAbort = true;
        throw new Error("simulated test failure");
      } finally {
        reapActiveHangFixtures();
      }
    };
    expect(runBody).toThrow("simulated test failure");
    expect(simulatedAbort).toBe(true);

    await waitForScriptExit(script, HANG_FIXTURE_EXIT_DEADLINE_MS);
    expect(agentRootPid).toBeDefined();
    await waitForProcessExit(agentRootPid as number, HANG_FIXTURE_EXIT_DEADLINE_MS);
  });
});
