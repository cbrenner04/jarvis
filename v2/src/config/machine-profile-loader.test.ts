import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadError } from "./agent-model-config.ts";
import {
  DEFAULT_SETTLE_DELAY_MS,
  loadMachineProfileMemory,
  loadMachineProfileModels,
} from "./machine-profile-loader.ts";

const VALID_MODELS = {
  claude: {
    plan: { rungs: [{ adapterModel: "m1", priceKey: "p1" }] },
    implement: { rungs: [{ adapterModel: "m2", priceKey: "p2" }] },
    shrink: { rungs: [{ adapterModel: "m7", priceKey: "p7" }] },
    adversary: { rungs: [{ adapterModel: "m3", priceKey: "p3" }] },
    advocate: { rungs: [{ adapterModel: "m4", priceKey: "p4" }] },
    adjudicator: { rungs: [{ adapterModel: "m5", priceKey: "p5" }] },
    actuator: { rungs: [{ adapterModel: "m6", priceKey: "p6" }] },
  },
};

const tempDirs: string[] = [];

function machinesDirWithProfile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-machines-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, `${name}.json`), content, "utf-8");
  return dir;
}

function isError(result: unknown): result is LoadError {
  return (
    typeof result === "object" && result !== null && "errors" in result && Array.isArray((result as LoadError).errors)
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadMachineProfileModels", () => {
  test("missing profile file throws naming profile and default config/machines path", () => {
    // No machinesDir override: proves default resolution lands under config/machines/ (read-only).
    expect(() => loadMachineProfileModels("does-not-exist", ["claude"])).toThrow(
      /does-not-exist.*config\/machines\/does-not-exist\.json/s,
    );
  });

  test("malformed JSON throws naming the file", () => {
    const machinesDir = machinesDirWithProfile("bad-json-profile", "{ not valid json");
    expect(() => loadMachineProfileModels("bad-json-profile", ["claude"], { machinesDir })).toThrow(
      /bad-json-profile.*\.json/s,
    );
  });

  test("valid profile with models returns AgentModelConfig", () => {
    const machinesDir = machinesDirWithProfile("valid-models-profile", JSON.stringify({ models: VALID_MODELS }));
    const result = loadMachineProfileModels("valid-models-profile", ["claude"], { machinesDir });
    expect(isError(result)).toBe(false);
  });

  test("models missing required role (actuator) returns LoadError naming agent and role", () => {
    const models = {
      claude: {
        ...VALID_MODELS.claude,
        actuator: undefined,
      },
    };
    const machinesDir = machinesDirWithProfile("missing-actuator-role-profile", JSON.stringify({ models }));
    const result = loadMachineProfileModels("missing-actuator-role-profile", ["claude"], { machinesDir });
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("claude") && e.includes("actuator"))).toBe(true);
    }
  });

  test("models missing required role (shrink) returns LoadError naming agent and role", () => {
    const models = {
      claude: {
        ...VALID_MODELS.claude,
        shrink: undefined,
      },
    };
    const machinesDir = machinesDirWithProfile("missing-shrink-role-profile", JSON.stringify({ models }));
    const result = loadMachineProfileModels("missing-shrink-role-profile", ["claude"], { machinesDir });
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("claude") && e.includes("shrink"))).toBe(true);
    }
  });

  test("missing models key returns LoadError naming the missing key, not a malformed-object claim", () => {
    const machinesDir = machinesDirWithProfile("missing-models-key-profile", JSON.stringify({}));
    const result = loadMachineProfileModels("missing-models-key-profile", ["claude"], { machinesDir });
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("missing-models-key-profile") && e.includes("models"))).toBe(true);
      expect(result.errors.some((e) => e.includes("JSON object"))).toBe(false);
    }
  });
});

describe("loadMachineProfileMemory", () => {
  test("no memory key returns default settle delay and undefined minFreeGb", () => {
    const machinesDir = machinesDirWithProfile("no-memory-profile", JSON.stringify({ models: VALID_MODELS }));
    const result = loadMachineProfileMemory("no-memory-profile", { machinesDir });
    expect(result).toEqual({ minFreeGb: undefined, settleDelayMs: DEFAULT_SETTLE_DELAY_MS });
  });

  test("memory present is validated and returned", () => {
    const machinesDir = machinesDirWithProfile(
      "with-memory-profile",
      JSON.stringify({ models: VALID_MODELS, memory: { minFreeGb: 4, settleDelayMs: 500 } }),
    );
    const result = loadMachineProfileMemory("with-memory-profile", { machinesDir });
    expect(result).toEqual({ minFreeGb: 4, settleDelayMs: 500 });
  });
});
