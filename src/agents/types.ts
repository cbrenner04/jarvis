export type AgentName = "claude" | "codex" | "cursor" | "opencode";

export type AgentResult =
  | {
      kind: "ok";
      stdout: string;
      stderr: string;
      usage?: {
        input_tokens: number | null;
        output_tokens: number | null;
        cache_read_input_tokens: number | null;
        cache_creation_input_tokens: number | null;
      };
      cost_usd?: number | null;
      cost_source?: "agent" | "computed" | "no-price" | "no-usage";
      warnings?: string[];
    }
  | { kind: "quota"; stderr: string }
  | { kind: "model_config"; stderr: string }
  | { kind: "error"; exitCode: number; stderr: string };

export type AgentRunOptions = {
  cwd: string;
  additionalReadDirs?: string[];
  signal?: AbortSignal;
};

export interface Agent {
  name: AgentName;
  run(prompt: string, opts: AgentRunOptions): Promise<AgentResult>;
  attributionLabel(): string;
}
