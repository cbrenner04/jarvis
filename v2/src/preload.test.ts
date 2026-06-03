import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

test("agent-spawn preload is active for the v2 slice", () => {
  const [fakeBinDir] = (process.env.PATH ?? "").split(":");
  const fakeCodex = join(fakeBinDir ?? "", "codex");
  expect(basename(fakeBinDir ?? "")).toStartWith("jarvis-test-fake-agents-");
  expect(existsSync(fakeCodex)).toBeTrue();
  expect(spawnSync(fakeCodex, ["--version"]).status).toBe(0);
});
