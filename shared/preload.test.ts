import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

test("agent-spawn preload is active for the shared slice", () => {
  const [fakeBinDir] = (process.env.PATH ?? "").split(":");
  expect(basename(fakeBinDir ?? "")).toStartWith("jarvis-test-fake-agents-");
  expect(existsSync(join(fakeBinDir ?? "", "codex"))).toBeTrue();
  expect(spawnSync("codex", ["--version"]).status).toBe(0);
});
