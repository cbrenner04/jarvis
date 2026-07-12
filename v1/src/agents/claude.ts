// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Permission flags: --permission-mode acceptEdits (see spec/2026-05-11-permissions/01-claude-flags.md).
// Invokes the `claude` CLI in non-interactive print mode: `claude -p` with the
// prompt piped on stdin. Stdin is used (instead of an argv positional) so the
// prompt size is not bounded by the OS argv limit. Stream-json output is always
// used so events arrive during the iteration (idle-watchdog liveness) and
// Claude-reported token usage and cost can be extracted from the terminal result.
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { isClaudeZeroExitQuotaEnvelope, parseClaudeJsonOutput } from "./claude-json.ts";
import { runAgent } from "./spawn.ts";
import type { Agent, AgentResult, AgentRunOptions } from "./types.ts";

export type ClaudeAgentOptions = {
  binary?: string;
  model?: string;
  spawn?: (binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess;
};

const CLAUDE_MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
};

const CLAUDE_PRICE_KEYS: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-opus-4-8": "claude-opus-4-8",
};

export const CLAUDE_HAS_PRICED_MODELS = true;

export function resolveClaudePriceKey(model: string | undefined): string | null {
  if (model === undefined) return null;
  return CLAUDE_PRICE_KEYS[model] ?? null;
}

export class ClaudeAgent implements Agent {
  readonly name = "claude" as const;
  readonly #binary: string;
  readonly #model: string | undefined;
  readonly #spawn: ((binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess) | undefined;

  constructor(opts: ClaudeAgentOptions = {}) {
    this.#binary = opts.binary ?? "claude";
    this.#model = opts.model;
    this.#spawn = opts.spawn;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    const config: Parameters<typeof runAgent>[0] = {
      name: this.name,
      binary: this.#binary,
      cwd: opts.cwd,
      buildArgv: (_prompt, opts) => {
        const argv = ["-p", "--permission-mode", "acceptEdits"];
        for (const dir of opts.additionalReadDirs ?? []) {
          argv.push("--add-dir", dir);
        }
        if (this.#model !== undefined) {
          argv.push("--model", this.#model);
        }
        argv.push("--output-format", "stream-json", "--verbose");
        return argv;
      },
      stdio: ["pipe", "pipe", "pipe"],
      writeStdin: (stdin, prompt) => {
        stdin.write(prompt);
        stdin.end();
      },
      streamErrorPrefix: "claude:",
    };
    if (this.#spawn !== undefined) {
      config.spawn = this.#spawn;
    }
    const result = await runAgent(config, prompt, opts);

    if (result.kind === "ok") {
      if (isClaudeZeroExitQuotaEnvelope(result.stdout)) {
        return { kind: "quota", stderr: result.stdout };
      }

      const parseResult = parseClaudeJsonOutput(result.stdout);
      const output: typeof result = {
        ...result,
        stdout: parseResult.displayText,
      };
      if (parseResult.usage !== null) {
        output.usage = parseResult.usage;
      }
      if (parseResult.cost_usd !== null) {
        output.cost_usd = parseResult.cost_usd;
        output.cost_source = "agent";
      }
      if (parseResult.warnings.length > 0) {
        output.warnings = parseResult.warnings;
      }
      return output;
    }

    return result;
  }

  attributionLabel(): string {
    if (this.#model === undefined) {
      return "claude (default model)";
    }
    return CLAUDE_MODEL_LABELS[this.#model] ?? this.#model;
  }
}
