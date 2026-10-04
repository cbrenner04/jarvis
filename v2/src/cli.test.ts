import { describe, expect, test } from "bun:test";
import {
  CLEANUP_HELP_FLAGS,
  DAEMON_LOG_HELP_FLAGS,
  INIT_HELP_FLAGS,
  RUN_KILL_HELP_FLAGS,
  RUN_LIST_HELP_FLAGS,
  WORKFLOW_IMPLEMENT_HELP_FLAGS,
  WORKFLOW_INTENT_HELP_FLAGS,
  WORKFLOW_PLAN_HELP_FLAGS,
  WORKFLOW_REVIEW_FEEDBACK_HELP_FLAGS,
} from "./cli/command-help-flags.ts";
import type { CommandNode } from "./cli/command-tree.ts";
import { commandTree, formatCommandFlagHelpLine, renderHelpNode, resolveHelpPath } from "./cli/command-tree.ts";
import {
  CLEANUP_USAGE,
  DAEMON_LOG_USAGE,
  DAEMON_USAGE,
  HELP_USAGE,
  INIT_USAGE,
  NOTIFICATIONS_USAGE,
  PIPELINE_USAGE,
  RUN_KILL_USAGE,
  RUN_LIST_USAGE,
  RUN_USAGE,
  TUI_USAGE,
  WORKFLOW_IMPLEMENT_USAGE,
  WORKFLOW_INTENT_USAGE,
  WORKFLOW_PLAN_USAGE,
  WORKFLOW_REVIEW_FEEDBACK_USAGE,
  WORKFLOW_USAGE,
} from "./cli/usage.ts";
import {
  classifyFreeTextArgv,
  enumerateCommands,
  findCommand,
  resolveHelpFlagAlias,
  main as runtimeMain,
} from "./cli.ts";
import { PIPELINE_START_USAGE } from "./cli/usage.ts";
import { DAEMON_SOCKET_PATH } from "./paths.ts";
import { captureIo, cliMain as main, tempPaths, writeMachineConfig } from "./testing/cli-test-helpers.ts";

const commandNames = "init, daemon, run, tui, pipeline, notifications, cleanup, help";

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

function freeTextRoutingDeps(onRoute: (body: string) => number | Promise<number>) {
  const calls: string[] = [];
  return {
    deps: {
      runFreeTextRouting: async (body: string) => {
        calls.push(body);
        return await onRoute(body);
      },
    },
    calls: () => calls,
  };
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
    ["Unicode distance two", "run😀😀"],
    ["absent", "zzzz"],
    ["ambiguous", "rux"],
    ["distance three", "wr"],
    ["unique deletion", "wrte"],
    ["insertion", "writex"],
    ["substitution", "wrote"],
    ["distance two", "wte"],
  ])("a single non-command token %s routes as free-text", async (_kind, command) => {
    const cap = captureIo();
    const { deps, calls } = freeTextRoutingDeps(() => 0);

    const code = await main([command], cap.io, deps);

    expect(code).toBe(0);
    expect(calls()).toEqual([command]);
    expect(cap.read()).toEqual({ stdout: "", stderr: "" });
  });

  test("jarvis write routes as free-text", async () => {
    const cap = captureIo();
    const { deps, calls } = freeTextRoutingDeps(() => 0);

    const code = await main(["write"], cap.io, deps);

    expect(code).toBe(0);
    expect(calls()).toEqual(["write"]);
  });

  test("help renders the complete command registry", async () => {
    const cap = captureIo();

    const code = await main(["help"], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({
      stdout:
        "init\tConfigure this machine and register the current repository.\n" +
        "daemon\tManage the background daemon.\n" +
        "run\tManage daemon-backed runs.\n" +
        "tui\tOpen the interactive run monitor.\n" +
        "pipeline\tManage daemon-backed pipelines.\n" +
        "notifications\tPull operator notification deliveries from the daemon ledger.\n" +
        "cleanup\tRetire completed worktrees and specs.\n" +
        "request\tRoute a natural-language request through the action catalog.\n" +
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
    expect(output).toContain("review-feedback\tAddress PR review feedback on a completed lane.");
  });

  test("help run wait prints ancestor usage (no own usage line)", async () => {
    const cap = captureIo();

    const code = await main(["help", "run", "wait"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toBe(RUN_USAGE);
  });

  test("help run workflow intent prints WORKFLOW_INTENT_USAGE", async () => {
    const cap = captureIo();

    const code = await main(["help", "run", "workflow", "intent"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("usage: jarvis run workflow intent");
  });

  describe("command help lists registered flags", () => {
    const cases = [
      ["cleanup", ["help", "cleanup"], CLEANUP_USAGE, CLEANUP_HELP_FLAGS],
      ["run list", ["help", "run", "list"], RUN_LIST_USAGE, RUN_LIST_HELP_FLAGS],
      ["run kill", ["help", "run", "kill"], RUN_KILL_USAGE, RUN_KILL_HELP_FLAGS],
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
  });

  describe("workflow preset help lists registered flags", () => {
    const cases = [
      ["intent", ["help", "run", "workflow", "intent"], WORKFLOW_INTENT_USAGE, WORKFLOW_INTENT_HELP_FLAGS],
      ["plan", ["help", "run", "workflow", "plan"], WORKFLOW_PLAN_USAGE, WORKFLOW_PLAN_HELP_FLAGS],
      ["implement", ["help", "run", "workflow", "implement"], WORKFLOW_IMPLEMENT_USAGE, WORKFLOW_IMPLEMENT_HELP_FLAGS],
      [
        "review-feedback",
        ["help", "run", "workflow", "review-feedback"],
        WORKFLOW_REVIEW_FEEDBACK_USAGE,
        WORKFLOW_REVIEW_FEEDBACK_HELP_FLAGS,
      ],
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

  test("the retired config command is absent from dispatch and help", async () => {
    const dispatch = captureIo();
    const { deps, calls } = freeTextRoutingDeps(() => 0);
    const dispatchCode = await main(["config", "show"], dispatch.io, deps);
    const help = captureIo();
    const helpCode = await main(["help", "config"], help.io);

    expect(dispatchCode).toBe(0);
    expect(calls()).toEqual(["config show"]);
    expect(helpCode).toBe(1);
    expect(help.read()).toEqual({ stdout: "", stderr: unknownCommandError("config", undefined, []) });
    expect(findCommand("config")).toBeUndefined();
    expect(commandTree.subcommands?.map(({ name }) => name)).not.toContain("config");
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

  test("help run strt omits a suggestion when multiple close siblings match", async () => {
    const cap = captureIo();

    const code = await main(["help", "run", "strt"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stderr).not.toContain("did you mean");
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
    const treeNodes = (commandTree.subcommands ?? []).filter((node) => node.name !== "request");

    expect(enumerateCommands().map(({ name, summary, usage }) => `${name}|${summary}|${usage}`)).toEqual(
      treeNodes.map(({ name, summary, usage }) => `${name}|${summary}|${usage}`),
    );
  });

  test("registry owns dispatched commands, metadata, and exact-name lookup", () => {
    const entries = enumerateCommands();

    expect(entries.map(({ name }) => name).join(", ")).toBe(commandNames);
    expect(entries.map(({ usage }) => usage)).toEqual([
      INIT_USAGE,
      DAEMON_USAGE,
      RUN_USAGE,
      TUI_USAGE,
      PIPELINE_USAGE,
      NOTIFICATIONS_USAGE,
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

  test.each(["constructor", "toString"])("%s routes as free-text", async (command) => {
    const cap = captureIo();
    const { deps, calls } = freeTextRoutingDeps(() => 0);

    const code = await main([command], cap.io, deps);

    expect(code).toBe(0);
    expect(calls()).toEqual([command]);
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
        stderr: "jarvis: flags are not supported on free-text requests: --helps\n",
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
      startDaemon: async () => ({ pid: 1, socketPath: "stub", alreadyRunning: false }),
      stopDaemon: async () => ({ reconciledRunIds: [] }),
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

  test("init dispatch and help expose the non-interactive contract", async () => {
    const helpCap = captureIo();
    const helpCode = await main(["help", "init"], helpCap.io);

    expect(helpCode).toBe(0);
    expect(helpCap.read()).toEqual({ stdout: helpStdoutWithFlags(INIT_USAGE, INIT_HELP_FLAGS), stderr: "" });

    for (const flag of ["--help", "-h"] as const) {
      const aliasCap = captureIo();
      const aliasCode = await main(["init", flag], aliasCap.io);

      expect(aliasCode).toBe(helpCode);
      expect(aliasCap.read()).toEqual(helpCap.read());
    }

    // All five parser flags reach the handler unrejected: routed as far as its own --check /
    // --scaffold conflict, not stopped earlier as an unrecognized flag.
    const configPath = writeMachineConfig({});
    const flagsCap = captureIo();
    const flagsCode = await main(
      ["init", "--profile", "home", "--name", "proj", "--target-dir", "dir", "--scaffold", "--check"],
      flagsCap.io,
      { machineConfigPath: configPath },
    );

    expect(flagsCode).toBe(1);
    expect(flagsCap.read()).toEqual({ stdout: "", stderr: "init: --check does not accept --scaffold\n" });

    // Invalid operand: init's own usage on stderr, exit 1; no route prompts for input.
    const badCap = captureIo();
    const badCode = await main(["init", "--bogus", "value"], badCap.io, { machineConfigPath: configPath });

    expect(badCode).toBe(1);
    expect(badCap.read()).toEqual({
      stdout: "",
      stderr: "init: expected [--profile <name>] [--name <key>] [--target-dir <dir>] [--scaffold] [--check]\n",
    });
  });

  test("pipeline start without seed flags does not invoke free-text routing", async () => {
    const cap = captureIo();
    const { deps, calls } = freeTextRoutingDeps(() => 0);
    const configPath = writeMachineConfig({ agents: ["claude"] });

    const code = await main(["pipeline", "start"], cap.io, {
      ...deps,
      machineConfigPath: configPath,
      connectIpcClient: () => Promise.reject(new Error("stubbed: no daemon")),
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe(PIPELINE_START_USAGE);
    expect(calls()).toEqual([]);
  });

  test("jarvis request … invokes free-text routing with the joined body", async () => {
    const cap = captureIo();
    const { deps, calls } = freeTextRoutingDeps(() => 0);
    const argv = ["request", "create", "a", "pipeline", "for", "v2/spec/seeds/x.md"];

    const code = await main(argv, cap.io, deps);

    expect(code).toBe(0);
    expect(calls()).toEqual(["create a pipeline for v2/spec/seeds/x.md"]);
    expect(cap.read()).toEqual({ stdout: "", stderr: "" });
  });

  test("unregistered first token with trailing argv joins into one free-text body", async () => {
    const cap = captureIo();
    const { deps, calls } = freeTextRoutingDeps(() => 0);
    const argv = ["pipelin", "start", "for", "v2/spec/seeds/x.md"];

    const code = await main(argv, cap.io, deps);

    expect(code).toBe(0);
    expect(calls()).toEqual(["pipelin start for v2/spec/seeds/x.md"]);
    expect(cap.read()).toEqual({ stdout: "", stderr: "" });
  });

  test("single unregistered argv token invokes free-text routing once with that body", async () => {
    const cap = captureIo();
    const { deps, calls } = freeTextRoutingDeps(() => 0);

    const code = await main(["pipelin"], cap.io, deps);

    expect(code).toBe(0);
    expect(calls()).toEqual(["pipelin"]);
    expect(cap.read()).toEqual({ stdout: "", stderr: "" });
  });

  test("classifyFreeTextArgv guard inversions", () => {
    expect(classifyFreeTextArgv(["pipeline", "start"])).toBeUndefined();
    expect(classifyFreeTextArgv(["request", "go"])).toEqual({ kind: "body", body: "go" });
    expect(classifyFreeTextArgv(["--bogus"])).toEqual({ kind: "unknown-flag", flag: "--bogus" });
  });

  test("init routing guard inversions expose hidden or invalid routes", async () => {
    const configPath = writeMachineConfig({});

    const dispatchCap = captureIo();
    const dispatchCode = await main(["init", "--bogus", "value"], dispatchCap.io, { machineConfigPath: configPath });

    expect(dispatchCode).toBe(1);
    expect(dispatchCap.read()).toEqual({
      stdout: "",
      stderr: "init: expected [--profile <name>] [--name <key>] [--target-dir <dir>] [--scaffold] [--check]\n",
    });

    const aliasCap = captureIo();
    const aliasCode = await main(["init", "--help"], aliasCap.io);
    const helpCap = captureIo();
    const helpCode = await main(["help", "init"], helpCap.io);

    expect(aliasCode).toBe(helpCode);
    expect(aliasCap.read()).toEqual(helpCap.read());
  });

  describe("dispatch-coverage: every tree path is dispatchable", () => {
    /** Extra operands that give a path a minimally valid argument shape, so an argument-shape
     * rejection cannot masquerade as the parent's unknown-subcommand output (`run undismiss` with no
     * run id prints `RUN_USAGE`, exactly what an unrecognized subcommand prints). Paths absent
     * from this map are driven bare. */
    const operands: Record<string, readonly string[]> = {
      "run log": ["run-1"],
      "run resume": ["run-1"],
      "run kill": ["run-1"],
      "run wait": ["run-1"],
      "pipeline start": ["demo", "--seed-text", "seed"],
      "pipeline wait": ["pipe-1"],
      "pipeline approve": ["pipe-1", "gate", "default"],
      "pipeline reject": ["pipe-1", "gate", "default"],
      "pipeline resume": ["pipe-1"],
      "tui log": ["run-1"],
    };

    /** The output each path's parent emits for a name it does not recognize. Asserting a path does
     * not produce it is the coverage check: a tree name no dispatcher accepts falls through to it. */
    function parentUnknownOutput(path: readonly string[]): string {
      const parent = path.slice(0, -1).join(" ");
      if (parent === "") return `unknown command: ${path[0]}\n`;
      if (parent === "daemon") return DAEMON_USAGE;
      if (parent === "run") return RUN_USAGE;
      if (parent === "run workflow") return WORKFLOW_USAGE;
      if (parent === "tui") return TUI_USAGE;
      if (parent === "pipeline") return PIPELINE_USAGE;
      if (parent === "notifications") return NOTIFICATIONS_USAGE;
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
      expect(joined).toContain("daemon start");
      expect(joined).toContain("run workflow implement");
    });

    for (const path of paths) {
      test(`${path.join(" ")} dispatches`, async () => {
        const cap = captureIo();
        const configPath = writeMachineConfig({ agents: ["claude"] });

        await main([...path, ...(operands[path.join(" ")] ?? [])], cap.io, {
          connectIpcClient: () => Promise.reject(new Error("stubbed: no daemon")),
          startDaemon: async () => ({ pid: 1, socketPath: "stub", alreadyRunning: false }),
          stopDaemon: async () => ({ reconciledRunIds: [] }),
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

describe("stable public daemon address resolution", () => {
  test("daemon-directed work resolves the public socket regardless of executable digest", async () => {
    const seenSocketPaths: string[] = [];
    for (const digest of ["digest-one", "digest-two"]) {
      const cap = captureIo();
      const code = await runtimeMain(["daemon", "status"], cap.io, {
        getExecutableDigest: async () => digest,
        getDaemonStatus: async (socketPath) => {
          seenSocketPaths.push(socketPath);
          return { state: "stopped" };
        },
      });
      expect(code).toBe(1);
    }

    expect(seenSocketPaths).toEqual([DAEMON_SOCKET_PATH, DAEMON_SOCKET_PATH]);
  });
});
