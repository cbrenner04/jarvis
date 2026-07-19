import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatConnectionError } from "../cli/ipc.ts";
import { CONFIG_USAGE } from "../cli/usage.ts";
import { loadMachineConfig, readMachineConfigDocument } from "../config/machine-config-loader.ts";

/** Sole validation for set-agents input: CSV shape first, then duplicates. Entries are
 * non-empty trimmed strings by construction, so the machine-config validator is not re-run. */
function parseSetAgentsCsv(raw: string): { ok: true; agents: string[] } | { ok: false; message: string } {
  const agents = raw.split(",").map((part) => part.trim());
  for (const [i, agent] of agents.entries()) {
    if (agent.length === 0) {
      return { ok: false, message: `Error: invalid agents CSV "${raw}": empty segment at position ${i + 1}\n` };
    }
    if (agent.includes(":")) {
      return { ok: false, message: `Error: invalid agent "${agent}": expected bare agent name\n` };
    }
  }

  const duplicate = agents.find((agent, i) => agents.indexOf(agent) !== i);
  if (duplicate !== undefined) {
    return { ok: false, message: `Machine config 'agents' contains duplicate entry: "${duplicate}"\n` };
  }

  return { ok: true, agents };
}

function writeMachineConfigAgents(configPath: string, agents: readonly string[]): void {
  const existing = readMachineConfigDocument(configPath) ?? {};
  const next = { ...existing, agents: [...agents] };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
}

export async function runConfigCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  if (argv[0] === "show" && argv.length === 1) {
    try {
      const agents = loadMachineConfig(deps.machineConfigPath);
      if (agents === undefined) {
        io.stdout("No machine agent override configured.\n");
        return 0;
      }
      for (const agent of agents) {
        io.stdout(`${agent}\n`);
      }
      return 0;
    } catch (error) {
      io.stderr(formatConnectionError(error));
      return 1;
    }
  }

  if (argv[0] === "path" && argv.length === 1) {
    io.stdout(`${deps.machineConfigPath}\n`);
    return 0;
  }

  const csv = argv[1];
  if (argv[0] !== "set-agents" || argv.length !== 2 || csv === undefined) {
    io.stderr(CONFIG_USAGE);
    return 1;
  }

  const parsed = parseSetAgentsCsv(csv);
  if (!parsed.ok) {
    io.stderr(parsed.message);
    return 1;
  }

  try {
    writeMachineConfigAgents(deps.machineConfigPath, parsed.agents);
  } catch (error) {
    io.stderr(formatConnectionError(error));
    return 1;
  }

  io.stdout(`${JSON.stringify({ agents: parsed.agents })}\n`);
  return 0;
}
