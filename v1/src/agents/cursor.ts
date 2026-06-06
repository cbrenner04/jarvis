// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Permission flags: --force (see spec/2026-05-11-permissions/03-cursor-flags.md).
// Invokes the `cursor` CLI in non-interactive print mode:
// `cursor agent -p --output-format text --workspace <cwd> "<prompt>"`.
// `-p`/`--print` is headless mode with full tool access; `--output-format text`
// matches Claude-style transcript output (see `cursor agent --help`);
// `--workspace` sets the working directory; the prompt is the trailing positional.
import { estimateCursorUsage } from "./cursor-tokens.ts";
import { runAgent } from "./spawn.ts";
import type { Agent, AgentResult, AgentRunOptions } from "./types.ts";

export type CursorAgentOptions = {
  binary?: string;
  model?: string;
};

// Cursor's model menu, sourced from https://cursor.com/docs/models-and-pricing.
// Hand-maintained; cursor adds models infrequently. Used as the price-key map
// (identity, since cursor's UI names are the price-table keys) and to surface
// known cursor models to config validation.
const CURSOR_KNOWN_MODELS: readonly string[] = [
  "Composer 2",
  "Composer 2.5",
  "Claude 4 Sonnet",
  "Claude 4.5 Haiku",
  "Claude 4.6 Sonnet",
  "Claude 4.7 Opus",
  "Claude 4.8 Opus",
  "GPT-5.3 Codex",
  "GPT-5.4",
  "GPT-5.5",
  "Gemini 3 Flash",
  "Gemini 3 Pro",
  "Gemini 3.1 Pro",
];

const CURSOR_MODEL_LABELS: Record<string, string> = {};

const CURSOR_PRICE_KEYS: Record<string, string> = Object.fromEntries(CURSOR_KNOWN_MODELS.map((m) => [m, m]));

export const CURSOR_HAS_PRICED_MODELS = true;

export function resolveCursorPriceKey(model: string | undefined): string | null {
  if (model === undefined) return null;
  return CURSOR_PRICE_KEYS[model] ?? null;
}

export class CursorAgent implements Agent {
  readonly name = "cursor" as const;
  readonly #binary: string;
  readonly #model: string | undefined;

  constructor(opts: CursorAgentOptions = {}) {
    this.#binary = opts.binary ?? "cursor";
    this.#model = opts.model;
  }

  run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    return runAgent(
      {
        name: this.name,
        binary: this.#binary,
        cwd: opts.cwd,
        buildArgv: (prompt, opts) => {
          const argv = ["agent", "-p", "--output-format", "text"];
          if (this.#model !== undefined) {
            argv.push("--model", this.#model);
          }
          argv.push("--force", "--workspace", opts.cwd, prompt);
          return argv;
        },
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "cursor:",
      },
      prompt,
      opts,
    ).then((result) => {
      if (result.kind !== "ok") {
        return result;
      }
      const estimated = estimateCursorUsage({
        prompt,
        stdout: result.stdout,
      });
      if (estimated === null) {
        return {
          ...result,
          usage_source: "unavailable",
          cost_source: "no-usage",
          warnings: [...(result.warnings ?? []), "cursor: token estimator unavailable; usage recorded as unavailable."],
        };
      }
      return {
        ...result,
        usage: estimated,
        usage_source: "estimated",
      };
    });
  }

  attributionLabel(): string {
    if (this.#model === undefined) {
      return "cursor (default model)";
    }
    return CURSOR_MODEL_LABELS[this.#model] ?? this.#model;
  }
}
