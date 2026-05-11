export type AgentName = "claude" | "codex" | "cursor";

export type AgentResult =
  | { kind: "ok"; stdout: string; stderr: string }
  | { kind: "quota"; stderr: string }
  | { kind: "model_config"; stderr: string }
  | { kind: "error"; exitCode: number; stderr: string };

export interface Agent {
  name: AgentName;
  run(prompt: string, opts: { cwd: string }): Promise<AgentResult>;
}
