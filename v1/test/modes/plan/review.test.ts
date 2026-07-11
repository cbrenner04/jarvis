// review.ts's git operations route through injectable SubprocessRunner / PlanCommitGitOps
// seams (see createFakeGitEnv below), so these cases need no real git/gh subprocess.
// Agent-side behavior is mocked with FakeAgent (no real agent CLI spawns either).
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubprocessRunner } from "../../../../shared/subprocess.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";
import type { Config } from "../../../src/config.ts";
import type { PlanCommitGitOps } from "../../../src/modes/plan/commits.ts";
import {
  hasWorkingTreeChanges,
  runPlanReviewPhase,
  snapshotSpecFiles,
  validateReviewOutput,
} from "../../../src/modes/plan/review.ts";

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.3-codex" };

class FakeAgent implements Agent {
  readonly name: AgentName;
  readonly calls: { prompt: string; cwd: string }[] = [];
  readonly #run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>;

  constructor(
    name: AgentName,
    run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>,
  ) {
    this.name = name;
    this.#run = run;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    this.calls.push({ prompt, cwd: opts.cwd });
    return this.#run(this.calls.length, prompt, opts);
  }

  attributionLabel(): string {
    return `fake-${this.name}`;
  }
}

function makeReviewConfig(opts?: {
  planOrder?: Array<{ agent: AgentName; model: string }>;
  reviewOrder?: Array<{ agent: AgentName; model: string }>;
  reviewPasses?: number;
}): Config {
  const planOrder = opts?.planOrder ?? [CLAUDE_ENTRY, CODEX_ENTRY];
  return {
    version: 2,
    modes: {
      patch: { agentOrder: [CLAUDE_ENTRY] },
      plan: { agentOrder: planOrder },
      prompt: { agentOrder: planOrder },
      review: {
        passes: opts?.reviewPasses ?? 2,
        ...(opts?.reviewOrder !== undefined ? { agentOrder: opts.reviewOrder } : {}),
      },
    },
    quotaFallback: "strict",
    weakQuotaExitCodes: [],
    maxIterations: 10,
    iterationTimeoutMs: 30 * 60_000,
    git: true,
    projects: {},
  };
}

/** Seeds a plain directory (no real git) with a spec dir under `targetDir`. */
function setupReviewFixture(opts?: { name?: string; targetDir?: string }): {
  dir: string;
  specDir: string;
  cleanup: () => void;
} {
  const name = opts?.name ?? "p-review";
  const targetDir = opts?.targetDir ?? "spec";
  const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-review-"));
  const specDir = join(dir, targetDir, name);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "intent.md"), `---\nname: ${name}\n---\n\n# Intent\n\nseed\n`);
  writeFileSync(join(specDir, "index.md"), "# Draft\n\n- [ ] [00](./00-one.md)\n");
  writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
  return { dir, specDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Fakes the git surface review.ts needs for commit:true runs: a SubprocessRunner
 * (status/checkout/clean/reset/add) that diffs the real files on disk against an
 * in-memory "HEAD" snapshot, plus a PlanCommitGitOps that records commits/pushes
 * instead of shelling out. Advances its snapshot on `commit()`, mirroring git.
 */
function createFakeGitEnv(rootDir: string): {
  runner: SubprocessRunner;
  gitOps: PlanCommitGitOps & { commits: string[]; pushed: Array<{ firstPush: boolean }> };
} {
  function walk(dir: string, base: string, into: Map<string, string>): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel, into);
      } else {
        into.set(rel, readFileSync(full, "utf8"));
      }
    }
  }

  function currentState(): Map<string, string> {
    const into = new Map<string, string>();
    walk(rootDir, "", into);
    return into;
  }

  // Mirrors real `git status`: an untracked directory with no tracked descendants is
  // reported as a single `?? dir/` entry, not one entry per file inside it.
  function hasSnapshotUnder(prefix: string): boolean {
    for (const key of snapshot.keys()) {
      if (key === prefix || key.startsWith(`${prefix}/`)) {
        return true;
      }
    }
    return false;
  }

  function records(): string[] {
    const current = currentState();
    const out: string[] = [];
    const untrackedDirsEmitted = new Set<string>();

    for (const [path, content] of current) {
      const before = snapshot.get(path);
      if (before === undefined) {
        const segments = path.split("/");
        let collapsedDir: string | undefined;
        let prefix = "";
        for (let i = 0; i < segments.length - 1; i += 1) {
          prefix = prefix ? `${prefix}/${segments[i]}` : (segments[i] ?? "");
          if (!hasSnapshotUnder(prefix)) {
            collapsedDir = prefix;
            break;
          }
        }
        if (collapsedDir !== undefined) {
          if (!untrackedDirsEmitted.has(collapsedDir)) {
            untrackedDirsEmitted.add(collapsedDir);
            out.push(`?? ${collapsedDir}/`);
          }
        } else {
          out.push(`?? ${path}`);
        }
      } else if (before !== content) {
        out.push(` M ${path}`);
      }
    }
    for (const path of snapshot.keys()) {
      if (!current.has(path)) {
        out.push(` D ${path}`);
      }
    }
    return out;
  }

  function removeUntracked(target: string, relBase: string): void {
    if (!existsSync(target)) {
      return;
    }
    if (statSync(target).isDirectory()) {
      if (!hasSnapshotUnder(relBase)) {
        // Entirely untracked directory: remove it wholesale, like `git clean -fd`.
        rmSync(target, { recursive: true, force: true });
        return;
      }
      for (const entry of readdirSync(target)) {
        removeUntracked(join(target, entry), relBase ? `${relBase}/${entry}` : entry);
      }
      return;
    }
    if (!snapshot.has(relBase)) {
      rmSync(target, { force: true });
    }
  }

  let snapshot = currentState();

  const runner: SubprocessRunner = {
    run(cmd, args) {
      if (cmd !== "git") {
        throw new Error(`unexpected command: ${cmd}`);
      }
      const sub = args[0];
      if (sub === "status") {
        const sep = args.includes("-z") ? "\0" : "\n";
        const list = records();
        return list.length > 0 ? list.join(sep) + sep : "";
      }
      if (sub === "checkout") {
        const file = args[args.length - 1] ?? "";
        const before = snapshot.get(file);
        if (before === undefined) {
          throw new Error("did not match any file(s) known to git");
        }
        writeFileSync(join(rootDir, file), before, "utf8");
        return "";
      }
      if (sub === "clean") {
        const relPath = (args[args.length - 1] ?? "").replace(/\/+$/, "");
        removeUntracked(join(rootDir, relPath), relPath);
        return "";
      }
      if (sub === "add" || sub === "reset") {
        return "";
      }
      return "";
    },
  };

  const gitOps: PlanCommitGitOps & { commits: string[]; pushed: Array<{ firstPush: boolean }> } = {
    commits: [],
    pushed: [],
    add() {
      // No staging concept in the fake: commit() snapshots the working tree directly.
    },
    commit(_cwd, message) {
      gitOps.commits.push(message);
      snapshot = currentState();
    },
    push(_cwd, pushOpts) {
      gitOps.pushed.push(pushOpts);
    },
    hasUpstream() {
      return true;
    },
    porcelainStatus() {
      return records().join("\n");
    },
    projectRoot() {
      return rootDir;
    },
  };

  return { runner, gitOps };
}

function makeIntentDriftActuatorAgent(
  acMarker: string,
  opts?: { adjudicatorVerdict?: string; onActuator?: (agentOpts: AgentRunOptions) => void },
) {
  return new FakeAgent("claude", (_c, prompt, agentOpts) => {
    if (prompt.includes("Review Actuator")) {
      const specRoot = join(agentOpts.cwd, "spec", "p-review");
      writeFileSync(join(specRoot, "00-one.md"), `# One\n\n## Acceptance criteria\n\n- [ ] ${acMarker}\n`, "utf8");
      const intentPath = join(specRoot, "intent.md");
      writeFileSync(intentPath, `${readFileSync(intentPath, "utf8")}\n# dirty\n`, "utf8");
      opts?.onActuator?.(agentOpts);
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (prompt.includes("Review: Adjudicator")) {
      return {
        kind: "ok",
        stdout: opts?.adjudicatorVerdict ?? "Tighten intent.md and the acceptance criterion.\n",
        stderr: "",
      };
    }
    return { kind: "ok", stdout: "", stderr: "" };
  });
}

describe("snapshotSpecFiles", () => {
  test("returns files in deterministic sorted order regardless of disk order", () => {
    const tmpPath = join(tmpdir(), `spec-test-${randomBytes(4).toString("hex")}`);
    const specDir = join(tmpPath, "spec", "test-spec");
    mkdirSync(specDir, { recursive: true });

    const fileOrder = ["z-last.md", "m-middle.md", "a-first.md"];
    for (const file of fileOrder) {
      writeFileSync(join(specDir, file), `# ${file}\n`);
    }

    const snapshot = snapshotSpecFiles(tmpPath, "test-spec");

    const fileMatches = snapshot.match(/<<<FILE name="([^"]+)" BEGIN>>>/g) || [];
    const extractedFiles = fileMatches.map((match) => match.match(/name="([^"]+)"/)?.[1]);

    expect(extractedFiles).toEqual(["a-first.md", "m-middle.md", "z-last.md"]);
  });
});

describe("hasWorkingTreeChanges", () => {
  function fakeRunner(porcelain: string): SubprocessRunner {
    return { run: () => porcelain };
  }

  test("returns false when the fake runner reports a clean tree", () => {
    expect(hasWorkingTreeChanges("/repo", fakeRunner(""))).toBe(false);
  });

  test("returns true when the fake runner reports uncommitted changes", () => {
    expect(hasWorkingTreeChanges("/repo", fakeRunner(" M test.txt\n"))).toBe(true);
  });
});

describe("runPlanReviewPhase", () => {
  test("uses modes.review.agentOrder when set and falls back to modes.plan.agentOrder", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const codex = new FakeAgent("codex", (_c, _p, opts) => {
        writeFileSync(join(opts.cwd, "spec", "p-review", "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] y\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const reviewOrderResult = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ reviewOrder: [CODEX_ENTRY], planOrder: [CLAUDE_ENTRY] }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: (agentName) => {
          if (agentName === "claude") return claude;
          if (agentName === "codex") return codex;
          throw new Error(`unexpected agent: ${agentName}`);
        },
      });
      expect(reviewOrderResult.exitCode).toBe(0);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(3); // 3 roles per cycle

      const fallbackClaude = new FakeAgent("claude", (_c, _p, opts) => {
        writeFileSync(join(opts.cwd, "spec", "p-review", "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] z\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const fallbackCodex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const fallbackResult = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY] }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: (agentName) => {
          if (agentName === "claude") return fallbackClaude;
          if (agentName === "codex") return fallbackCodex;
          throw new Error(`unexpected agent: ${agentName}`);
        },
      });
      expect(fallbackResult.exitCode).toBe(0);
      expect(fallbackClaude.calls).toHaveLength(3); // 3 roles per cycle
      expect(fallbackCodex.calls).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  test("honors --review-passes override, modes.review.passes, and default 2", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const passStarts: number[] = [];
      const noop = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const base = {
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        commit: false,
        specDirPath: specDir,
        createAgent: () => noop,
        onPassStart: (pass: number) => {
          passStarts.push(pass);
        },
      };

      await runPlanReviewPhase({
        ...base,
        config: makeReviewConfig({ reviewPasses: 7 }),
        reviewPassesOverride: 3,
      });
      expect(passStarts).toEqual([1, 2, 3]);

      passStarts.length = 0;
      await runPlanReviewPhase({
        ...base,
        config: makeReviewConfig({ reviewPasses: 4 }),
      });
      expect(passStarts).toEqual([1, 2, 3, 4]);

      passStarts.length = 0;
      await runPlanReviewPhase({
        ...base,
        config: makeReviewConfig({ reviewPasses: 2 }),
      });
      expect(passStarts).toEqual([1, 2]);
    } finally {
      cleanup();
    }
  });

  test("skips commit on no-change passes and appends blockers", async () => {
    const { dir: worktreePath, cleanup } = setupReviewFixture();
    try {
      let err = "";
      const noop = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const noChangeEnv = createFakeGitEnv(worktreePath);
      const noChange = await runPlanReviewPhase(
        {
          worktreePath,
          name: "p-review",
          specDirBasename: "p-review",
          config: makeReviewConfig({ reviewPasses: 1 }),
          commit: true,
          logNoChangeSkip: true,
          stderr: (s) => {
            err += s;
          },
          createAgent: () => noop,
        },
        noChangeEnv,
      );
      expect(noChange.exitCode).toBe(0);
      expect(err).toContain("made no changes; skipping commit");
      expect(noChangeEnv.gitOps.commits.some((m) => m.startsWith("plan: review"))).toBe(false);

      const blockerAgent = new FakeAgent("claude", (_c, _p, opts) => {
        const intentPath = join(opts.cwd, "spec", "p-review", "intent.md");
        const intent = readFileSync(intentPath, "utf8");
        writeFileSync(intentPath, `${intent}\n\n## Blocker\n\nNeed input.\n`);
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const blockerEnv = createFakeGitEnv(worktreePath);
      const blocked = await runPlanReviewPhase(
        {
          worktreePath,
          name: "p-review",
          specDirBasename: "p-review",
          config: makeReviewConfig({ reviewPasses: 1 }),
          commit: true,
          createAgent: () => blockerAgent,
        },
        blockerEnv,
      );
      expect(blocked.exitCode).toBe(1);
      expect(blocked.blocker).toContain("Need input.");
      expect(blockerEnv.gitOps.commits[0]?.split("\n")[0]).toBe("plan: blocker");
    } finally {
      cleanup();
    }
  });

  test("uses resume pass numbering, rK suffix, and refreshes PR body on commit", async () => {
    const { dir: worktreePath, cleanup } = setupReviewFixture();
    try {
      const agent = new FakeAgent("claude", (_c, prompt, opts) => {
        if (prompt.includes("Review Verdict")) {
          writeFileSync(
            join(opts.cwd, "spec", "p-review", "00-one.md"),
            "# One\n\n## Acceptance criteria\n\n- [ ] resume\n",
          );
          return { kind: "ok", stdout: "", stderr: "" };
        }
        if (prompt.includes("Review: Adjudicator")) {
          return { kind: "ok", stdout: "Tighten the resume criterion.\n", stderr: "" };
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });
      let prRefreshCount = 0;
      const env = createFakeGitEnv(worktreePath);
      const result = await runPlanReviewPhase(
        {
          worktreePath,
          name: "p-review",
          specDirBasename: "p-review",
          config: makeReviewConfig({ reviewPasses: 1 }),
          reviewPassesOverride: 1,
          startPassNumber: 3,
          subjectSuffix: "r2",
          commit: true,
          createAgent: () => agent,
          updatePrBody: async () => {
            prRefreshCount += 1;
          },
        },
        env,
      );
      expect(result.exitCode).toBe(0);
      expect(prRefreshCount).toBe(1);
      expect(env.gitOps.commits[env.gitOps.commits.length - 1]?.split("\n")[0]).toBe("plan: review: actuator r2");
    } finally {
      cleanup();
    }
  });

  test("actuator applies verdict to spec files without refining intent", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const intentPath = join(specDir, "intent.md");
      const specPath = join(specDir, "00-one.md");
      const originalIntent = readFileSync(intentPath, "utf8");
      const agent = new FakeAgent("claude", (_c, prompt, _opts) => {
        if (prompt.includes("Review Actuator")) {
          expect(prompt).toContain("Current Spec Files");
          expect(prompt).toContain("Do not edit `intent.md` unless appending a genuine `## Blocker` section.");
          expect(prompt).not.toContain("Intent Refinement Phase");
          expect(prompt).not.toContain("Do not write any other files.");
          writeFileSync(specPath, "# One\n\n## Acceptance criteria\n\n- [ ] verdict applied\n", "utf8");
          return { kind: "ok", stdout: "", stderr: "" };
        }
        if (prompt.includes("Review: Adjudicator")) {
          return { kind: "ok", stdout: "Add a concrete acceptance criterion.\n", stderr: "" };
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const stderr: string[] = [];
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY], reviewPasses: 1 }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: () => agent,
        stderr: (line) => stderr.push(line),
      });

      expect(result.exitCode, stderr.join("")).toBe(0);
      expect(readFileSync(intentPath, "utf8")).toBe(originalIntent);
      expect(readFileSync(specPath, "utf8")).toContain("verdict applied");
    } finally {
      cleanup();
    }
  });

  test("actuator turns an oversized verdict into a complete linked split tree", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const originalIntent = readFileSync(join(specDir, "intent.md"), "utf8");
      const originalTask = "Add builder behavior";
      const originalOutcome = "Builder behavior is verified";
      const originalWiringTask = "Wire builder behavior";
      const originalWiringOutcome = "Wiring behavior is verified";
      writeFileSync(
        join(specDir, "00-one.md"),
        `# Oversized\n\n## Tasks\n\n- ${originalTask}\n- ${originalWiringTask}\n\n## Acceptance criteria\n\n- [ ] ${originalOutcome}\n- [ ] ${originalWiringOutcome}\n`,
        "utf8",
      );
      const agent = new FakeAgent("claude", (_c, prompt, opts) => {
        if (prompt.includes("Review Actuator")) {
          expect(prompt).toContain("Preserve every original task and acceptance outcome exactly once");
          expect(prompt).toContain("link every replacement from `index.md`");
          rmSync(join(opts.cwd, "spec", "p-review", "00-one.md"));
          writeFileSync(
            join(opts.cwd, "spec", "p-review", "index.md"),
            "# Draft\n\n- [ ] [00 - Builder](./00-builder.md)\n- [ ] [01 - Wiring](./01-wiring.md)\n",
            "utf8",
          );
          writeFileSync(
            join(opts.cwd, "spec", "p-review", "00-builder.md"),
            `# Builder\n\n## Tasks\n\n- ${originalTask}\n\n## Acceptance criteria\n\n- [ ] ${originalOutcome}\n`,
            "utf8",
          );
          writeFileSync(
            join(opts.cwd, "spec", "p-review", "01-wiring.md"),
            `# Wiring\n\n## Tasks\n\n- ${originalWiringTask}\n\n## Acceptance criteria\n\n- [ ] ${originalWiringOutcome}\n`,
            "utf8",
          );
          return { kind: "ok", stdout: "", stderr: "" };
        }
        if (prompt.includes("Review: Adjudicator")) {
          return {
            kind: "ok",
            stdout:
              "Split the oversized subspec. Preserve every original task and acceptance outcome exactly once and link each replacement from the index.\n",
            stderr: "",
          };
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY], reviewPasses: 1 }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: () => agent,
      });

      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(specDir, "intent.md"), "utf8")).toBe(originalIntent);
      expect(existsSync(join(specDir, "00-one.md"))).toBe(false);
      const index = readFileSync(join(specDir, "index.md"), "utf8");
      expect(index).toContain("(./00-builder.md)");
      expect(index).toContain("(./01-wiring.md)");
      const replacements = `${readFileSync(join(specDir, "00-builder.md"), "utf8")}${readFileSync(join(specDir, "01-wiring.md"), "utf8")}`;
      for (const item of [originalTask, originalOutcome, originalWiringTask, originalWiringOutcome]) {
        expect(replacements.split(item)).toHaveLength(2);
      }
    } finally {
      cleanup();
    }
  });

  test("rejects malformed oversized splits", async () => {
    const cases = [
      {
        name: "orphaned task",
        builder: "- Add builder behavior\n\n## Acceptance criteria\n\n- [ ] Builder behavior is verified\n",
        wiring: "## Acceptance criteria\n\n- [ ] Wiring behavior is verified\n",
        links: 2,
      },
      {
        name: "duplicated outcome",
        builder: "- Add builder behavior\n\n## Acceptance criteria\n\n- [ ] Builder behavior is verified\n",
        wiring:
          "- Wire builder behavior\n\n## Acceptance criteria\n\n- [ ] Wiring behavior is verified\n- [ ] Builder behavior is verified\n",
        links: 2,
      },
      {
        name: "unlinked replacement",
        builder: "- Add builder behavior\n\n## Acceptance criteria\n\n- [ ] Builder behavior is verified\n",
        wiring: "- Wire builder behavior\n\n## Acceptance criteria\n\n- [ ] Wiring behavior is verified\n",
        links: 1,
      },
    ];

    for (const malformed of cases) {
      const { dir, specDir, cleanup } = setupReviewFixture();
      try {
        writeFileSync(
          join(specDir, "00-one.md"),
          "# Oversized\n\n## Tasks\n\n- Add builder behavior\n- Wire builder behavior\n\n## Acceptance criteria\n\n- [ ] Builder behavior is verified\n- [ ] Wiring behavior is verified\n",
          "utf8",
        );
        const agent = new FakeAgent("claude", (_c, prompt, opts) => {
          if (prompt.includes("Review Actuator")) {
            rmSync(join(opts.cwd, "spec", "p-review", "00-one.md"));
            writeFileSync(
              join(opts.cwd, "spec", "p-review", "index.md"),
              `# Draft\n\n- [ ] [00 - Builder](./00-builder.md)${malformed.links === 2 ? "\n- [ ] [01 - Wiring](./01-wiring.md)" : ""}\n`,
            );
            writeFileSync(
              join(opts.cwd, "spec", "p-review", "00-builder.md"),
              `# Builder\n\n## Tasks\n\n${malformed.builder}`,
            );
            writeFileSync(
              join(opts.cwd, "spec", "p-review", "01-wiring.md"),
              `# Wiring\n\n## Tasks\n\n${malformed.wiring}`,
            );
            return { kind: "ok", stdout: "", stderr: "" };
          }
          if (prompt.includes("Review: Adjudicator")) {
            return { kind: "ok", stdout: "Split the oversized subspec.\n", stderr: "" };
          }
          return { kind: "ok", stdout: "", stderr: "" };
        });
        const stderr: string[] = [];
        const result = await runPlanReviewPhase({
          worktreePath: dir,
          name: "p-review",
          specDirBasename: "p-review",
          config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY], reviewPasses: 1 }),
          reviewPassesOverride: 1,
          commit: false,
          specDirPath: specDir,
          createAgent: () => agent,
          stderr: (line) => stderr.push(line),
        });

        expect(result.exitCode, malformed.name).toBe(1);
        expect(stderr.join("")).toContain("actuator split validation failed");
      } finally {
        cleanup();
      }
    }
  });

  test("recovers immutable-only intent.md drift on commit:false and emits notice", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const intentPath = join(specDir, "intent.md");
      const specPath = join(specDir, "00-one.md");
      const originalIntent = readFileSync(intentPath, "utf8");
      const stderr: string[] = [];
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY], reviewPasses: 1 }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: () => makeIntentDriftActuatorAgent("recovered"),
        stderr: (line) => stderr.push(line),
      });

      const err = stderr.join("");
      expect(result.exitCode, err).toBe(0);
      expect(readFileSync(intentPath, "utf8")).toBe(originalIntent);
      expect(readFileSync(specPath, "utf8")).toContain("recovered");
      expect(err).toContain("plan: actuator reverted immutable-copy overreach:");
      expect(err).toContain("  intent.md");
      expect(err).toContain("verdict requirements for intent.md were not applied");
    } finally {
      cleanup();
    }
  });

  test("recovers immutable-only intent.md drift on commit:true and commits actuator pass", async () => {
    const { dir: worktreePath, specDir, cleanup } = setupReviewFixture();
    try {
      const intentPath = join(specDir, "intent.md");
      const specPath = join(specDir, "00-one.md");
      const originalIntent = readFileSync(intentPath, "utf8");
      let stderr = "";
      const env = createFakeGitEnv(worktreePath);
      const result = await runPlanReviewPhase(
        {
          worktreePath,
          name: "p-review",
          specDirBasename: "p-review",
          config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY], reviewPasses: 1 }),
          reviewPassesOverride: 1,
          commit: true,
          createAgent: () =>
            makeIntentDriftActuatorAgent("committed-recovery", {
              adjudicatorVerdict: "Add a concrete acceptance criterion.\n",
            }),
          stderr: (line) => {
            stderr += line;
          },
        },
        env,
      );

      expect(result.exitCode, stderr).toBe(0);
      expect(readFileSync(intentPath, "utf8")).toBe(originalIntent);
      expect(readFileSync(specPath, "utf8")).toContain("committed-recovery");
      expect(stderr).toContain("plan: actuator reverted immutable-copy overreach:");
      expect(env.gitOps.commits[env.gitOps.commits.length - 1]?.split("\n")[0]).toBe("plan: review: actuator");
    } finally {
      cleanup();
    }
  });

  test("does not recover when intent drift coexists with missing index.md", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const intentPath = join(specDir, "intent.md");
      const specPath = join(specDir, "00-one.md");
      const indexPath = join(specDir, "index.md");
      const originalIntent = readFileSync(intentPath, "utf8");
      let stderr = "";
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY], reviewPasses: 1 }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: () =>
          makeIntentDriftActuatorAgent("still-fails", {
            adjudicatorVerdict: "Tighten the spec.\n",
            onActuator: (agentOpts) => rmSync(join(agentOpts.cwd, "spec", "p-review", "index.md")),
          }),
        stderr: (line) => {
          stderr += line;
        },
      });

      expect(result.exitCode).toBe(1);
      expect(stderr).toContain("plan: actuator validation failed: index.md was deleted");
      expect(stderr).not.toContain("reverted immutable-copy overreach");
      expect(readFileSync(intentPath, "utf8")).toBe(originalIntent);
      expect(readFileSync(specPath, "utf8")).toContain("still-fails");
      expect(existsSync(indexPath)).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("does not recover invalid blocker composite on intent.md", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const agent = new FakeAgent("claude", (_c, prompt, opts) => {
        if (prompt.includes("Review Actuator")) {
          writeFileSync(
            join(opts.cwd, "spec", "p-review", "00-one.md"),
            "# One\n\n## Acceptance criteria\n\n- [ ] blocked\n",
            "utf8",
          );
          writeFileSync(
            join(opts.cwd, "spec", "p-review", "intent.md"),
            "---\nname: beta\n---\n\n# Intent\n\nseed\n\n## Blocker\n\nNeed input.\n",
            "utf8",
          );
          return { kind: "ok", stdout: "", stderr: "" };
        }
        if (prompt.includes("Review: Adjudicator")) {
          return { kind: "ok", stdout: "Add a blocker.\n", stderr: "" };
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      let stderr = "";
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY], reviewPasses: 1 }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: () => agent,
        stderr: (line) => {
          stderr += line;
        },
      });

      expect(result.exitCode).toBe(1);
      expect(stderr).toContain("frontmatter is immutable");
      expect(stderr).not.toContain("reverted immutable-copy overreach");
    } finally {
      cleanup();
    }
  });

  test("reverts out-of-bounds actuator writes before commit when specDirPath is unset", async () => {
    const targetDir = "v1/spec";
    const name = "2026-06-25T23-59-59Z-review-target";
    const { dir: worktreePath, cleanup } = setupReviewFixture({ name, targetDir });
    try {
      const env = createFakeGitEnv(worktreePath);
      const strayDir = join(worktreePath, name);
      const strayFile = join(strayDir, "00-stray.md");
      let stderr = "";
      const agent = new FakeAgent("claude", (_c, prompt, _opts) => {
        if (prompt.includes("Review Actuator")) {
          mkdirSync(strayDir, { recursive: true });
          writeFileSync(strayFile, "# stray\n", "utf8");
          return { kind: "ok", stdout: "", stderr: "" };
        }
        if (prompt.includes("Review: Adjudicator")) {
          return { kind: "ok", stdout: "Keep the current spec; no in-bounds edits required.\n", stderr: "" };
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const result = await runPlanReviewPhase(
        {
          worktreePath,
          name,
          specDirBasename: name,
          config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY], reviewPasses: 1 }),
          reviewPassesOverride: 1,
          commit: true,
          checkBoundary: true,
          targetDir,
          createAgent: () => agent,
          stderr: (line) => {
            stderr += line;
          },
        },
        env,
      );

      expect(result.exitCode).toBe(1);
      expect(stderr).toContain("plan: actuator boundary violation detected before commit");
      expect(stderr).toContain(`${name}/`);
      expect(existsSync(strayFile)).toBe(false);
      expect(existsSync(strayDir)).toBe(false);
      expect(env.gitOps.commits).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  test("git-disabled review skips target-repo git-status boundary on worktree roots", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "jarvis-plan-review-worktree-"));
    const cfgDir = join(tmp, "cfg");
    const project = join(tmp, "project");
    try {
      mkdirSync(project, { recursive: true });
      const specDir = join(cfgDir, "specs", "project", "review-git-false");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: review-git-false\n---\n\n# Intent\n\nseed\n");
      writeFileSync(join(specDir, "index.md"), "# Draft\n\nrepo: project\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");

      // Dirty file in the target-repo checkout: the git-status boundary check must
      // be skipped entirely (gitEnabled: false), so this is never inspected.
      mkdirSync(join(project, "spec", "unrelated"), { recursive: true });
      writeFileSync(join(project, "spec", "unrelated", "note.md"), "dirty\n");

      const agent = new FakeAgent("claude", (_c, prompt, _opts) => {
        if (prompt.includes("Review Verdict")) {
          writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] y\n");
          return { kind: "ok", stdout: "", stderr: "" };
        }
        if (prompt.includes("Review: Adjudicator")) {
          return { kind: "ok", stdout: "Tighten the spec.\n", stderr: "" };
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      let stderr = "";
      const result = await runPlanReviewPhase({
        worktreePath: project,
        projectRoot: project,
        name: "review-git-false",
        specDirBasename: "review-git-false",
        config: makeReviewConfig({ reviewPasses: 1 }),
        reviewPassesOverride: 1,
        commit: false,
        gitEnabled: false,
        checkBoundary: true,
        specDirPath: specDir,
        externalSpecRoot: join(cfgDir, "specs", "project"),
        stderr: (s) => {
          stderr += s;
        },
        createAgent: () => agent,
      });

      expect(result.exitCode, stderr).toBe(0);
      expect(stderr).not.toContain("boundary violation");
      expect(readFileSync(join(specDir, "00-one.md"), "utf8")).toContain("- [ ] y");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("validateReviewOutput", () => {
  test("rejects frontmatter edits even when blocker is appended", () => {
    const tmpPath = join(tmpdir(), `review-frontmatter-${randomBytes(4).toString("hex")}`);
    const specDir = join(tmpPath, "spec", "test-spec");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# Index\n", "utf8");

    const intentBefore = "---\nname: alpha\n---\n\n# Intent\nbody\n";
    const intentAfter = "---\nname: beta\n---\n\n# Intent\nbody\n\n## Blocker\n\nNeed input.\n";
    writeFileSync(join(specDir, "intent.md"), intentAfter, "utf8");

    const result = validateReviewOutput(tmpPath, "test-spec", intentBefore);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("frontmatter is immutable");
  });
});

describe("read-only reviewer enforcement", () => {
  test("reverts spec edits from adversary role and continues review", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      let adversaryEdited = false;
      const adversaryAgent = new FakeAgent("claude", (_c, _p, opts) => {
        // Adversary tries to edit the spec
        writeFileSync(
          join(opts.cwd, "spec", "p-review", "00-one.md"),
          "# ONE EDITED\n\n## Acceptance criteria\n\n- [x] hacked\n",
        );
        adversaryEdited = true;
        return { kind: "ok", stdout: "adversary findings", stderr: "" };
      });

      const advocateAgent = new FakeAgent("claude", (_c, _p, opts) => {
        // Advocate should see the original spec (adversary's edit was reverted)
        const spec = readFileSync(join(opts.cwd, "spec", "p-review", "00-one.md"), "utf8");
        expect(spec).not.toContain("EDITED");
        expect(spec).toContain("# One");
        return { kind: "ok", stdout: "advocate rebuttal", stderr: "" };
      });

      const adjudicatorAgent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

      let agentCallCount = 0;
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY] }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: (_agentName) => {
          agentCallCount += 1;
          if (agentCallCount === 1) return adversaryAgent;
          if (agentCallCount === 2) return advocateAgent;
          return adjudicatorAgent;
        },
      });

      expect(result.exitCode).toBe(0);
      expect(adversaryEdited).toBe(true);
      expect(advocateAgent.calls).toHaveLength(1);
      const finalSpec = readFileSync(join(dir, "spec", "p-review", "00-one.md"), "utf8");
      expect(finalSpec).toContain("# One");
      expect(finalSpec).not.toContain("EDITED");
    } finally {
      cleanup();
    }
  });

  test("reverts spec edits from advocate role", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const adversaryAgent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "adversary findings", stderr: "" }));

      const advocateAgent = new FakeAgent("claude", (_c, _p, opts) => {
        writeFileSync(join(opts.cwd, "spec", "p-review", "00-one.md"), "# ADVOCATE HACKED\n");
        return { kind: "ok", stdout: "advocate rebuttal", stderr: "" };
      });

      const adjudicatorAgent = new FakeAgent("claude", (_c, _p, opts) => {
        const spec = readFileSync(join(opts.cwd, "spec", "p-review", "00-one.md"), "utf8");
        expect(spec).not.toContain("HACKED");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      let agentCallCount = 0;
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY] }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: (_agentName) => {
          agentCallCount += 1;
          if (agentCallCount === 1) return adversaryAgent;
          if (agentCallCount === 2) return advocateAgent;
          return adjudicatorAgent;
        },
      });

      expect(result.exitCode).toBe(0);
      expect(adjudicatorAgent.calls).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("reverts spec edits from adjudicator role", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const adversaryAgent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "adversary", stderr: "" }));
      const advocateAgent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "advocacy", stderr: "" }));

      const adjudicatorAgent = new FakeAgent("claude", (_c, _p, opts) => {
        writeFileSync(join(opts.cwd, "spec", "p-review", "00-one.md"), "# ADJUDICATOR MODIFIED\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      let agentCallCount = 0;
      let stderr = "";
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY] }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        stderr: (s) => {
          stderr += s;
        },
        createAgent: (_agentName) => {
          agentCallCount += 1;
          if (agentCallCount === 1) return adversaryAgent;
          if (agentCallCount === 2) return advocateAgent;
          return adjudicatorAgent;
        },
      });

      expect(result.exitCode).toBe(0);
      const finalSpec = readFileSync(join(dir, "spec", "p-review", "00-one.md"), "utf8");
      expect(finalSpec).toContain("# One");
      expect(finalSpec).not.toContain("ADJUDICATOR MODIFIED");
      expect(stderr).toContain("edited spec files (reverting)");
    } finally {
      cleanup();
    }
  });
});

describe("verdict → refine seam", () => {
  test("passes prior role artifacts to next reviewer", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const adversaryFindings = "## Adversary Findings\n- Issue 1\n- Issue 2\n";
      const advocateRebuttal = "## Advocacy Rebuttal\n- Addressed Issue 1\n- Issue 2 is unavoidable\n";

      const adversaryAgent = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: adversaryFindings,
        stderr: "",
      }));

      const advocateAgent = new FakeAgent("claude", (_c, prompt) => {
        expect(prompt).toContain(adversaryFindings);
        return { kind: "ok", stdout: advocateRebuttal, stderr: "" };
      });

      const adjudicatorAgent = new FakeAgent("claude", (_c, prompt) => {
        expect(prompt).toContain(advocateRebuttal);
        return { kind: "ok", stdout: "", stderr: "" };
      });

      let agentCallCount = 0;
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY] }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: (_agentName) => {
          agentCallCount += 1;
          if (agentCallCount === 1) return adversaryAgent;
          if (agentCallCount === 2) return advocateAgent;
          return adjudicatorAgent;
        },
      });

      expect(result.exitCode).toBe(0);
      expect(advocateAgent.calls).toHaveLength(1);
      expect(adjudicatorAgent.calls).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("persists verdict to verdict-plan.md in spec directory when actuator would run", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const verdict =
        "## Spec Verdict\n\nThe spec needs refinement based on:\n- Missing acceptance criteria\n- Unclear intent\n";

      const adversaryAgent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const advocateAgent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const adjudicatorAgent = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: verdict,
        stderr: "",
      }));

      let agentCallCount = 0;
      await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY] }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: (_agentName) => {
          agentCallCount += 1;
          if (agentCallCount === 1) return adversaryAgent;
          if (agentCallCount === 2) return advocateAgent;
          return adjudicatorAgent;
        },
      });

      // Actuator will fail due to missing agent factory, but verdict should still be written
      // (written before the actuator is invoked).
      const verdictPath = join(specDir, "verdict-plan.md");
      const savedVerdict = readFileSync(verdictPath, "utf8");
      expect(savedVerdict).toContain("Spec Verdict");
      expect(savedVerdict).toContain("Missing acceptance criteria");
    } finally {
      cleanup();
    }
  });

  test("skips verdict persistence and actuator when adjudicator returns empty verdict", async () => {
    const { dir, specDir, cleanup } = setupReviewFixture();
    try {
      const adversaryAgent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const advocateAgent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const adjudicatorAgent = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "", // Empty verdict
        stderr: "",
      }));

      let agentCallCount = 0;
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY] }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: (_agentName) => {
          agentCallCount += 1;
          if (agentCallCount === 1) return adversaryAgent;
          if (agentCallCount === 2) return advocateAgent;
          return adjudicatorAgent;
        },
      });

      expect(result.exitCode).toBe(0);
      // Verdict file was NOT created (verdict was empty, so actuator was skipped).
      expect(existsSync(join(specDir, "verdict-plan.md"))).toBe(false);
    } finally {
      cleanup();
    }
  });
});
