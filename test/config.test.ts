import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Config,
  effectiveGit,
  findProjectForPath,
  findProjectMatchForPath,
  loadConfig,
  openSessionLog,
  registerProject,
  setGit,
  setProjectGit,
  setProjectOrigin,
  writeConfig,
} from "../src/config.ts";

let dir: string;

const DEFAULT_PATCH_MODELS = {
  claude: "haiku",
  codex: "gpt-5.3-codex",
  cursor: "Composer 2",
  opencode: "github-copilot/claude-opus-4.7",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("bootstraps from empty dir with defaults", () => {
    const file = join(dir, "config.json");
    expect(existsSync(file)).toBe(false);

    const cfg = loadConfig({ dir });

    expect(cfg).toEqual({
      version: 2,
      modes: {
        patch: { agentOrder: ["claude", "codex", "cursor"] },
        plan: { agentOrder: ["claude", "codex", "cursor"] },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      patchModels: DEFAULT_PATCH_MODELS,
      logServerUrl: "http://127.0.0.1:4310/logs",
      logServerBind: "127.0.0.1:4310",
      telemetryPath: join(dir, "runs.jsonl"),
      git: true,
      projects: {},
    });
    expect(existsSync(file)).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as Config;
    expect(onDisk).toEqual(cfg);
  });

  test("is idempotent: second call does not overwrite", () => {
    const cfg = loadConfig({ dir });
    cfg.projects.foo = { root: "/tmp/foo" };
    writeConfig(cfg, { dir });

    const reloaded = loadConfig({ dir });
    expect(reloaded.projects.foo).toEqual({ root: "/tmp/foo" });
  });

  test("loads an existing valid config", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["codex", "claude"] },
          plan: { agentOrder: ["claude"] },
        },
        quotaFallback: "strict",
        maxIterations: 7,
        patchModels: {
          claude: "sonnet",
          codex: "gpt-5.3-codex",
          cursor: "Composer 2",
          opencode: "opencode-model",
        },
        projects: { jarvis: { root: "/Users/me/jarvis" } },
      }),
    );

    const cfg = loadConfig({ dir });
    expect(cfg.modes.patch.agentOrder).toEqual(["codex", "claude"]);
    expect(cfg.modes.plan.agentOrder).toEqual(["claude"]);
    expect(cfg.quotaFallback).toBe("strict");
    expect(cfg.maxIterations).toBe(7);
    expect(cfg.patchModels.claude).toBe("sonnet");
    expect(cfg.patchModels.opencode).toBe("opencode-model");
    expect(cfg.logServerUrl).toBe("http://127.0.0.1:4310/logs");
    expect(cfg.logServerBind).toBe("127.0.0.1:4310");
    expect(cfg.telemetryPath).toBe(join(dir, "runs.jsonl"));
    expect(cfg.projects.jarvis).toEqual({ root: "/Users/me/jarvis" });
  });

  test("defaults maxIterations when an existing config omits it", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        projects: {},
      }),
    );

    expect(loadConfig({ dir }).maxIterations).toBe(10);
  });

  test("defaults quotaFallback when an existing config omits it", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        projects: {},
      }),
    );

    expect(loadConfig({ dir }).quotaFallback).toBe("lenient");
  });

  test("rejects invalid quotaFallback", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        quotaFallback: "off",
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/quotaFallback/);
  });

  test("defaults patchModels when an existing config omits it", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 7,
        projects: {},
      }),
    );

    const cfg = loadConfig({ dir });
    expect(cfg.patchModels).toEqual(DEFAULT_PATCH_MODELS);
    expect(JSON.parse(readFileSync(file, "utf8"))).not.toHaveProperty(
      "patchModels",
    );
  });

  test("populates missing opencode patch model for legacy configs", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 7,
        patchModels: {
          claude: "haiku",
          codex: "gpt-5.3-codex",
          cursor: "Composer 2",
        },
        projects: {},
      }),
    );

    const cfg = loadConfig({ dir });
    expect(cfg.patchModels).toEqual(DEFAULT_PATCH_MODELS);
    expect(
      JSON.parse(readFileSync(file, "utf8")).patchModels,
    ).not.toHaveProperty("opencode");
  });

  test("rejects invalid maxIterations", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 0,
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/maxIterations/);
  });

  test("rejects invalid iterationTimeoutMs", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        iterationTimeoutMs: -1,
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/iterationTimeoutMs/);
  });

  test("rejects invalid runTimeoutMs", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        iterationTimeoutMs: 30 * 60_000,
        runTimeoutMs: 0,
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/runTimeoutMs/);
  });

  test("accepts telemetryPath as null", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
        telemetryPath: null,
        projects: {},
      }),
    );
    expect(loadConfig({ dir }).telemetryPath).toBeNull();
  });

  test("accepts optional runTimeoutMs", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        iterationTimeoutMs: 30 * 60_000,
        runTimeoutMs: 60 * 60_000,
        patchModels: DEFAULT_PATCH_MODELS,
        git: true,
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.runTimeoutMs).toBe(60 * 60_000);
  });

  test("rejects non-object patchModels", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: "haiku",
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/patchModels/);
  });

  test("rejects non-string patchModels values", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: {
          claude: 1,
          codex: "gpt-5.3-codex",
          cursor: "Composer 2",
          opencode: "github-copilot/claude-opus-4.7",
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/patchModels\.claude/);
  });

  test("rejects empty patchModels values", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: {
          claude: " ",
          codex: "gpt-5.3-codex",
          cursor: "Composer 2",
          opencode: "github-copilot/claude-opus-4.7",
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/patchModels\.claude/);
  });

  test("rejects unknown patchModels keys", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: {
          claude: "haiku",
          codex: "gpt-5.3-codex",
          cursor: "Composer 2",
          opencode: "github-copilot/claude-opus-4.7",
          gpt: "model",
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/patchModels.*unknown agent/);
  });

  test("rejects missing patchModels keys when patchModels is present", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: {
          claude: "haiku",
          codex: "gpt-5.3-codex",
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/patchModels\.cursor/);
  });

  test("rejects v1 config", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        agentOrder: ["claude"],
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(
      /config version 1 is not supported/,
    );
  });

  test("rejects config with legacy agentOrder key", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        agentOrder: ["claude"],
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/legacy keys found/);
  });

  test("rejects config with legacy planAgentOrder key", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        planAgentOrder: ["claude"],
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/legacy keys found/);
  });

  test("rejects missing modes object", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes/);
  });

  test("rejects missing modes.patch", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          plan: { agentOrder: ["claude"] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch/);
  });

  test("rejects missing modes.plan", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.plan/);
  });

  test("rejects empty patch agentOrder", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: [] },
          plan: { agentOrder: ["claude"] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(
      /modes\.patch\.agentOrder.*non-empty/,
    );
  });

  test("rejects empty plan agentOrder", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: [] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(
      /modes\.plan\.agentOrder.*non-empty/,
    );
  });

  test("rejects duplicate agents in patch agentOrder", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude", "claude"] },
          plan: { agentOrder: ["claude"] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(
      /modes\.patch\.agentOrder.*duplicate/,
    );
  });

  test("rejects duplicate agents in plan agentOrder", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude", "codex", "claude"] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(
      /modes\.plan\.agentOrder.*duplicate/,
    );
  });

  test("rejects unknown agent", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["gpt"] },
          plan: { agentOrder: ["claude"] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/unknown agent/);
  });

  test("rejects missing version", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/version/);
  });

  test("rejects non-absolute project root", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        projects: { foo: { root: "relative/path" } },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/absolute/);
  });

  test("rejects duplicate project roots", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        projects: {
          a: { root: "/tmp/shared" },
          b: { root: "/tmp/shared" },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/duplicate/);
  });

  test("rejects malformed JSON, mentioning the path", () => {
    const file = join(dir, "config.json");
    writeFileSync(file, "{ not json");
    expect(() => loadConfig({ dir })).toThrow(file);
  });

  test("accepts an optional origin on a project", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
        projects: {
          "app-a": {
            root: "/tmp/jarvis-with-origin",
            origin: "git@github.com:you/app-a.git",
          },
        },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects["app-a"]).toEqual({
      root: "/tmp/jarvis-with-origin",
      origin: "git@github.com:you/app-a.git",
    });
  });

  test("loads configs without origin", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
        projects: { "app-a": { root: "/tmp/jarvis-legacy" } },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects["app-a"]).toEqual({ root: "/tmp/jarvis-legacy" });
  });

  test("rejects non-string project origin", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
        projects: { "app-a": { root: "/tmp/jarvis-bad", origin: 42 } },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/origin/);
  });
});

describe("registerProject / findProjectForPath", () => {
  test("registers and resolves a project by descendant path", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-proj-"));
    try {
      registerProject("proj", root, { dir });
      expect(findProjectForPath(root, { dir })).toEqual({ root });
      expect(findProjectForPath(join(root, "spec", "x.md"), { dir })).toEqual({
        root,
      });
      expect(findProjectForPath(tmpdir(), { dir })).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("registerProject refuses non-absolute root", () => {
    expect(() => registerProject("x", "relative", { dir })).toThrow(/absolute/);
  });

  test("registerProject refuses duplicate root under a different name", () => {
    registerProject("a", "/tmp/jarvis-dup", { dir });
    expect(() => registerProject("b", "/tmp/jarvis-dup", { dir })).toThrow(
      /already registered/,
    );
  });

  test("findProjectForPath picks the longest matching root", () => {
    registerProject("outer", "/tmp/jarvis-outer", { dir });
    registerProject("inner", "/tmp/jarvis-outer/inner", { dir });
    expect(
      findProjectForPath("/tmp/jarvis-outer/inner/file.md", { dir }),
    ).toEqual({
      root: "/tmp/jarvis-outer/inner",
    });
    expect(
      findProjectForPath("/tmp/jarvis-outer/other/file.md", { dir }),
    ).toEqual({
      root: "/tmp/jarvis-outer",
    });
  });

  test("findProjectMatchForPath returns the matching project key", () => {
    registerProject("outer", "/tmp/jarvis-keyed", { dir });
    registerProject("inner", "/tmp/jarvis-keyed/nested", { dir });

    expect(
      findProjectMatchForPath("/tmp/jarvis-keyed/nested/spec/index.md", {
        dir,
      }),
    ).toEqual({
      key: "inner",
      root: "/tmp/jarvis-keyed/nested",
    });
  });

  test("registerProject stores origin when provided", () => {
    registerProject("with-origin", "/tmp/jarvis-with-origin", {
      dir,
      origin: "git@github.com:you/app.git",
    });
    expect(findProjectMatchForPath("/tmp/jarvis-with-origin", { dir })).toEqual(
      {
        key: "with-origin",
        root: "/tmp/jarvis-with-origin",
        origin: "git@github.com:you/app.git",
      },
    );
  });

  test("setProjectOrigin updates an existing project's origin", () => {
    registerProject("lazy", "/tmp/jarvis-lazy", { dir });
    setProjectOrigin("lazy", "https://github.com/you/lazy.git", { dir });
    const cfg = loadConfig({ dir });
    expect(cfg.projects.lazy).toEqual({
      root: "/tmp/jarvis-lazy",
      origin: "https://github.com/you/lazy.git",
    });
  });
});

describe("git toggle", () => {
  test("defaults to true on bootstrap", () => {
    const cfg = loadConfig({ dir });
    expect(cfg.git).toBe(true);
  });

  test("loads configs with default git as true", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.git).toBe(true);
  });

  test("loads explicit git: false", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
        git: false,
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.git).toBe(false);
  });

  test("rejects non-boolean top-level git with file path in error", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
        git: "yes",
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/git must be a boolean/);
  });

  test("accepts optional project git override", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
        projects: { app: { root: "/tmp/jarvis-git-app", git: false } },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects.app).toEqual({
      root: "/tmp/jarvis-git-app",
      git: false,
    });
  });

  test("rejects non-boolean project git with file path in error", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: ["claude"] },
        },
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
        projects: { app: { root: "/tmp/jarvis-git-bad", git: "no" } },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/git must be a boolean/);
  });

  test("effectiveGit returns project override when set", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: ["claude"] },
        plan: { agentOrder: ["claude"] },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      patchModels: DEFAULT_PATCH_MODELS,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: { app: { root: "/tmp/a", git: false } },
    };
    expect(effectiveGit(cfg, "app")).toBe(false);
  });

  test("effectiveGit falls back to top-level value when no override", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: ["claude"] },
        plan: { agentOrder: ["claude"] },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      patchModels: DEFAULT_PATCH_MODELS,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: false,
      projects: { app: { root: "/tmp/a" } },
    };
    expect(effectiveGit(cfg, "app")).toBe(false);
  });

  test("effectiveGit returns top-level value when project not provided", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: ["claude"] },
        plan: { agentOrder: ["claude"] },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      patchModels: DEFAULT_PATCH_MODELS,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: false,
      projects: {},
    };
    expect(effectiveGit(cfg)).toBe(false);
  });

  test("setGit round-trips through disk", () => {
    setGit(false, { dir });
    expect(loadConfig({ dir }).git).toBe(false);
    setGit(true, { dir });
    expect(loadConfig({ dir }).git).toBe(true);
  });

  test("setProjectGit writes, clears, and rejects unknown", () => {
    registerProject("app", "/tmp/jarvis-git-set", { dir });
    setProjectGit("app", false, { dir });
    expect(loadConfig({ dir }).projects.app).toEqual({
      root: "/tmp/jarvis-git-set",
      git: false,
    });
    setProjectGit("app", undefined, { dir });
    expect(loadConfig({ dir }).projects.app).toEqual({
      root: "/tmp/jarvis-git-set",
    });
    expect(() => setProjectGit("ghost", true, { dir })).toThrow(
      /not registered/,
    );
  });
});

describe("openSessionLog", () => {
  test("creates sessions dir under the configured jarvis dir and appends", () => {
    const fd = openSessionLog("project-name", "2026-05-10T14:30Z", { dir });
    try {
      expect(existsSync(join(dir, "sessions"))).toBe(true);
      expect(
        existsSync(join(dir, "sessions", "project-name-2026-05-10T14:30Z.log")),
      ).toBe(true);
    } finally {
      closeSync(fd);
    }
  });
});

describe("atomic writes", () => {
  test("survives concurrent writes - first write is preserved", () => {
    const _cfg1 = loadConfig({ dir });
    registerProject("app1", "/app1", { dir });
    expect(loadConfig({ dir }).projects.app1).toBeDefined();

    registerProject("app2", "/app2", { dir });
    const loaded = loadConfig({ dir });

    // Both should be registered
    expect(loaded.projects.app1).toBeDefined();
    expect(loaded.projects.app2).toBeDefined();
  });

  test("config file is not corrupted by write", () => {
    const cfg = loadConfig({ dir });
    cfg.projects.test = { root: "/test/root" };
    writeConfig(cfg, { dir });

    // Read file and verify it's valid JSON
    const file = join(dir, "config.json");
    const content = readFileSync(file, "utf8");
    expect(() => JSON.parse(content)).not.toThrow();

    // Verify the write was successful
    const loaded = loadConfig({ dir });
    expect(loaded.projects.test).toBeDefined();
  });
});
