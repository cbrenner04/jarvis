import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogEvent, PersistedRecord } from "../persistence/log-stream.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { registerWriteLoopExecuteWriteMockHooks, roots, runLoop } from "./write-loop.test-support.ts";
import { findDraftContractRepromptStateFromLog } from "./write-loop.ts";

describe("write loop", () => {
  registerWriteLoopExecuteWriteMockHooks();

  describe("external implement adapter read dirs and subspec access", () => {
    function writeExternalImplementFixture(): {
      specReadRoot: string;
      externalSubspec: string;
      criterion: string;
    } {
      const specReadRoot = trackedMkdtempSync(join(tmpdir(), "write-loop-external-spec-"));
      roots.push(specReadRoot);
      const criterion = "external criterion satisfied";
      const externalSubspec = join(specReadRoot, "00-work.md");
      writeFileSync(join(specReadRoot, "index.md"), "- [ ] [Work](./00-work.md)\n", "utf8");
      writeFileSync(externalSubspec, `# Work\n\n## Acceptance criteria\n\n- [ ] ${criterion}\n`, "utf8");
      return {
        specReadRoot: realpathSync(specReadRoot),
        externalSubspec: realpathSync(externalSubspec),
        criterion,
      };
    }

    test("passes specReadRoot as additionalReadDirs and completes when external subspec criteria are ticked from worktree cwd", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const { specReadRoot, externalSubspec, criterion } = writeExternalImplementFixture();
      let observedAdditionalReadDirs: readonly string[] | undefined;
      let observedCwd = "";

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        promptId: "implement.prompt.body",
        specPath: join(specReadRoot, "index.md"),
        artifactPath: externalSubspec,
        externalPlanSpec: true,
        specReadRoot,
        bindings: [
          {
            id: "external-implement",
            invoke: async ({ cwd, additionalReadDirs }) => {
              observedCwd = cwd;
              observedAdditionalReadDirs = additionalReadDirs;
              writeFileSync(externalSubspec, `# Work\n\n## Acceptance criteria\n\n- [x] ${criterion}\n`, "utf8");
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
      });

      const worktreePath = join(jarvisRoot, "worktrees", "demo", "write-run");
      expect(observedCwd).toBe(worktreePath);
      expect(observedAdditionalReadDirs).toEqual([specReadRoot]);
      expect(result.kind).toBe("complete");
    });

    test("contract_miss appends blocker to external active subspec when expectedArtifactPath is absolute", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const { specReadRoot, externalSubspec, criterion } = writeExternalImplementFixture();
      const worktreePath = join(jarvisRoot, "worktrees", "demo", "write-run");
      mkdirSync(worktreePath, { recursive: true });
      const decoySubspec = join(worktreePath, "00-work.md");
      writeFileSync(decoySubspec, `# Decoy\n\n## Acceptance criteria\n\n- [ ] ${criterion}\n`, "utf8");

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        promptId: "implement.prompt.body",
        specPath: join(specReadRoot, "index.md"),
        artifactPath: externalSubspec,
        externalPlanSpec: true,
        specReadRoot,
        bindings: [{ id: "external-implement", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      });

      expect(result.kind).toBe("contract_miss");
      const externalContent = readFileSync(externalSubspec, "utf8");
      expect(externalContent).toContain("## Blocker");
      expect(externalContent).toContain(criterion);
      const decoyContent = readFileSync(decoySubspec, "utf8");
      expect(decoyContent).not.toContain("## Blocker");
    });
  });

  describe("findDraftContractRepromptStateFromLog", () => {
    function fakeRecords(events: readonly LogEvent[]): PersistedRecord[] {
      return events.map((event, index) => ({
        runId: "fake-run",
        seq: index + 1,
        ts: new Date(index).toISOString(),
        event,
      }));
    }

    test("no draft_contract_reprompt event yields no spent allowance", () => {
      expect(findDraftContractRepromptStateFromLog(undefined)).toEqual({ spent: false });
      expect(findDraftContractRepromptStateFromLog([])).toEqual({ spent: false });
    });

    test("a settled repair iteration reports spent with no pending context", () => {
      const records = fakeRecords([
        { kind: "draft_contract_reprompt", attemptId: "a1", contractId: "artifact.exists", detail: "x" },
        { kind: "iteration_started", attemptId: "a2" },
        { kind: "boundary_committed", attemptId: "a2", outcomeKind: "progress", runStatus: "in-progress" },
      ]);
      expect(findDraftContractRepromptStateFromLog(records)).toEqual({ spent: true });
    });

    test("an interrupted repair attempt with no matching boundary_committed stays pending", () => {
      const records = fakeRecords([
        { kind: "draft_contract_reprompt", attemptId: "a1", contractId: "artifact.exists", detail: "x" },
        { kind: "iteration_started", attemptId: "a2" },
      ]);
      expect(findDraftContractRepromptStateFromLog(records)).toEqual({
        spent: true,
        pending: { contractId: "artifact.exists", detail: "x" },
      });
    });

    test("a repair event with no subsequent iteration stays pending (paused/aborted before the repair began)", () => {
      const records = fakeRecords([
        { kind: "draft_contract_reprompt", attemptId: "a1", contractId: "artifact.exists", detail: "x" },
      ]);
      expect(findDraftContractRepromptStateFromLog(records)).toEqual({
        spent: true,
        pending: { contractId: "artifact.exists", detail: "x" },
      });
    });
  });
});
