import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { resolveHarnessRoot } from "../../../shared/markdownlint-repair.ts";
import type { LogEvent, LogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import type { ExternalWorktree, withExternalWorktree } from "./external-worktree.ts";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

const { roots } = trackedTempRoots();
const FIXTURES_DIR = join(import.meta.dir, "fixtures", "write-loop-staged-markdown-lint");
const HARNESS_ROOT = resolveHarnessRoot(join(import.meta.dir, "..", "..", ".."));
const PLAN_DRAFT_INTENT_SEED = "---\nname: test\n---\n\n## Prerequisites\n\nnone\n";
const PLAN_DRAFT_SPEC_PATH = "v2/spec/2099-01-01T00-00-00Z-plan-draft";

function hasHarnessMarkdownlint(): boolean {
  if (HARNESS_ROOT === null) return false;
  return existsSync(join(HARNESS_ROOT, "node_modules", "markdownlint-cli2", "markdownlint-cli2.js"));
}

function skipWithoutHarnessMarkdownlint(reason: string): boolean {
  if (hasHarnessMarkdownlint()) return false;
  process.stderr.write(`skip: ${reason}; pinned markdownlint binary not installed in this worktree\n`);
  return true;
}

function seedGitBaseline(worktreePath: string): void {
  if (existsSync(join(worktreePath, ".git"))) return;
  execFileSync("git", ["init", "-q"], { cwd: worktreePath });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: worktreePath });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: worktreePath });
  execFileSync("git", ["add", "-A"], { cwd: worktreePath });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: worktreePath });
}

function createGitAwareFakeWithExternalWorktree(jarvisRoot: string): typeof withExternalWorktree {
  const base = createFakeWithExternalWorktree(jarvisRoot);
  const gitAware: typeof withExternalWorktree = async (args, run, _runner?, _signal?) => {
    const wrappedRun = async (worktree: ExternalWorktree) => {
      seedGitBaseline(worktree.path);
      return run(worktree);
    };
    return base(args, wrappedRun);
  };
  return gitAware;
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

function writeValidPlanDraftStage(stagePath: string, subspecFile: string, subspecBody: string): void {
  mkdirSync(stagePath, { recursive: true });
  writeFileSync(join(stagePath, "intent.md"), "---\nname: test\n---\n", "utf8");
  writeFileSync(join(stagePath, "index.md"), `# Index\n\n- [ ] [00 - One](./${subspecFile})\n`, "utf8");
  writeFileSync(join(stagePath, subspecFile), subspecBody, "utf8");
}

function stageFromFixture(stagePath: string, subspecFixtureName: string, subspecFile = "00-one.md"): void {
  writeValidPlanDraftStage(stagePath, subspecFile, readFileSync(join(FIXTURES_DIR, subspecFixtureName), "utf8"));
}

async function runPlanDraftLoop(args: {
  jarvisRoot: string;
  stateDbPath: string;
  branchName: string;
  bindings: readonly InvocationBinding[];
  maxIterations?: number;
  logSink?: LogSink;
  publishCompletion?: boolean;
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
    specPath: PLAN_DRAFT_SPEC_PATH,
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: ".jarvis-plan-stage",
    promptId: "plan.prompt.draft",
    intentSeed: PLAN_DRAFT_INTENT_SEED,
    publishCompletion: args.publishCompletion ?? false,
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

describe("plan write step staged Markdown lint", () => {
  test("plan write step staged Markdown lint violation reprompts before finalize", async () => {
    if (skipWithoutHarnessMarkdownlint("plan write step staged Markdown lint violation reprompts before finalize")) {
      return;
    }

    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let invocations = 0;
    let repromptPrompt = "";
    const branchName = `plan-md-lint-reprompt-${Date.now()}`;
    const cleanSubspec = readFileSync(join(FIXTURES_DIR, "plan-md012-clean-subspec.md"), "utf8");

    const result = await runPlanDraftLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      maxIterations: 3,
      logSink: sink,
      bindings: [
        {
          id: "draft",
          metadata: { agent: "test-agent", model: "test" },
          invoke: async ({ cwd, prompt }) => {
            invocations += 1;
            const stage = join(cwd, ".jarvis-plan-stage");
            if (invocations === 1) {
              stageFromFixture(stage, "plan-md012-violation-subspec.md");
              return { kind: "ok", stdout: "done", stderr: "" };
            }
            repromptPrompt = prompt;
            writeValidPlanDraftStage(stage, "00-one.md", cleanSubspec);
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("complete");
    expect(repromptPrompt).toContain("MD012");
    expect(repromptPrompt).toContain(".jarvis-plan-stage/00-one.md");
    expect(result.iterationsConsumed).toBe(2);
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(events).toContain("staged_markdown_lint_reprompt");
    expect(events).not.toContain("contract_miss_detail");
    const reprompt = sink.getEventsForRun(result.runId).find((event) => event.kind === "staged_markdown_lint_reprompt");
    expect(reprompt).toMatchObject({
      kind: "staged_markdown_lint_reprompt",
      ruleId: "MD012",
      offendingFile: ".jarvis-plan-stage/00-one.md",
    });
    // Mutation checkpoint: skipping the pre-finalization plan-draft staged-Markdown lint guard must turn this test RED.
    // @mutate v2/src/execution/write-loop.ts "        if (lintResult.kind === \"violation\") {" -> "        if (false) {"
  });

  test("plan write step clean staged Markdown finalizes without extra invocation", async () => {
    if (skipWithoutHarnessMarkdownlint("plan write step clean staged Markdown finalizes without extra invocation")) {
      return;
    }

    const { jarvisRoot, stateDbPath } = createJarvisHome();
    let invocations = 0;
    const branchName = `plan-md-lint-clean-${Date.now()}`;

    const result = await runPlanDraftLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      bindings: [
        {
          id: "draft",
          metadata: { agent: "test-agent", model: "test" },
          invoke: async ({ cwd }) => {
            invocations += 1;
            stageFromFixture(join(cwd, ".jarvis-plan-stage"), "plan-md012-clean-subspec.md");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    expect(invocations).toBe(1);
    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);
  });

  test("plan write step lint-clean MD012 and MD038 golden fixtures finalize without reprompt", async () => {
    if (
      skipWithoutHarnessMarkdownlint(
        "plan write step lint-clean MD012 and MD038 golden fixtures finalize without reprompt",
      )
    ) {
      return;
    }

    for (const fixtureName of ["plan-md012-clean-subspec.md", "plan-md038-clean-subspec.md"] as const) {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      let invocations = 0;
      const branchName = `plan-md-lint-golden-${fixtureName}-${Date.now()}`;

      const result = await runPlanDraftLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: [
          {
            id: "draft",
            metadata: { agent: "test-agent", model: "test" },
            invoke: async ({ cwd }) => {
              invocations += 1;
              stageFromFixture(join(cwd, ".jarvis-plan-stage"), fixtureName);
              return { kind: "ok", stdout: "done", stderr: "" };
            },
          },
        ],
      });

      expect(invocations).toBe(1);
      expect(result.kind).toBe("complete");
      expect(result.iterationsConsumed).toBe(1);
    }
  });

  test("plan write step staged Markdown lint budget exhaustion settles landing_failed", async () => {
    if (
      skipWithoutHarnessMarkdownlint("plan write step staged Markdown lint budget exhaustion settles landing_failed")
    ) {
      return;
    }

    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const branchName = `plan-md-lint-exhausted-${Date.now()}`;
    const violationBytes = readFileSync(join(FIXTURES_DIR, "plan-md038-violation-subspec.md"), "utf8");

    const result = await runPlanDraftLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      maxIterations: 2,
      bindings: [
        {
          id: "draft",
          metadata: { agent: "test-agent", model: "test" },
          invoke: async ({ cwd }) => {
            writeValidPlanDraftStage(join(cwd, ".jarvis-plan-stage"), "00-one.md", violationBytes);
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    const stageFile = join(jarvisRoot, "worktrees", "demo", branchName, ".jarvis-plan-stage", "00-one.md");
    expect(result.kind).toBe("landing_failed");
    expect(result.resumable).toBe(true);
    expect(result.iterationsConsumed).toBe(2);
    expect(readFileSync(stageFile, "utf8")).toBe(violationBytes);
  });

  test("plan write step staged Markdown lint reprompt preserves sibling stage files", async () => {
    if (skipWithoutHarnessMarkdownlint("plan write step staged Markdown lint reprompt preserves sibling stage files")) {
      return;
    }

    const { jarvisRoot, stateDbPath } = createJarvisHome();
    let invocations = 0;
    const branchName = `plan-md-lint-siblings-${Date.now()}`;
    const goodSubspec = readFileSync(join(FIXTURES_DIR, "plan-md012-clean-subspec.md"), "utf8");
    const goodSubspecFile = "01-good.md";

    const result = await runPlanDraftLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      maxIterations: 3,
      bindings: [
        {
          id: "draft",
          metadata: { agent: "test-agent", model: "test" },
          invoke: async ({ cwd }) => {
            invocations += 1;
            const stage = join(cwd, ".jarvis-plan-stage");
            mkdirSync(stage, { recursive: true });
            writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n", "utf8");
            writeFileSync(
              join(stage, "index.md"),
              "# Index\n\n- [ ] [00 - Bad](./00-one.md)\n- [ ] [01 - Good](./01-good.md)\n",
              "utf8",
            );
            writeFileSync(join(stage, goodSubspecFile), goodSubspec, "utf8");
            if (invocations === 1) {
              copyFileSync(join(FIXTURES_DIR, "plan-md038-violation-subspec.md"), join(stage, "00-one.md"));
            } else {
              writeFileSync(join(stage, "00-one.md"), goodSubspec, "utf8");
            }
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("complete");
    const stageDir = join(jarvisRoot, "worktrees", "demo", branchName, ".jarvis-plan-stage");
    expect(readFileSync(join(stageDir, goodSubspecFile), "utf8")).toBe(goodSubspec);
  });
});
