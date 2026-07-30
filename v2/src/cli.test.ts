import { describe, expect, test } from "bun:test";
import {
  CLEANUP_HELP_FLAGS,
  DAEMON_LOG_HELP_FLAGS,
  RUN_LIST_HELP_FLAGS,
  WORKFLOW_IMPLEMENT_HELP_FLAGS,
  WORKFLOW_INTENT_HELP_FLAGS,
  WORKFLOW_PLAN_HELP_FLAGS,
  WRITE_HELP_FLAGS,
} from "./cli/command-help-flags.ts";
import type { CommandNode } from "./cli/command-tree.ts";
import { commandTree, formatCommandFlagHelpLine, renderHelpNode, resolveHelpPath } from "./cli/command-tree.ts";
import {
  CLEANUP_USAGE,
  CONFIG_USAGE,
  DAEMON_LOG_USAGE,
  DAEMON_USAGE,
  HELP_USAGE,
  PIPELINE_USAGE,
  RUN_LIST_USAGE,
  RUN_USAGE,
  TUI_USAGE,
  WORKFLOW_IMPLEMENT_USAGE,
  WORKFLOW_INTENT_USAGE,
  WORKFLOW_PLAN_USAGE,
  WORKFLOW_USAGE,
  WRITE_USAGE,
} from "./cli/usage.ts";
import { enumerateCommands, findCommand, resolveHelpFlagAlias } from "./cli.ts";
import { captureIo, cliMain as main, tempPaths, writeMachineConfig } from "./testing/cli-test-helpers.ts";

const commandNames = "write, daemon, config, run, tui, pipeline, cleanup, help";

function helpStdoutWithFlags(
  usage: string,
  flags: readonly { name: string; argumentShape: string; description: string }[],
): string {
  let output = usage;
  for (const flag of flags) {
    output += `${formatCommandFlagHelpLine(flag)}\n`;
  }
  return output;
}

function unknownCommandError(command: string, suggestion?: string, path?: readonly string[]): string {
  const trailer =
    path === undefined || path.length === 0
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
        "pipeline\tManage daemon-backed pipelines.\n" +
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

  describe("command help lists registered flags", () => {
    const cases = [
      ["write", ["help", "write"], WRITE_USAGE, WRITE_HELP_FLAGS],
      ["run start", ["help", "run", "start"], WRITE_USAGE, WRITE_HELP_FLAGS],
      ["cleanup", ["help", "cleanup"], CLEANUP_USAGE, CLEANUP_HELP_FLAGS],
      ["run list", ["help", "run", "list"], RUN_LIST_USAGE, RUN_LIST_HELP_FLAGS],
      ["daemon log", ["help", "daemon", "log"], DAEMON_LOG_USAGE, DAEMON_LOG_HELP_FLAGS],
    ] as const;

    for (const [label, argv, usage, flags] of cases) {
      test(`help ${label} lists every parser flag`, async () => {
        const cap = captureIo();

        const code = await main([...argv], cap.io);
        const { stdout, stderr } = cap.read();

        expect(code).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(helpStdoutWithFlags(usage, flags));
      });
    }

    test("help run start flag lines match help write", async () => {
      const writeCap = captureIo();
      await main(["help", "write"], writeCap.io);
      const writeStdout = writeCap.read().stdout;

      const startCap = captureIo();
      await main(["help", "run", "start"], startCap.io);
      const startStdout = startCap.read().stdout;

      expect(startStdout.replace(WRITE_USAGE, "")).toBe(writeStdout.replace(WRITE_USAGE, ""));
    });
  });

  describe("workflow preset help lists registered flags", () => {
    const cases = [
      ["intent", ["help", "run", "workflow", "intent"], WORKFLOW_INTENT_USAGE, WORKFLOW_INTENT_HELP_FLAGS],
      ["plan", ["help", "run", "workflow", "plan"], WORKFLOW_PLAN_USAGE, WORKFLOW_PLAN_HELP_FLAGS],
      ["implement", ["help", "run", "workflow", "implement"], WORKFLOW_IMPLEMENT_USAGE, WORKFLOW_IMPLEMENT_HELP_FLAGS],
    ] as const;

    for (const [preset, argv, usage, flags] of cases) {
      test(`help run workflow ${preset} lists every parser flag`, async () => {
        const cap = captureIo();

        const code = await main([...argv], cap.io);
        const { stdout, stderr } = cap.read();

        expect(code).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(helpStdoutWithFlags(usage, flags));
      });
    }
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

  test("help daemon start falls back to the daemon usage line", async () => {
    const cap = captureIo();

    const code = await main(["help", "daemon", "start"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toBe(DAEMON_USAGE);
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

  test("help run workflow intent-reviewed is an unknown segment (legacy alias, absent from the tree)", async () => {
    const cap = captureIo();

    const code = await main(["help", "run", "workflow", "intent-reviewed"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: unknownCommandError("intent-reviewed", undefined, ["run", "workflow"]),
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

  // `stat` is within distance 2 of `start`, `stop`, and `status`, so only a guard keyed on
  // "exactly one close match" suppresses the line — the zero-match cases above cannot tell the
  // two guards apart, since an absent match suppresses it either way.
  test("help daemon stat omits a suggestion for multiple close siblings", async () => {
    const cap = captureIo();

    const code = await main(["help", "daemon", "stat"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: unknownCommandError("stat", undefined, ["daemon"]),
    });
  });

  test("resolveHelpPath and renderHelpNode walk a caller-supplied tree", () => {
    const synthetic: CommandNode = {
      name: "root",
      summary: "Synthetic root.",
      usage: "usage: root\n",
      subcommands: [
        {
          name: "outer",
          summary: "Outer node.",
          subcommands: [{ name: "inner", summary: "Inner node." }],
        },
      ],
    };

    expect(resolveHelpPath(synthetic, ["outer", "inner"])?.map(({ name }) => name)).toEqual(["root", "outer", "inner"]);
    expect(resolveHelpPath(synthetic, ["outer", "nope"])).toBeUndefined();
    // `outer` and `inner` carry no usage, so both fall back to the root's line.
    expect(renderHelpNode(synthetic, ["outer"])).toBe("usage: root\ninner\tInner node.\n");
    expect(renderHelpNode(synthetic, ["outer", "inner"])).toBe("usage: root\n");
    expect(renderHelpNode(synthetic, ["outer", "nope"])).toBeUndefined();

    const withFlags: CommandNode = {
      name: "leaf",
      summary: "Leaf.",
      usage: "usage: leaf\n",
      flags: [{ name: "--foo", argumentShape: "<bar>", description: "Foo flag." }],
    };
    expect(renderHelpNode(withFlags, [])).toBe("usage: leaf\n--foo\t<bar>\tFoo flag.\n");
  });

  test("the command registry and the command tree agree on the top-level commands", () => {
    const treeNodes = commandTree.subcommands ?? [];

    expect(enumerateCommands().map(({ name, summary, usage }) => `${name}|${summary}|${usage}`)).toEqual(
      treeNodes.map(({ name, summary, usage }) => `${name}|${summary}|${usage}`),
    );
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
      PIPELINE_USAGE,
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

  async function expectHelpFlagMatchesHelp(aliasArgv: readonly string[], helpPath: readonly string[]) {
    const helpCap = captureIo();
    const helpCode = await main(["help", ...helpPath], helpCap.io);
    const helpOutput = helpCap.read();

    const aliasCap = captureIo();
    const aliasCode = await main(aliasArgv, aliasCap.io);

    expect(aliasCode).toBe(helpCode);
    expect(aliasCap.read()).toEqual(helpOutput);
  }

  function treeHelpPaths(node: CommandNode, prefix: readonly string[] = []): readonly (readonly string[])[] {
    return (node.subcommands ?? []).flatMap((child) => {
      const path = [...prefix, child.name];
      return [path, ...treeHelpPaths(child, path)];
    });
  }

  test("the --help and -h alias match help for every command-tree path", async () => {
    const paths: readonly (readonly string[])[] = [[], ...treeHelpPaths(commandTree)];

    for (const path of paths) {
      for (const flag of ["--help", "-h"] as const) {
        await expectHelpFlagMatchesHelp([...path, flag], path);
      }
    }
  });

  test("resolveHelpFlagAlias truncates to the longest tree prefix", () => {
    expect(resolveHelpFlagAlias(["tui", "log", "abc123", "--help"])).toEqual(["tui", "log"]);
    expect(resolveHelpFlagAlias(["run", "workflow", "intent-reviewed", "-h"])).toEqual(["run", "workflow"]);
  });

  describe("help flag alias guard invariants", () => {
    test("exact --help/-h tokens only: --helps does not alias", async () => {
      expect(resolveHelpFlagAlias(["--helps"])).toBeUndefined();
      expect(resolveHelpFlagAlias(["-help"])).toBeUndefined();

      const cap = captureIo();
      const code = await main(["--helps"], cap.io);

      expect(code).toBe(1);
      expect(cap.read()).toEqual({
        stdout: "",
        stderr: unknownCommandError("--helps"),
      });
    });

    test("first - token only: --help after an earlier flag does not alias", () => {
      const argv = ["run", "workflow", "intent", "--seed-text", "prose with --help inside"] as const;
      expect(resolveHelpFlagAlias(argv)).toBeUndefined();
    });

    test("longest tree prefix: positional tail after a valid path does not force unknown help", async () => {
      const helpCap = captureIo();
      const helpCode = await main(["help", "tui", "log", "abc123"], helpCap.io);
      expect(helpCode).toBe(1);

      await expectHelpFlagMatchesHelp(["tui", "log", "abc123", "--help"], ["tui", "log"]);
    });
  });

  test("resolveHelpFlagAlias keeps an unknown first segment for help to reject", () => {
    expect(resolveHelpFlagAlias(["nope", "--help"])).toEqual(["nope"]);
  });

  test.each([
    [
      ["tui", "log", "abc123", "--help"],
      ["tui", "log"],
    ],
    [
      ["run", "workflow", "intent-reviewed", "--help"],
      ["run", "workflow"],
    ],
  ] as const)("help flag alias matches help for %j", async (aliasArgv, helpPath) => {
    await expectHelpFlagMatchesHelp(aliasArgv, helpPath);
  });

  test("jarvis nope --help is unknown at depth 0", async () => {
    const cap = captureIo();

    const code = await main(["nope", "--help"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: unknownCommandError("nope", undefined, []),
    });
  });

  test("run workflow intent --seed-text prose with embedded --help is not the help alias", async () => {
    const argv = ["run", "workflow", "intent", "--seed-text", "prose with --help inside"] as const;
    expect(resolveHelpFlagAlias(argv)).toBeUndefined();

    const helpCap = captureIo();
    const helpCode = await main(["help", "run", "workflow", "intent"], helpCap.io);
    const helpOutput = helpCap.read();

    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: ["claude"] });
    const code = await main(argv, cap.io, {
      connectIpcClient: () => Promise.reject(new Error("stubbed: no daemon")),
      socketDiscovery: () => Promise.resolve([]),
      startDaemon: async () => ({ pid: 1, socketPath: "stub", alreadyRunning: false }),
      stopDaemon: async () => {},
      readProjectRegistry: () => ({}),
      machineConfigPath: configPath,
      ...tempPaths(),
    });

    expect(code).toBe(1);
    expect(code).not.toBe(helpCode);
    const output = cap.read();
    expect(output).not.toEqual(helpOutput);
    expect(output.stdout).toBe("");
    expect(output.stderr).toMatch(/^intent:/);
  });

  describe("dispatch-coverage: every tree path is dispatchable", () => {
    /** Extra operands that give a path a minimally valid argument shape, so an argument-shape
     * rejection cannot masquerade as the parent's unknown-subcommand output (`run pause` with no
     * run id prints `RUN_USAGE`, exactly what an unrecognized subcommand prints). Paths absent
     * from this map are driven bare. */
    const operands: Record<string, readonly string[]> = {
      "config set-agents": ["claude"],
      "run log": ["run-1"],
      "run pause": ["run-1"],
      "run resume": ["run-1"],
      "run kill": ["run-1"],
      "run wait": ["run-1"],
      "pipeline start": ["demo", "--seed-text", "seed"],
      "pipeline wait": ["pipe-1"],
      "pipeline approve": ["pipe-1", "gate"],
      "pipeline reject": ["pipe-1", "gate"],
      "pipeline resume": ["pipe-1"],
      "tui log": ["run-1"],
    };

    /** The output each path's parent emits for a name it does not recognize. Asserting a path does
     * not produce it is the coverage check: a tree name no dispatcher accepts falls through to it. */
    function parentUnknownOutput(path: readonly string[]): string {
      const parent = path.slice(0, -1).join(" ");
      if (parent === "") return `unknown command: ${path[0]}\n`;
      if (parent === "daemon") return DAEMON_USAGE;
      if (parent === "config") return CONFIG_USAGE;
      if (parent === "run") return RUN_USAGE;
      if (parent === "run workflow") return WORKFLOW_USAGE;
      if (parent === "tui") return TUI_USAGE;
      if (parent === "pipeline") return PIPELINE_USAGE;
      throw new Error(`dispatch-coverage: no unknown-subcommand output known for parent \`${parent}\``);
    }

    function treePaths(node: CommandNode, prefix: readonly string[] = []): string[][] {
      return (node.subcommands ?? []).flatMap((child) => {
        const path = [...prefix, child.name];
        return [path, ...treePaths(child, path)];
      });
    }

    const paths = treePaths(commandTree);

    test("the driven paths are walked from the tree, not hand-written", () => {
      const joined = paths.map((path) => path.join(" "));
      expect(joined).toContain("write");
      expect(joined).toContain("daemon start");
      expect(joined).toContain("run workflow implement");
    });

    for (const path of paths) {
      test(`${path.join(" ")} dispatches`, async () => {
        const cap = captureIo();
        const configPath = writeMachineConfig({ agents: ["claude"] });

        await main([...path, ...(operands[path.join(" ")] ?? [])], cap.io, {
          connectIpcClient: () => Promise.reject(new Error("stubbed: no daemon")),
          socketDiscovery: () => Promise.resolve([]),
          startDaemon: async () => ({ pid: 1, socketPath: "stub", alreadyRunning: false }),
          stopDaemon: async () => {},
          readDaemonProcessLog: () => 0,
          followDaemonProcessLog: async () => 0,
          runTuiEntry: async () => 0,
          runTuiLogFollow: async () => 0,
          readProjectRegistry: () => ({}),
          machineConfigPath: configPath,
          ...tempPaths(),
        });

        expect(cap.read().stderr).not.toContain(parentUnknownOutput(path));
      });
    }
  });
});
