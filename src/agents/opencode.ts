// Permission posture: safe-edits (see spec/permissions/00-default-posture.md).
// Permission handling: configured in ~/.config/opencode/opencode.json (see
// spec/opencode-as-agent/04-opencode-permission-stanza.md). Jarvis does not
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
        buildArgv: (prompt) => {
          return ["run", "--model", this.#model, "--format", "default", prompt];
        },
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "opencode:",
      },
      prompt,
      opts,
    );
  }
}
