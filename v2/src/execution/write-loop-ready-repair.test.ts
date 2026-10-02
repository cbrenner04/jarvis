import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import { gateOutput, lintMdOnlyGateFailureOutput } from "./ready-finalize.test-support.ts";
import { ReadyGateError, resolveAttributableRepairAllowset } from "./ready-finalize.ts";
import {
  deriveAllowedOrUndefined,
  initRepairFenceWorktree,
  registerWriteLoopExecuteWriteMockHooks,
  roots,
  runLoop,
} from "./write-loop.test-support.ts";

const ALLOWED_HEADING = "## Allowed paths";

function allowedPathLinesFromRepairPrompt(prompt: string): string[] {
  const start = prompt.indexOf(ALLOWED_HEADING);
  expect(start).toBeGreaterThanOrEqual(0);
  const afterHeading = prompt.slice(start + ALLOWED_HEADING.length).trimStart();
  const revertAt = afterHeading.indexOf("Edits outside these paths are reverted and end the run.");
  expect(revertAt).toBeGreaterThanOrEqual(0);
  const block = afterHeading.slice(0, revertAt).trim();
  expect(block.length).toBeGreaterThan(0);
  return block.split("\n");
}

async function captureReadyRepairPrompt(args: {
  branchName: string;
  initWorktree: (jarvisRoot: string, branchName: string) => { worktreePath: string; baseRef: string };
  gateOutput: string;
}): Promise<{ repairPrompt: string; frozen: Set<string> }> {
  const { jarvisRoot, stateDbPath } = createJarvisHome();
  roots.push(join(jarvisRoot, ".."));
  const { baseRef, worktreePath } = args.initWorktree(jarvisRoot, args.branchName);
  const frozen = await deriveAllowedOrUndefined(
    { worktreePath, baseRef, specPath: "spec.md" },
    { gitUntracked: async () => "\0" },
  );
  expect(frozen).toBeDefined();
  const prompts: string[] = [];
  let invocations = 0;

  await runLoop({
    jarvisRoot,
    stateDbPath,
    branchName: args.branchName,
    baseRef,
    bindings: [
      {
        id: "sim.1",
        metadata: { agent: "sim-agent-1", model: "sim-model-1" },
        invoke: async ({ prompt, cwd }) => {
          invocations += 1;
          prompts.push(prompt);
          if (invocations === 1) {
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          } else {
            writeFileSync(join(cwd, "proof.txt"), "fixed\n", "utf8");
          }
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        },
      },
    ],
    completionCommitter: createCompletionCommitter(),
    completionPublisher: async () => ({}),
    runFixCommand: async () => {},
    readyFinalizer: async () => {
      if (invocations === 1) {
        throw new ReadyGateError("bun run ready", 1, args.gateOutput);
      }
    },
  });

  const repairPrompt = prompts.find((prompt) => prompt.includes(ALLOWED_HEADING));
  expect(repairPrompt).toBeDefined();
  return { repairPrompt: repairPrompt as string, frozen: frozen as Set<string> };
}

describe("write loop ready repair prompt", () => {
  registerWriteLoopExecuteWriteMockHooks();

  test("marker-attributed lint failure lists attributable paths only", async () => {
    const gateOutputText = lintMdOnlyGateFailureOutput("spec.md");
    const { repairPrompt, frozen } = await captureReadyRepairPrompt({
      branchName: "ready-repair-prompt-lint-attributed",
      initWorktree: (jarvisRoot, branchName) =>
        initRepairFenceWorktree(jarvisRoot, branchName, { touchUntouchedInIteration: true }),
      gateOutput: gateOutputText,
    });
    const error = new ReadyGateError("bun run ready", 1, gateOutputText);
    const expected = [...resolveAttributableRepairAllowset(frozen, error)].sort();
    expect(allowedPathLinesFromRepairPrompt(repairPrompt)).toEqual(expected);
    expect(repairPrompt).toContain("Edits outside these paths are reverted and end the run.");
    expect(frozen.has("v2/src/untouched.test.ts")).toBe(true);
    expect(expected).not.toContain("v2/src/untouched.test.ts");
  });

  test("gate failure without lint attribution lists the frozen run-diff allowset", async () => {
    const gateOutputText = gateOutput({
      completions: [{ stepId: "2", attemptId: "2.1", command: "bun run check", status: 1 }],
    });
    const { repairPrompt, frozen } = await captureReadyRepairPrompt({
      branchName: "ready-repair-prompt-frozen-fallback",
      initWorktree: (jarvisRoot, branchName) => initRepairFenceWorktree(jarvisRoot, branchName),
      gateOutput: gateOutputText,
    });
    const error = new ReadyGateError("bun run ready", 1, gateOutputText);
    const expected = [...resolveAttributableRepairAllowset(frozen, error)].sort();
    expect(allowedPathLinesFromRepairPrompt(repairPrompt)).toEqual(expected);
  });
});
