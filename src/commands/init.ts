import { homedir } from "node:os";
import { relative, resolve, sep } from "node:path";
import type { Io } from "../cli.ts";
import { type ConfigOptions, loadConfig, registerProject } from "../config.ts";

export type InitOptions = {
  cwd: string;
  io: Io;
  config?: ConfigOptions | undefined;
  workRoot?: string | undefined;
};

function projectNameFor(cwd: string, workRoot: string): string | undefined {
  const root = resolve(workRoot);
  const rel = relative(root, cwd);
  if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) {
    return undefined;
  }
  return rel;
}

export function init(opts: InitOptions): number {
  const cwd = resolve(opts.cwd);
  const { io } = opts;
  const workRoot = resolve(opts.workRoot ?? `${homedir()}${sep}Work`);
  const name = projectNameFor(cwd, workRoot);
  if (name === undefined) {
    io.stderr(`jarvis: init must be run inside ${workRoot}\n`);
    return 1;
  }

  const cfg = loadConfig(opts.config);
  const existing = cfg.projects[name];
  if (existing !== undefined) {
    if (existing.root === cwd) {
      io.stdout(
        `project ${JSON.stringify(name)} already registered at ${cwd}\n`,
      );
      return 0;
    }
    io.stderr(
      `jarvis: project name ${JSON.stringify(name)} is already registered to ${existing.root}. Resolve with \`jarvis config\`.\n`,
    );
    return 1;
  }

  try {
    registerProject(name, cwd, opts.config);
  } catch (err) {
    io.stderr(`jarvis: ${(err as Error).message}\n`);
    return 1;
  }
  io.stdout(`registered project ${JSON.stringify(name)} → ${cwd}\n`);
  return 0;
}
