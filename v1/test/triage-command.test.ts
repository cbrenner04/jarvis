import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SuggestedMovesInput, TriageIo } from "../src/commands/triage.ts";
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

    const { io, out } = captureIo();
    const code = triageCommand({
      projectRoot,
      io,
    });

    expect(code).toBe(0);
    const output = out();
    // Should have only one worktree line (besides header)
    const lines = output.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(2); // Header + one worktree
    expect(output).not.toContain(".keep");
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
    expect(lines.some((l) => l.includes("Spec checklists are complete"))).toBe(
      true,
    );
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
    expect(lines.some((l) => l.includes("Spec checklists are complete"))).toBe(
      true,
    );
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
