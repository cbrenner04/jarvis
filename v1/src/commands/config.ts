import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Io } from "../cli.ts";
import {
  type AgentEntry,
  type AgentName,
  CONFIG_PATH,
  type ConfigOptions,
  loadConfig,
  setGit,
  setProjectGit,
  writeConfig,
} from "../config.ts";

const AGENT_NAMES = ["claude", "codex", "cursor", "opencode"] as const;

const USAGE = `Usage: jarvis1 config <subcommand> [args]

Subcommands:
  show                       Print the current config as JSON.
  path                       Print the absolute path of config.json.
  set-patch-order <agent:model,agent:model,...>
                             Replace modes.patch.agentOrder. Each entry is
                             agent:model (e.g. claude:haiku,codex:gpt-5.3-codex).
  set-plan-order <agent:model,agent:model,...>
                             Replace modes.plan.agentOrder. Same syntax as set-patch-order.
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

function parseOrder(raw: string): AgentEntry[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error("expected a non-empty comma-separated list");
  }
  const seen = new Set<string>();
  const order: AgentEntry[] = [];
  for (const p of parts) {
    const colon = p.indexOf(":");
    if (colon === -1) {
      throw new Error(`expected agent:model (got ${JSON.stringify(p)})`);
    }
    const agent = p.slice(0, colon).trim();
    const model = p.slice(colon + 1).trim();
    if (!(AGENT_NAMES as readonly string[]).includes(agent)) {
      throw new Error(`unknown agent ${JSON.stringify(agent)} (allowed: ${AGENT_NAMES.join(", ")})`);
    }
    if (model.length === 0) {
      throw new Error(`agent ${JSON.stringify(agent)}: model must be non-empty`);
    }
    if (seen.has(agent)) {
      throw new Error(`duplicate agent ${JSON.stringify(agent)}`);
    }
    seen.add(agent);
    order.push({ agent: agent as AgentName, model });
  }
  return order;
}

function formatOrder(order: AgentEntry[]): string {
  return order.map((e) => `${e.agent}:${e.model}`).join(", ");
}

function setModeOrder(mode: "patch" | "plan", raw: string, opts: ConfigCommandOptions): void {
  let order: AgentEntry[];
  try {
    order = parseOrder(raw);
  } catch (err) {
    throw new Error(`set-${mode}-order: ${(err as Error).message}`);
  }
  const cfg = loadConfig(opts.config);
  cfg.modes[mode].agentOrder = order;
  writeConfig(cfg, opts.config);
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
    case "set-patch-order": {
      const arg = rest[0];
      if (arg === undefined) {
        io.stderr("jarvis1: set-patch-order: missing <agent:model,agent:model,...>\n");
        return 1;
      }
      try {
        setModeOrder("patch", arg, opts);
        const cfg = loadConfig(opts.config);
        io.stdout(`modes.patch.agentOrder: ${formatOrder(cfg.modes.patch.agentOrder)}\n`);
        return 0;
      } catch (err) {
        io.stderr(`jarvis1: ${(err as Error).message}\n`);
        return 1;
      }
    }
    case "set-plan-order": {
      const arg = rest[0];
      if (arg === undefined) {
        io.stderr("jarvis1: set-plan-order: missing <agent:model,agent:model,...>\n");
        return 1;
      }
      try {
        setModeOrder("plan", arg, opts);
        const cfg = loadConfig(opts.config);
        io.stdout(`modes.plan.agentOrder: ${formatOrder(cfg.modes.plan.agentOrder)}\n`);
        return 0;
      } catch (err) {
        io.stderr(`jarvis1: ${(err as Error).message}\n`);
        return 1;
      }
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
        io.stderr("jarvis1: remove-project: missing <name>\n");
        return 1;
      }
      const cfg = loadConfig(opts.config);
      if (cfg.projects[name] === undefined) {
        io.stderr(`jarvis1: remove-project: unknown project ${JSON.stringify(name)}\n`);
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
        io.stderr("jarvis1: set-git: missing <true|false>\n");
        return 1;
      }
      if (arg !== "true" && arg !== "false") {
        io.stderr(`jarvis1: set-git: expected true or false (got ${JSON.stringify(arg)})\n`);
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
        io.stderr("jarvis1: set-project-git: missing <name> <true|false|unset>\n");
        return 1;
      }
      if (valueArg !== "true" && valueArg !== "false" && valueArg !== "unset") {
        io.stderr(`jarvis1: set-project-git: expected true, false, or unset (got ${JSON.stringify(valueArg)})\n`);
        return 1;
      }
      const cfg = loadConfig(opts.config);
      if (cfg.projects[name] === undefined) {
        io.stderr(`jarvis1: set-project-git: unknown project ${JSON.stringify(name)}\n`);
        return 1;
      }
      const next = valueArg === "unset" ? undefined : valueArg === "true";
      try {
        setProjectGit(name, next, opts.config);
      } catch (err) {
        io.stderr(`jarvis1: ${(err as Error).message}\n`);
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
        io.stderr(`jarvis1: editor exited with status ${status}\n`);
        return 1;
      }
      try {
        loadConfig(opts.config);
      } catch (err) {
        io.stderr(`jarvis1: ${(err as Error).message}\n`);
        return 1;
      }
      return 0;
    }
    default:
      io.stderr(`jarvis1: unknown config subcommand ${JSON.stringify(sub)}\n`);
      io.stderr(USAGE);
      return 1;
  }
}
