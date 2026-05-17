// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Permission flags: --permission-mode acceptEdits (see spec/2026-05-11-permissions/01-claude-flags.md).
// Invokes the `claude` CLI in non-interactive print mode: `claude -p` with the
// prompt piped on stdin. Stdin is used (instead of an argv positional) so the
// prompt size is not bounded by the OS argv limit. Default `--output-format` with
// `-p` is already plain text (`claude --help`); no extra verbosity flags.
import { parseClaudeJsonOutput } from "./claude-json.ts";
import { runAgent } from "./spawn.ts";
import type { Agent, AgentResult, AgentRunOptions } from "./types.ts";

export type ClaudeAgentOptions = {
  binary?: string;
  model?: string;
  outputFormat?: "json" | "text";
};

const CLAUDE_MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
};

const CLAUDE_PRICE_KEYS: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-opus-4-7": "claude-opus-4-7",
};

export const CLAUDE_HAS_PRICED_MODELS = true;

export function resolveClaudePriceKey(
  model: string | undefined,
): string | null {
  if (model === undefined) return null;
  return CLAUDE_PRICE_KEYS[model] ?? null;
}

export class ClaudeAgent implements Agent {
  readonly name = "claude" as const;
  readonly #binary: string;
  readonly #model: string | undefined;
  readonly #outputFormat: "json" | "text";

  constructor(opts: ClaudeAgentOptions = {}) {
    this.#binary = opts.binary ?? "claude";
    this.#model = opts.model;
    this.#outputFormat = opts.outputFormat ?? "json";
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    const result = await runAgent(
      {
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
          if (this.#outputFormat === "json") {
            argv.push("--output-format", "json");
          }
          return argv;
        },
        stdio: ["pipe", "pipe", "pipe"],
        writeStdin: (stdin, prompt) => {
          stdin.write(prompt);
          stdin.end();
        },
        streamErrorPrefix: "claude:",
      },
      prompt,
      opts,
    );

    // If using JSON output format, parse the output
    if (this.#outputFormat === "json" && result.kind === "ok") {
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
