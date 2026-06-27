import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { relative, resolve, sep } from "node:path";
import type { Io } from "../cli.ts";
import { type ConfigOptions, loadConfig, registerProject } from "../config.ts";
import { generateOperatorRunbook } from "../runbook-generator.ts";

export type InitOptions = {
  cwd: string;
  io: Io;
  config?: ConfigOptions | undefined;
  workRoot?: string | undefined;
  readOriginUrl?: (cwd: string) => string | undefined;
};

function projectNameFor(cwd: string, workRoot: string): string | undefined {
  const root = resolve(workRoot);
  const rel = relative(root, cwd);
  if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) {
    return undefined;
  }
  return rel;
}

export function readGitOriginUrl(cwd: string): string | undefined {
  try {
    const out = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const trimmed = out.trim();
    return trimmed === "" ? undefined : trimmed;
  } catch {
    return undefined;
  }
}

export function init(opts: InitOptions): number {
  const cwd = resolve(opts.cwd);
  const { io } = opts;
  const workRoot = resolve(opts.workRoot ?? `${homedir()}${sep}Work`);
  const name = projectNameFor(cwd, workRoot);
  if (name === undefined) {
    io.stderr(`jarvis1: init must be run inside ${workRoot}\n`);
    return 1;
  }

  const cfg = loadConfig(opts.config);
  const existing = cfg.projects[name];
  if (existing !== undefined) {
    if (existing.root === cwd) {
      io.stdout(`project ${JSON.stringify(name)} already registered at ${cwd}\n`);
      return 0;
    }
    io.stderr(
      `jarvis1: project name ${JSON.stringify(name)} is already registered to ${existing.root}. Resolve with \`jarvis1 config\`.\n`,
    );
    return 1;
  }

  const readOrigin = opts.readOriginUrl ?? readGitOriginUrl;
  const rawOrigin = readOrigin(cwd);
  const origin = rawOrigin === undefined || rawOrigin.trim() === "" ? undefined : rawOrigin.trim();

  try {
    registerProject(name, cwd, origin === undefined ? opts.config : { ...(opts.config ?? {}), origin });
  } catch (err) {
    io.stderr(`jarvis1: ${(err as Error).message}\n`);
    return 1;
  }
  io.stdout(`registered project ${JSON.stringify(name)} → ${cwd}\n`);
  if (origin === undefined) {
    io.stdout(`note: no \`origin\` remote found in ${cwd}; skipped recording origin URL\n`);
  }

  // Write OPERATOR_RUNBOOK.md if it doesn't already exist
  const runbookPath = resolve(cwd, "OPERATOR_RUNBOOK.md");
  if (!existsSync(runbookPath)) {
    const fullConfig = loadConfig(opts.config);
    const project = fullConfig.projects[name];
    if (project === undefined) {
      io.stderr(`jarvis1: project ${JSON.stringify(name)} not found in config\n`);
      return 1;
    }
    const runbookContent = generateOperatorRunbook({
      projectKey: name,
      projectRoot: cwd,
      projectOrigin: origin,
      config: fullConfig,
      project,
    });
    try {
      writeFileSync(runbookPath, runbookContent, "utf8");
    } catch (err) {
      io.stderr(`jarvis1: failed to write runbook: ${(err as Error).message}\n`);
      return 1;
    }
  }

  return 0;
}
