import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Io } from "../cli.ts";
import {
  type AgentName,
  CONFIG_PATH,
  type ConfigOptions,
  loadConfig,
  setGit,
  setProjectGit,
  writeConfig,
} from "../config.ts";

const AGENT_NAMES = ["claude", "codex", "cursor", "opencode"] as const;

const USAGE = `Usage: jarvis config <subcommand> [args]

Subcommands:
  show                       Print the current config as JSON.
  path                       Print the absolute path of config.json.
  set-patch-order <a,b,c>    Replace modes.patch.agentOrder.
  set-plan-order <a,b,c>     Replace modes.plan.agentOrder.
  set-git <true|false>       Set the top-level git toggle.
  set-project-git <name> <true|false|unset>
                             Set or clear the per-project git override.
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

function parseOrder(raw: string, command: string): AgentName[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error(`${command}: expected a non-empty comma-separated list`);
  }
  const seen = new Set<string>();
  const order: AgentName[] = [];
  for (const p of parts) {
    if (!(AGENT_NAMES as readonly string[]).includes(p)) {
      throw new Error(
        `${command}: unknown agent ${JSON.stringify(p)} (allowed: ${AGENT_NAMES.join(", ")})`,
      );
    }
    if (seen.has(p)) {
      throw new Error(`${command}: duplicate agent ${JSON.stringify(p)}`);
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
      io.stdout(
        `modes.patch.agentOrder: ${cfg.modes.patch.agentOrder.join(", ")}\n`,
      );
      io.stdout(
        `modes.plan.agentOrder: ${cfg.modes.plan.agentOrder.join(", ")}\n`,
      );
      return 0;
    }
    case "path": {
      io.stdout(`${configPath(opts.config)}\n`);
      return 0;
    }
    case "set-patch-order": {
      const arg = rest[0];
      if (arg === undefined) {
        io.stderr("jarvis: set-patch-order: missing <agent,agent,agent>\n");
        return 1;
      }
      let order: AgentName[];
      try {
        order = parseOrder(arg, "set-patch-order");
      } catch (err) {
        io.stderr(`jarvis: ${(err as Error).message}\n`);
        return 1;
      }
      const cfg = loadConfig(opts.config);
      cfg.modes.patch.agentOrder = order;
      writeConfig(cfg, opts.config);
      io.stdout(`modes.patch.agentOrder: ${order.join(", ")}\n`);
      return 0;
    }
    case "set-plan-order": {
      const arg = rest[0];
      if (arg === undefined) {
        io.stderr("jarvis: set-plan-order: missing <agent,agent,agent>\n");
        return 1;
      }
      let order: AgentName[];
      try {
        order = parseOrder(arg, "set-plan-order");
      } catch (err) {
        io.stderr(`jarvis: ${(err as Error).message}\n`);
        return 1;
      }
      const cfg = loadConfig(opts.config);
      cfg.modes.plan.agentOrder = order;
      writeConfig(cfg, opts.config);
      io.stdout(`modes.plan.agentOrder: ${order.join(", ")}\n`);
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
    case "set-git": {
      const arg = rest[0];
      if (arg === undefined) {
        io.stderr("jarvis: set-git: missing <true|false>\n");
        return 1;
      }
      if (arg !== "true" && arg !== "false") {
        io.stderr(
          `jarvis: set-git: expected true or false (got ${JSON.stringify(arg)})\n`,
        );
        return 1;
      }
      const value = arg === "true";
      setGit(value, opts.config);
      io.stdout(`git: ${value}\n`);
      return 0;
    }
    case "set-project-git": {
      const name = rest[0];
      const valueArg = rest[1];
      if (name === undefined || valueArg === undefined) {
        io.stderr(
          "jarvis: set-project-git: missing <name> <true|false|unset>\n",
        );
        return 1;
      }
      if (valueArg !== "true" && valueArg !== "false" && valueArg !== "unset") {
        io.stderr(
          `jarvis: set-project-git: expected true, false, or unset (got ${JSON.stringify(valueArg)})\n`,
        );
        return 1;
      }
      const cfg = loadConfig(opts.config);
      if (cfg.projects[name] === undefined) {
        io.stderr(
          `jarvis: set-project-git: unknown project ${JSON.stringify(name)}\n`,
        );
        return 1;
      }
      const next = valueArg === "unset" ? undefined : valueArg === "true";
      try {
        setProjectGit(name, next, opts.config);
      } catch (err) {
        io.stderr(`jarvis: ${(err as Error).message}\n`);
        return 1;
      }
      io.stdout(
        next === undefined
          ? `project ${JSON.stringify(name)}: git override cleared\n`
          : `project ${JSON.stringify(name)}: git=${next}\n`,
      );
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
