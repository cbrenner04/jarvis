// Marked as .sandbox-unrunnable: requires real process launch to verify Bun preload mutates PATH for the shared slice.
//
// The mocked SubprocessRunner boundary (shared/subprocess.ts) cannot substitute here: this test
// asserts that Bun's real preload mechanism mutates PATH for an actual OS-spawned child process,
// not that application code passes the right args to an injected runner. A mocked runner returns
// canned output regardless of PATH, so it would pass even if preload broke.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

test("agent-spawn preload is active for the shared slice", () => {
  const [fakeBinDir] = (process.env.PATH ?? "").split(":");
  const fakeCodex = join(fakeBinDir ?? "", "codex");
  expect(basename(fakeBinDir ?? "")).toStartWith("jarvis-test-fake-agents-");
  expect(existsSync(fakeCodex)).toBeTrue();
  expect(spawnSync(fakeCodex, ["--version"]).status).toBe(0);
});
