import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_STEP_BUDGET_MS } from "../../../scripts/ready.ts";
import * as sharedGit from "../shared/git.ts";
import * as realInvocationExecute from "../shared/invocation/execute.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import type { LoopFinishedEvent } from "../persistence/log-stream.ts";
import { INVALID_TOKEN_LOG_MAX_CHARS, truncateLogText } from "../persistence/log-stream.ts";
import { type OutcomeKind, openStateStore, type StateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import { renderAttribution } from "./pr-attribution.ts";
import { ReadyGateError } from "./ready-finalize.ts";
import type { StepRunResult } from "./step-runner.ts";
import * as realUncoveredChangedLines from "./uncovered-changed-lines.ts";
import { executeWrite as realExecuteWrite, type WriteExecuteInput } from "./write.ts";
import {
  CLEAN_MARKDOWNLINT_RUNNER,
  fastCeilingSchedule,
  loadRunOnce,
  registerWriteLoopExecuteWriteMockHooks,
  roots,
  runLoop,
  TestLogSink,
} from "./write-loop.test-support.ts";
import {
  acquireGateInvocationLease,
  getUncommittedPaths,
  executeWriteLoop as invokeWriteLoop,
  shouldFailTerminalCompletionForDirtyWorktree,
  type WriteLoopInput,
} from "./write-loop.ts";

function executeWriteLoop(input: WriteLoopInput): ReturnType<typeof invokeWriteLoop> {
  return invokeWriteLoop({
    ...input,
    stagedMarkdownLintRunner: input.stagedMarkdownLintRunner ?? CLEAN_MARKDOWNLINT_RUNNER,
  });
}

function restoreCoverageModuleMocks(): void {
  mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
  mock.module("./uncovered-changed-lines.ts", () => realUncoveredChangedLines);
  mock.module("../shared/invocation/execute.ts", () => realInvocationExecute);
}

describe.serial("write loop", () => {
  registerWriteLoopExecuteWriteMockHooks();
  afterEach(() => {
    restoreCoverageModuleMocks();
  });

  describe("coverage advisory on implement write completion", () => {
    function completingWriteStub(worktreePath: string): Awaited<ReturnType<typeof realExecuteWrite>> {
      return {
        worktreePath,
        worktreeReused: false,
        lock: { kind: "acquired" },
        result: {
          kind: "complete",
          token: "done",
          invocation: { attempts: [], final: null, telemetryFailures: [] },
        },
      };
    }

    test("runs advisory with uncovered sites and logs response before terminal boundary", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const logSink = new TestLogSink();

      const advisoryResponses: string[] = [];
      const advisoryCalls: string[] = [];
      const stubResult = completingWriteStub(join(jarvisRoot, "worktrees", "demo", "advisory-run"));

      mock.module("./write.ts", () => ({
        executeWrite: async () => stubResult,
      }));

      mock.module("./uncovered-changed-lines.ts", () => ({
        reportUncoveredChangedLines: async () => {
          advisoryCalls.push("coverage-reporter");
          return {
            uncoveredSites: [
              { file: "v2/src/foo.ts", line: 10 },
              { file: "v2/src/bar.ts", line: 20 },
            ],
            reportText: "Uncovered changed lines (execution count is zero):\nv2/src/bar.ts:20\nv2/src/foo.ts:10",
          };
        },
      }));

      mock.module("../shared/invocation/execute.ts", () => ({
        executeWithQuotaFallback: async (input: {
          prompt?: string;
          cwd?: string;
          bindings?: unknown;
          signal?: AbortSignal;
          idleOutputMs?: number;
          telemetry?: unknown;
          sessionLog?: unknown;
        }) => {
          advisoryResponses.push(input.prompt ?? "");
          return {
            attempts: [],
            final: { result: { kind: "ok", stdout: "Coverage noted.\n" }, binding: { id: "b1", metadata: {} } },
            telemetryFailures: [],
          };
        },
      }));

      try {
        const result = await executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: "advisory-run",
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "spec.md",
          stepRules: "Return exactly one terminal token.",
          expectedArtifactPath: "proof.txt",
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          logSink,
          promptId: "implement.prompt.body",
        });

        expect(result.kind).toBe("complete");
        expect(advisoryCalls).toHaveLength(1);
        expect(advisoryResponses).toHaveLength(1);

        const events = logSink.getEventsForRun(result.runId);
        const advisoryEvent = events.find((e) => e.kind === "coverage_advisory");
        expect(advisoryEvent).toBeDefined();
        if (advisoryEvent?.kind === "coverage_advisory") {
          expect(advisoryEvent.responseText).toBe("Coverage noted.");
        }

        const boundaryEvent = events.find((e) => e.kind === "boundary_committed");
        expect(boundaryEvent).toBeDefined();

        // Verify advisory comes before boundary
        const advisoryIndex = events.findIndex((e) => e.kind === "coverage_advisory");
        const boundaryIndex = events.findIndex((e) => e.kind === "boundary_committed");
        expect(advisoryIndex).toBeGreaterThanOrEqual(0);
        expect(boundaryIndex).toBeGreaterThanOrEqual(0);
        expect(advisoryIndex).toBeLessThan(boundaryIndex);
      } finally {
        store.close();
        restoreCoverageModuleMocks();
      }
    });

    test("logs coverage_advisory_skipped and skips the re-prompt when the coverage run times out", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const logSink = new TestLogSink();
      const advisoryResponses: string[] = [];
      const verifyInputs: { processGroups?: unknown }[] = [];
      const reporterInputs: { signal?: AbortSignal; processGroups?: unknown }[] = [];
      const stubResult = completingWriteStub(join(jarvisRoot, "worktrees", "demo", "advisory-timeout-run"));

      mock.module("./write.ts", () => ({ executeWrite: async () => stubResult }));
      mock.module("./uncovered-changed-lines.ts", () => ({
        reportUncoveredChangedLines: async (input: { signal?: AbortSignal; processGroups?: unknown }) => {
          reporterInputs.push(input);
          return { uncoveredSites: [], reportText: "", skipReason: "timeout" };
        },
      }));
      mock.module("../shared/invocation/execute.ts", () => ({
        executeWithQuotaFallback: async (input: { prompt?: string }) => {
          advisoryResponses.push(input.prompt ?? "");
          return { attempts: [], final: null, telemetryFailures: [] };
        },
      }));

      try {
        const result = await executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: "advisory-timeout-run",
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "spec.md",
          stepRules: "Return exactly one terminal token.",
          expectedArtifactPath: "proof.txt",
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          logSink,
          promptId: "implement.prompt.body",
          verifyDiffDerivedMutations: async (input) => {
            verifyInputs.push(input);
            return {
              kind: "pass",
              runBase: "HEAD",
              inspectedPaths: [],
              candidateCount: 0,
              acceptedSites: [],
              skippedCandidates: [],
            };
          },
        });

        expect(result.kind).toBe("complete");
        expect(advisoryResponses).toHaveLength(0);
        expect(verifyInputs[0]?.processGroups).toBe(reporterInputs[0]?.processGroups);
        expect(reporterInputs[0]?.processGroups).toBeDefined();
        const events = logSink.getEventsForRun(result.runId);
        expect(events.some((e) => e.kind === "coverage_advisory")).toBe(false);
        const skipped = events.find((e) => e.kind === "coverage_advisory_skipped");
        expect(skipped?.kind === "coverage_advisory_skipped" ? skipped.reason : undefined).toBe("timeout");
      } finally {
        store.close();
        restoreCoverageModuleMocks();
      }
    });

    test("does not increment iterationsConsumed when advisory runs", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);

      const stubResult = completingWriteStub(join(jarvisRoot, "worktrees", "demo", "iter-count-run"));

      mock.module("./write.ts", () => ({
        executeWrite: async () => stubResult,
      }));

      mock.module("./uncovered-changed-lines.ts", () => ({
        reportUncoveredChangedLines: async () => ({
          uncoveredSites: [{ file: "v2/src/foo.ts", line: 10 }],
          reportText: "Uncovered: v2/src/foo.ts:10",
        }),
      }));

      mock.module("../shared/invocation/execute.ts", () => ({
        executeWithQuotaFallback: async () => ({
          attempts: [],
          final: { result: { kind: "ok", stdout: "Noted.\n" }, binding: { id: "b1", metadata: {} } },
          telemetryFailures: [],
        }),
      }));

      try {
        const result = await executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: "iter-count-run",
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "spec.md",
          stepRules: "Return exactly one terminal token.",
          expectedArtifactPath: "proof.txt",
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          promptId: "implement.prompt.body",
        });

        expect(result.kind).toBe("complete");
        expect(result.iterationsConsumed).toBe(1);
      } finally {
        store.close();
        restoreCoverageModuleMocks();
      }
    });

    test("skips advisory when no uncovered sites", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const logSink = new TestLogSink();

      const advisoryInvoked = { called: false };

      const stubResult = completingWriteStub(join(jarvisRoot, "worktrees", "demo", "no-uncovered-run"));

      mock.module("./write.ts", () => ({
        executeWrite: async () => stubResult,
      }));

      mock.module("./uncovered-changed-lines.ts", () => ({
        reportUncoveredChangedLines: async () => {
          advisoryInvoked.called = true;
          return { uncoveredSites: [], reportText: "" };
        },
      }));

      try {
        const result = await executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: "no-uncovered-run",
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "spec.md",
          stepRules: "Return exactly one terminal token.",
          expectedArtifactPath: "proof.txt",
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          logSink,
          promptId: "implement.prompt.body",
        });

        expect(result.kind).toBe("complete");
        expect(advisoryInvoked.called).toBe(true);

        const events = logSink.getEventsForRun(result.runId);
        const advisoryEvent = events.find((e) => e.kind === "coverage_advisory");
        expect(advisoryEvent).toBeUndefined();
      } finally {
        store.close();
        restoreCoverageModuleMocks();
      }
    });

    test("skips advisory for non-implement prompts", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const logSink = new TestLogSink();

      const reporterCalled = { called: false };

      const stubResult = completingWriteStub(join(jarvisRoot, "worktrees", "demo", "non-patch-run"));

      mock.module("./write.ts", () => ({
        executeWrite: async () => stubResult,
      }));

      mock.module("./uncovered-changed-lines.ts", () => ({
        reportUncoveredChangedLines: async () => {
          reporterCalled.called = true;
          return {
            uncoveredSites: [{ file: "v2/src/foo.ts", line: 10 }],
            reportText: "Uncovered: v2/src/foo.ts:10",
          };
        },
      }));

      try {
        const result = await executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: "non-patch-run",
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "spec.md",
          stepRules: "Return exactly one terminal token.",
          expectedArtifactPath: "proof.txt",
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          logSink,
          promptId: "write.execute",
        });

        expect(result.kind).toBe("complete");
        expect(reporterCalled.called).toBe(false);

        const events = logSink.getEventsForRun(result.runId);
        const advisoryEvent = events.find((e) => e.kind === "coverage_advisory");
        expect(advisoryEvent).toBeUndefined();
      } finally {
        store.close();
        restoreCoverageModuleMocks();
      }
    });

    test("coverage-advisory prompt carries report text and states deliver-only", async () => {
      const { loadPromptRegistry } = await import("../shared/prompts/registry.ts");
      const { renderArtifactTemplate } = await import("../shared/prompts/render.ts");

      const registry = loadPromptRegistry();
      const artifact = registry.getById("write.coverage-advisory");

      expect(artifact).toBeDefined();
      expect(artifact.metadata.placeholders).toContainEqual({
        name: "COVERAGE_REPORT",
        type: "string",
        required: true,
      });

      const testReport = "Uncovered changed lines (execution count is zero):\nv2/src/foo.ts:10\n\nNote: ...";
      const rendered = renderArtifactTemplate(artifact, { COVERAGE_REPORT: testReport });

      expect(rendered).toContain(testReport);
      expect(rendered).toContain("deliver-only");
    });
  });

  describe("per-iteration git commit on progress", () => {
    const progressInvocation = {
      attempts: [] as const,
      final: {
        result: { kind: "ok" as const, stdout: "progress", stderr: "" },
        binding: {
          id: "sim.1",
          metadata: { agent: "Test Agent", model: "sim-model" },
        },
      },
      telemetryFailures: [] as const,
    };

    function gitIn(worktreePath: string, args: readonly string[]): string {
      return execFileSync("git", ["-C", worktreePath, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
    }

    function initGitWorktree(jarvisRoot: string, branchName: string): string {
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
      writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
      writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
      return worktreePath;
    }

    const biomeRepoRoot = join(import.meta.dir, "../../..");
    const complexityDirtyRel = "v2/src/complexity-dirty.ts";

    function initRealGitWorktree(
      jarvisRoot: string,
      branchName: string,
      options?: { gitignore?: "node_modules-only" },
    ): string {
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "commit.gpgsign", "false"], { stdio: "pipe" });
      copyFileSync(join(biomeRepoRoot, "biome.json"), join(worktreePath, "biome.json"));
      if (options?.gitignore === "node_modules-only") {
        writeFileSync(join(worktreePath, ".gitignore"), "node_modules/\n", "utf8");
      } else {
        copyFileSync(join(biomeRepoRoot, ".gitignore"), join(worktreePath, ".gitignore"));
      }
      const materializeNodeModulesSymlink = (): void => {
        try {
          symlinkSync(join(biomeRepoRoot, "node_modules"), join(worktreePath, "node_modules"), "dir");
        } catch {
          /* reuse existing symlink */
        }
      };
      if (options?.gitignore !== "node_modules-only") {
        materializeNodeModulesSymlink();
      }
      writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
      mkdirSync(join(worktreePath, "v2/src"), { recursive: true });
      writeFileSync(join(worktreePath, "v2/src/example.ts"), "export const seeded = true;\n");
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
      if (options?.gitignore === "node_modules-only") {
        materializeNodeModulesSymlink();
      }
      return worktreePath;
    }

    function writeComplexityDirty(worktreePath: string): void {
      const branches = Array.from({ length: 26 }, (_, i) => `  if (n === ${i}) return ${i};`).join("\n");
      writeFileSync(
        join(worktreePath, complexityDirtyRel),
        `export function complexityDirty(n: number): number {\n${branches}\n  return -1;\n}\n`,
      );
    }

    function blockedWrite(worktreePath: string) {
      return {
        worktreePath,
        worktreeReused: false as const,
        lock: { kind: "acquired" as const },
        result: {
          kind: "blocked" as const,
          token: "blocked" as const,
          invocation: progressInvocation,
        },
      };
    }

    function progressWrite(worktreePath: string) {
      return {
        worktreePath,
        worktreeReused: false as const,
        lock: { kind: "acquired" as const },
        result: { kind: "progress" as const, token: "progress" as const, invocation: progressInvocation },
      };
    }

    function completeWrite(worktreePath: string) {
      return {
        worktreePath,
        worktreeReused: false as const,
        lock: { kind: "acquired" as const },
        result: { kind: "complete" as const, token: "done" as const, invocation: progressInvocation },
      };
    }

    function iterLoopInput(
      jarvisRoot: string,
      branchName: string,
      store: StateStore,
      extra: Partial<WriteLoopInput> = {},
    ): WriteLoopInput {
      return {
        worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return progress.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["progress"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        completionCommitter: createCompletionCommitter(),
        maxIterations: 5,
        ...extra,
      };
    }

    test("terminal completion reuses the latest settled iteration without adding a marker commit", async () => {
      // Mutation checkpoint: inverting `!statSync(specPath).isDirectory()` must turn this RED.
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-terminal-boundary";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      mkdirSync(join(worktreePath, "spec"), { recursive: true });
      writeFileSync(join(worktreePath, "spec/index.md"), "# Workflow title\n", "utf8");
      writeFileSync(join(worktreePath, "spec/00-active.md"), "# Active subspec\n\n- [ ] task\n", "utf8");
      const store = openStateStore(stateDbPath);
      const seedBase = gitIn(worktreePath, ["rev-parse", "HEAD"]);
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return progress or done.",
            specPath: "spec",
            expectedArtifactPath: "spec/00-active.md",
            promptId: "implement.prompt.body",
            worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef: seedBase, jarvisRoot },
            bindings: simulatedBindings(["progress", "progress", "done"]),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
            verifyDiffDerivedMutations: async (input) => ({
              kind: "pass",
              runBase: input.runBase,
              inspectedPaths: [],
              candidateCount: 0,
              acceptedSites: [],
              skippedCandidates: [],
            }),
          }),
        );

        expect(result.kind).toBe("complete");
        const iterTwoSha = gitIn(worktreePath, ["rev-parse", "HEAD"]);
        const iterOneSha = gitIn(worktreePath, ["rev-parse", "HEAD~1"]);
        expect(new Set([iterTwoSha, iterOneSha]).size).toBe(2);
        expect([
          gitIn(worktreePath, ["show", "-s", "--format=%s", iterOneSha]),
          gitIn(worktreePath, ["show", "-s", "--format=%s", iterTwoSha]),
        ]).toEqual(["Active subspec", "Active subspec 2"]);

        const footer = await renderAttribution({ cwd: worktreePath, base: seedBase });
        expect(footer).toContain(iterOneSha.slice(0, 7));
        expect(footer).toContain(iterTwoSha.slice(0, 7));
        expect(footer).toContain("Test Agent");
        expect(footer).toContain("Written by");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("clean terminal completion at base skips publication after a no-op commit", async () => {
      // Mutation checkpoint: inverting the `shouldPublishSettledHead` empty-diff guard (`length > 0`) must turn this RED.
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-clean-at-base";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      let publishCalls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => completeWrite(worktreePath),
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return done.",
            bindings: simulatedBindings(["done"]),
            completionCommitter: async () => ({}),
            completionPublisher: async () => {
              publishCalls += 1;
              return {};
            },
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("complete");
        expect(publishCalls).toBe(0);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("plan draft and intent split checkpoints use phase subjects", async () => {
      const cases = [
        { branchName: "iter-plan-subject", promptId: "plan.prompt.draft", expected: "plan: draft" },
        {
          branchName: "iter-intent-subject",
          promptId: "intent.prompt.split",
          expected: "intent: split 1 intent",
        },
      ] as const;

      for (const testCase of cases) {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        roots.push(join(jarvisRoot, ".."));
        const worktreePath = initGitWorktree(jarvisRoot, testCase.branchName);
        const store = openStateStore(stateDbPath);
        const titles: string[] = [];

        mock.module("./write.ts", () => ({
          executeWrite: async () => {
            if (testCase.promptId === "intent.prompt.split") {
              const stage = join(worktreePath, ".jarvis-intent-stage");
              mkdirSync(stage, { recursive: true });
              writeFileSync(join(stage, "one.md"), "# One\n");
            } else {
              writeFileSync(join(worktreePath, "draft.txt"), "draft\n");
            }
            return progressWrite(worktreePath);
          },
        }));

        try {
          const result = await executeWriteLoop(
            iterLoopInput(jarvisRoot, testCase.branchName, store, {
              promptId: testCase.promptId,
              expectedArtifactPath:
                testCase.promptId === "intent.prompt.split" ? ".jarvis-intent-stage" : ".jarvis-plan-stage",
              maxIterations: 1,
              completionCommitter: async (input) => {
                titles.push(input.title);
                return { commitSha: "commit-1" };
              },
            }),
          );
          expect(result.kind).toBe("budget-exhausted");
          expect(titles).toEqual([testCase.expected]);
        } finally {
          store.close();
          mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
        }
      }
    });

    test("phase subject ordinals count baseRef..HEAD commits, not attempt count", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-plan-subject-ordinal";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const baseRef = gitIn(worktreePath, ["rev-parse", "HEAD"]);
      execFileSync("git", ["-C", worktreePath, "commit", "--allow-empty", "-m", "plan: draft"], { stdio: "pipe" });
      const store = openStateStore(stateDbPath);
      const titles: string[] = [];
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls < 3) return progressWrite(worktreePath);
          writeFileSync(join(worktreePath, "draft-2.txt"), "x\n");
          return progressWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            promptId: "plan.prompt.draft",
            expectedArtifactPath: ".jarvis-plan-stage",
            worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef, jarvisRoot },
            maxIterations: 3,
            completionCommitter: async (input) => {
              const result = await createCompletionCommitter()(input);
              if (result.commitSha !== undefined) titles.push(input.title);
              return result;
            },
          }),
        );
        expect(result.kind).toBe("budget-exhausted");
        expect(titles).toEqual(["plan: draft 2"]);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("publish-resume preserves settled iteration commits on a clean tree", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-publish-resume-distinct";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      writeFileSync(join(worktreePath, "subspec.md"), "- [ ] task\n", "utf8");
      const store = openStateStore(stateDbPath);
      let calls = 0;
      let publishAttempts = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const first = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return progress or done.",
            expectedArtifactPath: "subspec.md",
            bindings: simulatedBindings(["progress", "progress", "done"]),
            completionCommitter: createCompletionCommitter(),
            completionPublisher: async () => {
              publishAttempts += 1;
              if (publishAttempts === 1) throw new Error("publish failed");
              return {};
            },
            readyFinalizer: async () => {},
          }),
        );
        expect(first.kind).toBe("completion_commit_failed");
        // Two progress checkpoints plus the completing iteration's checkpoint.
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 3);

        const resumed = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: [],
            completionCommitter: createCompletionCommitter(),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );
        expect(resumed.kind).toBe("complete");
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 3);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("dirty worktree after iteration commits fails terminal completion and names paths", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-dirty-terminal";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      writeFileSync(join(worktreePath, "subspec.md"), "- [ ] task\n", "utf8");
      const store = openStateStore(stateDbPath);
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          writeFileSync(join(worktreePath, "left-dirty.txt"), "uncommitted\n");
          return completeWrite(worktreePath);
        },
      }));

      try {
        // Progress iterations checkpoint normally; the completing iteration's checkpoint and
        // terminal publication call both no-op, simulating a committer that cannot capture the worktree state.
        let commitCalls = 0;
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return progress or done.",
            expectedArtifactPath: "subspec.md",
            bindings: simulatedBindings(["progress", "progress", "done"]),
            completionCommitter: async (input) => {
              commitCalls += 1;
              if (commitCalls > 2) return {};
              return createCompletionCommitter()(input);
            },
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("completion_commit_failed");
        expect(result.completionCommitError).toContain("left-dirty.txt");
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(3);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("shouldFailTerminalCompletionForDirtyWorktree rejects complete when dirty after no-op committer (inverted guard would complete)", () => {
      expect(shouldFailTerminalCompletionForDirtyWorktree(undefined, ["left-dirty.txt"])).toBe(true);
      expect(shouldFailTerminalCompletionForDirtyWorktree("sha", ["left-dirty.txt"])).toBe(false);
      expect(shouldFailTerminalCompletionForDirtyWorktree(undefined, [])).toBe(false);
      const invertedIgnoresDirty = false;
      expect(shouldFailTerminalCompletionForDirtyWorktree(undefined, ["left-dirty.txt"])).not.toBe(
        invertedIgnoresDirty,
      );
    });

    test("uncommitted paths omit the materialized node_modules symlink and keep other untracked work", async () => {
      const worktreePath = trackedMkdtempSync(join(tmpdir(), "uncommitted-paths-node-modules-"));
      roots.push(worktreePath);
      execFileSync("git", ["init"], { cwd: worktreePath, stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
      writeFileSync(join(worktreePath, "tracked.txt"), "keep\n", "utf8");
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });

      symlinkSync("/nonexistent-target-for-test", join(worktreePath, "node_modules"));

      const symlinkOnly = await getUncommittedPaths(worktreePath);
      expect(symlinkOnly).not.toContain("node_modules");
      expect(shouldFailTerminalCompletionForDirtyWorktree(undefined, symlinkOnly)).toBe(false);

      writeFileSync(join(worktreePath, "leftover.txt"), "real work\n", "utf8");
      const withLeftover = await getUncommittedPaths(worktreePath);
      expect(withLeftover).toContain("leftover.txt");
      expect(withLeftover).not.toContain("node_modules");
      expect(shouldFailTerminalCompletionForDirtyWorktree(undefined, withLeftover)).toBe(true);
    });

    test("uncommitted paths omit harness root sidecars and keep other untracked work", async () => {
      const worktreePath = trackedMkdtempSync(join(tmpdir(), "uncommitted-paths-sidecars-"));
      roots.push(worktreePath);
      execFileSync("git", ["init"], { cwd: worktreePath, stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
      writeFileSync(join(worktreePath, "tracked.txt"), "keep\n", "utf8");
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });

      writeFileSync(join(worktreePath, ".jarvis-review-feedback-response.md"), "- t1: addressed\n", "utf8");
      writeFileSync(join(worktreePath, ".jarvis-pr-review-input.json"), "{}\n", "utf8");
      const sidecarsOnly = await getUncommittedPaths(worktreePath);
      expect(sidecarsOnly).toEqual([]);
      expect(shouldFailTerminalCompletionForDirtyWorktree(undefined, sidecarsOnly)).toBe(false);

      writeFileSync(join(worktreePath, "leftover.txt"), "real work\n", "utf8");
      expect(await getUncommittedPaths(worktreePath)).toEqual(["leftover.txt"]);
    });

    test("terminal completion reports the nested untracked file", async () => {
      const nestedPath = "untracked-dir/only-dirt.txt";
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-nested-untracked-terminal";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      writeFileSync(join(worktreePath, "subspec.md"), "- [ ] task\n", "utf8");
      const store = openStateStore(stateDbPath);
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          mkdirSync(join(worktreePath, "untracked-dir"), { recursive: true });
          writeFileSync(join(worktreePath, nestedPath), "nested only dirt\n");
          return completeWrite(worktreePath);
        },
      }));

      try {
        let commitCalls = 0;
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return progress or done.",
            expectedArtifactPath: "subspec.md",
            bindings: simulatedBindings(["progress", "progress", "done"]),
            completionCommitter: async (input) => {
              commitCalls += 1;
              if (commitCalls > 2) return {};
              return createCompletionCommitter()(input);
            },
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("completion_commit_failed");
        expect(result.completionCommitError).toContain(nestedPath);
        expect(result.completionCommitError).not.toContain("untracked-dir/,");

        const unusualPaths = ["space path.txt", "line\nbreak.txt", "café/雪.txt", " leading.txt "];
        for (const path of unusualPaths) {
          mkdirSync(join(worktreePath, path, ".."), { recursive: true });
          writeFileSync(join(worktreePath, path), "x\n");
        }
        const listed = await getUncommittedPaths(worktreePath);
        for (const path of unusualPaths) {
          expect(listed).toContain(path);
          expect(listed.filter((candidate) => candidate === path)).toHaveLength(1);
        }
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("getUncommittedPaths is fail-soft for Git failure and malformed status framing", async () => {
      const plain = trackedMkdtempSync(join(tmpdir(), "uncommitted-fail-soft-plain-"));
      roots.push(plain);
      expect(await getUncommittedPaths(plain)).toEqual([]);

      const { jarvisRoot } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const inventorySpy = spyOn(sharedGit, "getGitStatusInventory").mockRejectedValue(
        new Error("Malformed git status inventory: missing terminal NUL"),
      );
      try {
        expect(await getUncommittedPaths(initGitWorktree(jarvisRoot, "uncommitted-malformed"))).toEqual([]);
      } finally {
        inventorySpy.mockRestore();
      }
    });

    test("ready-gate snapshot and restoration retain lossless uncommitted paths", async () => {
      const nestedPath = "outer/nested only.txt";
      const nestedContent = "pre-autofix nested dirt\n";
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const logSink = new TestLogSink();
      const branchName = "repair-autofix-lossless-snapshot";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      writeFileSync(join(worktreePath, "proof.txt"), "ok", "utf8");
      execFileSync("git", ["-C", worktreePath, "add", "proof.txt"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-qm", "add proof"], { stdio: "pipe" });
      mkdirSync(join(worktreePath, "outer"), { recursive: true });
      writeFileSync(join(worktreePath, nestedPath), nestedContent, "utf8");

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: [
          {
            id: "sim.1",
            metadata: { agent: "sim-agent-1", model: "sim-model-1" },
            invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) as const,
          },
        ],
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        runAutofixTypecheck: async () => ({ exitCode: 1, output: "typecheck failed" }),
        runFixCommand: async ({ cwd }) => {
          const proofPath = join(cwd, "proof.txt");
          writeFileSync(proofPath, `${readFileSync(proofPath, "utf8").trimEnd()}\n`, "utf8");
          writeFileSync(join(cwd, "broken.ts"), "const x: number = 'bad'\n", "utf8");
        },
        readyFinalizer: async ({ worktreePath: cwd }) => {
          if (!readFileSync(join(cwd, "proof.txt"), "utf8").endsWith("\n")) {
            throw new ReadyGateError("bun run ready", 1, "formatting required");
          }
        },
      });

      expect(result.kind).toBe("completion_commit_failed");
      expect(existsSync(join(worktreePath, "broken.ts"))).toBe(false);
      expect(readFileSync(join(worktreePath, nestedPath), "utf8")).toBe(nestedContent);
      const listed = await getUncommittedPaths(worktreePath);
      expect(listed).toContain(nestedPath);
      expect(listed.filter((candidate) => candidate === nestedPath)).toHaveLength(1);
    });

    test("commits once per changed progress iteration with Jarvis-Agent and Spec lines", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-commit-run";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      writeFileSync(join(worktreePath, "subspec.md"), "- [ ] task\n", "utf8");
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return progress or done.",
            expectedArtifactPath: "subspec.md",
            bindings: simulatedBindings(["progress", "progress", "done"]),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
            logSink: sink,
          }),
        );

        expect(result.kind).toBe("complete");
        // Two progress checkpoints plus the completing iteration's checkpoint.
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 3);
        for (const rev of ["HEAD~1", "HEAD~2"]) {
          const message = gitIn(worktreePath, ["log", "-1", "--format=%B", rev]);
          expect(message).toContain("Jarvis-Agent: Test Agent");
          expect(message).toContain("Spec: subspec.md");
        }
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("skips git commit when progress materializes no diff vs HEAD", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-no-diff";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          return progressWrite(worktreePath);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(iterLoopInput(jarvisRoot, branchName, store, { maxIterations: 1 }));

        expect(result.kind).toBe("budget-exhausted");
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount);
        expect(calls).toBe(1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("a workflow step (publishCompletion: false) commits progress iterations and leaves commits after a mid-run failure", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-workflow-step-mid-run-failure";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      let calls = 0;
      let publisherCalled = false;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          return {
            worktreePath,
            worktreeReused: false as const,
            lock: { kind: "acquired" as const },
            result: {
              kind: "invocation_failure" as const,
              failureKind: "error" as const,
              invocation: progressInvocation,
            },
          };
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["progress", "progress", "error"]),
            publishCompletion: false,
            completionPublisher: async () => {
              publisherCalled = true;
              return {};
            },
          }),
        );

        expect(result.kind).toBe("invocation_failure");
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 2);
        expect(publisherCalled).toBe(false);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("a no-change iteration following a committing iteration reports skipped, not the prior sha", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-no-change-after-commit";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls === 1) writeFileSync(join(worktreePath, "iter-1.txt"), "x\n");
          return progressWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, { maxIterations: 2, logSink: sink }),
        );

        expect(result.kind).toBe("budget-exhausted");
        const commitEvents = sink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_commit");
        expect(commitEvents).toHaveLength(2);
        expect(commitEvents[0]?.kind === "iteration_commit" && "commitSha" in commitEvents[0]).toBe(true);
        expect(commitEvents[1]).toMatchObject({ kind: "iteration_commit", skipReason: "no_file_changes" });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("settled iteration checkpoint omits harness-materialized node_modules symlink", async () => {
      // Mutation checkpoint: narrowing `completionStageArgs` in `v2/src/execution/completion-commit.ts` to bare
      // `git add -A` must turn this RED.
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-checkpoint-node-modules-exclusion";
      const worktreePath = initRealGitWorktree(jarvisRoot, branchName, { gitignore: "node_modules-only" });
      const seedHead = gitIn(worktreePath, ["rev-parse", "HEAD"]);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const authoredRel = "authored-change.txt";

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, authoredRel), "authored\n", "utf8");
          return progressWrite(worktreePath);
        },
      }));

      try {
        const nodeModulesPath = join(worktreePath, "node_modules");
        const expectedNodeModulesTarget = join(biomeRepoRoot, "node_modules");
        expect(lstatSync(nodeModulesPath).isSymbolicLink()).toBe(true);
        expect(readlinkSync(nodeModulesPath)).toBe(expectedNodeModulesTarget);
        expect(gitIn(worktreePath, ["ls-files", "node_modules"]).trim()).toBe("");

        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, { maxIterations: 1, logSink: sink }),
        );

        expect(result.kind).toBe("budget-exhausted");
        const commitEvents = sink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_commit");
        expect(commitEvents).toHaveLength(1);
        const commitEvent = commitEvents[0];
        expect(commitEvent?.kind === "iteration_commit" && "commitSha" in commitEvent).toBe(true);
        const commitSha =
          commitEvent?.kind === "iteration_commit" && "commitSha" in commitEvent ? commitEvent.commitSha : undefined;
        expect(commitSha).toBeDefined();
        expect(commitSha).not.toBe(seedHead);
        expect(commitSha).toBe(gitIn(worktreePath, ["rev-parse", "HEAD"]));

        const topLevel = gitIn(worktreePath, ["ls-tree", "--name-only", "HEAD"]).split("\n").filter(Boolean);
        expect(topLevel).not.toContain("node_modules");
        expect(topLevel).toContain(authoredRel);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("iteration_commit logs mainSyncRevertedPaths from the committer", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-main-sync-revert-log";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const reverted = ["sync-a.txt", "sync-b.txt"];

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "lane.txt"), "lane\n");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["done"]),
            maxIterations: 1,
            logSink: sink,
            completionCommitter: async () => ({
              commitSha: "checkpoint-sha-main-sync",
              filesChanged: 1,
              mainSyncRevertedPaths: reverted,
            }),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );
        expect(result.kind).toBe("complete");
        const commitEvent = sink.getEventsForRun(result.runId).find((event) => event.kind === "iteration_commit");
        expect(commitEvent).toMatchObject({
          kind: "iteration_commit",
          commitSha: "checkpoint-sha-main-sync",
          mainSyncRevertedPaths: reverted,
        });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("iteration_commit event distinguishes committed, no_file_changes, and no_git skips", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));

      // no_git: no .git directory under the worktree, using the git: false + localPath shape
      // production no-commit intent steps use.
      const noGitBranch = "iter-no-git";
      const noGitWorktreePath = join(jarvisRoot, "no-commit-intent-stage");
      mkdirSync(noGitWorktreePath, { recursive: true });
      const noGitStore = openStateStore(stateDbPath);
      const noGitSink = new TestLogSink();
      mock.module("./write.ts", () => ({
        executeWrite: async () => progressWrite(noGitWorktreePath),
      }));
      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, noGitBranch, noGitStore, {
            maxIterations: 1,
            logSink: noGitSink,
            worktree: {
              projectRoot: "/fake",
              projectName: "demo",
              branchName: noGitBranch,
              baseRef: "HEAD",
              git: false,
              localPath: noGitWorktreePath,
            },
            withExternalWorktree: async (_args, run) => ({
              worktree: { path: noGitWorktreePath, reused: false },
              lock: { kind: "acquired" },
              value: await run({ path: noGitWorktreePath, reused: false }),
            }),
          }),
        );
        const events = noGitSink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_commit");
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: "iteration_commit", skipReason: "no_git" });
      } finally {
        noGitStore.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }

      // committed vs no_file_changes: real git worktree, first iteration changes a file, second doesn't.
      const branchName = "iter-commit-vs-no-change";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let calls = 0;
      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls === 1) writeFileSync(join(worktreePath, "iter-1.txt"), "x\n");
          return progressWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, { maxIterations: 2, logSink: sink }),
        );
        const events = sink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_commit");
        expect(events).toHaveLength(2);
        expect(events[0]?.kind === "iteration_commit" && "commitSha" in events[0]).toBe(true);
        expect(events[1]).toMatchObject({ kind: "iteration_commit", skipReason: "no_file_changes" });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("keeps iteration commit when aborted before the next iteration starts", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-abort-between";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const abort = new AbortController();
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
          if (calls === 1) {
            queueMicrotask(() => abort.abort());
            return progressWrite(worktreePath);
          }
          return new Promise<never>(() => undefined);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["progress", "progress"]),
            signal: abort.signal,
          }),
        );

        expect(result).toMatchObject({ kind: "progress", resumable: true, iterationsConsumed: 1 });
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 1);
        expect(calls).toBe(1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("commits progress before post-settle abort short-circuit", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-abort-post-settle";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const abort = new AbortController();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "iter-1.txt"), "x\n");
          abort.abort();
          return progressWrite(worktreePath);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(iterLoopInput(jarvisRoot, branchName, store, { signal: abort.signal }));

        expect(result).toMatchObject({ kind: "progress", resumable: true, iterationsConsumed: 1 });
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("stops failed when iteration commit throws on progress", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-commit-fail";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let commitCalls = 0;

      const boundaryCommitError = (message: string, stderr: string): Error & { stderr: string } => {
        const error = new Error(message) as Error & { stderr: string };
        error.stderr = stderr;
        return error;
      };

      mock.module("./write.ts", () => ({
        executeWrite: async (input: WriteExecuteInput) => {
          const activeWorktreePath = join(jarvisRoot, "worktrees", "demo", input.worktree.branchName);
          writeFileSync(join(activeWorktreePath, "iter-1.txt"), "x\n");
          return progressWrite(activeWorktreePath);
        },
      }));

      try {
        const commitMessage = "iteration commit blew up";
        const gitStderr = "fatal: unable to auto-detect email address";
        const expectedCause = `${commitMessage}\n${gitStderr}`;
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["progress", "progress"]),
            logSink: sink,
            completionCommitter: async () => {
              commitCalls += 1;
              throw boundaryCommitError(commitMessage, gitStderr);
            },
          }),
        );

        expect(result.kind).toBe("iteration_commit_failed");
        expect(result.resumable).toBe(true);
        expect(result.completionCommitError).toBe(expectedCause);
        expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("failed");
        expect(commitCalls).toBe(1);
        expect(sink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_started")).toHaveLength(
          1,
        );
        expect(sink.getEventsForRun(result.runId).filter((event) => event.kind === "boundary_committed")).toHaveLength(
          0,
        );
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toContain("iter-1.txt");
        const terminal = sink
          .getEventsForRun(result.runId)
          .find((event): event is LoopFinishedEvent => event.kind === "loop_finished");
        expect(terminal).toMatchObject({
          loopOutcomeKind: "iteration_commit_failed",
          resumable: true,
          message: expectedCause,
        });

        const oversizedStderr = "e".repeat(600);
        const oversizedBranch = `${branchName}-oversized`;
        initGitWorktree(jarvisRoot, oversizedBranch);
        const oversizedSink = new TestLogSink();
        const oversizedResult = await executeWriteLoop(
          iterLoopInput(jarvisRoot, oversizedBranch, store, {
            bindings: simulatedBindings(["progress", "progress"]),
            logSink: oversizedSink,
            completionCommitter: async () => {
              throw boundaryCommitError(commitMessage, oversizedStderr);
            },
          }),
        );
        expect(oversizedResult.completionCommitError).toBe(truncateLogText(`${commitMessage}\n${oversizedStderr}`));
        const oversizedTerminal = oversizedSink
          .getEventsForRun(oversizedResult.runId)
          .find((event): event is LoopFinishedEvent => event.kind === "loop_finished");
        expect(oversizedTerminal?.message).toMatch(/^iteration commit blew up\ne+…$/);
        expect(oversizedTerminal?.message?.length).toBe(INVALID_TOKEN_LOG_MAX_CHARS + 1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("per-iteration checkpoint commits despite biome complexity lint on worktree edit", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-checkpoint-complexity";
      const worktreePath = initRealGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const seedHead = gitIn(worktreePath, ["rev-parse", "HEAD"]);

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeComplexityDirty(worktreePath);
          return blockedWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["blocked"]),
            logSink: sink,
            completionCommitter: createCompletionCommitter(),
          }),
        );

        expect(result.kind).toBe("blocked");
        expect(result.kind).not.toBe("iteration_commit_failed");
        const head = gitIn(worktreePath, ["rev-parse", "HEAD"]);
        expect(head).not.toBe(seedHead);
        expect(gitIn(worktreePath, ["show", `HEAD:${complexityDirtyRel}`])).toContain("complexityDirty");
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toBe("");
        expect(
          sink.getEventsForRun(result.runId).some((event) => event.kind === "iteration_commit" && "commitSha" in event),
        ).toBe(true);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("checkpoint durability uses best-effort biome format not completion check", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-checkpoint-format-mode";
      const worktreePath = initRealGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeComplexityDirty(worktreePath);
          return blockedWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["blocked"]),
            completionCommitter: createCompletionCommitter(),
          }),
        );

        expect(result.kind).toBe("blocked");
        expect(result.kind).not.toBe("iteration_commit_failed");
        expect(gitIn(worktreePath, ["show", `HEAD:${complexityDirtyRel}`])).toContain("complexityDirty");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("single-iteration done without progress emits iteration_commit", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-single-done";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["done"]),
            logSink: sink,
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("complete");
        expect(sink.getEventsForRun(result.runId).map((event) => event.kind)).toEqual([
          "iteration_started",
          "iteration_commit",
          "boundary_committed",
          "loop_finished",
        ]);

        const checkpointSha = gitIn(worktreePath, ["rev-parse", "HEAD"]);
        expect(result.commitSha).toBe(checkpointSha);
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("settled result classes checkpoint before their boundary", async () => {
      const checkpointCaseInvocation = {
        attempts: [],
        final: {
          result: { kind: "ok" as const, stdout: "response", stderr: "" },
          binding: {
            id: "sim.1",
            metadata: { agent: "Test Agent", model: "sim-model" },
            invoke: async () => ({ kind: "ok" as const, stdout: "response", stderr: "" }),
          },
        },
        telemetryFailures: [],
      };
      const cases: Array<{ label: string; result: StepRunResult; expectedOutcomeKind: OutcomeKind }> = [
        {
          label: "no-work",
          result: { kind: "complete", token: "no-work", invocation: checkpointCaseInvocation },
          expectedOutcomeKind: "no-work",
        },
        {
          label: "blocked",
          result: { kind: "blocked", token: "blocked", invocation: checkpointCaseInvocation },
          expectedOutcomeKind: "blocked",
        },
        {
          label: "invalid_token",
          result: {
            kind: "invalid_token",
            tokenText: "prose without a terminal token",
            invocation: checkpointCaseInvocation,
          },
          expectedOutcomeKind: "invalid_token",
        },
        {
          label: "missing_blocker",
          result: {
            kind: "missing_blocker",
            token: "blocked",
            responseText: "no blocker text here",
            invocation: checkpointCaseInvocation,
          },
          expectedOutcomeKind: "missing_blocker",
        },
        {
          label: "invocation_failure",
          result: {
            kind: "invocation_failure",
            failureKind: "error",
            echoedInput: false,
            invocation: checkpointCaseInvocation,
          },
          expectedOutcomeKind: "invocation_failure",
        },
        {
          label: "idle_output_timeout",
          result: { kind: "stall", invocation: checkpointCaseInvocation },
          expectedOutcomeKind: "idle_output_timeout",
        },
      ];

      for (const testCase of cases) {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        roots.push(join(jarvisRoot, ".."));
        const branchName = `settled-checkpoint-${testCase.label}`;
        const worktreePath = initGitWorktree(jarvisRoot, branchName);
        const store = openStateStore(stateDbPath);
        const sink = new TestLogSink();

        mock.module("./write.ts", () => ({
          executeWrite: async () => {
            writeFileSync(join(worktreePath, `${testCase.label}.txt`), "x\n", "utf8");
            return {
              worktreePath,
              worktreeReused: false as const,
              lock: { kind: "acquired" as const },
              result: testCase.result,
            };
          },
        }));

        try {
          const result = await executeWriteLoop(iterLoopInput(jarvisRoot, branchName, store, { logSink: sink }));

          const events = sink.getEventsForRun(result.runId);
          const commitIndex = events.findIndex((event) => event.kind === "iteration_commit");
          const boundaryIndex = events.findIndex((event) => event.kind === "boundary_committed");
          expect(commitIndex).toBeGreaterThanOrEqual(0);
          expect(boundaryIndex).toBeGreaterThan(commitIndex);

          const boundaryEvent = events.find((event) => event.kind === "boundary_committed");
          expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.outcomeKind).toBe(
            testCase.expectedOutcomeKind,
          );
        } finally {
          store.close();
          mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
        }
      }
    });

    test("contract-miss blocker is included in its settled checkpoint", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-contract-miss-checkpoint";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "agent-edit.txt"), "edit\n", "utf8");
          return {
            worktreePath,
            worktreeReused: false as const,
            lock: { kind: "acquired" as const },
            result: {
              kind: "contract_miss" as const,
              token: "done" as const,
              failedContractId: "artifact.expected",
              failureReason: "expected artifact missing",
              invocation: progressInvocation,
            },
          };
        },
      }));

      try {
        const result = await executeWriteLoop(iterLoopInput(jarvisRoot, branchName, store, { logSink: sink }));

        expect(result.kind).toBe("contract_miss");
        const events = sink.getEventsForRun(result.runId);
        const commitIndex = events.findIndex((event) => event.kind === "iteration_commit");
        const boundaryIndex = events.findIndex((event) => event.kind === "boundary_committed");
        expect(commitIndex).toBeGreaterThanOrEqual(0);
        expect(boundaryIndex).toBeGreaterThan(commitIndex);

        const commitEvent = events.find((event) => event.kind === "iteration_commit");
        const checkpointSha =
          commitEvent?.kind === "iteration_commit" && "commitSha" in commitEvent ? commitEvent.commitSha : undefined;
        expect(checkpointSha).toBeDefined();

        const specAtCheckpoint = gitIn(worktreePath, ["show", `${checkpointSha}:spec.md`]);
        expect(specAtCheckpoint).toContain("## Blocker");
        const treeAtCheckpoint = gitIn(worktreePath, ["ls-tree", "--name-only", checkpointSha as string]);
        expect(treeAtCheckpoint.split("\n")).toContain("agent-edit.txt");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("settled checkpoint failure supersedes terminal boundary and publication", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-checkpoint-failure-supersedes";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let publishCalls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["done"]),
            logSink: sink,
            completionCommitter: async () => {
              throw new Error("checkpoint commit blew up");
            },
            completionPublisher: async () => {
              publishCalls += 1;
              return {};
            },
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("iteration_commit_failed");
        expect(result.resumable).toBe(true);
        expect(publishCalls).toBe(0);
        const failedRun = loadRunOnce(stateDbPath, result.runId);
        expect(failedRun?.status).toBe("failed");
        expect(failedRun?.attempts.at(-1)?.status).toBe("in-progress");
        expect(sink.getEventsForRun(result.runId).filter((event) => event.kind === "boundary_committed")).toHaveLength(
          0,
        );

        let resumedCalls = 0;
        mock.module("./write.ts", () => ({
          executeWrite: async () => {
            resumedCalls += 1;
            return completeWrite(worktreePath);
          },
        }));
        const resumed = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["done"]),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );
        expect(resumed.kind).toBe("complete");
        expect(resumedCalls).toBe(1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("deadline-killed gate (exit 124) skips repair and emits ready_gate_timeout", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "deadline-gate-124";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {
              const { ReadyGateError } = await import("./ready-finalize.ts");
              throw new ReadyGateError("bun run ready", 124, "timeout\n", true);
            },
          }),
        );

        expect(result.kind).toBe("ready_gate_failed");
        expect(result.resumable).toBe(true);

        const events = sink.getEventsForRun(result.runId);
        const repairEvents = events.filter((event) => event.kind === "ready_gate_repair");
        expect(repairEvents).toHaveLength(0);

        const timeoutEvents = events.filter((event) => event.kind === "ready_gate_timeout");
        expect(timeoutEvents).toHaveLength(1);
        if (timeoutEvents[0]?.kind === "ready_gate_timeout") {
          expect(timeoutEvents[0].gateExitCode).toBe(124);
        }
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("deadline-killed gate (marker in output) skips repair and emits ready_gate_timeout", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "deadline-gate-marker";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {
              const { ReadyGateError } = await import("./ready-finalize.ts");
              throw new ReadyGateError(
                "bun run ready",
                1,
                "ready: deadline exceeded after 600000ms; killing child tree\n",
                true,
              );
            },
          }),
        );

        expect(result.kind).toBe("ready_gate_failed");
        expect(result.resumable).toBe(true);

        const events = sink.getEventsForRun(result.runId);
        const repairEvents = events.filter((event) => event.kind === "ready_gate_repair");
        expect(repairEvents).toHaveLength(0);

        const timeoutEvents = events.filter((event) => event.kind === "ready_gate_timeout");
        expect(timeoutEvents).toHaveLength(1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("non-timeout gate failure still enters repair path", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "genuine-gate-failure";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {
              const { ReadyGateError } = await import("./ready-finalize.ts");
              throw new ReadyGateError("bun run ready", 1, "tests failed\n", false);
            },
          }),
        );

        expect(result.kind).toBe("ready_gate_failed");

        const events = sink.getEventsForRun(result.runId);
        const repairEvents = events.filter((event) => event.kind === "ready_gate_repair");
        expect(repairEvents.length).toBeGreaterThan(0);

        const timeoutEvents = events.filter((event) => event.kind === "ready_gate_timeout");
        expect(timeoutEvents).toHaveLength(0);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    /**
     * A kill mirrors the daemon's real sequencing: `commitGuardedKill` persists the killed status
     * durably before `abortController.abort()` fires, so a checkpoint failure racing the abort can
     * see that status already recorded and preserve it (`kill checkpoint failure preserves killed
     * state` proves nothing otherwise). Driven synchronously right after `executeWriteLoop` is
     * called (not awaited yet): the loop's synchronous prefix — `prepareRun`, `onRunCreated`, and
     * the first binding invocation up to its own first `await` — has already run by then, so the
     * write is already on disk and `runId` is already captured.
     */
    function killAfterDispatch(
      store: StateStore,
      controller: AbortController,
      getRunId: () => string | undefined,
    ): void {
      const runId = getRunId();
      if (runId === undefined) throw new Error("runId not captured before kill");
      store.commitGuardedKill(runId);
      controller.abort();
    }

    /** Resolves only once the executionController's abort signal fires, after a real macrotask
     * hop — so it never wins a same-tick race against the awaitIteration `abort` promise. */
    function resolveOnAbort<T>(input: WriteExecuteInput, value: T): Promise<T> {
      return new Promise((resolve) => {
        input.signal?.addEventListener("abort", () => setTimeout(() => resolve(value), 5), { once: true });
      });
    }

    test("a non-progress result that settles before abort still checkpoints", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "settle-before-abort";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const controller = new AbortController();

      // Resolves on its own, never touching `input.signal`: this write has already settled by
      // the time the abort fires, unlike the kill/watchdog tests below which race the abort.
      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "settle-before-abort.txt"), "settled-before-abort\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, { signal: controller.signal }),
        );
        controller.abort();
        const result = await resultPromise;

        expect(result.kind).toBe("progress");
        expect(result.resumable).toBe(true);

        expect(gitIn(worktreePath, ["show", "HEAD:settle-before-abort.txt"])).toBe("settled-before-abort");
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toBe("");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("mid-iteration kill commits agent edits before settle", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "kill-mid-iteration";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const controller = new AbortController();
      let runId: string | undefined;

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "kill-proof.txt"), "killed-work\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            signal: controller.signal,
            onRunCreated: (id) => {
              runId = id;
            },
          }),
        );
        killAfterDispatch(store, controller, () => runId);
        const result = await resultPromise;

        expect(result.kind).toBe("progress");
        expect(result.resumable).toBe(true);
        expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("killed");

        expect(gitIn(worktreePath, ["show", "HEAD:kill-proof.txt"])).toBe("killed-work");
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toBe("");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("iteration watchdog checkpoints quiesced agent edits before timeout settlement", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "watchdog-checkpoint";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "watchdog-proof.txt"), "watchdog-work\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            iterationTimeoutMs: 15,
          }),
        );

        expect(result.kind).toBe("iteration_timeout");
        expect(result.resumable).toBe(false);
        expect(gitIn(worktreePath, ["show", "HEAD:watchdog-proof.txt"])).toBe("watchdog-work");
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toBe("");

        const events = sink.getEventsForRun(result.runId);
        const commitIndex = events.findIndex((event) => event.kind === "iteration_commit");
        const boundaryIndex = events.findIndex(
          (event) => event.kind === "boundary_committed" && event.outcomeKind === "iteration_timeout",
        );
        expect(commitIndex).toBeGreaterThanOrEqual(0);
        expect(boundaryIndex).toBeGreaterThan(commitIndex);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("slot-refused gate invocation checkpoints quiesced agent edits before its boundary", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "slot-refused-checkpoint";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const seedBase = gitIn(worktreePath, ["rev-parse", "HEAD"]);
      const otherLane = acquireGateInvocationLease();
      expect(otherLane).toBeDefined();

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "slot-refused-proof.txt"), "slot-refused-work\n", "utf8");
          const settled = resolveOnAbort(input, progressWrite(worktreePath));
          input.onAgentShellCommand?.("bun run test:v2");
          return settled;
        },
      }));

      try {
        const result = await executeWriteLoop(iterLoopInput(jarvisRoot, branchName, store, { logSink: sink }));

        expect(result).toMatchObject({ kind: "gate_invocation_refused", gateRefusalCause: "slot_contention" });
        const head = gitIn(worktreePath, ["rev-parse", "HEAD"]);
        expect(head).not.toBe(seedBase);
        expect(() => gitIn(worktreePath, ["merge-base", "--is-ancestor", seedBase, head])).not.toThrow();
        expect(gitIn(worktreePath, ["show", "HEAD:slot-refused-proof.txt"])).toBe("slot-refused-work");
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toBe("");

        const events = sink.getEventsForRun(result.runId);
        const commitIndex = events.findIndex((event) => event.kind === "iteration_commit");
        const boundaryIndex = events.findIndex(
          (event) => event.kind === "boundary_committed" && event.outcomeKind === "gate_invocation_refused",
        );
        expect(commitIndex).toBeGreaterThanOrEqual(0);
        expect(boundaryIndex).toBeGreaterThan(commitIndex);
      } finally {
        otherLane?.release();
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("slot-refused checkpoint failure settles iteration_commit_failed", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "slot-refused-checkpoint-fail";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const otherLane = acquireGateInvocationLease();
      expect(otherLane).toBeDefined();

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "slot-refused-fail-proof.txt"), "x\n", "utf8");
          const settled = resolveOnAbort(input, progressWrite(worktreePath));
          input.onAgentShellCommand?.("bun run test:v2");
          return settled;
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            completionCommitter: async () => {
              throw new Error("checkpoint blew up");
            },
          }),
        );

        expect(result.kind).toBe("iteration_commit_failed");
        expect(result.resumable).toBe(true);

        const events = sink.getEventsForRun(result.runId);
        expect(events.some((event) => event.kind === "boundary_committed")).toBe(false);
        expect(
          events.some((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "gate_invocation_refused"),
        ).toBe(false);
        expect(store.loadRun(result.runId)?.gateRefusalRecoveryState).toBeNull();
      } finally {
        otherLane?.release();
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("slot-contention gate refusal persists its cause and gate command onto the run row", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "slot-refused-recovery-state";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const gateCommand = "bun run test:v2";
      const otherLane = acquireGateInvocationLease();
      expect(otherLane).toBeDefined();

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "slot-refused-recovery-proof.txt"), "x\n", "utf8");
          const settled = resolveOnAbort(input, progressWrite(worktreePath));
          input.onAgentShellCommand?.(gateCommand);
          return settled;
        },
      }));

      try {
        const result = await executeWriteLoop(iterLoopInput(jarvisRoot, branchName, store, { logSink: sink }));

        expect(result).toMatchObject({ kind: "gate_invocation_refused", gateRefusalCause: "slot_contention" });
        expect(store.loadRun(result.runId)?.gateRefusalRecoveryState).toEqual({
          cause: "slot_contention",
          gateCommand,
          slotRedriveCount: 0,
        });
        const finished = sink
          .getEventsForRun(result.runId)
          .find((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "gate_invocation_refused");
        expect(finished).toMatchObject({ gateCommand, gateRefusalCause: "slot_contention", slotRedriveCount: 0 });
      } finally {
        otherLane?.release();
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("ceiling-headroom gate refusal commits no checkpoint before its boundary", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "ceiling-headroom-no-checkpoint";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const seedBase = gitIn(worktreePath, ["rev-parse", "HEAD"]);

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "ceiling-headroom-proof.txt"), "x\n", "utf8");
          const settled = resolveOnAbort(input, progressWrite(worktreePath));
          input.onAgentShellCommand?.("bun run test:v2");
          return settled;
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            iterationCeilingMs: TEST_STEP_BUDGET_MS - 1,
          }),
        );

        expect(result).toMatchObject({ kind: "gate_invocation_refused", gateRefusalCause: "ceiling_headroom" });
        expect(gitIn(worktreePath, ["rev-parse", "HEAD"])).toBe(seedBase);
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toContain("ceiling-headroom-proof.txt");
        const events = sink.getEventsForRun(result.runId);
        expect(events.some((event) => event.kind === "iteration_commit")).toBe(false);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("ceiling-headroom gate refusal persists its cause and gate command onto the run row", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "ceiling-headroom-recovery-state";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const gateCommand = "bun run test:v2";

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "ceiling-headroom-recovery-proof.txt"), "x\n", "utf8");
          const settled = resolveOnAbort(input, progressWrite(worktreePath));
          input.onAgentShellCommand?.(gateCommand);
          return settled;
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            iterationCeilingMs: TEST_STEP_BUDGET_MS - 1,
          }),
        );

        expect(result).toMatchObject({ kind: "gate_invocation_refused", gateRefusalCause: "ceiling_headroom" });
        expect(store.loadRun(result.runId)?.gateRefusalRecoveryState).toEqual({
          cause: "ceiling_headroom",
          gateCommand,
          slotRedriveCount: 0,
        });
        const finished = sink
          .getEventsForRun(result.runId)
          .find((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "gate_invocation_refused");
        expect(finished).toMatchObject({ gateCommand, gateRefusalCause: "ceiling_headroom", slotRedriveCount: 0 });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("gate refusal settlement preserves an existing slot re-drive count instead of resetting it", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "ceiling-headroom-redrive-preserved";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const gateCommand = "bun run test:v2";

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "ceiling-headroom-redrive-proof.txt"), "x\n", "utf8");
          const settled = resolveOnAbort(input, progressWrite(worktreePath));
          input.onAgentShellCommand?.(gateCommand);
          return settled;
        },
      }));

      try {
        const first = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            iterationCeilingMs: TEST_STEP_BUDGET_MS - 1,
          }),
        );
        expect(first.kind).toBe("gate_invocation_refused");

        // Simulates a slot re-drive count a future consumer has already bumped on this row.
        store.commitTerminalRunSettlement({
          runId: first.runId,
          status: "failed",
          terminalCause: "gate_invocation_refused",
          gateRefusalRecoveryState: { cause: "ceiling_headroom", gateCommand, slotRedriveCount: 3 },
        });

        const second = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            iterationCeilingMs: TEST_STEP_BUDGET_MS - 1,
          }),
        );

        expect(second.runId).toBe(first.runId);
        expect(second.kind).toBe("gate_invocation_refused");
        expect(store.loadRun(second.runId)?.gateRefusalRecoveryState).toEqual({
          cause: "ceiling_headroom",
          gateCommand,
          slotRedriveCount: 3,
        });
        const finished = sink
          .getEventsForRun(second.runId)
          .filter((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "gate_invocation_refused")
          .at(-1);
        expect(finished).toMatchObject({ slotRedriveCount: 3 });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("controlled-loss checkpoint commits despite biome complexity lint on quiesced edit", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "watchdog-checkpoint-complexity";
      const worktreePath = initRealGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const seedHead = gitIn(worktreePath, ["rev-parse", "HEAD"]);

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeComplexityDirty(worktreePath);
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            iterationTimeoutMs: 15,
            completionCommitter: createCompletionCommitter(),
          }),
        );

        expect(result.kind).toBe("iteration_timeout");
        expect(result.kind).not.toBe("iteration_commit_failed");
        const head = gitIn(worktreePath, ["rev-parse", "HEAD"]);
        expect(head).not.toBe(seedHead);
        expect(gitIn(worktreePath, ["show", `HEAD:${complexityDirtyRel}`])).toContain("complexityDirty");
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toBe("");
        expect(
          sink.getEventsForRun(result.runId).some((event) => event.kind === "iteration_commit" && "commitSha" in event),
        ).toBe(true);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("kill checkpoint precedes loop settlement", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "kill-precedes-settlement";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const controller = new AbortController();
      let runId: string | undefined;

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "kill-order-proof.txt"), "x\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            signal: controller.signal,
            logSink: sink,
            onRunCreated: (id) => {
              runId = id;
            },
          }),
        );
        killAfterDispatch(store, controller, () => runId);
        const result = await resultPromise;

        expect(result.kind).toBe("progress");

        const events = sink.getEventsForRun(result.runId);
        const commitIndex = events.findIndex((event) => event.kind === "iteration_commit");
        const finishedIndex = events.findIndex((event) => event.kind === "loop_finished");
        expect(commitIndex).toBeGreaterThanOrEqual(0);
        expect(finishedIndex).toBeGreaterThan(commitIndex);

        expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("killed");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("interrupted fallback checkpoint attributes the active binding", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "kill-fallback-attribution";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const controller = new AbortController();
      let runId: string | undefined;

      const primaryBinding = { id: "primary", metadata: { agent: "Primary Agent", model: "primary-model" } };
      const fallbackBinding = { id: "fallback", metadata: { agent: "Fallback Agent", model: "fallback-model" } };

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "fallback-proof.txt"), "fallback-work\n", "utf8");
          return resolveOnAbort(input, {
            worktreePath,
            worktreeReused: false as const,
            lock: { kind: "acquired" as const },
            result: {
              kind: "progress" as const,
              token: "progress" as const,
              invocation: {
                attempts: [
                  { binding: primaryBinding, result: { kind: "quota" as const, stderr: "quota" } },
                  { binding: fallbackBinding, result: { kind: "ok" as const, stdout: "progress", stderr: "" } },
                ],
                final: { binding: fallbackBinding, result: { kind: "ok" as const, stdout: "progress", stderr: "" } },
                telemetryFailures: [],
              },
            },
          });
        },
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            signal: controller.signal,
            onRunCreated: (id) => {
              runId = id;
            },
          }),
        );
        killAfterDispatch(store, controller, () => runId);
        const result = await resultPromise;

        expect(result.kind).toBe("progress");
        const checkpointSha = gitIn(worktreePath, ["rev-parse", "HEAD"]);
        const message = gitIn(worktreePath, ["log", "-1", "--format=%B", checkpointSha]);
        expect(message).toContain("Jarvis-Agent: Fallback Agent");
        expect(message).not.toContain("Jarvis-Agent: Primary Agent");
        expect(gitIn(worktreePath, ["show", `${checkpointSha}:fallback-proof.txt`])).toBe("fallback-work");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("watchdog checkpoint failure supersedes timeout boundary", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "watchdog-checkpoint-fail";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let publishCalls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "watchdog-fail-proof.txt"), "x\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            iterationTimeoutMs: 15,
            completionCommitter: async () => {
              throw new Error("checkpoint blew up");
            },
            completionPublisher: async () => {
              publishCalls += 1;
              return {};
            },
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("iteration_commit_failed");
        expect(result.resumable).toBe(true);
        expect(publishCalls).toBe(0);

        const events = sink.getEventsForRun(result.runId);
        expect(events.some((event) => event.kind === "boundary_committed")).toBe(false);
        expect(
          events.some((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "iteration_timeout"),
        ).toBe(false);

        const failedRun = loadRunOnce(stateDbPath, result.runId);
        expect(failedRun?.status).toBe("failed");
        expect(failedRun?.attempts.at(-1)?.status).toBe("in-progress");

        mock.module("./write.ts", () => ({
          executeWrite: async () => {
            writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
            return completeWrite(worktreePath);
          },
        }));

        const resumed = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["done"]),
            completionCommitter: createCompletionCommitter(),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );
        expect(resumed.kind).toBe("complete");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("kill checkpoint failure preserves killed state", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "kill-checkpoint-fail";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const controller = new AbortController();
      let runId: string | undefined;

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "kill-fail-proof.txt"), "x\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            signal: controller.signal,
            logSink: sink,
            onRunCreated: (id) => {
              runId = id;
            },
            completionCommitter: async () => {
              throw new Error("checkpoint after kill blew up");
            },
          }),
        );
        killAfterDispatch(store, controller, () => runId);
        const result = await resultPromise;

        expect(result.kind).toBe("progress");
        expect(result.resumable).toBe(true);

        const run = loadRunOnce(stateDbPath, result.runId);
        expect(run?.status).toBe("killed");
        expect(run?.attempts.at(-1)?.status).toBe("in-progress");

        const events = sink.getEventsForRun(result.runId);
        expect(events.some((event) => event.kind === "boundary_committed")).toBe(false);
        expect(events.some((event) => event.kind === "iteration_commit")).toBe(false);
        const diagnostic = events.find(
          (event) =>
            event.kind === "run_execution_failed" && event.message?.includes("checkpoint after kill failed") === true,
        );
        expect(diagnostic).toBeDefined();
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("quiescence wait is bounded when the invocation never quiesces", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "quiescence-bound";
      initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const controller = new AbortController();

      // Ignores `signal` entirely: never settles, mirroring an invocation that ignores its
      // AbortSignal, the case the durability floor explicitly excludes.
      mock.module("./write.ts", () => ({
        executeWrite: () => new Promise<never>(() => undefined),
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            signal: controller.signal,
            logSink: sink,
            quiescenceTimeoutMs: 20,
          }),
        );
        controller.abort();
        const result = await resultPromise;

        expect(result.kind).toBe("progress");
        expect(result.resumable).toBe(true);

        const events = sink.getEventsForRun(result.runId);
        expect(events.some((event) => event.kind === "iteration_commit")).toBe(false);
        expect(events.some((event) => event.kind === "boundary_committed")).toBe(false);
        expect(events.some((event) => event.kind === "loop_finished")).toBe(true);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("no-work over dirty worktree with publishCompletion false settles non-completed failure naming uncommitted paths", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "no-work-dirty-publish-off";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "left-dirty.txt"), "uncommitted\n");
          return {
            worktreePath,
            worktreeReused: false as const,
            lock: { kind: "acquired" as const },
            result: { kind: "complete" as const, token: "no-work" as const, invocation: progressInvocation },
          };
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["no-work"]),
            publishCompletion: false,
            completionCommitter: async () => ({}),
            logSink: sink,
          }),
        );

        expect(result.kind).toBe("completion_commit_failed");
        expect(result.runStatus).not.toBe("completed");
        expect(result.completionCommitError).toContain("left-dirty.txt");
        expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("failed");
        const events = sink.getEventsForRun(result.runId);
        expect(events.some((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "complete")).toBe(
          false,
        );
        expect(
          events.some(
            (event) =>
              event.kind === "loop_finished" &&
              event.loopOutcomeKind === "completion_commit_failed" &&
              "completionCommitError" in event &&
              event.completionCommitError?.includes("left-dirty.txt"),
          ),
        ).toBe(true);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("publishCompletion false with no completion-row signal settles completed immediately", async () => {
      // A `publishCompletion: false` dispatch with no `isCompletionRow` signal has no owning
      // publication tail; it must keep settling `completed` at its own boundary, not strand
      // `in-progress` forever.
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "publish-off-no-completion-row-signal";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);

      mock.module("./write.ts", () => ({
        executeWrite: async () => completeWrite(worktreePath),
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return done.",
            bindings: simulatedBindings(["done"]),
            publishCompletion: false,
          }),
        );

        expect(result.kind).toBe("complete");
        expect(result.runStatus).toBe("completed");
        expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("completed");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    function writeImplementLinkedSpec(
      worktreePath: string,
      specDir: string,
      subspecs: ReadonlyArray<{ file: string; title: string; criteria: string }>,
    ): { specPath: string; subspecPaths: string[] } {
      const specRoot = join(worktreePath, specDir);
      mkdirSync(specRoot, { recursive: true });
      const links = subspecs.map((s, i) => `- [ ] [${String(i).padStart(2, "0")} - ${s.title}](./${s.file})`);
      writeFileSync(join(specRoot, "index.md"), `# Implement\n\n${links.join("\n")}\n`, "utf8");
      for (const s of subspecs) {
        writeFileSync(join(specRoot, s.file), `# ${s.title}\n\n## Acceptance criteria\n\n${s.criteria}\n`, "utf8");
      }
      return {
        specPath: `${specDir}/index.md`,
        subspecPaths: subspecs.map((s) => `${specDir}/${s.file}`),
      };
    }

    test("iteration_timeout with gate-only outstanding active subspec is resumable", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "timeout-gate-only-outstanding";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const subspecFile = "spec/implement/00-active.md";
      mkdirSync(join(worktreePath, "spec/implement"), { recursive: true });
      writeFileSync(
        join(worktreePath, subspecFile),
        "# Active\n\n## Acceptance criteria\n\n- [x] `bun run typecheck` passes\n- [ ] `bun run test:v2` passes\n",
        "utf8",
      );
      writeFileSync(
        join(worktreePath, "spec/implement/index.md"),
        "# Implement\n\n- [ ] [00 - Active](./00-active.md)\n",
        "utf8",
      );
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "spec"], { stdio: "pipe" });
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const gateCommand = "bun run test:v2";

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          input.onAgentShellCommand?.(gateCommand);
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            worktree: { projectRoot: worktreePath, projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
            specPath: "spec/implement/index.md",
            expectedArtifactPath: subspecFile,
            logSink: sink,
            iterationCeilingMs: TEST_STEP_BUDGET_MS + 1_000,
            schedule: fastCeilingSchedule(),
            clock: () => new Date("2026-09-08T06:00:00.000Z"),
          }),
        );

        expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: true });
        const finished = sink
          .getEventsForRun(result.runId)
          .find((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "iteration_timeout");
        expect(finished).toMatchObject({
          resumable: true,
          gateInvocationCommand: gateCommand,
          gateInvocationElapsedMs: expect.any(Number),
        });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("iteration_timeout during gate invocation carries gateInvocation fields and agent-stall timeout omits them", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "timeout-gate-vs-stall";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const gateCommand = "bun run test:v2";
      const ceilingSchedule = fastCeilingSchedule();
      let nowMs = Date.parse("2026-09-08T06:00:00.000Z");
      const clock = () => {
        nowMs += 25;
        return new Date(nowMs);
      };

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          input.onAgentShellCommand?.(gateCommand);
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const gateResult = await executeWriteLoop(
          iterLoopInput(jarvisRoot, `${branchName}-gate`, store, {
            worktree: {
              projectRoot: worktreePath,
              projectName: "demo",
              branchName: `${branchName}-gate`,
              baseRef: "HEAD",
              jarvisRoot,
            },
            iterationCeilingMs: TEST_STEP_BUDGET_MS + 1_000,
            schedule: ceilingSchedule,
            clock,
          }),
        );
        expect(gateResult).toMatchObject({ kind: "iteration_timeout" });
        expect(gateResult.gateInvocationCommand).toBe(gateCommand);
        expect(gateResult.gateInvocationElapsedMs).toBeGreaterThan(0);

        mock.module("./write.ts", () => ({
          executeWrite: (input: WriteExecuteInput) => resolveOnAbort(input, progressWrite(worktreePath)),
        }));
        const stallResult = await executeWriteLoop(
          iterLoopInput(jarvisRoot, `${branchName}-stall`, store, {
            worktree: {
              projectRoot: worktreePath,
              projectName: "demo",
              branchName: `${branchName}-stall`,
              baseRef: "HEAD",
              jarvisRoot,
            },
            iterationCeilingMs: TEST_STEP_BUDGET_MS + 1_000,
            schedule: ceilingSchedule,
            clock,
          }),
        );
        expect(stallResult).toMatchObject({ kind: "iteration_timeout" });
        expect(stallResult.gateInvocationCommand).toBeUndefined();
        expect(stallResult.gateInvocationElapsedMs).toBeUndefined();
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("committedResult replay preserves gate-only-outstanding iteration_timeout resumability", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "timeout-gate-only-committed-replay";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const subspecFile = "spec/implement/00-active.md";
      mkdirSync(join(worktreePath, "spec/implement"), { recursive: true });
      writeFileSync(
        join(worktreePath, subspecFile),
        "# Active\n\n## Acceptance criteria\n\n- [x] `bun run typecheck` passes\n- [ ] `bun run test:v2` passes\n",
        "utf8",
      );
      writeFileSync(
        join(worktreePath, "spec/implement/index.md"),
        "# Implement\n\n- [ ] [00 - Active](./00-active.md)\n",
        "utf8",
      );
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "spec"], { stdio: "pipe" });
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const gateCommand = "bun run test:v2";
      let executeCalls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          executeCalls += 1;
          input.onAgentShellCommand?.(gateCommand);
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const first = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            worktree: { projectRoot: worktreePath, projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
            specPath: "spec/implement/index.md",
            expectedArtifactPath: subspecFile,
            logSink: sink,
            iterationCeilingMs: TEST_STEP_BUDGET_MS + 1_000,
            schedule: fastCeilingSchedule(),
            clock: () => new Date("2026-09-08T06:00:00.000Z"),
          }),
        );
        expect(first).toMatchObject({ kind: "iteration_timeout", resumable: true });

        executeCalls = 0;
        await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            worktree: { projectRoot: worktreePath, projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
            specPath: "spec/implement/index.md",
            expectedArtifactPath: subspecFile,
            logSink: sink,
            iterationCeilingMs: TEST_STEP_BUDGET_MS + 1_000,
            schedule: fastCeilingSchedule(),
            clock: () => new Date("2026-09-08T06:00:00.000Z"),
          }),
        );
        expect(executeCalls).toBeGreaterThan(0);

        executeCalls = 0;
        const replaySink = new TestLogSink();
        const replay = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            worktree: { projectRoot: worktreePath, projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
            specPath: "spec/implement/index.md",
            logSink: replaySink,
            iterationCeilingMs: TEST_STEP_BUDGET_MS + 1_000,
            schedule: fastCeilingSchedule(),
            clock: () => new Date("2026-09-08T06:00:00.000Z"),
          }),
        );
        expect(replay).toMatchObject({ kind: "iteration_timeout", resumable: false });
        expect(executeCalls).toBe(0);
        expect(replaySink.getEventsForRun(first.runId)).toHaveLength(0);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("iteration_timeout with one completed subspec is resumable", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "timeout-one-complete";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const { specPath, subspecPaths } = writeImplementLinkedSpec(worktreePath, "spec/implement", [
        { file: "00-first.md", title: "First", criteria: "- [x] done" },
        { file: "01-second.md", title: "Second", criteria: "- [ ] pending" },
      ]);
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "spec"], { stdio: "pipe" });
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "timeout-proof.txt"), "work\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            worktree: { projectRoot: jarvisRoot, projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
            specPath,
            logSink: sink,
            iterationTimeoutMs: 15,
          }),
        );

        expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: true });
        const finished = sink
          .getEventsForRun(result.runId)
          .find((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "iteration_timeout");
        expect(finished).toMatchObject({
          resumable: true,
          completedSubspecPaths: [subspecPaths[0]],
          remainingSubspecPaths: [subspecPaths[1]],
        });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("committedResult echoes recomputed iteration_timeout inventory with divergent roots", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "timeout-committed-replay";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
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
      const specPath = "spec/implement/index.md";
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "spec"], { stdio: "pipe" });
      const store = openStateStore(stateDbPath);
      let resumableStore: StateStore | undefined;
      const sink = new TestLogSink();
      const divergentWorktree = {
        projectRoot: jarvisRoot,
        projectName: "demo",
        branchName,
        baseRef: "HEAD",
        jarvisRoot,
      };
      let executeCalls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          executeCalls += 1;
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const first = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            worktree: divergentWorktree,
            specPath,
            logSink: sink,
            iterationTimeoutMs: 15,
          }),
        );
        expect(first).toMatchObject({
          kind: "iteration_timeout",
          resumable: false,
          completedSubspecPaths: [],
          remainingSubspecPaths: [],
          inventoryError: `cannot relativize subspec path: ${outsidePath}`,
        });

        executeCalls = 0;
        const replaySink = new TestLogSink();
        const replay = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            worktree: divergentWorktree,
            specPath,
            logSink: replaySink,
            iterationTimeoutMs: 15,
          }),
        );
        expect(replay).toMatchObject({
          kind: "iteration_timeout",
          resumable: false,
          completedSubspecPaths: [],
          remainingSubspecPaths: [],
          inventoryError: `cannot relativize subspec path: ${outsidePath}`,
        });
        expect(executeCalls).toBe(0);
        expect(replaySink.getEventsForRun(first.runId)).toHaveLength(0);
        store.close();

        const resumableBranch = "timeout-committed-replay-resumable";
        const resumableWorktreePath = initGitWorktree(jarvisRoot, resumableBranch);
        const { specPath: resumableSpecPath, subspecPaths } = writeImplementLinkedSpec(
          resumableWorktreePath,
          "spec/implement",
          [
            { file: "00-first.md", title: "First", criteria: "- [x] done" },
            { file: "01-second.md", title: "Second", criteria: "- [ ] pending" },
          ],
        );
        execFileSync("git", ["-C", resumableWorktreePath, "add", "-A"], { stdio: "pipe" });
        execFileSync("git", ["-C", resumableWorktreePath, "commit", "-m", "spec"], { stdio: "pipe" });
        resumableStore = openStateStore(stateDbPath);
        const resumableSink = new TestLogSink();
        let resumableExecuteCalls = 0;
        mock.module("./write.ts", () => ({
          executeWrite: (input: WriteExecuteInput) => {
            resumableExecuteCalls += 1;
            return resolveOnAbort(input, progressWrite(resumableWorktreePath));
          },
        }));

        const resumableFirst = await executeWriteLoop(
          iterLoopInput(jarvisRoot, resumableBranch, resumableStore, {
            worktree: {
              projectRoot: jarvisRoot,
              projectName: "demo",
              branchName: resumableBranch,
              baseRef: "HEAD",
              jarvisRoot,
            },
            specPath: resumableSpecPath,
            logSink: resumableSink,
            iterationTimeoutMs: 15,
          }),
        );
        expect(resumableFirst).toMatchObject({
          kind: "iteration_timeout",
          resumable: true,
          completedSubspecPaths: [subspecPaths[0]],
          remainingSubspecPaths: [subspecPaths[1]],
        });

        resumableExecuteCalls = 0;
        const resumableReplaySink = new TestLogSink();
        await executeWriteLoop(
          iterLoopInput(jarvisRoot, resumableBranch, resumableStore, {
            worktree: {
              projectRoot: jarvisRoot,
              projectName: "demo",
              branchName: resumableBranch,
              baseRef: "HEAD",
              jarvisRoot,
            },
            specPath: resumableSpecPath,
            logSink: resumableReplaySink,
            iterationTimeoutMs: 15,
          }),
        );
        expect(resumableExecuteCalls).toBeGreaterThan(0);
        resumableStore.close();
        resumableStore = undefined;
      } finally {
        if (resumableStore !== undefined) resumableStore.close();
        try {
          store.close();
        } catch {
          /* closed after inventory-error replay */
        }
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("iteration_timeout with no completed subspec stays non-resumable", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "timeout-none-complete";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const { specPath, subspecPaths } = writeImplementLinkedSpec(worktreePath, "spec/implement", [
        { file: "00-first.md", title: "First", criteria: "- [ ] pending" },
        { file: "01-second.md", title: "Second", criteria: "- [ ] also pending" },
      ]);
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "spec"], { stdio: "pipe" });
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => resolveOnAbort(input, progressWrite(worktreePath)),
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            worktree: { projectRoot: worktreePath, projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
            specPath,
            logSink: sink,
            iterationTimeoutMs: 15,
          }),
        );

        expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: false });
        const finished = sink
          .getEventsForRun(result.runId)
          .find((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "iteration_timeout");
        expect(finished).toMatchObject({
          resumable: false,
          completedSubspecPaths: [],
          remainingSubspecPaths: subspecPaths,
        });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("invocation_failure with no binding skips the checkpoint and preserves detail", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "no-binding-checkpoint-skip";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => ({
          worktreePath,
          worktreeReused: false as const,
          lock: { kind: "acquired" as const },
          result: {
            kind: "invocation_failure" as const,
            failureKind: "no_binding" as const,
            invocation: { attempts: [], final: null, telemetryFailures: [] },
          },
        }),
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: [],
            logSink: sink,
          }),
        );

        expect(result.kind).toBe("invocation_failure");
        expect(result.resumable).toBe(false);
        expect(result.failureKind).toBe("no_binding");
        expect(result.bindingAttempts).toEqual([]);

        const events = sink.getEventsForRun(result.runId);
        const commitEvent = events.find((event) => event.kind === "iteration_commit");
        expect(commitEvent?.kind === "iteration_commit" && "skipReason" in commitEvent && commitEvent.skipReason).toBe(
          "no_binding",
        );
        expect(events.some((event) => event.kind === "boundary_committed")).toBe(true);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });
  });
});
