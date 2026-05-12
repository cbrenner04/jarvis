// Permission posture: safe-edits (see spec/permissions/00-default-posture.md).
// Sandbox flags: --sandbox workspace-write -c approval_policy="on-request"
// (see spec/permissions/02-codex-flags.md).
// Invokes the `codex` CLI in non-interactive exec mode: `codex exec` with the
// prompt piped on stdin. Stdin is used (instead of an argv positional) so the
// prompt size is not bounded by the OS argv limit; `codex exec` reads the
// prompt from stdin when none is supplied positionally. Quota detection is
// handled after process exit.
//
// `--color never`: documented on `codex exec --help`; disables ANSI so session
// logs match Claude/Cursor-style plain text more closely.
import { runAgent } from "./spawn.ts";
import type { Agent, AgentResult, AgentRunOptions } from "./types.ts";

export type CodexAgentOptions = {
  binary?: string;
  model?: string;
};

export class CodexAgent implements Agent {
  readonly name = "codex" as const;
  readonly #binary: string;
  readonly #model: string | undefined;

  constructor(opts: CodexAgentOptions = {}) {
    this.#binary = opts.binary ?? "codex";
    this.#model = opts.model;
  }

  run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    return runAgent(
      {
        name: this.name,
        binary: this.#binary,
        cwd: opts.cwd,
        buildArgv: (_prompt, _opts) => {
          const argv = [
            "exec",
            "--color",
            "never",
            "--sandbox",
            "workspace-write",
            "-c",
            'approval_policy="on-request"',
          ];
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
        streamErrorPrefix: "codex:",
      },
      prompt,
      opts,
    );
  }
}
