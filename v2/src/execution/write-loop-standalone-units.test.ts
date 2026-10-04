import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore } from "../persistence/state-store.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { mockWriteLoopInput } from "../testing/run-control.ts";
import {
  applyOperatorSessionId,
  buildSubspecCompletionInventory,
  persistRetainedFinalizationCheckpoint,
  type WriteLoopInput,
} from "./write-loop.ts";

describe("buildSubspecCompletionInventory", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function writeLinkedSpec(
    worktreePath: string,
    specDir: string,
    subspecs: ReadonlyArray<{ file: string; title: string; criteria: string }>,
    extraIndexLines: string[] = [],
  ): { specPath: string; subspecPaths: string[] } {
    const specRoot = join(worktreePath, specDir);
    mkdirSync(specRoot, { recursive: true });
    const links = subspecs.map((s, i) => `- [ ] [${String(i).padStart(2, "0")} - ${s.title}](./${s.file})`);
    writeFileSync(join(specRoot, "index.md"), `# Implement\n\n${[...links, ...extraIndexLines].join("\n")}\n`, "utf8");
    for (const s of subspecs) {
      writeFileSync(join(specRoot, s.file), `# ${s.title}\n\n## Acceptance criteria\n\n${s.criteria}\n`, "utf8");
    }
    return {
      specPath: `${specDir}/index.md`,
      subspecPaths: subspecs.map((s) => `${specDir}/${s.file}`),
    };
  }

  test("buildSubspecCompletionInventory classifies linked subspecs when projectRoot differs from worktreePath", () => {
    const projectRoot = trackedMkdtempSync(join(tmpdir(), "jarvis-project-root-"));
    roots.push(projectRoot);
    const worktreePath = trackedMkdtempSync(join(tmpdir(), "jarvis-worktree-"));
    roots.push(worktreePath);
    const { specPath } = writeLinkedSpec(worktreePath, "spec/implement", [
      { file: "00-first.md", title: "First", criteria: "- [x] done" },
      { file: "01-second.md", title: "Second", criteria: "- [ ] pending" },
    ]);

    expect(buildSubspecCompletionInventory(worktreePath, projectRoot, specPath)).toEqual({
      completedSubspecPaths: ["spec/implement/00-first.md"],
      remainingSubspecPaths: ["spec/implement/01-second.md"],
    });
  });

  test("buildSubspecCompletionInventory reports repo-relative paths when projectRoot differs from worktreePath", () => {
    const projectRoot = trackedMkdtempSync(join(tmpdir(), "jarvis-project-root-"));
    roots.push(projectRoot);
    const worktreePath = trackedMkdtempSync(join(tmpdir(), "jarvis-worktree-"));
    roots.push(worktreePath);
    const { specPath } = writeLinkedSpec(worktreePath, "spec/implement", [
      { file: "00-first.md", title: "First", criteria: "- [x] done" },
      { file: "01-second.md", title: "Second", criteria: "- [ ] pending" },
    ]);

    const inventory = buildSubspecCompletionInventory(worktreePath, projectRoot, specPath);
    expect(inventory.completedSubspecPaths).toEqual(["spec/implement/00-first.md"]);
    expect(inventory.remainingSubspecPaths).toEqual(["spec/implement/01-second.md"]);
    expect(inventory.completedSubspecPaths.every((path) => !path.startsWith(".."))).toBe(true);
  });

  test("buildSubspecCompletionInventory surfaces inventoryError for unrelativizable subspec paths", () => {
    const projectRoot = trackedMkdtempSync(join(tmpdir(), "jarvis-project-root-"));
    roots.push(projectRoot);
    const worktreePath = trackedMkdtempSync(join(tmpdir(), "jarvis-worktree-"));
    roots.push(worktreePath);
    const outsidePath = join(tmpdir(), `jarvis-outside-${Date.now()}.md`);
    writeFileSync(outsidePath, "# Outside\n\n## Acceptance criteria\n\n- [ ] pending\n", "utf8");
    roots.push(outsidePath);
    const specRoot = join(worktreePath, "spec/implement");
    mkdirSync(specRoot, { recursive: true });
    writeFileSync(
      join(specRoot, "index.md"),
      `# Implement\n\n- [ ] [00 - First](./00-first.md)\n- [ ] [01 - Outside](${outsidePath})\n`,
      "utf8",
    );
    writeFileSync(join(specRoot, "00-first.md"), "# First\n\n## Acceptance criteria\n\n- [x] done\n", "utf8");

    expect(buildSubspecCompletionInventory(worktreePath, projectRoot, "spec/implement/index.md")).toEqual({
      completedSubspecPaths: [],
      remainingSubspecPaths: [],
      inventoryError: `cannot relativize subspec path: ${outsidePath}`,
    });
  });

  test("buildSubspecCompletionInventory surfaces inventoryError when index build throws", () => {
    const projectRoot = trackedMkdtempSync(join(tmpdir(), "jarvis-project-root-"));
    roots.push(projectRoot);
    const worktreePath = trackedMkdtempSync(join(tmpdir(), "jarvis-worktree-"));
    roots.push(worktreePath);
    const specRoot = join(worktreePath, "spec/implement");
    mkdirSync(specRoot, { recursive: true });
    const indexPath = join(specRoot, "index.md");
    writeFileSync(indexPath, "# Implement\n", "utf8");
    chmodSync(indexPath, 0);

    const inventory = buildSubspecCompletionInventory(worktreePath, projectRoot, "spec/implement/index.md");
    chmodSync(indexPath, 0o644);

    expect(inventory.completedSubspecPaths).toEqual([]);
    expect(inventory.remainingSubspecPaths).toEqual([]);
    expect(inventory.inventoryError).toBeDefined();
  });

  test("buildSubspecCompletionInventory yields empty lists without inventoryError for zero linked subspecs", () => {
    const projectRoot = trackedMkdtempSync(join(tmpdir(), "jarvis-project-root-"));
    roots.push(projectRoot);
    const worktreePath = trackedMkdtempSync(join(tmpdir(), "jarvis-worktree-"));
    roots.push(worktreePath);
    const specRoot = join(worktreePath, "spec/implement");
    mkdirSync(specRoot, { recursive: true });
    writeFileSync(join(specRoot, "index.md"), "# Implement\n\nNo linked subspecs.\n", "utf8");

    expect(buildSubspecCompletionInventory(worktreePath, projectRoot, "spec/implement/index.md")).toEqual({
      completedSubspecPaths: [],
      remainingSubspecPaths: [],
    });
  });
});

describe("persistRetainedFinalizationCheckpoint", () => {
  test("returns false without a done attempt and does not persist", () => {
    const stateDbPath = join(tmpdir(), `jarvis-checkpoint-${process.pid}-${Date.now()}.db`);
    const store = openStateStore(stateDbPath);
    try {
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath: "/tmp/wt",
        branch: "branch",
        specPath: "spec.md",
      });
      const persisted = persistRetainedFinalizationCheckpoint(store, runId, {
        runId,
        kind: "ready_gate_failed",
        iterationsConsumed: 4,
        resumable: true,
        completionAgent: "agent-1",
      });
      expect(persisted).toBe(false);
      expect(store.loadRun(runId)?.retainedFinalizationCheckpoint ?? null).toBeNull();
    } finally {
      store.close();
      rmSync(stateDbPath, { force: true });
    }
  });
});

describe("applyOperatorSessionId", () => {
  test("overwrites caller-supplied operatorSessionId, preserves other telemetry fields", () => {
    const callerTelemetry = { sinkPath: "/tmp/t.jsonl", operatorSessionId: "caller-id", workflow: "w", role: "r" };
    const input: WriteLoopInput = { ...mockWriteLoopInput(), telemetry: callerTelemetry };

    const result = applyOperatorSessionId(input, "minted-id");

    expect(result.telemetry?.operatorSessionId).toBe("minted-id");
    expect(result.telemetry?.sinkPath).toBe(callerTelemetry.sinkPath);
    expect(result.telemetry?.workflow).toBe(callerTelemetry.workflow);
    expect(result.telemetry?.role).toBe(callerTelemetry.role);
  });
});
