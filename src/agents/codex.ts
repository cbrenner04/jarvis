// Permission posture: safe-edits (see spec/permissions/00-default-posture.md).
// Sandbox flags: --sandbox workspace-write --ask-for-approval on-request (see spec/permissions/02-codex-flags.md).
// Invokes the `codex` CLI in non-interactive exec mode: `codex exec` with the
// prompt piped on stdin. Stdin is used (instead of an argv positional) so the
// prompt size is not bounded by the OS argv limit; `codex exec` reads the
// prompt from stdin when none is supplied positionally. Quota detection is
// handled after process exit.
//
// `--color never`: documented on `codex exec --help`; disables ANSI so session
// logs match Claude/Cursor-style plain text more closely.
import { spawn } from "node:child_process";
import { isModelConfigurationSignal, isQuotaSignal } from "./quota.ts";
import type { Agent, AgentResult } from "./types.ts";

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

  run(prompt: string, opts: { cwd: string }): Promise<AgentResult> {
    return new Promise((resolvePromise) => {
      const argv = [
        "exec",
        "--color",
        "never",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
      ];
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
          stderr: "codex: failed to open child process streams",
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
