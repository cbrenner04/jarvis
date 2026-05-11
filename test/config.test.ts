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
  findProjectForPath,
  findProjectMatchForPath,
  loadConfig,
  openSessionLog,
  registerProject,
  writeConfig,
} from "../src/config.ts";

let dir: string;

const DEFAULT_PATCH_MODELS = {
  claude: "haiku",
  codex: "gpt-5.3-codex",
  cursor: "Composer 2",
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
      version: 1,
      agentOrder: ["claude", "codex", "cursor"],
      maxIterations: 10,
      patchModels: DEFAULT_PATCH_MODELS,
      logServerUrl: "http://127.0.0.1:4310/logs",
      logServerBind: "127.0.0.1:4310",
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
        version: 1,
        agentOrder: ["codex", "claude"],
        maxIterations: 7,
        patchModels: {
          claude: "sonnet",
          codex: "gpt-5.3-codex",
          cursor: "Composer 2",
        },
        projects: { jarvis: { root: "/Users/me/jarvis" } },
      }),
    );

    const cfg = loadConfig({ dir });
    expect(cfg.agentOrder).toEqual(["codex", "claude"]);
    expect(cfg.maxIterations).toBe(7);
    expect(cfg.patchModels.claude).toBe("sonnet");
    expect(cfg.logServerUrl).toBe("http://127.0.0.1:4310/logs");
    expect(cfg.logServerBind).toBe("127.0.0.1:4310");
    expect(cfg.projects.jarvis).toEqual({ root: "/Users/me/jarvis" });
  });

  test("defaults maxIterations when an existing config omits it", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        agentOrder: ["claude"],
        projects: {},
      }),
    );

    expect(loadConfig({ dir }).maxIterations).toBe(10);
  });

  test("defaults patchModels when an existing config omits it", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        agentOrder: ["claude"],
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

  test("rejects invalid maxIterations", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        agentOrder: ["claude"],
        maxIterations: 0,
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/maxIterations/);
  });

  test("rejects non-object patchModels", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        agentOrder: ["claude"],
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
        version: 1,
        agentOrder: ["claude"],
        maxIterations: 10,
        patchModels: {
          claude: 1,
          codex: "gpt-5.3-codex",
          cursor: "Composer 2",
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
        version: 1,
        agentOrder: ["claude"],
        maxIterations: 10,
        patchModels: {
          claude: " ",
          codex: "gpt-5.3-codex",
          cursor: "Composer 2",
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
        version: 1,
        agentOrder: ["claude"],
        maxIterations: 10,
        patchModels: {
          claude: "haiku",
          codex: "gpt-5.3-codex",
          cursor: "Composer 2",
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
        version: 1,
        agentOrder: ["claude"],
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

  test("rejects unknown agent", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ version: 1, agentOrder: ["gpt"], projects: {} }),
    );
    expect(() => loadConfig({ dir })).toThrow(/unknown agent/);
  });

  test("rejects missing version", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ agentOrder: ["claude"], projects: {} }),
    );
    expect(() => loadConfig({ dir })).toThrow(/version/);
  });

  test("rejects non-absolute project root", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        agentOrder: ["claude"],
        projects: { foo: { root: "relative/path" } },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/absolute/);
  });

  test("rejects duplicate project roots", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        agentOrder: ["claude"],
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
