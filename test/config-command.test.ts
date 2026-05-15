import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Io } from "../src/cli.ts";
import { configCommand } from "../src/commands/config.ts";
import { loadConfig, registerProject } from "../src/config.ts";

function captureIo(): { io: Io; out: () => string; err: () => string } {
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

let cfgDir: string;
beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), "jarvis-config-cmd-"));
});
afterEach(() => {
  rmSync(cfgDir, { recursive: true, force: true });
});

describe("config show", () => {
  test("returns the loaded config as JSON", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["show"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed).toEqual({
      version: 2,
      modes: {
        patch: { agentOrder: ["claude", "codex", "cursor"] },
        plan: { agentOrder: ["claude", "codex", "cursor"] },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 1800000,
      patchModels: {
        claude: "haiku",
        codex: "gpt-5.3-codex",
        cursor: "Composer 2",
        opencode: "github-copilot/claude-opus-4.7",
      },
      logServerUrl: "http://127.0.0.1:4310/logs",
      logServerBind: "127.0.0.1:4310",
      telemetryPath: join(cfgDir, "runs.jsonl"),
      git: true,
      projects: {},
    });
  });
});

describe("config path", () => {
  test("prints the config.json path", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["path"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    expect(cap.out().trim()).toBe(join(cfgDir, "config.json"));
  });
});

describe("config set-order", () => {
  test("happy path replaces agentOrder", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-order", "codex,claude,cursor"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.modes.patch.agentOrder).toEqual(["codex", "claude", "cursor"]);
    expect(cfg.modes.plan.agentOrder).toEqual(["codex", "claude", "cursor"]);
  });

  test("subset is allowed", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-order", "codex,claude"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.modes.patch.agentOrder).toEqual(["codex", "claude"]);
    expect(cfg.modes.plan.agentOrder).toEqual(["codex", "claude"]);
  });

  test("opencode is allowed", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-order", "claude,opencode"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.modes.patch.agentOrder).toEqual(["claude", "opencode"]);
    expect(cfg.modes.plan.agentOrder).toEqual(["claude", "opencode"]);
  });

  test("rejects unknown agent without changing file", () => {
    // seed config
    configCommand({
      args: ["show"],
      io: captureIo().io,
      config: { dir: cfgDir },
    });
    const before = readFileSync(join(cfgDir, "config.json"), "utf8");

    const cap = captureIo();
    const code = configCommand({
      args: ["set-order", "claude,bogus"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("unknown agent");

    const after = readFileSync(join(cfgDir, "config.json"), "utf8");
    expect(after).toBe(before);
  });

  test("rejects nonsense agent without changing file", () => {
    configCommand({
      args: ["show"],
      io: captureIo().io,
      config: { dir: cfgDir },
    });
    const before = readFileSync(join(cfgDir, "config.json"), "utf8");

    const cap = captureIo();
    const code = configCommand({
      args: ["set-order", "claude,nonsense"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("unknown agent");

    const after = readFileSync(join(cfgDir, "config.json"), "utf8");
    expect(after).toBe(before);
  });

  test("rejects duplicates", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-order", "claude,claude"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("duplicate");
  });

  test("rejects duplicate opencode", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-order", "claude,opencode,opencode"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("duplicate");
  });

  test("missing arg exits 1", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-order"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("missing");
  });

  test("empty arg exits 1", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-order", ""],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
  });
});

describe("config projects", () => {
  test("empty list message", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["projects"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    expect(cap.out()).toContain("no projects");
  });

  test("lists registered projects", () => {
    registerProject("alpha", "/tmp/alpha", { dir: cfgDir });
    registerProject("beta", "/tmp/beta", { dir: cfgDir });
    const cap = captureIo();
    const code = configCommand({
      args: ["projects"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    expect(cap.out()).toContain("alpha → /tmp/alpha");
    expect(cap.out()).toContain("beta → /tmp/beta");
  });
});

describe("config remove-project", () => {
  test("removes an existing project", () => {
    registerProject("alpha", "/tmp/alpha", { dir: cfgDir });
    const cap = captureIo();
    const code = configCommand({
      args: ["remove-project", "alpha"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    expect(loadConfig({ dir: cfgDir }).projects).toEqual({});
  });

  test("unknown project exits 1", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["remove-project", "ghost"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("unknown project");
  });

  test("missing name exits 1", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["remove-project"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
  });
});

describe("config edit", () => {
  test("rejects invalid edits with non-zero exit", () => {
    configCommand({
      args: ["show"],
      io: captureIo().io,
      config: { dir: cfgDir },
    });
    const file = join(cfgDir, "config.json");
    const cap = captureIo();
    const code = configCommand({
      args: ["edit"],
      io: cap.io,
      config: { dir: cfgDir },
      runEditor: (f) => {
        require("node:fs").writeFileSync(f, "not json");
        return 0;
      },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("Invalid config");
    expect(readFileSync(file, "utf8")).toBe("not json");
  });

  test("accepts a valid edit", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["edit"],
      io: cap.io,
      config: { dir: cfgDir },
      runEditor: (f) => {
        require("node:fs").writeFileSync(
          f,
          JSON.stringify({
            version: 2,
            modes: {
              patch: { agentOrder: ["cursor", "codex", "claude"] },
              plan: { agentOrder: ["cursor", "codex", "claude"] },
            },
            projects: {},
          }),
        );
        return 0;
      },
    });
    expect(code).toBe(0);
    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.modes.patch.agentOrder).toEqual([
      "cursor",
      "codex",
      "claude",
    ]);
    expect(cfg.modes.plan.agentOrder).toEqual([
      "cursor",
      "codex",
      "claude",
    ]);
  });

  test("editor non-zero exit is reported", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["edit"],
      io: cap.io,
      config: { dir: cfgDir },
      runEditor: () => 2,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("status 2");
  });
});

describe("config set-git", () => {
  test("writes true", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-git", "true"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    expect(loadConfig({ dir: cfgDir }).git).toBe(true);
  });

  test("writes false", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-git", "false"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    expect(loadConfig({ dir: cfgDir }).git).toBe(false);
  });

  test("rejects invalid value", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-git", "yes"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("set-git");
  });

  test("rejects missing value", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-git"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("missing");
  });
});

describe("config set-project-git", () => {
  test("sets per-project override", () => {
    registerProject("alpha", "/tmp/alpha-git", { dir: cfgDir });
    const cap = captureIo();
    const code = configCommand({
      args: ["set-project-git", "alpha", "false"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    expect(loadConfig({ dir: cfgDir }).projects.alpha).toEqual({
      root: "/tmp/alpha-git",
      git: false,
    });
  });

  test("clears per-project override with unset", () => {
    registerProject("alpha", "/tmp/alpha-git-unset", { dir: cfgDir });
    configCommand({
      args: ["set-project-git", "alpha", "true"],
      io: captureIo().io,
      config: { dir: cfgDir },
    });
    const cap = captureIo();
    const code = configCommand({
      args: ["set-project-git", "alpha", "unset"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    expect(loadConfig({ dir: cfgDir }).projects.alpha).toEqual({
      root: "/tmp/alpha-git-unset",
    });
  });

  test("unknown project exits 1", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-project-git", "ghost", "true"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("unknown project");
  });

  test("invalid value exits 1", () => {
    registerProject("alpha", "/tmp/alpha-git-bad", { dir: cfgDir });
    const cap = captureIo();
    const code = configCommand({
      args: ["set-project-git", "alpha", "maybe"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("set-project-git");
  });

  test("missing args exits 1", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["set-project-git", "alpha"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("missing");
  });
});

describe("config unknown subcommand", () => {
  test("exits 1", () => {
    const cap = captureIo();
    const code = configCommand({
      args: ["wat"],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("unknown config subcommand");
  });

  test("no subcommand exits 1", () => {
    const cap = captureIo();
    const code = configCommand({
      args: [],
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("Usage");
  });
});
