import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readyStepCompletionRecord, readyStepStartRecord } from "../../../scripts/ready.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import { createCompletionPublisher } from "./completion-publisher.ts";
import { gateFailureOutput } from "./ready-finalize.test-support.ts";
import { ReadyGateError } from "./ready-finalize.ts";
import { runLoop, TestLogSink } from "./write-loop.test-support.ts";
import { readyGateRepairLogFields } from "./write-loop.ts";

const GATE_COMMAND = "bun run ready";
function readyGateRepairPin(gateOutput: string, attempt: number, gateExitCode: number) {
  return {
    kind: "ready_gate_repair" as const,
    attempt,
    gateExitCode,
    ...readyGateRepairLogFields(GATE_COMMAND, gateOutput),
  };
}

async function firstReadyGateRepairEvent(gateOutput: string) {
  const { jarvisRoot, stateDbPath } = createJarvisHome();
  const logSink = new TestLogSink();
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
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        },
      },
    ],
    logSink,
    completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
    completionPublisher: async () => ({}),
    runFixCommand: async () => {},
    readyFinalizer: async () => {
      if (invocations === 1) {
        throw new ReadyGateError(GATE_COMMAND, 1, gateOutput);
      }
    },
  });
  const events = logSink.getEventsForRun(result.runId).filter((event) => event.kind === "ready_gate_repair");
  return { result, first: events[0], repairCount: events.length };
}

describe("ready_gate_repair log event context", () => {
  test("first ready_gate_repair includes the terminal failed step and its output tail", async () => {
    const start = (stepId: string, attemptId: string, command: string) =>
      readyStepStartRecord({ stepId, attemptId, command });
    const done = (stepId: string, attemptId: string, command: string, status: number) =>
      readyStepCompletionRecord({ stepId, attemptId, command, status });
    const stdout = `${start("1", "1.1", "bun install")}${start("2", "2.1", "bun run check")}warning: unrelated\n${start("3", "3.1", "bun run typecheck")}error TS1: boom\nterminal step last line\n`;
    const stderr = `${start("1", "1.1", "bun install")}${done("1", "1.1", "bun install", 0)}${start("2", "2.1", "bun run check")}${done("2", "2.1", "bun run check", 0)}${start("3", "3.1", "bun run typecheck")}${done("3", "3.1", "bun run typecheck", 2)}`;
    const gateOutput = `${stdout}${stderr}`;

    const { result, first, repairCount } = await firstReadyGateRepairEvent(gateOutput);
    expect(result.kind).toBe("complete");
    expect(repairCount).toBe(1);
    expect(first).toEqual(readyGateRepairPin(gateOutput, 1, 1));
    expect(first?.gateOutputTail).toContain("error TS1: boom\nterminal step last line\n");
    expect(first?.gateOutputTail).not.toContain("warning: unrelated");
  });

  test("gateOutputTail is capped at 4096 bytes when step output exceeds the cap", async () => {
    const start = readyStepStartRecord({ stepId: "1", attemptId: "1.1", command: "bun run test:v2" });
    const done = readyStepCompletionRecord({
      stepId: "1",
      attemptId: "1.1",
      command: "bun run test:v2",
      status: 1,
    });
    const padding = "p".repeat(5000);
    const gateOutput = `${start}${padding}\ncap tail last line\n${start}${done}`;

    const { result, first } = await firstReadyGateRepairEvent(gateOutput);
    expect(result.kind).toBe("complete");
    expect(first).toEqual(readyGateRepairPin(gateOutput, 1, 1));
    expect(first?.failingStep).toBe("bun run test:v2");
    expect(first?.gateOutputTail.length).toBe(4096);
    expect(first?.gateOutputTail).toContain("cap tail last line");
  });
});

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
}

function configureIdentity(cwd: string): void {
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test User"]);
}

/** Bare remote with `main` seeded, the lane worktree on `branchName`, and a second clone that can move `main`. */
function initPublishedLaneFixture(jarvisRoot: string, branchName: string) {
  const root = join(jarvisRoot, "..", "remotes");
  mkdirSync(root, { recursive: true });
  const remote = join(root, "remote.git");
  execFileSync("git", ["init", "--bare", "-b", "main", remote], { stdio: "pipe" });
  const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
  mkdirSync(join(worktreePath, ".."), { recursive: true });
  execFileSync("git", ["clone", remote, worktreePath], { stdio: "pipe" });
  configureIdentity(worktreePath);
  writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n");
  writeFileSync(join(worktreePath, ".gitignore"), ".reused\n");
  git(worktreePath, ["add", "-A"]);
  git(worktreePath, ["commit", "-m", "seed"]);
  git(worktreePath, ["push", "origin", "HEAD:main"]);
  git(worktreePath, ["checkout", "-b", branchName]);
  const other = join(root, "other");
  execFileSync("git", ["clone", remote, other], { stdio: "pipe" });
  configureIdentity(other);
  return { remote, worktreePath, other };
}

const ghStub = async (_cwd: string, args: readonly string[]) => {
  if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
  if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ number: 1, url: "u", baseRefName: "main" });
  return "";
};

/** Runs a lane whose ready-repair agent rebases onto a moved base; `conflictingEdit` blocks `reset --keep`. */
async function runRebasingReadyRepair(branchName: string, conflictingEdit: boolean) {
  const { jarvisRoot, stateDbPath } = createJarvisHome();
  const { remote, worktreePath, other } = initPublishedLaneFixture(jarvisRoot, branchName);
  const logSink = new TestLogSink();
  const pushedTips: string[] = [];
  let invocations = 0;
  let preRepairSha = "";
  let rewrittenSha = "";
  const publisher = createCompletionPublisher({
    git: async (cwd, args) => git(cwd, args),
    gh: ghStub,
    delay: async () => {},
    retryNotice: () => {},
    fetchPrBody: async () => "",
    writePrBody: async () => {},
    fetchPrTitle: async () => "t",
    writePrTitle: async () => {},
    renderFooter: async () => "",
  });

  const result = await runLoop({
    jarvisRoot,
    stateDbPath,
    branchName,
    baseRef: "main",
    logSink,
    completionCommitter: createCompletionCommitter(),
    completionPublisher: async (input) => {
      const published = await publisher(input);
      pushedTips.push(git(remote, ["rev-parse", `refs/heads/${branchName}`]));
      return published;
    },
    runFixCommand: async () => {},
    readyFinalizer: async () => {
      if (invocations === 1) throw new ReadyGateError("bun run ready", 1, gateFailureOutput("proof.txt"));
    },
    bindings: [
      {
        id: "sim.1",
        metadata: { agent: "sim-agent-1", model: "sim-model-1" },
        invoke: async ({ cwd }) => {
          invocations += 1;
          if (invocations === 1) {
            writeFileSync(join(cwd, "proof.txt"), "ok\n");
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          }
          preRepairSha = git(cwd, ["rev-parse", "HEAD"]);
          writeFileSync(join(other, "main-2.txt"), "main-2\n");
          git(other, ["add", "main-2.txt"]);
          git(other, ["commit", "-m", "main-2"]);
          git(other, ["push", "origin", "HEAD:main"]);
          git(cwd, ["fetch", "origin"]);
          git(cwd, ["rebase", "origin/main"]);
          rewrittenSha = git(cwd, ["rev-parse", "HEAD"]);
          writeFileSync(join(cwd, "proof.txt"), "fixed\n");
          if (conflictingEdit) writeFileSync(join(cwd, "main-2.txt"), "conflicting\n");
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        },
      },
    ],
  });
  const reverts = logSink
    .getEventsForRun(result.runId)
    .filter((event) => event.kind === "agent_history_rewrite_reverted");
  return { result, remote, worktreePath, pushedTips, invocations, preRepairSha, rewrittenSha, reverts };
}

describe("ready-gate repair history rewrite", () => {
  test("a repair agent that rebases onto a moved base publishes from the pre-iteration lineage", async () => {
    const branchName = "repair-rebase-lane";
    const run = await runRebasingReadyRepair(branchName, false);
    const { result, remote, worktreePath, preRepairSha, rewrittenSha } = run;

    expect(run.invocations).toBe(2);
    expect(rewrittenSha).not.toBe(preRepairSha);
    expect(result.completionCommitError).toBeUndefined();
    expect(result.kind).toBe("complete");
    expect(run.reverts).toEqual([
      { kind: "agent_history_rewrite_reverted", fromSha: rewrittenSha, toSha: preRepairSha },
    ]);
    expect(run.pushedTips[0]).toBe(preRepairSha);
    const finalTip = git(remote, ["rev-parse", `refs/heads/${branchName}`]);
    expect(finalTip).toBe(git(worktreePath, ["rev-parse", "HEAD"]));
    expect(git(worktreePath, ["merge-base", preRepairSha, finalTip])).toBe(preRepairSha);
    expect(git(worktreePath, ["rev-list", finalTip]).split("\n")).not.toContain(rewrittenSha);
  });

  test("a refused revert settles resumable completion_commit_failed naming both SHAs and pushes nothing more", async () => {
    const branchName = "repair-rebase-conflict";
    const run = await runRebasingReadyRepair(branchName, true);
    const { result, remote, preRepairSha, rewrittenSha } = run;

    expect(result.kind).toBe("completion_commit_failed");
    expect(result.resumable).toBe(true);
    expect(result.completionCommitError).toContain(preRepairSha);
    expect(result.completionCommitError).toContain(rewrittenSha);
    expect(run.reverts).toEqual([]);
    expect([...new Set(run.pushedTips)]).toEqual([preRepairSha]);
    expect(git(remote, ["rev-parse", `refs/heads/${branchName}`])).toBe(preRepairSha);
  });
});
