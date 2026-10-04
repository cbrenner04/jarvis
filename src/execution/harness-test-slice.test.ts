import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LogEvent, LogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import type { InvocationBinding } from "../shared/invocation/execute.ts";
import { AsyncSubprocessError, type AsyncSubprocessRunner } from "../shared/subprocess.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import type { ExternalWorktree, withExternalWorktree } from "./external-worktree.ts";
import { leasedHarnessFullSuiteGateSpawnCount, liveGateInvocationLeaseCount } from "./gate-invocation-lease.ts";
import {
  createDefaultHarnessTestSliceRunner,
  HARNESS_TEST_SLICE_REQUEST_FILE,
  type HarnessTestSliceRunner,
  MAX_HARNESS_TEST_SLICE_RUNS,
  takeHarnessTestSliceRequest,
  unverifiedMeasurementCriteria,
} from "./harness-test-slice.ts";
import { createStubMarkdownlintRunner } from "./workflow-runner.test-support.ts";
import { executeWrite } from "./write.ts";
import { executeWriteLoop, findHarnessTestSliceStateFromLog } from "./write-loop.ts";

const { roots } = trackedTempRoots();
const SLICE_FILE = "src/demo.sandbox-unrunnable.test.ts";
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

async function runImplementLoop(args: {
  jarvisRoot: string;
  stateDbPath: string;
  branchName: string;
  binding: InvocationBinding;
  runner?: HarnessTestSliceRunner;
  sink: TestLogSink;
  maxIterations: number;
}) {
  const store = openStateStore(args.stateDbPath);
  try {
    return await executeWriteLoop({
      stagedMarkdownLintRunner: createStubMarkdownlintRunner(),
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: args.branchName,
        baseRef: "HEAD",
        jarvisRoot: args.jarvisRoot,
      },
      specPath: "spec.md",
      stepRules: "Return progress.",
      expectedArtifactPath: SUBSPEC,
      promptId: "implement.prompt.body",
      bindings: [args.binding],
      stateStore: store,
      logSink: args.sink,
      withExternalWorktree: gitAwareWorktree(args.jarvisRoot),
      sessionsDir: join(args.jarvisRoot, "sessions"),
      completionCommitter: createCompletionCommitter(),
      ...(args.runner !== undefined ? { runHarnessTestSlice: args.runner } : {}),
      maxIterations: args.maxIterations,
      clock: () => new Date("2026-10-02T06:00:00.000Z"),
    });
  } finally {
    store.close();
  }
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
    mkdirSync(join(worktreePath, "src"), { recursive: true });
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
            `${SLICE_FILE}\nsrc/other.sandbox-unrunnable.test.ts\n`,
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
    const result = await runImplementLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      binding,
      runner,
      sink,
      maxIterations: 2,
    });

    expect(order).toEqual(["agent-1-start", "agent-1-end", "harness-run", "agent-2-start", "agent-2-end"]);
    expect(runnerCalls).toEqual([{ files: [SLICE_FILE], leased: 1 }]);
    expect(prompts[0]).not.toContain("Integration-slice test result");
    expect(prompts[1]).toContain("Integration-slice test result");
    expect(prompts[1]).toContain(`bun test ${SLICE_FILE}`);
    expect(prompts[1]).toContain("exit code 0");
    expect(prompts[1]).toContain("Ran 3 tests across 1 file. [19.57s]");
    expect(prompts[1]).toContain("src/other.sandbox-unrunnable.test.ts (not named by the active subspec)");
    const runEvent = sink.events.find(
      (entry) => entry.runId === result.runId && entry.event.kind === "harness_test_slice_run",
    );
    expect(runEvent?.event).toMatchObject({
      files: [SLICE_FILE],
      rejected: ["src/other.sandbox-unrunnable.test.ts (not named by the active subspec)"],
      exitCode: 0,
    });
    expect(existsSync(join(worktreePath, HARNESS_TEST_SLICE_REQUEST_FILE))).toBe(false);
    const committed = execFileSync("git", ["-C", worktreePath, "log", "--all", "--name-only", "--format="], {
      encoding: "utf8",
    });
    expect(committed).not.toContain(HARNESS_TEST_SLICE_REQUEST_FILE);
  });

  describe("takeHarnessTestSliceRequest", () => {
    const FLAG_FILE = "src/-x.sandbox-unrunnable.test.ts";
    const LINK_FILE = "src/link.sandbox-unrunnable.test.ts";

    function setup(request: string) {
      const { jarvisRoot } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const worktreePath = worktreeFor(jarvisRoot, "take");
      const outside = join(jarvisRoot, "worktrees", "demo", "other");
      mkdirSync(join(worktreePath, "src"), { recursive: true });
      mkdirSync(join(outside, "src"), { recursive: true });
      writeFileSync(join(worktreePath, SLICE_FILE), "", "utf8");
      writeFileSync(join(worktreePath, FLAG_FILE), "", "utf8");
      writeFileSync(join(worktreePath, "src/unnamed.sandbox-unrunnable.test.ts"), "", "utf8");
      writeFileSync(join(outside, SLICE_FILE), "", "utf8");
      symlinkSync(join(outside, SLICE_FILE), join(worktreePath, LINK_FILE));
      writeFileSync(join(worktreePath, HARNESS_TEST_SLICE_REQUEST_FILE), request);
      const subspec = [SLICE_FILE, FLAG_FILE, LINK_FILE, "src/missing.sandbox-unrunnable.test.ts"]
        .map((file) => `- [ ] \`${file}\` is faster`)
        .join("\n");
      return { worktreePath, subspec };
    }

    test("admits named in-worktree files and rejects .., absolute, symlink escapes, unnamed, and missing paths", () => {
      const { worktreePath, subspec } = setup(
        [
          SLICE_FILE,
          SLICE_FILE,
          FLAG_FILE,
          `../other/${SLICE_FILE}`,
          `/abs/${SLICE_FILE}`,
          LINK_FILE,
          "src/unnamed.sandbox-unrunnable.test.ts",
          "src/missing.sandbox-unrunnable.test.ts",
        ].join("\n"),
      );
      expect(takeHarnessTestSliceRequest(worktreePath, subspec, 0)).toEqual({
        files: [SLICE_FILE, FLAG_FILE],
        rejected: [
          `../other/${SLICE_FILE} (outside the worktree)`,
          `/abs/${SLICE_FILE} (absolute path)`,
          `${LINK_FILE} (outside the worktree)`,
          "src/unnamed.sandbox-unrunnable.test.ts (not named by the active subspec)",
          "src/missing.sandbox-unrunnable.test.ts (missing)",
        ],
      });
      expect(takeHarnessTestSliceRequest(worktreePath, subspec, 0)).toBeUndefined();
    });

    test("rejects every path once the per-subspec run cap is reached", () => {
      const { worktreePath, subspec } = setup(`${SLICE_FILE}\n`);
      expect(takeHarnessTestSliceRequest(worktreePath, subspec, MAX_HARNESS_TEST_SLICE_RUNS)).toEqual({
        files: [],
        rejected: [`${SLICE_FILE} (run cap of ${MAX_HARNESS_TEST_SLICE_RUNS} reached)`],
      });
    });
  });

  test("default runner passes ./-prefixed paths after -- so names cannot become bun flags, and maps a red exit to a result", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        calls.push({ cmd, args, cwd });
        throw new AsyncSubprocessError("exit 1", 1, "1 fail\n", "", undefined);
      },
    };
    const result = await createDefaultHarnessTestSliceRunner(runner)({
      worktreePath: "/wt",
      files: ["-x.sandbox-unrunnable.test.ts"],
      timeoutMs: 1_000,
    });
    expect(calls).toEqual([
      {
        cmd: "sh",
        args: ["-c", 'exec bun test "$@" 2>&1', "sh", "--", "./-x.sandbox-unrunnable.test.ts"],
        cwd: "/wt",
      },
    ]);
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
    const prompt = await renderImplementPrompt("- [ ] `src/demo.test.ts` passes\n");
    expect(prompt).not.toContain("## Integration-slice test runs");
    expect(prompt).not.toContain(HARNESS_TEST_SLICE_REQUEST_FILE);
  });
});

describe("completion boundary: measurement criteria need a recorded harness run", () => {
  test("reprompts a ticked measurement criterion with no recorded harness run instead of completing or blocking", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const branchName = `measure-reprompt-${Date.now()}`;
    const worktreePath = worktreeFor(jarvisRoot, branchName);
    const subspecPath = seedSubspec(worktreePath, `- [ ] \`${SLICE_FILE}\` runs faster than the merge base\n`);
    const prompts: string[] = [];
    const binding: InvocationBinding = {
      id: "agent",
      metadata: { agent: "test-agent", model: "test" },
      invoke: async (input) => {
        prompts.push(input.prompt);
        if (prompts.length === 1) {
          writeFileSync(subspecPath, readFileSync(subspecPath, "utf8").replace("- [ ]", "- [x]"));
          return { kind: "ok", stdout: "done", stderr: "" };
        }
        return { kind: "ok", stdout: "progress", stderr: "" };
      },
    };
    const sink = new TestLogSink();
    const result = await runImplementLoop({ jarvisRoot, stateDbPath, branchName, binding, sink, maxIterations: 2 });

    expect(result.kind).toBe("budget-exhausted");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("## Unverified measurement criteria");
    expect(prompts[1]).toContain("## Unverified measurement criteria");
    expect(prompts[1]).toContain(`\`${SLICE_FILE}\` runs faster than the merge base`);
    expect(prompts[1]).toContain(HARNESS_TEST_SLICE_REQUEST_FILE);
    expect(sink.events.map((entry) => entry.event)).toContainEqual({
      kind: "measurement_criteria_reprompt",
      attemptId: expect.any(String),
      criteria: [`\`${SLICE_FILE}\` runs faster than the merge base`],
    });
    expect(readFileSync(subspecPath, "utf8")).not.toContain("## Blocker");
  });

  test("historical pass/fail phrasings naming such files do not trip", () => {
    const criteria = [
      "- [x] `v1/test/ready-script.sandbox-unrunnable.test.ts` test `later ready step arms full step budget` records the armed timeout ms (third argument) and asserts its armed ms equals that step's full step budget.",
      "- [x] `v1/test/modes/patch/review.sandbox-unrunnable.test.ts` stays green for review-actuator coverage, including idle escalation and iteration-wall terminality.",
      "- [x] `src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts` — dispatch-count assertions make the named case fail when `intent` is not dispatched.",
      "- [x] Every `*.sandbox-unrunnable.test.ts` file runs faster under the new fixture.",
    ];
    expect(unverifiedMeasurementCriteria(`## Acceptance criteria\n\n${criteria.join("\n")}\n`, [])).toEqual([]);
  });

  test("unverifiedMeasurementCriteria ignores unticked criteria and matches recorded runs by path suffix", () => {
    const spec = `## Acceptance criteria\n\n- [ ] \`${SLICE_FILE}\` is 20% faster\n- [x] \`a.sandbox-unrunnable.test.ts\` duration drops\n- [x] \`b.sandbox-unrunnable.test.ts\` passes\n`;
    expect(unverifiedMeasurementCriteria(spec, [])).toEqual(["`a.sandbox-unrunnable.test.ts` duration drops"]);
    expect(unverifiedMeasurementCriteria(spec, ["v2/a.sandbox-unrunnable.test.ts"])).toEqual([]);
    expect(unverifiedMeasurementCriteria(spec, ["v2/xa.sandbox-unrunnable.test.ts"])).toHaveLength(1);
  });

  test("findHarnessTestSliceStateFromLog counts runs, records only exited files, and restores an unconsumed result", () => {
    const rec = (seq: number, event: Record<string, unknown>) => ({ runId: "r", seq, ts: "t", event }) as never;
    const run = { kind: "harness_test_slice_run", rejected: [], durationMs: 1, output: "out" };
    const first = rec(1, { ...run, attemptId: "a", files: ["a.sandbox-unrunnable.test.ts"], exitCode: 1 });
    const second = rec(3, { ...run, attemptId: "b", files: ["b.sandbox-unrunnable.test.ts"], exitCode: null });
    const consumed = rec(4, {
      kind: "boundary_committed",
      attemptId: "c",
      outcomeKind: "progress",
      runStatus: "in-progress",
    });
    const restored = findHarnessTestSliceStateFromLog([
      first,
      rec(2, { kind: "boundary_committed", attemptId: "b", outcomeKind: "progress", runStatus: "in-progress" }),
      second,
    ]);
    expect(restored).toEqual({
      runFiles: ["a.sandbox-unrunnable.test.ts"],
      runCount: 2,
      pendingResult: {
        files: ["b.sandbox-unrunnable.test.ts"],
        rejected: [],
        exitCode: null,
        durationMs: 1,
        output: "out",
      },
    });
    expect(findHarnessTestSliceStateFromLog([first, second, consumed]).pendingResult).toBeUndefined();
  });
});
