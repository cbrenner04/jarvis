import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { planCommand, renderPlanRefineHandoffNextSteps } from "../src/commands/plan.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";
import { hasGenuineBlocker, isLegacyReviewGateBlocker } from "../src/modes/plan/blocker.ts";

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };

const okLogClient: LogClient = {
  assertReachable: async () => {},
  send: async () => {},
};

function captureIo() {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s: string) => {
        out += s;
      },
      stderr: (s: string) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

type AgentMode = "ok" | "refine-blocker" | "refine-skip";

class HandoffAgent implements Agent {
  readonly name: AgentName = "claude";
  readonly #mode: AgentMode;

  constructor(mode: AgentMode = "ok") {
    this.#mode = mode;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    if (prompt.includes("Intent Draft Phase")) {
      const intentPath = join(opts.cwd, "intent.md");
      const current = readFileSync(intentPath, "utf8");
      const rawBegin = current.indexOf("<<<RAW_SEED_BEGIN>>>");
      const rawEnd = current.indexOf("<<<RAW_SEED_END>>>");
      const rawBlock = current.slice(rawBegin, rawEnd + "<<<RAW_SEED_END>>>".length);
      writeFileSync(
        intentPath,
        `---
name: handoff-plan
---

## Raw seed

${rawBlock}

## Intent

Drafted.
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (prompt.includes("Intent Refinement Phase")) {
      const intentPath = findIntentPath(opts.cwd);
      if (intentPath !== null) {
        const body = readFileSync(intentPath, "utf8");
        if (this.#mode === "refine-blocker") {
          writeFileSync(intentPath, `${body.trimEnd()}\n\n## Blocker\n\nNeed human input on scope.\n`, "utf8");
        } else if (this.#mode === "refine-skip") {
          writeFileSync(intentPath, `${body.trimEnd()}\n\n## Refine skip\n`, "utf8");
        }
      }
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (prompt.includes("Draft Phase")) {
      const intentPath = findIntentPath(opts.cwd);
      if (intentPath !== null) {
        const specDir = dirname(intentPath);
        mkdirSync(specDir, { recursive: true });
        writeFileSync(join(specDir, "index.md"), "# Draft spec\n\n- [ ] [00 - One](./00-one.md)\n");
        writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One.\n");
      }
      return { kind: "ok", stdout: "", stderr: "" };
    }
    return { kind: "ok", stdout: "", stderr: "" };
  }

  attributionLabel(): string {
    return "fake-claude";
  }
}

function findIntentPath(cwd: string): string | null {
  const walk = (dir: string, depth: number): string | null => {
    if (!existsSync(dir) || depth > 5) {
      return null;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isFile() && entry.name === "intent.md") {
        return full;
      }
      if (entry.isDirectory()) {
        const nested = walk(full, depth + 1);
        if (nested !== null) {
          return nested;
        }
      }
    }
    return null;
  };
  return walk(cwd, 0);
}

function setupHandoffEnv() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-handoff-"));
  const cfgDir = join(dir, "cfg");
  const projectRoot = join(dir, "project");
  const origin = join(dir, "origin.git");

  mkdirSync(projectRoot);
  mkdirSync(origin);
  registerProject("project", projectRoot, { dir: cfgDir });

  execSync("git init --bare -b main", { cwd: origin });
  execSync("git init -b main", { cwd: projectRoot });
  execSync("git config user.email 'test@example.com'", { cwd: projectRoot });
  execSync("git config user.name 'Test User'", { cwd: projectRoot });
  writeFileSync(join(projectRoot, "README.md"), "test\n");
  execSync("git add README.md", { cwd: projectRoot });
  execSync("git commit -m 'initial'", { cwd: projectRoot });
  execSync(`git remote add origin ${origin}`, { cwd: projectRoot });
  execSync("git push -u origin main", { cwd: projectRoot });

  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  const realGh = execSync("command -v gh", { encoding: "utf8" }).trim();
  const gh = join(binDir, "gh");
  const prState = join(dir, "pr-state");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1 $2" == "repo view" ]]; then printf 'main\\n'; exit 0; fi
if [[ "$1 $2" == "pr view" ]]; then
  if [[ "$*" == *"--json url"* ]]; then printf 'https://example.com/pull/1\\n'
  elif [[ "$*" == *"--json number"* ]]; then printf '1\\n'
  elif [[ "$*" == *"isDraft"* ]]; then printf 'true\\n'
  else printf '1\\n'; fi
  exit 0
fi
if [[ "$1 $2" == "pr create" ]]; then touch "${prState}"; exit 0; fi
if [[ "$1 $2" == "pr ready" ]]; then exit 0; fi
if [[ "$1 $2" == "pr edit" ]]; then exit 0; fi
exec "${realGh}" "$@"
`,
  );
  execSync(`chmod +x ${gh}`);
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;

  const cfg = loadConfig({ dir: cfgDir });
  cfg.modes.plan.agentOrder = [CLAUDE_ENTRY];
  cfg.modes.review = { passes: 1 };
  writeConfig(cfg, { dir: cfgDir });

  return {
    projectRoot,
    cfgDir,
    prState,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function planCommitSubjects(worktreePath: string): string[] {
  return execSync("git log --format=%s", { cwd: worktreePath, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("plan: "));
}

describe("plan intent refine handoff", () => {
  test("committed fresh run creates plan: intent then plan: refine and exits 0 with resume-draft handoff", async () => {
    const env = setupHandoffEnv();
    try {
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--review-passes", "0", "seed prompt"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: () => new HandoffAgent("refine-skip"),
      });

      expect(code).toBe(0);
      expect(cap.err()).toContain("plan: intent commit pushed");
      expect(cap.err()).toContain("plan: refine commit pushed");
      expect(cap.err()).toMatch(/plan: draft PR #1 (opened|updated)/);
      expect(cap.err()).not.toContain("plan: blocked");
      expect(cap.out()).toContain("jarvis1 plan --resume-draft spec/");
      expect(cap.out()).toContain("/intent.md");
      expect(cap.out()).not.toContain("## Blocker");

      const worktreePath = join(env.projectRoot, ".worktree", "plan-handoff-plan");
      const subjects = planCommitSubjects(worktreePath);
      expect(subjects[0]).toBe("plan: refine");
      expect(subjects[1]).toBe("plan: intent");
    } finally {
      env.cleanup();
    }
  });

  test("committed --refine-turns 0 creates plan: intent only and same handoff", async () => {
    const env = setupHandoffEnv();
    try {
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--refine-turns", "0", "--review-passes", "0", "intent only"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: () => new HandoffAgent(),
      });

      expect(code).toBe(0);
      expect(cap.err()).toContain("plan: intent commit pushed");
      expect(cap.err()).toContain("plan: refine: skipped");
      expect(cap.err()).not.toContain("plan: refine commit pushed");
      expect(cap.out()).toContain("jarvis1 plan --resume-draft spec/");

      const worktreePath = join(env.projectRoot, ".worktree", "plan-handoff-plan");
      const subjects = planCommitSubjects(worktreePath);
      expect(subjects).toEqual(["plan: intent"]);
    } finally {
      env.cleanup();
    }
  });

  test("genuine refine blocker commits plan: blocker and exits 1 without synthetic gate", async () => {
    const env = setupHandoffEnv();
    try {
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--review-passes", "0", "blocker seed"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: () => new HandoffAgent("refine-blocker"),
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain("plan: blocked");
      expect(cap.err()).toContain("Need human input on scope");
      expect(cap.out()).not.toContain("Review and approve");

      const worktreePath = join(env.projectRoot, ".worktree", "plan-handoff-plan");
      const subjects = planCommitSubjects(worktreePath);
      expect(subjects[0]).toBe("plan: blocker");
      expect(subjects[1]).toBe("plan: refine");
      expect(subjects[2]).toBe("plan: intent");
    } finally {
      env.cleanup();
    }
  });

  test("default refine budget is one turn", async () => {
    const env = setupHandoffEnv();
    try {
      let refineCalls = 0;
      const agent: Agent = {
        name: "claude",
        async run(prompt: string, opts: AgentRunOptions) {
          const handoff = new HandoffAgent("refine-skip");
          if (prompt.includes("Intent Refinement Phase")) {
            refineCalls += 1;
          }
          return handoff.run(prompt, opts);
        },
        attributionLabel: () => "fake-claude",
      };

      await planCommand({
        io: captureIo().io,
        args: ["--review-passes", "0", "one turn default"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: () => agent,
      });

      expect(refineCalls).toBe(1);
    } finally {
      env.cleanup();
    }
  });
});

describe("legacy review gate blocker detection", () => {
  test("isLegacyReviewGateBlocker recognizes historical gate text", () => {
    const body = `Review and approve \`spec/foo/intent.md\` before drafting subspecs.

Resume drafting once approved:
\`jarvis1 plan --resume-draft spec/foo/intent.md\``;
    expect(isLegacyReviewGateBlocker(body)).toBe(true);
    expect(hasGenuineBlocker(`## Blocker\n\n${body}`)).toBe(false);
  });

  test("hasGenuineBlocker rejects real agent blockers", () => {
    const content = "## Blocker\n\nNeed clarification on API surface.\n";
    expect(hasGenuineBlocker(content)).toBe(true);
    expect(isLegacyReviewGateBlocker("Need clarification on API surface.")).toBe(false);
  });
});

function legacyGateIntentBody(): string {
  return `---
name: handoff-plan
---

## Raw seed

<<<RAW_SEED_BEGIN>>>
seed prompt
<<<RAW_SEED_END>>>

## Intent

Drafted.

## Blocker

Review and approve \`spec/handoff-plan/intent.md\` before drafting subspecs.

Resume drafting once approved:
\`jarvis1 plan --resume-draft spec/handoff-plan/intent.md\`
`;
}

function setupResumeDraftEnv(intentBody: string) {
  const env = setupHandoffEnv();
  const specDir = "handoff-plan";
  const planName = "handoff-plan";
  const worktreePath = join(env.projectRoot, ".worktree", `plan-${planName}`);

  execSync(`git checkout -b plan/${planName}`, { cwd: env.projectRoot });
  mkdirSync(join(env.projectRoot, "spec", specDir), { recursive: true });
  writeFileSync(join(env.projectRoot, "spec", specDir, "intent.md"), intentBody, "utf8");
  execSync("git add spec", { cwd: env.projectRoot });
  execSync("git commit -m 'plan: intent'", { cwd: env.projectRoot });
  execSync(`git push -u origin plan/${planName}`, { cwd: env.projectRoot });
  execSync("git checkout main", { cwd: env.projectRoot });
  execSync(`git worktree add --checkout "${worktreePath}" "plan/${planName}"`, { cwd: env.projectRoot });

  return { ...env, specDir, worktreePath };
}

describe("resume-draft integration", () => {
  test("proceeds when only the historical generated gate blocker is present", async () => {
    const env = setupResumeDraftEnv(legacyGateIntentBody());
    try {
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--resume-draft", join(env.worktreePath, "spec", env.specDir, "intent.md"), "--review-passes", "1"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: () => new HandoffAgent("refine-skip"),
      });

      expect(cap.err()).not.toContain("--resume-draft requires `## Blocker` to be cleared");
      expect(cap.err()).toContain("plan: resume r1 started");
      expect(existsSync(join(env.worktreePath, "spec", env.specDir, "index.md"))).toBe(true);
    } finally {
      env.cleanup();
    }
  });

  test("refuses when a genuine ## Blocker exists", async () => {
    const env = setupResumeDraftEnv(`---
name: handoff-plan
---

## Intent

Need scope.

## Blocker

Need clarification on API surface.
`);
    try {
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--resume-draft", join(env.worktreePath, "spec", env.specDir, "intent.md")],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: () => new HandoffAgent("refine-skip"),
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain("--resume-draft requires `## Blocker` to be cleared");
    } finally {
      env.cleanup();
    }
  });
});

describe("renderPlanRefineHandoffNextSteps", () => {
  test("prints review PR then resume-draft command", () => {
    const text = renderPlanRefineHandoffNextSteps({
      prUrl: "https://example.com/pull/1",
      specDirBasename: "2026-06-14T12-00-00Z-my-plan",
      targetDir: "v1/spec",
    });
    expect(text).toContain("Review the draft PR: https://example.com/pull/1");
    expect(text).toContain("jarvis1 plan --resume-draft v1/spec/2026-06-14T12-00-00Z-my-plan/intent.md");
  });
});
