export type AgentName = "claude" | "codex" | "cursor" | "opencode";

export type AgentResult =
  | { kind: "ok"; stdout: string; stderr: string }
  | { kind: "quota"; stderr: string }
  | { kind: "model_config"; stderr: string }
  | { kind: "error"; exitCode: number; stderr: string };

export type AgentRunOptions = {
  cwd: string;
  additionalReadDirs?: string[];
};

export interface Agent {
  name: AgentName;
  run(prompt: string, opts: AgentRunOptions): Promise<AgentResult>;
  attributionLabel(): string;
}
