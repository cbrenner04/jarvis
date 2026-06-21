import { isAbsolute, resolve } from "node:path";
import { type CleanupCommandOptions, cleanupCommand } from "./commands/cleanup.ts";
import { configCommand } from "./commands/config.ts";
import { init as runInit } from "./commands/init.ts";
import { intentCommand, INTENT_USAGE } from "./commands/intent.ts";
import { logServerCommand } from "./commands/log-server.ts";
import { planCommand, PLAN_USAGE } from "./commands/plan.ts";
import { pricesCommand } from "./commands/prices.ts";
import { reviewFeedbackCommand } from "./commands/review-feedback.ts";
import { type TriageCommandOptions, triageCommand } from "./commands/triage.ts";
import {
  type ConfigOptions,
  findProjectMatchForPath,
  loadConfig,
  type ProjectMatch,
  resolvePlanFlags,
  validateNonNegativeInteger,
  validatePositiveInteger,
} from "./config.ts";
import { type RunCommandOptions, runCommand } from "./modes/patch/run.ts";
import { promptCommand } from "./modes/prompt/run.ts";
import { runSharedProjectPreflight } from "./modes/shared-entry.ts";

export type Subcommand =
  | "run"
  | "init"
  | "config"
  | "log-server"
  | "cleanup"
  | "triage"
  | "review-feedback"
  | "plan"
  | "intent"
  | "prompt"
  | "prices"
  | "help";

export type ParsedArgs =
  | { kind: "help" }
  | { kind: "run-help" }
  | { kind: "init-help" }
  | { kind: "config-help" }
  | { kind: "log-server-help" }
  | { kind: "cleanup-help" }
  | { kind: "triage-help" }
  | { kind: "review-feedback-help" }
  | { kind: "plan-help" }
  | { kind: "intent-help" }
  | { kind: "prompt-help" }
  | { kind: "prices-help" }
  | {
      kind: "run";
      specPath: string;
      maxIterations?: string;
      reviewPasses?: string;
      repo?: string;
      cwd?: string;
      resumeReview?: boolean;
    }
  | { kind: "init" }
  | { kind: "config"; rest: string[] }
  | { kind: "log-server" }
  | { kind: "cleanup"; dryRun?: boolean }
  | { kind: "triage"; worktreeName?: string }
  | { kind: "review-feedback"; worktreeName?: string }
  | { kind: "plan"; rest: string[] }
  | { kind: "intent"; rest: string[] }
  | {
      kind: "prompt";
      text: string;
      repo?: string;
    }
  | { kind: "prices"; rest: string[] }
  | { kind: "unknown"; name: string }
  | { kind: "error"; message: string };

export type Io = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

const USAGE = `Usage: jarvis1 <command> [args]

Commands:
  run [--max-iterations <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--resume-review] <spec-path>
                    Run the loop against a spec file in a registered project.
                    Use --resume-review to run the post-completion review phase on an already-complete spec.
  init              Register the current target repo.
  config            View or edit the jarvis config.
  log-server        Run the local log aggregation server.
  cleanup [--dry-run]
                    Remove merged worktrees.
  triage [worktree-name]
                    Inspect a dirty or orphaned worktree.
  review-feedback <worktree-name>
                    Address PR review feedback on an existing patch worktree.
  plan [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--target-dir <dir>] [--resume] <targetDir>/ready-intents/<name>.md
                    Draft specs via plan mode with intent refinement and self-review (--resume expects spec/<…>/index.md; --resume-draft expects spec/<…>/intent.md).
  intent [--repo <name|path|url>] [--cwd <dir>] <raw-seed-file|"inline text">
                    Split one seed into authored intents under ready-intents/ and open a draft PR.
  prompt [--repo <name|path|url>] <text>
                    Run an agent against a prompt in a registered project.
  prices            View or edit pricing data for cost tracking.
  help              Show this message.
`;

const RUN_USAGE = `Usage: jarvis1 run [--max-iterations <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--resume-review] <spec-path>

  Run the loop against a spec file in a registered project.
  Use --resume-review to run the post-completion review phase on an already-complete spec.

Flags:
  --max-iterations <n>        Maximum number of patch iterations (default: 10).
  --review-passes <n>         Number of review cycles after completion (default: 1).
  --repo <name|path|url>      Override project resolution via name, path, or URL.
  --cwd <dir>                 Working directory (only with git: false).
  --resume-review             Re-enter the review phase on a completed spec.
`;

const INIT_USAGE = `Usage: jarvis1 init

  Register the current target repo in the project registry.
`;

const CONFIG_USAGE = `Usage: jarvis1 config [show|edit]

  View or edit the jarvis config.
`;

const LOG_SERVER_USAGE = `Usage: jarvis1 log-server

  Run the local log aggregation server.
`;

const CLEANUP_USAGE = `Usage: jarvis1 cleanup [--dry-run]

  Remove merged worktrees.
`;

const TRIAGE_USAGE = `Usage: jarvis1 triage [worktree-name]

  Inspect a dirty or orphaned worktree.
`;

const REVIEW_FEEDBACK_USAGE = `Usage: jarvis1 review-feedback <worktree-name>

  Address PR review feedback on an existing patch worktree.
`;

const PROMPT_USAGE = `Usage: jarvis1 prompt [--repo <name|path|url>] <text>

  Run an agent against a prompt in a registered project.

Flags:
  --repo <name|path|url>      Override project resolution via name, path, or URL.
`;

const PRICES_USAGE = `Usage: jarvis1 prices [show|edit]

  View or edit pricing data for cost tracking.
`;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (first === undefined || first === "help" || first === "-h" || first === "--help") {
    return { kind: "help" };
  }
  switch (first) {
    case "run": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "run-help" };
      }
      let maxIterations: string | undefined;
      let reviewPasses: string | undefined;
      let repo: string | undefined;
      let cwd: string | undefined;
      let resumeReview = false;
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
        if (args[i] === "--review-passes") {
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "run: missing value for --review-passes",
            };
          }
          reviewPasses = value;
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
          continue;
        }
        if (args[i] === "--resume-review") {
          resumeReview = true;
          args.splice(i, 1);
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
      if (reviewPasses !== undefined) {
        parsed.reviewPasses = reviewPasses;
      }
      if (repo !== undefined) {
        parsed.repo = repo;
      }
      if (cwd !== undefined) {
        parsed.cwd = cwd;
      }
      if (resumeReview) {
        parsed.resumeReview = true;
      }
      return parsed;
    }
    case "init":
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "init-help" };
      }
      return { kind: "init" };
    case "config":
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "config-help" };
      }
      return { kind: "config", rest };
    case "log-server":
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "log-server-help" };
      }
      return { kind: "log-server" };
    case "cleanup": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "cleanup-help" };
      }
      const dryRun = rest.includes("--dry-run");
      return { kind: "cleanup", dryRun };
    }
    case "triage": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "triage-help" };
      }
      const worktreeName = rest[0];
      const result: { kind: "triage"; worktreeName?: string } = {
        kind: "triage",
      };
      if (worktreeName !== undefined) {
        result.worktreeName = worktreeName;
      }
      return result;
    }
    case "review-feedback": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "review-feedback-help" };
      }
      const worktreeName = rest[0];
      const result: { kind: "review-feedback"; worktreeName?: string } = {
        kind: "review-feedback",
      };
      if (worktreeName !== undefined) {
        result.worktreeName = worktreeName;
      }
      return result;
    }
    case "plan":
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "plan-help" };
      }
      return { kind: "plan", rest };
    case "intent":
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "intent-help" };
      }
      return { kind: "intent", rest };
    case "prompt": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "prompt-help" };
      }
      let repo: string | undefined;
      const args = [...rest];
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === "--cwd") {
          return {
            kind: "error",
            message: "prompt: --cwd is not allowed",
          };
        }
        if (args[i] === "--repo") {
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "prompt: missing value for --repo",
            };
          }
          repo = value;
          args.splice(i, 2);
          i -= 1;
        }
      }
      const text = args[0];
      if (text === undefined) {
        return { kind: "error", message: "prompt: missing <text>" };
      }
      const parsed: ParsedArgs = { kind: "prompt", text };
      if (repo !== undefined) {
        parsed.repo = repo;
      }
      return parsed;
    }
    case "prices":
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "prices-help" };
      }
      return { kind: "prices", rest };
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

export function run(argv: readonly string[], opts: RunOptions = {}): number | Promise<number> {
  const io: Io = opts.io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const parsed = parseArgs(argv);
  switch (parsed.kind) {
    case "help":
      io.stdout(USAGE);
      return 0;
    case "run-help":
      io.stdout(RUN_USAGE);
      return 0;
    case "init-help":
      io.stdout(INIT_USAGE);
      return 0;
    case "config-help":
      io.stdout(CONFIG_USAGE);
      return 0;
    case "log-server-help":
      io.stdout(LOG_SERVER_USAGE);
      return 0;
    case "cleanup-help":
      io.stdout(CLEANUP_USAGE);
      return 0;
    case "triage-help":
      io.stdout(TRIAGE_USAGE);
      return 0;
    case "review-feedback-help":
      io.stdout(REVIEW_FEEDBACK_USAGE);
      return 0;
    case "plan-help":
      io.stdout(PLAN_USAGE);
      return 0;
    case "intent-help":
      io.stdout(INTENT_USAGE);
      return 0;
    case "prompt-help":
      io.stdout(PROMPT_USAGE);
      return 0;
    case "prices-help":
      io.stdout(PRICES_USAGE);
      return 0;
    case "run": {
      let maxIterations: number | undefined;
      if (parsed.maxIterations !== undefined) {
        const parsedMax = Number(parsed.maxIterations);
        try {
          maxIterations = validatePositiveInteger(parsedMax, "--max-iterations");
        } catch (err) {
          io.stderr(`jarvis1: ${(err as Error).message}\n`);
          return 1;
        }
      }
      let reviewPasses: number | undefined;
      if (parsed.reviewPasses !== undefined) {
        const parsedReview = Number(parsed.reviewPasses);
        try {
          reviewPasses = validateNonNegativeInteger(parsedReview, "--review-passes");
        } catch (err) {
          io.stderr(`jarvis1: ${(err as Error).message}\n`);
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
      if (reviewPasses !== undefined) {
        runOpts.reviewPasses = reviewPasses;
      }
      if (parsed.repo !== undefined) {
        runOpts.repoFlag = parsed.repo;
      }
      if (parsed.cwd !== undefined) {
        runOpts.cwdFlag = parsed.cwd;
      }
      if (parsed.resumeReview) {
        runOpts.resumeReview = true;
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
        io.stderr("jarvis1 cleanup: not inside any project registered with `jarvis1 init`\n");
        return 1;
      }
      const readlineSync = (prompt: string): string => {
        io.stdout(prompt);
        const buffer = Buffer.alloc(256);
        let input = "";
        try {
          const nread = require("node:fs").readSync(process.stdin.fd, buffer, 0, 256);
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
      const cfg = loadConfig(opts.config);
      cleanupOpts.targetDir = resolvePlanFlags(cfg, cfg.projects[project.key]).targetDir;
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
        io.stderr("jarvis1 triage: not inside any project registered with `jarvis1 init`\n");
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
    case "review-feedback": {
      const worktreeName = parsed.worktreeName;
      if (worktreeName === undefined || worktreeName.trim() === "") {
        io.stderr("jarvis1: review-feedback: missing <worktree-name>\n");
        io.stderr(USAGE);
        return 1;
      }
      const cwd = opts.cwd ?? process.cwd();
      const projectPreflightOpts: Parameters<typeof runSharedProjectPreflight>[0] = {
        projectPath: cwd,
        io,
      };
      if (opts.config !== undefined) {
        projectPreflightOpts.config = opts.config;
      }
      return runSharedProjectPreflight(projectPreflightOpts).then((preflight) => {
        if (preflight.kind === "error") {
          return preflight.exitCode;
        }
        const reviewOpts: Parameters<typeof reviewFeedbackCommand>[0] = {
          projectRoot: preflight.project.root,
          worktreeName,
          io,
        };
        if (opts.config !== undefined) {
          reviewOpts.config = opts.config;
        }
        return reviewFeedbackCommand(reviewOpts);
      });
    }
    case "plan": {
      const planOpts: Parameters<typeof planCommand>[0] = {
        io,
        args: parsed.rest,
      };
      if (opts.cwd !== undefined) {
        planOpts.cwd = opts.cwd;
      }
      if (opts.config !== undefined) {
        planOpts.config = opts.config;
      }
      return planCommand(planOpts);
    }
    case "intent": {
      const intentOpts: Parameters<typeof intentCommand>[0] = {
        io,
        args: parsed.rest,
      };
      if (opts.cwd !== undefined) {
        intentOpts.cwd = opts.cwd;
      }
      if (opts.config !== undefined) {
        intentOpts.config = opts.config;
      }
      return intentCommand(intentOpts);
    }
    case "prompt": {
      if (parsed.text.trim() === "") {
        io.stderr(`jarvis1: prompt text must not be empty or whitespace-only\n`);
        return 1;
      }

      const cfg = loadConfig(opts.config);
      const effectiveGit = cfg.git;

      if (!effectiveGit) {
        io.stderr(`jarvis1: prompt mode requires git to be enabled\n`);
        return 1;
      }

      let project: ProjectMatch | undefined;

      if (parsed.repo !== undefined) {
        // Resolve from --repo flag
        const projects: ProjectMatch[] = [];
        for (const [key, p] of Object.entries(cfg.projects)) {
          const match: ProjectMatch = { key, root: p.root };
          if (p.origin !== undefined) {
            match.origin = p.origin;
          }
          projects.push(match);
        }
        const trimmed = parsed.repo.trim();
        const byName = projects.find((p) => p.key === trimmed);
        if (byName !== undefined) {
          project = byName;
        } else if (isAbsolute(trimmed)) {
          const root = resolve(trimmed);
          const byRoot = projects.find((p) => p.root === root);
          if (byRoot !== undefined) {
            project = byRoot;
          }
        }
        if (project === undefined) {
          io.stderr(`jarvis1: --repo: no project matches ${JSON.stringify(parsed.repo)}\n`);
          return 1;
        }
      } else {
        // Resolve from cwd
        project = findProjectMatchForPath(opts.cwd ?? process.cwd(), opts.config);
        if (project === undefined) {
          io.stderr(`jarvis1: repo resolution failed: not inside any project registered with \`jarvis1 init\`\n`);
          return 1;
        }
      }

      return promptCommand({
        promptText: parsed.text,
        io,
        projectPath: opts.cwd ?? process.cwd(),
        config: opts.config,
      });
    }
    case "prices":
      return pricesCommand({ args: parsed.rest, io });
    case "unknown":
      io.stderr(`jarvis1: unknown command ${JSON.stringify(parsed.name)}\n`);
      io.stderr(USAGE);
      return 1;
    case "error":
      io.stderr(`jarvis1: ${parsed.message}\n`);
      io.stderr(USAGE);
      return 1;
  }
}

if (import.meta.main) {
  process.exit(await Promise.resolve(run(process.argv.slice(2))));
}
