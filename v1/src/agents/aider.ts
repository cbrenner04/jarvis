// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Aider runs non-interactively with --yes-always; auto-commits are disabled so
// jarvis remains the sole committer in the worktree.
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { runAgent } from "./spawn.ts";
import { type EstimatedTokenUsage, estimateTokenUsage } from "./token-estimation.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "./types.ts";

export type AiderAgentOptions = {
  binary?: string;
  model: string;
  estimateUsage?: (args: { prompt: string; stdout: string }) => EstimatedTokenUsage | null;
  spawn?: (binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess;
};

const AIDER_MODEL_LABELS: Record<string, string> = {};

export const AIDER_HAS_PRICED_MODELS = false;

export function resolveAiderPriceKey(_model: string | undefined): string | null {
  return null;
}

export class AiderAgent implements Agent {
  readonly name = "aider" as AgentName;
  readonly #binary: string;
  readonly #model: string;
  readonly #estimateUsage: (args: { prompt: string; stdout: string }) => EstimatedTokenUsage | null;
  readonly #spawn: ((binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess) | undefined;

  constructor(opts: AiderAgentOptions) {
    this.#binary = opts.binary ?? "aider";
    this.#model = opts.model;
    this.#estimateUsage = opts.estimateUsage ?? estimateTokenUsage;
    this.#spawn = opts.spawn;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    const config: Parameters<typeof runAgent>[0] = {
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
          "--no-show-model-warnings",
        ];
        for (const dir of buildOpts.additionalReadDirs ?? []) {
          argv.push(dir);
        }
        return argv;
      },
      stdio: ["ignore", "pipe", "pipe"],
      streamErrorPrefix: "aider:",
      env: { BROWSER: "false" },
    };
    if (this.#spawn !== undefined) {
      config.spawn = this.#spawn;
    }
    const result = await runAgent(config, prompt, opts);

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
        warnings: [...(result.warnings ?? []), "aider: token estimator unavailable; usage recorded as unavailable."],
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
