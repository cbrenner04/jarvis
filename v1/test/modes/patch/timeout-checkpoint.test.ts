import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { consumeTimeoutCheckpointReceipt, writeTimeoutCheckpointReceipt } from "../../../src/modes/patch/timeout-checkpoint.ts";

function setup(): { root: string; spec: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "timeout-checkpoint-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  mkdirSync(join(root, "spec"));
  const spec = join(root, "spec", "task.md");
  writeFileSync(spec, "# Task\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-m", "checkpoint"], { cwd: root });
  return { root, spec, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("timeout checkpoint receipts", () => {
  test("qualifies and consumes a matching receipt once", () => {
    const { root, spec, cleanup } = setup();
    try {
      const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      execFileSync("git", ["commit", "--allow-empty", "-m", "WIP: checkpoint (iteration-timeout)\n\nSpec: spec/task.md"], {
        cwd: root,
      });
      writeTimeoutCheckpointReceipt(root, spec);
      const receiptPath = execFileSync("git", ["rev-parse", "--git-path", "jarvis/iteration-timeout-checkpoint.json"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
      const receipt = JSON.parse(readFileSync(resolve(root, receiptPath), "utf8")) as Record<string, unknown>;
      expect(receipt.version).toBe(1);
      expect(receipt.reason).toBe("iteration-timeout");
      expect(receipt.checkpointOid).not.toBe(oid);
      expect(receipt.activeSubspecPath).toBe("spec/task.md");
      expect(consumeTimeoutCheckpointReceipt(root, spec)?.activeSubspecPath).toBe("spec/task.md");
      expect(consumeTimeoutCheckpointReceipt(root, spec)).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("rejects a receipt after an intervening commit", () => {
    const { root, spec, cleanup } = setup();
    try {
      execFileSync("git", ["commit", "--allow-empty", "-m", "WIP: checkpoint (iteration-timeout)\n\nSpec: spec/task.md"], { cwd: root });
      writeTimeoutCheckpointReceipt(root, spec);
      execFileSync("git", ["commit", "--allow-empty", "-m", "intervening"], { cwd: root });
      expect(consumeTimeoutCheckpointReceipt(root, spec)).toBeNull();
    } finally {
      cleanup();
    }
  });
});
