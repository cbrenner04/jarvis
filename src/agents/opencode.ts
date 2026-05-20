// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Permission handling: configured in ~/.config/opencode/opencode.json (see
// spec/2026-05-11-opencode-as-agent/04-opencode-permission-stanza.md). Jarvis does not
// pass --dangerously-skip-permissions.
import { runAgent } from "./spawn.ts";
import {
  estimateTokenUsage,
  type EstimatedTokenUsage,
} from "./token-estimation.ts";
import type {
  Agent,
  AgentName,
  AgentResult,
  AgentRunOptions,
} from "./types.ts";

export type OpencodeAgentOptions = {
  binary?: string;
  model: string;
  estimateUsage?: (args: {
    prompt: string;
    stdout: string;
  }) => EstimatedTokenUsage | null;
};

const OPENCODE_MODEL_LABELS: Record<string, string> = {};

export const OPENCODE_HAS_PRICED_MODELS = true;

export function resolveOpencodePriceKey(
  model: string | undefined,
): string | null {
  return model ?? null;
}

export class OpencodeAgent implements Agent {
  readonly name = "opencode" as AgentName;
  readonly #binary: string;
  readonly #model: string;
  readonly #estimateUsage: (args: {
    prompt: string;
    stdout: string;
  }) => EstimatedTokenUsage | null;

  constructor(opts: OpencodeAgentOptions) {
    this.#binary = opts.binary ?? "opencode";
    this.#model = opts.model;
    this.#estimateUsage = opts.estimateUsage ?? estimateTokenUsage;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    const result = await runAgent(
      {
        name: this.name,
        binary: this.#binary,
        cwd: opts.cwd,
        buildArgv: (prompt, buildOpts) => {
          return [
            "run",
            "--dir",
            buildOpts.cwd,
            "--model",
            this.#model,
            "--format",
            "default",
            prompt,
          ];
        },
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "opencode:",
      },
      prompt,
      opts,
    );

    if (result.kind !== "ok") {
      return result;
    }

    const estimated = this.#estimateUsage({
      prompt,
      stdout: result.stdout,
    });
    if (estimated === null) {
      return {
        ...result,
        usage_source: "unavailable",
        cost_source: "no-usage",
        warnings: [
          ...(result.warnings ?? []),
          "opencode: token estimator unavailable; usage recorded as unavailable.",
        ],
      };
    }
    return {
      ...result,
      usage: estimated,
      usage_source: "estimated",
    };
  }

  attributionLabel(): string {
    return OPENCODE_MODEL_LABELS[this.#model] ?? this.#model;
  }
}
