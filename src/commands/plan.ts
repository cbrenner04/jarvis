import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { loadConfig } from "../config.ts";
import type { LogClient } from "../logging.ts";
import { enterMode } from "../mode-entry.ts";
import { commitPlanDraft, commitPlanInterview } from "../modes/plan/commits.ts";
import type { resolveTargetRepo } from "../repo.ts";
import { createPlanWorktree, createWorktreeSymlinks } from "../worktree.ts";
import {
  describePlanInvocation,
  type PlanInvocation,
  parsePlanArgs,
} from "./plan-args.ts";

export type PlanIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type PlanCommandOptions = {
  io: PlanIo;
  args?: readonly string[];
  cwd?: string;
  /**
   * Optional config dir override (for tests).
   */
  config?: Parameters<typeof resolveTargetRepo>[0]["config"];
  /** Override the log client (for tests). */
  logClient?: LogClient;
  /** Skip git/gh checks and worktree creation (for tests). */
  skipGhCheck?: boolean;
};

export const PLAN_USAGE = `Usage: jarvis plan [--interview-turns <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--resume] [<intent-file-or-text>]
                            Generate a spec tree from an intent. (planning behavior arrives in later specs)
`;

export const PLAN_STUB_MESSAGE =
  "jarvis plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n";

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function derivePlanName(inv: PlanInvocation): string | null {
  switch (inv.mode) {
    case "file": {
      const filename = basename(inv.intentPath);
      const nameWithoutExt = filename.replace(/\.[^.]*$/, "");
      return toKebabCase(nameWithoutExt) || "plan";
    }
    case "inline": {
      const words = inv.intentText.split(/\s+/).slice(0, 6);
      const kebabbed = toKebabCase(words.join(" "));
      const truncated = kebabbed.slice(0, 40);
      return truncated || "plan";
    }
    case "interactive":
      return null;
  }
}

const RESERVED_NAMES = new Set(["index", "intent"]);

function remoteSpecBranchExists(
  projectRoot: string,
  branchName: string,
): boolean {
  try {
    const output = execFileSync(
      "git",
      ["ls-remote", "--heads", "origin", `plan/${branchName}`],
      {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      },
    );
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export async function deriveSpecName(
  inv: PlanInvocation,
  projectRoot: string,
): Promise<string> {
  const candidateName = derivePlanName(inv);
  // Note: derivePlanName returns null for interactive mode, but interactive mode
  // is filtered out in planCommand before calling deriveSpecName, so candidateName
  // is always a string here
  if (candidateName === null) {
    throw new Error("deriveSpecName called with interactive mode");
  }

  let name = candidateName;

  // Check reserved names
  if (RESERVED_NAMES.has(name)) {
    name = "plan";
  }

  // Check for collisions and append suffix if needed
  let finalName = name;
  const specDirExists = existsSync(join(projectRoot, "spec", finalName));
  const worktreeDirExists = existsSync(
    join(projectRoot, ".worktree", `plan-${finalName}`),
  );
  const remoteBranchExists = remoteSpecBranchExists(projectRoot, finalName);

  if (!specDirExists && !worktreeDirExists && !remoteBranchExists) {
    // No collision, return the name as-is
    return finalName;
  }

  // There's a collision, start with suffix -2
  let suffix = 2;
  while (true) {
    finalName = `${name}-${suffix}`;

    const specDirExists = existsSync(join(projectRoot, "spec", finalName));
    const worktreeDirExists = existsSync(
      join(projectRoot, ".worktree", `plan-${finalName}`),
    );
    const remoteBranchExists = remoteSpecBranchExists(projectRoot, finalName);

    if (!specDirExists && !worktreeDirExists && !remoteBranchExists) {
      break;
    }

    suffix += 1;
  }

  return finalName;
}

export type SeedIntentFileMode = "file" | "inline";

export type SeedIntentFileOptions = {
  worktreePath: string;
  name: string;
  mode: SeedIntentFileMode;
  intentPath?: string;
  intentText?: string;
};

export function seedIntentFile(opts: SeedIntentFileOptions): void {
  const specDir = join(opts.worktreePath, "spec", opts.name);
  const intentPath = join(specDir, "intent.md");

  if (existsSync(intentPath)) {
    throw new Error(
      `intent.md already exists at ${intentPath}; will not overwrite`,
    );
  }

  mkdirSync(specDir, { recursive: true });

  let content: string;
  if (opts.mode === "file") {
    if (!opts.intentPath) {
      throw new Error("intentPath required for file mode");
    }
    try {
      content = readFileSync(opts.intentPath, "utf8");
    } catch (err) {
      throw new Error(`could not read intent file: ${(err as Error).message}`);
    }
  } else if (opts.mode === "inline") {
    if (opts.intentText === undefined) {
      throw new Error("intentText required for inline mode");
    }
    content = `${opts.intentText}\n`;
  } else {
    throw new Error(`unknown mode: ${opts.mode}`);
  }

  writeFileSync(intentPath, content, "utf8");
}

export async function planCommand(opts: PlanCommandOptions): Promise<number> {
  const args = opts.args ?? [];
  if (args.includes("--help") || args.includes("-h")) {
    opts.io.stdout(PLAN_USAGE);
    return 0;
  }
  const processCwd = opts.cwd ?? process.cwd();
  const result = parsePlanArgs(args, processCwd);
  if (!result.ok) {
    opts.io.stderr(`${result.message}\n`);
    return result.exitCode;
  }
  opts.io.stderr(`${describePlanInvocation(result.invocation)}\n`);

  const inv = result.invocation;
  // Resolve from a file-like path (matching run mode, which passes a spec
  // file). For inline/interactive plan modes there's no real intent file, so
  // synthesize one inside cwd: resolveProject's `dirname()` then yields cwd
  // as the walk start, mirroring "as if there were a spec here".
  const candidatePath =
    inv.mode === "file" ? inv.intentPath : join(inv.cwd, "intent");
  const cfg = loadConfig(opts.config);
  const entryOpts: Parameters<typeof enterMode>[0] = {
    candidatePath,
    io: { stderr: opts.io.stderr },
    logServerUrl: cfg.logServerUrl,
  };
  if (inv.repo !== undefined) {
    entryOpts.repoFlag = inv.repo;
  }
  if (opts.config !== undefined) {
    entryOpts.config = opts.config;
  }
  if (opts.logClient !== undefined) {
    entryOpts.logClient = opts.logClient;
  }
  const entry = await enterMode(entryOpts);
  if (entry.kind === "error") {
    opts.io.stderr(`${entry.message}\n`);
    return 1;
  }
  if (entry.kind === "ambiguous") {
    const names = entry.candidates.map((c) => `  - ${c.key}`).join("\n");
    opts.io.stderr(
      `${entry.reason}\nMatching projects:\n${names}\nPass --repo <name> to disambiguate.\n`,
    );
    return 1;
  }
  if (entry.kind === "needs-prompt") {
    opts.io.stderr(
      "could not determine a target project for this intent and no projects are registered. Run `jarvis init` in a target repo, or pass --repo <name|url>.\n",
    );
    return 1;
  }
  if (entry.kind === "log-error") {
    return entry.exitCode;
  }

  const project = entry.resolution.resolved.project;
  opts.io.stderr(
    `plan mode: target project=${project.key} root=${project.root}\n`,
  );

  // For interactive mode, keep falling through to stub exit
  const planName = derivePlanName(inv);
  if (planName === null) {
    opts.io.stderr(PLAN_STUB_MESSAGE);
    return 2;
  }

  // Derive the spec name with collision handling
  const specName = await deriveSpecName(inv, project.root);
  opts.io.stderr(`plan mode: spec name=${specName}\n`);

  // Create worktree for file or inline mode (only if it's a git repo and gh is available)
  const isGitRepo = existsSync(join(project.root, ".git"));
  let worktreePath: string | null = null;
  if (!opts.skipGhCheck && isGitRepo) {
    try {
      worktreePath = await createPlanWorktree({
        projectRoot: project.root,
        name: specName,
      });
      const cfg = loadConfig(opts.config);
      createWorktreeSymlinks(project.root, worktreePath, cfg.worktreeSymlinks);
      opts.io.stderr(`plan mode: worktree created at ${worktreePath}\n`);
    } catch (err) {
      const message = (err as Error).message;
      // Handle local-only branch collision with a specific error message
      if (message.includes("already exists") && message.includes(".worktree")) {
        opts.io.stderr(
          `plan: local branch plan/${specName} already exists; delete it with \`git branch -D plan/${specName}\` and re-run\n`,
        );
      } else {
        opts.io.stderr(`failed to create plan worktree: ${message}\n`);
      }
      return 1;
    }

    // Seed the intent.md file into the worktree
    try {
      if (inv.mode === "file") {
        seedIntentFile({
          worktreePath,
          name: specName,
          mode: "file",
          intentPath: inv.intentPath,
        });
      } else if (inv.mode === "inline") {
        seedIntentFile({
          worktreePath,
          name: specName,
          mode: "inline",
          intentText: inv.intentText,
        });
      }
    } catch (err) {
      opts.io.stderr(`failed to seed intent file: ${(err as Error).message}\n`);
      return 1;
    }

    // Create plan: interview commit and push
    try {
      const intentPathOrLabel =
        inv.mode === "file"
          ? (inv as Extract<typeof inv, { mode: "file" }>).intentPath
          : (inv as Extract<typeof inv, { mode: "inline" }>).intentText;
      commitPlanInterview({
        worktreePath,
        name: specName,
        mode: inv.mode as "file" | "inline",
        intentPathOrLabel,
      });
      opts.io.stderr(`plan mode: interview commit pushed\n`);
    } catch (err) {
      opts.io.stderr(`${(err as Error).message}\n`);
      return 1;
    }

    // Create plan: draft commit and push
    try {
      commitPlanDraft({
        worktreePath,
        name: specName,
      });
      opts.io.stderr(`plan mode: draft commit pushed\n`);
    } catch (err) {
      opts.io.stderr(`${(err as Error).message}\n`);
      return 1;
    }

    // For file/inline mode, commits were successfully created and pushed
    opts.io.stderr(
      `plan mode: commits created and pushed to plan/${specName}\n`,
    );
    return 0;
  }

  opts.io.stderr(PLAN_STUB_MESSAGE);
  return 2;
}
