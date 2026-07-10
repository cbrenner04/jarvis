import { isAbsolute, join, resolve } from "node:path";
import { PATCH_TIERS, type PatchTier } from "../../shared/spec-parser.ts";
import { cleanupCommand } from "./commands/cleanup.ts";
import { configCommand } from "./commands/config.ts";
import { init as runInit } from "./commands/init.ts";
import { INTENT_USAGE, intentCommand } from "./commands/intent.ts";
import { logServerCommand } from "./commands/log-server.ts";
import { PLAN_USAGE, planCommand } from "./commands/plan.ts";
import { pricesCommand } from "./commands/prices.ts";
import { reviewFeedbackCommand } from "./commands/review-feedback.ts";
import { RUNBOOK_USAGE, runbookCommand } from "./commands/runbook.ts";
import { type TriageCommandOptions, triageCommand } from "./commands/triage.ts";
import {
  type AgentEntry,
  CONFIG_DIR,
  type ConfigOptions,
  findProjectMatchForPath,
  loadConfig,
  type ProjectMatch,
  resolvePlanFlags,
  validateNonNegativeInteger,
  validatePositiveInteger,
} from "./config.ts";
import { type RunCommandOptions, runCommand } from "./modes/patch/run.ts";
import { computeProjectSafeId } from "./modes/plan/spec-paths.ts";
import { promptCommand } from "./modes/prompt/run.ts";
import { runSharedProjectPreflight } from "./modes/shared-entry.ts";
import { parseAgentFlagValues, parsePromptAgentOverride, prefixAgentFlagError } from "./parse-agent-flag.ts";

export type Subcommand =
  | "run"
  | "init"
  | "config"
  | "log-server"
  | "cleanup"
  | "triage"
  | "review-feedback"
  | "runbook"
  | "plan"
  | "intent"
  | "prompt"
  | "prices"
  | "help";

export type ParsedArgs =
  | { kind: "help"; command?: string }
  | {
      kind: "run";
      specPath: string;
      maxIterations?: string;
      reviewPasses?: string;
      tier?: string;
      repo?: string;
      cwd?: string;
      resumeReview?: boolean;
      agentFlags?: string[];
    }
  | { kind: "init" }
  | { kind: "config"; rest: string[] }
  | { kind: "log-server" }
  | { kind: "cleanup"; dryRun?: boolean; abandon?: boolean; worktreeName?: string }
  | { kind: "triage"; worktreeName?: string; markReady?: boolean; merge?: boolean }
  | { kind: "review-feedback"; worktreeName?: string }
  | {
      kind: "runbook";
      action: string;
      entry?: string;
      section?: string;
      issueUrl?: string;
    }
  | { kind: "plan"; rest: string[] }
  | { kind: "intent"; rest: string[]; agentFlag?: string }
  | {
      kind: "prompt";
      text: string;
      repo?: string;
      agentFlag?: string;
      modelFlag?: string;
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
  run [--max-iterations <n>] [--review-passes <n>] [--tier <tier>] [--agent <name>[:<model>]] [--repo <name|path|url>] [--cwd <dir>] [--resume-review] <spec-path>
                    Run the loop against a spec file in a registered project.
                    Use --resume-review to run the post-completion review phase on an already-complete spec.
  init              Register the current target repo.
  config            View or edit the jarvis config.
  log-server        Run the local log aggregation server.
  cleanup [--abandon] [--dry-run] [<worktree-name>]
                    Remove merged or abandoned worktrees.
  triage [target] [--mark-ready] [--merge]
                    Inspect a dirty or orphaned worktree. --mark-ready or --merge on a named worktree.
  review-feedback <worktree-name>
                    Address PR review feedback on an existing patch worktree.
  runbook add [--section <heading>] [--issue-url <url>] <entry>
                    Append a learning to the project's OPERATOR_RUNBOOK.md.
  plan [--review-passes <n>] [--agent <name>[:<model>]] [--repo <name|path|url>] [--cwd <dir>] [--target-dir <dir>] [--resume] <targetDir>/ready-intents/<name>.md
                    Draft specs via plan mode with intent refinement and self-review (--resume expects spec/<…>/index.md; --resume-draft expects spec/<…>/intent.md).
  intent [--agent <name>[:<model>]] [--repo <name|path|url>] [--cwd <dir>] [--target-dir <dir>] <raw-seed-file|"inline text">
                    Split one seed into authored intents under ready-intents/ and open a PR.
  prompt [--repo <name|path|url>] [--agent <name>[:<model>]] [--model <model>] <text>
                    Run an agent against a prompt in a registered project.
  prices            View or edit pricing data for cost tracking.
  help              Show this message.
`;

const COMMAND_USAGE: Record<string, string> = {
  run: `Usage: jarvis1 run [--max-iterations <n>] [--review-passes <n>] [--tier <tier>] [--agent <name>[:<model>]] [--repo <name|path|url>] [--cwd <dir>] [--resume-review] <spec-path>

  Run the loop against a spec file in a registered project.
  Use --resume-review to run the post-completion review phase on an already-complete spec.

Flags:
  --max-iterations <n>        Maximum number of patch iterations (default: 10).
  --review-passes <n>         Number of review cycles after completion (default: 1).
  --tier <tier>               Patch ladder start tier: trivial, standard, or hard.
  --agent <name>[:<model>]    Repeatable; one-run patch implementation ladder override.
  --repo <name|path|url>      Override project resolution via name, path, or URL.
  --cwd <dir>                 Working directory (only with git: false).
  --resume-review             Re-enter the review phase on a completed spec.
`,
  init: `Usage: jarvis1 init

  Register the current target repo in the project registry and scaffold
  an OPERATOR_RUNBOOK.md at the project root (if absent).
`,
  config: `Usage: jarvis1 config [show|edit]

  View or edit the jarvis config.
`,
  "log-server": `Usage: jarvis1 log-server

  Run the local log aggregation server.
`,
  cleanup: `Usage: jarvis1 cleanup [--abandon] [--dry-run] [<worktree-name>]

  Remove merged worktrees, or retire abandoned worktrees with --abandon.
  With --abandon, an optional worktree name retires only that tree.
`,
  triage: `Usage: jarvis1 triage [target] [--mark-ready] [--merge]

  Inspect a dirty or orphaned worktree. On a named worktree, --mark-ready finalizes
  a complete run: commit dirty work, open a draft PR when absent, run the completion
  ready gate once, and flip the PR to ready on green. --merge runs the ready gate,
  marks the PR ready if draft, waits for CI to be green, then admin-squash-merges
  the PR.

  --mark-ready requires a worktree name. --merge accepts a worktree name, a spec path
  (index or subspec, relative or absolute), or a PR reference (#N, bare N, or a
  GitHub pull URL).
`,
  "review-feedback": `Usage: jarvis1 review-feedback <worktree-name>

  Address PR review feedback on an existing patch worktree.
`,
  prompt: `Usage: jarvis1 prompt [--repo <name|path|url>] [--agent <name>[:<model>]] [--model <model>] <text>

  Run an agent against a prompt in a registered project.

Flags:
  --repo <name|path|url>      Override project resolution via name, path, or URL.
  --agent <name>[:<model>]    Pin the primary agent for this invocation.
  --model <model>             Model for the pinned agent when --agent omits :model.
`,
  prices: `Usage: jarvis1 prices [show|edit]

  View or edit pricing data for cost tracking.
`,
};

// Populate from plan and intent modules to avoid duplication
Object.assign(COMMAND_USAGE, { plan: PLAN_USAGE, intent: INTENT_USAGE, runbook: RUNBOOK_USAGE });

const AGENT_FLAG_SUBCOMMANDS = new Set(["run", "plan", "prompt", "intent"]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (first === undefined || first === "help" || first === "-h" || first === "--help") {
    return { kind: "help" };
  }
  if (!AGENT_FLAG_SUBCOMMANDS.has(first) && rest.includes("--agent")) {
    return { kind: "error", message: `${first}: --agent is not supported` };
  }
  switch (first) {
    case "run": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "run" };
      }
      let maxIterations: string | undefined;
      let reviewPasses: string | undefined;
      let tier: string | undefined;
      let repo: string | undefined;
      let cwd: string | undefined;
      let resumeReview = false;
      const agentFlags: string[] = [];
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
        if (args[i] === "--tier") {
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "run: missing value for --tier",
            };
          }
          tier = value;
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
          continue;
        }
        if (args[i] === "--agent") {
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "run: missing value for --agent",
            };
          }
          agentFlags.push(value);
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
      if (reviewPasses !== undefined) {
        parsed.reviewPasses = reviewPasses;
      }
      if (tier !== undefined) {
        parsed.tier = tier;
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
      if (agentFlags.length > 0) {
        parsed.agentFlags = agentFlags;
      }
      return parsed;
    }
    case "init":
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "init" };
      }
      return { kind: "init" };
    case "config":
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "config" };
      }
      return { kind: "config", rest };
    case "log-server":
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "log-server" };
      }
      return { kind: "log-server" };
    case "cleanup": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "cleanup" };
      }
      const dryRun = rest.includes("--dry-run");
      const abandon = rest.includes("--abandon");
      const positionals = rest.filter((arg) => arg !== "--dry-run" && arg !== "--abandon");
      if (positionals.length > 0 && !abandon) {
        return { kind: "error", message: "cleanup: [<worktree-name>] requires --abandon" };
      }
      if (positionals.length > 1) {
        return { kind: "error", message: "cleanup: too many arguments" };
      }
      return {
        kind: "cleanup",
        dryRun,
        abandon,
        ...(positionals[0] !== undefined ? { worktreeName: positionals[0] } : {}),
      };
    }
    case "triage": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "triage" };
      }
      const markReady = rest.includes("--mark-ready");
      const merge = rest.includes("--merge");
      const args = rest.filter((arg) => arg !== "--mark-ready" && arg !== "--merge");
      const worktreeName = args[0];
      const result: { kind: "triage"; worktreeName?: string; markReady?: boolean; merge?: boolean } = {
        kind: "triage",
      };
      if (worktreeName !== undefined) {
        result.worktreeName = worktreeName;
      }
      if (markReady) {
        result.markReady = true;
      }
      if (merge) {
        result.merge = true;
      }
      if (markReady && worktreeName === undefined) {
        return {
          kind: "error",
          message: "triage: --mark-ready requires a worktree name",
        };
      }
      if (merge && worktreeName === undefined) {
        return {
          kind: "error",
          message: "triage: --merge requires a target (worktree name, spec path, or PR reference)",
        };
      }
      if (markReady && merge) {
        return {
          kind: "error",
          message: "triage: --merge and --mark-ready are mutually exclusive",
        };
      }
      return result;
    }
    case "review-feedback": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "review-feedback" };
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
        return { kind: "help", command: "plan" };
      }
      return { kind: "plan", rest };
    case "intent": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "intent" };
      }
      const agentIndex = rest.indexOf("--agent");
      const agentFlag = agentIndex === -1 ? undefined : rest[agentIndex + 1];
      return agentFlag === undefined ? { kind: "intent", rest } : { kind: "intent", rest, agentFlag };
    }
    case "prompt": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "prompt" };
      }
      let repo: string | undefined;
      let agentFlag: string | undefined;
      let modelFlag: string | undefined;
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
          continue;
        }
        if (args[i] === "--agent") {
          if (agentFlag !== undefined) {
            return {
              kind: "error",
              message: "prompt: duplicate --agent flag",
            };
          }
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "prompt: missing value for --agent",
            };
          }
          agentFlag = value;
          args.splice(i, 2);
          i -= 1;
          continue;
        }
        if (args[i] === "--model") {
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "prompt: missing value for --model",
            };
          }
          modelFlag = value;
          args.splice(i, 2);
          i -= 1;
        }
      }
      const text = args[0];
      if (text === undefined) {
        return { kind: "error", message: "prompt: missing <text>" };
      }
      return {
        kind: "prompt",
        text,
        ...(repo !== undefined ? { repo } : {}),
        ...(agentFlag !== undefined ? { agentFlag } : {}),
        ...(modelFlag !== undefined ? { modelFlag } : {}),
      };
    }
    case "prices":
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "prices" };
      }
      return { kind: "prices", rest };
    case "runbook": {
      if (rest.includes("--help") || rest.includes("-h")) {
        return { kind: "help", command: "runbook" };
      }
      if (rest.length === 0) {
        return { kind: "runbook", action: "" };
      }
      const action = rest[0] ?? "";
      const args = [...rest.slice(1)];
      let section: string | undefined;
      let issueUrl: string | undefined;
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === "--section") {
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "runbook: missing value for --section",
            };
          }
          section = value;
          args.splice(i, 2);
          i -= 1;
          continue;
        }
        if (args[i] === "--issue-url") {
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              message: "runbook: missing value for --issue-url",
            };
          }
          issueUrl = value;
          args.splice(i, 2);
          i -= 1;
        }
      }
      const entry = args[0];
      const parsed: { kind: "runbook"; action: string; entry?: string; section?: string; issueUrl?: string } = {
        kind: "runbook",
        action,
      };
      if (entry !== undefined) {
        parsed.entry = entry;
      }
      if (section !== undefined) {
        parsed.section = section;
      }
      if (issueUrl !== undefined) {
        parsed.issueUrl = issueUrl;
      }
      return parsed;
    }
    default:
      return { kind: "unknown", name: first };
  }
}

export type RunOptions = {
  io?: Io;
  config?: ConfigOptions;
  cwd?: string;
  init?: { workRoot?: string; readOriginUrl?: (cwd: string) => string | undefined };
  run?: Partial<Pick<RunCommandOptions, "agents" | "handleSignals">>;
};

function parsePatchTier(value: string, flagName: string): PatchTier {
  if ((PATCH_TIERS as readonly string[]).includes(value)) {
    return value as PatchTier;
  }
  throw new Error(`${flagName} must be one of ${PATCH_TIERS.join(", ")}`);
}

export function run(argv: readonly string[], opts: RunOptions = {}): number | Promise<number> {
  const io: Io = opts.io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const parsed = parseArgs(argv);
  switch (parsed.kind) {
    case "help": {
      if (parsed.command) {
        const usage = COMMAND_USAGE[parsed.command];
        if (usage) {
          io.stdout(usage);
          return 0;
        }
      }
      io.stdout(USAGE);
      return 0;
    }
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
      let tierOverride: PatchTier | undefined;
      if (parsed.tier !== undefined) {
        try {
          tierOverride = parsePatchTier(parsed.tier, "--tier");
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
      if (tierOverride !== undefined) {
        runOpts.tierOverride = tierOverride;
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
      if (parsed.agentFlags !== undefined && parsed.agentFlags.length > 0) {
        const cfg = loadConfig(opts.config);
        const parsedAgents = parseAgentFlagValues(parsed.agentFlags, cfg.modes.patch.agentOrder);
        if (!parsedAgents.ok) {
          io.stderr(`jarvis1: ${prefixAgentFlagError("run", parsedAgents.message)}\n`);
          return 1;
        }
        runOpts.agentOrderOverride = parsedAgents.agentOrder;
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
        ...(opts.init?.readOriginUrl !== undefined ? { readOriginUrl: opts.init.readOriginUrl } : {}),
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
      const cfg = loadConfig(opts.config);
      const planFlags = resolvePlanFlags(cfg, cfg.projects[project.key]);
      return cleanupCommand({
        projectRoot: project.root,
        io: {
          stdout: io.stdout,
          stderr: io.stderr,
          readlineSync,
        },
        targetDir: planFlags.targetDir,
        commit: planFlags.commit,
        externalSpecsRoot: join(opts.config?.dir ?? CONFIG_DIR, "specs", computeProjectSafeId(project)),
        ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
        ...(parsed.abandon !== undefined ? { abandon: parsed.abandon } : {}),
        ...(parsed.worktreeName !== undefined ? { worktreeName: parsed.worktreeName } : {}),
      });
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
        cwd,
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
      if (parsed.markReady !== undefined) {
        triageOpts.markReady = parsed.markReady;
      }
      if (parsed.merge !== undefined) {
        triageOpts.merge = parsed.merge;
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

      let pinnedAgent: AgentEntry | undefined;
      if (parsed.agentFlag !== undefined) {
        const parsedAgent = parsePromptAgentOverride(parsed.agentFlag, parsed.modelFlag, cfg.modes.prompt.agentOrder);
        if (!parsedAgent.ok) {
          io.stderr(`jarvis1: ${prefixAgentFlagError("prompt", parsedAgent.message)}\n`);
          return 1;
        }
        pinnedAgent = parsedAgent.pinned;
      } else if (parsed.modelFlag !== undefined) {
        io.stderr("jarvis1: prompt: --model requires --agent\n");
        return 1;
      }

      return promptCommand({
        promptText: parsed.text,
        io,
        projectPath: opts.cwd ?? process.cwd(),
        config: opts.config,
        ...(pinnedAgent !== undefined ? { pinnedAgent } : {}),
      });
    }
    case "prices":
      return pricesCommand({ args: parsed.rest, io });
    case "runbook": {
      const cwd = opts.cwd ?? process.cwd();
      const runbookOpts: Parameters<typeof runbookCommand>[0] = {
        action: parsed.action ?? "",
        io,
        cwd,
      };
      if (parsed.entry !== undefined) {
        runbookOpts.entry = parsed.entry;
      }
      if (parsed.section !== undefined) {
        runbookOpts.section = parsed.section;
      }
      if (parsed.issueUrl !== undefined) {
        runbookOpts.issueUrl = parsed.issueUrl;
      }
      if (opts.config !== undefined) {
        runbookOpts.config = opts.config;
      }
      return runbookCommand(runbookOpts);
    }
    case "unknown":
      io.stderr(`jarvis1: unknown command ${JSON.stringify(parsed.name)}\n`);
      io.stderr(USAGE);
      return 1;
    case "error":
      io.stderr(`jarvis1: ${parsed.message}\n`);
      if (parsed.message.startsWith("runbook:")) {
        io.stderr(RUNBOOK_USAGE);
      } else {
        io.stderr(USAGE);
      }
      return 1;
  }
}

if (import.meta.main) {
  // Harness git calls (push/fetch/ls-remote) against an HTTPS remote without
  // cached credentials would otherwise prompt on /dev/tty and hang the session.
  // Default to non-interactive so they fail fast; respect an explicit override.
  if (!process.env.GIT_TERMINAL_PROMPT) {
    process.env.GIT_TERMINAL_PROMPT = "0";
  }
  process.exit(await Promise.resolve(run(process.argv.slice(2))));
}
