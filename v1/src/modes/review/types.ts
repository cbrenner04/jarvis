import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentEntry } from "../../config.ts";

/** Terminal outcome for one shared review attempt. */
export type ReviewAttemptOutcome = "ok" | "blocked" | "quota" | "model_config" | "error";

/** Debate role for one review attempt. */
export type ReviewRole = "adversary" | "defender" | "judge";

/** Shared pass metadata exposed to adapters and telemetry hooks. */
export type ReviewPassContext = {
  passNumber: number;
  totalPasses: number;
  role?: ReviewRole | undefined;
  priorArtifact?: string | undefined;
  priorVerdict?: string | undefined;
};

/** Metadata for one review agent attempt. */
export type ReviewAttemptContext = ReviewPassContext & {
  agent: Agent;
  agentEntry: AgentEntry;
  agentLabel: string;
  prompt: string;
  durationMs: number;
  result: AgentResult;
};

/** Common attempt telemetry payload owned by the shared runner. */
export type ReviewTelemetryEvent = ReviewAttemptContext & {
  outcome: ReviewAttemptOutcome;
  exitCode?: number;
};

/** Adapter-thrown error that maps to a harness exit code. */
export class ReviewTerminalError extends Error {
  readonly exitCode: number;
  /** When true, the adapter already recorded telemetry for this failure. */
  readonly telemetryRecorded?: boolean | undefined;

  constructor(message: string, exitCode: number, opts?: { telemetryRecorded?: boolean }) {
    super(message);
    this.exitCode = exitCode;
    this.telemetryRecorded = opts?.telemetryRecorded;
  }
}

/** Review-mode adapter contract. */
export interface ReviewAdapter {
  /** Build the prompt for one review attempt. */
  buildPrompt(ctx: ReviewPassContext & { agentEntry: AgentEntry }): string | Promise<string>;
  /** Enforce the mode-specific write boundary after a successful agent run. */
  enforceWriteBoundary(ctx: ReviewAttemptContext): void | Promise<void>;
  /** Read the mode-specific blocker source after boundary enforcement. */
  readBlocker(ctx: ReviewAttemptContext): string | null | Promise<string | null>;
  /** Handle a detected blocker and return the review exit code. */
  handleBlocker(ctx: ReviewAttemptContext & { blocker: string }): number | Promise<number>;
  /** Commit or otherwise persist a successful attempt. */
  commitPass(ctx: ReviewAttemptContext): void | Promise<void>;
  /** Record one review attempt in mode-specific telemetry. */
  recordTelemetry(event: ReviewTelemetryEvent): void | Promise<void>;
}
