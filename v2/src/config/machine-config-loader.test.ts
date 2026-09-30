import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import {
  DEFAULT_REVIEW_ROLE_TIMEOUT_MS,
  loadMachineConfig,
  readCodexSandboxMode,
  readMachineConfigDocument,
  readNotificationSinkCommand,
  readProjectImplementReviewBehavior,
  readProjectImplementReviewPasses,
  readProjectReadyCommand,
  readProjectRegistry,
  readRetentionSessions,
  readReviewRoleTimeoutMs,
  readRunTimeoutMs,
  resolveMachineProfile,
  resolveWritePathIterationBounds,
  validateMachineConfigAgents,
} from "./machine-config-loader.ts";

function writeRawConfig(text: string): string {
  const dir = trackedMkdtempSync(join(tmpdir(), "jarvis-config-test-"));
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

describe("readRetentionSessions", () => {
  const defaults = { ok: true as const, hotDays: 14, coldDays: 90 };
  const ok = (hotDays: number, coldDays: number) => ({ ok: true as const, hotDays, coldDays });

  test.each([
    ["retention", { agents: ["claude"] }],
    ["retention.sessions", { retention: {} }],
  ] as Array<[string, unknown]>)("defaults to 14/90 when %s is absent", (_label, config) => {
    expect(readRetentionSessions(writeConfig(config))).toEqual(defaults);
  });

  test.each([
    [{ coldDays: 30 }, 14, 30],
    [{ hotDays: 7 }, 7, 90],
    [{ hotDays: 7, coldDays: 30 }, 7, 30],
  ] as Array<
    [Record<string, number>, number, number]
  >)("merges overrides with defaults (%#)", (sessions, hotDays, coldDays) => {
    expect(readRetentionSessions(writeConfig({ retention: { sessions } }))).toEqual(ok(hotDays, coldDays));
  });

  test.each([
    ["hotDays non-integer", { retention: { sessions: { hotDays: 1.5, coldDays: 30 } } }, "hotDays"],
    ["hotDays zero", { retention: { sessions: { hotDays: 0, coldDays: 30 } } }, "hotDays"],
    ["hotDays negative", { retention: { sessions: { hotDays: -1, coldDays: 30 } } }, "hotDays"],
    ["hotDays non-number", { retention: { sessions: { hotDays: "7", coldDays: 30 } } }, "hotDays"],
    ["coldDays non-integer", { retention: { sessions: { hotDays: 7, coldDays: 30.5 } } }, "coldDays"],
    ["coldDays zero", { retention: { sessions: { hotDays: 7, coldDays: 0 } } }, "coldDays"],
    ["coldDays negative", { retention: { sessions: { hotDays: 7, coldDays: -1 } } }, "coldDays"],
    ["coldDays non-number", { retention: { sessions: { hotDays: 7, coldDays: "30" } } }, "coldDays"],
  ] as Array<[string, unknown, string]>)("rejects %s naming the field", (_label, config, field) => {
    expect(readRetentionSessions(writeConfig(config))).toEqual({
      ok: false,
      error: `retention.sessions.${field} must be a positive integer`,
    });
  });

  test.each([
    ["non-object retention", { retention: "invalid" }],
    ["non-object retention.sessions", { retention: { sessions: "invalid" } }],
  ] as Array<[string, unknown]>)("rejects %s naming both fields", (_label, config) => {
    expect(readRetentionSessions(writeConfig(config))).toEqual({
      ok: false,
      error: "retention.sessions.hotDays and retention.sessions.coldDays must be positive integers",
    });
  });

  test.each([
    ["coldDays equal to hotDays", { retention: { sessions: { hotDays: 14, coldDays: 14 } } }],
    ["coldDays below hotDays", { retention: { sessions: { hotDays: 30, coldDays: 14 } } }],
    ["default coldDays with hotDays at default", { retention: { sessions: { hotDays: 90 } } }],
  ] as Array<[string, unknown]>)("rejects %s", (_label, config) => {
    expect(readRetentionSessions(writeConfig(config))).toEqual({
      ok: false,
      error: "retention.sessions.coldDays must be greater than retention.sessions.hotDays",
    });
  });

  test("cleanup.sessionLogRetentionDays is not a retention source", () => {
    expect(readRetentionSessions(writeConfig({ cleanup: { sessionLogRetentionDays: 30 } }))).toEqual(defaults);
  });

  test("reads retention without validating unrelated agents", () => {
    expect(
      readRetentionSessions(writeConfig({ agents: "invalid", retention: { sessions: { hotDays: 7, coldDays: 30 } } })),
    ).toEqual(ok(7, 30));
  });

  test("nonexistent config path resolves to defaults", () => {
    expect(readRetentionSessions("/nonexistent/path/config.json")).toEqual(defaults);
  });

  test.each([
    ["array root", ["claude"]],
    ["null root", null],
    ["string root", "string"],
  ] as Array<[string, unknown]>)("non-record top-level config throws naming JSON object (%s)", (_label, value) => {
    expect(() => readRetentionSessions(writeConfig(value))).toThrow(/must be a JSON object/);
  });

  test("unparseable JSON throws without naming retention", () => {
    expect(() => readRetentionSessions(writeRawConfig("{ invalid json"))).toThrow(/Failed to parse machine config/);
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

describe("readRunTimeoutMs", () => {
  test("defaults to 6h, reads top-level, and prefers a project override", () => {
    expect(readRunTimeoutMs("demo", writeConfig({ agents: ["claude"] }))).toBe(21_600_000);
    const configPath = writeConfig({
      agents: ["claude"],
      runTimeoutMs: 7_200_000,
      projects: { demo: { root: "/tmp/demo", runTimeoutMs: 3_600_000 } },
    });
    expect(readRunTimeoutMs("other", configPath)).toBe(7_200_000);
    expect(readRunTimeoutMs("demo", configPath)).toBe(3_600_000);
  });

  test("rejects a budget below iterationCeilingMs and accepts one equal to it", () => {
    expect(() => readRunTimeoutMs(undefined, writeConfig({ agents: ["claude"], runTimeoutMs: 1_799_999 }))).toThrow(
      "Machine config 'runTimeoutMs' (1799999) must not be below 'iterationCeilingMs' (1800000)",
    );
    expect(readRunTimeoutMs(undefined, writeConfig({ agents: ["claude"], runTimeoutMs: 1_800_000 }))).toBe(1_800_000);
    expect(() => readRunTimeoutMs(undefined, writeConfig({ agents: ["claude"], runTimeoutMs: -1 }))).toThrow(
      "Machine config 'runTimeoutMs' must be a positive number",
    );
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

describe("readProjectReadyCommand", () => {
  test("reads a configured readyCommand", () => {
    const configPath = writeConfig({ projects: { demo: { root: "/tmp/repo", readyCommand: "npm run verify" } } });
    expect(readProjectReadyCommand("demo", configPath)).toBe("npm run verify");
  });

  test("readProjectReadyCommand ignores a blank or non-string readyCommand", () => {
    const blankPath = writeConfig({ projects: { demo: { root: "/tmp/repo", readyCommand: "   " } } });
    expect(readProjectReadyCommand("demo", blankPath)).toBeUndefined();

    const nonStringPath = writeConfig({ projects: { demo: { root: "/tmp/repo", readyCommand: 123 } } });
    expect(readProjectReadyCommand("demo", nonStringPath)).toBeUndefined();
  });

  test("returns undefined when the project or readyCommand is absent", () => {
    expect(readProjectReadyCommand("demo", writeConfig({ projects: { demo: { root: "/tmp/repo" } } }))).toBeUndefined();
    expect(readProjectReadyCommand("missing", writeConfig({ projects: {} }))).toBeUndefined();
  });
});

describe("readNotificationSinkCommand", () => {
  test("reads a configured notificationSinkCommand", () => {
    const configPath = writeConfig({ agents: ["claude"], notificationSinkCommand: "terminal-notifier -message -" });
    expect(readNotificationSinkCommand(configPath)).toBe("terminal-notifier -message -");
  });

  test("ignores blank or non-string notificationSinkCommand", () => {
    expect(readNotificationSinkCommand(writeConfig({ notificationSinkCommand: "   " }))).toBeUndefined();
    expect(readNotificationSinkCommand(writeConfig({ notificationSinkCommand: 1 }))).toBeUndefined();
  });
});

describe("readCodexSandboxMode", () => {
  test.each([
    "read-only",
    "workspace-write",
    "danger-full-access",
  ] as const)("recognized mode %s passes through unchanged", (mode) => {
    expect(readCodexSandboxMode(writeConfig({ codexSandboxMode: mode }))).toBe(mode);
  });

  test("absent codexSandboxMode falls back to workspace-write", () => {
    expect(readCodexSandboxMode(writeConfig({ agents: ["claude"] }))).toBe("workspace-write");
    expect(readCodexSandboxMode("/nonexistent/path/config.json")).toBe("workspace-write");
  });

  test("non-string codexSandboxMode falls back to workspace-write", () => {
    expect(readCodexSandboxMode(writeConfig({ codexSandboxMode: 3 }))).toBe("workspace-write");
    expect(readCodexSandboxMode(writeConfig({ codexSandboxMode: ["danger-full-access"] }))).toBe("workspace-write");
  });

  test("unrecognized Codex sandbox modes fall back to workspace-write", () => {
    expect(readCodexSandboxMode(writeConfig({ codexSandboxMode: "full-access" }))).toBe("workspace-write");
    expect(readCodexSandboxMode(writeConfig({ codexSandboxMode: "yolo" }))).toBe("workspace-write");
  });
});
