import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { deriveOperatorIncidents } from "../daemon/operator-incidents.ts";
import { composeRunOperatorError } from "../daemon/run-operator-error.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { stubAgentModelConfig } from "../testing/cli-test-helpers.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import { baseRefProbeFailsSeam, gateFailureOutput, initGateScopeWorktree } from "./ready-finalize.test-support.ts";
import { ReadyGateError } from "./ready-finalize.ts";
import {
  deriveAllowedOrUndefined,
  editLoadSensitiveSliceRepair,
  initIntentMarkdownOnlyRepairFenceWorktree,
  initIntentRepairFenceWorktree,
  initPlanMarkdownOnlyRepairFenceWorktree,
  initPlanRepairFenceWorktree,
  initRepairFenceWorktree,
  intentRepairLoopDefaults,
  planRepairLoopDefaults,
  registerWriteLoopExecuteWriteMockHooks,
  roots,
  runLoop,
  runRepairFenceLoop,
  seedFailedRepairFence,
  TestLogSink,
  touchUntouchedRepairEdit,
} from "./write-loop.test-support.ts";
import {
  admitCoLocatedTestsOfAllowedPaths,
  compareRepoPathsByUtf8Bytes,
  deriveMarkdownOutputRoots,
  enumerateRepairCompletionCandidates,
  escapeRepoPathForEvidence,
  findFirstMarkdownOnlyFenceViolation,
  findFirstRepairFenceViolation,
  validateReadyGateRepairCompletion,
  type WriteLoopInput,
} from "./write-loop.ts";

describe("write loop", () => {
  registerWriteLoopExecuteWriteMockHooks();

  describe("ready finalization", () => {
    describe("ready-gate repair fence", () => {
      test("rejects ready-gate repairs outside the run diff and spec tree", async () => {
        // Mutation checkpoint: remove `!allowedPaths.has(normalized)` rejection in
        // `findFirstRepairFenceViolation`.
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const logSink = new TestLogSink();
        const branchName = "repair-fence-outside";
        const { baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: touchUntouchedRepairEdit,
          logSink,
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(fenced.publishCalls).toBe(2);
        expect(fenced.gateCalls).toBe(2);
        // Mutation checkpoint: the terminal `loop_finished` record must carry the same
        // `completionCommitError` the write loop returns, not merely permit it in the schema.
        expect(logSink.getEventsForRun(fenced.result.runId).at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "completion_commit_failed",
          completionCommitError: fenced.result.completionCommitError,
        });
      });

      test("refused out-of-diff repair edits are reverted so the worktree is clean", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-revert";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);
        const status = () =>
          execFileSync("git", ["-C", worktreePath, "status", "--porcelain"], { encoding: "utf8", stdio: "pipe" });
        const before = status();

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: (cwd) => {
            writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "changed\n", "utf8");
            writeFileSync(join(cwd, "v2/src/new-untracked.ts"), "export {}\n", "utf8");
          },
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toContain("Ready-gate repair stages path outside run diff");
        expect(fenced.result.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(fenced.result.completionCommitError).toContain("v2/src/new-untracked.ts");
        expect(fenced.result.completionCommitError).toContain("refused paths reverted");
        expect(status()).toBe(before);
        expect(readFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "utf8")).toBe("export {}\n");
        expect(existsSync(join(worktreePath, "v2/src/new-untracked.ts"))).toBe(false);
      });

      test("admits a new co-located test of an in-diff production file", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-colocated-test";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          expectedArtifactPath: "v2/src/widget.ts",
          repairEdit: (cwd) => writeFileSync(join(cwd, "v2/src/widget.test.ts"), "export {}\n", "utf8"),
        });

        expect(fenced.result.kind).not.toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toBeUndefined();
        expect(readFileSync(join(worktreePath, "v2/src/widget.test.ts"), "utf8")).toBe("export {}\n");
      });

      describe("admitCoLocatedTestsOfAllowedPaths", () => {
        const noSiblings = () => [];

        test("admits the exact-stem and existing sibling tests of an allowed production path", () => {
          const admitted = admitCoLocatedTestsOfAllowedPaths(new Set(["v2/src/widget.ts"]), "/wt", (dir) =>
            dir === "/wt/v2/src" ? ["widget-render.test.ts", "widget.ts", "other-x.test.ts"] : [],
          );
          expect(findFirstRepairFenceViolation(["v2/src/widget.test.ts"], admitted)).toBeUndefined();
          expect(findFirstRepairFenceViolation(["v2/src/widget-render.test.ts"], admitted)).toBeUndefined();
        });

        test("still refuses an unrelated out-of-diff test", () => {
          const admitted = admitCoLocatedTestsOfAllowedPaths(new Set(["v2/src/widget.ts"]), "/wt", noSiblings);
          expect(findFirstRepairFenceViolation(["v2/src/untouched.test.ts"], admitted)).toBe(
            "v2/src/untouched.test.ts",
          );
        });

        test("still refuses the co-located test of an out-of-diff production file", () => {
          const admitted = admitCoLocatedTestsOfAllowedPaths(new Set(["v2/src/widget.ts"]), "/wt", noSiblings);
          expect(findFirstRepairFenceViolation(["v2/src/other.test.ts"], admitted)).toBe("v2/src/other.test.ts");
          expect(findFirstRepairFenceViolation(["v2/src/other.ts"], admitted)).toBe("v2/src/other.ts");
        });

        test("adds nothing for non-code or test paths", () => {
          const allowed = new Set(["spec.md", "v2/src/widget.test.ts"]);
          expect([...admitCoLocatedTestsOfAllowedPaths(allowed, "/wt", noSiblings)].sort()).toEqual([
            "spec.md",
            "v2/src/widget.test.ts",
          ]);
        });
      });
      test("mixed refusal commits the in-diff edit, reverts the out-of-diff path, and stays resumable", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-mixed-refusal";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);
        const git = (...gitArgs: string[]) =>
          execFileSync("git", ["-C", worktreePath, ...gitArgs], { encoding: "utf8", stdio: "pipe" });
        const headBefore = git("rev-parse", "HEAD").trim();

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: (cwd) => {
            writeFileSync(join(cwd, "proof.txt"), "fixed\n", "utf8");
            writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "changed\n", "utf8");
          },
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.resumable).toBe(true);
        expect(fenced.result.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(fenced.result.completionCommitError).toContain("refused paths reverted");
        expect(git("rev-parse", "HEAD").trim()).not.toBe(headBefore);
        expect(git("show", "--name-only", "--format=", "HEAD").split("\n")).toContain("proof.txt");
        expect(readFileSync(join(worktreePath, "proof.txt"), "utf8")).toBe("fixed\n");
        expect(readFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "utf8")).toBe("export {}\n");
        expect(git("status", "--porcelain")).toBe("");
        const reopened = openStateStore(stateDbPath);
        try {
          expect(reopened.loadRun(fenced.result.runId)?.status).toBe("failed");
        } finally {
          reopened.close();
        }
      });

      test("mixed refusal does not commit in-diff edits that trip the markdown-only fence", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-mixed-markdown";
        const { baseRef, worktreePath } = initIntentRepairFenceWorktree(jarvisRoot, branchName);
        const git = (...gitArgs: string[]) =>
          execFileSync("git", ["-C", worktreePath, ...gitArgs], { encoding: "utf8", stdio: "pipe" });

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          ...intentRepairLoopDefaults,
          repairEdit: (cwd) => {
            writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "changed\n", "utf8");
            writeFileSync(join(cwd, "v2/src/new-untracked.ts"), "export {}\n", "utf8");
          },
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.resumable).toBe(true);
        expect(fenced.result.completionCommitError).toContain("outside markdown workflow output roots");
        expect(fenced.result.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(git("show", "HEAD:v2/src/untouched.test.ts")).toBe("iteration\n");
        expect(existsSync(join(worktreePath, "v2/src/new-untracked.ts"))).toBe(false);
      });

      test("entirely out-of-diff refusal settles non-resumable with an incident naming the refused paths", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-non-resumable";
        const { baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);
        const sink = new TestLogSink();

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          logSink: sink,
          repairEdit: (cwd) => {
            writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "changed\n", "utf8");
            writeFileSync(join(cwd, "v2/src/new-untracked.ts"), "export {}\n", "utf8");
          },
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.resumable).toBe(false);
        const finished = sink.events.find(({ event }) => event.kind === "loop_finished")?.event;
        expect(finished).toMatchObject({ loopOutcomeKind: "completion_commit_failed", resumable: false });

        const reopened = openStateStore(stateDbPath);
        try {
          const run = reopened.loadRun(fenced.result.runId);
          expect(run?.status).toBe("failed");
          expect(run?.terminalCause).toBe("completion_commit_failed");
          if (run === null) throw new Error("expected run");
          const operatorError = composeRunOperatorError(
            { ...run, attempts: run.attempts },
            finished?.kind === "loop_finished"
              ? { runId: fenced.result.runId, seq: 1, ts: "2026-01-01T00:00:00.000Z", event: finished }
              : undefined,
          );
          expect(operatorError?.nextAction).toBe("stop");
          const incident = deriveOperatorIncidents(reopened).find(
            (candidate) => candidate.runId === fenced.result.runId,
          );
          expect(incident?.cause).toBe("failed");
          expect(incident?.detail).toContain("v2/src/untouched.test.ts");
          expect(incident?.detail).toContain("v2/src/new-untracked.ts");
        } finally {
          reopened.close();
        }
      });

      test("a non-resumable completion_commit_failed row does not re-enter as a completed run", async () => {
        // Mutation checkpoint: keying `committedResult`'s re-entry on the terminal cause alone
        // (`run.terminalCause === "completion_commit_failed"`) instead of the durable resumable flag
        // hands this hand-fix-only row back as `kind: "complete"` and replays the publication tail on
        // a row the runbook says `run resume` cannot clear — which re-fails as `completion_commit_failed`
        // instead of the terminal `invocation_failure` the pre-change `failed` row produced.
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-non-resumable-reentry";
        const { baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);
        const sink = new TestLogSink();

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          logSink: sink,
          repairEdit: (cwd) => {
            writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "changed\n", "utf8");
            writeFileSync(join(cwd, "v2/src/new-untracked.ts"), "export {}\n", "utf8");
          },
        });
        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.resumable).toBe(false);

        let published = 0;
        const retry = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          logSink: sink,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            published += 1;
            return {};
          },
          readyFinalizer: async () => {},
        });

        expect(retry.runId).toBe(fenced.result.runId);
        expect(retry.kind).toBe("invocation_failure");
        expect(published).toBe(0);
      });

      test("settles ready_gate_out_of_scope for lint attribution on a path outside the frozen run diff without repair", async () => {
        const outsidePath = "v2/src/untouched.test.ts";
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-lint-outside-envelope";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);
        const logSink = new TestLogSink();

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          lintMdOnly: true,
          gateFailurePath: outsidePath,
          logSink,
          repairEdit: (cwd) => {
            writeFileSync(join(cwd, outsidePath), "repair attempt\n", "utf8");
          },
        });

        expect(fenced.result.kind).toBe("ready_gate_out_of_scope");
        expect(fenced.invocations).toBe(1);
        expect(fenced.publishCalls).toBe(1);
        expect(logSink.getEventsForRun(fenced.result.runId).some((event) => event.kind === "ready_gate_repair")).toBe(
          false,
        );
        expect(readFileSync(join(worktreePath, outsidePath), "utf8")).toBe("export {}\n");
        expect(logSink.getEventsForRun(fenced.result.runId).at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_out_of_scope",
          readyGateOutsidePaths: [outsidePath],
        });
      });

      test("repair refuses a staged path outside the attributable allowset", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-attributable-allowset";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName, {
          touchUntouchedInIteration: true,
        });

        const allowed = await deriveAllowedOrUndefined(
          { worktreePath, baseRef, specPath: "spec.md" },
          { gitUntracked: async () => "\0" },
        );
        expect(allowed?.has("v2/src/untouched.test.ts")).toBe(true);

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          lintMdOnly: true,
          gateFailurePath: "spec.md",
          repairEdit: touchUntouchedRepairEdit,
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toContain(
          "Ready-gate repair stages path outside attributable allowset:",
        );
        expect(fenced.result.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(fenced.result.completionCommitError).toContain("refused paths reverted");
        expect(fenced.publishCalls).toBe(2);
        expect(fenced.gateCalls).toBe(2);
        expect(readFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "utf8")).toBe("iteration\n");
        expect(execFileSync("git", ["-C", worktreePath, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
      });

      test("lint:md-only gate failure answered with a .ts edit is refused without a repair commit", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-lint-md-ts";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName, {
          touchUntouchedInIteration: true,
        });

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          lintMdOnly: true,
          gateFailurePath: "spec.md",
          repairEdit: touchUntouchedRepairEdit,
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(fenced.publishCalls).toBe(2);
        expect(fenced.gateCalls).toBe(2);
        expect(
          execFileSync("git", ["-C", worktreePath, "show", "HEAD:v2/src/untouched.test.ts"], { encoding: "utf8" }),
        ).toBe("iteration\n");
        expect(readFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "utf8")).toBe("iteration\n");
      });

      function stageHarnessSidecarRepairEdit(cwd: string) {
        writeFileSync(join(cwd, ".jarvis-intent-review-verdict.md"), "modified verdict\n", "utf8");
        writeFileSync(join(cwd, ".jarvis-intent-review-verdict.md.owner"), "modified owner\n", "utf8");
      }

      test("rejects ready-gate repairs that would publish harness sidecars", async () => {
        // Mutation checkpoint: remove `basename(normalized).startsWith(".jarvis-")` rejection in
        // `findFirstHarnessSidecarBasenameViolation`.
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-harness-sidecars";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName, {
          harnessSidecars: true,
        });

        const allowed = await deriveAllowedOrUndefined(
          { worktreePath, baseRef, specPath: "spec.md" },
          { gitUntracked: async () => "\0" },
        );
        expect(allowed?.has(".jarvis-intent-review-verdict.md")).toBe(true);
        expect(allowed?.has(".jarvis-intent-review-verdict.md.owner")).toBe(true);

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: stageHarnessSidecarRepairEdit,
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toContain("Ready-gate repair stages harness sidecar:");
        expect(fenced.result.completionCommitError).toContain(".jarvis-intent-review-verdict.md");
        expect(fenced.publishCalls).toBe(2);
        expect(fenced.gateCalls).toBe(2);

        const dirty = execFileSync("git", ["-C", worktreePath, "diff", "--name-only", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        })
          .split("\n")
          .filter(Boolean);
        expect(dirty.some((path) => basename(path).startsWith(".jarvis-"))).toBe(true);
      });

      test("rejects ready-gate repairs that extend LOAD_SENSITIVE_FILES", async () => {
        // Mutation checkpoint: remove staged-vs-HEAD `LOAD_SENSITIVE_FILES` superset check in
        // `validateReadyGateRepairCompletion`.
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-load-sensitive-extend";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName, {
          loadSensitiveSlice: true,
        });

        const allowed = await deriveAllowedOrUndefined(
          { worktreePath, baseRef, specPath: "spec.md" },
          { gitUntracked: async () => "\0" },
        );
        expect(allowed?.has("scripts/test-slice.ts")).toBe(true);

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: (cwd) => {
            editLoadSensitiveSliceRepair(cwd, (content) =>
              content.replace(
                '"v2/src/existing.test.ts",',
                '"v2/src/existing.test.ts",\n  "v2/src/new-load-sensitive.test.ts",',
              ),
            );
          },
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toContain("Ready-gate repair extends LOAD_SENSITIVE_FILES:");
        expect(fenced.result.completionCommitError).toContain("v2/src/new-load-sensitive.test.ts");
        expect(fenced.publishCalls).toBe(2);
        expect(fenced.gateCalls).toBe(2);
      });

      test("membership guard rejects LOAD_SENSITIVE_FILES extension when path fence allows the path", async () => {
        // Mutation checkpoint: remove staged-vs-HEAD `LOAD_SENSITIVE_FILES` superset check in
        // `validateReadyGateRepairCompletion` even when `findFirstRepairFenceViolation` allows
        // `scripts/test-slice.ts`.
        const { jarvisRoot } = createJarvisHome();
        const branchName = "repair-fence-load-sensitive-decoupled";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName, {
          loadSensitiveSlice: true,
        });

        editLoadSensitiveSliceRepair(worktreePath, (content) =>
          content.replace(
            '"v2/src/implement-grown.test.ts",',
            '"v2/src/implement-grown.test.ts",\n  "v2/src/repair-added.test.ts",',
          ),
        );

        const allowedPaths = new Set(["proof.txt", "scripts/test-slice.ts"]);
        const candidates = (await enumerateRepairCompletionCandidates(worktreePath)) ?? [];
        expect(findFirstRepairFenceViolation(candidates, allowedPaths)).toBeUndefined();

        const violation = await validateReadyGateRepairCompletion(
          { worktreePath, baseRef, specPath: "spec.md" },
          allowedPaths,
        );
        expect(violation?.error.message).toContain("Ready-gate repair extends LOAD_SENSITIVE_FILES:");
        expect(violation?.error.message).toContain("v2/src/repair-added.test.ts");
      });

      test("allows ready-gate repairs that edit test-slice without growing LOAD_SENSITIVE_FILES", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-load-sensitive-churn";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName, {
          loadSensitiveSlice: true,
        });

        const allowed = await deriveAllowedOrUndefined(
          { worktreePath, baseRef, specPath: "spec.md" },
          { gitUntracked: async () => "\0" },
        );
        expect(allowed?.has("scripts/test-slice.ts")).toBe(true);

        const headSlice = execFileSync("git", ["-C", worktreePath, "show", "HEAD:scripts/test-slice.ts"], {
          encoding: "utf8",
          stdio: "pipe",
        });
        const baseSlice = execFileSync("git", ["-C", worktreePath, "show", `${baseRef}:scripts/test-slice.ts`], {
          encoding: "utf8",
          stdio: "pipe",
        });
        expect(headSlice).toContain("v2/src/implement-grown.test.ts");
        expect(baseSlice).not.toContain("v2/src/implement-grown.test.ts");

        const { result, gateCalls } = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: (cwd) => {
            editLoadSensitiveSliceRepair(cwd, (content) =>
              content.replace(
                "export const LOAD_SENSITIVE_FILES: readonly string[] = [",
                "export const LOAD_SENSITIVE_FILES: readonly string[] = [\n  // membership unchanged",
              ),
            );
          },
        });

        expect(result.kind).toBe("complete");
        expect(gateCalls).toBe(3);
      });

      test("repair candidate contract covers staged change kinds and excludes unstaged metadata", async () => {
        const parent = trackedMkdtempSync(join(tmpdir(), "repair-fence-candidates-"));
        roots.push(parent);
        const root = join(parent, "main");
        const submoduleRepo = join(parent, "submodule-repo");
        mkdirSync(root, { recursive: true });
        mkdirSync(submoduleRepo, { recursive: true });
        execFileSync("git", ["init"], { cwd: submoduleRepo, stdio: "pipe" });
        execFileSync("git", ["-C", submoduleRepo, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", submoduleRepo, "config", "user.name", "Test User"], { stdio: "pipe" });
        writeFileSync(join(submoduleRepo, "README.md"), "submodule\n", "utf8");
        execFileSync("git", ["-C", submoduleRepo, "add", "README.md"], { stdio: "pipe" });
        execFileSync("git", ["-C", submoduleRepo, "commit", "-m", "submodule seed"], { stdio: "pipe" });

        execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
        execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", root, "config", "user.name", "Test User"], { stdio: "pipe" });
        writeFileSync(join(root, "tracked.txt"), "keep\n", "utf8");
        writeFileSync(join(root, "delete-me.txt"), "gone\n", "utf8");
        writeFileSync(join(root, "rename-old.txt"), "rename\n", "utf8");
        writeFileSync(join(root, "link-target.txt"), "target\n", "utf8");
        writeFileSync(join(root, ".gitignore"), "ignored-tracked.txt\n", "utf8");
        writeFileSync(join(root, "ignored-tracked.txt"), "was ignored\n", "utf8");
        execFileSync(
          "git",
          ["-c", "protocol.file.allow=always", "-C", root, "submodule", "add", submoduleRepo, "libs/mod"],
          { stdio: "pipe" },
        );
        execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
        execFileSync("git", ["-C", root, "commit", "-m", "seed"], { stdio: "pipe" });

        writeFileSync(join(root, "added.txt"), "new\n", "utf8");
        writeFileSync(join(root, "tracked.txt"), "changed\n", "utf8");
        unlinkSync(join(root, "delete-me.txt"));
        execFileSync("git", ["-C", root, "mv", "rename-old.txt", "rename-new.txt"], { stdio: "pipe" });
        writeFileSync(join(root, "ignored-tracked.txt"), "tracked ignored change\n", "utf8");
        const unusualName = "weird\u0001name.txt";
        writeFileSync(join(root, unusualName), "odd\n", "utf8");
        unlinkSync(join(root, "link-target.txt"));
        symlinkSync("tracked.txt", join(root, "link-target.txt"));
        writeFileSync(join(root, "libs/mod/README.md"), "submodule changed\n", "utf8");
        execFileSync("git", ["-C", join(root, "libs/mod"), "config", "user.email", "test@example.com"], {
          stdio: "pipe",
        });
        execFileSync("git", ["-C", join(root, "libs/mod"), "config", "user.name", "Test User"], { stdio: "pipe" });
        execFileSync("git", ["-C", join(root, "libs/mod"), "add", "README.md"], { stdio: "pipe" });
        execFileSync("git", ["-C", join(root, "libs/mod"), "commit", "-m", "submodule change"], { stdio: "pipe" });
        execFileSync("git", ["-C", root, "add", "libs/mod"], { stdio: "pipe" });
        writeFileSync(join(root, ".git", "COMMIT_EDITMSG"), "metadata\n", "utf8");

        const candidates = await enumerateRepairCompletionCandidates(root);
        expect(candidates).toBeDefined();
        expect(candidates).toEqual(
          expect.arrayContaining([
            "added.txt",
            "tracked.txt",
            "delete-me.txt",
            "rename-old.txt",
            "rename-new.txt",
            unusualName,
            "link-target.txt",
            "libs/mod",
          ]),
        );
        expect(candidates).not.toEqual(expect.arrayContaining([".git/COMMIT_EDITMSG"]));

        const allowed = new Set(["added.txt", "tracked.txt", "outside.txt"]);
        expect(findFirstRepairFenceViolation(["z/outside.txt", "a/outside.txt"], allowed)).toBe("a/outside.txt");
        expect(findFirstRepairFenceViolation(["b/outside.txt", "a/outside.txt"], allowed)).toBe("a/outside.txt");
        expect(escapeRepoPathForEvidence("a\nb")).toBe("a\\nb");
        expect(compareRepoPathsByUtf8Bytes("b", "a")).toBeGreaterThan(0);
      });

      test("repair completion candidates omit unchanged tracked paths the stage pathspec excludes", async () => {
        const root = trackedMkdtempSync(join(tmpdir(), "repair-fence-excluded-tracked-"));
        roots.push(root);
        execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
        execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", root, "config", "user.name", "Test User"], { stdio: "pipe" });
        mkdirSync(join(root, "v1/spec/completed/old"), { recursive: true });
        writeFileSync(join(root, "v1/spec/completed/old/verdict-patch.md"), "frozen\n", "utf8");
        writeFileSync(join(root, "tracked.txt"), "base\n", "utf8");
        execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
        execFileSync("git", ["-C", root, "commit", "-m", "seed"], { stdio: "pipe" });

        expect(await enumerateRepairCompletionCandidates(root)).toEqual([]);
        expect(
          await validateReadyGateRepairCompletion({ worktreePath: root, baseRef: "HEAD", specPath: "spec" }, new Set()),
        ).toBe(undefined);

        writeFileSync(join(root, "tracked.txt"), "changed\n", "utf8");
        expect(await enumerateRepairCompletionCandidates(root)).toEqual(["tracked.txt"]);
      });

      test("repair completion candidates omit the harness-materialized node_modules symlink", async () => {
        const root = trackedMkdtempSync(join(tmpdir(), "repair-fence-node-modules-"));
        roots.push(root);
        execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
        execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", root, "config", "user.name", "Test User"], { stdio: "pipe" });
        writeFileSync(join(root, "tracked.txt"), "keep\n", "utf8");
        execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
        execFileSync("git", ["-C", root, "commit", "-m", "seed"], { stdio: "pipe" });

        writeFileSync(join(root, "tracked.txt"), "changed\n", "utf8");
        symlinkSync("/nonexistent-target-for-test", join(root, "node_modules"));

        const candidates = (await enumerateRepairCompletionCandidates(root)) ?? [];
        expect(candidates).toContain("tracked.txt");
        expect(candidates).not.toContain("node_modules");
      });

      test("completes repair limited to an existing run-diff path", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-run-diff";
        const { baseRef } = initGateScopeWorktree(jarvisRoot, branchName);

        const { result, gateCalls } = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: (cwd) => {
            writeFileSync(join(cwd, "proof.txt"), "fixed\n", "utf8");
          },
        });

        expect(result.kind).toBe("complete");
        expect(gateCalls).toBe(3);

        const reopened = openStateStore(stateDbPath);
        const persisted = reopened.loadRun(result.runId);
        expect(persisted?.readyGateRepairFence?.outcomeKind).toBe("frozen");
        expect(persisted?.readyGateRepairFence?.offendingPath).toBeUndefined();
        reopened.close();

        const withoutRunDiff = await deriveAllowedOrUndefined(
          { worktreePath: join(jarvisRoot, "worktrees", "demo", branchName), baseRef, specPath: "spec.md" },
          { gitUntracked: async () => "\0", gitDiffNameStatus: async () => "\0" },
        );
        const violation = findFirstRepairFenceViolation(["proof.txt"], withoutRunDiff ?? new Set());
        expect(violation).toBe("proof.txt");
      });

      test("completes repair limited to the resolved spec tree", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-spec-tree";
        const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
        mkdirSync(join(worktreePath, "spec"), { recursive: true });
        execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
        writeFileSync(join(worktreePath, "spec/index.md"), "- [ ] work\n", "utf8");
        writeFileSync(join(worktreePath, "spec/01-task.md"), "- [ ] task\n", "utf8");
        writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
        execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
        const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
        execFileSync("git", ["-C", worktreePath, "add", "proof.txt"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "commit", "-m", "iteration"], { stdio: "pipe" });

        const withoutSpecTree = await deriveAllowedOrUndefined(
          { worktreePath, baseRef, specPath: "spec/index.md" },
          { gitUntracked: async () => "\0", listSpecTreePaths: async () => [] },
        );
        expect(findFirstRepairFenceViolation(["spec/01-task.md"], withoutSpecTree ?? new Set())).toBe(
          "spec/01-task.md",
        );

        let gateCalls = 0;
        let invocations = 0;
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          specPath: "spec/index.md",
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                if (invocations === 1) {
                  writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                } else {
                  writeFileSync(join(cwd, "spec/01-task.md"), "- [x] task\n", "utf8");
                }
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          runFixCommand: async () => {},
          readyFinalizer: async () => {
            gateCalls += 1;
            if (invocations === 1) {
              throw new ReadyGateError("bun run ready", 1, gateFailureOutput("spec/01-task.md"));
            }
          },
        });

        expect(result.kind).toBe("complete");
        expect(gateCalls).toBe(3);
      });

      const RESUME_WORKFLOW_SNAPSHOT: WriteLoopInput["workflowSnapshot"] = {
        invocationId: "repair-fence-resume",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "Return exactly one terminal token.",
            expectedArtifactPath: "proof.txt",
            agents: ["sim-agent-1"],
            agentModelConfig: stubAgentModelConfig(["sim"]),
          },
        ],
      };

      test("completed-run retry on an implement workflow still rejects a path outside the run diff", async () => {
        // Guards the run-diff allowset layer on the recovery path. Mutation checkpoint: removing
        // the `!allowedPaths.has(normalized)` rejection in `findFirstRepairFenceViolation` must
        // turn this RED. Without an implement-shaped fixture here the staged path is inside the
        // intent run diff, so only the markdown layer rejects it and this layer goes unguarded.
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-retry-implement-run-diff";
        const { baseRef, worktreePath, first } = await seedFailedRepairFence({ jarvisRoot, stateDbPath, branchName });

        const reopened = openStateStore(stateDbPath);
        const persisted = reopened.loadRun(first.result.runId);
        expect(persisted?.readyGateRepairFence?.offendingPath).toBe("v2/src/untouched.test.ts");
        expect(persisted?.readyGateRepairFence?.markdownOnly).not.toBe(true);
        // Entirely refused edits settle non-resumable; recovery guards rows still retryable (e.g. a mixed refusal).
        reopened.setRunStatus(first.result.runId, "completed");
        reopened.close();
        // The refused edit was reverted; re-dirty the tree so recovery has something to fence.
        touchUntouchedRepairEdit(worktreePath);

        let publishCalls = 0;
        const retry = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            publishCalls += 1;
            return {};
          },
          readyFinalizer: async () => {},
        });
        expect(retry.kind).toBe("completion_commit_failed");
        expect(retry.runId).toBe(first.result.runId);
        expect(retry.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(publishCalls).toBe(0);
      });

      test("completed-run retry after restart retains frozen allowset and rejects dirty path", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-retry";
        const { baseRef, first } = await seedFailedRepairFence({
          jarvisRoot,
          stateDbPath,
          branchName,
          intentShaped: true,
        });
        expect(first.publishCalls).toBe(2);

        const reopened = openStateStore(stateDbPath);
        const persisted = reopened.loadRun(first.result.runId);
        expect(persisted?.readyGateRepairFence?.allowedPaths).toEqual(
          expect.arrayContaining(["v2/src/untouched.test.ts"]),
        );
        expect(persisted?.readyGateRepairFence?.markdownOutputRoots).toEqual(
          expect.arrayContaining(["ready-intents", ".jarvis-intent-stage"]),
        );
        expect(persisted?.readyGateRepairFence?.markdownOnly).toBe(true);
        expect(persisted?.readyGateRepairFence?.offendingPath).toBe("v2/src/untouched.test.ts");
        expect(persisted?.readyGateRepairFence?.outcomeKind).toBe("completion_commit_failed");
        reopened.close();

        let publishCalls = 0;
        const retry = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            publishCalls += 1;
            return {};
          },
          readyFinalizer: async () => {},
        });
        expect(retry.kind).toBe("completion_commit_failed");
        expect(retry.runId).toBe(first.result.runId);
        expect(retry.completionCommitError).toContain(
          "Ready-gate repair stages path outside markdown workflow output roots:",
        );
        expect(retry.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(publishCalls).toBe(0);
      });

      test("completed-run retry rejects staged harness sidecars through the persisted fence", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-sidecar-retry";
        const { baseRef } = initRepairFenceWorktree(jarvisRoot, branchName, { harnessSidecars: true });

        const first = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: stageHarnessSidecarRepairEdit,
        });
        expect(first.result.kind).toBe("completion_commit_failed");

        let publishCalls = 0;
        const retry = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            publishCalls += 1;
            return {};
          },
          readyFinalizer: async () => {},
        });
        expect(retry.kind).toBe("completion_commit_failed");
        expect(retry.runId).toBe(first.result.runId);
        expect(retry.completionCommitError).toContain("Ready-gate repair stages harness sidecar:");
        expect(retry.completionCommitError).toContain(".jarvis-intent-review-verdict.md");
        expect(publishCalls).toBe(0);
      });

      test("jarvis run resume cannot commit rejected path after restart", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-resume";
        const { baseRef, first } = await seedFailedRepairFence({
          jarvisRoot,
          stateDbPath,
          branchName,
          stepId: "implement",
          workflowSnapshot: RESUME_WORKFLOW_SNAPSHOT,
          intentShaped: true,
        });

        let publishCalls = 0;
        const resumed = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          stepId: "implement",
          workflowSnapshot: RESUME_WORKFLOW_SNAPSHOT,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            publishCalls += 1;
            return {};
          },
          readyFinalizer: async () => {},
        });
        expect(resumed.kind).toBe("completion_commit_failed");
        expect(resumed.runId).toBe(first.result.runId);
        expect(resumed.completionCommitError).toContain(
          "Ready-gate repair stages path outside markdown workflow output roots:",
        );
        expect(resumed.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(publishCalls).toBe(0);
      });

      test("completed-run retry fails closed when persisted markdown roots are missing on markdown-only run", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-retry-missing-markdown-roots";
        const { baseRef, first } = await seedFailedRepairFence({
          jarvisRoot,
          stateDbPath,
          branchName,
          intentShaped: true,
        });

        const reopened = openStateStore(stateDbPath);
        const persisted = reopened.loadRun(first.result.runId);
        reopened.setReadyGateRepairFence(first.result.runId, {
          allowedPaths: [...(persisted?.readyGateRepairFence?.allowedPaths ?? [])],
          markdownOnly: true,
          ...(persisted?.readyGateRepairFence?.offendingPath !== undefined
            ? { offendingPath: persisted.readyGateRepairFence.offendingPath }
            : {}),
          outcomeKind: "completion_commit_failed",
        });
        reopened.close();

        let publishCalls = 0;
        const retry = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            publishCalls += 1;
            return {};
          },
          readyFinalizer: async () => {},
        });
        expect(retry.kind).toBe("completion_commit_failed");
        expect(retry.runId).toBe(first.result.runId);
        expect(retry.completionCommitError).toContain(
          "Ready-gate repair fence could not reconstruct persisted markdown workflow output roots",
        );
        expect(publishCalls).toBe(0);

        const bypassed = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: async () => ({ commitSha: "commit-retry", filesChanged: 1 }),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
          persistedRepairFenceEnforcer: async () => undefined,
        });
        expect(bypassed.kind).toBe("complete");
      });

      test("jarvis run resume fails closed when persisted markdown roots are empty on markdown-only run", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-resume-empty-markdown-roots";
        const { baseRef, first } = await seedFailedRepairFence({
          jarvisRoot,
          stateDbPath,
          branchName,
          stepId: "implement",
          workflowSnapshot: RESUME_WORKFLOW_SNAPSHOT,
          intentShaped: true,
        });

        const reopened = openStateStore(stateDbPath);
        const persisted = reopened.loadRun(first.result.runId);
        reopened.setReadyGateRepairFence(first.result.runId, {
          allowedPaths: [...(persisted?.readyGateRepairFence?.allowedPaths ?? [])],
          markdownOnly: true,
          markdownOutputRoots: [],
          ...(persisted?.readyGateRepairFence?.offendingPath !== undefined
            ? { offendingPath: persisted.readyGateRepairFence.offendingPath }
            : {}),
          outcomeKind: "completion_commit_failed",
        });
        reopened.close();

        let publishCalls = 0;
        const resumed = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          stepId: "implement",
          workflowSnapshot: RESUME_WORKFLOW_SNAPSHOT,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            publishCalls += 1;
            return {};
          },
          readyFinalizer: async () => {},
        });
        expect(resumed.kind).toBe("completion_commit_failed");
        expect(resumed.runId).toBe(first.result.runId);
        expect(resumed.completionCommitError).toContain(
          "Ready-gate repair fence could not reconstruct persisted allowset",
        );
        expect(publishCalls).toBe(0);
      });

      test("recovery regressions fail when persisted-fence validation is bypassed", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-bypass";
        const { baseRef, first } = await seedFailedRepairFence({
          jarvisRoot,
          stateDbPath,
          branchName,
          intentShaped: true,
        });

        const reopened = openStateStore(stateDbPath);
        const persisted = reopened.loadRun(first.result.runId);
        expect(persisted?.readyGateRepairFence?.allowedPaths).toContain("v2/src/untouched.test.ts");
        expect(persisted?.readyGateRepairFence?.markdownOutputRoots).toEqual(
          expect.arrayContaining(["ready-intents", ".jarvis-intent-stage"]),
        );
        expect(persisted?.readyGateRepairFence?.markdownOnly).toBe(true);
        // Mutation checkpoint: remove `.endsWith(".md")` / under-root rejection in
        // `findFirstMarkdownOnlyFenceViolation`.
        const withoutMarkdownFence = findFirstMarkdownOnlyFenceViolation(
          ["v2/src/untouched.test.ts"],
          persisted?.readyGateRepairFence?.markdownOutputRoots ?? [],
        );
        expect(withoutMarkdownFence).toBe("v2/src/untouched.test.ts");
        reopened.close();

        const fenced = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });
        expect(fenced.kind).toBe("completion_commit_failed");

        const bypassed = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: async () => ({ commitSha: "commit-retry", filesChanged: 1 }),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
          persistedRepairFenceEnforcer: async () => undefined,
        });
        expect(bypassed.kind).toBe("complete");

        const corruptStore = openStateStore(stateDbPath);
        corruptStore.setReadyGateRepairFence(first.result.runId, {
          allowedPaths: "not-an-array" as unknown as string[],
          outcomeKind: "completion_commit_failed",
        });
        const corruptRun = corruptStore.loadRun(first.result.runId);
        corruptStore.close();
        expect(corruptRun?.readyGateRepairFenceCorrupt).toBe(true);

        const corruptRetry = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });
        expect(corruptRetry.kind).toBe("completion_commit_failed");
        expect(corruptRetry.completionCommitError).toContain("could not reconstruct persisted allowset");
      });

      test.each([
        [
          "source",
          "repair-fence-intent-source",
          "v2/src/untouched.test.ts",
          (cwd: string) => writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "changed\n", "utf8"),
        ],
        [
          "script",
          "repair-fence-intent-script",
          "scripts/helper.ts",
          (cwd: string) => writeFileSync(join(cwd, "scripts/helper.ts"), "changed\n", "utf8"),
        ],
        [
          "test",
          "repair-fence-intent-test",
          "v1/test/sample.test.ts",
          (cwd: string) => writeFileSync(join(cwd, "v1/test/sample.test.ts"), "changed\n", "utf8"),
        ],
      ])("rejects ready-gate repair staging a %s-path edit on intent workflow", async (_surface, branchName, offendingPath, repairEdit) => {
        // Mutation checkpoint: remove `.endsWith(".md")` / under-root rejection in
        // `findFirstMarkdownOnlyFenceViolation`.
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const { baseRef } = initIntentRepairFenceWorktree(jarvisRoot, branchName);

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          ...intentRepairLoopDefaults,
          repairEdit,
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toContain(
          "Ready-gate repair stages path outside markdown workflow output roots:",
        );
        expect(fenced.result.completionCommitError).toContain(offendingPath);
        expect(fenced.publishCalls).toBe(2);
        expect(fenced.gateCalls).toBe(2);
      });

      test("rejects ready-gate repair staging a source-path edit on plan workflow", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-plan-source";
        const { baseRef } = initPlanRepairFenceWorktree(jarvisRoot, branchName);

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          ...planRepairLoopDefaults,
          repairEdit: (cwd) => {
            writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "changed\n", "utf8");
          },
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toContain(
          "Ready-gate repair stages path outside markdown workflow output roots:",
        );
        expect(fenced.result.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(fenced.publishCalls).toBe(2);
        expect(fenced.gateCalls).toBe(2);
      });

      test("completes ready-gate repair limited to markdown under intent output roots", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-intent-markdown";
        const { baseRef } = initIntentRepairFenceWorktree(jarvisRoot, branchName);

        const { result, gateCalls } = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          ...intentRepairLoopDefaults,
          repairEdit: (cwd) => {
            writeFileSync(join(cwd, "ready-intents", "seed.md"), "# fixed\n", "utf8");
          },
        });

        expect(result.kind).toBe("complete");
        expect(gateCalls).toBe(3);

        const withoutMarkdownFence = findFirstMarkdownOnlyFenceViolation(
          ["v2/src/untouched.test.ts"],
          deriveMarkdownOutputRoots({
            promptId: undefined,
            specPath: intentRepairLoopDefaults.specPath,
            expectedArtifactPath: intentRepairLoopDefaults.expectedArtifactPath,
            landing: intentRepairLoopDefaults.landing,
          }) ?? [],
        );
        expect(withoutMarkdownFence).toBe("v2/src/untouched.test.ts");
      });

      test("markdown-only plan completion settles outside-diff ready gate", async () => {
        const outsidePath = "v2/src/untouched.test.ts";
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "markdown-only-plan-outside-diff-gate";
        const logSink = new TestLogSink();
        const { baseRef } = initPlanMarkdownOnlyRepairFenceWorktree(jarvisRoot, branchName);

        const { result } = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          ...planRepairLoopDefaults,
          gateFailurePath: outsidePath,
          lintMdOnly: false,
          readyGateScopeSeams: baseRefProbeFailsSeam,
          logSink,
          repairEdit: touchUntouchedRepairEdit,
        });

        expect(result.kind).toBe("ready_gate_out_of_scope");
        expect(result.resumable).toBe(false);
        expect(logSink.getEventsForRun(result.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual([]);
        expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_out_of_scope",
          resumable: false,
          readyGateOutsidePaths: [outsidePath],
        });
      });

      test("markdown-only intent completion settles outside-diff ready gate", async () => {
        const outsidePath = "v2/src/untouched.test.ts";
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "markdown-only-intent-outside-diff-gate";
        const logSink = new TestLogSink();
        const { baseRef } = initIntentMarkdownOnlyRepairFenceWorktree(jarvisRoot, branchName);

        const { result } = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          ...intentRepairLoopDefaults,
          gateFailurePath: outsidePath,
          lintMdOnly: false,
          readyGateScopeSeams: baseRefProbeFailsSeam,
          logSink,
          repairEdit: touchUntouchedRepairEdit,
        });

        expect(result.kind).toBe("ready_gate_out_of_scope");
        expect(result.resumable).toBe(false);
        expect(logSink.getEventsForRun(result.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual([]);
        expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_out_of_scope",
          resumable: false,
          readyGateOutsidePaths: [outsidePath],
        });
      });
    });
  });
});
