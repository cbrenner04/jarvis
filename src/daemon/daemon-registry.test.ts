import { describe, expect, test } from "bun:test";
import { checkWorktreeClaimed, DaemonDoubleClaimError, WorktreeOwnershipRegistry } from "./daemon";

describe("WorktreeOwnershipRegistry", () => {
  test("claim and release", () => {
    const registry = new WorktreeOwnershipRegistry();
    const key = { project: "test-proj", branch: "main" };
    const ownership = { runId: "run-123", worktreePath: "/tmp/wt" };

    // Initial claim succeeds
    registry.claim(key, ownership);
    expect(registry.isClaimed(key)).toBe(true);
    expect(registry.get(key)).toEqual(ownership);

    // Second claim on same key fails
    expect(() => {
      registry.claim(key, { runId: "run-456", worktreePath: "/tmp/wt2" });
    }).toThrow(DaemonDoubleClaimError);

    // Release succeeds
    registry.release(key);
    expect(registry.isClaimed(key)).toBe(false);
    expect(registry.get(key)).toBeUndefined();

    // Release on unheld key is no-op
    registry.release(key);
    expect(registry.isClaimed(key)).toBe(false);
  });

  test("multiple independent worktree claims coexist", () => {
    const registry = new WorktreeOwnershipRegistry();
    const key1 = { project: "proj1", branch: "main" };
    const key2 = { project: "proj1", branch: "dev" };
    const key3 = { project: "proj2", branch: "main" };

    registry.claim(key1, { runId: "run-1", worktreePath: "/tmp/wt1" });
    registry.claim(key2, { runId: "run-2", worktreePath: "/tmp/wt2" });
    registry.claim(key3, { runId: "run-3", worktreePath: "/tmp/wt3" });

    expect(registry.isClaimed(key1)).toBe(true);
    expect(registry.isClaimed(key2)).toBe(true);
    expect(registry.isClaimed(key3)).toBe(true);

    registry.release(key2);
    expect(registry.isClaimed(key1)).toBe(true);
    expect(registry.isClaimed(key2)).toBe(false);
    expect(registry.isClaimed(key3)).toBe(true);
  });
});

describe("checkWorktreeClaimed", () => {
  test("returns undefined when key is unclaimed", () => {
    const registry = new WorktreeOwnershipRegistry();
    const key = { project: "test-proj", branch: "main" };

    expect(checkWorktreeClaimed(registry, key)).toBeUndefined();
  });

  test("returns worktree_claimed error when key is claimed", () => {
    const registry = new WorktreeOwnershipRegistry();
    const key = { project: "test-proj", branch: "main" };
    registry.claim(key, { runId: "run-123", worktreePath: "/tmp/wt" });

    expect(checkWorktreeClaimed(registry, key)).toEqual({
      kind: "error",
      code: "worktree_claimed",
      message: "Worktree already claimed for project=test-proj, branch=main",
    });
  });
});
