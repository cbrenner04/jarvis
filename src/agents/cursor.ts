// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Permission flags: --force (see spec/2026-05-11-permissions/03-cursor-flags.md).
// Invokes the `cursor` CLI in non-interactive print mode:
// `cursor agent -p --output-format text --workspace <cwd> "<prompt>"`.
// `-p`/`--print` is headless mode with full tool access; `--output-format text`
// matches Claude-style transcript output (see `cursor agent --help`);
// `--workspace` sets the working directory; the prompt is the trailing positional.
import { runAgent } from "./spawn.ts";
import type { Agent, AgentResult, AgentRunOptions } from "./types.ts";

export type CursorAgentOptions = {
  binary?: string;
  model?: string;
};

const CURSOR_MODEL_LABELS: Record<string, string> = {};

export class CursorAgent implements Agent {
  readonly name = "cursor" as const;
  readonly #binary: string;
  readonly #model: string | undefined;

  constructor(opts: CursorAgentOptions = {}) {
    this.#binary = opts.binary ?? "cursor";
    this.#model = opts.model;
  }

  run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    return runAgent(
      {
        name: this.name,
        binary: this.#binary,
        cwd: opts.cwd,
        buildArgv: (prompt, opts) => {
          const argv = ["agent", "-p", "--output-format", "text"];
          if (this.#model !== undefined) {
            argv.push("--model", this.#model);
          }
          argv.push("--force", "--workspace", opts.cwd, prompt);
          return argv;
        },
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "cursor:",
      },
      prompt,
      opts,
    );
  }

  attributionLabel(): string {
    if (this.#model === undefined) {
      return "cursor (default model)";
    }
    return CURSOR_MODEL_LABELS[this.#model] ?? this.#model;
  }
}
