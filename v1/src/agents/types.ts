export type AgentName = "claude" | "codex" | "cursor" | "opencode";

export type AgentResult =
  | {
      kind: "ok";
      stdout: string;
      stderr: string;
      usage_source?: "agent" | "estimated" | "unavailable";
      usage?: {
        input_tokens: number | null;
        output_tokens: number | null;
        cache_read_input_tokens: number | null;
        cache_creation_input_tokens: number | null;
      };
      cost_usd?: number | null;
      cost_source?: "agent" | "computed" | "estimated" | "no-price" | "no-usage";
      warnings?: string[];
    }
  | { kind: "quota"; stderr: string; authFailure?: true }
  | { kind: "model_config"; stderr: string }
  | { kind: "error"; exitCode: number; stderr: string };

export type AgentRunOptions = {
  cwd: string;
  additionalReadDirs?: string[];
  signal?: AbortSignal;
  onSpawned?: (child: { pid: number }) => void;
  abortKillGraceMs?: number;
  /**
   * Caller-owned ref updated on every stdout/stderr `data` chunk during spawn.
   * Initialize `current` to `null` before each `agent.run`; patch mode snapshots
   * ms-since-last-output at watchdog fire from this ref (not a live re-read).
   */
  lastOutputAtMs?: { current: number | null };
  /**
   * Timestamp source paired with `lastOutputAtMs` updates.
   * Defaults to `Date.now`. Patch mode's watchdog timing test seam injects this
   * so observed stdout/stderr and watchdog snapshots share one clock.
   */
  lastOutputNowMs?: () => number;
  onTransientRetry?: (info: { attempt: number; cap: number; agent: AgentName; exitCode: number }) => void;
  /**
   * Injectable async sleep for backoff between transient retry attempts.
   * Called with (delayMs, signal) and should resolve when the delay elapses
   * or the signal aborts. Defaults to a promise-based sleep.
   */
  sleepMs?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
};

export interface Agent {
  name: AgentName;
  run(prompt: string, opts: AgentRunOptions): Promise<AgentResult>;
  attributionLabel(): string;
}
