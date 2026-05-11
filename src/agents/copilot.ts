import { OpencodeAgent } from "./opencode.ts";
import type { Agent, AgentName, AgentResult } from "./types.ts";

export type CopilotAgentOptions = {
  binary?: string;
  model: string;
};

export class CopilotAgent implements Agent {
  readonly name = "copilot" as AgentName;
  readonly #inner: OpencodeAgent;

  constructor(opts: CopilotAgentOptions) {
    this.#inner = new OpencodeAgent({
      agentName: this.name,
      model: opts.model,
      ...(opts.binary === undefined ? {} : { binary: opts.binary }),
    });
  }

  run(prompt: string, opts: { cwd: string }): Promise<AgentResult> {
    return this.#inner.run(prompt, opts);
  }
}
