import { describe, expect, test } from "bun:test";
import type { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adaptCheckRunsToCiStates,
  classifyCiChecks,
  collectFailingCiContext,
  fetchCommitCheckRunsForSha,
} from "../src/ci-checks.ts";

describe("ci-checks", () => {
  test("adaptCheckRunsToCiStates maps GitHub check-run status and conclusion", () => {
    expect(
      adaptCheckRunsToCiStates([
        { name: "ok", status: "completed", conclusion: "success" },
        { name: "skip", status: "completed", conclusion: "skipped" },
        { name: "wait", status: "in_progress", conclusion: null },
        { name: "open", status: "completed", conclusion: null },
        { name: "bad", status: "completed", conclusion: "failure" },
      ]),
    ).toEqual([
      { name: "ok", status: "success" },
      { name: "skip", status: "skipped" },
      { name: "wait", status: "in_progress" },
      { name: "open", status: "pending" },
      { name: "bad", status: "failure" },
    ]);
  });

  test("fetchCommitCheckRunsForSha returns ok:false on gh API error", () => {
    const worktree = mkdtempSync(join(tmpdir(), "jarvis-ci-checks-"));
    try {
      writeFileSync(join(worktree, ".git"), "gitdir: nowhere");
      const result = fetchCommitCheckRunsForSha(worktree, "abc123", {
        execFileSync: ((_file, _args, _opts) => "https://github.com/org/repo.git") as typeof execFileSync,
        execSync: (() => {
          throw new Error("api down");
        }) as typeof execSync,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("gh api error");
      }
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  test("fetch error is not consumed as classifiable empty input", () => {
    const worktree = mkdtempSync(join(tmpdir(), "jarvis-ci-checks-"));
    try {
      const result = fetchCommitCheckRunsForSha(worktree, "abc123", {
        execFileSync: (() => {
          throw new Error("no origin");
        }) as typeof execFileSync,
      });
      expect(result.ok).toBe(false);
      expect(classifyCiChecks(null).classification).toBe("red");
      expect(classifyCiChecks(null).failingCheck).toBe("no checks found");
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  test("fetchCommitCheckRunsForSha returns ok:false on unresolvable origin", () => {
    const worktree = mkdtempSync(join(tmpdir(), "jarvis-ci-checks-"));
    try {
      const result = fetchCommitCheckRunsForSha(worktree, "abc123", {
        execFileSync: (() => {
          throw new Error("no origin");
        }) as typeof execFileSync,
      });
      expect(result).toEqual({ ok: false, reason: "unresolvable origin remote" });
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  test("fetchCommitCheckRunsForSha returns ok:false on JSON parse failure", () => {
    const worktree = mkdtempSync(join(tmpdir(), "jarvis-ci-checks-"));
    try {
      const result = fetchCommitCheckRunsForSha(worktree, "abc123", {
        execFileSync: ((_file, _args, _opts) => "https://github.com/org/repo.git") as typeof execFileSync,
        execSync: (() => "not-json") as unknown as typeof execSync,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("JSON parse failure");
      }
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  test("collectFailingCiContext returns every red check with summary then text excerpt", () => {
    const failing = collectFailingCiContext({
      ok: true,
      checkRuns: [
        {
          name: "lint",
          status: "completed",
          conclusion: "success",
          output: { summary: "ok" },
        },
        {
          name: "test",
          status: "completed",
          conclusion: "failure",
          output: { summary: "tests failed", text: "AssertionError: expected true" },
        },
        {
          name: "build",
          status: "completed",
          conclusion: "failure",
          output: { text: "compile error" },
        },
      ],
    });
    expect(failing).toEqual([
      { name: "test", excerpt: "tests failed\nAssertionError: expected true" },
      { name: "build", excerpt: "compile error" },
    ]);
  });

  test("collectFailingCiContext uses no excerpt placeholder when output is absent", () => {
    const failing = collectFailingCiContext({
      ok: true,
      checkRuns: [{ name: "ci", status: "completed", conclusion: "failure" }],
    });
    expect(failing).toEqual([{ name: "ci", excerpt: "(no excerpt available)" }]);
  });

  test("collectFailingCiContext tail-preserves combined excerpt at 2048 bytes", () => {
    const tailMarker = "TAIL-MARKER-END";
    const text = `${"x".repeat(2100)}${tailMarker}`;
    const failing = collectFailingCiContext({
      ok: true,
      checkRuns: [
        {
          name: "ci",
          status: "completed",
          conclusion: "failure",
          output: { summary: "head", text },
        },
      ],
    });
    expect(failing[0]?.excerpt).toContain(tailMarker);
    expect(new TextEncoder().encode(failing[0]?.excerpt ?? "").length).toBeLessThanOrEqual(2048);
    expect(failing[0]?.excerpt.startsWith("head\n")).toBe(false);
  });
});
