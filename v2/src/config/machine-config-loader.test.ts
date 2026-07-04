import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMachineConfig } from "./machine-config-loader.ts";

describe("loadMachineConfig", () => {
  test("nonexistent config path returns undefined", () => {
    const result = loadMachineConfig("/nonexistent/path/v2.json");
    expect(result).toBeUndefined();
  });

  test("config file with no 'agents' key returns undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ other: "value" }));

    const result = loadMachineConfig(configPath);
    expect(result).toBeUndefined();
  });

  test("config file with empty 'agents' key returns undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({}));

    const result = loadMachineConfig(configPath);
    expect(result).toBeUndefined();
  });

  test("valid agents array is returned in order", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    const agents = ["claude", "codex", "cursor"];
    writeFileSync(configPath, JSON.stringify({ agents }));

    const result = loadMachineConfig(configPath);
    expect(result).toEqual(agents);
  });

  test("single agent in array is returned", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: ["claude"] }));

    const result = loadMachineConfig(configPath);
    expect(result).toEqual(["claude"]);
  });

  test("unparseable JSON throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, "{ invalid json");

    expect(() => loadMachineConfig(configPath)).toThrow(/Failed to parse machine config/);
  });

  test("non-object config throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify("string"));

    expect(() => loadMachineConfig(configPath)).toThrow(/must be a JSON object/);
  });

  test("array as root throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify(["claude"]));

    expect(() => loadMachineConfig(configPath)).toThrow(/must be a JSON object/);
  });

  test("null config throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify(null));

    expect(() => loadMachineConfig(configPath)).toThrow(/must be a JSON object/);
  });

  test("non-array 'agents' field throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: "claude" }));

    expect(() => loadMachineConfig(configPath)).toThrow(/must be an array/);
  });

  test("'agents' field as object throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: { name: "claude" } }));

    expect(() => loadMachineConfig(configPath)).toThrow(/must be an array/);
  });

  test("'agents' field as null throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: null }));

    expect(() => loadMachineConfig(configPath)).toThrow(/must be an array/);
  });

  test("non-string entry in agents throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: ["claude", 123] }));

    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 1 must be a string/);
  });

  test("number entry in agents throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: [123] }));

    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 0 must be a string/);
  });

  test("object entry in agents throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: [{ name: "claude" }] }));

    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 0 must be a string/);
  });

  test("null entry in agents throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: [null] }));

    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 0 must be a string/);
  });

  test("empty string entry in agents throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: ["claude", ""] }));

    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 1 must not be an empty string/);
  });

  test("empty string as only entry throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: [""] }));

    expect(() => loadMachineConfig(configPath)).toThrow(/entry at index 0 must not be an empty string/);
  });

  test("duplicate agent name throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: ["claude", "codex", "claude"] }));

    expect(() => loadMachineConfig(configPath)).toThrow(/duplicate entry/);
  });

  test("duplicate at consecutive indices throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: ["claude", "claude"] }));

    expect(() => loadMachineConfig(configPath)).toThrow(/duplicate entry/);
  });

  test("empty agents array throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: [] }));

    expect(() => loadMachineConfig(configPath)).toThrow(/must not be empty/);
  });

  test("preserves agent order in array", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    const agents = ["z-agent", "a-agent", "m-agent"];
    writeFileSync(configPath, JSON.stringify({ agents }));

    const result = loadMachineConfig(configPath);
    expect(result).toEqual(agents);
    expect(result![0]).toBe("z-agent");
    expect(result![1]).toBe("a-agent");
    expect(result![2]).toBe("m-agent");
  });

  test("ignores extra fields in config", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    writeFileSync(configPath, JSON.stringify({ agents: ["claude"], extra: "field", another: 123 }));

    const result = loadMachineConfig(configPath);
    expect(result).toEqual(["claude"]);
  });

  test("agents with special characters are accepted", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-config-test-"));
    const configPath = join(dir, "v2.json");
    const agents = ["claude-3-opus", "gpt-5.2", "agent_v2"];
    writeFileSync(configPath, JSON.stringify({ agents }));

    const result = loadMachineConfig(configPath);
    expect(result).toEqual(agents);
  });
});
