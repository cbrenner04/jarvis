// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Sandbox flags: --sandbox workspace-write -c approval_policy="on-request"
// (see spec/2026-05-11-permissions/02-codex-flags.md).
// Invokes the `codex` CLI in non-interactive exec mode: `codex exec` with the
// prompt piped on stdin. Stdin is used (instead of an argv positional) so the
// prompt size is not bounded by the OS argv limit; `codex exec` reads the
// prompt from stdin when none is supplied positionally. Quota detection is
// handled after process exit.
//
// `--color never`: documented on `codex exec --help`; disables ANSI so session
// logs match Claude/Cursor-style plain text more closely.

import type { ChildProcess, SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { computeCost } from "../prices/cost.ts";
import { loadPrices } from "../prices/load.ts";
import { getCodexSessionsDir, resolveCodexSessionUsage, snapshotCodexSessionFiles } from "./codex-session.ts";
import { runAgent } from "./spawn.ts";
import type { Agent, AgentResult, AgentRunOptions } from "./types.ts";

export type CodexAgentOptions = {
  binary?: string;
  model?: string;
  spawn?: (binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess;
};

const CODEX_MODEL_LABELS: Record<string, string> = {};

const CODEX_PRICE_KEYS: Record<string, string> = {
  "gpt-5.3-codex": "gpt-5.3-codex",
  "gpt-5.6-sol": "gpt-5.6-sol",
  "gpt-5.6-terra": "gpt-5.6-terra",
  "gpt-5.6-luna": "gpt-5.6-luna",
  "gpt-5.5": "gpt-5.5",
  "gpt-5.4": "gpt-5.4",
  "gpt-5.4-mini": "gpt-5.4-mini",
};

export const CODEX_HAS_PRICED_MODELS = true;

export function resolveCodexPriceKey(model: string | undefined): string | null {
  if (model === undefined) return null;
  return CODEX_PRICE_KEYS[model] ?? null;
}

export class CodexAgent implements Agent {
  readonly name = "codex" as const;
  readonly #binary: string;
  readonly #model: string | undefined;
  readonly #spawn: ((binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess) | undefined;

  constructor(opts: CodexAgentOptions = {}) {
    this.#binary = opts.binary ?? "codex";
    this.#model = opts.model;
    this.#spawn = opts.spawn;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    const sessionsDir = getCodexSessionsDir();
    const beforeSnapshot = snapshotCodexSessionFiles(sessionsDir);
    const invocationId = randomUUID();
    const invocationMarker = `<!-- jarvis-codex-invocation: ${invocationId} -->`;
    const augmentedPrompt = `${prompt}\n${invocationMarker}`;

    const config: Parameters<typeof runAgent>[0] = {
      name: this.name,
      binary: this.#binary,
      cwd: opts.cwd,
      buildArgv: (_prompt, opts) => {
        const argv = ["exec", "--color", "never", "--sandbox", "workspace-write", "-c", 'approval_policy="on-request"'];
        for (const dir of opts.additionalReadDirs ?? []) {
          argv.push("--add-dir", dir);
        }
        if (this.#model !== undefined) {
          argv.push("--model", this.#model);
        }
        return argv;
      },
      stdio: ["pipe", "pipe", "pipe"],
      writeStdin: (stdin, piped) => {
        stdin.write(piped);
        stdin.end();
      },
      streamErrorPrefix: "codex:",
    };
    if (this.#spawn !== undefined) {
      config.spawn = this.#spawn;
    }
    const result = await runAgent(config, augmentedPrompt, opts);

    if (result.kind !== "ok") {
      return result;
    }

    const resolved = resolveCodexSessionUsage({
      sessionsDir,
      beforeSnapshot,
      invocationMarker,
      cwd: opts.cwd,
    });

    const output: AgentResult = { ...result };

    if (resolved.sessionFile === null) {
      output.usage_source = "unavailable";
      output.cost_usd = null;
      output.cost_source = "no-usage";
      output.warnings = resolved.warnings;
      return output;
    }

    if (resolved.usage !== null) {
      output.usage = resolved.usage;
      const priceKey = resolveCodexPriceKey(this.#model);
      if (priceKey === null) {
        output.cost_usd = null;
        output.cost_source = "no-price";
      } else {
        try {
          const prices = loadPrices();
          const computed = computeCost(resolved.usage, priceKey, prices);
          output.cost_usd = computed.cost_usd;
          output.cost_source = computed.cost_source ?? "computed";
        } catch {
          // best-effort: telemetry still records usage without cost
        }
      }
    }

    if (resolved.warnings.length > 0) {
      output.warnings = resolved.warnings;
    }
    return output;
  }

  attributionLabel(): string {
    if (this.#model === undefined) {
      return "codex (default model)";
    }
    return CODEX_MODEL_LABELS[this.#model] ?? this.#model;
  }
}
