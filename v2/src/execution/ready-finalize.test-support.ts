import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readyStepCompletionRecord } from "../../../scripts/ready.ts";
import { failingTestFileRecord } from "../../../scripts/run-v2-tests.ts";
import type { ReadyGateScopeSeams } from "./ready-finalize.ts";

export function gateOutput(parts: {
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

/** A fixed placeholder conclusive-fail probe outcome for seam stubs that don't care about its
 *  observation values, just that the probe confirmed the failure reproduces at the base ref. */
export const PLACEHOLDER_BASE_REF_PROBE_FAIL = { kind: "fail" as const, pass: 0, fail: 1, baseCommit: "abc1234" };

export const PLACEHOLDER_BASE_REF_PROBE_OBSERVATION = { pass: 0, fail: 1, baseCommit: "abc1234" };

export const baseRefProbeFailsSeam: ReadyGateScopeSeams = {
  reproduceReadyGateAtBaseRef: async () => PLACEHOLDER_BASE_REF_PROBE_FAIL,
};
