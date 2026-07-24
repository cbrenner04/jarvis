import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore } from "./state-store";
import { copyOrchestrationStore, orchestrationStorePaths, removeOrchestrationStore } from "./state-store-on-disk";

function withTempPaths(name: string, run: (srcPath: string, destPath: string) => void): void {
  const stamp = `${name}-${Date.now()}`;
  const srcPath = join(tmpdir(), `jarvis-on-disk-src-${stamp}.sqlite`);
  const destPath = join(tmpdir(), `jarvis-on-disk-dest-${stamp}.sqlite`);
  try {
    run(srcPath, destPath);
  } finally {
    removeOrchestrationStore(srcPath);
    removeOrchestrationStore(destPath);
  }
}

function seedCommittedRun(dbPath: string): string {
  const store = openStateStore(dbPath);
  const runId = store.createRun({
    project: "copy-proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "copy-branch",
    specPath: "spec.md",
  });
  store.close();
  return runId;
}

describe("orchestration store on-disk helpers", () => {
  test("orchestrationStorePaths lists main file and WAL sidecars", () => {
    expect(orchestrationStorePaths("/tmp/foo.sqlite")).toEqual([
      "/tmp/foo.sqlite",
      "/tmp/foo.sqlite-wal",
      "/tmp/foo.sqlite-shm",
    ]);
  });

  test("copyOrchestrationStore round-trips a WAL-backed committed run row", () => {
    withTempPaths("full-copy", (srcPath, destPath) => {
      const runId = seedCommittedRun(srcPath);
      expect(existsSync(`${srcPath}-wal`)).toBe(true);

      copyOrchestrationStore(srcPath, destPath);

      const copyStore = openStateStore(destPath);
      const run = copyStore.loadRun(runId);
      expect(run?.id).toBe(runId);
      expect(run?.project).toBe("copy-proj");
      copyStore.close();
    });
  });

  test("main-file-only copy loses committed row when WAL sidecars are omitted", () => {
    withTempPaths("incomplete-copy", (srcPath, destPath) => {
      const runId = seedCommittedRun(srcPath);
      expect(existsSync(`${srcPath}-wal`)).toBe(true);

      copyFileSync(srcPath, destPath);

      const copyStore = openStateStore(destPath);
      expect(copyStore.loadRun(runId)).toBeNull();
      copyStore.close();
    });
  });

  test("removeOrchestrationStore deletes main file and WAL sidecars", () => {
    const stamp = `remove-${Date.now()}`;
    const guardedPath = join(tmpdir(), `jarvis-on-disk-guard-${stamp}.sqlite`);
    const subjectPath = join(tmpdir(), `jarvis-on-disk-subject-${stamp}.sqlite`);
    try {
      seedCommittedRun(guardedPath);
      expect(existsSync(`${guardedPath}-wal`)).toBe(true);
      rmSync(guardedPath, { force: true });
      expect(existsSync(`${guardedPath}-wal`) || existsSync(`${guardedPath}-shm`)).toBe(true);

      seedCommittedRun(subjectPath);
      removeOrchestrationStore(subjectPath);
      for (const path of orchestrationStorePaths(subjectPath)) {
        expect(existsSync(path)).toBe(false);
      }
    } finally {
      removeOrchestrationStore(guardedPath);
      removeOrchestrationStore(subjectPath);
    }
  });

  test("copy and remove are no-ops for :memory: paths", () => {
    expect(() => copyOrchestrationStore(":memory:", join(tmpdir(), "unused.sqlite"))).not.toThrow();
    expect(() => removeOrchestrationStore(":memory:")).not.toThrow();
  });
});
