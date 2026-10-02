import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openStateStore } from "../persistence/state-store.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import {
  initRepairFenceWorktree,
  registerWriteLoopExecuteWriteMockHooks,
  runLoop,
  runRepairFenceLoop,
  seedFailedRepairFence,
  touchUntouchedRepairEdit,
} from "./write-loop.test-support.ts";

describe("write loop", () => {
  registerWriteLoopExecuteWriteMockHooks();

  describe("ready finalization", () => {
    describe("ready-gate repair fence", () => {
      describe("refusal revert preserves pre-repair dirt", () => {
        async function runWithPreRepairDirt(branchName: string, dirt: (cwd: string) => void) {
          const { jarvisRoot, stateDbPath } = createJarvisHome();
          const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);
          const fenced = await runRepairFenceLoop({
            jarvisRoot,
            stateDbPath,
            branchName,
            baseRef,
            onGateFailure: dirt,
            runFixCommand: async ({ cwd }) => {
              writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "autofix\n", "utf8");
            },
            repairEdit: () => {},
          });
          expect(fenced.result.kind).toBe("completion_commit_failed");
          expect(fenced.result.completionCommitError).toContain("refused paths reverted");
          return { worktreePath, fenced };
        }

        test("an uncommitted out-of-diff operator edit survives while the refused edit is reverted", async () => {
          const { worktreePath, fenced } = await runWithPreRepairDirt("repair-fence-operator-edit", (cwd) => {
            writeFileSync(join(cwd, "README.md"), "operator hand-fix\n", "utf8");
          });
          expect(readFileSync(join(worktreePath, "README.md"), "utf8")).toBe("operator hand-fix\n");
          expect(readFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "utf8")).toBe("export {}\n");
          expect(fenced.result.resumable).toBe(false);
        });

        test("a pre-existing untracked file survives", async () => {
          const { worktreePath } = await runWithPreRepairDirt("repair-fence-operator-untracked", (cwd) => {
            writeFileSync(join(cwd, "operator-notes.txt"), "keep me\n", "utf8");
          });
          expect(readFileSync(join(worktreePath, "operator-notes.txt"), "utf8")).toBe("keep me\n");
          expect(readFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "utf8")).toBe("export {}\n");
        });

        test("a pre-existing dirty file edited further is restored to its pre-repair content, not HEAD", async () => {
          const { worktreePath } = await runWithPreRepairDirt("repair-fence-operator-dirty-edited", (cwd) => {
            writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "operator\n", "utf8");
          });
          expect(readFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "utf8")).toBe("operator\n");
        });

        const operatorBinary = Buffer.from([0xff, 0xfe, 0x00, 0x41]);

        test("a pre-existing dirty binary survives byte-for-byte through autofix discard and a refused repair", async () => {
          const { jarvisRoot, stateDbPath } = createJarvisHome();
          const branchName = "repair-fence-operator-binary";
          const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);
          const fenced = await runRepairFenceLoop({
            jarvisRoot,
            stateDbPath,
            branchName,
            baseRef,
            onGateFailure: (cwd) => writeFileSync(join(cwd, "operator.bin"), operatorBinary),
            runFixCommand: async ({ cwd }) => writeFileSync(join(cwd, "autofix-junk.ts"), "junk\n", "utf8"),
            runAutofixTypecheck: async () => ({ exitCode: 1, output: "typecheck failed" }),
            repairEdit: touchUntouchedRepairEdit,
          });
          expect(fenced.result.kind).toBe("completion_commit_failed");
          expect(fenced.result.completionCommitError).toContain("refused paths reverted");
          expect(readFileSync(join(worktreePath, "operator.bin")).equals(operatorBinary)).toBe(true);
          expect(readFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "utf8")).toBe("export {}\n");
        });

        test("a refused repair edit to a binary file is detected and reverted", async () => {
          const { jarvisRoot, stateDbPath } = createJarvisHome();
          const branchName = "repair-fence-binary-edit";
          const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);
          const fenced = await runRepairFenceLoop({
            jarvisRoot,
            stateDbPath,
            branchName,
            baseRef,
            onGateFailure: (cwd) => writeFileSync(join(cwd, "operator.bin"), operatorBinary),
            runFixCommand: async ({ cwd }) =>
              writeFileSync(join(cwd, "operator.bin"), Buffer.from([0xff, 0xfd, 0x00, 0x41])),
            repairEdit: () => {},
          });
          expect(fenced.result.kind).toBe("completion_commit_failed");
          expect(fenced.result.completionCommitError).toContain("refused paths reverted");
          expect(readFileSync(join(worktreePath, "operator.bin")).equals(operatorBinary)).toBe(true);
        });

        test("an operator hand-fix made before resume survives the resumed attempt", async () => {
          const { jarvisRoot, stateDbPath } = createJarvisHome();
          const branchName = "repair-fence-resume-hand-fix";
          const { baseRef, worktreePath, first } = await seedFailedRepairFence({ jarvisRoot, stateDbPath, branchName });
          const reopened = openStateStore(stateDbPath);
          reopened.setRunStatus(first.result.runId, "completed");
          reopened.close();
          writeFileSync(join(worktreePath, "README.md"), "operator hand-fix\n", "utf8");
          writeFileSync(join(worktreePath, "operator.bin"), operatorBinary);

          const retry = await runLoop({
            jarvisRoot,
            stateDbPath,
            branchName,
            baseRef,
            bindings: [],
            completionCommitter: createCompletionCommitter(),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          });
          expect(retry.runId).toBe(first.result.runId);
          expect(readFileSync(join(worktreePath, "README.md"), "utf8")).toBe("operator hand-fix\n");
          expect(readFileSync(join(worktreePath, "operator.bin")).equals(operatorBinary)).toBe(true);
        });
      });
    });
  });
});
