// Plan-command integration tests use FakeAgent and filesystem fixtures; no real git/gh subprocesses.
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import {
  parseIntentFrontmatter,
  planCommand,
  renderPlanNextSteps,
  resolveResumeSpecPath,
} from "../src/commands/plan.ts";
import type { PlanInvocation } from "../src/commands/plan-args.ts";
import { describePlanInvocation, parsePlanArgs } from "../src/commands/plan-args.ts";
import type { Config } from "../src/config.ts";
import { loadConfig, registerProject, resolveReviewPasses, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";
import { runPlanReviewPhase } from "../src/modes/plan/review.ts";

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

const okLogClient: LogClient = {
  assertReachable: async () => {},
  send: async () => {},
};

/** Write a minimal valid ready-intent under `<baseDir>/ready-intents/<name>.md` and return its path. */
function writeReadyIntent(baseDir: string, name = "my-feature"): string {
  const dir = join(baseDir, "ready-intents");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  writeFileSync(path, `---\nname: ${name}\n---\n\n## Prerequisites\n\nnone\n`);
  return path;
}

function capturingLogClient(): {
  client: LogClient;
  harnessTexts: string[];
} {
  const harnessTexts: string[] = [];
  return {
    harnessTexts,
    client: {
      assertReachable: async () => {},
      send: async (m) => {
        if (m.tag === "harness") {
          harnessTexts.push(m.text);
        }
      },
    },
  };
}

function setupRegisteredProject() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-cmd-"));
  const cfgDir = join(dir, "cfg");
  const project = join(dir, "project");
  mkdirSync(project);
  registerProject("project", project, { dir: cfgDir });
  return { dir, cfgDir, project };
}

/** Mark `dir` as a git checkout for ad-hoc project resolution (no subprocess). */
function markGitCheckout(dir: string): void {
  mkdirSync(join(dir, ".git"));
}

class FakeAgent implements Agent {
  readonly name: AgentName;
  readonly #runImpl: (prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>;

  constructor(name: AgentName, runImpl: (prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>) {
    this.name = name;
    this.#runImpl = runImpl;
  }

  run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    return Promise.resolve(this.#runImpl(prompt, opts));
  }

  attributionLabel(): string {
    return `fake-${this.name}`;
  }
}

function writeDraftSpec(specDir: string): void {
  writeFileSync(join(specDir, "index.md"), "# Test Spec\n\n- [ ] [00](./00-one.md)\n", "utf8");
  writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] drafted\n", "utf8");
}

const prerequisiteGatePolicy = [
  "Your first action is to read existing repo files and confirm each behavior in the intent's `## Prerequisites` section is legibly present.",
  "**Prerequisites input:** Extract the `## Prerequisites` section from the intent data block above. If the body is empty or contains only the bareword `none`, there are no prerequisites — skip this gate and draft normally.",
  "**Judgment rubric:** A prerequisite behavior is confirmed only when it is observable in committed code, tests, or docs in the repo. Prose describing future or in-flight work does not count. If you cannot cleanly confirm a behavior exists from reading existing files, treat it as absent.",
  "**On pass:** Every declared behavior is legibly present. Write nothing to `intent.md` — your prerequisite judgment is internal reasoning. Proceed to normal spec drafting.",
  "**On fail:** You cannot cleanly confirm one or more declared behaviors. Append a `## Blocker` section to `intent.md` (the only modification allowed to that file) naming each unconfirmed behavior. Write no `index.md` or numbered subspecs. The plan command will exit non-zero.",
].join("\n\n");

function hasPrerequisiteGatePolicy(prompt: string): boolean {
  const gate = /^## Prerequisite Gate\n\n([\s\S]*?)\n\n## Rules$/m.exec(prompt)?.[1];
  return gate === prerequisiteGatePolicy;
}

function namedPrerequisiteFromPrompt(prompt: string): string | null {
  const intent = /<<<INTENT_BEGIN>>>\n([\s\S]*?)\n<<<INTENT_END>>>/.exec(prompt)?.[1];
  if (!intent) return null;
  const prerequisite = /^## Prerequisites\s*\n\n- ([^\n]+)\s*$/m.exec(intent)?.[1];
  return prerequisite?.trim() || null;
}

function configureGitDisabledPlanProject(cfgDir: string, reviewPasses: number): void {
  const cfg = loadConfig({ dir: cfgDir });
  const projectConfig = cfg.projects.project;
  if (!projectConfig) {
    throw new Error("expected registered project");
  }
  projectConfig.git = false;
  projectConfig.plan = { commit: true };
  cfg.modes.review.passes = reviewPasses;
  writeConfig(cfg, { dir: cfgDir });
}

function expectNoPlanBranchOrWorktree(project: string, planName: string): void {
  expect(existsSync(join(project, ".worktree", `plan-${planName}`))).toBe(false);
}

function failingLogClient(message: string): LogClient {
  return {
    assertReachable: async () => {
      throw new Error(message);
    },
    send: async () => {},
  };
}

describe("planCommand", () => {
  test("renderPlanNextSteps includes PR URL and timestamped spec path command hints", () => {
    const specDirBasename = "2026-05-17T123456-opencode-agent";
    const text = renderPlanNextSteps({
      prUrl: "https://github.com/acme/repo/pull/123",
      specDirBasename,
    });
    expect(text).toContain("Next steps:");
    expect(text).toContain("https://github.com/acme/repo/pull/123");
    expect(text).toContain("jarvis1 plan --resume");
    expect(text).toContain(`spec/${specDirBasename}/index.md`);
    expect(text).toContain(`jarvis1 run spec/${specDirBasename}/index.md`);
  });

  test("successful-plan next steps omit ready-flip wording; plan.ts omits redundant stderr footers", () => {
    const specDirBasename = "2026-05-17T123456-opencode-agent";
    const text = renderPlanNextSteps({
      prUrl: "https://github.com/acme/repo/pull/555",
      specDirBasename,
    });
    expect(text).not.toContain("Mark the PR ready");
    expect(text).not.toContain("plan: complete");
    expect(text).not.toContain("commits created and pushed");

    const planSource = readFileSync(join(dirname(__dirname), "src", "commands", "plan.ts"), "utf8");
    expect(planSource).not.toContain("`plan: complete");
    expect(planSource).not.toContain("commits created and pushed to plan/");
  });

  test("plan mode invokes `gh pr ready` via maybeMarkPlanPrReady", () => {
    const source = readFileSync(join(dirname(__dirname), "src", "modes", "plan", "run.ts"), "utf8");
    expect(source).toContain("maybeMarkPlanPrReady");
    expect(source).toContain("safeMarkPlanPrReady");
  });

  test("--resume without spec path rejects", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    try {
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--resume"],
        cwd: project,
        config: { dir: cfgDir },
        logClient: okLogClient,
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("missing required ready-intent");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("commit: false on non-git project does not call git for baseBranch", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    const originalPath = process.env.PATH;
    try {
      // Verify project is not a git repo
      expect(!existsSync(join(project, ".git"))).toBe(true);

      // Stub `opencode` on PATH with a fake binary that fails immediately.
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const opencode = join(binDir, "opencode");
      writeFileSync(opencode, "#!/usr/bin/env bash\nexit 1\n");
      chmodSync(opencode, 0o755);
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      // Set project-level config to commit: false and add a no-op agent
      const cfg = loadConfig({ dir: cfgDir });
      const projectConfig = cfg.projects.project;
      if (!projectConfig) {
        throw new Error("expected registered project");
      }
      projectConfig.plan = { commit: false };
      // Configure the (now stubbed) opencode agent so it fails at invocation
      cfg.modes.plan.agentOrder = [{ agent: "opencode", model: "non-existent-model-for-test" }];
      writeConfig(cfg, { dir: cfgDir });

      // Run plan without skipGhCheck to exercise the actual git-gating logic
      const { client } = capturingLogClient();
      const cap = captureIo();
      const specPath = join(project, "intent.md");
      writeFileSync(specPath, "---\nname: test-non-git-basebranch\n---\ntest intent\n");

      // This will fail because the agent doesn't exist, but the important thing
      // is that we don't see git errors about "not a git repository" before that
      await planCommand({
        io: cap.io,
        args: [specPath],
        cwd: project,
        config: { dir: cfgDir },
        logClient: client,
        // Intentionally NOT using skipGhCheck
      }).catch(() => {
        // Expected to fail due to missing agent
      });

      // Check stderr for git pollution
      const stderr = cap.err();
      // Should not have leaked git stderr from baseBranch call
      // (it was fixed by gating behind if(commit))
      expect(stderr).not.toContain("fatal: not a git repository");
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("git: false forces loop-only external spec output even when plan.commit is true", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    try {
      configureGitDisabledPlanProject(cfgDir, 0);

      mkdirSync(join(project, "spec", "unrelated"), { recursive: true });
      writeFileSync(join(project, "spec", "unrelated", "note.md"), "dirty\n", "utf8");

      const intentPath = writeReadyIntent(project, "git-false-loop-only");
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: project,
        config: { dir: cfgDir },
        logClient: okLogClient,
        skipGhCheck: true,
        createAgent: () =>
          new FakeAgent("claude", (_prompt, opts) => {
            const specDir = opts.additionalReadDirs?.[0];
            if (!specDir) {
              throw new Error("expected external spec dir");
            }
            writeDraftSpec(specDir);
            return { kind: "ok", stdout: "", stderr: "" };
          }),
      });

      expect(code).toBe(0);
      expect(cap.err()).not.toContain("plan: not yet implemented");
      expect(cap.err()).not.toContain("boundary violation");
      expect(cap.out()).toContain("Intent: ");
      expect(cap.out()).toContain("Spec written to ");
      expect(cap.out()).toContain("/specs/project/");
      expect(cap.out()).toContain("jarvis1 run ");
      expectNoPlanBranchOrWorktree(project, "git-false-loop-only");
      expect(existsSync(intentPath)).toBe(false);

      const specPath = cap.out().match(/Spec written to (.+\/index\.md)\n/)?.[1];
      expect(specPath).toBeTruthy();
      if (specPath) {
        expect(readFileSync(specPath, "utf8")).toContain("repo:");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no-commit failures retain the ready-intent for retry", async () => {
    const cases: Array<{
      name: string;
      reviewPasses: number;
      setup?: (cfgDir: string) => void;
      run: (specDir: string, prompt: string) => AgentResult;
    }> = [
      {
        name: "draft-failure",
        reviewPasses: 0,
        run: () => ({ kind: "error", exitCode: 1, stderr: "draft failed" }),
      },
      {
        name: "validation-failure",
        reviewPasses: 0,
        run: () => ({ kind: "ok", stdout: "", stderr: "" }),
      },
      {
        name: "blocker",
        reviewPasses: 0,
        run: (specDir) => {
          writeFileSync(
            join(specDir, "intent.md"),
            "---\nname: blocker\n---\n\n## Prerequisites\n\nnone\n\n## Blocker\n\nblocked\n",
          );
          return { kind: "ok", stdout: "", stderr: "" };
        },
      },
      {
        name: "review-failure",
        reviewPasses: 1,
        run: (specDir) => {
          if (!existsSync(join(specDir, "index.md"))) {
            writeDraftSpec(specDir);
            return { kind: "ok", stdout: "", stderr: "" };
          }
          return { kind: "error", exitCode: 1, stderr: "review failed" };
        },
      },
      {
        name: "publication-failure",
        reviewPasses: 0,
        setup: (cfgDir) => {
          const cfg = loadConfig({ dir: cfgDir });
          cfg.modes.plan.specTimestamp = false;
          writeConfig(cfg, { dir: cfgDir });
        },
        run: (specDir) => {
          writeDraftSpec(specDir);
          return { kind: "ok", stdout: "", stderr: "" };
        },
      },
    ];

    for (const failureCase of cases) {
      const { dir, cfgDir, project } = setupRegisteredProject();
      try {
        configureGitDisabledPlanProject(cfgDir, failureCase.reviewPasses);
        failureCase.setup?.(cfgDir);
        const intentPath = writeReadyIntent(project, failureCase.name);
        if (failureCase.name === "publication-failure") {
          const externalRoot = join(cfgDir, "specs", "project");
          mkdirSync(externalRoot, { recursive: true });
          chmodSync(externalRoot, 0o555);
        }
        const cap = captureIo();
        const code = await planCommand({
          io: cap.io,
          args: [intentPath],
          cwd: project,
          config: { dir: cfgDir },
          logClient: okLogClient,
          skipGhCheck: true,
          createAgent: () =>
            new FakeAgent("claude", (prompt, opts) => {
              const specDir = opts.additionalReadDirs?.[0] ?? "";
              return failureCase.run(specDir, prompt);
            }),
        });

        expect(code).not.toBe(0);
        expect(existsSync(intentPath)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("dependent split intent blocks while prerequisite behavior is absent", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    const behavior = "dependent split foundation is available to later surfaces";
    const evidencePath = join(project, "runtime", "prerequisite-evidence.md");
    const specDir = join(cfgDir, "specs", "project", "dependent-split-prerequisite");
    const agentWorkingDirs: string[] = [];
    const assembledPrompts: string[] = [];
    try {
      configureGitDisabledPlanProject(cfgDir, 0);
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.plan.specTimestamp = false;
      writeConfig(cfg, { dir: cfgDir });

      const intentPath = writeReadyIntent(project, "dependent-split-prerequisite");
      writeFileSync(
        intentPath,
        `---\nname: dependent-split-prerequisite\n---\n\n## Prerequisites\n\n- ${behavior}\n`,
        "utf8",
      );

      const createAgent = () =>
        new FakeAgent("claude", (prompt, opts) => {
          agentWorkingDirs.push(opts.cwd);
          assembledPrompts.push(prompt);
          const outputDir = opts.additionalReadDirs?.[0];
          if (!outputDir) {
            throw new Error("expected external spec dir");
          }
          const prerequisite = namedPrerequisiteFromPrompt(prompt);
          if (!hasPrerequisiteGatePolicy(prompt) || !prerequisite) {
            return { kind: "error", exitCode: 1, stderr: "prerequisite policy missing" };
          }

          const evidencePath = join(opts.cwd, "runtime", "prerequisite-evidence.md");
          const evidenceReference = relative(opts.cwd, evidencePath);
          const hasEvidence = existsSync(evidencePath) && readFileSync(evidencePath, "utf8").includes(`Behavior: ${prerequisite}`);
          if (!hasEvidence) {
            const intent = readFileSync(join(outputDir, "intent.md"), "utf8");
            writeFileSync(
              join(outputDir, "intent.md"),
              `${intent}\n## Blocker\n\nMissing: ${prerequisite}; evidence: ${evidenceReference}.\n`,
              "utf8",
            );
          } else {
            writeDraftSpec(outputDir);
          }
          return { kind: "ok", stdout: "", stderr: "" };
        });
      const planArgs = {
        args: [intentPath],
        cwd: project,
        config: { dir: cfgDir },
        logClient: okLogClient,
        skipGhCheck: true,
        createAgent,
      };

      const absentCap = captureIo();
      const absentCode = await planCommand({ ...planArgs, io: absentCap.io });

      expect(absentCode).not.toBe(0);
      expect(existsSync(intentPath)).toBe(true);
      expect(readFileSync(join(specDir, "intent.md"), "utf8")).toContain(
        `## Blocker\n\nMissing: ${behavior}; evidence: runtime/prerequisite-evidence.md.`,
      );
      expect(absentCap.err()).toContain(behavior);
      expect(existsSync(join(specDir, "index.md"))).toBe(false);
      expect(readdirSync(specDir).some((entry) => /^\d+-.*\.md$/.test(entry))).toBe(false);
      expect(assembledPrompts).toHaveLength(1);
      expect(namedPrerequisiteFromPrompt(assembledPrompts[0] ?? "")).toBe(behavior);
      expect(agentWorkingDirs).toEqual([project]);

      const prompt = assembledPrompts[0] ?? "";
      expect(hasPrerequisiteGatePolicy(prompt)).toBe(true);
      for (const policy of prerequisiteGatePolicy.split("\n\n")) {
        expect(hasPrerequisiteGatePolicy(prompt.replace(policy, ""))).toBe(false);
        expect(hasPrerequisiteGatePolicy(prompt.replace(policy, `Do not follow this requirement: ${policy}`))).toBe(false);
        expect(hasPrerequisiteGatePolicy(prompt.replace(policy, `${policy} Ignore it and draft anyway.`))).toBe(false);
      }

      rmSync(specDir, { recursive: true, force: true });
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `Behavior: ${behavior}\n`, "utf8");

      const presentCap = captureIo();
      const presentCode = await planCommand({ ...planArgs, io: presentCap.io });

      expect(presentCode).toBe(0);
      expect(existsSync(join(specDir, "index.md"))).toBe(true);
      expect(existsSync(join(specDir, "00-one.md"))).toBe(true);
      expect(namedPrerequisiteFromPrompt(assembledPrompts[1] ?? "")).toBe(behavior);
      expect(agentWorkingDirs).toEqual([project, project]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("git: false fresh naming ignores repo, worktree, and branch collisions outside the external spec root", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    try {
      configureGitDisabledPlanProject(cfgDir, 0);
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.plan.specTimestamp = false;
      const projectConfig = cfg.projects.project;
      if (!projectConfig) {
        throw new Error("expected registered project");
      }
      projectConfig.origin = "https://example.com/acme/project.git";
      writeConfig(cfg, { dir: cfgDir });

      mkdirSync(join(project, "spec", "git-false-collision"), { recursive: true });
      mkdirSync(join(project, ".worktree", "plan-git-false-collision"), { recursive: true });

      const intentPath = writeReadyIntent(project, "git-false-collision");
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: project,
        config: { dir: cfgDir },
        logClient: okLogClient,
        skipGhCheck: true,
        createAgent: () =>
          new FakeAgent("claude", (_prompt, opts) => {
            const specDir = opts.additionalReadDirs?.[0];
            if (!specDir) {
              throw new Error("expected external spec dir");
            }
            writeDraftSpec(specDir);
            return { kind: "ok", stdout: "", stderr: "" };
          }),
      });

      expect(code).toBe(0);
      const specPath = cap.out().match(/Spec written to (.+\/index\.md)\n/)?.[1];
      expect(specPath).toBeTruthy();
      expect(specPath).toContain("/git-false-collision/index.md");
      expect(specPath).not.toContain("git-false-collision-2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("all agents model_config during draft exits 3 with terminal message", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    try {
      configureGitDisabledPlanProject(cfgDir, 0);
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.plan.agentOrder = [
        { agent: "claude", model: "haiku" },
        { agent: "codex", model: "gpt-5.3-codex" },
      ];
      writeConfig(cfg, { dir: cfgDir });

      const intentPath = writeReadyIntent(project, "all-model-config-draft");
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: project,
        config: { dir: cfgDir },
        logClient: okLogClient,
        skipGhCheck: true,
        createAgent: (agentName) =>
          new FakeAgent(agentName, () => ({
            kind: "model_config",
            stderr: agentName === "codex" ? "bad codex model" : "bad claude model",
          })),
      });

      expect(code).toBe(3);
      expect(cap.err()).toContain("plan: model configuration error");
      expect(cap.err()).toContain("bad codex model");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resume honors git: false even when plan.commit is true", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    try {
      configureGitDisabledPlanProject(cfgDir, 1);

      const externalSpecDir = join(cfgDir, "specs", "project", "2026-06-21T17-50-11Z-resume-git-false");
      mkdirSync(externalSpecDir, { recursive: true });
      writeFileSync(
        join(externalSpecDir, "intent.md"),
        "---\nname: resume-git-false\n---\n\n## Prerequisites\n\nnone\n",
        "utf8",
      );
      writeFileSync(
        join(externalSpecDir, "index.md"),
        "# Resume Spec\n\nrepo: project\n\n- [ ] [00](./00-one.md)\n",
        "utf8",
      );
      writeFileSync(join(externalSpecDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] stay\n", "utf8");

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project", "--resume", join(externalSpecDir, "index.md")],
        cwd: project,
        config: { dir: cfgDir },
        logClient: okLogClient,
        skipGhCheck: true,
        createAgent: () => new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" })),
      });

      expect(code).toBe(0);
      expect(cap.err()).toContain("plan: resume r");
      expect(cap.err()).not.toContain("missing spec/");
      expect(cap.err()).not.toContain("is not checked out on plan/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("git: false fresh run survives review without boundary violations or git worktree setup", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    try {
      configureGitDisabledPlanProject(cfgDir, 1);

      mkdirSync(join(project, "spec", "unrelated"), { recursive: true });
      writeFileSync(join(project, "spec", "unrelated", "note.md"), "dirty\n", "utf8");

      let callCount = 0;
      const intentPath = writeReadyIntent(project, "git-false-review");
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: project,
        config: { dir: cfgDir },
        logClient: okLogClient,
        skipGhCheck: true,
        createAgent: () =>
          new FakeAgent("claude", (prompt, opts) => {
            callCount += 1;
            const specDir = opts.additionalReadDirs?.[0];
            if (!specDir) {
              throw new Error("expected external spec dir");
            }
            if (callCount === 1) {
              writeDraftSpec(specDir);
              return { kind: "ok", stdout: "", stderr: "" };
            }
            if (prompt.includes("Review: Adjudicator")) {
              return { kind: "ok", stdout: "Tighten the spec.\n", stderr: "" };
            }
            if (prompt.includes("Review Verdict")) {
              writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] reviewed\n", "utf8");
              return { kind: "ok", stdout: "", stderr: "" };
            }
            return { kind: "ok", stdout: "", stderr: "" };
          }),
      });

      expect(code).toBe(0);
      expect(cap.err()).not.toContain("boundary violation");
      expect(cap.err()).not.toContain("git checkout");
      expect(cap.err()).not.toContain("git push");
      expectNoPlanBranchOrWorktree(project, "git-false-review");

      const specPath = cap.out().match(/Spec written to (.+\/index\.md)\n/)?.[1];
      expect(specPath).toBeTruthy();
      if (specPath) {
        expect(readFileSync(join(dirname(specPath), "00-one.md"), "utf8")).toContain("reviewed");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("commit: false with pre-existing siblings (ready-intents/ and prior spec dir) allows clean run", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    try {
      // Configure project with commit: false
      const cfg = loadConfig({ dir: cfgDir });
      const projectConfig = cfg.projects.project;
      if (!projectConfig) {
        throw new Error("expected registered project");
      }
      projectConfig.plan = { commit: false };
      projectConfig.git = false;
      cfg.modes.review.passes = 1;
      writeConfig(cfg, { dir: cfgDir });

      // Pre-populate external spec root with siblings
      const extSpecRoot = join(cfgDir, "specs", "project");
      mkdirSync(extSpecRoot, { recursive: true });
      mkdirSync(join(extSpecRoot, "ready-intents"), { recursive: true });
      writeFileSync(join(extSpecRoot, "ready-intents", "old-intent.md"), "# Old\n");
      mkdirSync(join(extSpecRoot, "2026-01-01T00-00-00Z-prior-spec"), { recursive: true });
      writeFileSync(join(extSpecRoot, "2026-01-01T00-00-00Z-prior-spec", "intent.md"), "# Prior\n");

      let callCount = 0;
      const intentPath = writeReadyIntent(project, "sibling-test");
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: project,
        config: { dir: cfgDir },
        logClient: okLogClient,
        skipGhCheck: true,
        createAgent: () =>
          new FakeAgent("claude", (prompt, opts) => {
            callCount += 1;
            const specDir = opts.additionalReadDirs?.[0];
            if (!specDir) {
              throw new Error("expected external spec dir");
            }
            if (callCount === 1) {
              writeDraftSpec(specDir);
              return { kind: "ok", stdout: "", stderr: "" };
            }
            if (prompt.includes("Review Verdict")) {
              writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] reviewed\n", "utf8");
              return { kind: "ok", stdout: "", stderr: "" };
            }
            return { kind: "ok", stdout: "", stderr: "" };
          }),
      });

      expect(code).toBe(0);
      expect(cap.err()).not.toContain("boundary violation");
      expect(cap.err()).not.toContain("## Blocker");
      expect(cap.err()).toContain("plan: review pass");
      // Verify the pre-existing siblings still exist
      expect(existsSync(join(extSpecRoot, "ready-intents", "old-intent.md"))).toBe(true);
      expect(existsSync(join(extSpecRoot, "2026-01-01T00-00-00Z-prior-spec", "intent.md"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runPlanReviewPhase git-disabled", () => {
  test("reviewer spec edits are reverted without git and actuator changes still apply", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    const originalPath = process.env.PATH;
    try {
      configureGitDisabledPlanProject(cfgDir, 1);
      const cfg = loadConfig({ dir: cfgDir });
      const projectConfig = cfg.projects.project;
      if (!projectConfig) {
        throw new Error("expected registered project");
      }
      projectConfig.origin = "https://example.com/acme/project.git";
      writeConfig(cfg, { dir: cfgDir });

      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      process.env.PATH = binDir;

      const externalSpecRoot = join(cfgDir, "specs", "project");
      const specDir = join(externalSpecRoot, "git-false-review");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "intent.md"),
        "---\nname: git-false-review\n---\n\n## Prerequisites\n\nnone\n",
        "utf8",
      );
      writeFileSync(join(specDir, "index.md"), "# Review Spec\n\nrepo: project\n\n- [ ] [00](./00-one.md)\n", "utf8");
      writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] drafted\n", "utf8");

      const result = await runPlanReviewPhase({
        worktreePath: project,
        name: "git-false-review",
        specDirBasename: "git-false-review",
        specDirPath: specDir,
        config: cfg,
        reviewPassesOverride: 1,
        commit: false,
        gitEnabled: false,
        externalSpecRoot,
        checkBoundary: true,
        additionalReadDirs: [specDir],
        createAgent: () =>
          new FakeAgent("claude", (prompt) => {
            if (prompt.includes("Review: Adversary")) {
              writeFileSync(
                join(specDir, "00-one.md"),
                "# One\n\n## Acceptance criteria\n\n- [ ] reviewer-edit\n",
                "utf8",
              );
              return { kind: "ok", stdout: "Adversary findings.\n", stderr: "" };
            }
            if (prompt.includes("Review Verdict")) {
              writeFileSync(
                join(specDir, "00-one.md"),
                "# One\n\n## Acceptance criteria\n\n- [ ] actuator-edit\n",
                "utf8",
              );
              return { kind: "ok", stdout: "", stderr: "" };
            }
            return { kind: "ok", stdout: "No objections.\n", stderr: "" };
          }),
      });

      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(specDir, "00-one.md"), "utf8")).toContain("actuator-edit");
      expect(readFileSync(join(specDir, "00-one.md"), "utf8")).not.toContain("reviewer-edit");
      expect(existsSync(join(project, ".jarvis-review-plan-adversary-1"))).toBe(false);
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("planCommand target-repo resolution", () => {
  function setupWorld() {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-resolve-"));
    const cfgDir = join(dir, "cfg");
    const projectA = join(dir, "project-a");
    const projectB = join(dir, "project-b");
    mkdirSync(projectA);
    mkdirSync(projectB);
    return { dir, cfgDir, projectA, projectB };
  }

  test("file mode: intent file inside a registered project resolves to that project", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });
      const intentDir = join(projectA, "ready-intents");
      mkdirSync(intentDir);
      const intentPath = join(intentDir, "my-feature.md");
      writeFileSync(intentPath, "---\nname: my-feature\n---\n\n## Prerequisites\n\nnone\n");

      const cap = captureIo();
      const { client: logClient, harnessTexts } = capturingLogClient();
      const code = await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: dir,
        config: { dir: cfgDir },
        logClient,
      });
      expect(code).toBe(2);
      const fileInv: PlanInvocation = {
        mode: "file",
        readyIntentPath: intentPath,
        cwd: dir,
        resume: false,
        resumeDraft: false,
      };
      expect(cap.err()).not.toContain(describePlanInvocation(fileInv));
      expect(cap.err()).not.toContain("plan: target project=");
      expect(harnessTexts).toContain(describePlanInvocation(fileInv));
      expect(harnessTexts).toContain(`plan: target project=project-a root=${projectA}`);
      expect(cap.err()).toContain(
        "plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("file mode: intent file inside a git checkout but unregistered → ad-hoc", async () => {
    const { dir, cfgDir, projectB } = setupWorld();
    try {
      markGitCheckout(projectB);
      const intentPath = writeReadyIntent(projectB);

      const cap = captureIo();
      const { client: logClient, harnessTexts } = capturingLogClient();
      const code = await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: dir,
        config: { dir: cfgDir },
        logClient,
        skipGhCheck: true,
      });
      expect(code).toBe(2);
      expect(cap.err()).not.toContain("plan: target project=");
      expect(harnessTexts).toContain(`plan: target project=project-b root=${projectB}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing seed with --cwd exits before resolution side effects", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });

      const cap = captureIo();
      const { client: logClient, harnessTexts } = capturingLogClient();
      const code = await planCommand({
        io: cap.io,
        args: ["--cwd", projectA],
        cwd: dir,
        config: { dir: cfgDir },
        logClient,
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("missing required ready-intent");
      expect(harnessTexts).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--repo <name> overrides path-walk fallback in file mode", async () => {
    const { dir, cfgDir, projectA, projectB } = setupWorld();
    try {
      markGitCheckout(projectB);
      registerProject("project-a", projectA, { dir: cfgDir });
      const intentPath = writeReadyIntent(projectB);

      const cap = captureIo();
      const { client: logClient, harnessTexts } = capturingLogClient();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a", intentPath],
        cwd: dir,
        config: { dir: cfgDir },
        logClient,
      });
      expect(code).toBe(2);
      expect(cap.err()).not.toContain("plan: target project=");
      expect(harnessTexts).toContain(`plan: target project=project-a root=${projectA}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--repo <name> without a seed exits before resolution side effects", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });

      const cap = captureIo();
      const { client: logClient, harnessTexts } = capturingLogClient();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a"],
        cwd: dir,
        config: { dir: cfgDir },
        logClient,
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("missing required ready-intent");
      expect(harnessTexts).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolution failure exits 1 with the same wording as jarvis run", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });
      const ri = writeReadyIntent(dir);

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "nope", ri],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: okLogClient,
      });
      expect(code).toBe(1);
      // Same wording as run mode's resolveProject error.
      expect(cap.err()).toContain('--repo: no project matches "nope"');
      expect(cap.err()).not.toContain(
        "plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("after successful resolution, the stub exit 2 still fires", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });
      const ri = writeReadyIntent(dir);

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a", ri],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: okLogClient,
      });
      expect(code).toBe(2);
      expect(cap.err()).toContain(
        "plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("planCommand log-server preflight", () => {
  function setupWorld() {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-logsrv-"));
    const cfgDir = join(dir, "cfg");
    const projectA = join(dir, "project-a");
    mkdirSync(projectA);
    return { dir, cfgDir, projectA };
  }

  test("log server down → exit 1 with shared message; stub does not fire", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });
      const ri = writeReadyIntent(dir);

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a", ri],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: failingLogClient("connect ECONNREFUSED 127.0.0.1:4310"),
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("log server unreachable");
      expect(cap.err()).toContain("jarvis1 log-server");
      expect(cap.err()).not.toContain(
        "plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("log server up + valid repo + valid args → exit 2 with stub", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });
      const ri = writeReadyIntent(dir);

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a", ri],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: okLogClient,
      });
      expect(code).toBe(2);
      expect(cap.err()).toContain(
        "plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("log server up + invalid repo → exit 1 with resolution error (resolution runs first)", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });
      const ri = writeReadyIntent(dir);

      const cap = captureIo();
      // logClient is a tripwire: if the preflight runs before resolution, the
      // failing client would surface a "log server unreachable" message.
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "nope", ri],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: failingLogClient("should not be called"),
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain('--repo: no project matches "nope"');
      expect(cap.err()).not.toContain("log server unreachable");
      expect(cap.err()).not.toContain(
        "plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("log server down (would fail) + bad args → exit 1 with arg error (parsing runs first)", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--bogus"],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: failingLogClient("should not be called"),
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("--bogus");
      expect(cap.err()).not.toContain("log server unreachable");
      expect(cap.err()).not.toContain(
        "plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parsePlanArgs", () => {
  let tmp: string;
  let intentFile: string;

  function setup() {
    tmp = mkdtempSync(join(tmpdir(), "jarvis-plan-args-"));
    intentFile = join(tmp, "intent.md");
    writeFileSync(intentFile, "intent");
  }
  function teardown() {
    rmSync(tmp, { recursive: true, force: true });
  }

  test("no positional → exit 1 missing required ready-intent", () => {
    setup();
    try {
      const res = parsePlanArgs([], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("missing required ready-intent");
    } finally {
      teardown();
    }
  });

  test("existing file → file mode with absolute intent path", () => {
    setup();
    try {
      const res = parsePlanArgs(["intent.md"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("file");
      if (res.invocation.mode !== "file") return;
      expect(res.invocation.readyIntentPath).toBe(intentFile);
    } finally {
      teardown();
    }
  });

  test("non-existing path → exit 1 with ready-intent guidance", () => {
    setup();
    try {
      const res = parsePlanArgs(["does-not-exist.md"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("does not exist or is not a file");
    } finally {
      teardown();
    }
  });

  test("two positional args → exit 1 too many arguments", () => {
    setup();
    try {
      const res = parsePlanArgs(["a", "b"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("too many arguments");
    } finally {
      teardown();
    }
  });

  test("--review-passes negative → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--review-passes", "-1"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("--review-passes");
    } finally {
      teardown();
    }
  });

  test("--review-passes non-integer → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--review-passes", "foo"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("--review-passes");
    } finally {
      teardown();
    }
  });

  test("--review-passes 0 is accepted and set to 0", () => {
    setup();
    try {
      const res = parsePlanArgs(["--review-passes", "0", "intent.md"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.reviewPasses).toBe(0);
    } finally {
      teardown();
    }
  });

  test("--repo missing value → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--repo"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("missing value for --repo");
    } finally {
      teardown();
    }
  });

  test("--repo captured", () => {
    setup();
    try {
      const res = parsePlanArgs(["--repo", "owner/repo", "intent.md"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.repo).toBe("owner/repo");
    } finally {
      teardown();
    }
  });

  test("--target-dir captured", () => {
    setup();
    try {
      const res = parsePlanArgs(["--target-dir", "v1/spec", "intent.md"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.targetDir).toBe("v1/spec");
    } finally {
      teardown();
    }
  });

  test("--target-dir absent leaves default resolution to command/config", () => {
    setup();
    try {
      const res = parsePlanArgs(["intent.md"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.targetDir).toBeUndefined();
    } finally {
      teardown();
    }
  });

  test("--target-dir missing value → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--target-dir"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("missing value for --target-dir");
    } finally {
      teardown();
    }
  });

  test("--target-dir invalid value → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--target-dir", "../escape", "intent.md"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain('--target-dir must not contain ".."');
    } finally {
      teardown();
    }
  });

  test("--resume without a path still fails parsing", () => {
    setup();
    try {
      const res = parsePlanArgs(["--resume"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.message).toContain("missing required ready-intent");
    } finally {
      teardown();
    }
  });

  test("--resume-draft without a path still fails parsing", () => {
    setup();
    try {
      const res = parsePlanArgs(["--resume-draft"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.message).toContain("missing required ready-intent");
    } finally {
      teardown();
    }
  });

  test("--resume and --resume-draft cannot be combined", () => {
    setup();
    try {
      const res = parsePlanArgs(["--resume", "--resume-draft"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("cannot be combined");
    } finally {
      teardown();
    }
  });

  test("--resume-draft with a non-existent spec path stays file mode", () => {
    setup();
    try {
      // The spec lives in the plan worktree, not the cwd the user runs from, so
      // the path won't exist here. It must still be treated as a spec path, not
      // silently downgraded to inline intent text.
      const rel = "spec/2026-05-21T04-13-11Z-fix-thing/intent.md";
      const res = parsePlanArgs(["--resume-draft", rel], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("file");
      if (res.invocation.mode !== "file") return;
      expect(res.invocation.resumeDraft).toBe(true);
      expect(res.invocation.readyIntentPath).toBe(resolve(tmp, rel));
    } finally {
      teardown();
    }
  });

  test("--resume with a non-existent spec path stays file mode", () => {
    setup();
    try {
      const rel = "spec/2026-05-21T04-13-11Z-fix-thing/index.md";
      const res = parsePlanArgs(["--resume", rel], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("file");
      if (res.invocation.mode !== "file") return;
      expect(res.invocation.resume).toBe(true);
      expect(res.invocation.readyIntentPath).toBe(resolve(tmp, rel));
    } finally {
      teardown();
    }
  });

  test("--recover keeps the index path and selected subspec separate", () => {
    const res = parsePlanArgs(["--recover", "./00-task.md", "spec/tree/index.md"], tmp);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.invocation.recover).toBe("./00-task.md");
      expect(res.invocation.readyIntentPath).toBe(resolve(tmp, "spec/tree/index.md"));
      expect(res.invocation.resume).toBe(false);
    }
  });

  test("--cwd rewrites file resolution base", () => {
    setup();
    try {
      const otherCwd = mkdtempSync(join(tmpdir(), "jarvis-plan-other-"));
      try {
        // intent.md exists in `tmp`, not in `otherCwd`. processCwd is otherCwd
        // but --cwd points at tmp, so the file should resolve.
        const res = parsePlanArgs(["--cwd", tmp, "intent.md"], otherCwd);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.invocation.mode).toBe("file");
        if (res.invocation.mode !== "file") return;
        expect(res.invocation.readyIntentPath).toBe(intentFile);
        expect(res.invocation.cwd).toBe(tmp);
      } finally {
        rmSync(otherCwd, { recursive: true, force: true });
      }
    } finally {
      teardown();
    }
  });

  test("unknown flag → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--bogus"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("--bogus");
    } finally {
      teardown();
    }
  });

  test("missing --agent value → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--agent"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("missing value for --agent");
    } finally {
      teardown();
    }
  });

  test("repeatable --agent values collected in order", () => {
    setup();
    try {
      const intent = join(tmp, "ready-intents", "feat.md");
      mkdirSync(join(tmp, "ready-intents"), { recursive: true });
      writeFileSync(intent, "---\nname: feat\n---\n\n## Prerequisites\n\nnone\n");
      const res = parsePlanArgs(["--agent", "codex", "--agent", "claude:haiku", intent], tmp);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.invocation.agentFlags).toEqual(["codex", "claude:haiku"]);
      }
    } finally {
      teardown();
    }
  });
});

describe("resolveResumeSpecPath", () => {
  test("derives the spec dir from the parent, not the file basename", () => {
    // Regression: a previous implementation used basename(specPath), yielding
    // "intent.md" as the spec dir and a bogus `plan-intent.md` worktree.
    const out = resolveResumeSpecPath(
      "/repo/.worktree/plan-fix-thing/spec/2026-05-21T04-13-11Z-fix-thing/intent.md",
      "resume-draft",
    );
    expect(out.specDirBasename).toBe("2026-05-21T04-13-11Z-fix-thing");
    expect(out.planName).toBe("fix-thing");
    expect(out.specDirPath).toBe("/repo/.worktree/plan-fix-thing/spec/2026-05-21T04-13-11Z-fix-thing");
    expect(out.externalSpecRoot).toBe("/repo/.worktree/plan-fix-thing/spec");
  });

  test("resume mode expects an index.md path", () => {
    const out = resolveResumeSpecPath("/x/specs/proj/2026-05-21T04-13-11Z-fix-thing/index.md", "resume");
    expect(out.specDirBasename).toBe("2026-05-21T04-13-11Z-fix-thing");
    expect(out.externalSpecRoot).toBe("/x/specs/proj");
  });

  test("rejects a path whose basename is not the expected spec file", () => {
    expect(() => resolveResumeSpecPath("/x/spec/foo/intent.md", "resume")).toThrow("--resume requires a index.md path");
    expect(() => resolveResumeSpecPath("/x/spec/foo/index.md", "resume-draft")).toThrow(
      "--resume-draft requires a intent.md path",
    );
  });
});

describe("plan review pass resolution", () => {
  const reviewCfg: Config = {
    version: 2,
    modes: {
      patch: { agentOrder: [{ agent: "claude", model: "haiku" }] },
      plan: { agentOrder: [{ agent: "claude", model: "haiku" }] },
      prompt: { agentOrder: [{ agent: "claude", model: "haiku" }] },
      review: { passes: 7 },
    },
    quotaFallback: "strict",
    weakQuotaExitCodes: [],
    maxIterations: 10,
    iterationTimeoutMs: 30 * 60_000,
    git: true,
    projects: {},
  };

  class NoopAgent implements Agent {
    readonly name: AgentName = "claude";
    async run(_prompt: string, _opts: AgentRunOptions): Promise<AgentResult> {
      return { kind: "ok", stdout: "", stderr: "" };
    }
    attributionLabel(): string {
      return "noop-claude";
    }
  }

  test("fresh and resume paths resolve passes as CLI override -> config -> default", async () => {
    expect(resolveReviewPasses(reviewCfg, 3)).toBe(3);
    expect(resolveReviewPasses(reviewCfg)).toBe(7);
    expect(resolveReviewPasses({ ...reviewCfg, modes: { ...reviewCfg.modes, review: { passes: 2 } } })).toBe(2);

    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-review-resolve-"));
    try {
      const specDir = join(dir, "spec", "p-resolve");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-resolve\n---\n\n# Intent\n\nseed\n");
      writeFileSync(join(specDir, "index.md"), "# Draft\n");

      const freshStarts: number[] = [];
      await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-resolve",
        specDirBasename: "p-resolve",
        specDirPath: specDir,
        config: reviewCfg,
        reviewPassesOverride: 2,
        commit: false,
        createAgent: () => new NoopAgent(),
        onPassStart: (pass) => {
          freshStarts.push(pass);
        },
      });
      expect(freshStarts).toEqual([1, 2]);

      const resumeStarts: number[] = [];
      await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-resolve",
        specDirBasename: "p-resolve",
        specDirPath: specDir,
        config: reviewCfg,
        startPassNumber: 4,
        commit: false,
        createAgent: () => new NoopAgent(),
        onPassStart: (pass) => {
          resumeStarts.push(pass);
        },
      });
      expect(resumeStarts).toEqual([4, 5, 6, 7, 8, 9, 10]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("plan.ts regression: error message removed", () => {
  test("plan.ts no longer contains the error string 'commit: false requires a git repository'", () => {
    const planTsContent = readFileSync(resolve(__dirname, "../src/commands/plan.ts"), "utf8");
    expect(planTsContent).not.toContain("commit: false requires a git repository");
  });
});

describe("intent frontmatter naming helpers", () => {
  test("parseIntentFrontmatter reads leading name field", () => {
    const parsed = parseIntentFrontmatter("---\nname: csv-export\n---\n\n# Intent\nhello\n");
    expect(parsed.name).toBe("csv-export");
  });

  test("parseIntentFrontmatter ignores non-leading block", () => {
    const parsed = parseIntentFrontmatter("# Intent\n---\nname: csv-export\n---\n");
    expect(parsed.name).toBeUndefined();
  });
});
