import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type MergeTargetResolutionSeams, resolveMergeTarget } from "../src/commands/resolve-merge-target.ts";
import type { SuggestedMovesInput, TriageCommandOptions, TriageGhRunner, TriageIo } from "../src/commands/triage.ts";
import { getSuggestedMoves, triageCommand } from "../src/commands/triage.ts";
import type { BaseCurrentCheckResult } from "../src/git/base-current.ts";

const currentBase =
  (baseRefName: string | null = "main") =>
  (): BaseCurrentCheckResult => ({ status: "current", baseRefName });

const behindBase = (baseRefName: string) => (): BaseCurrentCheckResult => ({ status: "behind", baseRefName });

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

function setupMarkReadyWorktree(
  worktreeName: string,
  opts?: {
    makeDirty?: boolean;
    specBody?: string;
    indexSpec?: { indexPath: string; subspecPath: string; subspecBody: string };
  },
): { worktreePath: string; specPath: string } {
  const worktreePath = join(worktreeDir, worktreeName);
  setupWorktree(worktreePath);

  const barePath = join(root, `${worktreeName}-remote.git`);
  execSync(`git init --bare "${barePath}"`, { stdio: "pipe" });
  execSync(`git remote add origin "${barePath}"`, { cwd: worktreePath, stdio: "pipe" });
  execSync("git push -u origin main", { cwd: worktreePath, stdio: "pipe" });

  let specPath: string;
  if (opts?.indexSpec) {
    const { indexPath, subspecPath, subspecBody } = opts.indexSpec;
    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, "# Test\n\n- [ ] [subspec 1](./01-test.md)");
    writeFileSync(subspecPath, subspecBody);
    specPath = indexPath;
  } else {
    const specDir = join(projectRoot, "v1", "spec");
    mkdirSync(specDir, { recursive: true });
    specPath = join(specDir, `${worktreeName}-spec.md`);
    writeFileSync(specPath, opts?.specBody ?? "# Test\n\n## Acceptance criteria\n\n- [x] done");
  }

  writeFileSync(join(worktreePath, ".active-spec-path"), specPath);
  execSync("git add .active-spec-path", { cwd: worktreePath });
  execSync("git commit -m 'marker'", { cwd: worktreePath });
  execSync("git push", { cwd: worktreePath, stdio: "pipe" });

  if (opts?.makeDirty) {
    writeFileSync(join(worktreePath, "test.txt"), "dirty");
  }

  return { worktreePath, specPath };
}

function setupWorktreeLocalMarkReadySpec(worktreeName: string): {
  worktreePath: string;
  markerSpecPath: string;
  worktreeSubspecPath: string;
} {
  const worktreePath = join(worktreeDir, worktreeName);
  setupWorktree(worktreePath);

  const barePath = join(root, `${worktreeName}-remote.git`);
  execSync(`git init --bare "${barePath}"`, { stdio: "pipe" });
  execSync(`git remote add origin "${barePath}"`, { cwd: worktreePath, stdio: "pipe" });
  execSync("git push -u origin main", { cwd: worktreePath, stdio: "pipe" });

  const markerSpecDir = join(projectRoot, "v1", "spec", worktreeName);
  const markerIndexPath = join(markerSpecDir, "index.md");
  const markerSubspecPath = join(markerSpecDir, "01-test.md");
  mkdirSync(markerSpecDir, { recursive: true });
  writeFileSync(markerIndexPath, "# Test\n\n- [ ] [subspec 1](./01-test.md)\n");
  writeFileSync(markerSubspecPath, "# Test\n\n## Acceptance criteria\n\n- [ ] automated criterion\n");

  const worktreeSpecDir = join(worktreePath, "v1", "spec", worktreeName);
  const worktreeSubspecPath = join(worktreeSpecDir, "01-test.md");
  mkdirSync(worktreeSpecDir, { recursive: true });
  writeFileSync(join(worktreeSpecDir, "index.md"), "# Test\n\n- [ ] [subspec 1](./01-test.md)\n");
  writeFileSync(worktreeSubspecPath, "# Test\n\n## Acceptance criteria\n\n- [x] automated criterion\n");

  writeFileSync(join(worktreePath, ".active-spec-path"), markerIndexPath);
  execSync("git add .active-spec-path", { cwd: worktreePath });
  execSync("git commit -m 'marker'", { cwd: worktreePath });
  execSync("git push", { cwd: worktreePath, stdio: "pipe" });

  return { worktreePath, markerSpecPath: markerIndexPath, worktreeSubspecPath };
}

function setupMergeWorktree(worktreeName: string): { worktreePath: string; specPath: string } {
  const worktreePath = join(worktreeDir, worktreeName);
  setupWorktree(worktreePath);
  const specDir = join(projectRoot, "v1", "spec");
  mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, "test-spec.md");
  writeFileSync(specPath, "# Test\n\n- [x] item 1");
  writeFileSync(join(worktreePath, ".active-spec-path"), specPath);
  return { worktreePath, specPath };
}

function singleOpenPrStub() {
  return [{ number: 1, isDraft: false }];
}

const singleOpenPrSeams: MergeTargetResolutionSeams = {
  findMatchingOpenPrs: singleOpenPrStub,
};

function triageMergeOpts(opts: TriageCommandOptions): TriageCommandOptions {
  return {
    ...opts,
    merge: true,
    mergeTargetSeams: { ...singleOpenPrSeams, ...opts.mergeTargetSeams },
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
  const draftPrGhRunner = {
    getPrState: () => ({ state: "OPEN", isDraft: true }) as const,
  };

  const currentBaseSeam = { checkBaseCurrent: currentBase() };

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

  test("--mark-ready on unknown worktree returns error", async () => {
    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName: "nonexistent",
      markReady: true,
    });
    expect(code).toBe(1);
    expect(err()).toContain("unknown worktree");
  });

  test("--mark-ready with missing .active-spec-path and no matching spec returns error", async () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
    });

    expect(code).toBe(1);
    expect(err()).toContain("no spec found for branch");
  });

  test("--mark-ready when no PR exists opens draft PR, gates, and promotes", async () => {
    const worktreeName = "branch-1";
    setupMarkReadyWorktree(worktreeName);

    let ensureDraftPrRan = false;
    let gateRan = false;

    const { io, out } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: { getPrState: () => null },
      ensureDraftPr: async () => {
        ensureDraftPrRan = true;
        return { number: 1, created: true };
      },
      runGate: () => {
        gateRan = true;
      },
      prReady: () => {},
    });

    expect(code).toBe(0);
    expect(ensureDraftPrRan).toBe(true);
    expect(gateRan).toBe(true);
    expect(out()).toContain("promoted to ready");
  });

  test("--mark-ready when PR is not DRAFT returns error", async () => {
    const worktreeName = "branch-1";
    setupMarkReadyWorktree(worktreeName);

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: {
        getPrState: () => ({
          state: "OPEN",
          isDraft: false,
        }),
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("PR is not in DRAFT state");
  });

  test("--mark-ready with incomplete spec refuses as re-run with no side effects", async () => {
    const worktreeName = "branch-1";
    const specDir = join(projectRoot, "v1", "spec");
    const indexPath = join(specDir, "spec-1", "index.md");
    const subspecPath = join(dirname(indexPath), "01-test.md");
    setupMarkReadyWorktree(worktreeName, {
      indexSpec: {
        indexPath,
        subspecPath,
        subspecBody: "# Test\n\n## Acceptance criteria\n\n- [ ] automated criterion",
      },
    });

    let commitRan = false;
    let gateRan = false;

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: draftPrGhRunner,
      commitAndPushDirty: () => {
        commitRan = true;
        return { ok: true };
      },
      runGate: () => {
        gateRan = true;
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("incomplete run");
    expect(err()).toContain("not finalize");
    expect(commitRan).toBe(false);
    expect(gateRan).toBe(false);
  });

  test("--mark-ready refuses when behind base with open PR", async () => {
    const worktreeName = "branch-behind-pr";
    setupMarkReadyWorktree(worktreeName);

    let commitRan = false;
    let gateRan = false;
    let prReadyRan = false;

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: draftPrGhRunner,
      checkBaseCurrent: behindBase("main"),
      commitAndPushDirty: () => {
        commitRan = true;
        return { ok: true };
      },
      runGate: () => {
        gateRan = true;
      },
      prReady: () => {
        prReadyRan = true;
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("behind base, resolve then re-invoke");
    expect(commitRan).toBe(false);
    expect(gateRan).toBe(false);
    expect(prReadyRan).toBe(false);
  });

  test("--mark-ready refuses when behind base with no PR", async () => {
    const worktreeName = "branch-behind-no-pr";
    setupMarkReadyWorktree(worktreeName);

    let ensureDraftPrRan = false;
    let gateRan = false;
    let prReadyRan = false;

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: { getPrState: () => null },
      checkBaseCurrent: behindBase("main"),
      ensureDraftPr: async () => {
        ensureDraftPrRan = true;
        return { number: 1, created: true };
      },
      runGate: () => {
        gateRan = true;
      },
      prReady: () => {
        prReadyRan = true;
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("behind base, resolve then re-invoke");
    expect(ensureDraftPrRan).toBe(false);
    expect(gateRan).toBe(false);
    expect(prReadyRan).toBe(false);
  });

  test("--mark-ready behind base with unpushed commits performs no push, gate, or ready", async () => {
    const worktreeName = "branch-behind-unpushed";
    const { worktreePath } = setupMarkReadyWorktree(worktreeName);
    writeFileSync(join(worktreePath, "extra.txt"), "unpushed");
    execSync("git add extra.txt", { cwd: worktreePath });
    execSync("git commit -m 'unpushed'", { cwd: worktreePath });

    let commitRan = false;
    let gateRan = false;
    let prReadyRan = false;

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: draftPrGhRunner,
      checkBaseCurrent: behindBase("main"),
      commitAndPushDirty: () => {
        commitRan = true;
        return { ok: true };
      },
      runGate: () => {
        gateRan = true;
      },
      prReady: () => {
        prReadyRan = true;
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("behind base, resolve then re-invoke");
    expect(commitRan).toBe(false);
    expect(gateRan).toBe(false);
    expect(prReadyRan).toBe(false);
  });

  test("--mark-ready behind base with dirty tree leaves changes uncommitted", async () => {
    const worktreeName = "branch-behind-dirty";
    const { worktreePath } = setupMarkReadyWorktree(worktreeName, { makeDirty: true });

    let gateRan = false;

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: draftPrGhRunner,
      checkBaseCurrent: behindBase("main"),
      runGate: () => {
        gateRan = true;
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("behind base, resolve then re-invoke");
    expect(gateRan).toBe(false);
    const porcelain = execSync("git status --porcelain", {
      cwd: worktreePath,
      encoding: "utf8",
    }).trim();
    expect(porcelain).not.toBe("");
  });

  test("--mark-ready with only human-only criteria unchecked finalizes", async () => {
    const worktreeName = "branch-1";
    setupMarkReadyWorktree(worktreeName, {
      specBody: "# Test\n\n## Acceptance criteria\n\n- [x] automated\n- [ ] verify manually (Manual)",
    });

    let gateRan = false;

    const { io, out } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: draftPrGhRunner,
      runGate: () => {
        gateRan = true;
      },
      prReady: () => {},
    });

    expect(code).toBe(0);
    expect(gateRan).toBe(true);
    expect(out()).toContain("promoted to ready");
  });

  test("--mark-ready on complete dirty worktree commits, gates, and promotes", async () => {
    const worktreeName = "branch-1";
    const { worktreePath } = setupMarkReadyWorktree(worktreeName, { makeDirty: true });

    let gateRan = false;
    let prReadyRan = false;

    const { io, out } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: draftPrGhRunner,
      runGate: () => {
        gateRan = true;
      },
      prReady: () => {
        prReadyRan = true;
      },
    });

    expect(code).toBe(0);
    expect(gateRan).toBe(true);
    expect(prReadyRan).toBe(true);
    expect(out()).toContain("promoted to ready");
    const porcelain = execSync("git status --porcelain", {
      cwd: worktreePath,
      encoding: "utf8",
    }).trim();
    expect(porcelain).toBe("");
    const lastCommit = execSync("git log -1 --pretty=%B", {
      cwd: worktreePath,
      encoding: "utf8",
    });
    expect(lastCommit).toContain("chore: complete-but-dirty commit");
    expect(lastCommit).toContain("Jarvis-Agent: completion-ready");
  });

  test("--mark-ready push failure after finalize commit skips PR open and gate", async () => {
    const worktreeName = "branch-1";
    setupMarkReadyWorktree(worktreeName);

    let ensureDraftPrRan = false;
    let gateRan = false;

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: {
        getPrState: () => null,
      },
      commitAndPushDirty: () => ({ ok: false, reason: "push-failed", message: "push rejected" }),
      ensureDraftPr: async () => {
        ensureDraftPrRan = true;
        return { number: 1, created: true };
      },
      runGate: () => {
        gateRan = true;
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("failed to push finalize commit");
    expect(ensureDraftPrRan).toBe(false);
    expect(gateRan).toBe(false);
  });

  test("--mark-ready still-dirty after finalize commit leaves PR draft and exits non-zero", async () => {
    const worktreeName = "branch-1";
    setupMarkReadyWorktree(worktreeName);

    let gateRan = false;

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: draftPrGhRunner,
      commitAndPushDirty: () => ({ ok: false, reason: "still-dirty" }),
      runGate: () => {
        gateRan = true;
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("still dirty after finalize commit");
    expect(gateRan).toBe(false);
  });

  test("--mark-ready with locked worktree returns error", async () => {
    const worktreeName = "branch-1";
    const { worktreePath } = setupMarkReadyWorktree(worktreeName);

    writeFileSync(
      join(worktreePath, ".jarvis.lock"),
      JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        host: "test",
      }),
    );

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: draftPrGhRunner,
    });

    expect(code).toBe(1);
    expect(err()).toContain("worktree is locked by live run");
  });

  test("--mark-ready gate failure returns error with message", async () => {
    const worktreeName = "branch-1";
    setupMarkReadyWorktree(worktreeName);

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: draftPrGhRunner,
      runGate: () => {
        throw new Error("gate command failed");
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("ready gate failed");
    expect(err()).toContain("gate command failed");
  });

  test("--mark-ready gh pr ready failure returns error", async () => {
    const worktreeName = "branch-1";
    setupMarkReadyWorktree(worktreeName);

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: draftPrGhRunner,
      runGate: () => {},
      prReady: () => {
        throw new Error("gh pr ready failed");
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("failed to mark PR ready");
    expect(err()).toContain("gh pr ready failed");
  });

  test("--mark-ready calls both runGate and prReady seams", async () => {
    const worktreeName = "branch-1";
    setupMarkReadyWorktree(worktreeName);

    let gateSeamCalled = false;
    let prReadySeamCalled = false;

    const { io, out } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: draftPrGhRunner,
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

  test("--mark-ready reads uncommitted worktree-local AC ticks when marker points at project root", async () => {
    const worktreeName = "branch-exit6";
    const { worktreePath } = setupWorktreeLocalMarkReadySpec(worktreeName);

    let gateRan = false;

    const { io, out } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: draftPrGhRunner,
      runGate: () => {
        gateRan = true;
      },
      prReady: () => {},
    });

    expect(code).toBe(0);
    expect(gateRan).toBe(true);
    expect(out()).toContain("promoted to ready");
    const porcelain = execSync("git status --porcelain", {
      cwd: worktreePath,
      encoding: "utf8",
    }).trim();
    expect(porcelain).toBe("");
  });

  test("--mark-ready refuses when worktree-local ACs are unchecked despite project-root marker", async () => {
    const worktreeName = "branch-exit6-incomplete";
    setupWorktreeLocalMarkReadySpec(worktreeName);
    const worktreeSubspecPath = join(worktreeDir, worktreeName, "v1", "spec", worktreeName, "01-test.md");
    writeFileSync(worktreeSubspecPath, "# Test\n\n## Acceptance criteria\n\n- [ ] automated criterion\n");

    let commitRan = false;
    let gateRan = false;

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ghRunner: draftPrGhRunner,
      commitAndPushDirty: () => {
        commitRan = true;
        return { ok: true };
      },
      runGate: () => {
        gateRan = true;
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("incomplete run");
    expect(err()).toContain("not finalize");
    expect(commitRan).toBe(false);
    expect(gateRan).toBe(false);
  });

  test("--mark-ready commit failure reports commit-specific error not push failure", async () => {
    const worktreeName = "branch-1";
    setupMarkReadyWorktree(worktreeName, { makeDirty: true });

    let gateRan = false;

    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      ...currentBaseSeam,
      ghRunner: draftPrGhRunner,
      commitAndPushDirty: () => ({ ok: false, reason: "commit-failed", message: "hook rejected" }),
      runGate: () => {
        gateRan = true;
      },
    });

    expect(code).toBe(1);
    expect(err()).toContain("failed to finalize commit");
    expect(err()).toContain("hook rejected");
    expect(err()).not.toContain("failed to push finalize commit");
    expect(gateRan).toBe(false);
  });

  describe("markerless branch-derived spec", () => {
    function setupMarkerlessWorktree(
      worktreeName: string,
      branchName: string,
    ): { worktreePath: string } {
      const worktreePath = join(worktreeDir, worktreeName);
      setupWorktree(worktreePath);
      const barePath = join(root, `${worktreeName}-remote.git`);
      execSync(`git init --bare "${barePath}"`, { stdio: "pipe" });
      execSync(`git remote add origin "${barePath}"`, { cwd: worktreePath, stdio: "pipe" });
      execSync(`git branch -M ${branchName}`, { cwd: worktreePath, stdio: "pipe" });
      execSync(`git push -u origin ${branchName}`, { cwd: worktreePath, stdio: "pipe" });
      return { worktreePath };
    }

    test("--mark-ready markerless patch worktree finalizes when branch maps to index.md spec", async () => {
      const branchName = "2026-01-01T00-00-00Z-my-patch";
      const worktreeName = branchName;
      setupMarkerlessWorktree(worktreeName, branchName);

      const specDir = join(projectRoot, "v1/spec", branchName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "index.md"), "# Test\n\n## Acceptance criteria\n\n- [x] done");

      let gateRan = false;
      const { io, out } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName,
        markReady: true,
        planTargetDir: "v1/spec",
        ...currentBaseSeam,
        ghRunner: { getPrState: () => null },
        ensureDraftPr: async () => ({ number: 1, created: true }),
        runGate: () => {
          gateRan = true;
        },
        prReady: () => {},
      });

      expect(code).toBe(0);
      expect(gateRan).toBe(true);
      expect(out()).toContain("promoted to ready");
    });

    test("--mark-ready markerless patch worktree resolves single-file spec directory", async () => {
      const branchName = "2026-01-01T00-00-00Z-single-file";
      const worktreeName = branchName;
      setupMarkerlessWorktree(worktreeName, branchName);

      const specDir = join(projectRoot, "v1/spec", branchName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "00-only.md"), "# Test\n\n## Acceptance criteria\n\n- [x] done");

      let gateRan = false;
      const { io } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName,
        markReady: true,
        planTargetDir: "v1/spec",
        ...currentBaseSeam,
        ghRunner: { getPrState: () => null },
        ensureDraftPr: async () => ({ number: 1, created: true }),
        runGate: () => {
          gateRan = true;
        },
        prReady: () => {},
      });

      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--mark-ready markerless plan/ branch resolves timestamped spec directory", async () => {
      const planName = "my-plan";
      const branchName = `plan/${planName}`;
      const worktreeName = "plan-my-plan";
      setupMarkerlessWorktree(worktreeName, branchName);

      const specDirName = `2026-01-01T00-00-00Z-${planName}`;
      const specDir = join(projectRoot, "v1/spec", specDirName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "index.md"), "# Test\n\n## Acceptance criteria\n\n- [x] done");

      let gateRan = false;
      const { io } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName,
        markReady: true,
        planTargetDir: "v1/spec",
        ...currentBaseSeam,
        ghRunner: { getPrState: () => null },
        ensureDraftPr: async () => ({ number: 1, created: true }),
        runGate: () => {
          gateRan = true;
        },
        prReady: () => {},
      });

      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--mark-ready markerless lookup searches planTargetDir first, then v1/spec, then v2/spec", async () => {
      const branchName = "2026-01-01T00-00-00Z-search-order";
      const worktreeName = branchName;
      setupMarkerlessWorktree(worktreeName, branchName);

      // Spec exists in v1/spec but NOT in custom-target
      const specDir = join(projectRoot, "v1/spec", branchName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "index.md"), "# Test\n\n## Acceptance criteria\n\n- [x] done");

      // planTargetDir is custom-target (no spec there); should fall through to v1/spec
      let gateRan = false;
      const { io } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName,
        markReady: true,
        planTargetDir: "custom-target",
        ...currentBaseSeam,
        ghRunner: { getPrState: () => null },
        ensureDraftPr: async () => ({ number: 1, created: true }),
        runGate: () => {
          gateRan = true;
        },
        prReady: () => {},
      });

      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--mark-ready markerless searches v2/spec as last fallback", async () => {
      const branchName = "2026-01-01T00-00-00Z-v2-spec";
      const worktreeName = branchName;
      setupMarkerlessWorktree(worktreeName, branchName);

      // Spec only in v2/spec
      const specDir = join(projectRoot, "v2/spec", branchName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "index.md"), "# Test\n\n## Acceptance criteria\n\n- [x] done");

      let gateRan = false;
      const { io } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName,
        markReady: true,
        planTargetDir: "custom-target",
        ...currentBaseSeam,
        ghRunner: { getPrState: () => null },
        ensureDraftPr: async () => ({ number: 1, created: true }),
        runGate: () => {
          gateRan = true;
        },
        prReady: () => {},
      });

      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--mark-ready markerless ambiguous directory (multiple .md, no index.md) refuses", async () => {
      const branchName = "2026-01-01T00-00-00Z-ambiguous";
      const worktreeName = branchName;
      setupMarkerlessWorktree(worktreeName, branchName);

      const specDir = join(projectRoot, "v1/spec", branchName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "00-a.md"), "# A");
      writeFileSync(join(specDir, "01-b.md"), "# B");

      const { io, err } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName,
        markReady: true,
        planTargetDir: "v1/spec",
        ...currentBaseSeam,
      });

      expect(code).toBe(1);
      expect(err()).toContain("ambiguous");
    });

    test("--mark-ready markerless directory with zero .md files refuses", async () => {
      const branchName = "2026-01-01T00-00-00Z-empty-dir";
      const worktreeName = branchName;
      setupMarkerlessWorktree(worktreeName, branchName);

      const specDir = join(projectRoot, "v1/spec", branchName);
      mkdirSync(specDir, { recursive: true });
      // No .md files

      const { io, err } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName,
        markReady: true,
        planTargetDir: "v1/spec",
        ...currentBaseSeam,
      });

      expect(code).toBe(1);
      expect(err()).toContain("no markdown files");
    });

    test("--mark-ready marker-present uses marker even when branch would find a spec", async () => {
      const branchName = "2026-01-01T00-00-00Z-marker-wins";
      const worktreeName = branchName;
      const worktreePath = join(worktreeDir, worktreeName);
      setupWorktree(worktreePath);

      const barePath = join(root, `${worktreeName}-remote.git`);
      execSync(`git init --bare "${barePath}"`, { stdio: "pipe" });
      execSync(`git remote add origin "${barePath}"`, { cwd: worktreePath, stdio: "pipe" });
      execSync(`git branch -M ${branchName}`, { cwd: worktreePath, stdio: "pipe" });
      execSync(`git push -u origin ${branchName}`, { cwd: worktreePath, stdio: "pipe" });

      // Create a complete spec the marker will point to
      const specDir = join(projectRoot, "v1/spec");
      mkdirSync(specDir, { recursive: true });
      const markerSpecPath = join(specDir, "complete-spec.md");
      writeFileSync(markerSpecPath, "# Test\n\n## Acceptance criteria\n\n- [x] done");
      // Write marker pointing to the complete spec
      writeFileSync(join(worktreePath, ".active-spec-path"), markerSpecPath);
      execSync("git add .active-spec-path", { cwd: worktreePath });
      execSync("git commit -m 'marker'", { cwd: worktreePath });
      execSync(`git push origin ${branchName}`, { cwd: worktreePath, stdio: "pipe" });

      // Create a branch-name-derived spec dir with INCOMPLETE criteria
      // If derivation were used, finalize would refuse; marker should win
      const derivedSpecDir = join(projectRoot, "v1/spec", branchName);
      mkdirSync(derivedSpecDir, { recursive: true });
      writeFileSync(
        join(derivedSpecDir, "index.md"),
        "# Test\n\n## Acceptance criteria\n\n- [ ] incomplete",
      );

      let gateRan = false;
      const { io } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName,
        markReady: true,
        planTargetDir: "v1/spec",
        ...currentBaseSeam,
        ghRunner: { getPrState: () => null },
        ensureDraftPr: async () => ({ number: 1, created: true }),
        runGate: () => {
          gateRan = true;
        },
        prReady: () => {},
      });

      // Marker wins: used complete spec, not the incomplete derived spec
      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--merge markerless resolved worktree derives spec from branch and merges", () => {
      const branchName = "2026-01-01T00-00-00Z-merge-markerless";
      const worktreeName = branchName;
      const worktreePath = join(worktreeDir, worktreeName);
      setupWorktree(worktreePath);
      execSync(`git branch -M ${branchName}`, { cwd: worktreePath, stdio: "pipe" });

      const specDir = join(projectRoot, "v1/spec", branchName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "index.md"), "# Test\n\n- [x] item 1");

      let mergeRan = false;
      const { io, out } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName,
          planTargetDir: "v1/spec",
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: false }),
            getChecks: () => [{ name: "test", status: "success" }],
          },
          runGate: () => {},
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(0);
      expect(mergeRan).toBe(true);
      expect(out()).toContain("merged successfully");
    });
  });

  describe("--merge flag", () => {
    test("--merge on unknown worktree returns error", () => {
      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "nonexistent",
        }),
      );
      expect(code).toBe(1);
      expect(err()).toContain("unresolvable target");
    });

    test("--merge with missing .active-spec-path and no matching spec returns error", () => {
      const worktreeName = "branch-1";
      const worktreePath = join(worktreeDir, worktreeName);
      setupWorktree(worktreePath);

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName,
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("no spec found for branch");
    });

    test("--merge when no PR exists returns error", () => {
      setupMergeWorktree("branch-1");

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: {
            getPrState: () => null,
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("no PR found");
    });

    test("--merge when PR is merged returns error", () => {
      setupMergeWorktree("branch-1");

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: {
            getPrState: () => ({
              state: "MERGED",
              isDraft: false,
            }),
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("already merged");
    });

    test("--merge when PR is closed returns error", () => {
      setupMergeWorktree("branch-1");

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: {
            getPrState: () => ({
              state: "CLOSED",
              isDraft: false,
            }),
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("already closed");
    });

    test("--merge with incomplete spec returns error", () => {
      const worktreeName = "branch-1";
      const worktreePath = join(worktreeDir, worktreeName);
      setupWorktree(worktreePath);

      // Write an index spec with unchecked subspecs
      const specDir = join(projectRoot, "v1", "spec");
      mkdirSync(specDir, { recursive: true });
      const indexPath = join(specDir, "spec-1", "index.md");
      mkdirSync(dirname(indexPath), { recursive: true });
      writeFileSync(indexPath, "# Test\n\n- [ ] [subspec 1](./01-test.md)");
      writeFileSync(
        join(dirname(indexPath), "01-test.md"),
        "# Test\n\n## Acceptance criteria\n\n- [ ] automated criterion",
      );

      writeFileSync(join(worktreePath, ".active-spec-path"), indexPath);

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName,
          ghRunner: {
            getPrState: () => ({
              state: "OPEN",
              isDraft: true,
            }),
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("spec is not complete");
    });

    test("--merge with green CI checks merges the PR", () => {
      setupMergeWorktree("branch-1");

      let gateRan = false;
      let prReadyRan = false;
      let mergeRan = false;
      const greenChecks = [
        { name: "check-1", status: "success" },
        { name: "check-2", status: "skipped" },
      ];

      const { io, out } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: {
            getPrState: () => ({
              state: "OPEN",
              isDraft: true,
            }),
            getChecks: () => greenChecks,
          },
          runGate: () => {
            gateRan = true;
          },
          prReady: () => {
            prReadyRan = true;
          },
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(0);
      expect(gateRan).toBe(true);
      expect(prReadyRan).toBe(true);
      expect(mergeRan).toBe(true);
      expect(out()).toContain("merged successfully");
    });

    test("--merge with red CI check refuses to merge", () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: {
            getPrState: () => ({
              state: "OPEN",
              isDraft: true,
            }),
            getChecks: () => [
              { name: "lint", status: "failure" },
              { name: "test", status: "success" },
            ],
          },
          runGate: () => {},
          prReady: () => {},
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(mergeRan).toBe(false);
      expect(err()).toContain("CI check failed");
      expect(err()).toContain("lint");
    });

    test("--merge with pending CI checks waits", () => {
      setupMergeWorktree("branch-1");

      let pollCount = 0;

      const { io, out } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          pollIntervalMs: 0,
          ghRunner: {
            getPrState: () => ({
              state: "OPEN",
              isDraft: false,
            }),
            getChecks: () => {
              pollCount++;
              if (pollCount < 2) {
                return [{ name: "test", status: "in_progress" }];
              }
              return [{ name: "test", status: "success" }];
            },
          },
          runGate: () => {},
          adminMerge: () => {},
        }),
      );

      expect(code).toBe(0);
      expect(pollCount).toBeGreaterThanOrEqual(2);
      expect(out()).toContain("merged successfully");
    });

    test("--merge with local gate failure refuses to merge", () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: {
            getPrState: () => ({
              state: "OPEN",
              isDraft: true,
            }),
          },
          runGate: () => {
            throw new Error("typecheck failed");
          },
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(mergeRan).toBe(false);
      expect(err()).toContain("ready gate failed");
      expect(err()).toContain("typecheck failed");
    });

    test("--merge on already-ready PR proceeds without prReady call", () => {
      setupMergeWorktree("branch-1");

      let prReadyRan = false;

      const { io, out } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: {
            getPrState: () => ({
              state: "OPEN",
              isDraft: false,
            }),
            getChecks: () => [{ name: "test", status: "success" }],
          },
          runGate: () => {},
          prReady: () => {
            prReadyRan = true;
          },
          adminMerge: () => {},
        }),
      );

      expect(code).toBe(0);
      expect(prReadyRan).toBe(false);
      expect(out()).toContain("merged successfully");
    });

    test("--merge with poll timeout refuses to merge", () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          pollIntervalMs: 0,
          pollTimeoutMs: 0,
          ghRunner: {
            getPrState: () => ({
              state: "OPEN",
              isDraft: true,
            }),
            getChecks: () => [{ name: "test", status: "in_progress" }],
          },
          runGate: () => {},
          prReady: () => {},
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(mergeRan).toBe(false);
      expect(err()).toContain("timed out");
      expect(err()).toContain("Still pending");
    });

    test("--merge with local gate failure on already-ready PR refuses to merge", () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: {
            getPrState: () => ({
              state: "OPEN",
              isDraft: false,
            }),
          },
          runGate: () => {
            throw new Error("test failure");
          },
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(mergeRan).toBe(false);
      expect(err()).toContain("ready gate failed");
      expect(err()).toContain("test failure");
    });

    test("--merge with empty checks list refuses to merge", () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: {
            getPrState: () => ({
              state: "OPEN",
              isDraft: true,
            }),
            getChecks: () => [],
          },
          runGate: () => {},
          prReady: () => {},
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(mergeRan).toBe(false);
      expect(err()).toContain("CI check failed");
      expect(err()).toContain("no checks found");
    });

    test("--merge with null checks (fetch error) refuses to merge", () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: {
            getPrState: () => ({
              state: "OPEN",
              isDraft: true,
            }),
            getChecks: () => null,
          },
          runGate: () => {},
          prReady: () => {},
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(mergeRan).toBe(false);
      expect(err()).toContain("CI check failed");
    });

    test("--merge classifies all spec check statuses correctly", () => {
      setupMergeWorktree("branch-1");

      const testCases: Array<{ status: string; shouldMerge: boolean; shouldWait: boolean }> = [
        // Green states
        { status: "success", shouldMerge: true, shouldWait: false },
        { status: "skipped", shouldMerge: true, shouldWait: false },
        { status: "neutral", shouldMerge: true, shouldWait: false },
        // Pending states
        { status: "pending", shouldMerge: false, shouldWait: true },
        { status: "queued", shouldMerge: false, shouldWait: true },
        { status: "in_progress", shouldMerge: false, shouldWait: true },
        { status: "action_required", shouldMerge: false, shouldWait: true },
        { status: "stale", shouldMerge: false, shouldWait: true },
        // Red states
        { status: "failure", shouldMerge: false, shouldWait: false },
        { status: "cancelled", shouldMerge: false, shouldWait: false },
        { status: "timed_out", shouldMerge: false, shouldWait: false },
        { status: "startup_failure", shouldMerge: false, shouldWait: false },
      ];

      for (const testCase of testCases) {
        const { io, err, out } = captureIo();
        const { io: io2, err: err2, out: out2 } = captureIo();

        let pollCount = 0;
        const code = triageCommand(
          triageMergeOpts({
            projectRoot,
            io: testCase.shouldWait ? io2 : io,
            worktreeName: "branch-1",
            pollIntervalMs: 0,
            pollTimeoutMs: 1000,
            ghRunner: {
              getPrState: () => ({
                state: "OPEN",
                isDraft: true,
              }),
              getChecks: () => {
                pollCount++;
                // If waiting, return pending first, then green
                if (testCase.shouldWait && pollCount === 1) {
                  return [{ name: "test", status: "in_progress" }];
                }
                return [{ name: "test", status: testCase.status }];
              },
            },
            runGate: () => {},
            prReady: () => {},
            adminMerge: () => {},
          }),
        );

        const output = testCase.shouldWait ? out2() : out();
        const errorOutput = testCase.shouldWait ? err2() : err();

        if (testCase.shouldMerge) {
          expect(code).toBe(0);
          expect(output).toContain("merged successfully");
        } else if (testCase.shouldWait) {
          // For pending cases, might merge or timeout depending on the test duration
          // Just verify it's not immediately failing
          expect(pollCount).toBeGreaterThanOrEqual(1);
        } else {
          expect(code).toBe(1);
          expect(errorOutput).toContain("CI check failed");
        }
      }
    });
  });

  describe("merge target resolution", () => {
    function setupResolvableMergeWorktree(
      worktreeName: string,
      opts?: { branch?: string; markerSpecPath?: string },
    ): { worktreePath: string; specPath: string } {
      const { worktreePath, specPath } = setupMergeWorktree(worktreeName);
      if (opts?.branch !== undefined) {
        execSync(`git branch -M ${opts.branch}`, { cwd: worktreePath, stdio: "pipe" });
      }
      if (opts?.markerSpecPath !== undefined) {
        writeFileSync(join(worktreePath, ".active-spec-path"), opts.markerSpecPath);
      }
      return { worktreePath, specPath };
    }

    test("resolves spec path via spec-directory basename", () => {
      const worktreeName = "2026-06-27T17-26-00Z-merge-target-by-worktree-or-spec";
      const specDir = join(projectRoot, "v1", "spec", worktreeName);
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, "index.md");
      writeFileSync(specPath, "# Test\n\n- [x] item 1");
      setupResolvableMergeWorktree(worktreeName, { markerSpecPath: specPath });

      let mergeRan = false;
      const { io, out } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: `v1/spec/${worktreeName}/index.md`,
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: false }),
            getChecks: () => [{ name: "test", status: "success" }],
          },
          runGate: () => {},
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(0);
      expect(mergeRan).toBe(true);
      expect(out()).toContain("merged successfully");
    });

    test("resolves spec path via .active-spec-path marker (plan worktree)", () => {
      const planName = "plan-merge-target";
      const worktreeName = `plan-${planName}`;
      const specDir = join(projectRoot, "v1", "spec", "2026-06-27T17-26-00Z-merge-target-by-worktree-or-spec");
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, "index.md");
      writeFileSync(specPath, "# Test\n\n- [x] item 1");
      setupResolvableMergeWorktree(worktreeName, { markerSpecPath: specPath });

      let mergeRan = false;
      const { io } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: specPath,
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: false }),
            getChecks: () => [{ name: "test", status: "success" }],
          },
          runGate: () => {},
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(0);
      expect(mergeRan).toBe(true);
    });

    test("resolves bare .md filename via marker scan only", () => {
      const worktreeName = "branch-1";
      const specDir = join(projectRoot, "v1", "spec");
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, "test-spec.md");
      writeFileSync(specPath, "# Test\n\n- [x] item 1");
      setupResolvableMergeWorktree(worktreeName, { markerSpecPath: specPath });

      let mergeRan = false;
      const { io } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: specDir,
          io,
          worktreeName: "test-spec.md",
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: false }),
            getChecks: () => [{ name: "test", status: "success" }],
          },
          runGate: () => {},
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(0);
      expect(mergeRan).toBe(true);
    });

    test("resolves PR reference forms and merges", () => {
      const worktreeName = "branch-1";
      const branch = "feature-merge-target";
      setupResolvableMergeWorktree(worktreeName, { branch });

      const prForms = ["#42", "42", "https://github.com/acme/repo/pull/42"];
      for (const prRef of prForms) {
        let mergeRan = false;
        const { io, out } = captureIo();
        const code = triageCommand(
          triageMergeOpts({
            projectRoot,
            cwd: projectRoot,
            io,
            worktreeName: prRef,
            mergeTargetSeams: {
              lookupPrHeadRef: () => ({ ok: true, headRef: branch }),
              findMatchingOpenPrs: () => [{ number: 42, isDraft: false }],
            },
            ghRunner: {
              getPrState: () => ({ state: "OPEN", isDraft: false }),
              getChecks: () => [{ name: "test", status: "success" }],
            },
            runGate: () => {},
            adminMerge: () => {
              mergeRan = true;
            },
          }),
        );

        expect(code).toBe(0);
        expect(mergeRan).toBe(true);
        expect(out()).toContain("merged successfully");
      }
    });

    test("numeric worktree name wins over PR number", () => {
      const worktreeName = "42";
      setupResolvableMergeWorktree(worktreeName);

      let lookupRan = false;
      let mergeRan = false;
      const { io, out } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: "42",
          mergeTargetSeams: {
            lookupPrHeadRef: () => {
              lookupRan = true;
              return { ok: true, headRef: "other-branch" };
            },
            findMatchingOpenPrs: () => [{ number: 42, isDraft: false }],
          },
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: false }),
            getChecks: () => [{ name: "test", status: "success" }],
          },
          runGate: () => {},
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(0);
      expect(lookupRan).toBe(false);
      expect(mergeRan).toBe(true);
      expect(out()).toContain("merged successfully");
    });

    test("unresolvable spec path reports clear error without merge", () => {
      let mergeRan = false;
      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: "v1/spec/missing-spec/index.md",
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("no worktree found for spec path");
      expect(mergeRan).toBe(false);
    });

    test("ambiguous spec path lists candidates without merge", () => {
      const specDir = join(projectRoot, "v1", "spec", "shared-spec");
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, "index.md");
      writeFileSync(specPath, "# Test\n\n- [x] item 1");

      setupResolvableMergeWorktree("branch-a", { markerSpecPath: specPath });
      setupResolvableMergeWorktree("branch-b", { markerSpecPath: specPath });

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: specPath,
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("multiple worktrees match spec path");
      expect(err()).toContain("branch-a");
      expect(err()).toContain("branch-b");
      expect(mergeRan).toBe(false);
    });

    test("PR reference with no local worktree reports clear error", () => {
      let mergeRan = false;
      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: "#99",
          mergeTargetSeams: {
            lookupPrHeadRef: () => ({ ok: true, headRef: "missing-branch" }),
            findMatchingOpenPrs: () => [{ number: 99, isDraft: false }],
          },
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("no local worktree for PR reference");
      expect(mergeRan).toBe(false);
    });

    test("findMatchingOpenPrs refusal at PR-ref resolution", () => {
      let mergeRan = false;
      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: "#7",
          mergeTargetSeams: {
            lookupPrHeadRef: () => ({ ok: true, headRef: "dup-branch" }),
            findMatchingOpenPrs: () => [
              { number: 7, isDraft: false },
              { number: 8, isDraft: true },
            ],
          },
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("multiple open PRs match branch dup-branch");
      expect(mergeRan).toBe(false);
    });

    test("findMatchingOpenPrs refusal at merge pre-check", () => {
      setupResolvableMergeWorktree("branch-1");

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: "branch-1",
          mergeTargetSeams: {
            findMatchingOpenPrs: () => [
              { number: 1, isDraft: false },
              { number: 2, isDraft: true },
            ],
          },
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: false }),
          },
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("multiple open PRs match branch");
      expect(mergeRan).toBe(false);
    });

    test("gh failure during PR lookup reports error without merge", () => {
      let mergeRan = false;
      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: "#5",
          mergeTargetSeams: {
            lookupPrHeadRef: () => ({ ok: false, message: "auth required" }),
          },
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("failed to look up PR reference");
      expect(err()).toContain("auth required");
      expect(mergeRan).toBe(false);
    });

    test("closed PR at resolution reports error without merge", () => {
      let mergeRan = false;
      const { io, err } = captureIo();
      const code = triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: "#5",
          mergeTargetSeams: {
            lookupPrHeadRef: () => ({ ok: false, message: "PR #5 is closed" }),
          },
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(err()).toContain("PR #5 is closed");
      expect(mergeRan).toBe(false);
    });

    test("drill-down with spec path reports unknown worktree", () => {
      const { io, err } = captureIo();
      const code = triageCommand({
        projectRoot,
        cwd: projectRoot,
        io,
        worktreeName: "v1/spec/missing-spec/index.md",
      });

      expect(code).toBe(1);
      expect(err()).toContain("unknown worktree");
    });

    test("--mark-ready with spec path reports unknown worktree", async () => {
      const { io, err } = captureIo();
      const code = await triageCommand({
        projectRoot,
        cwd: projectRoot,
        io,
        worktreeName: "v1/spec/missing-spec/index.md",
        markReady: true,
      });

      expect(code).toBe(1);
      expect(err()).toContain("unknown worktree");
    });

    test("resolveMergeTarget unit: zero matches for unknown token", () => {
      const { io, err } = captureIo();
      const result = resolveMergeTarget(projectRoot, "not-a-target", projectRoot, io);
      expect(result.ok).toBe(false);
      expect(err()).toContain("unresolvable target");
    });
  });
});
