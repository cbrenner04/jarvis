import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  absentMachineConfigPath,
  type CliRepoFixture,
  captureIo,
  completeResult,
  cliMain as main,
  makeCliRepoFixture,
  stubAgentModelConfig,
  writeMachineConfig,
  writeRawMachineConfig,
} from "../testing/cli-test-helpers.ts";

let fx: CliRepoFixture;

beforeAll(() => {
  fx = makeCliRepoFixture();
});

afterAll(() => {
  fx.cleanup();
});

async function runConfig(configPath: string, args: readonly string[], io = captureIo().io): Promise<number> {
  return main(["config", ...args], io, { machineConfigPath: configPath });
}

async function setAgents(configPath: string, csv: string, io = captureIo().io): Promise<number> {
  return runConfig(configPath, ["set-agents", csv], io);
}

describe("config command", () => {
  test("config set-agents writes agents, preserves unrelated keys, and later write uses the persisted order", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ other: "value", agents: ["cursor"] });

    const configCode = await setAgents(configPath, "claude,codex", cap.io);

    expect(configCode).toBe(0);
    expect(cap.read()).toEqual({ stdout: '{"agents":["claude","codex"]}\n', stderr: "" });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      other: "value",
      agents: ["claude", "codex"],
    });

    let capturedAgents: readonly string[] | undefined;
    const writeCap = captureIo();
    const writeCode = await main(fx.writeArgs, writeCap.io, {
      machineConfigPath: configPath,
      loadAgentModelConfig: (agents) => {
        capturedAgents = agents;
        return stubAgentModelConfig(agents);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(writeCode).toBe(0);
    expect(capturedAgents).toEqual(["claude", "codex"]);
  });

  test("config set-agents creates missing parent state", async () => {
    const cap = captureIo();
    const configPath = absentMachineConfigPath();

    const code = await setAgents(configPath, "claude,codex", cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: '{"agents":["claude","codex"]}\n', stderr: "" });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ agents: ["claude", "codex"] });
  });

  test.each([
    [
      "an empty CSV segment",
      "claude,,codex",
      absentMachineConfigPath,
      () => 'Error: invalid agents CSV "claude,,codex": empty segment at position 2\n',
    ],
    [
      "agent:model entries",
      "claude,codex:gpt-5",
      absentMachineConfigPath,
      () => 'Error: invalid agent "codex:gpt-5": expected bare agent name\n',
    ],
    [
      "duplicate names",
      "claude,claude",
      () => writeMachineConfig({ agents: ["cursor"], keep: true }),
      () => "Machine config 'agents' contains duplicate entry: \"claude\"\n",
    ],
    [
      "an invalid machine-config file",
      "claude,codex",
      () => writeRawMachineConfig("{ invalid json"),
      (configPath: string) => `Failed to parse machine config at ${configPath}: invalid JSON\n`,
    ],
    [
      "a non-object machine-config file",
      "claude,codex",
      () => writeRawMachineConfig('["claude"]\n'),
      (configPath: string) => `Machine config at ${configPath} must be a JSON object, got array\n`,
    ],
    [
      "a machine-config file with invalid agents",
      "claude,codex",
      () => writeMachineConfig({ agents: [] }),
      () => "Machine config 'agents' array must not be empty\n",
    ],
  ])("config set-agents rejects %s without touching prior state", async (_label, csv, makeConfigPath, expectStderr) => {
    const cap = captureIo();
    const configPath = makeConfigPath();
    const before = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;

    const code = await setAgents(configPath, csv, cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: expectStderr(configPath) });
    if (before === undefined) {
      expect(existsSync(configPath)).toBe(false);
      expect(existsSync(dirname(configPath))).toBe(false);
    } else {
      expect(readFileSync(configPath, "utf8")).toBe(before);
    }
  });

  test("config show prints configured agents one per line", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: ["claude", "codex", "cursor"] });

    const code = await runConfig(configPath, ["show"], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "claude\ncodex\ncursor\n", stderr: "" });
  });

  test.each([
    ["absent", absentMachineConfigPath],
    ["without agents", () => writeMachineConfig({ other: "value" })],
  ])("config show prints no-override line when machine config is %s", async (_label, configPathFn) => {
    const cap = captureIo();
    const configPath = configPathFn();

    const code = await runConfig(configPath, ["show"], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "No machine agent override configured.\n", stderr: "" });
  });

  test("config show exits non-zero on malformed machine config", async () => {
    const cap = captureIo();
    const configPath = writeRawMachineConfig("{ invalid json");

    const code = await runConfig(configPath, ["show"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: `Failed to parse machine config at ${configPath}: invalid JSON\n`,
    });
  });

  test("config show exits non-zero when agents fail validation", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: [] });

    const code = await runConfig(configPath, ["show"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "Machine config 'agents' array must not be empty\n",
    });
  });

  test("config path prints the expanded machine config path", async () => {
    const cap = captureIo();
    const configPath = absentMachineConfigPath();

    const code = await runConfig(configPath, ["path"], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: `${configPath}\n`, stderr: "" });
  });
});
