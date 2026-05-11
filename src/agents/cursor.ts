// Invokes the `cursor` CLI in non-interactive print mode:
// `cursor agent -p --output-format text --workspace <cwd> "<prompt>"`.
// `-p`/`--print` is headless mode with full tool access; `--output-format text`
// matches Claude-style transcript output (see `cursor agent --help`);
// `--workspace` sets the working directory; the prompt is the trailing positional.
import { spawn } from "node:child_process";
import { isModelConfigurationSignal, isQuotaSignal } from "./quota.ts";
import type { Agent, AgentResult } from "./types.ts";

export type CursorAgentOptions = {
  binary?: string;
  model?: string;
};

export class CursorAgent implements Agent {
  readonly name = "cursor" as const;
  readonly #binary: string;
  readonly #model: string | undefined;

  constructor(opts: CursorAgentOptions = {}) {
    this.#binary = opts.binary ?? "cursor";
    this.#model = opts.model;
  }

  run(prompt: string, opts: { cwd: string }): Promise<AgentResult> {
    return new Promise((resolvePromise) => {
      const argv = ["agent", "-p", "--output-format", "text"];
      if (this.#model !== undefined) {
        argv.push("--model", this.#model);
      }
      argv.push("--workspace", opts.cwd, prompt);
      const child = spawn(this.#binary, argv, {
        cwd: opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = child.stdout;
      const stderr = child.stderr;
      if (stdout === null || stderr === null) {
        resolvePromise({
          kind: "error",
          exitCode: -1,
          stderr: "cursor: failed to open child process streams",
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
    });
  }
}
