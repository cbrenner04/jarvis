// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Permission handling: configured in ~/.config/opencode/opencode.json (see
// spec/2026-05-11-opencode-as-agent/04-opencode-permission-stanza.md). Jarvis does not
// pass --dangerously-skip-permissions.
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { runAgent } from "./spawn.ts";
import { type EstimatedTokenUsage, estimateTokenUsage } from "./token-estimation.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "./types.ts";

export interface ParsedOpencodeJsonStream {
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  costUsd: number;
  sawStepFinish: boolean;
  sawAnyCostField: boolean;
  renderedText: string;
  warnings: string[];
}

export type OpencodeAgentOptions = {
  binary?: string;
  model: string;
  estimateUsage?: (args: { prompt: string; stdout: string }) => EstimatedTokenUsage | null;
  spawn?: (binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess;
};

const OPENCODE_MODEL_LABELS: Record<string, string> = {};

export const OPENCODE_HAS_PRICED_MODELS = true;

export function parseOpencodeJsonStream(stdout: string): ParsedOpencodeJsonStream {
  const lines = stdout.split("\n");
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  let costUsd = 0;
  let sawStepFinish = false;
  let sawAnyCostField = false;
  let sawAnyCleanStepFinish = false;
  const renderedTextParts: string[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty lines are skipped in event processing but don't count as non-JSON pass-through
    if (trimmed === "") {
      continue;
    }

    // Try to parse as JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Not valid JSON, add as pass-through to rendered text
      renderedTextParts.push(line);
      continue;
    }

    // Check if it's a plain object with a string type field
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      // Arrays, numbers, strings, null at top level are pass-through
      renderedTextParts.push(line);
      continue;
    }

    const event = parsed as Record<string, unknown>;
    if (typeof event.type !== "string") {
      // Not a valid event, treat as pass-through
      renderedTextParts.push(line);
      continue;
    }

    // It's a valid JSON event
    if (event.type === "step_finish") {
      // Extract part.tokens and part.cost
      const part = event.part as Record<string, unknown> | undefined;
      if (!part || typeof part !== "object") {
        continue;
      }

      const tokens = part.tokens as Record<string, unknown> | undefined;
      if (!tokens || typeof tokens !== "object") {
        continue;
      }

      // Check if all required token fields are present and numeric
      const inputTokens = tokens.input;
      const outputTokens = tokens.output;
      const cacheObj = tokens.cache as Record<string, unknown> | undefined;

      if (
        typeof inputTokens !== "number" ||
        typeof outputTokens !== "number" ||
        !cacheObj ||
        typeof cacheObj !== "object"
      ) {
        // Malformed step_finish, skip it
        continue;
      }

      const cacheRead = cacheObj.read;
      const cacheWrite = cacheObj.write;

      if (typeof cacheRead !== "number" || typeof cacheWrite !== "number") {
        // Malformed step_finish, skip it
        continue;
      }

      // This step_finish is clean, accumulate it
      usage.input_tokens += inputTokens;
      usage.output_tokens += outputTokens;
      usage.cache_read_input_tokens += cacheRead;
      usage.cache_creation_input_tokens += cacheWrite;
      sawAnyCleanStepFinish = true;

      // Check for cost field
      const cost = part.cost;
      if (typeof cost === "number") {
        costUsd += cost;
        sawAnyCostField = true;
      }
    } else if (event.type === "text") {
      // Render text part if present
      const part = event.part as Record<string, unknown> | undefined;
      if (part && typeof part === "object") {
        const text = part.text;
        if (typeof text === "string") {
          renderedTextParts.push(text);
        }
      }
    }
    // Other event types (step_start, tool parts, etc.) are ignored
  }

  // Set sawStepFinish only if at least one step_finish was clean
  sawStepFinish = sawAnyCleanStepFinish;

  return {
    usage,
    costUsd,
    sawStepFinish,
    sawAnyCostField,
    renderedText: renderedTextParts.join(""),
    warnings,
  };
}

export function resolveOpencodePriceKey(model: string | undefined): string | null {
  return model ?? null;
}

export class OpencodeAgent implements Agent {
  readonly name = "opencode" as AgentName;
  readonly #binary: string;
  readonly #model: string;
  readonly #estimateUsage: (args: { prompt: string; stdout: string }) => EstimatedTokenUsage | null;
  readonly #spawn: ((binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess) | undefined;

  constructor(opts: OpencodeAgentOptions) {
    this.#binary = opts.binary ?? "opencode";
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
        return ["run", "--dir", buildOpts.cwd, "--model", this.#model, "--format", "json", prompt];
      },
      stdio: ["ignore", "pipe", "pipe"],
      streamErrorPrefix: "opencode:",
    };
    if (this.#spawn !== undefined) {
      config.spawn = this.#spawn;
    }
    const result = await runAgent(config, prompt, opts);

    if (result.kind !== "ok") {
      return result;
    }

    // Parse the JSON stream
    const parsed = parseOpencodeJsonStream(result.stdout);

    // Case A: At least one step_finish was observed and accumulated cleanly
    if (parsed.sawStepFinish) {
      if (parsed.sawAnyCostField) {
        return {
          ...result,
          stdout: parsed.renderedText,
          usage: parsed.usage,
          usage_source: "agent",
          cost_usd: parsed.costUsd,
          cost_source: "agent",
          ...(parsed.warnings.length > 0 && { warnings: parsed.warnings }),
        };
      } else {
        return {
          ...result,
          stdout: parsed.renderedText,
          usage: parsed.usage,
          usage_source: "agent",
          cost_usd: null,
          cost_source: "no-price",
          ...(parsed.warnings.length > 0 && { warnings: parsed.warnings }),
        };
      }
    }

    // Case B: No step_finish was observed, try the estimator
    const estimated = this.#estimateUsage({
      prompt,
      stdout: result.stdout,
    });

    if (estimated !== null) {
      // Fallback to estimator succeeded
      return {
        ...result,
        stdout: parsed.renderedText,
        usage: estimated,
        usage_source: "estimated",
        warnings: [
          ...(result.warnings ?? []),
          "opencode: no step_finish events in --format json stream; falling back to token estimation.",
        ],
      };
    }

    // Case C: No step_finish was observed and estimator also failed
    return {
      ...result,
      usage_source: "unavailable",
      cost_source: "no-usage",
      warnings: [...(result.warnings ?? []), "opencode: token estimator unavailable; usage recorded as unavailable."],
    };
  }

  attributionLabel(): string {
    return OPENCODE_MODEL_LABELS[this.#model] ?? this.#model;
  }
}
