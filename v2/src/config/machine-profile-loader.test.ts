import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadError } from "./agent-model-config.ts";
import { validateAgentModelConfig } from "./agent-model-config.ts";
import {
  DEFAULT_SETTLE_DELAY_MS,
  loadMachineProfileMemory,
  loadMachineProfileModels,
} from "./machine-profile-loader.ts";

/** Pre-migration global agent-model-config content for claude/codex, retained here to prove no drift. */
const PRE_MIGRATION_CLAUDE_CODEX = {
  claude: {
    plan: {
      rungs: [
        { adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" },
        { adapterModel: "claude-haiku-4-5-20251001", priceKey: "claude-haiku-4-5-20251001" },
      ],
    },
    implement: {
      rungs: [
        { adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" },
        { adapterModel: "claude-haiku-4-5-20251001", priceKey: "claude-haiku-4-5-20251001" },
      ],
    },
    adversary: { rungs: [{ adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" }] },
    advocate: { rungs: [{ adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" }] },
    adjudicator: { rungs: [{ adapterModel: "claude-sonnet-4-6", priceKey: "claude-sonnet-4-6" }] },
    actuator: { rungs: [{ adapterModel: "claude-haiku-4-5-20251001", priceKey: "claude-haiku-4-5-20251001" }] },
  },
  codex: {
    plan: { rungs: [{ adapterModel: "gpt-5.4", priceKey: "gpt-5.4" }] },
    implement: { rungs: [{ adapterModel: "gpt-5.4", priceKey: "gpt-5.4" }] },
    adversary: { rungs: [{ adapterModel: "gpt-5.4", priceKey: "gpt-5.4" }] },
    advocate: { rungs: [{ adapterModel: "gpt-5.4", priceKey: "gpt-5.4" }] },
    adjudicator: { rungs: [{ adapterModel: "gpt-5.4", priceKey: "gpt-5.4" }] },
    actuator: { rungs: [{ adapterModel: "gpt-5.4", priceKey: "gpt-5.4" }] },
  },
};

const MACHINES_DIR = join(import.meta.dir, "..", "..", "..", "config", "machines");

const VALID_MODELS = {
  claude: {
    plan: { rungs: [{ adapterModel: "m1", priceKey: "p1" }] },
    implement: { rungs: [{ adapterModel: "m2", priceKey: "p2" }] },
    adversary: { rungs: [{ adapterModel: "m3", priceKey: "p3" }] },
    advocate: { rungs: [{ adapterModel: "m4", priceKey: "p4" }] },
    adjudicator: { rungs: [{ adapterModel: "m5", priceKey: "p5" }] },
    actuator: { rungs: [{ adapterModel: "m6", priceKey: "p6" }] },
  },
};

const writtenProfiles: string[] = [];

function writeProfile(name: string, content: string): void {
  mkdirSync(MACHINES_DIR, { recursive: true });
  const filePath = join(MACHINES_DIR, `${name}.json`);
  writeFileSync(filePath, content, "utf-8");
  writtenProfiles.push(filePath);
}

function isError(result: unknown): result is LoadError {
  return (
    typeof result === "object" && result !== null && "errors" in result && Array.isArray((result as LoadError).errors)
  );
}

afterEach(() => {
  for (const filePath of writtenProfiles.splice(0)) {
    if (existsSync(filePath)) rmSync(filePath);
  }
});

describe("loadMachineProfileModels", () => {
  test("missing profile file throws naming profile and resolved path", () => {
    expect(() => loadMachineProfileModels("does-not-exist", ["claude"])).toThrow(
      /does-not-exist.*config\/machines\/does-not-exist\.json/s,
    );
  });

  test("malformed JSON throws naming the file", () => {
    writeProfile("bad-json-profile", "{ not valid json");
    expect(() => loadMachineProfileModels("bad-json-profile", ["claude"])).toThrow(/bad-json-profile.*\.json/s);
  });

  test("valid profile with models returns AgentModelConfig", () => {
    writeProfile("valid-models-profile", JSON.stringify({ models: VALID_MODELS }));
    const result = loadMachineProfileModels("valid-models-profile", ["claude"]);
    expect(isError(result)).toBe(false);
  });

  test("models missing required role returns LoadError naming agent and role", () => {
    const models = {
      claude: {
        ...VALID_MODELS.claude,
        actuator: undefined,
      },
    };
    writeProfile("missing-role-profile", JSON.stringify({ models }));
    const result = loadMachineProfileModels("missing-role-profile", ["claude"]);
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("claude") && e.includes("actuator"))).toBe(true);
    }
  });

  test("missing models key returns LoadError naming the missing key, not a malformed-object claim", () => {
    writeProfile("missing-models-key-profile", JSON.stringify({}));
    const result = loadMachineProfileModels("missing-models-key-profile", ["claude"]);
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("missing-models-key-profile") && e.includes("models"))).toBe(true);
      expect(result.errors.some((e) => e.includes("JSON object"))).toBe(false);
    }
  });

  test("resolves path under config/machines/", () => {
    writeProfile("path-resolution-profile", JSON.stringify({ models: VALID_MODELS }));
    const result = loadMachineProfileModels("path-resolution-profile", ["claude"]);
    expect(isError(result)).toBe(false);
  });
});

describe("loadMachineProfileMemory", () => {
  test("no memory key returns default settle delay and undefined minFreeGb", () => {
    writeProfile("no-memory-profile", JSON.stringify({ models: VALID_MODELS }));
    const result = loadMachineProfileMemory("no-memory-profile");
    expect(result).toEqual({ minFreeGb: undefined, settleDelayMs: DEFAULT_SETTLE_DELAY_MS });
  });

  test("memory present is validated and returned", () => {
    writeProfile(
      "with-memory-profile",
      JSON.stringify({ models: VALID_MODELS, memory: { minFreeGb: 4, settleDelayMs: 500 } }),
    );
    const result = loadMachineProfileMemory("with-memory-profile");
    expect(result).toEqual({ minFreeGb: 4, settleDelayMs: 500 });
  });
});

describe("home profile fixture diff", () => {
  test("claude/codex bindings match pre-migration global agent-model-config", () => {
    const result = loadMachineProfileModels("home", ["claude", "codex"]);
    const expected = validateAgentModelConfig(PRE_MIGRATION_CLAUDE_CODEX, ["claude", "codex"]);
    expect(result).toEqual(expected);
  });
});
