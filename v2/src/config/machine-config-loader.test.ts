import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMachineConfig, readMachineConfigDocument, validateMachineConfigAgents } from "./machine-config-loader.ts";

function writeRawConfig(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
  const configPath = join(dir, "v2.json");
  writeFileSync(configPath, text);
  return configPath;
}

function writeConfig(value: unknown): string {
  return writeRawConfig(JSON.stringify(value));
}

describe("loadMachineConfig", () => {
  test("nonexistent config path returns undefined", () => {
    const result = loadMachineConfig("/nonexistent/path/v2.json");
    expect(result).toBeUndefined();
  });

  test("config file with no 'agents' key returns undefined", () => {
    const result = loadMachineConfig(writeConfig({ other: "value" }));
    expect(result).toBeUndefined();
  });

  test("config file with empty 'agents' key returns undefined", () => {
    const result = loadMachineConfig(writeConfig({}));
    expect(result).toBeUndefined();
  });

  test("document reader preserves unrelated top-level keys", () => {
    const result = readMachineConfigDocument(writeConfig({ agents: ["claude"], extra: "field" }));
    expect(result).toEqual({ agents: ["claude"], extra: "field" });
  });

  test("valid agents array is returned in order", () => {
    const agents = ["claude", "codex", "cursor"];
    const result = loadMachineConfig(writeConfig({ agents }));
    expect(result).toEqual(agents);
  });

  test("single agent in array is returned", () => {
    const result = loadMachineConfig(writeConfig({ agents: ["claude"] }));
    expect(result).toEqual(["claude"]);
  });

  test("unparseable JSON throws", () => {
    const configPath = writeRawConfig("{ invalid json");
    expect(() => loadMachineConfig(configPath)).toThrow(/Failed to parse machine config/);
  });

  test("non-object config throws", () => {
    const configPath = writeConfig("string");
    expect(() => loadMachineConfig(configPath)).toThrow(/must be a JSON object/);
  });

  test("array as root throws", () => {
    const configPath = writeConfig(["claude"]);
    expect(() => loadMachineConfig(configPath)).toThrow(/must be a JSON object/);
  });

  test("null config throws", () => {
    const configPath = writeConfig(null);
    expect(() => loadMachineConfig(configPath)).toThrow(/must be a JSON object/);
  });

  test("non-array 'agents' field throws", () => {
    const configPath = writeConfig({ agents: "claude" });
    expect(() => loadMachineConfig(configPath)).toThrow(/must be an array/);
  });

  test("'agents' field as object throws", () => {
    const configPath = writeConfig({ agents: { name: "claude" } });
    expect(() => loadMachineConfig(configPath)).toThrow(/must be an array/);
  });

  test("'agents' field as null throws", () => {
    const configPath = writeConfig({ agents: null });
    expect(() => loadMachineConfig(configPath)).toThrow(/must be an array/);
  });

  test("non-string entry in agents throws", () => {
    const configPath = writeConfig({ agents: ["claude", 123] });
    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 1 must be a string/);
  });

  test("number entry in agents throws", () => {
    const configPath = writeConfig({ agents: [123] });
    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 0 must be a string/);
  });

  test("object entry in agents throws", () => {
    const configPath = writeConfig({ agents: [{ name: "claude" }] });
    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 0 must be a string/);
  });

  test("null entry in agents throws", () => {
    const configPath = writeConfig({ agents: [null] });
    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 0 must be a string/);
  });

  test("empty string entry in agents throws", () => {
    const configPath = writeConfig({ agents: ["claude", ""] });
    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 1 must not be an empty string/);
  });

  test("empty string as only entry throws", () => {
    const configPath = writeConfig({ agents: [""] });
    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 0 must not be an empty string/);
  });

  test("duplicate agent name throws", () => {
    const configPath = writeConfig({ agents: ["claude", "codex", "claude"] });
    expect(() => loadMachineConfig(configPath)).toThrow(/duplicate entry/);
  });

  test("agent-array validator reuses duplicate checks for direct callers", () => {
    expect(() => validateMachineConfigAgents(["claude", "claude"])).toThrow(/duplicate entry/);
  });

  test("duplicate at consecutive indices throws", () => {
    const configPath = writeConfig({ agents: ["claude", "claude"] });
    expect(() => loadMachineConfig(configPath)).toThrow(/duplicate entry/);
  });

  test("empty agents array throws", () => {
    const configPath = writeConfig({ agents: [] });
    expect(() => loadMachineConfig(configPath)).toThrow(/must not be empty/);
  });

  test("preserves agent order in array", () => {
    const agents = ["z-agent", "a-agent", "m-agent"];
    const result = loadMachineConfig(writeConfig({ agents }));
    expect(result).toEqual(agents);
    expect(result![0]).toBe("z-agent");
    expect(result![1]).toBe("a-agent");
    expect(result![2]).toBe("m-agent");
  });

  test("ignores extra fields in config", () => {
    const result = loadMachineConfig(writeConfig({ agents: ["claude"], extra: "field", another: 123 }));
    expect(result).toEqual(["claude"]);
  });

  test("agents with special characters are accepted", () => {
    const agents = ["claude-3-opus", "gpt-5.2", "agent_v2"];
    const result = loadMachineConfig(writeConfig({ agents }));
    expect(result).toEqual(agents);
  });
});
