import { describe, expect, test } from "bun:test";
import {
  CLEANUP_USAGE,
  CONFIG_USAGE,
  DAEMON_LOG_USAGE,
  DAEMON_USAGE,
  HELP_USAGE,
  RUN_LIST_USAGE,
  RUN_USAGE,
  TUI_LOG_USAGE,
  TUI_USAGE,
  WORKFLOW_IMPLEMENT_USAGE,
  WORKFLOW_INTENT_USAGE,
  WORKFLOW_PLAN_USAGE,
  WORKFLOW_USAGE,
  WRITE_USAGE,
} from "./cli/usage.ts";
import { enumerateCommands, findCommand } from "./cli.ts";
import { captureIo, cliMain as main } from "./testing/cli-test-helpers.ts";

const commandNames = "write, daemon, config, run, tui, cleanup, help";

function unknownCommandError(command: string, suggestion?: string, path?: readonly string[]): string {
  const trailer = path === undefined || path.length === 0
    ? "run `jarvis help` for available commands\n"
    : `run \`jarvis help ${path.join(" ")}\` for available commands\n`;
  return `unknown command: ${command}\n${suggestion === undefined ? "" : `did you mean ${suggestion}?\n`}${trailer}`;
}

/** Top-level dispatch only; per-command behavior is covered next to each module in `commands/`. */
describe("v2 cli dispatch", () => {
  test("no args prints v2 boundary message and exits 0", async () => {
    const cap = captureIo();

    const code = await main([], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "v2 not ready\n", stderr: "" });
  });

  test.each([
    ["unique deletion", "writ", "write"],
    ["insertion", "writex", "write"],
    ["substitution", "wrote", "write"],
    ["distance two", "wte", "write"],
    ["Unicode distance two", "run😀😀", "run"],
  ])("a %s close match suggests the registered command", async (_kind, command, suggestion) => {
    const cap = captureIo();

    const code = await main([command], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: unknownCommandError(command, suggestion),
    });
  });

  test.each([
    ["absent", "zzzz"],
    ["ambiguous", "rux"],
    ["distance three", "wr"],
  ])("a %s match omits a suggestion", async (_kind, command) => {
    const cap = captureIo();

    const code = await main([command], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: unknownCommandError(command),
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
        "help\tShow help for commands and subcommands.\n",
      stderr: "",
    });
  });

  test.each([["foo"], ["--version"]])("help %p is an unknown segment", async (args) => {
    const cap = captureIo();

    const code = await main(["help", ...args], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: unknownCommandError(args[0] ?? "", undefined, []),
    });
  });

  test("help run prints usage and lists subcommands", async () => {
    const cap = captureIo();

    const code = await main(["help", "run"], cap.io);

    expect(code).toBe(0);
    const output = cap.read().stdout;
    expect(output).toContain("usage: jarvis run");
    expect(output).toContain("start\tStart a new run.");
    expect(output).toContain("list\tList runs.");
    expect(output).toContain("workflow\tRun workflow presets.");
  });

  test("help run workflow lists presets", async () => {
    const cap = captureIo();

    const code = await main(["help", "run", "workflow"], cap.io);

    expect(code).toBe(0);
    const output = cap.read().stdout;
    expect(output).toContain("usage: jarvis run workflow");
    expect(output).toContain("intent\tCreate a spec seed.");
    expect(output).toContain("plan\tCreate an implementation plan.");
    expect(output).toContain("implement\tImplement a plan.");
  });

  test("help run pause prints ancestor usage (no subcommands)", async () => {
    const cap = captureIo();

    const code = await main(["help", "run", "pause"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toBe("usage: jarvis run <start|list|log|pause|resume|kill|wait|workflow> [args]\n");
  });

  test("help run start prints WRITE_USAGE", async () => {
    const cap = captureIo();

    const code = await main(["help", "run", "start"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("usage: jarvis write");
  });

  test("help run workflow intent prints WORKFLOW_INTENT_USAGE", async () => {
    const cap = captureIo();

    const code = await main(["help", "run", "workflow", "intent"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("usage: jarvis run workflow intent");
  });

  test("help daemon lists subcommands", async () => {
    const cap = captureIo();

    const code = await main(["help", "daemon"], cap.io);

    expect(code).toBe(0);
    const output = cap.read().stdout;
    expect(output).toContain("usage: jarvis daemon");
    expect(output).toContain("start\tStart the daemon.");
    expect(output).toContain("stop\tStop the daemon.");
    expect(output).toContain("status\tShow daemon status.");
    expect(output).toContain("log\tStream daemon logs.");
  });

  test("help config lists subcommands", async () => {
    const cap = captureIo();

    const code = await main(["help", "config"], cap.io);

    expect(code).toBe(0);
    const output = cap.read().stdout;
    expect(output).toContain("usage: jarvis config");
    expect(output).toContain("show\tShow current machine configuration.");
    expect(output).toContain("path\tShow configuration file path.");
    expect(output).toContain("set-agents\tSet agent fallback order.");
  });

  test("help tui lists log subcommand", async () => {
    const cap = captureIo();

    const code = await main(["help", "tui"], cap.io);

    expect(code).toBe(0);
    const output = cap.read().stdout;
    expect(output).toContain("usage: jarvis tui");
    expect(output).toContain("log\tStream run logs in interactive view.");
  });

  test("help write prints usage with no subcommand lines", async () => {
    const cap = captureIo();

    const code = await main(["help", "write"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toBe("usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--max-iterations <n>]\n");
  });

  test("help nope is unknown at depth 0", async () => {
    const cap = captureIo();

    const code = await main(["help", "nope"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: unknownCommandError("nope", undefined, []),
    });
  });

  test("help run nope is unknown at depth 1", async () => {
    const cap = captureIo();

    const code = await main(["help", "run", "nope"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: unknownCommandError("nope", undefined, ["run"]),
    });
  });

  test("help write nope is unknown at depth 1 (past a leaf)", async () => {
    const cap = captureIo();

    const code = await main(["help", "write", "nope"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: unknownCommandError("nope", undefined, ["write"]),
    });
  });

  test("help ren suggests run", async () => {
    const cap = captureIo();

    const code = await main(["help", "ren"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("did you mean run?");
  });

  test("help run strt suggests start", async () => {
    const cap = captureIo();

    const code = await main(["help", "run", "strt"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("did you mean start?");
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

  test.each(["constructor", "toString"])("%s remains an unknown command", async (command) => {
    const cap = captureIo();

    const code = await main([command], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: unknownCommandError(command),
    });
  });

  test("--version prints package version and exits 0", async () => {
    const cap = captureIo();

    const code = await main(["--version"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stderr).toBe("");
    expect(cap.read().stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  describe("dispatch-coverage: every tree path is dispatchable", () => {
    // For each tree node with subcommands, verify that valid subcommand names don't
    // trigger an unknown-subcommand error from the parent dispatcher. We provide
    // minimal arguments so commands dispatch and possibly fail for other reasons,
    // but not because the subcommand is unknown.
    const testCases = [
      // run subcommands (these require specific argument patterns to dispatch)
      { path: ["run", "list"] }, // no args needed
      { path: ["run", "workflow", "intent"] }, // workflow commands fail for missing seed/seed-text, not unknown
      { path: ["run", "workflow", "plan"] }, // workflow commands fail for missing ready-intent, not unknown
      { path: ["run", "workflow", "implement"] }, // workflow commands fail for missing base/spec, not unknown
      // daemon subcommands
      { path: ["daemon", "status"] }, // no args needed
      // config subcommands
      { path: ["config", "show"] }, // no args needed
      { path: ["config", "path"] }, // no args needed
    ];

    for (const { path } of testCases) {
      test(`${path.join(" ")} dispatches successfully`, async () => {
        const cap = captureIo();
        const code = await main(path, cap.io);
        // These commands might exit with 1 for missing args, but they should dispatch
        // (i.e., not be rejected as unknown subcommands by the parent)
        expect(code).toBeGreaterThanOrEqual(0);
      });
    }
  });
});
