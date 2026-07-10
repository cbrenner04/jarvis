import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  consumeTimeoutCheckpointReceipt,
  writeTimeoutCheckpointReceipt,
} from "../../../src/modes/patch/timeout-checkpoint.ts";

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
  function getReceiptPath(root: string): string {
    const path = execFileSync("git", ["rev-parse", "--git-path", "jarvis/iteration-timeout-checkpoint.json"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    return resolve(root, path);
  }

  test("qualifies and consumes a matching receipt once", () => {
    const { root, spec, cleanup } = setup();
    try {
      const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      execFileSync(
        "git",
        ["commit", "--allow-empty", "-m", "WIP: checkpoint (iteration-timeout)\n\nSpec: spec/task.md"],
        {
          cwd: root,
        },
      );
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
      execFileSync(
        "git",
        ["commit", "--allow-empty", "-m", "WIP: checkpoint (iteration-timeout)\n\nSpec: spec/task.md"],
        { cwd: root },
      );
      writeTimeoutCheckpointReceipt(root, spec);
      execFileSync("git", ["commit", "--allow-empty", "-m", "intervening"], { cwd: root });
      expect(consumeTimeoutCheckpointReceipt(root, spec)).toBeNull();
      expect(existsSync(getReceiptPath(root))).toBeFalse();
    } finally {
      cleanup();
    }
  });

  test("retires malformed and mismatched receipts", () => {
    const { root, spec, cleanup } = setup();
    try {
      const path = getReceiptPath(root);
      mkdirSync(join(root, ".git", "jarvis"), { recursive: true });
      writeFileSync(path, "not json");
      expect(consumeTimeoutCheckpointReceipt(root, spec)).toBeNull();
      expect(existsSync(path)).toBeFalse();

      execFileSync(
        "git",
        ["commit", "--allow-empty", "-m", "WIP: checkpoint (iteration-timeout)\n\nSpec: spec/task.md"],
        {
          cwd: root,
        },
      );
      writeTimeoutCheckpointReceipt(root, spec);
      const otherSpec = join(root, "spec", "other.md");
      writeFileSync(otherSpec, "# Other\n");
      expect(consumeTimeoutCheckpointReceipt(root, otherSpec)).toBeNull();
      expect(existsSync(path)).toBeFalse();
    } finally {
      cleanup();
    }
  });

  test("does not revive stale evidence after HEAD restoration", () => {
    const { root, spec, cleanup } = setup();
    try {
      execFileSync(
        "git",
        ["commit", "--allow-empty", "-m", "WIP: checkpoint (iteration-timeout)\n\nSpec: spec/task.md"],
        {
          cwd: root,
        },
      );
      writeTimeoutCheckpointReceipt(root, spec);
      const checkpoint = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      execFileSync("git", ["commit", "--allow-empty", "-m", "intervening"], { cwd: root });
      expect(consumeTimeoutCheckpointReceipt(root, spec)).toBeNull();
      execFileSync("git", ["reset", "--hard", checkpoint], { cwd: root, stdio: "pipe" });
      expect(consumeTimeoutCheckpointReceipt(root, spec)).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("warns and omits context when inspection or consumption fails", () => {
    const { root, spec, cleanup } = setup();
    try {
      const path = getReceiptPath(root);
      mkdirSync(path, { recursive: true });
      const inspectionWarnings: string[] = [];
      expect(consumeTimeoutCheckpointReceipt(root, spec, (message) => inspectionWarnings.push(message))).toBeNull();
      expect(inspectionWarnings.join("\n")).toContain("could not inspect timeout checkpoint receipt");
      expect(inspectionWarnings.join("\n")).toContain("could not retire timeout checkpoint receipt");
      rmSync(`${path}.${process.pid}.consumed`, { recursive: true, force: true });

      execFileSync(
        "git",
        ["commit", "--allow-empty", "-m", "WIP: checkpoint (iteration-timeout)\n\nSpec: spec/task.md"],
        {
          cwd: root,
        },
      );
      writeTimeoutCheckpointReceipt(root, spec);
      mkdirSync(`${path}.${process.pid}.consumed`);
      const consumptionWarnings: string[] = [];
      expect(consumeTimeoutCheckpointReceipt(root, spec, (message) => consumptionWarnings.push(message))).toBeNull();
      expect(consumptionWarnings.join("\n")).toContain("could not consume timeout checkpoint receipt");
    } finally {
      cleanup();
    }
  });
});
