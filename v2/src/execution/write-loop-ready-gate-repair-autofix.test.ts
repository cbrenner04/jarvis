import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readyStepCompletionRecord, readyStepStartRecord } from "../../../scripts/ready.ts";
import { FixCommandError } from "../../../shared/fix-command.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { composeRunOperatorError } from "../daemon/run-operator-error.ts";
import type { LoopFinishedEvent } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import {
  baseRefProbeFailsSeam,
  gateFailureOutput,
  initGateScopeWorktree,
  initOutsideDiffRepairWorktree,
  PLACEHOLDER_BASE_REF_PROBE_OBSERVATION,
} from "./ready-finalize.test-support.ts";
import { formatReadyGateOutOfScopeDetail, type ReadyFinalizer, ReadyGateError } from "./ready-finalize.ts";
import {
  deriveAllowedOrUndefined,
  loadRunOnce,
  registerWriteLoopExecuteWriteMockHooks,
  roots,
  runLoop,
  TestLogSink,
} from "./write-loop.test-support.ts";
import {
  enumerateRepairCompletionCandidates,
  findFirstRepairFenceViolation,
  publishWithReadyRepair,
  readyGateRepairLogFields,
  runBuiltInReadyGateAutofixBiome,
} from "./write-loop.ts";

describe("write loop", () => {
  registerWriteLoopExecuteWriteMockHooks();

  describe("ready finalization", () => {
    const completionHooks = {
      completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
      completionPublisher: async () => ({}),
      runFixCommand: async () => {},
    };

    function fixProofFormatting(cwd: string): void {
      const proofPath = join(cwd, "proof.txt");
      writeFileSync(proofPath, `${readFileSync(proofPath, "utf8").trimEnd()}\n`, "utf8");
    }

    function proofNeedsFormatting(cwd: string): boolean {
      const proofPath = join(cwd, "proof.txt");
      return !existsSync(proofPath) || !readFileSync(proofPath, "utf8").endsWith("\n");
    }

    function proofFormattingFixCommand(onCall?: () => void) {
      return async ({ cwd }: { cwd: string }) => {
        onCall?.();
        fixProofFormatting(cwd);
      };
    }

    function proofFormattingReadyFinalizer(onGate: () => void, afterFormatting?: () => void | Promise<void>) {
      return async ({ worktreePath }: { worktreePath: string }) => {
        onGate();
        if (proofNeedsFormatting(worktreePath)) {
          throw new ReadyGateError("bun run ready", 1, "formatting required");
        }
        await afterFormatting?.();
      };
    }

    const biomeRepoRoot = join(import.meta.dir, "../../..");

    function initAutofixGitWorktree(jarvisRoot: string, branchName: string): string {
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "commit.gpgsign", "false"], { stdio: "pipe" });
      copyFileSync(join(biomeRepoRoot, "biome.json"), join(worktreePath, "biome.json"));
      copyFileSync(join(biomeRepoRoot, ".gitignore"), join(worktreePath, ".gitignore"));
      try {
        symlinkSync(join(biomeRepoRoot, "node_modules"), join(worktreePath, "node_modules"), "dir");
      } catch {
        /* reuse existing symlink */
      }
      writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
      mkdirSync(join(worktreePath, "v2/src"), { recursive: true });
      writeFileSync(join(worktreePath, "v2/src/example.ts"), "export const seeded = true;\n");
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
      return worktreePath;
    }

    function writeComplexityDirtyFile(worktreePath: string, relPath: string): void {
      const branches = Array.from({ length: 26 }, (_, i) => `  if (n === ${i}) return ${i};`).join("\n");
      writeFileSync(
        join(worktreePath, relPath),
        `export function complexityDirty(n: number): number {\n${branches}\n  return -1;\n}\n`,
      );
    }

    function commitAutofixAgentWork(worktreePath: string, changedRel: string): void {
      writeFileSync(join(worktreePath, changedRel), "export const changed=1\n", "utf8");
      writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
      execFileSync("git", ["-C", worktreePath, "add", changedRel, "proof.txt"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "agent work"], { stdio: "pipe" });
    }

    function autofixFormattingGate(changedRel: string, onGate: () => void): ReadyFinalizer {
      return async ({ worktreePath: gateWorktree }) => {
        onGate();
        if (!readFileSync(join(gateWorktree, changedRel), "utf8").includes("export const changed = 1")) {
          throw new ReadyGateError("bun run ready", 1, "formatting required");
        }
      };
    }

    describe("ready-gate repair autofix", () => {
      test("labels ready-gate repair commits", async () => {
        // Autofix commits through git for real: `enumerateRepairCompletionCandidates` short-circuits
        // to `[]` without a `.git` dir, which would mask the recommit under a fake committer.
        const autofixHome = createJarvisHome();
        const autofixBranch = "repair-autofix-labels-step";
        const autofixWorktree = join(autofixHome.jarvisRoot, "worktrees", "demo", autofixBranch);
        mkdirSync(autofixWorktree, { recursive: true });
        execFileSync("git", ["init", autofixWorktree], { stdio: "pipe" });
        execFileSync("git", ["-C", autofixWorktree, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", autofixWorktree, "config", "user.name", "Test User"], { stdio: "pipe" });
        writeFileSync(join(autofixWorktree, "spec.md"), "- [ ] work\n", "utf8");
        execFileSync("git", ["-C", autofixWorktree, "add", "-A"], { stdio: "pipe" });
        execFileSync("git", ["-C", autofixWorktree, "commit", "-m", "seed"], { stdio: "pipe" });
        const autofixBaseRef = execFileSync("git", ["-C", autofixWorktree, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();

        const autofixResult = await runLoop({
          jarvisRoot: autofixHome.jarvisRoot,
          stateDbPath: autofixHome.stateDbPath,
          branchName: autofixBranch,
          baseRef: autofixBaseRef,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                writeFileSync(join(cwd, "proof.txt"), "ok", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: completionHooks.completionPublisher,
          runFixCommand: proofFormattingFixCommand(),
          readyFinalizer: proofFormattingReadyFinalizer(() => {}),
        });

        expect(autofixResult.kind).toBe("complete");
        const autofixLog = execFileSync("git", ["-C", autofixWorktree, "log", "--format=%s%x00%b%x00==="], {
          encoding: "utf8",
        });
        const autofixCommit = autofixLog.split("===\n").find((entry) => entry.startsWith("ready-gate: "));
        expect(autofixCommit).toBeDefined();
        expect(autofixCommit).toContain("Jarvis-Step: ready-gate");
        expect(autofixCommit).toContain("Jarvis-Ready-Gate: autofix");

        const repairHome = createJarvisHome();
        const repairCommits: Array<{ title: string; step: unknown }> = [];
        let invocations = 0;
        const result = await runLoop({
          jarvisRoot: repairHome.jarvisRoot,
          stateDbPath: repairHome.stateDbPath,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          completionCommitter: async (input) => {
            repairCommits.push({ title: input.title, step: input.step });
            return completionHooks.completionCommitter();
          },
          completionPublisher: completionHooks.completionPublisher,
          runFixCommand: completionHooks.runFixCommand,
          readyFinalizer: async () => {
            if (invocations === 1) throw new ReadyGateError("bun run ready", 1, "tests failed");
          },
        });

        expect(result.kind).toBe("complete");
        const agentRepairCommit = repairCommits.find((c) => c.step !== undefined);
        expect(agentRepairCommit?.step).toEqual({ kind: "ready-gate" });
        expect((agentRepairCommit?.title as string).startsWith("ready-gate: ")).toBe(true);
      });

      test("ready-gate repair autofix greens a formatter-only red gate without repair iterations", async () => {
        // Mutation checkpoint: remove the ready-gate repair autofix block in `publishWithReadyRepair`.
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const logSink = new TestLogSink();
        let gateCalls = 0;
        let fixCalls = 0;
        let invocations = 0;
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                writeFileSync(join(cwd, "proof.txt"), "ok", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          ...completionHooks,
          runFixCommand: proofFormattingFixCommand(() => {
            fixCalls += 1;
          }),
          readyFinalizer: proofFormattingReadyFinalizer(() => {
            gateCalls += 1;
          }),
        });

        expect(result.kind).toBe("complete");
        expect(fixCalls).toBe(1);
        expect(gateCalls).toBe(2);
        expect(invocations).toBe(1);
        expect(logSink.getEventsForRun(result.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual([]);
      });

      test("ready-gate repair autofix runs once then preserves full agent repair budget", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const logSink = new TestLogSink();
        let _gateCalls = 0;
        let fixCalls = 0;
        let invocations = 0;
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                writeFileSync(join(cwd, "proof.txt"), "ok", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          ...completionHooks,
          runFixCommand: proofFormattingFixCommand(() => {
            fixCalls += 1;
          }),
          readyFinalizer: proofFormattingReadyFinalizer(
            () => {
              _gateCalls += 1;
            },
            () => {
              throw new ReadyGateError("bun run ready", 1, "lint still red");
            },
          ),
        });

        expect(result.kind).toBe("ready_gate_failed");
        expect(fixCalls).toBe(1);
        expect(invocations).toBe(4);
        expect(
          logSink.getEventsForRun(result.runId).filter((event) => event.kind === "ready_gate_repair"),
        ).toHaveLength(3);
        expect(result.iterationsConsumed).toBe(4);
      });

      test("ready-gate repair autofix rejects out-of-scope formatter changes", async () => {
        // Mutation checkpoint: remove the `enforceRepairIterationFence` call in the ready-gate repair autofix block of `publishWithReadyRepair`.
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-autofix-out-of-scope";
        const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
        execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
        mkdirSync(join(worktreePath, "v2", "src"), { recursive: true });
        writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
        writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
        writeFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "export {}\n", "utf8");
        writeFileSync(join(worktreePath, ".gitignore"), ".reused\n", "utf8");
        execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
        const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
        execFileSync("git", ["-C", worktreePath, "add", "proof.txt"], { stdio: "pipe" });

        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          readyGateScopeSeams: baseRefProbeFailsSeam,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          runFixCommand: async ({ cwd }) => {
            writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "changed\n", "utf8");
          },
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, "red");
          },
        });

        expect(result.kind).toBe("completion_commit_failed");
        expect(result.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(result.iterationsConsumed).toBe(1);
      });

      test("ready-gate repair autofix greens formatter-only red gate on gate-only resume without agent", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        roots.push(join(jarvisRoot, ".."));
        const store = openStateStore(stateDbPath);
        const branchName = "repair-autofix-gate-only-resume";
        const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
        mkdirSync(worktreePath, { recursive: true });
        writeFileSync(join(worktreePath, "proof.txt"), "ok", "utf8");
        writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
        const runId = store.createRun({
          project: "demo",
          specRef: "HEAD",
          worktreePath,
          branch: branchName,
          specPath: "spec.md",
        });
        const attemptId = store.recordAttemptStart(runId);
        store.commitCompletionBoundary({
          attemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        let gateCalls = 0;
        let fixCalls = 0;
        let agentInvocations = 0;

        try {
          const publication = await publishWithReadyRepair(
            {
              worktree: {
                projectRoot: "/fake",
                projectName: "demo",
                branchName,
                baseRef: "HEAD",
                jarvisRoot,
              },
              specPath: "spec.md",
              stepRules: "repair",
              expectedArtifactPath: "proof.txt",
              bindings: [
                {
                  id: "repair-agent",
                  metadata: { agent: "codex", model: "test" },
                  invoke: async () => {
                    agentInvocations += 1;
                    return { kind: "ok", stdout: "done", stderr: "" } as const;
                  },
                },
              ],
              stateStore: store,
              withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
              sessionsDir: join(jarvisRoot, "sessions"),
              maxIterations: 0,
              completionCommitter: completionHooks.completionCommitter,
              completionPublisher: completionHooks.completionPublisher,
              runFixCommand: proofFormattingFixCommand(() => {
                fixCalls += 1;
              }),
              readyFinalizer: proofFormattingReadyFinalizer(() => {
                gateCalls += 1;
              }),
            },
            store,
            { kind: "complete", runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
            0,
            {
              worktreePath,
              baseRef: "HEAD",
              specPath: "spec.md",
              branch: branchName,
            },
          );

          expect(publication.failure).toBeUndefined();
          expect(publication.success).toBeDefined();
          expect(fixCalls).toBe(1);
          expect(gateCalls).toBe(2);
          expect(agentInvocations).toBe(0);
          expect(publication.iterationsConsumed).toBe(0);
        } finally {
          store.close();
        }
      });

      test("an aborted signal short-circuits ready-gate repair without spending an iteration", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        roots.push(join(jarvisRoot, ".."));
        const store = openStateStore(stateDbPath);
        const branchName = "repair-aborted-short-circuit";
        const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
        mkdirSync(worktreePath, { recursive: true });
        writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
        writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
        const runId = store.createRun({
          project: "demo",
          specRef: "HEAD",
          worktreePath,
          branch: branchName,
          specPath: "spec.md",
        });
        const attemptId = store.recordAttemptStart(runId);
        store.commitCompletionBoundary({
          attemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        let gateCalls = 0;
        let fixCalls = 0;
        let agentInvocations = 0;
        const controller = new AbortController();
        controller.abort();

        try {
          const publication = await publishWithReadyRepair(
            {
              worktree: {
                projectRoot: "/fake",
                projectName: "demo",
                branchName,
                baseRef: "HEAD",
                jarvisRoot,
              },
              specPath: "spec.md",
              stepRules: "repair",
              expectedArtifactPath: "proof.txt",
              signal: controller.signal,
              bindings: [
                {
                  id: "repair-agent",
                  metadata: { agent: "codex", model: "test" },
                  invoke: async () => {
                    agentInvocations += 1;
                    return { kind: "ok", stdout: "done", stderr: "" } as const;
                  },
                },
              ],
              stateStore: store,
              withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
              sessionsDir: join(jarvisRoot, "sessions"),
              maxIterations: 3,
              completionCommitter: completionHooks.completionCommitter,
              completionPublisher: completionHooks.completionPublisher,
              runFixCommand: async () => {
                fixCalls += 1;
              },
              readyFinalizer: async () => {
                gateCalls += 1;
                throw new ReadyGateError("bun run ready", 1, "red");
              },
            },
            store,
            { kind: "complete", runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
            0,
            {
              worktreePath,
              baseRef: "HEAD",
              specPath: "spec.md",
              branch: branchName,
            },
          );

          expect(publication.failure?.kind).toBe("ready_gate_failed");
          expect(publication.iterationsConsumed).toBe(0);
          expect(gateCalls).toBe(1);
          expect(fixCalls).toBe(0);
          expect(agentInvocations).toBe(0);
        } finally {
          store.close();
        }
      });

      test("settles ready_gate_command_missing without autofix or repair when the gate command is absent", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const logSink = new TestLogSink();
        let fixCalls = 0;
        let agentInvocations = 0;
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                agentInvocations += 1;
                writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          ...completionHooks,
          runFixCommand: async () => {
            fixCalls += 1;
          },
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, 'Script not found "ready"');
          },
        });

        expect(result.kind).toBe("ready_gate_command_missing");
        expect(result.resumable).toBe(false);
        expect(fixCalls).toBe(0);
        expect(agentInvocations).toBe(1);
        const events = logSink.getEventsForRun(result.runId);
        expect(events.filter((event) => event.kind === "ready_gate_repair")).toEqual([]);
        expect(events.filter((event) => event.kind === "ready_gate_autofix_discarded")).toEqual([]);
        const loopEvent = events.at(-1);
        expect(loopEvent).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_command_missing",
          resumable: false,
          readyGateCommand: "bun run ready",
          readyGateCommandSource: "default",
          readyGateOutput: 'Script not found "ready"',
        });
        const run = openStateStore(stateDbPath).loadRun(result.runId);
        expect(run).toBeDefined();
        if (!run) return;
        expect(
          composeRunOperatorError(run, {
            runId: result.runId,
            seq: 1,
            ts: "",
            event: loopEvent as LoopFinishedEvent,
          }),
        ).toMatchObject({
          reason: "ready_gate_command_missing",
          nextAction: "stop",
          retryable: false,
          message: 'Ready gate command missing (default): bun run ready\nScript not found "ready"',
        });
      });

      test("ready-gate repair autofix ignores pre-existing out-of-diff lint findings", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        roots.push(join(jarvisRoot, ".."));
        const store = openStateStore(stateDbPath);
        const branchName = "repair-autofix-out-of-diff-noise";
        const worktreePath = initAutofixGitWorktree(jarvisRoot, branchName);
        const outOfDiffRel = "v2/src/preexisting-complex.ts";
        writeComplexityDirtyFile(worktreePath, outOfDiffRel);
        execFileSync("git", ["-C", worktreePath, "add", outOfDiffRel], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "commit", "-m", "add complexity"], { stdio: "pipe" });
        const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        const changedRel = "v2/src/changed.ts";
        commitAutofixAgentWork(worktreePath, changedRel);
        const runId = store.createRun({
          project: "demo",
          specRef: "HEAD",
          worktreePath,
          branch: branchName,
          specPath: "spec.md",
        });
        const attemptId = store.recordAttemptStart(runId);
        store.commitCompletionBoundary({
          attemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        let gateCalls = 0;

        try {
          const publication = await publishWithReadyRepair(
            {
              worktree: {
                projectRoot: "/fake",
                projectName: "demo",
                branchName,
                baseRef,
                jarvisRoot,
              },
              specPath: "spec.md",
              stepRules: "repair",
              expectedArtifactPath: "proof.txt",
              bindings: [],
              stateStore: store,
              withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
              sessionsDir: join(jarvisRoot, "sessions"),
              maxIterations: 0,
              completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
              completionPublisher: async () => ({}),
              runAutofixTypecheck: async () => ({ exitCode: 0, output: "" }),
              readyFinalizer: autofixFormattingGate(changedRel, () => {
                gateCalls += 1;
              }),
            },
            store,
            { kind: "complete", runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
            0,
            {
              worktreePath,
              baseRef,
              specPath: "spec.md",
              branch: branchName,
            },
          );

          expect(publication.failure).toBeUndefined();
          expect(publication.success).toBeDefined();
          expect(gateCalls).toBe(2);
          expect(readFileSync(join(worktreePath, outOfDiffRel), "utf8")).toContain("complexityDirty");
        } finally {
          store.close();
        }
      });

      test("ready-gate repair autofix best-effort-passes an unfixable complexity finding into bounded repair", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        roots.push(join(jarvisRoot, ".."));
        const store = openStateStore(stateDbPath);
        const branchName = "repair-autofix-unfixable-complexity";
        const worktreePath = initAutofixGitWorktree(jarvisRoot, branchName);
        const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        const changedRel = "v2/src/changed.ts";
        writeComplexityDirtyFile(worktreePath, changedRel);
        writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
        // Worktree reuse appends `.reused` to `.gitignore`; pre-seed it in this commit so the
        // marker lands inside the frozen run-diff allowset instead of tripping the repair fence.
        appendFileSync(join(worktreePath, ".gitignore"), ".reused\n", "utf8");
        execFileSync("git", ["-C", worktreePath, "add", changedRel, "proof.txt", ".gitignore"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "commit", "-m", "agent work"], { stdio: "pipe" });
        const runId = store.createRun({
          project: "demo",
          specRef: "HEAD",
          worktreePath,
          branch: branchName,
          specPath: "spec.md",
        });
        const attemptId = store.recordAttemptStart(runId);
        store.commitCompletionBoundary({
          attemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        let invocations = 0;
        const prompts: string[] = [];

        try {
          const publication = await publishWithReadyRepair(
            {
              worktree: {
                projectRoot: "/fake",
                projectName: "demo",
                branchName,
                baseRef,
                jarvisRoot,
              },
              specPath: "spec.md",
              stepRules: "repair",
              expectedArtifactPath: "proof.txt",
              bindings: [
                {
                  id: "sim.1",
                  metadata: { agent: "sim-agent-1", model: "sim-model-1" },
                  invoke: async ({ prompt }) => {
                    invocations += 1;
                    prompts.push(prompt);
                    return { kind: "ok", stdout: "done", stderr: "" } as const;
                  },
                },
              ],
              stateStore: store,
              withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
              sessionsDir: join(jarvisRoot, "sessions"),
              maxIterations: 1,
              completionCommitter: createCompletionCommitter(),
              completionPublisher: async () => ({}),
              runAutofixTypecheck: async () => ({ exitCode: 0, output: "" }),
              readyFinalizer: async () => {
                throw new ReadyGateError("bun run ready", 1, "lint still red");
              },
            },
            store,
            { kind: "complete", runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
            0,
            {
              worktreePath,
              baseRef,
              specPath: "spec.md",
              branch: branchName,
            },
          );

          expect(publication.failure?.kind).toBe("ready_gate_failed");
          expect(invocations).toBeGreaterThan(0);
          // A write.ready-repair reprompt renders the gate command/output into the prompt;
          // a completion_commit_failed short-circuit before repair never invokes the binding.
          expect(prompts[0]).toContain("Command: bun run ready");
          expect(prompts[0]).toContain("lint still red");
        } finally {
          store.close();
        }
      });

      const repairPromptForGateLog = async (branchName: string, gateLog: string): Promise<string | undefined> => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        roots.push(join(jarvisRoot, ".."));
        const store = openStateStore(stateDbPath);
        const worktreePath = initAutofixGitWorktree(jarvisRoot, branchName);
        const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        const changedRel = "v2/src/changed.ts";
        writeComplexityDirtyFile(worktreePath, changedRel);
        writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
        // Worktree reuse appends `.reused` to `.gitignore`; pre-seed it in this commit so the
        // marker lands inside the frozen run-diff allowset instead of tripping the repair fence.
        appendFileSync(join(worktreePath, ".gitignore"), ".reused\n", "utf8");
        execFileSync("git", ["-C", worktreePath, "add", changedRel, "proof.txt", ".gitignore"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "commit", "-m", "agent work"], { stdio: "pipe" });
        const runId = store.createRun({
          project: "demo",
          specRef: "HEAD",
          worktreePath,
          branch: branchName,
          specPath: "spec.md",
        });
        const attemptId = store.recordAttemptStart(runId);
        store.commitCompletionBoundary({
          attemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        const prompts: string[] = [];

        try {
          const publication = await publishWithReadyRepair(
            {
              worktree: {
                projectRoot: "/fake",
                projectName: "demo",
                branchName,
                baseRef,
                jarvisRoot,
              },
              specPath: "spec.md",
              stepRules: "repair",
              expectedArtifactPath: "proof.txt",
              bindings: [
                {
                  id: "sim.1",
                  metadata: { agent: "sim-agent-1", model: "sim-model-1" },
                  invoke: async ({ prompt }) => {
                    prompts.push(prompt);
                    return { kind: "ok", stdout: "done", stderr: "" } as const;
                  },
                },
              ],
              stateStore: store,
              withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
              sessionsDir: join(jarvisRoot, "sessions"),
              maxIterations: 1,
              completionCommitter: createCompletionCommitter(),
              completionPublisher: async () => ({}),
              runAutofixTypecheck: async () => ({ exitCode: 0, output: "" }),
              readyFinalizer: async () => {
                throw new ReadyGateError("bun run ready", 1, gateLog);
              },
            },
            store,
            { kind: "complete", runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
            0,
            {
              worktreePath,
              baseRef,
              specPath: "spec.md",
              branch: branchName,
            },
          );

          expect(publication.failure?.kind).toBe("ready_gate_failed");
          // A completion_commit_failed short-circuit before repair never invokes the binding.
          return prompts[0];
        } finally {
          store.close();
        }
      };

      test("ready-gate repair prompt carries only the failing step command and output", async () => {
        const stdout = [
          readyStepStartRecord({ stepId: "1", attemptId: "1.1", command: "bun install" }),
          "PASSING-STEP-WARNING\n",
          readyStepStartRecord({ stepId: "2", attemptId: "2.1", command: "bun run check" }),
          "FAILING-STEP-DIAGNOSTIC\n",
        ].join("");
        const stderr = [
          readyStepStartRecord({ stepId: "1", attemptId: "1.1", command: "bun install" }),
          readyStepCompletionRecord({ stepId: "1", attemptId: "1.1", command: "bun install", status: 0 }),
          readyStepStartRecord({ stepId: "2", attemptId: "2.1", command: "bun run check" }),
          readyStepCompletionRecord({ stepId: "2", attemptId: "2.1", command: "bun run check", status: 1 }),
        ].join("");

        const prompt = await repairPromptForGateLog("repair-prompt-failing-step", `${stdout}${stderr}`);

        expect(prompt).toContain("Command: bun run ready");
        expect(prompt).toContain("Failing step: bun run check");
        expect(prompt).toContain("FAILING-STEP-DIAGNOSTIC");
        expect(prompt).not.toContain("PASSING-STEP-WARNING");
      });

      test("ready-gate repair prompt caps the failing step output, not the whole log", async () => {
        // A short failing step preceded by oversized passing output: a whole-log tail would reach
        // back into the passing step's padding, while a step-scoped cap leaves the short failing
        // body whole. Only the step-scoped cap keeps PASSING-PAD-TAIL out of the prompt.
        const stdout = [
          readyStepStartRecord({ stepId: "1", attemptId: "1.1", command: "bun run check" }),
          `${"x".repeat(20000)}PASSING-PAD-TAIL\n`,
          readyStepStartRecord({ stepId: "2", attemptId: "2.1", command: "bun run test:v2" }),
          "FAILING-BODY\n",
        ].join("");
        const stderr = [
          readyStepCompletionRecord({ stepId: "1", attemptId: "1.1", command: "bun run check", status: 0 }),
          readyStepCompletionRecord({ stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 }),
        ].join("");

        const prompt = await repairPromptForGateLog("repair-prompt-output-cap", `${stdout}${stderr}`);

        expect(prompt).toContain("FAILING-BODY");
        expect(prompt).not.toContain("PASSING-PAD-TAIL");
      });

      test("ready-gate repair prompt truncates an oversized failing step to its tail", async () => {
        const stdout = [
          readyStepStartRecord({ stepId: "1", attemptId: "1.1", command: "bun run check" }),
          `HEAD-MARK${"x".repeat(20000)}TAIL-MARK\n`,
        ].join("");
        const stderr = [
          readyStepStartRecord({ stepId: "1", attemptId: "1.1", command: "bun run check" }),
          readyStepCompletionRecord({ stepId: "1", attemptId: "1.1", command: "bun run check", status: 1 }),
        ].join("");

        const prompt = await repairPromptForGateLog("repair-prompt-output-cap-oversized", `${stdout}${stderr}`);

        expect(prompt).toContain("TAIL-MARK");
        expect(prompt).not.toContain("HEAD-MARK");
      });

      async function publishWithUnderivableFence(
        branchName: string,
        site: "repair_fence_initialization" | "autofix_path_enumeration",
      ): Promise<{
        publication: Awaited<ReturnType<typeof publishWithReadyRepair>>;
        logSink: TestLogSink;
        runId: string;
      }> {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        roots.push(join(jarvisRoot, ".."));
        const store = openStateStore(stateDbPath);
        const worktreePath = initAutofixGitWorktree(jarvisRoot, branchName);
        const goodBaseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        commitAutofixAgentWork(worktreePath, "v2/src/changed.ts");
        const baseRef = site === "repair_fence_initialization" ? "refs/heads/no-such-base" : goodBaseRef;
        const runId = store.createRun({
          project: "demo",
          specRef: "HEAD",
          worktreePath,
          branch: branchName,
          specPath: "spec.md",
        });
        const attemptId = store.recordAttemptStart(runId);
        store.commitCompletionBoundary({
          attemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        const logSink = new TestLogSink();
        try {
          const publication = await publishWithReadyRepair(
            {
              worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef, jarvisRoot },
              specPath: "spec.md",
              stepRules: "repair",
              expectedArtifactPath: "proof.txt",
              bindings: [],
              stateStore: store,
              logSink,
              withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
              sessionsDir: join(jarvisRoot, "sessions"),
              maxIterations: 0,
              completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
              completionPublisher: async () => ({}),
              readyGateScopeSeams: {
                gitDiffNameStatus: async () => "\0",
                gitUntracked: async () => "\0",
                listSpecTreePaths: async () => [],
              },
              runBuiltInReadyGateAutofixBiome: async (opts) =>
                runBuiltInReadyGateAutofixBiome({
                  ...opts,
                  readyGateScopeSeams: { gitDiffNameStatus: async () => null },
                }),
              runAutofixTypecheck: async () => ({ exitCode: 0, output: "" }),
              readyFinalizer: async () => {
                throw new ReadyGateError("bun run ready", 1, "formatting required");
              },
            },
            store,
            { kind: "complete", runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
            0,
            { worktreePath, baseRef, specPath: "spec.md", branch: branchName },
          );
          return { publication, logSink, runId };
        } finally {
          store.close();
        }
      }

      test("repair-fence derivation failure logs its named reason before settling", async () => {
        const { publication, logSink, runId } = await publishWithUnderivableFence(
          "repair-fence-derivation-failure",
          "repair_fence_initialization",
        );

        const logged = logSink.getEventsForRun(runId).filter((e) => e.kind === "ready_gate_fence_derivation_failed");
        expect(logged).toEqual([
          {
            kind: "ready_gate_fence_derivation_failed",
            reason: "diff_unavailable",
            site: "repair_fence_initialization",
          },
        ]);
        expect(publication.failure?.kind).toBe("completion_commit_failed");
        expect(publication.failure?.error?.message).toContain("diff_unavailable");
      });

      test("autofix path-enumeration derivation failure logs its named reason before settling", async () => {
        const { publication, logSink, runId } = await publishWithUnderivableFence(
          "autofix-derivation-failure",
          "autofix_path_enumeration",
        );

        const logged = logSink.getEventsForRun(runId).filter((e) => e.kind === "ready_gate_fence_derivation_failed");
        expect(logged).toEqual([
          { kind: "ready_gate_fence_derivation_failed", reason: "diff_unavailable", site: "autofix_path_enumeration" },
        ]);
        expect(publication.failure?.kind).toBe("completion_commit_failed");
        expect(publication.failure?.error?.message).toContain("diff_unavailable");
      });

      test("ready-gate repair autofix scopes biome argv to changed paths", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        roots.push(join(jarvisRoot, ".."));
        const store = openStateStore(stateDbPath);
        const branchName = "repair-autofix-scoped-argv";
        const worktreePath = initAutofixGitWorktree(jarvisRoot, branchName);
        const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        const changedRel = "v2/src/changed.ts";
        commitAutofixAgentWork(worktreePath, changedRel);
        const runId = store.createRun({
          project: "demo",
          specRef: "HEAD",
          worktreePath,
          branch: branchName,
          specPath: "spec.md",
        });
        const attemptId = store.recordAttemptStart(runId);
        store.commitCompletionBoundary({
          attemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        let capturedArgv: string[] | undefined;
        let gateCalls = 0;

        try {
          const publication = await publishWithReadyRepair(
            {
              worktree: {
                projectRoot: "/fake",
                projectName: "demo",
                branchName,
                baseRef,
                jarvisRoot,
              },
              specPath: "spec.md",
              stepRules: "repair",
              expectedArtifactPath: "proof.txt",
              bindings: [],
              stateStore: store,
              withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
              sessionsDir: join(jarvisRoot, "sessions"),
              maxIterations: 0,
              completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
              completionPublisher: async () => ({}),
              runBuiltInReadyGateAutofixBiome: async (opts) => {
                await runBuiltInReadyGateAutofixBiome(opts, {
                  runAsync: async (cmd, argv, cwd, runOpts) => {
                    if (cmd === "bun" && argv[0] === "biome") {
                      capturedArgv = [...argv];
                      return "";
                    }
                    return realAsyncSubprocessRunner.runAsync(cmd, argv, cwd, runOpts);
                  },
                });
                writeFileSync(join(opts.cwd, changedRel), "export const changed = 1;\n", "utf8");
              },
              runAutofixTypecheck: async () => ({ exitCode: 0, output: "" }),
              readyFinalizer: autofixFormattingGate(changedRel, () => {
                gateCalls += 1;
              }),
            },
            store,
            { kind: "complete", runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
            0,
            {
              worktreePath,
              baseRef,
              specPath: "spec.md",
              branch: branchName,
            },
          );

          expect(publication.failure).toBeUndefined();
          expect(publication.success).toBeDefined();
          expect(gateCalls).toBe(2);
          expect(capturedArgv).toContain("--unsafe");
          expect(capturedArgv).toContain("--max-diagnostics=256");
          expect(capturedArgv).toContain(changedRel);
          expect(capturedArgv?.some((arg) => arg === ".")).toBe(false);
        } finally {
          store.close();
        }
      });

      describe("runBuiltInReadyGateAutofixBiome", () => {
        function interceptBiomeCall(reject: (cmd: string, argv: string[]) => never): AsyncSubprocessRunner {
          return {
            runAsync: async (cmd, argv, cwd, runOpts) => {
              if (cmd === "bun" && argv[0] === "biome") {
                reject(cmd, argv);
              }
              return realAsyncSubprocessRunner.runAsync(cmd, argv, cwd, runOpts);
            },
          };
        }

        function setupCommittedWorktree(branchName: string): { worktreePath: string; baseRef: string } {
          const { jarvisRoot } = createJarvisHome();
          const worktreePath = initAutofixGitWorktree(jarvisRoot, branchName);
          const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
            encoding: "utf8",
            stdio: "pipe",
          }).trim();
          commitAutofixAgentWork(worktreePath, "v2/src/changed.ts");
          return { worktreePath, baseRef };
        }

        test("returns normally when biome rejects with a defined numeric status", async () => {
          const { worktreePath, baseRef } = setupCommittedWorktree("builtin-autofix-status-code");

          await expect(
            runBuiltInReadyGateAutofixBiome(
              { cwd: worktreePath, baseRef, timeoutMs: 5000 },
              interceptBiomeCall(() => {
                throw new AsyncSubprocessError("Command failed", 1, "", "noExcessiveCognitiveComplexity", undefined);
              }),
            ),
          ).resolves.toBeUndefined();
        });

        test("throws FixCommandError naming the timeout budget on ETIMEDOUT", async () => {
          const { worktreePath, baseRef } = setupCommittedWorktree("builtin-autofix-etimedout");

          await expect(
            runBuiltInReadyGateAutofixBiome(
              { cwd: worktreePath, baseRef, timeoutMs: 5000 },
              interceptBiomeCall(() => {
                throw new AsyncSubprocessError("Command timed out", undefined, "", "", "ETIMEDOUT");
              }),
            ),
          ).rejects.toThrow(/exceeded 5000ms budget/);
        });

        test("throws FixCommandError when the rejection carries no status (spawn failure)", async () => {
          const { worktreePath, baseRef } = setupCommittedWorktree("builtin-autofix-spawn-failure");

          await expect(
            runBuiltInReadyGateAutofixBiome(
              { cwd: worktreePath, baseRef, timeoutMs: 5000 },
              interceptBiomeCall(() => {
                throw new AsyncSubprocessError("spawn bun ENOENT", undefined, "", "", undefined);
              }),
            ),
          ).rejects.toThrow(FixCommandError);
        });
      });

      test("ready-gate repair autofix invokes configured fixCommand", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        let observedFixCommand: string | undefined;
        let gateCalls = 0;
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                writeFileSync(join(cwd, "proof.txt"), "ok", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          fixCommand: "npm run lint-fix",
          ...completionHooks,
          runFixCommand: async (opts) => {
            observedFixCommand = opts.fixCommand;
            fixProofFormatting(opts.cwd);
          },
          readyFinalizer: proofFormattingReadyFinalizer(() => {
            gateCalls += 1;
          }),
        });

        expect(result.kind).toBe("complete");
        expect(observedFixCommand).toBe("npm run lint-fix");
        expect(gateCalls).toBe(2);
      });

      test("configured fixCommand exiting non-zero settles completion_commit_failed", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                writeFileSync(join(cwd, "proof.txt"), "ok", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          fixCommand: "npm run lint-fix",
          ...completionHooks,
          runFixCommand: async () => {
            throw new FixCommandError("npm run lint-fix failed");
          },
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, "lint still red");
          },
        });

        expect(result.kind).toBe("completion_commit_failed");
        expect(result.completionCommitError).toContain("npm run lint-fix failed");
      });

      test("autofix output failing typecheck is reverted before the fence commit", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const logSink = new TestLogSink();
        const branchName = "repair-autofix-typecheck-discard";
        let gateCalls = 0;
        let invocations = 0;
        let autofixCommits = 0;
        const typecheckOutput = "error TS2322: Type 'string' is not assignable to type 'number'.";
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                writeFileSync(join(cwd, "proof.txt"), invocations === 1 ? "ok" : "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          ...completionHooks,
          completionCommitter: async (input) => {
            if (input.readyGateAttribution === "autofix") {
              autofixCommits += 1;
            }
            return completionHooks.completionCommitter();
          },
          runAutofixTypecheck: async () => ({ exitCode: 1, output: typecheckOutput }),
          runFixCommand: async ({ cwd }) => {
            fixProofFormatting(cwd);
            writeFileSync(join(cwd, "broken.ts"), "const x: number = 'bad'\n", "utf8");
          },
          readyFinalizer: proofFormattingReadyFinalizer(() => {
            gateCalls += 1;
          }),
        });

        const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
        expect(result.kind).toBe("complete");
        expect(autofixCommits).toBe(0);
        expect(gateCalls).toBe(2);
        expect(invocations).toBe(2);
        expect(existsSync(join(worktreePath, "broken.ts"))).toBe(false);
        expect(readFileSync(join(worktreePath, "proof.txt"), "utf8")).toBe("ok\n");
        expect(logSink.getEventsForRun(result.runId)).toContainEqual({
          kind: "ready_gate_autofix_discarded",
          typecheckExitCode: 1,
          typecheckOutput,
        });
        expect(logSink.getEventsForRun(result.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual([
          {
            kind: "ready_gate_repair",
            attempt: 1,
            gateExitCode: 1,
            ...readyGateRepairLogFields("bun run ready", "formatting required"),
          },
        ]);
      });

      test("autofix output that typechecks is fence-committed and re-gated without discard", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const logSink = new TestLogSink();
        let gateCalls = 0;
        let fixCalls = 0;
        let typecheckCalls = 0;
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                writeFileSync(join(cwd, "proof.txt"), "ok", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          ...completionHooks,
          runAutofixTypecheck: async () => {
            typecheckCalls += 1;
            return { exitCode: 0, output: "" };
          },
          runFixCommand: proofFormattingFixCommand(() => {
            fixCalls += 1;
          }),
          readyFinalizer: proofFormattingReadyFinalizer(() => {
            gateCalls += 1;
          }),
        });

        expect(result.kind).toBe("complete");
        expect(typecheckCalls).toBe(1);
        expect(fixCalls).toBe(1);
        expect(gateCalls).toBe(2);
        expect(
          logSink.getEventsForRun(result.runId).filter((event) => event.kind === "ready_gate_autofix_discarded"),
        ).toEqual([]);
        expect(logSink.getEventsForRun(result.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual([]);
      });
    });

    describe("untouched-path gate settlement", () => {
      test("settles ready_gate_out_of_scope without repair while in-scope failures enter bounded repair", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "gate-out-of-scope";
        const outOfScopeBranch = `${branchName}-oos`;
        const { baseRef: outOfScopeBaseRef } = initGateScopeWorktree(jarvisRoot, outOfScopeBranch);
        const logSink = new TestLogSink();
        let inScopeGateCalls = 0;
        let inScopeInvocations = 0;

        const outOfScope = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName: outOfScopeBranch,
          baseRef: outOfScopeBaseRef,
          logSink,
          readyGateScopeSeams: baseRefProbeFailsSeam,
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          ...completionHooks,
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, gateFailureOutput("v2/src/untouched.test.ts"));
          },
        });

        expect(outOfScope.kind).toBe("ready_gate_out_of_scope");
        expect(outOfScope.resumable).toBe(false);
        expect(outOfScope.iterationsConsumed).toBe(1);
        expect(logSink.getEventsForRun(outOfScope.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual(
          [],
        );
        expect(logSink.getEventsForRun(outOfScope.runId).at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_out_of_scope",
          iterationsConsumed: 1,
          resumable: false,
        });

        const inScopeBranch = `${branchName}-in-scope`;
        const { baseRef: inScopeBaseRef } = initGateScopeWorktree(jarvisRoot, inScopeBranch);
        const inScope = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName: inScopeBranch,
          baseRef: inScopeBaseRef,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                inScopeInvocations += 1;
                writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          completionCommitter: completionHooks.completionCommitter,
          completionPublisher: completionHooks.completionPublisher,
          runFixCommand: completionHooks.runFixCommand,
          readyFinalizer: async () => {
            inScopeGateCalls += 1;
            if (inScopeInvocations === 1) {
              throw new ReadyGateError("bun run ready", 1, gateFailureOutput("proof.txt"));
            }
          },
        });

        expect(inScope.kind).toBe("complete");
        expect(inScopeGateCalls).toBe(3);
        expect(logSink.getEventsForRun(inScope.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual([
          {
            kind: "ready_gate_repair",
            attempt: 1,
            gateExitCode: 1,
            ...readyGateRepairLogFields("bun run ready", gateFailureOutput("proof.txt")),
          },
        ]);
      });

      test("repairs once on an in-scope gate then settles ready_gate_out_of_scope on a later untouched gate", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "gate-repair-then-out-of-scope";
        const { baseRef } = initGateScopeWorktree(jarvisRoot, branchName);
        const logSink = new TestLogSink();
        let gateCalls = 0;
        let invocations = 0;

        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          readyGateScopeSeams: baseRefProbeFailsSeam,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          completionCommitter: completionHooks.completionCommitter,
          completionPublisher: completionHooks.completionPublisher,
          runFixCommand: completionHooks.runFixCommand,
          readyFinalizer: async () => {
            gateCalls += 1;
            if (invocations === 1) {
              throw new ReadyGateError("bun run ready", 1, gateFailureOutput("proof.txt"));
            }
            throw new ReadyGateError("bun run ready", 1, gateFailureOutput("v2/src/untouched.test.ts"));
          },
        });

        expect(result.kind).toBe("ready_gate_out_of_scope");
        expect(result.resumable).toBe(false);
        expect(gateCalls).toBe(3);
        expect(invocations).toBe(2);
        expect(result.iterationsConsumed).toBe(2);
        const events = logSink.getEventsForRun(result.runId);
        expect(events.filter((event) => event.kind === "ready_gate_repair")).toEqual([
          {
            kind: "ready_gate_repair",
            attempt: 1,
            gateExitCode: 1,
            ...readyGateRepairLogFields("bun run ready", gateFailureOutput("proof.txt")),
          },
        ]);
        expect(events.at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_out_of_scope",
          iterationsConsumed: 2,
          resumable: false,
        });
      });

      test("unchanged-path out-of-scope settlement is terminal non-resumable", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "gate-out-of-scope-non-resumable";
        const outsidePath = "v2/src/untouched.test.ts";
        const { baseRef } = initGateScopeWorktree(jarvisRoot, branchName);
        const logSink = new TestLogSink();

        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          readyGateScopeSeams: baseRefProbeFailsSeam,
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          ...completionHooks,
          logSink,
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, gateFailureOutput(outsidePath));
          },
        });

        expect(result.kind).toBe("ready_gate_out_of_scope");
        expect(result.resumable).toBe(false);
        const loopEvent = logSink.getEventsForRun(result.runId).at(-1);
        expect(loopEvent).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_out_of_scope",
          resumable: false,
          readyGateOutsidePaths: [outsidePath],
        });
        const run = openStateStore(stateDbPath).loadRun(result.runId);
        expect(run).toBeDefined();
        if (!run) return;
        expect(
          composeRunOperatorError(run, {
            runId: result.runId,
            seq: 1,
            ts: "",
            event: loopEvent as LoopFinishedEvent,
          }),
        ).toMatchObject({
          reason: "ready_gate_out_of_scope",
          nextAction: "stop",
          retryable: false,
          readyGateOutsidePaths: [outsidePath],
        });
      });

      test("settlement persists per-path base-ref probe observations and names them in the detail", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "gate-out-of-scope-observations";
        const outsidePath = "v2/src/untouched.test.ts";
        const { baseRef } = initGateScopeWorktree(jarvisRoot, branchName);
        const logSink = new TestLogSink();

        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          readyGateScopeSeams: baseRefProbeFailsSeam,
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          ...completionHooks,
          logSink,
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, gateFailureOutput(outsidePath));
          },
        });

        expect(result.kind).toBe("ready_gate_out_of_scope");
        const expectedObservations = { [outsidePath]: PLACEHOLDER_BASE_REF_PROBE_OBSERVATION };
        const loopEvent = logSink.getEventsForRun(result.runId).at(-1);
        expect(loopEvent).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_out_of_scope",
          readyGateOutsidePaths: [outsidePath],
          readyGateOutOfScopeObservations: expectedObservations,
          readyGateOutOfScopeDetail: formatReadyGateOutOfScopeDetail([outsidePath], baseRef, expectedObservations),
        });
      });

      test("never invokes repair for a fully attributed untouched-path gate", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "gate-out-of-scope-no-repair";
        const { baseRef } = initGateScopeWorktree(jarvisRoot, branchName);
        const logSink = new TestLogSink();
        let invocations = 0;

        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          readyGateScopeSeams: baseRefProbeFailsSeam,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          ...completionHooks,
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, gateFailureOutput("v2/src/untouched.test.ts"));
          },
        });

        expect(result.kind).toBe("ready_gate_out_of_scope");
        expect(invocations).toBe(1);
        expect(logSink.getEventsForRun(result.runId).some((event) => event.kind === "ready_gate_repair")).toBe(false);
        expect(
          logSink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_started"),
        ).toHaveLength(1);
      });

      test("admits repair for an outside-diff gate failure that passes on baseRef and extends the allowset", async () => {
        const outsidePath = "v2/src/untouched.test.ts";
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "gate-outside-diff-in-scope";
        const { worktreePath, baseRef } = initOutsideDiffRepairWorktree(jarvisRoot, branchName);
        const frozenAllowset = await deriveAllowedOrUndefined(
          { worktreePath, baseRef, specPath: "spec.md" },
          { gitUntracked: async () => "\0" },
        );
        expect(frozenAllowset?.has(outsidePath)).toBe(false);

        let invocations = 0;
        let gateCalls = 0;
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          readyGateScopeSeams: {
            reproduceReadyGateAtBaseRef: async () => "pass",
          },
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                if (invocations === 1) {
                  writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                } else {
                  writeFileSync(join(cwd, outsidePath), "fixed\n", "utf8");
                }
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          completionCommitter: completionHooks.completionCommitter,
          completionPublisher: completionHooks.completionPublisher,
          runFixCommand: completionHooks.runFixCommand,
          readyFinalizer: async () => {
            gateCalls += 1;
            if (invocations === 1) {
              throw new ReadyGateError("bun run ready", 1, gateFailureOutput(outsidePath));
            }
          },
        });

        expect(result.kind).toBe("complete");
        expect(gateCalls).toBe(3);
        expect(invocations).toBe(2);
        const candidates = (await enumerateRepairCompletionCandidates(worktreePath)) ?? [];
        expect(findFirstRepairFenceViolation(candidates, frozenAllowset ?? new Set())).toEqual(outsidePath);
        const extendedAllowset = new Set(frozenAllowset ?? []);
        extendedAllowset.add(outsidePath);
        expect(findFirstRepairFenceViolation(candidates, extendedAllowset)).toBeUndefined();
      });

      test("logs ready_gate_base_ref_probe before ready_gate_repair when base-ref probe errors", async () => {
        const probeMessage = "exit 2: cannot run base-ref probe";
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "gate-base-ref-probe-error";
        const { baseRef } = initGateScopeWorktree(jarvisRoot, branchName);
        const logSink = new TestLogSink();
        let invocations = 0;

        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          maxIterations: 2,
          logSink,
          readyGateScopeSeams: {
            reproduceReadyGateAtBaseRef: async () => ({ kind: "error", message: probeMessage }),
          },
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          ...completionHooks,
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, gateFailureOutput("v2/src/untouched.test.ts"));
          },
        });

        expect(result.kind).toBe("ready_gate_failed");
        expect(result.resumable).toBe(true);
        expect(invocations).toBeGreaterThanOrEqual(2);
        const events = logSink.getEventsForRun(result.runId);
        const probeIndex = events.findIndex((event) => event.kind === "ready_gate_base_ref_probe");
        const repairIndex = events.findIndex((event) => event.kind === "ready_gate_repair");
        expect(probeIndex).toBeGreaterThanOrEqual(0);
        expect(repairIndex).toBeGreaterThan(probeIndex);
        expect(events[probeIndex]).toMatchObject({ kind: "ready_gate_base_ref_probe", message: probeMessage });
        expect(events.some((event) => event.kind === "ready_gate_repair")).toBe(true);
        expect(events.at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_failed",
          resumable: true,
        });
        expect(loadRunOnce(stateDbPath, result.runId)?.operatorFailureRecord?.retryable).toBe(true);
      });
    });
  });
});
