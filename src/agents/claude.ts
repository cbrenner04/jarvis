// Invokes the `claude` CLI in non-interactive print mode: `claude -p` with the
// prompt piped on stdin. Stdin is used (instead of an argv positional) so the
// prompt size is not bounded by the OS argv limit. Default `--output-format` with
// `-p` is already plain text (`claude --help`); no extra verbosity flags.
import { spawn } from "node:child_process";
import { isModelConfigurationSignal, isQuotaSignal } from "./quota.ts";
import type { Agent, AgentResult } from "./types.ts";

export type ClaudeAgentOptions = {
  binary?: string;
  model?: string;
};

export class ClaudeAgent implements Agent {
  readonly name = "claude" as const;
  readonly #binary: string;
  readonly #model: string | undefined;

  constructor(opts: ClaudeAgentOptions = {}) {
    this.#binary = opts.binary ?? "claude";
    this.#model = opts.model;
  }

  run(prompt: string, opts: { cwd: string }): Promise<AgentResult> {
    return new Promise((resolvePromise) => {
      const argv = ["-p"];
      if (this.#model !== undefined) {
        argv.push("--model", this.#model);
      }
      const child = spawn(this.#binary, argv, {
        cwd: opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdin = child.stdin;
      const stdout = child.stdout;
      const stderr = child.stderr;
      if (stdin === null || stdout === null || stderr === null) {
        resolvePromise({
          kind: "error",
          exitCode: -1,
          stderr: "claude: failed to open child process streams",
        });
        return;
      }

      let outBuf = "";
      let errBuf = "";
      let settled = false;
      const settle = (r: AgentResult) => {
        if (settled) return;
        settled = true;
        resolvePromise(r);
      };

      stdout.on("data", (chunk: Buffer) => {
        outBuf += chunk.toString("utf8");
      });
      stderr.on("data", (chunk: Buffer) => {
        errBuf += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        settle({
          kind: "error",
          exitCode: -1,
          stderr: `${errBuf}${String(err)}`,
        });
      });
      child.on("close", (code) => {
        if (code === 0) {
          settle({ kind: "ok", stdout: outBuf, stderr: errBuf });
          return;
        }
        const exitCode = code ?? -1;
        const diagnostics = `${errBuf}${outBuf}`;
        if (isModelConfigurationSignal(diagnostics)) {
          settle({ kind: "model_config", stderr: diagnostics });
          return;
        }
        if (isQuotaSignal(this.name, exitCode, diagnostics)) {
          settle({ kind: "quota", stderr: diagnostics });
          return;
        }
        settle({ kind: "error", exitCode, stderr: diagnostics });
      });

      stdin.write(prompt);
      stdin.end();
    });
  }
}
