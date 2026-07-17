import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type MergeTargetResolutionSeams, resolveMergeTarget } from "../src/commands/resolve-merge-target.ts";
import type { SuggestedMovesInput, TriageCommandOptions, TriageGhRunner, TriageIo } from "../src/commands/triage.ts";
import {
  extractFailingTestFilePaths,
  getSuggestedMoves,
  recoveryProbeExitFromExecError,
  runRecoveryProbeWithExec,
  triageCommand,
} from "../src/commands/triage.ts";
import type { ConfigOptions } from "../src/config.ts";
import type { BaseCurrentCheckResult } from "../src/git/base-current.ts";
import { FixCommandError, ReadyCommandError } from "../src/ready-gate.ts";
import { checkScopedAbandonPreflight } from "../src/scoped-abandon-preflight.ts";
import { getWorktreeLockPath } from "../src/worktree-lock.ts";

const currentBase =
  (baseRefName: string | null = "main") =>
  (): BaseCurrentCheckResult => ({ status: "current", baseRefName });

const behindBase = (baseRefName: string) => (): BaseCurrentCheckResult => ({ status: "behind", baseRefName });

function suggestedMovesBase(
  input: Omit<SuggestedMovesInput, "worktreeName" | "scopedAbandonEligible"> &
    Partial<Pick<SuggestedMovesInput, "worktreeName" | "scopedAbandonEligible">>,
): SuggestedMovesInput {
  return {
    worktreeName: "test-tree",
    scopedAbandonEligible: false,
    ...input,
  };
}

function initGitWorktree(worktreePath: string): void {
  execSync("git init -b main", { cwd: worktreePath });
  execSync("git config user.email test@example.com", { cwd: worktreePath });
  execSync("git config user.name Test", { cwd: worktreePath });
  execSync("git commit --allow-empty -m 'initial'", { cwd: worktreePath });
}

function writeWorktreeLock(worktreePath: string, pid: number): void {
  writeFileSync(
    getWorktreeLockPath(worktreePath),
    JSON.stringify({
      pid,
      started_at: "2026-06-29T00:00:00.000Z",
      host: "test",
    }),
  );
}

function makePreflightWorktree(name: string, opts: { git?: boolean; lockPid?: number } = {}): string {
  const worktreePath = join(worktreeDir, name);
  mkdirSync(worktreePath, { recursive: true });
  if (opts.git !== false) initGitWorktree(worktreePath);
  if (opts.lockPid !== undefined) writeWorktreeLock(worktreePath, opts.lockPid);
  return worktreePath;
}

const noPrDeps = { isMergedPr: () => false, findMatchingOpenPrs: () => [] };

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
    setUpstream?: boolean;
  },
): { worktreePath: string; specPath: string } {
  const worktreePath = join(worktreeDir, worktreeName);
  setupWorktree(worktreePath);

  const barePath = join(root, `${worktreeName}-remote.git`);
  execSync(`git init --bare "${barePath}"`, { stdio: "pipe" });
  execSync(`git remote add origin "${barePath}"`, { cwd: worktreePath, stdio: "pipe" });
  const initialPush = opts?.setUpstream === false ? "git push origin main" : "git push -u origin main";
  execSync(initialPush, { cwd: worktreePath, stdio: "pipe" });

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
  const markerPush = opts?.setUpstream === false ? "git push origin main" : "git push";
  execSync(markerPush, { cwd: worktreePath, stdio: "pipe" });

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

const completeIndexBody = "# Test\n\n## Acceptance criteria\n\n- [x] done";

function setupMarkerlessWorktree(worktreeName: string, branchName: string): void {
  const worktreePath = join(worktreeDir, worktreeName);
  setupWorktree(worktreePath);
  const barePath = join(root, `${worktreeName}-remote.git`);
  execSync(`git init --bare "${barePath}"`, { stdio: "pipe" });
  execSync(`git remote add origin "${barePath}"`, { cwd: worktreePath, stdio: "pipe" });
  execSync(`git branch -M ${branchName}`, { cwd: worktreePath, stdio: "pipe" });
  execSync(`git push -u origin ${branchName}`, { cwd: worktreePath, stdio: "pipe" });
}

function writeIndexSpec(homeRel: string, name: string, body = completeIndexBody): void {
  const specDir = join(projectRoot, homeRel, name);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "index.md"), body);
}

function jarvisConfigOpts(planTargetDir: string): { config: ConfigOptions } {
  const configDir = join(root, "jarvis-config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({
      version: 2,
      modes: {
        patch: { agentOrder: [{ agent: "claude", model: "haiku" }] },
        plan: { agentOrder: [{ agent: "claude", model: "haiku" }], targetDir: planTargetDir },
        prompt: { agentOrder: [{ agent: "claude", model: "haiku" }] },
        review: { passes: 0 },
      },
      projects: { project: { root: projectRoot } },
    }),
  );
  return { config: { dir: configDir } };
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

function setupPlanMergeWorktree(
  planName: string,
  opts?: { markerless?: boolean },
): { worktreePath: string; specPath: string; branch: string } {
  const worktreeName = `plan-${planName}`;
  const branch = `plan/${planName}`;
  const worktreePath = join(worktreeDir, worktreeName);
  setupWorktree(worktreePath);
  execSync(`git branch -M ${branch}`, { cwd: worktreePath, stdio: "pipe" });

  const specDir = join(projectRoot, "v1", "spec", `2026-01-01T00-00-00Z-${planName}`);
  mkdirSync(specDir, { recursive: true });
  const indexPath = join(specDir, "index.md");
  writeFileSync(indexPath, "# Test\n\n- [ ] [subspec 1](./01-test.md)");
  writeFileSync(join(specDir, "01-test.md"), "# Test\n\n## Acceptance criteria\n\n- [ ] automated criterion");

  if (!opts?.markerless) {
    writeFileSync(join(worktreePath, ".active-spec-path"), indexPath);
  }

  return { worktreePath, specPath: indexPath, branch };
}

function setupV2PlanWorktree(
  jarvisConfigDir: string,
  planName: string,
): { worktreePath: string; specPath: string; branch: string } {
  const branch = `plan/${planName}`;
  const projectKey = "project";
  const worktreePath = join(jarvisConfigDir, "worktrees", projectKey, "plan", planName);
  setupWorktree(worktreePath);
  execSync(`git branch -M ${branch}`, { cwd: worktreePath, stdio: "pipe" });

  const compactTimestamp = "20260101T000000Z";
  const specDir = join(worktreePath, "v2", "spec", `${compactTimestamp}-${planName}`);
  mkdirSync(specDir, { recursive: true });
  const indexPath = join(specDir, "index.md");
  writeFileSync(indexPath, "# Test\n\n- [ ] [subspec 1](./01-test.md)");
  writeFileSync(join(specDir, "01-test.md"), "# Test\n\n## Acceptance criteria\n\n- [ ] automated criterion");

  return { worktreePath, specPath: indexPath, branch };
}

function singleOpenPrStub() {
  return [{ number: 1, isDraft: false }];
}

const mergeReadyGhRunner = {
  getPrState: () => ({ state: "OPEN" as const, isDraft: false }),
  getChecks: () => [{ name: "test", status: "success" as const }],
};

const RECOVERY_STDOUT = "triage --merge: local ready flake recovered (CI green at HEAD); proceeding";

/** Anchored against bun test failure lines from a real gate stderr capture. */
const GATE_TEST_FLAKE_STDERR = `bun run ready failed:
ready: parallel test failed (code 1); retrying serially
ready: serial test failed (code 1)

v1/test/run.sandbox-unrunnable.test.ts:
      at failCase (/repo/v1/test/run.sandbox-unrunnable.test.ts:42:10)
(fail) sandbox runnable > flaky case [1.00ms]
      at otherCase (/repo/v1/test/triage-command.test.ts:100:5)
(fail) triage command > another case [0.50ms]
`;

function readyTestFlakeError(stderr = GATE_TEST_FLAKE_STDERR): ReadyCommandError {
  return new ReadyCommandError(stderr);
}

const headShaGreenGh = {
  ...mergeReadyGhRunner,
  getPrState: () => ({ state: "OPEN" as const, isDraft: true }),
  getChecksForSha: () => [{ name: "ci", status: "success" as const }],
};

async function runMergeFlakeRecovery(overrides: Partial<TriageCommandOptions> = {}) {
  setupMergeWorktree("branch-1");
  let probeCalls = 0;
  const probeArgs: string[][] = [];
  const { runRecoveryProbe: userProbe, ...rest } = overrides;
  const { io, out, err } = captureIo();
  const code = await triageCommand(
    triageMergeOpts({
      projectRoot,
      io,
      worktreeName: "branch-1",
      ghRunner: headShaGreenGh,
      runGate: () => {
        throw readyTestFlakeError();
      },
      runRecoveryProbe: (cwd, args) => {
        probeCalls += 1;
        probeArgs.push(args);
        return userProbe ? userProbe(cwd, args) : 0;
      },
      prReady: () => {},
      adminMerge: () => {},
      ...rest,
    }),
  );
  return { code, probeCalls, probeArgs, out: out(), err: err() };
}

async function expectMergeRecoveryRefused(
  overrides: Partial<TriageCommandOptions>,
  expectedProbeCalls: number,
): Promise<void> {
  const { code, probeCalls, err } = await runMergeFlakeRecovery(overrides);
  expect(code).toBe(1);
  expect(probeCalls).toBe(expectedProbeCalls);
  expectMergeRefusal(err, "implementation PR", "ready gate failed");
}

function expectMergeRefusal(stderr: string, mergeClass: string, stem?: string) {
  expect(stderr).toContain(`triage --merge (${mergeClass}):`);
  if (stem !== undefined) {
    expect(stderr).toContain(stem);
  }
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
  test("no worktrees prints no worktrees", async () => {
    const { io, out } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
    });
    expect(code).toBe(0);
    expect(out()).toBe("no worktrees\n");
  });

  test("with worktrees prints header and summary lines", async () => {
    // Create a worktree with git repo
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    mkdirSync(worktreePath, { recursive: true });

    // Initialize git repo in the worktree
    execSync("git init", { cwd: worktreePath });
    execSync("git config user.email test@example.com", { cwd: worktreePath });
    execSync("git config user.name Test", { cwd: worktreePath });

    const { io, out } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("NAME");
    expect(output).toContain("DIRTY");
    expect(output).toContain(worktreeName);
  });

  test("unknown worktree with name returns error", async () => {
    const { io, err } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName: "nonexistent",
    });
    expect(code).toBe(1);
    expect(err()).toContain("unknown worktree: nonexistent");
  });

  test("named form prints section headers", async () => {
    // Create a worktree with git repo
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    mkdirSync(worktreePath, { recursive: true });

    // Initialize git repo in the worktree
    execSync("git init", { cwd: worktreePath });
    execSync("git config user.email test@example.com", { cwd: worktreePath });
    execSync("git config user.name Test", { cwd: worktreePath });

    const { io, out } = captureIo();
    const code = await triageCommand({
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

  test("with .keep directory is filtered", async () => {
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
    const code = await triageCommand({
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

  test("drill-down with clean worktree and no marker", async () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    mkdirSync(worktreePath, { recursive: true });

    // Initialize git repo
    execSync("git init", { cwd: worktreePath });
    execSync("git config user.email test@example.com", { cwd: worktreePath });
    execSync("git config user.name Test", { cwd: worktreePath });
    execSync("git commit --allow-empty -m 'initial'", { cwd: worktreePath });

    const { io, out } = captureIo();
    const code = await triageCommand({
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

  test("drill-down with dirty worktree (untracked files)", async () => {
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
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("?? test.txt");
  });

  test("drill-down with unpushed commits", async () => {
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
    const code = await triageCommand({
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
    const input = suggestedMovesBase({
      dirtyKind: "clean",
      unpushed: 1,
      prState: "OPEN",
      specComplete: false,
      worktreePath: "/tmp/test",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("git -C /tmp/test push");
  });

  test("rule 1: clean + unpushed > 0 + prState DRAFT", () => {
    const input = suggestedMovesBase({
      dirtyKind: "clean",
      unpushed: 2,
      prState: "DRAFT",
      specComplete: false,
      worktreePath: "/tmp/test",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("git -C /tmp/test push");
  });

  test("rule 1: clean + unpushed > 0 + prState none", () => {
    const input = suggestedMovesBase({
      dirtyKind: "clean",
      unpushed: 1,
      prState: "none",
      specComplete: false,
      worktreePath: "/tmp/test",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("git -C /tmp/test push");
  });

  test("rule 2: clean + prState MERGED", () => {
    const input = suggestedMovesBase({
      dirtyKind: "clean",
      unpushed: 0,
      prState: "MERGED",
      specComplete: false,
      worktreePath: "/tmp/test",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("PR is merged");
    expect(lines[0]).toContain("jarvis1 cleanup");
  });

  test.each(["modified", "mixed", "untracked-only"] as const)("rule 4: %s + prState MERGED", (dirtyKind) => {
    const lines = getSuggestedMoves(
      suggestedMovesBase({
        dirtyKind,
        unpushed: 0,
        prState: "MERGED",
        specComplete: false,
        worktreePath: "/tmp/test",
      }),
    );
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("Discard: jarvis1 cleanup"))).toBe(true);
    expect(lines.some((l) => l.includes("stash"))).toBe(false);
    if (dirtyKind !== "untracked-only") {
      expect(lines.some((l) => l.includes("orphaned"))).toBe(true);
    }
  });

  test("rule 5: modified + specComplete true", () => {
    const input = suggestedMovesBase({
      dirtyKind: "modified",
      unpushed: 0,
      prState: "OPEN",
      specComplete: true,
      worktreePath: "/tmp/test",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("Spec checklists are complete"))).toBe(true);
    expect(lines.some((l) => l.includes("add -A"))).toBe(true);
  });

  test("rule 5: mixed + specComplete true", () => {
    const input = suggestedMovesBase({
      dirtyKind: "mixed",
      unpushed: 0,
      prState: "OPEN",
      specComplete: true,
      worktreePath: "/tmp/test",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("Spec checklists are complete"))).toBe(true);
  });

  test("rule 6: modified + specComplete false keeps git discard when ineligible", () => {
    const input = suggestedMovesBase({
      dirtyKind: "modified",
      unpushed: 0,
      prState: "OPEN",
      specComplete: false,
      worktreePath: "/tmp/test",
      specPath: "/path/to/spec.md",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("Inspect"))).toBe(true);
    expect(lines.some((l) => l.includes("Resume"))).toBe(true);
    expect(lines.some((l) => l.includes("reset --hard"))).toBe(true);
    expect(lines.some((l) => l.includes("cleanup --abandon"))).toBe(false);
  });

  test("rule 6: mixed + specComplete false", () => {
    const input = suggestedMovesBase({
      dirtyKind: "mixed",
      unpushed: 0,
      prState: "OPEN",
      specComplete: false,
      worktreePath: "/tmp/test",
      specPath: "/path/to/spec.md",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("reset --hard"))).toBe(true);
  });

  test("rule 6: eligible dirty incomplete suggests scoped abandon and keeps resume", () => {
    const input = suggestedMovesBase({
      dirtyKind: "modified",
      unpushed: 0,
      prState: "CLOSED",
      specComplete: false,
      worktreePath: "/tmp/test",
      worktreeName: "my-tree",
      scopedAbandonEligible: true,
      specPath: "/path/to/spec.md",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.some((l) => l.includes("Resume: jarvis1 run /path/to/spec.md"))).toBe(true);
    expect(lines.some((l) => l.includes("Discard: jarvis1 cleanup --abandon my-tree"))).toBe(true);
    expect(lines.some((l) => l.includes("reset --hard"))).toBe(false);
  });

  test("rule 7: clean incomplete closed PR with scoped abandon eligible", () => {
    const input = suggestedMovesBase({
      dirtyKind: "clean",
      unpushed: 0,
      prState: "CLOSED",
      specComplete: false,
      worktreePath: "/tmp/test",
      worktreeName: "retire-me",
      scopedAbandonEligible: true,
    });

    const lines = getSuggestedMoves(input);
    expect(lines).toEqual(["1. Retire this worktree: jarvis1 cleanup --abandon retire-me"]);
  });

  test("rule 7: clean incomplete no PR with scoped abandon eligible", () => {
    const input = suggestedMovesBase({
      dirtyKind: "clean",
      unpushed: 0,
      prState: "none",
      specComplete: false,
      worktreePath: "/tmp/test",
      worktreeName: "orphan-tree",
      scopedAbandonEligible: true,
    });

    const lines = getSuggestedMoves(input);
    expect(lines).toEqual(["1. Retire this worktree: jarvis1 cleanup --abandon orphan-tree"]);
  });

  test("clean incomplete DRAFT with abandon eligible falls through to fallback", () => {
    const input = suggestedMovesBase({
      dirtyKind: "clean",
      unpushed: 0,
      prState: "DRAFT",
      specComplete: false,
      worktreePath: "/tmp/test",
      scopedAbandonEligible: true,
    });

    const lines = getSuggestedMoves(input);
    expect(lines[0]).toContain("Inspect");
    expect(lines.some((l) => l.includes("cleanup --abandon"))).toBe(false);
  });

  test("clean incomplete OPEN with abandon eligible falls through to fallback", () => {
    const input = suggestedMovesBase({
      dirtyKind: "clean",
      unpushed: 0,
      prState: "OPEN",
      specComplete: false,
      worktreePath: "/tmp/test",
      scopedAbandonEligible: true,
    });

    const lines = getSuggestedMoves(input);
    expect(lines[0]).toContain("Inspect");
    expect(lines.some((l) => l.includes("cleanup --abandon"))).toBe(false);
  });

  test("prState unknown falls through to fallback", () => {
    const input = suggestedMovesBase({
      dirtyKind: "modified",
      unpushed: 0,
      prState: "unknown",
      specComplete: false,
      worktreePath: "/tmp/test",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("--force"))).toBe(false);
    expect(lines.some((l) => l.includes("-D"))).toBe(false);
    expect(lines.some((l) => l.includes("--no-verify"))).toBe(false);
    expect(lines.some((l) => l.includes("cleanup --abandon"))).toBe(false);
  });

  test("unknown prState with scoped abandon eligible does not suggest scoped abandon", () => {
    const input = suggestedMovesBase({
      dirtyKind: "modified",
      unpushed: 0,
      prState: "unknown",
      specComplete: false,
      worktreePath: "/tmp/test",
      worktreeName: "uncertain-tree",
      scopedAbandonEligible: true,
      specPath: "/path/to/spec.md",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.some((l) => l.includes("cleanup --abandon"))).toBe(false);
    expect(lines.some((l) => l.includes("reset --hard"))).toBe(true);
  });

  test("fallback suggestion includes diff and session log", () => {
    const input = suggestedMovesBase({
      dirtyKind: "clean",
      unpushed: 0,
      prState: "CLOSED",
      specComplete: false,
      worktreePath: "/tmp/test",
    });

    const lines = getSuggestedMoves(input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("Inspect");
  });

  test("no rule matches a destructive suggestion for unknown prState", () => {
    const scenarios: Array<[SuggestedMovesInput]> = [
      [
        suggestedMovesBase({
          dirtyKind: "clean",
          unpushed: 5,
          prState: "unknown",
          specComplete: false,
          worktreePath: "/tmp/test",
        }),
      ],
      [
        suggestedMovesBase({
          dirtyKind: "modified",
          unpushed: 0,
          prState: "unknown",
          specComplete: false,
          worktreePath: "/tmp/test",
        }),
      ],
      [
        suggestedMovesBase({
          dirtyKind: "mixed",
          unpushed: 0,
          prState: "unknown",
          specComplete: true,
          worktreePath: "/tmp/test",
        }),
      ],
    ];

    for (const [input] of scenarios) {
      const lines = getSuggestedMoves(input);
      for (const line of lines) {
        expect(line).not.toContain("--force");
        expect(line).not.toContain(" -D ");
        expect(line).not.toContain("--no-verify");
        expect(line).not.toContain("cleanup --abandon");
      }
    }
  });

  test("rule 4: untracked-only + MERGED with spec-dir untracked beats rule 3", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-triage-rule4-"));
    try {
      initGitWorktree(worktreePath);
      const specDir = join(worktreePath, "v1/spec/plan-spec");
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, "index.md");
      writeFileSync(specPath, "# spec\n");
      writeFileSync(join(specDir, "draft.md"), "draft\n");

      const lines = getSuggestedMoves(
        suggestedMovesBase({
          dirtyKind: "untracked-only",
          unpushed: 0,
          prState: "MERGED",
          specComplete: false,
          worktreePath,
          specPath,
        }),
      );
      expect(lines.some((l) => l.includes("Discard: jarvis1 cleanup"))).toBe(true);
      expect(lines.some((l) => l.includes("stash"))).toBe(false);
      expect(lines.some((l) => l.includes("seed spec"))).toBe(false);
      expect(lines.some((l) => l.includes("add") && l.includes("push"))).toBe(false);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});

describe("scoped abandon preflight", () => {
  test("eligible when path exists, no lock, branch resolves, PR eligible", () => {
    const result = checkScopedAbandonPreflight({
      projectRoot,
      worktreePath: makePreflightWorktree("eligible-tree"),
      deps: noPrDeps,
    });
    expect(result).toEqual({ eligible: true, branch: "main" });
  });

  test("ineligible for merged PR", () => {
    const result = checkScopedAbandonPreflight({
      projectRoot,
      worktreePath: makePreflightWorktree("merged-tree"),
      deps: { isMergedPr: () => true, findMatchingOpenPrs: () => [] },
    });
    expect(result).toMatchObject({
      eligible: false,
      reason: "pr_ineligible",
      branch: "main",
      eligibility: { kind: "merged" },
    });
  });

  test("ineligible for ready open PR", () => {
    const result = checkScopedAbandonPreflight({
      projectRoot,
      worktreePath: makePreflightWorktree("ready-pr-tree"),
      deps: {
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [{ number: 42, isDraft: false }],
      },
    });
    expect(result).toMatchObject({
      eligible: false,
      reason: "pr_ineligible",
      eligibility: { kind: "ready_pr" },
    });
  });

  test("ineligible for multiple open PRs", () => {
    const result = checkScopedAbandonPreflight({
      projectRoot,
      worktreePath: makePreflightWorktree("multi-pr-tree"),
      deps: {
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [
          { number: 1, isDraft: true },
          { number: 2, isDraft: true },
        ],
      },
    });
    expect(result).toMatchObject({
      eligible: false,
      reason: "pr_ineligible",
      eligibility: { kind: "multiple_open" },
    });
  });

  test("ineligible for live lock", () => {
    const result = checkScopedAbandonPreflight({
      projectRoot,
      worktreePath: makePreflightWorktree("locked-tree", { lockPid: process.pid }),
      deps: noPrDeps,
    });
    expect(result).toEqual({
      eligible: false,
      reason: "live_lock",
      lock: {
        pid: process.pid,
        started_at: "2026-06-29T00:00:00.000Z",
        host: "test",
      },
    });
  });

  test("ineligible for PR inspection failure", () => {
    const result = checkScopedAbandonPreflight({
      projectRoot,
      worktreePath: makePreflightWorktree("inspect-fail-tree"),
      deps: {
        isMergedPr: () => false,
        findMatchingOpenPrs: () => {
          throw new Error("gh unavailable");
        },
      },
    });
    expect(result).toMatchObject({
      eligible: false,
      reason: "pr_ineligible",
      eligibility: { kind: "inspection_failed" },
    });
  });

  test("ineligible when branch cannot be resolved", () => {
    const result = checkScopedAbandonPreflight({
      projectRoot,
      worktreePath: makePreflightWorktree("no-branch-tree", { git: false }),
      deps: noPrDeps,
    });
    expect(result).toEqual({ eligible: false, reason: "branch_resolve_failed" });
  });
});

describe("triage verdict", () => {
  test("all-landed verdict when all worktrees are merged, clean, and no unpushed", async () => {
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
    const code = await triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("all work landed");
  });

  test("outstanding verdict lists worktrees with draft PRs", async () => {
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
    const code = await triageCommand({
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

  test("outstanding verdict lists worktrees with ready (non-draft) PRs", async () => {
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
    const code = await triageCommand({
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

  test("merged dirty worktree is outstanding", async () => {
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
    const code = await triageCommand({
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

  test("plan worktree is classified as outstanding", async () => {
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
    const code = await triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(worktreeName);
  });

  test("no PR state is classified as outstanding", async () => {
    const worktreeName = "branch-1";
    const worktreePath = join(worktreeDir, worktreeName);
    setupWorktree(worktreePath);

    const ghRunner: TriageGhRunner = {
      getPrState: () => null,
    };

    const { io, out } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      ghRunner,
    });

    expect(code).toBe(0);
    const output = out();
    expect(output).toContain("outstanding work");
    expect(output).toContain(worktreeName);
  });

  test("mixed verdict with both landed and outstanding worktrees", async () => {
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
    const code = await triageCommand({
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

  test("gate state shows as blocked when merge is blocked", async () => {
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
    const code = await triageCommand({
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

  test("gate state shows as clean when merge is permitted", async () => {
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
    const code = await triageCommand({
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

  test("gate state shows as unavailable when getMergeGateState returns null", async () => {
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
    const code = await triageCommand({
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

  test("gate state is not shown for landed worktrees", async () => {
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
    const code = await triageCommand({
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

  test("gate state query failure does not abort sweep", async () => {
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
    const code = await triageCommand({
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

  test("--mark-ready without worktree name should not pass to command layer (CLI rejects)", async () => {
    // This test verifies that the CLI layer rejects --mark-ready without a worktree name
    // and never calls the triage command. The command layer doesn't need to handle this,
    // but we verify the read-only listing still works.
    const { io, out } = captureIo();
    const code = await triageCommand({
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

  test("--mark-ready on complete dirty worktree with no upstream pushes with -u, gates, and promotes", async () => {
    const worktreeName = "branch-no-upstream";
    const { worktreePath } = setupMarkReadyWorktree(worktreeName, { makeDirty: true, setUpstream: false });

    let ensureDraftPrRan = false;
    let gateRan = false;
    let prReadyRan = false;

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
      prReady: () => {
        prReadyRan = true;
      },
    });

    expect(code).toBe(0);
    expect(
      execSync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
        cwd: worktreePath,
        encoding: "utf8",
      }).trim(),
    ).toBe("origin/main");
    expect(ensureDraftPrRan).toBe(true);
    expect(gateRan).toBe(true);
    expect(prReadyRan).toBe(true);
    expect(out()).toContain("promoted to ready");
  });

  test("--mark-ready push failure after finalize commit skips PR open and gate", async () => {
    const worktreeName = "branch-push-fail";
    const { worktreePath } = setupMarkReadyWorktree(worktreeName, { makeDirty: true });

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
      pushCurrent: () => {
        throw new Error("error: failed to push some refs to 'origin'\nfatal: push rejected");
      },
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
    expect(err()).toContain("push rejected");
    expect(ensureDraftPrRan).toBe(false);
    expect(gateRan).toBe(false);
    const lastCommit = execSync("git log -1 --pretty=%B", {
      cwd: worktreePath,
      encoding: "utf8",
    });
    expect(lastCommit).toContain("chore: complete-but-dirty commit");
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

  test("resolves fixCommand from registered project at --mark-ready", async () => {
    const worktreeName = "branch-1";
    setupMarkReadyWorktree(worktreeName);
    const configDir = mkdtempSync(join(tmpdir(), "jarvis-triage-fix-cfg-"));
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: [{ agent: "claude", model: "haiku" }] },
          plan: { agentOrder: [{ agent: "claude", model: "haiku" }] },
          prompt: { agentOrder: [{ agent: "claude", model: "haiku" }] },
          review: { passes: 1 },
        },
        projects: {
          app: { root: projectRoot, fixCommand: "npm run lint-fix" },
        },
      }),
    );

    let capturedFix: string | undefined;
    const { io } = captureIo();
    const code = await triageCommand({
      projectRoot,
      io,
      worktreeName,
      markReady: true,
      config: { dir: configDir },
      ...currentBaseSeam,
      ghRunner: draftPrGhRunner,
      runGate: (_cwd, _ready, fix) => {
        capturedFix = fix;
      },
      prReady: () => {},
    });

    expect(code).toBe(0);
    expect(capturedFix).toBe("npm run lint-fix");
    rmSync(configDir, { recursive: true, force: true });
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
    async function markReadyMarkerless(
      worktreeName: string,
      opts?: Partial<TriageCommandOptions>,
    ): Promise<{ code: number; out: () => string; err: () => string; gateRan: boolean }> {
      let gateRan = false;
      const { io, out, err } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName,
        markReady: true,
        ...currentBaseSeam,
        ghRunner: { getPrState: () => null },
        ensureDraftPr: async () => ({ number: 1, created: true }),
        runGate: () => {
          gateRan = true;
        },
        prReady: () => {},
        ...opts,
      });
      return { code, out, err, gateRan };
    }

    test("--mark-ready markerless patch worktree finalizes when branch maps to index.md spec", async () => {
      const branchName = "2026-01-01T00-00-00Z-my-patch";
      setupMarkerlessWorktree(branchName, branchName);
      writeIndexSpec("v1/spec", branchName);

      const { code, out, gateRan } = await markReadyMarkerless(branchName);
      expect(code).toBe(0);
      expect(gateRan).toBe(true);
      expect(out()).toContain("promoted to ready");
    });

    test("--mark-ready markerless patch worktree resolves single-file spec directory", async () => {
      const branchName = "2026-01-01T00-00-00Z-single-file";
      setupMarkerlessWorktree(branchName, branchName);
      const specDir = join(projectRoot, "v1/spec", branchName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "00-only.md"), completeIndexBody);

      const { code, gateRan } = await markReadyMarkerless(branchName);
      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--mark-ready markerless plan/ branch resolves timestamped spec directory", async () => {
      const planName = "my-plan";
      setupMarkerlessWorktree("plan-my-plan", `plan/${planName}`);
      writeIndexSpec("v1/spec", `2026-01-01T00-00-00Z-${planName}`);

      const { code, gateRan } = await markReadyMarkerless("plan-my-plan");
      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--mark-ready markerless lookup searches planTargetDir first, then v1/spec, then v2/spec", async () => {
      const branchName = "2026-01-01T00-00-00Z-search-order";
      setupMarkerlessWorktree(branchName, branchName);
      writeIndexSpec("v1/spec", branchName);

      const { code, gateRan } = await markReadyMarkerless(branchName, jarvisConfigOpts("custom-target"));
      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--mark-ready markerless searches v2/spec as last fallback", async () => {
      const branchName = "2026-01-01T00-00-00Z-v2-spec";
      setupMarkerlessWorktree(branchName, branchName);
      writeIndexSpec("v2/spec", branchName);

      const { code, gateRan } = await markReadyMarkerless(branchName, jarvisConfigOpts("custom-target"));
      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--mark-ready markerless ambiguous directory (multiple .md, no index.md) refuses", async () => {
      const branchName = "2026-01-01T00-00-00Z-ambiguous";
      setupMarkerlessWorktree(branchName, branchName);
      const specDir = join(projectRoot, "v1/spec", branchName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "00-a.md"), "# A");
      writeFileSync(join(specDir, "01-b.md"), "# B");

      const { code, err } = await markReadyMarkerless(branchName);
      expect(code).toBe(1);
      expect(err()).toContain("ambiguous");
    });

    test("--mark-ready markerless directory with zero .md files refuses", async () => {
      const branchName = "2026-01-01T00-00-00Z-empty-dir";
      setupMarkerlessWorktree(branchName, branchName);
      mkdirSync(join(projectRoot, "v1/spec", branchName), { recursive: true });

      const { code, err } = await markReadyMarkerless(branchName);
      expect(code).toBe(1);
      expect(err()).toContain("no markdown files");
    });

    test("--mark-ready marker-present uses marker even when branch would find a spec", async () => {
      const branchName = "2026-01-01T00-00-00Z-marker-wins";
      const worktreePath = join(worktreeDir, branchName);
      setupWorktree(worktreePath);
      const barePath = join(root, `${branchName}-remote.git`);
      execSync(`git init --bare "${barePath}"`, { stdio: "pipe" });
      execSync(`git remote add origin "${barePath}"`, { cwd: worktreePath, stdio: "pipe" });
      execSync(`git branch -M ${branchName}`, { cwd: worktreePath, stdio: "pipe" });
      execSync(`git push -u origin ${branchName}`, { cwd: worktreePath, stdio: "pipe" });

      const markerSpecPath = join(projectRoot, "v1/spec", "complete-spec.md");
      mkdirSync(dirname(markerSpecPath), { recursive: true });
      writeFileSync(markerSpecPath, completeIndexBody);
      writeFileSync(join(worktreePath, ".active-spec-path"), markerSpecPath);
      execSync("git add .active-spec-path", { cwd: worktreePath });
      execSync("git commit -m 'marker'", { cwd: worktreePath });
      execSync(`git push origin ${branchName}`, { cwd: worktreePath, stdio: "pipe" });

      writeIndexSpec("v1/spec", branchName, "# Test\n\n## Acceptance criteria\n\n- [ ] incomplete");

      const { code, gateRan } = await markReadyMarkerless(branchName);
      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--merge markerless resolved worktree derives spec from branch and merges", async () => {
      const branchName = "2026-01-01T00-00-00Z-merge-markerless";
      setupWorktree(join(worktreeDir, branchName));
      execSync(`git branch -M ${branchName}`, { cwd: join(worktreeDir, branchName), stdio: "pipe" });
      writeIndexSpec("v1/spec", branchName, "# Test\n\n- [x] item 1");

      let mergeRan = false;
      const { io, out } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: branchName,
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

    test("--mark-ready markerless reads worktree-local spec when project-root copy is stale", async () => {
      const branchName = "2026-01-01T00-00-00Z-local-mirror";
      setupMarkerlessWorktree(branchName, branchName);

      // Project-root spec is INCOMPLETE
      const specDir = join(projectRoot, "v1/spec", branchName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "index.md"), "# Test\n\n## Acceptance criteria\n\n- [ ] not done yet");

      // Worktree-local spec is COMPLETE
      const worktreeSpecDir = join(worktreeDir, branchName, "v1/spec", branchName);
      mkdirSync(worktreeSpecDir, { recursive: true });
      writeFileSync(join(worktreeSpecDir, "index.md"), completeIndexBody);

      const { code, gateRan } = await markReadyMarkerless(branchName);
      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--mark-ready empty .active-spec-path refuses and does not fall back to branch-derived spec", async () => {
      const branchName = "2026-01-01T00-00-00Z-empty-marker";
      const worktreePath = join(worktreeDir, branchName);
      setupMarkerlessWorktree(branchName, branchName);
      // Write a complete branch-derived spec so fallback would succeed if it ran
      writeIndexSpec("v1/spec", branchName);
      // Write an empty marker file
      writeFileSync(join(worktreePath, ".active-spec-path"), "");

      let gateRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName: branchName,
        markReady: true,
        ...currentBaseSeam,
        ghRunner: { getPrState: () => null },
        ensureDraftPr: async () => ({ number: 1, created: true }),
        runGate: () => {
          gateRan = true;
        },
        prReady: () => {},
      });

      expect(code).toBe(1);
      expect(err()).toContain("spec file not found");
      expect(gateRan).toBe(false);
    });

    test("--mark-ready .active-spec-path pointing at missing file refuses without branch fallback", async () => {
      const branchName = "2026-01-01T00-00-00Z-bad-marker-path";
      const worktreePath = join(worktreeDir, branchName);
      setupMarkerlessWorktree(branchName, branchName);
      // Write a complete branch-derived spec so fallback would succeed if it ran
      writeIndexSpec("v1/spec", branchName);
      // Write a marker pointing at a nonexistent path
      writeFileSync(join(worktreePath, ".active-spec-path"), "/nonexistent/path/index.md");

      let gateRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName: branchName,
        markReady: true,
        ...currentBaseSeam,
        ghRunner: { getPrState: () => null },
        ensureDraftPr: async () => ({ number: 1, created: true }),
        runGate: () => {
          gateRan = true;
        },
        prReady: () => {},
      });

      expect(code).toBe(1);
      expect(err()).toContain("spec file not found");
      expect(gateRan).toBe(false);
    });

    test("--merge corrupted .active-spec-path refuses without branch fallback", async () => {
      const branchName = "2026-01-01T00-00-00Z-corrupt-marker-merge";
      const worktreePath = join(worktreeDir, branchName);
      setupWorktree(worktreePath);
      execSync(`git branch -M ${branchName}`, { cwd: worktreePath, stdio: "pipe" });
      // Write a complete branch-derived spec so fallback would succeed if it ran
      writeIndexSpec("v1/spec", branchName, "# Test\n\n- [x] item 1");
      // Write an empty marker file
      writeFileSync(join(worktreePath, ".active-spec-path"), "");

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: branchName,
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

      expect(code).toBe(1);
      expect(err()).toContain("spec file not found");
      expect(mergeRan).toBe(false);
    });

    test("configured plan.targetDir wins over v1/spec when both have specs for same branch", async () => {
      const branchName = "2026-01-01T00-00-00Z-target-dir-wins";
      setupMarkerlessWorktree(branchName, branchName);
      // Configured home has COMPLETE spec
      writeIndexSpec("custom-spec", branchName);
      // Fallback v1/spec has INCOMPLETE spec (would refuse if used)
      writeIndexSpec("v1/spec", branchName, "# Test\n\n## Acceptance criteria\n\n- [ ] not done");

      const { code, gateRan } = await markReadyMarkerless(branchName, jarvisConfigOpts("custom-spec"));
      expect(code).toBe(0);
      expect(gateRan).toBe(true);
    });

    test("--merge markerless resolves spec via PR-reference target resolution", async () => {
      const branchName = "2026-01-01T00-00-00Z-pr-ref-merge";
      const worktreePath = join(worktreeDir, branchName);
      setupWorktree(worktreePath);
      execSync(`git branch -M ${branchName}`, { cwd: worktreePath, stdio: "pipe" });
      // Markerless: no .active-spec-path
      writeIndexSpec("v1/spec", branchName, "# Test\n\n- [x] item 1");

      let mergeRan = false;
      const { io, out } = captureIo();
      const code = await triageCommand({
        projectRoot,
        io,
        worktreeName: "#42",
        merge: true,
        mergeTargetSeams: {
          lookupPrHeadRef: () => ({ ok: true, headRef: branchName }),
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
      });

      expect(code).toBe(0);
      expect(mergeRan).toBe(true);
      expect(out()).toContain("merged successfully");
    });
  });

  describe("--merge flag", () => {
    test("--merge on unknown worktree returns error", async () => {
      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "nonexistent",
        }),
      );
      expect(code).toBe(1);
      expectMergeRefusal(err(), "unknown worktree", "unresolvable target");
    });

    test("--merge without a spec runs the local and CI gates before merging", async () => {
      const worktreeName = "branch-1";
      const worktreePath = join(worktreeDir, worktreeName);
      setupWorktree(worktreePath);

      const calls: string[] = [];
      const { io } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName,
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: false }),
            getChecks: () => {
              calls.push("ci");
              return [{ name: "test", status: "success" }];
            },
          },
          runGate: () => {
            calls.push("ready");
          },
          adminMerge: () => {
            calls.push("merge");
          },
        }),
      );

      expect(code).toBe(0);
      expect(calls).toEqual(["ready", "ci", "merge"]);
    });

    test("--merge without a spec refuses on local-ready or CI failure", async () => {
      for (const failure of ["ready", "ci"] as const) {
        const worktreeName = `spec-less-${failure}`;
        setupWorktree(join(worktreeDir, worktreeName));
        let mergeRan = false;
        const { io } = captureIo();
        const code = await triageCommand(
          triageMergeOpts({
            projectRoot,
            io,
            worktreeName,
            ghRunner: {
              getPrState: () => ({ state: "OPEN", isDraft: false }),
              getChecks: () => [{ name: "test", status: failure === "ci" ? "failure" : "success" }],
            },
            runGate: () => {
              if (failure === "ready") throw new Error("ready failed");
            },
            adminMerge: () => {
              mergeRan = true;
            },
          }),
        );
        expect(code).toBe(1);
        expect(mergeRan).toBe(false);
      }
    });

    test("--merge when no PR exists returns error", async () => {
      setupMergeWorktree("branch-1");

      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "no PR found");
    });

    test("--merge when PR is merged returns error", async () => {
      setupMergeWorktree("branch-1");

      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "already merged");
    });

    test("--merge when PR is closed returns error", async () => {
      setupMergeWorktree("branch-1");

      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "already closed");
    });

    test("--merge with incomplete spec returns error", async () => {
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
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "spec is not complete");
    });

    test("--merge on plan worktree merges with incomplete subspec AC", async () => {
      const planName = "plan-merge-eligibility";
      setupPlanMergeWorktree(planName);

      let mergeRan = false;
      const { io, out } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: `plan-${planName}`,
          ghRunner: mergeReadyGhRunner,
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

    test("--merge on plan PR ref merges with incomplete subspec AC", async () => {
      const planName = "plan-merge-pr-ref";
      const { branch } = setupPlanMergeWorktree(planName, { markerless: true });

      let mergeRan = false;
      const { io, out } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "#42",
          mergeTargetSeams: {
            lookupPrHeadRef: () => ({ ok: true, headRef: branch }),
            findMatchingOpenPrs: () => [{ number: 42, isDraft: false }],
          },
          ghRunner: mergeReadyGhRunner,
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

    test("--merge on plan worktree gate failure uses plan PR refusal class", async () => {
      const planName = "plan-merge-gate-fail";
      setupPlanMergeWorktree(planName);

      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: `plan-${planName}`,
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: true }),
          },
          runGate: () => {
            throw new Error("typecheck failed");
          },
        }),
      );

      expect(code).toBe(1);
      expectMergeRefusal(err(), "plan PR", "ready gate failed");
      expect(err()).not.toContain("implementation PR");
    });

    test("--merge on plan worktree CI red uses plan PR refusal class", async () => {
      const planName = "plan-merge-ci-red";
      setupPlanMergeWorktree(planName);

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: `plan-${planName}`,
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: true }),
            getChecks: () => [{ name: "lint", status: "failure" }],
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
      expectMergeRefusal(err(), "plan PR", "CI check failed");
      expect(err()).not.toContain("implementation PR");
    });

    test("--merge on plan worktree CI poll timeout uses plan PR refusal class", async () => {
      const planName = "plan-merge-ci-timeout";
      setupPlanMergeWorktree(planName);

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: `plan-${planName}`,
          pollIntervalMs: 0,
          pollTimeoutMs: 0,
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: true }),
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
      expectMergeRefusal(err(), "plan PR", "timed out");
      expect(err()).not.toContain("implementation PR");
    });

    test("--merge on plan worktree lock uses plan PR refusal class", async () => {
      const planName = "plan-merge-lock";
      const { worktreePath } = setupPlanMergeWorktree(planName);

      writeFileSync(
        join(worktreePath, ".jarvis.lock"),
        JSON.stringify({
          pid: process.pid,
          started_at: new Date().toISOString(),
          host: "test",
        }),
      );

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: `plan-${planName}`,
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: false }),
          },
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(mergeRan).toBe(false);
      expectMergeRefusal(err(), "plan PR", "worktree is locked by live run");
      expect(err()).not.toContain("implementation PR");
    });

    test("--merge on plan worktree adminMerge failure uses plan PR refusal class", async () => {
      const planName = "plan-merge-transport";
      setupPlanMergeWorktree(planName);

      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: `plan-${planName}`,
          ghRunner: mergeReadyGhRunner,
          runGate: () => {},
          adminMerge: () => {
            throw new Error("merge rejected by branch protection");
          },
        }),
      );

      expect(code).toBe(1);
      expectMergeRefusal(err(), "plan PR", "failed to merge PR");
      expect(err()).not.toContain("implementation PR");
    });

    test("--merge on Jarvis-owned v2 plan worktree with compact-timestamp spec merges", async () => {
      const planName = "plan-v2-compact";
      const configDir = join(root, "jarvis-config");
      const { config } = jarvisConfigOpts("v2/spec");
      setupV2PlanWorktree(configDir, planName);

      let mergeRan = false;
      const { io, out } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: `plan/${planName}`,
          ghRunner: mergeReadyGhRunner,
          runGate: () => {},
          adminMerge: () => {
            mergeRan = true;
          },
          config,
        }),
      );

      expect(code).toBe(0);
      expect(mergeRan).toBe(true);
      expect(out()).toContain("merged successfully");
    });

    test("--merge with green CI checks merges the PR", async () => {
      setupMergeWorktree("branch-1");

      let gateRan = false;
      let prReadyRan = false;
      let mergeRan = false;
      const greenChecks = [
        { name: "check-1", status: "success" },
        { name: "check-2", status: "skipped" },
      ];

      const { io, out } = captureIo();
      const code = await triageCommand(
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

    test("--merge with red CI check refuses to merge", async () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "CI check failed");
      expect(err()).toContain("lint");
    });

    test("--merge with pending CI checks waits", async () => {
      setupMergeWorktree("branch-1");

      let pollCount = 0;

      const { io, out } = captureIo();
      const code = await triageCommand(
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

    test("--merge with local gate failure refuses to merge", async () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "ready gate failed");
      expect(err()).toContain("typecheck failed");
    });

    test("--merge on already-ready PR proceeds without prReady call", async () => {
      setupMergeWorktree("branch-1");

      let prReadyRan = false;

      const { io, out } = captureIo();
      const code = await triageCommand(
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

    test("--merge with poll timeout refuses to merge", async () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "timed out");
      expect(err()).toContain("Still pending");
    });

    test("--merge with locked worktree refuses to merge", async () => {
      const worktreeName = "branch-1";
      const { worktreePath } = setupMergeWorktree(worktreeName);

      writeFileSync(
        join(worktreePath, ".jarvis.lock"),
        JSON.stringify({
          pid: process.pid,
          started_at: new Date().toISOString(),
          host: "test",
        }),
      );

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName,
          ghRunner: {
            getPrState: () => ({ state: "OPEN", isDraft: false }),
          },
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expect(mergeRan).toBe(false);
      expectMergeRefusal(err(), "implementation PR", "worktree is locked by live run");
    });

    test("--merge with adminMerge failure refuses to merge", async () => {
      setupMergeWorktree("branch-1");

      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: mergeReadyGhRunner,
          runGate: () => {},
          adminMerge: () => {
            throw new Error("merge rejected by branch protection");
          },
        }),
      );

      expect(code).toBe(1);
      expectMergeRefusal(err(), "implementation PR", "failed to merge PR");
      expect(err()).toContain("merge rejected by branch protection");
    });

    test("--merge with local gate failure on already-ready PR refuses to merge", async () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "ready gate failed");
      expect(err()).toContain("test failure");
    });

    test("--merge with empty checks list refuses to merge", async () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "CI check failed");
      expect(err()).toContain("no checks found");
    });

    test("--merge with null checks (fetch error) refuses to merge", async () => {
      setupMergeWorktree("branch-1");

      let mergeRan = false;

      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "CI check failed");
    });

    test("--merge classifies all spec check statuses correctly", async () => {
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
        const code = await triageCommand(
          triageMergeOpts({
            projectRoot,
            io: testCase.shouldWait ? io2 : io,
            worktreeName: "branch-1",
            pollIntervalMs: 0,
            pollTimeoutMs: 0,
            ghRunner: {
              getPrState: () => ({
                state: "OPEN",
                isDraft: true,
              }),
              getChecks: () => {
                pollCount++;
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
          // pollTimeoutMs: 0 times out after exactly one poll; just confirm it polled.
          expect(pollCount).toBeGreaterThanOrEqual(1);
        } else {
          expect(code).toBe(1);
          expectMergeRefusal(errorOutput, "implementation PR", "CI check failed");
        }
      }
    });

    test("extractFailingTestFilePaths dedupes and caps paths from gate stderr fixture", () => {
      expect(extractFailingTestFilePaths(GATE_TEST_FLAKE_STDERR)).toEqual([
        "/repo/v1/test/run.sandbox-unrunnable.test.ts",
        "/repo/v1/test/triage-command.test.ts",
      ]);
      expect(extractFailingTestFilePaths("no failure markers here")).toEqual([]);
    });

    test("--merge recovers on test flake when HEAD-sha CI green and serial probe passes", async () => {
      let mergeRan = false;
      const { code, probeCalls, out } = await runMergeFlakeRecovery({
        adminMerge: () => {
          mergeRan = true;
        },
      });

      expect(code).toBe(0);
      expect(probeCalls).toBe(1);
      expect(mergeRan).toBe(true);
      expect(out).toContain(RECOVERY_STDOUT);
      expect(out).toContain("merged successfully");
    });

    test("--merge recovers with targeted file probe when serial probe stays red", async () => {
      let mergeRan = false;
      const { code, probeArgs, out } = await runMergeFlakeRecovery({
        runRecoveryProbe: (_cwd, args) => (args.length === 1 ? 1 : 0),
        adminMerge: () => {
          mergeRan = true;
        },
      });

      expect(code).toBe(0);
      expect(probeArgs).toEqual([
        ["test"],
        ["test", "/repo/v1/test/run.sandbox-unrunnable.test.ts", "/repo/v1/test/triage-command.test.ts"],
      ]);
      expect(mergeRan).toBe(true);
      expect(out).toContain(RECOVERY_STDOUT);
    });

    test("--merge refuses recovery on FixCommandError even when HEAD-sha CI is green", async () => {
      await expectMergeRecoveryRefused(
        {
          runGate: () => {
            throw new FixCommandError("bun run fix failed");
          },
        },
        0,
      );
    });

    test("--merge refuses recovery on generic Error with test-like message", async () => {
      await expectMergeRecoveryRefused(
        {
          runGate: () => {
            throw new Error("ready: serial test failed (code 1)");
          },
        },
        0,
      );
    });

    test("--merge refuses recovery when HEAD-sha CI is not green", async () => {
      for (const getChecksForSha of [
        () => [{ name: "ci", status: "failure" as const }],
        () => {
          throw new Error("gh api failed");
        },
        () => null,
      ]) {
        await expectMergeRecoveryRefused({ ghRunner: { ...headShaGreenGh, getChecksForSha } }, 0);
      }
    });

    test("--merge refuses recovery on deadline exceeded or missing harness test markers", async () => {
      for (const message of [
        `bun run ready failed:\nready: deadline exceeded after 600000ms; killing child tree\n`,
        "bun run ready failed:\nbun run typecheck failed\n",
      ]) {
        await expectMergeRecoveryRefused(
          {
            runGate: () => {
              throw new ReadyCommandError(message);
            },
          },
          0,
        );
      }
    });

    test("--merge refuses recovery when probe 1 red and extraction yields zero paths", async () => {
      await expectMergeRecoveryRefused(
        {
          runGate: () => {
            throw readyTestFlakeError("bun run ready failed:\nready: serial test failed (code 1)\n");
          },
          runRecoveryProbe: () => 1,
        },
        1,
      );
    });

    test("--merge refuses recovery when probes stay red", async () => {
      await expectMergeRecoveryRefused({ runRecoveryProbe: () => 1 }, 2);
    });

    test("--merge refuses recovery when probe exits with signal or timeout code", async () => {
      for (const exitCode of [124, 130, 143]) {
        await expectMergeRecoveryRefused({ runRecoveryProbe: () => exitCode }, 1);
      }
    });

    test("recoveryProbeExitFromExecError maps execFileSync signal and timeout failure shapes", () => {
      const execError = (overrides: { status?: number | null; signal?: NodeJS.Signals | null }) =>
        Object.assign(new Error("Command failed: bun test"), overrides);

      expect(recoveryProbeExitFromExecError(execError({ status: null, signal: "SIGINT" }))).toBe(130);
      expect(recoveryProbeExitFromExecError(execError({ status: null, signal: "SIGTERM" }))).toBe(143);
      expect(recoveryProbeExitFromExecError(execError({ status: 124 }))).toBe(124);
      expect(recoveryProbeExitFromExecError(execError({ status: null, signal: null }))).toBe(1);
    });

    test("--merge refuses recovery when default probe runner hits execFileSync signal kill (no probe 2)", async () => {
      setupMergeWorktree("branch-1");
      let probeCalls = 0;
      const signalExecError = Object.assign(new Error("Command failed: bun test"), {
        status: null,
        signal: "SIGINT" as const,
      });
      const signalExec = (() => {
        throw signalExecError;
      }) as typeof import("node:child_process").execFileSync;

      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: headShaGreenGh,
          runGate: () => {
            throw readyTestFlakeError();
          },
          runRecoveryProbe: (cwd, args) => {
            probeCalls += 1;
            return runRecoveryProbeWithExec(cwd, args, signalExec);
          },
          prReady: () => {},
          adminMerge: () => {},
        }),
      );

      expect(code).toBe(1);
      expect(probeCalls).toBe(1);
      expectMergeRefusal(err(), "implementation PR", "ready gate failed");
    });

    test("--merge with passing gate runs no recovery probes", async () => {
      setupMergeWorktree("branch-1");

      let probeCalls = 0;
      const { io, out } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName: "branch-1",
          ghRunner: mergeReadyGhRunner,
          runGate: () => {},
          runRecoveryProbe: () => {
            probeCalls += 1;
            return 0;
          },
          adminMerge: () => {},
        }),
      );

      expect(code).toBe(0);
      expect(probeCalls).toBe(0);
      expect(out()).not.toContain(RECOVERY_STDOUT);
      expect(out()).toContain("merged successfully");
    });

    test("--merge markerless plan worktree resolves spec from worktree's own targetDir", async () => {
      const planName = "plan-merge-worktree-spec";
      const worktreeName = `plan-${planName}`;
      const branch = `plan/${planName}`;
      const worktreePath = join(worktreeDir, worktreeName);
      setupWorktree(worktreePath);
      execSync(`git branch -M ${branch}`, { cwd: worktreePath, stdio: "pipe" });

      // Spec directory exists ONLY in the worktree, not in projectRoot
      const worktreeSpecDir = join(worktreePath, "v1", "spec", `2026-01-01T00-00-00Z-${planName}`);
      mkdirSync(worktreeSpecDir, { recursive: true });
      writeFileSync(join(worktreeSpecDir, "index.md"), "# Test\n\n- [ ] [subspec](./01-test.md)");
      writeFileSync(
        join(worktreeSpecDir, "01-test.md"),
        "# Test\n\n## Acceptance criteria\n\n- [ ] automated criterion",
      );

      let mergeRan = false;
      const { io, out } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName,
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

    test("--merge markerless plan worktree with no spec still requires an open PR", async () => {
      const planName = "plan-merge-no-spec";
      const worktreeName = `plan-${planName}`;
      const branch = `plan/${planName}`;
      const worktreePath = join(worktreeDir, worktreeName);
      setupWorktree(worktreePath);
      execSync(`git branch -M ${branch}`, { cwd: worktreePath, stdio: "pipe" });

      // No spec in projectRoot, no spec in worktreePath

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          io,
          worktreeName,
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(1);
      expectMergeRefusal(err(), "plan PR", "no PR found");
      expect(mergeRan).toBe(false);
    });
  });

  describe("merge target resolution", () => {
    const completeSpecBody = "# Test\n\n- [x] item 1";
    const greenMergeGh = {
      ghRunner: {
        getPrState: () => ({ state: "OPEN" as const, isDraft: false }),
        getChecks: () => [{ name: "test", status: "success" as const }],
      },
      runGate: () => {},
    };

    function writeCompleteSpec(relPath: string): string {
      const specPath = join(projectRoot, "v1", "spec", relPath);
      mkdirSync(dirname(specPath), { recursive: true });
      writeFileSync(specPath, completeSpecBody);
      return specPath;
    }

    function setupResolvableMergeWorktree(
      worktreeName: string,
      opts?: { branch?: string; markerSpecPath?: string; planBranch?: string },
    ): { worktreePath: string; specPath: string } {
      let worktreePath: string;
      let specPath: string;
      if (opts?.planBranch !== undefined) {
        worktreePath = join(worktreeDir, worktreeName);
        setupWorktree(worktreePath);
        execSync(`git branch -M plan/${opts.planBranch}`, { cwd: worktreePath, stdio: "pipe" });
        const specDir = join(projectRoot, "v1", "spec");
        mkdirSync(specDir, { recursive: true });
        specPath = join(specDir, "test-spec.md");
        writeFileSync(specPath, completeSpecBody);
      } else {
        ({ worktreePath, specPath } = setupMergeWorktree(worktreeName));
        if (opts?.branch !== undefined) {
          execSync(`git branch -M ${opts.branch}`, { cwd: worktreePath, stdio: "pipe" });
        }
      }
      if (opts?.markerSpecPath !== undefined) {
        writeFileSync(join(worktreePath, ".active-spec-path"), opts.markerSpecPath);
      }
      return { worktreePath, specPath };
    }

    test("resolves spec path via spec-directory basename", async () => {
      const worktreeName = "2026-06-27T17-26-00Z-merge-target-by-worktree-or-spec";
      const specPath = writeCompleteSpec(`${worktreeName}/index.md`);
      setupResolvableMergeWorktree(worktreeName, { markerSpecPath: specPath });

      let mergeRan = false;
      const { io, out } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: `v1/spec/${worktreeName}/index.md`,
          ...greenMergeGh,
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(0);
      expect(mergeRan).toBe(true);
      expect(out()).toContain("merged successfully");
    });

    test("resolves spec path via .active-spec-path marker (plan worktree)", async () => {
      const planName = "plan-merge-target";
      const worktreeName = `plan-${planName}`;
      const specPath = writeCompleteSpec("2026-06-27T17-26-00Z-merge-target-by-worktree-or-spec/index.md");
      setupResolvableMergeWorktree(worktreeName, { markerSpecPath: specPath });

      let mergeRan = false;
      const { io } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: specPath,
          ...greenMergeGh,
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(0);
      expect(mergeRan).toBe(true);
    });

    test("resolves timestamped plan spec path via plan-slug without marker", async () => {
      const planName = "triage-resolve-plan-spec-path-merge-target";
      const specBasename = `2026-06-29T21-34-56Z-${planName}`;
      writeCompleteSpec(`${specBasename}/index.md`);
      setupResolvableMergeWorktree(`plan-${planName}`, { planBranch: planName });

      let mergeRan = false;
      const { io, out } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: projectRoot,
          io,
          worktreeName: `v1/spec/${specBasename}/index.md`,
          ...greenMergeGh,
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(0);
      expect(mergeRan).toBe(true);
      expect(out()).toContain("merged successfully");
    });

    test("ambiguous plan spec path (marker vs plan-slug) lists candidates without merge", async () => {
      const planSlug = "merge-target-by-worktree-or-spec";
      const specPath = writeCompleteSpec(`2026-06-27T17-26-00Z-${planSlug}/index.md`);
      setupResolvableMergeWorktree(`plan-${planSlug}`, { planBranch: planSlug });
      setupResolvableMergeWorktree("branch-marker", { markerSpecPath: specPath });

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expect(err()).toContain(`plan-${planSlug}`);
      expect(err()).toContain("branch-marker");
      expect(mergeRan).toBe(false);
    });

    test("resolves bare .md filename via marker scan only", async () => {
      const worktreeName = "branch-1";
      const specPath = writeCompleteSpec("test-spec.md");
      setupResolvableMergeWorktree(worktreeName, { markerSpecPath: specPath });

      let mergeRan = false;
      const { io } = captureIo();
      const code = await triageCommand(
        triageMergeOpts({
          projectRoot,
          cwd: join(projectRoot, "v1", "spec"),
          io,
          worktreeName: "test-spec.md",
          ...greenMergeGh,
          adminMerge: () => {
            mergeRan = true;
          },
        }),
      );

      expect(code).toBe(0);
      expect(mergeRan).toBe(true);
    });

    test("resolves PR reference forms and merges", async () => {
      const worktreeName = "branch-1";
      const branch = "feature-merge-target";
      setupResolvableMergeWorktree(worktreeName, { branch });

      const prForms = ["#42", "42", "https://github.com/acme/repo/pull/42"];
      for (const prRef of prForms) {
        let mergeRan = false;
        const { io, out } = captureIo();
        const code = await triageCommand(
          triageMergeOpts({
            projectRoot,
            cwd: projectRoot,
            io,
            worktreeName: prRef,
            mergeTargetSeams: {
              lookupPrHeadRef: () => ({ ok: true, headRef: branch }),
              findMatchingOpenPrs: () => [{ number: 42, isDraft: false }],
            },
            ...greenMergeGh,
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

    test("numeric worktree name wins over PR number", async () => {
      const worktreeName = "42";
      setupResolvableMergeWorktree(worktreeName);

      let lookupRan = false;
      let mergeRan = false;
      const { io, out } = captureIo();
      const code = await triageCommand(
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
          ...greenMergeGh,
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

    test("unresolvable spec path reports clear error without merge", async () => {
      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "unknown worktree", "no worktree found for spec path");
      expect(mergeRan).toBe(false);
    });

    test("ambiguous spec path lists candidates without merge", async () => {
      const specPath = writeCompleteSpec("shared-spec/index.md");

      setupResolvableMergeWorktree("branch-a", { markerSpecPath: specPath });
      setupResolvableMergeWorktree("branch-b", { markerSpecPath: specPath });

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "unknown worktree", "multiple worktrees match spec path");
      expect(err()).toContain("branch-a");
      expect(err()).toContain("branch-b");
      expect(mergeRan).toBe(false);
    });

    test("PR reference with no local worktree reports clear error", async () => {
      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "unknown worktree", "no local worktree for PR reference");
      expect(mergeRan).toBe(false);
    });

    test("findMatchingOpenPrs refusal at PR-ref resolution", async () => {
      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "unknown worktree", "multiple open PRs match branch dup-branch");
      expect(mergeRan).toBe(false);
    });

    test("findMatchingOpenPrs refusal at merge pre-check", async () => {
      setupResolvableMergeWorktree("branch-1");

      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "implementation PR", "multiple open PRs match branch");
      expect(mergeRan).toBe(false);
    });

    test("gh failure during PR lookup reports error without merge", async () => {
      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "unknown worktree", "failed to look up PR reference");
      expect(err()).toContain("auth required");
      expect(mergeRan).toBe(false);
    });

    test("closed PR at resolution reports error without merge", async () => {
      let mergeRan = false;
      const { io, err } = captureIo();
      const code = await triageCommand(
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
      expectMergeRefusal(err(), "unknown worktree", "PR #5 is closed");
      expect(mergeRan).toBe(false);
    });

    test("drill-down with spec path reports unknown worktree", async () => {
      const { io, err } = captureIo();
      const code = await triageCommand({
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
      expectMergeRefusal(err(), "unknown worktree", "unresolvable target");
    });
  });
});
