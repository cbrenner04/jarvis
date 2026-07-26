import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_REVIEW_ROLE_TIMEOUT_MS,
  loadMachineConfig,
  readMachineConfigDocument,
  readProjectImplementReviewBehavior,
  readProjectImplementReviewPasses,
  readProjectRegistry,
  readReviewRoleTimeoutMs,
  resolveMachineProfile,
  resolveWritePathIterationBounds,
  validateMachineConfigAgents,
} from "./machine-config-loader.ts";

function writeRawConfig(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, text);
  return configPath;
}

function writeConfig(value: unknown): string {
  return writeRawConfig(JSON.stringify(value));
}

describe("loadMachineConfig", () => {
  test("nonexistent config path returns undefined", () => {
    expect(loadMachineConfig("/nonexistent/path/config.json")).toBeUndefined();
  });

  test.each([
    ["no 'agents' key", { other: "value" }],
    ["an empty object", {}],
  ] as Array<[string, unknown]>)("config with %s returns undefined", (_label, value) => {
    expect(loadMachineConfig(writeConfig(value))).toBeUndefined();
  });

  test.each([
    ["multiple agents", ["claude", "codex", "cursor"]],
    ["a single agent", ["claude"]],
    ["non-alphabetical order", ["z-agent", "a-agent", "m-agent"]],
    ["special characters", ["claude-3-opus", "gpt-5.2", "agent_v2"]],
  ] as Array<[string, string[]]>)("valid agents array (%s) is returned in order", (_label, agents) => {
    expect(loadMachineConfig(writeConfig({ agents }))).toEqual(agents);
  });

  test("ignores extra fields in config", () => {
    expect(loadMachineConfig(writeConfig({ agents: ["claude"], extra: "field", another: 123 }))).toEqual(["claude"]);
  });

  test("document reader preserves unrelated top-level keys", () => {
    expect(readMachineConfigDocument(writeConfig({ agents: ["claude"], extra: "field" }))).toEqual({
      agents: ["claude"],
      extra: "field",
    });
  });

  test("unparseable JSON throws", () => {
    expect(() => loadMachineConfig(writeRawConfig("{ invalid json"))).toThrow(/Failed to parse machine config/);
  });

  test.each([
    ["string root", "string", /must be a JSON object/],
    ["array root", ["claude"], /must be a JSON object/],
    ["null root", null, /must be a JSON object/],
    ["string 'agents'", { agents: "claude" }, /must be an array/],
    ["object 'agents'", { agents: { name: "claude" } }, /must be an array/],
    ["null 'agents'", { agents: null }, /must be an array/],
    ["number entry", { agents: [123] }, /entry at index 0 must be a string/],
    ["object entry", { agents: [{ name: "claude" }] }, /entry at index 0 must be a string/],
    ["null entry", { agents: [null] }, /entry at index 0 must be a string/],
    ["non-string entry after a valid one", { agents: ["claude", 123] }, /entry at index 1 must be a string/],
    ["empty-string entry", { agents: [""] }, /entry at index 0 must not be an empty string/],
    [
      "empty-string entry after a valid one",
      { agents: ["claude", ""] },
      /entry at index 1 must not be an empty string/,
    ],
    ["duplicate entries", { agents: ["claude", "codex", "claude"] }, /duplicate entry/],
    ["consecutive duplicate entries", { agents: ["claude", "claude"] }, /duplicate entry/],
    ["empty agents array", { agents: [] }, /must not be empty/],
  ] as Array<[string, unknown, RegExp]>)("malformed config throws on %s", (_label, value, pattern) => {
    expect(() => loadMachineConfig(writeConfig(value))).toThrow(pattern);
  });

  test("agent-array validator reuses duplicate checks for direct callers", () => {
    expect(() => validateMachineConfigAgents(["claude", "claude"])).toThrow(/duplicate entry/);
  });
});

describe("resolveMachineProfile", () => {
  test("nonexistent config path throws naming the missing key", () => {
    expect(() => resolveMachineProfile("/nonexistent/path/config.json")).toThrow(/missing required 'machineProfile'/);
  });

  test.each([
    ["absent key", { agents: ["claude"] }],
    ["empty string", { machineProfile: "" }],
    ["non-string value", { machineProfile: 123 }],
  ] as Array<[string, unknown]>)("throws naming the missing key on %s", (_label, value) => {
    expect(() => resolveMachineProfile(writeConfig(value))).toThrow(/missing required 'machineProfile'/);
  });

  test.each([["home"], ["work"]])("configured profile %s is returned (open string)", (profile) => {
    expect(resolveMachineProfile(writeConfig({ machineProfile: profile }))).toBe(profile);
  });
});

describe("write-path iteration bounds", () => {
  test("rejects idleOutputTimeoutMs above iterationTimeoutMs with both keys and values", () => {
    const configPath = writeConfig({
      agents: ["claude"],
      iterationTimeoutMs: 60_000,
      idleOutputTimeoutMs: 120_000,
      iterationCeilingMs: 1_800_000,
    });
    expect(() => resolveWritePathIterationBounds(configPath)).toThrow(
      "Machine config 'idleOutputTimeoutMs' (120000) must not exceed 'iterationTimeoutMs' (60000)",
    );
  });

  test("allows idleOutputTimeoutMs at or below iterationTimeoutMs", () => {
    const configPath = writeConfig({
      agents: ["claude"],
      iterationTimeoutMs: 600_000,
      idleOutputTimeoutMs: 90_000,
      iterationCeilingMs: 1_800_000,
    });
    expect(resolveWritePathIterationBounds(configPath)).toEqual({
      iterationTimeoutMs: 600_000,
      iterationCeilingMs: 1_800_000,
      idleOutputMs: 90_000,
    });
  });

  test("omits idleOutputMs when idleOutputTimeoutMs is 0 (disabled)", () => {
    const configPath = writeConfig({
      agents: ["claude"],
      iterationTimeoutMs: 600_000,
      iterationCeilingMs: 1_800_000,
      idleOutputTimeoutMs: 0,
    });
    expect(resolveWritePathIterationBounds(configPath)).toEqual({
      iterationTimeoutMs: 600_000,
      iterationCeilingMs: 1_800_000,
    });
  });

  test("rejects iterationTimeoutMs above iterationCeilingMs with both keys and values", () => {
    const configPath = writeConfig({
      agents: ["claude"],
      iterationTimeoutMs: 2_000_000,
      iterationCeilingMs: 1_000_000,
      idleOutputTimeoutMs: 0,
    });
    expect(() => resolveWritePathIterationBounds(configPath)).toThrow(
      "Machine config 'iterationTimeoutMs' (2000000) must not exceed 'iterationCeilingMs' (1000000)",
    );
  });

  test("allows iterationTimeoutMs at or below iterationCeilingMs", () => {
    const configPath = writeConfig({
      agents: ["claude"],
      iterationTimeoutMs: 600_000,
      iterationCeilingMs: 1_800_000,
    });
    expect(resolveWritePathIterationBounds(configPath)).toEqual({
      iterationTimeoutMs: 600_000,
      iterationCeilingMs: 1_800_000,
      idleOutputMs: 90_000,
    });
  });
});

describe("readReviewRoleTimeoutMs", () => {
  test("defaults to 1_800_000 when unset", () => {
    const configPath = writeConfig({ agents: ["claude"] });
    expect(readReviewRoleTimeoutMs(configPath)).toBe(DEFAULT_REVIEW_ROLE_TIMEOUT_MS);
  });

  test("returns a configured positive value", () => {
    const configPath = writeConfig({ agents: ["claude"], reviewRoleTimeoutMs: 900_000 });
    expect(readReviewRoleTimeoutMs(configPath)).toBe(900_000);
  });

  test("rejects a non-positive value naming the key", () => {
    const configPath = writeConfig({ agents: ["claude"], reviewRoleTimeoutMs: 0 });
    expect(() => readReviewRoleTimeoutMs(configPath)).toThrow(
      "Machine config 'reviewRoleTimeoutMs' must be a positive number",
    );
  });

  test("rejects a non-numeric value naming the key", () => {
    const configPath = writeConfig({ agents: ["claude"], reviewRoleTimeoutMs: "900000" });
    expect(() => readReviewRoleTimeoutMs(configPath)).toThrow(
      "Machine config 'reviewRoleTimeoutMs' must be a positive number",
    );
  });
});

type ImplementFieldCase = {
  field: string;
  read: (projectKey: string, configPath: string) => unknown;
  fallback: unknown;
  valid: Array<[value: unknown, expected: unknown]>;
  malformed: unknown[];
  error: string;
};

const implementFieldCases: ImplementFieldCase[] = [
  {
    field: "reviewPasses",
    read: readProjectImplementReviewPasses,
    fallback: { ok: true, reviewPasses: 1 },
    valid: [[2, { ok: true, reviewPasses: 2 }]],
    malformed: [1.5, -1, "2"],
    error: "projects.demo.implement.reviewPasses must be a non-negative integer",
  },
  {
    field: "reviewBehavior",
    read: readProjectImplementReviewBehavior,
    fallback: { ok: true, reviewBehavior: "debate" },
    valid: [
      ["debate", { ok: true, reviewBehavior: "debate" }],
      ["light", { ok: true, reviewBehavior: "light" }],
    ],
    malformed: ["heavy", 1, true],
    error: 'projects.demo.implement.reviewBehavior must be "debate" or "light"',
  },
];

for (const { field, read, fallback, valid, malformed, error } of implementFieldCases) {
  describe(`readProjectImplement ${field}`, () => {
    const implementConfig = (value: unknown): string =>
      writeConfig({ projects: { demo: { root: "/tmp/repo", implement: { [field]: value } } } });

    test.each([
      ["projects", { agents: ["claude"] }],
      ["implement", { projects: { demo: { root: "/tmp/repo" } } }],
      [`implement.${field}`, { projects: { demo: { root: "/tmp/repo", implement: {} } } }],
    ] as Array<[string, unknown]>)("returns the default when %s is absent", (_label, config) => {
      expect(read("demo", writeConfig(config))).toEqual(fallback);
    });

    test("returns a valid configured value", () => {
      for (const [value, expected] of valid) {
        expect(read("demo", implementConfig(value))).toEqual(expected);
      }
    });

    test("rejects malformed values with a named error", () => {
      for (const value of malformed) {
        expect(read("demo", implementConfig(value))).toEqual({ ok: false, error });
      }
    });

    test("rejects a non-object implement with a named error", () => {
      expect(read("demo", writeConfig({ projects: { demo: { root: "/tmp/repo", implement: "yes" } } }))).toEqual({
        ok: false,
        error: "projects.demo.implement must be an object",
      });
    });
  });
}

describe("readProjectRegistry", () => {
  test("keeps entries with a string root, carries origin, skips malformed entries", () => {
    const configPath = writeConfig({
      projects: {
        demo: { root: "/tmp/repo" },
        withOrigin: { root: "/tmp/other", origin: "git@example:demo.git" },
        noRoot: {},
        emptyRoot: { root: "" },
        notObject: "nope",
      },
    });
    expect(readProjectRegistry(configPath)).toEqual({
      demo: { root: "/tmp/repo" },
      withOrigin: { root: "/tmp/other", origin: "git@example:demo.git" },
    });
  });

  test("returns an empty registry when projects is absent or not an object", () => {
    expect(readProjectRegistry(writeConfig({ agents: ["claude"] }))).toEqual({});
    expect(readProjectRegistry(writeConfig({ projects: [] }))).toEqual({});
  });
});
