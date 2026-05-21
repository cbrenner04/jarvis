import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  appendPhase0ReviewGateBlocker,
  deriveSpecName,
  parseIntentFrontmatter,
  planCommand,
  renderPlanNextSteps,
  seedIntentFile,
  shouldStopAfterPhase0Refine,
  validateProposedName,
} from "../src/commands/plan.ts";
import type { PlanInvocation } from "../src/commands/plan-args.ts";
import {
  describePlanInvocation,
  parsePlanArgs,
} from "../src/commands/plan-args.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";

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
    expect(text).toContain("jarvis plan --resume");
    expect(text).toContain(`spec/${specDirBasename}/index.md`);
    expect(text).toContain(`jarvis run spec/${specDirBasename}/index.md`);
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

    const planSource = readFileSync(
      join(dirname(__dirname), "src", "commands", "plan.ts"),
      "utf8",
    );
    expect(planSource).not.toContain("`plan: complete");
    expect(planSource).not.toContain("commits created and pushed to plan/");
  });

  test("plan mode invokes `gh pr ready` via maybeMarkPlanPrReady", () => {
    const source = readFileSync(
      join(dirname(__dirname), "src", "commands", "plan.ts"),
      "utf8",
    );
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
      expect(cap.err()).toContain("--resume requires a spec path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("commit: false on non-git project does not call git for baseBranch", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    try {
      // Verify project is not a git repo
      expect(!existsSync(join(project, ".git"))).toBe(true);

      // Set project-level config to commit: false and add a no-op agent
      const cfg = loadConfig({ dir: cfgDir });
      const projectConfig = cfg.projects.project;
      if (!projectConfig) {
        throw new Error("expected registered project");
      }
      projectConfig.plan = { commit: false };
      // Configure an invalid model for an agent so it fails at invocation
      cfg.modes.plan.agentOrder = [
        { agent: "aider", model: "non-existent-model-for-test" },
      ];
      writeConfig(cfg, { dir: cfgDir });

      // Run plan without skipGhCheck to exercise the actual git-gating logic
      const { client } = capturingLogClient();
      const cap = captureIo();
      const specPath = join(project, "intent.md");
      writeFileSync(
        specPath,
        "---\nname: test-non-git-basebranch\n---\ntest intent\n",
      );

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
      const intentDir = join(projectA, "intents");
      mkdirSync(intentDir);
      const intentPath = join(intentDir, "intent.md");
      writeFileSync(intentPath, "intent\n");

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
        intentPath,
        cwd: dir,
        resume: false,
        resumeDraft: false,
      };
      expect(cap.err()).not.toContain(describePlanInvocation(fileInv));
      expect(cap.err()).not.toContain("plan: target project=");
      expect(harnessTexts).toContain(describePlanInvocation(fileInv));
      expect(harnessTexts).toContain(
        `plan: target project=project-a root=${projectA}`,
      );
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
      const intentPath = join(projectB, "intent.md");
      writeFileSync(intentPath, "intent\n");

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
      expect(harnessTexts).toContain(
        `plan: target project=project-b root=${projectB}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("inline mode + --cwd inside a registered project resolves to that project", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });
      const existingInlineIntent = join(
        projectA,
        "spec",
        "wip-intents",
        "freeform-intent.md",
      );
      mkdirSync(dirname(existingInlineIntent), { recursive: true });
      writeFileSync(existingInlineIntent, "existing\n", "utf8");

      const cap = captureIo();
      const { client: logClient, harnessTexts } = capturingLogClient();
      const code = await planCommand({
        io: cap.io,
        args: ["--cwd", projectA, "freeform intent"],
        cwd: dir,
        config: { dir: cfgDir },
        logClient,
      });
      expect(code).toBe(1);
      const inlineInv: PlanInvocation = {
        mode: "inline",
        intentText: "freeform intent",
        cwd: projectA,
        resume: false,
        resumeDraft: false,
      };
      expect(cap.err()).not.toContain(describePlanInvocation(inlineInv));
      expect(cap.err()).not.toContain("plan: target project=");
      expect(harnessTexts).toContain(describePlanInvocation(inlineInv));
      expect(harnessTexts).toContain(
        `plan: target project=project-a root=${projectA}`,
      );
      expect(cap.err()).toContain("already exists; refusing to overwrite");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("interactive mode + --cwd inside a registered project resolves to that project", async () => {
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
      expect(code).toBe(2);
      expect(cap.err()).toContain("plan: interactive session started");
      expect(cap.err()).not.toContain("plan: target project=");
      expect(harnessTexts).toContain(
        describePlanInvocation({
          mode: "interactive",
          cwd: projectA,
          resume: false,
          resumeDraft: false,
        }),
      );
      expect(harnessTexts).toContain(
        `plan: target project=project-a root=${projectA}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--repo <name> overrides path-walk fallback in file mode", async () => {
    const { dir, cfgDir, projectA, projectB } = setupWorld();
    try {
      execSync("git init -b main", { cwd: projectB });
      registerProject("project-a", projectA, { dir: cfgDir });
      const intentPath = join(projectB, "intent.md");
      writeFileSync(intentPath, "intent\n");

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
      expect(harnessTexts).toContain(
        `plan: target project=project-a root=${projectA}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--repo <name> overrides path-walk fallback in inline mode", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });
      const existingInlineIntent = join(
        dir,
        "spec",
        "wip-intents",
        "freeform.md",
      );
      mkdirSync(dirname(existingInlineIntent), { recursive: true });
      writeFileSync(existingInlineIntent, "existing\n", "utf8");

      const cap = captureIo();
      const { client: logClient, harnessTexts } = capturingLogClient();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a", "freeform"],
        cwd: dir,
        config: { dir: cfgDir },
        logClient,
      });
      expect(code).toBe(1);
      expect(cap.err()).not.toContain("plan: target project=");
      expect(harnessTexts).toContain(
        `plan: target project=project-a root=${projectA}`,
      );
      expect(cap.err()).toContain("already exists; refusing to overwrite");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--repo <name> overrides path-walk fallback in interactive mode", async () => {
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
      expect(code).toBe(2);
      expect(cap.err()).toContain("plan: interactive session started");
      expect(cap.err()).not.toContain("plan: target project=");
      expect(harnessTexts).toContain(
        `plan: target project=project-a root=${projectA}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolution failure exits 1 with the same wording as jarvis run", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "nope"],
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

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a"],
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

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a"],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: failingLogClient("connect ECONNREFUSED 127.0.0.1:4310"),
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("log server unreachable");
      expect(cap.err()).toContain("jarvis log-server");
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

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a"],
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

      const cap = captureIo();
      // logClient is a tripwire: if the preflight runs before resolution, the
      // failing client would surface a "log server unreachable" message.
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "nope"],
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

  test("no positional → interactive", () => {
    setup();
    try {
      const res = parsePlanArgs([], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("interactive");
      expect(res.invocation.cwd).toBe(tmp);
      expect(res.invocation.resume).toBe(false);
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
      expect(res.invocation.intentPath).toBe(intentFile);
    } finally {
      teardown();
    }
  });

  test("non-existing path → inline mode preserving original text", () => {
    setup();
    try {
      const res = parsePlanArgs(["does-not-exist.md"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("inline");
      if (res.invocation.mode !== "inline") return;
      expect(res.invocation.intentText).toBe("does-not-exist.md");
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

  test("--refine-turns valid", () => {
    setup();
    try {
      const res = parsePlanArgs(["--refine-turns", "3"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.refineTurns).toBe(3);
    } finally {
      teardown();
    }
  });

  test("--refine-turns negative → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--refine-turns", "-1"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("--refine-turns");
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
      const res = parsePlanArgs(["--review-passes", "0", "intent"], tmp);
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
      const res = parsePlanArgs(["--repo", "owner/repo"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.repo).toBe("owner/repo");
    } finally {
      teardown();
    }
  });

  test("--resume sets flag inert", () => {
    setup();
    try {
      const res = parsePlanArgs(["--resume"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.resume).toBe(true);
      expect(res.invocation.resumeDraft).toBe(false);
      expect(res.invocation.mode).toBe("interactive");
    } finally {
      teardown();
    }
  });

  test("--resume-draft sets flag inert", () => {
    setup();
    try {
      const res = parsePlanArgs(["--resume-draft"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.resume).toBe(false);
      expect(res.invocation.resumeDraft).toBe(true);
      expect(res.invocation.mode).toBe("interactive");
    } finally {
      teardown();
    }
  });

  test("--resume resolves an existing spec directory to index.md", () => {
    setup();
    try {
      const specDir = join(tmp, "spec-dir");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      writeFileSync(indexPath, "# spec\n");

      const res = parsePlanArgs(["--resume", specDir], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("file");
      if (res.invocation.mode !== "file") return;
      expect(res.invocation.intentPath).toBe(indexPath);
    } finally {
      teardown();
    }
  });

  test("--resume-draft resolves an existing spec directory to intent.md", () => {
    setup();
    try {
      const specDir = join(tmp, "spec-dir");
      mkdirSync(specDir);
      const intentPath = join(specDir, "intent.md");
      writeFileSync(intentPath, "intent\n");

      const res = parsePlanArgs(["--resume-draft", specDir], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("file");
      if (res.invocation.mode !== "file") return;
      expect(res.invocation.intentPath).toBe(intentPath);
    } finally {
      teardown();
    }
  });

  test("resume directory resolution tolerates trailing slashes", () => {
    setup();
    try {
      const specDir = join(tmp, "spec-dir");
      mkdirSync(specDir);
      const indexPath = join(specDir, "index.md");
      const intentPath = join(specDir, "intent.md");
      writeFileSync(indexPath, "# spec\n");
      writeFileSync(intentPath, "intent\n");

      const resumeRes = parsePlanArgs(["--resume", `${specDir}/`], tmp);
      expect(resumeRes.ok).toBe(true);
      if (!resumeRes.ok) return;
      expect(resumeRes.invocation.mode).toBe("file");
      if (resumeRes.invocation.mode !== "file") return;
      expect(resumeRes.invocation.intentPath).toBe(indexPath);

      const draftRes = parsePlanArgs(["--resume-draft", `${specDir}/`], tmp);
      expect(draftRes.ok).toBe(true);
      if (!draftRes.ok) return;
      expect(draftRes.invocation.mode).toBe("file");
      if (draftRes.invocation.mode !== "file") return;
      expect(draftRes.invocation.intentPath).toBe(intentPath);
    } finally {
      teardown();
    }
  });

  test("resume directory missing expected file returns a path-specific error", () => {
    setup();
    try {
      const specDir = join(tmp, "spec-dir");
      mkdirSync(specDir);
      const intentPath = join(specDir, "intent.md");

      const res = parsePlanArgs(["--resume-draft", specDir], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("--resume-draft");
      expect(res.message).toContain(intentPath);
      expect(res.message).not.toContain("intent text");
    } finally {
      teardown();
    }
  });

  test("resume missing path returns a path-specific error", () => {
    setup();
    try {
      const missingPath = join(tmp, "missing-spec", "index.md");

      const res = parsePlanArgs(["--resume", "missing-spec/index.md"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("--resume");
      expect(res.message).toContain(missingPath);
      expect(res.message).not.toContain("intent text");
    } finally {
      teardown();
    }
  });

  test("existing directory without resume remains inline mode", () => {
    setup();
    try {
      const specDir = join(tmp, "spec-dir");
      mkdirSync(specDir);

      const res = parsePlanArgs([specDir], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.mode).toBe("inline");
      if (res.invocation.mode !== "inline") return;
      expect(res.invocation.intentText).toBe(specDir);
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
        expect(res.invocation.intentPath).toBe(intentFile);
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

describe("deriveSpecName", () => {
  function setupProjectDir(): { dir: string; projectRoot: string } {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-spec-name-"));
    const projectRoot = dir;
    mkdirSync(join(projectRoot, "spec"), { recursive: true });
    execSync("git init -b main", { cwd: projectRoot });
    return { dir, projectRoot };
  }

  test("file mode: kebab-case the basename without extension", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      const inv: PlanInvocation = {
        mode: "file",
        intentPath: "/some/path/OAuth Login.md",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toBe("oauth-login");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("file mode: various basenames produce expected kebab-case", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      const cases: [string, string][] = [
        ["simple.md", "simple"],
        ["my-feature.md", "my-feature"],
        ["Add CSV Export.md", "add-csv-export"],
        ["test_underscore.md", "test-underscore"],
        ["file!!!.md", "file"],
        ["UPPERCASE.md", "uppercase"],
      ];

      for (const [filename, expected] of cases) {
        const inv: PlanInvocation & { mode: "file" } = {
          mode: "file",
          intentPath: join(projectRoot, filename),
          cwd: projectRoot,
          resume: false,
          resumeDraft: false,
        };
        const name = await deriveSpecName(inv, projectRoot);
        expect(name).toBe(expected);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("inline mode: truncate to first 6 words OR 40 chars, whichever comes first", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      const inv: PlanInvocation = {
        mode: "inline",
        intentText: "add csv export to reports !!!",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toBe("add-csv-export-to-reports");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("inline mode: strip trailing dashes after truncation", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      const inv: PlanInvocation = {
        mode: "inline",
        intentText: "add csv export to reports !!!",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      // Should not end with `-`
      expect(name).not.toMatch(/-$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("inline mode: 40-char limit", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      const longText =
        "this is a very long inline text that should be truncated to forty characters";
      const inv: PlanInvocation = {
        mode: "inline",
        intentText: longText,
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name.length).toBeLessThanOrEqual(40);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty file basename falls back to 'plan'", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      const inv: PlanInvocation = {
        mode: "file",
        intentPath: "/some/path/!!!.md",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toBe("plan");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty inline text falls back to 'plan'", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      const inv: PlanInvocation = {
        mode: "inline",
        intentText: "!!!",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toBe("plan");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reserved name 'index' falls back to 'plan'", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      const inv: PlanInvocation = {
        mode: "file",
        intentPath: "/some/path/index.md",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toBe("plan");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reserved name 'intent' falls back to 'plan'", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      const inv: PlanInvocation = {
        mode: "file",
        intentPath: "/some/path/intent.md",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toBe("plan");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("existing spec/<name>/ directory triggers -2 suffix", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      mkdirSync(join(projectRoot, "spec", "oauth-login"));
      const inv: PlanInvocation = {
        mode: "file",
        intentPath: "/some/path/OAuth Login.md",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toBe("oauth-login-2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("existing .worktree/plan-<name>/ directory triggers -2 suffix", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      mkdirSync(join(projectRoot, ".worktree", "plan-oauth-login"), {
        recursive: true,
      });
      const inv: PlanInvocation = {
        mode: "file",
        intentPath: "/some/path/OAuth Login.md",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toBe("oauth-login-2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("both spec dir and worktree dir colliding requires going to higher suffix", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      mkdirSync(join(projectRoot, "spec", "oauth-login"));
      mkdirSync(join(projectRoot, ".worktree", "plan-oauth-login-2"), {
        recursive: true,
      });

      const inv: PlanInvocation = {
        mode: "file",
        intentPath: "/some/path/OAuth Login.md",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toBe("oauth-login-3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("interactive mode: base name is interactive-<short-timestamp>", async () => {
    const { dir, projectRoot } = setupProjectDir();
    try {
      const inv: PlanInvocation = {
        mode: "interactive",
        cwd: projectRoot,
        resume: false,
        resumeDraft: false,
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toMatch(/^interactive-\d{4}-\d{2}-\d{2}-\d{4}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("phase-0 intent review gate", () => {
  test("stops only for fresh committed file-mode runs", () => {
    expect(
      shouldStopAfterPhase0Refine({
        commit: true,
        mode: "file",
        resume: false,
      }),
    ).toBe(true);
    expect(
      shouldStopAfterPhase0Refine({
        commit: true,
        mode: "inline",
        resume: false,
      }),
    ).toBe(false);
    expect(
      shouldStopAfterPhase0Refine({
        commit: true,
        mode: "interactive",
        resume: false,
      }),
    ).toBe(false);
    expect(
      shouldStopAfterPhase0Refine({
        commit: false,
        mode: "file",
        resume: false,
      }),
    ).toBe(false);
    expect(
      shouldStopAfterPhase0Refine({
        commit: true,
        mode: "file",
        resume: true,
      }),
    ).toBe(false);
  });

  test("appends a blocker section for intent review with the concrete spec dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-phase0-gate-"));
    try {
      const intentPath = join(dir, "intent.md");
      writeFileSync(intentPath, "# Intent\n\nInitial request.\n", "utf8");
      const out = appendPhase0ReviewGateBlocker(
        intentPath,
        "2026-05-20T02-41-21Z-plan-intent-review-gate",
      );
      expect(out).toContain("## Blocker");
      expect(out).toContain(
        "spec/2026-05-20T02-41-21Z-plan-intent-review-gate/intent.md",
      );
      expect(out).toContain("jarvis plan --resume-draft spec/");
      expect(out).toContain("/intent.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("seedIntentFile", () => {
  test("file mode: copies intent file byte-for-byte to spec/<name>/intent.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-seed-file-"));
    try {
      const worktreePath = join(dir, "worktree");
      mkdirSync(worktreePath);

      const intentContent = "# My Intent\n\nThis is the intent.\n";
      const sourceIntentPath = join(dir, "source-intent.md");
      writeFileSync(sourceIntentPath, intentContent, "utf8");

      seedIntentFile({
        worktreePath,
        name: "my-spec",
        mode: "file",
        intentPath: sourceIntentPath,
      });

      const writtenPath = join(worktreePath, "spec", "my-spec", "intent.md");
      expect(existsSync(writtenPath)).toBe(true);
      const written = readFileSync(writtenPath, "utf8");
      expect(written).toBe(intentContent);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("file mode: with trailing newline preserved", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-seed-trailing-newline-"));
    try {
      const worktreePath = join(dir, "worktree");
      mkdirSync(worktreePath);

      const intentContent = "intent text";
      const sourceIntentPath = join(dir, "source.md");
      writeFileSync(sourceIntentPath, intentContent, "utf8");

      seedIntentFile({
        worktreePath,
        name: "my-spec",
        mode: "file",
        intentPath: sourceIntentPath,
      });

      const writtenPath = join(worktreePath, "spec", "my-spec", "intent.md");
      const written = readFileSync(writtenPath, "utf8");
      expect(written).toBe(intentContent);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("inline mode: writes text with exactly one trailing newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-seed-inline-"));
    try {
      const worktreePath = join(dir, "worktree");
      mkdirSync(worktreePath);

      seedIntentFile({
        worktreePath,
        name: "my-spec",
        mode: "inline",
        intentText: "add csv export to reports",
      });

      const writtenPath = join(worktreePath, "spec", "my-spec", "intent.md");
      expect(existsSync(writtenPath)).toBe(true);
      const written = readFileSync(writtenPath, "utf8");
      expect(written).toBe("add csv export to reports\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("inline mode: exactly one newline even if text is empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-seed-inline-empty-"));
    try {
      const worktreePath = join(dir, "worktree");
      mkdirSync(worktreePath);

      seedIntentFile({
        worktreePath,
        name: "my-spec",
        mode: "inline",
        intentText: "",
      });

      const writtenPath = join(worktreePath, "spec", "my-spec", "intent.md");
      const written = readFileSync(writtenPath, "utf8");
      expect(written).toBe("\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("interactive mode: writes minimal seed intent", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-seed-interactive-"));
    try {
      const worktreePath = join(dir, "worktree");
      mkdirSync(worktreePath);

      seedIntentFile({
        worktreePath,
        name: "my-spec",
        mode: "interactive",
      });

      const writtenPath = join(worktreePath, "spec", "my-spec", "intent.md");
      expect(existsSync(writtenPath)).toBe(true);
      const written = readFileSync(writtenPath, "utf8");
      expect(written).toBe(
        "# Intent\n\n(Interactive session — no seed text. The refine phase will gather\nthe intent.)\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("existing intent.md in worktree → throws error", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-seed-collision-"));
    try {
      const worktreePath = join(dir, "worktree");
      const existingPath = join(worktreePath, "spec", "my-spec", "intent.md");
      mkdirSync(dirname(existingPath), { recursive: true });
      writeFileSync(existingPath, "existing", "utf8");

      expect(() => {
        seedIntentFile({
          worktreePath,
          name: "my-spec",
          mode: "inline",
          intentText: "new intent",
        });
      }).toThrow("intent.md already exists");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unreadable source intent file → throws error", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-seed-unreadable-"));
    try {
      const worktreePath = join(dir, "worktree");
      mkdirSync(worktreePath);

      expect(() => {
        seedIntentFile({
          worktreePath,
          name: "my-spec",
          mode: "file",
          intentPath: "/nonexistent/path/to/intent.md",
        });
      }).toThrow("could not read intent file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("creates spec/<name>/ directory as needed", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-seed-mkdir-"));
    try {
      const worktreePath = join(dir, "worktree");
      mkdirSync(worktreePath);

      seedIntentFile({
        worktreePath,
        name: "my-spec",
        mode: "inline",
        intentText: "intent",
      });

      const specDir = join(worktreePath, "spec", "my-spec");
      expect(existsSync(specDir)).toBe(true);
      expect(existsSync(join(specDir, "intent.md"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("plan.ts regression: error message removed", () => {
  test("plan.ts no longer contains the error string 'commit: false requires a git repository'", () => {
    const planTsContent = readFileSync(
      resolve(__dirname, "../src/commands/plan.ts"),
      "utf8",
    );
    expect(planTsContent).not.toContain(
      "commit: false requires a git repository",
    );
  });
});

describe("intent frontmatter naming helpers", () => {
  test("parseIntentFrontmatter reads leading name field", () => {
    const parsed = parseIntentFrontmatter(
      "---\nname: csv-export\n---\n\n# Intent\nhello\n",
    );
    expect(parsed.name).toBe("csv-export");
  });

  test("parseIntentFrontmatter ignores non-leading block", () => {
    const parsed = parseIntentFrontmatter(
      "# Intent\n---\nname: csv-export\n---\n",
    );
    expect(parsed.name).toBeUndefined();
  });

  test("validateProposedName accepts valid kebab name", () => {
    const validation = validateProposedName("csv-export-v2");
    expect(validation.valid).toBe(true);
    expect(validation.normalized).toBe("csv-export-v2");
  });

  test("validateProposedName rejects reserved and invalid names", () => {
    expect(validateProposedName("index").valid).toBe(false);
    expect(validateProposedName("UPPER").valid).toBe(false);
    expect(validateProposedName("a".repeat(41)).valid).toBe(false);
  });
});
