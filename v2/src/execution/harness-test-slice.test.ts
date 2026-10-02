import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { AsyncSubprocessError, type AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { LogEvent, LogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import type { ExternalWorktree, withExternalWorktree } from "./external-worktree.ts";
import { leasedHarnessFullSuiteGateSpawnCount, liveGateInvocationLeaseCount } from "./gate-invocation-lease.ts";
import {
  createDefaultHarnessTestSliceRunner,
  HARNESS_TEST_SLICE_REQUEST_FILE,
  type HarnessTestSliceRunner,
  takeHarnessTestSliceRequest,
  unverifiedMeasurementCriteria,
} from "./harness-test-slice.ts";
import { createStubMarkdownlintRunner } from "./workflow-runner.test-support.ts";
import { executeWrite } from "./write.ts";
import { executeWriteLoop, findHarnessTestSliceRunFilesFromLog } from "./write-loop.ts";

const { roots } = trackedTempRoots();
const SLICE_FILE = "v2/src/demo.sandbox-unrunnable.test.ts";
const SUBSPEC = "00-subspec.md";

class TestLogSink implements LogSink {
  events: Array<{ runId: string; event: LogEvent }> = [];
  append(runId: string, event: LogEvent): void {
    this.events.push({ runId, event });
  }
  close(): void {}
}

function worktreeFor(jarvisRoot: string, branchName: string): string {
  return join(jarvisRoot, "worktrees", "demo", branchName);
}

function seedSubspec(worktreePath: string, criteria: string): string {
  mkdirSync(worktreePath, { recursive: true });
  const path = join(worktreePath, SUBSPEC);
  writeFileSync(path, `# Sub\n\n## Acceptance criteria\n\n${criteria}`, "utf8");
  return path;
}

function gitAwareWorktree(jarvisRoot: string): typeof withExternalWorktree {
  const base = createFakeWithExternalWorktree(jarvisRoot);
  return async (args, run) =>
    base(args, async (worktree: ExternalWorktree) => {
      if (!existsSync(join(worktree.path, ".git"))) {
        execFileSync("git", ["init", "-q"], { cwd: worktree.path });
        execFileSync("git", ["config", "user.email", "t@t"], { cwd: worktree.path });
        execFileSync("git", ["config", "user.name", "t"], { cwd: worktree.path });
        execFileSync("git", ["add", "-A"], { cwd: worktree.path });
        execFileSync("git", ["commit", "-qm", "baseline"], { cwd: worktree.path });
      }
      return run(worktree);
    });
}

afterEach(() => {
  expect(liveGateInvocationLeaseCount()).toBe(0);
});

describe("write step: integration-slice test command", () => {
  test("runs an agent-requested sandbox-unrunnable test file outside the agent invocation, holding the gate slot, and returns its output", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const branchName = `slice-run-${Date.now()}`;
    const worktreePath = worktreeFor(jarvisRoot, branchName);
    seedSubspec(worktreePath, `- [ ] \`${SLICE_FILE}\` runs faster than the merge base\n`);
    mkdirSync(join(worktreePath, "v2", "src"), { recursive: true });
    writeFileSync(join(worktreePath, SLICE_FILE), "// slice\n", "utf8");

    const order: string[] = [];
    const prompts: string[] = [];
    const binding: InvocationBinding = {
      id: "agent",
      metadata: { agent: "test-agent", model: "test" },
      invoke: async (input) => {
        prompts.push(input.prompt);
        order.push(`agent-${prompts.length}-start`);
        if (prompts.length === 1) {
          writeFileSync(
            join(input.cwd, HARNESS_TEST_SLICE_REQUEST_FILE),
            `${SLICE_FILE}\n../escape.sandbox-unrunnable.test.ts\n`,
          );
        }
        order.push(`agent-${prompts.length}-end`);
        return { kind: "ok", stdout: "progress", stderr: "" };
      },
    };
    const runnerCalls: Array<{ files: readonly string[]; leased: number }> = [];
    const runner: HarnessTestSliceRunner = async ({ files }) => {
      order.push("harness-run");
      runnerCalls.push({ files, leased: leasedHarnessFullSuiteGateSpawnCount() });
      return { exitCode: 0, output: "3 pass\nRan 3 tests across 1 file. [19.57s]" };
    };

    const sink = new TestLogSink();
    const store = openStateStore(stateDbPath);
    let result: Awaited<ReturnType<typeof executeWriteLoop>>;
    try {
      result = await executeWriteLoop({
        stagedMarkdownLintRunner: createStubMarkdownlintRunner(),
        worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return progress.",
        expectedArtifactPath: SUBSPEC,
        promptId: "implement.prompt.body",
        bindings: [binding],
        stateStore: store,
        logSink: sink,
        withExternalWorktree: gitAwareWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        completionCommitter: createCompletionCommitter(),
        runHarnessTestSlice: runner,
        maxIterations: 2,
        clock: () => new Date("2026-10-02T06:00:00.000Z"),
      });
    } finally {
      store.close();
    }

    expect(order).toEqual(["agent-1-start", "agent-1-end", "harness-run", "agent-2-start", "agent-2-end"]);
    expect(runnerCalls).toEqual([{ files: [SLICE_FILE], leased: 1 }]);
    expect(prompts[0]).not.toContain("Integration-slice test result");
    expect(prompts[1]).toContain("Integration-slice test result");
    expect(prompts[1]).toContain(`bun test ${SLICE_FILE}`);
    expect(prompts[1]).toContain("exit code 0");
    expect(prompts[1]).toContain("Ran 3 tests across 1 file. [19.57s]");
    expect(prompts[1]).toContain("../escape.sandbox-unrunnable.test.ts");
    const runEvent = sink.events.find(
      (entry) => entry.runId === result.runId && entry.event.kind === "harness_test_slice_run",
    );
    expect(runEvent?.event).toMatchObject({
      files: [SLICE_FILE],
      rejected: ["../escape.sandbox-unrunnable.test.ts"],
      exitCode: 0,
    });
    expect(existsSync(join(worktreePath, HARNESS_TEST_SLICE_REQUEST_FILE))).toBe(false);
    const committed = execFileSync("git", ["-C", worktreePath, "log", "--all", "--name-only", "--format="], {
      encoding: "utf8",
    });
    expect(committed).not.toContain(HARNESS_TEST_SLICE_REQUEST_FILE);
  });

  test("takeHarnessTestSliceRequest admits only existing in-worktree sandbox-unrunnable files and consumes the request", () => {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const worktreePath = worktreeFor(jarvisRoot, "take");
    mkdirSync(join(worktreePath, "v2", "src"), { recursive: true });
    writeFileSync(join(worktreePath, SLICE_FILE), "", "utf8");
    writeFileSync(
      join(worktreePath, HARNESS_TEST_SLICE_REQUEST_FILE),
      `${SLICE_FILE}\n${SLICE_FILE}\n/abs/x.sandbox-unrunnable.test.ts\nv2/src/plain.test.ts\nv2/src/missing.sandbox-unrunnable.test.ts\n`,
    );
    expect(takeHarnessTestSliceRequest(worktreePath)).toEqual({
      files: [SLICE_FILE],
      rejected: [
        "/abs/x.sandbox-unrunnable.test.ts",
        "v2/src/plain.test.ts",
        "v2/src/missing.sandbox-unrunnable.test.ts",
      ],
    });
    expect(takeHarnessTestSliceRequest(worktreePath)).toBeUndefined();
  });

  test("default runner spawns bun test with combined output and maps a red exit to a result", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        calls.push({ cmd, args, cwd });
        throw new AsyncSubprocessError("exit 1", 1, "1 fail\n", "", undefined);
      },
    };
    const result = await createDefaultHarnessTestSliceRunner(runner)({
      worktreePath: "/wt",
      files: [SLICE_FILE],
      timeoutMs: 1_000,
    });
    expect(calls).toEqual([{ cmd: "sh", args: ["-c", 'exec bun test "$@" 2>&1', "sh", SLICE_FILE], cwd: "/wt" }]);
    expect(result).toEqual({ exitCode: 1, output: "1 fail\n" });
  });
});

describe("implement prompt: integration-slice test command", () => {
  async function renderImplementPrompt(criteria: string): Promise<string> {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    seedSubspec(worktreeFor(jarvisRoot, "prompt-run"), criteria);
    let captured = "";
    await executeWrite({
      worktree: { projectRoot: "/fake", projectName: "demo", branchName: "prompt-run", baseRef: "HEAD", jarvisRoot },
      specPath: "spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: SUBSPEC,
      promptId: "implement.prompt.body",
      bindings: [
        {
          id: "agent",
          invoke: async ({ prompt }) => {
            captured = prompt;
            return { kind: "ok", stdout: "progress", stderr: "" };
          },
        },
      ],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });
    return captured;
  }

  test("names the command when the active subspec references a sandbox-unrunnable test file", async () => {
    const prompt = await renderImplementPrompt(`- [ ] \`${SLICE_FILE}\` runs faster than the merge base\n`);
    expect(prompt).toContain("## Integration-slice test runs");
    expect(prompt).toContain(HARNESS_TEST_SLICE_REQUEST_FILE);
  });

  test("omits the command otherwise", async () => {
    const prompt = await renderImplementPrompt("- [ ] `v2/src/demo.test.ts` passes\n");
    expect(prompt).not.toContain("## Integration-slice test runs");
    expect(prompt).not.toContain(HARNESS_TEST_SLICE_REQUEST_FILE);
  });
});

describe("completion boundary: measurement criteria need a recorded harness run", () => {
  async function completeWith(criteria: string, harnessTestSliceRunFiles?: readonly string[]) {
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    seedSubspec(worktreeFor(jarvisRoot, "boundary-run"), criteria);
    const result = await executeWrite({
      worktree: { projectRoot: "/fake", projectName: "demo", branchName: "boundary-run", baseRef: "HEAD", jarvisRoot },
      specPath: "spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: SUBSPEC,
      promptId: "implement.prompt.body",
      ...(harnessTestSliceRunFiles !== undefined ? { harnessTestSliceRunFiles } : {}),
      bindings: [{ id: "agent", invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }) }],
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    });
    return result.result;
  }

  const MEASURED = "- [x] `demo.sandbox-unrunnable.test.ts` runs faster than the merge base\n";

  test("refuses a ticked measurement criterion naming a sandbox-unrunnable file with no recorded harness run as unverified", async () => {
    const result = await completeWith(MEASURED);
    expect(result.kind).toBe("contract_miss");
    if (result.kind !== "contract_miss") return;
    expect(result.failedContractId).toBe("spec.measurement-criteria-harness-run");
    expect(result.failureReason).toContain("Unverified measurement criteria");
    expect(result.failureReason).toContain("demo.sandbox-unrunnable.test.ts");
  });

  test("accepts the tick once a harness run of that file is recorded", async () => {
    expect((await completeWith(MEASURED, [SLICE_FILE])).kind).toBe("complete");
  });

  test("leaves pass/fail criteria naming such a file to the harness ready gate", async () => {
    expect((await completeWith(`- [x] \`${SLICE_FILE}\` passes\n`)).kind).toBe("complete");
  });

  test("unverifiedMeasurementCriteria ignores unticked criteria and matches recorded runs by path suffix", () => {
    const spec = `## Acceptance criteria\n\n- [ ] \`${SLICE_FILE}\` is 20% faster\n- [x] \`a.sandbox-unrunnable.test.ts\` wall time drops\n`;
    expect(unverifiedMeasurementCriteria(spec, [])).toEqual(["`a.sandbox-unrunnable.test.ts` wall time drops"]);
    expect(unverifiedMeasurementCriteria(spec, ["v2/a.sandbox-unrunnable.test.ts"])).toEqual([]);
    expect(unverifiedMeasurementCriteria(spec, ["v2/xa.sandbox-unrunnable.test.ts"])).toHaveLength(1);
  });

  test("findHarnessTestSliceRunFilesFromLog counts only runs that recorded an exit code", () => {
    const rec = (seq: number, event: Record<string, unknown>) => ({ runId: "r", seq, ts: "t", event }) as never;
    const run = { kind: "harness_test_slice_run", attemptId: "a", rejected: [], durationMs: 1, output: "" };
    expect(
      findHarnessTestSliceRunFilesFromLog([
        rec(1, { ...run, files: ["a.sandbox-unrunnable.test.ts"], exitCode: 1 }),
        rec(2, { ...run, files: ["b.sandbox-unrunnable.test.ts"], exitCode: null }),
        rec(3, { kind: "iteration_started", attemptId: "b" }),
      ]),
    ).toEqual(["a.sandbox-unrunnable.test.ts"]);
  });
});
