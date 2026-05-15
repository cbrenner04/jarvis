import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deriveSpecName,
  PLAN_STUB_MESSAGE,
  PLAN_USAGE,
  planCommand,
} from "../src/commands/plan.ts";
import type { PlanInvocation } from "../src/commands/plan-args.ts";
import { parsePlanArgs } from "../src/commands/plan-args.ts";
import { registerProject } from "../src/config.ts";
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
  test("no args → interactive mode, stub on stderr, exit 2", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    try {
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        cwd: project,
        config: { dir: cfgDir },
        logClient: okLogClient,
        skipGhCheck: true,
      });
      expect(code).toBe(2);
      expect(cap.err()).toContain("plan mode: interactive");
      expect(cap.err()).toContain(PLAN_STUB_MESSAGE);
      expect(cap.out()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--help prints usage to stdout, exit 0", async () => {
    const cap = captureIo();
    const code = await planCommand({ io: cap.io, args: ["--help"] });
    expect(code).toBe(0);
    expect(cap.out()).toBe(PLAN_USAGE);
    expect(cap.err()).toBe("");
  });

  test("-h prints usage to stdout, exit 0", async () => {
    const cap = captureIo();
    const code = await planCommand({ io: cap.io, args: ["-h"] });
    expect(code).toBe(0);
    expect(cap.out()).toBe(PLAN_USAGE);
    expect(cap.err()).toBe("");
  });

  test("usage advertises full surface", () => {
    expect(PLAN_USAGE).toContain("--interview-turns");
    expect(PLAN_USAGE).toContain("--review-passes");
    expect(PLAN_USAGE).toContain("--repo");
    expect(PLAN_USAGE).toContain("--cwd");
    expect(PLAN_USAGE).toContain("--resume");
    expect(PLAN_USAGE).toContain("intent-file-or-text");
  });

  test("inline mode: positional that is not a file", async () => {
    const { dir, cfgDir, project } = setupRegisteredProject();
    try {
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["this is freeform intent"],
        cwd: project,
        config: { dir: cfgDir },
        logClient: okLogClient,
      });
      expect(code).toBe(2);
      expect(cap.err()).toContain("plan mode: inline");
      expect(cap.err()).toContain("this is freeform intent");
      expect(cap.err()).toContain(PLAN_STUB_MESSAGE);
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
      const code = await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: okLogClient,
      });
      expect(code).toBe(2);
      expect(cap.err()).toContain(
        `plan mode: target project=project-a root=${projectA}`,
      );
      expect(cap.err()).toContain(PLAN_STUB_MESSAGE);
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
      const code = await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: okLogClient,
        skipGhCheck: true,
      });
      expect(code).toBe(2);
      expect(cap.err()).toContain(
        `plan mode: target project=project-b root=${projectB}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("inline mode + --cwd inside a registered project resolves to that project", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--cwd", projectA, "freeform intent"],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: okLogClient,
      });
      expect(code).toBe(2);
      expect(cap.err()).toContain("plan mode: inline");
      expect(cap.err()).toContain(
        `plan mode: target project=project-a root=${projectA}`,
      );
      expect(cap.err()).toContain(PLAN_STUB_MESSAGE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("interactive mode + --cwd inside a registered project resolves to that project", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--cwd", projectA],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: okLogClient,
      });
      expect(code).toBe(2);
      expect(cap.err()).toContain("plan mode: interactive");
      expect(cap.err()).toContain(
        `plan mode: target project=project-a root=${projectA}`,
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
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a", intentPath],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: okLogClient,
      });
      expect(code).toBe(2);
      expect(cap.err()).toContain(
        `plan mode: target project=project-a root=${projectA}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--repo <name> overrides path-walk fallback in inline mode", async () => {
    const { dir, cfgDir, projectA } = setupWorld();
    try {
      registerProject("project-a", projectA, { dir: cfgDir });

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project-a", "freeform"],
        cwd: dir,
        config: { dir: cfgDir },
        logClient: okLogClient,
      });
      expect(code).toBe(2);
      expect(cap.err()).toContain(
        `plan mode: target project=project-a root=${projectA}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--repo <name> overrides path-walk fallback in interactive mode", async () => {
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
        `plan mode: target project=project-a root=${projectA}`,
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
      expect(cap.err()).not.toContain(PLAN_STUB_MESSAGE);
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
      expect(cap.err()).toContain(PLAN_STUB_MESSAGE);
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
      expect(cap.err()).not.toContain(PLAN_STUB_MESSAGE);
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
      expect(cap.err()).toContain(PLAN_STUB_MESSAGE);
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
      expect(cap.err()).not.toContain(PLAN_STUB_MESSAGE);
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
      expect(cap.err()).not.toContain(PLAN_STUB_MESSAGE);
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

  test("--interview-turns valid", () => {
    setup();
    try {
      const res = parsePlanArgs(["--interview-turns", "3"], tmp);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.invocation.interviewTurns).toBe(3);
    } finally {
      teardown();
    }
  });

  test("--interview-turns negative → exit 1", () => {
    setup();
    try {
      const res = parsePlanArgs(["--interview-turns", "-1"], tmp);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.exitCode).toBe(1);
      expect(res.message).toContain("--interview-turns");
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
      expect(res.invocation.mode).toBe("interactive");
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
      };
      const name = await deriveSpecName(inv, projectRoot);
      expect(name).toBe("oauth-login-3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
