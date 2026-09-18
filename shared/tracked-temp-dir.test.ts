import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTrackedTempDirs, trackedMkdtemp, trackedMkdtempSync } from "./tracked-temp-dir.test-support.ts";

test("removeTrackedTempDirs deletes every tracked dir", async () => {
  const dirs = [
    trackedMkdtempSync(join(tmpdir(), "jarvis-tracked-")),
    await trackedMkdtemp(join(tmpdir(), "jarvis-tracked-")),
  ];
  expect(dirs.every((dir) => existsSync(dir))).toBe(true);
  removeTrackedTempDirs();
  expect(dirs.some((dir) => existsSync(dir))).toBe(false);
});
