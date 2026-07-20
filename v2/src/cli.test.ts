import { describe, expect, test } from "bun:test";
import { enumerateCommands, findCommand } from "./cli.ts";
import {
  CLEANUP_USAGE,
  CONFIG_USAGE,
  DAEMON_USAGE,
  HELP_USAGE,
  RUN_USAGE,
  TUI_USAGE,
  WRITE_USAGE,
} from "./cli/usage.ts";
import { captureIo, cliMain as main } from "./testing/cli-test-helpers.ts";

const commandNames = "write, daemon, config, run, tui, cleanup, help";

/** Top-level dispatch only; per-command behavior is covered next to each module in `commands/`. */
describe("v2 cli dispatch", () => {
  test("no args prints v2 boundary message and exits 0", async () => {
    const cap = captureIo();

    const code = await main([], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "v2 not ready\n", stderr: "" });
  });

  test("an unknown command writes a diagnostic to stderr and exits non-zero", async () => {
    const cap = captureIo();

    const code = await main(["bogus"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: `unknown command: bogus; expected one of: ${commandNames}\n`,
    });
  });

  test("help renders the complete command registry", async () => {
    const cap = captureIo();

    const code = await main(["help"], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({
      stdout:
        "write\tRun an in-process write loop.\n" +
        "daemon\tManage the background daemon.\n" +
        "config\tShow or update machine configuration.\n" +
        "run\tManage daemon-backed runs.\n" +
        "tui\tOpen the interactive run monitor.\n" +
        "cleanup\tRetire completed worktrees and specs.\n" +
        "help\tList top-level commands.\n",
      stderr: "",
    });
  });

  test.each([["foo"], ["--version"]])("help %p prints help usage and exits non-zero", async (args) => {
    const cap = captureIo();

    const code = await main(["help", ...args], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "usage: jarvis help\n" });
  });

  test("registry owns dispatched commands, metadata, and exact-name lookup", () => {
    const entries = enumerateCommands();

    expect(entries.map(({ name }) => name).join(", ")).toBe(commandNames);
    expect(entries.map(({ usage }) => usage)).toEqual([
      WRITE_USAGE,
      DAEMON_USAGE,
      CONFIG_USAGE,
      RUN_USAGE,
      TUI_USAGE,
      CLEANUP_USAGE,
      HELP_USAGE,
    ]);
    expect(new Set(entries.map(({ name }) => name)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.name.trim()).not.toBe("");
      expect(entry.summary.trim()).not.toBe("");
      expect(entry.summary).not.toContain("\n");
      expect(entry.usage.trim()).not.toBe("");
      expect(entry.handler).toBeTypeOf("function");
      expect(findCommand(entry.name)).toBe(entry);
    }
    expect(findCommand("constructor")).toBeUndefined();
    expect(findCommand("toString")).toBeUndefined();
  });

  test.each(["constructor", "toString"]) ("%s remains an unknown command", async (command) => {
    const cap = captureIo();

    const code = await main([command], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: `unknown command: ${command}; expected one of: ${commandNames}\n`,
    });
  });

  test("--version prints package version and exits 0", async () => {
    const cap = captureIo();

    const code = await main(["--version"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stderr).toBe("");
    expect(cap.read().stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
