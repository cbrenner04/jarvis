import { OpencodeAgent } from "./opencode.ts";
import type { Agent, AgentName, AgentResult } from "./types.ts";

export type AirProxyAgentOptions = {
  binary?: string;
  model: string;
};

export class AirProxyAgent implements Agent {
  readonly name = "airproxy" as AgentName;
  readonly #inner: OpencodeAgent;

  constructor(opts: AirProxyAgentOptions) {
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
