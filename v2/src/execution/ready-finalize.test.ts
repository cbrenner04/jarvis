import { describe, expect, it, mock } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { READY_STEP_COMPLETION_MARKER, readyStepCompletionRecord } from "../../../scripts/ready.ts";
import { FAILING_TEST_FILE_MARKER, failingTestFileRecord } from "../../../scripts/run-v2-tests.ts";
import { AsyncSubprocessError, type AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import { verifyDiffDerivedMutations } from "./diff-derived-mutation-verifier.ts";
import {
  classifyReadyGateError,
  classifyReadyGateFailure,
  createReadyFinalizer,
  deriveGateAllowedPaths,
  formatReadyGateOutOfScopeDetail,
  outOfScopeSettlementResumable,
  parseGitNameStatusZ,
  ReadyGateError,
  type ReadyGateScopeSeams,
  SurvivingMutationError,
  selectTerminalFailingPaths,
  validateRepoRelativePath,
} from "./ready-finalize.ts";
import { nonEmptyDiscoveryReason } from "./runtime-smoke-verifier.ts";

function gateOutput(parts: {
  completions?: Array<{ stepId: string; attemptId: string; command: string; status: number }>;
  failingFiles?: Array<{ attemptId: string; path: string }>;
  extra?: string;
}): string {
  const lines: string[] = [];
  for (const completion of parts.completions ?? []) {
    lines.push(readyStepCompletionRecord(completion));
  }
  for (const file of parts.failingFiles ?? []) {
    lines.push(failingTestFileRecord(file.path, file.attemptId));
  }
  if (parts.extra !== undefined) {
    lines.push(parts.extra);
  }
  return `${lines.join("")}\n`;
}

export function gateFailureOutput(failingPath: string): string {
  return gateOutput({
    completions: [
      { stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 },
      { stepId: "2", attemptId: "2.2", command: "bun run test:v2", status: 1 },
    ],
    failingFiles: [{ attemptId: "2.2", path: failingPath }],
  });
}

export function lintMdOnlyGateFailureOutput(failingMdPath: string): string {
  return gateOutput({
    completions: [
      { stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 0 },
      { stepId: "3", attemptId: "3.1", command: "bun run lint:md", status: 3 },
    ],
    failingFiles: [{ attemptId: "3.1", path: failingMdPath }],
  });
}

export function initGateScopeWorktree(
  jarvisRoot: string,
  branchName: string,
): { worktreePath: string; baseRef: string } {
  const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
  mkdirSync(worktreePath, { recursive: true });
  execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
  writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
  writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
  writeFileSync(join(worktreePath, ".gitignore"), ".reused\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
  const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "proof.txt"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "iteration"], { stdio: "pipe" });
  return { worktreePath, baseRef };
}

export function initOutsideDiffRepairWorktree(
  jarvisRoot: string,
  branchName: string,
): { worktreePath: string; baseRef: string } {
  const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
  mkdirSync(join(worktreePath, "v2", "src"), { recursive: true });
  execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
  writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
  writeFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "base\n", "utf8");
  writeFileSync(join(worktreePath, ".gitignore"), ".reused\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
  const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
  execFileSync("git", ["-C", worktreePath, "add", "proof.txt"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "iteration"], { stdio: "pipe" });
  return { worktreePath, baseRef };
}

const scope = {
  worktreePath: "/tmp/worktree",
  baseRef: "main",
  specPath: "v2/spec/demo/index.md",
};

const allowedSeams: ReadyGateScopeSeams = {
  gitDiffNameStatus: async () => `M\0v2/src/changed.ts\0`,
  gitUntracked: async () => "",
  listSpecTreePaths: async () => ["v2/spec/demo/index.md", "v2/spec/demo/01-task.md"],
  reproduceReadyGateAtBaseRef: async () => "fail",
};

export const baseRefProbeFailsSeam: ReadyGateScopeSeams = {
  reproduceReadyGateAtBaseRef: async () => "fail",
};

describe("ready gate untouched-path classification", () => {
  it("includes sibling spec-tree markdown when specPath routes a direct subspec file", async () => {
    const root = mkdtempSync(join(tmpdir(), "gate-allowed-"));
    const specDir = join(root, "v2", "spec", "demo");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# index\n");
    writeFileSync(join(specDir, "01-task.md"), "# task\n");
    writeFileSync(join(specDir, "02-sibling.md"), "# sibling\n");
    writeFileSync(join(root, "proof.txt"), "ok\n");
    execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"], { stdio: "pipe" });
    execFileSync("git", ["-C", root, "config", "user.name", "Test User"], { stdio: "pipe" });
    execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
    execFileSync("git", ["-C", root, "commit", "-m", "seed"], { stdio: "pipe" });
    const baseRef = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    writeFileSync(join(root, "changed.ts"), "export {}\n");
    execFileSync("git", ["-C", root, "add", "changed.ts"], { stdio: "pipe" });
    execFileSync("git", ["-C", root, "commit", "-m", "iteration"], { stdio: "pipe" });

    const directSubspecScope = {
      worktreePath: root,
      baseRef,
      specPath: "v2/spec/demo/01-task.md",
    };
    const allowed = await deriveGateAllowedPaths(directSubspecScope, {
      gitUntracked: async () => "",
    });
    expect(allowed?.has("v2/spec/demo/01-task.md")).toBe(true);
    expect(allowed?.has("v2/spec/demo/02-sibling.md")).toBe(true);
    expect(allowed?.has("v2/spec/demo/index.md")).toBe(true);

    const siblingSpecPath = "v2/spec/demo/02-sibling.md";
    const output = gateOutput({
      completions: [{ stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 }],
      failingFiles: [{ attemptId: "2.1", path: siblingSpecPath }],
    });
    const error = new ReadyGateError("bun run ready", 1, output);
    const classified = await classifyReadyGateError(error, directSubspecScope, {
      gitDiffNameStatus: async () => `M\0v2/src/changed.ts\0`,
      gitUntracked: async () => "",
      reproduceReadyGateAtBaseRef: async () => "fail",
    });
    expect(classified.gateFailureKind).toBe("ready_gate_failed");

    const singleFileEnumeration = await classifyReadyGateError(error, directSubspecScope, {
      gitDiffNameStatus: async () => `M\0v2/src/changed.ts\0`,
      gitUntracked: async () => "",
      listSpecTreePaths: async () => ["v2/spec/demo/01-task.md"],
      reproduceReadyGateAtBaseRef: async () => "fail",
    });
    expect(singleFileEnumeration.gateFailureKind).toBe("ready_gate_out_of_scope");
  });

  it("classifies fully attributed terminal failures outside the allowed set as out of scope", async () => {
    const output = gateOutput({
      completions: [
        { stepId: "1", attemptId: "1.1", command: "bun run typecheck", status: 0 },
        { stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 },
        { stepId: "2", attemptId: "2.2", command: "bun run test:v2", status: 1 },
      ],
      failingFiles: [{ attemptId: "2.2", path: "v2/src/untouched.test.ts" }],
    });
    const error = new ReadyGateError("bun run ready", 1, output);
    const classified = await classifyReadyGateError(error, scope, allowedSeams);
    expect(classified.gateFailureKind).toBe("ready_gate_out_of_scope");
    expect(classified.outsidePaths).toEqual(["v2/src/untouched.test.ts"]);
  });

  it("keeps mixed, absent, malformed, stale-retry, later-non-test, and partial attribution on ready_gate_failed", async () => {
    const mixed = await classifyReadyGateError(
      new ReadyGateError(
        "bun run ready",
        1,
        gateOutput({
          completions: [{ stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 }],
          failingFiles: [
            { attemptId: "2.1", path: "v2/src/changed.ts" },
            { attemptId: "2.1", path: "v2/src/untouched.test.ts" },
          ],
        }),
      ),
      scope,
      allowedSeams,
    );
    expect(mixed.gateFailureKind).toBe("ready_gate_failed");

    const absent = await classifyReadyGateError(
      new ReadyGateError(
        "bun run ready",
        1,
        gateOutput({
          completions: [{ stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 }],
        }),
      ),
      scope,
      allowedSeams,
    );
    expect(absent.gateFailureKind).toBe("ready_gate_failed");

    const malformed = await classifyReadyGateError(
      new ReadyGateError(
        "bun run ready",
        1,
        `${READY_STEP_COMPLETION_MARKER}{not-json}\n${failingTestFileRecord("v2/src/untouched.test.ts", "2.1")}`,
      ),
      scope,
      allowedSeams,
    );
    expect(malformed.gateFailureKind).toBe("ready_gate_failed");

    const staleRetry = await classifyReadyGateError(
      new ReadyGateError(
        "bun run ready",
        1,
        gateOutput({
          completions: [
            { stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 },
            { stepId: "2", attemptId: "2.2", command: "bun run test:v2", status: 1 },
          ],
          failingFiles: [{ attemptId: "2.1", path: "v2/src/untouched.test.ts" }],
        }),
      ),
      scope,
      allowedSeams,
    );
    expect(staleRetry.gateFailureKind).toBe("ready_gate_failed");

    const laterNonTest = await classifyReadyGateError(
      new ReadyGateError(
        "bun run ready",
        3,
        gateOutput({
          completions: [
            { stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 0 },
            { stepId: "3", attemptId: "3.1", command: "bun run lint:md", status: 3 },
          ],
          failingFiles: [{ attemptId: "2.1", path: "v2/src/untouched.test.ts" }],
        }),
      ),
      scope,
      allowedSeams,
    );
    expect(laterNonTest.gateFailureKind).toBe("ready_gate_failed");

    const partial = await classifyReadyGateError(
      new ReadyGateError(
        "bun run ready",
        1,
        gateOutput({
          completions: [{ stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 }],
          failingFiles: [
            { attemptId: "2.1", path: "v2/src/untouched.test.ts" },
            { attemptId: "2.1", path: "/absolute/path.test.ts" },
          ],
        }),
      ),
      scope,
      allowedSeams,
    );
    expect(partial.gateFailureKind).toBe("ready_gate_failed");
  });

  it("fails closed for absolute, escaping, colliding, unusual-name, and unavailable scope inputs", async () => {
    expect(validateRepoRelativePath("/absolute.test.ts")).toBeUndefined();
    expect(validateRepoRelativePath("../escape.test.ts")).toBeUndefined();
    expect(
      selectTerminalFailingPaths(
        gateOutput({
          completions: [{ stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 }],
          failingFiles: [
            { attemptId: "2.1", path: "./same.test.ts" },
            { attemptId: "2.1", path: "same.test.ts" },
          ],
        }),
      ),
    ).toBeUndefined();

    const unusualName = await classifyReadyGateError(
      new ReadyGateError(
        "bun run ready",
        1,
        gateOutput({
          completions: [{ stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 }],
          failingFiles: [{ attemptId: "2.1", path: "v2/src/file with space.test.ts" }],
        }),
      ),
      scope,
      allowedSeams,
    );
    expect(unusualName.gateFailureKind).toBe("ready_gate_out_of_scope");
    expect(unusualName.outsidePaths).toEqual(["v2/src/file with space.test.ts"]);

    const renameSeams = {
      ...allowedSeams,
      gitDiffNameStatus: async () => `R100\0v2/src/old.ts\0v2/src/new.ts\0`,
    };
    const renameAllowed = await deriveGateAllowedPaths(scope, renameSeams);
    expect(renameAllowed?.has("v2/src/old.ts")).toBe(true);
    expect(renameAllowed?.has("v2/src/new.ts")).toBe(true);

    const deleteSeams = {
      ...allowedSeams,
      gitDiffNameStatus: async () => `D\0v2/src/removed.ts\0`,
    };
    const deleteAllowed = await deriveGateAllowedPaths(scope, deleteSeams);
    expect(deleteAllowed?.has("v2/src/removed.ts")).toBe(true);

    const untrackedSeams = {
      ...allowedSeams,
      gitUntracked: async () => `v2/src/new-file.ts\0`,
    };
    const untrackedAllowed = await deriveGateAllowedPaths(scope, untrackedSeams);
    expect(untrackedAllowed?.has("v2/src/new-file.ts")).toBe(true);

    const unavailableDiff = await deriveGateAllowedPaths(scope, {
      ...allowedSeams,
      gitDiffNameStatus: async () => null,
    });
    expect(unavailableDiff).toBeUndefined();

    const unavailableInventory = await deriveGateAllowedPaths(scope, {
      ...allowedSeams,
      gitUntracked: async () => null,
    });
    expect(unavailableInventory).toBeUndefined();

    const malformedDiff = await deriveGateAllowedPaths(scope, {
      ...allowedSeams,
      gitDiffNameStatus: async () => "M\0missing-trailing-nul",
    });
    expect(malformedDiff).toBeUndefined();
  });

  it("does not misclassify deadline-killed or requiredIntegrationScope failures", async () => {
    const timedOut = await classifyReadyGateError(
      new ReadyGateError("bun run ready", 124, "timeout\n", true),
      scope,
      allowedSeams,
    );
    expect(timedOut.gateFailureKind).toBe("ready_gate_failed");

    const integration = await classifyReadyGateError(
      new ReadyGateError(
        "test:integration:v2",
        1,
        gateOutput({
          completions: [{ stepId: "1", attemptId: "1.1", command: "bun run test:integration:v2", status: 1 }],
          failingFiles: [{ attemptId: "1.1", path: "v2/src/untouched.test.ts" }],
        }),
      ),
      scope,
      allowedSeams,
    );
    expect(integration.gateFailureKind).toBe("ready_gate_failed");
  });

  it("formats out-of-scope detail from base-ref reproduction semantics", () => {
    expect(formatReadyGateOutOfScopeDetail(["v2/src/untouched.test.ts"], "main")).toBe(
      "ready gate failing paths also reproduce on main: v2/src/untouched.test.ts",
    );
  });

  it("base-ref probe invokes the terminal ready-step scoped command", async () => {
    // @mutate v2/src/execution/ready-finalize.ts "if (v2Mode !== undefined) {" -> "if (false) {"
    const realRunV2Tests = await import("../../../scripts/run-v2-tests.ts");
    const runV2Calls: Array<{ mode: string; files: string[] }> = [];
    const subprocessCalls: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const failingPath = "v2/src/untouched.test.ts";
    const probeScope = {
      worktreePath: "/tmp/run-worktree",
      baseRef: "main",
      specPath: "v2/spec/demo/index.md",
    };
    const allowed = new Set(["v2/src/changed.ts"]);
    const probeSeams: ReadyGateScopeSeams = {
      gitDiffNameStatus: async () => `M\0v2/src/changed.ts\0`,
      gitUntracked: async () => "",
      listSpecTreePaths: async () => ["v2/spec/demo/index.md"],
    };
    const mockRunner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, _cwd, options) {
        if (cmd === "git") {
          if (args?.[0] === "merge-base") {
            return "abc123\n";
          }
          if (args?.[0] === "worktree") {
            return "";
          }
          if (args?.[0] === "diff" && args?.[1] === "--name-only") {
            return "v2/src/changed.ts\n";
          }
          if (args?.[0] === "ls-files") {
            return "";
          }
        }
        if (cmd === "bun") {
          subprocessCalls.push({
            cmd,
            args: [...args],
            ...(options?.env !== undefined ? { env: options.env } : {}),
          });
        }
        return "";
      },
    };

    mock.module("../../../scripts/run-v2-tests.ts", () => ({
      ...realRunV2Tests,
      async runV2TestFiles(mode: string, files: string[]) {
        runV2Calls.push({ mode, files });
        return files.map((file) => ({ file, timedOut: false, status: 0 }));
      },
    }));

    try {
      for (const terminalCommand of ["bun run test:v2", "bun run test:integration:v2"] as const) {
        runV2Calls.length = 0;
        subprocessCalls.length = 0;
        const output = gateOutput({
          completions: [{ stepId: "2", attemptId: "2.1", command: terminalCommand, status: 1 }],
          failingFiles: [{ attemptId: "2.1", path: failingPath }],
        });
        const error = new ReadyGateError("bun run ready", 1, output);
        await classifyReadyGateFailure(error, [failingPath], allowed, probeScope, probeSeams, mockRunner);
        expect(runV2Calls).toEqual([
          {
            mode: terminalCommand === "bun run test:integration:v2" ? "integration" : "agent",
            files: [failingPath],
          },
        ]);
        expect(subprocessCalls.some((call) => call.args[0] === "test")).toBe(false);
        expect(subprocessCalls.some((call) => call.args[0] === "run" && call.args[1] === "test:v2")).toBe(false);
        expect(subprocessCalls.some((call) => call.args[0] === "run" && call.args[1] === "test:integration:v2")).toBe(
          false,
        );
      }

      subprocessCalls.length = 0;
      const v1Output = gateOutput({
        completions: [{ stepId: "2", attemptId: "2.1", command: "bun run test:v1", status: 1 }],
        failingFiles: [{ attemptId: "2.1", path: failingPath }],
      });
      const v1Error = new ReadyGateError("bun run ready", 1, v1Output);
      await classifyReadyGateFailure(v1Error, [failingPath], allowed, probeScope, probeSeams, mockRunner);
      const bunProbe = subprocessCalls.find((call) => call.cmd === "bun");
      expect(bunProbe?.args).toEqual(["test", failingPath]);
      expect(bunProbe?.env?.JARVIS_READY_TIER).toBe("full");
      expect(bunProbe?.env?.JARVIS_READY_TEST_SCOPE).toBe("test:v2 test:integration:v2");
    } finally {
      mock.module("../../../scripts/run-v2-tests.ts", () => realRunV2Tests);
    }
  });

  it("base-ref reproduction classifies a base-passing worktree-failing path as in scope", async () => {
    // @mutate invert `outcome === "pass"` to `outcome !== "pass"` in `probeOutsidePathsAtBaseRef` (ready-finalize.ts)
    const output = gateOutput({
      completions: [{ stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 }],
      failingFiles: [{ attemptId: "2.1", path: "v2/src/untouched.test.ts" }],
    });
    const error = new ReadyGateError("bun run ready", 1, output);
    const classified = await classifyReadyGateError(error, scope, {
      ...allowedSeams,
      reproduceReadyGateAtBaseRef: async () => "pass",
    });
    expect(classified.gateFailureKind).toBe("ready_gate_failed");
    expect(classified.gateRepairAllowsetPaths).toEqual(["v2/src/untouched.test.ts"]);
  });

  it("base-ref probe failure classifies in scope", async () => {
    const probeMessage = "exit 1: probe stderr tail";
    const output = gateOutput({
      completions: [{ stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 }],
      failingFiles: [{ attemptId: "2.1", path: "v2/src/untouched.test.ts" }],
    });
    const error = new ReadyGateError("bun run ready", 1, output);
    const classified = await classifyReadyGateError(error, scope, {
      ...allowedSeams,
      reproduceReadyGateAtBaseRef: async () => ({ kind: "error", message: probeMessage }),
    });
    expect(classified.gateFailureKind).toBe("ready_gate_failed");
    expect(classified.gateRepairAllowsetPaths).toEqual(["v2/src/untouched.test.ts"]);
    expect(classified.baseRefProbeError).toBe(probeMessage);
  });

  it("turns guard inversions red for parsing, validation, scope resolution, and classification", async () => {
    const output = gateOutput({
      completions: [{ stepId: "2", attemptId: "2.1", command: "bun run test:v2", status: 1 }],
      failingFiles: [{ attemptId: "2.1", path: "v2/src/untouched.test.ts" }],
    });
    const allowed = new Set(["v2/src/changed.ts", "v2/spec/demo/index.md"]);
    const error = new ReadyGateError("bun run ready", 1, output);

    expect(selectTerminalFailingPaths(output)).toEqual(["v2/src/untouched.test.ts"]);
    expect(selectTerminalFailingPaths(output.replace(FAILING_TEST_FILE_MARKER, "INVERTED "))).toBeUndefined();

    expect(validateRepoRelativePath("v2/src/ok.test.ts")).toBe("v2/src/ok.test.ts");
    expect(validateRepoRelativePath("../bad.test.ts")).toBeUndefined();

    expect(parseGitNameStatusZ("M\0v2/src/changed.ts\0")).toEqual(["v2/src/changed.ts"]);
    expect(parseGitNameStatusZ("M\0broken")).toBeUndefined();

    expect(
      await classifyReadyGateFailure(error, ["v2/src/untouched.test.ts"], allowed, scope, {
        reproduceReadyGateAtBaseRef: async () => "fail",
      }),
    ).toEqual({
      kind: "ready_gate_out_of_scope",
      outsidePaths: ["v2/src/untouched.test.ts"],
    });
    expect(
      (
        await classifyReadyGateFailure(error, ["v2/src/untouched.test.ts"], allowed, scope, {
          reproduceReadyGateAtBaseRef: async () => "fail",
        })
      ).kind,
    ).not.toBe("ready_gate_failed");
    expect(
      (
        await classifyReadyGateFailure(error, undefined, allowed, scope, {
          reproduceReadyGateAtBaseRef: async () => "fail",
        })
      ).kind,
    ).toBe("ready_gate_failed");
    expect(
      (
        await classifyReadyGateFailure(error, ["v2/src/changed.ts"], allowed, scope, {
          reproduceReadyGateAtBaseRef: async () => "fail",
        })
      ).kind,
    ).toBe("ready_gate_failed");
  });
});

describe("createReadyFinalizer", () => {
  const input = { worktreePath: "/tmp/worktree", branch: "feature-branch", baseRef: "main" };
  const noopDelay = async () => {};

  it("runs the ready gate then flips the draft PR on green", async () => {
    const calls: string[] = [];
    const finalizer = createReadyFinalizer({
      runReadyGate: async (worktreePath, baseRef) => {
        calls.push(`gate:${worktreePath}@${baseRef}`);
      },
      ghReadyFlip: async (branch, worktreePath) => {
        calls.push(`flip:${branch}@${worktreePath}`);
      },
    });

    await finalizer(input);

    expect(calls).toEqual(["gate:/tmp/worktree@main", "flip:feature-branch@/tmp/worktree"]);
  });

  it("returns a successful runtime smoke outcome", async () => {
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      runRuntimeSmokeVerification: async () => ({
        kind: "not-runnable",
        inspectedPaths: ["v2/src/execution/write-loop.ts", "shared/subprocess.ts"],
        discoveryReason: nonEmptyDiscoveryReason("no changed runnable entrypoint found"),
      }),
      ghReadyFlip: async () => {},
    });

    await expect(finalizer(input)).resolves.toEqual({
      runtimeSmokeOutcome: {
        kind: "not-runnable",
        inspectedPaths: ["v2/src/execution/write-loop.ts", "shared/subprocess.ts"],
        discoveryReason: nonEmptyDiscoveryReason("no changed runnable entrypoint found"),
      },
    });
  });

  it("carries a successful runtime smoke outcome when the ready flip fails", async () => {
    const outcome = { kind: "observed-clean" } as const;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      runRuntimeSmokeVerification: async () => outcome,
      ghReadyFlip: async () => {
        throw new Error("gh pr ready failed");
      },
      delay: noopDelay,
    });

    await expect(finalizer(input)).rejects.toEqual(
      expect.objectContaining({
        name: "ReadyFlipError",
        runtimeSmokeOutcome: outcome,
      }),
    );
  });

  it("does not return a runtime smoke outcome when no verifier is configured", async () => {
    const finalizer = createReadyFinalizer({ runReadyGate: async () => {}, ghReadyFlip: async () => {} });

    await expect(finalizer(input)).resolves.toEqual({});
  });

  it("leaves the PR draft and does not flip when the ready gate fails", async () => {
    let flipCalls = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {
        throw new Error("ready gate failed (exit 1): tests failed");
      },
      ghReadyFlip: async () => {
        flipCalls += 1;
      },
    });

    await expect(finalizer(input)).rejects.toThrow("ready gate failed");
    expect(flipCalls).toBe(0);
  });

  it("stops ready finalization for missing prompt render coverage", async () => {
    let flipCalls = 0;
    let prompt = `---
id: patch.review.critic
behavior: review
kind: step
revision: 1
placeholders: []
---
new output
`;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      runMutationVerification: async () => {
        const result = await verifyDiffDerivedMutations(
          { worktreePath: "/tmp/worktree", runBase: "main" },
          {
            gitDiff: async () => `diff --git a/prompts/patch/review-critic.md b/prompts/patch/review-critic.md
index f424d7da..be281d02 100644
--- a/prompts/patch/review-critic.md
+++ b/prompts/patch/review-critic.md
@@ -1 +1 @@
-old output
+new output
diff --git a/shared/prompts/review-implement.test.ts b/shared/prompts/review-implement.test.ts
index 1234567..abcdefg 100644
--- a/shared/prompts/review-implement.test.ts
+++ b/shared/prompts/review-implement.test.ts
@@ -1 +1 @@
+const output = renderPatchReviewCriticPrompt();
`,
            untrackedFiles: async () => [],
            registeredPromptPaths: async () => ["prompts/patch/review-critic.md"],
            readFile: async () => prompt,
            writeFile: async (_path, content) => {
              prompt = content;
            },
            runScopedTests: async () => true,
          },
        );
        if (result.kind === "surviving-mutation") {
          throw new SurvivingMutationError(result.mutation, result.sourceSite.file, result.sourceSite.line);
        }
      },
      ghReadyFlip: async () => {
        flipCalls += 1;
      },
    });

    await expect(finalizer(input)).rejects.toThrow(
      "Surviving mutation in prompts/patch/review-critic.md:1: missing-render-coverage",
    );
    expect(flipCalls).toBe(0);
  });

  it("carries the ready gate command, exit code, and combined output", async () => {
    const finalizer = createReadyFinalizer({
      asyncSubprocessRunner: {
        async runAsync() {
          throw new AsyncSubprocessError("ready failed", 1, "stdout failure\n", "stderr failure\n", undefined);
        },
      },
    });

    await expect(finalizer(input)).rejects.toEqual(
      new ReadyGateError("bun run ready", 1, "stdout failure\nstderr failure\n"),
    );
  });

  it("retries transient gh pr ready errors up to 3 attempts", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const notices: string[] = [];

    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Connection reset by peer");
        }
      },
      delay: async (ms) => {
        delays.push(ms);
      },
      retryNotice: (message) => {
        notices.push(message);
      },
    });

    await finalizer(input);

    expect(attempts).toBe(3);
    expect(delays).toEqual([1000, 1000]);
    expect(notices).toEqual([
      "gh pr ready: Connection reset by peer; exit=unknown; retrying (attempt 2/3)",
      "gh pr ready: Connection reset by peer; exit=unknown; retrying (attempt 3/3)",
    ]);
  });

  it("treats already ready stderr as success without retry", async () => {
    let attempts = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {
        attempts += 1;
        throw new Error("error: pull request is already ready for review");
      },
      delay: noopDelay,
      retryNotice: () => {
        throw new Error("should not retry");
      },
    });

    await finalizer(input);

    expect(attempts).toBe(1);
  });

  it("treats not a draft stderr as success without retry", async () => {
    let attempts = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {
        attempts += 1;
        throw new Error("error: this pull request is not a draft");
      },
      delay: noopDelay,
      retryNotice: () => {
        throw new Error("should not retry");
      },
    });

    await finalizer(input);

    expect(attempts).toBe(1);
  });

  it("treats an empty exit-0 gh pr ready response as success", async () => {
    let attempts = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {
        attempts += 1;
      },
    });

    await finalizer(input);

    expect(attempts).toBe(1);
  });

  it("throws after 3 failed gh pr ready attempts", async () => {
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {
        throw new Error("Connection timeout");
      },
      delay: noopDelay,
    });

    await expect(finalizer(input)).rejects.toThrow("Connection timeout");
  });

  it("overrides inherited JARVIS_READY_TIER=fast with full in the gate's child env", async () => {
    const originalEnv = process.env.JARVIS_READY_TIER;
    try {
      process.env.JARVIS_READY_TIER = "fast";

      const calls: Array<{ env: NodeJS.ProcessEnv | undefined }> = [];
      const mockRunner: AsyncSubprocessRunner = {
        async runAsync(cmd, _args, _cwd, options) {
          if (cmd === "bun") {
            calls.push({ env: options?.env });
          }
          return "";
        },
      };

      const finalizer = createReadyFinalizer({
        asyncSubprocessRunner: mockRunner,
        ghReadyFlip: async () => {},
      });

      await finalizer(input);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.env?.JARVIS_READY_TIER).toBe("full");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.JARVIS_READY_TIER;
      } else {
        process.env.JARVIS_READY_TIER = originalEnv;
      }
    }
  });

  it("scopes JARVIS_READY_TEST_SCOPE to v2 test scripts when only v2/** changed", async () => {
    const calls: Array<{ env: NodeJS.ProcessEnv | undefined }> = [];
    const mockRunner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, _cwd, options) {
        if (cmd === "git") {
          if (args?.[0] === "diff") return "v2/src/execution/ready-finalize.ts\nv2/src/execution/write-loop.ts";
          if (args?.[0] === "ls-files") return "";
        }
        calls.push({ env: options?.env });
        return "";
      },
    };

    const finalizer = createReadyFinalizer({
      asyncSubprocessRunner: mockRunner,
      ghReadyFlip: async () => {},
    });

    await finalizer(input);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.env?.JARVIS_READY_TIER).toBe("full");
    expect(calls[0]?.env?.JARVIS_READY_TEST_SCOPE).toBe("test:v2 test:integration:v2");
  });

  it("classifies gate failure with exit 124 as timed out", async () => {
    const finalizer = createReadyFinalizer({
      asyncSubprocessRunner: {
        async runAsync() {
          throw new AsyncSubprocessError("ready failed", 124, "", "", undefined);
        },
      },
    });

    try {
      await finalizer(input);
      expect.unreachable();
    } catch (error) {
      const gateError = error as InstanceType<typeof ReadyGateError>;
      expect(gateError.timedOut).toBe(true);
      expect(gateError.exitCode).toBe(124);
    }
  });

  it("classifies gate failure with deadline marker in output as timed out", async () => {
    const finalizer = createReadyFinalizer({
      asyncSubprocessRunner: {
        async runAsync() {
          throw new AsyncSubprocessError(
            "ready failed",
            1,
            "ready: deadline exceeded after 600000ms; killing child tree\n",
            "",
            undefined,
          );
        },
      },
    });

    try {
      await finalizer(input);
      expect.unreachable();
    } catch (error) {
      const gateError = error as InstanceType<typeof ReadyGateError>;
      expect(gateError.timedOut).toBe(true);
      expect(gateError.exitCode).toBe(1);
    }
  });

  it("classifies non-timeout gate failure (exit 1, no marker) as not timed out", async () => {
    const finalizer = createReadyFinalizer({
      asyncSubprocessRunner: {
        async runAsync() {
          throw new AsyncSubprocessError("ready failed", 1, "test failure\n", "stderr\n", undefined);
        },
      },
    });

    try {
      await finalizer(input);
      expect.unreachable();
    } catch (error) {
      const gateError = error as InstanceType<typeof ReadyGateError>;
      expect(gateError.timedOut).toBe(false);
      expect(gateError.exitCode).toBe(1);
    }
  });

  it("classifies required-integration failure with exit 124 as timed out", async () => {
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {},
      asyncSubprocessRunner: {
        async runAsync(cmd, args) {
          if (cmd === "bun" && args?.[0] === "run" && args?.[1] === "test:integration:v2") {
            throw new AsyncSubprocessError("integration test failed", 124, "", "", undefined);
          }
          return "";
        },
      },
    });

    try {
      await finalizer({ ...input, requiredIntegrationScope: "test:integration:v2" });
      expect.unreachable();
    } catch (error) {
      const gateError = error as InstanceType<typeof ReadyGateError>;
      expect(gateError.timedOut).toBe(true);
      expect(gateError.command).toBe("test:integration:v2");
    }
  });

  it("falls back to JARVIS_READY_TEST_SCOPE=full when diff fails", async () => {
    const calls: Array<{ env: NodeJS.ProcessEnv | undefined }> = [];
    const mockRunner: AsyncSubprocessRunner = {
      async runAsync(cmd, _args, _cwd, options) {
        if (cmd === "git") {
          throw new Error("unable to resolve base ref");
        }
        calls.push({ env: options?.env });
        return "";
      },
    };

    const finalizer = createReadyFinalizer({
      asyncSubprocessRunner: mockRunner,
      ghReadyFlip: async () => {},
    });

    await finalizer(input);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.env?.JARVIS_READY_TIER).toBe("full");
    expect(calls[0]?.env?.JARVIS_READY_TEST_SCOPE).toBe("full");
  });

  it("rejects required v2 integration scope failure before publisher finalization", async () => {
    let flipCalls = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      runRequiredIntegration: async () => {
        throw new ReadyGateError("bun run test:integration:v2", 1, "integration test failed\n");
      },
      ghReadyFlip: async () => {
        flipCalls += 1;
      },
    });

    const inputWithIntegration = { ...input, requiredIntegrationScope: "test:integration:v2" };
    await expect(finalizer(inputWithIntegration)).rejects.toThrow("ready gate failed");
    expect(flipCalls).toBe(0);
  });

  it("runs required integration scope after ready gate and before flip", async () => {
    const calls: string[] = [];
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {
        calls.push("gate");
      },
      runRequiredIntegration: async () => {
        calls.push("integration");
      },
      ghReadyFlip: async () => {
        calls.push("flip");
      },
    });

    const inputWithIntegration = { ...input, requiredIntegrationScope: "test:integration:v2" };
    await finalizer(inputWithIntegration);

    expect(calls).toEqual(["gate", "integration", "flip"]);
  });

  it("skips required integration scope when not specified", async () => {
    let integrationCalls = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      runRequiredIntegration: async () => {
        integrationCalls += 1;
      },
      ghReadyFlip: async () => {},
    });

    await finalizer(input);

    expect(integrationCalls).toBe(0);
  });

  it("appends dual-constraint clause only when both timer callback and guarded root apply", () => {
    const dual = new SurvivingMutationError("guard-flip: !x → x", "v2/src/execution/test.ts", 3, true);
    expect(dual.message).toContain("Surviving mutation in v2/src/execution/test.ts:3: guard-flip: !x → x");
    expect(dual.message).toContain("setTimeout/setInterval callback");
    expect(dual.message).toContain("determinism-guarded");
    expect(dual.message).toContain("pure exported predicate");
    expect(dual.message).toContain("both truth directions");

    const single = new SurvivingMutationError("guard-flip: !x → x", "v2/src/execution/test.ts", 3);
    expect(single.message).toBe("Surviving mutation in v2/src/execution/test.ts:3: guard-flip: !x → x");
  });
});

describe("outOfScopeSettlementResumable", () => {
  const outOfScopeRecord = (paths: string[], resumable = false): PersistedRecord => ({
    runId: "run-1",
    seq: 1,
    ts: "",
    event: {
      kind: "loop_finished",
      loopOutcomeKind: "ready_gate_out_of_scope",
      iterationsConsumed: 1,
      resumable,
      readyGateOutsidePaths: paths,
    },
  });

  it("returns false for first settlement with no prior out-of-scope record", () => {
    expect(outOfScopeSettlementResumable(["v2/src/a.test.ts"], [])).toBe(false);
  });

  it("returns false when outside paths match the first settlement", () => {
    const path = "v2/src/untouched.test.ts";
    expect(outOfScopeSettlementResumable([path], [outOfScopeRecord([path])])).toBe(false);
  });

  it("returns true when outside paths differ from the first settlement", () => {
    const prior = [outOfScopeRecord(["v2/src/a.test.ts"])];
    expect(outOfScopeSettlementResumable(["v2/src/b.test.ts"], prior)).toBe(true);
    expect(outOfScopeSettlementResumable(["v2/src/a.test.ts", "v2/src/b.test.ts"], prior)).toBe(true);
  });

  it("returns false for missing or empty outside-path evidence", () => {
    expect(outOfScopeSettlementResumable(undefined, [outOfScopeRecord(["v2/src/a.test.ts"])])).toBe(false);
    expect(outOfScopeSettlementResumable([], [outOfScopeRecord(["v2/src/a.test.ts"])])).toBe(false);
  });
});
