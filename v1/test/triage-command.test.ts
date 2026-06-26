import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SuggestedMovesInput, TriageGhRunner, TriageIo } from "../src/commands/triage.ts";
import { getSuggestedMoves, triageCommand } from "../src/commands/triage.ts";

function captureIo(): { io: TriageIo; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

function setupWorktree(worktreePath: string, makeDirty = false): void {
  mkdirSync(worktreePath, { recursive: true });
  execSync("git init", { cwd: worktreePath });
  execSync("git config user.email test@example.com", { cwd: worktreePath });
  execSync("git config user.name Test", { cwd: worktreePath });
  execSync("git commit --allow-empty -m 'initial'", { cwd: worktreePath });
  if (makeDirty) {
    writeFileSync(join(worktreePath, "test.txt"), "dirty");
  }
}

let root: string;
let projectRoot: string;
let worktreeDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jarvis-triage-"));
  projectRoot = root;
  worktreeDir = join(projectRoot, ".worktree");
  mkdirSync(worktreeDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("triage command", () => {
  test("no worktrees prints no worktrees", () => {
    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
    });
    expect(code).toBe(0);
    expect(out()).toBe("no worktrees\n");
  });

  test("with worktrees prints header and summary lines", () => {
    // Create a worktree with git repo
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    mkdirSync(worktreePath, { recursive: true });

    // Initialize git repo in the worktree
    execSync("git init", { cwd: worktreePath });
    execSync("git config user.email test@example.com", { cwd: worktreePath });
    execSync("git config user.name Test", { cwd: worktreePath });

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("NAME");
    expect(output).toContain("DIRTY");
    expect(output).toContain(worktreeName);
  });

  test("unknown worktree with name returns error", () => {
    const { io, err } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName: "nonexistent",
    });
    expect(code).toBe(1);
    expect(err()).toContain("unknown worktree: nonexistent");
  });

  test("named form prints section headers", () => {
    // Create a worktree with git repo
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    mkdirSync(worktreePath, { recursive: true });

    // Initialize git repo in the worktree
    execSync("git init", { cwd: worktreePath });
    execSync("git config user.email test@example.com", { cwd: worktreePath });
    execSync("git config user.name Test", { cwd: worktreePath });

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("Identity");
    expect(output).toContain("Git");
    expect(output).toContain("Spec");
    expect(output).toContain("PR");
    expect(output).toContain("Session log");
    expect(output).toContain("Suggested next moves");
    expect(output).toContain("Inspect");
  });

  test("with .keep directory is filtered", () => {
    // Create a .keep directory
    mkdirSync(join(worktreeDir, ".keep"), { recursive: true });

    // Create a real worktree
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    mkdirSync(worktreePath, { recursive: true });

    // Initialize git repo in the worktree
    execSync("git init", { cwd: worktreePath });
    execSync("git config user.email test@example.com", { cwd: worktreePath });
    execSync("git config user.name Test", { cwd: worktreePath });

    const ghRunner: TriageGhRunner = {
      getPrState: () => null,
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    // .keep should not appear in output
    expect(output).not.toContain(".keep");
    // Verdict should be present
    expect(output).toContain("Session-end verdict");
  });

  test("drill-down with clean worktree and no marker", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    mkdirSync(worktreePath, { recursive: true });

    // Initialize git repo
    execSync("git init", { cwd: worktreePath });
    execSync("git config user.email test@example.com", { cwd: worktreePath });
    execSync("git config user.name Test", { cwd: worktreePath });
    execSync("git commit --allow-empty -m 'initial'", { cwd: worktreePath });

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("Identity");
    expect(output).toContain("Git");
    expect(output).toContain("Spec");
    expect(output).toContain("PR");
    expect(output).toContain("Session log");
    expect(output).toContain("Suggested next moves");
    expect(output).toContain("clean working tree");
    expect(output).toContain("pre-marker worktree");
  });

  test("drill-down with dirty worktree (untracked files)", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    mkdirSync(worktreePath, { recursive: true });

    // Initialize git repo
    execSync("git init", { cwd: worktreePath });
    execSync("git config user.email test@example.com", { cwd: worktreePath });
    execSync("git config user.name Test", { cwd: worktreePath });
    execSync("git commit --allow-empty -m 'initial'", { cwd: worktreePath });

    // Add untracked file
    writeFileSync(join(worktreePath, "test.txt"), "test content");

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("?? test.txt");
  });

  test("drill-down with unpushed commits", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    mkdirSync(worktreePath, { recursive: true });

    // Initialize git repo with a commit
    execSync("git init", { cwd: worktreePath });
    execSync("git config user.email test@example.com", { cwd: worktreePath });
    execSync("git config user.name Test", { cwd: worktreePath });
    writeFileSync(join(worktreePath, "file.txt"), "content");
    execSync("git add .", { cwd: worktreePath });
    execSync("git commit -m 'first'", { cwd: worktreePath });

    // Create a remote tracking branch
    execSync("git branch --set-upstream-to=origin/main 2>/dev/null || true", {
      cwd: worktreePath,
      stdio: "pipe",
    });

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("Last commit");
  });
});

describe("suggested moves rules", () => {
  test("rule 1: clean + unpushed > 0 + prState OPEN", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "clean",
      unpushed: 1,
      prState: "OPEN",
      specComplete: false,
      worktreePath: "/tmp/test",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("git -C /tmp/test push");
  });

  test("rule 1: clean + unpushed > 0 + prState DRAFT", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "clean",
      unpushed: 2,
      prState: "DRAFT",
      specComplete: false,
      worktreePath: "/tmp/test",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("git -C /tmp/test push");
  });

  test("rule 1: clean + unpushed > 0 + prState none", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "clean",
      unpushed: 1,
      prState: "none",
      specComplete: false,
      worktreePath: "/tmp/test",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("git -C /tmp/test push");
  });

  test("rule 2: clean + prState MERGED", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "clean",
      unpushed: 0,
      prState: "MERGED",
      specComplete: false,
      worktreePath: "/tmp/test",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("PR is merged");
    expect(lines[0]).toContain("jarvis1 cleanup");
  });

  test("rule 4: modified + prState MERGED", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "modified",
      unpushed: 0,
      prState: "MERGED",
      specComplete: false,
      worktreePath: "/tmp/test",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("PR is merged"))).toBe(true);
    expect(lines.some((l) => l.includes("orphaned"))).toBe(true);
  });

  test("rule 4: mixed + prState MERGED", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "mixed",
      unpushed: 0,
      prState: "MERGED",
      specComplete: false,
      worktreePath: "/tmp/test",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("orphaned"))).toBe(true);
  });

  test("rule 5: modified + specComplete true", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "modified",
      unpushed: 0,
      prState: "OPEN",
      specComplete: true,
      worktreePath: "/tmp/test",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("Spec checklists are complete"))).toBe(true);
    expect(lines.some((l) => l.includes("add -A"))).toBe(true);
  });

  test("rule 5: mixed + specComplete true", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "mixed",
      unpushed: 0,
      prState: "OPEN",
      specComplete: true,
      worktreePath: "/tmp/test",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("Spec checklists are complete"))).toBe(true);
  });

  test("rule 6: modified + specComplete false", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "modified",
      unpushed: 0,
      prState: "OPEN",
      specComplete: false,
      worktreePath: "/tmp/test",
      specPath: "/path/to/spec.md",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("Inspect"))).toBe(true);
    expect(lines.some((l) => l.includes("Resume"))).toBe(true);
  });

  test("rule 6: mixed + specComplete false", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "mixed",
      unpushed: 0,
      prState: "OPEN",
      specComplete: false,
      worktreePath: "/tmp/test",
      specPath: "/path/to/spec.md",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("reset --hard"))).toBe(true);
  });

  test("prState unknown falls through to fallback", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "modified",
      unpushed: 0,
      prState: "unknown",
      specComplete: false,
      worktreePath: "/tmp/test",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    // Should not suggest destructive commands
    expect(lines.some((l) => l.includes("--force"))).toBe(false);
    expect(lines.some((l) => l.includes("-D"))).toBe(false);
    expect(lines.some((l) => l.includes("--no-verify"))).toBe(false);
  });

  test("fallback suggestion includes diff and session log", () => {
    const input: SuggestedMovesInput = {
      dirtyKind: "clean",
      unpushed: 0,
      prState: "CLOSED",
      specComplete: false,
      worktreePath: "/tmp/test",
    };

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("Inspect");
  });

  test("no rule matches a destructive suggestion for unknown prState", () => {
    const scenarios: Array<[SuggestedMovesInput]> = [
      [
        {
          dirtyKind: "clean",
          unpushed: 5,
          prState: "unknown",
          specComplete: false,
          worktreePath: "/tmp/test",
        },
      ],
      [
        {
          dirtyKind: "modified",
          unpushed: 0,
          prState: "unknown",
          specComplete: false,
          worktreePath: "/tmp/test",
        },
      ],
      [
        {
          dirtyKind: "mixed",
          unpushed: 0,
          prState: "unknown",
          specComplete: true,
          worktreePath: "/tmp/test",
        },
      ],
    ];

    for (const [input] of scenarios) {
      const lines = getSuggestedMoves(input);
      for (const line of lines) {
        expect(line).not.toContain("--force");
        expect(line).not.toContain(" -D ");
        expect(line).not.toContain("--no-verify");
      }
    }
  });

  test("untracked-only with MERGED (no spec path) falls through to fallback", () => {
    // untracked-only + MERGED doesn't match rule 4 (which requires modified/mixed)
    // and rule 3 requires a spec path. So it falls through to fallback.
    const input: SuggestedMovesInput = {
      dirtyKind: "untracked-only",
      unpushed: 0,
      prState: "MERGED",
      specComplete: false,
      worktreePath: "/tmp/test",
      specPath: undefined,
    };

    const lines = getSuggestedMoves(input);
    // Should fall through to the fallback suggestion
    expect(lines.some((l) => l.includes("Inspect"))).toBe(true);
  });
});

describe("triage verdict", () => {
  test("all-landed verdict when all worktrees are merged, clean, and no unpushed", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const ghRunner: TriageGhRunner = {
      getPrState: (_branch) => ({
        state: "MERGED",
        isDraft: false,
      }),
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("all work landed");
  });

  test("outstanding verdict lists worktrees with draft PRs", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath, true);

    const ghRunner: TriageGhRunner = {
      getPrState: (_branch) => ({
        state: "OPEN",
        isDraft: true,
      }),
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(worktreeName);
    expect(output).toContain("open");
    expect(output).toContain("(draft)");
  });

  test("outstanding verdict lists worktrees with ready (non-draft) PRs", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const ghRunner: TriageGhRunner = {
      getPrState: (_branch) => ({
        state: "OPEN",
        isDraft: false,
      }),
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(worktreeName);
    expect(output).toContain("open");
    expect(output).not.toContain("(draft)");
  });

  test("merged dirty worktree is outstanding", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath, true);

    const ghRunner: TriageGhRunner = {
      getPrState: (_branch) => ({
        state: "MERGED",
        isDraft: false,
      }),
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(worktreeName);
    expect(output).toContain("merged");
  });

  test("plan worktree is classified as outstanding", () => {
    const worktreeName = "plan-new-feature";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const ghRunner: TriageGhRunner = {
      getPrState: (_branch) => ({
        state: "MERGED",
        isDraft: false,
      }),
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(worktreeName);
  });

  test("no PR state is classified as outstanding", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const ghRunner: TriageGhRunner = {
      getPrState: () => null,
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(worktreeName);
  });

  test("mixed verdict with both landed and outstanding worktrees", () => {
    // Create first worktree (landed)
    const landed = "branch-landed";
    const landedPath = join(worktreeDir, landed);
    setupWorktree(landedPath);

    // Create second worktree (outstanding - open PR)
    const outstanding = "branch-unpushed";
    const outstandingPath = join(worktreeDir, outstanding);
    setupWorktree(outstandingPath);

    const ghRunner: TriageGhRunner = {
      getPrState: (branch) => {
        if (branch === landed) {
          return { state: "MERGED", isDraft: false };
        }
        return { state: "OPEN", isDraft: true };
      },
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(outstanding);
    // Check that landed worktree is not in the outstanding section of the verdict
    const verdictSection = output.split("Session-end verdict:")[1];
    expect(verdictSection).not.toContain(landed);
  });

  test("gate state shows as blocked when merge is blocked", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const ghRunner: TriageGhRunner = {
      getPrState: (_branch) => ({
        state: "OPEN",
        isDraft: false,
      }),
      getMergeGateState: (_branch) => ({
        mergeStateStatus: "BLOCKED",
      }),
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(worktreeName);
    expect(output).toContain("[BLOCKED]");
  });

  test("gate state shows as clean when merge is permitted", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const ghRunner: TriageGhRunner = {
      getPrState: (_branch) => ({
        state: "OPEN",
        isDraft: false,
      }),
      getMergeGateState: (_branch) => ({
        mergeStateStatus: "CLEAN",
      }),
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(worktreeName);
    expect(output).toContain("[CLEAN]");
  });

  test("gate state shows as unavailable when getMergeGateState returns null", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const ghRunner: TriageGhRunner = {
      getPrState: (_branch) => ({
        state: "OPEN",
        isDraft: false,
      }),
      getMergeGateState: (_branch) => null,
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(worktreeName);
    expect(output).toContain("[unavailable]");
  });

  test("gate state is not shown for landed worktrees", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const ghRunner: TriageGhRunner = {
      getPrState: (_branch) => ({
        state: "MERGED",
        isDraft: false,
      }),
      getMergeGateState: (_branch) => ({
        mergeStateStatus: "CLEAN",
      }),
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("all work landed");
    // Gate state should not appear in output since the worktree is landed
    expect(output).not.toContain("[CLEAN]");
  });

  test("gate state query failure does not abort sweep", () => {
    // Create first worktree (outstanding, gate state query fails)
    const outstanding1 = "branch-1";
    const outstanding1Path = join(worktreeDir, outstanding1);
    setupWorktree(outstanding1Path);

    // Create second worktree (outstanding, gate state query succeeds)
    const outstanding2 = "branch-2";
    const outstanding2Path = join(worktreeDir, outstanding2);
    setupWorktree(outstanding2Path);

    const ghRunner: TriageGhRunner = {
      getPrState: (_branch) => ({
        state: "OPEN",
        isDraft: false,
      }),
      getMergeGateState: (branch) => {
        if (branch === outstanding1) {
          return null; // Query fails for first worktree
        }
        return { mergeStateStatus: "CLEAN" };
      },
    };

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    // Both worktrees should appear in the verdict despite gate state query failure on one
    expect(output).toContain(outstanding1);
    expect(output).toContain(outstanding2);
    // First should show unavailable, second should show CLEAN
    expect(output).toContain("[unavailable]");
    expect(output).toContain("[CLEAN]");
  });
});

describe("triage --mark-ready", () => {
  test("--mark-ready without worktree name should not pass to command layer (CLI rejects)", () => {
    // This test verifies that the CLI layer rejects --mark-ready without a worktree name
    // and never calls the triage command. The command layer doesn't need to handle this,
    // but we verify the read-only listing still works.
    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      // No worktreeName provided - the CLI would have already rejected --mark-ready in this case
    });
    // Should return listing (not an error)
    expect(code).toBe(0);
    expect(out()).toContain("no worktrees");
  });

  test("--mark-ready on unknown worktree returns error", () => {
    const { io, err } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName: "nonexistent",
      markReady: true,
    });
    expect(code).toBe(1);
    expect(err()).toContain("unknown worktree");
  });

  test("--mark-ready with missing .active-spec-path returns error", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const { io, err } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
    });

    expect(code).toBe(1);
    expect(err()).toContain(".active-spec-path marker not found");
  });

  test("--mark-ready when no PR exists returns error", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    // Write a minimal spec file
    const specDir = join(projectRoot, "v1", "spec");
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "test-spec.md");
    writeFileSync(specPath, "# Test\n\n- [x] item 1");
    writeFileSync(join(worktreePath, ".active-spec-path"), specPath);

    const { io, err } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: {
        getPrState: () => null,
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("no PR found");
  });

  test("--mark-ready when PR is not DRAFT returns error", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    // Get the actual branch name (which is "main" from setupWorktree)
    const branch = "main";

    // Write a minimal spec file
    const specDir = join(projectRoot, "v1", "spec");
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "test-spec.md");
    writeFileSync(specPath, "# Test\n\n- [x] item 1");
    writeFileSync(join(worktreePath, ".active-spec-path"), specPath);

    const { io, err } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: {
        getPrState: (b) => {
          if (b === branch) {
            return {
              state: "OPEN",
              isDraft: false,
            };
          }
          return null;
        },
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("PR is not in DRAFT state");
  });

  test("--mark-ready with incomplete spec returns error", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    // Write an index spec with unchecked subspecs
    const specDir = join(projectRoot, "v1", "spec");
    mkdirSync(specDir, { recursive: true });
    const indexPath = join(specDir, "spec-1", "index.md");
    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, "# Test\n\n- [ ] [subspec 1](./01-test.md)");
    writeFileSync(join(dirname(indexPath), "01-test.md"), "# Test\n\n- [ ] item");

    writeFileSync(join(worktreePath, ".active-spec-path"), indexPath);

    const { io, err } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: {
        getPrState: () => ({
          state: "OPEN",
          isDraft: true,
        }),
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("spec is not complete");
  });

  test("--mark-ready with single-file spec that is complete succeeds", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    // Write a single-file spec (no index, no linked subspecs)
    const specDir = join(projectRoot, "v1", "spec");
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "test-spec.md");
    writeFileSync(specPath, "# Test\n\n- [x] item 1\n- [x] item 2");
    writeFileSync(join(worktreePath, ".active-spec-path"), specPath);

    let gateRan = false;
    let prReadyRan = false;

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: {
        getPrState: () => ({
          state: "OPEN",
          isDraft: true,
        }),
      },
      runGate: () => {
        gateRan = true;
      },
      prReady: () => {
        prReadyRan = true;
      },
    });

    expect(code).toBe(0);
    expect(out()).toContain("promoted to ready");
    expect(gateRan).toBe(true);
    expect(prReadyRan).toBe(true);
  });

  test("--mark-ready with locked worktree returns error", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    // Write a minimal spec file
    const specDir = join(projectRoot, "v1", "spec");
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "test-spec.md");
    writeFileSync(specPath, "# Test\n\n- [x] item 1");
    writeFileSync(join(worktreePath, ".active-spec-path"), specPath);

    // Create a lock file with a live PID (lock path is worktreePath/.jarvis.lock)
    const lockPath = join(worktreePath, ".jarvis.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        host: "test",
      }),
    );

    const { io, err } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: {
        getPrState: () => ({
          state: "OPEN",
          isDraft: true,
        }),
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("worktree is locked by live run");
  });

  test("--mark-ready gate failure returns error with message", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    // Write a minimal spec file
    const specDir = join(projectRoot, "v1", "spec");
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "test-spec.md");
    writeFileSync(specPath, "# Test\n\n- [x] item 1");
    writeFileSync(join(worktreePath, ".active-spec-path"), specPath);

    const { io, err } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: {
        getPrState: () => ({
          state: "OPEN",
          isDraft: true,
        }),
      },
      runGate: () => {
        throw new Error("gate command failed");
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("ready gate failed");
    expect(err()).toContain("gate command failed");
  });

  test("--mark-ready gh pr ready failure returns error", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    // Write a minimal spec file
    const specDir = join(projectRoot, "v1", "spec");
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "test-spec.md");
    writeFileSync(specPath, "# Test\n\n- [x] item 1");
    writeFileSync(join(worktreePath, ".active-spec-path"), specPath);

    const { io, err } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: {
        getPrState: () => ({
          state: "OPEN",
          isDraft: true,
        }),
      },
      runGate: () => {
        // Gate succeeds
      },
      prReady: () => {
        throw new Error("gh pr ready failed");
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("failed to mark PR ready");
    expect(err()).toContain("gh pr ready failed");
  });

  test("--mark-ready calls both runGate and prReady seams", () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    // Write a minimal spec file
    const specDir = join(projectRoot, "v1", "spec");
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "test-spec.md");
    writeFileSync(specPath, "# Test\n\n- [x] item 1");
    writeFileSync(join(worktreePath, ".active-spec-path"), specPath);

    let gateSeamCalled = false;
    let prReadySeamCalled = false;

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: {
        getPrState: () => ({
          state: "OPEN",
          isDraft: true,
        }),
      },
      runGate: () => {
        gateSeamCalled = true;
      },
      prReady: () => {
        prReadySeamCalled = true;
      },
    });

    expect(code).toBe(0);
    expect(out()).toContain("promoted to ready");
    expect(gateSeamCalled).toBe(true);
    expect(prReadySeamCalled).toBe(true);
  });
});
