import { describe, expect, test } from "bun:test";
import {
  ALLOW_MARKER,
  exitCodeForLintCallViolations,
  findRealLintCallViolations,
} from "./guard-real-lint-in-unit-tests.ts";

function violations(source: string, file = "v2/src/execution/example.test.ts") {
  return findRealLintCallViolations([{ file, source }]);
}

describe("real-lint-in-unit-tests guard", () => {
  test("rejects a fixture violation: staged lint called without an injected runner", () => {
    const source = [
      'import { lintStagedMarkdown } from "./staged-markdown-lint.ts";',
      "await lintStagedMarkdown(stagingRoot, { worktreePath });",
    ].join("\n");
    expect(violations(source)).toMatchObject([{ line: 2, functionName: "lintStagedMarkdown" }]);
  });

  test("accepts staged lint called with an injected runner", () => {
    const source = [
      'import { lintStagedMarkdown } from "./staged-markdown-lint.ts";',
      "await lintStagedMarkdown(stagingRoot, { worktreePath, runner });",
    ].join("\n");
    expect(violations(source)).toEqual([]);
  });

  test.each([
    ["runMarkdownlintAutofix", "../../../shared/markdownlint-repair.ts", "runMarkdownlintAutofix({ files, warn });"],
    ["validateIntentStage", "../../../shared/intent-stage.ts", "await validateIntentStage(dir, paths, warn);"],
    ["repairIntentStageContent", "../../../shared/intent-stage.ts", "await repairIntentStageContent(dir, warn, null);"],
    ["landIntentWorkflowOutput", "./intent-output.ts", "await landIntentWorkflowOutput({ worktreePath, baseRef });"],
    ["recoverPlanStage", "./workflow-runner-resume.ts", "await recoverPlanStage({ runId, worktreePath });"],
  ])("rejects %s called without an injected runner", (functionName, modulePath, callExpression) => {
    const source = [`import { ${functionName} } from "${modulePath}";`, callExpression].join("\n");
    expect(violations(source)).toMatchObject([{ functionName }]);
  });

  test("allows an aliased import when the call site carries a runner identifier", () => {
    const source = [
      'import { lintStagedMarkdown as lintStaged } from "./staged-markdown-lint.ts";',
      "await lintStaged(stagingRoot, { worktreePath, runner: stubRunner });",
    ].join("\n");
    expect(violations(source)).toEqual([]);
  });

  test("bounds argument scanning to the call's own parentheses, not the rest of the file", () => {
    const source = [
      'import { lintStagedMarkdown } from "./staged-markdown-lint.ts";',
      "await lintStagedMarkdown(stagingRoot, { worktreePath });",
      "const runner = null;",
    ].join("\n");
    expect(violations(source)).toMatchObject([{ line: 2, functionName: "lintStagedMarkdown" }]);
  });

  test("ignores non-test files and the integration slice", () => {
    const source = [
      'import { lintStagedMarkdown } from "./staged-markdown-lint.ts";',
      "await lintStagedMarkdown(stagingRoot, { worktreePath });",
    ].join("\n");
    expect(violations(source, "v2/src/execution/staged-markdown-lint.ts")).toEqual([]);
    expect(violations(source, "v2/src/execution/example.sandbox-unrunnable.test.ts")).toEqual([]);
  });

  test("ignores unrelated function calls sharing no import binding", () => {
    const source = ["function lintStagedMarkdown() {}", "lintStagedMarkdown();"].join("\n");
    expect(violations(source)).toEqual([]);
  });

  test("respects the per-call-site allow marker on the line above the call", () => {
    const source = [
      'import { landIntentWorkflowOutput } from "./intent-output.ts";',
      "await expect(",
      `  // ${ALLOW_MARKER} rejects before markdownlint runs`,
      "  landIntentWorkflowOutput({ worktreePath, baseRef }),",
      ').rejects.toThrow("rogue");',
    ].join("\n");
    expect(violations(source)).toEqual([]);
  });

  test("skips explicitly allowlisted pre-existing real-binary files", () => {
    const source = [
      'import { lintStagedMarkdown } from "./staged-markdown-lint.ts";',
      "await lintStagedMarkdown(stagingRoot, { worktreePath });",
    ].join("\n");
    expect(violations(source, "v2/src/execution/staged-markdown-lint.test.ts")).toEqual([]);
    expect(violations(source, "shared/intent-stage.test.ts")).toEqual([]);
    expect(violations(source, "v2/src/daemon/daemon-start-list.test.ts")).toEqual([]);
    expect(violations(source, "v2/src/execution/write-loop.test.ts")).toEqual([]);
    expect(violations(source, "v2/src/execution/write-loop-idle-watchdog.test.ts")).toEqual([]);
    expect(violations(source, "v2/src/execution/write-loop-session-log.test.ts")).toEqual([]);
  });

  test.each([
    "v2/src/execution/workflow-runner-resume.test.ts",
    "v2/src/daemon/daemon-resume.test.ts",
    "v2/src/daemon/daemon-pipeline-recover.test.ts",
    "v2/src/daemon/pipeline-stage-recovery.test.ts",
    "v2/src/execution/workflow-runner-review.test.ts",
    "v2/src/execution/write-loop-intent-landing.test.ts",
  ])("flags stubbed-seam file %s (no longer allowlisted)", (file) => {
    const source = [
      'import { lintStagedMarkdown } from "./staged-markdown-lint.ts";',
      "await lintStagedMarkdown(stagingRoot, { worktreePath });",
    ].join("\n");
    expect(violations(source, file)).toMatchObject([{ line: 2, functionName: "lintStagedMarkdown" }]);
  });

  test.each([
    ["executeWriteLoop", "./write-loop.ts", "await executeWriteLoop(input);"],
    ["resumePopulatedIntentPublication", "./workflow-runner-resume.ts", "await resumePopulatedIntentPublication(ctx);"],
  ])("rejects %s called without an injected runner", (functionName, modulePath, call) => {
    const source = [`import { ${functionName} } from "${modulePath}";`, call].join("\n");
    expect(violations(source)).toMatchObject([{ line: 2, functionName }]);
  });

  test.each([
    ["executeWriteLoop", "./write-loop.ts", "await executeWriteLoop({ ...input, runner });"],
    [
      "lintStagedMarkdown",
      "./staged-markdown-lint.ts",
      "await lintStagedMarkdown(root, { worktreePath, stubRunner });",
    ],
    ["lintStagedMarkdown", "./staged-markdown-lint.ts", "await lintStagedMarkdown(root, { runner: undefined });"],
    [
      "executeWriteLoop",
      "./write-loop.ts",
      "await executeWriteLoop({ ...input, stagedMarkdownLintRunner: undefined });",
    ],
    ["recoverPlanStage", "./workflow-runner-resume.ts", "await recoverPlanStage({ ...request, runnerLike: runner });"],
    [
      "validateIntentStage",
      "../../../shared/intent-stage.ts",
      "await validateIntentStage(dir, paths, warn, null, undefined);",
    ],
    [
      "repairIntentStageContent",
      "../../../shared/intent-stage.ts",
      "await repairIntentStageContent(dir, warn, runner);",
    ],
  ])("flags %s (%s) with a wrong or undefined injection: %s", (functionName, modulePath, call) => {
    const source = [`import { ${functionName} } from "${modulePath}";`, call].join("\n");
    expect(violations(source)).toMatchObject([{ line: 2, functionName }]);
  });

  test.each([
    ["executeWriteLoop", "./write-loop.ts", "await executeWriteLoop({ ...input, stagedMarkdownLintRunner: runner });"],
    ["executeWriteLoop", "./write-loop.ts", "await executeWriteLoop({ ...input, stagedMarkdownLintRunner });"],
    [
      "resumePopulatedIntentPublication",
      "./workflow-runner-resume.ts",
      "await resumePopulatedIntentPublication(run, store, { runner: stub });",
    ],
    [
      "validateIntentStage",
      "../../../shared/intent-stage.ts",
      "await validateIntentStage(dir, paths, () => {}, undefined, runner);",
    ],
    [
      "repairIntentStageContent",
      "../../../shared/intent-stage.ts",
      "await repairIntentStageContent(dir, warn, undefined, runner);",
    ],
  ])("accepts %s (%s) with the correct injection: %s", (functionName, modulePath, call) => {
    const source = [`import { ${functionName} } from "${modulePath}";`, call].join("\n");
    expect(violations(source)).toEqual([]);
  });

  test("exit code is 1 when violations exist, 0 otherwise", () => {
    expect(exitCodeForLintCallViolations([])).toBe(0);
    expect(exitCodeForLintCallViolations([{ file: "a.test.ts", line: 1, functionName: "f" }])).toBe(1);
  });
});
