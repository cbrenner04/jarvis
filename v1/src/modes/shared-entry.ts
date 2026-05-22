import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Io } from "../cli.ts";
import type { Config, ProjectMatch } from "../config.ts";
import { type ConfigOptions, loadConfig } from "../config.ts";
import {
  type DisambiguationResult,
  promptForProject,
} from "../disambiguation-prompt.ts";
import { createLogClient, type LogClient } from "../logging.ts";
import { resolveProject } from "../resolve-project.ts";

export type DisambiguateFn = (opts: {
  candidates: ProjectMatch[];
  reason: string;
  io: Io;
}) => Promise<DisambiguationResult> | DisambiguationResult;

export type SharedPreflightOpts = {
  specPath: string;
  repoFlag?: string;
  config?: ConfigOptions;
  io: Io;
  disambiguate?: DisambiguateFn;
  logServerUrl?: string;
  logClient?: LogClient;
};

export type SharedProjectPreflightOpts = {
  projectPath: string;
  repoFlag?: string;
  config?: ConfigOptions;
  io: Io;
  disambiguate?: DisambiguateFn;
  logServerUrl?: string;
  logClient?: LogClient;
};

export type SharedPreflightResult =
  | {
      kind: "ok";
      project: ProjectMatch;
      projectMode: "registered" | "ad-hoc";
      cfg: Config;
      logClient: LogClient;
    }
  | { kind: "error"; exitCode: number };

export type SharedProjectPreflightResult = SharedPreflightResult;

export async function runSharedPreflight(
  opts: SharedPreflightOpts,
): Promise<SharedPreflightResult> {
  const initialSpecPath = opts.specPath;

  // Resolve the target project
  const projectResolution = await resolveProjectFromSpec({
    specPath: initialSpecPath,
    repoFlag: opts.repoFlag,
    config: opts.config,
    io: opts.io,
    disambiguate: opts.disambiguate,
  });

  if (projectResolution.error !== undefined) {
    opts.io.stderr(`${projectResolution.error}\n`);
    return { kind: "error", exitCode: 1 };
  }

  const project = projectResolution.project;
  const projectMode = projectResolution.mode;
  const projectSource = projectResolution.source;

  // Check project root exists
  const projectRootCheck = checkProjectRootExists(project.root);
  if (!projectRootCheck.ok) {
    opts.io.stderr(
      `${formatMissingProjectRootError({
        path: project.root,
        projectKey: project.key,
        source: projectSource,
        repoFlag: opts.repoFlag,
        reason: projectRootCheck.reason,
      })}\n`,
    );
    return { kind: "error", exitCode: 1 };
  }

  // Load config
  const cfg = loadConfig(opts.config);

  // Check log server reachability
  const logClient =
    opts.logClient ??
    createLogClient(
      opts.logServerUrl ?? cfg.logServerUrl ?? "http://127.0.0.1:4310/logs",
    );

  try {
    await logClient.assertReachable();
  } catch (err) {
    const logServerUrl =
      opts.logServerUrl ?? cfg.logServerUrl ?? "http://127.0.0.1:4310/logs";
    opts.io.stderr(
      `jarvis1: log server unreachable at ${logServerUrl}. Start it with \`jarvis1 log-server\` or update config.\n`,
    );
    opts.io.stderr(`jarvis1: ${(err as Error).message}\n`);
    return { kind: "error", exitCode: 1 };
  }

  return {
    kind: "ok",
    project,
    projectMode,
    cfg,
    logClient,
  };
}

export async function runSharedProjectPreflight(
  opts: SharedProjectPreflightOpts,
): Promise<SharedProjectPreflightResult> {
  const specAnchorPath = join(
    resolve(opts.projectPath),
    ".jarvis-project-resolution-anchor.md",
  );

  const projectResolution = await resolveProjectFromSpec({
    specPath: specAnchorPath,
    repoFlag: opts.repoFlag,
    config: opts.config,
    io: opts.io,
    disambiguate: opts.disambiguate,
  });

  if (projectResolution.error !== undefined) {
    opts.io.stderr(`${projectResolution.error}\n`);
    return { kind: "error", exitCode: 1 };
  }

  const projectRootCheck = checkProjectRootExists(
    projectResolution.project.root,
  );
  if (!projectRootCheck.ok) {
    opts.io.stderr(
      `${formatMissingProjectRootError({
        path: projectResolution.project.root,
        projectKey: projectResolution.project.key,
        source: projectResolution.source,
        repoFlag: opts.repoFlag,
        reason: projectRootCheck.reason,
      })}\n`,
    );
    return { kind: "error", exitCode: 1 };
  }

  const cfg = loadConfig(opts.config);
  const logClient =
    opts.logClient ??
    createLogClient(
      opts.logServerUrl ?? cfg.logServerUrl ?? "http://127.0.0.1:4310/logs",
    );
  try {
    await logClient.assertReachable();
  } catch (err) {
    const logServerUrl =
      opts.logServerUrl ?? cfg.logServerUrl ?? "http://127.0.0.1:4310/logs";
    opts.io.stderr(
      `jarvis1: log server unreachable at ${logServerUrl}. Start it with \`jarvis1 log-server\` or update config.\n`,
    );
    opts.io.stderr(`jarvis1: ${(err as Error).message}\n`);
    return { kind: "error", exitCode: 1 };
  }

  return {
    kind: "ok",
    project: projectResolution.project,
    projectMode: projectResolution.mode,
    cfg,
    logClient,
  };
}

async function resolveProjectFromSpec(opts: {
  specPath: string;
  repoFlag?: string | undefined;
  config?: ConfigOptions | undefined;
  io: Io;
  disambiguate?: DisambiguateFn | undefined;
}): Promise<{
  project: ProjectMatch;
  mode: "registered" | "ad-hoc";
  source?: "repo-flag" | "spec-repo" | "registered" | "ad-hoc";
  error?: string;
}> {
  const specRepoRaw = readRepoPath(opts.specPath);
  const specRepo =
    specRepoRaw === undefined || specRepoRaw.trim() === ""
      ? undefined
      : specRepoRaw.trim();

  // Reject relative `repo:` values up front
  if (
    specRepo !== undefined &&
    /[\\/]/.test(specRepo) &&
    !isAbsolute(specRepo) &&
    !looksLikeUrlOrSlug(specRepo)
  ) {
    return {
      project: { key: "", root: "" },
      mode: "registered",
      error: `spec repo must be an absolute path: ${specRepo}`,
    };
  }

  const resolveOpts: Parameters<typeof resolveProject>[0] = {
    specPath: opts.specPath,
  };
  if (specRepo !== undefined) {
    resolveOpts.specRepo = specRepo;
  }
  if (opts.repoFlag !== undefined) {
    resolveOpts.repoFlag = opts.repoFlag;
  }
  if (opts.config !== undefined) {
    resolveOpts.config = opts.config;
  }
  const result = resolveProject(resolveOpts);

  if (result.kind === "ok") {
    return {
      project: result.resolved.project,
      mode: result.resolved.mode,
      source: result.resolved.source,
    };
  }
  if (result.kind === "error") {
    return {
      project: { key: "", root: "" },
      mode: "registered",
      error: result.message,
    };
  }

  // Ambiguous: prompt user to pick from the matching candidates.
  if (result.kind === "ambiguous") {
    const disambiguateResult = await runDisambiguationPrompt({
      candidates: result.candidates,
      reason: result.reason,
      io: opts.io,
      disambiguate: opts.disambiguate,
    });
    return disambiguateResult;
  }

  // needs-prompt: prompt user to pick from all registered projects.
  const cfg = loadConfig(opts.config);
  const allProjects: ProjectMatch[] = [];
  for (const [key, project] of Object.entries(cfg.projects)) {
    const match: ProjectMatch = { key, root: project.root };
    if (project.origin !== undefined) {
      match.origin = project.origin;
    }
    allProjects.push(match);
  }

  if (allProjects.length === 0) {
    return {
      project: { key: "", root: "" },
      mode: "registered",
      error:
        "could not determine a target project for this spec and no projects are registered. Run `jarvis1 init` in a target repo, or pass --repo <name|url>, or add a `repo:` line.",
    };
  }

  return await runDisambiguationPrompt({
    candidates: allProjects,
    reason: result.reason,
    io: opts.io,
    disambiguate: opts.disambiguate,
  });
}

async function runDisambiguationPrompt(opts: {
  candidates: ProjectMatch[];
  reason: string;
  io: Io;
  disambiguate?: DisambiguateFn | undefined;
}): Promise<{
  project: ProjectMatch;
  mode: "registered" | "ad-hoc";
  source?: "repo-flag" | "spec-repo" | "registered" | "ad-hoc";
  error?: string;
}> {
  const prompt = opts.disambiguate ?? defaultDisambiguate;
  const result = await prompt({
    candidates: opts.candidates,
    reason: opts.reason,
    io: opts.io,
  });
  if (result.kind === "selected") {
    return {
      project: result.project,
      mode: "registered",
      source: "registered",
    };
  }
  if (result.kind === "non-tty") {
    const list = opts.candidates.map((c) => `  - ${c.key}`).join("\n");
    return {
      project: { key: "", root: "" },
      mode: "registered",
      error: `${opts.reason}; rerun with --repo <name>. Candidates:\n${list}`,
    };
  }
  // cancelled
  return {
    project: { key: "", root: "" },
    mode: "registered",
    error: "project selection cancelled",
  };
}

async function defaultDisambiguate(opts: {
  candidates: ProjectMatch[];
  reason: string;
  io: Io;
}): Promise<DisambiguationResult> {
  const isTty = Boolean(process.stdin.isTTY);
  return promptForProject({
    candidates: opts.candidates,
    reason: opts.reason,
    io: opts.io,
    readLine: readLineFromStdin,
    isTty,
  });
}

async function readLineFromStdin(): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const newline = buffer.indexOf(10);
    if (newline !== -1) {
      chunks.push(buffer.subarray(0, newline));
      return Buffer.concat(chunks).toString("utf8");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return Buffer.concat(chunks).toString("utf8");
}

function looksLikeUrlOrSlug(value: string): boolean {
  if (/^(https?:\/\/|ssh:\/\/|git:\/\/|git@)/i.test(value)) {
    return true;
  }
  if (
    /^[A-Za-z0-9_-][A-Za-z0-9._-]*\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(value)
  ) {
    return true;
  }
  return false;
}

function readRepoPath(specPath: string): string | undefined {
  let inFence = false;
  for (const line of readFileSync(specPath, "utf8").split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = line.match(/^repo:\s*(.+?)\s*$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function checkProjectRootExists(
  path: string,
): { ok: true } | { ok: false; reason: "missing" | "not-directory" } {
  if (!existsSync(path)) {
    return { ok: false, reason: "missing" };
  }
  try {
    if (!statSync(path).isDirectory()) {
      return { ok: false, reason: "not-directory" };
    }
  } catch {
    return { ok: false, reason: "missing" };
  }
  return { ok: true };
}

function formatMissingProjectRootError(opts: {
  path: string;
  projectKey: string;
  source: "repo-flag" | "spec-repo" | "registered" | "ad-hoc" | undefined;
  repoFlag: string | undefined;
  reason: "missing" | "not-directory";
}): string {
  const sourceText = describeProjectSource(
    opts.source,
    opts.repoFlag,
    opts.projectKey,
  );
  const what =
    opts.reason === "not-directory"
      ? "is not a directory"
      : "does not exist on disk";
  return `error: project root ${opts.path} ${what} (resolved from ${sourceText})`;
}

function describeProjectSource(
  source: "repo-flag" | "spec-repo" | "registered" | "ad-hoc" | undefined,
  repoFlag: string | undefined,
  projectKey: string,
): string {
  switch (source) {
    case "repo-flag":
      return repoFlag === undefined
        ? "--repo flag value"
        : `--repo flag value ${JSON.stringify(repoFlag)}`;
    case "spec-repo":
      return "spec `repo:` line";
    case "ad-hoc":
      return "ad-hoc git checkout discovered from spec location";
    default:
      return projectKey === ""
        ? "registered project"
        : `registered project \`${projectKey}\``;
  }
}
