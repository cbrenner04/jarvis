// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Permission handling: configured in ~/.config/opencode/opencode.json (see
// spec/2026-05-11-opencode-as-agent/04-opencode-permission-stanza.md). Jarvis does not
// pass --dangerously-skip-permissions.
import { runAgent } from "./spawn.ts";
import type {
  Agent,
  AgentName,
  AgentResult,
  AgentRunOptions,
} from "./types.ts";

export type OpencodeAgentOptions = {
  binary?: string;
  model: string;
};

const OPENCODE_MODEL_LABELS: Record<string, string> = {};

export class OpencodeAgent implements Agent {
  readonly name = "opencode" as AgentName;
  readonly #binary: string;
  readonly #model: string;

  constructor(opts: OpencodeAgentOptions) {
    this.#binary = opts.binary ?? "opencode";
    this.#model = opts.model;
  }

  run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    return runAgent(
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
  }

  attributionLabel(): string {
    return OPENCODE_MODEL_LABELS[this.#model] ?? this.#model;
  }
}
