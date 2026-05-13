// Permission posture: safe-edits (see spec/permissions/00-default-posture.md).
// Permission flags: --permission-mode acceptEdits (see spec/permissions/01-claude-flags.md).
// Invokes the `claude` CLI in non-interactive print mode: `claude -p` with the
// prompt piped on stdin. Stdin is used (instead of an argv positional) so the
// prompt size is not bounded by the OS argv limit. Default `--output-format` with
// `-p` is already plain text (`claude --help`); no extra verbosity flags.
import { runAgent } from "./spawn.ts";
import type { Agent, AgentResult, AgentRunOptions } from "./types.ts";

export type ClaudeAgentOptions = {
  binary?: string;
  model?: string;
};

const CLAUDE_MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
};

export class ClaudeAgent implements Agent {
  readonly name = "claude" as const;
  readonly #binary: string;
  readonly #model: string | undefined;

  constructor(opts: ClaudeAgentOptions = {}) {
    this.#binary = opts.binary ?? "claude";
    this.#model = opts.model;
  }

  run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    return runAgent(
      {
        name: this.name,
        binary: this.#binary,
        cwd: opts.cwd,
        buildArgv: (_prompt, opts) => {
          const argv = ["-p", "--permission-mode", "acceptEdits"];
          for (const dir of opts.additionalReadDirs ?? []) {
            argv.push("--add-dir", dir);
          }
          if (this.#model !== undefined) {
            argv.push("--model", this.#model);
          }
          return argv;
        },
        stdio: ["pipe", "pipe", "pipe"],
        writeStdin: (stdin, prompt) => {
          stdin.write(prompt);
          stdin.end();
        },
        streamErrorPrefix: "claude:",
      },
      prompt,
      opts,
    );
  }

  attributionLabel(): string {
    if (this.#model === undefined) {
      return "claude (default model)";
    }
    return CLAUDE_MODEL_LABELS[this.#model] ?? this.#model;
  }
}
