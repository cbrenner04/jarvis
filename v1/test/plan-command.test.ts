import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
    const specDirBasename = "2026-05-17T123456-aider-agent";
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
    const specDirBasename = "2026-05-17T123456-aider-agent";
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
      execSync("git init -b main", { cwd: project });
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

      // Stub `aider` on PATH with a fake binary that fails immediately. This
      // keeps the test from spawning the real aider, which would otherwise try
      // to open a browser to litellm/aider docs on an unknown model.
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const aider = join(binDir, "aider");
      writeFileSync(aider, "#!/usr/bin/env bash\nexit 1\n");
      chmodSync(aider, 0o755);
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      // Set project-level config to commit: false and add a no-op agent
      const cfg = loadConfig({ dir: cfgDir });
      const projectConfig = cfg.projects.project;
      if (!projectConfig) {
        throw new Error("expected registered project");
      }
      projectConfig.plan = { commit: false };
      // Configure the (now stubbed) aider agent so it fails at invocation
      cfg.modes.plan.agentOrder = [{ agent: "aider", model: "non-existent-model-for-test" }];
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
      execSync("git init -b main", { cwd: projectB });
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
      execSync("git init -b main", { cwd: projectB });
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
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      const specDir = join(dir, "spec", "p-resolve");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-resolve\n---\n\n# Intent\n\nseed\n");
      writeFileSync(join(specDir, "index.md"), "# Draft\n");
      execSync("git add -A", { cwd: dir });
      execSync("git commit -m seed", { cwd: dir });

      const freshStarts: number[] = [];
      await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-resolve",
        specDirBasename: "p-resolve",
        config: reviewCfg,
        reviewPassesOverride: 2,
        commit: true,
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
        config: reviewCfg,
        startPassNumber: 4,
        commit: true,
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
