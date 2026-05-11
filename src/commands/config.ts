import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Io } from "../cli.ts";
import {
  type AgentName,
  CONFIG_PATH,
  type ConfigOptions,
  loadConfig,
  writeConfig,
} from "../config.ts";

const AGENT_NAMES = ["claude", "codex", "cursor"] as const;

const USAGE = `Usage: jarvis config <subcommand> [args]

Subcommands:
  show                       Print the current config as JSON.
  path                       Print the absolute path of config.json.
  set-order <a,b,c>          Replace agentOrder with a comma-separated list.
  projects                   List registered projects.
  remove-project <name>      Remove a registered project.
  edit                       Open config.json in $EDITOR (fallback: vi).
`;

export type ConfigCommandOptions = {
  args: readonly string[];
  io: Io;
  config?: ConfigOptions | undefined;
  editor?: string | undefined;
  runEditor?: ((file: string) => number) | undefined;
};

function configPath(opts?: ConfigOptions): string {
  const dir = opts?.dir;
  return dir !== undefined ? join(dir, "config.json") : CONFIG_PATH;
}

function parseOrder(raw: string): AgentName[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error("set-order: expected a non-empty comma-separated list");
  }
  const seen = new Set<string>();
  const order: AgentName[] = [];
  for (const p of parts) {
    if (!(AGENT_NAMES as readonly string[]).includes(p)) {
      throw new Error(
        `set-order: unknown agent ${JSON.stringify(p)} (allowed: ${AGENT_NAMES.join(", ")})`,
      );
    }
    if (seen.has(p)) {
      throw new Error(`set-order: duplicate agent ${JSON.stringify(p)}`);
    }
    seen.add(p);
    order.push(p as AgentName);
  }
  return order;
}

export function configCommand(opts: ConfigCommandOptions): number {
  const { args, io } = opts;
  const [sub, ...rest] = args;

  if (sub === undefined) {
    io.stderr(USAGE);
    return 1;
  }

  switch (sub) {
    case "show": {
      const cfg = loadConfig(opts.config);
      io.stdout(`${JSON.stringify(cfg, null, 2)}\n`);
      return 0;
    }
    case "path": {
      io.stdout(`${configPath(opts.config)}\n`);
      return 0;
    }
    case "set-order": {
      const arg = rest[0];
      if (arg === undefined) {
        io.stderr("jarvis: set-order: missing <agent,agent,agent>\n");
        return 1;
      }
      let order: AgentName[];
      try {
        order = parseOrder(arg);
      } catch (err) {
        io.stderr(`jarvis: ${(err as Error).message}\n`);
        return 1;
      }
      const cfg = loadConfig(opts.config);
      cfg.agentOrder = order;
      writeConfig(cfg, opts.config);
      io.stdout(`agentOrder: ${order.join(", ")}\n`);
      return 0;
    }
    case "projects": {
      const cfg = loadConfig(opts.config);
      const entries = Object.entries(cfg.projects);
      if (entries.length === 0) {
        io.stdout("(no projects registered)\n");
        return 0;
      }
      for (const [name, project] of entries) {
        io.stdout(`${name} → ${project.root}\n`);
      }
      return 0;
    }
    case "remove-project": {
      const name = rest[0];
      if (name === undefined) {
        io.stderr("jarvis: remove-project: missing <name>\n");
        return 1;
      }
      const cfg = loadConfig(opts.config);
      if (cfg.projects[name] === undefined) {
        io.stderr(
          `jarvis: remove-project: unknown project ${JSON.stringify(name)}\n`,
        );
        return 1;
      }
      delete cfg.projects[name];
      writeConfig(cfg, opts.config);
      io.stdout(`removed project ${JSON.stringify(name)}\n`);
      return 0;
    }
    case "edit": {
      loadConfig(opts.config);
      const file = configPath(opts.config);
      let status: number;
      if (opts.runEditor !== undefined) {
        status = opts.runEditor(file);
      } else {
        const editor = opts.editor ?? process.env.EDITOR ?? "vi";
        const result = spawnSync(editor, [file], {
          stdio: "inherit",
          shell: true,
        });
        status = result.status ?? 1;
      }
      if (status !== 0) {
        io.stderr(`jarvis: editor exited with status ${status}\n`);
        return 1;
      }
      try {
        loadConfig(opts.config);
      } catch (err) {
        io.stderr(`jarvis: ${(err as Error).message}\n`);
        return 1;
      }
      return 0;
    }
    default:
      io.stderr(`jarvis: unknown config subcommand ${JSON.stringify(sub)}\n`);
      io.stderr(USAGE);
      return 1;
  }
}
