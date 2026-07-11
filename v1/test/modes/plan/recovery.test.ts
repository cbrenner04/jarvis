import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRecoveryCheckpointSafe,
  findRecoveryTarget,
  hasQualifyingTimeout,
  validateRecoveryReconciliation,
  validateRecoveryReplacement,
} from "../../../src/modes/plan/recovery.ts";

describe("timed-out subspec recovery", () => {
  test("accepts one matching terminal patch timeout and one unchecked local target", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-recovery-"));
    try {
      const spec = join(root, "spec");
      mkdirSync(spec);
      writeFileSync(join(spec, "index.md"), "# Spec\n\n- [ ] [Task](./00-task.md)\n");
      writeFileSync(join(spec, "00-task.md"), "# Task\n\n## Acceptance criteria\n\n- [ ] works\n");
      writeFileSync(
        join(root, "runs.jsonl"),
        `${JSON.stringify({ record_role: "run_terminal", mode: "patch", exit_reason: "iteration-timeout", active_subspec_path: "spec/00-task.md" })}\n`,
      );
      expect(findRecoveryTarget(join(spec, "index.md"), "./00-task.md").subspecPath).toBe(join(spec, "00-task.md"));
      expect(hasQualifyingTimeout(join(root, "runs.jsonl"), root, join(spec, "00-task.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects unrelated records, duplicate links, and invalid replacements", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-recovery-"));
    try {
      const spec = join(root, "spec");
      mkdirSync(spec);
      writeFileSync(join(spec, "00-task.md"), "# Task\n\n## Acceptance criteria\n\n- [ ] works\n");
      writeFileSync(join(spec, "index.md"), "- [ ] [A](./00-task.md)\n- [ ] [B](./00-task.md)\n");
      writeFileSync(
        join(root, "runs.jsonl"),
        `${JSON.stringify({ record_role: "run_terminal", mode: "patch", exit_reason: "idle-timeout", active_subspec_path: "spec/00-task.md" })}\n`,
      );
      expect(() => findRecoveryTarget(join(spec, "index.md"), "./00-task.md")).toThrow("one unchecked index link");
      expect(hasQualifyingTimeout(join(root, "runs.jsonl"), root, join(spec, "00-task.md"))).toBe(false);
      expect(() => validateRecoveryReplacement("bad.md", "# x")).toThrow("invalid replacement filename");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses checkpoint work and requires an atomic replacement", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-recovery-"));
    try {
      execFileSync("git", ["init", "-q", root]);
      const spec = join(root, "spec");
      mkdirSync(spec);
      const worktreeAdminDir = join(root, ".git", "worktrees", "spec", "jarvis");
      mkdirSync(worktreeAdminDir, { recursive: true });
      writeFileSync(join(worktreeAdminDir, "iteration-timeout-checkpoint.json"), "{}");
      expect(() => assertRecoveryCheckpointSafe(root, "spec")).toThrow("checkpoint receipt");
      unlinkSync(join(worktreeAdminDir, "iteration-timeout-checkpoint.json"));
      writeFileSync(join(spec, "index.md"), "- [ ] [A](./01-a.md)\n- [ ] [B](./02-b.md)\n");
      writeFileSync(join(spec, "01-a.md"), "# A\n\n## Acceptance criteria\n\n- [ ] a\n");
      writeFileSync(join(spec, "02-b.md"), "# B\n\n## Acceptance criteria\n\n- [ ] b\n");
      expect(
        validateRecoveryReconciliation({
          specDir: spec,
          oldSubspecBasename: "00-old.md",
          indexPath: join(spec, "index.md"),
          preexistingSubspecs: [],
        }),
      ).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("counts only newly-created replacements, not preexisting completed siblings", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-recovery-"));
    try {
      const spec = join(root, "spec");
      mkdirSync(spec);
      writeFileSync(join(spec, "index.md"), "- [x] [A](./01-a.md)\n- [x] [B](./02-b.md)\n");
      writeFileSync(join(spec, "01-a.md"), "# A\n\n## Acceptance criteria\n\n- [x] a\n");
      writeFileSync(join(spec, "02-b.md"), "# B\n\n## Acceptance criteria\n\n- [x] b\n");
      expect(() =>
        validateRecoveryReconciliation({
          specDir: spec,
          oldSubspecBasename: "00-old.md",
          indexPath: join(spec, "index.md"),
          preexistingSubspecs: ["01-a.md", "02-b.md"],
        }),
      ).toThrow("at least two replacement subspecs");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
