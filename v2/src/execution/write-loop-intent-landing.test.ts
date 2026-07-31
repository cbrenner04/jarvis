import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import type { LogEvent, LogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

const { roots } = trackedTempRoots();

function seedGitBaseline(worktreePath: string): void {
  if (existsSync(join(worktreePath, ".git"))) return;
  execFileSync("git", ["init", "-q"], { cwd: worktreePath });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: worktreePath });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: worktreePath });
  execFileSync("git", ["add", "-A"], { cwd: worktreePath });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: worktreePath });
}

function createGitAwareFakeWithExternalWorktree(jarvisRoot: string) {
  const base = createFakeWithExternalWorktree(jarvisRoot);
  return async <T>(
    args: Parameters<typeof base>[0],
    run: Parameters<typeof base>[1],
    signal?: Parameters<typeof base>[2],
  ) => {
    const wrappedRun = async (worktree: { path: string; reused: boolean }) => {
      seedGitBaseline(worktree.path);
      return run(worktree);
    };
    return base(args, wrappedRun, signal);
  };
}

class TestLogSink implements LogSink {
  events: Array<{ runId: string; event: LogEvent }> = [];

  append(runId: string, event: LogEvent): void {
    this.events.push({ runId, event });
  }

  close(): void {}

  getEventsForRun(runId: string): LogEvent[] {
    return this.events.filter((entry) => entry.runId === runId).map((entry) => entry.event);
  }
}

async function runIntentSplitLoop(args: {
  jarvisRoot: string;
  stateDbPath: string;
  branchName: string;
  bindings: readonly InvocationBinding[];
  maxIterations?: number;
  logSink?: LogSink;
}) {
  roots.push(join(args.jarvisRoot, ".."));
  const store = openStateStore(args.stateDbPath);
  const loopInput: WriteLoopInput = {
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: args.branchName,
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: "ready-intents",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: ".jarvis-intent-stage",
    promptId: "intent.prompt.split",
    promptPlaceholders: {
      SEED_LABEL: "inline",
      SEED_CONTENT: "Split the seed into ready intents",
    },
    publishCompletion: false,
    freshDispatch: true,
    bindings: args.bindings,
    stateStore: store,
    withExternalWorktree: createGitAwareFakeWithExternalWorktree(args.jarvisRoot),
    sessionsDir: join(args.jarvisRoot, "sessions"),
    ...(args.maxIterations !== undefined ? { maxIterations: args.maxIterations } : {}),
    ...(args.logSink !== undefined ? { logSink: args.logSink } : {}),
  };
  try {
    return await executeWriteLoop(loopInput);
  } finally {
    store.close();
  }
}

function prerequisitesProseIntent(path: string): void {
  writeFileSync(
    path,
    `---
name: bad-intent
---

# Bad Intent

## Prerequisites

This is prose, not a bullet list.
`,
    "utf8",
  );
}

describe("intent split landing-contract pre-completion gate", () => {
  test("intent split landing-contract violation reprompts before settle", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let invocations = 0;
    let repromptPrompt = "";
    const branchName = `intent-landing-reprompt-${Date.now()}`;

    const result = await runIntentSplitLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      maxIterations: 3,
      logSink: sink,
      bindings: [
        {
          id: "split",
          metadata: { agent: "test-agent", model: "test" },
          invoke: async ({ cwd, prompt }) => {
            invocations += 1;
            const stage = join(cwd, ".jarvis-intent-stage");
            mkdirSync(stage, { recursive: true });
            if (invocations === 1) {
              prerequisitesProseIntent(join(stage, "bad-intent.md"));
              return { kind: "ok", stdout: "done", stderr: "" };
            }
            repromptPrompt = prompt;
            writeFileSync(
              join(stage, "bad-intent.md"),
              "---\nname: bad-intent\n---\n\n# Bad Intent\n\n## Prerequisites\n\n- prior behavior exists\n",
              "utf8",
            );
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("complete");
    expect(repromptPrompt).toContain("must list prerequisites as one bullet per line");
    expect(repromptPrompt).toContain("bad-intent.md");
    expect(result.iterationsConsumed).toBe(2);
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(events).toContain("landing_contract_reprompt");
    expect(events).not.toContain("contract_miss_detail");
    const reprompt = sink.getEventsForRun(result.runId).find((event) => event.kind === "landing_contract_reprompt");
    expect(reprompt).toMatchObject({
      kind: "landing_contract_reprompt",
      offendingFile: "bad-intent.md",
    });
    expect(reprompt && "violation" in reprompt ? reprompt.violation : "").toContain(
      "must list prerequisites as one bullet per line",
    );
    // Mutation checkpoint: skipping the pre-completion landing-validation guard must turn this test RED.
  });

  test("intent split landing-contract budget exhaustion settles landing_failed", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const branchName = `intent-landing-exhausted-${Date.now()}`;
    const violationBytes = `---
name: bad-intent
---

# Bad Intent

## Prerequisites

Still prose after every attempt.
`;

    const result = await runIntentSplitLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      maxIterations: 2,
      bindings: [
        {
          id: "split",
          metadata: { agent: "test-agent", model: "test" },
          invoke: async ({ cwd }) => {
            const stage = join(cwd, ".jarvis-intent-stage");
            mkdirSync(stage, { recursive: true });
            writeFileSync(join(stage, "bad-intent.md"), violationBytes, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    const stageFile = join(jarvisRoot, "worktrees", "demo", branchName, ".jarvis-intent-stage", "bad-intent.md");
    expect(result.kind).toBe("landing_failed");
    expect(result.resumable).toBe(true);
    expect(result.iterationsConsumed).toBe(2);
    expect(readFileSync(stageFile, "utf8")).toBe(violationBytes);
    // Mutation checkpoint: inverting the budget-exhaustion landing_failed branch to contract_miss or blocked must turn this test RED.
  });

  test("rogue path outside stage settles landing_failed without reprompt", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const branchName = `intent-landing-rogue-${Date.now()}`;

    const result = await runIntentSplitLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      maxIterations: 3,
      logSink: sink,
      bindings: [
        {
          id: "split",
          metadata: { agent: "test-agent", model: "test" },
          invoke: async ({ cwd }) => {
            const stage = join(cwd, ".jarvis-intent-stage");
            mkdirSync(stage, { recursive: true });
            prerequisitesProseIntent(join(stage, "bad-intent.md"));
            writeFileSync(join(cwd, "rogue.txt"), "outside stage\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    expect(result.kind).toBe("landing_failed");
    expect(result.resumable).toBe(true);
    expect(result.iterationsConsumed).toBe(1);
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(events).not.toContain("landing_contract_reprompt");
  });

  test("landing-contract reprompt preserves valid sibling staged intents", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    let invocations = 0;
    const branchName = `intent-landing-siblings-${Date.now()}`;

    const goodIntent = `---
name: good-intent
---

# Good Intent

## Prerequisites

- prior behavior exists
`;

    const result = await runIntentSplitLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      maxIterations: 3,
      bindings: [
        {
          id: "split",
          metadata: { agent: "test-agent", model: "test" },
          invoke: async ({ cwd }) => {
            invocations += 1;
            const stage = join(cwd, ".jarvis-intent-stage");
            mkdirSync(stage, { recursive: true });
            writeFileSync(join(stage, "good-intent.md"), goodIntent, "utf8");
            if (invocations === 1) {
              prerequisitesProseIntent(join(stage, "bad-intent.md"));
            } else {
              writeFileSync(
                join(stage, "bad-intent.md"),
                "---\nname: bad-intent\n---\n\n# Bad Intent\n\n## Prerequisites\n\n- prior behavior exists\n",
                "utf8",
              );
            }
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("complete");
    const stageDir = join(jarvisRoot, "worktrees", "demo", branchName, ".jarvis-intent-stage");
    expect(readFileSync(join(stageDir, "good-intent.md"), "utf8")).toBe(goodIntent);
  });

  test("resumed write loop preserves hand-edited stage across iteration", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const branchName = `intent-landing-resume-stage-${Date.now()}`;
    const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
    const stageFile = join(worktreePath, ".jarvis-intent-stage", "bad-intent.md");
    const handEdited = `---
name: bad-intent
---

# Bad Intent

## Prerequisites

- operator fixed this by hand
`;
    let sawHandEdit = false;
    const store = openStateStore(stateDbPath);
    const sharedLoop = {
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName,
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath: "ready-intents",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: ".jarvis-intent-stage",
      promptId: "intent.prompt.split",
      promptPlaceholders: {
        SEED_LABEL: "inline",
        SEED_CONTENT: "Resume after landing_failed",
      },
      publishCompletion: false,
      stateStore: store,
      withExternalWorktree: createGitAwareFakeWithExternalWorktree(jarvisRoot),
      sessionsDir: join(jarvisRoot, "sessions"),
    } satisfies Omit<WriteLoopInput, "bindings">;

    try {
      const exhausted = await executeWriteLoop({
        ...sharedLoop,
        freshDispatch: true,
        maxIterations: 1,
        bindings: [
          {
            id: "split",
            metadata: { agent: "test-agent", model: "test" },
            invoke: async ({ cwd }) => {
              const stage = join(cwd, ".jarvis-intent-stage");
              mkdirSync(stage, { recursive: true });
              prerequisitesProseIntent(join(stage, "bad-intent.md"));
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
      });
      expect(exhausted.kind).toBe("landing_failed");

      writeFileSync(stageFile, handEdited, "utf8");

      const resumed = await executeWriteLoop({
        ...sharedLoop,
        bindings: [
          {
            id: "split",
            metadata: { agent: "test-agent", model: "test" },
            invoke: async ({ cwd }) => {
              sawHandEdit = readFileSync(join(cwd, ".jarvis-intent-stage", "bad-intent.md"), "utf8") === handEdited;
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
      });
      expect(sawHandEdit).toBe(true);
      expect(resumed.kind).toBe("complete");
    } finally {
      store.close();
    }
  });
});
