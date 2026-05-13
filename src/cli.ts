import {
  type CleanupCommandOptions,
  cleanupCommand,
} from "./commands/cleanup.ts";
import { configCommand } from "./commands/config.ts";
import { init as runInit } from "./commands/init.ts";
import { logServerCommand } from "./commands/log-server.ts";
import { type TriageCommandOptions, triageCommand } from "./commands/triage.ts";
import {
  type ConfigOptions,
  findProjectMatchForPath,
  validatePositiveInteger,
} from "./config.ts";
import { type RunCommandOptions, runCommand } from "./modes/patch/run.ts";

export type Subcommand =
  | "run"
  | "init"
  | "config"
  | "log-server"
  | "cleanup"
  | "triage"
  | "help";

export type ParsedArgs =
  | { kind: "help" }
  | {
      kind: "run";
      specPath: string;
      maxIterations?: string;
      repo?: string;
      cwd?: string;
    }
  | { kind: "init" }
  | { kind: "config"; rest: string[] }
  | { kind: "log-server" }
  | { kind: "cleanup"; dryRun?: boolean }
  | { kind: "triage"; worktreeName?: string }
  | { kind: "unknown"; name: string }
  | { kind: "error"; message: string };

export type Io = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

const USAGE = `Usage: jarvis <command> [args]

Commands:
  run [--max-iterations <n>] [--repo <name|path|url>] [--cwd <dir>] <spec-path>
                    Run the loop against a spec file in a registered project.
  init              Register the current target repo.
  config            View or edit the jarvis config.
  log-server        Run the local log aggregation server.
  cleanup [--dry-run]
                    Remove merged worktrees.
  triage [worktree-name]
                    Inspect a dirty or orphaned worktree.
  help              Show this message.
`;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (
    first === undefined ||
    first === "help" ||
    first === "-h" ||
    first === "--help"
  ) {
    return { kind: "help" };
  }
  switch (first) {
    case "run": {
      let maxIterations: string | undefined;
      let repo: string | undefined;
      let cwd: string | undefined;
      const args = [...rest];
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === "--max-iterations") {
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "run: missing value for --max-iterations",
            };
          }
          maxIterations = value;
          args.splice(i, 2);
          i -= 1;
          continue;
        }
        if (args[i] === "--repo") {
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "run: missing value for --repo",
            };
          }
          repo = value;
          args.splice(i, 2);
          i -= 1;
          continue;
        }
        if (args[i] === "--cwd") {
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "run: missing value for --cwd",
            };
          }
          cwd = value;
          args.splice(i, 2);
          i -= 1;
        }
      }
      const specPath = args[0];
      if (specPath === undefined) {
        return { kind: "error", message: "run: missing <spec-path>" };
      }
      const parsed: ParsedArgs = { kind: "run", specPath };
      if (maxIterations !== undefined) {
        parsed.maxIterations = maxIterations;
      }
      if (repo !== undefined) {
        parsed.repo = repo;
      }
      if (cwd !== undefined) {
        parsed.cwd = cwd;
      }
      return parsed;
    }
    case "init":
      return { kind: "init" };
    case "config":
      return { kind: "config", rest };
    case "log-server":
      return { kind: "log-server" };
    case "cleanup": {
      const dryRun = rest.includes("--dry-run");
      return { kind: "cleanup", dryRun };
    }
    case "triage": {
      const worktreeName = rest[0];
      const result: { kind: "triage"; worktreeName?: string } = {
        kind: "triage",
      };
      if (worktreeName !== undefined) {
        result.worktreeName = worktreeName;
      }
      return result;
    }
    default:
      return { kind: "unknown", name: first };
  }
}

export type RunOptions = {
  io?: Io;
  config?: ConfigOptions;
  cwd?: string;
  init?: { workRoot?: string };
  run?: Partial<Pick<RunCommandOptions, "agents" | "handleSignals">>;
};

export function run(
  argv: readonly string[],
  opts: RunOptions = {},
): number | Promise<number> {
  const io: Io = opts.io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const parsed = parseArgs(argv);
  switch (parsed.kind) {
    case "help":
      io.stdout(USAGE);
      return 0;
    case "run": {
      let maxIterations: number | undefined;
      if (parsed.maxIterations !== undefined) {
        const parsedMax = Number(parsed.maxIterations);
        try {
          maxIterations = validatePositiveInteger(
            parsedMax,
            "--max-iterations",
          );
        } catch (err) {
          io.stderr(`jarvis: ${(err as Error).message}\n`);
          return 1;
        }
      }
      const runOpts: RunCommandOptions = {
        specPath: parsed.specPath,
        io,
      };
      if (opts.config !== undefined) {
        runOpts.config = { ...opts.config };
      }
      if (maxIterations !== undefined) {
        runOpts.config = { ...runOpts.config, maxIterations };
      }
      if (parsed.repo !== undefined) {
        runOpts.repoFlag = parsed.repo;
      }
      if (parsed.cwd !== undefined) {
        runOpts.cwdFlag = parsed.cwd;
      }
      if (opts.run?.agents !== undefined) {
        runOpts.agents = opts.run.agents;
      }
      if (opts.run?.handleSignals !== undefined) {
        runOpts.handleSignals = opts.run.handleSignals;
      }
      return runCommand(runOpts);
    }
    case "init":
      return runInit({
        cwd: opts.cwd ?? process.cwd(),
        io,
        config: opts.config,
        workRoot: opts.init?.workRoot,
      });
    case "config":
      return configCommand({ args: parsed.rest, io, config: opts.config });
    case "log-server":
      return logServerCommand({ io, config: opts.config });
    case "cleanup": {
      const cwd = opts.cwd ?? process.cwd();
      const project = findProjectMatchForPath(cwd, opts.config);
      if (project === undefined) {
        io.stderr(
          "jarvis cleanup: not inside any project registered with `jarvis init`\n",
        );
        return 1;
      }
      const readlineSync = (prompt: string): string => {
        io.stdout(prompt);
        const buffer = Buffer.alloc(256);
        let input = "";
        try {
          const nread = require("node:fs").readSync(
            process.stdin.fd,
            buffer,
            0,
            256,
          );
          input = buffer.toString("utf8", 0, nread).trim();
        } catch {
          return "";
        }
        return input;
      };
      const cleanupOpts: CleanupCommandOptions = {
        projectRoot: project.root,
        io: {
          stdout: io.stdout,
          stderr: io.stderr,
          readlineSync,
        },
      };
      if (opts.config !== undefined) {
        cleanupOpts.config = opts.config;
      }
      if (parsed.dryRun !== undefined) {
        cleanupOpts.dryRun = parsed.dryRun;
      }
      return cleanupCommand(cleanupOpts);
    }
    case "triage": {
      const cwd = opts.cwd ?? process.cwd();
      const project = findProjectMatchForPath(cwd, opts.config);
      if (project === undefined) {
        io.stderr(
          "jarvis triage: not inside any project registered with `jarvis init`\n",
        );
        return 1;
      }
      const triageOpts: TriageCommandOptions = {
        projectRoot: project.root,
        io: {
          stdout: io.stdout,
          stderr: io.stderr,
        },
      };
      if (opts.config !== undefined) {
        triageOpts.config = opts.config;
      }
      if (parsed.worktreeName !== undefined) {
        triageOpts.worktreeName = parsed.worktreeName;
      }
      return triageCommand(triageOpts);
    }
    case "unknown":
      io.stderr(`jarvis: unknown command ${JSON.stringify(parsed.name)}\n`);
      io.stderr(USAGE);
      return 1;
    case "error":
      io.stderr(`jarvis: ${parsed.message}\n`);
      io.stderr(USAGE);
      return 1;
  }
}

if (import.meta.main) {
  process.exit(await Promise.resolve(run(process.argv.slice(2))));
}
