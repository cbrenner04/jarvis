// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Aider runs non-interactively with --yes-always; auto-commits are disabled so
// jarvis remains the sole committer in the worktree.
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

export type AiderAgentOptions = {
  binary?: string;
  model: string;
  estimateUsage?: (args: {
    prompt: string;
    stdout: string;
  }) => EstimatedTokenUsage | null;
};

const AIDER_MODEL_LABELS: Record<string, string> = {};

export const AIDER_HAS_PRICED_MODELS = false;

export function resolveAiderPriceKey(
  _model: string | undefined,
): string | null {
  return null;
}

export class AiderAgent implements Agent {
  readonly name = "aider" as AgentName;
  readonly #binary: string;
  readonly #model: string;
  readonly #estimateUsage: (args: {
    prompt: string;
    stdout: string;
  }) => EstimatedTokenUsage | null;

  constructor(opts: AiderAgentOptions) {
    this.#binary = opts.binary ?? "aider";
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
          const argv = [
            "--message",
            prompt,
            "--model",
            this.#model,
            "--yes-always",
            "--no-auto-commits",
            "--no-git",
            "--no-stream",
          ];
          for (const dir of buildOpts.additionalReadDirs ?? []) {
            argv.push(dir);
          }
          return argv;
        },
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "aider:",
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
          "aider: token estimator unavailable; usage recorded as unavailable.",
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
    return AIDER_MODEL_LABELS[this.#model] ?? this.#model;
  }
}
